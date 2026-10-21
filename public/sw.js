/* ToolHub Service Worker — offline-first app shell */
const CACHE_NAME = 'toolhub-v3'

/* Precache the app shell; every tool runs fully client-side */
const PRECACHE = [
  '/',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/favicon-32.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  /* Never cache API responses */
  if (url.pathname.startsWith('/api/')) return

  /* App navigations: network-first, fall back to cached shell (offline) */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('/', copy))
          return response
        })
        .catch(() => caches.match('/').then((r) => r || Response.error()))
    )
    return
  }

  /* Hashed build assets + icons: cache-first */
  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    /\.(png|jpg|jpeg|svg|ico|webp|woff2?|css|webmanifest)$/.test(url.pathname)

  if (isStatic) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
            return response
          })
      )
    )
    return
  }

  /* Everything else (JS chunks etc.): network-first with cache fallback */
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        return response
      })
      .catch(() => caches.match(request).then((r) => r || Response.error()))
  )
})
