const SEQUENCE_BONUS = 20
const DISTANCE_SCORE_MAX_M = 40 // この距離以遠は距離加点なし（bbox探索半径35mの対角付近）
const BACKWARD_TOLERANCE_M = 3  // GPS/選定誤差の揺らぎ吸収用の許容量

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

function recencyScore(capturedAtMs) {
  const years = (Date.now() - capturedAtMs) / (1000 * 60 * 60 * 24 * 365)
  return Math.max(0, 10 - years)
}

// computed_compass_angle（SfM補正済み）を優先し、なければ生センサー値にフォールバック
export function effectiveAngle(image) {
  return image.computed_compass_angle ?? image.compass_angle
}

// computed_geometry（SfM補正済み）を優先し、なければ生センサー値にフォールバック
export function effectiveGeometry(image) {
  const g = image.computed_geometry ?? image.geometry
  return g ? { lat: g.coordinates[1], lon: g.coordinates[0] } : null
}

function distanceScore(distanceM) {
  if (distanceM === null) return 0
  return Math.max(0, DISTANCE_SCORE_MAX_M - distanceM) * 0.5
}

// lastPos→candidatePosのベクトルをルート進行方位bearingDegへ射影し、
// 進行方向の負成分（後方）がBACKWARD_TOLERANCE_Mを超えるかを判定する。
// 数十m規模の局所計算のため、球面補正なしの平面近似で十分。
function isBehind(lastPos, candidatePos, bearingDeg) {
  const dLatM = (candidatePos.lat - lastPos.lat) * 111320
  const dLonM = (candidatePos.lon - lastPos.lon) * 111320 * Math.cos(lastPos.lat * Math.PI / 180)
  const bearingRad = bearingDeg * Math.PI / 180
  const forwardM = dLonM * Math.sin(bearingRad) + dLatM * Math.cos(bearingRad)
  return forwardM < -BACKWARD_TOLERANCE_M
}

function scoreCandidate(image, point, activeSequenceId, distanceM, lastImagePosition) {
  const angle = effectiveAngle(image)
  const diff = angleDiff(angle, point.bearing)
  if (diff > 45) return -1

  // 同一シーケンス継続中は、直前に選んだ画像より進行方向後方の候補を除外する
  // （シーケンス内の巻き戻り＝写真が逆走して見える現象の防止）。
  if (activeSequenceId && image.sequence === activeSequenceId && lastImagePosition) {
    const geo = effectiveGeometry(image)
    if (geo && isBehind(lastImagePosition, geo, point.bearing)) return -1
  }

  let score = image.is_pano
    ? 35 - diff * 0.2 + (image.quality_score ?? 0.5) * 20 + recencyScore(image.captured_at)
    : 50 - diff * 0.3 + (image.quality_score ?? 0.5) * 20 + recencyScore(image.captured_at)

  score += distanceScore(distanceM)

  if (activeSequenceId && image.sequence === activeSequenceId) {
    score += SEQUENCE_BONUS
  }

  return score
}

/**
 * @param {Array}  images
 * @param {{lat: number, lon: number, bearing: number}} point
 * @param {string|null} activeSequenceId
 * @param {(lat: number, lon: number, lat2: number, lon2: number) => number} haversineM
 * @param {{lat: number, lon: number}|null} lastImagePosition  直前に選ばれた画像の実座標
 */
export function selectBest(images, point, activeSequenceId = null, haversineM, lastImagePosition = null) {
  const all = images.map((img) => {
    const geo = effectiveGeometry(img)
    const distanceM = geo ? haversineM(point.lat, point.lon, geo.lat, geo.lon) : null
    return { ...img, distanceM, score: scoreCandidate(img, point, activeSequenceId, distanceM, lastImagePosition) }
  })
  all.sort((a, b) => b.score - a.score)

  console.group(`[Mapillary] selectBest routeBearing=${point.bearing.toFixed(1)}° seq=${activeSequenceId ?? 'none'} (${images.length} candidates)`)
  const bestIdx = all.findIndex((c) => c.score >= 0)
  for (let i = 0; i < all.length; i++) {
    const c      = all[i]
    const angle  = effectiveAngle(c)
    const diff   = angleDiff(angle, point.bearing)
    const tag    = c.score < 0 ? 'REJECT' : i === bestIdx ? 'BEST  ' : 'pass  '
    const src    = c.computed_compass_angle != null ? 'cmp' : 'raw'
    const seqTag = activeSequenceId && c.sequence === activeSequenceId ? '+seq' : '    '
    const author = c.creator?.username ?? '?'
    const distTag = c.distanceM !== null ? `${c.distanceM.toFixed(1)}m` : 'null'
    console.log(
      `  ${tag} ${seqTag} id=${c.id} @${author} pano=${c.is_pano} angle=${angle ?? 'null'}(${src}) diff=${isNaN(diff) ? 'NaN' : diff.toFixed(1)}° dist=${distTag} score=${c.score < 0 ? 'REJECT' : c.score.toFixed(1)}`
    )
  }
  console.groupEnd()

  return bestIdx >= 0 ? all[bestIdx] : null
}
