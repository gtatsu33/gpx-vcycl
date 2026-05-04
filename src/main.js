import { initDb, getDb }            from './storage/db.js'
import { initDeviceManager }         from './ui/deviceManager.js'
import { MapView }                   from './ui/map.js'
import { HUDView }                   from './ui/hud.js'
import { initRoutePicker }           from './ui/routePicker.js'
import { RideController }            from './ride/rideController.js'
import { RideEndModal }              from './ui/rideEndModal.js'
import { renderRideHistory }         from './ui/rideHistory.js'
import { DEFAULT_PHYSICS }           from './domain/physics.js'
import { exchangeCode, getConnectionInfo, startAuthorization, disconnect as stravaDisconnect }
  from './strava/auth.js'

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
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab
    document.querySelectorAll('.tab-btn').forEach((b)     => b.classList.toggle('active', b.dataset.tab === target))
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.toggle('active', c.id === `tab-${target}`))
    if (target === 'route')   { requestAnimationFrame(() => mapView?.invalidateSize()); requestWakeLock() }
    if (target !== 'route')   releaseWakeLock()
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

async function loadSettings() {
  const db = getDb()
  const set = (id, key) => db.get('settings', key).then((v) => { if (v != null) document.getElementById(id).value = v })
  set('rider-weight-input', 'riderWeightKg')
  set('bike-weight-input',  'bikeWeightKg')
  set('smoothing-input',    'smoothingWindowSec')

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
  db.get('settings', 'trainerDifficulty').then((v) => {
    const val = v ?? 0.5
    document.getElementById('trainer-difficulty-input').value = val
    document.getElementById('trainer-difficulty-val').textContent = parseFloat(val).toFixed(1)
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
    db.put('settings', document.getElementById('trainer-control-toggle').checked, 'trainerControlEnabled'),
    db.put('settings', num('trainer-difficulty-input'), 'trainerDifficulty'),
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
let rideController  = null
let selectedRoute   = null
let selectedRouteId = null
let selectedRouteName = ''
let getLiveData     = null
let ftmsClient      = null
let hudView         = null
let rideEndModal    = null
let isPaused        = false

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

  const stravaInfo = await getConnectionInfo()
  if (!stravaInfo) {
    const ok = await showStravaWarningDialog()
    if (!ok) return
  }

  const params             = await loadPhysicsParams()
  const smoothingWindowSec = (await getDb().get('settings', 'smoothingWindowSec')) ?? 3
  const trainerEnabled     = document.getElementById('trainer-control-toggle').checked
  const trainerDifficulty  = (await getDb().get('settings', 'trainerDifficulty')) ?? 0.5

  rideController = new RideController({
    route:      selectedRoute,
    routeId:    selectedRouteId,
    routeName:  selectedRouteName,
    params,
    mapView,
    hudView,
    getLiveData,
    smoothingWindowSec,
    trainerDifficulty,
    ftmsClient:  trainerEnabled ? ftmsClient : null,
    onFinished: (summary) => {
      rideController = null
      setRidingState(false)
      if (summary) rideEndModal.show(summary)
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
  }
})

stopBtn.addEventListener('click', () => {
  const summary = rideController?.stop()
  rideController = null
  setRidingState(false)
  if (summary) rideEndModal.show(summary)
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

  // Strava OAuth コールバック処理（リダイレクトで戻ってきた場合）
  const params = new URLSearchParams(window.location.search)
  const code   = params.get('code')
  if (code && params.get('scope')?.includes('activity')) {
    try {
      await exchangeCode(code)
      history.replaceState({}, '', window.location.pathname)
    } catch (err) {
      console.error('Strava auth failed:', err)
    }
  }

  const result = await initDeviceManager()
  getLiveData  = result.getLiveData
  ftmsClient   = result.ftmsClient

  mapView = new MapView(document.getElementById('map-container'))
  hudView = new HUDView()

  rideEndModal = new RideEndModal({
    onClose: () => renderRideHistory(),
  })

  await initRoutePicker(mapView, {
    onRouteSelected: ({ route, id, name }) => {
      selectedRoute     = route
      selectedRouteId   = id
      selectedRouteName = name
      startBtn.disabled = false
    },
  })

  await loadSettings()
}

init()
