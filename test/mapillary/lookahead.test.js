import { describe, it, expect } from 'vitest'
import { ActiveIndexTracker } from '../../src/mapillary/lookahead.js'

function makePoints(n, stepM = 50) {
  return Array.from({ length: n }, (_, i) => ({ distanceFromStartM: i * stepM }))
}

describe('ActiveIndexTracker.update', () => {
  it('starts at index 0', () => {
    const t = new ActiveIndexTracker(makePoints(10))
    expect(t.update(0)).toBe(0)
  })

  it('advances monotonically as distance increases', () => {
    const t = new ActiveIndexTracker(makePoints(10))
    t.update(0)
    const idx = t.update(120) // past point[2] (100m) minus 25m trigger
    expect(idx).toBeGreaterThan(0)
  })

  it('does not move backward on a smaller distance', () => {
    const t = new ActiveIndexTracker(makePoints(10))
    t.update(300)
    const idx = t.update(0)
    expect(idx).toBeGreaterThan(0)
  })
})

describe('ActiveIndexTracker.seekTo', () => {
  it('jumps forward to the index matching a large distance', () => {
    const t = new ActiveIndexTracker(makePoints(20, 50))
    const idx = t.seekTo(500)
    expect(idx).toBeGreaterThan(0)
  })

  it('can jump backward, unlike update()', () => {
    const t = new ActiveIndexTracker(makePoints(20, 50))
    t.seekTo(900)
    const idx = t.seekTo(0)
    expect(idx).toBe(0)
  })

  it('matches update() result for the same forward distance', () => {
    const points = makePoints(20, 50)
    const a = new ActiveIndexTracker(points)
    const b = new ActiveIndexTracker(points)
    expect(a.seekTo(400)).toBe(b.update(400))
  })
})
