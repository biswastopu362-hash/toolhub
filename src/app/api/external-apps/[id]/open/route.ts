import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSchema } from '@/lib/ensure-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * D83 — open telemetry for linked platforms.
 *
 * POST /api/external-apps/<id>/open — fire-and-forget counter bump when a
 * user actually opens a platform (embedded view mounts). Public but
 * write-only: no data is returned, failures are swallowed client-side.
 * `id` is the public slug.
 */

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_request: Request, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params
  if (!id || id.length > 64) {
    return new NextResponse(null, { status: 400 })
  }
  try {
    await ensureSchema()
    await db.externalApp.update({
      where: { slug: id },
      data: { openCount: { increment: 1 } },
    })
  } catch {
    // Telemetry must never break the user flow — ignore everything.
  }
  return new NextResponse(null, { status: 204 })
}
