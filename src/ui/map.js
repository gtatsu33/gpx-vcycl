import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// SVG arrow marker (tip points up = heading 0°; rotated for current heading)
const ARROW_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
  <polygon points="14,2 26,30 14,24 2,30" fill="#e94560" stroke="#fff" stroke-width="2"/>
</svg>`

export class MapView {
  #map
  #routeLayer    = null
  #progressLayer = null
  #positionMarker = null
  #currentRoute  = null
  #followMode    = true

  constructor(containerEl) {
    this.#map = L.map(containerEl, { zoomControl: true })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(this.#map)
    this.#map.on('dragstart', () => { this.#followMode = false })
  }

  setRoute(route) {
    this.#currentRoute = route
    if (this.#routeLayer)    { this.#map.removeLayer(this.#routeLayer);    this.#routeLayer    = null }
    if (this.#progressLayer) { this.#map.removeLayer(this.#progressLayer); this.#progressLayer = null }
    if (this.#positionMarker){ this.#map.removeLayer(this.#positionMarker);this.#positionMarker= null }

    const latlngs = route.points.map((p) => [p.lat, p.lon])
    this.#routeLayer = L.polyline(latlngs, { color: '#4488ff', weight: 4, opacity: 0.9 }).addTo(this.#map)
    this.#map.fitBounds(this.#routeLayer.getBounds(), { padding: [16, 16] })
  }

  setCurrentPosition(lat, lon, headingDeg) {
    const icon = L.divIcon({
      html: `<div style="transform:rotate(${headingDeg}deg);transform-origin:50% 50%">${ARROW_SVG}</div>`,
      className: '',
      iconSize:   [28, 36],
      iconAnchor: [14, 18],
    })
    if (!this.#positionMarker) {
      this.#positionMarker = L.marker([lat, lon], { icon }).addTo(this.#map)
    } else {
      this.#positionMarker.setLatLng([lat, lon])
      this.#positionMarker.setIcon(icon)
    }
    if (this.#followMode) this.#map.panTo([lat, lon])
  }

  recenter() {
    this.#followMode = true
    if (this.#positionMarker) {
      this.#map.setView(this.#positionMarker.getLatLng(), Math.max(this.#map.getZoom(), 15))
    }
  }

  /** Draw the traversed portion of the route in green up to distanceM. */
  setProgress(distanceM) {
    if (!this.#currentRoute) return
    if (this.#progressLayer) { this.#map.removeLayer(this.#progressLayer); this.#progressLayer = null }

    const pts      = this.#currentRoute.points
    const traversed = pts.filter((p) => p.distanceFromStartM <= distanceM)
    if (traversed.length < 2) return

    const pos = this.#currentRoute.getPositionAt(distanceM)
    const latlngs = [...traversed.map((p) => [p.lat, p.lon]), [pos.lat, pos.lon]]
    this.#progressLayer = L.polyline(latlngs, { color: '#4caf50', weight: 4, opacity: 0.9 }).addTo(this.#map)
  }

  /** Must be called after the container becomes visible (e.g. tab switch). */
  invalidateSize() {
    this.#map.invalidateSize()
  }

  destroy() {
    this.#map.remove()
  }
}

export { MapView as LeafletMapView }
