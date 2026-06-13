import { saveRoute, listRoutes, deleteRoute } from '../storage/routes.js'
import { Route } from '../domain/route.js'

/**
 * @param {import('./map.js').MapView} mapView
 * @param {{ onRouteSelected?: (route: import('../domain/route.js').Route) => void }} [opts]
 */
export async function initRoutePicker(mapView, { onRouteSelected } = {}) {
  const loadBtn      = document.getElementById('load-gpx-btn')
  const fileInput    = document.getElementById('gpx-file-input')
  const routeListEl  = document.getElementById('route-list')
  const profileSvg   = document.getElementById('elevation-profile')

  const overlay      = document.getElementById('route-name-overlay')
  const nameInput    = document.getElementById('route-name-input')
  const cancelBtn    = document.getElementById('route-name-cancel')
  const saveBtn      = document.getElementById('route-name-save')

  let pendingGpxText = null

  loadBtn.addEventListener('click', () => fileInput.click())

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
      await renderList(mapView, routeListEl, profileSvg, onRouteSelected)
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

  await renderList(mapView, routeListEl, profileSvg, onRouteSelected)
}

async function renderList(mapView, listEl, profileSvg, onRouteSelected) {
  const routes = await listRoutes()
  listEl.innerHTML = ''

  if (routes.length === 0) {
    listEl.innerHTML = '<p class="route-empty">保存済みのルートはありません</p>'
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
      selectRoute(r, mapView, listEl, profileSvg, onRouteSelected, reverseCheckbox.checked)
    })

    reverseCheckbox.addEventListener('change', () => {
      if (item.classList.contains('selected')) {
        selectRoute(r, mapView, listEl, profileSvg, onRouteSelected, reverseCheckbox.checked)
      }
    })

    item.querySelector('.route-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm(`「${r.name}」を削除しますか？`)) return
      await deleteRoute(r.id)
      await renderList(mapView, listEl, profileSvg, onRouteSelected)
    })

    listEl.appendChild(item)
  }
}

function selectRoute(record, mapView, listEl, profileSvg, onRouteSelected, reversed = false) {
  listEl.querySelectorAll('.route-item').forEach((el) => el.classList.remove('selected'))
  listEl.querySelector(`[data-id="${record.id}"]`)?.classList.add('selected')

  const route = Route.fromGpx(record.gpxText, { reversed })
  mapView.setRoute(route)
  renderProfile(route, profileSvg)
  onRouteSelected?.({ route, id: record.id, name: record.name, reversed })
}

function renderProfile(route, svgEl) {
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

  svgEl.setAttribute('viewBox', `0 0 ${W} ${H}`)
  svgEl.setAttribute('preserveAspectRatio', 'none')
  svgEl.innerHTML = `
    <polygon points="${fillPts}" fill="#4488ff" fill-opacity="0.2"/>
    <polyline points="${polyPts}" fill="none" stroke="#4488ff" stroke-width="1.5"/>
  `
}

function fmtDist(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}
function fmtGain(m) {
  return `${Math.round(m)} m↑`
}
function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
