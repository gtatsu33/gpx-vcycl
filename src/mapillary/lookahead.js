import { resolveImageForPoint }   from './cache.js'
import { preloadImage }           from './panel.js'
import { effectiveGeometry }      from './score.js'

// points は resampleRoute() で生成された等間隔（既定20m）点列を想定。
// マージンは間隔より十分小さくし、1tickでactiveIndexが2つ以上進まないようにする。
const PRE_TRIGGER_M = 8

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
      currentDistanceM >= this.#points[this.#activeIndex + 1].distanceFromStartM - PRE_TRIGGER_M
    ) {
      this.#activeIndex++
    }
    return this.#activeIndex
  }

  /** 開始距離の変更（複数日ライドの開始点選択など）で任意距離へ飛ぶ。前後どちらへも移動可。 */
  seekTo(currentDistanceM) {
    let idx = 0
    for (let i = 0; i < this.#points.length - 1; i++) {
      if (currentDistanceM >= this.#points[i + 1].distanceFromStartM - PRE_TRIGGER_M) idx = i + 1
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
  #buffer            = new Map() // index -> { status: 'pending'|'done'|'error', image, reason }
  #nextFetchIndex    = 0
  #inFlightPromise   = null
  #activeSequenceId  = null     // 直前に選ばれた画像のsequence（連続性ボーナス用）
  #lastImagePosition = null     // 直前に選ばれた画像の実座標（同一シーケンス内の巻き戻り防止用）

  /**
   * @param {string} cachePrefix  `${routeId}:f` または `${routeId}:r`
   * @param {Array}  points       bearing 付与済み resampleRoute() 出力（既定20m間隔）
   * @param {number} lookaheadPoints  20m間隔前提で12≈240m先
   */
  constructor(cachePrefix, points, lookaheadPoints = 12) {
    this.#cachePrefix     = cachePrefix
    this.#points          = points
    this.#lookaheadPoints = lookaheadPoints
  }

  /**
   * 先読みバッファを埋める。既に他のフェッチが進行中の場合、その完了を
   * 待ってから自分の要求（activeIndex）で再試行する（黙って空振りしない）。
   * 【2026-07-25修正】以前は進行中フェッチがあると即return（空振り）して
   * いたため、その空振り直後に呼び出し元が単発でgetStateFor()を参照する
   * ケース（previewAtDistance()等）で、狙った位置が永久にpendingのまま
   * 取り残される不具合があった（ライド終了直後にルート選択へ戻ると
   * 写真パネルがNo Imageのまま更新されない、など）。
   */
  async tick(activeIndex) {
    for (const idx of this.#buffer.keys()) {
      if (idx < activeIndex - 1) this.#buffer.delete(idx)
    }

    if (this.#inFlightPromise) {
      await this.#inFlightPromise
      return this.tick(activeIndex)
    }

    const target = activeIndex + this.#lookaheadPoints
    if (this.#nextFetchIndex > target || this.#nextFetchIndex >= this.#points.length) return

    const idx = this.#nextFetchIndex++
    this.#buffer.set(idx, { status: 'pending', image: null })
    const pt = this.#points[idx]
    console.debug(`[Mapillary] fetching idx=${idx} lat=${pt.lat.toFixed(5)} lon=${pt.lon.toFixed(5)} bearing=${pt.bearing.toFixed(1)}°`)
    this.#inFlightPromise = (async () => {
      try {
        const { image: best, reason } = await resolveImageForPoint(
          this.#cachePrefix, idx, pt, this.#activeSequenceId, this.#lastImagePosition
        )
        if (best?.sequence) this.#activeSequenceId = best.sequence
        if (best) this.#lastImagePosition = effectiveGeometry(best) ?? this.#lastImagePosition
        preloadImage(best?.thumb_1024_url)
        this.#buffer.set(idx, { status: 'done', image: best, routeBearing: pt.bearing, reason })
        console.debug(`[Mapillary] idx=${idx} → ${best ? `id=${best.id} seq=${best.sequence}` : `no image (${reason})`}`)
      } catch (e) {
        console.warn(`[Mapillary] fetch failed idx=${idx}`, e)
        this.#buffer.set(idx, { status: 'error', image: null, routeBearing: pt.bearing, reason: 'fetch-error' })
      } finally {
        this.#inFlightPromise = null
      }
    })()
    await this.#inFlightPromise
  }

  getStateFor(index) {
    return this.#buffer.get(index) ?? { status: 'pending', image: null, routeBearing: null, reason: null }
  }

  /** 開始距離の変更で任意のindexへ飛ぶ。#nextFetchIndexをそこから再開させ、
   *  無関係になった先読みバッファ・連続性ボーナスをクリアする。 */
  seekTo(activeIndex) {
    this.#nextFetchIndex    = activeIndex
    this.#buffer.clear()
    this.#activeSequenceId  = null
    this.#lastImagePosition = null
  }
}
