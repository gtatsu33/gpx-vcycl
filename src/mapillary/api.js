const TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN

export async function fetchCandidateImages(point) {
  const url = `https://graph.mapillary.com/images` +
    `?access_token=${TOKEN}` +
    `&fields=id,compass_angle,computed_compass_angle,is_pano,sequence_id,quality_score,captured_at,thumb_1024_url,creator` +
    `&lat=${point.lat}&lng=${point.lon}&radius=50&limit=40`
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
