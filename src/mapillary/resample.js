const DEFAULT_INTERVAL_M = 20

/**
 * GPXの生trkpt密度に依存せず、Mapillary用に一定距離間隔でルートをリサンプルする。
 * ルート選択時に一括計算（数千〜数万点でも数ms・数MB程度で収まるため逐次計算はしない）。
 * @param {import('../domain/route.js').Route} route
 * @param {number} intervalM
 * @returns {Array<{lat: number, lon: number, distanceFromStartM: number}>}
 */
export function resampleRoute(route, intervalM = DEFAULT_INTERVAL_M) {
  const totalM = route.totalDistanceM
  const points = []
  for (let d = 0; d < totalM; d += intervalM) {
    points.push({ ...route.getPositionAt(d), distanceFromStartM: d })
  }
  points.push({ ...route.getPositionAt(totalM), distanceFromStartM: totalM })
  return points
}
