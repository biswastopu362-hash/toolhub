import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import { describeDbError, ensureSchema } from '@/lib/ensure-schema'
import {
  randomSuffix,
  serializeApp,
  slugifyName,
  validateAppInput,
} from '@/lib/external-apps-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * D83 Admin Console v2 — bulk import.
 *
 * POST /api/admin/external-apps/import
 * Body: { apps: Array<name, url, description, ...> } — same field shape as
 * the single create endpoint (an export file round-trips 1:1). Every entry
 * is validated independently; entries whose URL already exists are skipped
 * so re-importing an export never duplicates the catalog.
 *
 * Returns { created, skipped, errors } — never all-or-nothing.
 */

const MAX_IMPORT = 50

interface ImportOutcome {
  created: number
  skipped: number
  errors: { name: string; message: string }[]
  apps: ReturnType<typeof serializeApp>[]
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 401 })
  }

  let body: { apps?: unknown }
  try {
    body = (await request.json()) as { apps?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const list = Array.isArray(body.apps) ? body.apps : []
  if (list.length === 0) {
    return NextResponse.json({ error: 'No platforms found in the import file' }, { status: 400 })
  }
  if (list.length > MAX_IMPORT) {
    return NextResponse.json(
      { error: `Too many platforms in one import (max ${MAX_IMPORT})` },
      { status: 400 }
    )
  }

  const outcome: ImportOutcome = { created: 0, skipped: 0, errors: [], apps: [] }

  try {
    await ensureSchema()

    // Pre-index existing URLs for duplicate skipping (case-insensitive host+path).
    const existing = await db.externalApp.findMany({ select: { url: true } })
    const seen = new Set(existing.map((r) => r.url.toLowerCase()))

    for (const raw of list) {
      const rec = (raw ?? {}) as Record<string, unknown>
      const name = typeof rec.name === 'string' ? rec.name : ''
      const { values, issues } = validateAppInput(rec, false)
      if (issues.length > 0 || !values.name || !values.url || !values.description) {
        outcome.errors.push({
          name: name || 'Unnamed platform',
          message: issues[0]?.message ?? 'Name, URL and description are required',
        })
        continue
      }
      if (seen.has(values.url.toLowerCase())) {
        outcome.skipped += 1
        continue
      }

      // Unique slug (same policy as single create).
      let slug = slugifyName(values.name)
      if (slug === 'platform') slug = `platform-${randomSuffix()}`
      for (let attempt = 0; attempt < 6; attempt++) {
        const clash = await db.externalApp.findUnique({ where: { slug } })
        if (!clash) break
        slug = `${slugifyName(values.name)}-${randomSuffix()}`
      }

      // Imports land at the bottom of the manual order.
      const maxOrder = await db.externalApp.aggregate({ _max: { sortOrder: true } })
      const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1

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
            sortOrder,
          },
        })
        seen.add(values.url.toLowerCase())
        outcome.created += 1
        outcome.apps.push(serializeApp(row))
      } catch {
        outcome.errors.push({ name: values.name, message: 'Could not save — slug clash or db error' })
      }
    }

    return NextResponse.json(outcome)
  } catch (err) {
    console.error('[admin/external-apps/import] POST failed:', err)
    const hint = describeDbError(err)
    return NextResponse.json(
      { error: hint ?? 'Import failed — check the file and try again' },
      { status: hint ? 503 : 500 }
    )
  }
}
