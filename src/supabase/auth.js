import { getSupabaseClient } from './client.js'

/** 招待制ログイン（Supabase Auth マジックリンク）。サインアップ機能はない。 */
export async function sendMagicLink(email) {
  const { error } = await getSupabaseClient().auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  })
  if (error) return { ok: false, error: error.message ?? String(error) }
  return { ok: true }
}

export async function getSession() {
  const { data } = await getSupabaseClient().auth.getSession()
  return data.session
}

/** @returns {() => void} unsubscribe */
export function onAuthStateChange(callback) {
  const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => callback(session))
  return () => data.subscription.unsubscribe()
}

export async function signOut() {
  await getSupabaseClient().auth.signOut()
}
