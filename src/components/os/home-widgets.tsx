'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CloudSun, StickyNote } from 'lucide-react'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Home widgets (D72) — clock, weather and notes-sticky cards living   */
/* above the launcher grid on page 1. All data is read on-device:      */
/* clock from Date, weather from the toolhub-weather IndexedDB cache,  */
/* sticky note from the toolhub-notes localStorage.                    */
/* ================================================================== */

interface WidgetStripProps {
  onOpenApp: (id: string, el?: HTMLElement | null) => void
  onLight: boolean
}

/* ---------------- weather code → short label + emoji ---------------- */

function describeCode(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: 'Clear', emoji: '☀️' }
  if (code <= 2) return { label: 'Partly cloudy', emoji: '⛅' }
  if (code === 3) return { label: 'Overcast', emoji: '☁️' }
  if (code === 45 || code === 48) return { label: 'Fog', emoji: '🌫️' }
  if (code >= 51 && code <= 57) return { label: 'Drizzle', emoji: '🌦️' }
  if (code >= 61 && code <= 67) return { label: 'Rain', emoji: '🌧️' }
  if (code >= 71 && code <= 77) return { label: 'Snow', emoji: '❄️' }
  if (code >= 80 && code <= 82) return { label: 'Showers', emoji: '🌧️' }
  if (code >= 85 && code <= 86) return { label: 'Snow', emoji: '🌨️' }
  if (code >= 95) return { label: 'Storm', emoji: '⛈️' }
  return { label: 'Cloudy', emoji: '☁️' }
}

interface WeatherBits {
  temp: number
  code: number
  city: string
  unit: 'c' | 'f'
}

function readWeather(): Promise<WeatherBits | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('toolhub-weather')
      req.onsuccess = () => {
        const db = req.result
        const get = <T,>(store: string, key?: IDBValidKey): Promise<T | undefined> =>
          new Promise((res, rej) => {
            try {
              const r = key !== undefined ? db.transaction(store).objectStore(store).get(key) : db.transaction(store).objectStore(store).getAll()
              r.onsuccess = () => res(r.result as T)
              r.onerror = () => rej(r.error)
            } catch (e) {
              rej(e)
            }
          })
        void (async () => {
          try {
            const settings = await get<{ key: string; value: unknown }[]>('settings')
            const activeId = settings?.find((s) => s.key === 'activeLocationId')?.value as string | undefined
            const unit = (settings?.find((s) => s.key === 'unit')?.value as 'c' | 'f') ?? 'c'
            if (!activeId) return resolve(null)
            const locs = await get<{ id: string; name: string }[]>('locations')
            const loc = locs?.find((l) => l.id === activeId)
            const cache = await get<{ locationId: string; data: { current: { temperature_2m: number; weather_code: number } } }[]>('cache')
            const row = cache?.find((c) => c.locationId === activeId)
            if (!loc || !row) return resolve(null)
            resolve({
              temp: row.data.current.temperature_2m,
              code: row.data.current.weather_code,
              city: loc.name,
              unit,
            })
          } catch {
            resolve(null)
          }
        })()
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

interface StickyBits {
  title: string
  body: string
}

function readSticky(): StickyBits | null {
  try {
    const raw = localStorage.getItem('toolhub-notes')
    if (!raw) return null
    const notes = JSON.parse(raw) as Array<{ title: string; body: string; pinned: boolean; updatedAt: number }>
    const pinned = notes.filter((n) => n.pinned).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    const pick = pinned ?? notes.sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (!pick) return null
    return { title: pick.title || 'Untitled note', body: pick.body || '' }
  } catch {
    return null
  }
}

function useClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(new Date()))
    const t = setInterval(() => setNow(new Date()), 15_000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(t)
    }
  }, [])
  return now
}

export function WidgetStrip({ onOpenApp, onLight }: WidgetStripProps) {
  const now = useClock()
  const [weather, setWeather] = useState<WeatherBits | null>(null)
  const [sticky, setSticky] = useState<StickyBits | null>(null)

  useEffect(() => {
    let alive = true
    void readWeather().then((w) => {
      if (alive) setWeather(w)
    })
    const t = setTimeout(() => {
      if (alive) setSticky(readSticky())
    }, 0)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [])

  const timeStr = now
    ? now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '--:--'
  const dateStr = now
    ? now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : ''
  const wd = weather ? describeCode(weather.code) : null

  const card = cn(
    'relative overflow-hidden rounded-[1.4rem] p-3 text-left ring-1 backdrop-blur-xl transition-transform active:scale-[0.97]',
    onLight
      ? 'bg-white/55 ring-black/[0.08] shadow-[0_10px_26px_-14px_rgb(0_0_0/0.3)]'
      : 'bg-white/[0.12] ring-white/20 shadow-[0_10px_26px_-14px_rgb(0_0_0/0.5)]'
  )
  const titleCls = onLight ? 'text-zinc-900' : 'text-white'
  const subCls = onLight ? 'text-zinc-600' : 'text-white/65'

  return (
    <div className="mb-4 grid grid-cols-3 gap-2.5" role="group" aria-label="Widgets">
      {/* Clock */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        onClick={(e) => onOpenApp('clock', e.currentTarget)}
        aria-label="Clock widget — open Clock"
        className={card}
      >
        <div className={cn('text-[10px] font-bold uppercase tracking-wider', subCls)}>Clock</div>
        <div className={cn('mt-1 text-2xl font-black tabular-nums leading-none', titleCls)} suppressHydrationWarning>
          {timeStr}
        </div>
        <div className={cn('mt-1 truncate text-[10px] font-medium', subCls)} suppressHydrationWarning>
          {dateStr}
        </div>
      </motion.button>

      {/* Weather */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.04 }}
        onClick={(e) => onOpenApp('weather', e.currentTarget)}
        aria-label="Weather widget — open Weather"
        className={card}
      >
        <div className={cn('text-[10px] font-bold uppercase tracking-wider', subCls)}>Weather</div>
        {weather && wd ? (
          <>
            <div className={cn('mt-1 flex items-baseline gap-1 text-2xl font-black leading-none', titleCls)}>
              {Math.round(weather.unit === 'f' ? weather.temp * 1.8 + 32 : weather.temp)}°
              <span className="text-base" aria-hidden>
                {wd.emoji}
              </span>
            </div>
            <div className={cn('mt-1 truncate text-[10px] font-medium', subCls)}>
              {weather.city} · {wd.label}
            </div>
          </>
        ) : (
          <>
            <div className={cn('mt-1 flex items-center gap-1 text-2xl font-black leading-none', titleCls)}>
              <CloudSun className="size-5 opacity-60" aria-hidden />
            </div>
            <div className={cn('mt-1 truncate text-[10px] font-medium', subCls)}>Open for forecast</div>
          </>
        )}
      </motion.button>

      {/* Sticky note */}
      <motion.button
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.08 }}
        onClick={(e) => onOpenApp('notes', e.currentTarget)}
        aria-label="Notes widget — open Notes"
        className={card}
      >
        <div className={cn('flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider', subCls)}>
          <StickyNote className="size-3" aria-hidden /> Notes
        </div>
        {sticky ? (
          <>
            <div className={cn('mt-1 truncate text-sm font-bold leading-tight', titleCls)}>{sticky.title}</div>
            <div className={cn('mt-0.5 line-clamp-2 text-[10px] leading-tight', subCls)}>
              {sticky.body || 'Empty note'}
            </div>
          </>
        ) : (
          <>
            <div className={cn('mt-1 text-sm font-bold leading-tight', titleCls)}>Quick note</div>
            <div className={cn('mt-0.5 text-[10px] leading-tight', subCls)}>Tap to write one</div>
          </>
        )}
      </motion.button>
    </div>
  )
}
