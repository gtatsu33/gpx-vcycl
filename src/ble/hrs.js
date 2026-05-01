import { HRS_SERVICE_UUID, HEART_RATE_MEASUREMENT_UUID } from './constants.js'

/**
 * Heart Rate Measurement (0x2A37) をパースする。
 * - flags bit 0 = 0: 心拍数は uint8、1: uint16
 * - flags bit 3: Energy Expended あり
 * - flags bit 4: RR Interval あり（複数、単位 1/1024 秒）
 * @param {DataView} dataView
 */
export function parseHeartRateMeasurement(dataView) {
  if (dataView.byteLength < 2) {
    throw new Error(`HRM buffer too short: ${dataView.byteLength} bytes`)
  }

  const flags = dataView.getUint8(0)
  let offset = 1

  const result = {}

  if (flags & 0x01) {
    result.heartRateBpm = dataView.getUint16(offset, true)
    offset += 2
  } else {
    result.heartRateBpm = dataView.getUint8(offset)
    offset += 1
  }

  if (flags & 0x08) {
    result.energyExpendedKj = dataView.getUint16(offset, true)
    offset += 2
  }

  if (flags & 0x10) {
    result.rrIntervals = []
    while (offset + 1 < dataView.byteLength) {
      result.rrIntervals.push(dataView.getUint16(offset, true) / 1024)
      offset += 2
    }
  }

  return result
}

export class HrsClient {
  #device = null
  #onDataCallback = null
  #onStateCallback = null

  async connect() {
    this.#device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [HRS_SERVICE_UUID] }],
    })

    this.#device.addEventListener('gattserverdisconnected', () => {
      this.#onStateCallback?.('disconnected')
    })

    const server  = await this.#device.gatt.connect()
    const service = await server.getPrimaryService(HRS_SERVICE_UUID)
    const char    = await service.getCharacteristic(HEART_RATE_MEASUREMENT_UUID)

    await char.startNotifications()
    char.addEventListener('characteristicvaluechanged', (e) => {
      if (!this.#onDataCallback) return
      try {
        this.#onDataCallback(parseHeartRateMeasurement(e.target.value))
      } catch (err) {
        console.error('HRM parse error:', err)
      }
    })

    this.#onStateCallback?.('connected')
  }

  async disconnect() {
    if (this.#device?.gatt.connected) this.#device.gatt.disconnect()
  }

  onHeartRateData(callback)         { this.#onDataCallback  = callback }
  onConnectionStateChange(callback) { this.#onStateCallback = callback }

  get isConnected() { return this.#device?.gatt.connected ?? false }
}
