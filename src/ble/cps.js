import { CPS_SERVICE_UUID, CYCLING_POWER_MEASUREMENT_UUID, CPM_FLAG } from './constants.js'
import { createCadenceCalculator } from './cadence.js'

/**
 * Cycling Power Measurement (0x2A63) をパースする。
 * Power は常に存在する (sint16)。Crank Revolution Data が含まれる場合は
 * cumulativeCrankRevolutions / lastCrankEventTime も返す。
 * @param {DataView} dataView
 */
export function parseCyclingPowerMeasurement(dataView) {
  if (dataView.byteLength < 4) {
    throw new Error(`CPM buffer too short: ${dataView.byteLength} bytes`)
  }

  const flags = dataView.getUint16(0, true)
  let offset = 2

  const readUint8  = () => { const v = dataView.getUint8(offset);          offset += 1; return v }
  const readUint16 = () => { const v = dataView.getUint16(offset, true);   offset += 2; return v }
  const readInt16  = () => { const v = dataView.getInt16(offset, true);    offset += 2; return v }
  const readUint24 = () => {
    const v = dataView.getUint8(offset)
              | (dataView.getUint8(offset + 1) << 8)
              | (dataView.getUint8(offset + 2) << 16)
    offset += 3; return v
  }
  const readUint32 = () => { const v = dataView.getUint32(offset, true);   offset += 4; return v }

  const result = {}

  result.powerW = readInt16()

  if (flags & CPM_FLAG.PEDAL_POWER_BALANCE_PRESENT)   result.pedalPowerBalancePercent  = readUint8() * 0.5
  if (flags & CPM_FLAG.ACCUMULATED_TORQUE_PRESENT)    result.accumulatedTorqueNm       = readUint16() / 32
  if (flags & CPM_FLAG.WHEEL_REVOLUTION_DATA_PRESENT) {
    result.cumulativeWheelRevolutions = readUint32()
    result.lastWheelEventTime = readUint16()
  }
  if (flags & CPM_FLAG.CRANK_REVOLUTION_DATA_PRESENT) {
    result.cumulativeCrankRevolutions = readUint16()
    result.lastCrankEventTime = readUint16()
  }
  if (flags & CPM_FLAG.EXTREME_FORCE_MAGNITUDES_PRESENT) {
    result.maxForceMagnitudeN = readInt16()
    result.minForceMagnitudeN = readInt16()
  }
  if (flags & CPM_FLAG.EXTREME_TORQUE_MAGNITUDES_PRESENT) {
    result.maxTorqueMagnitudeNm = readInt16() / 32
    result.minTorqueMagnitudeNm = readInt16() / 32
  }
  if (flags & CPM_FLAG.EXTREME_ANGLES_PRESENT) {
    const raw = readUint24()
    result.maximumAngle = raw & 0xFFF
    result.minimumAngle = (raw >> 12) & 0xFFF
  }
  if (flags & CPM_FLAG.TOP_DEAD_SPOT_ANGLE_PRESENT)    result.topDeadSpotAngle    = readUint16()
  if (flags & CPM_FLAG.BOTTOM_DEAD_SPOT_ANGLE_PRESENT) result.bottomDeadSpotAngle = readUint16()
  if (flags & CPM_FLAG.ACCUMULATED_ENERGY_PRESENT)     result.accumulatedEnergyKj = readUint16()

  return result
}

export class CpsClient {
  #device = null
  #onDataCallback = null
  #onStateCallback = null
  #cadenceCalc = createCadenceCalculator()

  get device() { return this.#device }

  async connect(nameHint = null) {
    const filters = nameHint
      ? [{ name: nameHint }, { services: [CPS_SERVICE_UUID] }]
      : [{ services: [CPS_SERVICE_UUID] }]
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
    const service = await server.getPrimaryService(CPS_SERVICE_UUID)
    const char    = await service.getCharacteristic(CYCLING_POWER_MEASUREMENT_UUID)

    await char.startNotifications()
    char.addEventListener('characteristicvaluechanged', (e) => {
      if (!this.#onDataCallback) return
      try {
        const raw = parseCyclingPowerMeasurement(e.target.value)
        const cadenceRpm = (raw.cumulativeCrankRevolutions != null)
          ? this.#cadenceCalc(raw.cumulativeCrankRevolutions, raw.lastCrankEventTime)
          : undefined
        this.#onDataCallback({
          powerW: raw.powerW,
          cadenceRpm,
          pedalPowerBalancePercent: raw.pedalPowerBalancePercent,
        })
      } catch (err) {
        console.error('CPM parse error:', err)
      }
    })

    this.#onStateCallback?.('connected')
  }

  async disconnect() {
    if (this.#device?.gatt.connected) this.#device.gatt.disconnect()
  }

  onPowerData(callback)             { this.#onDataCallback  = callback }
  onConnectionStateChange(callback) { this.#onStateCallback = callback }

  get isConnected() { return this.#device?.gatt.connected ?? false }
}
