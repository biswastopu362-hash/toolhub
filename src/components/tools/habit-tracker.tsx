'use client'

/**
 * Habit Tracker — small streaks, big change.
 *
 * Create daily habits, tap a big check each day, and watch the fire grow.
 * Current streaks (with a graceful "today isn't over yet" rule), week dots,
 * a 30-day heatmap per habit and a live today-progress ring. Everything
 * persists in IndexedDB — private, offline, instant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  Flame,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

interface Habit {
  id: string
  name: string
  emoji: string
  /** accent hex from PALETTE, used for tiles, dots and the heatmap */
  color: string
  createdAt: number
  /** local date keys 'YYYY-MM-DD' that were completed */
  checks: Record<string, true>
}

const EMOJIS = [
  '🔥', '💧', '🏃', '💪', '🧘', '📚', '✍️', '🌅',
  '🥗', '💊', '😴', '🚭', '🧹', '💰', '🎸', '🎯',
] as const

const PALETTE = [
  '#f59e0b', // amber
  '#f97316', // orange
  '#ef4444', // red
  '#f43f5e', // rose
  '#ec4899', // pink
  '#a855f7', // violet
  '#14b8a6', // teal
  '#10b981', // emerald
  '#84cc16', // lime
  '#eab308', // yellow
] as const

/** streak lengths that earn a celebration toast */
const MILESTONES = [3, 7, 14, 21, 30, 50, 100, 200, 365]

/* ---------------- date helpers (all local-time) ---------------- */

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** trailing window of n local date keys, oldest first, ending today */
function lastNDays(n: number, todayKey: string): string[] {
  const out: string[] = []
  const base = parseKey(todayKey)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(base.getDate() - i)
    out.push(dateKey(d))
  }
  return out
}

function shortDay(key: string): string {
  return parseKey(key).toLocaleDateString('en-US', { weekday: 'narrow' })
}

/* ---------------- streak logic ---------------- */

/**
 * Consecutive days ending today — or ending yesterday while today is still
 * pending, so an unfinished day never breaks a live streak.
 */
function currentStreak(checks: Record<string, true>, todayKey: string): number {
  let n = 0
  const d = parseKey(todayKey)
  if (!checks[dateKey(d)]) d.setDate(d.getDate() - 1)
  while (checks[dateKey(d)]) {
    n++
    d.setDate(d.getDate() - 1)
  }
  return n
}

/** longest run of consecutive days ever recorded for a habit */
function bestStreak(checks: Record<string, true>): number {
  const keys = Object.keys(checks).sort()
  let best = 0
  let run = 0
  let prev: Date | null = null
  for (const k of keys) {
    if (prev) {
      const next = new Date(prev)
      next.setDate(prev.getDate() + 1)
      run = dateKey(next) === k ? run + 1 : 1
    } else {
      run = 1
    }
    if (run > best) best = run
    prev = parseKey(k)
  }
  return best
}

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

/* ================================================================== */
/* IndexedDB — habits, fully on-device                                 */
/* ================================================================== */

const DB_NAME = 'toolhub-habits'
const DB_VERSION = 1
const HABIT_STORE = 'habits'

let dbPromise: Promise<IDBDatabase> | null = null

function openHabitDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(HABIT_STORE)) {
        d.createObjectStore(HABIT_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openHabitDb()
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

/** Thin glass scrollbar for long lists. */
const SCROLL_CLS =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

function ProgressRing({ frac, done, total }: { frac: number; done: number; total: number }) {
  const R = 30
  const C = 2 * Math.PI * R
  return (
    <div className="relative size-[4.5rem] shrink-0">
      <svg viewBox="0 0 76 76" className="size-full -rotate-0">
        <defs>
          <linearGradient id="ht-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fcd34d" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        <circle cx="38" cy="38" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="7" />
        <motion.circle
          cx="38"
          cy="38"
          r={R}
          fill="none"
          stroke="url(#ht-ring)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - Math.min(Math.max(frac, 0), 1)) }}
          transition={{ type: 'spring', stiffness: 60, damping: 20 }}
          transform="rotate(-90 38 38)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-black leading-none tabular-nums text-zinc-100">
          {done}
          <span className="text-zinc-500">/{total}</span>
        </span>
        <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">today</span>
      </div>
    </div>
  )
}

function WeekDots({ checks, weekKeys, color }: { checks: Record<string, true>; weekKeys: string[]; color: string }) {
  return (
    <div className="flex items-end gap-1" aria-hidden>
      {weekKeys.map((k) => {
        const done = !!checks[k]
        const isToday = k === weekKeys[weekKeys.length - 1]
        return (
          <span
            key={k}
            title={`${k}${done ? ' · done' : ''}`}
            className={cn(
              'size-2 rounded-full transition-colors',
              !done && (isToday ? 'ring-1 ring-white/50' : 'bg-white/10')
            )}
            style={done ? { backgroundColor: color } : undefined}
          />
        )
      })}
    </div>
  )
}

function Heatmap({ checks, days, color, todayKey }: { checks: Record<string, true>; days: string[]; color: string; todayKey: string }) {
  return (
    <div className="grid grid-cols-10 gap-1.5" role="img" aria-label="Last 30 days heatmap">
      {days.map((k) => {
        const done = !!checks[k]
        const isToday = k === todayKey
        return (
          <span
            key={k}
            title={`${parseKey(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}${done ? ' · done' : ''}`}
            className={cn(
              'aspect-square rounded-[5px] transition-colors',
              done ? 'shadow-[inset_0_1px_1px_rgb(255_255_255/0.25)]' : 'bg-white/[0.06]',
              isToday && 'ring-2 ring-amber-300/80 ring-offset-1 ring-offset-zinc-950'
            )}
            style={done ? { backgroundColor: color } : undefined}
          />
        )
      })}
    </div>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function HabitTrackerApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [habits, setHabits] = useState<Habit[]>([])
  const [loaded, setLoaded] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  /* ---------------- form ---------------- */
  const [formName, setFormName] = useState('')
  const [formEmoji, setFormEmoji] = useState<string>(EMOJIS[0])
  const [formColor, setFormColor] = useState<string>(PALETTE[0])
  const nameRef = useRef<HTMLInputElement>(null)
  const confirmTimer = useRef<number | null>(null)

  const today = useMemo(() => new Date(), [])
  const todayKey = dateKey(today)
  const weekKeys = useMemo(() => lastNDays(7, todayKey), [todayKey])
  const heatDays = useMemo(() => lastNDays(30, todayKey), [todayKey])

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const all = await idbGetAll<Habit>(HABIT_STORE)
        if (!alive) return
        setHabits(all.sort((a, b) => a.createdAt - b.createdAt))
      } catch {
        /* private mode / quota — keep in-memory data */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    return () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    }
  }, [])

  /* ---------------- mutations (write-through to IndexedDB) ---------------- */
  const putHabit = useCallback((h: Habit) => {
    setHabits((prev) => {
      const idx = prev.findIndex((x) => x.id === h.id)
      if (idx === -1) return [...prev, h]
      return prev.map((x) => (x.id === h.id ? h : x))
    })
    void idbPut(HABIT_STORE, h).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const removeHabit = useCallback(
    (id: string) => {
      const target = habits.find((h) => h.id === id)
      setHabits((prev) => prev.filter((h) => h.id !== id))
      setConfirmDeleteId(null)
      setExpandedId((cur) => (cur === id ? null : cur))
      void idbDelete(HABIT_STORE, id).catch(() => {
        /* memory-only fallback */
      })
      haptic()
      toast({ title: 'Habit deleted', description: target ? `${target.emoji} ${target.name}` : undefined })
    },
    [habits, toast]
  )

  const armDelete = useCallback((id: string) => {
    setConfirmDeleteId(id)
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    confirmTimer.current = window.setTimeout(() => setConfirmDeleteId(null), 2600)
  }, [])

  /* ---------------- check toggle ---------------- */
  const toggleToday = useCallback(
    (h: Habit) => {
      const wasDone = !!h.checks[todayKey]
      let next: Habit
      if (wasDone) {
        const checks = { ...h.checks }
        delete checks[todayKey]
        next = { ...h, checks }
      } else {
        next = { ...h, checks: { ...h.checks, [todayKey]: true } }
      }
      putHabit(next)
      haptic(wasDone ? 8 : 14)
      if (!wasDone) {
        const streak = currentStreak(next.checks, todayKey)
        if (MILESTONES.includes(streak)) {
          toast({
            title: `${streak}-day streak! 🔥`,
            description: `${h.emoji} ${h.name} — keep the fire going.`,
          })
          haptic([30, 60, 30])
        }
      }
    },
    [putHabit, todayKey, toast]
  )

  /* ---------------- form actions ---------------- */
  const openAdd = useCallback(() => {
    setEditingId(null)
    setFormName('')
    setFormEmoji(EMOJIS[0])
    setFormColor(PALETTE[0])
    setFormOpen(true)
    window.setTimeout(() => nameRef.current?.focus(), 140)
  }, [])

  const openEdit = useCallback((h: Habit) => {
    setEditingId(h.id)
    setFormName(h.name)
    setFormEmoji(h.emoji)
    setFormColor(h.color)
    setFormOpen(true)
    window.setTimeout(() => nameRef.current?.focus(), 140)
  }, [])

  const submitForm = useCallback(() => {
    const name = formName.trim()
    if (!name) {
      toast({ title: 'Give your habit a name' })
      return
    }
    if (editingId) {
      const existing = habits.find((h) => h.id === editingId)
      if (existing) {
        putHabit({ ...existing, name, emoji: formEmoji, color: formColor })
        toast({ title: 'Habit updated', description: `${formEmoji} ${name}` })
      }
    } else {
      putHabit({
        id: `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        emoji: formEmoji,
        color: formColor,
        createdAt: Date.now(),
        checks: {},
      })
      toast({ title: 'Habit created', description: `${formEmoji} ${name} — day 1 starts now.` })
    }
    haptic()
    setFormOpen(false)
  }, [editingId, formColor, formEmoji, formName, habits, putHabit, toast])

  /* ---------------- derived ---------------- */
  const doneToday = habits.filter((h) => !!h.checks[todayKey]).length
  const frac = habits.length > 0 ? doneToday / habits.length : 0
  const longestCurrent = useMemo(
    () => habits.reduce((max, h) => Math.max(max, currentStreak(h.checks, todayKey)), 0),
    [habits, todayKey]
  )
  const allDone = habits.length > 0 && doneToday === habits.length

  const todayLabel = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

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
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-amber-500/[0.1] via-transparent to-orange-600/[0.08] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-300 via-orange-400 to-orange-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(249_115_22/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Flame className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Habit Tracker</h2>
              <p className="text-xs text-zinc-400">Small streaks, big change.</p>
            </div>
            <Button
              onClick={openAdd}
              className="h-10 shrink-0 rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-200 hover:to-orange-400"
            >
              <Plus className="size-4" aria-hidden /> Add
            </Button>
          </div>
          <p className="mt-3 text-[11px] font-medium text-zinc-500">{todayLabel}</p>
        </div>

        {!loaded ? (
          /* ---------------- Hydrating ---------------- */
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
            ))}
          </div>
        ) : (
          <div className="space-y-5 p-4 sm:p-5">
            {/* ---------------- Stats header ---------------- */}
            <div
              className={cn(
                'flex items-center gap-4 rounded-2xl border border-white/10 bg-gradient-to-br from-amber-500/[0.08] to-orange-500/[0.05] p-4',
                allDone && 'border-amber-400/30'
              )}
            >
              <ProgressRing frac={frac} done={doneToday} total={habits.length} />
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Habits done today
                  </p>
                  <p className="text-xs font-bold tabular-nums text-amber-300">
                    {habits.length > 0 ? Math.round(frac * 100) : 0}%
                  </p>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(frac, 1) * 100}%` }}
                    transition={{ type: 'spring', stiffness: 80, damping: 20 }}
                  />
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="flex items-center gap-1 rounded-lg border border-orange-400/20 bg-orange-500/10 px-2 py-1 font-semibold text-orange-300">
                    <Flame className="size-3.5" aria-hidden />
                    Longest streak
                    <span className="tabular-nums">{longestCurrent}d</span>
                  </span>
                  {allDone && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 20 }}
                      className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-amber-300"
                    >
                      <Sparkles className="size-3.5" aria-hidden /> All done — see you tomorrow
                    </motion.span>
                  )}
                </div>
              </div>
            </div>

            {/* ---------------- Empty state ---------------- */}
            {habits.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-10 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300/20 to-orange-500/20 text-amber-300 ring-1 ring-white/10">
                  <Flame className="size-7" aria-hidden />
                </span>
                <p className="mt-3 text-sm font-semibold text-zinc-300">No habits yet</p>
                <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
                  Pick one small thing you can do every day. Streaks build themselves — one check at a
                  time. Everything stays on this device.
                </p>
                <Button
                  onClick={openAdd}
                  className="mt-4 h-11 rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 font-semibold text-zinc-950 hover:from-amber-200 hover:to-orange-400"
                >
                  <Plus className="size-4" aria-hidden /> Create your first habit
                </Button>
              </div>
            ) : (
              /* ---------------- Today list ---------------- */
              <div className={cn('max-h-96 space-y-2 overflow-y-auto pr-1', SCROLL_CLS)}>
                <AnimatePresence initial={false}>
                  {habits.map((h) => {
                    const done = !!h.checks[todayKey]
                    const streak = currentStreak(h.checks, todayKey)
                    const expanded = expandedId === h.id
                    const confirming = confirmDeleteId === h.id
                    return (
                      <motion.div
                        key={h.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                        className={cn(
                          'overflow-hidden rounded-2xl border bg-white/[0.03] transition-colors',
                          expanded ? 'border-white/20 bg-white/[0.05]' : 'border-white/10'
                        )}
                      >
                        {/* row header */}
                        <div className="flex items-center gap-2 p-2.5">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expanded ? null : h.id)}
                            aria-expanded={expanded}
                            aria-label={`${expanded ? 'Hide' : 'Show'} 30-day history for ${h.name}`}
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 text-left transition-colors hover:bg-white/[0.03]"
                          >
                            <span
                              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-xl ring-1 ring-white/10"
                              style={{ backgroundColor: `${h.color}22` }}
                              aria-hidden
                            >
                              {h.emoji}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2">
                                <span className="truncate text-sm font-semibold text-zinc-100">{h.name}</span>
                                {streak > 0 && (
                                  <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-bold text-orange-300">
                                    <Flame className="size-3.5" aria-hidden />
                                    {streak}
                                  </span>
                                )}
                              </span>
                              <span className="mt-1 flex items-center gap-2.5">
                                <WeekDots checks={h.checks} weekKeys={weekKeys} color={h.color} />
                                <span className="text-[10px] text-zinc-600">last 7 days</span>
                              </span>
                            </span>
                            <ChevronDown
                              className={cn(
                                'size-4 shrink-0 text-zinc-500 transition-transform duration-200',
                                expanded && 'rotate-180'
                              )}
                              aria-hidden
                            />
                          </button>
                          {/* big check */}
                          <motion.button
                            type="button"
                            whileTap={{ scale: 0.82 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                            onClick={() => toggleToday(h)}
                            aria-pressed={done}
                            aria-label={done ? `Undo today for ${h.name}` : `Mark ${h.name} done today`}
                            className={cn(
                              'flex size-12 shrink-0 items-center justify-center rounded-full border transition-colors',
                              done
                                ? 'border-transparent text-zinc-950 shadow-[0_8px_20px_-6px_rgb(0_0_0/0.5)]'
                                : 'border-white/15 bg-white/5 text-zinc-500 hover:border-white/25 hover:text-zinc-300'
                            )}
                            style={done ? { backgroundColor: h.color } : undefined}
                          >
                            <Check className="size-6" strokeWidth={3} aria-hidden />
                          </motion.button>
                        </div>

                        {/* expanded detail */}
                        <AnimatePresence initial={false}>
                          {expanded && (
                            <motion.div
                              key="detail"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
                              className="overflow-hidden"
                            >
                              <div className="space-y-3 border-t border-white/10 px-3 pb-3 pt-3">
                                <div className="flex items-center justify-between">
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                    Last 30 days
                                  </p>
                                  <p className="text-[10px] text-zinc-600">
                                    {parseKey(heatDays[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                    {' — '}
                                    {parseKey(heatDays[heatDays.length - 1]).toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                    })}
                                  </p>
                                </div>
                                <Heatmap checks={h.checks} days={heatDays} color={h.color} todayKey={todayKey} />
                                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                                  <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-zinc-300">
                                    🔥 Best <span className="tabular-nums">{bestStreak(h.checks)}d</span>
                                  </span>
                                  <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-zinc-300">
                                    ✅ Total <span className="tabular-nums">{Object.keys(h.checks).length}</span>
                                  </span>
                                  <span className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-zinc-300">
                                    Week{' '}
                                    <span className="tabular-nums">
                                      {weekKeys.filter((k) => !!h.checks[k]).length}/7
                                    </span>
                                  </span>
                                  <span className="ml-auto flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openEdit(h)}
                                      className="flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                                    >
                                      <Pencil className="size-3.5" aria-hidden /> Edit
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => (confirming ? removeHabit(h.id) : armDelete(h.id))}
                                      aria-label={confirming ? `Confirm delete ${h.name}` : `Delete ${h.name}`}
                                      className={cn(
                                        'flex h-9 items-center gap-1.5 rounded-lg border px-2.5 font-semibold transition-colors',
                                        confirming
                                          ? 'border-rose-400/40 bg-rose-500 text-white'
                                          : 'border-white/10 bg-white/[0.04] text-zinc-400 hover:border-rose-400/30 hover:bg-rose-500/10 hover:text-rose-300'
                                      )}
                                    >
                                      <Trash2 className="size-3.5" aria-hidden />
                                      {confirming ? 'Sure?' : 'Delete'}
                                    </button>
                                  </span>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            )}

            {habits.length > 0 && (
              <p className="px-1 text-center text-[10px] leading-relaxed text-zinc-600">
                Tap a row for the 30-day heatmap · checks save instantly on this device
              </p>
            )}
          </div>
        )}
      </motion.div>

      {/* ---------------- Add / edit habit modal ---------------- */}
      <AnimatePresence>
        {formOpen && (
          <motion.div
            key="habit-form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setFormOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? 'Edit habit' : 'New habit'}
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                  <Flame className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">{editingId ? 'Edit habit' : 'New habit'}</h3>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              {/* live preview */}
              <div className="mb-4 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-xl ring-1 ring-white/10 transition-colors"
                  style={{ backgroundColor: `${formColor}22` }}
                  aria-hidden
                >
                  {formEmoji}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200">
                  {formName.trim() || 'Your new habit'}
                </p>
              </div>

              {/* name */}
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Name
              </label>
              <input
                ref={nameRef}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitForm()
                }}
                placeholder="e.g. Morning run"
                maxLength={40}
                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 [color-scheme:dark] focus:border-amber-400/50 focus:outline-none"
              />

              {/* emoji picker */}
              <p className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Icon
              </p>
              <div className="grid grid-cols-8 gap-1.5">
                {EMOJIS.map((e) => (
                  <motion.button
                    key={e}
                    type="button"
                    whileTap={{ scale: 0.85 }}
                    onClick={() => {
                      setFormEmoji(e)
                      haptic()
                    }}
                    aria-pressed={formEmoji === e}
                    aria-label={`Icon ${e}`}
                    className={cn(
                      'flex h-11 items-center justify-center rounded-xl text-lg transition-colors',
                      formEmoji === e
                        ? 'bg-amber-400/20 ring-2 ring-amber-300/70'
                        : 'bg-white/[0.04] ring-1 ring-white/10 hover:bg-white/10'
                    )}
                  >
                    {e}
                  </motion.button>
                ))}
              </div>

              {/* color palette */}
              <p className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Color
              </p>
              <div className="flex flex-wrap gap-2">
                {PALETTE.map((c) => (
                  <motion.button
                    key={c}
                    type="button"
                    whileTap={{ scale: 0.85 }}
                    onClick={() => {
                      setFormColor(c)
                      haptic()
                    }}
                    aria-pressed={formColor === c}
                    aria-label={`Color ${c}`}
                    className={cn(
                      'flex size-9 items-center justify-center rounded-full ring-1 ring-white/15 transition-shadow',
                      formColor === c && 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950'
                    )}
                    style={{ backgroundColor: c }}
                  >
                    {formColor === c && <Check className="size-4 text-white/90 drop-shadow" strokeWidth={3} aria-hidden />}
                  </motion.button>
                ))}
              </div>

              {/* actions */}
              <div className="mt-5 flex gap-2">
                <Button
                  onClick={() => setFormOpen(false)}
                  variant="outline"
                  className="h-11 flex-1 rounded-xl border-white/10 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitForm}
                  className="h-11 flex-[1.4] rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 font-semibold text-zinc-950 hover:from-amber-200 hover:to-orange-400"
                >
                  <Check className="size-4" aria-hidden /> {editingId ? 'Save changes' : 'Create habit'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
