'use client'

/**
 * Shared video clip library — the bridge between Video Studio (editor),
 * Video Player (viewer) and the QR transfer receive flow.
 *
 * DB: toolhub-video (v1)
 *   clips — ClipRecord  (metadata + tiny poster data URL; cheap to list)
 *   blobs — { id, blob } (the actual video bytes; loaded only on demand)
 */

export interface ClipRecord {
  id: string
  name: string
  mime: string
  size: number
  /** seconds, when known */
  duration?: number
  /** small JPEG poster (first frame) — optional */
  poster?: string
  createdAt: number
  /** where the clip came from */
  origin: 'import' | 'received'
}

const DB_NAME = 'toolhub-video'
const DB_VERSION = 1
const S_CLIPS = 'clips'
const S_BLOBS = 'blobs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(S_CLIPS)) db.createObjectStore(S_CLIPS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(S_BLOBS)) db.createObjectStore(S_BLOBS, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open toolhub-video'))
    req.onblocked = () => reject(new Error('toolhub-video is open in another tab'))
  })
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = run(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
        t.oncomplete = () => db.close()
        t.onabort = () => {
          db.close()
          reject(t.error ?? new Error('IndexedDB transaction aborted'))
        }
      })
  )
}

export function newClipId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** All clips, newest first (metadata only — no video bytes). */
export async function listClips(): Promise<ClipRecord[]> {
  try {
    const all = await tx<ClipRecord[]>(S_CLIPS, 'readonly', (s) => s.getAll() as IDBRequest<ClipRecord[]>)
    return all.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export async function getClipMeta(id: string): Promise<ClipRecord | undefined> {
  try {
    return await tx<ClipRecord | undefined>(S_CLIPS, 'readonly', (s) =>
      s.get(id) as IDBRequest<ClipRecord | undefined>
    )
  } catch {
    return undefined
  }
}

export async function getClipBlob(id: string): Promise<Blob | undefined> {
  try {
    const rec = await tx<{ id: string; blob: Blob } | undefined>(S_BLOBS, 'readonly', (s) =>
      s.get(id) as IDBRequest<{ id: string; blob: Blob } | undefined>
    )
    return rec?.blob
  } catch {
    return undefined
  }
}

/** Persist a clip (metadata + bytes) in one call. */
export async function putClip(rec: ClipRecord, blob: Blob): Promise<void> {
  await tx(S_CLIPS, 'readwrite', (s) => s.put(stripBlob(rec)) as IDBRequest<IDBValidKey>)
  await tx(S_BLOBS, 'readwrite', (s) => s.put({ id: rec.id, blob }) as IDBRequest<IDBValidKey>)
}

export async function deleteClip(id: string): Promise<void> {
  await tx(S_CLIPS, 'readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>)
  await tx(S_BLOBS, 'readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>)
}

function stripBlob(rec: ClipRecord): ClipRecord {
  return { ...rec }
}

/**
 * Grab a poster frame from a video Blob (first ~0.4s) as a small JPEG
 * data URL. Falls back gracefully — posters are decorative.
 */
export function makePoster(blob: Blob): Promise<string | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob)
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'metadata'
    const finish = (poster?: string) => {
      v.removeAttribute('src')
      v.load()
      URL.revokeObjectURL(url)
      resolve(poster)
    }
    const fail = () => finish(undefined)
    const timer = setTimeout(() => fail(), 6000)
    v.onerror = fail
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(0.4, (v.duration || 1) / 4)
      } catch {
        fail()
      }
    }
    v.onseeked = () => {
      try {
        const scale = Math.min(1, 360 / Math.max(v.videoWidth || 360, v.videoHeight || 200))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round((v.videoWidth || 360) * scale))
        c.height = Math.max(1, Math.round((v.videoHeight || 200) * scale))
        const ctx = c.getContext('2d')
        if (!ctx) throw new Error('no canvas')
        ctx.drawImage(v, 0, 0, c.width, c.height)
        clearTimeout(timer)
        finish(c.toDataURL('image/jpeg', 0.72))
      } catch {
        clearTimeout(timer)
        fail()
      }
    }
    v.src = url
  })
}

/** Grab a poster from a <video> element that is already showing the frame. */
export function posterFromElement(v: HTMLVideoElement): string | undefined {
  try {
    if (!v.videoWidth || !v.videoHeight) return undefined
    const scale = Math.min(1, 360 / Math.max(v.videoWidth, v.videoHeight))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(v.videoWidth * scale))
    c.height = Math.max(1, Math.round(v.videoHeight * scale))
    const ctx = c.getContext('2d')
    if (!ctx) return undefined
    ctx.drawImage(v, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.72)
  } catch {
    return undefined
  }
}
