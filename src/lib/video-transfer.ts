'use client'

/**
 * Client half of the QR transfer relay (see /api/transfer).
 *
 * uploadTransfer()  — chunks a Blob into ~3 MB base64 POSTs, returns the id
 * downloadTransfer() — streams a GET with live progress, returns the Blob
 */

const CHUNK_BYTES = 3 * 1024 * 1024

async function postJson(body: unknown, signal?: AbortSignal): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch('/api/transfer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    /* non-JSON error body */
  }
  return { ok: res.ok, status: res.status, data }
}

function errFrom(data: Record<string, unknown>, fallback: string): Error {
  return new Error(typeof data.error === 'string' ? data.error : fallback)
}

/* stack-safe base64 for multi-MB chunks */
function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode(...bytes.subarray(i, i + step))
  }
  return btoa(out)
}

export interface UploadCallbacks {
  onProgress?: (sent: number, total: number) => void
  signal?: AbortSignal
}

/** Upload a file to the relay; resolves with the transfer id. */
export async function uploadTransfer(
  file: Blob,
  meta: { name: string; mime: string },
  { onProgress, signal }: UploadCallbacks = {}
): Promise<string> {
  const init = await postJson({ op: 'init', name: meta.name, mime: meta.mime, size: file.size }, signal)
  if (!init.ok) throw errFrom(init.data, 'Could not start the transfer')
  const id = typeof init.data.id === 'string' ? init.data.id : ''
  const chunks = typeof init.data.chunks === 'number' ? init.data.chunks : 0
  if (!id || chunks <= 0) throw new Error('Relay returned an invalid transfer')

  for (let i = 0; i < chunks; i++) {
    const slice = file.slice(i * CHUNK_BYTES, Math.min(file.size, (i + 1) * CHUNK_BYTES))
    const bytes = new Uint8Array(await slice.arrayBuffer())
    const res = await postJson({ op: 'chunk', id, index: i, data: bytesToBase64(bytes) }, signal)
    if (!res.ok) throw errFrom(res.data, `Upload failed at chunk ${i + 1}/${chunks}`)
    onProgress?.(Math.min(file.size, (i + 1) * CHUNK_BYTES), file.size)
  }

  const done = await postJson({ op: 'done', id }, signal)
  if (!done.ok) throw errFrom(done.data, 'Could not finalize the transfer')
  return id
}

export interface DownloadCallbacks {
  onProgress?: (received: number, total: number) => void
  signal?: AbortSignal
}

export interface DownloadedTransfer {
  blob: Blob
  name: string
  mime: string
}

/** Download + assemble a transfer; streams progress when possible. */
export async function downloadTransfer(
  id: string,
  { onProgress, signal }: DownloadCallbacks = {}
): Promise<DownloadedTransfer> {
  const res = await fetch(`/api/transfer?id=${encodeURIComponent(id)}`, { signal })
  let data: Record<string, unknown> = {}
  try {
    data = (await res.clone().json()) as Record<string, unknown>
  } catch {
    /* binary body — expected on success */
  }
  if (!res.ok) throw errFrom(data, 'Transfer unavailable — it may have expired')

  let name = 'clip'
  try {
    name = decodeURIComponent(res.headers.get('X-Transfer-Name') ?? 'clip')
  } catch {
    /* keep default name */
  }
  const mime = res.headers.get('Content-Type') ?? 'application/octet-stream'
  const total = Number(res.headers.get('Content-Length') ?? 0)

  if (res.body && total > 0) {
    const reader = res.body.getReader()
    const parts: Uint8Array[] = []
    let received = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        parts.push(value)
        received += value.byteLength
        onProgress?.(received, total)
      }
    }
    return { blob: new Blob(parts as BlobPart[], { type: mime }), name, mime }
  }

  const blob = await res.blob()
  onProgress?.(blob.size, blob.size)
  return { blob, name, mime }
}
