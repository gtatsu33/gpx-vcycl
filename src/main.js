import { initDb, getDb }            from './storage/db.js'
import { initDeviceManager }         from './ui/deviceManager.js'
import { createMapView }              from './ui/mapFactory.js'
import { EleView }                    from './ui/eleView.js'
import { activateOwnerModeIfValid, isOwnerMode } from './utils/ownerMode.js'
import { HUDView }                   from './ui/hud.js'
import { initRoutePicker }           from './ui/routePicker.js'
import { RideController }            from './ride/rideController.js'
import { RideEndModal }              from './ui/rideEndModal.js'
import { renderRideHistory }         from './ui/rideHistory.js'
import { DEFAULT_PHYSICS }           from './domain/physics.js'
import { exchangeCode, getConnectionInfo, startAuthorization, disconnect as stravaDisconnect }
  from './strava/auth.js'
import { initWorkoutTab }            from './ui/workoutTab.js'
import { buildWorkoutFit }           from './export/fitWriter.js'
import { uploadToStrava }            from './strava/upload.js'
import { saveRide, markUploaded, markUploadFailed } from './storage/rides.js'
import { Route }                     from './domain/route.js'
import { getRoute }                  from './storage/routes.js'
import { precomputeBearings }        from './mapillary/bearing.js'
import { MapillaryLookahead, ActiveIndexTracker } from './mapillary/lookahead.js'
import { updatePhotoPanel, resetPhotoPanel } from './mapillary/panel.js'

const MAPILLARY_ENABLED = Boolean(import.meta.env.VITE_MAPILLARY_TOKEN)

// ── App version ────────────────────────────────────────────────────────
document.getElementById('app-version').textContent = `v${__APP_VERSION__}`

// ── Mapillary 起動時診断 ────────────────────────────────────────────────
console.info(`[Mapillary] enabled: ${MAPILLARY_ENABLED}${MAPILLARY_ENABLED ? '' : ' (VITE_MAPILLARY_TOKEN 未設定)'}`)

// ── DB status ──────────────────────────────────────────────────────────
const dbStatusEl = document.getElementById('db-status')

// ── Wake Lock ──────────────────────────────────────────────────────────
let wakeLock = null

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
  try {
    wakeLock = await navigator.wakeLock.request('screen')
    wakeLock.addEventListener('release', () => { wakeLock = null })
  } catch { /* unsupported or denied — silent */ }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {})
  wakeLock = null
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    const routeActive = document.querySelector('#tab-route.active')
    if (routeActive) requestWakeLock()
  }
})

// ── Tab switching ──────────────────────────────────────────────────────
let mapView = null
let eleView = null
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab
    document.querySelectorAll('.tab-btn').forEach((b)     => b.classList.toggle('active', b.dataset.tab === target))
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.toggle('active', c.id === `tab-${target}`))
    if (target === 'route' || target === 'workout') requestWakeLock()
    if (target !== 'route' && target !== 'workout') releaseWakeLock()
    if (target === 'route')   requestAnimationFrame(() => { mapView?.invalidateSize(); eleView?.resize() })
    if (target === 'history') renderRideHistory()
  })
})

// ── Settings modal ─────────────────────────────────────────────────────
const settingsBtn  = document.getElementById('settings-btn')
const modalOverlay = document.getElementById('modal-overlay')
const modalClose   = document.getElementById('modal-close')

settingsBtn.addEventListener('click',  () => { updateStravaStatusUI(); modalOverlay.classList.add('open') })
modalClose.addEventListener('click',   () => { saveSettings(); modalOverlay.classList.remove('open') })
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) { saveSettings(); modalOverlay.classList.remove('open') }
})

document.getElementById('cda-input').addEventListener('input', (e) => {
  document.getElementById('cda-val').textContent = parseFloat(e.target.value).toFixed(2)
})
document.getElementById('crr-input').addEventListener('input', (e) => {
  document.getElementById('crr-val').textContent = parseFloat(e.target.value).toFixed(4)
})
document.getElementById('trainer-difficulty-input').addEventListener('input', (e) => {
  document.getElementById('trainer-difficulty-val').textContent = parseFloat(e.target.value).toFixed(1)
})

// ── Strava ─────────────────────────────────────────────────────────────
document.getElementById('strava-connect-btn').addEventListener('click', startAuthorization)
document.getElementById('strava-disconnect-btn').addEventListener('click', async () => {
  if (!confirm('Strava接続を解除しますか？')) return
  await stravaDisconnect()
  updateStravaStatusUI()
})

async function updateStravaStatusUI() {
  const info         = await getConnectionInfo()
  const statusEl     = document.getElementById('strava-status')
  const connectBtn   = document.getElementById('strava-connect-btn')
  const disconnectBtn = document.getElementById('strava-disconnect-btn')
  if (info) {
    statusEl.textContent    = `接続済: ${info.athleteName}`
    connectBtn.hidden       = true
    disconnectBtn.hidden    = false
  } else {
    statusEl.textContent    = '未接続'
    connectBtn.hidden       = false
    disconnectBtn.hidden    = true
  }
}

function getFtpW() {
  return parseInt(document.getElementById('ftp-input').value, 10) || 170
}

async function loadSettings() {
  const db = getDb()
  const set = (id, key) => db.get('settings', key).then((v) => { if (v != null) document.getElementById(id).value = v })
  set('rider-weight-input', 'riderWeightKg')
  set('bike-weight-input',  'bikeWeightKg')
  set('smoothing-input',    'smoothingWindowSec')
  set('ftp-input',          'ftpW')

  const cdaEl = document.getElementById('cda-input')
  const crrEl = document.getElementById('crr-input')
  db.get('settings', 'cdA').then((v) => {
    if (v != null) { cdaEl.value = v; document.getElementById('cda-val').textContent = parseFloat(v).toFixed(2) }
  })
  db.get('settings', 'crr').then((v) => {
    if (v != null) { crrEl.value = v; document.getElementById('crr-val').textContent = parseFloat(v).toFixed(4) }
  })
  db.get('settings', 'trainerControlEnabled').then((v) => {
    document.getElementById('trainer-control-toggle').checked = v ?? true
  })
  db.get('settings', 'altitudeEffectEnabled').then((v) => {
    document.getElementById('altitude-effect-toggle').checked = v ?? true
  })
  db.get('settings', 'trainerDifficulty').then((v) => {
    const val = v ?? 0.5
    document.getElementById('trainer-difficulty-input').value = val
    document.getElementById('trainer-difficulty-val').textContent = parseFloat(val).toFixed(1)
  })
  db.get('settings', 'mapProvider').then((v) => {
    const current = v ?? 'osm'
    document.querySelectorAll('input[name="map-provider"]').forEach((radio) => {
      radio.checked = radio.value === current
      radio.addEventListener('change', async (e) => {
        await getDb().put('settings', e.target.value, 'mapProvider')
        location.reload()
      })
    })
  })
}

async function saveSettings() {
  const db  = getDb()
  const num = (id) => parseFloat(document.getElementById(id).value)
  await Promise.all([
    db.put('settings', num('rider-weight-input'), 'riderWeightKg'),
    db.put('settings', num('bike-weight-input'),  'bikeWeightKg'),
    db.put('settings', num('cda-input'),          'cdA'),
    db.put('settings', num('crr-input'),          'crr'),
    db.put('settings', num('smoothing-input'),    'smoothingWindowSec'),
    db.put('settings', document.getElementById('trainer-control-toggle').checked,  'trainerControlEnabled'),
    db.put('settings', document.getElementById('altitude-effect-toggle').checked,   'altitudeEffectEnabled'),
    db.put('settings', num('trainer-difficulty-input'), 'trainerDifficulty'),
    db.put('settings', num('ftp-input'), 'ftpW'),
  ])
}

async function loadPhysicsParams() {
  const db      = getDb()
  const riderKg = (await db.get('settings', 'riderWeightKg')) ?? 70
  const bikeKg  = (await db.get('settings', 'bikeWeightKg'))  ?? 10
  const cdA     = (await db.get('settings', 'cdA'))           ?? DEFAULT_PHYSICS.cdA
  const crr     = (await db.get('settings', 'crr'))           ?? DEFAULT_PHYSICS.crr
  return { massKg: riderKg + bikeKg, cdA, crr }
}

// ── Ride controls ──────────────────────────────────────────────────────
let rideController           = null
let selectedRoute            = null
let selectedRouteId          = null
let selectedRouteName        = ''
let selectedPointsWithBearing  = null
let selectedReversed           = false
let selectedMapillaryLookahead = null
let selectedMapillaryTracker   = null
let getLiveData              = null
let ftmsClient      = null
let isDummyTrainer  = () => false
let hudView         = null
let rideEndModal    = null
let isPaused        = false

// ── Route session persistence ───────────────────────────────────────────
const ROUTE_SESSION_KEY = 'route-session'

function saveRouteSession() {
  if (!rideController || !selectedRouteId) return
  const cp = rideController.getCheckpoint()
  if (!cp) return
  try { localStorage.setItem(ROUTE_SESSION_KEY, JSON.stringify(cp)) }
  catch { /* storage full */ }
}

function clearRouteSession() { localStorage.removeItem(ROUTE_SESSION_KEY) }

window.addEventListener('beforeunload', () => { if (rideController && selectedRouteId) saveRouteSession() })

const startBtn       = document.getElementById('start-ride-btn')
const pauseResumeBtn = document.getElementById('pause-resume-btn')
const stopBtn        = document.getElementById('stop-ride-btn')
const rideControlsEl = document.getElementById('ride-controls')
const preRidePanelEl = document.getElementById('pre-ride-panel')
const hudPanelEl     = document.getElementById('hud-panel')

document.getElementById('recenter-btn').addEventListener('click', () => mapView?.recenter())
document.getElementById('reset-trainer-btn').addEventListener('click', () => {
  ftmsClient?.reset().catch((err) => console.warn('Reset trainer failed:', err))
})

function showStravaWarningDialog() {
  return new Promise((resolve) => {
    const overlay = document.getElementById('strava-warning-overlay')
    overlay.classList.add('open')
    const cancel  = document.getElementById('strava-warning-cancel')
    const proceed = document.getElementById('strava-warning-proceed')
    const cleanup = (val) => {
      overlay.classList.remove('open')
      cancel.onclick  = null
      proceed.onclick = null
      resolve(val)
    }
    cancel.onclick  = () => cleanup(false)
    proceed.onclick = () => cleanup(true)
  })
}

startBtn.addEventListener('click', async () => {
  if (!selectedRoute || !getLiveData) return

  if (!isDummyTrainer()) {
    const stravaInfo = await getConnectionInfo()
    if (!stravaInfo) {
      const ok = await showStravaWarningDialog()
      if (!ok) return
    }
  }

  const params                 = await loadPhysicsParams()
  const smoothingWindowSec     = (await getDb().get('settings', 'smoothingWindowSec')) ?? 3
  const trainerEnabled         = document.getElementById('trainer-control-toggle').checked
  const trainerDifficulty      = (await getDb().get('settings', 'trainerDifficulty')) ?? 0.5
  const altitudeEffectEnabled  = document.getElementById('altitude-effect-toggle').checked

  clearRouteSession()

  // onRouteSelected 時に作成済み（index 0 がプレビュー取得済みの状態で引き継ぐ）
  const mapillaryLookahead = selectedMapillaryLookahead
  const mapillaryTracker   = selectedMapillaryTracker

  rideController = new RideController({
    route:      selectedRoute,
    routeId:    selectedRouteId,
    routeName:  selectedRouteName,
    params,
    mapView,
    hudView,
    eleView,
    getLiveData,
    smoothingWindowSec,
    trainerDifficulty,
    altitudeEffectEnabled,
    ftmsClient:  trainerEnabled ? ftmsClient : null,
    mapillaryLookahead,
    mapillaryTracker,
    onFinished: (summary) => {
      rideController = null
      clearRouteSession()
      setRidingState(false)
      if (summary && !isDummyTrainer()) rideEndModal.show(summary)
    },
  })
  rideController.start()
  setRidingState(true)
})

pauseResumeBtn.addEventListener('click', () => {
  if (!rideController) return
  if (isPaused) {
    rideController.resume()
    isPaused = false
    pauseResumeBtn.textContent = '⏸ 一時停止'
  } else {
    rideController.pause()
    isPaused = true
    pauseResumeBtn.textContent = '▶ 再開'
    saveRouteSession()
  }
})

stopBtn.addEventListener('click', () => {
  const summary = rideController?.stop()
  rideController = null
  clearRouteSession()
  setRidingState(false)
  if (summary && !isDummyTrainer()) rideEndModal.show(summary)
})

function setRidingState(riding) {
  preRidePanelEl.hidden = riding
  hudPanelEl.hidden     = !riding
  rideControlsEl.hidden = !riding
  document.getElementById('course-elevation-map').style.display = riding ? 'block' : 'none'
  if (riding) {
    isPaused = false
    pauseResumeBtn.textContent = '⏸ 一時停止'
    document.getElementById('hud-finish-msg').hidden = true
  }
}

// ── Init ───────────────────────────────────────────────────────────────
async function init() {
  try {
    await initDb()
    dbStatusEl.textContent = 'DB初期化済み'
    dbStatusEl.className   = 'ready'
  } catch (err) {
    dbStatusEl.textContent = `DB初期化エラー: ${err.message}`
    dbStatusEl.className   = 'error'
    console.error(err)
    return
  }

  // オーナーモード: URLに ?owner=PASSCODE があれば検証してセッションに記録
  await activateOwnerModeIfValid()
  if (isOwnerMode()) {
    document.getElementById('map-provider-group').hidden = false
  }

  // Strava OAuth コールバック処理（リダイレクトで戻ってきた場合）
  let stravaJustConnected = false
  const cbParams = new URLSearchParams(window.location.search)
  const cbCode   = cbParams.get('code')
  if (cbCode && (cbParams.get('scope') ?? '').includes('activity')) {
    try {
      await exchangeCode(cbCode)
      stravaJustConnected = true
    } catch (err) {
      console.error('Strava auth failed:', err)
      showToast(`Strava認証失敗: ${err.message}`, 8000)
    }
    history.replaceState({}, '', window.location.pathname)
  }

  const result    = await initDeviceManager({ getFtpW })
  getLiveData     = result.getLiveData
  ftmsClient      = result.ftmsClient
  isDummyTrainer  = result.isDummyTrainer

  const mapProvider = (await getDb().get('settings', 'mapProvider')) ?? 'osm'
  const isOsmMode   = !(mapProvider === 'google' && isOwnerMode())
  const eleViewEl   = document.getElementById('ele-view')
  eleViewEl.hidden  = !isOsmMode

  mapView = await createMapView(
    document.getElementById('map-inner'),
    document.getElementById('map-container'),
  )
  if (isOsmMode) eleView = new EleView(eleViewEl)

  hudView = new HUDView()

  rideEndModal = new RideEndModal({
    onClose: () => renderRideHistory(),
  })

  await initRoutePicker(mapView, {
    onRouteSelected: ({ route, id, name, reversed = false }) => {
      selectedRoute             = route
      selectedRouteId           = id
      selectedRouteName         = name
      selectedReversed          = reversed
      selectedPointsWithBearing = MAPILLARY_ENABLED ? precomputeBearings(route.points) : null
      startBtn.disabled = false
      eleView?.setRoute(route)

      // ルート選択時に1枚目をプレビュー表示
      selectedMapillaryLookahead = null
      selectedMapillaryTracker   = null
      if (MAPILLARY_ENABLED && selectedPointsWithBearing && id != null) {
        const cachePrefix = `${id}:${reversed ? 'r' : 'f'}`
        const lookahead   = new MapillaryLookahead(cachePrefix, selectedPointsWithBearing)
        selectedMapillaryLookahead = lookahead
        selectedMapillaryTracker   = new ActiveIndexTracker(selectedPointsWithBearing)
        resetPhotoPanel()
        // tick(0) の完了後にパネルを更新（ルートが切り替わっていたら無視）
        lookahead.tick(0).then(() => {
          if (selectedMapillaryLookahead !== lookahead) return
          const { status, image, routeBearing } = lookahead.getStateFor(0)
          updatePhotoPanel(status, image, routeBearing, 0)
        })
      }
    },
  })

  initWorkoutTab({
    getLiveData,
    ftmsClient,
    getFtpW,
    isDummyTrainer,
    getPhysicsParams: loadPhysicsParams,
    onWorkoutEnd: (summary) => showWorkoutEndModal(summary),
  })

  await loadSettings()

  // ルートセッション復元
  try {
    const routeSession = JSON.parse(localStorage.getItem(ROUTE_SESSION_KEY))
    if (routeSession) {
      const record = await getRoute(routeSession.routeId)
      if (record) {
        const route                 = Route.fromGpx(record.gpxText)
        const params                = await loadPhysicsParams()
        const smoothingWindowSec    = (await getDb().get('settings', 'smoothingWindowSec')) ?? 3
        const trainerEnabled        = document.getElementById('trainer-control-toggle').checked
        const trainerDifficulty     = (await getDb().get('settings', 'trainerDifficulty')) ?? 0.5
        const altitudeEffectEnabled = document.getElementById('altitude-effect-toggle').checked

        selectedRoute             = route
        selectedRouteId           = routeSession.routeId
        selectedRouteName         = routeSession.routeName
        selectedReversed          = false // セッション復元時は逆走フラグを保持しないため forward 扱い
        selectedPointsWithBearing = MAPILLARY_ENABLED ? precomputeBearings(route.points) : null
        startBtn.disabled = false
        eleView?.setRoute(route)

        let mapillaryLookahead = null
        let mapillaryTracker   = null
        if (MAPILLARY_ENABLED && selectedPointsWithBearing) {
          const cachePrefix  = `${routeSession.routeId}:f`
          mapillaryLookahead = new MapillaryLookahead(cachePrefix, selectedPointsWithBearing)
          mapillaryTracker   = new ActiveIndexTracker(selectedPointsWithBearing)
        }

        rideController = new RideController({
          route, routeId: routeSession.routeId, routeName: routeSession.routeName,
          params, mapView, hudView, eleView, getLiveData, smoothingWindowSec, trainerDifficulty,
          altitudeEffectEnabled,
          ftmsClient: trainerEnabled ? ftmsClient : null,
          mapillaryLookahead,
          mapillaryTracker,
          onFinished: (summary) => {
            rideController = null
            clearRouteSession()
            setRidingState(false)
            if (summary && !isDummyTrainer()) rideEndModal.show(summary)
          },
        })
        rideController.restoreFrom(routeSession)

        document.querySelector('.tab-btn[data-tab="route"]')?.click()
        setRidingState(true)
        isPaused = true
        pauseResumeBtn.textContent = '▶ 再開（中断から復元）'
      } else {
        clearRouteSession()
      }
    }
  } catch (err) {
    console.error('Route session restore failed:', err)
    clearRouteSession()
  }

  if (stravaJustConnected) showToast('Strava接続完了。デバイスを再接続してください。', 7000)
}

// ── Workout end modal ──────────────────────────────────────────────────────────

function showWorkoutEndModal(summary) {
  const overlay    = document.getElementById('workout-end-overlay')
  const nameInput  = document.getElementById('workout-end-name')
  const statusEl   = document.getElementById('workout-end-status')
  const summaryEl  = document.getElementById('workout-end-summary')
  const uploadBtn  = document.getElementById('workout-end-upload-btn')
  const saveBtn    = document.getElementById('workout-end-save-btn')
  const discardBtn = document.getElementById('workout-end-discard-btn')

  const elapsedS = (summary.endedAt - summary.startedAt) / 1000
  const avgPower = summary.samples.length
    ? Math.round(summary.samples.reduce((s, x) => s + x.powerW, 0) / summary.samples.length)
    : 0
  const avgHR = summary.samples.length
    ? Math.round(summary.samples.reduce((s, x) => s + x.heartRateBpm, 0) / summary.samples.length)
    : 0

  const distKm = ((summary.samples.at(-1)?.distanceM ?? 0) / 1000).toFixed(2)
  summaryEl.innerHTML = `
    <div class="summary-row"><span>距離（仮想）</span><span>${distKm} km</span></div>
    <div class="summary-row"><span>時間</span><span>${fmtTimeS(elapsedS)}</span></div>
    <div class="summary-row"><span>平均パワー</span><span>${avgPower} W</span></div>
    <div class="summary-row"><span>平均心拍</span><span>${avgHR > 0 ? avgHR + ' bpm' : '--'}</span></div>
  `
  nameInput.value = summary.workoutName ? `gpx-vcycl workout : ${summary.workoutName}` : 'gpx-vcycl workout'
  statusEl.textContent = ''
  statusEl.className   = 'ride-end-status'
  overlay.classList.add('open')

  const close = () => overlay.classList.remove('open')

  const setLoading = (on) => { uploadBtn.disabled = saveBtn.disabled = discardBtn.disabled = on }

  uploadBtn.onclick = async () => {
    const name = nameInput.value.trim() || 'gpx-vcycl workout'
    setLoading(true)
    statusEl.textContent = '保存中...'; statusEl.className = 'ride-end-status'
    let rideId
    try {
      rideId = await saveRide({ ...summary, routeName: name })
    } catch (err) {
      statusEl.textContent = `保存失敗: ${err.message}`; statusEl.className = 'ride-end-status error'
      setLoading(false); return
    }
    statusEl.textContent = 'Stravaにアップロード中...'
    try {
      const fitData = buildWorkoutFit({ ...summary, workoutName: name })
      const actId   = await uploadToStrava(fitData, { name, trainer: true })
      await markUploaded(rideId, actId)
      statusEl.textContent = 'アップロード成功！'
      renderRideHistory()
      setTimeout(close, 2000)
    } catch (err) {
      await markUploadFailed(rideId, err.message).catch(() => {})
      statusEl.textContent = `アップロード失敗（ローカルに保存済み）: ${err.message}`
      statusEl.className   = 'ride-end-status error'
      setLoading(false)
    }
  }

  saveBtn.onclick = async () => {
    await saveRide({ ...summary, routeName: nameInput.value.trim() || 'gpx-vcycl workout' })
    renderRideHistory()
    close()
  }

  discardBtn.onclick = close
}

function showToast(msg, durationMs = 4000) {
  const el = Object.assign(document.createElement('div'), {
    textContent: msg,
    style: 'position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);background:#212f3d;color:#ccd8e4;border:1px solid #38bdf8;border-radius:8px;padding:0.6rem 1.2rem;font-size:0.875rem;z-index:9999;pointer-events:none;',
  })
  document.body.appendChild(el)
  setTimeout(() => el.remove(), durationMs)
}

function fmtTimeS(totalSec) {
  const s = Math.floor(totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

init()
