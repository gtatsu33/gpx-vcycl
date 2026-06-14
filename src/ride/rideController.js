import { RideSimulator }                    from '../domain/simulator.js'
import { calcTorque }                       from '../domain/torque.js'
import { MovingAverage }                    from '../utils/smoothing.js'
import { updatePhotoPanel, resetPhotoPanel } from '../mapillary/panel.js'

const TICK_MS            = 100   // 10 Hz
const SAMPLE_INTERVAL_MS = 1000  // 1 Hz recording
const AIR_DENSITY_KG_M3  = 1.225

export class RideController {
  #simulator
  #route
  #mapView
  #hudView
  #getLiveData
  #powerAvg
  #cadenceAvg
  #intervalId = null
  #paused     = false

  // Route metadata (for recording)
  #routeId   = null
  #routeName = ''

  // Recording
  #startedAt     = null
  #samples       = []
  #lastSampleAt  = 0
  #lastTickAt    = 0

  // Trainer control
  #ftmsClient               = null
  #trainerDifficulty        = 0.5
  #gradientUpdateIntervalMs
  #lastGradientSentAt       = 0
  #lastSentGradient         = null
  #simulationParams         = null

  // Forward gradient view
  #eleView = null

  // Mapillary
  #mapillaryLookahead = null
  #mapillaryTracker   = null

  // Callbacks
  #onFinished = null

  /**
   * @param {{
   *   route:                    import('../domain/route.js').Route,
   *   routeId?:                 number,
   *   routeName?:               string,
   *   params:                   { massKg: number, cdA: number, crr: number },
   *   mapView:                  import('../ui/map.js').MapView,
   *   hudView:                  import('../ui/hud.js').HUDView,
   *   getLiveData:              () => { powerW: number, cadenceRpm: number, heartRateBpm: number },
   *   ftmsClient?:              { isControllable: boolean, setSimulationParameters: fn, reset: fn },
   *   onFinished?:              (summary: object|null) => void,
   *   smoothingWindowSec?:      number,
   *   gradientUpdateIntervalMs?: number,
   *   mapillaryLookahead?:      import('../mapillary/lookahead.js').MapillaryLookahead,
   *   mapillaryTracker?:        import('../mapillary/lookahead.js').ActiveIndexTracker,
   * }} options
   */
  constructor({
    route, routeId = null, routeName = '',
    params, mapView, hudView, getLiveData,
    ftmsClient               = null,
    eleView                  = null,
    onFinished               = null,
    smoothingWindowSec       = 3,
    gradientUpdateIntervalMs = 1000,
    trainerDifficulty        = 0.5,
    altitudeEffectEnabled    = true,
    mapillaryLookahead       = null,
    mapillaryTracker         = null,
  }) {
    this.#simulator              = new RideSimulator(route, params)
    this.#simulator.altitudeEffectEnabled = altitudeEffectEnabled
    this.#route                  = route
    this.#mapView                = mapView
    this.#hudView                = hudView
    this.#hudView.setRoute(route)
    this.#getLiveData            = getLiveData
    this.#powerAvg               = new MovingAverage(smoothingWindowSec)
    this.#cadenceAvg             = new MovingAverage(smoothingWindowSec)
    this.#routeId                = routeId
    this.#routeName              = routeName
    this.#ftmsClient             = ftmsClient
    this.#eleView                = eleView
    this.#trainerDifficulty      = trainerDifficulty
    this.#onFinished             = onFinished
    this.#mapillaryLookahead     = mapillaryLookahead
    this.#mapillaryTracker       = mapillaryTracker
    this.#gradientUpdateIntervalMs = gradientUpdateIntervalMs

    if (ftmsClient) {
      // windResistanceCoef [kg/m] = ρ/2 * CdA
      this.#simulationParams = {
        crr:                params.crr,
        windResistanceCoef: 0.5 * AIR_DENSITY_KG_M3 * params.cdA,
      }
    }
  }

  start() {
    if (this.#intervalId) return
    const now          = Date.now()
    this.#paused       = false
    this.#startedAt    = new Date(now)
    this.#samples      = []
    this.#lastSampleAt = now - SAMPLE_INTERVAL_MS
    this.#lastTickAt   = now
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

  /**
   * ライドを停止してサマリーを返す。
   * 既に停止済みの場合は null を返す。
   * @returns {{ routeId, routeName, startedAt, endedAt, samples } | null}
   */
  stop() {
    if (!this.#startedAt) return null

    clearInterval(this.#intervalId)
    this.#intervalId = null
    this.#simulator.reset()
    this.#paused = false
    resetPhotoPanel()

    if (this.#ftmsClient?.isControllable) {
      this.#ftmsClient.reset().catch((err) => console.warn('FTMS reset failed:', err))
    }

    const summary = this.#samples.length >= 2 ? {
      routeId:   this.#routeId,
      routeName: this.#routeName,
      startedAt: this.#startedAt,
      endedAt:   new Date(),
      samples:   this.#samples,
    } : null

    this.#startedAt = null
    this.#samples   = []
    return summary
  }

  get isRunning() { return this.#intervalId !== null }
  get isPaused()  { return this.#paused }

  getCheckpoint() {
    if (!this.#startedAt) return null
    const sim = this.#simulator.getSimState()
    return {
      routeId:   this.#routeId,
      routeName: this.#routeName,
      startedAt: this.#startedAt.getTime(),
      samples:   [...this.#samples],
      simState:  { distanceM: sim.distanceM, velocityMs: sim.velocityMs, elapsedSec: sim.elapsedSec, elevationGainM: sim.elevationGainM },
    }
  }

  restoreFrom({ startedAt, samples, simState }) {
    if (this.#intervalId) return
    this.#startedAt    = new Date(startedAt)
    this.#samples      = [...samples]
    this.#lastSampleAt = Date.now()  // 復元直後の不要なサンプル記録を防ぐ
    this.#lastTickAt   = Date.now()
    this.#simulator.restoreSimState(simState)
    this.#paused       = true
    this.#intervalId   = setInterval(() => this.#tick(), TICK_MS)
  }

  #tick() {
    const now     = Date.now()
    const dtSec   = Math.min((now - this.#lastTickAt) / 1000, 0.5)  // cap at 0.5s against long pauses
    this.#lastTickAt = now

    const { powerW, cadenceRpm, heartRateBpm } = this.#getLiveData()

    this.#powerAvg.push(powerW, now)
    this.#cadenceAvg.push(cadenceRpm, now)

    const smoothPowerW  = this.#powerAvg.average
    const smoothCadence = this.#cadenceAvg.average
    const torqueNm      = calcTorque(smoothPowerW, smoothCadence)

    this.#simulator.tick(smoothPowerW, dtSec)

    const state          = this.#simulator.getState()
    const altFactor      = state.altitudeFactor ?? 1
    const effectivePowerW = smoothPowerW * altFactor
    this.#mapView.setCurrentPosition(state.currentLat, state.currentLon, state.headingDeg, state.currentGradientPercent)
    this.#mapView.setProgress(state.distanceM)
    this.#eleView?.update(state.distanceM)
    this.#hudView.update({
      velocityMs:      state.velocityMs,
      distanceM:       state.distanceM,
      totalDistanceM:  this.#route.totalDistanceM,
      elapsedSec:      state.elapsedSec,
      elevationGainM:  state.elevationGainM,
      powerW:          effectivePowerW,
      altitudeFactor:  altFactor,
      cadenceRpm:      smoothCadence,
      torqueNm,
      heartRateBpm,
      gradientPercent: state.currentGradientPercent,
      altitudeM:       this.#route.getElevationAt(state.distanceM),
    })

    // 1Hz サンプリング（1秒グリッドに補間）
    while (now - this.#lastSampleAt >= SAMPLE_INTERVAL_MS) {
      this.#lastSampleAt += SAMPLE_INTERVAL_MS
      const overshootSec = (now - this.#lastSampleAt) / 1000
      const distM = Math.max(0, state.distanceM - state.velocityMs * overshootSec)
      this.#samples.push({
        timestampMs:     this.#lastSampleAt,
        lat:             state.currentLat,
        lon:             state.currentLon,
        elevationM:      this.#route.getElevationAt(distM),
        distanceM:       distM,
        velocityMs:      state.velocityMs,
        gradientPercent: state.currentGradientPercent,
        powerW:          effectivePowerW,
        cadenceRpm:      smoothCadence,
        heartRateBpm,
      })
    }

    // Mapillary 写真パネル更新
    if (this.#mapillaryTracker && this.#mapillaryLookahead) {
      const activeIdx = this.#mapillaryTracker.update(state.distanceM)
      this.#mapillaryLookahead.tick(activeIdx) // 非同期・await不要
      const { status, image, routeBearing } = this.#mapillaryLookahead.getStateFor(activeIdx)
      updatePhotoPanel(status, image, routeBearing, state.distanceM)
    }

    // 勾配をトレーナーへ送信（1秒ごと、または±1%急変時は即送信）
    if (this.#ftmsClient?.isControllable) {
      const gradient  = state.currentGradientPercent
      const elapsed   = now - this.#lastGradientSentAt
      const bigChange = Math.abs(gradient - (this.#lastSentGradient ?? Infinity)) >= 1.0
      if (elapsed >= this.#gradientUpdateIntervalMs || bigChange) {
        this.#sendGradient(gradient * this.#trainerDifficulty)
        this.#lastGradientSentAt = now
        this.#lastSentGradient   = gradient
      }
    }

    if (this.#simulator.isFinished) {
      this.#hudView.showFinished()
      const summary = this.stop()
      this.#onFinished?.(summary)
    }
  }

  async #sendGradient(gradientPercent) {
    try {
      await this.#ftmsClient.setSimulationParameters({
        windSpeedMs:        0,
        gradientPercent,
        crr:                this.#simulationParams.crr,
        windResistanceCoef: this.#simulationParams.windResistanceCoef,
      })
    } catch (err) {
      console.error('Gradient send failed:', err)
    }
  }
}
