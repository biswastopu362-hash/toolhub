import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { serializeApp } from '@/lib/external-apps-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/external-apps — public catalog of live linked platforms.
 * Everyone's App Store reads from here; only admins can mutate.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const rows = await db.externalApp.findMany({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json(
      { apps: rows.map(serializeApp) },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (err) {
    console.error('[external-apps] GET failed:', err)
    return NextResponse.json({ apps: [] }, { status: 200 })
  }
}
