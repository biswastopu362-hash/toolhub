'use client'

import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}

/**
 * True after the first client render, false during SSR and hydration.
 * Correct way to gate persisted/localStorage-driven UI without
 * hydration mismatches or setState-in-effect lint errors.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  )
}
