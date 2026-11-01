import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isAdminRequest } from '@/lib/admin-auth'
import { describeDbError, ensureSchema } from '@/lib/ensure-schema'
import { serializeApp, validateAppInput } from '@/lib/external-apps-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PATCH  /api/admin/external-apps/<id> — update any subset of fields
 * DELETE /api/admin/external-apps/<id> — remove the platform entirely
 * Both require the admin session cookie. `id` is the public slug.
 */

type Ctx = { params: Promise<{ id: string }> }

async function requireAdmin(request: Request): Promise<NextResponse | null> {
  if (isAdminRequest(request)) return null
  return NextResponse.json({ error: 'Admin access required' }, { status: 401 })
}

export async function PATCH(request: Request, ctx: Ctx): Promise<NextResponse> {
  const denied = await requireAdmin(request)
  if (denied) return denied

  const { id } = await ctx.params
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { values, issues } = validateAppInput(body, true)
  if (issues.length > 0) {
    return NextResponse.json({ error: issues[0].message }, { status: 400 })
  }
  if (Object.keys(values).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  try {
    await ensureSchema()
    const row = await db.externalApp.update({
      where: { slug: id },
      data: values,
    })
    return NextResponse.json({ app: serializeApp(row) })
  } catch (err) {
    console.error('[admin/external-apps/:id] PATCH failed:', err)
    const hint = describeDbError(err)
    if (hint) {
      return NextResponse.json({ error: hint }, { status: 503 })
    }
    return NextResponse.json({ error: 'Platform not found or update failed' }, { status: 404 })
  }
}

export async function DELETE(request: Request, ctx: Ctx): Promise<NextResponse> {
  const denied = await requireAdmin(request)
  if (denied) return denied

  const { id } = await ctx.params
  try {
    await ensureSchema()
    await db.externalApp.delete({ where: { slug: id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/external-apps/:id] DELETE failed:', err)
    const hint = describeDbError(err)
    if (hint) {
      return NextResponse.json({ error: hint }, { status: 503 })
    }
    return NextResponse.json({ error: 'Platform not found' }, { status: 404 })
  }
}
