import { getDb } from '../storage/db.js'

const CLIENT_ID    = import.meta.env.VITE_STRAVA_CLIENT_ID
const REDIRECT_URI = import.meta.env.VITE_STRAVA_REDIRECT_URI

/** Stravaの認可画面へリダイレクトする */
export function startAuthorization() {
  const url = new URL('https://www.strava.com/oauth/authorize')
  url.searchParams.set('client_id',       CLIENT_ID)
  url.searchParams.set('redirect_uri',    REDIRECT_URI)
  url.searchParams.set('response_type',   'code')
  url.searchParams.set('scope',           'activity:write,read')
  url.searchParams.set('approval_prompt', 'auto')
  window.location.href = url.toString()
}

/** 認可コードをトークンに交換してDBに保存する（サーバー経由でSecretを秘匿） */
export async function exchangeCode(code) {
  const res = await fetch('/strava-exchange', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ code }),
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { throw new Error(`Token exchange failed: ${res.status} (non-JSON: ${text.slice(0, 120)})`) }
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${data.message ?? JSON.stringify(data)}`)
  const tokens = {
    accessToken:  data.access_token,
    refreshToken: data.refresh_token,
    expiresAt:    data.expires_at,
    athleteId:    data.athlete?.id ?? null,
    athleteName:  data.athlete ? `${data.athlete.firstname} ${data.athlete.lastname}` : '',
  }
  await getDb().put('settings', tokens, 'stravaTokens')
  return tokens
}

/** Stravaにアクセストークンのリフレッシュを問い合わせ、DBを更新する。失敗時は接続を解除して例外を投げる */
async function refreshAccessToken(tokens) {
  try {
    const res = await fetch('/strava-refresh', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refresh_token: tokens.refreshToken }),
    })
    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
    const data      = await res.json()
    const newTokens = { ...tokens, accessToken: data.access_token, expiresAt: data.expires_at }
    await getDb().put('settings', newTokens, 'stravaTokens')
    return newTokens.accessToken
  } catch (err) {
    console.warn('Strava再認証失敗、接続を解除します:', err.message)
    await disconnect()
    throw err
  }
}

/** 有効なアクセストークンを返す（期限切れなら自動リフレッシュ、失敗時は接続解除） */
export async function getValidAccessToken() {
  const tokens = await getDb().get('settings', 'stravaTokens')
  if (!tokens) throw new Error('Strava not connected')

  if (tokens.expiresAt > Date.now() / 1000 + 60) return tokens.accessToken

  return refreshAccessToken(tokens)
}

export async function getConnectionInfo() {
  const tokens = await getDb().get('settings', 'stravaTokens')
  if (!tokens) return null
  return { athleteName: tokens.athleteName, athleteId: tokens.athleteId }
}

export async function disconnect() {
  await getDb().delete('settings', 'stravaTokens')
}

/** 起動時・Settings表示時などに接続状態を検証する（expiresAtに関わらず必ずStravaへ問い合わせ、失敗なら接続解除） */
export async function verifyConnection() {
  const tokens = await getDb().get('settings', 'stravaTokens')
  if (!tokens) return false
  try {
    await refreshAccessToken(tokens)
    return true
  } catch {
    return false
  }
}
