const LOOKAHEAD_M = 1000
const SAMPLE_M    = 20
const SVG_W       = 300   // fallback viewBox width (overridden by clientWidth at render)
const SVG_H       = 100   // fallback viewBox height (overridden by clientHeight at render)
const PAD_B       = 14    // bottom padding in px (labels; Y-scale is always 1)

// Course elevation map viewBox width (unit = 1/1000 of total distance)
const COURSE_VW   = 1000
const COURSE_VH   = 52

export class HUDView {
  #route = null
  #courseTotalM    = 0
  #courseReady     = false

  setRoute(route) {
    this.#route       = route
    this.#courseReady = false
    // 描画は update() の初回呼び出し時に行う（SVG が visible になってから）
  }

  update({
    velocityMs, distanceM, totalDistanceM, elapsedSec, elevationGainM,
    powerW, altitudeFactor = 1, cadenceRpm, torqueNm, heartRateBpm, gradientPercent, altitudeM,
  }) {
    set('hud-speed',    (velocityMs * 3.6).toFixed(1))
    set('hud-distance', (distanceM  / 1000).toFixed(2))
    set('hud-time',     fmtTime(elapsedSec))
    set('hud-elev',     Math.round(elevationGainM).toString())
    set('hud-altitude', altitudeM != null ? Math.round(altitudeM).toString() : '--')
    set('hud-power',    Math.round(powerW).toString())
    const penaltyEl = document.getElementById('hud-power-penalty')
    if (penaltyEl) {
      if (altitudeFactor < 1.0) {
        penaltyEl.textContent = `(-${Math.round((1 - altitudeFactor) * 100)}%)`
        penaltyEl.hidden = false
      } else {
        penaltyEl.hidden = true
      }
    }
    set('hud-cadence',  Math.round(cadenceRpm).toString())
    set('hud-torque',   torqueNm != null ? torqueNm.toFixed(1) : '--.-')
    set('hud-hr',       heartRateBpm > 0 ? heartRateBpm.toString() : '--')
    set('hud-gradient', (gradientPercent >= 0 ? '+' : '') + gradientPercent.toFixed(1))
    const gradBadge = document.getElementById('hud-gradient-badge')
    if (gradBadge) {
      const col = gradientColor(gradientPercent)
      gradBadge.style.color      = col
      gradBadge.style.background = hexToRgba(col, 0.18)
    }

    if (totalDistanceM > 0) {
      const rem = Math.max(0, totalDistanceM - distanceM)
      set('hud-remaining', `残り ${(rem / 1000).toFixed(1)} km`)
    }

    if (this.#route) {
      if (!this.#courseReady) this.#renderCourseElevation()
      this.#renderGradientProfile(distanceM)
      this.#updateCourseMarker(distanceM)
    }
  }

  showFinished() {
    const el = document.getElementById('hud-finish-msg')
    if (el) el.hidden = false
  }

  // ── 1km 勾配プロファイル ───────────────────────────────────────────────
  #renderGradientProfile(currentDistanceM) {
    const svg = document.getElementById('gradient-profile')
    if (!svg || !this.#route) return

    // viewBox をピクセル等倍にすることでテキスト・線の歪みをなくす
    const W = svg.clientWidth  || SVG_W
    const H = svg.clientHeight || SVG_H

    const route  = this.#route
    const totalM = route.totalDistanceM
    const spanM  = LOOKAHEAD_M

    const goalRelX = Math.min((totalM - currentDistanceM) / spanM * W, W)
    const blackRect = goalRelX < W
      ? `<rect x="${goalRelX.toFixed(1)}" y="0" width="${(W - goalRelX).toFixed(1)}" height="${H}" fill="#000"/>`
      : ''

    const endM = Math.min(currentDistanceM + LOOKAHEAD_M, totalM)
    if (endM <= currentDistanceM) { svg.innerHTML = blackRect; return }

    const samples = []
    for (let d = currentDistanceM; d <= endM; d += SAMPLE_M) {
      samples.push({ d, elev: route.getElevationAt(d) ?? 0, grad: route.getGradientAt(d) })
    }
    if (samples[samples.length - 1].d < endM) {
      samples.push({ d: endM, elev: route.getElevationAt(endM) ?? 0, grad: route.getGradientAt(endM) })
    }

    const eleMin      = Math.min(...samples.map((s) => s.elev))
    const ELE_RANGE_M = 50

    const toX = (d) => ((d - currentDistanceM) / spanM) * W
    const toY = (e) => H - PAD_B - ((e - eleMin) / ELE_RANGE_M) * (H - PAD_B - 2)

    // 色ポリゴン
    const parts = []
    let si = 1
    while (si < samples.length) {
      const col = gradientColor(samples[si].grad)
      let ei = si
      while (ei < samples.length && gradientColor(samples[ei].grad) === col) ei++
      const pts = [
        `${toX(samples[si - 1].d).toFixed(1)},${H}`,
        `${toX(samples[si - 1].d).toFixed(1)},${toY(samples[si - 1].elev).toFixed(1)}`,
      ]
      for (let k = si; k < ei; k++) {
        pts.push(`${toX(samples[k].d).toFixed(1)},${toY(samples[k].elev).toFixed(1)}`)
      }
      pts.push(`${toX(samples[ei - 1].d).toFixed(1)},${H}`)
      parts.push(`<polygon points="${pts.join(' ')}" fill="${col}" fill-opacity="0.9" shape-rendering="crispEdges"/>`)
      si = ei
    }

    const polyPts = samples.map((s) => `${toX(s.d).toFixed(1)},${toY(s.elev).toFixed(1)}`).join(' ')
    const line    = `<polyline points="${polyPts}" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.5"/>`
    const marker  = `<line x1="1" y1="0" x2="1" y2="${H - PAD_B}" stroke="#fff" stroke-width="2" opacity="0.8"/>`

    // 距離ラベル（500m・1km）
    const x500   = toX(currentDistanceM + 500)
    const lbl500 = x500 <= W - 2
      ? `<line x1="${x500.toFixed(1)}" y1="${H - PAD_B}" x2="${x500.toFixed(1)}" y2="${H - PAD_B + 4}" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>` +
        `<text x="${x500.toFixed(1)}" y="${H - 2}" fill="rgba(255,255,255,0.7)" font-size="11" text-anchor="middle" font-family="system-ui,sans-serif">500m</text>`
      : ''
    const x1000  = W
    const lbl1km = goalRelX >= W
      ? `<line x1="${x1000 - 1}" y1="${H - PAD_B}" x2="${x1000 - 1}" y2="${H - PAD_B + 4}" stroke="rgba(255,255,255,0.5)" stroke-width="1"/>` +
        `<text x="${x1000 - 3}" y="${H - 2}" fill="rgba(255,255,255,0.7)" font-size="11" text-anchor="end" font-family="system-ui,sans-serif">1km</text>`
      : ''

    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.innerHTML = blackRect + parts.join('') + line + marker + lbl500 + lbl1km
  }

  // ── コース全体標高マップ（ルート確定時に一度だけ描画）────────────────────
  #renderCourseElevation() {
    const svg = document.getElementById('course-elevation-map')
    if (!svg || !this.#route) return

    const route  = this.#route
    const totalM = route.totalDistanceM
    if (totalM <= 0) return

    this.#courseTotalM = totalM

    // 200点サンプル
    const STEPS = 200
    const samples = []
    for (let i = 0; i <= STEPS; i++) {
      const d = (i / STEPS) * totalM
      samples.push({ d, elev: route.getElevationAt(d) ?? 0 })
    }

    const eleMin  = Math.min(...samples.map((s) => s.elev))
    const eleMax  = Math.max(...samples.map((s) => s.elev))
    const eleSpan = eleMax - eleMin || 1

    const toX = (d) => (d / totalM) * COURSE_VW
    const toY = (e) => COURSE_VH - PAD_B - ((e - eleMin) / eleSpan) * (COURSE_VH - PAD_B - 2)

    // 標高ポリゴン
    const pts = [
      `0,${COURSE_VH}`,
      ...samples.map((s) => `${toX(s.d).toFixed(1)},${toY(s.elev).toFixed(1)}`),
      `${COURSE_VW},${COURSE_VH}`,
    ]
    const poly = `<polygon points="${pts.join(' ')}" fill="#1a4c8a" fill-opacity="0.75"/>`
    const line = `<polyline points="${samples.map((s) => `${toX(s.d).toFixed(1)},${toY(s.elev).toFixed(1)}`).join(' ')}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1.5"/>`

    // 10分割の縦線＋距離ラベル
    const divs = []
    for (let i = 1; i <= 10; i++) {
      const d  = (i / 10) * totalM
      const x  = toX(d)
      const km = (d / 1000).toFixed(1)
      divs.push(
        `<line x1="${x.toFixed(1)}" y1="0" x2="${x.toFixed(1)}" y2="${COURSE_VH - PAD_B}" stroke="rgba(255,255,255,0.2)" stroke-width="0.8"/>`,
        `<line x1="${x.toFixed(1)}" y1="${COURSE_VH - PAD_B}" x2="${x.toFixed(1)}" y2="${COURSE_VH}" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"/>`,
        `<text x="${x.toFixed(1)}" y="${COURSE_VH - 1}" fill="rgba(255,255,255,0.8)" font-size="12" text-anchor="middle" font-family="system-ui,sans-serif">${km}km</text>`,
      )
    }

    // 現在位置マーカー（後で x1/x2 を更新）
    const posMarker = `<line id="course-pos-line" x1="0" y1="0" x2="0" y2="${COURSE_VH}" stroke="#fff" stroke-width="2" stroke-dasharray="3,2" opacity="0.9"/>`

    svg.setAttribute('viewBox', `0 0 ${COURSE_VW} ${COURSE_VH}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.innerHTML = poly + line + divs.join('') + posMarker
    this.#courseReady = true
  }

  #updateCourseMarker(distanceM) {
    if (!this.#courseReady || this.#courseTotalM <= 0) return
    const marker = document.getElementById('course-pos-line')
    if (!marker) return
    const x = (distanceM / this.#courseTotalM * COURSE_VW).toFixed(1)
    marker.setAttribute('x1', x)
    marker.setAttribute('x2', x)
  }
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return `rgba(${r},${g},${b},${alpha})`
}

function gradientColor(pct) {
  if (pct < 3)  return '#2ed573'
  if (pct < 6)  return '#ffd32a'
  if (pct < 9)  return '#ee7800'
  if (pct < 12) return '#ff0000'
  return '#4C2E30'
}

function set(id, value) {
  const el = document.getElementById(id)
  if (el) el.textContent = value
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
