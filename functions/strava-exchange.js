export async function onRequestPost(context) {
  const { request, env } = context
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
