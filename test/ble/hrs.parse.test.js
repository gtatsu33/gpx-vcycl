import { describe, it, expect } from 'vitest'
import { parseHeartRateMeasurement } from '../../src/ble/hrs.js'

describe('parseHeartRateMeasurement', () => {
  it('parses uint8 heart rate (bit 0 = 0)', () => {
    const buf = new ArrayBuffer(2)
    const view = new DataView(buf)
    view.setUint8(0, 0x00)
    view.setUint8(1, 145)
    expect(parseHeartRateMeasurement(view).heartRateBpm).toBe(145)
  })

  it('parses uint16 heart rate (bit 0 = 1)', () => {
    const buf = new ArrayBuffer(3)
    const view = new DataView(buf)
    view.setUint8(0, 0x01)
    view.setUint16(1, 300, true)
    expect(parseHeartRateMeasurement(view).heartRateBpm).toBe(300)
  })

  it('parses energy expended when bit 3 is set', () => {
    // flags = 0x08: energy expended present, uint8 heart rate
    const buf = new ArrayBuffer(4)
    const view = new DataView(buf)
    view.setUint8(0, 0x08)
    view.setUint8(1, 130)      // 130 bpm
    view.setUint16(2, 500, true) // 500 kJ
    const result = parseHeartRateMeasurement(view)
    expect(result.heartRateBpm).toBe(130)
    expect(result.energyExpendedKj).toBe(500)
  })

  it('parses RR intervals when bit 4 is set', () => {
    // flags = 0x10: RR interval present, uint8 heart rate
    // RR interval unit: 1/1024 s。512 → 0.5s
    const buf = new ArrayBuffer(4)
    const view = new DataView(buf)
    view.setUint8(0, 0x10)
    view.setUint8(1, 60)
    view.setUint16(2, 1024, true) // 1.0s RR interval
    const result = parseHeartRateMeasurement(view)
    expect(result.heartRateBpm).toBe(60)
    expect(result.rrIntervals).toHaveLength(1)
    expect(result.rrIntervals[0]).toBeCloseTo(1.0)
  })

  it('throws on buffer too short', () => {
    expect(() => parseHeartRateMeasurement(new DataView(new ArrayBuffer(1)))).toThrow()
  })
})
