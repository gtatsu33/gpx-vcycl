import { initDb, getDb }        from './storage/db.js'
import { initDeviceManager }    from './ui/deviceManager.js'
import { MapView }              from './ui/map.js'
import { HUDView }              from './ui/hud.js'
import { initRoutePicker }      from './ui/routePicker.js'
import { RideController }       from './ride/rideController.js'
import { DEFAULT_PHYSICS }      from './domain/physics.js'

// ── DB status ──────────────────────────────────────────────────────────
const dbStatusEl = document.getElementById('db-status')

// ── Tab switching ──────────────────────────────────────────────────────
let mapView = null
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab
    document.querySelectorAll('.tab-btn').forEach((b)     => b.classList.toggle('active', b.dataset.tab === target))
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.toggle('active', c.id === `tab-${target}`))
    if (target === 'route' && mapView) requestAnimationFrame(() => mapView.invalidateSize())
  })
})

// ── Settings modal ─────────────────────────────────────────────────────
const settingsBtn  = document.getElementById('settings-btn')
const modalOverlay = document.getElementById('modal-overlay')
const modalClose   = document.getElementById('modal-close')

settingsBtn.addEventListener('click',  () => modalOverlay.classList.add('open'))
modalClose.addEventListener('click',   () => { saveSettings(); modalOverlay.classList.remove('open') })
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) { saveSettings(); modalOverlay.classList.remove('open') }
})

// Slider live value display
document.getElementById('cda-input').addEventListener('input', (e) => {
  document.getElementById('cda-val').textContent = parseFloat(e.target.value).toFixed(2)
})
document.getElementById('crr-input').addEventListener('input', (e) => {
  document.getElementById('crr-val').textContent = parseFloat(e.target.value).toFixed(4)
})

async function loadSettings() {
  const db = getDb()
  const set = (id, key, def) => {
    const el = document.getElementById(id)
    db.get('settings', key).then((v) => { if (v != null) el.value = v })
    return el
  }
  set('rider-weight-input', 'riderWeightKg',      70)
  set('bike-weight-input',  'bikeWeightKg',       10)
  set('smoothing-input',    'smoothingWindowSec',  3)

  const cdaEl = document.getElementById('cda-input')
  const crrEl = document.getElementById('crr-input')
  db.get('settings', 'cdA').then((v) => {
    if (v != null) { cdaEl.value = v; document.getElementById('cda-val').textContent = parseFloat(v).toFixed(2) }
  })
  db.get('settings', 'crr').then((v) => {
    if (v != null) { crrEl.value = v; document.getElementById('crr-val').textContent = parseFloat(v).toFixed(4) }
  })
}

async function saveSettings() {
  const db = getDb()
  const num = (id) => parseFloat(document.getElementById(id).value)
  await Promise.all([
    db.put('settings', num('rider-weight-input'), 'riderWeightKg'),
    db.put('settings', num('bike-weight-input'),  'bikeWeightKg'),
    db.put('settings', num('cda-input'),          'cdA'),
    db.put('settings', num('crr-input'),          'crr'),
    db.put('settings', num('smoothing-input'),    'smoothingWindowSec'),
  ])
}

async function loadPhysicsParams() {
  const db = getDb()
  const riderKg = (await db.get('settings', 'riderWeightKg'))     ?? 70
  const bikeKg  = (await db.get('settings', 'bikeWeightKg'))      ?? 10
  const cdA     = (await db.get('settings', 'cdA'))               ?? DEFAULT_PHYSICS.cdA
  const crr     = (await db.get('settings', 'crr'))               ?? DEFAULT_PHYSICS.crr
  return { massKg: riderKg + bikeKg, cdA, crr }
}

// ── Ride controls ──────────────────────────────────────────────────────
let rideController = null
let selectedRoute  = null
let getLiveData    = null
let hudView        = null
let isPaused       = false

const startBtn        = document.getElementById('start-ride-btn')
const pauseResumeBtn  = document.getElementById('pause-resume-btn')
const stopBtn         = document.getElementById('stop-ride-btn')
const rideControlsEl  = document.getElementById('ride-controls')
const preRidePanelEl  = document.getElementById('pre-ride-panel')
const hudPanelEl      = document.getElementById('hud-panel')

document.getElementById('recenter-btn').addEventListener('click', () => mapView?.recenter())

startBtn.addEventListener('click', async () => {
  if (!selectedRoute || !getLiveData) return

  const params             = await loadPhysicsParams()
  const smoothingWindowSec = (await getDb().get('settings', 'smoothingWindowSec')) ?? 3

  rideController = new RideController({
    route: selectedRoute,
    params,
    mapView,
    hudView,
    getLiveData,
    smoothingWindowSec,
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
  rideController?.stop()
  rideController = null
  setRidingState(false)
})

function setRidingState(riding) {
  preRidePanelEl.hidden = riding
  hudPanelEl.hidden     = !riding
  rideControlsEl.hidden = !riding
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

  const result = await initDeviceManager()
  getLiveData  = result.getLiveData

  mapView = new MapView(document.getElementById('map-container'))
  hudView = new HUDView()

  await initRoutePicker(mapView, {
    onRouteSelected: (route) => {
      selectedRoute = route
      startBtn.disabled = false
    },
  })

  await loadSettings()
}

init()
