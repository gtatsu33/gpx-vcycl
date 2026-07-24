import { getDb }              from '../storage/db.js'
import { fetchCandidateImages, fetchThumbUrl } from './api.js'
import { selectBest }         from './score.js'
import { haversineM }         from '../domain/gpxParser.js'

const STALE_MS = 90 * 24 * 60 * 60 * 1000

// スコアリング・表示ロジックを変更したときはここを上げる。
// バージョン不一致のキャッシュエントリは自動的に再フェッチされる。
const CACHE_VERSION = 11

function isStale(entry) {
  return (
    entry.v !== CACHE_VERSION ||
    Date.now() - entry.cachedAt > STALE_MS
  )
}

// thumb_1024_url は有効期限不明のため永続化しない
function stripUrl({ thumb_1024_url, ...rest }) {
  return rest
}

async function cacheGet(key) {
  return getDb().get('mapillaryCache', key)
}

async function cacheSet(key, value) {
  return getDb().put('mapillaryCache', value, key)
}

/**
 * キャッシュを確認し、必要に応じて Mapillary API を呼んで最適画像を返す。
 * @param {string} cachePrefix  `${routeId}:f` または `${routeId}:r`
 * @param {number} idx          points 配列内のインデックス
 * @param {object} point        { lat, lon, bearing, ... }
 * @param {string|null} activeSequenceId
 * @param {{lat: number, lon: number}|null} lastImagePosition  直前に選ばれた画像の実座標
 * @returns {Promise<{image: object|null, reason: 'no-candidates'|'no-viable-candidate'|null}>}
 *   image===nullのとき、reasonが理由を示す（fetch失敗はここでは投げっぱなしにし、
 *   呼び出し元のlookahead.js側でcatchして'fetch-error'として扱う）。
 */
export async function resolveImageForPoint(cachePrefix, idx, point, activeSequenceId = null, lastImagePosition = null) {
  const key    = `${cachePrefix}::${idx}`
  const cached = await cacheGet(key)

  if (cached && !isStale(cached)) {
    if (cached.image === null) return { image: null, reason: cached.reason ?? 'no-viable-candidate' }
    const fresh = await fetchThumbUrl(cached.image.id)
    return { image: { ...cached.image, thumb_1024_url: fresh.thumb_1024_url }, reason: null }
  }

  const candidates = await fetchCandidateImages(point)
  const best   = selectBest(candidates, point, activeSequenceId, haversineM, lastImagePosition)
  const reason = best ? null : (candidates.length === 0 ? 'no-candidates' : 'no-viable-candidate')
  await cacheSet(key, {
    v:        CACHE_VERSION,
    image:    best ? stripUrl(best) : null,
    reason,
    cachedAt: Date.now(),
  })
  return { image: best, reason }
}
