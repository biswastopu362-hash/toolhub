import type { MetadataRoute } from 'next'

/**
 * ToolHub 2.0 — release metadata (D89).
 * Screenshots live in /public/screenshots (captured from the real UI).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ToolHub — All-in-One App Hub',
    short_name: 'ToolHub',
    description:
      'Your phone\'s second OS: 85 offline apps — calculators, converters, notes, games, media and developer tools — plus your own linked platforms, in one private hub. Zero uploads, works offline, on every device.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'en',
    dir: 'ltr',
    background_color: '#f4faf7',
    theme_color: '#12211f',
    categories: ['utilities', 'productivity', 'tools'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    /* D89: store listing screenshots — captured from the shipped UI */
    screenshots: [
      {
        src: '/screenshots/home-mobile.png',
        sizes: '390x844',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'ToolHub home screen — widgets, apps and dock',
      },
      {
        src: '/screenshots/store-mobile.png',
        sizes: '390x844',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'App Store — 85 apps, categories and linked platforms',
      },
    ],
    /* D70: receive shared text/links from other apps straight into Notes */
    share_target: {
      action: '/',
      method: 'GET',
      params: {
        title: 'title',
        text: 'text',
        url: 'url',
      },
    },
    /* D71: home-screen long-press app shortcuts */
    shortcuts: [
      { name: 'App Store', short_name: 'Store', url: '/?shortcut=store' },
      { name: 'New Note', short_name: 'Note', url: '/?shortcut=notes' },
      { name: 'Weather', short_name: 'Weather', url: '/?shortcut=weather' },
      { name: 'Scan QR', short_name: 'QR', url: '/?shortcut=qr-generator' },
      { name: 'Help Center', short_name: 'Help', url: '/?shortcut=help' },
    ],
  }
}
