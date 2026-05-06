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
  const res = await fetch('/.netlify/functions/strava-exchange', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ code }),
  })
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`)
  const data   = await res.json()
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

/** 有効なアクセストークンを返す（期限切れなら自動リフレッシュ） */
export async function getValidAccessToken() {
  const db     = getDb()
  const tokens = await db.get('settings', 'stravaTokens')
  if (!tokens) throw new Error('Strava not connected')

  if (tokens.expiresAt > Date.now() / 1000 + 60) return tokens.accessToken

  const res = await fetch('/.netlify/functions/strava-refresh', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ refresh_token: tokens.refreshToken }),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
  const data      = await res.json()
  const newTokens = { ...tokens, accessToken: data.access_token, expiresAt: data.expires_at }
  await db.put('settings', newTokens, 'stravaTokens')
  return newTokens.accessToken
}

export async function getConnectionInfo() {
  const tokens = await getDb().get('settings', 'stravaTokens')
  if (!tokens) return null
  return { athleteName: tokens.athleteName, athleteId: tokens.athleteId }
}

export async function disconnect() {
  await getDb().delete('settings', 'stravaTokens')
}
