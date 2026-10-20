'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Minimal hash-based router so the whole app stays on the "/" route.
 * Supports: '#/' (home) and '#/tool/<id>' (tool view).
 * Gives free browser back/forward button support + shareable links.
 */
export function useHashRoute(): [string, (hash: string) => void] {
  const [hash, setHash] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.hash : ''
  )

  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const navigate = useCallback((next: string) => {
    if (typeof window === 'undefined') return
    if (window.location.hash === next) {
      setHash(next)
      return
    }
    window.location.hash = next
  }, [])

  return [hash, navigate]
}
