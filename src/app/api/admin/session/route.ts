import { NextResponse } from 'next/server'
import {
  ADMIN_COOKIE,
  checkAdminPasscode,
  createAdminToken,
  isAdminRequest,
} from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Admin session — GET checks, POST logs in, DELETE logs out.
 * Session lives in a signed httpOnly cookie (7 days).
 */

/** GET /api/admin/session -> { authenticated } */
export async function GET(request: Request): Promise<NextResponse> {
  return NextResponse.json({ authenticated: isAdminRequest(request) })
}

/** POST /api/admin/session { passcode } -> sets the admin cookie */
export async function POST(request: Request): Promise<NextResponse> {
  let body: { passcode?: unknown }
  try {
    body = (await request.json()) as { passcode?: unknown }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  if (!checkAdminPasscode(body.passcode)) {
    // Small delay slows brute-force attempts without hurting UX.
    await new Promise((r) => setTimeout(r, 600))
    return NextResponse.json({ error: 'Incorrect passcode' }, { status: 401 })
  }

  const { token, maxAge } = createAdminToken()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
  return res
}

/** DELETE /api/admin/session -> clears the admin cookie */
export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
