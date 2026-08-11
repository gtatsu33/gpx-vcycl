import { initDb, getDb }            from './storage/db.js'
import { initDeviceManager }         from './ui/deviceManager.js'
import { createMapView }              from './ui/mapFactory.js'
import { EleView }                    from './ui/eleView.js'
import { activateOwnerModeIfValid, isOwnerMode } from './utils/ownerMode.js'
import { HUDView }                   from './ui/hud.js'
import { initRoutePicker }           from './ui/routePicker.js'
import { RideController }            from './ride/rideController.js'
import { RideEndModal }              from './ui/rideEndModal.js'
import { renderRideHistory, configureRideHistory } from './ui/rideHistory.js'
import { DEFAULT_PHYSICS }           from './domain/physics.js'
import { exchangeCode, getConnectionInfo, startAuthorization, disconnect as stravaDisconnect, verifyConnection as verifyStravaConnection }
  from './strava/auth.js'
import { initWorkoutTab }            from './ui/workoutTab.js'
import { buildWorkoutFit }           from './export/fitWriter.js'
import { uploadToStrava }            from './strava/upload.js'
import { saveRide, saveDraftRide, deleteRide, markUploaded, markUploadFailed } from './storage/rides.js'
import { Route }                     from './domain/route.js'
import { getRoute, saveRouteProgress } from './storage/routes.js'
import { precomputeBearings }        from './mapillary/bearing.js'
import { resampleRoute }             from './mapillary/resample.js'
import { MapillaryLookahead, ActiveIndexTracker } from './mapillary/lookahead.js'
import { updatePhotoPanel, resetPhotoPanel } from './mapillary/panel.js'

const MAPILLARY_ENABLED = Boolean(import.meta.env.VITE_MAPILLARY_TOKEN)

// ── App version ────────────────────────────────────────────────────────
document.getElementById('app-version').textContent = `v${__APP_VERSION__}`

// ── Mapillary 起動時診断 ────────────────────────────────────────────────
console.info(`[Mapillary] enabled: ${MAPILLARY_ENABLED}${MAPILLARY_ENABLED ? '' : ' (VITE_MAPILLARY_TOKEN 未設定)'}`)

// ── DB status（エラー時のみ表示） ─────────────────────────────────────────
const dbStatusErrorEl = document.getElementById('db-status-error')

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
  const statusEl     = document.getElementById('strava-status')
  const connectBtn   = document.getElementById('strava-connect-btn')
  const disconnectBtn = document.getElementById('strava-disconnect-btn')
  const connected    = await verifyStravaConnection()
  const info         = connected ? await getConnectionInfo() : null
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
let selectedStartDistanceM     = 0
let routePickerApi             = null
let getLiveData              = null
let ftmsClient      = null
let isDummyTrainer  = () => false
let hudView         = null
let rideEndModal    = null
let isPaused        = false

// ── Route session persistence ───────────────────────────────────────────
// 走行中断からの復旧（spec.txt 6-2-1節）: localStorageのチェックポイントは
// 「再開」用、IndexedDBの下書きレコード（draftRideId）は「履歴タブから
// 直接、再開せずに確定・Stravaアップロードできる」ためのもの。両者は
// 定期タイマー（AUTOSAVE_INTERVAL_MS毎）で同時に更新する。beforeunloadは
// ホームボタン操作やOSによる強制終了では発火しないため、この定期保存が
// 主たる防御線となる（beforeunload/pagehide/visibilitychangeは補助的に
// 即時保存を試みるのみ）。
const ROUTE_SESSION_KEY      = 'route-session'
const AUTOSAVE_INTERVAL_MS   = 20000

let draftRideId    = null  // 走行中の下書きレコードID（storage/rides.js）
let autosaveTimerId = null

configureRideHistory({ getActiveDraftId: () => draftRideId })

function checkpointToSummary(cp) {
  return {
    routeId:   cp.routeId,
    routeName: cp.routeName,
    startedAt: new Date(cp.startedAt),
    endedAt:   new Date(),
    samples:   cp.samples,
  }
}

function saveRouteSession() {
  if (!rideController || !selectedRouteId) return
  const cp = rideController.getCheckpoint()
  if (!cp) return
  try { localStorage.setItem(ROUTE_SESSION_KEY, JSON.stringify({ ...cp, draftRideId })) }
  catch { /* storage full */ }
}

async function autosaveDraft() {
  if (!rideController || !selectedRouteId) return
  const cp = rideController.getCheckpoint()
  if (!cp || cp.samples.length < 2) return
  try {
    draftRideId = await saveDraftRide(checkpointToSummary(cp), draftRideId)
  } catch (err) {
    console.error('下書き自動保存失敗:', err)
  }
}

function autosaveTick() {
  saveRouteSession()
  autosaveDraft()
}

function startAutosaveTimer() {
  stopAutosaveTimer()
  autosaveTimerId = setInterval(autosaveTick, AUTOSAVE_INTERVAL_MS)
}

function stopAutosaveTimer() {
  if (autosaveTimerId == null) return
  clearInterval(autosaveTimerId)
  autosaveTimerId = null
}

function clearRouteSession() { localStorage.removeItem(ROUTE_SESSION_KEY) }

window.addEventListener('beforeunload', () => { if (rideController && selectedRouteId) autosaveTick() })
window.addEventListener('pagehide',      () => { if (rideController && selectedRouteId) autosaveTick() })
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && rideController && selectedRouteId) autosaveTick()
})

// 開始距離（複数日ライドの再開地点）に応じて3Dマップ・Mapillary・2Dマップの
// プレビューを一致させる。ルート選択直後の初期表示、開始距離の確定時
// （ドラッグのpointerup／数値入力のchange）、ライド終了時（再開地点の
// 再同期）から呼ばれる、Mapillary写真取得を含むフル同期。withPhoto:false
// の場合は3D/2Dマップ・標高プロファイルのみの軽量なライブ更新（ドラッグ中・
// 入力中に連続発火しても問題ない）。
//
// 【2026-07-25修正】以前はドラッグ中の毎pointermoveでMapillary写真取得まで
// 行っていたため、MapillaryLookahead.tick()の同時1件制限により、ドラッグ
// 開始直後の取得だけが最後に完了して確定位置と異なる写真が表示される
// 不具合があった。写真取得は確定時（onStartDistanceCommitted）のみに限定
// することで解消した。
//
// 【2026-07-25修正・その2】以前はinit()内のローカル関数だったため、
// モジュールトップレベルのhandleRideFinished()から参照するとスコープ外
// でReferenceErrorになっていた（ライド終了時にNo Imageのまま固まって
// 見えた本当の原因はこちら）。mapView/eleView/selectedMapillaryLookahead/
// selectedMapillaryTrackerはすべてモジュールトップレベルのlet変数なので、
// この関数自体もモジュールトップレベルへ移動して解消した。
function previewAtDistance(distanceM, { withPhoto = true } = {}) {
  eleView?.previewAt(distanceM)
  mapView.setProgress(distanceM)
  if (!withPhoto) return

  const lookahead = selectedMapillaryLookahead
  const tracker    = selectedMapillaryTracker
  if (!lookahead || !tracker) return
  const idx = tracker.seekTo(distanceM)
  lookahead.seekTo(idx)
  resetPhotoPanel()
  lookahead.tick(idx).then(() => {
    if (selectedMapillaryLookahead !== lookahead) return
    const { status, image, routeBearing, reason } = lookahead.getStateFor(idx)
    updatePhotoPanel(status, image, routeBearing, distanceM, reason)
  })
}

// ライド終了時の共通処理（新規開始・セッション復元どちらの経路からも呼ばれる）。
// 複数日ライド用に、そのルート（順走/逆走別）の最終到達距離をIndexedDBへ保存する。
function handleRideFinished(summary) {
  rideController = null
  clearRouteSession()
  setRidingState(false)
  stopAutosaveTimer()
  const finishedDraftId = draftRideId
  draftRideId = null
  if (summary) {
    const lastDistanceM = summary.samples.at(-1)?.distanceM
    if (summary.routeId != null && lastDistanceM != null) {
      saveRouteProgress(summary.routeId, selectedReversed, lastDistanceM).catch(() => {})
      // 事前ライド画面（開始距離スライダー・3D/2Dマップ・Mapillary先読み）を
      // 今回のライドの到達距離に合わせて再同期する。これをしないと、次にライドを
      // 開始した際、開始距離表示は0のまま、かつmapillaryLookahead/Trackerが
      // 前回ライド終了時点のindexに取り残されたまま流用されてしまう。
      if (summary.routeId === selectedRouteId) {
        selectedStartDistanceM = lastDistanceM
        routePickerApi?.syncStartDistance(lastDistanceM)
        previewAtDistance(lastDistanceM)
      }
    }
    if (!isDummyTrainer()) {
      rideEndModal.show(summary, { existingId: finishedDraftId })
    } else if (finishedDraftId != null) {
      // ダミートレーナー使用時は終了モーダルを出さず記録も保存しない
      // （既存仕様）。走行中に作成された下書きは道連れで破棄する。
      deleteRide(finishedDraftId).catch(() => {})
    }
  }
}

const startBtn       = document.getElementById('start-ride-btn')
const pauseResumeBtn = document.getElementById('pause-resume-btn')
const stopBtn        = document.getElementById('stop-ride-btn')
const rideControlsEl    = document.getElementById('ride-controls')
const routeSidePanelEl  = document.getElementById('route-side-panel')
const preRidePanelEl    = document.getElementById('pre-ride-panel')
const hudPanelEl        = document.getElementById('hud-panel')
const mapContainerEl    = document.getElementById('map-container')

document.getElementById('recenter-btn').addEventListener('click', () => mapView?.recenter())
document.getElementById('reset-trainer-btn').addEventListener('click', () => {
  ftmsClient?.reset().catch((err) => console.warn('Reset trainer failed:', err))
})

// ライド中（#ride-controls内）とルート選択画面（#start-ride-row内）の両方に
// ボタンを置き、同じ表示タイプ状態を共有する（#map-containerは両画面で共通の
// ため、切り替え自体は常に同じDOM操作で済む）。
const layoutToggleBtns = [
  document.getElementById('layout-toggle-btn'),
  document.getElementById('layout-toggle-btn-preride'),
]

function setDisplayLayoutSwapped(swapped) {
  const eleViewEl   = document.getElementById('ele-view')
  const mapillaryEl = document.getElementById('mapillary-panel')
  const mapSideEl   = document.getElementById('map-side')
  const mapInnerEl  = document.getElementById('map-inner')

  mapContainerEl.classList.toggle('is-swapped', swapped)
  if (swapped) {
    mapContainerEl.insertBefore(mapillaryEl, mapSideEl)
    mapSideEl.insertBefore(eleViewEl, mapInnerEl)
  } else {
    mapContainerEl.insertBefore(eleViewEl, mapSideEl)
    mapSideEl.insertBefore(mapillaryEl, mapInnerEl)
  }
  for (const btn of layoutToggleBtns) btn.textContent = swapped ? '表示タイプB' : '表示タイプA'
}

for (const btn of layoutToggleBtns) {
  btn.addEventListener('click', () => {
    setDisplayLayoutSwapped(!mapContainerEl.classList.contains('is-swapped'))
  })
}

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
  draftRideId = null

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
    startDistanceM: selectedStartDistanceM,
    onFinished: handleRideFinished,
  })
  rideController.start()
  setRidingState(true)
  startAutosaveTimer()
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
    autosaveTick()
  }
})

stopBtn.addEventListener('click', () => {
  const summary = rideController?.stop()
  handleRideFinished(summary)
})

function setRidingState(riding) {
  routeSidePanelEl.hidden = riding
  preRidePanelEl.hidden   = riding
  hudPanelEl.hidden       = !riding
  rideControlsEl.hidden   = !riding
  mapContainerEl.classList.toggle('is-riding', riding)
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
  } catch (err) {
    dbStatusErrorEl.textContent = `DB初期化エラー: ${err.message}`
    dbStatusErrorEl.hidden      = false
    console.error(err)
    return
  }

  // オーナーモード: URLに ?owner=PASSCODE があれば検証してセッションに記録
  await activateOwnerModeIfValid()
  if (isOwnerMode()) {
    document.getElementById('map-provider-group').hidden = false
    document.getElementById('owner-badge').hidden = false
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

  updateStravaStatusUI()

  const result    = await initDeviceManager({ getFtpW })
  getLiveData     = result.getLiveData
  ftmsClient      = result.ftmsClient
  isDummyTrainer  = result.isDummyTrainer

  const mapProvider = (await getDb().get('settings', 'mapProvider')) ?? 'osm'
  const isGoogleMode = mapProvider === 'google' && isOwnerMode()
  // 3Dマップ（EleView）は地図プロバイダによらず常時動作する（resupport_gmap.txt参照）
  // index.html側で既定hiddenのため、ここで明示的に表示する
  const eleViewEl   = document.getElementById('ele-view')
  eleViewEl.hidden  = false
  eleView = new EleView(eleViewEl)

  // Mapillary（実写風景写真）とGoogle Street Viewは排他。Googleモード時は
  // #mapillary-panel をStreet View表示に転用するため、Mapillaryは無効化する
  const mapillaryUsable = MAPILLARY_ENABLED && !isGoogleMode

  mapView = await createMapView(
    document.getElementById('map-inner'),
    document.getElementById('mapillary-panel'),
  )

  hudView = new HUDView()

  rideEndModal = new RideEndModal({
    onClose: () => renderRideHistory(),
  })

  routePickerApi = await initRoutePicker(mapView, {
    onRouteSelected: ({ route, id, name, reversed = false, startDistanceM = 0 }) => {
      selectedRoute             = route
      selectedRouteId           = id
      selectedRouteName         = name
      selectedReversed          = reversed
      selectedStartDistanceM    = startDistanceM
      selectedPointsWithBearing = mapillaryUsable ? precomputeBearings(resampleRoute(route)) : null
      startBtn.disabled = false
      eleView?.setRoute(route)

      selectedMapillaryLookahead = null
      selectedMapillaryTracker   = null
      if (mapillaryUsable && selectedPointsWithBearing && id != null) {
        const cachePrefix = `${id}:${reversed ? 'r' : 'f'}`
        selectedMapillaryLookahead = new MapillaryLookahead(cachePrefix, selectedPointsWithBearing)
        selectedMapillaryTracker   = new ActiveIndexTracker(selectedPointsWithBearing)
      }

      previewAtDistance(selectedStartDistanceM)
    },
    onStartDistanceChanged: (distanceM) => {
      selectedStartDistanceM = distanceM
      previewAtDistance(distanceM, { withPhoto: false })
    },
    onStartDistanceCommitted: (distanceM) => {
      selectedStartDistanceM = distanceM
      previewAtDistance(distanceM)
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

  // ルートセッション復元（走行中断からの復旧、spec.txt 6-2-1節）
  async function resumeRouteSession(routeSession, record) {
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
    selectedPointsWithBearing = mapillaryUsable ? precomputeBearings(resampleRoute(route)) : null
    startBtn.disabled = false
    mapView.setRoute(route)
    eleView?.setRoute(route)

    let mapillaryLookahead = null
    let mapillaryTracker   = null
    if (mapillaryUsable && selectedPointsWithBearing) {
      const cachePrefix  = `${routeSession.routeId}:f`
      mapillaryLookahead = new MapillaryLookahead(cachePrefix, selectedPointsWithBearing)
      mapillaryTracker   = new ActiveIndexTracker(selectedPointsWithBearing)
    }

    draftRideId = routeSession.draftRideId ?? null

    rideController = new RideController({
      route, routeId: routeSession.routeId, routeName: routeSession.routeName,
      params, mapView, hudView, eleView, getLiveData, smoothingWindowSec, trainerDifficulty,
      altitudeEffectEnabled,
      ftmsClient: trainerEnabled ? ftmsClient : null,
      mapillaryLookahead,
      mapillaryTracker,
      onFinished: handleRideFinished,
    })
    rideController.restoreFrom(routeSession)
    startAutosaveTimer()

    document.querySelector('.tab-btn[data-tab="route"]')?.click()
    setRidingState(true)
    isPaused = true
    pauseResumeBtn.textContent = '▶ 再開（中断から復元）'
  }

  function formatRecoverySummary(routeSession) {
    const distKm   = ((routeSession.simState?.distanceM ?? 0) / 1000).toFixed(2)
    const elapsedS = Math.round(routeSession.simState?.elapsedSec ?? 0)
    const h = Math.floor(elapsedS / 3600), m = Math.floor((elapsedS % 3600) / 60), s = elapsedS % 60
    const timeStr = h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`
    return `${routeSession.routeName || 'ルート'} ・ ${distKm} km ・ ${timeStr}`
  }

  // 復旧ダイアログ: [再開する] [ここまでの記録を終了して保存] [破棄] の3択
  function showRideRecoveryDialog(routeSession, record) {
    return new Promise((resolve) => {
      const overlay    = document.getElementById('ride-recovery-overlay')
      const summaryEl  = document.getElementById('ride-recovery-summary')
      const resumeBtn  = document.getElementById('ride-recovery-resume-btn')
      const finishBtn  = document.getElementById('ride-recovery-finish-btn')
      const discardBtn = document.getElementById('ride-recovery-discard-btn')

      summaryEl.textContent = formatRecoverySummary(routeSession)
      overlay.classList.add('open')

      const cleanup = () => {
        overlay.classList.remove('open')
        resumeBtn.onclick  = null
        finishBtn.onclick  = null
        discardBtn.onclick = null
      }

      resumeBtn.onclick = async () => {
        cleanup()
        await resumeRouteSession(routeSession, record)
        resolve()
      }
      finishBtn.onclick = async () => {
        cleanup()
        const finishedDraftId = routeSession.draftRideId ?? null
        const summary = checkpointToSummary(routeSession)
        clearRouteSession()
        if (!isDummyTrainer()) {
          rideEndModal.show(summary, { existingId: finishedDraftId })
        } else if (finishedDraftId != null) {
          await deleteRide(finishedDraftId).catch(() => {})
        }
        resolve()
      }
      discardBtn.onclick = async () => {
        cleanup()
        if (routeSession.draftRideId != null) await deleteRide(routeSession.draftRideId).catch(() => {})
        clearRouteSession()
        resolve()
      }
    })
  }

  try {
    const routeSession = JSON.parse(localStorage.getItem(ROUTE_SESSION_KEY))
    if (routeSession) {
      const record = await getRoute(routeSession.routeId)
      if (record) {
        await showRideRecoveryDialog(routeSession, record)
      } else {
        if (routeSession.draftRideId != null) await deleteRide(routeSession.draftRideId).catch(() => {})
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
