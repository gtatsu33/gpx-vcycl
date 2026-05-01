// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Route } from '../../src/domain/route.js'

const flatGpx    = readFileSync(resolve('test/fixtures/flat-loop.gpx'),    'utf8')
const mountainGpx = readFileSync(resolve('test/fixtures/mountain.gpx'),   'utf8')
const noElevGpx  = readFileSync(resolve('test/fixtures/no-elevation.gpx'), 'utf8')

describe('Route.fromGpx', () => {
  it('parses without throwing', () => {
    expect(() => Route.fromGpx(mountainGpx)).not.toThrow()
  })

  it('exposes name', () => {
    expect(Route.fromGpx(mountainGpx).name).toBe('Mountain Route')
  })

  it('attaches distanceFromStartM = 0 to first point', () => {
    expect(Route.fromGpx(mountainGpx).points[0].distanceFromStartM).toBe(0)
  })
})

describe('Route.totalDistanceM', () => {
  it('mountain route ≈ 300 m (30 segments × ~10 m)', () => {
    expect(Route.fromGpx(mountainGpx).totalDistanceM).toBeCloseTo(300, -1)
  })
})

describe('Route.totalElevationGainM', () => {
  it('mountain route: 30 m gain (100→130)', () => {
    expect(Route.fromGpx(mountainGpx).totalElevationGainM).toBeCloseTo(30, 0)
  })

  it('flat route: 0 m gain', () => {
    expect(Route.fromGpx(flatGpx).totalElevationGainM).toBe(0)
  })

  it('no-elevation route: 0 m gain', () => {
    expect(Route.fromGpx(noElevGpx).totalElevationGainM).toBe(0)
  })
})

describe('Route.getElevationAt', () => {
  it('returns start elevation at d=0', () => {
    expect(Route.fromGpx(mountainGpx).getElevationAt(0)).toBeCloseTo(100, 0)
  })

  it('clamps to start at d < 0', () => {
    expect(Route.fromGpx(mountainGpx).getElevationAt(-50)).toBeCloseTo(100, 0)
  })

  it('clamps to end at d > totalDistanceM', () => {
    expect(Route.fromGpx(mountainGpx).getElevationAt(99999)).toBeCloseTo(130, 0)
  })

  it('interpolates mid-route elevation', () => {
    const route = Route.fromGpx(mountainGpx)
    const mid = route.totalDistanceM / 2
    expect(route.getElevationAt(mid)).toBeCloseTo(115, 0)
  })

  it('returns null for no-elevation route', () => {
    expect(Route.fromGpx(noElevGpx).getElevationAt(100)).toBeNull()
  })
})

describe('Route.getGradientAt', () => {
  it('mountain route returns positive gradient', () => {
    const route = Route.fromGpx(mountainGpx)
    expect(route.getGradientAt(route.totalDistanceM / 2)).toBeGreaterThan(0)
  })

  it('no-elevation route returns 0', () => {
    expect(Route.fromGpx(noElevGpx).getGradientAt(100)).toBe(0)
  })
})

describe('Route.getPositionAt', () => {
  it('returns start coordinates at d=0', () => {
    const route = Route.fromGpx(mountainGpx)
    const { lat, lon } = route.getPositionAt(0)
    expect(lat).toBeCloseTo(35.0, 3)
    expect(lon).toBeCloseTo(135.0, 3)
  })

  it('returns end coordinates at d=totalDistanceM', () => {
    const route = Route.fromGpx(mountainGpx)
    const { lat } = route.getPositionAt(route.totalDistanceM)
    expect(lat).toBeCloseTo(35.0027, 3)
  })

  it('clamps to start at d < 0', () => {
    const route = Route.fromGpx(mountainGpx)
    const { lat } = route.getPositionAt(-100)
    expect(lat).toBeCloseTo(35.0, 3)
  })
})
