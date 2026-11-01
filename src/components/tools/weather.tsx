'use client'

/**
 * Weather v2 — your sky, saved on device.
 *
 * Multiple saved places (chips + add via city search, remove via edit toggle
 * or long-press), an active place persisted in IndexedDB, a dynamic hero
 * backdrop that shifts with condition + day/night, next-24-hour strip and
 * temperature line chart, 7-day max/min area chart + day cards, and a full
 * details grid (feels-like, humidity, wind + direction, pressure, UV,
 * sunrise/sunset, precip chance). Data comes from the key-free Open-Meteo
 * API; the last successful payload per place is cached in IndexedDB
 * ('toolhub-weather') and rendered instantly on open — offline last-known
 * state — with a silent background refresh when stale.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Gauge,
  Loader2,
  LocateFixed,
  MapPin,
  Moon,
  Navigation2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Sunrise,
  Sunset,
  Thermometer,
  Umbrella,
  WifiOff,
  Wind,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* API types (Open-Meteo — free, no key)                               */
/* ================================================================== */

interface GeoPlace {
  id: number
  name: string
  latitude: number
  longitude: number
  country?: string
  admin1?: string
}

interface GeoResponse {
  results?: GeoPlace[]
}

interface CurrentWeather {
  time: string
  temperature_2m: number
  relative_humidity_2m: number
  apparent_temperature: number
  is_day: number
  weather_code: number
  wind_speed_10m: number
  wind_direction_10m: number
  surface_pressure: number
}

interface HourlyWeather {
  time: string[]
  temperature_2m: number[]
  precipitation_probability: Array<number | null>
  weather_code: number[]
  uv_index: Array<number | null>
}

interface DailyWeather {
  time: string[]
  weather_code: number[]
  temperature_2m_max: number[]
  temperature_2m_min: number[]
  sunrise: string[]
  sunset: string[]
  uv_index_max: Array<number | null>
  wind_speed_10m_max: Array<number | null>
  precipitation_probability_max: Array<number | null>
}

interface ForecastResponse {
  timezone?: string
  current: CurrentWeather
  hourly: HourlyWeather
  daily: DailyWeather
}

/* ================================================================== */
/* On-device model                                                     */
/* ================================================================== */

interface SavedLocation {
  id: string
  name: string
  admin1?: string
  country?: string
  lat: number
  lon: number
  /** true → derived from the device's GPS position */
  device?: boolean
}

interface CacheRow {
  locationId: string
  data: ForecastResponse
  fetchedAt: number
}

interface SettingRow {
  key: string
  value: unknown
}

/** Shape of the pre-v2 localStorage 'weather-cache' payload (for migration). */
interface LegacyCache {
  placeName: string
  admin1?: string
  country?: string
  lat: number
  lon: number
  data: ForecastResponse
  fetchedAt: number
}

type Unit = 'c' | 'f'
type Cond = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'

interface HourPoint {
  key: string
  label: string
  temp: number
  precip: number
  isNow: boolean
  isDay: boolean
  bucket: Cond
  Icon: LucideIcon
}

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const DB_NAME = 'toolhub-weather'
const DB_VERSION = 1
const LOC_STORE = 'locations'
const CACHE_STORE = 'cache'
const SET_STORE = 'settings'

const LEGACY_CACHE_KEY = 'weather-cache'
const LEGACY_UNIT_KEY = 'weather-unit'

/** Refresh the cached forecast in the background when older than 10 min. */
const CACHE_REFRESH_MS = 10 * 60 * 1000

const DEVICE_ID = 'device'

/** Dynamic hero backdrops — gradient shifts by condition + day/night. */
const BACKDROPS: Record<Cond, { day: string; night: string }> = {
  clear: {
    day: 'from-amber-300 via-sky-400 to-cyan-500',
    night: 'from-slate-800 via-slate-900 to-zinc-950',
  },
  partly: {
    day: 'from-sky-300 via-cyan-500 to-sky-700',
    night: 'from-slate-700 via-slate-800 to-zinc-900',
  },
  cloudy: {
    day: 'from-zinc-400 via-slate-500 to-slate-700',
    night: 'from-slate-700 via-zinc-800 to-zinc-950',
  },
  fog: {
    day: 'from-zinc-300 via-zinc-400 to-slate-500',
    night: 'from-zinc-600 via-slate-700 to-zinc-900',
  },
  drizzle: {
    day: 'from-slate-400 via-slate-500 to-cyan-800',
    night: 'from-slate-600 via-slate-700 to-zinc-900',
  },
  rain: {
    day: 'from-slate-500 via-slate-600 to-zinc-800',
    night: 'from-slate-700 via-slate-800 to-zinc-950',
  },
  snow: {
    day: 'from-cyan-200 via-sky-300 to-slate-400',
    night: 'from-cyan-900 via-slate-800 to-zinc-950',
  },
  storm: {
    day: 'from-zinc-600 via-slate-800 to-zinc-950',
    night: 'from-zinc-800 via-zinc-900 to-black',
  },
}

const EMPTY_BACKDROP = 'from-cyan-300 via-cyan-500 to-sky-600'

const TOOLTIP_STYLE = {
  background: 'rgba(9,9,11,0.95)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  fontSize: 12,
  color: '#e4e4e7',
  padding: '8px 10px',
} as const

const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

const WIND_DIRS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
]

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function haptic(): void {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* not supported — ignore */
  }
}

function validForecast(d: unknown): d is ForecastResponse {
  if (!d || typeof d !== 'object') return false
  const f = d as Partial<ForecastResponse>
  return Boolean(
    f.current &&
      f.current.temperature_2m !== undefined &&
      f.daily &&
      Array.isArray(f.daily.time) &&
      f.daily.time.length > 0 &&
      f.hourly &&
      Array.isArray(f.hourly.time) &&
      f.hourly.time.length > 0
  )
}

function readLegacyCache(): LegacyCache | null {
  try {
    const raw = localStorage.getItem(LEGACY_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LegacyCache
    if (
      !parsed ||
      typeof parsed.lat !== 'number' ||
      typeof parsed.lon !== 'number' ||
      typeof parsed.fetchedAt !== 'number'
    ) {
      return null
    }
    /* payload itself may be v1-shaped (no hourly) — the caller decides whether
       to import the forecast row or just the location */
    return parsed
  } catch {
    return null
  }
}

function describeWeather(code: number, isDay: boolean): { label: string; Icon: LucideIcon; bucket: Cond } {
  if (code === 0) return { label: 'Clear sky', Icon: isDay ? Sun : Moon, bucket: 'clear' }
  if (code === 1) return { label: 'Mainly clear', Icon: isDay ? CloudSun : CloudMoon, bucket: 'partly' }
  if (code === 2) return { label: 'Partly cloudy', Icon: CloudSun, bucket: 'partly' }
  if (code === 3) return { label: 'Overcast', Icon: Cloud, bucket: 'cloudy' }
  if (code === 45 || code === 48) return { label: 'Fog', Icon: CloudFog, bucket: 'fog' }
  if (code >= 51 && code <= 57) return { label: 'Drizzle', Icon: CloudDrizzle, bucket: 'drizzle' }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82))
    return { label: 'Rain', Icon: CloudRain, bucket: 'rain' }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { label: 'Snow', Icon: CloudSnow, bucket: 'snow' }
  if (code >= 95) return { label: 'Thunderstorm', Icon: CloudLightning, bucket: 'storm' }
  return { label: 'Cloudy', Icon: Cloud, bucket: 'cloudy' }
}

function backdropFor(bucket: Cond, isDay: boolean): string {
  const v = BACKDROPS[bucket]
  return isDay ? v.day : v.night
}

function toUnit(celsius: number, unit: Unit): number {
  return unit === 'c' ? celsius : celsius * (9 / 5) + 32
}

function weekdayShort(isoDate: string): string {
  // noon anchor avoids timezone-induced date shifts
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
  })
}

/** '2025-01-01T14:00' (location-local, no TZ suffix) → '2 PM'. */
function hourLabel(isoHour: string): string {
  const h = Number(isoHour.slice(11, 13))
  if (Number.isNaN(h)) return '—'
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12} ${ampm}`
}

/** '2025-01-01T06:41' → '6:41 AM'. */
function clockLabel(iso?: string): string {
  if (!iso || iso.length < 16) return '—'
  const h = Number(iso.slice(11, 13))
  const m = iso.slice(14, 16)
  if (Number.isNaN(h) || !/^\d{2}$/.test(m)) return '—'
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${ampm}`
}

function compass(deg: number): string {
  const d = ((deg % 360) + 360) % 360
  return WIND_DIRS[Math.round(d / 22.5) % 16]
}

function uvLabel(u: number): string {
  if (u < 3) return 'Low'
  if (u < 6) return 'Moderate'
  if (u < 8) return 'High'
  if (u < 11) return 'Very high'
  return 'Extreme'
}

function timeAgo(ts: number, now: number): string {
  const diff = Math.max(0, now - ts)
  if (diff < 45_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function forecastUrl(lat: number, lon: number): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure' +
    '&hourly=temperature_2m,precipitation_probability,weather_code,uv_index' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,wind_speed_10m_max,precipitation_probability_max' +
    '&timezone=auto&forecast_days=7'
  )
}

function hourIconTint(bucket: Cond, isDay: boolean): string {
  switch (bucket) {
    case 'clear':
      return isDay ? 'text-amber-300' : 'text-zinc-200'
    case 'partly':
      return 'text-sky-300'
    case 'drizzle':
    case 'rain':
      return 'text-sky-300'
    case 'snow':
      return 'text-cyan-200'
    case 'storm':
      return 'text-violet-300'
    case 'fog':
      return 'text-zinc-400'
    default:
      return 'text-zinc-300'
  }
}

/* ================================================================== */
/* IndexedDB — toolhub-weather (locations + per-place cache + settings) */
/* ================================================================== */

let dbPromise: Promise<IDBDatabase> | null = null

function openWeatherDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(LOC_STORE)) d.createObjectStore(LOC_STORE, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(CACHE_STORE))
        d.createObjectStore(CACHE_STORE, { keyPath: 'locationId' })
      if (!d.objectStoreNames.contains(SET_STORE)) d.createObjectStore(SET_STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openWeatherDb()
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

/* ================================================================== */
/* Small presentational pieces                                         */
/* ================================================================== */

function DetailCell({
  icon: Icon,
  label,
  value,
  sub,
  extra,
}: {
  icon: LucideIcon
  label: string
  value: string
  sub?: string
  extra?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/5 bg-zinc-900/60 px-3 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-300">
        <Icon className="size-4.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] leading-tight text-zinc-500">{label}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold tabular-nums text-zinc-100">
          <span className="truncate">{value}</span>
          {extra && <span className="shrink-0 text-xs font-medium text-zinc-400">{extra}</span>}
        </p>
        {sub && <p className="text-[10px] leading-tight text-zinc-500">{sub}</p>}
      </div>
    </div>
  )
}

/* ================================================================== */
/* WeatherTool — default export                                        */
/* ================================================================== */

export default function WeatherTool() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [booted, setBooted] = useState(false)
  const [locations, setLocations] = useState<SavedLocation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [cacheMap, setCacheMap] = useState<Record<string, { data: ForecastResponse; fetchedAt: number }>>({})
  const [unit, setUnit] = useState<Unit>('c')

  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoPlace[] | null>(null)
  const [searching, setSearching] = useState(false)

  const [editMode, setEditMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [offline, setOffline] = useState(false)
  const [geoPerm, setGeoPerm] = useState<'granted' | 'prompt' | 'denied' | 'unsupported'>('prompt')
  const [now, setNow] = useState(0)

  /* ---------------- refs ---------------- */
  const reqRef = useRef(0)
  const activeIdRef = useRef<string | null>(null)
  const locationsRef = useRef<SavedLocation[]>([])
  const cacheMapRef = useRef(cacheMap)
  const pressTimerRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    locationsRef.current = locations
    cacheMapRef.current = cacheMap
  }, [locations, cacheMap])

  /* ---------------- data fetch (write-through cache) ---------------- */

  const fetchForecast = useCallback(async (loc: SavedLocation, opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false
    const token = ++reqRef.current
    if (!silent) {
      setLoading(true)
      setRefreshing(false)
    } else {
      setRefreshing(true)
    }
    setError(null)

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      if (reqRef.current === token) {
        setLoading(false)
        setRefreshing(false)
        setOffline(true)
        if (cacheMapRef.current[loc.id]) setStale(true)
        else setError('You are offline. Reconnect to the internet or open a saved place with a cached forecast.')
      }
      return
    }

    try {
      const res = await fetch(forecastUrl(loc.lat, loc.lon))
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as ForecastResponse
      if (!validForecast(json)) throw new Error('Malformed forecast payload')

      // write-through: cache per place, even if the user already switched away
      const stillExists = locationsRef.current.some((l) => l.id === loc.id)
      const fetchedAt = Date.now()
      if (stillExists) {
        setCacheMap((prev) => ({ ...prev, [loc.id]: { data: json, fetchedAt } }))
        void idbPut(CACHE_STORE, { locationId: loc.id, data: json, fetchedAt } satisfies CacheRow).catch(() => {})
      }

      if (reqRef.current === token) {
        setLoading(false)
        setRefreshing(false)
        setStale(false)
        setOffline(false)
      }
    } catch {
      if (reqRef.current === token) {
        setLoading(false)
        setRefreshing(false)
        if (silent && cacheMapRef.current[loc.id]) {
          setStale(true)
        } else {
          setError('Could not load the forecast. Check your connection and try again.')
        }
      }
    }
  }, [])

  /* ---------------- activation ---------------- */

  const activate = useCallback(
    (loc: SavedLocation) => {
      haptic()
      setActiveId(loc.id)
      activeIdRef.current = loc.id
      setStale(false)
      setError(null)
      void idbPut(SET_STORE, { key: 'activeLocationId', value: loc.id } satisfies SettingRow).catch(() => {})

      const cached = cacheMapRef.current[loc.id]
      if (!cached) setLoading(true)
      if (!cached || Date.now() - cached.fetchedAt > CACHE_REFRESH_MS) {
        void fetchForecast(loc, { silent: Boolean(cached) })
      }
    },
    [fetchForecast]
  )

  /* ---------------- boot: restore from IndexedDB + migrate legacy ---------------- */

  useEffect(() => {
    void (async () => {
      try {
        const [locs, cacheRows, settingRows] = await Promise.all([
          idbGetAll<SavedLocation>(LOC_STORE),
          idbGetAll<CacheRow>(CACHE_STORE),
          idbGetAll<SettingRow>(SET_STORE),
        ])

        /* unit preference (IDB, fallback to legacy localStorage) */
        let nextUnit: Unit | undefined
        for (const row of settingRows) {
          if (row.key === 'unit' && (row.value === 'c' || row.value === 'f')) nextUnit = row.value
        }
        if (!nextUnit) {
          try {
            if (localStorage.getItem(LEGACY_UNIT_KEY) === 'f') nextUnit = 'f'
          } catch {
            /* storage unavailable */
          }
        }
        setUnit(nextUnit ?? 'c')
        if (nextUnit && !settingRows.some((r) => r.key === 'unit')) {
          void idbPut(SET_STORE, { key: 'unit', value: nextUnit } satisfies SettingRow).catch(() => {})
        }

        /* one-time migration from the v1 localStorage cache */
        const migrated = settingRows.some((r) => r.key === 'legacyMigrated' && r.value === true)
        let locs2 = locs.filter((l) => l && typeof l.lat === 'number' && typeof l.lon === 'number')
        const cacheRows2 = cacheRows.filter((r) => r && validForecast(r.data) && typeof r.fetchedAt === 'number')

        if (!migrated) {
          const legacy = readLegacyCache()
          const legacyId = legacy ? `m-${legacy.lat},${legacy.lon}` : null
          if (legacy && legacyId && !locs2.some((l) => l.id === legacyId)) {
            const loc: SavedLocation = {
              id: legacyId,
              name: legacy.placeName || 'Saved place',
              admin1: legacy.admin1,
              country: legacy.country,
              lat: legacy.lat,
              lon: legacy.lon,
            }
            locs2 = [...locs2, loc]
            void idbPut(LOC_STORE, loc).catch(() => {})
            /* import the cached payload only when it already has the v2 hourly shape */
            if (validForecast(legacy.data)) {
              cacheRows2.push({ locationId: legacyId, data: legacy.data, fetchedAt: legacy.fetchedAt })
              void idbPut(CACHE_STORE, {
                locationId: legacyId,
                data: legacy.data,
                fetchedAt: legacy.fetchedAt,
              } satisfies CacheRow).catch(() => {})
            }
          }
          void idbPut(SET_STORE, { key: 'legacyMigrated', value: true } satisfies SettingRow).catch(() => {})
          try {
            localStorage.removeItem(LEGACY_CACHE_KEY)
          } catch {
            /* storage unavailable */
          }
        }

        setLocations(locs2)
        setCacheMap(Object.fromEntries(cacheRows2.map((r) => [r.locationId, { data: r.data, fetchedAt: r.fetchedAt }])))

        /* active place (persisted preference, fallback first place) */
        let active: string | null = null
        for (const row of settingRows) {
          if (row.key === 'activeLocationId' && typeof row.value === 'string') active = row.value
        }
        if (!active || !locs2.some((l) => l.id === active)) active = locs2[0]?.id ?? null

        if (active) {
          setActiveId(active)
          activeIdRef.current = active
          const loc = locs2.find((l) => l.id === active)
          const cached = cacheRows2.find((r) => r.locationId === active)
          if (loc) {
            if (!cached) {
              setLoading(true)
              void fetchForecast(loc)
            } else if (Date.now() - cached.fetchedAt > CACHE_REFRESH_MS) {
              void fetchForecast(loc, { silent: true })
            }
          }
        }

        setOffline(typeof navigator !== 'undefined' && !navigator.onLine)
      } catch {
        /* IndexedDB unavailable — app still works, just without persistence */
      } finally {
        setBooted(true)
      }
    })()
  }, [fetchForecast])

  /* ---------------- debounced city search (400 ms) ---------------- */

  useEffect(() => {
    const q = query.trim()
    let cancelled = false

    if (q.length < 2) {
      const t = setTimeout(() => {
        if (cancelled) return
        setResults(null)
        setSearching(false)
      }, 0)
      return () => {
        cancelled = true
        clearTimeout(t)
      }
    }

    const t = setTimeout(() => {
      void (async () => {
        if (cancelled) return
        setSearching(true)
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
      clearTimeout(t)
    }
  }, [query])

  /* ---------------- geolocation permission probe (never blocks) ---------------- */

  useEffect(() => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      setGeoPerm('unsupported')
      return
    }
    try {
      if (!navigator.permissions?.query) return
      navigator.permissions
        .query({ name: 'geolocation' as PermissionName })
        .then((status) => {
          setGeoPerm(status.state as 'granted' | 'prompt' | 'denied')
          status.onchange = () => setGeoPerm(status.state as 'granted' | 'prompt' | 'denied')
        })
        .catch(() => {
          /* Firefox/Safari quirks — stay on 'prompt' */
        })
    } catch {
      /* unsupported — stay on 'prompt' */
    }
  }, [])

  /* ---------------- "updated X ago" ticker ---------------- */

  useEffect(() => {
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  /* ---------------- auto-retry when back online ---------------- */

  useEffect(() => {
    const goOnline = () => {
      setOffline(false)
      const loc = locationsRef.current.find((l) => l.id === activeIdRef.current)
      if (loc && (!cacheMapRef.current[loc.id] || staleNow())) {
        void fetchForecast(loc, { silent: Boolean(cacheMapRef.current[loc.id]) })
      }
    }
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }

    function staleNow(): boolean {
      const loc = locationsRef.current.find((l) => l.id === activeIdRef.current)
      if (!loc) return false
      const c = cacheMapRef.current[loc.id]
      return Boolean(c && Date.now() - c.fetchedAt > CACHE_REFRESH_MS)
    }
  }, [fetchForecast])

  /* ---------------- auto-open search when nothing is saved ---------------- */

  useEffect(() => {
    if (booted && locations.length === 0) setSearchOpen(true)
  }, [booted, locations.length])

  /* ---------------- actions ---------------- */

  const openSearch = () => {
    haptic()
    setSearchOpen(true)
    setTimeout(() => searchInputRef.current?.focus(), 220)
  }

  const chooseUnit = (u: Unit) => {
    if (u === unit) return
    haptic()
    setUnit(u)
    void idbPut(SET_STORE, { key: 'unit', value: u } satisfies SettingRow).catch(() => {})
  }

  const addLocation = (p: GeoPlace) => {
    haptic()
    const id = `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`
    const existing = locations.find((l) => l.id === id)
    if (!existing) {
      const loc: SavedLocation = {
        id,
        name: p.name,
        admin1: p.admin1,
        country: p.country,
        lat: p.latitude,
        lon: p.longitude,
      }
      setLocations((prev) => [...prev, loc])
      void idbPut(LOC_STORE, loc).catch(() => {})
      setQuery('')
      setResults(null)
      setSearchOpen(false)
      setEditMode(false)
      activate(loc)
      toast({ title: 'Place saved', description: `${loc.name} added to your places.` })
    } else {
      setQuery('')
      setResults(null)
      setSearchOpen(false)
      activate(existing)
    }
  }

  const removeLocation = (id: string) => {
    haptic()
    const loc = locations.find((l) => l.id === id)
    const rest = locations.filter((l) => l.id !== id)
    setLocations(rest)
    setEditMode(rest.length > 0 ? editMode : false)
    void idbDelete(LOC_STORE, id).catch(() => {})
    void idbDelete(CACHE_STORE, id).catch(() => {})
    setCacheMap((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (activeIdRef.current === id) {
      const next = rest[0] ?? null
      if (next) {
        activate(next)
      } else {
        setActiveId(null)
        activeIdRef.current = null
        setLoading(false)
        setRefreshing(false)
        setError(null)
        setStale(false)
        void idbDelete(SET_STORE, 'activeLocationId').catch(() => {})
      }
    }
    toast({ title: 'Place removed', description: `${loc?.name ?? 'Location'} was removed.` })
  }

  const useDeviceLocation = () => {
    haptic()
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      toast({
        title: 'Location unavailable',
        description: 'This device does not support location services. Search for your city instead.',
      })
      openSearch()
      return
    }

    const existing = locations.find((l) => l.device)
    if (existing) {
      activate(existing)
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocating(false)
        const { latitude, longitude } = pos.coords

        /* best-effort reverse geocode so the chip shows a real city name */
        let name = 'My Location'
        let admin1: string | undefined
        let country: string | undefined
        try {
          const ac = new AbortController()
          const timer = setTimeout(() => ac.abort(), 3500)
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`,
            { signal: ac.signal }
          )
          clearTimeout(timer)
          if (res.ok) {
            const j = (await res.json()) as {
              city?: string
              locality?: string
              principalSubdivision?: string
              countryName?: string
            }
            name = j.city || j.locality || j.principalSubdivision || 'My Location'
            admin1 = j.principalSubdivision || undefined
            country = j.countryName || undefined
          }
        } catch {
          /* reverse geocode is best-effort only */
        }

        const loc: SavedLocation = {
          id: DEVICE_ID,
          name,
          admin1,
          country,
          lat: latitude,
          lon: longitude,
          device: true,
        }
        setLocations((prev) => (prev.some((l) => l.device) ? prev.map((l) => (l.device ? loc : l)) : [...prev, loc]))
        void idbPut(LOC_STORE, loc).catch(() => {})
        setQuery('')
        setResults(null)
        setSearchOpen(false)
        activate(loc)
        toast({ title: 'Location added', description: `${name} — using your current position.` })
      },
      () => {
        setLocating(false)
        toast({
          title: 'Location unavailable',
          description: 'Permission was denied or timed out — search for your city instead.',
        })
        openSearch()
      },
      { timeout: 10_000, maximumAge: 300_000 }
    )
  }

  /* ---------------- long-press on chips → edit mode ---------------- */

  const startPress = () => {
    stopPress()
    pressTimerRef.current = window.setTimeout(() => {
      pressTimerRef.current = null
      suppressClickRef.current = true
      haptic()
      setEditMode(true)
    }, 550)
  }

  const stopPress = () => {
    if (pressTimerRef.current !== null) {
      clearTimeout(pressTimerRef.current)
      pressTimerRef.current = null
    }
  }

  const onChipClick = (loc: SavedLocation) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    activate(loc)
  }

  /* ---------------- derived: active place + data ---------------- */

  const activeLoc = useMemo(() => locations.find((l) => l.id === activeId) ?? null, [locations, activeId])
  const cache = activeId ? cacheMap[activeId] ?? null : null
  const data = cache?.data ?? null
  const current = data?.current ?? null
  const daily = data?.daily ?? null
  const headline = current ? describeWeather(current.weather_code, current.is_day === 1) : null
  const isDay = current ? current.is_day === 1 : true

  const backdrop = headline ? backdropFor(headline.bucket, isDay) : EMPTY_BACKDROP
  const backdropKey = headline ? `${headline.bucket}-${isDay ? 'd' : 'n'}` : 'empty'

  const region = activeLoc ? [activeLoc.admin1, activeLoc.country].filter(Boolean).join(', ') : ''
  const hasDeviceLoc = locations.some((l) => l.device)

  /* next 24 hours starting at the location's current hour */
  const hours = useMemo<HourPoint[]>(() => {
    if (!data || !data.hourly?.time?.length) return []
    const { hourly, current: cur, daily: dl } = data
    const nowKey = (cur.time ?? '').slice(0, 13)
    let idx = hourly.time.findIndex((t) => t.slice(0, 13) >= nowKey)
    if (idx < 0) idx = 0
    return hourly.time.slice(idx, idx + 24).map((t, k) => {
      const i = idx + k
      const dayIdx = dl.time.indexOf(t.slice(0, 10))
      const sunrise = dayIdx >= 0 ? dl.sunrise[dayIdx] : undefined
      const sunset = dayIdx >= 0 ? dl.sunset[dayIdx] : undefined
      const isDayHour = sunrise && sunset ? t >= sunrise && t <= sunset : true
      const code = hourly.weather_code[i] ?? 0
      const desc = describeWeather(code, isDayHour)
      return {
        key: t,
        label: hourLabel(t),
        temp: Math.round(toUnit(hourly.temperature_2m[i] ?? 0, unit)),
        precip: hourly.precipitation_probability?.[i] ?? 0,
        isNow: k === 0,
        isDay: isDayHour,
        bucket: desc.bucket,
        Icon: desc.Icon,
      }
    })
  }, [data, unit])

  const hourlyChartData = useMemo(
    () => hours.map((h) => ({ h: h.isNow ? 'Now' : h.label, temp: h.temp })),
    [hours]
  )

  const dailyChartData = useMemo(() => {
    if (!daily?.time?.length) return []
    return daily.time.map((iso, i) => ({
      day: i === 0 ? 'Today' : weekdayShort(iso),
      max: Math.round(toUnit(daily.temperature_2m_max[i] ?? 0, unit)),
      min: Math.round(toUnit(daily.temperature_2m_min[i] ?? 0, unit)),
    }))
  }, [daily, unit])

  const uvNow = useMemo<number | null>(() => {
    if (!data) return null
    const hv = data.hourly?.uv_index
    if (hv?.length) {
      const nowKey = (data.current.time ?? '').slice(0, 13)
      const idx = data.hourly.time.findIndex((t) => t.slice(0, 13) >= nowKey)
      const v = hv[idx >= 0 ? idx : 0]
      if (typeof v === 'number') return Math.round(v)
    }
    const dmax = data.daily?.uv_index_max?.[0]
    return typeof dmax === 'number' ? Math.round(dmax) : null
  }, [data])

  /* ---------------- loading skeleton ---------------- */

  if (!booted) {
    return (
      <div className="mx-auto max-w-2xl" aria-busy="true" aria-label="Loading weather">
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]">
          <div className="min-h-[13rem] animate-pulse bg-gradient-to-br from-cyan-500/10 via-transparent to-sky-600/10" />
          <div className="space-y-4 px-5 py-5">
            <div className="h-11 animate-pulse rounded-full bg-white/[0.06]" />
            <div className="h-28 animate-pulse rounded-2xl bg-white/[0.06]" />
            <div className="h-48 animate-pulse rounded-2xl bg-white/[0.06]" />
          </div>
        </div>
      </div>
    )
  }

  /* ---------------- render ---------------- */

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ============ Dynamic hero ============ */}
        <section className="relative overflow-hidden" aria-label="Current conditions">
          {/* condition + day/night backdrop (crossfades between states) */}
          <AnimatePresence initial={false}>
            <motion.div
              key={backdropKey}
              aria-hidden
              className={cn('absolute inset-0 bg-gradient-to-br', backdrop)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.7, ease: 'easeInOut' }}
            />
          </AnimatePresence>
          {/* readability scrim — keeps text legible even on pale (snow) backdrops */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-black/25 to-black/55"
          />
          {headline && (
            <headline.Icon
              aria-hidden
              className="pointer-events-none absolute -bottom-10 -right-8 size-44 rotate-12 text-white/10"
            />
          )}

          <div className="relative px-5 pb-5 pt-5">
            {/* brand row + refresh */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-cyan-300 via-cyan-500 to-sky-600 text-white ring-1 ring-white/25 shadow-[inset_0_1px_1px_rgb(255_255_255/0.4)]">
                  <CloudSun className="size-4.5" aria-hidden />
                  <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold leading-tight">Weather</p>
                  <p className="text-[10px] leading-tight text-white/60">Live · saved on device</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => activeLoc && void fetchForecast(activeLoc)}
                disabled={refreshing || !activeLoc}
                aria-label="Refresh forecast"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-white/25 disabled:opacity-50"
              >
                <RefreshCw className={cn('size-4.5', refreshing && 'animate-spin')} aria-hidden />
              </button>
            </div>

            {/* current conditions or empty prompt */}
            {activeLoc && current ? (
              <motion.div
                key={`${activeLoc.id}-${unit}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 26 }}
              >
                <p className="mt-4 flex min-w-0 items-center gap-1.5 text-sm font-medium text-white/90">
                  <MapPin className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{activeLoc.name}</span>
                  {region && <span className="truncate text-xs font-normal text-white/60">· {region}</span>}
                </p>
                <div className="mt-1 flex flex-wrap items-end gap-x-3 gap-y-1">
                  <span
                    className="text-7xl font-bold leading-none tracking-tighter tabular-nums drop-shadow-sm"
                    aria-label={`Current temperature ${Math.round(toUnit(current.temperature_2m, unit))} degrees ${unit === 'c' ? 'Celsius' : 'Fahrenheit'}`}
                  >
                    {Math.round(toUnit(current.temperature_2m, unit))}°
                  </span>
                  <div className="pb-1.5">
                    {headline && (
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        <headline.Icon className="size-4.5" aria-hidden />
                        {headline.label}
                      </p>
                    )}
                    {daily && (
                      <p className="mt-0.5 text-xs text-white/75">
                        H {Math.round(toUnit(daily.temperature_2m_max[0] ?? 0, unit))}° · L{' '}
                        {Math.round(toUnit(daily.temperature_2m_min[0] ?? 0, unit))}°
                      </p>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : activeLoc && loading ? (
              <div className="mt-5 space-y-3" aria-hidden>
                <div className="h-4 w-28 animate-pulse rounded bg-white/20" />
                <div className="h-14 w-44 animate-pulse rounded-xl bg-white/15" />
              </div>
            ) : !activeLoc ? (
              <div className="mt-5">
                <p className="text-2xl font-bold drop-shadow-sm">What&rsquo;s the sky doing?</p>
                <p className="mt-1 max-w-sm text-xs leading-relaxed text-white/80">
                  Add a city or use your current location to see live conditions, hourly detail and a
                  7-day outlook — all saved on device.
                </p>
                <button
                  type="button"
                  onClick={openSearch}
                  className="mt-4 flex h-11 items-center gap-2 rounded-xl bg-white px-5 text-sm font-bold text-zinc-900 shadow-lg transition-colors hover:bg-zinc-100"
                >
                  <Plus className="size-4" aria-hidden /> Add a city
                </button>
              </div>
            ) : null}

            {/* updated-at + unit toggle */}
            <div className="mt-5 flex items-center justify-between gap-3">
              <p aria-live="polite" className="min-w-0 flex-1 text-[11px] text-white/75">
                {offline ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 font-medium text-amber-100">
                    <WifiOff className="size-3" aria-hidden /> Offline · showing saved forecast
                  </span>
                ) : stale ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 font-medium text-amber-100">
                    <WifiOff className="size-3" aria-hidden /> Saved · refresh failed
                  </span>
                ) : cache ? (
                  `Updated ${timeAgo(cache.fetchedAt, now)}`
                ) : (
                  ''
                )}
              </p>
              <div
                className="flex shrink-0 rounded-full bg-white/15 p-0.5 ring-1 ring-white/25 backdrop-blur"
                role="group"
                aria-label="Temperature unit"
              >
                {(['c', 'f'] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => chooseUnit(u)}
                    aria-pressed={unit === u}
                    className={cn(
                      'h-11 min-w-11 rounded-full text-xs font-bold transition-colors',
                      unit === u ? 'bg-white text-zinc-900 shadow' : 'text-white/80 hover:text-white'
                    )}
                  >
                    {u === 'c' ? '°C' : '°F'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ Search panel ============ */}
        <AnimatePresence initial={false}>
          {searchOpen && (
            <motion.div
              key="search"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
              className="overflow-hidden border-b border-white/5 bg-white/[0.03]"
            >
              <div className="px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Add a place
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearchOpen(false)}
                    aria-label="Close search"
                    className="flex size-11 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <X className="size-4.5" aria-hidden />
                  </button>
                </div>

                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search
                      className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
                      aria-hidden
                    />
                    <Input
                      ref={searchInputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search any city…"
                      className="h-11 border-white/10 bg-white/[0.04] pl-9 text-zinc-100 placeholder:text-zinc-500 focus-visible:border-cyan-400/50 focus-visible:ring-cyan-400/30"
                      aria-label="Search for a city"
                      autoComplete="off"
                      enterKeyHint="search"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={useDeviceLocation}
                    disabled={locating}
                    className="flex h-11 shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/10 disabled:opacity-60"
                    aria-label="Use my current location"
                  >
                    {locating ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <LocateFixed className="size-4" aria-hidden />
                    )}
                    <span className="hidden sm:inline">My Location</span>
                  </button>
                </div>

                {searching && (
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-zinc-500">
                    <Loader2 className="size-3 animate-spin" aria-hidden />
                    Searching cities…
                  </p>
                )}

                {!searching && results !== null && results.length === 0 && query.trim().length >= 2 && (
                  <p className="mt-3 text-xs text-zinc-500">No cities found for “{query.trim()}”.</p>
                )}

                {results !== null && results.length > 0 && (
                  <motion.ul
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      'mt-3 max-h-64 divide-y divide-white/5 overflow-y-auto rounded-xl border border-white/10 bg-zinc-900/80 backdrop-blur',
                      THIN_SCROLLBAR
                    )}
                    aria-label="City search results"
                  >
                    {results.map((r) => (
                      <li key={`${r.id}-${r.latitude}-${r.longitude}`}>
                        <button
                          type="button"
                          className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none"
                          onClick={() => addLocation(r)}
                        >
                          <MapPin
                            className="mt-0.5 size-4 shrink-0 text-zinc-500"
                            aria-hidden
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-zinc-100">
                              {r.name}
                            </span>
                            <span className="block truncate text-xs text-zinc-500">
                              {[r.admin1, r.country].filter(Boolean).join(', ')}
                            </span>
                          </span>
                          <Plus className="ml-auto mt-1 size-4 shrink-0 text-zinc-600" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ============ Saved places chips ============ */}
        <section aria-label="Saved locations" className="border-b border-white/5 px-5 py-4">
          <div className="mb-2.5 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              My places{locations.length > 0 ? ` · ${locations.length}` : ''}
            </p>
            {locations.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  haptic()
                  setEditMode((v) => !v)
                }}
                aria-pressed={editMode}
                className={cn(
                  'flex h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-colors',
                  editMode
                    ? 'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/30 hover:bg-cyan-500/20'
                    : 'text-zinc-400 hover:bg-white/[0.06] hover:text-white'
                )}
              >
                {editMode ? <Check className="size-3.5" aria-hidden /> : <Pencil className="size-3.5" aria-hidden />}
                {editMode ? 'Done' : 'Edit'}
              </button>
            )}
          </div>

          <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1" role="list">
            {/* current-location quick chip (until the device place is saved) */}
            {!hasDeviceLoc && (
              <button
                type="button"
                onClick={useDeviceLocation}
                disabled={locating}
                className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.08] disabled:opacity-60"
                aria-label="Add and use my current location"
              >
                {locating ? (
                  <Loader2 className="size-3.5 animate-spin text-cyan-300" aria-hidden />
                ) : (
                  <LocateFixed className="size-3.5 text-cyan-300" aria-hidden />
                )}
                My Location
              </button>
            )}

            <AnimatePresence initial={false} mode="popLayout">
              {locations.map((loc) => {
                const isActive = loc.id === activeId
                return (
                  <motion.div
                    key={loc.id}
                    layout
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                    className="shrink-0"
                    role="listitem"
                  >
                    {editMode ? (
                      <span className="flex h-11 items-center rounded-full border border-white/10 bg-white/[0.04] pl-4 pr-1 text-sm font-medium text-zinc-200">
                        <span className="max-w-36 truncate">{loc.name}</span>
                        <button
                          type="button"
                          onClick={() => removeLocation(loc.id)}
                          aria-label={`Remove ${loc.name}`}
                          className="ml-1 flex size-11 items-center justify-center rounded-full text-rose-400 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onChipClick(loc)}
                        onPointerDown={startPress}
                        onPointerUp={stopPress}
                        onPointerLeave={stopPress}
                        onPointerCancel={stopPress}
                        onContextMenu={(e) => e.preventDefault()}
                        aria-current={isActive ? 'true' : undefined}
                        className={cn(
                          'flex h-11 select-none touch-manipulation items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-all',
                          isActive
                            ? 'border-cyan-300/60 bg-gradient-to-r from-cyan-500/25 to-sky-500/15 text-white ring-1 ring-cyan-400/40'
                            : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08]'
                        )}
                      >
                        {loc.device && (
                          <LocateFixed
                            className={cn('size-3.5', isActive ? 'text-cyan-200' : 'text-cyan-300')}
                            aria-hidden
                          />
                        )}
                        <span className="max-w-36 truncate">{loc.name}</span>
                      </button>
                    )}
                  </motion.div>
                )
              })}
            </AnimatePresence>

            <button
              type="button"
              onClick={openSearch}
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-white/15 px-4 text-sm font-medium text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-200"
              aria-label="Add a new location"
            >
              <Plus className="size-4" aria-hidden /> Add
            </button>
          </div>
        </section>

        {/* ============ Body ============ */}
        <div className="flex flex-col gap-4 px-5 py-4">
          {/* error + retry */}
          {error && (
            <Alert variant="destructive" className="border-rose-500/30 bg-rose-500/[0.07] text-rose-200">
              <WifiOff className="size-4" aria-hidden />
              <AlertTitle>Couldn&rsquo;t load the forecast</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
              {activeLoc && (
                <button
                  type="button"
                  onClick={() => void fetchForecast(activeLoc)}
                  className="mt-3 h-11 w-full rounded-xl bg-rose-500 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-rose-400"
                >
                  Try again
                </button>
              )}
            </Alert>
          )}

          {/* loading skeleton */}
          {loading && !data && (
            <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading forecast">
              <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <div className="h-4 w-32 animate-pulse rounded bg-white/[0.07]" />
                <div className="flex gap-1.5 overflow-hidden">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="h-24 w-14 shrink-0 animate-pulse rounded-xl bg-white/[0.07]" />
                  ))}
                </div>
              </div>
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
                <div className="h-4 w-28 animate-pulse rounded bg-white/[0.07]" />
                <div className="h-36 animate-pulse rounded-xl bg-white/[0.07]" />
              </div>
            </div>
          )}

          {/* ============ Next 24 hours ============ */}
          {!loading && data && hours.length > 0 && (
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5" aria-label="Next 24 hours">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-bold">Next 24 hours</h3>
                {data.timezone && (
                  <p className="truncate text-[11px] text-zinc-500">{data.timezone.replace('_', ' ')}</p>
                )}
              </div>

              {/* horizontal hour strip */}
              <div className="mt-3 -mx-1 flex gap-1 overflow-x-auto no-scrollbar px-1 pb-1">
                {hours.map((h) => (
                  <div
                    key={h.key}
                    className={cn(
                      'flex w-14 shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-2',
                      h.isNow && 'bg-cyan-500/15 ring-1 ring-cyan-400/30'
                    )}
                  >
                    <span className="text-[11px] font-medium text-zinc-400">
                      {h.isNow ? 'Now' : h.label}
                    </span>
                    <h.Icon
                      className={cn('size-5', hourIconTint(h.bucket, h.isDay))}
                      aria-hidden
                    />
                    <span className="text-sm font-semibold tabular-nums">{h.temp}°</span>
                    <span
                      className={cn(
                        'flex items-center gap-0.5 text-[10px] tabular-nums',
                        h.precip > 0 ? 'text-cyan-300' : 'text-zinc-600'
                      )}
                      aria-label={`${h.precip}% chance of precipitation`}
                    >
                      <Droplets className="size-2.5" aria-hidden />
                      {h.precip}%
                    </span>
                  </div>
                ))}
              </div>

              {/* hourly temperature line */}
              <div className="mt-3 h-36 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={hourlyChartData} margin={{ top: 6, right: 8, bottom: 0, left: 8 }}>
                    <XAxis
                      dataKey="h"
                      tick={{ fill: '#71717a', fontSize: 9 }}
                      axisLine={false}
                      tickLine={false}
                      interval={3}
                    />
                    <YAxis hide domain={['dataMin - 2', 'dataMax + 2']} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ stroke: 'rgba(255,255,255,0.18)' }}
                      formatter={(value) => [`${value}°`, 'Temp']}
                    />
                    <Line
                      type="monotone"
                      dataKey="temp"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3, fill: '#22d3ee', stroke: 'none' }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-1 text-center text-[10px] text-zinc-600">
                Temperature (°{unit.toUpperCase()}) · next 24 hours
              </p>
            </section>
          )}

          {/* ============ 7-day forecast ============ */}
          {!loading && data && dailyChartData.length > 0 && (
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5" aria-label="7-day forecast">
              <h3 className="text-sm font-bold">7-day forecast</h3>

              <div className="mt-3 h-40 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyChartData} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <defs>
                      <linearGradient id="wx-max-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#fbbf24" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="wx-min-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="day"
                      tick={{ fill: '#71717a', fontSize: 9 }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <YAxis hide domain={['dataMin - 3', 'dataMax + 3']} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      cursor={{ stroke: 'rgba(255,255,255,0.18)' }}
                      formatter={(value, name) => [`${value}°`, name === 'max' ? 'High' : 'Low']}
                    />
                    <Area
                      type="monotone"
                      dataKey="max"
                      stroke="#fbbf24"
                      strokeWidth={2}
                      fill="url(#wx-max-fill)"
                      dot={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="min"
                      stroke="#38bdf8"
                      strokeWidth={2}
                      fill="url(#wx-min-fill)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-1 flex items-center justify-center gap-4 text-[11px] text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-[#fbbf24]" aria-hidden /> High
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-full bg-[#38bdf8]" aria-hidden /> Low
                </span>
              </div>

              {/* day cards */}
              <div className="mt-3 -mx-1 flex gap-2 overflow-x-auto no-scrollbar px-1 pb-1">
                {daily?.time.map((isoDate, i) => {
                  const day = describeWeather(daily.weather_code[i] ?? 0, true)
                  const min = Math.round(toUnit(daily.temperature_2m_min[i] ?? 0, unit))
                  const max = Math.round(toUnit(daily.temperature_2m_max[i] ?? 0, unit))
                  const pp = daily.precipitation_probability_max?.[i]
                  return (
                    <div
                      key={isoDate}
                      className={cn(
                        'flex w-[76px] shrink-0 flex-col items-center gap-1 rounded-xl border p-2.5 text-center',
                        i === 0 ? 'border-cyan-400/30 bg-cyan-500/10' : 'border-white/10 bg-white/[0.03]'
                      )}
                    >
                      <span className="text-xs font-semibold text-zinc-300">
                        {i === 0 ? 'Today' : weekdayShort(isoDate)}
                      </span>
                      <day.Icon className={cn('size-5', hourIconTint(day.bucket, true))} aria-hidden />
                      <span className="text-sm font-semibold tabular-nums">{max}°</span>
                      <span className="text-xs tabular-nums text-zinc-500">{min}°</span>
                      {typeof pp === 'number' && pp > 0 ? (
                        <span className="flex items-center gap-0.5 text-[10px] tabular-nums text-cyan-300">
                          <Droplets className="size-2.5" aria-hidden />
                          {pp}%
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-700">—</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* ============ Details grid ============ */}
          {!loading && current && daily && (
            <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 sm:p-5" aria-label="Weather details">
              <h3 className="text-sm font-bold">Details</h3>
              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <DetailCell
                  icon={Thermometer}
                  label="Feels like"
                  value={`${Math.round(toUnit(current.apparent_temperature, unit))}°`}
                />
                <DetailCell
                  icon={Droplets}
                  label="Humidity"
                  value={`${current.relative_humidity_2m}%`}
                />
                <DetailCell
                  icon={Wind}
                  label="Wind"
                  value={`${Math.round(current.wind_speed_10m)} km/h`}
                  extra={
                    <span className="flex items-center gap-1">
                      <Navigation2
                        className="size-3.5 text-cyan-300"
                        style={{ transform: `rotate(${(current.wind_direction_10m ?? 0) + 180}deg)` }}
                        aria-hidden
                      />
                      {compass(current.wind_direction_10m ?? 0)}
                    </span>
                  }
                />
                <DetailCell
                  icon={Gauge}
                  label="Pressure"
                  value={`${Math.round(current.surface_pressure)} hPa`}
                />
                <DetailCell
                  icon={Sun}
                  label="UV index"
                  value={uvNow !== null ? String(uvNow) : '—'}
                  sub={uvNow !== null ? uvLabel(uvNow) : undefined}
                />
                <DetailCell icon={Umbrella} label="Precip. today" value={`${daily.precipitation_probability_max?.[0] ?? 0}%`} />
                <DetailCell icon={Sunrise} label="Sunrise" value={clockLabel(daily.sunrise[0])} />
                <DetailCell icon={Sunset} label="Sunset" value={clockLabel(daily.sunset[0])} />
              </div>
            </section>
          )}

          {/* attribution */}
          <p className="px-1 pb-1 pt-1 text-center text-[10px] leading-relaxed text-zinc-600">
            Forecast data by Open-Meteo · cached on device, works offline
          </p>
        </div>
      </motion.div>
    </div>
  )
}
