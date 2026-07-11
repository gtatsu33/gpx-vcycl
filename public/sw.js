const CACHE_NAME = 'vcycl-v11'
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/favicon.png',
  '/apple-touch-icon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  // ナビゲーションリクエスト（HTML本体）はネットワーク優先。
  // デプロイのたびに変わる index.html を古いキャッシュのまま返し続けて
  // アプリが起動しなくなる事故（存在しないハッシュ付きJSを参照し続ける）
  // を防ぐため。オフライン時のみキャッシュにフォールバックする。
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request).then((cached) => cached ?? caches.match('/'))
      )
    )
    return
  }

  // それ以外（ハッシュ付きJS/CSS・アイコン等）はキャッシュ優先。
  // ファイル名にコンテンツハッシュが含まれるため、一度取得した内容は
  // ビルドが変わらない限り不変 — キャッシュ優先が正しく安全。
  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request))
  )
})
