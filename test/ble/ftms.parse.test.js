import { describe, it, expect } from 'vitest'
import { parseIndoorBikeData } from '../../src/ble/ftms.js'

describe('parseIndoorBikeData', () => {
  it('speed only (MORE_DATA=0, no other flags)', () => {
    // flags = 0x0000: MORE_DATA bit is 0 → instantaneous speed is present
    // speed raw = 2500 → 2500 * 0.01 = 25.00 km/h
    const buf = new ArrayBuffer(4)
    const view = new DataView(buf)
    view.setUint16(0, 0x0000, true)
    view.setUint16(2, 2500, true)

    const result = parseIndoorBikeData(view)
    expect(result.speedKmh).toBeCloseTo(25.0)
    expect(result.powerW).toBeUndefined()
    expect(result.cadenceRpm).toBeUndefined()
  })

  it('speed + instantaneous power (int16)', () => {
    // flags = 0x0040: bit 6 = INSTANTANEOUS_POWER_PRESENT
    // speed raw = 2000 → 20.00 km/h, power = 200 W (int16)
    const buf = new ArrayBuffer(6)
    const view = new DataView(buf)
    view.setUint16(0, 0x0040, true)
    view.setUint16(2, 2000, true)
    view.setInt16(4, 200, true)

    const result = parseIndoorBikeData(view)
    expect(result.speedKmh).toBeCloseTo(20.0)
    expect(result.powerW).toBe(200)
    expect(result.cadenceRpm).toBeUndefined()
  })

  it('speed + cadence + power in correct field order', () => {
    // flags = 0x0044: bit 2 (INSTANTANEOUS_CADENCE_PRESENT) | bit 6 (INSTANTANEOUS_POWER_PRESENT)
    // speed = 3000 → 30.00 km/h
    // cadence = 160 → 80.0 rpm (raw * 0.5)
    // power = 250 W
    const buf = new ArrayBuffer(8)
    const view = new DataView(buf)
    view.setUint16(0, 0x0044, true)
    view.setUint16(2, 3000, true)
    view.setUint16(4, 160, true)
    view.setInt16(6, 250, true)

    const result = parseIndoorBikeData(view)
    expect(result.speedKmh).toBeCloseTo(30.0)
    expect(result.cadenceRpm).toBeCloseTo(80.0)
    expect(result.powerW).toBe(250)
  })

  it('negative power (int16) is parsed correctly', () => {
    const buf = new ArrayBuffer(6)
    const view = new DataView(buf)
    view.setUint16(0, 0x0040, true)
    view.setUint16(2, 0, true)
    view.setInt16(4, -10, true)

    const result = parseIndoorBikeData(view)
    expect(result.powerW).toBe(-10)
  })

  it('throws on buffer too short to read flags', () => {
    const view = new DataView(new ArrayBuffer(1))
    expect(() => parseIndoorBikeData(view)).toThrow()
  })
})
