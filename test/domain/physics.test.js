import { describe, it, expect } from 'vitest'
import { stepVelocity } from '../../src/domain/physics.js'

const PARAMS = { massKg: 80, cdA: 0.32, crr: 0.005 }
const DT     = 0.1   // s per tick
const TICKS  = 3000  // 300 s — long enough for all scenarios to converge

function converge(powerW, gradientPercent, v0 = 0) {
  let v = v0
  for (let i = 0; i < TICKS; i++) v = stepVelocity(powerW, gradientPercent, v, DT, PARAMS)
  return v
}

describe('stepVelocity', () => {
  it('flat 200 W → terminal velocity 32–36 km/h', () => {
    const kmh = converge(200, 0) * 3.6
    expect(kmh).toBeGreaterThan(32)
    expect(kmh).toBeLessThan(36)
  })

  it('5 % gradient 200 W → slower than flat', () => {
    const vFlat = converge(200,  0)
    const vHill = converge(200,  5)
    expect(vHill).toBeLessThan(vFlat)
    expect(vHill * 3.6).toBeGreaterThan(5)  // still moving, not stalled
  })

  it('0 W flat from 9 m/s → decelerates', () => {
    const vFinal = converge(0, 0, 9.0)
    expect(vFinal).toBeLessThan(9.0)
    expect(vFinal).toBeGreaterThanOrEqual(0)
  })

  it('−5 % gradient 0 W from rest → accelerates (gravity > resistance)', () => {
    const v = converge(0, -5, 0)
    expect(v).toBeGreaterThan(0)
  })

  it('velocity never goes negative regardless of steep uphill + 0 W', () => {
    let v = 5  // m/s
    for (let i = 0; i < 200; i++) v = stepVelocity(0, 20, v, DT, PARAMS)
    expect(v).toBeGreaterThanOrEqual(0)
  })

  it('more power → higher terminal velocity on same gradient', () => {
    const v100 = converge(100, 0)
    const v300 = converge(300, 0)
    expect(v300).toBeGreaterThan(v100)
  })

  it('heavier rider → lower terminal velocity at same power', () => {
    const vLight = converge(200, 5)
    const vHeavy = stepVelocity  // just use inline
    let v = 0
    const heavyParams = { massKg: 100, cdA: 0.32, crr: 0.005 }
    for (let i = 0; i < TICKS; i++) v = stepVelocity(200, 5, v, DT, heavyParams)
    expect(v).toBeLessThan(vLight)
  })
})
