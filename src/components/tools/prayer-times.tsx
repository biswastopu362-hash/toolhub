'use client'

/**
 * Prayer Times — a serene, on-device salah companion.
 *
 * Pick a location once (device GPS with graceful denial → Open-Meteo city
 * search, or manual latitude/longitude), and get the five daily prayers plus
 * sunrise from the key-free Aladhan API — with Bengali labels under every
 * name, a Hijri date chip, a live countdown ring to the next prayer, a
 * Karachi-first calculation-method picker, Hanafi/Shafi Asr toggle, and an
 * optional adhan-style chime + vibration reminder while the app is open.
 * The last successful schedule per date is cached in IndexedDB
 * ('toolhub-prayer') and rendered instantly on open — offline last-known
 * state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Bell,
  BellRing,
  Check,
  CloudSun,
  LocateFixed,
  Loader2,
  MapPin,
  Moon,
  MoonStar,
  RefreshCw,
  Search,
  Settings2,
  Sun,
  SunDim,
  Sunrise,
  Sunset,
  TriangleAlert,
  Volume2,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type PrayerKey = 'Fajr' | 'Dhuhr' | 'Asr' | 'Maghrib' | 'Isha'
type DayTimings = Record<PrayerKey | 'Sunrise', string>

interface PrayerMeta {
  key: PrayerKey
  en: string
  bn: string
  Icon: LucideIcon
  tint: string
}

const PRAYERS: PrayerMeta[] = [
  { key: 'Fajr', en: 'Fajr', bn: 'ফজর', Icon: CloudSun, tint: 'text-teal-300' },
  { key: 'Dhuhr', en: 'Dhuhr', bn: 'যোহর', Icon: Sun, tint: 'text-amber-300' },
  { key: 'Asr', en: 'Asr', bn: 'আসর', Icon: SunDim, tint: 'text-orange-300' },
  { key: 'Maghrib', en: 'Maghrib', bn: 'মাগরিব', Icon: Sunset, tint: 'text-orange-400' },
  { key: 'Isha', en: 'Isha', bn: 'এশা', Icon: Moon, tint: 'text-violet-300' },
]

const PRAYER_BY_KEY = new Map(PRAYERS.map((p) => [p.key, p]))

const SUNRISE_BN = 'সূর্যোদয়'

interface PrayerSettings {
  lat: number
  lng: number
  city: string
  /** Aladhan calculation method: 1 Karachi · 2 ISNA · 3 MWL · 5 Egypt */
  method: number
  /** Asr school: 1 Hanafi (later) · 0 Shafi/standard */
  school: 0 | 1
  adhanOn: boolean
}

type MethodId = 1 | 2 | 3 | 5

const METHODS: Array<{ id: MethodId; label: string; sub: string }> = [
  { id: 1, label: 'Karachi', sub: 'Univ. of Islamic Sciences — Bangladesh standard' },
  { id: 2, label: 'ISNA', sub: 'Islamic Society of North America' },
  { id: 3, label: 'MWL', sub: 'Muslim World League' },
  { id: 5, label: 'Egypt', sub: 'Egyptian General Authority' },
]

const SCHOOLS: Array<{ id: 0 | 1; label: string; sub: string }> = [
  { id: 1, label: 'Hanafi', sub: 'Later Asr — Bangladesh & South Asia' },
  { id: 0, label: 'Shafi · Standard', sub: 'Earlier Asr — Shafi, Maliki, Hanbali' },
]

const HIJRI_BN: Record<number, string> = {
  1: 'মুহাররম',
  2: 'সফর',
  3: 'রবিউল আউয়াল',
  4: 'রবিউস সানি',
  5: 'জুমাদাল আউয়াল',
  6: 'জুমাদাস সানি',
  7: 'রজব',
  8: 'শাবান',
  9: 'রমজান',
  10: 'শাওয়াল',
  11: 'জিলকদ',
  12: 'জিলহজ',
}

interface HijriInfo {
  day: number
  monthNumber: number
  monthEn: string
  year: number
}

interface DayData {
  /** local date key 'YYYY-MM-DD' */
  date: string
  timings: DayTimings
  hijri: HijriInfo | null
  gregorian: string
  lat: number
  lng: number
  method: number
  school: number
  savedAt: number
}

interface NextInfo {
  key: PrayerKey
  en: string
  bn: string
  time: string
  target: number
  frac: number
  tomorrow: boolean
}

/* ---------------- date + time helpers (all local-time) ---------------- */

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dmyFromKey(key: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  const [y, m, d] = key.split('-')
  return `${d}-${m}-${y}`
}

function nextDayKey(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return ''
  const [y, m, d] = key.split('-').map(Number)
  return localDayKey(new Date(y ?? 2025, (m ?? 1) - 1, (d ?? 1) + 1))
}

/** 'HH:MM (TZ)' → {h, m} — tolerates the timezone suffix Aladhan appends. */
function parseHM(s: string): { h: number; m: number } | null {
  const m = /(\d{1,2}):(\d{2})/.exec(s ?? '')
  if (!m) return null
  const h = Number(m[1])
  const mm = Number(m[2])
  if (h > 23 || mm > 59) return null
  return { h, m: mm }
}

/** 'HH:MM' → '4:38 AM' */
function to12(hm: string): string {
  const p = parseHM(hm)
  if (!p) return hm
  const ap = p.h >= 12 ? 'PM' : 'AM'
  const h = p.h % 12 || 12
  return `${h}:${String(p.m).padStart(2, '0')} ${ap}`
}

function timingToDate(hm: string, base: Date): Date | null {
  const p = parseHM(hm)
  if (!p) return null
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), p.h, p.m, 0, 0)
}

/** '2h 14m' above the hour, '14m 05s' below. */
function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/* ---------------- Aladhan payload ---------------- */

interface AladhanHijri {
  day?: string | number
  year?: string | number
  month?: { number?: string | number; en?: string }
}

interface AladhanResponse {
  code?: number
  data?: {
    timings?: Record<string, string>
    date?: {
      readable?: string
      hijri?: AladhanHijri
    }
  }
}

const NEEDED_TIMINGS = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const

function normalizeTimings(raw?: Record<string, string>): DayTimings | null {
  if (!raw) return null
  const out: Partial<DayTimings> = {}
  for (const k of NEEDED_TIMINGS) {
    const p = parseHM(raw[k] ?? '')
    if (!p) return null
    out[k] = `${String(p.h).padStart(2, '0')}:${String(p.m).padStart(2, '0')}`
  }
  return out as DayTimings
}

function parseHijri(h?: AladhanHijri): HijriInfo | null {
  if (!h) return null
  const day = Number(h.day)
  const year = Number(h.year)
  const monthNumber = Number(h.month?.number)
  const monthEn = (h.month?.en ?? '').trim()
  if (!Number.isFinite(day) || !Number.isFinite(year) || !monthEn) return null
  return { day, year, monthNumber: Number.isFinite(monthNumber) ? monthNumber : 0, monthEn }
}

/* ---------------- sound, haptics, notifications ---------------- */

function haptic(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

function audioCtx(): AudioContext | null {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    return new Ctx()
  } catch {
    return null
  }
}

function tone(ctx: AudioContext, freq: number, start: number, dur: number, vol: number) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(vol, start + 0.09)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(start)
  osc.stop(start + dur + 0.05)
}

/** Gentle synthesized adhan-style chime — a maqam-flavoured rise and resolve. */
function playAdhanChime() {
  try {
    const ctx = audioCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    const t0 = ctx.currentTime + 0.06
    // D5 · F#5 · G5 · C6 · G5 · D5 — soft Hijaz-inflected phrase
    const seq: Array<[number, number]> = [
      [587.33, 0],
      [739.99, 0.65],
      [783.99, 1.3],
      [1046.5, 1.95],
      [783.99, 2.8],
      [587.33, 3.6],
    ]
    for (const [f, off] of seq) {
      tone(ctx, f, t0 + off, 1.15, 0.16)
      tone(ctx, f * 2, t0 + off, 0.9, 0.045)
    }
    window.setTimeout(() => {
      try {
        void ctx.close()
      } catch {
        /* already closed */
      }
    }, 6500)
  } catch {
    /* audio unavailable — stay silent */
  }
}

/** Two-note confirmation blip; doubles as an autoplay-policy audio unlock. */
function playConfirmBlip() {
  try {
    const ctx = audioCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    const t0 = ctx.currentTime + 0.05
    tone(ctx, 659.25, t0, 0.35, 0.1)
    tone(ctx, 987.77, t0 + 0.18, 0.5, 0.1)
    window.setTimeout(() => {
      try {
        void ctx.close()
      } catch {
        /* already closed */
      }
    }, 1500)
  } catch {
    /* audio unavailable */
  }
}

function notifyNative(title: string, body: string) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return
    new Notification(title, { body, silent: true })
  } catch {
    /* notifications unavailable (e.g. Android Chrome without a service worker) */
  }
}

/* ================================================================== */
/* IndexedDB — settings singleton + per-date schedule cache             */
/* ================================================================== */

const DB_NAME = 'toolhub-prayer'
const DB_VERSION = 1
const STORE_SET = 'settings'
const STORE_CACHE = 'cache'
const CACHE_KEEP = 40

let dbPromise: Promise<IDBDatabase> | null = null

function openPrayerDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE_SET)) d.createObjectStore(STORE_SET, { keyPath: 'key' })
      if (!d.objectStoreNames.contains(STORE_CACHE)) d.createObjectStore(STORE_CACHE, { keyPath: 'date' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openPrayerDb()
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

interface SetRow {
  key: 'settings'
  value: PrayerSettings
}

async function pruneCache(): Promise<void> {
  try {
    const all = await idbGetAll<DayData>(STORE_CACHE)
    if (all.length <= CACHE_KEEP) return
    const sorted = [...all].sort((a, b) => a.savedAt - b.savedAt)
    for (const row of sorted.slice(0, all.length - CACHE_KEEP)) {
      if (row?.date) void idbDelete(STORE_CACHE, row.date).catch(() => {})
    }
  } catch {
    /* non-fatal */
  }
}

/* ================================================================== */
/* Shared bits                                                          */
/* ================================================================== */

/** Thin glass scrollbar for long lists (house convention). */
const SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

const RING_R = 54
const RING_C = 2 * Math.PI * RING_R

const STARS: Array<{ l: string; t: string; s: number; o: number; d: number; delay: number }> = [
  { l: '4%', t: '16%', s: 2, o: 0.45, d: 3.2, delay: 0 },
  { l: '12%', t: '58%', s: 1.5, o: 0.35, d: 4.1, delay: 0.7 },
  { l: '18%', t: '30%', s: 2.5, o: 0.5, d: 3.6, delay: 1.2 },
  { l: '27%', t: '74%', s: 1.5, o: 0.3, d: 4.6, delay: 0.3 },
  { l: '38%', t: '12%', s: 2, o: 0.4, d: 3.9, delay: 1.6 },
  { l: '47%', t: '44%', s: 1.5, o: 0.28, d: 4.4, delay: 0.9 },
  { l: '58%', t: '20%', s: 2, o: 0.45, d: 3.4, delay: 2.1 },
  { l: '66%', t: '66%', s: 1.5, o: 0.3, d: 4.8, delay: 0.4 },
  { l: '76%', t: '10%', s: 2.5, o: 0.5, d: 3.7, delay: 1.4 },
  { l: '84%', t: '52%', s: 2, o: 0.38, d: 4.2, delay: 0.2 },
  { l: '92%', t: '28%', s: 1.5, o: 0.42, d: 3.3, delay: 1.9 },
  { l: '95%', t: '76%', s: 2, o: 0.3, d: 4.5, delay: 1.1 },
]

function StarField() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {STARS.map((s, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-white"
          style={{ left: s.l, top: s.t, width: s.s, height: s.s, opacity: s.o }}
          animate={i % 2 === 0 ? { opacity: [s.o, s.o * 0.2, s.o] } : undefined}
          transition={{ duration: s.d, repeat: Infinity, ease: 'easeInOut', delay: s.delay }}
        />
      ))}
    </div>
  )
}

function GlassSwitch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full border transition-colors after:absolute after:-inset-2.5 after:rounded-full after:content-[""]',
        checked
          ? 'border-emerald-400/60 bg-emerald-500/80 shadow-[0_0_16px_-4px_rgb(16_185_129/0.7)]'
          : 'border-white/15 bg-white/10'
      )}
    >
      <motion.span
        className="absolute left-0.5 top-1/2 size-5 -translate-y-1/2 rounded-full bg-white shadow"
        animate={{ x: checked ? 22 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </button>
  )
}

/* ================================================================== */
/* Component                                                            */
/* ================================================================== */

export default function PrayerTimesApp() {
  const { toast } = useToast()

  /* ---------------- core state ---------------- */
  const [loaded, setLoaded] = useState(false)
  const [settings, setSettings] = useState<PrayerSettings | null>(null)
  const settingsRef = useRef<PrayerSettings | null>(null)
  const [dayKey, setDayKey] = useState('')
  const [data, setData] = useState<DayData | null>(null)
  const dataRef = useRef<DayData | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [syncNote, setSyncNote] = useState<'live' | 'saved'>('live')
  const [fetching, setFetching] = useState(false)
  const [online, setOnline] = useState(true)
  const [retryToken, setRetryToken] = useState(0)
  const [nowMs, setNowMs] = useState(0)
  const [tomorrow, setTomorrow] = useState<{ key: string; fajr: string; sig: string } | null>(null)
  const [banner, setBanner] = useState<{ en: string; bn: string; time: string; id: number } | null>(null)
  const [notifPerm, setNotifPerm] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('default')

  /* ---------------- modals + forms ---------------- */
  const [locOpen, setLocOpen] = useState(false)
  const [setOpen, setSetOpen] = useState(false)
  const [locating, setLocating] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [manLat, setManLat] = useState('')
  const [manLng, setManLng] = useState('')

  const fetchTokenRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const bannerTimerRef = useRef<number | null>(null)
  const firedRef = useRef<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)

  const applyDay = useCallback((day: DayData) => {
    dataRef.current = day
    setData(day)
  }, [])

  /* ---------------- hydration (IndexedDB → instant paint) ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        setOnline(typeof navigator !== 'undefined' ? navigator.onLine : true)
      } catch {
        /* default online */
      }
      try {
        const rows = await idbGetAll<SetRow>(STORE_SET)
        if (!alive) return
        const saved = rows.find((r) => r.key === 'settings')?.value
        if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
          const s: PrayerSettings = {
            lat: saved.lat,
            lng: saved.lng,
            city: saved.city || 'My location',
            method: (METHODS.some((m) => m.id === saved.method) ? saved.method : 1) as MethodId,
            school: saved.school === 0 ? 0 : 1,
            adhanOn: Boolean(saved.adhanOn),
          }
          settingsRef.current = s
          setSettings(s)
        }
      } catch {
        /* private mode / quota — fresh start */
      }
      const k = localDayKey(new Date())
      setDayKey(k)
      const s = settingsRef.current
      if (s) {
        try {
          const cacheRows = await idbGetAll<DayData>(STORE_CACHE)
          const hit = cacheRows.find(
            (c) =>
              c.date === k &&
              c.lat === s.lat &&
              c.lng === s.lng &&
              c.method === s.method &&
              c.school === s.school &&
              Boolean(c.timings?.Fajr)
          )
          if (hit && alive) {
            applyDay(hit)
            setPhase('ready')
            setSyncNote('saved')
          }
        } catch {
          /* cache read failed */
        }
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [applyDay])

  /* ---------------- 1s tick + midnight rollover ---------------- */
  useEffect(() => {
    setNowMs(Date.now())
    const t = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!nowMs) return
    const k = localDayKey(new Date(nowMs))
    if (k && k !== dayKey) setDayKey(k)
  }, [nowMs, dayKey])

  /* re-sync the clock when the tab becomes visible again */
  useEffect(() => {
    const onVis = () => {
      try {
        if (document.visibilityState === 'visible') setNowMs(Date.now())
      } catch {
        /* ignore */
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  /* ---------------- online / offline listeners ---------------- */
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  /* ---------------- notification permission probe (never blocks) ---------------- */
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && 'Notification' in window) setNotifPerm(Notification.permission)
      else setNotifPerm('unsupported')
    } catch {
      setNotifPerm('unsupported')
    }
  }, [])

  /* ---------------- fetch today's schedule from Aladhan ---------------- */
  const fetchDay = useCallback(
    async (key: string, silent = false) => {
      const s = settingsRef.current
      if (!s || !key) return
      const dmy = dmyFromKey(key)
      if (!dmy) return
      const token = ++fetchTokenRef.current
      abortRef.current?.abort()
      const ac = new AbortController()
      abortRef.current = ac
      if (!silent && !dataRef.current) setPhase('loading')
      if (!silent) setFetching(true)
      try {
        const res = await fetch(
          `https://api.aladhan.com/v1/timings/${dmy}?latitude=${s.lat}&longitude=${s.lng}&method=${s.method}&school=${s.school}`,
          { signal: ac.signal }
        )
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as AladhanResponse
        if (token !== fetchTokenRef.current) return
        const timings = normalizeTimings(json.data?.timings)
        if (!timings) throw new Error('Unexpected payload')
        const day: DayData = {
          date: key,
          timings,
          hijri: parseHijri(json.data?.date?.hijri),
          gregorian: (json.data?.date?.readable ?? '').trim(),
          lat: s.lat,
          lng: s.lng,
          method: s.method,
          school: s.school,
          savedAt: Date.now(),
        }
        applyDay(day)
        setPhase('ready')
        setSyncNote('live')
        void idbPut(STORE_CACHE, day).catch(() => {})
        void pruneCache()
      } catch {
        if (token !== fetchTokenRef.current) return
        if (silent) return
        if (dataRef.current) {
          setSyncNote('saved')
          toast({ title: 'Could not refresh', description: 'Showing the last saved times for today.' })
        } else {
          setPhase('error')
        }
      } finally {
        if (token === fetchTokenRef.current) setFetching(false)
      }
    },
    [applyDay, toast]
  )

  /* fetch whenever location/method/day changes — silent when fresh data is showing */
  const lat = settings?.lat
  const lng = settings?.lng
  const method = settings?.method
  const school = settings?.school
  useEffect(() => {
    const s = settingsRef.current
    if (!loaded || !s || !dayKey) return
    const d = dataRef.current
    const sameMeta =
      d && d.date === dayKey && d.lat === s.lat && d.lng === s.lng && d.method === s.method && d.school === s.school
    void fetchDay(dayKey, Boolean(sameMeta))
  }, [loaded, lat, lng, method, school, dayKey, retryToken, fetchDay])

  /* ---------------- adhan watcher (only while the app is open) ---------------- */
  const fireAdhan = useCallback((p: { en: string; bn: string }, time12: string) => {
    playAdhanChime()
    try {
      navigator.vibrate?.([200, 100, 200])
    } catch {
      /* haptics unsupported */
    }
    const id = Date.now()
    setBanner({ en: p.en, bn: p.bn, time: time12, id })
    if (bannerTimerRef.current) window.clearTimeout(bannerTimerRef.current)
    bannerTimerRef.current = window.setTimeout(() => setBanner(null), 90_000)
    notifyNative(`Prayer time — ${p.en}`, `${p.bn} · ${time12}`)
  }, [])

  useEffect(() => {
    if (!settings?.adhanOn || !data || !nowMs) return
    const nd = new Date(nowMs)
    const dk = localDayKey(nd)
    if (dk !== data.date) return
    for (const p of PRAYERS) {
      const ts = timingToDate(data.timings[p.key], nd)
      if (!ts) continue
      const id = `${dk}:${p.key}`
      if (firedRef.current.has(id)) continue
      const dt = nowMs - ts.getTime()
      if (dt >= 0 && dt <= 90_000) {
        firedRef.current.add(id)
        fireAdhan(p, to12(data.timings[p.key]))
      }
    }
  }, [nowMs, data, settings?.adhanOn, fireAdhan])

  /* ---------------- mutations (write-through to IndexedDB) ---------------- */

  const changeSettings = useCallback((patch: Partial<PrayerSettings>) => {
    const s = settingsRef.current
    if (!s) return
    const next: PrayerSettings = { ...s, ...patch }
    settingsRef.current = next
    setSettings(next)
    void idbPut(STORE_SET, { key: 'settings', value: next } satisfies SetRow).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const applyLocation = useCallback(
    (latNum: number, lngNum: number, city: string) => {
      /* Write directly — changeSettings bails when no settings row exists yet,
         which is exactly the first-run "location not set" case. */
      const next: PrayerSettings = settingsRef.current
        ? { ...settingsRef.current, lat: latNum, lng: lngNum, city }
        : { lat: latNum, lng: lngNum, city, method: 1, school: 1, adhanOn: false }
      settingsRef.current = next
      setSettings(next)
      void idbPut(STORE_SET, { key: 'settings', value: next } satisfies SetRow).catch(() => {
        /* memory-only fallback */
      })
      setTomorrow(null)
      setLocOpen(false)
      setQuery('')
      setResults(null)
      setSearching(false)
      haptic()
      toast({ title: 'Location saved', description: city })
    },
    [toast]
  )

  const toggleAdhan = useCallback(() => {
    const s = settingsRef.current
    if (!s) return
    const next: PrayerSettings = { ...s, adhanOn: !s.adhanOn }
    settingsRef.current = next
    setSettings(next)
    void idbPut(STORE_SET, { key: 'settings', value: next } satisfies SetRow).catch(() => {
      /* memory-only fallback */
    })
    haptic()
    if (next.adhanOn) {
      playConfirmBlip()
      try {
        if ('Notification' in window && Notification.permission === 'default') {
          void Notification.requestPermission()
            .then((perm) => setNotifPerm(perm))
            .catch(() => {})
        }
      } catch {
        /* notifications unavailable — chime still works */
      }
      toast({ title: 'Adhan reminder on', description: 'A gentle chime will play when a prayer time arrives.' })
    } else {
      toast({ title: 'Adhan reminder off', description: 'Prayer times will arrive quietly.' })
    }
  }, [toast])

  /* ---------------- device geolocation (graceful denial → manual search) ---------------- */

  const reverseGeocode = useCallback(async (la: number, ln: number): Promise<string> => {
    try {
      const ac = new AbortController()
      const timer = window.setTimeout(() => ac.abort(), 3500)
      const res = await fetch(
        `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${la}&longitude=${ln}&localityLanguage=en`,
        { signal: ac.signal }
      )
      window.clearTimeout(timer)
      if (res.ok) {
        const j = (await res.json()) as {
          city?: string
          locality?: string
          principalSubdivision?: string
          countryName?: string
        }
        const nm = j.city || j.locality || j.principalSubdivision
        if (nm) return j.countryName ? `${nm}, ${j.countryName}` : nm
      }
    } catch {
      /* reverse geocode is best-effort only */
    }
    return `${la.toFixed(2)}°, ${ln.toFixed(2)}°`
  }, [])

  const useDeviceLocation = useCallback(() => {
    haptic()
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      toast({
        title: 'Location unavailable',
        description: 'This device has no location services — search for your city instead.',
      })
      setLocOpen(true)
      window.setTimeout(() => searchRef.current?.focus(), 350)
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const { latitude, longitude } = pos.coords
        void (async () => {
          const city = await reverseGeocode(latitude, longitude)
          applyLocation(latitude, longitude, city)
        })()
      },
      (err) => {
        setLocating(false)
        toast({
          title: err.code === 1 ? 'Location permission denied' : 'Could not get location',
          description: 'No worries — search for your city or enter coordinates manually.',
        })
        setLocOpen(true)
        window.setTimeout(() => searchRef.current?.focus(), 350)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    )
  }, [applyLocation, reverseGeocode, toast])

  /* ---------------- city search (Open-Meteo geocoding, key-free) ---------------- */

  useEffect(() => {
    if (!locOpen) return
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`
          )
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const json = (await res.json()) as GeoResponse
          if (cancelled) return
          setResults(json.results ?? [])
          setSearching(false)
        } catch {
          if (cancelled) return
          setResults([])
          setSearching(false)
        }
      })()
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [query, locOpen])

  const saveManual = useCallback(() => {
    const la = parseFloat(manLat)
    const ln = parseFloat(manLng)
    if (Number.isNaN(la) || Number.isNaN(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
      toast({ title: 'Check coordinates', description: 'Latitude runs −90…90, longitude −180…180.' })
      return
    }
    haptic()
    void (async () => {
      const city = await reverseGeocode(la, ln)
      applyLocation(la, ln, city)
    })()
  }, [manLat, manLng, applyLocation, reverseGeocode, toast])

  const refresh = useCallback(() => {
    haptic()
    setRetryToken((t) => t + 1)
  }, [])

  /* ================================================================== */
  /* Derived                                                             */
  /* ================================================================== */

  const nowDate = nowMs ? new Date(nowMs) : null

  const nextInfo = useMemo<NextInfo | null>(() => {
    if (!data || !nowMs) return null
    const nd = new Date(nowMs)
    const ts = new Map<PrayerKey, number>()
    for (const p of PRAYERS) {
      const d = timingToDate(data.timings[p.key], nd)
      if (d) ts.set(p.key, d.getTime())
    }
    const order: PrayerKey[] = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha']
    for (let i = 0; i < order.length; i++) {
      const target = ts.get(order[i])
      if (target === undefined || nowMs >= target) continue
      const meta = PRAYER_BY_KEY.get(order[i])
      if (!meta) continue
      const prevKey: PrayerKey = i === 0 ? 'Isha' : order[i - 1]
      let prev: number | undefined
      if (i === 0) {
        const isha = ts.get('Isha')
        prev = (isha !== undefined ? isha : target - 7 * 3_600_000) - 86_400_000
      } else {
        prev = ts.get(prevKey)
      }
      const prevTs = prev !== undefined ? prev : target - 4 * 3_600_000
      const span = Math.max(target - prevTs, 60_000)
      return {
        key: meta.key,
        en: meta.en,
        bn: meta.bn,
        time: data.timings[meta.key],
        target,
        frac: Math.min(1, Math.max(0, (nowMs - prevTs) / span)),
        tomorrow: false,
      }
    }
    // after Isha — countdown to tomorrow's Fajr
    const isha = ts.get('Isha')
    const tomorrowDate = new Date(nd.getFullYear(), nd.getMonth(), nd.getDate() + 1)
    let target: number | null = null
    let time = data.timings.Fajr
    if (tomorrow && dayKey && tomorrow.key === nextDayKey(dayKey)) {
      const d = timingToDate(tomorrow.fajr, tomorrowDate)
      if (d) {
        target = d.getTime()
        time = tomorrow.fajr
      }
    }
    if (target === null) {
      const fajr = ts.get('Fajr')
      target = fajr !== undefined ? fajr + 86_400_000 : nowMs + 6 * 3_600_000
    }
    const prevTs = isha !== undefined ? isha : target - 7 * 3_600_000
    const span = Math.max(target - prevTs, 60_000)
    return {
      key: 'Fajr',
      en: 'Fajr',
      bn: 'ফজর',
      time,
      target,
      frac: Math.min(1, Math.max(0, (nowMs - prevTs) / span)),
      tomorrow: true,
    }
  }, [data, nowMs, dayKey, tomorrow])

  /* ---------------- tomorrow's Fajr (for the post-Isha countdown) ---------------- */
  const sig = settings ? `${settings.lat},${settings.lng},${settings.method},${settings.school}` : ''
  const tomorrowKey = dayKey ? nextDayKey(dayKey) : ''
  const needTomorrow = nextInfo?.tomorrow === true && !(tomorrow && tomorrow.key === tomorrowKey && tomorrow.sig === sig)

  useEffect(() => {
    if (!needTomorrow || !settings || !dayKey) return
    const tKey = tomorrowKey
    let cancelled = false
    void (async () => {
      try {
        const s = settingsRef.current
        if (!s) return
        const dmy = dmyFromKey(tKey)
        if (!dmy) return
        const res = await fetch(
          `https://api.aladhan.com/v1/timings/${dmy}?latitude=${s.lat}&longitude=${s.lng}&method=${s.method}&school=${s.school}`
        )
        if (!res.ok) return
        const json = (await res.json()) as AladhanResponse
        if (cancelled) return
        const timings = normalizeTimings(json.data?.timings)
        if (!timings) return
        setTomorrow({ key: tKey, fajr: timings.Fajr, sig })
        const day: DayData = {
          date: tKey,
          timings,
          hijri: parseHijri(json.data?.date?.hijri),
          gregorian: (json.data?.date?.readable ?? '').trim(),
          lat: s.lat,
          lng: s.lng,
          method: s.method,
          school: s.school,
          savedAt: Date.now(),
        }
        void idbPut(STORE_CACHE, day).catch(() => {})
        void pruneCache()
      } catch {
        /* best effort — the countdown falls back to Fajr + 24h */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [needTomorrow, settings, sig, dayKey, tomorrowKey, tomorrow])

  const sunriseTs = useMemo(() => {
    if (!data || !nowDate) return null
    return timingToDate(data.timings.Sunrise, nowDate)?.getTime() ?? null
  }, [data, nowDate])

  const countText = nextInfo && nowMs ? fmtCountdown(nextInfo.target - nowMs) : null

  const gregLabel = useMemo(() => {
    if (!dayKey) return ''
    const d = new Date(`${dayKey}T00:00:00`)
    if (Number.isNaN(d.getTime())) return ''
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
  }, [dayKey])

  const hijri = data?.hijri ?? null
  const hijriBn = hijri ? HIJRI_BN[hijri.monthNumber] ?? '' : ''

  const methodLabel = METHODS.find((m) => m.id === settings?.method)?.label ?? 'Karachi'
  const schoolLabel = settings?.school === 1 ? 'Hanafi' : 'Shafi (Standard)'

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
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-teal-500/[0.10] via-emerald-500/[0.06] to-transparent px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-teal-300 via-emerald-500 to-green-700 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(16_185_129/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <MoonStar className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Prayer Times</h2>
              <p className="text-xs text-zinc-400">Fajr to Isha — Bengali labels, live countdown.</p>
              <button
                onClick={() => {
                  haptic()
                  setLocOpen(true)
                }}
                className="relative mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 text-[11px] font-semibold text-emerald-200 transition-colors after:absolute after:-inset-2 after:rounded-full after:content-[''] hover:border-emerald-400/50"
                aria-label={`Location: ${settings?.city ?? 'not set'} — tap to change`}
              >
                <MapPin className="size-3" aria-hidden />
                <span className="max-w-[220px] truncate">{settings?.city ?? 'Set location'}</span>
              </button>
            </div>
            <button
              onClick={() => {
                haptic()
                setSetOpen(true)
              }}
              aria-label="Calculation settings"
              className="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-white/10 hover:text-white"
            >
              <Settings2 className="size-4.5" aria-hidden />
            </button>
          </div>
        </div>

        {!loaded ? (
          /* ---------------- Hydrating ---------------- */
          <div className="space-y-3 p-5">
            <div className="h-10 animate-pulse rounded-2xl bg-white/[0.05]" />
            <div className="h-48 animate-pulse rounded-3xl bg-white/[0.05]" />
            <div className="grid grid-cols-2 gap-2.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.05]" />
              ))}
            </div>
          </div>
        ) : !settings ? (
          /* ---------------- Empty state — choose a location ---------------- */
          <div className="relative overflow-hidden px-5 py-12 text-center">
            <StarField />
            <div className="pointer-events-none absolute -top-16 right-0 size-48 rounded-full bg-emerald-500/10 blur-3xl" aria-hidden />
            <span className="relative mx-auto flex size-16 items-center justify-center rounded-3xl bg-gradient-to-br from-teal-300 via-emerald-500 to-green-700 text-white shadow-[0_18px_45px_-12px_rgb(16_185_129/0.7)]">
              <MoonStar className="size-8" strokeWidth={1.8} aria-hidden />
            </span>
            <h3 className="relative mt-4 text-base font-bold">Find your prayer times</h3>
            <p className="relative mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-zinc-500">
              Set your location once — Fajr to Isha with Bengali labels, the Hijri date, and a live countdown to the
              next prayer. Everything stays on this device.
            </p>
            <div className="relative mx-auto mt-5 flex max-w-xs flex-col gap-2">
              <Button
                onClick={useDeviceLocation}
                disabled={locating}
                className="h-11 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
              >
                {locating ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <LocateFixed className="size-4" aria-hidden />
                )}
                {locating ? 'Locating…' : 'Use my location'}
              </Button>
              <button
                onClick={() => {
                  haptic()
                  setLocOpen(true)
                }}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10"
              >
                <Search className="size-4" aria-hidden /> Search city manually
              </button>
            </div>
            <p className="relative mt-5 text-[10px] text-zinc-600">
              Times by Aladhan.com · works offline with saved cache
            </p>
          </div>
        ) : (
          <div className="space-y-4 p-4 sm:p-5">
            {/* ---------------- Date strip ---------------- */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-zinc-400">{gregLabel || dayKey}</p>
              {hijri ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-200">
                  <MoonStar className="size-3" aria-hidden />
                  {hijri.day} {hijri.monthEn} {hijri.year}
                  {hijriBn ? <span lang="bn">· {hijriBn}</span> : null}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-500">
                  {methodLabel} · {schoolLabel}
                </span>
              )}
            </div>

            {/* ---------------- Offline note ---------------- */}
            {!online && data && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/[0.08] px-3 py-2 text-[11px] font-semibold text-amber-200">
                <WifiOff className="size-3.5 shrink-0" aria-hidden />
                Offline — showing the last saved times for today.
              </div>
            )}

            {/* ---------------- Next-prayer hero ---------------- */}
            {!data ? (
              phase === 'error' ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-rose-400/25 bg-rose-500/[0.05] px-6 py-10 text-center">
                  <TriangleAlert className="size-9 text-rose-300" aria-hidden />
                  <p className="text-sm font-bold text-zinc-100">Couldn’t load prayer times</p>
                  <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                    {online
                      ? 'Aladhan.com could not be reached. Check your connection and try again.'
                      : 'You’re offline and there are no saved times for today yet.'}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                    <Button
                      onClick={refresh}
                      className="h-10 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
                    >
                      <RefreshCw className="size-4" aria-hidden /> Try again
                    </Button>
                    <button
                      onClick={() => {
                        haptic()
                        setLocOpen(true)
                      }}
                      className="flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <MapPin className="size-4" aria-hidden /> Change location
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                  <div className="flex flex-col items-center gap-5 sm:flex-row">
                    <div className="size-40 shrink-0 animate-pulse rounded-full bg-white/[0.05] sm:size-44" />
                    <div className="w-full max-w-[220px] space-y-3">
                      <div className="h-3 w-20 animate-pulse rounded-full bg-white/[0.06]" />
                      <div className="h-7 w-36 animate-pulse rounded-full bg-white/[0.08]" />
                      <div className="h-3 w-44 animate-pulse rounded-full bg-white/[0.06]" />
                      <div className="h-8 w-28 animate-pulse rounded-full bg-white/[0.06]" />
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="relative overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-b from-emerald-950/50 via-zinc-950/40 to-transparent p-5">
                <StarField />
                <div
                  className="pointer-events-none absolute -top-16 right-0 size-48 rounded-full bg-emerald-500/15 blur-3xl"
                  aria-hidden
                />
                <div className="relative flex flex-col items-center gap-5 sm:flex-row sm:gap-6">
                  {/* countdown ring */}
                  <div className="relative shrink-0">
                    <svg
                      viewBox="0 0 120 120"
                      className="size-40 -rotate-90 sm:size-44"
                      role="img"
                      aria-label={
                        nextInfo
                          ? `Progress from the previous prayer toward ${nextInfo.en}`
                          : 'Countdown to the next prayer'
                      }
                    >
                      <circle cx="60" cy="60" r={RING_R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
                      <motion.circle
                        cx="60"
                        cy="60"
                        r={RING_R}
                        fill="none"
                        stroke="url(#ptRingGrad)"
                        strokeWidth="7"
                        strokeLinecap="round"
                        strokeDasharray={RING_C}
                        initial={{ strokeDashoffset: RING_C }}
                        animate={{ strokeDashoffset: RING_C * (1 - (nextInfo?.frac ?? 0)) }}
                        transition={{ type: 'spring', stiffness: 120, damping: 30 }}
                        style={{ filter: 'drop-shadow(0 0 6px rgb(16 185 129 / 0.55))' }}
                      />
                      <defs>
                        <linearGradient id="ptRingGrad" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="#5eead4" />
                          <stop offset="55%" stopColor="#34d399" />
                          <stop offset="100%" stopColor="#16a34a" />
                        </linearGradient>
                      </defs>
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <MoonStar className="size-4 text-emerald-300/80" aria-hidden />
                      <p className="mt-1 text-[26px] font-black leading-none tracking-tight tabular-nums text-zinc-100">
                        {countText ?? '—'}
                      </p>
                      <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">left</p>
                    </div>
                  </div>

                  {/* next prayer info */}
                  <div className="min-w-0 flex-1 text-center sm:text-left">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-400/80">
                      Next prayer
                    </p>
                    <p className="mt-1 text-2xl font-black tracking-tight text-zinc-100">
                      {nextInfo?.en ?? '—'}
                      {nextInfo ? (
                        <span className="text-lg font-semibold text-zinc-500" lang="bn">
                          {' '}
                          · {nextInfo.bn}
                        </span>
                      ) : null}
                    </p>
                    <p className="mt-1 text-sm text-zinc-400">
                      in <span className="font-bold text-zinc-200 tabular-nums">{countText ?? '—'}</span>
                      {nextInfo ? <> · at {to12(nextInfo.time)}</> : null}
                    </p>
                    {nextInfo?.tomorrow && (
                      <p className="mt-1 text-[11px] text-zinc-500">Tomorrow’s Fajr — counting through the night.</p>
                    )}
                    <button
                      onClick={toggleAdhan}
                      role="switch"
                      aria-checked={Boolean(settings.adhanOn)}
                      className={cn(
                        'relative mt-3 inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-xs font-semibold transition-colors after:absolute after:-inset-1.5 after:rounded-full after:content-[""]',
                        settings.adhanOn
                          ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                          : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                      )}
                    >
                      {settings.adhanOn ? (
                        <BellRing className="size-3.5" aria-hidden />
                      ) : (
                        <Bell className="size-3.5" aria-hidden />
                      )}
                      Adhan {settings.adhanOn ? 'on' : 'off'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- Sunrise row ---------------- */}
            {data && (
              <div
                className={cn(
                  'flex items-center gap-3 rounded-2xl border border-amber-400/15 bg-amber-500/[0.06] px-4 py-3',
                  sunriseTs !== null && nowMs >= sunriseTs && 'opacity-70'
                )}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15">
                  <Sunrise className="size-5 text-amber-300" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-zinc-100">Sunrise</p>
                  <p className="text-[11px] text-zinc-500" lang="bn">
                    {SUNRISE_BN} · end of Fajr window
                  </p>
                </div>
                <p
                  className={cn(
                    'shrink-0 text-lg font-black tabular-nums',
                    sunriseTs !== null && nowMs >= sunriseTs ? 'text-zinc-500' : 'text-amber-200'
                  )}
                >
                  {to12(data.timings.Sunrise)}
                </p>
              </div>
            )}

            {/* ---------------- Prayer cards ---------------- */}
            {data && (
              <div>
                <div className="mb-2.5 flex items-baseline justify-between">
                  <p className="text-sm font-bold">Today’s schedule</p>
                  <p className="text-[11px] text-zinc-500">5 prayers · 12h clock</p>
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                  {PRAYERS.map((p) => {
                    const ts = nowDate ? timingToDate(data.timings[p.key], nowDate)?.getTime() ?? null : null
                    const isNext = nextInfo?.key === p.key
                    const isPast = ts !== null && nowMs >= ts
                    const isIsha = p.key === 'Isha'
                    return (
                      <motion.div
                        key={p.key}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                        className={cn(
                          'relative overflow-hidden rounded-2xl border p-3.5',
                          isIsha && 'max-sm:col-span-2',
                          isNext
                            ? 'border-emerald-400/50 bg-emerald-500/[0.12] shadow-[0_0_28px_-8px_rgb(16_185_129/0.55)]'
                            : 'border-white/10 bg-white/[0.03]'
                        )}
                      >
                        <div className={cn('flex h-full flex-col justify-between gap-2', isIsha && 'max-sm:flex-row max-sm:items-center')}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p.Icon
                                className={cn('size-4 shrink-0', isNext ? 'text-emerald-300' : p.tint)}
                                aria-hidden
                              />
                              <p className="text-sm font-bold text-zinc-100">{p.en}</p>
                              {isNext && (
                                <span className="ml-auto shrink-0 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
                                  Next
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-zinc-500" lang="bn">
                              {p.bn}
                            </p>
                          </div>
                          <p
                            className={cn(
                              'text-lg font-black tabular-nums',
                              isNext ? 'text-emerald-200' : isPast ? 'text-zinc-500' : 'text-zinc-100',
                              isIsha && 'max-sm:ml-auto max-sm:mt-0'
                            )}
                          >
                            {to12(data.timings[p.key])}
                          </p>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ---------------- Footer strip ---------------- */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-[11px] text-zinc-500">
              <p>
                {methodLabel} · {schoolLabel} Asr
              </p>
              <div className="flex items-center gap-2">
                {fetching ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden /> Syncing…
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    {data ? (
                      syncNote === 'live' ? (
                        <Check className="size-3.5 text-emerald-400" aria-hidden />
                      ) : (
                        <WifiOff className="size-3.5" aria-hidden />
                      )
                    ) : null}
                    {!data ? 'Waiting to sync' : syncNote === 'live' ? 'Live · Aladhan.com' : 'Saved copy'}
                  </span>
                )}
                <button
                  onClick={refresh}
                  aria-label="Refresh prayer times"
                  className="relative flex size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-white/10 hover:text-white"
                >
                  <RefreshCw className={cn('size-3.5', fetching && 'animate-spin')} aria-hidden />
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>

      {/* ---------------- Adhan banner ---------------- */}
      <AnimatePresence>
        {banner && (
          <motion.div
            key={banner.id}
            initial={{ y: -70, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -70, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
            role="alert"
            className="fixed inset-x-3 top-3 z-[70] mx-auto flex max-w-sm items-center gap-3 rounded-2xl border border-emerald-400/30 bg-zinc-950/95 p-3.5 text-zinc-100 shadow-[0_18px_50px_-12px_rgb(16_185_129/0.45)] backdrop-blur-md sm:inset-x-4"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-300 via-emerald-500 to-green-700 text-white">
              <BellRing className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">It’s time for {banner.en}</p>
              <p className="text-xs text-zinc-400" lang="bn">
                {banner.bn} · {banner.time}
              </p>
            </div>
            <button
              onClick={() => setBanner(null)}
              aria-label="Dismiss adhan reminder"
              className="relative flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-white/10 hover:text-white"
            >
              <X className="size-4" aria-hidden />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Location modal ---------------- */}
      <AnimatePresence>
        {locOpen && (
          <motion.div
            key="pt-location"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setLocOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Choose location"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className={cn(
                'max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl',
                SCROLLBAR
              )}
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
                  <MapPin className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">Location</h3>
                <button
                  onClick={() => setLocOpen(false)}
                  aria-label="Close"
                  className="relative flex size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-4">
                {/* current */}
                {settings && (
                  <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.08] p-3">
                    <MapPin className="size-4 shrink-0 text-emerald-300" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{settings.city}</p>
                      <p className="text-[11px] tabular-nums text-zinc-500">
                        {settings.lat.toFixed(3)}°, {settings.lng.toFixed(3)}°
                      </p>
                    </div>
                    <Check className="size-4 shrink-0 text-emerald-400" aria-hidden />
                  </div>
                )}

                {/* device location */}
                <Button
                  onClick={useDeviceLocation}
                  disabled={locating}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
                >
                  {locating ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <LocateFixed className="size-4" aria-hidden />
                  )}
                  {locating ? 'Locating…' : 'Use my location'}
                </Button>

                <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
                </div>

                {/* city search */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Search city</p>
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 transition-colors focus-within:border-emerald-400/50">
                    <Search className="size-4 shrink-0 text-zinc-500" aria-hidden />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Dhaka, Chittagong, Makkah…"
                      aria-label="Search city"
                      autoComplete="off"
                      className="h-11 w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                    />
                    {query && (
                      <button
                        onClick={() => setQuery('')}
                        aria-label="Clear search"
                        className="relative flex size-6 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:bg-white/10 hover:text-white"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </div>

                  {searching && (
                    <div className="mt-2 flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-zinc-500">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden /> Searching…
                    </div>
                  )}
                  {!searching && results && results.length === 0 && (
                    <p className="mt-2 rounded-xl border border-dashed border-white/10 px-3 py-3 text-center text-xs text-zinc-500">
                      No matches — try another spelling.
                    </p>
                  )}
                  {!searching && results && results.length > 0 && (
                    <div className={cn('mt-2 max-h-52 space-y-1.5 overflow-y-auto pr-1', SCROLLBAR)}>
                      {results.map((r) => (
                        <button
                          key={`${r.name}-${r.latitude}-${r.longitude}`}
                          onClick={() => {
                            applyLocation(r.latitude, r.longitude, [r.name, r.country].filter(Boolean).join(', '))
                          }}
                          className="flex min-h-[44px] w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:border-emerald-400/40 hover:bg-emerald-500/10"
                        >
                          <MapPin className="size-4 shrink-0 text-emerald-300" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-zinc-100">{r.name}</span>
                            <span className="block truncate text-[11px] text-zinc-500">
                              {[r.admin1, r.country].filter(Boolean).join(', ') ||
                                `${r.latitude.toFixed(2)}°, ${r.longitude.toFixed(2)}°`}
                            </span>
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-zinc-600">
                            {r.latitude.toFixed(1)}°, {r.longitude.toFixed(1)}°
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                  <span className="h-px flex-1 bg-white/10" /> or enter coordinates{' '}
                  <span className="h-px flex-1 bg-white/10" />
                </div>

                {/* manual coordinates */}
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={manLat}
                    onChange={(e) => setManLat(e.target.value.replace(/[^0-9.\-]/g, ''))}
                    inputMode="decimal"
                    placeholder="Latitude 23.81"
                    aria-label="Latitude"
                    className="h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-400/50 focus:outline-none"
                  />
                  <input
                    value={manLng}
                    onChange={(e) => setManLng(e.target.value.replace(/[^0-9.\-]/g, ''))}
                    inputMode="decimal"
                    placeholder="Longitude 90.41"
                    aria-label="Longitude"
                    className="h-11 rounded-xl border border-white/10 bg-white/5 px-3 text-sm tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-400/50 focus:outline-none"
                  />
                </div>
                <Button
                  onClick={saveManual}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
                >
                  <Check className="size-4" aria-hidden /> Save coordinates
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Calculation settings modal ---------------- */}
      <AnimatePresence>
        {setOpen && (
          <motion.div
            key="pt-settings"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSetOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Calculation settings"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className={cn(
                'max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl',
                SCROLLBAR
              )}
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
                  <Settings2 className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">Calculation settings</h3>
                <button
                  onClick={() => setSetOpen(false)}
                  aria-label="Close"
                  className="relative flex size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-4">
                {/* method */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Calculation method
                  </p>
                  <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Calculation method">
                    {METHODS.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => {
                          haptic()
                          changeSettings({ method: m.id })
                        }}
                        role="radio"
                        aria-checked={settings?.method === m.id}
                        className={cn(
                          'flex min-h-[52px] flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-all',
                          settings?.method === m.id
                            ? 'border-emerald-400/60 bg-emerald-500/15 shadow-md'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        )}
                      >
                        <span className="text-sm font-bold text-zinc-100">{m.label}</span>
                        <span className="text-[10px] leading-tight text-zinc-500">{m.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* school */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Asr calculation (school)
                  </p>
                  <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Asr school">
                    {SCHOOLS.map((sc) => (
                      <button
                        key={sc.id}
                        onClick={() => {
                          haptic()
                          changeSettings({ school: sc.id })
                        }}
                        role="radio"
                        aria-checked={settings?.school === sc.id}
                        className={cn(
                          'flex min-h-[52px] flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-all',
                          settings?.school === sc.id
                            ? 'border-emerald-400/60 bg-emerald-500/15 shadow-md'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        )}
                      >
                        <span className="text-sm font-bold text-zinc-100">{sc.label}</span>
                        <span className="text-[10px] leading-tight text-zinc-500">{sc.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* adhan */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-xl',
                        settings?.adhanOn ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-zinc-400'
                      )}
                    >
                      {settings?.adhanOn ? <BellRing className="size-5" aria-hidden /> : <Bell className="size-5" aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold">Adhan reminder</p>
                      <p className="text-[11px] leading-snug text-zinc-500">
                        Gentle chime + vibration when a prayer time arrives while the app is open.
                      </p>
                    </div>
                    <GlassSwitch checked={Boolean(settings?.adhanOn)} onChange={toggleAdhan} label="Adhan reminder" />
                  </div>
                  {settings?.adhanOn && (
                    <div className="mt-3 space-y-2.5 border-t border-white/5 pt-3">
                      <p className="text-[11px] leading-snug text-zinc-500">
                        {notifPerm === 'granted'
                          ? 'Browser notifications are on — you’ll get an alert even in a background tab.'
                          : notifPerm === 'denied'
                            ? 'Browser notifications are blocked; the in-app chime still works.'
                            : notifPerm === 'unsupported'
                              ? 'Browser notifications unavailable; the in-app chime still works.'
                              : 'Allow browser notifications if prompted for alerts outside the app.'}
                      </p>
                      <button
                        onClick={() => {
                          haptic()
                          playAdhanChime()
                        }}
                        className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <Volume2 className="size-3.5" aria-hidden /> Preview chime
                      </button>
                    </div>
                  )}
                </div>

                <p className="text-[10px] leading-relaxed text-zinc-600">
                  Fajr &amp; Isha angles and the Asr shadow factor come from the selected method. Times by
                  Aladhan.com; the last schedule is cached on this device for offline use.
                </p>

                <Button
                  onClick={() => {
                    haptic()
                    setSetOpen(false)
                  }}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
                >
                  Done
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ================================================================== */
/* Geocoding types + post-Isha helper                                   */
/* ================================================================== */

interface GeoResult {
  name: string
  latitude: number
  longitude: number
  admin1?: string
  country?: string
}

interface GeoResponse {
  results?: GeoResult[]
}
