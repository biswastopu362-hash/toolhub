/* ToolHub Service Worker — offline-first app shell */
/* v2.1: cache v4 — adds navigation preload (parallel start of the network
 * request while the SW boots, shaving cold-start latency on mobile) */
const CACHE_NAME = 'toolhub-v4'

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
      .then(() =>
        /* v2.1: navigation preload — the browser starts the navigation
         * request while this SW is still activating */
        self.registration.navigationPreload
          ? self.registration.navigationPreload.enable()
          : Promise.resolve()
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

  /* App navigations: prefer the preloaded response, then network, then
   * fall back to the cached shell (offline) */
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse
          if (preloaded) {
            const copy = preloaded.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put('/', copy))
            return preloaded
          }
        } catch {
          /* preload unsupported/failed — fall through to plain fetch */
        }
        try {
          const response = await fetch(request)
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('/', copy))
          return response
        } catch {
          const cached = await caches.match('/')
          return cached || Response.error()
        }
      })()
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
