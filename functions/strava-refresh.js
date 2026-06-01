export async function onRequestPost(context) {
  const { request, env } = context
  const { refresh_token } = await request.json().catch(() => ({}))
  if (!refresh_token) return new Response('Missing refresh_token', { status: 400 })

  const res = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      refresh_token,
      grant_type:    'refresh_token',
    }),
  })

  const data = await res.json()
  return new Response(JSON.stringify(data), {
    status:  res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
