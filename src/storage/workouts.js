import { getDb } from './db.js'

/**
 * @typedef {{ id?: number, name: string, zwoText: string, totalDurationS: number }} WorkoutRecord
 */

export async function saveWorkout({ name, zwoText, totalDurationS }) {
  const db = getDb()
  return db.add('workouts', { name, zwoText, totalDurationS, createdAt: Date.now() })
}

export async function listWorkouts() {
  return getDb().getAll('workouts')
}

export async function deleteWorkout(id) {
  return getDb().delete('workouts', id)
}
