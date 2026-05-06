export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const { refresh_token } = JSON.parse(event.body ?? '{}')
  if (!refresh_token) return { statusCode: 400, body: 'Missing refresh_token' }

  const res = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token,
      grant_type:    'refresh_token',
    }),
  })

  const data = await res.json()
  return {
    statusCode: res.status,
    headers:    { 'Content-Type': 'application/json' },
    body:       JSON.stringify(data),
  }
}
