export async function onRequestPost(context) {
  const { request, env } = context
  const { code } = await request.json().catch(() => ({}))
  if (!code) return new Response('Missing code', { status: 400 })

  const res = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
    }),
  })

  const data = await res.json()
  return new Response(JSON.stringify(data), {
    status:  res.status,
    headers: { 'Content-Type': 'application/json' },
  })
}
