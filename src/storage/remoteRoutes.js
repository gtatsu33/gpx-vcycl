import { getSupabaseClient } from '../supabase/client.js'

const BUCKET = import.meta.env.VITE_SUPABASE_BUCKET ?? 'gpx_routes'

function client() {
  return getSupabaseClient()
}

/**
 * @returns {Promise<Array<{name: string, id: string, updated_at: string}>>}
 */
export async function listRemoteGpxFiles() {
  const { data, error } = await client().storage.from(BUCKET).list('', {
    limit: 200,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (error) throw new Error(error.message)
  return (data ?? []).filter((f) => f.name.toLowerCase().endsWith('.gpx'))
}

/**
 * route_files テーブルの表示名・距離・獲得標高を file_key をキーに取得する。
 * db.v4.md「読み取りフロー（gpx-vcycl）」参照。
 * @returns {Promise<Map<string, {displayName: string, distanceM: number|null, elevationGainM: number|null}>>}
 */
export async function fetchRouteFilesMeta() {
  const { data, error } = await client()
    .from('route_files')
    .select('file_key, display_name, distance_m, elevation_gain_m')
  if (error) throw new Error(error.message)

  const map = new Map()
  for (const row of data ?? []) {
    map.set(row.file_key, {
      displayName:   row.display_name,
      distanceM:     row.distance_m,
      elevationGainM: row.elevation_gain_m,
    })
  }
  return map
}

/**
 * @param {string} fileName
 * @returns {Promise<string>} GPX text content
 */
export async function downloadRemoteGpx(fileName) {
  const { data, error } = await client().storage.from(BUCKET).download(fileName)
  if (error) throw new Error(error.message)
  return data.text()
}
