import { openDB } from 'idb'

const DB_NAME = 'virtualCycling'
const DB_VERSION = 4

/** @type {import('idb').IDBPDatabase | null} */
let db = null

/**
 * DBを開いてスキーマを初期化する。アプリ起動時に一度だけ呼ぶ。
 * @returns {Promise<import('idb').IDBPDatabase>}
 */
export async function initDb() {
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        // routes: GPXルート
        // fields: id, name, gpxText, createdAt, distanceKm, elevationGainM
        database.createObjectStore('routes', { keyPath: 'id', autoIncrement: true })

        // rides: ライド記録
        // fields: id, routeId, startedAt, endedAt, samples
        database.createObjectStore('rides', { keyPath: 'id', autoIncrement: true })

        // settings: キーバリュー設定
        database.createObjectStore('settings')
      }
      if (oldVersion < 2) {
        database.createObjectStore('workouts', { keyPath: 'id', autoIncrement: true })
      }
      if (oldVersion < 3) {
        database.createObjectStore('mapillaryCache')
      }
      if (oldVersion < 4) {
        // routeProgress: 複数日ライド用の最終到達距離
        // key: `${routeId}:${reversed?'r':'f'}`, value: { distanceM, updatedAt }
        database.createObjectStore('routeProgress')
      }
    },
  })
  return db
}

/**
 * 初期化済みのDB接続を返す。initDb() より前に呼ぶとエラー。
 * @returns {import('idb').IDBPDatabase}
 */
export function getDb() {
  if (!db) throw new Error('DB not initialized. Call initDb() first.')
  return db
}
