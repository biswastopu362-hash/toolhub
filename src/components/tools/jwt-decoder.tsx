'use client'

/**
 * JWT Decoder — inspect tokens without ever uploading them.
 *
 * Splits a JSON Web Token into its three segments, base64url-decodes the
 * header and payload, and pretty-prints them with colorized JSON, a friendly
 * claims table, a live expiry countdown and an honest signature disclaimer.
 * Everything happens 100% on-device — the token is only persisted when the
 * user explicitly turns on "Remember last token".
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  FileJson,
  Fingerprint,
  Info,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

/** Successfully decoded JWT parts; claim values stay `unknown` until guarded. */
interface DecodedToken {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  signature: string
}

type ParseError =
  | { kind: 'empty' }
  | { kind: 'segments'; count: number }
  | { kind: 'segment'; segment: 'header' | 'payload'; reason: string }

type ParseResult = { ok: true; data: DecodedToken } | { ok: false; error: ParseError }

type ExpiryState = 'valid' | 'expired' | 'not-yet' | 'no-exp'

interface SampleToken {
  id: string
  label: string
  hint: string
  token: string
}

interface ClaimMeta {
  key: string
  name: string
  description: string
  /** date claims render epoch seconds as a human date + relative time */
  kind: 'text' | 'date'
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

/** localStorage key for the opt-in "Remember last token" feature. */
const LAST_TOKEN_KEY = 'toolhub-jwt-last'

/** Flat indent (px) per JSON nesting level in the pretty panes. */
const JSON_INDENT = 14

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

/** Thin glass scrollbar for long lists. */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/** base64url-encode a UTF-8 string (used to build the sample tokens). */
function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** base64url-decode a JWT segment into UTF-8 text. Throws on malformed input. */
function base64UrlDecode(segment: string): string {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/** Parse a JWT string; every failure mode returns a typed error, never throws. */
function decodeJwt(raw: string): ParseResult {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: { kind: 'empty' } }

  const parts = trimmed.split('.')
  if (parts.length !== 3) {
    return { ok: false, error: { kind: 'segments', count: parts.length } }
  }
  const [headerSeg, payloadSeg, signatureSeg] = parts

  let headerText: string
  try {
    if (!headerSeg) throw new Error('empty')
    headerText = base64UrlDecode(headerSeg)
  } catch {
    return { ok: false, error: { kind: 'segment', segment: 'header', reason: 'is empty or not valid base64url' } }
  }

  let payloadText: string
  try {
    if (!payloadSeg) throw new Error('empty')
    payloadText = base64UrlDecode(payloadSeg)
  } catch {
    return { ok: false, error: { kind: 'segment', segment: 'payload', reason: 'is empty or not valid base64url' } }
  }

  let header: unknown
  try {
    header = JSON.parse(headerText)
  } catch {
    return { ok: false, error: { kind: 'segment', segment: 'header', reason: 'is not valid JSON' } }
  }

  let payload: unknown
  try {
    payload = JSON.parse(payloadText)
  } catch {
    return { ok: false, error: { kind: 'segment', segment: 'payload', reason: 'is not valid JSON' } }
  }

  if (!isPlainObject(header)) {
    return { ok: false, error: { kind: 'segment', segment: 'header', reason: 'is not a JSON object' } }
  }
  if (!isPlainObject(payload)) {
    return { ok: false, error: { kind: 'segment', segment: 'payload', reason: 'is not a JSON object' } }
  }

  return { ok: true, data: { header, payload, signature: signatureSeg } }
}

/** Epoch seconds from an ISO date (sample token building only). */
function epochSeconds(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000)
}

function makeSampleToken(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const signature = base64UrlEncode('toolhub-local-sample-signature-not-verified')
  return `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}.${signature}`
}

/** Two bundled demo tokens, generated at module load. Never leave the device. */
const SAMPLES: SampleToken[] = [
  {
    id: 'valid',
    label: 'Valid token',
    hint: 'role admin · expires 2099',
    token: makeSampleToken({
      iss: 'https://auth.toolhub.dev',
      sub: 'user_8f3a92c4',
      aud: 'toolhub-api',
      name: 'Ava Thornton',
      role: 'admin',
      iat: Math.floor(Date.now() / 1000) - 3600,
      nbf: Math.floor(Date.now() / 1000) - 3600,
      exp: epochSeconds('2099-12-31T23:59:59Z'),
      jti: 'tok_01jf29ak3b',
    }),
  },
  {
    id: 'expired',
    label: 'Expired token',
    hint: 'role viewer · expired 2023',
    token: makeSampleToken({
      iss: 'https://auth.toolhub.dev',
      sub: 'user_2b7d10e9',
      aud: 'toolhub-api',
      name: 'Old Session',
      role: 'viewer',
      iat: epochSeconds('2023-05-01T09:00:00Z'),
      nbf: epochSeconds('2023-05-01T09:00:00Z'),
      exp: epochSeconds('2023-08-01T09:00:00Z'),
      jti: 'tok_9x83kd21mf',
    }),
  },
]

/* ---------------- time formatting ---------------- */

const MINUTE_S = 60
const HOUR_S = 60 * MINUTE_S
const DAY_S = 24 * HOUR_S
const MONTH_S = 30 * DAY_S
const YEAR_S = 365 * DAY_S

/** Relative time like "3 days ago" / "in 2 months" (past → ago, future → in). */
function formatRelative(ms: number, nowMs: number): string {
  const diffSec = Math.round((ms - nowMs) / 1000)
  const future = diffSec > 0
  const abs = Math.abs(diffSec)
  if (abs < 45) return 'just now'
  let value: number
  let unit: string
  if (abs < HOUR_S) {
    value = Math.max(1, Math.round(abs / MINUTE_S))
    unit = 'min'
  } else if (abs < DAY_S) {
    value = Math.round(abs / HOUR_S)
    unit = 'hour'
  } else if (abs < MONTH_S) {
    value = Math.round(abs / DAY_S)
    unit = 'day'
  } else if (abs < YEAR_S) {
    value = Math.round(abs / MONTH_S)
    unit = 'month'
  } else {
    value = Math.round(abs / YEAR_S)
    unit = 'year'
  }
  const noun = value === 1 ? unit : `${unit}s`
  return future ? `in ${value} ${noun}` : `${value} ${noun} ago`
}

/** Compact live countdown like "4d 2h 11m"; years collapse to "74y 3mo". */
function formatCountdown(msRemaining: number): string {
  const totalSec = Math.max(0, Math.floor(msRemaining / 1000))
  const d = Math.floor(totalSec / DAY_S)
  const h = Math.floor((totalSec % DAY_S) / HOUR_S)
  const m = Math.floor((totalSec % HOUR_S) / MINUTE_S)
  if (d >= YEAR_S / DAY_S) {
    const years = Math.floor(d / (YEAR_S / DAY_S))
    const months = Math.floor((d % (YEAR_S / DAY_S)) / 30)
    return months > 0 ? `${years}y ${months}mo` : `${years}y`
  }
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

/** Read a numeric epoch claim (seconds or ms) as milliseconds; null if absent. */
function claimEpochMs(payload: Record<string, unknown>, key: string): number | null {
  const v = payload[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string' && /^\d+$/.test(v)) {
    const n = Number(v)
    if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n
  }
  return null
}

/** Derive the expiry badge state from exp/nbf vs the given clock. */
function expiryStateOf(payload: Record<string, unknown>, nowMs: number): ExpiryState {
  const expMs = claimEpochMs(payload, 'exp')
  const nbfMs = claimEpochMs(payload, 'nbf')
  if (expMs !== null && nowMs >= expMs) return 'expired'
  if (nbfMs !== null && nowMs < nbfMs) return 'not-yet'
  if (expMs !== null) return 'valid'
  return 'no-exp'
}

/** Human-readable fallback rendering for any claim value. */
function claimText(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v === null) return 'null'
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join(', ')
  try {
    return JSON.stringify(v) ?? ''
  } catch {
    return String(v)
  }
}

/** Keep both ends of a long string, elide the middle (mobile signature). */
function truncateMiddle(s: string, keep = 12): string {
  if (s.length <= keep * 2 + 1) return s
  return `${s.slice(0, keep)}…${s.slice(-keep)}`
}

/** Tint for the alg badge by algorithm family. */
function algBadgeClass(alg: string): string {
  if (alg.startsWith('HS')) return 'border-violet-400/30 bg-violet-500/15 text-violet-300'
  if (alg.startsWith('RS') || alg.startsWith('PS')) return 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300'
  if (alg.startsWith('ES')) return 'border-amber-400/30 bg-amber-500/15 text-amber-300'
  if (alg.startsWith('Ed')) return 'border-sky-400/30 bg-sky-500/15 text-sky-300'
  return 'border-white/15 bg-white/5 text-zinc-300'
}

/* ================================================================== */
/* Standard claims metadata                                            */
/* ================================================================== */

const STANDARD_CLAIMS: ClaimMeta[] = [
  { key: 'iss', name: 'Issuer', description: 'Principal that issued the token', kind: 'text' },
  { key: 'sub', name: 'Subject', description: 'Principal the claims are about', kind: 'text' },
  { key: 'aud', name: 'Audience', description: 'Recipient the token is intended for', kind: 'text' },
  { key: 'exp', name: 'Expires', description: 'Expiration time (epoch seconds)', kind: 'date' },
  { key: 'nbf', name: 'Not before', description: 'Token is invalid before this time', kind: 'date' },
  { key: 'iat', name: 'Issued at', description: 'Time the token was issued', kind: 'date' },
  { key: 'jti', name: 'JWT ID', description: 'Unique identifier for this token', kind: 'text' },
]

/* ================================================================== */
/* Colorized JSON renderer (React elements only, never innerHTML)      */
/* ================================================================== */

function JsonScalar({ value }: { value: unknown }) {
  if (value === null) return <span className="italic text-zinc-500">null</span>
  if (typeof value === 'string') return <span className="break-all text-emerald-300">&quot;{value}&quot;</span>
  if (typeof value === 'number') return <span className="text-amber-300">{String(value)}</span>
  if (typeof value === 'boolean') return <span className="text-rose-300">{value ? 'true' : 'false'}</span>
  return <span className="text-zinc-400">{String(value)}</span>
}

function JsonNode({ value }: { value: unknown }) {
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) return <span className="text-zinc-500">{'{}'}</span>
    return (
      <>
        <span className="text-zinc-500">{'{'}</span>
        {keys.map((k, i) => (
          <div key={k} style={{ paddingLeft: JSON_INDENT }}>
            <span className="break-all text-sky-300">&quot;{k}&quot;</span>
            <span className="text-zinc-600">: </span>
            <JsonNode value={value[k]} />
            {i < keys.length - 1 ? <span className="text-zinc-600">,</span> : null}
          </div>
        ))}
        <div>
          <span className="text-zinc-500">{'}'}</span>
        </div>
      </>
    )
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-500">[]</span>
    return (
      <>
        <span className="text-zinc-500">[</span>
        {value.map((item, i) => (
          <div key={i} style={{ paddingLeft: JSON_INDENT }}>
            <JsonNode value={item} />
            {i < value.length - 1 ? <span className="text-zinc-600">,</span> : null}
          </div>
        ))}
        <div>
          <span className="text-zinc-500">]</span>
        </div>
      </>
    )
  }
  return <JsonScalar value={value} />
}

/* ================================================================== */
/* Presentational bits                                                 */
/* ================================================================== */

function StatusChip({
  active,
  tone,
  icon: Icon,
  title,
  detail,
}: {
  active: boolean
  tone: 'emerald' | 'rose' | 'amber'
  icon: LucideIcon
  title: string
  detail: string
}) {
  return (
    <div
      className={cn(
        'flex min-h-14 items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors',
        active
          ? tone === 'emerald'
            ? 'border-emerald-400/40 bg-emerald-500/[0.12] text-emerald-300'
            : tone === 'rose'
              ? 'border-rose-400/40 bg-rose-500/[0.12] text-rose-300'
              : 'border-amber-400/40 bg-amber-500/[0.12] text-amber-300'
          : 'border-white/10 bg-white/[0.02] text-zinc-600'
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs font-semibold leading-tight">{title}</p>
        <p className={cn('truncate text-[11px] leading-tight', active ? 'opacity-80' : 'text-zinc-600')}>{detail}</p>
      </div>
    </div>
  )
}

/** Friendly value cell for a standard claim row. */
function ClaimValue({ meta, payload, nowMs }: { meta: ClaimMeta; payload: Record<string, unknown>; nowMs: number }) {
  if (meta.kind === 'date') {
    const ms = claimEpochMs(payload, meta.key)
    if (ms !== null) {
      const future = ms >= nowMs
      return (
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <span className="text-[13px] font-medium text-zinc-100">{new Date(ms).toLocaleString()}</span>
          <Badge
            className={cn(
              'border-transparent px-1.5 py-0 text-[10px]',
              future ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/5 text-zinc-400'
            )}
          >
            {formatRelative(ms, nowMs)}
          </Badge>
          <span className="font-mono text-[10px] text-zinc-600">epoch {claimText(payload[meta.key])}</span>
        </div>
      )
    }
  }
  return (
    <span className="block break-all text-right font-mono text-[12px] leading-snug text-zinc-300">
      {claimText(payload[meta.key])}
    </span>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function JwtDecoderApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [token, setToken] = useState('')
  const [remember, setRemember] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [samplePickerOpen, setSamplePickerOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  /* ---------------- restore remembered token (opt-in only) ---------------- */
  useEffect(() => {
    const restore = () => {
      try {
        const saved = window.localStorage.getItem(LAST_TOKEN_KEY)
        if (saved) {
          setToken(saved)
          setRemember(true)
        }
      } catch {
        /* storage unavailable (private mode) — stay memory-only */
      }
      setHydrated(true)
    }
    const t = setTimeout(restore, 0)
    return () => clearTimeout(t)
  }, [])

  /* ---------------- write-through persistence for the Switch ---------------- */
  useEffect(() => {
    if (!hydrated) return
    try {
      if (remember && token.trim()) window.localStorage.setItem(LAST_TOKEN_KEY, token)
      else window.localStorage.removeItem(LAST_TOKEN_KEY)
    } catch {
      /* storage unavailable — stay memory-only */
    }
  }, [hydrated, remember, token])

  /* ---------------- live countdown ticks every 30s ---------------- */
  const hasToken = token.trim().length > 0
  useEffect(() => {
    if (!hasToken) return
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [hasToken])

  /* ---------------- parsing + derived ---------------- */
  const parse = useMemo<ParseResult>(() => decodeJwt(token), [token])
  const decoded = parse.ok ? parse.data : null

  const prettyHeader = useMemo(() => (decoded ? JSON.stringify(decoded.header, null, 2) : ''), [decoded])
  const prettyPayload = useMemo(() => (decoded ? JSON.stringify(decoded.payload, null, 2) : ''), [decoded])
  const claimRows = useMemo(
    () => (decoded ? STANDARD_CLAIMS.filter((c) => decoded.payload[c.key] !== undefined) : []),
    [decoded]
  )

  const algRaw: unknown = decoded ? decoded.header['alg'] : null
  const alg = typeof algRaw === 'string' && algRaw.length > 0 ? algRaw : null

  const expMs = decoded ? claimEpochMs(decoded.payload, 'exp') : null
  const nbfMs = decoded ? claimEpochMs(decoded.payload, 'nbf') : null
  const expiry: ExpiryState = decoded ? expiryStateOf(decoded.payload, now) : 'no-exp'

  const validDetail = expMs !== null ? `expires in ${formatCountdown(expMs - now)}` : 'no exp claim'
  const expiredDetail = expMs !== null ? `expired ${formatRelative(expMs, now)}` : 'no exp claim'
  const notYetDetail = nbfMs !== null ? `valid ${formatRelative(nbfMs, now)}` : 'no nbf claim'

  /* ---------------- actions ---------------- */
  const copyText = useCallback(
    async (text: string, label: string) => {
      try {
        await navigator.clipboard.writeText(text)
        haptic()
        toast({ title: `${label} copied ✓`, description: 'Clipboard only — nothing was sent anywhere.' })
      } catch {
        toast({ title: 'Copy failed', description: 'Clipboard is unavailable in this context', variant: 'destructive' })
      }
    },
    [toast]
  )

  const loadSample = useCallback(
    (sample: SampleToken) => {
      setToken(sample.token)
      setSamplePickerOpen(false)
      haptic()
      toast({ title: `${sample.label} loaded`, description: 'Decoding stays 100% on this device.' })
    },
    [toast]
  )

  const clearToken = useCallback(() => {
    setToken('')
    setSamplePickerOpen(false)
    haptic()
  }, [])

  const toggleRemember = useCallback(
    (checked: boolean) => {
      setRemember(checked)
      haptic()
      toast({
        title: checked ? 'Token will be remembered' : 'Saved token cleared',
        description: checked
          ? 'It now persists in this browser only (toolhub-jwt-last).'
          : 'Any stored token was removed from this device.',
      })
    },
    [toast]
  )

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
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-sky-500/[0.1] via-transparent to-indigo-500/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(56_189_248/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <KeyRound className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">JWT Decoder</h2>
              <p className="text-xs text-zinc-400">Peek inside tokens — header, payload, expiry. Never uploaded.</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {/* ---------------- Privacy banner ---------------- */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-amber-400/20 bg-amber-400/[0.07] px-3.5 py-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
            <p className="text-[12px] leading-relaxed text-amber-200/90">
              Decoded <span className="font-semibold">100% locally</span>. Your token never leaves this device. Tokens
              are NOT remembered unless you enable it.
            </p>
          </div>

          {/* ---------------- Token input ---------------- */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <label
                htmlFor="jwt-input"
                className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
              >
                Token
              </label>
              <div className="flex items-center gap-2.5">
                <span className="text-xs text-zinc-400">Remember last token</span>
                <Switch
                  checked={remember}
                  onCheckedChange={toggleRemember}
                  aria-label="Remember last token on this device"
                />
              </div>
            </div>

            <Textarea
              id="jwt-input"
              rows={4}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI…"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              className="min-h-24 resize-y rounded-xl border-white/10 bg-white/5 font-mono text-[12px] leading-relaxed break-all text-zinc-100 [color-scheme:dark] placeholder:text-zinc-600 focus-visible:border-sky-400/50 focus-visible:ring-sky-400/20"
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setSamplePickerOpen((v) => !v)}
                aria-expanded={samplePickerOpen}
                className="h-11 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
              >
                <Sparkles className="size-4" aria-hidden /> Load sample
              </Button>
              {hasToken && (
                <>
                  <Button
                    variant="ghost"
                    onClick={clearToken}
                    className="h-11 rounded-xl text-zinc-400 hover:bg-white/10 hover:text-white"
                  >
                    <Trash2 className="size-4" aria-hidden /> Clear
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void copyText(token, 'Original token')}
                    className="h-11 rounded-xl text-zinc-400 hover:bg-white/10 hover:text-white"
                  >
                    <Copy className="size-4" aria-hidden /> Copy token
                  </Button>
                </>
              )}
            </div>

            {/* sample picker */}
            <AnimatePresence>
              {samplePickerOpen && (
                <motion.div
                  key="sample-picker"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.16 }}
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                >
                  {SAMPLES.map((sample) => (
                    <button
                      key={sample.id}
                      type="button"
                      onClick={() => loadSample(sample)}
                      className="flex min-h-14 items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-left transition-colors hover:border-sky-400/40 hover:bg-sky-500/10"
                    >
                      <span
                        className={cn(
                          'flex size-8 shrink-0 items-center justify-center rounded-lg',
                          sample.id === 'valid'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-rose-500/15 text-rose-300'
                        )}
                      >
                        {sample.id === 'valid' ? (
                          <CheckCircle2 className="size-4" aria-hidden />
                        ) : (
                          <XCircle className="size-4" aria-hidden />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-zinc-100">{sample.label}</span>
                        <span className="block truncate text-[11px] text-zinc-500">{sample.hint}</span>
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ---------------- Feedback: idle / error / decoded ---------------- */}
          {!parse.ok && parse.error.kind === 'empty' ? (
            <div className="flex items-start gap-2.5 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-4 text-zinc-400">
              <Info className="mt-0.5 size-4 shrink-0 text-zinc-500" aria-hidden />
              <p className="text-xs leading-relaxed">
                Paste a JWT above — three dot-separated base64url segments — or load a sample to inspect its header,
                payload, expiry and signature.
              </p>
            </div>
          ) : !parse.ok && parse.error.kind === 'segments' ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-rose-400/25 bg-rose-500/[0.08] px-4 py-3.5 text-rose-200"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="text-xs leading-relaxed">
                Expected <span className="font-bold">3</span> dot-separated segments (header.payload.signature) but
                found <span className="font-bold">{parse.error.count}</span>. Encrypted JWE tokens (5 segments) are not
                supported by this decoder.
              </p>
            </div>
          ) : !parse.ok && parse.error.kind === 'segment' ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-2xl border border-rose-400/25 bg-rose-500/[0.08] px-4 py-3.5 text-rose-200"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p className="text-xs leading-relaxed">
                <span className="font-bold">{parse.error.segment === 'header' ? 'Header' : 'Payload'}</span> segment{' '}
                {parse.error.reason}.
              </p>
            </div>
          ) : decoded ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="space-y-4"
            >
              {/* ---------------- Expiry status panel ---------------- */}
              <section>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Status</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <StatusChip
                    active={expiry === 'valid'}
                    tone="emerald"
                    icon={CheckCircle2}
                    title="Valid now"
                    detail={expiry === 'valid' ? validDetail : '—'}
                  />
                  <StatusChip
                    active={expiry === 'expired'}
                    tone="rose"
                    icon={XCircle}
                    title="Expired"
                    detail={expiry === 'expired' ? expiredDetail : '—'}
                  />
                  <StatusChip
                    active={expiry === 'not-yet'}
                    tone="amber"
                    icon={Clock}
                    title="Not yet valid"
                    detail={expiry === 'not-yet' ? notYetDetail : '—'}
                  />
                </div>
                {expiry === 'no-exp' && (
                  <p className="mt-2 text-[11px] text-zinc-500">
                    No exp/nbf claims found — expiry status can&apos;t be determined for this token.
                  </p>
                )}
              </section>

              {/* ---------------- Header card ---------------- */}
              <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-300">
                    <KeyRound className="size-4" aria-hidden />
                  </span>
                  <h3 className="text-sm font-bold">Header</h3>
                  <Badge
                    className={cn(
                      'border-transparent font-mono text-[10px]',
                      alg ? algBadgeClass(alg) : 'border-white/15 bg-white/5 text-zinc-400'
                    )}
                  >
                    {alg ?? 'no alg'}
                  </Badge>
                  <Button
                    variant="ghost"
                    onClick={() => void copyText(prettyHeader, 'Header JSON')}
                    className="ml-auto h-11 shrink-0 rounded-lg px-3 text-xs text-zinc-400 hover:bg-white/10 hover:text-white"
                  >
                    <Copy className="size-4" aria-hidden /> Copy
                  </Button>
                </div>
                <div
                  className={cn(
                    'max-h-96 overflow-y-auto px-4 py-3 pr-1 font-mono text-[12px] leading-relaxed',
                    THIN_SCROLLBAR
                  )}
                >
                  <JsonNode value={decoded.header} />
                </div>
              </section>

              {/* ---------------- Payload card ---------------- */}
              <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300">
                    <FileJson className="size-4" aria-hidden />
                  </span>
                  <h3 className="text-sm font-bold">Payload</h3>
                  <Button
                    variant="ghost"
                    onClick={() => void copyText(prettyPayload, 'Payload JSON')}
                    className="ml-auto h-11 shrink-0 rounded-lg px-3 text-xs text-zinc-400 hover:bg-white/10 hover:text-white"
                  >
                    <Copy className="size-4" aria-hidden /> Copy
                  </Button>
                </div>
                <div
                  className={cn(
                    'max-h-96 overflow-y-auto px-4 py-3 pr-1 font-mono text-[12px] leading-relaxed',
                    THIN_SCROLLBAR
                  )}
                >
                  <JsonNode value={decoded.payload} />
                </div>

                {/* claims table */}
                <div className="border-t border-white/5 px-4 py-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Standard claims
                  </p>
                  {claimRows.length === 0 ? (
                    <p className="text-xs text-zinc-500">No standard claims found in this payload.</p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-white/10">
                      {claimRows.map((meta, i) => (
                        <div
                          key={meta.key}
                          className={cn(
                            'flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4',
                            i > 0 && 'border-t border-white/5'
                          )}
                        >
                          <div className="min-w-0">
                            <p className="font-mono text-[12px] font-semibold text-sky-300">{meta.key}</p>
                            <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">
                              {meta.name} — {meta.description}
                            </p>
                          </div>
                          <div className="shrink-0 sm:max-w-[60%]">
                            <ClaimValue meta={meta} payload={decoded.payload} nowMs={now} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              {/* ---------------- Signature card ---------------- */}
              <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
                <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-300">
                    <Fingerprint className="size-4" aria-hidden />
                  </span>
                  <h3 className="text-sm font-bold">Signature</h3>
                  <Badge
                    className={cn(
                      'border-transparent font-mono text-[10px]',
                      alg ? algBadgeClass(alg) : 'border-white/15 bg-white/5 text-zinc-400'
                    )}
                  >
                    {alg ?? 'no alg'}
                  </Badge>
                </div>
                <div className="space-y-2 px-4 py-3">
                  <div
                    className={cn(
                      'max-h-28 overflow-y-auto pr-1 font-mono text-[12px] leading-relaxed break-all text-zinc-400',
                      THIN_SCROLLBAR
                    )}
                  >
                    {decoded.signature.length === 0 ? (
                      <span className="italic text-zinc-600">(empty)</span>
                    ) : (
                      <>
                        <span className="sm:hidden">{truncateMiddle(decoded.signature)}</span>
                        <span className="hidden sm:inline">{decoded.signature}</span>
                      </>
                    )}
                  </div>
                  <p className="flex items-start gap-2 text-[11px] leading-relaxed text-zinc-500">
                    <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-zinc-600" aria-hidden />
                    {alg?.startsWith('HS')
                      ? 'HMAC signature cannot be verified in-browser without the secret — nothing here verifies or validates tokens.'
                      : 'Signatures cannot be verified in-browser without the signing key — nothing here verifies or validates tokens.'}
                  </p>
                </div>
              </section>
            </motion.div>
          ) : null}
        </div>
      </motion.div>
    </div>
  )
}
