import { MovingAverage } from '../utils/smoothing.js'

const TICK_MS              = 100
const SAMPLE_INTERVAL_MS   = 1000
const ERG_UPDATE_MS        = 1000
const ERG_THRESHOLD_W      = 5    // これ以上変化したら即送信
const AUTO_PAUSE_ZERO_CNT  = 10   // 0W がこの回数続いたら自動一時停止
const AUTO_RESUME_HIGH_CNT = 10   // ≥10W がこの回数続いたら自動再開
const AUTO_RESUME_POWER_W  = 10   // 自動再開の最低パワー閾値

/**
 * 経過時間[s]からセグメントインデックスと区間内進行率[0–1]を返す。
 * @param {Array} segments
 * @param {number} elapsedS
 */
function locateSegment(segments, elapsedS) {
  let cum = 0
  for (let i = 0; i < segments.length; i++) {
    const d = segments[i].durationS
    if (elapsedS < cum + d) {
      return { idx: i, t: d > 0 ? (elapsedS - cum) / d : 0 }
    }
    cum += d
  }
  return { idx: segments.length - 1, t: 1 }
}

/**
 * セグメントとその内部進行率から目標ワット数を計算する。
 * @param {object} seg
 * @param {number} t    区間内進行率 [0–1]
 * @param {number} ftpW FTP in watts
 * @returns {number | null}  null = FreeRide (ERG解除)
 */
function calcTargetW(seg, t, ftpW) {
  switch (seg.type) {
    case 'steady':
      return Math.round(seg.powerLowFtp * ftpW)
    case 'ramp': {
      const ftp = seg.powerLowFtp + (seg.powerHighFtp - seg.powerLowFtp) * t
      return Math.round(ftp * ftpW)
    }
    case 'intervals': {
      const cycleS  = seg.onDurationS + seg.offDurationS
      const posInCycle = (t * seg.durationS) % cycleS
      const isOn    = posInCycle < seg.onDurationS
      return Math.round((isOn ? seg.onPowerFtp : seg.offPowerFtp) * ftpW)
    }
    case 'free':
      return null
  }
  return null
}

export class WorkoutController {
  #segments
  #ftpW
  #ftmsClient
  #getLiveData
  #onStateUpdate
  #onFinished
  #onAutoPause
  #onAutoResume
  #powerAvg
  #cadenceAvg

  #intervalId         = null
  #paused             = false   // 手動一時停止
  #autoPaused         = false   // 自動一時停止
  #startedAt          = null
  #elapsedMs          = 0
  #tickAt             = 0
  #samples            = []
  #lastSampleAt       = 0
  #lastErgSentAt      = 0
  #lastSentPowerW     = null
  #ergActive          = false   // FreeRide中はfalse
  #zeroPowerCount     = 0       // 連続0Wカウント（自動一時停止用）
  #highPowerCount     = 0       // 連続≥10Wカウント（自動再開用）
  #manualPauseSawZero = false   // 手動停止中に一度0Wを見たか（手動自動再開の条件）

  /**
   * @param {{
   *   segments:      Array,
   *   ftpW:          number,
   *   getLiveData:   () => { powerW: number, cadenceRpm: number, heartRateBpm: number },
   *   ftmsClient?:   { isConnected: boolean, isControllable: boolean, setTargetPower: fn, reset: fn },
   *   onStateUpdate: (state: object) => void,
   *   onFinished?:   (summary: object|null) => void,
   *   onAutoPause?:  () => void,
   *   onAutoResume?: () => void,
   *   smoothingWindowSec?: number,
   * }}
   */
  constructor({
    segments, ftpW, getLiveData,
    ftmsClient         = null,
    onStateUpdate      = null,
    onFinished         = null,
    onAutoPause        = null,
    onAutoResume       = null,
    smoothingWindowSec = 3,
  }) {
    this.#segments      = segments
    this.#ftpW          = ftpW
    this.#ftmsClient    = ftmsClient
    this.#getLiveData   = getLiveData
    this.#onStateUpdate = onStateUpdate
    this.#onFinished    = onFinished
    this.#onAutoPause   = onAutoPause
    this.#onAutoResume  = onAutoResume
    this.#powerAvg      = new MovingAverage(smoothingWindowSec)
    this.#cadenceAvg    = new MovingAverage(smoothingWindowSec)
  }

  get isRunning()    { return this.#intervalId !== null }
  get isPaused()     { return this.#paused }
  get isAutoPaused() { return this.#autoPaused }

  get totalDurationS() {
    return this.#segments.reduce((s, seg) => s + seg.durationS, 0)
  }

  start() {
    if (this.#intervalId) return
    this.#paused      = false
    this.#startedAt   = new Date()
    this.#elapsedMs   = 0
    this.#samples     = []
    this.#lastSampleAt = 0
    this.#tickAt      = Date.now()
    // ルートライドの Simulation Parameters など前のセッションの状態を確実にクリアする
    this.#ergPrepare()
    this.#intervalId  = setInterval(() => this.#tick(), TICK_MS)
  }

  pause() {
    if (this.#paused) return
    this.#paused             = true
    this.#manualPauseSawZero = false
    this.#highPowerCount     = 0
    this.#resetErg()
  }

  resume() {
    if (!this.#paused) return
    this.#paused             = false
    this.#manualPauseSawZero = false
    this.#zeroPowerCount     = 0
    this.#highPowerCount     = 0
    // RESET 後に制御権を再取得してから ERG を再開する
    this.#ergPrepare()
    this.#tickAt = Date.now()
  }

  resumeFromAutoPause() {
    if (!this.#autoPaused) return
    this.#autoPaused     = false
    this.#zeroPowerCount = 0
    this.#highPowerCount = 0
    this.#tickAt         = Date.now()
    this.#onAutoResume?.()
  }

  stop() {
    if (!this.#startedAt) return null
    clearInterval(this.#intervalId)
    this.#intervalId = null
    this.#paused     = false
    this.#resetErg()

    const summary = this.#samples.length >= 2 ? {
      startedAt: this.#startedAt,
      endedAt:   new Date(),
      samples:   this.#samples,
    } : null

    this.#startedAt = null
    this.#samples   = []
    return summary
  }

  #tick() {
    const now = Date.now()
    const dtMs = now - this.#tickAt
    this.#tickAt = now

    const effectivePaused = this.#paused || this.#autoPaused
    if (!effectivePaused) this.#elapsedMs += dtMs

    const elapsedS = this.#elapsedMs / 1000
    const totalS   = this.totalDurationS

    const { powerW: rawPowerW, cadenceRpm, heartRateBpm } = this.#getLiveData()
    this.#powerAvg.push(rawPowerW, now)
    this.#cadenceAvg.push(cadenceRpm, now)

    const smoothPowerW  = this.#powerAvg.average
    const smoothCadence = this.#cadenceAvg.average

    // パワーカウンタ更新（生値で判定）
    this.#updatePowerCounters(rawPowerW)

    // 自動一時停止・自動再開の判定
    this.#checkAutoPause()

    const { idx, t } = locateSegment(this.#segments, elapsedS)
    const seg         = this.#segments[idx]
    const targetPowerW = calcTargetW(seg, t, this.#ftpW)

    // ERG制御（有効に動いているときのみ）
    if (!effectivePaused && this.#ftmsClient?.isControllable) {
      this.#updateErg(targetPowerW, now)
    }

    // 状態コールバック (10Hz)
    this.#onStateUpdate?.({
      elapsedS,
      totalS,
      segmentIdx:  idx,
      segment:     seg,
      targetPowerW,
      powerW:      smoothPowerW,
      cadenceRpm:  smoothCadence,
      heartRateBpm,
      autoPaused:  this.#autoPaused,
    })

    // 1Hzサンプリング
    if (!effectivePaused && now - this.#lastSampleAt >= SAMPLE_INTERVAL_MS) {
      this.#samples.push({
        timestampMs:  now,
        powerW:       smoothPowerW,
        cadenceRpm:   smoothCadence,
        heartRateBpm,
      })
      this.#lastSampleAt = now
    }

    // 終了判定
    if (!effectivePaused && elapsedS >= totalS) {
      const summary = this.stop()
      this.#onFinished?.(summary)
    }
  }

  #updatePowerCounters(rawPowerW) {
    if (rawPowerW === 0) {
      this.#zeroPowerCount = Math.min(this.#zeroPowerCount + 1, AUTO_PAUSE_ZERO_CNT + 1)
      this.#highPowerCount = 0
      // 手動一時停止中: 0Wを確認したフラグを立てる
      if (this.#paused && !this.#autoPaused) {
        this.#manualPauseSawZero = true
      }
    } else if (rawPowerW >= AUTO_RESUME_POWER_W) {
      this.#zeroPowerCount = 0
      this.#highPowerCount = Math.min(this.#highPowerCount + 1, AUTO_RESUME_HIGH_CNT + 1)
    } else {
      // 1–9W: 端境値はリセット
      this.#zeroPowerCount = 0
      this.#highPowerCount = 0
    }
  }

  #checkAutoPause() {
    if (!this.#paused) {
      if (!this.#autoPaused) {
        // 自動一時停止の条件: BLE切断 または 0W連続
        const bleDisconnected = this.#ftmsClient !== null && !this.#ftmsClient.isConnected
        if (bleDisconnected || this.#zeroPowerCount >= AUTO_PAUSE_ZERO_CNT) {
          this.#autoPaused     = true
          this.#zeroPowerCount = 0
          this.#highPowerCount = 0
          this.#resetErg()
          this.#onAutoPause?.()
        }
      } else {
        // 自動一時停止中: ≥10W連続で自動再開
        if (this.#highPowerCount >= AUTO_RESUME_HIGH_CNT) {
          this.#autoPaused     = false
          this.#zeroPowerCount = 0
          this.#highPowerCount = 0
          this.#tickAt         = Date.now()
          this.#onAutoResume?.()
        }
      }
    } else if (!this.#autoPaused) {
      // 手動一時停止中: 0Wを一度見た後に≥10W連続で自動再開
      if (this.#manualPauseSawZero && this.#highPowerCount >= AUTO_RESUME_HIGH_CNT) {
        this.#paused             = false
        this.#manualPauseSawZero = false
        this.#zeroPowerCount     = 0
        this.#highPowerCount     = 0
        this.#tickAt             = Date.now()
        this.#onAutoResume?.()
      }
    }
  }

  #updateErg(targetPowerW, now) {
    if (targetPowerW === null) {
      // FreeRide: ERG解除
      if (this.#ergActive) {
        this.#resetErg()
      }
      return
    }

    const elapsed   = now - this.#lastErgSentAt
    const bigChange = this.#lastSentPowerW === null
      || Math.abs(targetPowerW - this.#lastSentPowerW) >= ERG_THRESHOLD_W
    if (elapsed >= ERG_UPDATE_MS || bigChange) {
      this.#ergActive      = true
      this.#lastSentPowerW = targetPowerW
      this.#lastErgSentAt  = now
      this.#ftmsClient.setTargetPower(targetPowerW).catch((err) => {
        console.warn('ERG setTargetPower failed:', err)
      })
    }
  }

  #resetErg() {
    this.#ergActive      = false
    this.#lastSentPowerW = null
    this.#lastErgSentAt  = 0
    this.#ftmsClient?.reset().catch((err) => console.warn('ERG reset failed:', err))
  }

  // reset() の後、制御権を再取得してから ERG が使えるようにする。
  // Simulation Parameters などの残留状態もクリアされる。
  #ergPrepare() {
    if (!this.#ftmsClient?.isControllable) return
    this.#ergActive      = false
    this.#lastSentPowerW = null
    this.#lastErgSentAt  = 0
    this.#ftmsClient.reset()
      .then(() => this.#ftmsClient.requestControl())
      .catch((err) => console.warn('ERG prepare failed:', err))
  }
}
