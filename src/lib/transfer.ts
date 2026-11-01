'use client'

/**
 * Cross-app handoff for QR transfers.
 *
 * When the shell boots with /?transfer=<id> (someone scanned a share QR),
 * it stashes the id here, strips the query from the address bar and opens
 * Video Studio — which picks the id up and starts receiving automatically.
 */

let pending: string | null = null

export function setPendingTransfer(id: string | null): void {
  pending = id
}

/** One-shot read: returns the stashed id (if any) and clears it. */
export function takePendingTransfer(): string | null {
  const v = pending
  pending = null
  return v
}

/**
 * Extract a transfer id from anything a user might paste: a full share URL,
 * a URL with the id inside a query string, or a bare id.
 */
export function transferIdFromUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null

  try {
    const u = new URL(s)
    const q = u.searchParams.get('transfer')
    if (q) return sanitizeId(q)
  } catch {
    /* not a full URL — keep trying */
  }

  const m = s.match(/[?&]transfer=([A-Za-z0-9_-]+)/)
  if (m) return sanitizeId(m[1])

  if (/^[A-Za-z0-9_-]{6,64}$/.test(s)) return s
  return null
}

function sanitizeId(v: string): string {
  return /^[A-Za-z0-9_-]{6,64}$/.test(v) ? v : v.slice(0, 64)
}

/** Build the shareable QR target for a transfer id. */
export function transferShareUrl(id: string): string {
  if (typeof window === 'undefined') return `/?transfer=${id}`
  return `${window.location.origin}/?transfer=${encodeURIComponent(id)}`
}
