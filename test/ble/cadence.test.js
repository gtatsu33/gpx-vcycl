import { describe, it, expect, vi, afterEach } from 'vitest'
import { createCadenceCalculator } from '../../src/ble/cadence.js'

afterEach(() => vi.useRealTimers())

describe('createCadenceCalculator', () => {
  it('returns 0 on first call (no previous state)', () => {
    const calc = createCadenceCalculator()
    expect(calc(0, 0)).toBe(0)
  })

  it('calculates cadence correctly (1 rev / 0.5s = 120 rpm)', () => {
    const calc = createCadenceCalculator()
    calc(0, 0)
    // deltaRevolutions=1, deltaEventTime=512 (512/1024=0.5s) → 120 rpm
    expect(calc(1, 512)).toBeCloseTo(120)
  })

  it('returns previous rpm when event time unchanged (not yet stale)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const calc = createCadenceCalculator({ staleTimeoutMs: 2000 })
    calc(0, 0)
    vi.setSystemTime(100)
    calc(1, 512)             // 120 rpm, lastEventWallMs = 100
    vi.setSystemTime(1500)   // 1.4s since last event, not stale yet
    expect(calc(1, 512)).toBeCloseTo(120)
  })

  it('returns 0 after stale timeout', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const calc = createCadenceCalculator({ staleTimeoutMs: 2000 })
    calc(0, 0)
    vi.setSystemTime(100)
    calc(1, 512)             // 120 rpm, lastEventWallMs = 100
    vi.setSystemTime(2200)   // 2.1s since last event → stale
    expect(calc(1, 512)).toBe(0)
  })

  it('handles revolution counter wraparound (0xFFFF → 0)', () => {
    const calc = createCadenceCalculator()
    calc(0xFFFF, 0)
    // delta = (0 - 0xFFFF + 0x10000) & 0xFFFF = 1, time = 512 ticks → 120 rpm
    expect(calc(0, 512)).toBeCloseTo(120)
  })

  it('handles event time wraparound (0xFF00 → 0x0100)', () => {
    const calc = createCadenceCalculator()
    calc(0, 0xFF00)
    // deltaTime = (0x0100 - 0xFF00 + 0x10000) & 0xFFFF = 0x0200 = 512 ticks
    // 1 rev / 0.5s = 120 rpm
    expect(calc(1, 0x0100)).toBeCloseTo(120)
  })

  it('handles both counters wrapping simultaneously', () => {
    const calc = createCadenceCalculator()
    calc(0xFFFE, 0xFE00)
    // deltaRev = (0 - 0xFFFE + 0x10000) & 0xFFFF = 2
    // deltaTime = (0x0200 - 0xFE00 + 0x10000) & 0xFFFF = 0x0400 = 1024 ticks = 1s
    // 2 rev / 1s * 60 = 120 rpm
    expect(calc(0, 0x0200)).toBeCloseTo(120)
  })
})
