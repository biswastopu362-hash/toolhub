import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Server-only admin gate for the "Linked platforms" feature.
 *
 * A single shared passcode (ADMIN_PASSCODE env, with a safe default) unlocks
 * a signed, stateless session cookie. No user accounts, no database — the
 * HMAC proves the cookie was issued by this server after a valid passcode
 * and that it has not expired.
 */

export const ADMIN_COOKIE = 'toolhub_admin'

/** 7 days, matches the cookie maxAge. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000

function passcode(): string {
  return process.env.ADMIN_PASSCODE || 'toolhub-admin'
}

function secret(): string {
  // Derived from the passcode so rotating the passcode invalidates sessions.
  return process.env.ADMIN_SECRET || `toolhub::admin::${passcode()}`
}

function sign(expires: number): string {
  return createHmac('sha256', secret()).update(`admin:${expires}`).digest('hex')
}

/** Issue a fresh session token (expiry + hmac). */
export function createAdminToken(): { token: string; maxAge: number } {
  const expires = Date.now() + TTL_MS
  return { token: `${expires}.${sign(expires)}`, maxAge: Math.floor(TTL_MS / 1000) }
}

/** Verify a session token — constant-time, expiry-checked. */
export function verifyAdminToken(token: string | undefined | null): boolean {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const expStr = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expires = Number(expStr)
  if (!Number.isSafeInteger(expires) || expires < Date.now()) return false
  const expected = sign(expires)
  if (sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    return false
  }
}

/** Check a submitted passcode against the configured one. */
export function checkAdminPasscode(input: unknown): boolean {
  if (typeof input !== 'string' || input.length === 0) return false
  const expected = passcode()
  if (input.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(input), Buffer.from(expected))
  } catch {
    return false
  }
}

/**
 * Extract + verify the session from a Request's Cookie header.
 * Returns true when the caller may perform admin mutations.
 */
export function isAdminRequest(request: Request): boolean {
  const cookie = request.headers.get('cookie') ?? ''
  const match = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ADMIN_COOKIE}=`))
  if (!match) return false
  return verifyAdminToken(decodeURIComponent(match.slice(ADMIN_COOKIE.length + 1)))
}
