'use client'

import { SessionProvider } from 'next-auth/react'
import type { ReactNode } from 'react'

/**
 * D76 — client session context for the OS shell. With no `session` prop,
 * next-auth resolves it lazily from /api/auth/session, so guest mode
 * costs exactly one tiny request and zero render blocking.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  return <SessionProvider refetchOnWindowFocus={false}>{children}</SessionProvider>
}
