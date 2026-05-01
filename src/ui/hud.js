const LOOKAHEAD_M  = 1000
const SAMPLE_M     = 20
const SVG_W        = 200
const SVG_H        = 52
const PAD_B        = 6    // bottom padding for color strip
const ELE_RANGE_M  = 100  // fixed vertical scale: SVG height always represents 100 m of elevation

export class HUDView {
  #route = null

  /** Call once when a route is selected (before riding starts). */
  setRoute(route) {
    this.#route = route
  }

  update({
    velocityMs, distanceM, elapsedSec, elevationGainM,
    powerW, cadenceRpm, torqueNm, heartRateBpm, gradientPercent,
  }) {
    set('hud-speed',    (velocityMs * 3.6).toFixed(1))
    set('hud-distance', (distanceM  / 1000).toFixed(2))
    set('hud-time',     fmtTime(elapsedSec))
    set('hud-elev',     Math.round(elevationGainM).toString())
    set('hud-power',    Math.round(powerW).toString())
    set('hud-cadence',  Math.round(cadenceRpm).toString())
    set('hud-torque',   torqueNm != null ? torqueNm.toFixed(1) : '--.-')
    set('hud-hr',       heartRateBpm > 0 ? heartRateBpm.toString() : '--')
    set('hud-gradient', (gradientPercent >= 0 ? '+' : '') + gradientPercent.toFixed(1))

    if (this.#route) this.#renderGradientProfile(distanceM)
  }

  showFinished() {
    const el = document.getElementById('hud-finish-msg')
    if (el) el.hidden = false
  }

  #renderGradientProfile(currentDistanceM) {
    const svg = document.getElementById('gradient-profile')
    if (!svg) return

    const route    = this.#route
    const endM     = Math.min(currentDistanceM + LOOKAHEAD_M, route.totalDistanceM)
    const spanM    = endM - currentDistanceM
    if (spanM <= 0) { svg.innerHTML = ''; return }

    // Sample route ahead
    const samples = []
    for (let d = currentDistanceM; d <= endM; d += SAMPLE_M) {
      samples.push({ d, elev: route.getElevationAt(d) ?? 0, grad: route.getGradientAt(d) })
    }
    if (samples.length === 0 || samples[samples.length - 1].d < endM) {
      samples.push({ d: endM, elev: route.getElevationAt(endM) ?? 0, grad: route.getGradientAt(endM) })
    }

    const eleMin = Math.min(...samples.map((s) => s.elev))

    const toX = (d) => ((d - currentDistanceM) / spanM) * SVG_W
    const toY = (e) => SVG_H - PAD_B - ((e - eleMin) / ELE_RANGE_M) * (SVG_H - PAD_B - 2)

    // Group consecutive same-color samples into one polygon (eliminates gaps at color boundaries)
    const parts = []
    let si = 1
    while (si < samples.length) {
      const col = gradientColor(samples[si].grad)
      let ei = si
      while (ei < samples.length && gradientColor(samples[ei].grad) === col) ei++

      const pts = [
        `${toX(samples[si - 1].d)},${SVG_H}`,
        `${toX(samples[si - 1].d)},${toY(samples[si - 1].elev)}`,
      ]
      for (let k = si; k < ei; k++) {
        pts.push(`${toX(samples[k].d)},${toY(samples[k].elev)}`)
      }
      pts.push(`${toX(samples[ei - 1].d)},${SVG_H}`)
      parts.push(`<polygon points="${pts.join(' ')}" fill="${col}" fill-opacity="0.9" shape-rendering="crispEdges"/>`)
      si = ei
    }
    const polys = parts.join('')

    // White profile line on top
    const polyPts = samples.map((s) => `${toX(s.d)},${toY(s.elev)}`).join(' ')
    const line = `<polyline points="${polyPts}" fill="none" stroke="rgba(255,255,255,0.55)" stroke-width="1"/>`

    // Vertical marker at current position (left edge)
    const marker = `<line x1="1" y1="0" x2="1" y2="${SVG_H}" stroke="#fff" stroke-width="1.5" opacity="0.8"/>`

    // Distance ticks: 500m mark
    const ticks = spanM >= 500
      ? `<line x1="${toX(currentDistanceM + 500)}" y1="${SVG_H - 6}" x2="${toX(currentDistanceM + 500)}" y2="${SVG_H}" stroke="#fff" stroke-width="0.8" opacity="0.5"/>`
      : ''

    svg.setAttribute('viewBox', `0 0 ${SVG_W} ${SVG_H}`)
    svg.setAttribute('preserveAspectRatio', 'none')
    svg.innerHTML = polys + line + marker + ticks
  }
}

function gradientColor(pct) {
  if (pct < 3)  return '#2ed573'   // flat / downhill
  if (pct < 6)  return '#ffd32a'   // moderate climb
  if (pct < 9)  return '#ff6348'   // hard climb
  if (pct < 12) return '#ff0000'   // steep climb
  return '#4C2E30'                  // very steep
}

function set(id, value) {
  const el = document.getElementById(id)
  if (el) el.textContent = value
}

function fmtTime(totalSec) {
  const s = Math.floor(totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0
    ? `${h}:${pad(m)}:${pad(s % 60)}`
    : `${m}:${pad(s % 60)}`
}

function pad(n) { return String(n).padStart(2, '0') }
