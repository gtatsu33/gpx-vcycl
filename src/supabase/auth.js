import { getSupabaseClient } from './client.js'

/**
 * 招待制ログイン（Supabase Auth メールOTP）。サインアップ機能はない。
 * メールクライアントのリンクプリフェッチでワンタイムリンクが無効化される
 * 問題を避けるため、リンククリックではなく8桁コード手入力方式を使う
 * （verifyOtpとセットで使う。gpx-editorと同じ方針）。
 */
export async function sendMagicLink(email) {
  const { error } = await getSupabaseClient().auth.signInWithOtp({ email })
  if (error) return { ok: false, error: error.message ?? String(error) }
  return { ok: true }
}

/** メールで届いた8桁コードを検証してログインする。 */
export async function verifyOtp(email, token) {
  const { error } = await getSupabaseClient().auth.verifyOtp({ email, token, type: 'email' })
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
