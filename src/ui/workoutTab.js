import { saveWorkout, listWorkouts, deleteWorkout } from '../storage/workouts.js'
import { parseZwo, totalDurationS, ftpColor } from '../workout/zwoParser.js'
import { WorkoutController } from '../workout/workoutController.js'
import { buildWorkoutFit } from '../export/fitWriter.js'
import { uploadToStrava } from '../strava/upload.js'
import { getConnectionInfo } from '../strava/auth.js'

// ── Profile SVG helpers ──────────────────────────────────────────────────────

/**
 * セグメント配列を受け取り、時間×負荷のSVGを描画する。
 * @param {SVGElement} svg
 * @param {Array} segments
 * @param {number} [w] viewBox width
 * @param {number} [h] viewBox height
 */
function renderProfileSvg(svg, segments, w = 400, h = 60) {
  const totalS  = totalDurationS(segments)
  if (totalS <= 0) { svg.innerHTML = ''; return }

  const PAD_TOP = 6
  const usableH = h - PAD_TOP

  const toX = (s) => (s / totalS) * w
  const toY = (ftp) => h - ftp * usableH

  // FTP上限（グラフ表示の最高点）
  let maxFtp = 1.0
  for (const seg of segments) {
    if (seg.type === 'intervals') maxFtp = Math.max(maxFtp, seg.onPowerFtp)
    else maxFtp = Math.max(maxFtp, seg.powerHighFtp)
  }
  maxFtp = Math.max(maxFtp, 1.25)
  const scaleY = (ftp) => h - (ftp / maxFtp) * usableH

  const rects = []
  let x = 0
  for (const seg of segments) {
    if (seg.type === 'intervals') {
      const cycleS = seg.onDurationS + seg.offDurationS
      const cycles = Math.round(seg.repeatCount)
      for (let i = 0; i < cycles; i++) {
        const xOn  = toX(x)
        const wOn  = toX(seg.onDurationS)
        const hOn  = scaleY(0) - scaleY(seg.onPowerFtp)
        rects.push(`<rect x="${xOn.toFixed(1)}" y="${scaleY(seg.onPowerFtp).toFixed(1)}" width="${wOn.toFixed(1)}" height="${hOn.toFixed(1)}" fill="${ftpColor(seg.onPowerFtp)}"/>`)
        const xOff = toX(x + seg.onDurationS)
        const wOff = toX(seg.offDurationS)
        const hOff = scaleY(0) - scaleY(seg.offPowerFtp)
        if (hOff > 0) rects.push(`<rect x="${xOff.toFixed(1)}" y="${scaleY(seg.offPowerFtp).toFixed(1)}" width="${wOff.toFixed(1)}" height="${hOff.toFixed(1)}" fill="${ftpColor(seg.offPowerFtp)}"/>`)
        x += cycleS
      }
    } else if (seg.type === 'ramp') {
      // rampは多角形で描画
      const STEPS = 20
      const pts   = [`${toX(x).toFixed(1)},${h}`]
      for (let i = 0; i <= STEPS; i++) {
        const t   = i / STEPS
        const ftp = seg.powerLowFtp + (seg.powerHighFtp - seg.powerLowFtp) * t
        pts.push(`${toX(x + t * seg.durationS).toFixed(1)},${scaleY(ftp).toFixed(1)}`)
      }
      pts.push(`${toX(x + seg.durationS).toFixed(1)},${h}`)
      // グラデーション代わりに平均色
      const midFtp = (seg.powerLowFtp + seg.powerHighFtp) / 2
      rects.push(`<polygon points="${pts.join(' ')}" fill="${ftpColor(midFtp)}"/>`)
      x += seg.durationS
    } else if (seg.type === 'free') {
      rects.push(`<rect x="${toX(x).toFixed(1)}" y="${(h * 0.7).toFixed(1)}" width="${toX(seg.durationS).toFixed(1)}" height="${(h * 0.3).toFixed(1)}" fill="#444" opacity="0.5"/>`)
      x += seg.durationS
    } else {
      // steady
      const bx = toX(x)
      const bw = toX(seg.durationS)
      const by = scaleY(seg.powerLowFtp)
      const bh = scaleY(0) - by
      if (bh > 0) rects.push(`<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${ftpColor(seg.powerLowFtp)}"/>`)
      x += seg.durationS
    }
  }

  // FTP点線
  const ftpY = scaleY(1.0).toFixed(1)
  const ftpLine = `<line x1="0" y1="${ftpY}" x2="${w}" y2="${ftpY}" stroke="rgba(255,255,255,0.6)" stroke-width="1" stroke-dasharray="4,3"/>`

  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.setAttribute('preserveAspectRatio', 'none')
  svg.innerHTML = rects.join('') + ftpLine
}

// ── Segment list rendering ────────────────────────────────────────────────────

function fmtDurS(s) {
  const m = Math.floor(s / 60)
  const sec = Math.round(s % 60)
  return sec > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${m}:00`
}

function segLabel(seg, ftpW) {
  const w = (ftp) => Math.round(ftp * ftpW) + 'W'
  switch (seg.type) {
    case 'steady':    return `${w(seg.powerLowFtp)}  ${fmtDurS(seg.durationS)}`
    case 'ramp':      return `${w(seg.powerLowFtp)} → ${w(seg.powerHighFtp)}  ${fmtDurS(seg.durationS)}`
    case 'intervals': return `${w(seg.onPowerFtp)} / ${w(seg.offPowerFtp)}  ×${seg.repeatCount}  ${fmtDurS(seg.durationS)}`
    case 'free':      return `Free  ${fmtDurS(seg.durationS)}`
    default:          return fmtDurS(seg.durationS)
  }
}

function segFtpForColor(seg) {
  if (seg.type === 'intervals') return seg.onPowerFtp
  if (seg.type === 'free')      return 0
  return seg.powerHighFtp
}

// ── Main exported init ────────────────────────────────────────────────────────

export function initWorkoutTab({ getLiveData, ftmsClient, getFtpW, onWorkoutEnd }) {
  const loadBtn    = document.getElementById('load-zwo-btn')
  const fileInput  = document.getElementById('zwo-file-input')
  const zwoListEl  = document.getElementById('zwo-list')
  const profileSvg = document.getElementById('workout-profile-svg')
  const startBtn   = document.getElementById('start-workout-btn')
  const prePanel   = document.getElementById('workout-pre-panel')
  const runPanel   = document.getElementById('workout-run-panel')
  const pauseBtn   = document.getElementById('workout-pause-btn')
  const stopBtn    = document.getElementById('workout-stop-btn')
  const segListEl  = document.getElementById('workout-seg-list')
  const progressSvg = document.getElementById('workout-progress-svg')

  let selectedWorkout = null  // { record, segments }
  let controller      = null
  let isPaused        = false

  loadBtn.addEventListener('click', () => fileInput.click())

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]
    if (!file) return
    fileInput.value = ''
    const text = await file.text()
    try {
      const { name, segments } = parseZwo(text)
      await saveWorkout({ name, zwoText: text, totalDurationS: totalDurationS(segments) })
      await renderList()
    } catch (err) {
      alert(`ZWOの読み込みに失敗しました: ${err.message}`)
    }
  })

  startBtn.addEventListener('click', async () => {
    if (!selectedWorkout || !getLiveData) return
    const ftpW = getFtpW()
    controller = new WorkoutController({
      segments:  selectedWorkout.segments,
      ftpW,
      getLiveData,
      ftmsClient,
      onStateUpdate: (state) => updateRunUI(state, selectedWorkout.segments),
      onFinished:    (summary) => {
        controller = null
        setRunningState(false)
        if (summary) onWorkoutEnd(summary)
      },
      onAutoPause: () => {
        pauseBtn.textContent = '自動一時停止中 ▶ 再開'
      },
      onAutoResume: () => {
        isPaused = false
        pauseBtn.textContent = '⏸ 一時停止'
      },
    })
    buildProgressSvg(progressSvg, selectedWorkout.segments)
    buildSegmentList(segListEl, selectedWorkout.segments, ftpW)
    setRunningState(true)
    controller.start()
  })

  pauseBtn.addEventListener('click', () => {
    if (!controller) return
    if (controller.isAutoPaused) {
      controller.resumeFromAutoPause()
      return
    }
    if (isPaused) {
      controller.resume()
      isPaused = false
      pauseBtn.textContent = '⏸ 一時停止'
    } else {
      controller.pause()
      isPaused = true
      pauseBtn.textContent = '▶ 再開'
    }
  })

  stopBtn.addEventListener('click', () => {
    const summary = controller?.stop()
    controller = null
    setRunningState(false)
    if (summary) onWorkoutEnd(summary)
  })

  function setRunningState(running) {
    prePanel.hidden = running
    runPanel.hidden = !running
    if (running) {
      isPaused = false
      pauseBtn.textContent = '⏸ 一時停止'
    }
  }

  function selectWorkout(record) {
    const segs = parseZwo(record.zwoText).segments
    selectedWorkout = { record, segments: segs }
    profileSvg.hidden = false
    renderProfileSvg(profileSvg, segs, 800, 80)
    startBtn.disabled = false
    zwoListEl.querySelectorAll('.zwo-item').forEach((el) =>
      el.classList.toggle('selected', el.dataset.id === String(record.id))
    )
  }

  async function renderList() {
    const workouts = await listWorkouts()
    zwoListEl.innerHTML = ''
    selectedWorkout     = null
    startBtn.disabled   = true
    profileSvg.hidden   = true

    if (workouts.length === 0) {
      zwoListEl.innerHTML = '<p class="route-empty">保存済みのワークアウトはありません</p>'
      return
    }

    for (const r of workouts) {
      const segs    = parseZwo(r.zwoText).segments
      const totalS  = totalDurationS(segs)
      const item    = document.createElement('div')
      item.className    = 'zwo-item'
      item.dataset.id   = r.id

      const miniSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      miniSvg.classList.add('zwo-mini-profile')
      renderProfileSvg(miniSvg, segs, 120, 30)

      item.innerHTML = `
        <div class="zwo-info" role="button" tabindex="0">
          <span class="zwo-name">${escHtml(r.name)}</span>
          <span class="zwo-meta">${fmtDurS(totalS)}</span>
        </div>
      `
      item.querySelector('.zwo-info').prepend(miniSvg)

      const delBtn = document.createElement('button')
      delBtn.className   = 'route-delete-btn'
      delBtn.textContent = '✕'
      delBtn.setAttribute('aria-label', '削除')
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (!confirm(`「${r.name}」を削除しますか？`)) return
        await deleteWorkout(r.id)
        await renderList()
      })
      item.appendChild(delBtn)

      item.querySelector('.zwo-info').addEventListener('click', () => selectWorkout(r))
      zwoListEl.appendChild(item)
    }
  }

  renderList()

  // ── Running UI ──────────────────────────────────────────────────────────────

  function updateRunUI(state, segments) {
    setText('wo-hud-time',    fmtTime(state.elapsedS))
    setText('wo-hud-power',   Math.round(state.powerW))
    setText('wo-hud-cadence', Math.round(state.cadenceRpm))
    setText('wo-hud-hr',      state.heartRateBpm > 0 ? state.heartRateBpm : '--')
    setText('wo-hud-target',  state.targetPowerW !== null ? Math.round(state.targetPowerW) : '--')

    // Target cadence
    const targetCad = state.segment?.cadenceRpm ?? null
    setText('wo-hud-target-cadence', targetCad !== null ? Math.round(targetCad) : 'FREE')

    // Remaining time
    const remS = Math.max(0, state.totalS - state.elapsedS)
    setText('wo-hud-remaining', `残り ${fmtTime(remS)}`)

    // Deviation alerts
    updateAlerts(state, targetCad)

    // Scroll segment list
    scrollSegList(state.segmentIdx)

    // Move progress cursor
    updateProgressCursor(progressSvg, state.elapsedS, state.totalS)
  }

  function updateAlerts(state, targetCadRpm) {
    const alerts = []

    // Power deviation (ERGモード時)
    const powerEl = document.getElementById('wo-hud-power')
    if (state.targetPowerW !== null && state.powerW > 5) {
      const diff = Math.abs(state.powerW - state.targetPowerW)
      const pct  = diff / state.targetPowerW
      if (pct > 0.1 || diff > 15) {
        powerEl?.classList.add('alert')
        alerts.push(state.powerW < state.targetPowerW ? 'パワーが足りません' : 'パワーが高すぎます')
      } else {
        powerEl?.classList.remove('alert')
      }
    } else {
      powerEl?.classList.remove('alert')
    }

    // Cadence deviation
    const cadEl = document.getElementById('wo-hud-cadence')
    if (targetCadRpm !== null && state.cadenceRpm > 0) {
      const diff = Math.abs(state.cadenceRpm - targetCadRpm)
      if (diff > 10) {
        cadEl?.classList.add('alert')
        alerts.push(state.cadenceRpm < targetCadRpm ? 'ケイデンスを上げてください' : 'ケイデンスを下げてください')
      } else {
        cadEl?.classList.remove('alert')
      }
    } else {
      cadEl?.classList.remove('alert')
    }

    setText('wo-alert-msg', alerts.join('　'))
  }

  function buildSegmentList(container, segments, ftpW) {
    container.innerHTML = ''
    for (let i = 0; i < segments.length; i++) {
      const seg   = segments[i]
      const color = ftpColor(segFtpForColor(seg))
      const row   = document.createElement('div')
      row.className           = 'wo-seg-row'
      row.dataset.idx         = i
      row.dataset.segColor    = color
      row.style.background    = hexWithAlpha(color, 0.3)
      row.style.borderColor   = color
      row.textContent = segLabel(seg, ftpW)
      container.appendChild(row)
    }
  }

  function scrollSegList(idx) {
    const rows = segListEl.querySelectorAll('.wo-seg-row')
    rows.forEach((r, i) => {
      const isCurrent = i === idx
      r.classList.toggle('current', isCurrent)
      const color = r.dataset.segColor || '#888888'
      r.style.background = hexWithAlpha(color, isCurrent ? 0.72 : 0.3)
    })
    rows[idx]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

// ── Progress SVG ─────────────────────────────────────────────────────────────

function buildProgressSvg(svg, segments) {
  renderProfileSvg(svg, segments, 1000, 60)
  // Add cursor line (will be updated each tick)
  const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  cursor.id = 'workout-progress-cursor'
  cursor.setAttribute('x1', '0'); cursor.setAttribute('x2', '0')
  cursor.setAttribute('y1', '0'); cursor.setAttribute('y2', '60')
  cursor.setAttribute('stroke', '#ffffff')
  cursor.setAttribute('stroke-width', '1.5')
  cursor.setAttribute('stroke-dasharray', '4,3')
  svg.appendChild(cursor)
}

function updateProgressCursor(svg, elapsedS, totalS) {
  const cursor = document.getElementById('workout-progress-cursor')
  if (!cursor || totalS <= 0) return
  const x = ((elapsedS / totalS) * 1000).toFixed(1)
  cursor.setAttribute('x1', x)
  cursor.setAttribute('x2', x)
}

// ── Utility ──────────────────────────────────────────────────────────────────

function hexWithAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function setText(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val
}

function fmtTime(totalSec) {
  const s = Math.floor(totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0
    ? `${h}:${pad(m)}:${pad(s % 60)}`
    : `${m}:${pad(s % 60)}`
}

function pad(n) { return String(n).padStart(2, '0') }

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
