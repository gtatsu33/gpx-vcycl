import { describe, it, expect } from 'vitest'
import { parseCyclingPowerMeasurement } from '../../src/ble/cps.js'

describe('parseCyclingPowerMeasurement', () => {
  it('parses instantaneous power (always present, sint16)', () => {
    const buf = new ArrayBuffer(4)
    const view = new DataView(buf)
    view.setUint16(0, 0x0000, true)
    view.setInt16(2, 250, true)
    expect(parseCyclingPowerMeasurement(view).powerW).toBe(250)
  })

  it('parses negative power', () => {
    const buf = new ArrayBuffer(4)
    const view = new DataView(buf)
    view.setUint16(0, 0x0000, true)
    view.setInt16(2, -5, true)
    expect(parseCyclingPowerMeasurement(view).powerW).toBe(-5)
  })

  it('parses crank revolution data (bit 5)', () => {
    // flags = 0x0020: bit 5 = CRANK_REVOLUTION_DATA_PRESENT
    const buf = new ArrayBuffer(8)
    const view = new DataView(buf)
    view.setUint16(0, 0x0020, true)
    view.setInt16(2, 200, true)    // 200W
    view.setUint16(4, 42, true)    // cumulativeCrankRevolutions
    view.setUint16(6, 2048, true)  // lastCrankEventTime
    const result = parseCyclingPowerMeasurement(view)
    expect(result.powerW).toBe(200)
    expect(result.cumulativeCrankRevolutions).toBe(42)
    expect(result.lastCrankEventTime).toBe(2048)
  })

  it('skips wheel revolution data before crank data (bit 4 + bit 5)', () => {
    // flags = 0x0030: bit 4 (wheel) + bit 5 (crank)
    // wheel: uint32 + uint16 = 6 bytes
    // crank: uint16 + uint16 = 4 bytes
    const buf = new ArrayBuffer(16)
    const view = new DataView(buf)
    view.setUint16(0, 0x0030, true)
    view.setInt16(2, 180, true)      // power
    view.setUint32(4, 999, true)     // cumulative wheel rev
    view.setUint16(8, 512, true)     // last wheel event time
    view.setUint16(10, 77, true)     // cumulative crank rev
    view.setUint16(12, 1024, true)   // last crank event time
    const result = parseCyclingPowerMeasurement(view)
    expect(result.powerW).toBe(180)
    expect(result.cumulativeCrankRevolutions).toBe(77)
    expect(result.lastCrankEventTime).toBe(1024)
  })

  it('throws on buffer too short', () => {
    expect(() => parseCyclingPowerMeasurement(new DataView(new ArrayBuffer(3)))).toThrow()
  })
})
