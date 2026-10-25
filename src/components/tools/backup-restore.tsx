'use client'

/**
 * Backup & Restore — your OS, portable.
 *
 * Scans EVERYTHING ToolHub keeps on this device (every localStorage key +
 * every IndexedDB database/store: photos, video clips, expense entries,
 * document drafts, music, the device file index), previews it with sizes,
 * and packs the checked sources into ONE JSON file. Restoring on a new
 * device replays that file back into the same stores, creating any missing
 * databases along the way.
 *
 * PRIVACY: the backup file is generated and consumed entirely on this
 * device — it never touches any server.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Check,
  CheckCircle2,
  DatabaseBackup,
  FileJson,
  HardDrive,
  HardDriveDownload,
  Loader2,
  Package,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Known data map — labels for every store ToolHub owns                */
/* ================================================================== */

interface LsMeta {
  label: string
  hint: string
}

const LS_KEYS: Record<string, LsMeta> = {
  'toolhub-store': { label: 'System & home screen', hint: 'wallpaper, accent, layout, installed apps, App Lock' },
  'toolhub-notes': { label: 'Notes', hint: 'all notebooks content' },
  'toolhub-notes-folders': { label: 'Notes folders', hint: 'folder list, icons & counts' },
  'toolhub-reminders': { label: 'Reminders', hint: 'tasks and due dates' },
  'toolhub-calc-history': { label: 'Calculator history', hint: 'past calculations' },
  'toolhub-sheet-draft': { label: 'Spreadsheet draft', hint: 'auto-saved workbook state' },
  'toolhub-goals:v1': { label: 'Goal tracker', hint: 'goals and progress' },
  'toolhub.ai-chat.messages': { label: 'AI Assistant chats', hint: 'conversation history' },
  'toolhub.music-player.state': { label: 'Music player state', hint: 'queue & playback position' },
  'toolhub.calendar.events': { label: 'Calendar events', hint: 'events and reminders' },
  'toolhub.2048.best': { label: '2048 best score', hint: 'high score' },
  'toolhub-translator-prefs': { label: 'Translator preferences', hint: 'language pair' },
  'toolhub-translator-history': { label: 'Translator history', hint: 'past translations' },
  'toolhub-tts-prefs': { label: 'Text-to-Speech preferences', hint: 'voice & speed' },
  'toolhub-tts-history': { label: 'Text-to-Speech history', hint: 'generated speech items' },
  'toolhub-stt-lang': { label: 'Speech-to-Text language', hint: 'recognition language' },
  'toolhub-stt-history': { label: 'Speech-to-Text history', hint: 'past transcriptions' },
  'toolhub-canva:draft:v1': { label: 'Design draft (legacy)', hint: 'old localStorage draft' },
  'toolhub.mode': { label: 'Theme mode', hint: 'light / dark / amoled / system' },
  'toolhub.accent': { label: 'Accent color', hint: 'system-wide color palette' },
  'toolhub-install-banner-dismissed': { label: 'Install banner', hint: 'dismissed state' },
  'currency-rates': { label: 'Currency rates cache', hint: 'offline exchange rates' },
  'weather-cache': { label: 'Weather cache', hint: 'recent forecasts' },
  'weather-unit': { label: 'Weather units', hint: '°C / °F preference' },
}

/** Playback positions are written per video (`toolhub-vp:<kind>:<id>`). */
const LS_PREFIXES: Array<{ prefix: string; label: string; hint: string }> = [
  { prefix: 'toolhub-vp:', label: 'Video playback positions', hint: 'resume points for each clip' },
]

interface StoreMeta {
  keyPath: string
  label: string
  /** true → shown for completeness but excluded from the backup file */
  nonPortable?: boolean
}

interface DbMeta {
  label: string
  stores: Record<string, StoreMeta>
}

/** Versioned shapes mirrored from media-db / video-db / doc-db / device-media / expense-tracker / music-player. */
const IDB_DBS: Record<string, DbMeta> = {
  'toolhub-media': {
    label: 'Photos & images',
    stores: { photos: { keyPath: 'id', label: 'Photos' } },
  },
  'toolhub-video': {
    label: 'Video clips',
    stores: {
      clips: { keyPath: 'id', label: 'Clip details' },
      blobs: { keyPath: 'id', label: 'Video files' },
    },
  },
  'toolhub-docs': {
    label: 'Design documents',
    stores: { kv: { keyPath: 'key', label: 'Document drafts' } },
  },
  'toolhub-device': {
    label: 'Device file index',
    stores: {
      handles: { keyPath: 'key', label: 'Folder connections', nonPortable: true },
      entries: { keyPath: 'id', label: 'File index' },
      meta: { keyPath: 'key', label: 'Index metadata' },
    },
  },
  'toolhub-expenses': {
    label: 'Expense Tracker',
    stores: {
      transactions: { keyPath: 'id', label: 'Transactions' },
      settings: { keyPath: 'key', label: 'Budget & settings' },
    },
  },
  'toolhub-audio': {
    label: 'Music library',
    stores: { tracks: { keyPath: 'id', label: 'Tracks' } },
  },
}

/* ================================================================== */
/* Backup file schema                                                  */
/* ================================================================== */

interface BackupFile {
  app: 'toolhub'
  schema: 1
  createdAt: string
  localStorage: Record<string, string>
  indexedDB: Record<string, Record<string, unknown[]>>
}

type SourceKind = 'ls' | 'idb'

interface Source {
  id: string
  kind: SourceKind
  lsKey?: string
  db?: string
  store?: string
  label: string
  sub: string
  count: number
  /** approximate serialized size, bytes */
  bytes: number
  portable: boolean
  heavy: boolean
}

interface RestoreResult {
  keys: number
  records: number
  skipped: string[]
}

/* ================================================================== */
/* Small helpers                                                       */
/* ================================================================== */

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

const haptic = () => navigator.vibrate?.(12)

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${Math.max(1, Math.round(n))} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function isQuotaError(err: unknown): boolean {
  const e = err as { name?: string; code?: number } | undefined
  if (!e) return false
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22
}

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/* ================================================================== */
/* IndexedDB plumbing (raw, no libs)                                   */
/* ================================================================== */

/** Open any database read-only-ish WITHOUT a version — never triggers upgrades, never blocks. */
function openRaw(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error(`Could not open ${name}`))
    req.onblocked = () => reject(new Error(`${name} is open in another tab`))
  })
}

function getAllStore(db: IDBDatabase, store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll()
    req.onsuccess = () => resolve((req.result ?? []) as unknown[])
    req.onerror = () => reject(req.error ?? new Error('IndexedDB getAll failed'))
  })
}

/**
 * Open for writing at version 1, creating the KNOWN stores if missing
 * (mirrors the shapes above). If the db already exists at a higher version,
 * fall back to opening it as-is and skip stores we don't recognize.
 */
function openForWrite(name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      const shape = IDB_DBS[name]
      if (!shape) return
      for (const [store, meta] of Object.entries(shape.stores)) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: meta.keyPath })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error(`Could not open ${name}`))
  }).catch((err: unknown) => {
    const name2 = (err as { name?: string } | null)?.name
    if (name2 === 'VersionError') {
      // db exists at a higher version — restore into whatever stores exist
      return openRaw(name)
    }
    throw err
  })
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted'))
    t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'))
  })
}

/* ================================================================== */
/* Blob <-> base64 (video/photo bytes can't live in JSON directly)     */
/* ================================================================== */

const BLOB_TAG = '__thblob'

interface EncodedBlob {
  [BLOB_TAG]: true
  mime: string
  b64: string
}

function blobToB64(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(new Error('Could not read media data'))
    r.onload = () => {
      const s = String(r.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.readAsDataURL(b)
  })
}

async function encodeValue(v: unknown, depth = 0): Promise<unknown> {
  if (v instanceof Blob) {
    const b64 = await blobToB64(v)
    const out: EncodedBlob = { [BLOB_TAG]: true, mime: v.type || 'application/octet-stream', b64 }
    return out
  }
  if (depth > 6 || v === null || typeof v !== 'object') return v ?? null
  if (Array.isArray(v)) {
    const out: unknown[] = []
    for (let i = 0; i < v.length; i++) {
      out.push(await encodeValue(v[i], depth + 1))
      if (i % 40 === 39) await tick()
    }
    return out
  }
  const src = v as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(src)) out[k] = await encodeValue(src[k], depth + 1)
  return out
}

function decodeValue(v: unknown, depth = 0): unknown {
  if (depth > 6 || v === null || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map((x) => decodeValue(x, depth + 1))
  const o = v as Record<string, unknown>
  if (o[BLOB_TAG] === true && typeof o.b64 === 'string') {
    const bin = atob(o.b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: typeof o.mime === 'string' ? o.mime : '' })
  }
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(o)) out[k] = decodeValue(o[k], depth + 1)
  return out
}

/* ================================================================== */
/* Scanning                                                            */
/* ================================================================== */

function blobWalk(v: unknown, fn: (b: Blob) => void, depth = 0): void {
  if (!v || depth > 6) return
  if (v instanceof Blob) {
    fn(v)
    return
  }
  if (Array.isArray(v)) {
    for (const x of v) blobWalk(x, fn, depth + 1)
    return
  }
  if (typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) blobWalk(x, fn, depth + 1)
  }
}

function measureRecords(recs: unknown[]): { bytes: number; blobs: number } {
  let bytes = 0
  let blobs = 0
  for (const rec of recs) {
    const json = JSON.stringify(rec, (_k, v) => (v instanceof Blob ? { __blobBytes: v.size } : v)) ?? ''
    bytes += json.length * 2
    blobWalk(rec, (b) => {
      blobs++
      bytes += Math.round(b.size * 1.37) // base64 overhead
    })
  }
  return { bytes, blobs }
}

function lsMetaFor(key: string): LsMeta {
  const exact = LS_KEYS[key]
  if (exact) return exact
  const pre = LS_PREFIXES.find((p) => key.startsWith(p.prefix))
  return pre ?? { label: 'Other data', hint: key }
}

async function scanSources(stage: (s: string) => void): Promise<Source[]> {
  const found: Source[] = []

  /* ---- localStorage (sessionStorage skipped — session-only) ---- */
  stage('Reading app settings…')
  await tick()
  const lsRows: Source[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key === null) continue
    const value = localStorage.getItem(key) ?? ''
    const meta = lsMetaFor(key)
    lsRows.push({
      id: `ls:${key}`,
      kind: 'ls',
      lsKey: key,
      label: meta.label,
      sub: meta.hint,
      count: 1,
      bytes: (key.length + value.length) * 2,
      portable: true,
      heavy: false,
    })
  }
  const knownOrder = Object.keys(LS_KEYS)
  lsRows.sort((a, b) => {
    const ia = knownOrder.indexOf(a.lsKey ?? '')
    const ib = knownOrder.indexOf(b.lsKey ?? '')
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })
  found.push(...lsRows)

  /* ---- IndexedDB: enumerate, else fall back to the known list ---- */
  let names: string[] = []
  try {
    const infos = await indexedDB.databases()
    names = infos.map((i) => i.name).filter((n): n is string => typeof n === 'string')
  } catch {
    names = []
  }
  const knownNames = Object.keys(IDB_DBS)
  const namesUnion = [...names]
  for (const k of knownNames) if (!namesUnion.includes(k)) namesUnion.push(k)
  // only ToolHub-owned databases — never touch strangers' storage
  const dbs = namesUnion.filter((n) => knownNames.includes(n) || n.startsWith('toolhub'))
  dbs.sort((a, b) => {
    const ia = knownNames.indexOf(a)
    const ib = knownNames.indexOf(b)
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib)
  })

  for (const name of dbs) {
    const shape = IDB_DBS[name]
    stage(`Scanning ${shape?.label ?? name}…`)
    await tick()
    let db: IDBDatabase
    try {
      db = await openRaw(name)
    } catch {
      continue // locked or unreadable — show nothing rather than break the scan
    }
    try {
      for (const store of Array.from(db.objectStoreNames)) {
        const meta = shape?.stores[store]
        let recs: unknown[] = []
        try {
          recs = await getAllStore(db, store)
        } catch {
          recs = []
        }
        const { bytes, blobs } = measureRecords(recs)
        found.push({
          id: `idb:${name}:${store}`,
          kind: 'idb',
          db: name,
          store,
          label: meta?.label ?? `${name} · ${store}`,
          sub: meta
            ? meta.nonPortable
              ? `${name} → ${store} · re-link on the new device`
              : `${name} → ${store}`
            : 'Other data',
          count: recs.length,
          bytes,
          portable: !meta?.nonPortable,
          heavy: blobs > 0,
        })
      }
    } finally {
      db.close()
    }
  }
  return found
}

/* ================================================================== */
/* Export / Restore engines                                            */
/* ================================================================== */

async function buildBackup(picked: Source[], stage: (s: string) => void): Promise<BackupFile> {
  const localStorageOut: Record<string, string> = {}
  for (const s of picked) {
    if (s.kind === 'ls' && s.lsKey) localStorageOut[s.lsKey] = localStorage.getItem(s.lsKey) ?? ''
  }

  const indexedDBOut: Record<string, Record<string, unknown[]>> = {}
  const byDb = new Map<string, Source[]>()
  for (const s of picked) {
    if (s.kind !== 'idb' || !s.db || !s.store) continue
    const list = byDb.get(s.db) ?? []
    list.push(s)
    byDb.set(s.db, list)
  }
  for (const [dbName, list] of byDb) {
    const db = await openRaw(dbName)
    try {
      const stores: Record<string, unknown[]> = {}
      for (const s of list) {
        stage(`Packing ${s.label}…`)
        await tick()
        let recs: unknown[] = []
        try {
          recs = await getAllStore(db, s.store as string)
        } catch {
          recs = []
        }
        const enc: unknown[] = []
        for (let i = 0; i < recs.length; i++) {
          enc.push(await encodeValue(recs[i]))
          if (i % 40 === 39) await tick()
        }
        stores[s.store as string] = enc
      }
      if (Object.keys(stores).length > 0) indexedDBOut[dbName] = stores
    } finally {
      db.close()
    }
  }

  return {
    app: 'toolhub',
    schema: 1,
    createdAt: new Date().toISOString(),
    localStorage: localStorageOut,
    indexedDB: indexedDBOut,
  }
}

function parseBackup(text: string): BackupFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON.")
  }
  const o = raw as Record<string, unknown>
  if (!isPlainObj(o) || o.app !== 'toolhub' || o.schema !== 1) {
    throw new Error("This file isn't a ToolHub backup (wrong app or schema).")
  }
  const indexedDB: BackupFile['indexedDB'] = {}
  if (isPlainObj(o.indexedDB)) {
    for (const [dbName, stores] of Object.entries(o.indexedDB)) {
      if (!isPlainObj(stores)) continue
      const clean: Record<string, unknown[]> = {}
      for (const [store, recs] of Object.entries(stores)) {
        if (Array.isArray(recs)) clean[store] = recs.filter(isPlainObj)
      }
      indexedDB[dbName] = clean
    }
  }
  const localStorage: Record<string, string> = {}
  if (isPlainObj(o.localStorage)) {
    for (const [k, v] of Object.entries(o.localStorage)) {
      if (typeof v === 'string') localStorage[k] = v
    }
  }
  return { app: 'toolhub', schema: 1, createdAt: typeof o.createdAt === 'string' ? o.createdAt : '', localStorage, indexedDB }
}

async function applyBackup(file: BackupFile, stage: (s: string) => void): Promise<RestoreResult> {
  let keys = 0
  let records = 0
  const skipped: string[] = []

  /* ---- localStorage ---- */
  const lsEntries = Object.entries(file.localStorage)
  if (lsEntries.length > 0) {
    stage('Restoring app settings…')
    await tick()
    for (const [k, v] of lsEntries) {
      try {
        localStorage.setItem(k, v)
        keys++
      } catch (err) {
        if (isQuotaError(err)) throw new Error('Device storage is full — free some space and try again.')
        skipped.push(`settings · ${k}`)
      }
    }
  }

  /* ---- IndexedDB ---- */
  for (const [dbName, stores] of Object.entries(file.indexedDB)) {
    const shape = IDB_DBS[dbName]
    const storeNames = Object.keys(stores)
    if (storeNames.length === 0) continue
    stage(`Restoring ${shape?.label ?? dbName}…`)
    await tick()
    let db: IDBDatabase
    try {
      db = await openForWrite(dbName)
    } catch {
      skipped.push(`${dbName} (couldn't open)`)
      continue
    }
    try {
      for (const store of storeNames) {
        if (!db.objectStoreNames.contains(store)) {
          skipped.push(`${dbName} → ${store} (unknown layout)`)
          continue
        }
        const meta = shape?.stores[store]
        const label = meta?.label ?? store
        stage(`Restoring ${label}…`)
        await tick()
        try {
          const t = db.transaction(store, 'readwrite')
          const os = t.objectStore(store)
          os.clear()
          const recs = stores[store]
          for (let i = 0; i < recs.length; i++) {
            os.put(decodeValue(recs[i]) as Record<string, unknown>)
          }
          await txDone(t)
          records += recs.length
        } catch (err) {
          if (isQuotaError(err)) throw new Error('Device storage is full — free some space and try again.')
          skipped.push(`${dbName} → ${store}`)
        }
      }
    } finally {
      db.close()
    }
  }

  return { keys, records, skipped }
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

type Phase = 'scanning' | 'ready' | 'packing'
type RestorePhase = 'idle' | 'preview' | 'applying' | 'done'

function SourceRow({
  src,
  checked,
  onToggle,
}: {
  src: Source
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={!src.portable}
      onClick={onToggle}
      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04] disabled:opacity-45 disabled:hover:bg-transparent"
    >
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors',
          checked ? 'border-emerald-400 bg-emerald-500 text-zinc-950' : 'border-white/20 bg-white/5 text-transparent'
        )}
        aria-hidden
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold leading-tight text-zinc-100">{src.label}</span>
        <span className="block truncate text-[11px] leading-tight text-zinc-500">{src.sub}</span>
      </span>
      {src.count > 0 && (
        <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-zinc-300">
          {src.count}
        </span>
      )}
      {src.portable ? (
        <span
          className={cn(
            'w-16 shrink-0 text-right text-[11px] font-semibold tabular-nums',
            src.heavy ? 'rounded-md border border-amber-400/25 bg-amber-500/10 px-1.5 py-0.5 text-amber-300' : 'text-zinc-400'
          )}
        >
          {src.count > 0 ? fmtBytes(src.bytes) : '—'}
        </span>
      ) : (
        <span className="w-16 shrink-0 text-right text-[10px] font-semibold leading-tight text-zinc-500">won&apos;t copy</span>
      )}
    </button>
  )
}

function GroupHeader({
  title,
  icon: Icon,
  count,
  bytes,
  allChecked,
  anyToggleable,
  onToggleAll,
}: {
  title: string
  icon: typeof HardDrive
  count: number
  bytes: number
  allChecked: boolean
  anyToggleable: boolean
  onToggleAll: () => void
}) {
  return (
    <button
      type="button"
      onClick={anyToggleable ? onToggleAll : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-1 pt-1 pb-1.5 text-left',
        anyToggleable && 'cursor-pointer hover:opacity-90'
      )}
    >
      <Icon className="size-3.5 shrink-0 text-slate-400" aria-hidden />
      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{title}</span>
      <span className="text-[10px] font-semibold tabular-nums text-zinc-600">
        {count} {count === 1 ? 'item' : 'items'} · {fmtBytes(bytes)}
      </span>
      {anyToggleable && (
        <span className={cn('ml-auto text-[10px] font-bold uppercase tracking-wide', allChecked ? 'text-emerald-400' : 'text-zinc-500')}>
          {allChecked ? 'Uncheck all' : 'Check all'}
        </span>
      )}
    </button>
  )
}

export default function BackupRestore() {
  const { toast } = useToast()

  const [phase, setPhase] = useState<Phase>('scanning')
  const [stage, setStage] = useState('Reading device storage…')
  const [sources, setSources] = useState<Source[]>([])
  const [sel, setSel] = useState<Record<string, boolean>>({})

  const [rPhase, setRPhase] = useState<RestorePhase>('idle')
  const [rStage, setRStage] = useState('')
  const [pending, setPending] = useState<BackupFile | null>(null)
  const [pendingName, setPendingName] = useState('')
  const [result, setResult] = useState<RestoreResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const scanningRef = useRef(false)

  const runScan = useCallback(async () => {
    if (scanningRef.current) return
    scanningRef.current = true
    setPhase('scanning')
    setStage('Reading device storage…')
    try {
      const found = await scanSources(setStage)
      setSources(found)
      const next: Record<string, boolean> = {}
      for (const s of found) next[s.id] = s.portable && s.count > 0
      setSel(next)
      setPhase('ready')
    } catch {
      setPhase('ready')
      toast({
        title: 'Scan failed',
        description: 'Storage on this device could not be read. Try re-scanning.',
        variant: 'destructive',
      })
    } finally {
      scanningRef.current = false
    }
  }, [toast])

  useEffect(() => {
    void runScan()
  }, [runScan])

  /* ---------------- derived ---------------- */

  const lsSources = sources.filter((s) => s.kind === 'ls')
  const idbSources = sources.filter((s) => s.kind === 'idb')
  const selected = sources.filter((s) => sel[s.id] && s.portable && s.count > 0)
  const totalBytes = selected.reduce((n, s) => n + s.bytes, 0)
  const totalItems = selected.length

  const groupStats = (list: Source[]) => {
    const checked = list.filter((s) => sel[s.id] && s.portable && s.count > 0)
    const bytes = list.filter((s) => s.count > 0).reduce((n, s) => n + s.bytes, 0)
    const count = list.reduce((n, s) => n + s.count, 0)
    const toggleable = list.some((s) => s.portable && s.count > 0)
    return { allChecked: toggleable && checked.length === list.filter((s) => s.portable && s.count > 0).length, bytes, count, toggleable, checkedCount: checked.length }
  }

  const toggle = (id: string) => {
    haptic()
    setSel((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const toggleGroup = (list: Source[]) => {
    haptic()
    const { allChecked } = groupStats(list)
    setSel((prev) => {
      const next = { ...prev }
      for (const s of list) {
        if (s.portable && s.count > 0) next[s.id] = !allChecked
      }
      return next
    })
  }

  /* ---------------- export ---------------- */

  const doExport = useCallback(async () => {
    if (selected.length === 0 || phase === 'packing') return
    haptic()
    setPhase('packing')
    try {
      const file = await buildBackup(selected, setStage)
      const json = JSON.stringify(file)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `toolhub-backup-${dateKey(new Date())}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      toast({
        title: 'Backup exported',
        description: `${fmtBytes(blob.size)} saved to your downloads. The file never left this device.`,
      })
    } catch (err) {
      toast({
        title: isQuotaError(err) ? 'Not enough memory to pack' : 'Export failed',
        description:
          isQuotaError(err)
            ? 'This backup is too large to build in memory. Try excluding photos or videos.'
            : 'Something went wrong while packing the backup. Try again.',
        variant: 'destructive',
      })
    } finally {
      setPhase('ready')
    }
  }, [selected, phase, toast])

  /* ---------------- restore ---------------- */

  const ingestFile = useCallback(
    async (file: File) => {
      haptic()
      try {
        const text = await file.text()
        const parsed = parseBackup(text)
        setPending(parsed)
        setPendingName(file.name)
        setResult(null)
        setRPhase('preview')
      } catch (err) {
        toast({
          title: "Can't read that file",
          description: err instanceof Error ? err.message : 'Not a ToolHub backup.',
          variant: 'destructive',
        })
      }
    },
    [toast]
  )

  const doRestore = useCallback(async () => {
    if (!pending) return
    setConfirmOpen(false)
    setRPhase('applying')
    haptic()
    try {
      const res = await applyBackup(pending, setRStage)
      setResult(res)
      setRPhase('done')
      toast({
        title: 'Backup restored',
        description: 'Some data appears after ToolHub reloads — tap “Reload to finish”.',
      })
    } catch (err) {
      setRPhase('preview')
      toast({
        title: isQuotaError(err) ? 'Device storage is full' : 'Restore failed',
        description:
          err instanceof Error
            ? err.message
            : 'Something went wrong while writing the backup. Try again.',
        variant: 'destructive',
      })
    }
  }, [pending, toast])

  const pendingCounts = (() => {
    if (!pending) return { keys: 0, records: 0 }
    const keys = Object.keys(pending.localStorage).length
    let records = 0
    for (const stores of Object.values(pending.indexedDB)) {
      for (const recs of Object.values(stores)) records += recs.length
    }
    return { keys, records }
  })()

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-zinc-400/[0.09] via-transparent to-slate-500/[0.08] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-400 via-slate-500 to-slate-700 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(100_116_139/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <DatabaseBackup className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Backup &amp; Restore</h2>
              <p className="text-xs text-zinc-400">One file with everything. Move it anywhere.</p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
              <ShieldCheck className="size-3.5" aria-hidden /> On-device
            </span>
          </div>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          {/* ---------------- Privacy + size note ---------------- */}
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.08] p-3.5">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-400" aria-hidden />
            <p className="text-xs leading-relaxed text-emerald-100/90">
              <span className="font-bold text-emerald-300">Private by design.</span> Your backup file never touches any
              server — it is generated and restored entirely on this device.
            </p>
          </div>
          <div className="-mt-3 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/[0.07] px-3 py-2">
            <TriangleAlert className="size-4 shrink-0 text-amber-400" aria-hidden />
            <p className="text-[11px] font-medium text-amber-200/90">
              Photos &amp; videos make backup files large — watch the size badges before exporting.
            </p>
          </div>

          {/* ================= BACKUP ================= */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
              <div className="flex items-center gap-2">
                <HardDriveDownload className="size-4 text-slate-300" aria-hidden />
                <h3 className="text-sm font-bold">Backup</h3>
                <span className="text-[11px] text-zinc-500">
                  {totalItems > 0 ? `${totalItems} sources · ~${fmtBytes(totalBytes)}` : 'scanning device…'}
                </span>
              </div>
              <button
                onClick={() => {
                  haptic()
                  void runScan()
                }}
                disabled={phase === 'scanning' || phase === 'packing'}
                aria-label="Re-scan device storage"
                className="flex size-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <RefreshCw className={cn('size-4', phase === 'scanning' && 'animate-spin')} aria-hidden />
              </button>
            </div>

            {phase === 'scanning' || phase === 'packing' ? (
              <div className="flex flex-col items-center gap-3 px-4 py-10">
                <Loader2 className="size-6 animate-spin text-slate-400" aria-hidden />
                <p className="text-xs font-medium text-zinc-400">{stage}</p>
              </div>
            ) : sources.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10">
                <Package className="size-6 text-zinc-600" aria-hidden />
                <p className="text-xs text-zinc-500">Nothing to back up yet — data appears as you use apps.</p>
              </div>
            ) : (
              <>
                <div className="max-h-96 space-y-1 overflow-y-auto px-3 py-2">
                  {lsSources.length > 0 && (
                    <>
                      <GroupHeader
                        title="App settings (localStorage)"
                        icon={Smartphone}
                        count={groupStats(lsSources).count}
                        bytes={groupStats(lsSources).bytes}
                        allChecked={groupStats(lsSources).allChecked}
                        anyToggleable={groupStats(lsSources).toggleable}
                        onToggleAll={() => toggleGroup(lsSources)}
                      />
                      {lsSources.map((s) => (
                        <SourceRow key={s.id} src={s} checked={!!sel[s.id]} onToggle={() => toggle(s.id)} />
                      ))}
                    </>
                  )}
                  {idbSources.length > 0 && (
                    <>
                      <GroupHeader
                        title="Databases (IndexedDB)"
                        icon={HardDrive}
                        count={groupStats(idbSources).count}
                        bytes={groupStats(idbSources).bytes}
                        allChecked={groupStats(idbSources).allChecked}
                        anyToggleable={groupStats(idbSources).toggleable}
                        onToggleAll={() => toggleGroup(idbSources)}
                      />
                      {idbSources.map((s) => (
                        <SourceRow key={s.id} src={s} checked={!!sel[s.id]} onToggle={() => toggle(s.id)} />
                      ))}
                    </>
                  )}
                </div>
                <div className="border-t border-white/5 p-3">
                  <Button
                    onClick={() => void doExport()}
                    disabled={totalItems === 0}
                    className="h-11 w-full rounded-xl bg-gradient-to-r from-slate-300 to-slate-500 text-[13px] font-bold text-zinc-950 shadow-lg hover:from-slate-200 hover:to-slate-400"
                  >
                    <FileJson className="size-4" aria-hidden />
                    Export backup (.json)
                    <span className="font-semibold opacity-70">· ~{fmtBytes(totalBytes)}</span>
                  </Button>
                  {totalItems < sources.filter((s) => s.portable && s.count > 0).length && (
                    <p className="mt-2 text-center text-[10px] text-zinc-500">
                      Exports only checked sources — {sources.filter((s) => s.portable && s.count > 0).length - totalItems}{' '}
                      deselected.
                    </p>
                  )}
                </div>
              </>
            )}
          </section>

          {/* ================= RESTORE ================= */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
            <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
              <Upload className="size-4 text-slate-300" aria-hidden />
              <h3 className="text-sm font-bold">Restore</h3>
              <span className="text-[11px] text-zinc-500">on this or a new device</span>
            </div>

            <div className="p-4">
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void ingestFile(f)
                  e.target.value = ''
                }}
              />

              {rPhase === 'idle' && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    const f = e.dataTransfer.files?.[0]
                    if (f) void ingestFile(f)
                  }}
                  className={cn(
                    'flex min-h-24 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed p-4 transition-colors',
                    dragOver
                      ? 'border-emerald-400/60 bg-emerald-500/[0.07]'
                      : 'border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]'
                  )}
                >
                  <Upload className="size-5 text-slate-400" aria-hidden />
                  <span className="text-[13px] font-semibold text-zinc-200">Choose a backup file</span>
                  <span className="text-[11px] text-zinc-500">toolhub-backup-*.json — tap or drop it here</span>
                </button>
              )}

              {rPhase === 'preview' && pending && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold text-zinc-100">{pendingName || 'backup.json'}</p>
                      <p className="text-[11px] text-zinc-500">
                        {pending.createdAt
                          ? `Created ${new Date(pending.createdAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
                          : 'Created date unknown'}{' '}
                        · schema {pending.schema}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      <CheckCircle2 className="size-3" aria-hidden /> Valid
                    </span>
                  </div>

                  <div className="max-h-96 space-y-1 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] p-2">
                    {pendingCounts.keys > 0 && (
                      <div className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                        <FileJson className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">
                          App settings (localStorage)
                        </span>
                        <span className="shrink-0 text-[11px] font-bold tabular-nums text-zinc-400">
                          {pendingCounts.keys} {pendingCounts.keys === 1 ? 'key' : 'keys'}
                        </span>
                      </div>
                    )}
                    {Object.entries(pending.indexedDB).flatMap(([dbName, stores]) =>
                        Object.entries(stores).map(([store, recs]) => {
                          const meta = IDB_DBS[dbName]?.stores[store]
                          return (
                            <div key={`idb:${dbName}:${store}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                              <HardDrive className="size-3.5 shrink-0 text-slate-400" aria-hidden />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12px] font-semibold leading-tight">
                                  {meta?.label ?? `${dbName} · ${store}`}
                                </span>
                                <span className="block truncate text-[10px] leading-tight text-zinc-500">
                                  {meta ? `${dbName} → ${store}` : 'unknown layout — will be skipped'}
                                </span>
                              </span>
                              <span className="shrink-0 text-[11px] font-bold tabular-nums text-zinc-400">
                                {recs.length} {recs.length === 1 ? 'item' : 'items'}
                              </span>
                            </div>
                          )
                        })
                      )}
                  </div>

                  <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] px-3 py-2.5">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" aria-hidden />
                    <p className="text-[11px] leading-relaxed text-amber-200/90">
                      This will <span className="font-bold">replace current data</span> for these apps on this device.
                      Anything not in the backup for the same stores will be lost.
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPending(null)
                        setRPhase('idle')
                      }}
                      className="h-11 flex-1 rounded-xl border-white/10 bg-white/5 text-[13px] font-semibold hover:bg-white/10"
                    >
                      Choose different file
                    </Button>
                    <Button
                      onClick={() => {
                        haptic()
                        setConfirmOpen(true)
                      }}
                      className="h-11 flex-1 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 text-[13px] font-bold text-zinc-950 shadow-lg hover:from-emerald-300 hover:to-teal-400"
                    >
                      <RotateCcw className="size-4" aria-hidden /> Restore
                    </Button>
                  </div>
                </div>
              )}

              {rPhase === 'applying' && (
                <div className="flex flex-col items-center gap-3 py-10">
                  <Loader2 className="size-6 animate-spin text-slate-400" aria-hidden />
                  <p className="text-xs font-medium text-zinc-400">{rStage || 'Restoring…'}</p>
                </div>
              )}

              {rPhase === 'done' && result && (
                <div className="space-y-3">
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.08] px-4 py-6 text-center">
                    <CheckCircle2 className="size-8 text-emerald-400" aria-hidden />
                    <p className="text-sm font-bold text-emerald-200">
                      Restored {result.keys + result.records} {result.keys + result.records === 1 ? 'item' : 'items'}
                    </p>
                    <p className="text-[11px] text-zinc-400">
                      {result.keys} settings {result.keys === 1 ? 'key' : 'keys'} · {result.records} database{' '}
                      {result.records === 1 ? 'record' : 'records'}
                    </p>
                    {result.skipped.length > 0 && (
                      <p className="max-w-xs text-[10px] leading-relaxed text-zinc-500">
                        Skipped {result.skipped.length} unavailable {result.skipped.length === 1 ? 'source' : 'sources'}:{' '}
                        {result.skipped.slice(0, 3).join(', ')}
                        {result.skipped.length > 3 ? ` +${result.skipped.length - 3} more` : ''}
                      </p>
                    )}
                  </div>
                  <p className="text-center text-[11px] text-zinc-500">
                    Some data appears after ToolHub reloads — the home screen, apps and media all come back.
                  </p>
                  <Button
                    onClick={() => window.location.reload()}
                    className="h-12 w-full rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 text-sm font-bold text-zinc-950 shadow-lg hover:from-emerald-300 hover:to-teal-400"
                  >
                    <RotateCcw className="size-4" aria-hidden /> Reload to finish
                  </Button>
                </div>
              )}
            </div>
          </section>
        </div>
      </motion.div>

      {/* ---------------- Confirm restore ---------------- */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-2xl border-white/10 bg-zinc-950 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this backup?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              {pendingCounts.keys} settings {pendingCounts.keys === 1 ? 'key' : 'keys'} and{' '}
              {pendingCounts.records} database {pendingCounts.records === 1 ? 'record' : 'records'} will be written to
              this device. Current data for the same apps will be replaced — this can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl border-white/10 bg-white/5 hover:bg-white/10">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void doRestore()}
              className="rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 font-bold text-zinc-950 hover:from-emerald-300 hover:to-teal-400"
            >
              Restore now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
