'use client'

/* ================================================================== */
/* Cloud Sync client (D77) — optional backup for signed-in users.      */
/*                                                                     */
/* Three domains mirror the on-device stores:                          */
/*   notes     → localStorage 'toolhub-notes'                          */
/*   reminders → localStorage 'toolhub-reminders'                      */
/*   launcher  → localStorage 'toolhub-store' (zustand persisted JSON) */
/*                                                                     */
/* Backup = read here, POST blob. Restore = write here, reload.        */
/* Last write wins; nothing is uploaded unless the user signs in and   */
/* presses "Back up now" (privacy stance unchanged).                   */
/* ================================================================== */

export interface SyncDomain {
  id: 'notes' | 'reminders' | 'launcher'
  label: string
  description: string
  /** primary localStorage key holding the domain's JSON snapshot */
  storageKey: string
  /** secondary keys written on restore (mirrors) */
  extraKeys?: string[]
}

export const SYNC_DOMAINS: SyncDomain[] = [
  {
    id: 'notes',
    label: 'Notes',
    description: 'Folders, pinned notes, colors',
    storageKey: 'toolhub-notes',
    extraKeys: ['toolhub-notes-folders'],
  },
  {
    id: 'reminders',
    label: 'Reminders',
    description: 'Open and completed reminders',
    storageKey: 'toolhub-reminders',
  },
  {
    id: 'launcher',
    label: 'Launcher & settings',
    description: 'Layout, wallpaper, accent, theme',
    storageKey: 'toolhub-store',
  },
]

export interface SyncBlobMeta {
  domain: string
  rev: number
  updatedAt: string
  size: number
}

interface BlobResponse {
  blobs: SyncBlobMeta[]
}

export function readDomainPayload(domain: SyncDomain): string | null {
  try {
    const raw = localStorage.getItem(domain.storageKey)
    const extra = (domain.extraKeys ?? []).map((k) => [k, localStorage.getItem(k)] as const)
    if ((raw === null || raw.length === 0) && extra.every(([, v]) => v === null)) return null
    return JSON.stringify({ v: 1, main: raw, extra })
  } catch {
    return null
  }
}

/** Push one domain's local snapshot to the cloud. Returns the stored rev.
 *  Resolves with null when the on-device store is empty (nothing to push). */
export async function pushDomain(domain: SyncDomain): Promise<SyncBlobMeta | null> {
  const payload = readDomainPayload(domain)
  if (!payload) return null
  const res = await fetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain: domain.id, payload }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Backup failed (${res.status})`)
  }
  return (await res.json()) as SyncBlobMeta
}

/** List every cloud blob for the signed-in account. */
export async function listCloudBlobs(): Promise<SyncBlobMeta[]> {
  const res = await fetch('/api/sync', { cache: 'no-store' })
  if (!res.ok) throw new Error(`Could not read cloud backups (${res.status})`)
  const body = (await res.json()) as BlobResponse
  return body.blobs
}

/** Fetch one domain's payload and write it into localStorage (no reload).
 *  Handles both the composed {v:1, main, extra} envelope and legacy plain
 *  snapshots. Returns the primary payload size. */
export async function restoreDomain(domain: SyncDomain): Promise<number> {
  const res = await fetch(`/api/sync?domain=${domain.id}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`Restore failed (${res.status})`)
  const body = (await res.json()) as { blobs: Array<{ payload?: string }> }
  const payload = body.blobs[0]?.payload
  if (!payload) throw new Error(`No cloud backup found for ${domain.label}`)

  let main = payload
  try {
    const parsed = JSON.parse(payload) as
      | { v?: number; main?: string | null; extra?: [string, string | null][] }
      | null
    if (parsed && typeof parsed === 'object' && parsed.v === 1) {
      main = parsed.main ?? ''
      if (main) localStorage.setItem(domain.storageKey, main)
      for (const [k, val] of parsed.extra ?? []) {
        if (val != null) localStorage.setItem(k, val)
      }
      return main.length
    }
  } catch {
    /* legacy plain snapshot falls through */
  }
  localStorage.setItem(domain.storageKey, main)
  return main.length
}

/** Delete cloud blobs — one domain, or everything with '*'. */
export async function deleteCloudBlobs(domain: SyncDomain['id'] | '*'): Promise<number> {
  const qs = domain === '*' ? 'all=1' : `domain=${domain}`
  const res = await fetch(`/api/sync?${qs}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete failed (${res.status})`)
  const body = (await res.json()) as { deleted: number }
  return body.deleted
}
