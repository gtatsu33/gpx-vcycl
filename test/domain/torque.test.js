import { describe, it, expect } from 'vitest'
import { calcTorque } from '../../src/domain/torque.js'

describe('calcTorque', () => {
  it('200 W, 90 rpm → ~21.2 N·m', () => {
    expect(calcTorque(200, 90)).toBeCloseTo(21.22, 1)
  })

  it('100 W, 80 rpm → ~11.9 N·m', () => {
    expect(calcTorque(100, 80)).toBeCloseTo(11.94, 1)
  })

  it('cadence = 0 → null', () => {
    expect(calcTorque(200, 0)).toBeNull()
  })

  it('cadence < 20 (e.g. 10) → null', () => {
    expect(calcTorque(200, 10)).toBeNull()
  })

  it('cadence exactly 20 → not null', () => {
    expect(calcTorque(200, 20)).not.toBeNull()
  })

  it('power = 0 → null', () => {
    expect(calcTorque(0, 90)).toBeNull()
  })

  it('negative power → null', () => {
    expect(calcTorque(-50, 90)).toBeNull()
  })

  it('higher cadence → lower torque at same power', () => {
    const t60  = calcTorque(200, 60)
    const t100 = calcTorque(200, 100)
    expect(t60).toBeGreaterThan(t100)
  })
})
