import { NextResponse } from 'next/server'

/**
 * QR Transfer relay — moves a video (or any file) between two devices that
 * both have ToolHub open. The sender uploads in ~3 MB chunks (stays well
 * under the 4.5 MB serverless request-body cap), gets a short transfer id,
 * and the receiver downloads the assembled file with one GET.
 *
 * Storage: in-memory with a 30 minute TTL. Nothing is written to disk and
 * nothing outlives the process — this is a relay, not a host.
 *
 *   POST { op:'init',  name, mime, size }        -> { id, chunks, ttlMs }
 *   POST { op:'chunk', id, index, data(b64) }    -> { ok, received }
 *   POST { op:'done',  id }                      -> { ok, exp }
 *   GET  /api/transfer?id=<id>                   -> binary (X-Transfer-Name)
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TTL_MS = 30 * 60_000
/** Binary bytes per chunk — base64 makes the JSON body ≈4.0 MB, under the cap. */
const CHUNK_BYTES = 3 * 1024 * 1024
const MAX_TOTAL = 120 * 1024 * 1024
/** Concurrent-transfer guard so one box can't be OOM'd by parked uploads. */
const MAX_ACTIVE = 40

interface TransferMeta {
  name: string
  mime: string
  size: number
  chunks: number
}

interface Transfer {
  meta: TransferMeta
  parts: (Uint8Array | null)[]
  createdAt: number
  received: number
}

/* Survives route-module reloads within the same process. */
const store = globalThis as typeof globalThis & { __toolhubTransfers?: Map<string, Transfer> }
const transfers: Map<string, Transfer> = store.__toolhubTransfers ?? new Map()
store.__toolhubTransfers = transfers

function sweep(): void {
  const now = Date.now()
  for (const [id, t] of transfers) if (now - t.createdAt > TTL_MS) transfers.delete(id)
}

function newId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/* ------------------------------------------------------------------ */
/* GET — assembled download                                            */
/* ------------------------------------------------------------------ */

export async function GET(request: Request): Promise<NextResponse> {
  sweep()
  const id = new URL(request.url).searchParams.get('id')?.trim()
  if (!id) return jsonError('Missing transfer id', 400)

  const t = transfers.get(id)
  if (!t) return jsonError('Transfer not found — it may have expired. Ask the sender to share the QR again.', 404)
  if (t.parts.some((p) => p === null)) {
    return jsonError('Transfer is still uploading — wait a moment and retry.', 409)
  }

  const parts = t.parts as Uint8Array[]
  const total = parts.reduce((n, p) => n + p.byteLength, 0)
  const merged = new Uint8Array(total)
  let at = 0
  for (const p of parts) {
    merged.set(p, at)
    at += p.byteLength
  }

  return new NextResponse(merged, {
    headers: {
      'Content-Type': t.meta.mime || 'application/octet-stream',
      'Content-Length': String(merged.byteLength),
      'X-Transfer-Name': encodeURIComponent(t.meta.name || 'clip'),
      'Cache-Control': 'no-store',
    },
  })
}

/* ------------------------------------------------------------------ */
/* POST — init / chunk / done                                          */
/* ------------------------------------------------------------------ */

interface ParsedBody {
  op?: unknown
  id?: unknown
  name?: unknown
  mime?: unknown
  size?: unknown
  index?: unknown
  data?: unknown
}

export async function POST(request: Request): Promise<NextResponse> {
  sweep()

  let raw: ParsedBody
  try {
    raw = (await request.json()) as ParsedBody
  } catch {
    return jsonError('Invalid request body', 400)
  }

  /* ---- init ---- */
  if (raw.op === 'init') {
    const size = typeof raw.size === 'number' && isFinite(raw.size) ? raw.size : 0
    if (size <= 0) return jsonError('File size missing', 400)
    if (size > MAX_TOTAL) return jsonError('File is too large for QR transfer (max 120 MB)', 413)
    if (transfers.size >= MAX_ACTIVE) return jsonError('Relay is busy — try again shortly', 429)

    const meta: TransferMeta = {
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 200) : 'clip',
      mime: typeof raw.mime === 'string' && raw.mime ? raw.mime.slice(0, 120) : 'video/mp4',
      size,
      chunks: Math.max(1, Math.ceil(size / CHUNK_BYTES)),
    }
    const id = newId()
    transfers.set(id, { meta, parts: new Array(meta.chunks).fill(null), createdAt: Date.now(), received: 0 })
    return NextResponse.json({ id, chunks: meta.chunks, ttlMs: TTL_MS })
  }

  /* ---- chunk ---- */
  if (raw.op === 'chunk') {
    const t = typeof raw.id === 'string' ? transfers.get(raw.id) : undefined
    if (!t) return jsonError('Transfer not found — it may have expired', 404)
    const idx = typeof raw.index === 'number' ? Math.floor(raw.index) : -1
    if (idx < 0 || idx >= t.meta.chunks) return jsonError('Chunk index out of range', 400)
    if (typeof raw.data !== 'string') return jsonError('Chunk data missing', 400)

    let buf: Uint8Array
    try {
      buf = new Uint8Array(Buffer.from(raw.data, 'base64'))
    } catch {
      return jsonError('Chunk is not valid base64', 400)
    }
    if (buf.byteLength > CHUNK_BYTES) return jsonError('Chunk too large', 413)
    if (buf.byteLength === 0) return jsonError('Chunk is empty', 400)

    if (!t.parts[idx]) t.received += buf.byteLength
    t.parts[idx] = buf
    return NextResponse.json({ ok: true, received: t.received })
  }

  /* ---- done ---- */
  if (raw.op === 'done') {
    const t = typeof raw.id === 'string' ? transfers.get(raw.id) : undefined
    if (!t) return jsonError('Transfer not found — it may have expired', 404)
    const missing = t.parts.findIndex((p) => p === null)
    if (missing >= 0) return NextResponse.json({ error: 'Missing chunks', missing }, { status: 409 })
    return NextResponse.json({ ok: true, exp: t.createdAt + TTL_MS })
  }

  return jsonError('Unknown operation', 400)
}
