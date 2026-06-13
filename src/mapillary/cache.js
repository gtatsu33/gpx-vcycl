import { getDb }              from '../storage/db.js'
import { fetchCandidateImages, fetchThumbUrl } from './api.js'
import { selectBest }         from './score.js'

const STALE_MS = 90 * 24 * 60 * 60 * 1000

// スコアリング・表示ロジックを変更したときはここを上げる。
// バージョン不一致のキャッシュエントリは自動的に再フェッチされる。
const CACHE_VERSION = 5

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
 */
export async function resolveImageForPoint(cachePrefix, idx, point) {
  const key    = `${cachePrefix}::${idx}`
  const cached = await cacheGet(key)

  if (cached && !isStale(cached)) {
    if (cached.image === null) return null
    const fresh = await fetchThumbUrl(cached.image.id)
    return { ...cached.image, thumb_1024_url: fresh.thumb_1024_url }
  }

  const candidates = await fetchCandidateImages(point)
  const best = selectBest(candidates, point.bearing)
  await cacheSet(key, {
    v:        CACHE_VERSION,
    image:    best ? stripUrl(best) : null,
    cachedAt: Date.now(),
  })
  return best
}
