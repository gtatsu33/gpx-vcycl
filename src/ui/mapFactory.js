import { getDb }       from '../storage/db.js'
import { isOwnerMode } from '../utils/ownerMode.js'

export async function createMapView(osmContainerEl, googleContainerEl) {
  const provider = (await getDb().get('settings', 'mapProvider')) ?? 'osm'
  if (provider === 'google' && isOwnerMode()) {
    const { GoogleMapView } = await import('./googleMapView.js')
    return new GoogleMapView(googleContainerEl ?? osmContainerEl)
  }
  const { MapView } = await import('./map.js')
  return new MapView(osmContainerEl)
}
