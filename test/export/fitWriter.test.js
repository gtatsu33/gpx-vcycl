import { describe, it, expect } from 'vitest'
import { buildFit } from '../../src/export/fitWriter.js'

const T0 = Date.UTC(2026, 4, 1, 10, 0, 0)  // 2026-05-01 10:00:00 UTC

const baseSummary = {
  routeId:   1,
  routeName: 'Test Route',
  startedAt: new Date(T0),
  endedAt:   new Date(T0 + 30 * 60 * 1000),  // +30 min
  samples: [
    { timestampMs: T0,       lat: 35.6, lon: 139.7, elevationM: 10,  distanceM: 0,  velocityMs: 0,   powerW: 200, cadenceRpm: 80, heartRateBpm: 140 },
    { timestampMs: T0 + 1000, lat: 35.6001, lon: 139.7001, elevationM: 11, distanceM: 15, velocityMs: 5, powerW: 220, cadenceRpm: 85, heartRateBpm: 145 },
    { timestampMs: T0 + 2000, lat: 35.6002, lon: 139.7002, elevationM: 12, distanceM: 30, velocityMs: 5, powerW: 210, cadenceRpm: 83, heartRateBpm: 148 },
  ],
}

describe('buildFit', () => {
  it('returns a Uint8Array', () => {
    expect(buildFit(baseSummary)).toBeInstanceOf(Uint8Array)
  })

  it('header size byte is 14', () => {
    expect(buildFit(baseSummary)[0]).toBe(14)
  })

  it('contains ".FIT" signature at bytes 8-11', () => {
    const fit = buildFit(baseSummary)
    expect(fit[8]).toBe(0x2E)   // '.'
    expect(fit[9]).toBe(0x46)   // 'F'
    expect(fit[10]).toBe(0x49)  // 'I'
    expect(fit[11]).toBe(0x54)  // 'T'
  })

  it('total length > 14 (header) + 2 (CRC)', () => {
    expect(buildFit(baseSummary).length).toBeGreaterThan(16)
  })

  it('data size in header matches actual data length', () => {
    const fit = buildFit(baseSummary)
    const dv  = new DataView(fit.buffer)
    const declaredDataSize = dv.getUint32(4, true)
    // total = 14 (header) + dataSize + 2 (CRC)
    expect(fit.length).toBe(14 + declaredDataSize + 2)
  })

  it('works with empty samples', () => {
    const fit = buildFit({ ...baseSummary, samples: [] })
    expect(fit).toBeInstanceOf(Uint8Array)
    expect(fit.length).toBeGreaterThan(16)
  })

  it('works with null elevationM', () => {
    const samples = baseSummary.samples.map(s => ({ ...s, elevationM: null }))
    expect(() => buildFit({ ...baseSummary, samples })).not.toThrow()
  })

  it('longer ride produces larger file', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      ...baseSummary.samples[0], timestampMs: T0 + i * 1000, distanceM: i * 5,
    }))
    const small = buildFit({ ...baseSummary, samples: baseSummary.samples })
    const large = buildFit({ ...baseSummary, samples: many })
    expect(large.length).toBeGreaterThan(small.length)
  })
})
