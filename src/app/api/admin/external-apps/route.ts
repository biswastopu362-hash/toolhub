import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import {
  isReservedSlug,
  randomSuffix,
  serializeApp,
  slugifyName,
  validateAppInput,
} from '@/lib/external-apps-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Admin catalog management for Linked Platforms.
 *   GET  — every row (including hidden)
 *   POST — create a platform
 * Both require the admin session cookie.
 */

/** GET /api/admin/external-apps -> all platforms, newest last */
export async function GET(request: Request): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 401 })
  }
  try {
    const rows = await db.externalApp.findMany({ orderBy: { createdAt: 'asc' } })
    return NextResponse.json({ apps: rows.map(serializeApp) })
  } catch (err) {
    console.error('[admin/external-apps] GET failed:', err)
    return NextResponse.json({ error: 'Could not load platforms' }, { status: 500 })
  }
}

/** POST /api/admin/external-apps -> create */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { values, issues } = validateAppInput(body, false)
  if (issues.length > 0 || !values.name || !values.url || !values.description) {
    return NextResponse.json(
      { error: issues[0]?.message ?? 'Name, URL and description are required' },
      { status: 400 }
    )
  }

  // Unique slug, and never collide with built-in app ids.
  let slug = slugifyName(values.name)
  if (isReservedSlug(slug)) slug = `${slug}-app`
  for (let attempt = 0; attempt < 6; attempt++) {
    const clash = await db.externalApp.findUnique({ where: { slug } })
    if (!clash) break
    slug = `${slugifyName(values.name)}-${randomSuffix()}`
  }

  try {
    const row = await db.externalApp.create({
      data: {
        slug,
        name: values.name,
        url: values.url,
        description: values.description,
        tagline: values.tagline ?? '',
        category: values.category ?? 'utilities',
        icon: values.icon ?? 'Globe',
        gradient: values.gradient ?? 'from-emerald-400 via-teal-500 to-cyan-600',
        glow: values.glow ?? '#10b981',
        developer: values.developer ?? 'Linked platform',
        keywords: values.keywords ?? '',
        featured: values.featured ?? false,
        active: values.active ?? true,
      },
    })
    return NextResponse.json({ app: serializeApp(row) }, { status: 201 })
  } catch (err) {
    console.error('[admin/external-apps] POST failed:', err)
    return NextResponse.json({ error: 'Could not save the platform' }, { status: 500 })
  }
}
