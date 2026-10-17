import { getDb } from './db.js'
import { assertRideKind } from '../ride/rideKind.js'

function buildRideRecord(summary, isDraft) {
  const { samples, startedAt, endedAt } = summary
  return {
    kind:             assertRideKind(summary.kind),
    routeId:          summary.routeId,
    routeName:        summary.routeName,
    startedAt,
    endedAt,
    totalDistanceM:   samples.at(-1)?.sessionDistanceM ?? samples.at(-1)?.distanceM ?? 0,
    totalElapsedSec:  (endedAt - startedAt) / 1000,
    avgPowerW:        Math.round(avgOf(samples, s => s.powerW)),
    avgCadenceRpm:    Math.round(avgOf(samples.filter(s => s.cadenceRpm > 0), s => s.cadenceRpm)),
    avgHeartRateBpm:  Math.round(avgOf(samples.filter(s => s.heartRateBpm > 0), s => s.heartRateBpm)),
    samples,
    isDraft,
    uploadStatus:     'pending',
    uploadedAt:       null,
    stravaActivityId: null,
    uploadError:      null,
  }
}

export async function saveRide(summary) {
  return getDb().add('rides', buildRideRecord(summary, false))
}

// 走行中の定期自動保存。existingId未指定なら新規下書きレコードを作成し、
// 指定時はそのレコードを上書き更新する（1走行につき1レコードを使い回す）。
export async function saveDraftRide(summary, existingId = null) {
  const record = buildRideRecord(summary, true)
  if (existingId != null) {
    await getDb().put('rides', { ...record, id: existingId })
    return existingId
  }
  return getDb().add('rides', record)
}

// 下書きレコードを確定記録に更新する（アップロード状態は未送信にリセット）。
export async function finalizeDraftRide(id, summary) {
  const record = buildRideRecord(summary, false)
  await getDb().put('rides', { ...record, id })
  return id
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
