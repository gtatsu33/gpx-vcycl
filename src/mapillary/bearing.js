const toRad = (deg) => (deg * Math.PI) / 180
const toDeg = (rad) => (rad * 180) / Math.PI

function calcBearing(p1, p2) {
  const φ1 = toRad(p1.lat), φ2 = toRad(p2.lat)
  const Δλ = toRad(p2.lon - p1.lon)
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** 各点に bearing [deg] を付与して返す。逆走済みの points をそのまま渡せばよい。 */
export function precomputeBearings(points, window = 2) {
  return points.map((p, i) => {
    const before = points[Math.max(0, i - window)]
    const after  = points[Math.min(points.length - 1, i + window)]
    return { ...p, bearing: calcBearing(before, after) }
  })
}
