// gpx-navi/index.html の parseGPX を移植・拡張（Haversine 累積距離を付加）

const EARTH_RADIUS_M = 6371000

/**
 * 2点間の距離 [m]（Haversine 公式）
 * @param {number} lat1  @param {number} lon1
 * @param {number} lat2  @param {number} lon2
 * @returns {number}
 */
export function haversineM(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return EARTH_RADIUS_M * 2 * Math.asin(Math.sqrt(Math.max(0, a)))
}

/**
 * GPX文字列をパースして { name, rawPoints } を返す。
 * rawPoints: Array<{ lat, lon, elevationM: number|null }>
 *
 * gpx-navi と同じ Namespace フォールバック実装を採用（フォーマットの揺れに対応）。
 * @param {string} gpxText
 */
export function parseGpx(gpxText) {
  const doc = new DOMParser().parseFromString(gpxText, 'text/xml')

  const parseError = doc.querySelector('parsererror')
  if (parseError) throw new Error(`GPX parse error: ${parseError.textContent.slice(0, 200)}`)

  const NS = 'http://www.topografix.com/GPX/1/1'
  function getEls(parent, tag) {
    const withNS    = [...parent.getElementsByTagNameNS(NS, tag)]
    const withoutNS = [...parent.getElementsByTagName(tag)]
    return withNS.length >= withoutNS.length ? withNS : withoutNS
  }
  function getText(parent, tag) {
    const el = getEls(parent, tag)[0]
    return el ? el.textContent.trim() : ''
  }

  const metaEl = getEls(doc, 'metadata')[0]
  const trkEl  = getEls(doc, 'trk')[0]
  const name   = (metaEl ? getText(metaEl, 'name') : '')
              || (trkEl  ? getText(trkEl,  'name')  : '')
              || 'ルート'

  const rawPoints = []
  let prevKey = null
  for (const el of getEls(doc, 'trkpt')) {
    const lat = parseFloat(el.getAttribute('lat'))
    const lon = parseFloat(el.getAttribute('lon'))
    if (isNaN(lat) || isNaN(lon)) continue
    // 連続する重複点を除去（gpx-navi と同じロジック）
    const key = `${lat.toFixed(6)},${lon.toFixed(6)}`
    if (key === prevKey) continue
    prevKey = key
    const eleRaw = parseFloat(getText(el, 'ele'))
    rawPoints.push({ lat, lon, elevationM: isNaN(eleRaw) ? null : eleRaw })
  }

  if (rawPoints.length < 2) {
    throw new Error(`有効なトラックポイントが不足しています（${rawPoints.length}点）`)
  }

  const wpts = []
  for (const el of getEls(doc, 'wpt')) {
    const lat  = parseFloat(el.getAttribute('lat'))
    const lon  = parseFloat(el.getAttribute('lon'))
    const name = getText(el, 'name')
    if (isNaN(lat) || isNaN(lon) || !name) continue
    wpts.push({ lat, lon, name })
  }

  return { name, rawPoints, wpts }
}
