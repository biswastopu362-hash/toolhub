import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'ToolHub — All-in-One App Hub',
    short_name: 'ToolHub',
    description:
      'One app for everything: calculator, converters, generators, developer tools, notes, weather and more. Works offline, on every device.',
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
  }
}
