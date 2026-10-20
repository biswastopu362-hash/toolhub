import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'টুলহাব — সব কাজের এক অ্যাপ',
    short_name: 'টুলহাব',
    description:
      'ল্যাপটপ, মোবাইল বা কম্পিউটার — প্রতিদিনের প্রয়োজনীয় সব টুল এক জায়গায়। অফলাইনেও কাজ করে এমন প্রগ্রেসিভ ওয়েব অ্যাপ।',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    lang: 'bn',
    dir: 'ltr',
    background_color: '#f6fdf9',
    theme_color: '#059669',
    categories: ['utilities', 'productivity', 'tools'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
