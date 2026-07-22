import { effectiveAngle } from './score.js'

const PANEL_ID = 'mapillary-panel'
// キャッシュ選択は45°以内だが、表示はより厳しい閾値を適用する。
// 25°超の写真は道が斜め〜横向きに見えるためNo Imageを表示する。
const DISPLAY_MAX_DIFF_DEG = 25

/**
 * パノラマ（equirectangular）画像を、ルートの進行方向が中心に来るよう
 * 2倍ズームで切り出して表示するためのインラインスタイルを返す。
 * equirectangular では画像中心 = compass_angle 方向なので、
 * routeBearing との差分分だけ transform-origin を水平にずらす。
 */
function panoImgStyle(compassAngle, routeBearing) {
  const diff = ((routeBearing - compassAngle + 540) % 360) - 180 // -180〜+180
  // visible_center = (50 + originX) / 2, want = 50 + diff/360*100, solve: originX = 50 + diff/180*100
  const originX = Math.max(0, Math.min(100, 50 + (diff / 180) * 100))
  return `width:100%;height:100%;object-fit:cover;transform:scale(2);transform-origin:${originX.toFixed(0)}% 50%`
}

/**
 * 表示に使う前に画像バイトをブラウザキャッシュへ先読みしておく。
 * 先読みなしだと切り替え時に<img>挿入後にダウンロードが始まり、
 * 完了までパネル背景色（黒）が見えてしまう。
 */
export function preloadImage(url) {
  if (!url) return
  const img = new Image()
  img.src = url
}

export function updatePhotoPanel(status, image, routeBearing = null, distanceM = null) {
  const panel = document.getElementById(PANEL_ID)
  if (!panel) return

  if (status === 'pending') return // 取得中は前回表示を維持してチラつきを防ぐ

  const distTag = distanceM !== null ? `dist=${(distanceM / 1000).toFixed(3)}km` : 'dist=?'

  if (!image) {
    panel.hidden = false
    panel.dataset.imageId = ''
    panel.innerHTML = '<span class="mapillary-no-image">No Image</span>'
    return
  }

  if (panel.dataset.imageId === String(image.id)) return

  panel.dataset.imageId = String(image.id)

  // 表示閾値チェック: 選択済みでも角度が大きすぎる写真はNo Imageにする
  const angle = effectiveAngle(image)
  const angleSrc = image.computed_compass_angle != null ? 'cmp' : 'raw'
  if (routeBearing !== null) {
    const d = Math.abs(angle - routeBearing) % 360
    const diff = d > 180 ? 360 - d : d
    if (diff > DISPLAY_MAX_DIFF_DEG) {
      console.log(
        `[Mapillary] suppressed ${distTag} id=${image.id} road=${routeBearing.toFixed(1)}° photo=${angle?.toFixed(1)}°(${angleSrc}) diff=${diff.toFixed(1)}° > ${DISPLAY_MAX_DIFF_DEG}°`
      )
      panel.hidden = false
      panel.innerHTML = '<span class="mapillary-no-image">No Image</span>'
      return
    }
  }

  const isPano = image.is_pano && routeBearing !== null
  {
    const diff = routeBearing !== null
      ? Math.abs(((angle - routeBearing + 540) % 360) - 180)
      : null
    const panoTag = isPano ? ' [pano]' : ''
    console.log(
      `[Mapillary] display ${distTag} id=${image.id} road=${routeBearing?.toFixed(1) ?? 'null'}° photo=${angle?.toFixed(1) ?? 'null'}°(${angleSrc}) diff=${diff?.toFixed(1) ?? 'null'}°${panoTag}`
    )
  }
  const imgStyle = isPano
    ? panoImgStyle(angle ?? 0, routeBearing)
    : 'width:100%;height:100%;object-fit:cover'
  const username = image.creator?.username ?? ''
  const credit   = username ? `© ${username} / Mapillary` : '© Mapillary'
  panel.hidden = false
  panel.innerHTML =
    `<img src="${image.thumb_1024_url}" alt="" style="${imgStyle}">` +
    `<span class="mapillary-credit">${credit}</span>`
}

export function resetPhotoPanel() {
  const panel = document.getElementById(PANEL_ID)
  if (!panel) return
  panel.hidden = false
  panel.dataset.imageId = ''
  panel.innerHTML = '<span class="mapillary-no-image">No Image</span>'
}
