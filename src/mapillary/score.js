const SEQUENCE_BONUS = 15

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

function scoreCandidate(image, routeBearing, activeSequenceId) {
  const angle = effectiveAngle(image)
  const diff = angleDiff(angle, routeBearing)
  if (diff > 45) return -1

  let score = image.is_pano
    ? 35 - diff * 0.2 + (image.quality_score ?? 0.5) * 20 + recencyScore(image.captured_at)
    : 50 - diff * 0.3 + (image.quality_score ?? 0.5) * 20 + recencyScore(image.captured_at)

  if (activeSequenceId && image.sequence_id === activeSequenceId) {
    score += SEQUENCE_BONUS
  }

  return score
}

export function selectBest(images, routeBearing, activeSequenceId = null) {
  const all = images.map((img) => ({ ...img, score: scoreCandidate(img, routeBearing, activeSequenceId) }))
  all.sort((a, b) => b.score - a.score)

  console.group(`[Mapillary] selectBest routeBearing=${routeBearing.toFixed(1)}° seq=${activeSequenceId ?? 'none'} (${images.length} candidates)`)
  const bestIdx = all.findIndex((c) => c.score >= 0)
  for (let i = 0; i < all.length; i++) {
    const c      = all[i]
    const angle  = effectiveAngle(c)
    const diff   = angleDiff(angle, routeBearing)
    const tag    = c.score < 0 ? 'REJECT' : i === bestIdx ? 'BEST  ' : 'pass  '
    const src    = c.computed_compass_angle != null ? 'cmp' : 'raw'
    const seqTag = activeSequenceId && c.sequence_id === activeSequenceId ? '+seq' : '    '
    const author = c.creator?.username ?? '?'
    console.log(
      `  ${tag} ${seqTag} id=${c.id} @${author} pano=${c.is_pano} angle=${angle ?? 'null'}(${src}) diff=${isNaN(diff) ? 'NaN' : diff.toFixed(1)}° score=${c.score < 0 ? 'REJECT' : c.score.toFixed(1)}`
    )
  }
  console.groupEnd()

  return bestIdx >= 0 ? all[bestIdx] : null
}
