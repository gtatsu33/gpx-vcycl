import { listRides, getRide, deleteRide, finalizeDraftRide, markUploaded, markUploadFailed } from '../storage/rides.js'
import { prepareUpload, defaultUploadName } from '../strava/rideUpload.js'
import { uploadToStrava } from '../strava/upload.js'
import { getConnectionInfo } from '../strava/auth.js'

// 現在走行中のライドに対応するdraftRideIdを取得する関数。main.jsから
// configureRideHistory()で注入される（未設定時は常にnull＝全draftを
// 「中断中」扱いにする）。
let getActiveDraftId = () => null

export function configureRideHistory({ getActiveDraftId: fn } = {}) {
  if (fn) getActiveDraftId = fn
}

export async function renderRideHistory() {
  const listEl = document.getElementById('ride-history-list')
  if (!listEl) return

  const rides = await listRides()
  if (rides.length === 0) {
    listEl.innerHTML = '<p class="route-empty">記録されたライドはありません</p>'
    return
  }

  listEl.innerHTML = ''
  for (const ride of rides) {
    listEl.appendChild(buildRideItem(ride))
  }
}

function buildRideItem(ride) {
  const el = document.createElement('div')
  el.className = 'ride-item'
  el.dataset.id = ride.id

  const isActiveDraft = ride.isDraft && ride.id === getActiveDraftId()

  const distKm   = (ride.totalDistanceM / 1000).toFixed(2)
  const timeStr  = fmtTime(ride.totalElapsedSec)
  const dateStr  = new Date(ride.startedAt).toLocaleString('ja-JP', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
  const badge    = ride.isDraft ? (isActiveDraft ? '走行中' : '中断中') : statusBadge(ride.uploadStatus)
  const badgeCls = ride.isDraft ? (isActiveDraft ? 'active' : 'draft') : ride.uploadStatus
  const stravaLink = ride.stravaActivityId
    ? `<a href="https://www.strava.com/activities/${ride.stravaActivityId}" target="_blank" class="strava-link">Stravaで見る</a>`
    : ''
  // 走行中のdraftは裏でRideControllerが更新し続けているため、履歴タブ
  // から確定・削除させると次の自動保存で上書きされてしまう。ここでは
  // 操作させず、ルートタブでの終了操作へ誘導する。
  const activeNote = isActiveDraft
    ? ' &middot; <span style="color:#fbbf24;">ルートタブで走行中</span>'
    : ''

  el.innerHTML = `
    <div class="ride-info">
      <span class="ride-name">${escHtml(ride.routeName)} <span class="status-badge ${badgeCls}">${badge}</span></span>
      <span class="ride-meta">${dateStr} &middot; ${distKm} km &middot; ${timeStr} &middot; ${ride.avgPowerW} W ${stravaLink}${activeNote}</span>
    </div>
    <div class="ride-actions">
      ${ride.isDraft && !isActiveDraft ? '<button class="draft-finish-btn small-btn">記録を確定</button>' : ''}
      ${!ride.isDraft && ride.uploadStatus !== 'uploaded' ? '<button class="upload-btn small-btn">アップロード</button>' : ''}
      <button class="fit-dl-btn small-btn">FIT</button>
      ${isActiveDraft ? '' : `<button class="ride-del-btn small-btn">${ride.isDraft ? '破棄' : '削除'}</button>`}
    </div>
  `

  el.querySelector('.fit-dl-btn').addEventListener('click', () => downloadFit(ride))
  el.querySelector('.ride-del-btn')?.addEventListener('click', async () => {
    const msg = ride.isDraft
      ? `「${ride.routeName}」の中断中の記録を破棄しますか？`
      : `「${ride.routeName}」のライド記録を削除しますか？`
    if (!confirm(msg)) return
    await deleteRide(ride.id)
    await renderRideHistory()
  })
  el.querySelector('.upload-btn')?.addEventListener('click', () => reupload(ride))
  el.querySelector('.draft-finish-btn')?.addEventListener('click', () => finalizeDraft(ride))

  return el
}

// 中断中の下書きを確定記録に更新する（履歴タブから、走行を再開せずに済ませる経路）
async function finalizeDraft(ride) {
  const fullRide = await getRide(ride.id)
  await finalizeDraftRide(ride.id, {
    kind:      fullRide.kind,
    routeId:   fullRide.routeId,
    routeName: fullRide.routeName,
    startedAt: new Date(fullRide.startedAt),
    endedAt:   new Date(fullRide.endedAt),
    samples:   fullRide.samples,
  })
  await renderRideHistory()
}

async function reupload(ride) {
  const info = await getConnectionInfo()
  if (!info) { alert('Stravaに接続されていません。Settingsから接続してください。'); return }

  const fullRide = await getRide(ride.id)
  const name = defaultUploadName(fullRide)

  try {
    const { fitData, meta } = prepareUpload(fullRide, { name })
    const activityId = await uploadToStrava(fitData, meta)
    await markUploaded(ride.id, activityId)
    await renderRideHistory()
  } catch (err) {
    await markUploadFailed(ride.id, err.message)
    alert(`アップロード失敗: ${err.message}`)
    await renderRideHistory()
  }
}

function downloadFit(ride) {
  try {
    const { fitData } = prepareUpload(ride, { name: ride.routeName })
    const blob    = new Blob([fitData], { type: 'application/octet-stream' })
    const url     = URL.createObjectURL(blob)
    const a       = document.createElement('a')
    a.href        = url
    a.download    = `ride_${ride.id}.fit`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    alert(`FIT生成失敗: ${err.message}`)
  }
}

function statusBadge(status) {
  return { pending: '未送信', uploaded: '送信済', failed: '失敗' }[status] ?? status
}

function fmtTime(totalSec) {
  const s = Math.floor(totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

function pad(n)  { return String(n).padStart(2, '0') }
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}
