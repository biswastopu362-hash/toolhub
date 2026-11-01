import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import { describeDbError, ensureSchema } from '@/lib/ensure-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * D83 Admin Console v2 — manual store ordering.
 *
 * PATCH /api/admin/external-apps/reorder
 * Body: { ids: string[] } — the full list of platform slugs in the exact
 * order they should appear in the store. `sortOrder` = array index, so the
 * public catalog (ordered by sortOrder asc, createdAt asc) matches 1:1.
 */

export async function PATCH(request: Request): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 401 })
  }

  let body: { ids?: unknown }
  try {
    body = (await request.json()) as { ids?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((v): v is string => typeof v === 'string' && v.length > 0)
    : []
  if (ids.length === 0) {
    return NextResponse.json({ error: 'No platform order provided' }, { status: 400 })
  }

  try {
    await ensureSchema()
    // One update per row inside a single transaction keeps the order
    // consistent under concurrent admin edits.
    await db.$transaction(
      ids.map((slug, index) =>
        db.externalApp.update({
          where: { slug },
          data: { sortOrder: index },
        })
      )
    )
    return NextResponse.json({ ok: true, count: ids.length })
  } catch (err) {
    console.error('[admin/external-apps/reorder] PATCH failed:', err)
    const hint = describeDbError(err)
    return NextResponse.json(
      { error: hint ?? 'Could not save the new order' },
      { status: hint ? 503 : 500 }
    )
  }
}
