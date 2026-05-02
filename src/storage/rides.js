import { getDb } from './db.js'

export async function saveRide(summary) {
  const { samples, startedAt, endedAt } = summary
  return getDb().add('rides', {
    routeId:          summary.routeId,
    routeName:        summary.routeName,
    startedAt,
    endedAt,
    totalDistanceM:   samples.at(-1)?.distanceM ?? 0,
    totalElapsedSec:  (endedAt - startedAt) / 1000,
    avgPowerW:        Math.round(avgOf(samples, s => s.powerW)),
    avgCadenceRpm:    Math.round(avgOf(samples.filter(s => s.cadenceRpm > 0), s => s.cadenceRpm)),
    avgHeartRateBpm:  Math.round(avgOf(samples.filter(s => s.heartRateBpm > 0), s => s.heartRateBpm)),
    samples,
    uploadStatus:     'pending',
    uploadedAt:       null,
    stravaActivityId: null,
    uploadError:      null,
  })
}

export async function listRides() {
  const all = await getDb().getAll('rides')
  return all.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
}

export async function getRide(id) {
  return getDb().get('rides', id)
}

export async function markUploaded(rideId, stravaActivityId) {
  const db   = getDb()
  const ride = await db.get('rides', rideId)
  return db.put('rides', { ...ride, uploadStatus: 'uploaded', uploadedAt: new Date(), stravaActivityId })
}

export async function markUploadFailed(rideId, errorMsg) {
  const db   = getDb()
  const ride = await db.get('rides', rideId)
  return db.put('rides', { ...ride, uploadStatus: 'failed', uploadError: errorMsg })
}

export async function deleteRide(id) {
  return getDb().delete('rides', id)
}

function avgOf(arr, fn) {
  return arr.length ? arr.reduce((s, x) => s + fn(x), 0) / arr.length : 0
}
