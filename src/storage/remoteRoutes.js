import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY
const BUCKET        = import.meta.env.VITE_SUPABASE_BUCKET ?? 'gpx_routes'

let _client = null
function client() {
  if (!_client) _client = createClient(SUPABASE_URL, SUPABASE_KEY)
  return _client
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
 * @param {string} fileName
 * @returns {Promise<string>} GPX text content
 */
export async function downloadRemoteGpx(fileName) {
  const { data, error } = await client().storage.from(BUCKET).download(fileName)
  if (error) throw new Error(error.message)
  return data.text()
}
