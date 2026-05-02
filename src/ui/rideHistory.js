import { listRides, getRide, deleteRide, markUploaded, markUploadFailed } from '../storage/rides.js'
import { buildFit }       from '../export/fitWriter.js'
import { uploadToStrava } from '../strava/upload.js'
import { getConnectionInfo } from '../strava/auth.js'

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

  const distKm   = (ride.totalDistanceM / 1000).toFixed(2)
  const timeStr  = fmtTime(ride.totalElapsedSec)
  const dateStr  = new Date(ride.startedAt).toLocaleString('ja-JP', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
  const badge    = statusBadge(ride.uploadStatus)
  const stravaLink = ride.stravaActivityId
    ? `<a href="https://www.strava.com/activities/${ride.stravaActivityId}" target="_blank" class="strava-link">Stravaで見る</a>`
    : ''

  el.innerHTML = `
    <div class="ride-info">
      <span class="ride-name">${escHtml(ride.routeName)} <span class="status-badge ${ride.uploadStatus}">${badge}</span></span>
      <span class="ride-meta">${dateStr} &middot; ${distKm} km &middot; ${timeStr} &middot; ${ride.avgPowerW} W ${stravaLink}</span>
    </div>
    <div class="ride-actions">
      ${ride.uploadStatus !== 'uploaded' ? '<button class="upload-btn small-btn">アップロード</button>' : ''}
      <button class="fit-dl-btn small-btn">FIT</button>
      <button class="ride-del-btn small-btn">削除</button>
    </div>
  `

  el.querySelector('.fit-dl-btn').addEventListener('click', () => downloadFit(ride))
  el.querySelector('.ride-del-btn').addEventListener('click', async () => {
    if (!confirm(`「${ride.routeName}」のライド記録を削除しますか？`)) return
    await deleteRide(ride.id)
    await renderRideHistory()
  })
  el.querySelector('.upload-btn')?.addEventListener('click', () => reupload(ride))

  return el
}

async function reupload(ride) {
  const info = await getConnectionInfo()
  if (!info) { alert('Stravaに接続されていません。Settingsから接続してください。'); return }

  const fullRide = await getRide(ride.id)
  const name     = `Indoor Ride - ${fullRide.routeName} - ${new Date(fullRide.startedAt).toLocaleDateString('ja-JP')}`

  try {
    const fitData    = buildFit(fullRide)
    const activityId = await uploadToStrava(fitData, { name })
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
    const fitData = buildFit(ride)
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
