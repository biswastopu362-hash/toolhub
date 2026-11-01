'use client'

/**
 * Hash & UUID — digests and identifiers, computed entirely on-device.
 *
 * Tab 1 ("Hash") digests text or a locally picked file (read into memory,
 * never persisted) with SHA-1/256/384/512 via Web Crypto — feature-guarded
 * for non-secure contexts with a graceful notice — plus a self-contained
 * RFC 1321 MD5 (pure JS over bytes, correct for arbitrary lengths). Digests
 * render in hex or Base64, optionally uppercase, with per-row copy,
 * tap-to-expand middle truncation on mobile, and a live case-insensitive
 * verify badge checked against every computed digest. Tab 2 ("UUID") rolls
 * RFC 4122 v4 identifiers via crypto.randomUUID() with a
 * crypto.getRandomValues fallback, one at a time or in batches of 1–100,
 * with uppercase / no-dash formatting, copy-all, and the last three batches
 * restoreable. The newest batch is cached in localStorage under
 * `toolhub-hashuuid-lastbatch`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Binary,
  Check,
  Copy,
  Dices,
  File,
  FileUp,
  Fingerprint,
  Hash,
  History,
  ListPlus,
  Loader2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model + constants                                                   */
/* ================================================================== */

type AlgoId = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512' | 'MD5'

interface AlgoMeta {
  id: AlgoId
  bits: number
  insecure?: boolean
}

const ALGOS: AlgoMeta[] = [
  { id: 'SHA-1', bits: 160 },
  { id: 'SHA-256', bits: 256 },
  { id: 'SHA-384', bits: 384 },
  { id: 'SHA-512', bits: 512 },
  { id: 'MD5', bits: 128, insecure: true },
]

type HashFormat = 'hex' | 'b64'
type VerifyState = 'idle' | 'pending' | 'match' | 'mismatch'

interface FileSource {
  name: string
  size: number
  bytes: Uint8Array<ArrayBuffer>
}

interface UuidBatch {
  id: number
  at: number
  uuids: string[]
}

const DEBOUNCE_MS = 250
/** Files above this size show the "hashing…" shimmer. */
const LARGE_FILE_BYTES = 2 * 1024 * 1024
/** Hard cap so a runaway pick can't freeze the tab for minutes. */
const MAX_FILE_BYTES = 512 * 1024 * 1024
/** Last generated batch is cached here (best effort, device-local). */
const LAST_BATCH_KEY = 'toolhub-hashuuid-lastbatch'

/** Thin glass scrollbar for long lists (house convention). */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/** Tab trigger overrides — explicit zinc styling survives light/dark themes. */
const TAB_TRIGGER_CLS =
  'h-full rounded-lg text-xs font-semibold text-zinc-500! shadow-none data-[state=active]:bg-white/10! data-[state=active]:text-white! data-[state=active]:shadow-none!'

/* ================================================================== */
/* MD5 — RFC 1321, self-contained pure JS over bytes                   */
/* ================================================================== */

/** Per-round left-rotate amounts: rounds 1–4, four steps each. */
const MD5_SHIFTS: readonly number[] = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21]

/** Sine table T[i] = floor(2^32 × |sin(i + 1)|), precomputed once. */
const MD5_K: readonly number[] = Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)
)

/**
 * MD5 hex digest of arbitrary bytes (RFC 1321): the message is padded with
 * 0x80 + zeros to ≡ 448 mod 512 bits, a 64-bit little-endian bit length is
 * appended, then 64 rounds (F/G/H/I over little-endian 32-bit words) compress
 * each 512-bit block into the running state.
 */
function md5Hex(bytes: Uint8Array): string {
  const len = bytes.length
  const paddedLen = Math.ceil((len + 9) / 64) * 64
  const padded = new Uint8Array(paddedLen)
  padded.set(bytes)
  padded[len] = 0x80
  const dv = new DataView(padded.buffer)
  const bits = len * 8
  dv.setUint32(paddedLen - 8, bits >>> 0, true)
  dv.setUint32(paddedLen - 4, Math.floor(bits / 4294967296) >>> 0, true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  const m = new Int32Array(16)
  for (let off = 0; off < paddedLen; off += 64) {
    for (let j = 0; j < 16; j++) m[j] = dv.getInt32(off + j * 4, true)
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let i = 0; i < 64; i++) {
      let f: number
      let g: number
      if (i < 16) {
        f = (b & c) | (~b & d)
        g = i
      } else if (i < 32) {
        f = (d & b) | (~d & c)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        f = b ^ c ^ d
        g = (3 * i + 5) % 16
      } else {
        f = c ^ (b | ~d)
        g = (7 * i) % 16
      }
      const s = MD5_SHIFTS[((i >> 4) << 2) | (i & 3)] ?? 0
      f = (f + a + (MD5_K[i] ?? 0) + (m[g] ?? 0)) | 0
      a = d
      d = c
      c = b
      b = (b + ((f << s) | (f >>> (32 - s)))) | 0
    }
    a0 = (a0 + a) | 0
    b0 = (b0 + b) | 0
    c0 = (c0 + c) | 0
    d0 = (d0 + d) | 0
  }

  // Four 32-bit state words, each serialized little-endian.
  const out = new Uint8Array(16)
  const odv = new DataView(out.buffer)
  odv.setInt32(0, a0, true)
  odv.setInt32(4, b0, true)
  odv.setInt32(8, c0, true)
  odv.setInt32(12, d0, true)
  let hex = ''
  for (let i = 0; i < 16; i++) hex += (out[i] ?? 0).toString(16).padStart(2, '0')
  return hex
}

/* ================================================================== */
/* Web Crypto SHA + byte/format helpers                                */
/* ================================================================== */

/** True when Web Crypto's SubtleCrypto is usable (secure contexts only). */
function subtleAvailable(): boolean {
  return typeof crypto !== 'undefined' && !!crypto.subtle
}

async function shaHex(algo: Exclude<AlgoId, 'MD5'>, bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  if (!subtleAvailable()) throw new Error('Web Crypto unavailable')
  const buf = await crypto.subtle.digest(algo, bytes)
  const view = new Uint8Array(buf)
  let hex = ''
  for (let i = 0; i < view.length; i++) hex += (view[i] ?? 0).toString(16).padStart(2, '0')
  return hex
}

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

/** Render a hex digest in the active format (hex/Base64, optional uppercase). */
function formatDigest(hex: string, fmt: HashFormat, upper: boolean): string {
  if (!hex) return ''
  const value = fmt === 'hex' ? hex : hexToBase64(hex)
  return upper ? value.toUpperCase() : value
}

function formatUuid(id: string, upper: boolean, noDashes: boolean): string {
  const dashed = noDashes ? id.replace(/-/g, '') : id
  return upper ? dashed.toUpperCase() : dashed
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`
  return `${(n / 1073741824).toFixed(2)} GB`
}

function truncateMiddle(s: string, head: number = 12, tail: number = 8): string {
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

function clockTime(ms: number): string {
  const d = new Date(ms)
  const p = (x: number): string => x.toString().padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function clampCount(raw: string): number {
  const n = Number.parseInt(raw, 10)
  if (Number.isNaN(n)) return 8
  return Math.min(100, Math.max(1, n))
}

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

/** Clipboard write with a legacy textarea fallback for insecure contexts. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

/**
 * RFC 4122 v4: crypto.randomUUID() when present (secure contexts), otherwise
 * 16 bytes from crypto.getRandomValues with the version/variant bits set; a
 * Math.random path covers devices without Web Crypto entirely.
 */
function generateUuidV4(): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const buf = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(buf)
  } else {
    for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  buf[6] = (buf[6] & 0x0f) | 0x40 // version 4
  buf[8] = (buf[8] & 0x3f) | 0x80 // RFC 4122 variant
  let out = ''
  for (let i = 0; i < 16; i++) {
    out += (buf[i] ?? 0).toString(16).padStart(2, '0')
    if (i === 3 || i === 5 || i === 7 || i === 9) out += '-'
  }
  return out
}

/* ================================================================== */
/* Shared micro-components                                             */
/* ================================================================== */

interface CopyIconButtonProps {
  value: string
  label: string
  onCopy: (value: string, label: string) => void
  disabled?: boolean
}

function CopyIconButton({ value, label, onCopy, disabled = false }: CopyIconButtonProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    []
  )

  const handleCopy = (): void => {
    if (disabled) return
    onCopy(value, label)
    setCopied(true)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      aria-label={`Copy ${label}`}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white',
        copied && 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </button>
  )
}

interface HashRowProps {
  meta: AlgoMeta
  display: string
  onCopy: (value: string, label: string) => void
}

function HashRow({ meta, display, onCopy }: HashRowProps) {
  const [expanded, setExpanded] = useState(false)
  const failed = display.length === 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-semibold tracking-wide text-emerald-300">{meta.id}</span>
        {meta.insecure && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            <TriangleAlert className="size-3" aria-hidden /> insecure
          </span>
        )}
        <span className="ml-auto text-[10px] text-zinc-600">{failed ? 'unavailable' : `${meta.bits} bits`}</span>
        <CopyIconButton value={display} label={`${meta.id} digest`} onCopy={onCopy} disabled={failed} />
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="mt-1.5 block w-full cursor-pointer text-left"
      >
        {failed ? (
          <span className="block break-all font-mono text-[13px] leading-relaxed text-zinc-600">
            Could not compute this digest on this device.
          </span>
        ) : (
          <>
            {/* mobile: middle-truncated, tap to expand */}
            <span className="block break-all font-mono text-[13px] leading-relaxed text-zinc-400 md:hidden">
              {expanded ? display : truncateMiddle(display)}
            </span>
            {/* desktop: full digest */}
            <span className="hidden break-all font-mono text-[13px] leading-relaxed text-zinc-400 md:block">
              {display}
            </span>
          </>
        )}
      </button>
    </motion.div>
  )
}

interface UuidRowProps {
  value: string
  index: number
  onCopy: (value: string, label: string) => void
}

function UuidRow({ value, index, onCopy }: UuidRowProps) {
  return (
    <div className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 transition-colors hover:bg-white/[0.06]">
      <span className="w-6 shrink-0 text-right font-mono text-[10px] text-zinc-600">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200" title={value}>
        {value}
      </span>
      <CopyIconButton value={value} label={`UUID #${index + 1}`} onCopy={onCopy} />
    </div>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function HashUuidApp() {
  const { toast } = useToast()

  /* ---------------- hash tab state ---------------- */
  const [text, setText] = useState('')
  const [fileData, setFileData] = useState<FileSource | null>(null)
  const [selected, setSelected] = useState<AlgoId[]>(['SHA-256'])
  const [results, setResults] = useState<Partial<Record<AlgoId, string>>>({})
  const [busy, setBusy] = useState(false)
  const [fmt, setFmt] = useState<HashFormat>('hex')
  const [upper, setUpper] = useState(false)
  const [expected, setExpected] = useState('')
  const [subtleOk, setSubtleOk] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const hashRunRef = useRef(0)

  /* ---------------- uuid tab state ---------------- */
  const [single, setSingle] = useState('')
  const [bulkUuids, setBulkUuids] = useState<string[]>([])
  const [count, setCount] = useState('8')
  const [uuidUpper, setUuidUpper] = useState(false)
  const [uuidNoDash, setUuidNoDash] = useState(false)
  const [recent, setRecent] = useState<UuidBatch[]>([])
  const [batchKey, setBatchKey] = useState(0)
  const batchSeqRef = useRef(1)

  /* ---------------- hash: file source ---------------- */
  const loadFile = useCallback(
    (file: File) => {
      if (file.size > MAX_FILE_BYTES) {
        toast({
          title: 'File too large',
          description: `Limit is ${formatBytes(MAX_FILE_BYTES)} — that file is ${formatBytes(file.size)}.`,
          variant: 'destructive',
        })
        return
      }
      void (async () => {
        try {
          const buf = await file.arrayBuffer()
          setFileData({ name: file.name, size: file.size, bytes: new Uint8Array(buf) })
          toast({ title: 'File loaded', description: `${file.name} · ${formatBytes(file.size)}` })
        } catch {
          toast({ title: 'Could not read file', description: 'Reading this file failed on this device.', variant: 'destructive' })
        }
      })()
    },
    [toast]
  )

  const onFileInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] ?? null
      e.target.value = ''
      if (file) loadFile(file)
    },
    [loadFile]
  )

  const clearFile = useCallback(() => setFileData(null), [])

  /* ---------------- hash: algorithm chips ---------------- */
  const toggleAlgo = useCallback((id: AlgoId) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]))
  }, [])

  /* ---------------- copy plumbing ---------------- */
  const copyValue = useCallback(
    (value: string, label: string) => {
      haptic(12)
      void (async () => {
        const ok = await copyToClipboard(value)
        if (ok) {
          toast({ title: 'Copied', description: label })
        } else {
          toast({ title: 'Copy failed', description: 'The clipboard is unavailable here.', variant: 'destructive' })
        }
      })()
    },
    [toast]
  )

  /* ---------------- uuid actions ---------------- */
  const genSingle = useCallback(() => {
    setSingle(generateUuidV4())
    haptic(12)
  }, [])

  const normalizeCount = useCallback(() => setCount(String(clampCount(count))), [count])

  const genBatch = useCallback(() => {
    const n = clampCount(count)
    const at = Date.now()
    const uuids = Array.from({ length: n }, () => generateUuidV4())
    const batch: UuidBatch = { id: batchSeqRef.current++, at, uuids }
    setBulkUuids(uuids)
    setBatchKey((k) => k + 1)
    setRecent((prev) => [batch, ...prev].slice(0, 3))
    try {
      localStorage.setItem(LAST_BATCH_KEY, JSON.stringify({ at, uuids }))
    } catch {
      /* storage unavailable — memory only */
    }
    haptic(12)
    toast({ title: 'Batch generated', description: `${n} UUID v4${n === 1 ? '' : 's'} — kept on this device only.` })
  }, [count, toast])

  const restoreBatch = useCallback(
    (batch: UuidBatch) => {
      setBulkUuids(batch.uuids)
      setBatchKey((k) => k + 1)
      setCount(String(batch.uuids.length))
      toast({
        title: 'Batch restored',
        description: `${batch.uuids.length} UUID${batch.uuids.length === 1 ? '' : 's'} from ${clockTime(batch.at)}.`,
      })
    },
    [toast]
  )

  const clearBulk = useCallback(() => {
    setBulkUuids([])
    setBatchKey((k) => k + 1)
  }, [])

  const copyAll = useCallback(() => {
    if (bulkUuids.length === 0) return
    copyValue(
      bulkUuids.map((u) => formatUuid(u, uuidUpper, uuidNoDash)).join('\n'),
      `${bulkUuids.length} UUID${bulkUuids.length === 1 ? '' : 's'} joined with newlines`
    )
  }, [bulkUuids, uuidUpper, uuidNoDash, copyValue])

  /* ---------------- mount effects ---------------- */
  // Probe the secure context after hydration (SSR has no reliable answer).
  useEffect(() => {
    const t = setTimeout(() => setSubtleOk(subtleAvailable()), 0)
    return () => clearTimeout(t)
  }, [])

  // Restore the last cached batch (tolerant parsing, best effort).
  useEffect(() => {
    const restore = () => {
      try {
        const raw = localStorage.getItem(LAST_BATCH_KEY)
        if (!raw) return
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') return
        const rec = parsed as { at?: unknown; uuids?: unknown }
        const at = typeof rec.at === 'number' ? rec.at : Date.now()
        const uuids = Array.isArray(rec.uuids)
          ? rec.uuids.filter((u): u is string => typeof u === 'string').slice(0, 100)
          : []
        if (uuids.length === 0) return
        setBulkUuids(uuids)
        setCount(String(uuids.length))
        setRecent([{ id: 0, at, uuids }])
      } catch {
        /* corrupted or unavailable storage — start fresh */
      }
    }
    const t = setTimeout(restore, 0)
    return () => clearTimeout(t)
  }, [])

  /* ---------------- debounced hashing (text or file source) ---------------- */
  useEffect(() => {
    const runId = ++hashRunRef.current
    const timer = setTimeout(() => {
      const file = fileData
      const bytes: Uint8Array<ArrayBuffer> | null = file
        ? file.bytes
        : text.length > 0
          ? new TextEncoder().encode(text)
          : null
      if (!bytes || selected.length === 0) {
        setResults({})
        setBusy(false)
        return
      }
      const large = file !== null && file.size > LARGE_FILE_BYTES
      if (large) setBusy(true)
      void (async () => {
        const next: Partial<Record<AlgoId, string>> = {}
        for (const algo of selected) {
          try {
            next[algo] = algo === 'MD5' ? md5Hex(bytes) : await shaHex(algo, bytes)
          } catch {
            next[algo] = ''
          }
        }
        if (hashRunRef.current !== runId) return
        setResults(next)
        if (large) setBusy(false)
      })()
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text, fileData, selected])

  /* ---------------- derived (hash) ---------------- */
  const hasSource = fileData !== null || text.length > 0

  const resultRows = useMemo<AlgoMeta[]>(
    () => ALGOS.filter((meta) => selected.includes(meta.id)),
    [selected]
  )

  const expectedNorm = expected.trim().toLowerCase()
  const matchedAlgos = useMemo<AlgoId[]>(() => {
    if (!expectedNorm) return []
    return ALGOS.filter((meta) => {
      const hex = results[meta.id]
      if (!hex) return false
      return hex.toLowerCase() === expectedNorm || hexToBase64(hex).toLowerCase() === expectedNorm
    }).map((meta) => meta.id)
  }, [results, expectedNorm])

  const verifyState: VerifyState = !expectedNorm
    ? 'idle'
    : matchedAlgos.length > 0
      ? 'match'
      : resultRows.length === 0 || Object.keys(results).length === 0
        ? 'pending'
        : 'mismatch'

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-emerald-500/[0.1] via-transparent to-cyan-500/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(16_185_129/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Hash className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Hash &amp; UUID</h2>
              <p className="text-xs text-zinc-400">Digests and identifiers, computed on this device.</p>
            </div>
          </div>
        </div>

        {/* ---------------- Tabs ---------------- */}
        <div className="p-4 sm:p-5">
          <Tabs defaultValue="hash">
            <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl border border-white/10 bg-white/[0.04] p-1 text-zinc-400">
              <TabsTrigger value="hash" className={TAB_TRIGGER_CLS}>
                Hash
              </TabsTrigger>
              <TabsTrigger value="uuid" className={TAB_TRIGGER_CLS}>
                UUID
              </TabsTrigger>
            </TabsList>

            {/* ==================== TAB 1 — HASH ==================== */}
            <TabsContent value="hash" className="mt-4 space-y-4">
              {/* ---------- source ---------- */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Input</span>
                  <span className="text-[11px] text-zinc-600">
                    {fileData ? `source · file` : `${text.length} chars`}
                  </span>
                </div>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type or paste text to hash…"
                  spellCheck={false}
                  className="mt-2.5 min-h-28 w-full resize-none rounded-xl border-white/10 bg-white/5! p-3.5 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus-visible:border-emerald-400/50 focus-visible:ring-1 focus-visible:ring-emerald-400/30"
                />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-10 rounded-xl border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
                  >
                    <FileUp className="size-4" aria-hidden /> Hash a file
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={onFileInputChange}
                    aria-hidden
                    tabIndex={-1}
                  />
                  {fileData ? (
                    <div className="flex h-10 min-w-0 max-w-full items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 pl-3 pr-1.5 text-xs">
                      <File className="size-3.5 shrink-0 text-emerald-300" aria-hidden />
                      <span className="min-w-0 truncate font-medium text-emerald-100">{fileData.name}</span>
                      <span className="shrink-0 text-emerald-300/70">{formatBytes(fileData.size)}</span>
                      <button
                        type="button"
                        onClick={clearFile}
                        aria-label="Clear file"
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg text-emerald-300/70 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-zinc-600">any file · read in memory, never stored</span>
                  )}
                </div>
                {fileData && (
                  <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">
                    File source active — digests below are computed from this file. Clear it to hash text instead.
                  </p>
                )}
              </section>

              {/* ---------- secure-context notice ---------- */}
              {!subtleOk && (
                <div className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-3.5">
                  <div className="flex items-start gap-2.5">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-amber-200">SHA digests need a secure context</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-amber-200/70">
                        Web Crypto (crypto.subtle) is unavailable over plain HTTP. Open ToolHub via HTTPS or
                        localhost to enable SHA-1/256/384/512 — MD5 keeps working offline either way.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ---------- algorithms ---------- */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Algorithms</span>
                  <span className="text-[11px] text-zinc-600">
                    {selected.length}/{ALGOS.length} selected
                  </span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {ALGOS.map((meta) => {
                    const active = selected.includes(meta.id)
                    return (
                      <button
                        key={meta.id}
                        type="button"
                        onClick={() => toggleAlgo(meta.id)}
                        aria-pressed={active}
                        className={cn(
                          'flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors',
                          active
                            ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                            : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                        )}
                      >
                        <Check
                          className={cn('size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')}
                          aria-hidden
                        />
                        {meta.id}
                        {meta.insecure && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                            <TriangleAlert className="size-3" aria-hidden /> insecure
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* ---------- display toggles ---------- */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="inline-flex overflow-hidden rounded-xl border border-white/10" role="group" aria-label="Digest encoding">
                  <button
                    type="button"
                    onClick={() => setFmt('hex')}
                    aria-pressed={fmt === 'hex'}
                    className={cn(
                      'h-10 px-4 font-mono text-xs font-semibold transition-colors',
                      fmt === 'hex'
                        ? 'bg-emerald-400/15 text-emerald-200'
                        : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                    )}
                  >
                    HEX
                  </button>
                  <button
                    type="button"
                    onClick={() => setFmt('b64')}
                    aria-pressed={fmt === 'b64'}
                    className={cn(
                      'h-10 px-4 text-xs font-semibold transition-colors',
                      fmt === 'b64'
                        ? 'bg-emerald-400/15 text-emerald-200'
                        : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                    )}
                  >
                    Base64
                  </button>
                </div>
                <div className="flex items-center gap-2.5">
                  <Switch
                    id="hashuuid-upper"
                    checked={upper}
                    onCheckedChange={(v) => setUpper(v)}
                    className="data-[state=checked]:bg-emerald-500! data-[state=unchecked]:bg-white/10!"
                  />
                  <label htmlFor="hashuuid-upper" className="select-none text-xs text-zinc-300">
                    Uppercase
                  </label>
                </div>
              </div>

              {/* ---------- hashing shimmer ---------- */}
              {busy && (
                <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-xs text-zinc-400">
                  <Loader2 className="size-3.5 animate-spin text-emerald-300" aria-hidden /> Hashing large file…
                </div>
              )}

              {/* ---------- results ---------- */}
              {!hasSource ? (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 text-emerald-300">
                    <Fingerprint className="size-6" aria-hidden />
                  </span>
                  <p className="text-sm font-medium text-zinc-300">Nothing to hash yet</p>
                  <p className="text-xs text-zinc-500">Enter text above or pick a file — digests appear here instantly.</p>
                </div>
              ) : resultRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-8 text-center text-xs text-zinc-500">
                  Select at least one algorithm above.
                </div>
              ) : (
                <div className="space-y-2">
                  {resultRows.map((meta) => (
                    <HashRow
                      key={meta.id}
                      meta={meta}
                      display={formatDigest(results[meta.id] ?? '', fmt, upper)}
                      onCopy={copyValue}
                    />
                  ))}
                </div>
              )}

              {/* ---------- verify ---------- */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Verify</span>
                  {verifyState === 'idle' && (
                    <Badge variant="outline" className="border-white/10 bg-white/5 text-zinc-500">
                      no expected hash
                    </Badge>
                  )}
                  {verifyState === 'pending' && (
                    <Badge variant="outline" className="border-white/10 bg-white/5 text-zinc-500">
                      waiting for digests
                    </Badge>
                  )}
                  {verifyState === 'match' && (
                    <Badge className="border-emerald-400/30 bg-emerald-400/15 text-emerald-300">
                      MATCH · {matchedAlgos.join(', ')}
                    </Badge>
                  )}
                  {verifyState === 'mismatch' && (
                    <Badge className="border-rose-400/30 bg-rose-400/15 text-rose-300">MISMATCH</Badge>
                  )}
                </div>
                <Input
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                  placeholder="Paste an expected digest (hex or Base64)…"
                  spellCheck={false}
                  className="mt-2.5 h-11 w-full rounded-xl border-white/10 bg-white/5! text-sm text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus-visible:border-emerald-400/50 focus-visible:ring-1 focus-visible:ring-emerald-400/30"
                />
                <p className="mt-2 text-[11px] text-zinc-600">
                  Compared case-insensitively against every computed digest — hex and Base64.
                </p>
              </section>
            </TabsContent>

            {/* ==================== TAB 2 — UUID ==================== */}
            <TabsContent value="uuid" className="mt-4 space-y-4">
              {/* ---------- info chips ---------- */}
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="gap-1.5 border-white/10 bg-white/5 text-zinc-300">
                  <ShieldCheck className="size-3 text-emerald-300" aria-hidden /> RFC 4122 v4
                </Badge>
                <Badge variant="outline" className="gap-1.5 border-white/10 bg-white/5 text-zinc-300">
                  <Binary className="size-3 text-emerald-300" aria-hidden /> 122 random bits
                </Badge>
              </div>

              {/* ---------- single ---------- */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-start gap-2">
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.p
                      key={single || 'empty'}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.15 }}
                      className={cn(
                        'min-w-0 flex-1 break-all font-mono text-sm leading-relaxed',
                        single ? 'text-zinc-100' : 'text-zinc-600'
                      )}
                    >
                      {single || 'Tap generate to roll a fresh UUID v4.'}
                    </motion.p>
                  </AnimatePresence>
                  {single && (
                    <CopyIconButton
                      value={formatUuid(single, uuidUpper, uuidNoDash)}
                      label="UUID"
                      onCopy={copyValue}
                    />
                  )}
                </div>
                <Button
                  onClick={genSingle}
                  className="mt-3 h-12 w-full rounded-xl bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-600 text-sm font-semibold text-white shadow-lg hover:from-emerald-300 hover:via-teal-400 hover:to-cyan-500"
                >
                  <Dices className="size-4" aria-hidden /> Generate UUID
                </Button>
              </section>

              {/* ---------- format toggles ---------- */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Switch
                    id="hashuuid-uuid-upper"
                    checked={uuidUpper}
                    onCheckedChange={(v) => setUuidUpper(v)}
                    className="data-[state=checked]:bg-emerald-500! data-[state=unchecked]:bg-white/10!"
                  />
                  <label htmlFor="hashuuid-uuid-upper" className="select-none text-xs text-zinc-300">
                    Uppercase
                  </label>
                </div>
                <div className="flex items-center gap-2.5">
                  <Switch
                    id="hashuuid-uuid-nodash"
                    checked={uuidNoDash}
                    onCheckedChange={(v) => setUuidNoDash(v)}
                    className="data-[state=checked]:bg-emerald-500! data-[state=unchecked]:bg-white/10!"
                  />
                  <label htmlFor="hashuuid-uuid-nodash" className="select-none text-xs text-zinc-300">
                    No dashes
                  </label>
                </div>
              </div>

              {/* ---------- batch ---------- */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Batch</span>
                  <span className="text-[11px] text-zinc-600">1–100 UUIDs</span>
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={100}
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    onBlur={normalizeCount}
                    aria-label="How many UUIDs to generate"
                    className="h-11 w-20 rounded-xl border-white/10 bg-white/5! text-center font-mono text-sm text-zinc-100 [color-scheme:dark] focus-visible:border-emerald-400/50 focus-visible:ring-1 focus-visible:ring-emerald-400/30"
                  />
                  <Button
                    variant="outline"
                    onClick={genBatch}
                    className="h-11 flex-1 rounded-xl border-white/10 bg-white/5 text-sm font-semibold text-zinc-100 hover:bg-white/10 hover:text-white"
                  >
                    <ListPlus className="size-4" aria-hidden /> Generate batch
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={clearBulk}
                    disabled={bulkUuids.length === 0}
                    aria-label="Clear batch"
                    className="h-11 w-11 shrink-0 rounded-xl border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-rose-300"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>

                {bulkUuids.length === 0 ? (
                  <div className="mt-3 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
                    <Fingerprint className="size-5 text-zinc-600" aria-hidden />
                    <p className="text-xs text-zinc-500">No batch yet — roll up to 100 UUIDs at once.</p>
                  </div>
                ) : (
                  <>
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">
                        {bulkUuids.length} UUID{bulkUuids.length === 1 ? '' : 's'}
                      </span>
                      <Button
                        variant="ghost"
                        onClick={copyAll}
                        className="h-9 rounded-lg px-3 text-xs font-semibold text-emerald-300 hover:bg-white/10 hover:text-emerald-200"
                      >
                        <Copy className="size-3.5" aria-hidden /> Copy all
                      </Button>
                    </div>
                    <motion.div
                      key={batchKey}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, ease: 'easeOut' }}
                      className={cn('mt-2 max-h-96 overflow-y-auto pr-1', THIN_SCROLLBAR)}
                    >
                      <div className="space-y-1.5">
                        {bulkUuids.map((u, i) => (
                          <UuidRow
                            key={`${batchKey}-${i}`}
                            index={i}
                            value={formatUuid(u, uuidUpper, uuidNoDash)}
                            onCopy={copyValue}
                          />
                        ))}
                      </div>
                    </motion.div>
                  </>
                )}
              </section>

              {/* ---------- recent batches ---------- */}
              {recent.length > 0 && (
                <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    <History className="size-3.5" aria-hidden /> Recent batches
                    <span className="ml-auto font-normal normal-case tracking-normal text-zinc-600">
                      last 3 · tap to restore
                    </span>
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {recent.map((batch, i) => (
                      <button
                        key={batch.id}
                        type="button"
                        onClick={() => restoreBatch(batch)}
                        className={cn(
                          'flex h-10 items-center gap-2 rounded-xl border px-3 text-xs transition-colors',
                          i === 0
                            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200'
                            : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                        )}
                      >
                        <span className="font-mono">{clockTime(batch.at)}</span>
                        <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">
                          ×{batch.uuids.length}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </motion.div>
    </div>
  )
}
