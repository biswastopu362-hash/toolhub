'use client'

/**
 * PIN hashing for App Lock (D9). We never store the raw PIN — only a
 * salted SHA-256 hex digest. Falls back to djb2 on insecure contexts
 * where WebCrypto (crypto.subtle) is unavailable (http dev hosts).
 */
export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`toolhub-applock:${pin}`)
  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', data)
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    } catch {
      /* fall through to djb2 */
    }
  }
  let h = 5381
  for (const b of data) h = (((h << 5) + h + b) | 0) >>> 0
  return `djb2:${h.toString(16)}`
}
