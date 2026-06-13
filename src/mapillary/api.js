const TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN

function bboxFromPoint(lat, lon, halfSideM = 35) {
  const dLat = halfSideM / 111320
  const dLon = halfSideM / (111320 * Math.cos(lat * Math.PI / 180))
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(v => v.toFixed(7)).join(',')
}

export async function fetchCandidateImages(point) {
  const bbox = bboxFromPoint(point.lat, point.lon)
  const url = `https://graph.mapillary.com/images` +
    `?access_token=${TOKEN}` +
    `&fields=id,compass_angle,computed_compass_angle,is_pano,sequence_id,quality_score,captured_at,thumb_1024_url,creator` +
    `&bbox=${bbox}&limit=40`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Mapillary API error: ${res.status}`)
  const json = await res.json()
  return json.data ?? []
}

export async function fetchThumbUrl(imageId) {
  const url = `https://graph.mapillary.com/${imageId}?access_token=${TOKEN}&fields=thumb_1024_url`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Mapillary entity API error: ${res.status}`)
  return res.json()
}
