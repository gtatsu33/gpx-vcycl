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
