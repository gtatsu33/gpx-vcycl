import { FTMS_SERVICE_UUID, INDOOR_BIKE_DATA_UUID, IBD_FLAG } from './constants.js'

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
  if (!(flags & IBD_FLAG.MORE_DATA))                 result.speedKmh              = readUint16() * 0.01
  if (flags & IBD_FLAG.AVERAGE_SPEED_PRESENT)        result.averageSpeedKmh       = readUint16() * 0.01
  if (flags & IBD_FLAG.INSTANTANEOUS_CADENCE_PRESENT) result.cadenceRpm           = readUint16() * 0.5
  if (flags & IBD_FLAG.AVERAGE_CADENCE_PRESENT)      result.averageCadenceRpm     = readUint16() * 0.5
  if (flags & IBD_FLAG.TOTAL_DISTANCE_PRESENT)       result.totalDistanceM        = readUint24()
  if (flags & IBD_FLAG.RESISTANCE_LEVEL_PRESENT)     result.resistanceLevel       = readInt16()
  if (flags & IBD_FLAG.INSTANTANEOUS_POWER_PRESENT)  result.powerW                = readInt16()
  if (flags & IBD_FLAG.AVERAGE_POWER_PRESENT)        result.averagePowerW         = readInt16()
  if (flags & IBD_FLAG.EXPENDED_ENERGY_PRESENT) {
    result.totalEnergyKj     = readUint16()
    result.energyPerHourKj   = readUint16()
    result.energyPerMinuteKj = readUint8()
  }
  if (flags & IBD_FLAG.HEART_RATE_PRESENT)           result.heartRateBpm          = readUint8()
  if (flags & IBD_FLAG.METABOLIC_EQUIVALENT_PRESENT) result.metabolicEquivalent   = readUint8() * 0.1
  if (flags & IBD_FLAG.ELAPSED_TIME_PRESENT)         result.elapsedTimeS          = readUint16()
  if (flags & IBD_FLAG.REMAINING_TIME_PRESENT)       result.remainingTimeS        = readUint16()

  return result
}

export class FtmsClient {
  #device = null
  #onDataCallback = null
  #onStateCallback = null

  async connect() {
    this.#device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS_SERVICE_UUID] }],
    })

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

    this.#onStateCallback?.('connected')
  }

  async disconnect() {
    if (this.#device?.gatt.connected) {
      this.#device.gatt.disconnect()
    }
  }

  onIndoorBikeData(callback)        { this.#onDataCallback  = callback }
  onConnectionStateChange(callback) { this.#onStateCallback = callback }

  get isConnected() { return this.#device?.gatt.connected ?? false }
}
