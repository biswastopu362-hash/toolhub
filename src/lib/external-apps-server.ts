/**
 * Server-side validation + serialization for Linked Platforms.
 * Kept free of client imports so route bundles stay tiny.
 */

export const VALID_CATEGORIES = [
  'calculator',
  'converter',
  'generator',
  'text',
  'developer',
  'daily',
  'media',
  'games',
  'utilities',
] as const

export type ValidCategory = (typeof VALID_CATEGORIES)[number]

/** Slugs that must never be claimed by a linked platform. */
const RESERVED_SLUGS = new Set([
  'files', 'store', 'gallery', 'camera', 'video-studio', 'video-player',
  'music-player', 'paint-studio', 'design-studio', 'sheet-studio',
  'pdf-tools', 'calendar', 'goal-tracker', 'ai-chat', 'game-2048',
  'calculator', 'unit-converter', 'qr-generator', 'password-generator',
  'emi-calculator', 'age-calculator', 'text-tools', 'color-tool',
  'json-formatter', 'base64-tool', 'clock', 'weather', 'notes',
  'reminders', 'currency', 'image-tools', 'voice-recorder',
  'device-info', 'settings', 'admin-console', 'admin', 'api', 'transfer',
])

export interface ExternalAppRow {
  id: string
  slug: string
  name: string
  url: string
  description: string
  tagline: string
  category: string
  icon: string
  gradient: string
  glow: string
  developer: string
  keywords: string
  featured: boolean
  active: boolean
  createdAt: Date
  updatedAt: Date
}

/** The JSON shape clients receive. */
export interface ExternalAppPayload {
  id: string
  name: string
  url: string
  description: string
  tagline: string
  category: string
  icon: string
  gradient: string
  glow: string
  developer: string
  keywords: string
  featured: boolean
  active: boolean
}

export function serializeApp(row: ExternalAppRow): ExternalAppPayload {
  return {
    id: row.slug || row.id,
    name: row.name,
    url: row.url,
    description: row.description,
    tagline: row.tagline,
    category: row.category,
    icon: row.icon,
    gradient: row.gradient,
    glow: row.glow,
    developer: row.developer,
    keywords: row.keywords,
    featured: row.featured,
    active: row.active,
  }
}

export function slugifyName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'platform'
}

export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6)
}

const GRADIENT_RE = /^from-[a-z0-9-]+\s+via-[a-z0-9-]+\s+to-[a-z0-9-]+$/
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v.trim() : undefined
}

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol === 'http:' && !local) u.protocol = 'https:'
    return u.toString()
  } catch {
    return null
  }
}

export interface ValidationIssue {
  field: string
  message: string
}

/**
 * Validate a create/update payload. Returns the normalized fields.
 * `partial` (PATCH) only checks the fields that are present.
 */
export function validateAppInput(
  body: Record<string, unknown>,
  partial: boolean
): { values: Partial<ExternalAppRow>; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = []
  const values: Partial<ExternalAppRow> = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)

  if (!partial || has('name')) {
    const name = str(body.name)
    if (!name) issues.push({ field: 'name', message: 'Name is required' })
    else if (name.length > 60) issues.push({ field: 'name', message: 'Name is too long (max 60)' })
    else values.name = name
  }

  if (!partial || has('url')) {
    const url = str(body.url)
    if (!url) issues.push({ field: 'url', message: 'URL is required' })
    else {
      const normalized = normalizeUrl(url)
      if (!normalized) issues.push({ field: 'url', message: 'Enter a valid http(s) link' })
      else values.url = normalized
    }
  }

  if (!partial || has('description')) {
    const description = str(body.description)
    if (!description) issues.push({ field: 'description', message: 'Description is required' })
    else if (description.length > 400)
      issues.push({ field: 'description', message: 'Description is too long (max 400)' })
    else values.description = description
  }

  if (has('tagline')) {
    const tagline = str(body.tagline) ?? ''
    values.tagline = tagline.slice(0, 120)
  }

  if (!partial || has('category')) {
    const category = str(body.category) ?? 'utilities'
    if (!(VALID_CATEGORIES as readonly string[]).includes(category))
      issues.push({ field: 'category', message: 'Unknown category' })
    else values.category = category
  }

  if (has('icon')) {
    const icon = str(body.icon)
    values.icon = icon && /^[A-Za-z0-9_]{1,40}$/.test(icon) ? icon : 'Globe'
  }

  if (has('gradient')) {
    const gradient = str(body.gradient)
    if (!gradient || !GRADIENT_RE.test(gradient))
      issues.push({ field: 'gradient', message: 'Invalid gradient' })
    else values.gradient = gradient
  }

  if (has('glow')) {
    const glow = str(body.glow)
    if (!glow || !HEX_RE.test(glow)) issues.push({ field: 'glow', message: 'Invalid glow color' })
    else values.glow = glow
  }

  if (has('developer')) {
    const developer = str(body.developer) ?? ''
    values.developer = developer.slice(0, 60) || 'Linked platform'
  }

  if (has('keywords')) {
    const keywords = str(body.keywords) ?? ''
    values.keywords = keywords.slice(0, 240)
  }

  if (has('featured')) values.featured = body.featured === true
  if (has('active')) values.active = body.active !== false

  return { values, issues }
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug)
}
