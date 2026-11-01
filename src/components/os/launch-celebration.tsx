'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useToast } from '@/hooks/use-toast'
import { useLang } from '@/hooks/use-lang'
import { APP_VERSION } from '@/lib/constants'

/**
 * D90 Launch Day — a one-time "2.0 is here" moment.
 *
 * Fires a celebratory toast on the first launch after the v2.0 update
 * (once per device, keyed by version), then stays silent forever.
 * Deliberately toast-only: no layout shifts, no overlay, no permission asks.
 */

const CELEBRATED_KEY = 'toolhub-celebrated'

export function LaunchCelebration() {
  const { toast } = useToast()
  const { t, lang } = useLang()
  const fired = useRef(false)

  const celebrate = useCallback(() => {
    toast({
      title: t('launchToastTitle').replace('{v}', APP_VERSION),
      description: t('launchToastDesc'),
    })
  }, [toast, t])

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    let known: string | null = null
    try {
      known = localStorage.getItem(CELEBRATED_KEY)
    } catch {
      return
    }
    if (known === APP_VERSION) return
    const timer = setTimeout(() => {
      celebrate()
      try {
        localStorage.setItem(CELEBRATED_KEY, APP_VERSION)
      } catch {
        /* private mode — toast may repeat, acceptable */
      }
    }, 1800)
    return () => clearTimeout(timer)
  }, [celebrate])

  return null
}
