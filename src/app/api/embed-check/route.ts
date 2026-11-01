import { NextResponse } from 'next/server'
import { isAdminRequest } from '@/lib/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * D84 Linked Platforms v2 — embed-failure diagnostics.
 *
 * GET /api/embed-check?url=https://example.com
 * Server-side probe of the target's framing policy: reads the response
 * headers and reports whether the site allows being embedded in an iframe.
 *
 * Admin-gated (the probe is a limited SSRF surface), http/https only,
 * 6s timeout, response body never read.
 */

type Verdict = 'yes' | 'no' | 'unknown'

interface EmbedReport {
  url: string
  finalUrl: string
  status: number | null
  verdict: Verdict
  reason: string
  checkedMs: number
}

function analyzeHeaders(
  headers: Headers,
  status: number | null,
  finalUrl: string
): { verdict: Verdict; reason: string } {
  const xfo = (headers.get('x-frame-options') ?? '').toLowerCase()
  const csp = (headers.get('content-security-policy') ?? '').toLowerCase()

  if (xfo.includes('deny')) {
    return { verdict: 'no', reason: 'X-Frame-Options: DENY — the site refuses all embedding' }
  }
  if (xfo.includes('sameorigin')) {
    return {
      verdict: 'no',
      reason: 'X-Frame-Options: SAMEORIGIN — only the site itself may embed it',
    }
  }
  const ancestorMatch = csp.match(/frame-ancestors([^;]*)/)
  if (ancestorMatch) {
    const directive = ancestorMatch[1].trim()
    if (directive === "'none'" || directive === 'none') {
      return { verdict: 'no', reason: 'CSP frame-ancestors: none — embedding is blocked' }
    }
    if (directive.includes('*') || directive.includes('http')) {
      return { verdict: 'yes', reason: 'CSP frame-ancestors allows embedding' }
    }
    return {
      verdict: 'no',
      reason: `CSP frame-ancestors restricts embedding (${directive.slice(0, 60)})`,
    }
  }
  if (status !== null && status >= 200 && status < 400) {
    return {
      verdict: 'yes',
      reason: 'No framing restriction found — the site should embed fine',
    }
  }
  return { verdict: 'unknown', reason: 'Could not determine the framing policy' }
}

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 401 })
  }

  const raw = new URL(request.url).searchParams.get('url') ?? ''
  let target: URL
  try {
    target = new URL(raw)
    if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('protocol')
  } catch {
    return NextResponse.json({ error: 'Provide a valid http(s) URL' }, { status: 400 })
  }

  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 6000)

  try {
    // GET (not HEAD) — some hosts answer HEAD differently; body is never read.
    const res = await fetch(target.toString(), {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'ToolHubEmbedCheck/2.0' },
    })
    void res.body?.cancel().catch(() => undefined)
    const { verdict, reason } = analyzeHeaders(res.headers, res.status, res.url || target.toString())
    const report: EmbedReport = {
      url: target.toString(),
      finalUrl: res.url || target.toString(),
      status: res.status,
      verdict,
      reason,
      checkedMs: Date.now() - started,
    }
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const aborted = err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted)
    const report: EmbedReport = {
      url: target.toString(),
      finalUrl: target.toString(),
      status: null,
      verdict: 'unknown',
      reason: aborted
        ? 'The site took longer than 6s to respond — try again or open it directly'
        : 'The site could not be reached from the hub server (DNS/network error)',
      checkedMs: Date.now() - started,
    }
    return NextResponse.json(report, { headers: { 'Cache-Control': 'no-store' } })
  } finally {
    clearTimeout(timer)
  }
}
