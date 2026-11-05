'use client'

/* ================================================================== */
/* End-to-end encryption for Cloud Sync blobs (v2.1 "Reach & Rituals"). */
/*                                                                     */
/* The sync server stores payloads opaquely; this layer makes them     */
/* opaque to the server too. A passphrase is stretched with PBKDF2     */
/* (SHA-256, 250k iterations) into an AES-GCM-256 key. The passphrase  */
/* itself never leaves the device — it lives in sessionStorage for the */
/* current tab session only. Blobs wrap into a self-describing JSON    */
/* envelope:                                                          */
/*                                                                     */
/*   { v: 2, enc: 'A256GCM', kdf: 'PBKDF2-SHA256', iters, salt, iv, ct } */
/*                                                                     */
/* Losing the passphrase means losing the backup — by design.          */
/* ================================================================== */

const ITERATIONS = 250_000
const SALT_BYTES = 16
const IV_BYTES = 12

export interface E2EEnvelope {
  v: 2
  enc: 'A256GCM'
  kdf: 'PBKDF2-SHA256'
  iters: number
  salt: string
  iv: string
  ct: string
}

function subtle(): SubtleCrypto {
  const s = typeof globalThis !== 'undefined' ? globalThis.crypto?.subtle : undefined
  if (!s) throw new Error('WebCrypto unavailable in this context')
  return s
}

function toB64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await subtle().importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  )
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

/** True when the payload string is one of our v2 encrypted envelopes. */
export function isEncryptedEnvelope(payload: string): boolean {
  if (!payload.startsWith('{')) return false
  try {
    const parsed = JSON.parse(payload) as Partial<E2EEnvelope> | null
    return parsed?.v === 2 && parsed?.enc === 'A256GCM'
  } catch {
    return false
  }
}

/** Encrypt a plain JSON string into the v2 envelope. Throws when
 *  WebCrypto is missing or the passphrase is empty. */
export async function encryptString(plain: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error('passphrase required')
  const salt = new Uint8Array(SALT_BYTES)
  const iv = new Uint8Array(IV_BYTES)
  globalThis.crypto.getRandomValues(salt)
  globalThis.crypto.getRandomValues(iv)
  const key = await deriveKey(passphrase, salt)
  const ct = await subtle().encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plain)
  )
  const envelope: E2EEnvelope = {
    v: 2,
    enc: 'A256GCM',
    kdf: 'PBKDF2-SHA256',
    iters: ITERATIONS,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  }
  return JSON.stringify(envelope)
}

/** Decrypt a v2 envelope back to the plain JSON string.
 *  Throws Error('wrong-passphrase') on auth failure so callers can
 *  show a targeted message. */
export async function decryptString(envelope: string, passphrase: string): Promise<string> {
  if (!passphrase) throw new Error('wrong-passphrase')
  let parsed: E2EEnvelope
  try {
    parsed = JSON.parse(envelope) as E2EEnvelope
  } catch {
    throw new Error('not-an-envelope')
  }
  if (parsed?.v !== 2 || parsed?.enc !== 'A256GCM' || !parsed.salt || !parsed.iv || !parsed.ct) {
    throw new Error('not-an-envelope')
  }
  try {
    const key = await deriveKey(passphrase, fromB64(parsed.salt))
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: fromB64(parsed.iv) as BufferSource },
      key,
      fromB64(parsed.ct) as BufferSource
    )
    return new TextDecoder().decode(plain)
  } catch {
    throw new Error('wrong-passphrase')
  }
}
