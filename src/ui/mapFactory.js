import { getDb } from '../storage/db.js'

export async function createMapView(containerEl) {
  const provider = (await getDb().get('settings', 'mapProvider')) ?? 'osm'
  if (provider === 'google') {
    const { GoogleMapView } = await import('./googleMapView.js')
    return new GoogleMapView(containerEl)
  }
  const { MapView } = await import('./map.js')
  return new MapView(containerEl)
}
