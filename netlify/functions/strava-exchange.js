export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  const { code } = JSON.parse(event.body ?? '{}')
  if (!code) return { statusCode: 400, body: 'Missing code' }

  const res = await fetch('https://www.strava.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
    }),
  })

  const data = await res.json()
  return {
    statusCode: res.status,
    headers:    { 'Content-Type': 'application/json' },
    body:       JSON.stringify(data),
  }
}
