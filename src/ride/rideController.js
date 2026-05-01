import { RideSimulator } from '../domain/simulator.js'
import { calcTorque }    from '../domain/torque.js'
import { MovingAverage } from '../utils/smoothing.js'

const TICK_MS = 100  // 10 Hz

export class RideController {
  #simulator
  #mapView
  #hudView
  #getLiveData
  #powerAvg
  #cadenceAvg
  #intervalId = null
  #paused = false

  /**
   * @param {{
   *   route: import('../domain/route.js').Route,
   *   params: { massKg: number, cdA: number, crr: number },
   *   mapView: import('../ui/map.js').MapView,
   *   hudView: import('../ui/hud.js').HUDView,
   *   getLiveData: () => { powerW: number, cadenceRpm: number, heartRateBpm: number },
   *   smoothingWindowSec?: number,
   * }} options
   */
  constructor({ route, params, mapView, hudView, getLiveData, smoothingWindowSec = 3 }) {
    this.#simulator   = new RideSimulator(route, params)
    this.#mapView     = mapView
    this.#hudView     = hudView
    this.#hudView.setRoute(route)
    this.#getLiveData = getLiveData
    this.#powerAvg    = new MovingAverage(smoothingWindowSec)
    this.#cadenceAvg  = new MovingAverage(smoothingWindowSec)
  }

  start() {
    if (this.#intervalId) return
    this.#paused = false
    this.#simulator.resume()
    this.#intervalId = setInterval(() => this.#tick(), TICK_MS)
  }

  pause() {
    this.#paused = true
    this.#simulator.pause()
  }

  resume() {
    this.#paused = false
    this.#simulator.resume()
  }

  stop() {
    clearInterval(this.#intervalId)
    this.#intervalId = null
    this.#simulator.reset()
    this.#paused = false
  }

  get isRunning() { return this.#intervalId !== null }
  get isPaused()  { return this.#paused }

  #tick() {
    const now = Date.now()
    const { powerW, cadenceRpm, heartRateBpm } = this.#getLiveData()

    this.#powerAvg.push(powerW, now)
    this.#cadenceAvg.push(cadenceRpm, now)

    const smoothPowerW  = this.#powerAvg.average
    const smoothCadence = this.#cadenceAvg.average
    const torqueNm      = calcTorque(smoothPowerW, smoothCadence)

    this.#simulator.tick(smoothPowerW, TICK_MS / 1000)

    const state = this.#simulator.getState()
    this.#mapView.setCurrentPosition(state.currentLat, state.currentLon, state.headingDeg)
    this.#mapView.setProgress(state.distanceM)
    this.#hudView.update({
      velocityMs:           state.velocityMs,
      distanceM:            state.distanceM,
      elapsedSec:           state.elapsedSec,
      elevationGainM:       state.elevationGainM,
      powerW:               smoothPowerW,
      cadenceRpm:           smoothCadence,
      torqueNm,
      heartRateBpm,
      gradientPercent:      state.currentGradientPercent,
    })

    if (this.#simulator.isFinished) {
      this.stop()
      this.#hudView.showFinished()
    }
  }
}
