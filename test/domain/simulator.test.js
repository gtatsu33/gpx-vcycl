// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Route } from '../../src/domain/route.js'
import { RideSimulator } from '../../src/domain/simulator.js'

const mountainGpx = readFileSync(resolve('test/fixtures/mountain.gpx'), 'utf8')
const PARAMS = { massKg: 80, cdA: 0.32, crr: 0.005 }

function makeSimulator() {
  return new RideSimulator(Route.fromGpx(mountainGpx), PARAMS)
}

describe('RideSimulator initial state', () => {
  it('starts at distanceM = 0', () => {
    expect(makeSimulator().getState().distanceM).toBe(0)
  })

  it('starts at velocityMs = 0', () => {
    expect(makeSimulator().getState().velocityMs).toBe(0)
  })

  it('isFinished = false at start', () => {
    expect(makeSimulator().isFinished).toBe(false)
  })
})

describe('RideSimulator.tick', () => {
  it('advances distanceM with power', () => {
    const sim = makeSimulator()
    for (let i = 0; i < 100; i++) sim.tick(200, 0.1)  // 10 s
    expect(sim.getState().distanceM).toBeGreaterThan(0)
  })

  it('accumulates elapsedSec', () => {
    const sim = makeSimulator()
    sim.tick(200, 1.0)
    sim.tick(200, 0.5)
    expect(sim.getState().elapsedSec).toBeCloseTo(1.5, 5)
  })

  it('distanceM clamps at totalDistanceM', () => {
    const route = Route.fromGpx(mountainGpx)
    const sim   = new RideSimulator(route, PARAMS)
    for (let i = 0; i < 500; i++) sim.tick(10000, 1.0)
    expect(sim.getState().distanceM).toBeLessThanOrEqual(route.totalDistanceM)
  })

  it('elevationGainM accumulates on uphill', () => {
    const sim = makeSimulator()
    for (let i = 0; i < 500; i++) sim.tick(200, 0.1)
    expect(sim.getState().elevationGainM).toBeGreaterThan(0)
  })
})

describe('RideSimulator.pause / resume', () => {
  it('paused tick does not advance distanceM', () => {
    const sim = makeSimulator()
    sim.tick(200, 1.0)
    const distBefore = sim.getState().distanceM
    sim.pause()
    sim.tick(200, 1.0)
    expect(sim.getState().distanceM).toBe(distBefore)
  })

  it('paused tick does not accumulate elapsedSec', () => {
    const sim = makeSimulator()
    sim.tick(200, 1.0)
    sim.pause()
    sim.tick(200, 5.0)
    expect(sim.getState().elapsedSec).toBeCloseTo(1.0, 5)
  })

  it('resume continues advancing after pause', () => {
    const sim = makeSimulator()
    sim.tick(200, 1.0)
    sim.pause()
    const distAfterPause = sim.getState().distanceM
    sim.resume()
    sim.tick(200, 1.0)
    expect(sim.getState().distanceM).toBeGreaterThan(distAfterPause)
  })
})

describe('RideSimulator.reset', () => {
  it('reset returns all state to zero', () => {
    const sim = makeSimulator()
    for (let i = 0; i < 100; i++) sim.tick(200, 0.1)
    sim.reset()
    const s = sim.getState()
    expect(s.distanceM).toBe(0)
    expect(s.velocityMs).toBe(0)
    expect(s.elapsedSec).toBe(0)
    expect(s.elevationGainM).toBe(0)
  })

  it('can tick again after reset', () => {
    const sim = makeSimulator()
    for (let i = 0; i < 100; i++) sim.tick(200, 0.1)
    sim.reset()
    sim.tick(200, 1.0)
    expect(sim.getState().distanceM).toBeGreaterThan(0)
  })
})

describe('RideSimulator.isFinished', () => {
  it('becomes true when route end is reached', () => {
    const route = Route.fromGpx(mountainGpx)
    const sim   = new RideSimulator(route, PARAMS)
    for (let i = 0; i < 500; i++) sim.tick(10000, 1.0)
    expect(sim.isFinished).toBe(true)
  })

  it('tick is no-op after finish', () => {
    const route = Route.fromGpx(mountainGpx)
    const sim   = new RideSimulator(route, PARAMS)
    for (let i = 0; i < 500; i++) sim.tick(10000, 1.0)
    const distAtFinish = sim.getState().distanceM
    sim.tick(10000, 1.0)
    expect(sim.getState().distanceM).toBe(distAtFinish)
  })
})

describe('RideSimulator.getState geometry', () => {
  it('returns valid lat/lon at start', () => {
    const s = makeSimulator().getState()
    expect(s.currentLat).toBeCloseTo(35.0, 3)
    expect(s.currentLon).toBeCloseTo(135.0, 3)
  })

  it('returns a headingDeg number', () => {
    const s = makeSimulator().getState()
    expect(typeof s.headingDeg).toBe('number')
  })
})
