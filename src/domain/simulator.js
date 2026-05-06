import { stepVelocity } from './physics.js'

export class RideSimulator {
  #route
  #params
  #s       // mutable state object
  #paused = false

  /** @param {import('./route.js').Route} route */
  constructor(route, params) {
    this.#route  = route
    this.#params = params
    this.#s      = { distanceM: 0, velocityMs: 0, elapsedSec: 0, elevationGainM: 0 }
  }

  /**
   * Advance simulation by dtSec seconds.
   * No-op when paused or already finished.
   * @param {number} powerW
   * @param {number} dtSec
   */
  tick(powerW, dtSec) {
    if (this.#paused || this.isFinished) return
    const s = this.#s

    const gradient   = this.#route.getGradientAt(s.distanceM)
    const newV       = stepVelocity(powerW, gradient, s.velocityMs, dtSec, this.#params)
    const prevDist   = s.distanceM

    s.distanceM  = Math.min(prevDist + newV * dtSec, this.#route.totalDistanceM)
    s.velocityMs = newV
    s.elapsedSec += dtSec

    const prevElev = this.#route.getElevationAt(prevDist)
    const currElev = this.#route.getElevationAt(s.distanceM)
    if (prevElev !== null && currElev !== null && currElev > prevElev) {
      s.elevationGainM += currElev - prevElev
    }
  }

  getState() {
    const s   = this.#s
    const pos = this.#route.getPositionAt(s.distanceM)

    // Look ahead a short distance to derive heading (degrees, clockwise from north)
    const lookM = Math.min(10, this.#route.totalDistanceM - s.distanceM)
    let headingDeg = 0
    if (lookM > 0.1) {
      const next = this.#route.getPositionAt(s.distanceM + lookM)
      headingDeg = Math.atan2(next.lon - pos.lon, next.lat - pos.lat) * 180 / Math.PI
    }

    return {
      distanceM:              s.distanceM,
      velocityMs:             s.velocityMs,
      elapsedSec:             s.elapsedSec,
      elevationGainM:         s.elevationGainM,
      currentLat:             pos.lat,
      currentLon:             pos.lon,
      currentGradientPercent: this.#route.getGradientAt(s.distanceM),
      headingDeg,
    }
  }

  get isFinished() { return this.#s.distanceM >= this.#route.totalDistanceM }

  getSimState() { return { ...this.#s } }

  restoreSimState({ distanceM, velocityMs, elapsedSec, elevationGainM }) {
    this.#s      = { distanceM, velocityMs, elapsedSec, elevationGainM }
    this.#paused = true
  }

  pause()  { this.#paused = true  }
  resume() { this.#paused = false }

  reset() {
    this.#s      = { distanceM: 0, velocityMs: 0, elapsedSec: 0, elevationGainM: 0 }
    this.#paused = false
  }
}
