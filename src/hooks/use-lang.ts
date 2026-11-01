'use client'

import { useCallback } from 'react'
import { useAppStore } from '@/lib/store/app-store'
import { translate, type TKey } from '@/lib/i18n'

/**
 * D78 — language hook for the OS chrome. `lang` lives in the persisted
 * app store, so the choice survives reloads and joins cloud backups
 * (launcher domain) for free.
 */
export function useLang() {
  const lang = useAppStore((s) => s.lang)
  const setLang = useAppStore((s) => s.setLang)
  const t = useCallback(
    (key: TKey, params?: Record<string, string | number>) => translate(lang, key, params),
    [lang]
  )
  return { lang, t, setLang }
}
