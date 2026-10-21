'use client'

import { useEffect } from 'react'
import { getAccent, type AccentId, type ModeId } from '@/lib/theme'
import { useAppStore } from '@/lib/store/app-store'

/**
 * Custom theme engine (replaces next-themes so we can support
 * light / dark / amoled / system + 8 accent palettes with zero FOUC).
 *
 * - Applies `dark` / `amoled` classes + `data-accent` on <html>
 * - Sets `color-scheme` so native widgets match
 * - Mirrors prefs to localStorage for the pre-paint inline script
 * - Updates the browser chrome (theme-color meta) to match the accent
 * - Follows OS dark-mode changes while mode = system
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useAppStore((s) => s.mode)
  const accent = useAppStore((s) => s.accent)

  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    const apply = () => {
      const resolved = mode === 'system' ? (mq.matches ? 'dark' : 'light') : mode
      const dark = resolved !== 'light'

      root.classList.toggle('dark', dark)
      root.classList.toggle('amoled', mode === 'amoled')
      root.dataset.accent = accent
      root.style.colorScheme = dark ? 'dark' : 'light'

      try {
        localStorage.setItem('toolhub.mode', mode)
        localStorage.setItem('toolhub.accent', accent)
      } catch {
        /* private mode */
      }

      // Browser chrome tint (Android status bar in standalone PWA)
      try {
        const def = getAccent(accent)
        const color = dark ? def.chrome.dark : def.chrome.light
        document
          .querySelectorAll('meta[name="theme-color"]')
          .forEach((m) => m.remove())
        const meta = document.createElement('meta')
        meta.setAttribute('name', 'theme-color')
        meta.setAttribute('content', color)
        document.head.appendChild(meta)
      } catch {
        /* non-critical */
      }
    }

    apply()
    const onSystemChange = () => {
      if (mode === 'system') apply()
    }
    mq.addEventListener('change', onSystemChange)
    return () => mq.removeEventListener('change', onSystemChange)
  }, [mode, accent])

  return <>{children}</>
}

export type { AccentId, ModeId }
