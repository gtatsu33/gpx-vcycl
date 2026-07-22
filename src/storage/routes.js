import { getDb } from './db.js'
import { Route } from '../domain/route.js'

export async function saveRoute({ name, gpxText }) {
  const route = Route.fromGpx(gpxText)
  const db = getDb()
  return db.add('routes', {
    name,
    gpxText,
    totalDistanceM:      route.totalDistanceM,
    totalElevationGainM: route.totalElevationGainM,
    savedAt:             Date.now(),
  })
}

export async function getRoute(id) {
  return getDb().get('routes', id)
}

export async function listRoutes() {
  return getDb().getAll('routes')
}

export async function deleteRoute(id) {
  return getDb().delete('routes', id)
}

function progressKey(routeId, reversed) {
  return `${routeId}:${reversed ? 'r' : 'f'}`
}

/** 複数日ライド用: そのルート（順走/逆走別）の最終到達距離を取得する。 */
export async function getRouteProgress(routeId, reversed) {
  if (routeId == null) return null
  return getDb().get('routeProgress', progressKey(routeId, reversed))
}

/** ライド終了時に、次回の「開始距離」初期値として最終到達距離を保存する。 */
export async function saveRouteProgress(routeId, reversed, distanceM) {
  if (routeId == null) return
  return getDb().put('routeProgress', { distanceM, updatedAt: Date.now() }, progressKey(routeId, reversed))
}
