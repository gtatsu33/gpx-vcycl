const TOKEN = import.meta.env.VITE_MAPILLARY_TOKEN
const SEARCH_RADIUS_M = 35 // radiusパラメータの最大値は50m（Mapillary Graph API仕様）

export async function fetchCandidateImages(point) {
  const url = `https://graph.mapillary.com/images` +
    `?access_token=${TOKEN}` +
    `&fields=id,compass_angle,computed_compass_angle,geometry,computed_geometry,is_pano,sequence,quality_score,captured_at,thumb_1024_url,creator` +
    `&lat=${point.lat}&lng=${point.lon}&radius=${SEARCH_RADIUS_M}&limit=100`
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
