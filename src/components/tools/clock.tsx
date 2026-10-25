'use client'

/**
 * Clock — world time, stopwatch and countdown alarm.
 *
 * Three tabs in one dark-glass shell:
 *  • Clock     — live local time + a world-clock strip: curated cities via
 *                Intl.DateTimeFormat (IANA zones), day offsets, persisted to
 *                localStorage key 'toolhub-clock-world'.
 *  • Stopwatch — start/pause/reset with lap splits, best/worst highlighted.
 *  • Timer     — preset chips + manual H/M/S inputs, animated countdown ring,
 *                looping WebAudio alarm (880/660 Hz) + vibration at zero.
 *
 * Client-side only — works fully offline.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BellRing,
  Check,
  Clock,
  Flag,
  Globe2,
  Hourglass,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Watch,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Shared helpers                                                      */
/* ================================================================== */

const pad2 = (n: number): string => String(n).padStart(2, '0')

function clampInt(raw: string, min: number, max: number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

/** Subtle tick haptic — silently no-ops on unsupported devices. */
function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* ignore */
  }
}

const SPRING = { type: 'spring', stiffness: 320, damping: 26 } as const

/** Thin glass scrollbar for long lists. */
const SCROLL_CLASS =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/* ================================================================== */
/* World clock                                                         */
/* ================================================================== */

interface CityZone {
  id: string
  city: string
  tz: string
}

const CITIES: CityZone[] = [
  { id: 'dhaka', city: 'Dhaka', tz: 'Asia/Dhaka' },
  { id: 'kolkata', city: 'Kolkata', tz: 'Asia/Kolkata' },
  { id: 'new-york', city: 'New York', tz: 'America/New_York' },
  { id: 'london', city: 'London', tz: 'Europe/London' },
  { id: 'dubai', city: 'Dubai', tz: 'Asia/Dubai' },
  { id: 'singapore', city: 'Singapore', tz: 'Asia/Singapore' },
  { id: 'tokyo', city: 'Tokyo', tz: 'Asia/Tokyo' },
  { id: 'sydney', city: 'Sydney', tz: 'Australia/Sydney' },
  { id: 'los-angeles', city: 'Los Angeles', tz: 'America/Los_Angeles' },
  { id: 'paris', city: 'Paris', tz: 'Europe/Paris' },
  { id: 'riyadh', city: 'Riyadh', tz: 'Asia/Riyadh' },
  { id: 'toronto', city: 'Toronto', tz: 'America/Toronto' },
]

const WORLD_LS_KEY = 'toolhub-clock-world'

function cityTime(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
}

function cityDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(now)
}

function cityGmt(now: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(now)
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}

/** Days between the calendar date in `tz` and the local calendar date. */
function dayOffset(now: Date, tz: string): number {
  const key = (zone?: string): string =>
    new Intl.DateTimeFormat('en-CA', zone ? { timeZone: zone } : undefined).format(now)
  const toUTC = (k: string): number => {
    const [y, m, d] = k.split('-').map(Number)
    return Date.UTC(y, (m ?? 1) - 1, d ?? 1)
  }
  return Math.round((toUTC(key(tz)) - toUTC(key())) / 86_400_000)
}

function offsetLabel(offset: number): string {
  if (offset < 0) return 'Yesterday'
  if (offset > 0) return 'Tomorrow'
  return 'Today'
}

function loadWorldCities(): string[] {
  try {
    const raw = window.localStorage.getItem(WORLD_LS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is string => typeof x === 'string' && CITIES.some((c) => c.id === x)
    )
  } catch {
    return []
  }
}

function WorldClockTab({ active }: { active: boolean }) {
  /* Registry components render client-only (ssr:false), so lazy initializers
     can safely read the clock and localStorage — no hydration effect needed. */
  const [now, setNow] = useState<Date | null>(() => (typeof window === 'undefined' ? null : new Date()))
  const [selected, setSelected] = useState<string[]>(() =>
    typeof window === 'undefined' ? [] : loadWorldCities()
  )
  const [pickerOpen, setPickerOpen] = useState(false)

  /* tick while the tab is visible */
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(new Date()), 250)
    return () => window.clearInterval(id)
  }, [active])

  /* persist selection */
  useEffect(() => {
    try {
      window.localStorage.setItem(WORLD_LS_KEY, JSON.stringify(selected))
    } catch {
      /* private mode — run without persistence */
    }
  }, [selected])

  const toggleCity = useCallback((id: string): void => {
    haptic()
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }, [])

  const chosen = useMemo(
    () =>
      selected
        .map((id) => CITIES.find((c) => c.id === id))
        .filter((c): c is CityZone => Boolean(c)),
    [selected]
  )

  const localTime = now
    ? new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now)
    : '--:--:--'
  const localDate = now
    ? now.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : '—'

  return (
    <div className="space-y-4">
      {/* -------- Local time -------- */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-500/[0.12] via-transparent to-slate-500/[0.05] p-5 text-center sm:p-6">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          Local time
        </p>
        <p
          className="mt-1 text-5xl font-black tracking-tight tabular-nums text-zinc-50 sm:text-6xl"
          aria-label={`Local time ${localTime}`}
        >
          {localTime}
        </p>
        <p className="mt-2 text-sm text-zinc-400">{localDate}</p>
      </div>

      {/* -------- World clock strip -------- */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <Globe2 className="size-3.5" aria-hidden />
            World clock
            <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-bold text-zinc-400">
              {chosen.length}
            </span>
          </p>
          <button
            onClick={() => {
              haptic()
              setPickerOpen(true)
            }}
            aria-label="Add or remove cities"
            className="flex h-11 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 text-xs font-bold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Plus className="size-4" aria-hidden /> Add city
          </button>
        </div>

        {chosen.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-10 text-center">
            <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-500 via-slate-600 to-slate-800 text-white ring-1 ring-white/20">
              <Globe2 className="size-7" strokeWidth={1.9} aria-hidden />
            </span>
            <p className="mt-4 text-sm font-bold text-zinc-200">
              Track the world&apos;s time
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
              Add cities to see their live time next to yours — your pick is
              stored on this device only.
            </p>
            <Button
              onClick={() => {
                haptic()
                setPickerOpen(true)
              }}
              className="mt-4 h-11 rounded-xl bg-gradient-to-r from-slate-300 to-slate-500 font-semibold text-zinc-950 hover:from-slate-200 hover:to-slate-400"
            >
              <Plus className="size-4" aria-hidden /> Add your first city
            </Button>
          </div>
        ) : (
          <div className={cn('max-h-80 space-y-2 pr-1', SCROLL_CLASS)}>
            <AnimatePresence initial={false}>
              {chosen.map((c) => {
                const offset = now ? dayOffset(now, c.tz) : 0
                return (
                  <motion.div
                    key={c.id}
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={SPRING}
                    className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-bold text-zinc-100">
                          {c.city}
                        </p>
                        <span
                          className={cn(
                            'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                            offset === 0
                              ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                              : 'border-white/10 bg-white/5 text-zinc-400'
                          )}
                        >
                          {offsetLabel(offset)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        {now ? cityDate(now, c.tz) : '—'}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-lg font-bold tabular-nums text-zinc-100">
                      {now ? cityTime(now, c.tz) : '--:--'}
                    </p>
                    <button
                      onClick={() => toggleCity(c.id)}
                      aria-label={`Remove ${c.city}`}
                      className="flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* -------- City picker -------- */}
      <AnimatePresence>
        {pickerOpen && (
          <motion.div
            key="city-picker"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPickerOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Manage world clock cities"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={SPRING}
              className="max-h-[85vh] w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-2xl"
            >
              <div className="flex items-center gap-2.5 border-b border-white/5 px-5 py-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-500 to-slate-700 text-white ring-1 ring-white/15">
                  <Globe2 className="size-4.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold">World clock cities</h3>
                  <p className="text-[11px] text-zinc-500">
                    Tap to add or remove · {selected.length} selected
                  </p>
                </div>
                <button
                  onClick={() => setPickerOpen(false)}
                  aria-label="Close"
                  className="flex size-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <div className={cn('max-h-[52vh] space-y-1.5 overflow-y-auto p-4', SCROLL_CLASS)}>
                {CITIES.map((c) => {
                  const on = selected.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleCity(c.id)}
                      aria-pressed={on}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                        on
                          ? 'border-emerald-400/30 bg-emerald-500/10'
                          : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-zinc-100">{c.city}</p>
                        <p className="text-[11px] text-zinc-500">
                          {now ? cityGmt(now, c.tz) : '—'} · {c.tz}
                        </p>
                      </div>
                      <span className="shrink-0 font-mono text-sm tabular-nums text-zinc-400">
                        {now ? cityTime(now, c.tz) : '--:--'}
                      </span>
                      <span
                        className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-full border',
                          on
                            ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-300'
                            : 'border-white/15 text-transparent'
                        )}
                      >
                        <Check className="size-3.5" aria-hidden />
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="border-t border-white/5 p-4">
                <Button
                  onClick={() => {
                    haptic()
                    setPickerOpen(false)
                  }}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-slate-300 to-slate-500 font-bold text-zinc-950 hover:from-slate-200 hover:to-slate-400"
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
/* Stopwatch                                                           */
/* ================================================================== */

interface Lap {
  n: number
  split: number
  total: number
}

function formatStopwatch(ms: number): string {
  const mm = Math.floor(ms / 60_000)
  const ss = Math.floor((ms % 60_000) / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${pad2(mm)}:${pad2(ss)}.${pad2(cs)}`
}

function StopwatchTab({ active }: { active: boolean }) {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [laps, setLaps] = useState<Lap[]>([])
  const startAtRef = useRef(0)
  const accumRef = useRef(0)

  /* rAF-style ticker driven by performance.now() — only while visible */
  useEffect(() => {
    if (!running || !active) return
    const id = window.setInterval(() => {
      setElapsed(accumRef.current + (performance.now() - startAtRef.current))
    }, 31)
    return () => window.clearInterval(id)
  }, [running, active])

  const toggleRun = (): void => {
    haptic()
    if (running) {
      accumRef.current += performance.now() - startAtRef.current
      setElapsed(accumRef.current)
      setRunning(false)
    } else {
      startAtRef.current = performance.now()
      setRunning(true)
    }
  }

  const reset = (): void => {
    haptic()
    accumRef.current = 0
    startAtRef.current = 0
    setRunning(false)
    setElapsed(0)
    setLaps([])
  }

  const addLap = (): void => {
    haptic()
    const total = accumRef.current + (performance.now() - startAtRef.current)
    setLaps((prev) => {
      const prevTotal = prev.length > 0 ? prev[prev.length - 1].total : 0
      return [...prev, { n: prev.length + 1, split: total - prevTotal, total }]
    })
  }

  const { bestIdx, worstIdx } = useMemo(() => {
    if (laps.length < 2) return { bestIdx: -1, worstIdx: -1 }
    let b = 0
    let w = 0
    laps.forEach((l, i) => {
      if (l.split < laps[b].split) b = i
      if (l.split > laps[w].split) w = i
    })
    return { bestIdx: b, worstIdx: w }
  }, [laps])

  const reversedLaps = useMemo(() => [...laps].reverse(), [laps])
  const status = running ? 'Running' : elapsed > 0 ? 'Paused' : 'Ready'

  return (
    <div className="space-y-4">
      {/* -------- Display + controls -------- */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-500/[0.12] via-transparent to-slate-500/[0.05] p-5 text-center sm:p-6">
        <p
          className={cn(
            'text-[10px] font-semibold uppercase tracking-widest',
            running ? 'text-emerald-400' : 'text-zinc-500'
          )}
        >
          {status}
        </p>
        <p
          className="mt-1 font-mono text-5xl font-bold tracking-tight tabular-nums text-zinc-50 sm:text-6xl"
          aria-label={`Stopwatch ${formatStopwatch(elapsed)}`}
        >
          {formatStopwatch(elapsed)}
        </p>

        <div className="mt-5 flex items-center justify-center gap-3">
          <button
            onClick={reset}
            disabled={elapsed === 0 && laps.length === 0}
            aria-label="Reset stopwatch"
            className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <RotateCcw className="size-5" aria-hidden />
          </button>
          <Button
            onClick={toggleRun}
            className={cn(
              'h-12 min-w-36 gap-2 rounded-2xl text-base font-bold',
              running
                ? 'bg-white/10 text-zinc-100 hover:bg-white/15'
                : 'bg-gradient-to-r from-emerald-400 to-teal-500 text-zinc-950 shadow-lg shadow-emerald-500/25 hover:from-emerald-300 hover:to-teal-400'
            )}
            aria-label={running ? 'Pause stopwatch' : 'Start stopwatch'}
          >
            {running ? (
              <Pause className="size-5" aria-hidden />
            ) : (
              <Play className="size-5" aria-hidden />
            )}
            {running ? 'Pause' : 'Start'}
          </Button>
          <button
            onClick={addLap}
            disabled={!running}
            aria-label="Record lap"
            className={cn(
              'flex size-12 items-center justify-center rounded-2xl border transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              running
                ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
            )}
          >
            <Flag className="size-5" aria-hidden />
          </button>
        </div>
      </div>

      {/* -------- Laps -------- */}
      {laps.length > 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Laps · {laps.length}
            </p>
            <p className="text-[10px] text-zinc-600">
              <span className="font-bold text-emerald-300">Best</span> ·{' '}
              <span className="font-bold text-rose-300">Worst</span> highlighted
            </p>
          </div>
          <ol className={cn('max-h-72 space-y-1.5 pr-1', SCROLL_CLASS)}>
            <AnimatePresence initial={false}>
              {reversedLaps.map((l) => {
                const i = l.n - 1
                const isBest = i === bestIdx
                const isWorst = i === worstIdx
                return (
                  <motion.li
                    key={l.n}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={SPRING}
                    className={cn(
                      'flex items-center gap-2 rounded-xl border px-3 py-2',
                      isBest
                        ? 'border-emerald-400/25 bg-emerald-500/10'
                        : isWorst
                          ? 'border-rose-400/25 bg-rose-500/10'
                          : 'border-white/10 bg-white/[0.03]'
                    )}
                  >
                    <span className="w-16 shrink-0 text-xs font-bold uppercase tracking-wider text-zinc-400">
                      Lap {l.n}
                    </span>
                    {isBest && (
                      <span className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                        Best
                      </span>
                    )}
                    {isWorst && (
                      <span className="shrink-0 rounded-full border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                        Worst
                      </span>
                    )}
                    <span className="flex-1" />
                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          'font-mono text-sm font-bold tabular-nums',
                          isBest
                            ? 'text-emerald-300'
                            : isWorst
                              ? 'text-rose-300'
                              : 'text-zinc-100'
                        )}
                      >
                        {formatStopwatch(l.split)}
                      </p>
                      <p className="font-mono text-[10px] tabular-nums text-zinc-500">
                        {formatStopwatch(l.total)} total
                      </p>
                    </div>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ol>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-zinc-500">
          {running
            ? 'Tap Lap to record a split — best and worst get highlighted.'
            : 'Laps will appear here once you record them.'}
        </p>
      )}
    </div>
  )
}

/* ================================================================== */
/* Timer                                                               */
/* ================================================================== */

const PRESETS = [1, 3, 5, 10, 15, 30]

function formatTimer(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
}

function TimerTab() {
  const { toast } = useToast()
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(5)
  const [seconds, setSeconds] = useState(0)
  const [running, setRunning] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [totalMs, setTotalMs] = useState<number | null>(null)
  const [finished, setFinished] = useState(false)
  const [needsDuration, setNeedsDuration] = useState(false)

  const endAtRef = useRef(0)
  const audioRef = useRef<AudioContext | null>(null)
  const alarmIntervalRef = useRef<number | null>(null)
  const alarmUntilRef = useRef(0)
  const beepCountRef = useRef(0)

  const stopAlarm = useCallback((): void => {
    if (alarmIntervalRef.current !== null) {
      window.clearInterval(alarmIntervalRef.current)
      alarmIntervalRef.current = null
    }
  }, [])

  /* AudioContext is created/resumed inside the Start tap (user gesture),
     so the looping alarm works later — even offline, no permissions. */
  const ensureAudio = useCallback((): void => {
    try {
      if (!audioRef.current) {
        const w = window as unknown as {
          AudioContext?: typeof AudioContext
          webkitAudioContext?: typeof AudioContext
        }
        const Ctx = w.AudioContext ?? w.webkitAudioContext
        if (!Ctx) return
        audioRef.current = new Ctx()
      }
      if (audioRef.current.state === 'suspended') void audioRef.current.resume()
    } catch {
      /* audio unavailable */
    }
  }, [])

  const startAlarm = useCallback((): void => {
    stopAlarm()
    const ctx = audioRef.current
    alarmUntilRef.current = Date.now() + 20_000
    beepCountRef.current = 0
    const tick = (): void => {
      if (Date.now() >= alarmUntilRef.current) {
        stopAlarm()
        return
      }
      haptic([260, 110, 260])
      if (ctx && ctx.state === 'running') {
        try {
          const t0 = ctx.currentTime
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(
            beepCountRef.current % 2 === 0 ? 880 : 660,
            t0
          )
          gain.gain.setValueAtTime(0.0001, t0)
          gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start(t0)
          osc.stop(t0 + 0.34)
        } catch {
          /* ignore a failed beep */
        }
        beepCountRef.current += 1
      }
    }
    tick()
    alarmIntervalRef.current = window.setInterval(tick, 700)
  }, [stopAlarm])

  /* cleanup on unmount */
  useEffect(
    () => () => {
      stopAlarm()
      try {
        void audioRef.current?.close()
      } catch {
        /* ignore */
      }
    },
    [stopAlarm]
  )

  /* countdown ticker — keeps running even when the tab is hidden so the alarm fires */
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => {
      const rem = endAtRef.current - performance.now()
      if (rem <= 0) {
        setRemaining(0)
        setRunning(false)
        setFinished(true)
        startAlarm()
        toast({
          title: "Time's up",
          description: 'Your countdown finished — alarm rings for 20 seconds.',
        })
      } else {
        setRemaining(rem)
      }
    }, 100)
    return () => window.clearInterval(id)
  }, [running, startAlarm, toast])

  const inputTotalMs = (hours * 3600 + minutes * 60 + seconds) * 1000

  const clearRun = (): void => {
    setRemaining(null)
    setTotalMs(null)
    setFinished(false)
    setNeedsDuration(false)
  }

  const changeInput = (
    setter: (n: number) => void,
    raw: string,
    max: number
  ): void => {
    setter(clampInt(raw, 0, max))
    clearRun()
  }

  const applyPreset = (mins: number): void => {
    haptic()
    setHours(0)
    setMinutes(mins)
    setSeconds(0)
    clearRun()
  }

  const start = (duration: number): void => {
    if (duration <= 0) {
      setNeedsDuration(true)
      return
    }
    ensureAudio()
    endAtRef.current = performance.now() + duration
    setRemaining(duration)
    setTotalMs((prev) => prev ?? duration)
    setFinished(false)
    setNeedsDuration(false)
    setRunning(true)
  }

  const toggleRun = (): void => {
    haptic()
    if (running) {
      setRemaining(Math.max(0, endAtRef.current - performance.now()))
      setRunning(false)
      return
    }
    if (finished) {
      start(totalMs ?? inputTotalMs)
      return
    }
    start(remaining ?? inputTotalMs)
  }

  const reset = (): void => {
    haptic()
    stopAlarm()
    setRunning(false)
    clearRun()
  }

  const shownMs = remaining ?? inputTotalMs
  const frac = finished
    ? 1
    : remaining !== null && totalMs
      ? clamp01(remaining / totalMs)
      : 1
  const status = finished
    ? "Time's up"
    : running
      ? 'Running'
      : remaining !== null
        ? 'Paused'
        : 'Ready'
  const inputsLocked = running || finished

  return (
    <div className="space-y-4">
      {/* -------- Ring + controls -------- */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-500/[0.12] via-transparent to-slate-500/[0.05] p-5 sm:p-6">
        <div className="relative mx-auto size-56 max-w-full sm:size-64">
          <svg viewBox="0 0 200 200" className="size-full -rotate-90" aria-hidden>
            <defs>
              <linearGradient id="clock-ring-emerald" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#14b8a6" />
              </linearGradient>
              <linearGradient id="clock-ring-rose" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#fb7185" />
                <stop offset="100%" stopColor="#f43f5e" />
              </linearGradient>
            </defs>
            <circle
              cx="100"
              cy="100"
              r="88"
              fill="none"
              stroke="rgb(255 255 255 / 0.07)"
              strokeWidth="10"
            />
            <motion.circle
              cx="100"
              cy="100"
              r="88"
              fill="none"
              stroke={finished ? 'url(#clock-ring-rose)' : 'url(#clock-ring-emerald)'}
              strokeWidth="10"
              strokeLinecap="round"
              initial={false}
              animate={{
                pathLength: frac,
                opacity: remaining === null && !finished ? 0.25 : 1,
              }}
              transition={{ type: 'spring', stiffness: 55, damping: 20 }}
              className={cn(finished && 'animate-pulse')}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {finished ? (
              <>
                <BellRing className="size-7 text-rose-300" aria-hidden />
                <p className="mt-1 text-2xl font-black tracking-tight text-rose-300">
                  Time&apos;s up
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Alarm rings for 20 s
                </p>
              </>
            ) : (
              <>
                <p
                  className={cn(
                    'font-mono text-4xl font-bold tracking-tight tabular-nums sm:text-5xl',
                    remaining === null && !running ? 'text-zinc-500' : 'text-zinc-50'
                  )}
                  aria-label={`Timer ${formatTimer(shownMs)}`}
                >
                  {formatTimer(shownMs)}
                </p>
                <p
                  className={cn(
                    'mt-1 text-[11px] font-semibold uppercase tracking-widest',
                    running
                      ? 'text-emerald-400'
                      : remaining !== null
                        ? 'text-amber-400'
                        : 'text-zinc-500'
                  )}
                >
                  {status}
                </p>
              </>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-3">
          {finished ? (
            <>
              <Button
                onClick={reset}
                className="h-12 gap-2 rounded-2xl bg-rose-500 px-6 font-bold text-white shadow-lg shadow-rose-500/25 hover:bg-rose-400"
                aria-label="Dismiss alarm"
              >
                <Check className="size-4" aria-hidden /> Dismiss
              </Button>
              <Button
                onClick={toggleRun}
                variant="outline"
                className="h-12 min-w-28 gap-2 rounded-2xl border-white/15 bg-white/5 font-bold hover:bg-white/10"
                aria-label="Restart timer"
              >
                <Play className="size-4" aria-hidden /> Restart
              </Button>
            </>
          ) : (
            <>
              <button
                onClick={reset}
                disabled={remaining === null}
                aria-label="Reset timer"
                className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RotateCcw className="size-5" aria-hidden />
              </button>
              <Button
                onClick={toggleRun}
                className={cn(
                  'h-12 min-w-36 gap-2 rounded-2xl text-base font-bold',
                  running
                    ? 'bg-white/10 text-zinc-100 hover:bg-white/15'
                    : 'bg-gradient-to-r from-emerald-400 to-teal-500 text-zinc-950 shadow-lg shadow-emerald-500/25 hover:from-emerald-300 hover:to-teal-400'
                )}
                aria-label={running ? 'Pause timer' : 'Start timer'}
              >
                {running ? (
                  <Pause className="size-5" aria-hidden />
                ) : (
                  <Play className="size-5" aria-hidden />
                )}
                {running ? 'Pause' : remaining !== null ? 'Resume' : 'Start'}
              </Button>
            </>
          )}
        </div>

        {needsDuration && (
          <p className="mt-3 text-center text-xs font-medium text-rose-300" role="alert">
            Set a duration above zero to start.
          </p>
        )}
      </div>

      {/* -------- Presets + manual duration -------- */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Quick presets
        </p>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Timer presets">
          {PRESETS.map((p) => {
            const activePreset = !inputsLocked && hours === 0 && minutes === p && seconds === 0
            return (
              <button
                key={p}
                onClick={() => applyPreset(p)}
                disabled={inputsLocked}
                aria-label={`Set ${p} minute timer`}
                aria-pressed={activePreset}
                className={cn(
                  'h-11 min-w-[3.25rem] rounded-xl border px-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  activePreset
                    ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
                )}
              >
                {p}m
              </button>
            )
          })}
        </div>

        <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Custom duration
        </p>
        <div className="mt-2 grid grid-cols-3 gap-3">
          {(
            [
              { id: 'timer-hours', label: 'Hours', value: hours, set: setHours, max: 99 },
              { id: 'timer-minutes', label: 'Minutes', value: minutes, set: setMinutes, max: 59 },
              { id: 'timer-seconds', label: 'Seconds', value: seconds, set: setSeconds, max: 59 },
            ] as const
          ).map((f) => (
            <div key={f.id} className="space-y-1.5">
              <label
                htmlFor={f.id}
                className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
              >
                {f.label}
              </label>
              <input
                id={f.id}
                type="number"
                inputMode="numeric"
                min={0}
                max={f.max}
                value={f.value}
                disabled={inputsLocked}
                onChange={(e) => changeInput(f.set, e.target.value, f.max)}
                className="h-12 w-full rounded-xl border border-white/10 bg-white/5 text-center font-mono text-lg font-bold tabular-nums text-zinc-100 outline-none transition-colors [appearance:textfield] [color-scheme:dark] focus:border-emerald-400/50 disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* ClockTool — default export                                          */
/* ================================================================== */

type TabId = 'clock' | 'stopwatch' | 'timer'

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'clock', label: 'Clock', icon: Clock },
  { id: 'stopwatch', label: 'Stopwatch', icon: Watch },
  { id: 'timer', label: 'Timer', icon: Hourglass },
]

export default function ClockTool() {
  const [tab, setTab] = useState<TabId>('clock')

  const switchTab = (t: TabId): void => {
    if (t === tab) return
    haptic()
    setTab(t)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header + pill switcher ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-slate-500/[0.12] via-transparent to-slate-600/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-500 via-slate-600 to-slate-800 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(71_85_105/0.8),inset_0_1px_1px_rgb(255_255_255/0.35)]">
              <Clock className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Clock</h2>
              <p className="text-xs text-zinc-400">
                World time, stopwatch and countdowns.
              </p>
            </div>
          </div>

          <div
            className="mt-5 flex rounded-2xl border border-white/10 bg-white/[0.04] p-1.5"
            role="tablist"
            aria-label="Clock tools"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`clock-tab-${t.id}`}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`clock-panel-${t.id}`}
                onClick={() => switchTab(t.id)}
                className={cn(
                  'relative flex h-11 flex-1 items-center justify-center rounded-xl text-sm font-bold transition-colors',
                  tab === t.id ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                )}
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="clock-tab-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.13] to-white/[0.06] shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <t.icon className="size-4" aria-hidden />
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* ---------------- Panels (kept mounted so state survives tab switches) ---------------- */}
        <div className="p-4 sm:p-5">
          {TABS.map((t) => (
            <motion.div
              key={t.id}
              id={`clock-panel-${t.id}`}
              role="tabpanel"
              aria-labelledby={`clock-tab-${t.id}`}
              initial={false}
              animate={{ opacity: tab === t.id ? 1 : 0, y: tab === t.id ? 0 : 10 }}
              transition={SPRING}
              className={cn(tab !== t.id && 'hidden')}
            >
              {t.id === 'clock' && <WorldClockTab active={tab === 'clock'} />}
              {t.id === 'stopwatch' && <StopwatchTab active={tab === 'stopwatch'} />}
              {t.id === 'timer' && <TimerTab />}
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
