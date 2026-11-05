'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useAppStore } from '@/lib/store/app-store'
import { SYNC_DOMAINS, pushDomain } from '@/lib/sync'

/* ================================================================== */
/* AutoSync (v2.1) — automatic, debounced cloud backup.                */
/*                                                                     */
/* While the user is signed in AND has enabled "Automatic backup",     */
/* this watcher polls the four domain localStorage keys, and ~5s after */
/* a domain stops changing, pushes just that domain. A hidden-tab      */
/* flush fires when the app is backgrounded so mobile sessions never   */
/* lose the tail end of their edits.                                   */
/*                                                                     */
/* With E2E enabled the push is sealed on-device first (the session    */
/* passphrase from sessionStorage); when no passphrase is available    */
/* the watcher pauses instead of uploading plaintext.                  */
/*                                                                     */
/* Zero UI by itself — status is surfaced through the                  */
/* 'toolhub:autosync' window event + getAutoSyncStatus() in the        */
/* Settings account card.                                              */
/* ================================================================== */

const POLL_MS = 4_000
const DEBOUNCE_MS = 5_000
const PASS_KEY = 'toolhub-e2e-pass'

export interface AutoSyncStatus {
  /** ms timestamp of the last successful (or attempted) auto push */
  lastPushAt: number | null
  /** domains pushed in the last round */
  lastPushed: string[]
  /** last error message, cleared on the next success */
  lastError: string | null
  /** true while a push round is in flight */
  pushing: boolean
}

let status: AutoSyncStatus = { lastPushAt: null, lastPushed: [], lastError: null, pushing: false }

function emit() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('toolhub:autosync'))
}

export function getAutoSyncStatus(): AutoSyncStatus {
  return status
}

/** Session-scoped E2E passphrase helpers (never persisted to disk). */
export function getSessionPassphrase(): string | null {
  try {
    return sessionStorage.getItem(PASS_KEY)
  } catch {
    return null
  }
}

export function setSessionPassphrase(pass: string | null) {
  try {
    if (pass) sessionStorage.setItem(PASS_KEY, pass)
    else sessionStorage.removeItem(PASS_KEY)
  } catch {
    /* private-mode sessionStorage denial — E2E stays available in-memory
     * for this tick only; pushes requiring it will pause instead */
  }
}

export function AutoSync() {
  const { status: sessionStatus, data: session } = useSession()
  const signedIn = sessionStatus === 'authenticated' && Boolean(session?.user?.email)

  useEffect(() => {
    if (!signedIn) return

    let snapshot = new Map<string, string | null>()
    let dirty = new Set<string>()
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let stopped = false

    const readAll = () => {
      const next = new Map<string, string | null>()
      for (const d of SYNC_DOMAINS) {
        let v: string | null = null
        try {
          v = localStorage.getItem(d.storageKey)
        } catch {
          v = null
        }
        next.set(d.storageKey, v)
      }
      return next
    }
    snapshot = readAll()

    const pushChanged = async (changed: string[]) => {
      if (changed.length === 0 || stopped) return
      const e2e = useAppStore.getState().e2eEnabled
      const pass = e2e ? getSessionPassphrase() : undefined
      if (e2e && !pass) {
        status = { ...status, pushing: false, lastError: 'passphrase' }
        emit()
        return
      }
      status = { ...status, pushing: true, lastError: null }
      emit()
      const pushed: string[] = []
      let firstError: string | null = null
      for (const d of SYNC_DOMAINS) {
        if (!changed.includes(d.storageKey)) continue
        try {
          const meta = await pushDomain(d, pass ? { passphrase: pass } : undefined)
          if (meta) pushed.push(d.id)
          snapshot.set(d.storageKey, (() => {
            try { return localStorage.getItem(d.storageKey) } catch { return null }
          })())
        } catch (err) {
          firstError = firstError ?? (err instanceof Error ? err.message : 'backup failed')
        }
      }
      status = {
        lastPushAt: pushed.length > 0 ? Date.now() : status.lastPushAt,
        lastPushed: pushed,
        lastError: firstError,
        pushing: false,
      }
      emit()
    }

    const schedule = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        const changed = [...dirty]
        dirty = new Set()
        void pushChanged(changed)
      }, DEBOUNCE_MS)
    }

    const poll = () => {
      if (stopped || document.hidden) return
      const next = readAll()
      for (const [key, val] of next) {
        if (snapshot.get(key) !== val) {
          snapshot.set(key, val)
          dirty.add(key)
        }
      }
      /* Arm the debounce exactly once per pending round — re-arming on
       * every tick would postpone the push forever (4s poll < 5s wait). */
      if (dirty.size > 0 && !debounceTimer) schedule()
    }

    const onHidden = () => {
      if (document.visibilityState !== 'hidden') return
      if (debounceTimer) {
        clearTimeout(debounceTimer)
        debounceTimer = null
        const changed = [...dirty]
        dirty = new Set()
        void pushChanged(changed)
      }
    }

    const interval = setInterval(poll, POLL_MS)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      stopped = true
      clearInterval(interval)
      if (debounceTimer) clearTimeout(debounceTimer)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [signedIn])

  return null
}
