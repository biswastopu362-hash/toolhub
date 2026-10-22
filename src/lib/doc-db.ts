'use client'

/**
 * IndexedDB key-value store for Design Studio document drafts.
 *
 * Imported PDF/Word pages carry multi-megabyte data-URL backgrounds, which
 * blow past the ~5 MB localStorage cap — so drafts live here instead.
 * Completely independent of toolhub-media (whose schema is a shared contract).
 *
 * DB:    toolhub-docs (version 1)
 * Store: kv (keyPath 'key')
 */

const DB_NAME = 'toolhub-docs'
const DB_VERSION = 1
const STORE = 'kv'

export interface KvRecord {
  key: string
  value: unknown
  at: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open toolhub-docs'))
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

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const rec = await tx<KvRecord | undefined>('readonly', (s) => s.get(key) as IDBRequest<KvRecord | undefined>)
    return rec?.value as T | undefined
  } catch {
    return undefined
  }
}

export async function kvPut(key: string, value: unknown): Promise<void> {
  try {
    await tx('readwrite', (s) => s.put({ key, value, at: Date.now() }) as IDBRequest<IDBValidKey>)
  } catch {
    /* storage unavailable — draft simply not persisted */
  }
}

export async function kvDel(key: string): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(key) as unknown as IDBRequest<undefined>)
  } catch {
    /* ignore */
  }
}
