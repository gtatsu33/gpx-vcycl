import { getSupabaseClient } from '../supabase/client.js'

// GPXと同じバケットを共用する（db.v4.md参照。ファイル種別は拡張子で区別）
const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET ?? 'gpx_routes'

function client() {
  return getSupabaseClient()
}

/**
 * @returns {Promise<Array<{name: string, id: string, updated_at: string}>>}
 */
export async function listRemoteZwoFiles() {
  const { data, error } = await client().storage.from(BUCKET).list('', {
    limit: 200,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (error) throw new Error(error.message)
  return (data ?? []).filter((f) => f.name.toLowerCase().endsWith('.zwo'))
}

/**
 * workout_files テーブルの表示名・総時間を file_key をキーに取得する。
 * db.v4.md「読み取りフロー（gpx-vcycl、ワークアウト）」参照。
 * @returns {Promise<Map<string, {displayName: string, durationS: number|null}>>}
 */
export async function fetchWorkoutFilesMeta() {
  const { data, error } = await client()
    .from('workout_files')
    .select('file_key, display_name, duration_s')
  if (error) throw new Error(error.message)

  const map = new Map()
  for (const row of data ?? []) {
    map.set(row.file_key, {
      displayName: row.display_name,
      durationS:   row.duration_s,
    })
  }
  return map
}

/**
 * @param {string} fileName
 * @returns {Promise<string>} ZWO(XML) text content
 */
export async function downloadRemoteZwo(fileName) {
  const { data, error } = await client().storage.from(BUCKET).download(fileName)
  if (error) throw new Error(error.message)
  return data.text()
}
