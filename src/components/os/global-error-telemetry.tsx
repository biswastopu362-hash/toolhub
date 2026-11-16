'use client'

import { useEffect } from 'react'
import { finishSession, markSessionStart, recordGlobalError } from '@/lib/crash-telemetry'

/**
 * GlobalErrorTelemetry — P9-W5. Invisible shell-level component that owns
 * the platform-wide error streams: `window.onerror` (script exceptions,
 * filtered to skip resource-load noise) and `unhandledrejection`. Events
 * are attributed to the open app via setActiveCrashApp; the session is
 * closed out on pagehide so the Admin Console can show a last-session
 * score. Mount exactly once, at the root of the OS shell.
 */
export function GlobalErrorTelemetry() {
  useEffect(() => {
    markSessionStart()

    const onError = (e: ErrorEvent) => {
      /* resource-load failures (img/script/link) arrive with an empty
       * message and a target — those are network noise, not app errors */
      if (!e.message) return
      const detail = e.error instanceof Error ? `${e.error.name}: ${e.message}` : e.message
      recordGlobalError(detail)
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason
      const msg =
        r instanceof Error
          ? `${r.name}: ${r.message}`
          : typeof r === 'string' && r.trim()
            ? r
            : 'Unhandled promise rejection'
      recordGlobalError(msg, 'rejection')
    }
    const onHide = () => finishSession()

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('pagehide', onHide)
      finishSession()
    }
  }, [])

  return null
}
