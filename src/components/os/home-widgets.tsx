'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { CalendarDays, CloudSun, Flame, StickyNote, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLang } from '@/hooks/use-lang'
import { localizeDigits } from '@/lib/i18n'
import { useAppStore, type WidgetId } from '@/lib/store/app-store'

/* ================================================================== */
/* Home widgets (D72 + v2.1 widget packs). Cards above the launcher    */
/* grid on page 1 — every card reads on-device data only:              */
/*   clock    → Date                                                   */
/*   weather  → toolhub-weather IndexedDB cache                        */
/*   notes    → toolhub-notes localStorage (pinned sticky)             */
/*   calendar → toolhub.calendar.events (next events)                  */
/*   habits   → toolhub-habits IndexedDB (today + best streak)         */
/*   goals    → toolhub-goals:v1 (progress ring)                       */
/*                                                                     */
/* Which widgets appear — and in what order — is user state            */
/* (store.widgets, edited from Settings → Home widgets).               */
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

/* ---------------- v2.1: calendar / habits / goals readers ---------------- */

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface EventBits {
  title: string
  when: string
  color: string
}

/** Next two calendar events from today onward (toolhub.calendar.events). */
function readUpcomingEvents(): EventBits[] {
  try {
    const raw = localStorage.getItem('toolhub.calendar.events')
    if (!raw) return []
    const events = JSON.parse(raw) as Array<{ date: string; time: string; title: string; color?: string }>
    const today = todayKey()
    const dot: Record<string, string> = {
      red: 'bg-red-400',
      orange: 'bg-orange-400',
      amber: 'bg-amber-400',
      green: 'bg-green-400',
      teal: 'bg-teal-400',
      violet: 'bg-violet-400',
    }
    return events
      .filter((e) => e.date >= today)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .slice(0, 2)
      .map((e) => ({
        title: e.title,
        when: e.date === today ? (e.time ? `Today ${e.time}` : 'Today') : e.date.slice(5) + (e.time ? ` ${e.time}` : ''),
        color: dot[e.color ?? 'teal'] ?? 'bg-teal-400',
      }))
  } catch {
    return []
  }
}

/** Consecutive done-days ending today (or yesterday while today pends). */
function habitStreak(checks: Record<string, true>, today: string): number {
  let n = 0
  const d = new Date(today + 'T00:00:00')
  if (!checks[today]) d.setDate(d.getDate() - 1)
  for (;;) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (checks[key]) {
      n += 1
      d.setDate(d.getDate() - 1)
    } else break
  }
  return n
}

interface HabitBits {
  done: number
  total: number
  best: number
  color: string
}

function readHabits(): Promise<HabitBits | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('toolhub-habits', 1)
      req.onupgradeneeded = () => {
        /* fresh browser — the habits app will create the store on first run */
        try {
          if (!req.result.objectStoreNames.contains('habits')) {
            req.result.createObjectStore('habits', { keyPath: 'id' })
          }
        } catch {
          /* ignore */
        }
      }
      req.onsuccess = () => {
        try {
          const all = req.result.transaction('habits', 'readonly').objectStore('habits').getAll()
          all.onsuccess = () => {
            const habits = (all.result ?? []) as Array<{ name: string; color: string; checks: Record<string, true> }>
            if (habits.length === 0) return resolve(null)
            const today = todayKey()
            const done = habits.filter((h) => h.checks?.[today]).length
            const best = Math.max(...habits.map((h) => habitStreak(h.checks ?? {}, today)))
            const first = habits[0]
            resolve({ done, total: habits.length, best, color: first?.color ?? '#34d399' })
          }
          all.onerror = () => resolve(null)
        } catch {
          resolve(null)
        }
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

interface GoalBits {
  name: string
  emoji: string
  hex: string
  pct: number
  done: number
  target: number
}

const GOAL_HEX: Record<string, string> = {
  emerald: '#34d399',
  rose: '#fb7185',
  amber: '#fbbf24',
  violet: '#a78bfa',
  cyan: '#22d3ee',
  pink: '#f472b6',
}

/** First goal with a progress ratio for the current day/week window. */
function readGoal(): GoalBits | null {
  try {
    const raw = localStorage.getItem('toolhub-goals:v1')
    if (!raw) return null
    const goals = JSON.parse(raw) as Array<{
      name: string
      emoji: string
      colorId: string
      target: number
      period: 'day' | 'week'
      history: Record<string, number>
    }>
    if (goals.length === 0) return null
    const now = new Date()
    const today = todayKey()
    /* current week window (weeks start Sunday, matching the calendar app) */
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - now.getDay())
    const weekStartKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`
    const g = goals[0]
    const entries = Object.entries(g.history ?? {}).filter(([k]) => k >= weekStartKey)
    const done = g.period === 'day' ? (g.history?.[today] ?? 0) : entries.reduce((s, [, v]) => s + v, 0)
    const target = Math.max(1, g.target)
    return {
      name: g.name,
      emoji: g.emoji,
      hex: GOAL_HEX[g.colorId] ?? '#34d399',
      pct: Math.min(1, done / target),
      done,
      target,
    }
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

/* ---------------- card chrome ---------------- */

interface CardBits {
  onLight: boolean
  onOpenApp: (id: string, el?: HTMLElement | null) => void
}

function useCardCls(onLight: boolean) {
  return useMemo(
    () =>
      cn(
        'relative overflow-hidden rounded-[1.4rem] p-3 text-left ring-1 backdrop-blur-md sm:backdrop-blur-xl transition-transform active:scale-[0.97]',
        onLight
          ? 'bg-white/55 ring-black/[0.08] shadow-[0_10px_26px_-14px_rgb(0_0_0/0.3)]'
          : 'bg-white/[0.12] ring-white/20 shadow-[0_10px_26px_-14px_rgb(0_0_0/0.5)]'
      ),
    [onLight]
  )
}

/* ---------------- individual widgets ---------------- */

function ClockWidget({ bits }: { bits: CardBits & { now: Date | null; cls: string; titleCls: string; subCls: string } }) {
  const { t, lang } = useLang()
  const timeStr = bits.now
    ? localizeDigits(bits.now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }), lang)
    : '--:--'
  const dateStr = bits.now
    ? bits.now.toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : ''
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      onClick={(e) => bits.onOpenApp('clock', e.currentTarget)}
      aria-label={t('clockWidgetAria')}
      className={bits.cls}
    >
      <div className={cn('text-[10px] font-bold uppercase tracking-wider', bits.subCls)}>{t('widgetClock')}</div>
      <div className={cn('mt-1 text-2xl font-black tabular-nums leading-none', bits.titleCls)} suppressHydrationWarning>
        {timeStr}
      </div>
      <div className={cn('mt-1 truncate text-[10px] font-medium', bits.subCls)} suppressHydrationWarning>
        {dateStr}
      </div>
    </motion.button>
  )
}

function WeatherWidget({ bits, weather }: { bits: CardBits & { cls: string; titleCls: string; subCls: string }; weather: WeatherBits | null }) {
  const { t } = useLang()
  const wd = weather ? describeCode(weather.code) : null
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.04 }}
      onClick={(e) => bits.onOpenApp('weather', e.currentTarget)}
      aria-label={t('weatherWidgetAria')}
      className={bits.cls}
    >
      <div className={cn('text-[10px] font-bold uppercase tracking-wider', bits.subCls)}>{t('widgetWeather')}</div>
      {weather && wd ? (
        <>
          <div className={cn('mt-1 flex items-baseline gap-1 text-2xl font-black leading-none', bits.titleCls)}>
            {Math.round(weather.unit === 'f' ? weather.temp * 1.8 + 32 : weather.temp)}°
            <span className="text-base" aria-hidden>
              {wd.emoji}
            </span>
          </div>
          <div className={cn('mt-1 truncate text-[10px] font-medium', bits.subCls)}>
            {weather.city} · {wd.label}
          </div>
        </>
      ) : (
        <>
          <div className={cn('mt-1 flex items-center gap-1 text-2xl font-black leading-none', bits.titleCls)}>
            <CloudSun className="size-5 opacity-60" aria-hidden />
          </div>
          <div className={cn('mt-1 truncate text-[10px] font-medium', bits.subCls)}>{t('openForForecast')}</div>
        </>
      )}
    </motion.button>
  )
}

function NotesWidget({ bits, sticky }: { bits: CardBits & { cls: string; titleCls: string; subCls: string }; sticky: StickyBits | null }) {
  const { t } = useLang()
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.08 }}
      onClick={(e) => bits.onOpenApp('notes', e.currentTarget)}
      aria-label={t('notesWidgetAria')}
      className={bits.cls}
    >
      <div className={cn('flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider', bits.subCls)}>
        <StickyNote className="size-3" aria-hidden /> {t('widgetNotes')}
      </div>
      {sticky ? (
        <>
          <div className={cn('mt-1 truncate text-sm font-bold leading-tight', bits.titleCls)}>
            {sticky.title || t('untitledNote')}
          </div>
          <div className={cn('mt-0.5 line-clamp-2 text-[10px] leading-tight', bits.subCls)}>
            {sticky.body || t('emptyNote')}
          </div>
        </>
      ) : (
        <>
          <div className={cn('mt-1 text-sm font-bold leading-tight', bits.titleCls)}>{t('quickNote')}</div>
          <div className={cn('mt-0.5 text-[10px] leading-tight', bits.subCls)}>{t('tapToWrite')}</div>
        </>
      )}
    </motion.button>
  )
}

function CalendarWidget({ bits, events }: { bits: CardBits & { cls: string; titleCls: string; subCls: string }; events: EventBits[] }) {
  const { t } = useLang()
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.04 }}
      onClick={(e) => bits.onOpenApp('calendar', e.currentTarget)}
      aria-label={t('calendarWidgetAria')}
      className={bits.cls}
    >
      <div className={cn('flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider', bits.subCls)}>
        <CalendarDays className="size-3" aria-hidden /> {t('widgetCalendar')}
      </div>
      {events.length > 0 ? (
        <>
          <div className={cn('mt-1 flex items-center gap-1.5 truncate text-sm font-bold leading-tight', bits.titleCls)}>
            <span className={cn('size-1.5 shrink-0 rounded-full', events[0].color)} aria-hidden />
            {events[0].title}
          </div>
          <div className={cn('mt-0.5 truncate text-[10px] leading-tight', bits.subCls)}>
            {events[0].when}
            {events[1] ? ` · ${events[1].title}` : ''}
          </div>
        </>
      ) : (
        <>
          <div className={cn('mt-1 text-sm font-bold leading-tight', bits.titleCls)}>{t('widgetNoEvents')}</div>
          <div className={cn('mt-0.5 text-[10px] leading-tight', bits.subCls)}>{t('widgetTapToPlan')}</div>
        </>
      )}
    </motion.button>
  )
}

function HabitsWidget({ bits, habits }: { bits: CardBits & { cls: string; titleCls: string; subCls: string }; habits: HabitBits | null }) {
  const { t } = useLang()
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.08 }}
      onClick={(e) => bits.onOpenApp('habit-tracker', e.currentTarget)}
      aria-label={t('habitsWidgetAria')}
      className={bits.cls}
    >
      <div className={cn('flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider', bits.subCls)}>
        <Flame className="size-3" aria-hidden /> {t('widgetHabits')}
      </div>
      {habits ? (
        <>
          <div className={cn('mt-1 text-2xl font-black tabular-nums leading-none', bits.titleCls)} style={habits.color ? { color: habits.color } : undefined}>
            {localizeDigits(`${habits.done}/${habits.total}`, 'en')}
          </div>
          <div className={cn('mt-1 truncate text-[10px] font-medium', bits.subCls)}>
            {t('widgetBestStreak', { n: habits.best })}
          </div>
        </>
      ) : (
        <>
          <div className={cn('mt-1 text-sm font-bold leading-tight', bits.titleCls)}>{t('widgetNoHabits')}</div>
          <div className={cn('mt-0.5 text-[10px] leading-tight', bits.subCls)}>{t('widgetTapToStart')}</div>
        </>
      )}
    </motion.button>
  )
}

function GoalsWidget({ bits, goal }: { bits: CardBits & { cls: string; titleCls: string; subCls: string }; goal: GoalBits | null }) {
  const { t } = useLang()
  const R = 13
  const C = 2 * Math.PI * R
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: 0.12 }}
      onClick={(e) => bits.onOpenApp('goal-tracker', e.currentTarget)}
      aria-label={t('goalsWidgetAria')}
      className={bits.cls}
    >
      <div className={cn('flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider', bits.subCls)}>
        <Target className="size-3" aria-hidden /> {t('widgetGoals')}
      </div>
      {goal ? (
        <div className="mt-1 flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="size-8 shrink-0 -rotate-90" aria-hidden>
            <circle cx="16" cy="16" r={R} fill="none" strokeWidth="3.5" className={bits.onLight ? 'stroke-black/10' : 'stroke-white/15'} />
            <circle
              cx="16"
              cy="16"
              r={R}
              fill="none"
              strokeWidth="3.5"
              strokeLinecap="round"
              stroke={goal.hex}
              strokeDasharray={`${goal.pct * C} ${C}`}
            />
          </svg>
          <span className="min-w-0">
            <span className={cn('block truncate text-sm font-bold leading-tight', bits.titleCls)}>
              {goal.emoji} {goal.name}
            </span>
            <span className={cn('block text-[10px] leading-tight', bits.subCls)}>
              {t('widgetGoalProgress', { done: goal.done, target: goal.target })}
            </span>
          </span>
        </div>
      ) : (
        <>
          <div className={cn('mt-1 text-sm font-bold leading-tight', bits.titleCls)}>{t('widgetNoGoals')}</div>
          <div className={cn('mt-0.5 text-[10px] leading-tight', bits.subCls)}>{t('widgetTapToSet')}</div>
        </>
      )}
    </motion.button>
  )
}

/* ---------------- strip ---------------- */

export function WidgetStrip({ onOpenApp, onLight }: WidgetStripProps) {
  const now = useClock()
  const { t } = useLang()
  const widgets = useAppStore((s) => s.widgets)
  const [weather, setWeather] = useState<WeatherBits | null>(null)
  const [sticky, setSticky] = useState<StickyBits | null>(null)
  const [events, setEvents] = useState<EventBits[]>([])
  const [habits, setHabits] = useState<HabitBits | null>(null)
  const [goal, setGoal] = useState<GoalBits | null>(null)

  useEffect(() => {
    let alive = true
    void readWeather().then((w) => {
      if (alive) setWeather(w)
    })
    const t1 = setTimeout(() => {
      if (alive) {
        setSticky(readSticky())
        setEvents(readUpcomingEvents())
        setGoal(readGoal())
      }
    }, 0)
    void readHabits().then((h) => {
      if (alive) setHabits(h)
    })
    return () => {
      alive = false
      clearTimeout(t1)
    }
  }, [])

  const cls = useCardCls(onLight)
  const titleCls = onLight ? 'text-zinc-900' : 'text-white'
  const subCls = onLight ? 'text-zinc-600' : 'text-white/65'
  const bits = { onLight, onOpenApp, now, cls, titleCls, subCls }

  if (widgets.length === 0) return null

  return (
    <div className="mb-4 grid grid-cols-3 gap-2.5" role="group" aria-label={t('widgetGroup')}>
      {widgets.map((id: WidgetId) => {
        switch (id) {
          case 'clock':
            return <ClockWidget key={id} bits={bits} />
          case 'weather':
            return <WeatherWidget key={id} bits={bits} weather={weather} />
          case 'notes':
            return <NotesWidget key={id} bits={bits} sticky={sticky} />
          case 'calendar':
            return <CalendarWidget key={id} bits={bits} events={events} />
          case 'habits':
            return <HabitsWidget key={id} bits={bits} habits={habits} />
          case 'goals':
            return <GoalsWidget key={id} bits={bits} goal={goal} />
          default:
            return null
        }
      })}
    </div>
  )
}
