import { getDb }       from '../storage/db.js'
import { isOwnerMode } from '../utils/ownerMode.js'

/**
 * @param {HTMLElement} mapInnerEl   2Dマップ用コンテナ（#map-inner）
 * @param {HTMLElement} photoPanelEl 写真枠コンテナ（#mapillary-panel。
 *   Googleモード時はStreet View画像の表示に転用する。Mapillaryとは
 *   排他のため同じ要素を共用してよい）
 */
export async function createMapView(mapInnerEl, photoPanelEl) {
  const provider = (await getDb().get('settings', 'mapProvider')) ?? 'osm'
  if (provider === 'google' && isOwnerMode()) {
    const { GoogleMapView } = await import('./googleMapView.js')
    return new GoogleMapView(mapInnerEl, photoPanelEl)
  }
  const { MapView } = await import('./map.js')
  return new MapView(mapInnerEl)
}
