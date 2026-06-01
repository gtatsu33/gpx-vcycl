export async function onRequestPost(context) {
  const { request, env } = context
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
