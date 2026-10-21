'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  Loader2,
  LocateFixed,
  MapPin,
  Moon,
  Search,
  Sun,
  WifiOff,
  Wind,
  type LucideIcon,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

/* ================================================================== */
/* API types                                                           */
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
  temperature_2m: number
  relative_humidity_2m: number
  apparent_temperature: number
  is_day: number
  weather_code: number
  wind_speed_10m: number
}

interface DailyWeather {
  time: string[]
  weather_code: number[]
  temperature_2m_max: number[]
  temperature_2m_min: number[]
}

interface ForecastResponse {
  current: CurrentWeather
  daily: DailyWeather
}

interface WeatherCache {
  placeName: string
  admin1?: string
  country?: string
  lat: number
  lon: number
  data: ForecastResponse
  fetchedAt: number
}

type Unit = 'c' | 'f'

interface PlaceInfo {
  name: string
  admin1?: string
  country?: string
}

/* ================================================================== */
/* Constants + helpers                                                 */
/* ================================================================== */

const CACHE_KEY = 'weather-cache'
const UNIT_KEY = 'weather-unit'
/** Refresh the cached forecast in the background when older than 10 min. */
const REFRESH_MS = 10 * 60 * 1000

function readCache(): WeatherCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as WeatherCache
    if (
      !parsed ||
      typeof parsed.lat !== 'number' ||
      typeof parsed.lon !== 'number' ||
      !parsed.data?.current ||
      !parsed.data?.daily
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeCache(cache: WeatherCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage unavailable — ignore */
  }
}

function describeWeather(code: number, isDay: boolean): { label: string; Icon: LucideIcon } {
  if (code === 0) return { label: 'Clear sky', Icon: isDay ? Sun : Moon }
  if (code === 1) return { label: 'Mainly clear', Icon: isDay ? CloudSun : CloudMoon }
  if (code === 2) return { label: 'Partly cloudy', Icon: CloudSun }
  if (code === 3) return { label: 'Overcast', Icon: Cloud }
  if (code === 45 || code === 48) return { label: 'Fog', Icon: CloudFog }
  if (code >= 51 && code <= 57) return { label: 'Drizzle', Icon: CloudDrizzle }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82))
    return { label: 'Rain', Icon: CloudRain }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86)
    return { label: 'Snow', Icon: CloudSnow }
  if (code >= 95 && code <= 99) return { label: 'Thunderstorm', Icon: CloudLightning }
  return { label: 'Unknown', Icon: Cloud }
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

function forecastUrl(lat: number, lon: number): string {
  return (
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&timezone=auto&forecast_days=7'
  )
}

/* ================================================================== */
/* WeatherTool — default export                                        */
/* ================================================================== */

export default function WeatherTool() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeoPlace[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [place, setPlace] = useState<PlaceInfo | null>(null)
  const [data, setData] = useState<ForecastResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unit, setUnit] = useState<Unit>(() => {
    try {
      return localStorage.getItem(UNIT_KEY) === 'f' ? 'f' : 'c'
    } catch {
      return 'c'
    }
  })
  const reqIdRef = useRef(0)

  const loadForecast = useCallback(
    async (
      lat: number,
      lon: number,
      name: string,
      admin1?: string,
      country?: string,
      silent = false
    ): Promise<void> => {
      const id = ++reqIdRef.current
      if (!silent) setLoading(true)
      setError(null)
      if (!navigator.onLine) {
        if (reqIdRef.current === id) {
          setLoading(false)
          setError('You appear to be offline. Reconnect to the internet and try again.')
        }
        return
      }
      try {
        const res = await fetch(forecastUrl(lat, lon))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as ForecastResponse
        if (reqIdRef.current !== id) return
        setData(json)
        setPlace({ name, admin1, country })
        setLoading(false)
        writeCache({
          placeName: name,
          admin1,
          country,
          lat,
          lon,
          data: json,
          fetchedAt: Date.now(),
        })
      } catch {
        if (reqIdRef.current !== id) return
        setLoading(false)
        setError('Could not load the forecast. Please try again.')
      }
    },
    []
  )

  /* Restore last result from cache on mount (async callback, not sync setState). */
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(() => {
      if (cancelled) return
      const cached = readCache()
      if (!cached) return
      setPlace({ name: cached.placeName, admin1: cached.admin1, country: cached.country })
      setData(cached.data)
      if (Date.now() - cached.fetchedAt > REFRESH_MS) {
        void loadForecast(cached.lat, cached.lon, cached.placeName, cached.admin1, cached.country, true)
      }
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [loadForecast])

  /* Debounced city search (400 ms). */
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

  const selectPlace = (p: GeoPlace): void => {
    setQuery(p.name)
    setResults(null)
    void loadForecast(p.latitude, p.longitude, p.name, p.admin1, p.country)
  }

  const locate = (): void => {
    if (!('geolocation' in navigator)) {
      setError('Location services are not available on this device.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        setQuery('')
        setResults(null)
        void loadForecast(pos.coords.latitude, pos.coords.longitude, 'My Location')
      },
      () => {
        setLocating(false)
        setError('Could not get your location. Check permissions and try again.')
      },
      { timeout: 10_000, maximumAge: 300_000 }
    )
  }

  const chooseUnit = (u: Unit): void => {
    setUnit(u)
    try {
      localStorage.setItem(UNIT_KEY, u)
    } catch {
      /* storage unavailable — ignore */
    }
  }

  const current = data?.current
  const daily = data?.daily
  const headline = current ? describeWeather(current.weather_code, current.is_day === 1) : null
  const subtitle = place
    ? [place.admin1, place.country].filter(Boolean).join(', ')
    : ''

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------- Search ---------------- */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search a city…"
                className="h-11 pl-9"
                aria-label="Search for a city"
                autoComplete="off"
              />
            </div>
            <Button
              variant="outline"
              className="h-11 shrink-0 gap-2"
              onClick={locate}
              disabled={locating}
              aria-label="Use my location"
            >
              {locating ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <LocateFixed className="h-4 w-4" aria-hidden />
              )}
              My Location
            </Button>
          </div>

          {searching && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Searching cities…
            </p>
          )}

          {!searching && results !== null && results.length === 0 && query.trim().length >= 2 && (
            <p className="text-xs text-muted-foreground">
              No cities found for “{query.trim()}”.
            </p>
          )}

          {results !== null && results.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden rounded-lg border"
            >
              <ul className="max-h-64 overflow-y-auto">
                {results.map((r) => (
                  <li key={`${r.id}-${r.latitude}-${r.longitude}`}>
                    <button
                      type="button"
                      className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                      onClick={() => selectPlace(r)}
                    >
                      <MapPin
                        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{r.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[r.admin1, r.country].filter(Boolean).join(', ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Error ---------------- */}
      {error !== null && (
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" aria-hidden />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* ---------------- Loading skeleton ---------------- */}
      {loading && (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading forecast">
          <Card>
            <CardContent className="space-y-4 p-6">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-16 w-48" />
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 p-4 sm:p-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ---------------- Forecast ---------------- */}
      {!loading && current && daily && place && headline && (
        <>
          <Card>
            <CardContent className="p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">
                    {subtitle.length > 0 ? subtitle : place.name}
                  </p>
                  <p className="mt-1 flex items-baseline gap-1">
                    <span
                      className="text-6xl font-semibold tracking-tight tabular-nums"
                      aria-label={`Current temperature ${Math.round(toUnit(current.temperature_2m, unit))} degrees ${unit === 'c' ? 'Celsius' : 'Fahrenheit'}`}
                    >
                      {Math.round(toUnit(current.temperature_2m, unit))}°
                    </span>
                    <span className="text-2xl text-muted-foreground">
                      {unit === 'c' ? 'C' : 'F'}
                    </span>
                  </p>
                  <p className="mt-2 flex items-center gap-2">
                    <headline.Icon
                      className="h-5 w-5 text-amber-500 dark:text-amber-400"
                      aria-hidden
                    />
                    <span className="text-sm font-medium">{headline.label}</span>
                  </p>
                </div>
                <div
                  className="inline-flex rounded-full border p-0.5"
                  role="group"
                  aria-label="Temperature unit"
                >
                  <Button
                    size="sm"
                    variant={unit === 'c' ? 'secondary' : 'ghost'}
                    className="h-9 rounded-full px-3"
                    onClick={() => chooseUnit('c')}
                    aria-pressed={unit === 'c'}
                  >
                    °C
                  </Button>
                  <Button
                    size="sm"
                    variant={unit === 'f' ? 'secondary' : 'ghost'}
                    className="h-9 rounded-full px-3"
                    onClick={() => chooseUnit('f')}
                    aria-pressed={unit === 'f'}
                  >
                    °F
                  </Button>
                </div>
              </div>

              <Separator className="my-4" />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
                  <Sun className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Feels like</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {Math.round(toUnit(current.apparent_temperature, unit))}°
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
                  <Droplets className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Humidity</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {current.relative_humidity_2m}%
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2.5">
                  <Wind className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Wind</p>
                    <p className="text-sm font-semibold tabular-nums">
                      {Math.round(current.wind_speed_10m)} km/h
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 sm:p-6">
              <h3 className="text-sm font-medium text-muted-foreground">7-day forecast</h3>
              <ul className="mt-3 max-h-96 divide-y overflow-y-auto">
                {daily.time.map((isoDate, i) => {
                  const day = describeWeather(daily.weather_code[i] ?? 0, true)
                  const min = Math.round(toUnit(daily.temperature_2m_min[i] ?? 0, unit))
                  const max = Math.round(toUnit(daily.temperature_2m_max[i] ?? 0, unit))
                  return (
                    <li
                      key={isoDate}
                      className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <span className="w-14 shrink-0 text-sm font-medium">
                        {i === 0 ? 'Today' : weekdayShort(isoDate)}
                      </span>
                      <day.Icon
                        className="h-5 w-5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                        {day.label}
                      </span>
                      <span className="ml-auto text-sm tabular-nums">
                        <span className="text-muted-foreground">{min}°</span>
                        {' / '}
                        <span className="font-semibold">{max}°</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        </>
      )}

      {/* ---------------- Empty state ---------------- */}
      {!loading && !data && error === null && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <CloudSun className="h-10 w-10 text-muted-foreground/50" aria-hidden />
            <p className="text-sm font-medium">Search for a city to see the weather</p>
            <p className="max-w-xs text-xs text-muted-foreground">
              Type a city name above or use your current location to get live conditions and a
              7-day forecast.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
