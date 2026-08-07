// 実走GPXの実測パワー系列を、アプリ本体の物理エンジン(src/domain/physics.js)に
// そのまま入力し、アプリが計算する走行距離と実測(GPS)走行距離を比較する。
// gpx-vcyclアプリ本体のコードは一切変更せず、実際のモジュールを直接importして使う。
//
// 使い方: node tools/route_distance_check.mjs <GPXファイルパス> [--mass 80] [--cda 0.32] [--crr 0.005]

import { readFileSync } from 'node:fs'
import { stepVelocity, DEFAULT_PHYSICS } from '../src/domain/physics.js'

const GAP_THRESHOLD_SEC = 10   // これを超えるタイムギャップは「記録一時停止」とみなしスキップ
const GRAD_SMOOTH_WINDOW = 21  // 勾配計算前の標高平滑化ウィンドウ(サンプル数)

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180
  const dphi = (lat2 - lat1) * Math.PI / 180
  const dlmb = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function parseGpx(path) {
  const xml = readFileSync(path, 'utf-8')
  const re = /<trkpt lat="([-\d.]+)" lon="([-\d.]+)">([\s\S]*?)<\/trkpt>/g
  const pts = []
  let m
  while ((m = re.exec(xml)) !== null) {
    const [, lat, lon, body] = m
    const ele = body.match(/<ele>([-\d.]+)<\/ele>/)
    const time = body.match(/<time>([^<]+)<\/time>/)
    const power = body.match(/<power>(\d+)<\/power>/)
    if (!ele || !time) continue
    pts.push({
      lat: parseFloat(lat), lon: parseFloat(lon),
      ele: parseFloat(ele[1]),
      t: Date.parse(time[1]) / 1000,
      power: power ? parseInt(power[1], 10) : 0,
    })
  }
  return pts
}

function movingAverage(arr, window) {
  const half = Math.floor(window / 2)
  const out = new Array(arr.length)
  let sum = 0
  const q = []
  for (let i = 0; i < arr.length; i++) {
    q.push(arr[i]); sum += arr[i]
    if (q.length > window) sum -= q.shift()
    out[i] = sum / q.length
  }
  return out
}

function buildGradientProfile(pts) {
  const dist = [0]
  for (let i = 1; i < pts.length; i++) {
    dist.push(dist[i - 1] + haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon))
  }
  const eleSmooth = movingAverage(pts.map(p => p.ele), GRAD_SMOOTH_WINDOW)

  // distBins[i] -> gradPercent[i] (区間 [distBins[i], distBins[i+1]) の勾配)
  const distBins = dist
  const gradPercent = new Array(pts.length - 1)
  for (let i = 0; i < pts.length - 1; i++) {
    const dd = distBins[i + 1] - distBins[i]
    gradPercent[i] = dd > 0.1 ? 100 * (eleSmooth[i + 1] - eleSmooth[i]) / dd : 0
  }

  function gradientAt(d) {
    if (d <= distBins[0]) return gradPercent[0] ?? 0
    if (d >= distBins[distBins.length - 1]) return gradPercent[gradPercent.length - 1] ?? 0
    // 二分探索
    let lo = 0, hi = distBins.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (distBins[mid] <= d) lo = mid; else hi = mid
    }
    return gradPercent[Math.min(lo, gradPercent.length - 1)]
  }

  return { totalDistM: dist[dist.length - 1], gradientAt }
}

function simulate(pts, physics, useRealPosition) {
  const { totalDistM, gradientAt } = buildGradientProfile(pts)

  let simDist = 0
  let realDist = 0
  let v = 0
  let simulatedSec = 0
  let skippedGapSec = 0

  for (let i = 1; i < pts.length; i++) {
    const dt = pts[i].t - pts[i - 1].t
    if (!(dt > 0)) continue
    if (dt > GAP_THRESHOLD_SEC) {
      skippedGapSec += dt
      continue
    }
    realDist += haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon)
    // useRealPosition: 実測位置（実測累積距離）で勾配参照 → 位置フィードバックを切って
    //                   「その瞬間の地形」に対するモデルの瞬時誤差だけを見る
    // !useRealPosition: シミュレート上の現在位置で勾配参照 → アプリの実際の挙動を再現
    const gradientPercent = gradientAt(useRealPosition ? realDist : simDist)
    v = stepVelocity(pts[i].power, gradientPercent, v, dt, physics)
    simDist += v * dt
    simulatedSec += dt
  }

  return { simDist, realDist, totalDistM, simulatedSec, skippedGapSec }
}

function main() {
  const args = process.argv.slice(2)
  const gpxPath = args[0]
  const getOpt = (name, def) => {
    const idx = args.indexOf(`--${name}`)
    return idx >= 0 ? parseFloat(args[idx + 1]) : def
  }
  const massKg = getOpt('mass', DEFAULT_PHYSICS.massKg)
  const cdA = getOpt('cda', DEFAULT_PHYSICS.cdA)
  const crr = getOpt('crr', DEFAULT_PHYSICS.crr)
  const useRealPosition = args.includes('--real-position')

  const pts = parseGpx(gpxPath)
  console.log(`サンプル数: ${pts.length}`)
  console.log(`勾配参照モード: ${useRealPosition ? '実測位置（フィードバックなし）' : 'シミュレート位置（アプリ実挙動）'}`)

  const physics = { massKg, cdA, crr }
  const { simDist, realDist, totalDistM, simulatedSec, skippedGapSec } = simulate(pts, physics, useRealPosition)

  console.log(`使用パラメータ: mass=${massKg}kg  CdA=${cdA}m²  Crr=${crr}`)
  console.log(`シミュレーション対象時間: ${(simulatedSec / 60).toFixed(1)}分  (スキップした一時停止ギャップ: ${(skippedGapSec / 60).toFixed(1)}分)`)
  console.log()
  console.log(`実測距離(GPS, 同区間):     ${(realDist / 1000).toFixed(2)} km`)
  console.log(`アプリ計算距離(physics.js): ${(simDist / 1000).toFixed(2)} km`)
  const errPct = 100 * (simDist - realDist) / realDist
  console.log(`誤差: ${(simDist - realDist).toFixed(0)} m  (${errPct.toFixed(1)}%)`)
}

main()
