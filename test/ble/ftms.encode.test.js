import { describe, it, expect } from 'vitest'
import { encodeSimulationParams } from '../../src/ble/ftms.js'

describe('encodeSimulationParams', () => {
  it('gradient 0 %, crr 0.005, windRes 0.51 → expected 7 bytes', () => {
    const bytes = encodeSimulationParams({
      windSpeedMs: 0, gradientPercent: 0, crr: 0.005, windResistanceCoef: 0.51,
    })
    // opcode=0x11, wind=[00,00], grad=[00,00], crr=50=0x32, cwa=51=0x33
    expect([...bytes]).toEqual([0x11, 0x00, 0x00, 0x00, 0x00, 0x32, 0x33])
  })

  it('gradient 5 % → sint16 LE 500 = [0xF4, 0x01]', () => {
    const bytes = encodeSimulationParams({
      windSpeedMs: 0, gradientPercent: 5, crr: 0.005, windResistanceCoef: 0.51,
    })
    expect([...bytes]).toEqual([0x11, 0x00, 0x00, 0xF4, 0x01, 0x32, 0x33])
  })

  it('gradient -3.5 % → sint16 LE -350 = [0xA2, 0xFE]', () => {
    const bytes = encodeSimulationParams({
      windSpeedMs: 0, gradientPercent: -3.5, crr: 0.005, windResistanceCoef: 0.51,
    })
    expect([...bytes]).toEqual([0x11, 0x00, 0x00, 0xA2, 0xFE, 0x32, 0x33])
  })

  it('gradient 300 % is clipped to 25 %', () => {
    const over = encodeSimulationParams({
      windSpeedMs: 0, gradientPercent: 300, crr: 0.005, windResistanceCoef: 0.51,
    })
    const at25 = encodeSimulationParams({
      windSpeedMs: 0, gradientPercent: 25, crr: 0.005, windResistanceCoef: 0.51,
    })
    expect([...over]).toEqual([...at25])
  })

  it('gradient -300 % is clipped to -25 %', () => {
    const over = encodeSimulationParams({
      windSpeedMs: 0, gradientPercent: -300, crr: 0.005, windResistanceCoef: 0.51,
    })
    const at25 = encodeSimulationParams({
      windSpeedMs: 0, gradientPercent: -25, crr: 0.005, windResistanceCoef: 0.51,
    })
    expect([...over]).toEqual([...at25])
  })

  it('windSpeed -2.5 m/s → sint16 LE -2500 = [0x3C, 0xF6]', () => {
    const bytes = encodeSimulationParams({
      windSpeedMs: -2.5, gradientPercent: 0, crr: 0.005, windResistanceCoef: 0.51,
    })
    expect(bytes[1]).toBe(0x3C)
    expect(bytes[2]).toBe(0xF6)
  })

  it('crr 0 → byte 5 = 0', () => {
    const bytes = encodeSimulationParams({
      windSpeedMs: 0, gradientPercent: 0, crr: 0, windResistanceCoef: 0,
    })
    expect(bytes[5]).toBe(0)
    expect(bytes[6]).toBe(0)
  })

  it('opcode is always 0x11', () => {
    const bytes = encodeSimulationParams({
      windSpeedMs: 10, gradientPercent: 15, crr: 0.004, windResistanceCoef: 1.0,
    })
    expect(bytes[0]).toBe(0x11)
  })
})
