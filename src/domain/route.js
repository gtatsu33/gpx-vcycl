import { parseGpx, haversineM } from './gpxParser.js'

/**
 * 各点に gradientPercent を付与する。前後 windowM [m] の範囲の点で線形回帰。
 * elevation が null の点は gradientPercent = 0。
 * @param {Array<{distanceFromStartM: number, elevationM: number|null}>} points
 * @param {number} windowM
 */
export function calculateGradients(points, windowM = 30) {
  const half = windowM / 2
  return points.map((pt, idx) => {
    if (pt.elevationM === null) return { ...pt, gradientPercent: 0 }

    const win = points.filter(
      (p) => p.elevationM !== null && Math.abs(p.distanceFromStartM - pt.distanceFromStartM) <= half
    )

    if (win.length >= 2) {
      const n    = win.length
      const sumX  = win.reduce((s, p) => s + p.distanceFromStartM, 0)
      const sumY  = win.reduce((s, p) => s + p.elevationM, 0)
      const sumXY = win.reduce((s, p) => s + p.distanceFromStartM * p.elevationM, 0)
      const sumX2 = win.reduce((s, p) => s + p.distanceFromStartM ** 2, 0)
      const denom = n * sumX2 - sumX ** 2
      if (denom === 0) return { ...pt, gradientPercent: 0 }
      const slopePerM = (n * sumXY - sumX * sumY) / denom
      return { ...pt, gradientPercent: slopePerM * 100 }
    }

    // Fallback for sparse GPS: slope between nearest valid bounding points
    let lo = idx - 1
    while (lo >= 0 && points[lo].elevationM === null) lo--
    let hi = idx + 1
    while (hi < points.length && points[hi].elevationM === null) hi++

    const p0 = lo >= 0 ? points[lo] : pt
    const p1 = hi < points.length ? points[hi] : pt
    if (p0 === p1) return { ...pt, gradientPercent: 0 }
    const dist = p1.distanceFromStartM - p0.distanceFromStartM
    if (dist <= 0) return { ...pt, gradientPercent: 0 }
    return { ...pt, gradientPercent: ((p1.elevationM - p0.elevationM) / dist) * 100 }
  })
}

/**
 * Smooth elevation samples with a distance-based regression window.
 * Preserves steady grades better than a simple moving average, especially near route edges.
 * @param {Array<{distanceFromStartM: number, elevationM: number|null}>} points
 * @param {number} windowM
 */
export function smoothElevations(points, windowM) {
  const half = windowM / 2
  return points.map((pt) => {
    if (pt.elevationM === null) return pt

    const win = points.filter(
      (p) => p.elevationM !== null && Math.abs(p.distanceFromStartM - pt.distanceFromStartM) <= half
    )

    if (win.length < 2) return pt

    const n    = win.length
    const sumX  = win.reduce((s, p) => s + p.distanceFromStartM, 0)
    const sumY  = win.reduce((s, p) => s + p.elevationM, 0)
    const sumXY = win.reduce((s, p) => s + p.distanceFromStartM * p.elevationM, 0)
    const sumX2 = win.reduce((s, p) => s + p.distanceFromStartM ** 2, 0)
    const denom = n * sumX2 - sumX ** 2
    if (denom === 0) return { ...pt, elevationM: sumY / n }

    const slopePerM = (n * sumXY - sumX * sumY) / denom
    const intercept = (sumY - slopePerM * sumX) / n
    const elevationM = intercept + slopePerM * pt.distanceFromStartM
    return { ...pt, elevationM: Math.abs(elevationM - pt.elevationM) < 1e-9 ? pt.elevationM : elevationM }
  })
}

export class Route {
  #name
  #points
  #waypoints = []
  #gradientBuckets = []
  static #ELEVATION_SMOOTHING_WINDOW_M = 300
  static #BUCKET_M = 50

  constructor(name, points, waypoints = []) {
    this.#name      = name
    this.#points    = points
    this.#waypoints = waypoints
    this.#buildGradientBuckets()
  }

  #buildGradientBuckets() {
    const totalM = this.totalDistanceM
    if (totalM <= 0 || this.#points.length < 2) return
    const bM = Route.#BUCKET_M
    const count = Math.ceil(totalM / bM) + 1
    for (let i = 0; i < count; i++) {
      const s  = i * bM
      const e  = Math.min(s + bM, totalM)
      const ea = this.getElevationAt(s)
      const eb = this.getElevationAt(e)
      const pct = (ea !== null && eb !== null && e > s)
        ? ((eb - ea) / (e - s)) * 100
        : 0
      this.#gradientBuckets.push(pct)
    }
  }

  static fromGpx(gpxText, { windowM = 30, reversed = false } = {}) {
    const { name, rawPoints, wpts } = parseGpx(gpxText)
    const ordered = reversed ? [...rawPoints].reverse() : rawPoints

    let cumM = 0
    const withDist = ordered.map((pt, i) => {
      if (i > 0) cumM += haversineM(ordered[i - 1].lat, ordered[i - 1].lon, pt.lat, pt.lon)
      return { ...pt, distanceFromStartM: cumM }
    })

    const smoothed  = smoothElevations(withDist, Route.#ELEVATION_SMOOTHING_WINDOW_M)
    const points    = calculateGradients(smoothed, windowM)
    const waypoints = wpts
      .filter(w => w.name.startsWith('「') && w.name.endsWith('」'))
      .map(w => ({
        lat:       w.lat,
        lon:       w.lon,
        name:      w.name.slice(1, -1),   // 「」を除去
        distanceM: nearestDistM(points, w.lat, w.lon),
      }))

    return new Route(name, points, waypoints)
  }

  get name()      { return this.#name }
  get points()    { return this.#points }
  get waypoints() { return this.#waypoints }

  get totalDistanceM() {
    return this.#points.length > 0 ? this.#points[this.#points.length - 1].distanceFromStartM : 0
  }

  get totalElevationGainM() {
    let gain = 0
    for (let i = 1; i < this.#points.length; i++) {
      const prev = this.#points[i - 1].elevationM
      const curr = this.#points[i].elevationM
      if (prev !== null && curr !== null && curr > prev) gain += curr - prev
    }
    return gain
  }

  /** Binary search for the segment index and interpolation factor t containing distanceM. */
  #findSegment(distanceM) {
    const pts = this.#points
    if (distanceM <= pts[0].distanceFromStartM)                return { i: 0, t: 0 }
    if (distanceM >= pts[pts.length - 1].distanceFromStartM)   return { i: pts.length - 2, t: 1 }

    let lo = 0, hi = pts.length - 2
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (pts[mid + 1].distanceFromStartM < distanceM) lo = mid + 1
      else hi = mid
    }
    const segLen = pts[lo + 1].distanceFromStartM - pts[lo].distanceFromStartM
    const t      = segLen > 0 ? (distanceM - pts[lo].distanceFromStartM) / segLen : 0
    return { i: lo, t }
  }

  /** Linear interpolation of elevation [m] at distanceM. Returns null if no elevation data. */
  getElevationAt(distanceM) {
    const { i, t } = this.#findSegment(distanceM)
    const a = this.#points[i].elevationM
    const b = this.#points[i + 1].elevationM
    if (a === null || b === null) return null
    return a + (b - a) * t
  }

  /** Stable gradient [%] at distanceM [m] — 50 m bucket, constant within each segment. */
  getGradientAt(distanceM) {
    if (this.#gradientBuckets.length === 0) return 0
    const idx = Math.floor(distanceM / Route.#BUCKET_M)
    return this.#gradientBuckets[Math.max(0, Math.min(idx, this.#gradientBuckets.length - 1))]
  }

  /** { lat, lon } at distanceM [m]. */
  getPositionAt(distanceM) {
    const { i, t } = this.#findSegment(distanceM)
    const pa = this.#points[i]
    const pb = this.#points[i + 1]
    return {
      lat: pa.lat + (pb.lat - pa.lat) * t,
      lon: pa.lon + (pb.lon - pa.lon) * t,
    }
  }
}

function nearestDistM(points, lat, lon) {
  let minD = Infinity, best = 0
  for (const pt of points) {
    const d = haversineM(lat, lon, pt.lat, pt.lon)
    if (d < minD) { minD = d; best = pt.distanceFromStartM }
  }
  return best
}
