// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseGpx, haversineM } from '../../src/domain/gpxParser.js'

const flatGpx    = readFileSync(resolve('test/fixtures/flat-loop.gpx'),    'utf8')
const mountainGpx = readFileSync(resolve('test/fixtures/mountain.gpx'),   'utf8')
const noElevGpx  = readFileSync(resolve('test/fixtures/no-elevation.gpx'), 'utf8')

describe('haversineM', () => {
  it('same point → 0 m', () => {
    expect(haversineM(35, 135, 35, 135)).toBe(0)
  })

  it('1 degree latitude ≈ 111 194 m', () => {
    expect(haversineM(35, 135, 36, 135)).toBeCloseTo(111194, -2)
  })

  it('symmetrical', () => {
    expect(haversineM(35, 135, 36, 136)).toBeCloseTo(haversineM(36, 136, 35, 135), 6)
  })
})

describe('parseGpx', () => {
  it('parses route name', () => {
    expect(parseGpx(flatGpx).name).toBe('Flat Loop')
  })

  it('defaults name to ルート when absent', () => {
    const gpx = `<gpx><trk><trkseg>
      <trkpt lat="35.0" lon="135.0"/><trkpt lat="35.001" lon="135.0"/>
    </trkseg></trk></gpx>`
    expect(parseGpx(gpx).name).toBe('ルート')
  })

  it('parses lat/lon', () => {
    const { rawPoints } = parseGpx(flatGpx)
    expect(rawPoints[0].lat).toBeCloseTo(35.0, 4)
    expect(rawPoints[0].lon).toBeCloseTo(135.0, 4)
  })

  it('parses elevation', () => {
    const { rawPoints } = parseGpx(flatGpx)
    expect(rawPoints[0].elevationM).toBe(50)
  })

  it('returns null elevation when <ele> is absent', () => {
    const { rawPoints } = parseGpx(noElevGpx)
    rawPoints.forEach((p) => expect(p.elevationM).toBeNull())
  })

  it('deduplicates consecutive identical lat/lon', () => {
    const gpx = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>
      <trkpt lat="35.000000" lon="135.000000"><ele>100</ele></trkpt>
      <trkpt lat="35.000000" lon="135.000000"><ele>100</ele></trkpt>
      <trkpt lat="35.001000" lon="135.000000"><ele>100</ele></trkpt>
    </trkseg></trk></gpx>`
    expect(parseGpx(gpx).rawPoints.length).toBe(2)
  })

  it('returns all 31 mountain points', () => {
    expect(parseGpx(mountainGpx).rawPoints.length).toBe(31)
  })

  it('throws on XML parse error', () => {
    expect(() => parseGpx('<not valid xml')).toThrow(/GPX parse error/)
  })

  it('throws when fewer than 2 valid track points', () => {
    const gpx = `<gpx><trk><trkseg>
      <trkpt lat="35.0" lon="135.0"><ele>100</ele></trkpt>
    </trkseg></trk></gpx>`
    expect(() => parseGpx(gpx)).toThrow(/有効なトラックポイントが不足/)
  })
})
