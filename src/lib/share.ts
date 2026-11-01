'use client'

/* ================================================================== */
/* ToolHub — pending share payload (D70 Share Target, reused by the    */
/* D74 Spotlight "note:" deep action)                                  */
/*                                                                     */
/* Web Share Target lands on `/` with ?title=&text=&url= — the shell   */
/* stashes the payload here and opens Notes, which consumes it into a  */
/* new note. Zero uploads: everything stays on the device.             */
/* ================================================================== */

export interface PendingShare {
  title?: string
  text?: string
  url?: string
  /** where the payload came from (shown in the receipt toast) */
  source: 'share-target' | 'spotlight'
}

const KEY = 'toolhub.share.pending'

export function setPendingShare(payload: PendingShare): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    /* storage unavailable */
  }
}

export function consumePendingShare(): PendingShare | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    localStorage.removeItem(KEY)
    const parsed = JSON.parse(raw) as PendingShare
    if (!parsed || (!parsed.text && !parsed.title && !parsed.url)) return null
    return parsed
  } catch {
    return null
  }
}
