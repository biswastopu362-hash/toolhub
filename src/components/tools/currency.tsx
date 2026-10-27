'use client'

/**
 * Currency Converter v2 — live FX, offline-first.
 *
 * Rates come from the free, key-less https://open.er-api.com/v6/latest/USD
 * feed (kept from v1). Every successful payload is persisted to IndexedDB
 * ('toolhub-currency' → store 'cache', row key 'rates' together with the
 * previous sync for ▲▼ movement hints), so the tool opens INSTANTLY with the
 * last known rates — even fully offline — and refreshes silently in the
 * background. Starred currencies become one-tap chips above the converter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeftRight,
  CircleDollarSign,
  Loader2,
  RefreshCw,
  Star,
  TriangleAlert,
  WifiOff,
  X,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Constants + types                                                   */
/* ================================================================== */

interface CurrencyMeta {
  code: string
  name: string
  symbol: string
}

const CURRENCIES: CurrencyMeta[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: '₨' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SR' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'Dh' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QR' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
]

/** Approximate fallback rates per 1 USD — used only when live rates fail and no cache exists. */
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 155,
  CNY: 7.25,
  INR: 83.5,
  BDT: 117.5,
  PKR: 278,
  NPR: 133.6,
  LKR: 300,
  AUD: 1.53,
  CAD: 1.37,
  CHF: 0.88,
  SGD: 1.35,
  MYR: 4.7,
  THB: 36.5,
  IDR: 16300,
  PHP: 58.5,
  VND: 25400,
  KRW: 1380,
  SAR: 3.75,
  AED: 3.67,
  QAR: 3.64,
  TRY: 32.3,
  RUB: 90,
  BRL: 5.15,
  MXN: 17.1,
  ZAR: 18.4,
  NGN: 1450,
  KES: 130,
  EGP: 47.5,
}

const API_URL = 'https://open.er-api.com/v6/latest/USD'
/** Older than this the cached rates pill turns amber ("may be outdated"). */
const FRESH_MS = 12 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 10_000

const DEFAULT_FAVS: string[] = ['EUR', 'GBP', 'JPY', 'INR', 'BDT']

type Status = 'loading' | 'live' | 'stale' | 'stale-offline' | 'fallback'

interface RatesResponse {
  result?: string
  rates?: Record<string, number>
  time_last_update_unix?: number
}

interface PrevRates {
  rates: Record<string, number>
  fetchedAt: number
}

/** Row in store 'cache' keyed 'rates'. */
interface RatesCacheRow {
  key: 'rates'
  base: string
  rates: Record<string, number>
  fetchedAt: number
  prev: PrevRates | null
}

/** Rows in store 'settings'. */
interface FavRow {
  key: 'favs'
  value: string[]
}
interface PairRow {
  key: 'pair'
  value: { from: string; to: string }
}
interface AmountRow {
  key: 'amount'
  value: string
}

interface RateDelta {
  pct: number
  dir: 1 | -1
}

/* ================================================================== */
/* IndexedDB — 'toolhub-currency' (stores: cache, settings)            */
/* ================================================================== */

const DB_NAME = 'toolhub-currency'
const DB_VERSION = 1
const CACHE_STORE = 'cache'
const SET_STORE = 'settings'
const RATES_KEY = 'rates'
const FAVS_KEY = 'favs'
const PAIR_KEY = 'pair'
const AMOUNT_KEY = 'amount'
/** v1 cache lived in localStorage — migrated once into IndexedDB. */
const LEGACY_LS_KEY = 'currency-rates'

let dbPromise: Promise<IDBDatabase> | null = null

function openCurrencyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(CACHE_STORE)) {
        d.createObjectStore(CACHE_STORE, { keyPath: 'key' })
      }
      if (!d.objectStoreNames.contains(SET_STORE)) {
        d.createObjectStore(SET_STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openCurrencyDb()
  return dbPromise
}

function idbGet<T>(store: string, key: string): Promise<T | null> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readonly').objectStore(store).get(key)
        req.onsuccess = () => resolve((req.result as T | undefined) ?? null)
        req.onerror = () => reject(req.error ?? new Error('IndexedDB get failed'))
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

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function buzz(ms = 12): void {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* haptics unsupported */
  }
}

function isKnownCode(code: string): boolean {
  return CURRENCIES.some((c) => c.code === code)
}

/**
 * Paste-safe amount parsing: accepts "1,234.56" / "1.234,56" / "$1 234" and
 * reduces to plain digits with at most one decimal point.
 */
function sanitizeAmount(raw: string): string {
  let s = raw.replace(/,/g, '.').replace(/[^0-9.]/g, '')
  const dots = (s.match(/\./g) ?? []).length
  if (dots > 1) {
    const last = s.lastIndexOf('.')
    s = s.slice(0, last).replace(/\./g, '') + s.slice(last)
  }
  if (s.length > 15) s = s.slice(0, 15)
  return s
}

/** Big result: max 2 decimals at 1000+, otherwise up to 4. */
function formatResult(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 2 : 4 })
}

function formatRate(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

/** Compact rate for favorite chips (16,300 instead of 16,300.00). */
function formatChipRate(v: number): string {
  return v.toLocaleString('en-US', {
    minimumFractionDigits: v >= 100 ? 0 : 2,
    maximumFractionDigits: v >= 1000 ? 0 : v >= 100 ? 2 : 4,
  })
}

function symbolOf(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? ''
}

/** "just now" / "3h 12m ago" / "2d ago"; short variant drops the " ago". */
function ageLabel(ts: number, now: number, short = false): string {
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 90) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return short ? `${m}m` : `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) {
    const rem = m % 60
    const base = rem > 0 ? `${h}h ${rem}m` : `${h}h`
    return short ? base : `${base} ago`
  }
  const d = Math.floor(h / 24)
  return short ? `${d}d` : `${d}d ago`
}

/** Movement of one currency vs the previous sync (USD-base rates). */
function deltaFor(
  code: string,
  rates: Record<string, number>,
  prevRates: Record<string, number> | null
): RateDelta | null {
  if (!prevRates) return null
  const before = prevRates[code]
  const after = rates[code]
  if (typeof before !== 'number' || typeof after !== 'number' || before === 0) return null
  const pct = ((after - before) / before) * 100
  if (Math.abs(pct) < 0.01) return null
  return { pct, dir: pct > 0 ? 1 : -1 }
}

const AMBER_PILL =
  'border-amber-400/30 bg-amber-500/10 text-amber-300'
const ZINC_PILL = 'border-white/10 bg-white/5 text-zinc-400'
const EMERALD_PILL = 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'

/* ================================================================== */
/* CurrencyTool — default export                                       */
/* ================================================================== */

export default function CurrencyTool() {
  /* ---------------- rates state ---------------- */
  const [booted, setBooted] = useState(false)
  const [status, setStatus] = useState<Status>('loading')
  const [fetching, setFetching] = useState(false)
  const [rates, setRates] = useState<Record<string, number> | null>(null)
  const [prevRates, setPrevRates] = useState<Record<string, number> | null>(null)
  const [fetchedAt, setFetchedAt] = useState<number | null>(null)

  /* ---------------- user state ---------------- */
  const [favs, setFavs] = useState<string[]>([])
  const [amount, setAmount] = useState('1')
  const [from, setFrom] = useState('USD')
  const [to, setTo] = useState('BDT')

  /* ---------------- animation / misc ---------------- */
  const [swapDeg, setSwapDeg] = useState(0)
  const [nowTick, setNowTick] = useState(() => Date.now())

  const tokenRef = useRef(0)
  const ratesRef = useRef<Record<string, number> | null>(null)
  const fetchedAtRef = useRef<number | null>(null)
  const statusRef = useRef<Status>('loading')

  /* ---------------- network: fetch + persist (write-through IDB) ---------------- */
  const loadRates = useCallback(async (): Promise<void> => {
    const token = ++tokenRef.current

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (token !== tokenRef.current) return
      if (ratesRef.current) {
        statusRef.current = 'stale-offline'
        setStatus('stale-offline')
      } else {
        ratesRef.current = FALLBACK_RATES
        statusRef.current = 'fallback'
        setRates(FALLBACK_RATES)
        setStatus('fallback')
      }
      return
    }

    setFetching(true)
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(API_URL, { signal: ctrl.signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as RatesResponse
      const next = json.rates
      if (!next || Object.keys(next).length === 0) throw new Error('Empty rates payload')
      if (token !== tokenRef.current) return

      const now = Date.now()
      /* previous sync = whatever real (non-fallback) rates are on screen right now */
      const hadReal =
        statusRef.current !== 'fallback' &&
        ratesRef.current !== null &&
        fetchedAtRef.current !== null
      const prev: PrevRates | null = hadReal
        ? { rates: ratesRef.current as Record<string, number>, fetchedAt: fetchedAtRef.current as number }
        : null

      ratesRef.current = next
      fetchedAtRef.current = now
      statusRef.current = 'live'
      setRates(next)
      setPrevRates(prev?.rates ?? null)
      setFetchedAt(now)
      setStatus('live')

      void idbPut(CACHE_STORE, {
        key: RATES_KEY,
        base: 'USD',
        rates: next,
        fetchedAt: now,
        prev,
      } satisfies RatesCacheRow).catch(() => {
        /* memory-only session */
      })
    } catch {
      if (token !== tokenRef.current) return
      if (ratesRef.current) {
        statusRef.current = 'stale-offline'
        setStatus('stale-offline')
      } else {
        ratesRef.current = FALLBACK_RATES
        statusRef.current = 'fallback'
        setRates(FALLBACK_RATES)
        setStatus('fallback')
      }
    } finally {
      clearTimeout(timer)
      if (token === tokenRef.current) setFetching(false)
    }
  }, [])

  /* ---------------- boot: hydrate from IndexedDB instantly, then background-refresh ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      let cache: RatesCacheRow | null = null
      let savedFavs: string[] | null = null
      let savedPair: { from: string; to: string } | null = null
      let savedAmount: string | null = null
      try {
        const [c, f, p, a] = await Promise.all([
          idbGet<RatesCacheRow>(CACHE_STORE, RATES_KEY),
          idbGet<FavRow>(SET_STORE, FAVS_KEY),
          idbGet<PairRow>(SET_STORE, PAIR_KEY),
          idbGet<AmountRow>(SET_STORE, AMOUNT_KEY),
        ])
        cache = c
        savedFavs = f?.value ?? null
        savedPair = p?.value ?? null
        savedAmount = a?.value ?? null
      } catch {
        /* IndexedDB unavailable — memory-only session */
      }
      if (!alive) return

      /* one-time migration from the v1 localStorage cache */
      if (!cache) {
        try {
          const raw = localStorage.getItem(LEGACY_LS_KEY)
          if (raw) {
            const legacy = JSON.parse(raw) as { rates?: Record<string, number>; fetchedAt?: number }
            if (
              legacy?.rates &&
              typeof legacy.fetchedAt === 'number' &&
              Object.keys(legacy.rates).length > 0
            ) {
              cache = {
                key: 'rates',
                base: 'USD',
                rates: legacy.rates,
                fetchedAt: legacy.fetchedAt,
                prev: null,
              }
              void idbPut(CACHE_STORE, cache).catch(() => {})
            }
            localStorage.removeItem(LEGACY_LS_KEY)
          }
        } catch {
          /* malformed legacy data — ignore */
        }
      }

      if (cache?.rates && Object.keys(cache.rates).length > 0 && typeof cache.fetchedAt === 'number') {
        ratesRef.current = cache.rates
        fetchedAtRef.current = cache.fetchedAt
        statusRef.current = 'stale'
        setRates(cache.rates)
        setPrevRates(cache.prev?.rates ?? null)
        setFetchedAt(cache.fetchedAt)
        setStatus('stale')
      }

      if (savedFavs === null) {
        savedFavs = DEFAULT_FAVS
        void idbPut(SET_STORE, { key: FAVS_KEY, value: savedFavs } satisfies FavRow).catch(() => {})
      }
      setFavs(savedFavs.filter(isKnownCode))

      if (savedPair && isKnownCode(savedPair.from) && isKnownCode(savedPair.to)) {
        setFrom(savedPair.from)
        setTo(savedPair.to)
      }
      if (typeof savedAmount === 'string') {
        const clean = sanitizeAmount(savedAmount)
        if (clean !== '') setAmount(clean)
      }

      if (alive) setBooted(true)

      /* background refresh — always, keeps the pill + movement deltas current */
      void loadRates()
    })()
    return () => {
      alive = false
    }
  }, [loadRates])

  /* ---------------- keep the "as of Xh ago" pill ticking ---------------- */
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  /* ---------------- online/offline listeners ---------------- */
  useEffect(() => {
    const onOnline = () => {
      if (statusRef.current === 'stale-offline' || statusRef.current === 'fallback') {
        void loadRates()
      }
    }
    const onOffline = () => {
      if (ratesRef.current && statusRef.current !== 'fallback') {
        statusRef.current = 'stale-offline'
        setStatus('stale-offline')
      }
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [loadRates])

  /* ---------------- persist last pair + amount (post-hydration) ---------------- */
  useEffect(() => {
    if (!booted) return
    void idbPut(SET_STORE, { key: PAIR_KEY, value: { from, to } } satisfies PairRow).catch(() => {})
  }, [from, to, booted])

  useEffect(() => {
    if (!booted) return
    const t = setTimeout(() => {
      void idbPut(SET_STORE, { key: AMOUNT_KEY, value: amount } satisfies AmountRow).catch(() => {})
    }, 400)
    return () => clearTimeout(t)
  }, [amount, booted])

  /* ---------------- actions ---------------- */
  const swap = useCallback(() => {
    buzz(12)
    setSwapDeg((d) => d + 180)
    setFrom(to)
    setTo(from)
  }, [from, to])

  const toggleFav = useCallback((code: string) => {
    buzz(10)
    setFavs((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
      void idbPut(SET_STORE, { key: FAVS_KEY, value: next } satisfies FavRow).catch(() => {})
      return next
    })
  }, [])

  /* ---------------- derived ---------------- */
  const parsedAmount = Number(amount)
  const amountValid = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount >= 0

  const crossRate = useMemo(() => {
    if (!rates) return null
    const rf = rates[from]
    const rt = rates[to]
    if (typeof rf !== 'number' || typeof rt !== 'number' || rf === 0) return null
    return rt / rf
  }, [rates, from, to])

  const converted = amountValid && crossRate !== null ? parsedAmount * crossRate : null

  const favChips = useMemo(() => favs.filter(isKnownCode), [favs])
  const toFav = favs.includes(to)

  const now = nowTick
  const ageShort = fetchedAt !== null ? ageLabel(fetchedAt, now, true) : null
  const cacheStale = fetchedAt !== null && now - fetchedAt > FRESH_MS

  /* ---------------- status pill ---------------- */
  let pillText = 'Syncing…'
  let pillCls = ZINC_PILL
  if (status === 'live') {
    pillText = 'Live'
    pillCls = EMERALD_PILL
  } else if (status === 'stale') {
    pillText = ageShort !== null ? `as of ${ageShort}` : 'Cached'
    pillCls = cacheStale ? AMBER_PILL : ZINC_PILL
  } else if (status === 'stale-offline') {
    pillText = ageShort !== null ? `Offline · ${ageShort}` : 'Offline'
    pillCls = AMBER_PILL
  } else if (status === 'fallback') {
    pillText = 'Approx.'
    pillCls = AMBER_PILL
  }

  const retry = useCallback(() => {
    buzz(10)
    void loadRates()
  }, [loadRates])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto w-full max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-emerald-500/[0.10] via-transparent to-green-500/[0.06] px-4 py-4 sm:px-5 sm:py-5">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-16 size-44 rounded-full bg-[#22c55e]/15 blur-3xl"
          />
          <div className="relative flex items-center gap-3.5">
            <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-300 via-emerald-400 to-green-600 text-zinc-950 ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(34_197_94/0.65),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <CircleDollarSign className="size-6" strokeWidth={2} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-bold tracking-tight sm:text-lg">
                Currency Converter
              </h2>
              <p className="truncate text-xs text-zinc-400">
                Live FX · works offline with last known rates
              </p>
            </div>
            <span
              role="status"
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold tabular-nums',
                pillCls
              )}
            >
              {status === 'loading' && <Loader2 className="size-3 animate-spin" aria-hidden />}
              {status === 'live' && (
                <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden />
              )}
              {status === 'stale-offline' && <WifiOff className="size-3" aria-hidden />}
              {pillText}
            </span>
            <button
              type="button"
              onClick={retry}
              disabled={fetching}
              aria-label="Refresh exchange rates"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={cn('size-4', fetching && 'animate-spin')} aria-hidden />
            </button>
          </div>
        </div>

        {/* ---------------- Offline / fallback banners ---------------- */}
        {status === 'stale-offline' && (
          <div
            role="alert"
            className="flex items-center gap-3 border-b border-amber-400/20 bg-amber-500/[0.08] px-4 py-2.5 sm:px-5"
          >
            <WifiOff className="size-4 shrink-0 text-amber-300" aria-hidden />
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-200/90">
              {typeof navigator !== 'undefined' && !navigator.onLine
                ? `You're offline — showing last synced rates${
                    ageShort !== null ? ` from ${ageLabel(fetchedAt ?? now, now)}` : ''
                  }.`
                : `Couldn't reach the rates service — showing last synced rates${
                    ageShort !== null ? ` from ${ageLabel(fetchedAt ?? now, now)}` : ''
                  }.`}
            </p>
            <button
              type="button"
              onClick={retry}
              disabled={fetching}
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-amber-400/30 px-3 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-400/10 disabled:opacity-50"
            >
              <RefreshCw className={cn('size-3.5', fetching && 'animate-spin')} aria-hidden />
              Retry
            </button>
          </div>
        )}
        {status === 'fallback' && (
          <div
            role="status"
            className="flex items-center gap-3 border-b border-amber-400/20 bg-amber-500/[0.08] px-4 py-2.5 sm:px-5"
          >
            <TriangleAlert className="size-4 shrink-0 text-amber-300" aria-hidden />
            <p className="min-w-0 flex-1 text-xs leading-relaxed text-amber-200/90">
              Live rates are unavailable right now — built-in approximate rates are being used.
            </p>
            <button
              type="button"
              onClick={retry}
              disabled={fetching}
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-amber-400/30 px-3 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-400/10 disabled:opacity-50"
            >
              <RefreshCw className={cn('size-3.5', fetching && 'animate-spin')} aria-hidden />
              Retry
            </button>
          </div>
        )}

        {/* ---------------- Body ---------------- */}
        <div className="space-y-5 p-4 sm:p-5">
          {/* Favorites strip */}
          <section aria-label="Favorite currencies" className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Favorites
              </p>
              <p className="truncate text-[10px] text-zinc-600">Tap a chip to set the target</p>
            </div>
            {favChips.length === 0 ? (
              <p className="flex items-center gap-2 rounded-xl border border-dashed border-white/10 px-3 py-2.5 text-xs leading-relaxed text-zinc-500">
                <Star className="size-3.5 shrink-0" aria-hidden />
                Nothing pinned yet — tap the star next to the result to pin a currency here.
              </p>
            ) : (
              <div className="-mx-0.5 flex gap-2 overflow-x-auto px-0.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <AnimatePresence mode="popLayout" initial={false}>
                  {favChips.map((code) => {
                    if (!rates) return null
                    const delta = deltaFor(code, rates, prevRates)
                    const rf = rates[from]
                    const rc = rates[code]
                    const chipRate =
                      typeof rf === 'number' && typeof rc === 'number' && rf !== 0 ? rc / rf : null
                    const before = prevRates?.[code]
                    const active = code === to
                    return (
                      <motion.button
                        key={code}
                        type="button"
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.85 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 30 }}
                        onClick={() => {
                          buzz(8)
                          setTo(code)
                        }}
                        aria-pressed={active}
                        aria-label={`Convert to ${code}${chipRate !== null ? ` — 1 ${from} = ${formatChipRate(chipRate)}` : ''}`}
                        title={
                          typeof before === 'number'
                            ? `Was ${formatChipRate(before)} at the previous sync`
                            : undefined
                        }
                        className={cn(
                          'flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-xl border px-3 py-1.5 transition-colors',
                          active
                            ? 'border-emerald-400/50 bg-emerald-500/15'
                            : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
                        )}
                      >
                        <Star
                          className="size-3 shrink-0 text-emerald-400"
                          fill="currentColor"
                          aria-hidden
                        />
                        <span className="text-[13px] font-bold tracking-wide text-zinc-100">
                          {code}
                        </span>
                        {chipRate !== null && (
                          <span className="text-[11px] tabular-nums text-zinc-400">
                            {formatChipRate(chipRate)}
                          </span>
                        )}
                        {delta && (
                          <span
                            className={cn(
                              'text-[10px] font-semibold tabular-nums',
                              delta.dir > 0 ? 'text-emerald-400' : 'text-rose-400'
                            )}
                          >
                            {delta.dir > 0 ? '▲' : '▼'}{' '}
                            {Math.abs(delta.pct).toFixed(Math.abs(delta.pct) >= 10 ? 1 : 2)}%
                          </span>
                        )}
                      </motion.button>
                    )
                  })}
                </AnimatePresence>
              </div>
            )}
          </section>

          {/* Amount */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <label
                htmlFor="currency-amount"
                className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
              >
                Amount to convert
              </label>
              <span className="text-[11px] tabular-nums text-zinc-500">
                {from} · {symbolOf(from)}
              </span>
            </div>
            <div className="flex h-14 items-center rounded-xl border border-white/10 bg-white/5 px-4 transition-colors focus-within:border-emerald-400/40">
              <input
                id="currency-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text')
                  if (!text) return
                  e.preventDefault()
                  setAmount(sanitizeAmount(text))
                }}
                aria-label="Amount to convert"
                className="h-full w-full bg-transparent text-2xl font-bold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              />
            </div>
            <div className="grid grid-cols-5 gap-2" role="group" aria-label="Quick amounts">
              {[1, 10, 100, 1000].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    buzz(8)
                    setAmount(String(n))
                  }}
                  aria-label={`Set amount to ${n}`}
                  aria-pressed={amount === String(n)}
                  className={cn(
                    'min-h-11 rounded-xl border text-sm font-bold tabular-nums transition-colors',
                    amount === String(n)
                      ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200'
                      : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]'
                  )}
                >
                  {n}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  buzz(8)
                  setAmount('')
                }}
                aria-label="Clear amount"
                className="flex min-h-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-zinc-200"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          </div>

          {/* From / swap / To */}
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-1.5">
              <label
                htmlFor="currency-from"
                className="block px-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
              >
                From
              </label>
              <Select
                value={from}
                onValueChange={(v) => {
                  buzz(8)
                  setFrom(v)
                }}
              >
                <SelectTrigger
                  id="currency-from"
                  aria-label="From currency"
                  className="h-12 w-full rounded-xl border-white/10 bg-white/5 text-zinc-100 hover:bg-white/[0.08] focus:ring-emerald-400/30 data-[placeholder]:text-zinc-500 [&>svg]:text-zinc-400"
                >
                  <SelectValue placeholder="From currency" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-white/10 bg-zinc-900 text-zinc-100">
                  {CURRENCIES.map((c) => (
                    <SelectItem
                      key={c.code}
                      value={c.code}
                      className="rounded-lg focus:bg-emerald-500/15 focus:text-emerald-200"
                    >
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-center">
              <motion.button
                type="button"
                onClick={swap}
                animate={{ rotate: swapDeg }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                aria-label="Swap currencies"
                className="flex size-12 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-500/10 text-emerald-300 shadow-[0_8px_24px_-8px_rgb(34_197_94/0.5)] transition-colors hover:bg-emerald-500/20"
              >
                <ArrowLeftRight className="size-5" aria-hidden />
              </motion.button>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="currency-to"
                className="block px-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
              >
                To
              </label>
              <Select
                value={to}
                onValueChange={(v) => {
                  buzz(8)
                  setTo(v)
                }}
              >
                <SelectTrigger
                  id="currency-to"
                  aria-label="To currency"
                  className="h-12 w-full rounded-xl border-white/10 bg-white/5 text-zinc-100 hover:bg-white/[0.08] focus:ring-emerald-400/30 data-[placeholder]:text-zinc-500 [&>svg]:text-zinc-400"
                >
                  <SelectValue placeholder="To currency" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-white/10 bg-zinc-900 text-zinc-100">
                  {CURRENCIES.map((c) => (
                    <SelectItem
                      key={c.code}
                      value={c.code}
                      className="rounded-lg focus:bg-emerald-500/15 focus:text-emerald-200"
                    >
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Result hero */}
          <div
            role="status"
            aria-live="polite"
            className="relative overflow-hidden rounded-2xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/[0.10] via-transparent to-green-600/[0.08] px-4 pb-4 pt-5 text-center sm:px-5"
          >
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-0 size-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#22c55e]/10 blur-3xl"
            />
            <button
              type="button"
              onClick={() => toggleFav(to)}
              aria-pressed={toFav}
              aria-label={toFav ? `Remove ${to} from favorites` : `Pin ${to} to favorites`}
              className={cn(
                'absolute right-1.5 top-1.5 z-10 flex size-11 items-center justify-center rounded-xl transition-colors',
                toFav
                  ? 'text-emerald-300 hover:bg-emerald-400/10'
                  : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
              )}
            >
              <Star className="size-5" fill={toFav ? 'currentColor' : 'none'} aria-hidden />
            </button>

            <div className="relative flex min-h-28 items-center justify-center px-9 sm:px-11">
              <AnimatePresence mode="popLayout" initial={false}>
                {rates === null && (status === 'loading' || status === 'stale') ? (
                  <motion.div
                    key="boot"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                    className="space-y-3"
                  >
                    <p className="flex items-center justify-center gap-2 text-sm text-zinc-400">
                      <Loader2 className="size-4 animate-spin text-emerald-300" aria-hidden />
                      Fetching live exchange rates…
                    </p>
                    <div className="mx-auto h-10 w-44 animate-pulse rounded-xl bg-white/[0.06]" />
                  </motion.div>
                ) : (
                  <motion.div
                    key={`${from}->${to}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                    className="space-y-1.5"
                  >
                    {converted !== null ? (
                      <>
                        <p className="break-all text-4xl font-black tracking-tight sm:text-5xl">
                          <span className="mr-1.5 align-middle text-2xl text-zinc-400 sm:text-3xl">
                            {symbolOf(to)}
                          </span>
                          <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-green-600 bg-clip-text text-transparent tabular-nums">
                            {formatResult(converted)}
                          </span>
                        </p>
                        <p className="text-sm tabular-nums text-zinc-400">
                          {formatResult(parsedAmount)} {from} equals
                        </p>
                      </>
                    ) : (
                      <p className="px-2 text-sm leading-relaxed text-zinc-500">
                        {amountValid
                          ? `Exchange rate for ${from} → ${to} is unavailable.`
                          : 'Enter a valid amount to convert.'}
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="relative mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-white/5 pt-3 text-xs text-zinc-400">
              <span className="tabular-nums">
                {crossRate !== null ? (
                  <>
                    1 {from} ={' '}
                    <span className="font-semibold text-zinc-100">{formatRate(crossRate)}</span>{' '}
                    {to}
                  </>
                ) : (
                  'Rate unavailable'
                )}
              </span>
              <span className="text-zinc-500">
                {fetchedAt !== null
                  ? `Synced ${new Date(fetchedAt).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : 'Not synced yet'}
              </span>
            </div>
          </div>

          <p className="text-center text-[10px] text-zinc-600">
            Rates: open.er-api.com (base USD) · cached on-device for offline use
          </p>
        </div>
      </motion.div>
    </div>
  )
}
