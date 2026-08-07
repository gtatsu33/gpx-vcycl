// アプリ本体の Route / RideSimulator クラスをそのまま使い、実測パワーを流し込んで
// アプリが実際に計算するであろう走行距離と実測(GPS)距離を比較する。
// route_distance_check.mjs との違い: 標高平滑化・勾配バケット計算を含め、
// 自前の近似ロジックを一切使わず src/domain/route.js の実装をそのままimportする。
//
// 使い方: node tools/route_distance_check_real.mjs <GPXファイルパス> [--mass 80] [--cda 0.32] [--crr 0.005]

import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

// route.js / gpxParser.js が使う DOMParser をグローバルに用意
const dom = new JSDOM()
globalThis.DOMParser = dom.window.DOMParser

const { Route } = await import('../src/domain/route.js')
const { RideSimulator } = await import('../src/domain/simulator.js')
const { DEFAULT_PHYSICS } = await import('../src/domain/physics.js')
const { haversineM } = await import('../src/domain/gpxParser.js')

const GAP_THRESHOLD_SEC = 10

function extractPowerAndTime(gpxText) {
  const re = /<trkpt lat="([-\d.]+)" lon="([-\d.]+)">([\s\S]*?)<\/trkpt>/g
  const pts = []
  let m
  while ((m = re.exec(gpxText)) !== null) {
    const [, lat, lon, body] = m
    const time  = body.match(/<time>([^<]+)<\/time>/)
    const power = body.match(/<power>(\d+)<\/power>/)
    if (!time) continue
    pts.push({
      lat: parseFloat(lat), lon: parseFloat(lon),
      t: Date.parse(time[1]) / 1000,
      power: power ? parseInt(power[1], 10) : 0,
    })
  }
  return pts
}

function main() {
  const args = process.argv.slice(2)
  const gpxPath = args[0]
  const getOpt = (name, def) => {
    const idx = args.indexOf(`--${name}`)
    return idx >= 0 ? parseFloat(args[idx + 1]) : def
  }
  const massKg = getOpt('mass', DEFAULT_PHYSICS.massKg)
  const cdA    = getOpt('cda',  DEFAULT_PHYSICS.cdA)
  const crr    = getOpt('crr',  DEFAULT_PHYSICS.crr)

  const gpxText = readFileSync(gpxPath, 'utf-8')
  const route   = Route.fromGpx(gpxText)
  const pts     = extractPowerAndTime(gpxText)

  console.log(`サンプル数: ${pts.length}`)
  console.log(`Route.totalDistanceM (アプリのコース総距離): ${(route.totalDistanceM / 1000).toFixed(2)} km`)
  console.log(`使用パラメータ: mass=${massKg}kg  CdA=${cdA}m²  Crr=${crr}`)

  const sim = new RideSimulator(route, { massKg, cdA, crr })

  let realDist = 0
  let simulatedSec = 0
  let skippedGapSec = 0

  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t
    if (!(dt > 0)) continue
    if (dt > GAP_THRESHOLD_SEC) { skippedGapSec += dt; continue }
    realDist += haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon)
    sim.tick(pts[i].power, dt)
    simulatedSec += dt
    if (sim.isFinished) break
  }

  const state = sim.getState()
  console.log(`シミュレーション対象時間: ${(simulatedSec / 60).toFixed(1)}分  (スキップした一時停止ギャップ: ${(skippedGapSec / 60).toFixed(1)}分)`)
  console.log()
  console.log(`実測距離(GPS, 同区間):        ${(realDist / 1000).toFixed(2)} km`)
  console.log(`アプリ計算距離(RideSimulator): ${(state.distanceM / 1000).toFixed(2)} km`)
  const errPct = 100 * (state.distanceM - realDist) / realDist
  console.log(`誤差: ${(state.distanceM - realDist).toFixed(0)} m  (${errPct.toFixed(1)}%)`)
  if (sim.isFinished) console.log('※ コース終端に到達したため打ち切り')
}

main()
