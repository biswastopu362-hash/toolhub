'use client'

/* ================================================================== */
/* Input hardening toolkit — P9-W6 ("Fortify" wave 6).                 */
/*                                                                     */
/* One vocabulary for every form in the platform:                      */
/*   • sanitizeText / sanitizePastedText — strip control, separator,   */
/*     bidi and zero-width characters that should never end up in a    */
/*     stored field (invisible-character injection defense).           */
/*   • isValidPlatformUrl — http(s)-only URL check, mirrors the        */
/*     server's normalizeUrl rules (external-apps-server.ts).          */
/*   • validatePlatformForm — per-field friendly errors + cleaned      */
/*     values for the Linked Platforms editor, mirroring the server     */
/*     contract so the client catches everything before a round-trip.  */
/*                                                                     */
/* The global paste funnel (paste-sanitizer.tsx) applies these         */
/* sanitizers platform-wide: every input in all 90 apps inherits       */
/* paste protection from a single mount — no per-app wiring.           */
/* ================================================================== */

/**
 * Characters that must never survive into a stored field:
 *  • C0 control codes except \n (\u000A) and \t (\u0009)
 *  • DEL + C1 control codes
 *  • Unicode separators and bidi/embedding controls (U+2028/U+2029,
 *    U+200E/U+200F, U+202A–U+202E) — classic spoofing vectors
 *  • Zero-width spaces/joiners/notes (U+200B–U+200D, U+2060–U+2064,
 *    U+FEFF) — invisible payload; U+200D also breaks legit emoji, an
 *    accepted tradeoff for injection safety
 *  • Interlinear annotation + specials (U+FFF9–U+FFFB)
 */
const INVISIBLE_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2028\u2029\uFEFF\uFFF9-\uFFFB]/g

/** Upper bounds shared by client hints and final clamps. */
export const LIMITS = {
  platformName: 60,
  platformUrl: 2048,
  platformDescription: 400,
  platformTagline: 120,
  platformKeywords: 200,
  adminPasscode: 64,
  noteTitle: 120,
} as const

/**
 * Strip invisible/control characters, normalize line endings, collapse
 * paragraph spam and trim. `multiline` keeps \n/\t and caps blank-line
 * runs; single-line fields get them folded into plain spaces.
 */
export function sanitizeText(raw: string, opts?: { multiline?: boolean }): string {
  const multiline = opts?.multiline ?? false
  const eol = raw.replace(/\r\n?/g, '\n').replace(INVISIBLE_RE, '')
  if (!multiline) {
    return eol.replace(/[\n\t]+/g, ' ').replace(/[ ]{2,}/g, ' ').trim()
  }
  /* trim each line's trailing spaces, cap runs of blank lines at two */
  const lines = eol.split('\n').map((l) => l.replace(/[ \t]+$/g, ''))
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Paste-path sanitizer used by the global funnel. Same rules as
 * sanitizeText, plus an optional `maxChars` clamp so pasting can never
 * blow past a field's maxLength guard (the native paste path is skipped
 * when we rewrite, so the attribute alone would not protect the field).
 */
export function sanitizePastedText(
  raw: string,
  opts?: { multiline?: boolean; maxChars?: number }
): string {
  const clean = sanitizeText(raw, opts)
  const max = opts?.maxChars
  if (max !== undefined && max >= 0 && clean.length > max) return clean.slice(0, max)
  return clean
}

/* ------------------------------------------------------------------ */
/* URL validation (mirrors the server's http(s)-only normalizeUrl)     */
/* ------------------------------------------------------------------ */

export function isValidPlatformUrl(url: string): boolean {
  const candidate = url.trim()
  if (!candidate || candidate.length > LIMITS.platformUrl) return false
  if (/\s/.test(candidate)) return false
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return false
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:'
}

/* ------------------------------------------------------------------ */
/* Linked Platforms form validation (client mirror of the server)      */
/* ------------------------------------------------------------------ */

export interface PlatformFormShape {
  name: string
  url: string
  description: string
  tagline: string
  keywords: string
}

/** Friendly, per-field error messages — keyed by form field. */
export type FieldErrors = Partial<Record<keyof PlatformFormShape, string>>

export interface PlatformFormResult {
  errors: FieldErrors
  /** Cleaned, clamped values safe to send — only meaningful when errors is empty. */
  values: PlatformFormShape
}

function cleanField(value: string, max: number, multiline = false): string {
  return sanitizeText(value, { multiline }).slice(0, max)
}

/**
 * Validates + sanitizes the Linked Platforms form. Every issue gets a
 * friendly, human sentence (never a code) and the cleaned payload is
 * returned so submission cannot leak unsanitized text.
 */
export function validatePlatformForm(form: PlatformFormShape): PlatformFormResult {
  const errors: FieldErrors = {}

  const name = cleanField(form.name, LIMITS.platformName)
  if (!name) errors.name = 'Give this platform a name.'
  else if (form.name.length > LIMITS.platformName)
    errors.name = `Names stay under ${LIMITS.platformName} characters — it was trimmed to fit.`

  const url = form.url.trim().slice(0, LIMITS.platformUrl)
  if (!url) errors.url = 'Add the link to your platform.'
  else if (/\s/.test(url) || !isValidPlatformUrl(url))
    errors.url = "That link doesn't look right — paste the full address starting with https://"

  const description = cleanField(form.description, LIMITS.platformDescription, true)
  if (!description) errors.description = 'Describe what the platform does — it shows in the store.'
  else if (form.description.length > LIMITS.platformDescription)
    errors.description = `Descriptions stay under ${LIMITS.platformDescription} characters — it was trimmed to fit.`

  const tagline = cleanField(form.tagline, LIMITS.platformTagline)
  const keywords = cleanField(form.keywords.replace(/#/g, ''), LIMITS.platformKeywords)
    .replace(/,\s*,+/g, ',')
    .replace(/^,+|,+$/g, '')

  return {
    errors,
    values: { name, url, description, tagline, keywords },
  }
}
