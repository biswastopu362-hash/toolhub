'use client'

/**
 * Device media layer — native-software style access to the user's real files.
 *
 * Uses the File System Access API (Chromium): the user picks a folder ONCE
 * (e.g. their Pictures / Music / home directory), the directory handle is
 * persisted in IndexedDB, and from then on every app in the hub can list and
 * read those files directly — no uploading, no copying. Handles are
 * duck-typed so the indexer can also be exercised with synthetic handles.
 *
 * DB: toolhub-device (v1)
 *   handles  — { key: 'root', handle, connectedAt }
 *   entries  — DeviceEntry[] (flat index of the whole tree)
 *   meta     — { key: 'index', at, count }
 */

/* ------------------------------------------------------------------ */
/* Minimal structural types (duck-typed → testable with fakes)         */
/* ------------------------------------------------------------------ */

export interface FsFileHandle {
  kind: 'file'
  name: string
  getFile: () => Promise<File>
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
}

export interface FsDirHandle {
  kind: 'directory'
  name: string
  values: () => AsyncIterableIterator<FsFileHandle | FsDirHandle>
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
  getDirectoryHandle?: (name: string) => Promise<FsDirHandle>
  getFileHandle?: (name: string) => Promise<FsFileHandle>
  removeEntry?: (name: string, opts?: { recursive?: boolean }) => Promise<void>
}

export type DeviceKind = 'image' | 'video' | 'audio' | 'file'

export interface DeviceEntry {
  /** path within the connected root, joined with '/' (root itself excluded) */
  id: string
  /** path segments (dirs…, filename) relative to root */
  segs: string[]
  name: string
  dir: boolean
  kind: DeviceKind
  ext: string
  size: number
  lastModified: number
  /** id of parent folder ('' for top level) */
  parent: string
}

export interface DeviceMeta {
  at: number
  count: number
}

/* ------------------------------------------------------------------ */
/* IndexedDB plumbing                                                  */
/* ------------------------------------------------------------------ */

const DB_NAME = 'toolhub-device'
const DB_VERSION = 1
const S_HANDLES = 'handles'
const S_ENTRIES = 'entries'
const S_META = 'meta'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(S_HANDLES)) db.createObjectStore(S_HANDLES, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(S_ENTRIES)) db.createObjectStore(S_ENTRIES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(S_META)) db.createObjectStore(S_META, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open toolhub-device'))
  })
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = run(t.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
        t.oncomplete = () => db.close()
      })
  )
}

function bulkPut(entries: DeviceEntry[]): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const t = db.transaction(S_ENTRIES, 'readwrite')
        const s = t.objectStore(S_ENTRIES)
        s.clear()
        for (const e of entries) s.put(e)
        t.oncomplete = () => {
          db.close()
          resolve()
        }
        t.onerror = () => reject(t.error ?? new Error('Index write failed'))
      })
  )
}

/* ------------------------------------------------------------------ */
/* Feature detection + classification                                  */
/* ------------------------------------------------------------------ */

interface PickerWindow {
  showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FsDirHandle>
}

export function fsSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function'
}

const IMG_EXT = 'jpg jpeg png gif webp bmp avif svg heic heif ico'
const VID_EXT = 'mp4 webm mov mkv avi m4v mpg mpeg 3gp'
const AUD_EXT = 'mp3 wav ogg oga m4a flac aac opus weba mid midi'

function classify(name: string): { kind: DeviceKind; ext: string } {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  if (IMG_EXT.split(' ').includes(ext)) return { kind: 'image', ext }
  if (VID_EXT.split(' ').includes(ext)) return { kind: 'video', ext }
  if (AUD_EXT.split(' ').includes(ext)) return { kind: 'audio', ext }
  return { kind: 'file', ext }
}

const SKIP_DIR = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.next',
  'dist',
  'build',
  'out',
  '$RECYCLE.BIN',
  'System Volume Information',
  'AppData',
])

/* ------------------------------------------------------------------ */
/* Root handle — connect / reconnect / disconnect                      */
/* ------------------------------------------------------------------ */

interface RootRecord {
  key: 'root'
  handle: FsDirHandle
  connectedAt: number
}

export async function connectRoot(): Promise<FsDirHandle> {
  const w = window as PickerWindow
  if (!w.showDirectoryPicker) throw new Error('unsupported')
  const handle = await w.showDirectoryPicker({ mode: 'read', id: 'toolhub-device-root' })
  await tx(S_HANDLES, 'readwrite', (s) => s.put({ key: 'root', handle, connectedAt: Date.now() }) as IDBRequest<IDBValidKey>)
  return handle
}

/** Dev-only in-memory root override (never persists; stripped in production). */
let devRootOverride: FsDirHandle | undefined

export async function getRoot(): Promise<FsDirHandle | undefined> {
  if (devRootOverride) return devRootOverride
  try {
    const rec = await tx<RootRecord | undefined>(S_HANDLES, 'readonly', (s) =>
      s.get('root') as IDBRequest<RootRecord | undefined>
    )
    return rec?.handle
  } catch {
    return undefined
  }
}

export async function accessState(handle: FsDirHandle): Promise<PermissionState> {
  try {
    return (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted'
  } catch {
    return 'denied'
  }
}

/** Must be called from a user gesture when state is 'prompt'. */
export async function requestAccess(handle: FsDirHandle): Promise<boolean> {
  try {
    const state = (await handle.requestPermission?.({ mode: 'read' })) ?? 'granted'
    return state === 'granted'
  } catch {
    return false
  }
}

export async function disconnectRoot(): Promise<void> {
  await tx(S_HANDLES, 'readwrite', (s) => s.delete('root') as IDBRequest<undefined>)
  await bulkPut([])
  await tx(S_META, 'readwrite', (s) => s.delete('index') as IDBRequest<undefined>)
}

/* ------------------------------------------------------------------ */
/* Indexing — fast metadata walk of the whole tree (no file reads)     */
/* ------------------------------------------------------------------ */

export const INDEX_LIMIT = 25_000

export async function indexRoot(
  handle: FsDirHandle,
  onProgress?: (count: number) => void,
  signal?: { aborted: boolean }
): Promise<DeviceMeta> {
  const entries: DeviceEntry[] = []
  let aborted = false

  async function walk(dir: FsDirHandle, segs: string[], depth: number): Promise<void> {
    if (depth > 10 || entries.length >= INDEX_LIMIT || signal?.aborted) {
      if (entries.length >= INDEX_LIMIT) aborted = true
      return
    }
    try {
      for await (const ch of dir.values()) {
        if (signal?.aborted || entries.length >= INDEX_LIMIT) {
          if (entries.length >= INDEX_LIMIT) aborted = true
          return
        }
        if (ch.kind === 'directory') {
          if (ch.name.startsWith('.') || SKIP_DIR.has(ch.name)) continue
          const childSegs = [...segs, ch.name]
          entries.push({
            id: childSegs.join('/'),
            segs: childSegs,
            name: ch.name,
            dir: true,
            kind: 'file',
            ext: '',
            size: 0,
            lastModified: 0,
            parent: segs.join('/'),
          })
          if (onProgress && entries.length % 200 === 0) onProgress(entries.length)
          await walk(ch, childSegs, depth + 1)
        } else {
          const { kind, ext } = classify(ch.name)
          let size = 0
          let lastModified = 0
          try {
            const f = await ch.getFile()
            size = f.size
            lastModified = f.lastModified
          } catch {
            /* unreadable — keep metadata-only entry */
          }
          const childSegs = [...segs, ch.name]
          entries.push({
            id: childSegs.join('/'),
            segs: childSegs,
            name: ch.name,
            dir: false,
            kind,
            ext,
            size,
            lastModified,
            parent: segs.join('/'),
          })
          if (onProgress && entries.length % 100 === 0) onProgress(entries.length)
        }
      }
    } catch {
      /* unreadable directory — skip */
    }
  }

  await walk(handle, [], 0)
  const meta: DeviceMeta = { at: Date.now(), count: entries.length }
  await bulkPut(entries)
  await tx(S_META, 'readwrite', (s) => s.put({ key: 'index', ...meta }) as IDBRequest<IDBValidKey>)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('toolhub:device-indexed'))
  if (aborted && onProgress) onProgress(-1)
  return meta
}

export async function indexMeta(): Promise<DeviceMeta | undefined> {
  try {
    const rec = await tx<(DeviceMeta & { key: string }) | undefined>(S_META, 'readonly', (s) =>
      s.get('index') as IDBRequest<DeviceMeta & { key: string } | undefined>
    )
    return rec ? { at: rec.at, count: rec.count } : undefined
  } catch {
    return undefined
  }
}

/** Index if never done or older than maxAge. Returns fresh meta (or undefined without access). */
export async function ensureFreshIndex(
  maxAgeMs = 10 * 60_000,
  onProgress?: (count: number) => void
): Promise<DeviceMeta | undefined> {
  const root = await getRoot()
  if (!root) return undefined
  if ((await accessState(root)) !== 'granted') return undefined
  const meta = await indexMeta()
  if (meta && Date.now() - meta.at < maxAgeMs) return meta
  return indexRoot(root, onProgress)
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listEntries(filter?: {
  dir?: boolean
  kinds?: DeviceKind[]
  parent?: string
}): Promise<DeviceEntry[]> {
  try {
    const all = await tx<DeviceEntry[]>(S_ENTRIES, 'readonly', (s) => s.getAll() as IDBRequest<DeviceEntry[]>)
    let out = all
    if (filter) {
      out = all.filter((e) => {
        if (filter.dir !== undefined && e.dir !== filter.dir) return false
        if (filter.parent !== undefined && e.parent !== filter.parent) return false
        if (filter.kinds && !e.dir && !filter.kinds.includes(e.kind)) return false
        return true
      })
    }
    return out.sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1
      const segsA = a.segs.length
      const segsB = b.segs.length
      if (a.parent === b.parent && segsA === segsB) return a.name.localeCompare(b.name)
      return a.id.localeCompare(b.id)
    })
  } catch {
    return []
  }
}

export async function getEntry(id: string): Promise<DeviceEntry | undefined> {
  try {
    return await tx<DeviceEntry | undefined>(S_ENTRIES, 'readonly', (s) =>
      s.get(id) as IDBRequest<DeviceEntry | undefined>
    )
  } catch {
    return undefined
  }
}

/** Count of non-dir entries per kind — cheap stats for UI badges. */
export async function kindCounts(): Promise<Record<DeviceKind, number>> {
  const all = await listEntries({ dir: false })
  const out: Record<DeviceKind, number> = { image: 0, video: 0, audio: 0, file: 0 }
  for (const e of all) out[e.kind]++
  return out
}

/* ------------------------------------------------------------------ */
/* File access & mutations                                             */
/* ------------------------------------------------------------------ */

export async function getFileFor(entry: DeviceEntry): Promise<File> {
  const root = await getRoot()
  if (!root) throw new Error('No device folder connected')
  if ((await accessState(root)) !== 'granted') throw new Error('Access not granted')
  let dir: FsDirHandle = root
  for (const seg of entry.segs.slice(0, -1)) {
    if (!dir.getDirectoryHandle) throw new Error('Cannot traverse handle')
    dir = await dir.getDirectoryHandle(seg)
  }
  if (!dir.getFileHandle) throw new Error('Cannot read handle')
  const fh = await dir.getFileHandle(entry.name)
  return fh.getFile()
}

/** Local, resolvable URL for viewing/downloading. Caller revokes. */
export async function entryUrl(entry: DeviceEntry): Promise<string> {
  const file = await getFileFor(entry)
  return URL.createObjectURL(file)
}

export async function deleteEntry(entry: DeviceEntry): Promise<number> {
  const root = await getRoot()
  if (!root?.removeEntry || !root.getDirectoryHandle) throw new Error('Delete unsupported')
  let dir: FsDirHandle = root
  for (const seg of entry.segs.slice(0, -1)) {
    if (!dir.getDirectoryHandle) throw new Error('Cannot traverse handle')
    dir = await dir.getDirectoryHandle(seg)
  }
  if (!dir.removeEntry) throw new Error('Delete unsupported')
  await dir.removeEntry(entry.name, { recursive: entry.dir })
  // purge from index (entry +, for dirs, all descendants)
  const all = await listEntries()
  const doomed = new Set([entry.id])
  if (entry.dir) for (const e of all) if (e.id.startsWith(entry.id + '/')) doomed.add(e.id)
  const kept = all.filter((e) => !doomed.has(e.id))
  await bulkPut(kept)
  const meta = { key: 'index', at: Date.now(), count: kept.length }
  await tx(S_META, 'readwrite', (s) => s.put(meta) as IDBRequest<IDBValidKey>)
  return doomed.size
}

/* ------------------------------------------------------------------ */
/* Lazy thumbnails (in-memory LRU — nothing is copied to the cloud)    */
/* ------------------------------------------------------------------ */

const thumbCache = new Map<string, string>()
const THUMB_CAP = 600

export function peekThumb(id: string): string | undefined {
  return thumbCache.get(id)
}

export function cachedThumb(id: string): string | undefined {
  const hit = thumbCache.get(id)
  if (hit) {
    // refresh recency
    thumbCache.delete(id)
    thumbCache.set(id, hit)
  }
  return hit
}

function stashThumb(id: string, dataUrl: string): string {
  if (thumbCache.size >= THUMB_CAP) {
    const oldest = thumbCache.keys().next().value
    if (oldest) {
      thumbCache.delete(oldest)
    }
  }
  thumbCache.set(id, dataUrl)
  return dataUrl
}

function imageThumb(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('decode failed'))
    }
    img.onload = () => {
      const scale = Math.min(1, 320 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(img.width * scale))
      c.height = Math.max(1, Math.round(img.height * scale))
      const ctx = c.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('no canvas'))
        return
      }
      ctx.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/jpeg', 0.72))
    }
    img.src = url
  })
}

function videoThumb(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.muted = true
    const fail = () => {
      v.removeAttribute('src')
      URL.revokeObjectURL(url)
      reject(new Error('video thumb failed'))
    }
    const timer = setTimeout(fail, 5000)
    v.onerror = fail
    v.onloadeddata = () => {
      try {
        v.currentTime = Math.min(0.5, (v.duration || 1) / 3)
      } catch {
        fail()
      }
    }
    v.onseeked = () => {
      try {
        const scale = Math.min(1, 320 / Math.max(v.videoWidth || 320, v.videoHeight || 180))
        const c = document.createElement('canvas')
        c.width = Math.max(1, Math.round((v.videoWidth || 320) * scale))
        c.height = Math.max(1, Math.round((v.videoHeight || 180) * scale))
        const ctx = c.getContext('2d')
        if (!ctx) throw new Error('no canvas')
        ctx.drawImage(v, 0, 0, c.width, c.height)
        clearTimeout(timer)
        v.removeAttribute('src')
        URL.revokeObjectURL(url)
        resolve(c.toDataURL('image/jpeg', 0.7))
      } catch (err) {
        clearTimeout(timer)
        fail()
      }
    }
    v.src = url
  })
}

/** Resolve a thumbnail for a media entry (images + videos). Falls back gracefully. */
export async function thumbFor(entry: DeviceEntry): Promise<string | undefined> {
  if (entry.dir || entry.kind === 'audio' || entry.kind === 'file') return undefined
  const hit = cachedThumb(entry.id)
  if (hit) return hit
  try {
    const file = await getFileFor(entry)
    const dataUrl = entry.kind === 'image' ? await imageThumb(file) : await videoThumb(file)
    return stashThumb(entry.id, dataUrl)
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------------ */
/* Dev-only test hook (stripped from production builds)                */
/* ------------------------------------------------------------------ */

if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  interface DevHook {
    setRoot(h: FsDirHandle): void
    index(): Promise<DeviceMeta | undefined>
    entries(): Promise<DeviceEntry[]>
  }
  const hook: DevHook = {
    setRoot(h) {
      devRootOverride = h
    },
    async index() {
      const root = await getRoot()
      if (!root) return undefined
      return indexRoot(root)
    },
    async entries() {
      return listEntries()
    },
  }
  ;(window as unknown as { __deviceMedia?: DevHook }).__deviceMedia = hook
}
