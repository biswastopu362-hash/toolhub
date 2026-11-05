import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { db } from '@/lib/db'
import { authOptions } from '@/lib/auth'
import { ensureSchema } from '@/lib/ensure-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * D77 Cloud Sync — pull/push per-domain JSON snapshots for signed-in users.
 *
 *   GET            → list every stored domain (domain, rev, updatedAt, size)
 *   GET ?domain=x  → the stored payload for one domain
 *   POST           → { domain, payload } upsert (last write wins, rev++)
 *   DELETE         → ?domain=x one blob, or ?all=1 everything
 *
 * Privacy: endpoints require a session; payloads are stored opaquely and
 * never parsed server-side. 2 MB cap per blob keeps the free Turso tier safe.
 */

const DOMAINS = new Set(['notes', 'reminders', 'launcher', 'games'])
const MAX_BYTES = 2 * 1024 * 1024

interface SessionUser {
  email?: string | null
  name?: string | null
}

async function requireEmail(): Promise<{ email: string; name: string } | null> {
  const session = await getServerSession(authOptions)
  const email = (session?.user as SessionUser | undefined)?.email?.toLowerCase()
  if (!email) return null
  const name = (session?.user as SessionUser | undefined)?.name ?? ''
  return { email, name }
}

export async function GET(request: Request): Promise<NextResponse> {
  const who = await requireEmail()
  if (!who) return NextResponse.json({ error: 'Sign in to use cloud sync' }, { status: 401 })
  const domain = new URL(request.url).searchParams.get('domain')

  try {
    await ensureSchema()
    const account = await db.syncAccount.findUnique({ where: { email: who.email } })
    if (!account) {
      /* never synced — empty catalog is the correct answer */
      return NextResponse.json({ blobs: [] }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const blobs = await db.syncBlob.findMany({
      where: { accountId: account.id, ...(domain ? { domain } : {}) },
      select: { domain: true, rev: true, updatedAt: true, payload: true },
      orderBy: { updatedAt: 'desc' },
    })
    return NextResponse.json(
      {
        blobs: blobs.map((b) => ({
          domain: b.domain,
          rev: b.rev,
          updatedAt: b.updatedAt.toISOString(),
          size: b.payload.length,
          /* v2.1: cheap prefix probe so clients can badge encrypted blobs —
           * the payload itself is never interpreted server-side. */
          enc: b.payload.startsWith('{"v":2'),
          ...(domain ? { payload: b.payload } : {}),
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    console.error('[sync] GET failed:', err)
    return NextResponse.json({ error: 'Sync storage unreachable' }, { status: 503 })
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const who = await requireEmail()
  if (!who) return NextResponse.json({ error: 'Sign in to use cloud sync' }, { status: 401 })

  let body: { domain?: string; payload?: string }
  try {
    body = (await request.json()) as { domain?: string; payload?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const domain = body.domain
  const payload = body.payload
  if (!domain || !DOMAINS.has(domain)) {
    return NextResponse.json(
      { error: `domain must be one of ${[...DOMAINS].join(', ')}` },
      { status: 400 }
    )
  }
  if (typeof payload !== 'string' || payload.length === 0) {
    return NextResponse.json({ error: 'payload must be a non-empty JSON string' }, { status: 400 })
  }
  if (payload.length > MAX_BYTES) {
    return NextResponse.json({ error: 'payload too large (2 MB cap)' }, { status: 413 })
  }

  try {
    await ensureSchema()
    const account = await db.syncAccount.upsert({
      where: { email: who.email },
      create: { email: who.email, name: who.name || who.email.split('@')[0] },
      update: who.name ? { name: who.name } : {},
    })
    const existing = await db.syncBlob.findUnique({
      where: { accountId_domain: { accountId: account.id, domain } },
      select: { rev: true },
    })
    const blob = await db.syncBlob.upsert({
      where: { accountId_domain: { accountId: account.id, domain } },
      create: { accountId: account.id, domain, payload, rev: 1 },
      update: { payload, rev: (existing?.rev ?? 0) + 1 },
    })
    return NextResponse.json({
      domain: blob.domain,
      rev: blob.rev,
      updatedAt: blob.updatedAt.toISOString(),
      size: blob.payload.length,
    })
  } catch (err) {
    console.error('[sync] POST failed:', err)
    return NextResponse.json({ error: 'Sync storage unreachable' }, { status: 503 })
  }
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const who = await requireEmail()
  if (!who) return NextResponse.json({ error: 'Sign in to use cloud sync' }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const domain = sp.get('domain')
  const all = sp.get('all') === '1'
  if (!all && (!domain || !DOMAINS.has(domain))) {
    return NextResponse.json({ error: 'pass ?domain=<id> or ?all=1' }, { status: 400 })
  }

  try {
    await ensureSchema()
    const account = await db.syncAccount.findUnique({ where: { email: who.email } })
    if (!account) return NextResponse.json({ deleted: 0 })
    const dom = all ? null : (domain as string)
    const res = await db.syncBlob.deleteMany({
      where: { accountId: account.id, ...(dom ? { domain: dom } : {}) },
    })
    return NextResponse.json({ deleted: res.count })
  } catch (err) {
    console.error('[sync] DELETE failed:', err)
    return NextResponse.json({ error: 'Sync storage unreachable' }, { status: 503 })
  }
}
