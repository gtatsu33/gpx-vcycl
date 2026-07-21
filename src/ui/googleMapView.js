const STREETVIEW_MIN_DIST_M        = 100
const STREETVIEW_MIN_GRADIENT_DIFF = 2
const STREETVIEW_MIN_HEADING_DIFF  = 20
const STREETVIEW_MIN_INTERVAL_MS   = 3000

function loadGoogleMapsScript(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(); return }
    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&loading=async&libraries=marker`
    script.async = true
    script.onload  = resolve
    script.onerror = () => reject(new Error('Google Maps script load failed'))
    document.head.appendChild(script)
  })
}

// 絵文字だけを表示するAdvancedMarkerElement用のcontent要素
// （anchorLeft/anchorTop:'-50%'と組み合わせ、絵文字の中心を座標にアンカーする）
function emojiMarkerContent(emoji, sizePx = 22) {
  const div = document.createElement('div')
  div.textContent   = emoji
  div.style.fontSize = `${sizePx}px`
  div.style.lineHeight = '1'
  return div
}

// 現在位置マーカー用の矢印SVG content要素（回転はCSS transformで適用）
function createPositionMarkerContent() {
  const div = document.createElement('div')
  div.style.width  = '28px'
  div.style.height = '32px'
  div.innerHTML = `<svg width="28" height="32" viewBox="0 0 28 32">
    <path d="M 14 2 L 26 30 L 14 24 L 2 30 Z" fill="#e94560" stroke="#ffffff" stroke-width="2"/>
  </svg>`
  return div
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R    = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a    = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

/**
 * オーナーモード限定の地図プロバイダ代替。3Dマップ（EleView）はプロバイダ
 * によらず常時動作するため、このクラスは #map-inner に2Dマップを、
 * #mapillary-panel（Mapillaryとは排他）にStreet View画像を描画するだけの
 * 役割に限定する。コンテナ全体の専有・インラインスタイルでのレイアウト
 * 上書きは行わない（resupport_gmap.txt参照）。
 */
export class GoogleMapView {
  #gmap           = null
  #mapEl
  #photoEl
  #photoImg
  #photoPlaceholder
  #initPromise
  #followMode     = true

  #routePolyline    = null
  #progressPolyline = null
  #positionMarker   = null
  #positionMarkerContent = null
  #startMarker      = null
  #goalMarker       = null
  #currentRoute     = null

  #lastSVLat      = null
  #lastSVLon      = null
  #lastSVGradient = null
  #lastSVHeading  = null
  #lastSVAt       = 0

  /**
   * @param {HTMLElement} mapEl   2Dマップ用コンテナ（#map-inner）
   * @param {HTMLElement} photoEl 写真枠コンテナ（#mapillary-panel）
   */
  constructor(mapEl, photoEl) {
    this.#mapEl   = mapEl
    this.#photoEl = photoEl

    this.#photoEl.hidden     = false
    this.#photoEl.innerHTML  = ''

    this.#photoPlaceholder = document.createElement('div')
    this.#photoPlaceholder.className = 'mapillary-no-image'
    this.#photoPlaceholder.textContent = 'Street View: ライド開始後に表示'

    this.#photoImg = document.createElement('img')
    this.#photoImg.alt = ''
    this.#photoImg.style.display = 'none'
    this.#photoImg.onload  = () => {
      this.#photoImg.style.display = 'block'
      this.#photoPlaceholder.hidden = true
    }
    this.#photoImg.onerror = () => {
      this.#photoImg.style.display = 'none'
      this.#photoPlaceholder.hidden = false
      this.#photoPlaceholder.textContent = 'Street View: 取得できませんでした'
    }

    this.#photoEl.appendChild(this.#photoPlaceholder)
    this.#photoEl.appendChild(this.#photoImg)

    this.#initPromise = this.#init()
  }

  async #init() {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    if (!apiKey) {
      this.#mapEl.textContent = 'VITE_GOOGLE_MAPS_API_KEY が設定されていません'
      return
    }
    await loadGoogleMapsScript(apiKey)
    this.#gmap = new google.maps.Map(this.#mapEl, {
      zoom:             15,
      center:           { lat: 35.0, lng: 136.0 },
      mapTypeId:        'roadmap',
      mapId:            import.meta.env.VITE_GOOGLE_MAPS_MAP_ID,
      disableDefaultUI: true,
      zoomControl:      true,
      gestureHandling:  'greedy',
    })
    this.#gmap.addListener('dragstart', () => { this.#followMode = false })
  }

  setRoute(route) {
    this.#currentRoute = route
    this.#initPromise.then(() => {
      if (!this.#gmap) return
      this.#routePolyline?.setMap(null)
      this.#progressPolyline?.setMap(null)
      if (this.#positionMarker) this.#positionMarker.map = null
      if (this.#startMarker)    this.#startMarker.map    = null
      if (this.#goalMarker)     this.#goalMarker.map     = null
      this.#routePolyline    = null
      this.#progressPolyline = null
      this.#positionMarker   = null
      this.#startMarker      = null
      this.#goalMarker       = null

      const path = route.points.map((p) => ({ lat: p.lat, lng: p.lon }))
      this.#routePolyline = new google.maps.Polyline({
        path,
        geodesic:      true,
        strokeColor:   '#4488ff',
        strokeOpacity: 0.9,
        strokeWeight:  4,
        map:           this.#gmap,
      })
      const bounds = new google.maps.LatLngBounds()
      path.forEach((p) => bounds.extend(p))
      this.#gmap.fitBounds(bounds, 16)

      // スタート/ゴールの絵文字マーカー（gpx-naviと同じ方式。逆走時は自動的に位置が入れ替わる）
      this.#startMarker = new google.maps.marker.AdvancedMarkerElement({
        position:   path[0],
        map:        this.#gmap,
        content:    emojiMarkerContent('🟢'),
        anchorLeft: '-50%',
        anchorTop:  '-50%',
        zIndex:     500,
      })
      this.#goalMarker = new google.maps.marker.AdvancedMarkerElement({
        position:   path[path.length - 1],
        map:        this.#gmap,
        content:    emojiMarkerContent('🏁'),
        anchorLeft: '-50%',
        anchorTop:  '-50%',
        zIndex:     500,
      })
    })
  }

  setCurrentPosition(lat, lon, headingDeg, gradientPercent = 0) {
    if (!this.#gmap) return

    if (!this.#positionMarker) {
      this.#positionMarkerContent = createPositionMarkerContent()
      this.#positionMarker = new google.maps.marker.AdvancedMarkerElement({
        position:   { lat, lng: lon },
        map:        this.#gmap,
        content:    this.#positionMarkerContent,
        anchorLeft: '-50%',
        anchorTop:  '-50%',
      })
    } else {
      this.#positionMarker.position = { lat, lng: lon }
    }
    this.#positionMarkerContent.style.transform = `rotate(${headingDeg}deg)`

    if (this.#followMode) this.#gmap.panTo({ lat, lng: lon })
    this.#maybeUpdateStreetView(lat, lon, headingDeg, gradientPercent)
  }

  setProgress(distanceM) {
    if (!this.#gmap || !this.#currentRoute) return
    this.#progressPolyline?.setMap(null)

    const pts      = this.#currentRoute.points
    const traversed = pts.filter((p) => p.distanceFromStartM <= distanceM)
    if (traversed.length < 2) return

    const pos  = this.#currentRoute.getPositionAt(distanceM)
    const path = [
      ...traversed.map((p) => ({ lat: p.lat, lng: p.lon })),
      { lat: pos.lat, lng: pos.lon },
    ]
    this.#progressPolyline = new google.maps.Polyline({
      path,
      geodesic:      true,
      strokeColor:   '#4caf50',
      strokeOpacity: 0.9,
      strokeWeight:  4,
      map:           this.#gmap,
    })
  }

  recenter() {
    this.#followMode = true
    if (this.#positionMarker && this.#gmap) {
      this.#gmap.setCenter(this.#positionMarker.position)
      this.#gmap.setZoom(Math.max(this.#gmap.getZoom() ?? 0, 15))
    }
  }

  invalidateSize() {
    if (this.#gmap) google.maps.event.trigger(this.#gmap, 'resize')
  }

  destroy() {
    this.#routePolyline?.setMap(null)
    this.#progressPolyline?.setMap(null)
    if (this.#positionMarker) this.#positionMarker.map = null
    if (this.#startMarker)    this.#startMarker.map    = null
    if (this.#goalMarker)     this.#goalMarker.map     = null
    this.#photoEl.hidden    = true
    this.#photoEl.innerHTML = ''
  }

  #maybeUpdateStreetView(lat, lon, headingDeg, gradientPercent) {
    const now = Date.now()
    if (now - this.#lastSVAt < STREETVIEW_MIN_INTERVAL_MS) return

    const distM       = this.#lastSVLat != null ? haversineM(this.#lastSVLat, this.#lastSVLon, lat, lon) : Infinity
    const gradDiff    = this.#lastSVGradient != null ? Math.abs(gradientPercent - this.#lastSVGradient) : Infinity
    const headingDiff = this.#lastSVHeading  != null ? Math.abs(headingDeg - this.#lastSVHeading)       : Infinity

    if (
      distM       < STREETVIEW_MIN_DIST_M &&
      gradDiff    < STREETVIEW_MIN_GRADIENT_DIFF &&
      headingDiff < STREETVIEW_MIN_HEADING_DIFF
    ) return

    this.#lastSVLat      = lat
    this.#lastSVLon      = lon
    this.#lastSVGradient = gradientPercent
    this.#lastSVHeading  = headingDeg
    this.#lastSVAt       = now

    // Cloudflare Workers の /api/streetview 経由（APIキーをブラウザに渡さない。13-5節参照）
    this.#photoImg.src = `/api/streetview?lat=${lat}&lon=${lon}&heading=${Math.round(headingDeg)}`
  }
}
