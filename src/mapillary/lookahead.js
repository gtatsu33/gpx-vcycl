import { resolveImageForPoint } from './cache.js'
import { preloadImage }         from './panel.js'

export class ActiveIndexTracker {
  #points
  #activeIndex = 0

  constructor(points) {
    this.#points = points
  }

  /** currentDistanceM の単調増加を前提に activeIndex を進める。 */
  update(currentDistanceM) {
    while (
      this.#activeIndex + 1 < this.#points.length &&
      currentDistanceM >= this.#points[this.#activeIndex + 1].distanceFromStartM - 25
    ) {
      this.#activeIndex++
    }
    return this.#activeIndex
  }

  /** 開始距離の変更（複数日ライドの開始点選択など）で任意距離へ飛ぶ。前後どちらへも移動可。 */
  seekTo(currentDistanceM) {
    let idx = 0
    for (let i = 0; i < this.#points.length - 1; i++) {
      if (currentDistanceM >= this.#points[i + 1].distanceFromStartM - 25) idx = i + 1
      else break
    }
    this.#activeIndex = idx
    return idx
  }
}

export class MapillaryLookahead {
  #cachePrefix
  #points
  #lookaheadPoints
  #buffer           = new Map() // index -> { status: 'pending'|'done'|'error', image }
  #nextFetchIndex   = 0
  #inFlight         = false
  #activeSequenceId = null     // 直前に選ばれた画像のsequence_id（連続性ボーナス用）

  /**
   * @param {string} cachePrefix  `${routeId}:f` または `${routeId}:r`
   * @param {Array}  points       bearing 付与済み route.points
   * @param {number} lookaheadPoints  50m間隔前提で6≈300m先
   */
  constructor(cachePrefix, points, lookaheadPoints = 6) {
    this.#cachePrefix     = cachePrefix
    this.#points          = points
    this.#lookaheadPoints = lookaheadPoints
  }

  async tick(activeIndex) {
    for (const idx of this.#buffer.keys()) {
      if (idx < activeIndex - 1) this.#buffer.delete(idx)
    }

    if (this.#inFlight) return

    const target = activeIndex + this.#lookaheadPoints
    if (this.#nextFetchIndex > target || this.#nextFetchIndex >= this.#points.length) return

    const idx = this.#nextFetchIndex++
    this.#buffer.set(idx, { status: 'pending', image: null })
    this.#inFlight = true
    const pt = this.#points[idx]
    console.debug(`[Mapillary] fetching idx=${idx} lat=${pt.lat.toFixed(5)} lon=${pt.lon.toFixed(5)} bearing=${pt.bearing.toFixed(1)}°`)
    try {
      const best = await resolveImageForPoint(this.#cachePrefix, idx, pt, this.#activeSequenceId)
      if (best?.sequence_id) this.#activeSequenceId = best.sequence_id
      preloadImage(best?.thumb_1024_url)
      this.#buffer.set(idx, { status: 'done', image: best, routeBearing: pt.bearing })
      console.debug(`[Mapillary] idx=${idx} → ${best ? `id=${best.id} seq=${best.sequence_id}` : 'no image'}`)
    } catch (e) {
      console.warn(`[Mapillary] fetch failed idx=${idx}`, e)
      this.#buffer.set(idx, { status: 'error', image: null, routeBearing: pt.bearing })
    } finally {
      this.#inFlight = false
    }
  }

  getStateFor(index) {
    return this.#buffer.get(index) ?? { status: 'pending', image: null, routeBearing: null }
  }

  /** 開始距離の変更で任意のindexへ飛ぶ。#nextFetchIndexをそこから再開させ、
   *  無関係になった先読みバッファ・連続性ボーナスをクリアする。 */
  seekTo(activeIndex) {
    this.#nextFetchIndex   = activeIndex
    this.#buffer.clear()
    this.#activeSequenceId = null
  }
}
