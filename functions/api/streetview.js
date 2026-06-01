export async function onRequestGet(context) {
  const { request, env } = context
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
