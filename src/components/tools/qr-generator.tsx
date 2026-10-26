'use client'

/**
 * QR Studio — offline QR code workshop.
 *
 * Five sections: Link/Text and Wi-Fi (v1 features, preserved), Contact
 * (vCard 3.0), Bulk (CSV → a mapped grid of QR cards) and History (every
 * generated code auto-saves into IndexedDB; tap a row to load it back).
 * Codes render black-on-white for maximum scanner compatibility; PNG size
 * and error-correction level apply to every section.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import QRCode from 'qrcode'
import { motion } from 'framer-motion'
import {
  Check,
  Copy,
  Download,
  Eraser,
  Eye,
  EyeOff,
  History,
  Link2,
  Loader2,
  QrCode,
  Table2,
  Trash2,
  TriangleAlert,
  Type,
  User,
  Wifi,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Types & constants                                                   */
/* ================================================================== */

type Mode = 'text' | 'wifi' | 'vcard' | 'bulk' | 'history'
type WifiType = 'WPA' | 'WEP' | 'nopass'
type EcLevel = 'L' | 'M' | 'Q' | 'H'
type SizeKey = '256' | '512' | '1024'
type BulkKind = 'wifi' | 'contact' | 'text'
type HistoryType = 'text' | 'wifi' | 'vcard' | 'bulk'

interface HistoryDoc {
  id: string
  type: HistoryType
  label: string
  payload: string
  createdAt: number
}

interface WifiMap {
  [key: string]: number
  ssid: number
  password: number
  encryption: number
  hidden: number
}

interface ContactMap {
  [key: string]: number
  name: number
  phone: number
  email: number
  org: number
  url: number
}

interface QrPrefs {
  ec: EcLevel
  size: SizeKey
  headerOn: boolean
  bulkKind: BulkKind
  textCol: number
  wifiMap: WifiMap
  contactMap: ContactMap
}

interface BulkRow {
  index: number
  label: string
  payload: string
  valid: boolean
}

const PREFS_KEY = 'toolhub-qr-prefs'
const DB_NAME = 'toolhub-qr'
const DB_VERSION = 1
const HISTORY_STORE = 'history'

const BULK_PARSE_CAP = 200
const BULK_DOWNLOAD_CAP = 60
const BULK_HISTORY_CAP = 20
const BULK_DOWNLOAD_STAGGER_MS = 250
const BULK_PREVIEW_DEBOUNCE_MS = 250
const PREVIEW_DEBOUNCE_MS = 300
const SETTLE_SAVE_MS = 2000
const BULK_SETTLE_SAVE_MS = 2500

/** Fixed colors — black modules on white for maximum scanner compatibility. */
const QR_COLORS = { dark: '#000000', light: '#ffffff' } as const

/** Sentinel stored in the bulk QR map when a payload cannot be encoded. */
const QR_FAIL = '\u0000failed'

const WIFI_MAP_DEFAULT: WifiMap = { ssid: 0, password: 1, encryption: 2, hidden: 3 }
const CONTACT_MAP_DEFAULT: ContactMap = { name: 0, phone: 1, email: 2, org: 3, url: 4 }

const INPUT_CLS =
  'h-11 rounded-xl border-white/10 bg-white/[0.04] text-zinc-100 placeholder:text-zinc-600 focus-visible:border-violet-400/60 focus-visible:ring-violet-500/20'
const TEXTAREA_CLS =
  'rounded-xl border-white/10 bg-white/[0.04] text-zinc-100 placeholder:text-zinc-600 focus-visible:border-violet-400/60 focus-visible:ring-violet-500/20'
const TRIGGER_CLS =
  'flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-1 pb-1.5 pt-2 text-[10px] font-medium text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-zinc-50 sm:text-[11px]'
const SELECT_TRIGGER_CLS = 'h-11 w-full rounded-xl border-white/10 bg-white/[0.04] text-zinc-100'
const SELECT_CONTENT_CLS = 'rounded-2xl border-white/10 bg-zinc-900 text-zinc-100'

/** Thin glass scrollbar for long lists. */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

const HISTORY_META: Record<HistoryType, { icon: LucideIcon; name: string; tile: string }> = {
  text: { icon: Link2, name: 'Link / Text', tile: 'bg-sky-500/15 text-sky-300' },
  wifi: { icon: Wifi, name: 'Wi-Fi', tile: 'bg-violet-500/15 text-violet-300' },
  vcard: { icon: User, name: 'Contact', tile: 'bg-emerald-500/15 text-emerald-300' },
  bulk: { icon: Table2, name: 'Bulk', tile: 'bg-amber-500/15 text-amber-300' },
}

const BULK_KINDS: Array<{ id: BulkKind; label: string; icon: LucideIcon }> = [
  { id: 'wifi', label: 'Wi-Fi', icon: Wifi },
  { id: 'contact', label: 'Contact', icon: User },
  { id: 'text', label: 'Plain text', icon: Type },
]

/* ================================================================== */
/* IndexedDB — history, fully on-device (write-through)                */
/* ================================================================== */

let dbPromise: Promise<IDBDatabase> | null = null

function openQrDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(HISTORY_STORE)) d.createObjectStore(HISTORY_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openQrDb()
  return dbPromise
}

function idbGetAll<T>(store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readonly').objectStore(store).getAll()
        req.onsuccess = () => resolve((req.result ?? []) as T[])
        req.onerror = () => reject(req.error ?? new Error('IndexedDB getAll failed'))
      })
      .catch(reject)
  })
}

function idbPut<T>(store: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).put(value as object)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'))
      })
      .catch(reject)
  })
}

function idbDelete(store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).delete(key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
      })
      .catch(reject)
  })
}

function idbClear(store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).clear()
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB clear failed'))
      })
      .catch(reject)
  })
}

/* ================================================================== */
/* Payload builders — Wi-Fi & vCard                                    */
/* ================================================================== */

const escapeWifi = (s: string): string => s.replace(/([\\;,:"])/g, '\\$1')

function buildWifiPayload(type: WifiType, ssid: string, pass: string, hidden: boolean): string {
  const parts: string[] = [`WIFI:T:${type}`, `S:${escapeWifi(ssid)}`]
  if (type !== 'nopass' && pass) parts.push(`P:${escapeWifi(pass)}`)
  if (hidden) parts.push('H:true')
  return parts.join(';') + ';;'
}

function unescapeWifi(s: string): string {
  return s.replace(/\\(.)/g, '$1')
}

function normalizeWifiType(v: string): WifiType {
  const t = v.trim().toUpperCase()
  if (t === 'WEP') return 'WEP'
  if (t === '' || t === 'NOPASS' || t === 'NONE' || t === 'OPEN') return 'nopass'
  return 'WPA'
}

interface WifiFields {
  ssid: string
  pass: string
  type: WifiType
  hidden: boolean
}

/** Re-parses a WIFI: payload back into form fields (history restore). */
function parseWifiPayload(raw: string): WifiFields {
  const out: WifiFields = { ssid: '', pass: '', type: 'WPA', hidden: false }
  if (!raw.startsWith('WIFI:')) return out
  const body = raw.slice(5)
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body.charAt(i)
    if (ch === '\\' && i + 1 < body.length) {
      cur += ch + body.charAt(i + 1)
      i++
      continue
    }
    if (ch === ';') {
      parts.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  parts.push(cur)
  for (const part of parts) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const key = part.slice(0, idx).trim().toUpperCase()
    const val = unescapeWifi(part.slice(idx + 1))
    if (key === 'S') out.ssid = val
    else if (key === 'P') out.pass = val
    else if (key === 'T') out.type = normalizeWifiType(val)
    else if (key === 'H') out.hidden = /^(true|yes|1)$/i.test(val.trim())
  }
  return out
}

function escapeVcard(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n')
}

function unescapeVcard(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\(.)/g, '$1')
}

interface ContactFields {
  name: string
  phone: string
  email: string
  org: string
  url: string
  address: string
}

/** Splits a full name into first/last on the first space. */
function splitName(full: string): { first: string; last: string } {
  const t = full.trim()
  const cut = t.indexOf(' ')
  if (cut < 0) return { first: t, last: '' }
  return { first: t.slice(0, cut), last: t.slice(cut + 1).trim() }
}

function buildVcard(c: ContactFields): string {
  const lines: string[] = ['BEGIN:VCARD', 'VERSION:3.0']
  const name = c.name.trim()
  if (name) {
    const { first, last } = splitName(name)
    lines.push(`N:${escapeVcard(last)};${escapeVcard(first)}`)
  }
  const fn = name || c.phone.trim() || c.email.trim() || c.org.trim() || 'Contact'
  lines.push(`FN:${escapeVcard(fn)}`)
  if (c.phone.trim()) lines.push(`TEL;TYPE=CELL:${escapeVcard(c.phone.trim())}`)
  if (c.email.trim()) lines.push(`EMAIL:${escapeVcard(c.email.trim())}`)
  if (c.org.trim()) lines.push(`ORG:${escapeVcard(c.org.trim())}`)
  if (c.url.trim()) lines.push(`URL:${escapeVcard(c.url.trim())}`)
  if (c.address.trim()) lines.push(`ADR:;;${escapeVcard(c.address.trim())};;;;`)
  lines.push('END:VCARD')
  return lines.join('\n')
}

/** Re-parses a vCard payload back into form fields (history restore). */
function parseVcardPayload(raw: string): ContactFields {
  const out: ContactFields = { name: '', phone: '', email: '', org: '', url: '', address: '' }
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const key = line.slice(0, idx).toUpperCase()
    const rawVal = line.slice(idx + 1)
    /* Split on raw ';' separators FIRST, unescape each component after —
       escaped \; inside values must never act as a separator. */
    if (key === 'FN') {
      out.name = unescapeVcard(rawVal)
    } else if (key === 'N' && !out.name) {
      const seg = rawVal.split(';')
      const last = unescapeVcard(seg[0])
      const first = unescapeVcard(seg[1])
      out.name = [first, last].filter((p) => p !== '').join(' ')
    } else if (key.startsWith('TEL')) {
      out.phone = unescapeVcard(rawVal)
    } else if (key.startsWith('EMAIL')) {
      out.email = unescapeVcard(rawVal)
    } else if (key.startsWith('ORG')) {
      out.org = unescapeVcard(rawVal)
    } else if (key.startsWith('URL')) {
      out.url = unescapeVcard(rawVal)
    } else if (key.startsWith('ADR')) {
      const seg = rawVal.split(';')
      const street = unescapeVcard(seg[2])
      out.address = street !== '' ? street : seg.map(unescapeVcard).filter((p) => p !== '').join(', ')
    }
  }
  return out
}

/* ================================================================== */
/* Bulk CSV parsing                                                    */
/* ================================================================== */

interface ParsedCsv {
  rows: string[][]
  colCount: number
  truncated: boolean
}

function stripQuotes(field: string): string {
  const t = field.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).replace(/""/g, '"')
  return t
}

/** Quote-aware comma split: commas inside "double quotes" stay in the field. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i)
    if (ch === '"') {
      if (inQuotes && line.charAt(i + 1) === '"') {
        cur += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

/** One line = one row, comma-separated; skips empty lines, drops trailing commas. */
function parseCsv(raw: string, maxRows: number): ParsedCsv {
  const rows: string[][] = []
  let truncated = false
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue
    let cols = splitCsvLine(line)
    while (cols.length > 1 && cols[cols.length - 1].trim() === '') cols = cols.slice(0, -1)
    const cleaned = cols.map(stripQuotes)
    if (cleaned.every((c) => c === '')) continue
    if (rows.length >= maxRows) {
      truncated = true
      break
    }
    rows.push(cleaned)
  }
  const colCount = rows.reduce((m, r) => Math.max(m, r.length), 0)
  return { rows, colCount, truncated }
}

/* ================================================================== */
/* Small helpers                                                       */
/* ================================================================== */

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (secs < 45) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

function triggerDownload(dataUrl: string, fileName: string): void {
  const a = document.createElement('a')
  a.download = fileName
  a.href = dataUrl
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function bulkKey(row: BulkRow): string {
  return `${row.index}:${row.payload}`
}

/** Friendly history label for a single-mode code. */
function labelFor(type: 'text' | 'wifi' | 'vcard', payload: string): string {
  if (type === 'wifi') {
    const ssid = parseWifiPayload(payload).ssid
    return `Wi-Fi — ${truncate(ssid.trim() || 'Unnamed network', 40)}`
  }
  if (type === 'vcard') {
    const name = parseVcardPayload(payload).name
    return `Contact — ${truncate(name.trim() || 'Unnamed contact', 40)}`
  }
  return `Text — ${payload.length} chars`
}

/* ================================================================== */
/* Tolerant localStorage prefs                                         */
/* ================================================================== */

function numField(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback
}

function readColMap<T extends Record<string, number>>(v: unknown, def: T): T {
  if (!v || typeof v !== 'object') return def
  const o = v as Record<string, unknown>
  const out = { ...def }
  for (const k of Object.keys(def) as Array<keyof T>) {
    const val = o[k as string]
    if (typeof val === 'number' && Number.isFinite(val)) (out as Record<string, number>)[k as string] = Math.trunc(val)
  }
  return out
}

function readPrefs(): QrPrefs | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return null
    const j: unknown = JSON.parse(raw)
    if (!j || typeof j !== 'object') return null
    const o = j as Record<string, unknown>
    const ec: EcLevel = o.ec === 'L' || o.ec === 'Q' || o.ec === 'H' ? o.ec : 'M'
    const size: SizeKey = o.size === '256' || o.size === '1024' ? o.size : '512'
    const bulkKind: BulkKind = o.bulkKind === 'contact' || o.bulkKind === 'text' ? o.bulkKind : 'wifi'
    return {
      ec,
      size,
      bulkKind,
      headerOn: o.headerOn === true,
      textCol: numField(o.textCol, 0),
      wifiMap: readColMap<WifiMap>(o.wifiMap, WIFI_MAP_DEFAULT),
      contactMap: readColMap<ContactMap>(o.contactMap, CONTACT_MAP_DEFAULT),
    }
  } catch {
    return null
  }
}

function isHistoryDoc(d: unknown): d is HistoryDoc {
  if (!d || typeof d !== 'object') return false
  const o = d as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    (o.type === 'text' || o.type === 'wifi' || o.type === 'vcard' || o.type === 'bulk') &&
    typeof o.label === 'string' &&
    typeof o.payload === 'string' &&
    typeof o.createdAt === 'number'
  )
}

/* ================================================================== */
/* Tiny presentational helpers                                         */
/* ================================================================== */

function Chip({ tone = 'neutral', children }: { tone?: 'neutral' | 'positive' | 'warn'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        tone === 'positive' && 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
        tone === 'warn' && 'border-amber-400/25 bg-amber-400/10 text-amber-300',
        tone === 'neutral' && 'border-white/10 bg-white/[0.05] text-zinc-300'
      )}
    >
      {children}
    </span>
  )
}

interface ColumnOption {
  value: string
  label: string
}

interface MapSelectProps {
  id: string
  label: string
  value: number
  options: ColumnOption[]
  onChange: (v: number) => void
  allowNone: boolean
}

function MapSelect({ id, label, value, options, onChange, allowNone }: MapSelectProps) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-zinc-400">
        {label}
      </Label>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger id={id} className={SELECT_TRIGGER_CLS} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className={SELECT_CONTENT_CLS}>
          {allowNone && <SelectItem value="-1">Not used</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function QrGeneratorTool() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [mode, setMode] = useState<Mode>('text')

  /* Link / Text tab (v1) */
  const [text, setText] = useState('https://toolhub.app — ToolHub')

  /* Wi-Fi tab (v1) */
  const [ssid, setSsid] = useState('')
  const [wifiPass, setWifiPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [wifiType, setWifiType] = useState<WifiType>('WPA')
  const [hidden, setHidden] = useState(false)

  /* Contact tab (v2) */
  const [cName, setCName] = useState('')
  const [cPhone, setCPhone] = useState('')
  const [cEmail, setCEmail] = useState('')
  const [cOrg, setCOrg] = useState('')
  const [cUrl, setCUrl] = useState('')
  const [cAddress, setCAddress] = useState('')

  /* Bulk tab (v2) */
  const [csvRaw, setCsvRaw] = useState('')
  const [headerOn, setHeaderOn] = useState(false)
  const [bulkKind, setBulkKind] = useState<BulkKind>('wifi')
  const [wifiMap, setWifiMap] = useState<WifiMap>(WIFI_MAP_DEFAULT)
  const [contactMap, setContactMap] = useState<ContactMap>(CONTACT_MAP_DEFAULT)
  const [textCol, setTextCol] = useState(0)
  const [bulkQrs, setBulkQrs] = useState<Record<string, string>>({})
  const [downloadingAll, setDownloadingAll] = useState(false)

  /* Shared options (v1) */
  const [size, setSize] = useState<SizeKey>('512')
  const [ec, setEc] = useState<EcLevel>('M')

  /* QR result (v1) */
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)

  /* History (v2) */
  const [history, setHistory] = useState<HistoryDoc[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  /* Copy flash */
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  /* ---------------- refs ---------------- */
  const historyRef = useRef<HistoryDoc[]>([])
  const bulkQrsRef = useRef<Record<string, string>>({})
  const lastSavedRef = useRef<string | null>(null)
  const lastBulkSigRef = useRef<string>('')
  const mountedRef = useRef(true)

  /* ================================================================== */
  /* Effects                                                             */
  /* ================================================================== */

  /* Track mounted-ness so the async bulk download loop never sets state late. */
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /* Hydration: localStorage prefs + IndexedDB history (alive-flagged). */
  useEffect(() => {
    let alive = true
    void (async () => {
      const prefs = readPrefs()
      let docs: HistoryDoc[] = []
      try {
        docs = await idbGetAll<HistoryDoc>(HISTORY_STORE)
      } catch {
        docs = []
      }
      if (!alive) return
      if (prefs) {
        setEc(prefs.ec)
        setSize(prefs.size)
        setHeaderOn(prefs.headerOn)
        setBulkKind(prefs.bulkKind)
        setTextCol(prefs.textCol)
        setWifiMap(prefs.wifiMap)
        setContactMap(prefs.contactMap)
      }
      const clean = docs.filter(isHistoryDoc).sort((a, b) => b.createdAt - a.createdAt)
      historyRef.current = clean
      setHistory(clean)
      lastSavedRef.current = clean[0]?.payload ?? null
      setHistoryLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* Prefs write-through. */
  useEffect(() => {
    try {
      const prefs: QrPrefs = { ec, size, headerOn, bulkKind, textCol, wifiMap, contactMap }
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      /* private mode / quota — memory-only */
    }
  }, [ec, size, headerOn, bulkKind, textCol, wifiMap, contactMap])

  /* Ref mirrors (kept in sync without re-render churn). */
  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    bulkQrsRef.current = bulkQrs
  }, [bulkQrs])

  /* Two-tap "clear all" auto-reset. */
  useEffect(() => {
    if (!confirmClearAll) return
    const t = setTimeout(() => setConfirmClearAll(false), 3000)
    return () => clearTimeout(t)
  }, [confirmClearAll])

  /* ---------------- derived payloads ---------------- */

  const wifiPayload = useMemo(
    () => (ssid.trim() ? buildWifiPayload(wifiType, ssid, wifiPass, hidden) : ''),
    [ssid, wifiPass, wifiType, hidden]
  )

  const contactHasAny = useMemo(
    () => [cName, cPhone, cEmail, cOrg, cUrl, cAddress].some((v) => v.trim() !== ''),
    [cName, cPhone, cEmail, cOrg, cUrl, cAddress]
  )

  const contactPayload = useMemo(
    () => buildVcard({ name: cName, phone: cPhone, email: cEmail, org: cOrg, url: cUrl, address: cAddress }),
    [cName, cPhone, cEmail, cOrg, cUrl, cAddress]
  )

  const isSingle = mode === 'text' || mode === 'wifi' || mode === 'vcard'
  const previewPayload =
    mode === 'wifi' ? wifiPayload : mode === 'vcard' ? (contactHasAny ? contactPayload : '') : mode === 'text' ? text : ''
  const hasPreviewPayload = previewPayload.trim().length > 0

  /* Debounced (300ms) async QR generation with stale-result guard (v1 logic).
     All setState calls happen inside async callbacks, never synchronously. */
  useEffect(() => {
    if (!isSingle) return
    if (!hasPreviewPayload) return
    let cancelled = false
    const t = setTimeout(() => {
      QRCode.toDataURL(previewPayload, {
        width: Number(size),
        margin: 2,
        errorCorrectionLevel: ec,
        color: QR_COLORS,
      })
        .then((url: string) => {
          if (cancelled) return
          setDataUrl(url)
          setQrError(null)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setDataUrl(null)
          setQrError(err instanceof Error ? err.message : 'Could not generate the QR code.')
        })
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [previewPayload, size, ec, isSingle, hasPreviewPayload])

  /* ---------------- history write-through ---------------- */

  const saveDocs = useCallback((docs: HistoryDoc[]): void => {
    if (docs.length === 0) return
    const ordered = [...docs].sort((a, b) => b.createdAt - a.createdAt)
    setHistory((prev) => [...ordered, ...prev])
    void (async () => {
      for (const d of docs) {
        try {
          await idbPut(HISTORY_STORE, d)
        } catch {
          /* memory-only fallback */
        }
      }
    })()
  }, [])

  /* Settled single-mode codes auto-save: 2s after the payload stops changing,
     deduped against the newest saved payload and existing rows. */
  useEffect(() => {
    if ((mode !== 'text' && mode !== 'wifi' && mode !== 'vcard') || !historyLoaded) return
    if (!hasPreviewPayload) return
    const kind: 'text' | 'wifi' | 'vcard' = mode
    const t = setTimeout(() => {
      if (previewPayload === lastSavedRef.current) return
      if (historyRef.current.some((h) => h.type === kind && h.payload === previewPayload)) {
        lastSavedRef.current = previewPayload
        return
      }
      const doc: HistoryDoc = {
        id: uid('qr'),
        type: kind,
        label: labelFor(kind, previewPayload),
        payload: previewPayload,
        createdAt: Date.now(),
      }
      lastSavedRef.current = previewPayload
      saveDocs([doc])
    }, SETTLE_SAVE_MS)
    return () => clearTimeout(t)
  }, [previewPayload, mode, historyLoaded, hasPreviewPayload, saveDocs])

  /* ---------------- bulk CSV → rows ---------------- */

  const parsed = useMemo(() => parseCsv(csvRaw, BULK_PARSE_CAP), [csvRaw])
  const colCount = parsed.colCount

  const colNames = useMemo<string[]>(() => {
    const names: string[] = []
    for (let i = 0; i < parsed.colCount; i++) {
      const h = headerOn ? (parsed.rows[0]?.[i] ?? '').trim() : ''
      names.push(h || `Column ${i + 1}`)
    }
    return names
  }, [headerOn, parsed])

  const columnOptions = useMemo<ColumnOption[]>(
    () => colNames.map((label, i) => ({ value: String(i), label })),
    [colNames]
  )

  const dataRows = useMemo<string[][]>(() => (headerOn ? parsed.rows.slice(1) : parsed.rows), [headerOn, parsed])

  const reqCol = useCallback((i: number): number => (i >= 0 && i < colCount ? i : 0), [colCount])
  const optCol = useCallback((i: number): number => (i >= 0 && i < colCount ? i : -1), [colCount])

  const effWifi = useMemo(
    () => ({
      ssid: reqCol(wifiMap.ssid),
      password: optCol(wifiMap.password),
      encryption: optCol(wifiMap.encryption),
      hidden: optCol(wifiMap.hidden),
    }),
    [reqCol, optCol, wifiMap]
  )

  const effContact = useMemo(
    () => ({
      name: reqCol(contactMap.name),
      phone: optCol(contactMap.phone),
      email: optCol(contactMap.email),
      org: optCol(contactMap.org),
      url: optCol(contactMap.url),
    }),
    [reqCol, optCol, contactMap]
  )

  const effTextCol = useMemo(() => reqCol(textCol), [reqCol, textCol])

  const bulkRows = useMemo<BulkRow[]>(() => {
    return dataRows.map((row, index) => {
      const at = (col: number): string => (col >= 0 && col < row.length ? row[col] : '')
      if (bulkKind === 'wifi') {
        const rowSsid = at(effWifi.ssid).trim()
        if (!rowSsid) return { index, label: `Row ${index + 1}`, payload: '', valid: false }
        const encRaw = at(effWifi.encryption).trim().toLowerCase()
        const enc: WifiType = encRaw.includes('wep')
          ? 'WEP'
          : encRaw === '' || /nopass|none|open/.test(encRaw)
            ? 'nopass'
            : 'WPA'
        const rowHidden = /^(true|yes|y|1)$/i.test(at(effWifi.hidden).trim())
        const pass = enc === 'nopass' ? '' : at(effWifi.password).trim()
        return {
          index,
          label: truncate(rowSsid, 36),
          payload: buildWifiPayload(enc, rowSsid, pass, rowHidden),
          valid: true,
        }
      }
      if (bulkKind === 'contact') {
        const name = at(effContact.name).trim()
        const phone = at(effContact.phone).trim()
        const email = at(effContact.email).trim()
        if (!name && !phone && !email) return { index, label: `Row ${index + 1}`, payload: '', valid: false }
        const org = at(effContact.org).trim()
        const url = at(effContact.url).trim()
        return {
          index,
          label: truncate(name || phone || email || 'Contact', 36),
          payload: buildVcard({ name, phone, email, org, url, address: '' }),
          valid: true,
        }
      }
      const value = at(effTextCol).trim()
      if (!value) return { index, label: `Row ${index + 1}`, payload: '', valid: false }
      return { index, label: truncate(value, 36), payload: value, valid: true }
    })
  }, [bulkKind, dataRows, effContact, effTextCol, effWifi])

  const validCount = useMemo(() => bulkRows.reduce((n, r) => n + (r.valid ? 1 : 0), 0), [bulkRows])

  /* Debounced bulk mini-QR generation (256px previews), cached per payload. */
  useEffect(() => {
    if (mode !== 'bulk') return
    let cancelled = false
    const t = setTimeout(() => {
      const targets = bulkRows.filter((r) => r.valid)
      if (targets.length === 0) {
        bulkQrsRef.current = {}
        setBulkQrs({})
        return
      }
      void (async () => {
        const next: Record<string, string> = {}
        for (const row of targets) {
          if (cancelled) return
          const key = bulkKey(row)
          const cached: string | undefined = bulkQrsRef.current[key]
          if (cached !== undefined) {
            next[key] = cached
            continue
          }
          try {
            next[key] = await QRCode.toDataURL(row.payload, {
              width: 256,
              margin: 1,
              errorCorrectionLevel: ec,
              color: QR_COLORS,
            })
          } catch {
            next[key] = QR_FAIL
          }
        }
        if (cancelled) return
        bulkQrsRef.current = next
        setBulkQrs(next)
      })()
    }, BULK_PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [mode, bulkRows, ec])

  /* Settled bulk rows auto-save (only when ≤ BULK_HISTORY_CAP rows). */
  useEffect(() => {
    if (mode !== 'bulk' || !historyLoaded) return
    const savable = bulkRows.filter((r) => r.valid)
    if (savable.length === 0 || savable.length > BULK_HISTORY_CAP) return
    const kindName = bulkKind === 'wifi' ? 'Wi-Fi' : bulkKind === 'contact' ? 'Contact' : 'Text'
    const sig = savable.map((r) => r.payload).join('\u0000')
    const t = setTimeout(() => {
      if (lastBulkSigRef.current === sig) return
      lastBulkSigRef.current = sig
      const seen = new Set(historyRef.current.map((h) => `${h.type}:${h.payload}`))
      const fresh = savable.filter((r) => !seen.has(`bulk:${r.payload}`))
      if (fresh.length === 0) return
      saveDocs(
        fresh.map<HistoryDoc>((r) => ({
          id: uid('qr'),
          type: 'bulk',
          label: `Bulk ${kindName} — ${r.label}`,
          payload: r.payload,
          createdAt: Date.now(),
        }))
      )
    }, BULK_SETTLE_SAVE_MS)
    return () => clearTimeout(t)
  }, [mode, historyLoaded, bulkRows, bulkKind, saveDocs])

  /* ================================================================== */
  /* Handlers                                                            */
  /* ================================================================== */

  const flashCopied = useCallback((key: string): void => {
    setCopiedKey(key)
    window.setTimeout(() => {
      setCopiedKey((k) => (k === key ? null : k))
    }, 1500)
  }, [])

  const onTabChange = (v: string): void => {
    if (v === 'text' || v === 'wifi' || v === 'vcard' || v === 'bulk' || v === 'history') setMode(v)
  }

  const singleFileName = (): string => {
    if (mode === 'wifi') return `qr-wifi-${slug(ssid.trim()) || 'network'}.png`
    if (mode === 'vcard') return `qr-contact-${slug(cName.trim()) || 'contact'}.png`
    return `qr-${slug(text.trim()) || 'text'}.png`
  }

  const downloadSingle = (): void => {
    if (!dataUrl) return
    const fileName = singleFileName()
    triggerDownload(dataUrl, fileName)
    haptic()
    toast({ title: 'Download started', description: `Saving ${fileName}` })
  }

  const copyPreview = async (): Promise<void> => {
    if (!hasPreviewPayload) return
    const ok = await copyText(previewPayload)
    if (ok) {
      flashCopied('preview')
      toast({
        title: 'Copied ✓',
        description: mode === 'vcard' ? 'vCard text saved to your clipboard' : 'Content saved to your clipboard',
      })
    } else {
      toast({ title: 'Copy failed', variant: 'destructive' })
    }
  }

  const copyRow = async (row: BulkRow): Promise<void> => {
    const ok = await copyText(row.payload)
    if (ok) {
      flashCopied(bulkKey(row))
      toast({ title: 'Copied ✓', description: truncate(row.label, 44) })
    } else {
      toast({ title: 'Copy failed', variant: 'destructive' })
    }
  }

  /* Per-row downloads always render at the selected PNG size / EC level,
     independent of the 256px mini previews. */
  const downloadRow = async (row: BulkRow): Promise<void> => {
    const fileName = `qr-bulk-${String(row.index + 1).padStart(2, '0')}-${slug(row.label) || 'row'}.png`
    try {
      const url = await QRCode.toDataURL(row.payload, {
        width: Number(size),
        margin: 2,
        errorCorrectionLevel: ec,
        color: QR_COLORS,
      })
      triggerDownload(url, fileName)
      haptic()
      toast({ title: 'Download started', description: truncate(row.label, 44) })
    } catch {
      toast({ title: 'Could not generate QR code', description: truncate(row.label, 44), variant: 'destructive' })
    }
  }

  const downloadAll = async (): Promise<void> => {
    if (downloadingAll) return
    const targets = bulkRows.filter((r) => r.valid).slice(0, BULK_DOWNLOAD_CAP)
    if (targets.length === 0) return
    setDownloadingAll(true)
    haptic()
    let queued = 0
    const rendered = new Map<string, string>()
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i]
      if (!row) break
      const key = bulkKey(row)
      let url = rendered.get(key)
      if (!url) {
        try {
          url = await QRCode.toDataURL(row.payload, {
            width: Number(size),
            margin: 2,
            errorCorrectionLevel: ec,
            color: QR_COLORS,
          })
          rendered.set(key, url)
        } catch {
          continue
        }
      }
      triggerDownload(url, `qr-bulk-${String(row.index + 1).padStart(2, '0')}-${slug(row.label) || 'row'}.png`)
      queued++
      if (i < targets.length - 1) await sleep(BULK_DOWNLOAD_STAGGER_MS)
      if (!mountedRef.current) return
    }
    if (mountedRef.current) {
      setDownloadingAll(false)
      toast({
        title: 'Download started',
        description: `Saving ${queued} QR ${queued === 1 ? 'code' : 'codes'} as PNG`,
      })
    }
  }

  const restoreDoc = (doc: HistoryDoc): void => {
    haptic()
    if (doc.type === 'wifi') {
      const p = parseWifiPayload(doc.payload)
      setWifiType(p.type)
      setSsid(p.ssid)
      setWifiPass(p.pass)
      setHidden(p.hidden)
      setMode('wifi')
    } else if (doc.type === 'vcard') {
      const c = parseVcardPayload(doc.payload)
      setCName(c.name)
      setCPhone(c.phone)
      setCEmail(c.email)
      setCOrg(c.org)
      setCUrl(c.url)
      setCAddress(c.address)
      setMode('vcard')
    } else {
      setText(doc.payload)
      setMode('text')
    }
    toast({ title: 'Restored', description: doc.label })
  }

  const copyHistoryRow = async (doc: HistoryDoc): Promise<void> => {
    const ok = await copyText(doc.payload)
    if (ok) {
      flashCopied(doc.id)
      toast({ title: 'Copied ✓', description: truncate(doc.label, 44) })
    } else {
      toast({ title: 'Copy failed', variant: 'destructive' })
    }
  }

  const deleteDoc = (id: string): void => {
    setHistory((prev) => prev.filter((h) => h.id !== id))
    void idbDelete(HISTORY_STORE, id).catch(() => {
      /* memory-only fallback */
    })
    haptic()
  }

  const clearHistory = (): void => {
    if (!confirmClearAll) {
      setConfirmClearAll(true)
      return
    }
    setConfirmClearAll(false)
    setHistory([])
    void idbClear(HISTORY_STORE).catch(() => {
      /* memory-only fallback */
    })
    haptic(20)
    toast({ title: 'History cleared', description: 'All saved codes were removed from this device' })
  }

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  const emptyHint =
    mode === 'wifi'
      ? 'Enter the Wi-Fi name (SSID) — the QR code will appear here'
      : mode === 'vcard'
        ? 'Fill in at least one contact field — the QR code will appear here'
        : 'Enter text or a link above — the QR code will appear here'

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-violet-500/[0.1] via-transparent to-fuchsia-500/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-400 via-purple-500 to-fuchsia-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(168_85_247/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <QrCode className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">QR Studio</h2>
              <p className="text-xs text-zinc-400">Links, Wi-Fi, contacts &amp; bulk codes — all on this device.</p>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <Tabs value={mode} onValueChange={onTabChange}>
            <TabsList className="grid h-auto w-full grid-cols-5 gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
              <TabsTrigger value="text" className={TRIGGER_CLS} aria-label="Link and text QR codes">
                <Link2 className="size-4" aria-hidden />
                Link/Text
              </TabsTrigger>
              <TabsTrigger value="wifi" className={TRIGGER_CLS} aria-label="Wi-Fi QR codes">
                <Wifi className="size-4" aria-hidden />
                Wi-Fi
              </TabsTrigger>
              <TabsTrigger value="vcard" className={TRIGGER_CLS} aria-label="Contact vCard QR codes">
                <User className="size-4" aria-hidden />
                Contact
              </TabsTrigger>
              <TabsTrigger value="bulk" className={TRIGGER_CLS} aria-label="Bulk CSV QR codes">
                <Table2 className="size-4" aria-hidden />
                Bulk
              </TabsTrigger>
              <TabsTrigger value="history" className={TRIGGER_CLS} aria-label="Generated codes history">
                <History className="size-4" aria-hidden />
                History
              </TabsTrigger>
            </TabsList>

            {/* ---------------- Link / Text tab (v1) ---------------- */}
            <TabsContent value="text" className="pt-3">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="space-y-1.5"
              >
                <Label htmlFor="qr-text" className="text-xs font-medium text-zinc-400">
                  Text or URL
                </Label>
                <Textarea
                  id="qr-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Enter any text or an https:// link…"
                  className={cn(TEXTAREA_CLS, 'min-h-[110px]')}
                  aria-label="QR code content"
                />
              </motion.div>
            </TabsContent>

            {/* ---------------- Wi-Fi tab (v1) ---------------- */}
            <TabsContent value="wifi" className="pt-3">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="space-y-3"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="qr-ssid" className="text-xs font-medium text-zinc-400">
                    Network name (SSID)
                  </Label>
                  <Input
                    id="qr-ssid"
                    value={ssid}
                    onChange={(e) => setSsid(e.target.value)}
                    placeholder="e.g. Home_WiFi"
                    className={INPUT_CLS}
                    aria-label="Wi-Fi network name"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="qr-wifipass" className="text-xs font-medium text-zinc-400">
                    Password
                  </Label>
                  <div className="relative">
                    <Input
                      id="qr-wifipass"
                      type={showPass ? 'text' : 'password'}
                      value={wifiPass}
                      onChange={(e) => setWifiPass(e.target.value)}
                      placeholder={wifiType === 'nopass' ? 'None selected — not required' : 'Wi-Fi password'}
                      disabled={wifiType === 'nopass'}
                      className={cn(INPUT_CLS, 'pr-13')}
                      aria-label="Wi-Fi password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 size-11 -translate-y-1/2 rounded-lg text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                      onClick={() => setShowPass((s) => !s)}
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                    >
                      {showPass ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium text-zinc-400">Security</Label>
                    <Select
                      value={wifiType}
                      onValueChange={(v) => (v === 'WPA' || v === 'WEP' || v === 'nopass') && setWifiType(v)}
                    >
                      <SelectTrigger className={SELECT_TRIGGER_CLS} aria-label="Select security type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className={SELECT_CONTENT_CLS}>
                        <SelectItem value="WPA">WPA / WPA2 / WPA3</SelectItem>
                        <SelectItem value="WEP">WEP (legacy)</SelectItem>
                        <SelectItem value="nopass">None (open network)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                    <Label htmlFor="qr-hidden" className="text-sm font-normal text-zinc-300">
                      Hidden network
                    </Label>
                    <Switch
                      id="qr-hidden"
                      checked={hidden}
                      onCheckedChange={(v) => setHidden(v)}
                      className="data-[state=checked]:bg-violet-500 data-[state=unchecked]:bg-zinc-700"
                      aria-label="Hidden network toggle"
                    />
                  </div>
                </div>
              </motion.div>
            </TabsContent>

            {/* ---------------- Contact tab (v2) ---------------- */}
            <TabsContent value="vcard" className="pt-3">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="space-y-3"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="qr-cname" className="text-xs font-medium text-zinc-400">
                    Name (full)
                  </Label>
                  <Input
                    id="qr-cname"
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                    placeholder="e.g. Ava Thornton"
                    className={INPUT_CLS}
                    autoComplete="off"
                    aria-label="Contact full name"
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="qr-cphone" className="text-xs font-medium text-zinc-400">
                      Phone
                    </Label>
                    <Input
                      id="qr-cphone"
                      type="tel"
                      value={cPhone}
                      onChange={(e) => setCPhone(e.target.value)}
                      placeholder="+1 555 010 2030"
                      className={INPUT_CLS}
                      autoComplete="off"
                      aria-label="Contact phone number"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="qr-cemail" className="text-xs font-medium text-zinc-400">
                      Email
                    </Label>
                    <Input
                      id="qr-cemail"
                      type="email"
                      value={cEmail}
                      onChange={(e) => setCEmail(e.target.value)}
                      placeholder="ava@example.com"
                      className={INPUT_CLS}
                      autoComplete="off"
                      aria-label="Contact email address"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="qr-corg" className="text-xs font-medium text-zinc-400">
                      Organization
                    </Label>
                    <Input
                      id="qr-corg"
                      value={cOrg}
                      onChange={(e) => setCOrg(e.target.value)}
                      placeholder="Company or team"
                      className={INPUT_CLS}
                      autoComplete="off"
                      aria-label="Contact organization"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="qr-curl" className="text-xs font-medium text-zinc-400">
                      Website
                    </Label>
                    <Input
                      id="qr-curl"
                      type="url"
                      value={cUrl}
                      onChange={(e) => setCUrl(e.target.value)}
                      placeholder="https://example.com"
                      className={INPUT_CLS}
                      autoComplete="off"
                      aria-label="Contact website"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="qr-caddress" className="text-xs font-medium text-zinc-400">
                    Address
                  </Label>
                  <Input
                    id="qr-caddress"
                    value={cAddress}
                    onChange={(e) => setCAddress(e.target.value)}
                    placeholder="Street, city, country"
                    className={INPUT_CLS}
                    autoComplete="off"
                    aria-label="Contact address"
                  />
                </div>

                <p className="text-[11px] leading-relaxed text-zinc-500">
                  Encodes a vCard 3.0 — scanners offer to save the contact straight to the phone book.
                </p>
              </motion.div>
            </TabsContent>

            {/* ---------------- Bulk tab (v2) ---------------- */}
            <TabsContent value="bulk" className="pt-3">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="space-y-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="qr-csv" className="text-xs font-medium text-zinc-400">
                      CSV rows — one QR code per line
                    </Label>
                    {csvRaw.trim() !== '' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-11 rounded-lg text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                        onClick={() => {
                          setCsvRaw('')
                          haptic()
                        }}
                        aria-label="Clear CSV input"
                      >
                        <Eraser className="size-4" aria-hidden />
                      </Button>
                    )}
                  </div>
                  <Textarea
                    id="qr-csv"
                    value={csvRaw}
                    onChange={(e) => setCsvRaw(e.target.value)}
                    placeholder={'ssid,password,encryption,hidden\nCafe_Guest,latte-art,WPA,false\nOffice,Guest1234,WPA,true'}
                    className={cn(TEXTAREA_CLS, 'min-h-[130px] font-mono text-xs leading-relaxed')}
                    aria-label="CSV input for bulk QR codes"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Bulk code type">
                  {BULK_KINDS.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => setBulkKind(k.id)}
                      aria-pressed={bulkKind === k.id}
                      className={cn(
                        'flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-2 text-xs font-medium transition-colors',
                        bulkKind === k.id
                          ? 'border-violet-400/50 bg-violet-500/15 text-violet-200'
                          : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]'
                      )}
                    >
                      <k.icon className="size-4" aria-hidden />
                      {k.label}
                    </button>
                  ))}
                </div>

                <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <Label htmlFor="qr-csv-header" className="text-sm font-normal text-zinc-300">
                    First row is header
                  </Label>
                  <Switch
                    id="qr-csv-header"
                    checked={headerOn}
                    onCheckedChange={setHeaderOn}
                    className="data-[state=checked]:bg-violet-500 data-[state=unchecked]:bg-zinc-700"
                    aria-label="Treat the first CSV row as a header"
                  />
                </div>

                {colCount > 0 && (
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {bulkKind === 'wifi' && (
                      <>
                        <MapSelect
                          id="qr-map-ssid"
                          label="SSID column"
                          value={effWifi.ssid}
                          options={columnOptions}
                          onChange={(v) => setWifiMap((m) => ({ ...m, ssid: v }))}
                          allowNone={false}
                        />
                        <MapSelect
                          id="qr-map-pass"
                          label="Password column"
                          value={effWifi.password}
                          options={columnOptions}
                          onChange={(v) => setWifiMap((m) => ({ ...m, password: v }))}
                          allowNone
                        />
                        <MapSelect
                          id="qr-map-enc"
                          label="Encryption column (WPA / WEP / nopass)"
                          value={effWifi.encryption}
                          options={columnOptions}
                          onChange={(v) => setWifiMap((m) => ({ ...m, encryption: v }))}
                          allowNone
                        />
                        <MapSelect
                          id="qr-map-hidden"
                          label="Hidden-flag column (true / false)"
                          value={effWifi.hidden}
                          options={columnOptions}
                          onChange={(v) => setWifiMap((m) => ({ ...m, hidden: v }))}
                          allowNone
                        />
                      </>
                    )}
                    {bulkKind === 'contact' && (
                      <>
                        <MapSelect
                          id="qr-map-name"
                          label="Name column"
                          value={effContact.name}
                          options={columnOptions}
                          onChange={(v) => setContactMap((m) => ({ ...m, name: v }))}
                          allowNone={false}
                        />
                        <MapSelect
                          id="qr-map-phone"
                          label="Phone column"
                          value={effContact.phone}
                          options={columnOptions}
                          onChange={(v) => setContactMap((m) => ({ ...m, phone: v }))}
                          allowNone
                        />
                        <MapSelect
                          id="qr-map-email"
                          label="Email column"
                          value={effContact.email}
                          options={columnOptions}
                          onChange={(v) => setContactMap((m) => ({ ...m, email: v }))}
                          allowNone
                        />
                        <MapSelect
                          id="qr-map-org"
                          label="Organization column"
                          value={effContact.org}
                          options={columnOptions}
                          onChange={(v) => setContactMap((m) => ({ ...m, org: v }))}
                          allowNone
                        />
                        <MapSelect
                          id="qr-map-url"
                          label="Website column"
                          value={effContact.url}
                          options={columnOptions}
                          onChange={(v) => setContactMap((m) => ({ ...m, url: v }))}
                          allowNone
                        />
                      </>
                    )}
                    {bulkKind === 'text' && (
                      <MapSelect
                        id="qr-map-text"
                        label="Content column"
                        value={effTextCol}
                        options={columnOptions}
                        onChange={(v) => setTextCol(v)}
                        allowNone={false}
                      />
                    )}
                  </div>
                )}

                {colCount > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tone="neutral">
                      {dataRows.length} data {dataRows.length === 1 ? 'row' : 'rows'}
                    </Chip>
                    <Chip tone="positive">
                      <Check className="size-3" aria-hidden /> {validCount} ready
                    </Chip>
                    {parsed.truncated && (
                      <Chip tone="warn">
                        <TriangleAlert className="size-3" aria-hidden /> Capped at {BULK_PARSE_CAP} rows
                      </Chip>
                    )}
                    {validCount > BULK_DOWNLOAD_CAP && (
                      <Chip tone="warn">
                        <TriangleAlert className="size-3" aria-hidden /> Download all runs the first {BULK_DOWNLOAD_CAP}{' '}
                        only
                      </Chip>
                    )}
                    {validCount > BULK_HISTORY_CAP && (
                      <Chip tone="warn">
                        <TriangleAlert className="size-3" aria-hidden /> Rows above {BULK_HISTORY_CAP} are not kept in
                        history
                      </Chip>
                    )}
                  </div>
                )}

                {dataRows.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center">
                    <Table2 className="size-7 text-zinc-600" aria-hidden />
                    <p className="max-w-xs text-sm text-zinc-500">
                      Paste CSV above — every line becomes one QR code. Optional header row, flexible column mapping,
                      quotes and trailing commas tolerated.
                    </p>
                  </div>
                ) : validCount === 0 ? (
                  <div className="flex items-center gap-2 rounded-2xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
                    <TriangleAlert className="size-4 shrink-0" aria-hidden />
                    No valid rows — check that the required columns (SSID, name or content) are mapped.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
                    {bulkRows.map((row) => {
                      const url: string | undefined = row.valid ? bulkQrs[bulkKey(row)] : undefined
                      return (
                        <motion.div
                          key={row.index}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.18, ease: 'easeOut' }}
                          className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5"
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="shrink-0 rounded-md bg-white/[0.07] px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
                              #{row.index + 1}
                            </span>
                            <p className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-200" title={row.label}>
                              {row.label}
                            </p>
                          </div>
                          <div className="flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-white p-1">
                            {!row.valid ? (
                              <span className="px-2 text-center text-[10px] font-medium leading-snug text-zinc-500">
                                Missing required field
                              </span>
                            ) : url === QR_FAIL ? (
                              <span className="px-2 text-center text-[10px] font-medium leading-snug text-rose-500">
                                Too long to encode
                              </span>
                            ) : url ? (
                              <img
                                src={url}
                                alt={`QR code for row ${row.index + 1}`}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <Loader2 className="size-5 animate-spin text-zinc-400" aria-label="Generating QR code" />
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-11 rounded-lg border-white/10 bg-white/[0.03] px-2 text-[11px] text-zinc-200 hover:bg-white/[0.08] hover:text-white"
                              disabled={!row.valid || !url || url === QR_FAIL}
                              onClick={() => void downloadRow(row)}
                              aria-label={`Download PNG for ${row.label}`}
                            >
                              <Download className="size-3.5" aria-hidden /> PNG
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-11 rounded-lg bg-white/[0.06] px-2 text-[11px] text-zinc-200 hover:bg-white/[0.1] hover:text-white"
                              disabled={!row.valid}
                              onClick={() => void copyRow(row)}
                              aria-label={`Copy payload for ${row.label}`}
                            >
                              {copiedKey === bulkKey(row) ? (
                                <Check className="size-3.5 text-emerald-400" aria-hidden />
                              ) : (
                                <Copy className="size-3.5" aria-hidden />
                              )}
                              Copy
                            </Button>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>
                )}

                <Button
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 font-semibold text-white shadow-lg shadow-violet-500/25 hover:from-violet-400 hover:to-fuchsia-500 disabled:opacity-50"
                  onClick={() => void downloadAll()}
                  disabled={validCount === 0 || downloadingAll}
                  aria-label="Download all bulk QR codes as PNG"
                >
                  {downloadingAll ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Download className="size-4" aria-hidden />
                  )}
                  {downloadingAll
                    ? 'Downloading…'
                    : `Download all${validCount > BULK_DOWNLOAD_CAP ? ` (first ${BULK_DOWNLOAD_CAP})` : ''}`}
                </Button>
              </motion.div>
            </TabsContent>

            {/* ---------------- History tab (v2) ---------------- */}
            <TabsContent value="history" className="pt-3">
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <Chip tone="neutral">{history.length} saved</Chip>
                  <Button
                    variant={confirmClearAll ? 'destructive' : 'outline'}
                    size="sm"
                    className={cn(
                      'h-11 rounded-xl px-3 text-xs',
                      confirmClearAll
                        ? 'text-white'
                        : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/[0.08]'
                    )}
                    disabled={history.length === 0}
                    onClick={clearHistory}
                    aria-label="Clear all saved codes"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    {confirmClearAll ? 'Tap again to clear' : 'Clear all'}
                  </Button>
                </div>

                {!historyLoaded ? (
                  <div className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
                    ))}
                  </div>
                ) : history.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center">
                    <History className="size-7 text-zinc-600" aria-hidden />
                    <p className="max-w-xs text-sm text-zinc-500">
                      Nothing saved yet — every code you generate lands here automatically, stored on this device only.
                    </p>
                  </div>
                ) : (
                  <div className={cn('max-h-96 space-y-2 overflow-y-auto pr-1', THIN_SCROLLBAR)}>
                    {history.map((doc) => {
                      const meta = HISTORY_META[doc.type]
                      return (
                        <motion.div
                          key={doc.id}
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.16, ease: 'easeOut' }}
                          className="flex items-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.03] p-2"
                        >
                          <button
                            type="button"
                            onClick={() => restoreDoc(doc)}
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left transition-colors hover:bg-white/[0.04]"
                            aria-label={`Restore ${doc.label} into its form`}
                          >
                            <span
                              className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', meta.tile)}
                            >
                              <meta.icon className="size-4" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-zinc-100">{doc.label}</span>
                              <span className="block text-[11px] text-zinc-500">
                                {meta.name} · saved {timeAgo(doc.createdAt)}
                              </span>
                            </span>
                          </button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 shrink-0 rounded-lg text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
                            onClick={() => void copyHistoryRow(doc)}
                            aria-label={`Copy payload of ${doc.label}`}
                          >
                            {copiedKey === doc.id ? (
                              <Check className="size-4 text-emerald-400" aria-hidden />
                            ) : (
                              <Copy className="size-4" aria-hidden />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 shrink-0 rounded-lg text-zinc-400 hover:bg-rose-500/10 hover:text-rose-300"
                            onClick={() => deleteDoc(doc.id)}
                            aria-label={`Delete ${doc.label} from history`}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </motion.div>
                      )
                    })}
                  </div>
                )}

                <p className="text-[11px] leading-relaxed text-zinc-500">
                  Tap a row to load it back into its form — Wi-Fi and contact codes are re-parsed into fields when
                  possible, everything else opens in Link/Text. Stored in this browser via IndexedDB.
                </p>
              </motion.div>
            </TabsContent>
          </Tabs>

          {/* ---------------- Shared options ---------------- */}
          {mode !== 'history' && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-400">PNG size</Label>
                <Select value={size} onValueChange={(v) => (v === '256' || v === '512' || v === '1024') && setSize(v)}>
                  <SelectTrigger className={SELECT_TRIGGER_CLS} aria-label="Select QR code size">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={SELECT_CONTENT_CLS}>
                    <SelectItem value="256">256 px</SelectItem>
                    <SelectItem value="512">512 px</SelectItem>
                    <SelectItem value="1024">1024 px</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-zinc-400">Error correction</Label>
                <Select
                  value={ec}
                  onValueChange={(v) => (v === 'L' || v === 'M' || v === 'Q' || v === 'H') && setEc(v)}
                >
                  <SelectTrigger className={SELECT_TRIGGER_CLS} aria-label="Select error correction level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className={SELECT_CONTENT_CLS}>
                    <SelectItem value="L">L — 7% recovery</SelectItem>
                    <SelectItem value="M">M — 15% (default)</SelectItem>
                    <SelectItem value="Q">Q — 25%</SelectItem>
                    <SelectItem value="H">H — 30%</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <p className="col-span-full text-center text-[11px] text-zinc-500">
                Codes render black-on-white for maximum scanner compatibility.
              </p>
            </div>
          )}

          {/* ---------------- QR display (single modes) ---------------- */}
          {isSingle && (
            <div className="mt-4">
              {!hasPreviewPayload ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 py-10 text-center text-sm text-zinc-500">
                  <QrCode className="size-8 text-zinc-600" aria-hidden />
                  {emptyHint}
                </div>
              ) : qrError ? (
                <Alert variant="destructive" className="rounded-2xl border-rose-500/30 bg-rose-500/10 text-rose-200">
                  <TriangleAlert className="size-4" aria-hidden />
                  <AlertTitle>Could not generate QR code</AlertTitle>
                  <AlertDescription>{qrError}</AlertDescription>
                </Alert>
              ) : dataUrl ? (
                <motion.div
                  key={dataUrl.slice(-24)}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  className="flex justify-center"
                >
                  <div className="rounded-2xl bg-white p-3 shadow-md">
                    <img
                      src={dataUrl}
                      alt="QR code preview"
                      width={Number(size)}
                      height={Number(size)}
                      className="h-auto max-w-full rounded-lg"
                    />
                  </div>
                </motion.div>
              ) : (
                <div className="flex justify-center py-10" role="status" aria-label="Generating QR code">
                  <div className="size-8 animate-spin rounded-full border-2 border-zinc-600 border-t-transparent" />
                </div>
              )}

              {/* ---------------- Actions ---------------- */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="h-11 rounded-xl border-white/10 bg-white/[0.03] text-zinc-100 hover:bg-white/[0.08] hover:text-white"
                  onClick={downloadSingle}
                  disabled={!dataUrl}
                  aria-label="Download QR code as PNG"
                >
                  <Download className="size-4" aria-hidden />
                  Download
                </Button>
                <Button
                  variant="secondary"
                  className="h-11 rounded-xl bg-white/[0.08] text-zinc-100 hover:bg-white/[0.12] hover:text-white"
                  onClick={() => void copyPreview()}
                  disabled={!hasPreviewPayload}
                  aria-label="Copy QR code content"
                >
                  {copiedKey === 'preview' ? (
                    <Check className="size-4 text-emerald-400" aria-hidden />
                  ) : (
                    <Copy className="size-4" aria-hidden />
                  )}
                  Copy
                </Button>
              </div>

              {hasPreviewPayload && !qrError && (
                <p className="mt-3 break-all text-center text-[11px] leading-relaxed text-zinc-500">
                  Encoding: {previewPayload}
                </p>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  )
}
