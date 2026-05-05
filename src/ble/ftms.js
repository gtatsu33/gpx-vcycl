import {
  FTMS_SERVICE_UUID, INDOOR_BIKE_DATA_UUID, IBD_FLAG,
  FITNESS_MACHINE_CONTROL_POINT_UUID, FTMS_OPCODE, FTMS_RESULT,
} from './constants.js'

const COMMAND_TIMEOUT_MS  = 3000
const GRADIENT_CLIP_PCT   = 25      // ±25 %
const CRR_MAX             = 0.0254
const WIND_RESISTANCE_MAX = 2.55

/**
 * Indoor Bike Data (0x2AD2) をパースして物理値のオブジェクトを返す。
 * フラグに基づいてオフセットを動的に進めるため、ハードコードされたオフセットは使わない。
 * @param {DataView} dataView
 * @returns {{ speedKmh?, cadenceRpm?, powerW?, ... }}
 */
export function parseIndoorBikeData(dataView) {
  if (dataView.byteLength < 2) {
    throw new Error(`IBD buffer too short: ${dataView.byteLength} bytes`)
  }

  const flags = dataView.getUint16(0, true)
  let offset = 2

  const readUint8  = () => { const v = dataView.getUint8(offset);            offset += 1; return v }
  const readUint16 = () => { const v = dataView.getUint16(offset, true);     offset += 2; return v }
  const readInt16  = () => { const v = dataView.getInt16(offset, true);      offset += 2; return v }
  const readUint24 = () => {
    const v = dataView.getUint8(offset)
              | (dataView.getUint8(offset + 1) << 8)
              | (dataView.getUint8(offset + 2) << 16)
    offset += 3
    return v
  }

  const result = {}

  // bit 0 の意味は反転: MORE_DATA=0 のとき instantaneous speed が存在する
  if (!(flags & IBD_FLAG.MORE_DATA))                  result.speedKmh              = readUint16() * 0.01
  if (flags & IBD_FLAG.AVERAGE_SPEED_PRESENT)         result.averageSpeedKmh       = readUint16() * 0.01
  if (flags & IBD_FLAG.INSTANTANEOUS_CADENCE_PRESENT) result.cadenceRpm            = readUint16() * 0.5
  if (flags & IBD_FLAG.AVERAGE_CADENCE_PRESENT)       result.averageCadenceRpm     = readUint16() * 0.5
  if (flags & IBD_FLAG.TOTAL_DISTANCE_PRESENT)        result.totalDistanceM        = readUint24()
  if (flags & IBD_FLAG.RESISTANCE_LEVEL_PRESENT)      result.resistanceLevel       = readInt16()
  if (flags & IBD_FLAG.INSTANTANEOUS_POWER_PRESENT)   result.powerW                = readInt16()
  if (flags & IBD_FLAG.AVERAGE_POWER_PRESENT)         result.averagePowerW         = readInt16()
  if (flags & IBD_FLAG.EXPENDED_ENERGY_PRESENT) {
    result.totalEnergyKj     = readUint16()
    result.energyPerHourKj   = readUint16()
    result.energyPerMinuteKj = readUint8()
  }
  if (flags & IBD_FLAG.HEART_RATE_PRESENT)            result.heartRateBpm          = readUint8()
  if (flags & IBD_FLAG.METABOLIC_EQUIVALENT_PRESENT)  result.metabolicEquivalent   = readUint8() * 0.1
  if (flags & IBD_FLAG.ELAPSED_TIME_PRESENT)          result.elapsedTimeS          = readUint16()
  if (flags & IBD_FLAG.REMAINING_TIME_PRESENT)        result.remainingTimeS        = readUint16()

  return result
}

/**
 * Set Indoor Bike Simulation Parameters (0x11) を 7 バイトの Uint8Array にエンコードする。
 *
 * バイト構成（FTMS仕様 4.16.2.18）:
 *   byte 0   opcode   uint8                  0x11
 *   byte 1-2 wind     sint16 LE   0.001 m/s
 *   byte 3-4 gradient sint16 LE   0.01 %
 *   byte 5   crr      uint8       0.0001
 *   byte 6   windRes  uint8       0.01 kg/m
 *
 * @param {{ windSpeedMs: number, gradientPercent: number, crr: number, windResistanceCoef: number }}
 * @returns {Uint8Array}
 */
export function encodeSimulationParams({ windSpeedMs, gradientPercent, crr, windResistanceCoef }) {
  const grad    = Math.max(-GRADIENT_CLIP_PCT, Math.min(GRADIENT_CLIP_PCT, gradientPercent))
  const crrSafe = Math.max(0, Math.min(CRR_MAX, crr))
  const cwaSafe = Math.max(0, Math.min(WIND_RESISTANCE_MAX, windResistanceCoef))

  const buf  = new ArrayBuffer(7)
  const view = new DataView(buf)
  view.setUint8 (0, FTMS_OPCODE.SET_INDOOR_BIKE_SIMULATION_PARAMS)
  view.setInt16 (1, Math.round(windSpeedMs * 1000), true)   // 0.001 m/s
  view.setInt16 (3, Math.round(grad * 100), true)           // 0.01 %
  view.setUint8 (5, Math.round(crrSafe * 10000))            // 0.0001
  view.setUint8 (6, Math.round(cwaSafe * 100))              // 0.01 kg/m
  return new Uint8Array(buf)
}

/**
 * Control Point notification をパースする。
 * 正常なレスポンスパケットでなければ null を返す。
 * @param {DataView} dataView
 * @returns {{ requestOpcode: number, resultCode: number } | null}
 */
export function parseControlPointResponse(dataView) {
  if (dataView.byteLength < 3) return null
  if (dataView.getUint8(0) !== FTMS_OPCODE.RESPONSE_CODE) return null
  return {
    requestOpcode: dataView.getUint8(1),
    resultCode:    dataView.getUint8(2),
  }
}

export class FtmsClient {
  #device           = null
  #onDataCallback   = null
  #onStateCallback  = null
  #onControlLog     = null
  #controlPoint     = null
  #pendingResponse  = null  // { opcode: number, resolve: fn, reject: fn }

  get device() { return this.#device }

  async connect(nameHint = null) {
    const filters = nameHint
      ? [{ name: nameHint }, { services: [FTMS_SERVICE_UUID] }]
      : [{ services: [FTMS_SERVICE_UUID] }]
    this.#device = await navigator.bluetooth.requestDevice({ filters })
    await this.#setupGatt()
  }

  async connectToDevice(device) {
    this.#device = device
    await this.#setupGatt()
  }

  async #setupGatt() {
    this.#device.addEventListener('gattserverdisconnected', () => {
      this.#onStateCallback?.('disconnected')
    })

    const server  = await this.#device.gatt.connect()
    const service = await server.getPrimaryService(FTMS_SERVICE_UUID)
    const char    = await service.getCharacteristic(INDOOR_BIKE_DATA_UUID)

    await char.startNotifications()
    char.addEventListener('characteristicvaluechanged', (e) => {
      if (!this.#onDataCallback) return
      try {
        this.#onDataCallback(parseIndoorBikeData(e.target.value))
      } catch (err) {
        console.error('IBD parse error:', err)
      }
    })

    // Control Point setup (optional — not all trainers expose it)
    try {
      this.#controlPoint = await service.getCharacteristic(FITNESS_MACHINE_CONTROL_POINT_UUID)
      await this.#controlPoint.startNotifications()
      this.#controlPoint.addEventListener('characteristicvaluechanged', (e) => {
        this.#handleControlResponse(e.target.value)
      })
      await this.requestControl()
      this.#onControlLog?.('制御権取得成功 — 負荷制御が有効です')
    } catch (err) {
      this.#onControlLog?.(`制御ポイント利用不可: ${err.message}`)
      this.#controlPoint = null
    }

    this.#onStateCallback?.('connected')
  }

  async disconnect() {
    if (this.#device?.gatt.connected) {
      this.#device.gatt.disconnect()
    }
  }

  onIndoorBikeData(callback)        { this.#onDataCallback  = callback }
  onConnectionStateChange(callback) { this.#onStateCallback = callback }
  onControlLog(callback)            { this.#onControlLog    = callback }

  get isConnected()    { return this.#device?.gatt.connected ?? false }
  get isControllable() { return this.#controlPoint !== null && this.isConnected }

  /** Request Control (0x00) — 接続直後に呼ぶ必要がある。 */
  async requestControl() {
    await this.#sendCommand(FTMS_OPCODE.REQUEST_CONTROL)
  }

  /**
   * Set Indoor Bike Simulation Parameters (0x11).
   * @param {{ windSpeedMs?: number, gradientPercent: number, crr: number, windResistanceCoef: number }}
   */
  async setSimulationParameters({ windSpeedMs = 0, gradientPercent, crr, windResistanceCoef }) {
    if (!this.#controlPoint) throw new Error('Control Point not available')
    const encoded = encodeSimulationParams({ windSpeedMs, gradientPercent, crr, windResistanceCoef })
    // encoded[0] はオペコード。#sendCommand が再組み立てするため slice(1) を渡す
    await this.#sendCommand(FTMS_OPCODE.SET_INDOOR_BIKE_SIMULATION_PARAMS, encoded.slice(1))
  }

  /** Reset (0x01) — トレーナーをアイドル状態に戻す。 */
  async reset() {
    if (!this.#controlPoint) return
    await this.#sendCommand(FTMS_OPCODE.RESET)
  }

  /**
   * Set Target Power (0x05) — ERGモード。指定ワット数に負荷を固定する。
   * @param {number} powerW
   */
  async setTargetPower(powerW) {
    if (!this.#controlPoint) throw new Error('Control Point not available')
    const data = new Uint8Array(2)
    new DataView(data.buffer).setInt16(0, Math.max(0, Math.round(powerW)), true)
    await this.#sendCommand(FTMS_OPCODE.SET_TARGET_POWER, data)
  }

  async #sendCommand(opcode, data = new Uint8Array(0)) {
    if (!this.#controlPoint) throw new Error('Control Point not available')
    if (this.#pendingResponse) return  // 前のコマンド処理中はスキップ

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingResponse = null
        reject(new Error(`FTMS 0x${opcode.toString(16).padStart(2, '0')} timed out`))
      }, COMMAND_TIMEOUT_MS)

      this.#pendingResponse = {
        opcode,
        resolve: () => { clearTimeout(timer); resolve() },
        reject:  (e) => { clearTimeout(timer); reject(e) },
      }

      const payload = new Uint8Array([opcode, ...data])
      this.#controlPoint.writeValueWithResponse(payload).catch((err) => {
        clearTimeout(timer)
        this.#pendingResponse = null
        reject(err)
      })
    })
  }

  #handleControlResponse(dataView) {
    const parsed = parseControlPointResponse(dataView)
    if (!parsed || !this.#pendingResponse) return
    if (parsed.requestOpcode !== this.#pendingResponse.opcode) return

    const { resolve, reject } = this.#pendingResponse
    this.#pendingResponse = null

    if (parsed.resultCode === FTMS_RESULT.SUCCESS) {
      resolve()
    } else {
      const msg = `FTMS 0x${parsed.requestOpcode.toString(16).padStart(2, '0')} failed: result=0x${parsed.resultCode.toString(16).padStart(2, '0')}`
      this.#onControlLog?.(msg)
      reject(new Error(msg))
    }
  }
}
