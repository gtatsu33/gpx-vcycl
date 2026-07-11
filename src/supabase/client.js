import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY

export function isSupabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY)
}

let _client = null
export function getSupabaseClient() {
  if (!_client) _client = createClient(SUPABASE_URL, SUPABASE_KEY)
  return _client
}
