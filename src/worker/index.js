// Cloudflare Workers エントリーポイント。
// Strava OAuth の秘匿処理・オーナーモード認証のみ扱う。
// それ以外の全リクエストは wrangler.jsonc の assets.run_worker_first
// に含まれないため、静的アセット配信へ自動的にフォールバックする
// （Pages Functions の functions/ ディレクトリを置き換える実装）。

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/strava-exchange') {
      return handleStravaExchange(request, env)
    }
    if (request.method === 'POST' && url.pathname === '/strava-refresh') {
      return handleStravaRefresh(request, env)
    }
    if (request.method === 'GET' && url.pathname === '/api/auth') {
      return handleOwnerAuth(request, env)
    }
    if (request.method === 'GET' && url.pathname === '/api/streetview') {
      return handleStreetview(request, env)
    }
    return new Response('Not Found', { status: 404 })
  },
}

async function handleStravaExchange(request, env) {
  try {
    const { code } = await request.json().catch(() => ({}))
    if (!code) return jsonResponse({ error: 'Missing code' }, 400)

    const res  = await fetch('https://www.strava.com/oauth/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        client_id:     env.STRAVA_CLIENT_ID,
        client_secret: env.STRAVA_CLIENT_SECRET,
        code,
        grant_type:    'authorization_code',
      }),
    })
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = { error: 'non-json from Strava', raw: text.slice(0, 200) } }
    return jsonResponse(data, res.status)
  } catch (err) {
    return jsonResponse({ error: err.message }, 500)
  }
}

async function handleStravaRefresh(request, env) {
  try {
    const { refresh_token } = await request.json().catch(() => ({}))
    if (!refresh_token) return jsonResponse({ error: 'Missing refresh_token' }, 400)

    const res  = await fetch('https://www.strava.com/oauth/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        client_id:     env.STRAVA_CLIENT_ID,
        client_secret: env.STRAVA_CLIENT_SECRET,
        refresh_token,
        grant_type:    'refresh_token',
      }),
    })
    const text = await res.text()
    let data
    try { data = JSON.parse(text) } catch { data = { error: 'non-json from Strava', raw: text.slice(0, 200) } }
    return jsonResponse(data, res.status)
  } catch (err) {
    return jsonResponse({ error: err.message }, 500)
  }
}

async function handleStreetview(request, env) {
  const params  = new URL(request.url).searchParams
  const lat     = params.get('lat')
  const lon     = params.get('lon')
  const heading = params.get('heading') ?? '0'

  if (!lat || !lon) return new Response('Missing lat/lon', { status: 400 })

  const key = env.GOOGLE_MAPS_STREETVIEW_KEY
  if (!key)  return new Response('Not configured', { status: 500 })

  const url = `https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${lat},${lon}&heading=${heading}&pitch=0&key=${key}`
  const res = await fetch(url)

  return new Response(res.body, {
    status:  res.status,
    headers: {
      'Content-Type':  'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}

function handleOwnerAuth(request, env) {
  const passcode = new URL(request.url).searchParams.get('owner')
  const expected = env.OWNER_PASSCODE
  if (!expected) return jsonResponse({ ok: false }, 500)
  return jsonResponse({ ok: passcode === expected })
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
