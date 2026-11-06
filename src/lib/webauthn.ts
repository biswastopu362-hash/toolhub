'use client'

/* ================================================================== */
/* WebAuthn biometric unlock for App Lock v2 (v2.1).                   */
/*                                                                     */
/* Device-local pattern: a platform-authenticator credential is created*/
/* once (userVerification: 'required') and its rawId is stored locally. */
/* Unlocking = navigator.credentials.get() with that id — the browser  */
/* only returns an assertion after the user passed the biometric/      */
/* screen-lock check, so a resolved promise IS the verification.       */
/* The PIN stays available as the fallback path.                       */
/* ================================================================== */

export function biometricAvailable(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return (
      typeof window.PublicKeyCredential !== 'undefined' &&
      typeof navigator.credentials?.create === 'function' &&
      typeof navigator.credentials?.get === 'function'
    )
  } catch {
    return false
  }
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function randomChallenge(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(32)))
}

/** Create a platform credential. Returns the base64 rawId to persist,
 *  or null when the user cancels / the platform refuses. */
export async function registerBiometric(): Promise<string | null> {
  if (!biometricAvailable()) return null
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: randomChallenge(),
        rp: { name: 'ToolHub App Lock' },
        user: {
          id: crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16))),
          name: 'toolhub-local',
          displayName: 'ToolHub App Lock',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null
    if (!cred) return null
    return bufToB64(cred.rawId)
  } catch {
    /* NotAllowedError (user cancel), InvalidStateError (already registered) … */
    return null
  }
}

/** Ask the platform authenticator to verify the user. Resolves true when
 *  the biometric/screen-lock check passed. */
export async function unlockBiometric(credIdB64: string): Promise<boolean> {
  if (!biometricAvailable() || !credIdB64) return false
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: randomChallenge(),
        allowCredentials: [{ type: 'public-key', id: b64ToBuf(credIdB64) }],
        userVerification: 'required',
        timeout: 30_000,
      },
    })
    return true
  } catch {
    return false
  }
}
