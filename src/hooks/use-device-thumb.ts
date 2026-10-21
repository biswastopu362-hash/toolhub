'use client'

import { useEffect, useState } from 'react'
import { cachedThumb, thumbFor, type DeviceEntry } from '@/lib/device-media'

/**
 * Resolve a lazy in-memory thumbnail for a device media entry.
 * Cache hits are applied during render (derived-state pattern); async
 * lookups resolve in an effect without synchronous state churn.
 */
export function useDeviceThumb(entry: DeviceEntry | undefined): string | undefined {
  const [state, setState] = useState<{ id?: string; thumb?: string }>(() => ({
    id: entry?.id,
    thumb: entry ? cachedThumb(entry.id) : undefined,
  }))

  // Derived-state adjustment: reset immediately when the entry changes.
  if (state.id !== entry?.id) {
    setState({ id: entry?.id, thumb: entry ? cachedThumb(entry.id) : undefined })
  }

  useEffect(() => {
    if (!entry || state.thumb) return
    let alive = true
    const myId = entry.id
    void thumbFor(entry).then((t) => {
      if (alive) setState({ id: myId, thumb: t })
    })
    return () => {
      alive = false
    }
  }, [entry, state.thumb])

  return state.id === entry?.id ? state.thumb : undefined
}
