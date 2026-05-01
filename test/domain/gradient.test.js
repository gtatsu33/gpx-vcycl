import { describe, it, expect } from 'vitest'
import { calculateGradients } from '../../src/domain/route.js'

function pts(specs) {
  return specs.map(([distanceFromStartM, elevationM]) => ({
    lat: 0, lon: 0, elevationM, distanceFromStartM,
  }))
}

describe('calculateGradients', () => {
  it('flat route → 0 % at all points', () => {
    const result = calculateGradients(pts([[0,100],[10,100],[20,100],[30,100],[40,100]]))
    result.forEach((p) => expect(p.gradientPercent).toBeCloseTo(0, 5))
  })

  it('10 % constant climb → ~10 % at interior points', () => {
    // 1 m rise per 10 m → slope = 0.1 m/m = 10 %
    const input = pts([[0,0],[10,1],[20,2],[30,3],[40,4],[50,5],[60,6]])
    const result = calculateGradients(input, 30)
    // Interior points have ≥3 neighbours in the 30 m window
    expect(result[3].gradientPercent).toBeCloseTo(10, 1)
  })

  it('downhill → negative gradient', () => {
    const result = calculateGradients(pts([[0,100],[10,90],[20,80],[30,70],[40,60]]))
    result.forEach((p) => expect(p.gradientPercent).toBeLessThanOrEqual(0))
  })

  it('null elevation → gradientPercent = 0', () => {
    const input = [0,10,20].map((d) => ({ lat:0, lon:0, elevationM: null, distanceFromStartM: d }))
    calculateGradients(input).forEach((p) => expect(p.gradientPercent).toBe(0))
  })

  it('sparse data falls back to adjacent-point slope', () => {
    // Points 100m apart; 10m window has no regression neighbours
    // → falls back to slope between bounding points: 10m / 100m = 10 %
    const input = pts([[0,0],[100,10],[200,20],[300,30]])
    const result = calculateGradients(input, 10)
    result.forEach((p) => expect(p.gradientPercent).toBeCloseTo(10, 1))
  })

  it('wider window includes sparse neighbours and yields correct gradient', () => {
    // Same data, 300m window includes all 4 points → 10 % slope
    const input = pts([[0,0],[100,10],[200,20],[300,30]])
    const result = calculateGradients(input, 300)
    expect(result[1].gradientPercent).toBeCloseTo(10, 1)
  })

  it('preserves lat/lon/elevationM/distanceFromStartM', () => {
    const input = pts([[0,100],[50,105]])
    const [p] = calculateGradients(input)
    expect(p.lat).toBe(0)
    expect(p.lon).toBe(0)
    expect(p.elevationM).toBe(100)
    expect(p.distanceFromStartM).toBe(0)
  })
})
