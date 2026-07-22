import { saveRoute, listRoutes, deleteRoute, getRouteProgress } from '../storage/routes.js'
import { listRemoteGpxFiles, downloadRemoteGpx, fetchRouteFilesMeta } from '../storage/remoteRoutes.js'
import { Route } from '../domain/route.js'

const START_DISTANCE_MARGIN_M = 50 // ルート終端ぎりぎりを開始距離に選べないようにする余白

/**
 * @param {import('./map.js').MapView} mapView
 * @param {{
 *   onRouteSelected?:        (args: { route, id, name, reversed, startDistanceM: number }) => void,
 *   onStartDistanceChanged?: (startDistanceM: number) => void,
 * }} [opts]
 */
export async function initRoutePicker(mapView, { onRouteSelected, onStartDistanceChanged } = {}) {
  const loadLocalBtn  = document.getElementById('load-local-gpx-btn')
  const loadRemoteBtn = document.getElementById('load-remote-gpx-btn')
  const fileInput     = document.getElementById('gpx-file-input')
  const routeListEl   = document.getElementById('route-list')
  const profileSvg    = document.getElementById('elevation-profile')
  const startDistInput = document.getElementById('start-distance-input')

  const overlay    = document.getElementById('route-name-overlay')
  const nameInput  = document.getElementById('route-name-input')
  const cancelBtn  = document.getElementById('route-name-cancel')
  const saveBtn    = document.getElementById('route-name-save')

  const remoteOverlay   = document.getElementById('remote-gpx-overlay')
  const remoteStatus    = document.getElementById('remote-gpx-status')
  const remoteList      = document.getElementById('remote-gpx-list')
  const remoteCancelBtn = document.getElementById('remote-gpx-cancel')

  let pendingGpxText = null
  let remoteMetaMap  = new Map()

  // 現在選択中ルート・開始距離（プレビュー・スライダー連動用の共有状態）
  let currentRoute       = null
  let startDistanceM     = 0

  // ── Local file load ──
  loadLocalBtn.addEventListener('click', () => fileInput.click())

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0]
    if (!file) return
    fileInput.value = ''
    const reader = new FileReader()
    reader.onload = (e) => {
      pendingGpxText = e.target.result
      try {
        const { name } = Route.fromGpx(pendingGpxText)
        nameInput.value = name
      } catch (err) {
        alert(`GPXの読み込みに失敗しました: ${err.message}`)
        pendingGpxText = null
        return
      }
      overlay.classList.add('open')
      nameInput.select()
    }
    reader.readAsText(file)
  })

  // ── Remote file load ──
  loadRemoteBtn.addEventListener('click', () => openRemotePicker())

  remoteCancelBtn.addEventListener('click', () => {
    remoteOverlay.classList.remove('open')
  })

  remoteOverlay.addEventListener('click', (e) => {
    if (e.target === remoteOverlay) remoteOverlay.classList.remove('open')
  })

  async function openRemotePicker() {
    remoteList.innerHTML = ''
    remoteStatus.textContent = '読み込み中...'
    remoteOverlay.classList.add('open')

    let files
    try {
      [files, remoteMetaMap] = await Promise.all([
        listRemoteGpxFiles(),
        fetchRouteFilesMeta().catch(() => new Map()), // メタ取得失敗時はfile_keyフォールバックのみで表示続行
      ])
    } catch (err) {
      remoteStatus.textContent = `取得に失敗しました: ${err.message}`
      return
    }

    if (files.length === 0) {
      remoteStatus.textContent = 'GPXファイルが見つかりませんでした'
      return
    }

    remoteStatus.textContent = `${files.length} 件`

    for (const file of files) {
      const meta = remoteMetaMap.get(file.name)
      const fileBaseName = file.name.replace(/\.gpx$/i, '').replace(/_gne$/i, '')
      const btn = document.createElement('button')
      btn.className = 'remote-gpx-item'
      const metaText = [fmtDist(meta?.distanceM), fmtGain(meta?.elevationGainM)]
        .filter(Boolean).join(' · ')
      btn.innerHTML = `
        <span class="remote-gpx-name">${escHtml(meta?.displayName ?? fileBaseName)}</span>
        ${metaText ? `<span class="remote-gpx-meta">${metaText}</span>` : ''}
      `
      btn.addEventListener('click', () => loadRemoteFile(file.name))
      remoteList.appendChild(btn)
    }
  }

  async function loadRemoteFile(fileName) {
    remoteStatus.textContent = `ダウンロード中: ${fileName}`
    remoteList.querySelectorAll('button').forEach((b) => (b.disabled = true))

    let gpxText
    try {
      gpxText = await downloadRemoteGpx(fileName)
    } catch (err) {
      remoteStatus.textContent = `ダウンロードに失敗しました: ${err.message}`
      remoteList.querySelectorAll('button').forEach((b) => (b.disabled = false))
      return
    }

    remoteOverlay.classList.remove('open')

    pendingGpxText = gpxText
    try {
      const { name } = Route.fromGpx(pendingGpxText)
      const fileBaseName = fileName.replace(/\.gpx$/i, '').replace(/_gne$/i, '')
      const displayName  = remoteMetaMap.get(fileName)?.displayName
      nameInput.value = displayName ?? ((name && name !== 'ルート') ? name : fileBaseName)
    } catch (err) {
      alert(`GPXの読み込みに失敗しました: ${err.message}`)
      pendingGpxText = null
      return
    }
    overlay.classList.add('open')
    nameInput.select()
  }

  // ── Route name modal ──
  cancelBtn.addEventListener('click', () => {
    overlay.classList.remove('open')
    pendingGpxText = null
  })

  saveBtn.addEventListener('click', async () => {
    if (!pendingGpxText) return
    const name = nameInput.value.trim() || 'ルート'
    overlay.classList.remove('open')
    try {
      await saveRoute({ name, gpxText: pendingGpxText })
      pendingGpxText = null
      await renderList()
    } catch (err) {
      alert(`保存に失敗しました: ${err.message}`)
    }
  })

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('open')
      pendingGpxText = null
    }
  })

  // ── 開始距離（数値入力・標高プロファイル上のドラッグ、双方向に同期） ──

  /**
   * 状態値を更新し、プロファイル上のマーカー（と、updateInputがtrueなら
   * 数値入力欄）に反映する。数値入力欄からの変更時はupdateInput:false にし、
   * 入力中の値を毎キー入力で上書きして操作を妨げないようにする。
   */
  function setStartDistance(distM, { notify = true, updateInput = true } = {}) {
    if (!currentRoute) return
    const maxM = Math.max(0, currentRoute.totalDistanceM - START_DISTANCE_MARGIN_M)
    startDistanceM = Math.max(0, Math.min(distM, maxM))
    if (updateInput) startDistInput.value = (startDistanceM / 1000).toFixed(2)
    renderProfile(currentRoute, profileSvg, startDistanceM, (d) => setStartDistance(d))
    if (notify) onStartDistanceChanged?.(startDistanceM)
  }

  startDistInput.addEventListener('input', () => {
    const km = parseFloat(startDistInput.value)
    setStartDistance(Number.isFinite(km) ? km * 1000 : 0, { updateInput: false })
  })
  // 確定時（blur）に、クランプ後の正式な値へ整形し直す
  startDistInput.addEventListener('change', () => {
    startDistInput.value = (startDistanceM / 1000).toFixed(2)
  })

  await renderList()

  // ── internal ──────────────────────────────────────────────────────────

  async function renderList() {
    const routes = await listRoutes()
    routeListEl.innerHTML = ''

    if (routes.length === 0) {
      routeListEl.innerHTML = '<p class="route-empty">保存済みのルートはありません</p>'
      return
    }

    for (const r of routes) {
      const item = document.createElement('div')
      item.className = 'route-item'
      item.dataset.id = r.id
      item.innerHTML = `
        <div class="route-info" role="button" tabindex="0">
          <span class="route-name">${escHtml(r.name)}</span>
          <span class="route-meta">${fmtDist(r.totalDistanceM)} &middot; ${fmtGain(r.totalElevationGainM)}</span>
        </div>
        <label class="reverse-label" title="逆走モード">
          <input type="checkbox" class="reverse-checkbox"> 逆走
        </label>
        <button class="route-delete-btn" aria-label="削除">✕</button>
      `

      const reverseCheckbox = item.querySelector('.reverse-checkbox')

      item.querySelector('.route-info').addEventListener('click', () => {
        selectRoute(r, reverseCheckbox.checked)
      })

      reverseCheckbox.addEventListener('change', () => {
        if (item.classList.contains('selected')) {
          selectRoute(r, reverseCheckbox.checked)
        }
      })

      item.querySelector('.route-delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation()
        if (!confirm(`「${r.name}」を削除しますか？`)) return
        await deleteRoute(r.id)
        await renderList()
      })

      routeListEl.appendChild(item)
    }
  }

  async function selectRoute(record, reversed = false) {
    routeListEl.querySelectorAll('.route-item').forEach((el) => el.classList.remove('selected'))
    routeListEl.querySelector(`[data-id="${record.id}"]`)?.classList.add('selected')

    const route = Route.fromGpx(record.gpxText, { reversed })
    mapView.setRoute(route)
    currentRoute = route

    const progress = await getRouteProgress(record.id, reversed).catch(() => null)
    setStartDistance(progress?.distanceM ?? 0, { notify: false })

    onRouteSelected?.({ route, id: record.id, name: record.name, reversed, startDistanceM })
  }
}

function renderProfile(route, svgEl, startDistanceM, onSeek) {
  const pts = route.points.filter((p) => p.elevationM !== null)
  if (pts.length < 2) { svgEl.innerHTML = ''; return }

  const W = 400, H = 60, PAD = 4
  const maxDist  = route.totalDistanceM
  const elevs    = pts.map((p) => p.elevationM)
  const minElev  = Math.min(...elevs)
  const maxElev  = Math.max(...elevs)
  const elevSpan = maxElev - minElev || 1

  const toX = (d) => PAD + (d / maxDist) * (W - 2 * PAD)
  const toY = (e) => H - PAD - ((e - minElev) / elevSpan) * (H - 2 * PAD)

  const polyPts  = pts.map((p) => `${toX(p.distanceFromStartM)},${toY(p.elevationM)}`).join(' ')
  const fillPts  = `${toX(pts[0].distanceFromStartM)},${H} ` + polyPts + ` ${toX(pts[pts.length-1].distanceFromStartM)},${H}`
  const markerX  = toX(startDistanceM)

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svgEl.setAttribute('preserveAspectRatio', 'none')
  svgEl.innerHTML = `
    <polygon points="${fillPts}" fill="#4488ff" fill-opacity="0.2"/>
    <polyline points="${polyPts}" fill="none" stroke="#4488ff" stroke-width="1.5"/>
    <line x1="${markerX}" y1="0" x2="${markerX}" y2="${H}" stroke="#ffb454" stroke-width="2"/>
  `

  if (!onSeek) return
  svgEl.onpointerdown = (e) => {
    const seek = (clientX) => {
      const rect = svgEl.getBoundingClientRect()
      const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      onSeek(frac * maxDist)
    }
    seek(e.clientX)
    const onMove = (ev) => seek(ev.clientX)
    const onUp   = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
}

function fmtDist(m) {
  if (m == null) return null
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}
function fmtGain(m) {
  if (m == null) return null
  return `${Math.round(m)} m↑`
}
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
