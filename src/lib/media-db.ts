'use client'

/**
 * Shared IndexedDB store for binary media (photos created by Camera,
 * Gallery uploads, Paint exports, Video Studio frame grabs).
 *
 * Contract used by multiple apps — DO NOT change the schema shape without
 * checking gallery.tsx / camera.tsx / paint-studio.tsx / video-studio.tsx.
 *
 * DB:   toolhub-media  (version 1)
 * Store: photos (keyPath 'id')
 */

export type PhotoSource = 'camera' | 'upload' | 'paint' | 'video'

export interface PhotoRecord {
  id: string
  /** data URL (image/jpeg|png|webp) */
  dataUrl: string
  createdAt: number
  fav: boolean
  source: PhotoSource
  /** optional display name, e.g. original filename */
  name?: string
}

const DB_NAME = 'toolhub-media'
const DB_VERSION = 1
const STORE = 'photos'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open toolhub-media'))
  })
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
        t.oncomplete = () => db.close()
      })
  )
}

export async function listPhotos(): Promise<PhotoRecord[]> {
  try {
    const all = await tx<PhotoRecord[]>('readonly', (s) => s.getAll() as IDBRequest<PhotoRecord[]>)
    return all.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

export async function putPhoto(rec: PhotoRecord): Promise<void> {
  await tx('readwrite', (s) => s.put(rec) as IDBRequest<IDBValidKey>)
}

export async function deletePhoto(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>)
}

export async function toggleFav(id: string, fav: boolean): Promise<void> {
  const rec = await tx<PhotoRecord | undefined>('readonly', (s) => s.get(id) as IDBRequest<PhotoRecord | undefined>)
  if (rec) await tx('readwrite', (s) => s.put({ ...rec, fav }) as IDBRequest<IDBValidKey>)
}

export function newPhotoId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** Compress any image source into a reasonably sized JPEG data URL. */
export function fileToDataUrl(file: File | Blob, maxSize = 2048, quality = 0.86): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Unsupported image'))
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas unavailable'))
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
