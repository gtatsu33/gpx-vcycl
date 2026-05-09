const AHEAD_M = 500
const FOG_RGB = [14, 24, 32]  // #0e1820 — matches canvas background

function gradientColor(pct) {
  if (pct < 3)  return '#2ed573'
  if (pct < 6)  return '#ffd32a'
  if (pct < 9)  return '#ff6348'
  if (pct < 12) return '#ff0000'
  return '#4C2E30'
}

function foggedColor(hex, t) {
  const r1  = parseInt(hex.slice(1, 3), 16)
  const g1  = parseInt(hex.slice(3, 5), 16)
  const b1  = parseInt(hex.slice(5, 7), 16)
  const fog = t * 0.95
  return `rgb(${Math.round(r1 + (FOG_RGB[0] - r1) * fog)},${Math.round(g1 + (FOG_RGB[1] - g1) * fog)},${Math.round(b1 + (FOG_RGB[2] - b1) * fog)})`
}

export class EleView {
  #canvas
  #ctx
  #route     = null
  #distanceM = 0
  #sized     = false

  constructor(canvasEl) {
    this.#canvas = canvasEl
    this.#ctx    = canvasEl.getContext('2d')
    this.#syncSize()
    new ResizeObserver(() => { this.#syncSize(); this.#redraw() }).observe(canvasEl)
  }

  setRoute(route)   { this.#route = route; this.#redraw() }
  update(distanceM) { this.#distanceM = distanceM; this.#redraw() }
  resize()          { this.#syncSize(); this.#redraw() }

  // ── private ──────────────────────────────────────────────────────────

  #syncSize() {
    const dpr  = window.devicePixelRatio || 1
    const rect = this.#canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    this.#canvas.width  = Math.round(rect.width  * dpr)
    this.#canvas.height = Math.round(rect.height * dpr)
    this.#sized = true
  }

  // Returns [{distFromCurrentM, elevM}] using actual trkpt intervals
  #buildSamples(currentDistM, aheadM) {
    const route        = this.#route
    const currentElevM = route.getElevationAt(currentDistM) ?? 0
    const samples      = [{ distFromCurrentM: 0, elevM: currentElevM }]

    for (const pt of route.points) {
      const d = pt.distanceFromStartM
      if (d <= currentDistM) continue
      if (d >= currentDistM + aheadM) break
      samples.push({
        distFromCurrentM: d - currentDistM,
        elevM: pt.elevationM ?? route.getElevationAt(d) ?? currentElevM,
      })
    }

    samples.push({
      distFromCurrentM: aheadM,
      elevM: route.getElevationAt(currentDistM + aheadM) ?? currentElevM,
    })
    return samples
  }

  #redraw() {
    if (!this.#sized) return

    const dpr = window.devicePixelRatio || 1
    const W   = this.#canvas.width  / dpr
    const H   = this.#canvas.height / dpr
    const ctx = this.#ctx

    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#0e1820'
    ctx.fillRect(0, 0, W, H)

    if (!this.#route) { ctx.restore(); return }

    const currentDistM = this.#distanceM
    const totalDistM   = this.#route.totalDistanceM
    const aheadM       = Math.min(AHEAD_M, totalDistM - currentDistM)
    if (aheadM < 5) { ctx.restore(); return }

    // Perspective constants (CSS px)
    const Y_NEAR     = H
    const Y_HORIZON  = H * 0.60   // flat road reaches 40% up from bottom
    const W_NEAR     = W * 0.85
    const W_FAR      = W * 0.30   // far end ~50% canvas width
    const ELEV_SCALE = (Y_NEAR - Y_HORIZON) / 100  // 100 m fills full perspective height

    const samples      = this.#buildSamples(currentDistM, aheadM)
    const currentElevM = samples[0].elevM

    const pts = samples.map(({ distFromCurrentM, elevM }) => {
      const t      = distFromCurrentM / aheadM
      const perspY = Y_NEAR + (Y_HORIZON - Y_NEAR) * t
      const w      = W_NEAR + (W_FAR - W_NEAR) * t
      const y      = perspY - (elevM - currentElevM) * ELEV_SCALE
      return { y, w }
    })

    // Draw segments far → near (near overdraws far for correct z-order)
    for (let i = pts.length - 2; i >= 0; i--) {
      const p0   = pts[i]      // near end of this segment
      const p1   = pts[i + 1]  // far end of this segment
      const midD = (samples[i].distFromCurrentM + samples[i + 1].distFromCurrentM) / 2
      const grad = this.#route.getGradientAt(Math.min(currentDistM + midD, totalDistM))

      ctx.beginPath()
      ctx.moveTo(W / 2 - p1.w / 2, p1.y)
      ctx.lineTo(W / 2 + p1.w / 2, p1.y)
      ctx.lineTo(W / 2 + p0.w / 2, p0.y)
      ctx.lineTo(W / 2 - p0.w / 2, p0.y)
      ctx.closePath()
      ctx.fillStyle = foggedColor(gradientColor(Math.abs(grad)), midD / aheadM)
      ctx.fill()
    }

    // Reference lines: left/right edges of a flat (0% gradient) road
    ctx.beginPath()
    ctx.moveTo(W / 2 - W_NEAR / 2, Y_NEAR)
    ctx.lineTo(W / 2 - W_FAR  / 2, Y_HORIZON)
    ctx.moveTo(W / 2 + W_NEAR / 2, Y_NEAR)
    ctx.lineTo(W / 2 + W_FAR  / 2, Y_HORIZON)
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'
    ctx.lineWidth   = 4
    ctx.stroke()

    // Labels
    const e0      = this.#route.getElevationAt(currentDistM)
    const e1      = this.#route.getElevationAt(currentDistM + aheadM)
    const avgGrad = (e0 !== null && e1 !== null) ? ((e1 - e0) / aheadM) * 100 : 0
    const sign    = avgGrad >= 0 ? '+' : ''
    const avgLabel = `avg ${sign}${avgGrad.toFixed(1)}%`

    ctx.font         = '11px system-ui, sans-serif'
    ctx.fillStyle    = 'rgba(160,195,220,0.75)'
    ctx.textBaseline = 'top'
    ctx.fillText(`Ahead ${Math.round(aheadM)}m`, 8, 6)
    ctx.fillText(avgLabel, W - ctx.measureText(avgLabel).width - 8, 6)

    ctx.restore()
  }
}
