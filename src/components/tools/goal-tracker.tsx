'use client'

/**
 * Goal Tracker — build streaks that stick.
 *
 * Daily or weekly count targets, one-tap check-ins, flame streaks,
 * per-goal progress rings and a 28-day heatmap. Everything lives in
 * localStorage — private, offline, instantly available.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Flame, Minus, Plus, Target, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

interface Goal {
  id: string
  name: string
  emoji: string
  colorId: ColorId
  /** how many check-ins per day/week count as “done” */
  target: number
  period: 'day' | 'week'
  createdAt: number
  /** local date key 'YYYY-MM-DD' → count logged that day */
  history: Record<string, number>
}

const STORAGE_KEY = 'toolhub-goals:v1'

type ColorId = 'emerald' | 'rose' | 'amber' | 'violet' | 'cyan' | 'pink'

const GOAL_COLORS: { id: ColorId; hex: string; chip: string }[] = [
  { id: 'emerald', hex: '#34d399', chip: 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300' },
  { id: 'rose', hex: '#fb7185', chip: 'border-rose-400/40 bg-rose-500/15 text-rose-300' },
  { id: 'amber', hex: '#fbbf24', chip: 'border-amber-400/40 bg-amber-500/15 text-amber-300' },
  { id: 'violet', hex: '#a78bfa', chip: 'border-violet-400/40 bg-violet-500/15 text-violet-300' },
  { id: 'cyan', hex: '#22d3ee', chip: 'border-cyan-400/40 bg-cyan-500/15 text-cyan-300' },
  { id: 'pink', hex: '#f472b6', chip: 'border-pink-400/40 bg-pink-500/15 text-pink-300' },
]

const EMOJIS = ['🎯', '💪', '📚', '💧', '🏃', '🧘', '💻', '🌱', '🎨', '🙏', '💰', '😴']

function colorOf(id: ColorId): (typeof GOAL_COLORS)[number] {
  return GOAL_COLORS.find((c) => c.id === id) ?? GOAL_COLORS[0]
}

/* ---------------- date helpers (all local-time) ---------------- */

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function startOfToday(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function mondayOf(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

function weekKeysFor(monday: Date): string[] {
  const keys: string[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    keys.push(dateKey(d))
  }
  return keys
}

/* ---------------- metrics ---------------- */

function periodProgress(goal: Goal, today: Date): number {
  if (goal.period === 'day') return goal.history[dateKey(today)] ?? 0
  return weekKeysFor(mondayOf(today)).reduce((sum, k) => sum + (goal.history[k] ?? 0), 0)
}

function isDone(goal: Goal, today: Date): boolean {
  return periodProgress(goal, today) >= goal.target
}

function streakOf(goal: Goal, today: Date): number {
  const met = (cursor: Date): boolean => {
    if (goal.period === 'day') return (goal.history[dateKey(cursor)] ?? 0) >= goal.target
    const monday = mondayOf(cursor)
    return weekKeysFor(monday).reduce((s, k) => s + (goal.history[k] ?? 0), 0) >= goal.target
  }

  let streak = 0
  const cursor = new Date(today)
  // a not-yet-met today must not break yesterday's streak
  if (!met(cursor)) {
    if (goal.period === 'day') cursor.setDate(cursor.getDate() - 1)
    else cursor.setDate(cursor.getDate() - 7)
  }
  const stepDays = goal.period === 'day' ? 1 : 7
  while (streak < 3650 && met(cursor)) {
    streak++
    cursor.setDate(cursor.getDate() - stepDays)
  }
  return streak
}

/** last 28 day-keys ending today (oldest first) — for the heatmap */
function last28Days(today: Date): string[] {
  const keys: string[] = []
  for (let i = 27; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    keys.push(dateKey(d))
  }
  return keys
}

/* ================================================================== */
/* Persistence                                                         */
/* ================================================================== */

function readGoals(): Goal[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Goal[]
    return Array.isArray(parsed) ? parsed.filter((g) => g && typeof g.id === 'string') : []
  } catch {
    return []
  }
}

function useGoals() {
  // ssr:false dynamic import → window exists on first render; hydrate lazily
  const [goals, setGoals] = useState<Goal[]>(readGoals)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(goals))
    } catch {
      /* storage full — ignore */
    }
  }, [goals])

  return { goals, setGoals }
}

/* ================================================================== */
/* Small pieces                                                        */
/* ================================================================== */

function ProgressRing({
  fraction,
  hex,
  size = 56,
  stroke = 6,
  children,
}: {
  fraction: number
  hex: string
  size?: number
  stroke?: number
  children?: React.ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(1, fraction))
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={hex}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped)}
          style={{ transition: 'stroke-dashoffset 500ms cubic-bezier(0.32,0.72,0,1)' }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center">{children}</span>
    </span>
  )
}

function Heatmap({ goal, today }: { goal: Goal; today: Date }) {
  const days = useMemo(() => last28Days(today), [today])
  const hex = colorOf(goal.colorId).hex
  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Last 28 days</p>
      <div className="grid grid-flow-col grid-rows-7 gap-1" style={{ gridAutoColumns: '10px' }} aria-hidden>
        {days.map((k) => {
          const count = goal.history[k] ?? 0
          const done = count >= goal.target
          const partial = count > 0 && !done
          const isToday = k === dateKey(today)
          return (
            <span
              key={k}
              title={`${k} · ${count}`}
              className={cn('size-2.5 rounded-[3px]', isToday && 'ring-1 ring-white/50')}
              style={{
                backgroundColor: done ? hex : partial ? `${hex}55` : 'rgb(255 255 255 / 0.06)',
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function GoalTrackerApp() {
  const { toast } = useToast()
  const { goals, setGoals } = useGoals()
  const today = startOfToday()
  const todayKey = dateKey(today)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  /* ---------------- add-goal form ---------------- */
  const [formName, setFormName] = useState('')
  const [formEmoji, setFormEmoji] = useState(EMOJIS[0])
  const [formColor, setFormColor] = useState<ColorId>('emerald')
  const [formTarget, setFormTarget] = useState(1)
  const [formPeriod, setFormPeriod] = useState<'day' | 'week'>('day')

  const addGoal = useCallback(() => {
    const name = formName.trim()
    if (!name) {
      toast({ title: 'Give your goal a name first' })
      return
    }
    const goal: Goal = {
      id: `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name,
      emoji: formEmoji,
      colorId: formColor,
      target: Math.max(1, Math.min(99, formTarget)),
      period: formPeriod,
      createdAt: Date.now(),
      history: {},
    }
    setGoals((prev) => [goal, ...prev])
    setAddOpen(false)
    setFormName('')
    setFormEmoji(EMOJIS[0])
    setFormColor('emerald')
    setFormTarget(1)
    setFormPeriod('day')
    toast({ title: 'Goal created', description: `${goal.emoji} ${goal.name} — day one starts now.` })
  }, [formColor, formEmoji, formName, formPeriod, formTarget, setGoals, toast])

  const logGoal = useCallback(
    (id: string, delta: number) => {
      setGoals((prev) =>
        prev.map((g) => {
          if (g.id !== id) return g
          const current = g.history[todayKey] ?? 0
          const next = Math.max(0, current + delta)
          return { ...g, history: { ...g.history, [todayKey]: next } }
        })
      )
    },
    [setGoals, todayKey]
  )

  const toggleDone = useCallback(
    (goal: Goal) => {
      const done = isDone(goal, today)
      // check = fill today up to the target, uncheck = clear today completely
      setGoals((prev) =>
        prev.map((g) => {
          if (g.id !== goal.id) return g
          const history = { ...g.history }
          if (done) delete history[todayKey]
          else history[todayKey] = g.target
          return { ...g, history }
        })
      )
      if (!done) {
        try {
          navigator.vibrate?.(12)
        } catch {
          /* haptics unsupported */
        }
      }
    },
    [setGoals, today, todayKey]
  )

  const removeGoal = useCallback(
    (id: string) => {
      setGoals((prev) => prev.filter((g) => g.id !== id))
      setConfirmDeleteId(null)
      toast({ title: 'Goal deleted' })
    },
    [setGoals, toast]
  )

  /* ---------------- header stats ---------------- */
  const doneCount = goals.filter((g) => isDone(g, today)).length
  const overallFraction = goals.length > 0 ? doneCount / goals.length : 0
  const bestStreak = goals.reduce((max, g) => Math.max(max, streakOf(g, today)), 0)

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-emerald-500/[0.08] via-transparent to-teal-500/[0.06] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-teal-300 via-emerald-500 to-green-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(45_212_191/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Target className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Goal Tracker</h2>
              <p className="text-xs text-zinc-400">Small wins, every day — streaks do the rest.</p>
            </div>
            <Button
              onClick={() => setAddOpen(true)}
              className="h-10 shrink-0 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
            >
              <Plus className="size-4" aria-hidden /> Goal
            </Button>
          </div>

          {goals.length > 0 && (
            <div className="mt-5 flex items-center gap-5">
              <div className="flex items-center gap-3">
                <ProgressRing fraction={overallFraction} hex="#34d399" size={52}>
                  <span className="text-[11px] font-bold tabular-nums">
                    {doneCount}/{goals.length}
                  </span>
                </ProgressRing>
                <div className="text-xs">
                  <p className="font-semibold text-zinc-200">
                    {doneCount === goals.length ? 'All done today — legendary.' : 'Done today'}
                  </p>
                  <p className="text-zinc-500">
                    {doneCount === goals.length ? 'Every goal checked in.' : `${goals.length - doneCount} still open`}
                  </p>
                </div>
              </div>
              {bestStreak > 0 && (
                <div className="ml-auto flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2">
                  <Flame className={cn('size-4 text-amber-400', bestStreak >= 3 && 'animate-pulse')} aria-hidden />
                  <div className="text-xs">
                    <p className="font-bold tabular-nums text-amber-200">{bestStreak}</p>
                    <p className="text-[10px] text-amber-200/70">best streak</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---------------- Goal list ---------------- */}
        <div className="space-y-3 p-4 sm:p-5">
          {goals.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-14 text-center">
              <Target className="size-10 text-zinc-600" aria-hidden />
              <p className="text-sm font-semibold text-zinc-300">No goals yet</p>
              <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                Pick one thing that matters — water, workouts, pages, prayers. Check in daily and watch the
                streak grow.
              </p>
              <Button
                onClick={() => setAddOpen(true)}
                className="mt-1 h-11 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 hover:from-teal-200 hover:to-emerald-400"
              >
                <Plus className="size-4" aria-hidden /> Create your first goal
              </Button>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {goals.map((g) => {
                const progress = periodProgress(g, today)
                const done = isDone(g, today)
                const streak = streakOf(g, today)
                const fraction = Math.min(1, progress / Math.max(1, g.target))
                const hex = colorOf(g.colorId)
                const expanded = expandedId === g.id
                const confirming = confirmDeleteId === g.id
                return (
                  <motion.div
                    key={g.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 30 }}
                    className={cn(
                      'rounded-2xl border bg-white/[0.03] p-4 transition-colors',
                      done ? 'border-white/[0.06]' : 'border-white/10'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <ProgressRing fraction={fraction} hex={hex.hex}>
                        <span className="text-lg" aria-hidden>
                          {done ? '✅' : g.emoji}
                        </span>
                      </ProgressRing>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={cn('truncate text-sm font-bold', done && 'text-zinc-400 line-through')}>
                            {g.name}
                          </p>
                          {streak > 0 && (
                            <Badge variant="outline" className={cn('gap-1 border-white/10 px-1.5 text-[10px] tabular-nums', hex.chip)}>
                              <Flame className="size-3" aria-hidden /> {streak}
                            </Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-zinc-500">
                          {g.period === 'day' ? 'Daily' : 'Weekly'} · {Math.min(progress, g.target)}/{g.target}{' '}
                          {done ? '· done' : '· in progress'}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {g.target === 1 ? (
                          <motion.button
                            whileTap={{ scale: 0.88 }}
                            onClick={() => toggleDone(g)}
                            aria-pressed={done}
                            aria-label={done ? `Uncheck ${g.name}` : `Check in ${g.name}`}
                            className={cn(
                              'flex size-11 items-center justify-center rounded-full transition-all',
                              done
                                ? 'text-zinc-950 shadow-lg'
                                : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                            )}
                            style={done ? { backgroundColor: hex.hex } : undefined}
                          >
                            <Check className="size-5" strokeWidth={3} aria-hidden />
                          </motion.button>
                        ) : (
                          <>
                            <button
                              onClick={() => logGoal(g.id, -1)}
                              disabled={(g.history[todayKey] ?? 0) <= 0}
                              aria-label={`Remove one check-in from ${g.name}`}
                              className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-30"
                            >
                              <Minus className="size-4" aria-hidden />
                            </button>
                            <motion.button
                              whileTap={{ scale: 0.88 }}
                              onClick={() => logGoal(g.id, 1)}
                              aria-label={`Check in ${g.name}`}
                              className="flex size-11 items-center justify-center rounded-full text-zinc-950 shadow-lg"
                              style={{ backgroundColor: hex.hex }}
                            >
                              <Plus className="size-5" strokeWidth={3} aria-hidden />
                            </motion.button>
                          </>
                        )}
                        <button
                          onClick={() => setExpandedId(expanded ? null : g.id)}
                          aria-expanded={expanded}
                          aria-label={`${expanded ? 'Hide' : 'Show'} history for ${g.name}`}
                          className="ml-0.5 flex size-8 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className={cn('size-4 transition-transform', expanded && 'rotate-180')}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            aria-hidden
                          >
                            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <button
                          onClick={() => (confirming ? void removeGoal(g.id) : setConfirmDeleteId(g.id))}
                          aria-label={confirming ? `Confirm delete ${g.name}` : `Delete ${g.name}`}
                          className={cn(
                            'flex size-8 items-center justify-center rounded-full transition-colors',
                            confirming
                              ? 'bg-rose-500 text-white'
                              : 'text-zinc-600 hover:bg-rose-500/15 hover:text-rose-300'
                          )}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>

                    <AnimatePresence>
                      {expanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                          className="overflow-hidden"
                        >
                          <Heatmap goal={g} today={today} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          )}
        </div>
      </motion.div>

      {/* ---------------- Add-goal modal ---------------- */}
      <AnimatePresence>
        {addOpen && (
          <motion.div
            key="add-goal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setAddOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Create a goal"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
                  <Target className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">New goal</h3>
                <button
                  onClick={() => setAddOpen(false)}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="goal-name" className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Name
                  </label>
                  <input
                    id="goal-name"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addGoal()
                    }}
                    placeholder="e.g. Drink water, Read 10 pages"
                    maxLength={60}
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-400/50 focus:outline-none"
                  />
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Icon</p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Goal icon">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        onClick={() => setFormEmoji(e)}
                        role="radio"
                        aria-checked={formEmoji === e}
                        className={cn(
                          'flex size-10 items-center justify-center rounded-xl border text-lg transition-all',
                          formEmoji === e
                            ? 'border-emerald-400/60 bg-emerald-500/15 shadow-md'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        )}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Color</p>
                  <div className="flex gap-2" role="radiogroup" aria-label="Goal color">
                    {GOAL_COLORS.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setFormColor(c.id)}
                        role="radio"
                        aria-checked={formColor === c.id}
                        aria-label={c.id}
                        className={cn(
                          'size-9 rounded-full transition-transform',
                          formColor === c.id ? 'scale-110 ring-2 ring-white/70 ring-offset-2 ring-offset-zinc-950' : 'hover:scale-105'
                        )}
                        style={{ backgroundColor: c.hex }}
                      />
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Repeat</p>
                    <div className="flex rounded-xl border border-white/10 bg-white/5 p-1" role="radiogroup" aria-label="Repeat period">
                      {(['day', 'week'] as const).map((p) => (
                        <button
                          key={p}
                          onClick={() => setFormPeriod(p)}
                          role="radio"
                          aria-checked={formPeriod === p}
                          className={cn(
                            'h-8 flex-1 rounded-lg text-xs font-semibold transition-all',
                            formPeriod === p ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-300 hover:bg-white/5'
                          )}
                        >
                          {p === 'day' ? 'Daily' : 'Weekly'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Target / {formPeriod === 'day' ? 'day' : 'week'}
                    </p>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-1">
                      <button
                        onClick={() => setFormTarget((t) => Math.max(1, t - 1))}
                        aria-label="Decrease target"
                        className="flex size-8 items-center justify-center rounded-lg text-zinc-300 hover:bg-white/10"
                      >
                        <Minus className="size-4" aria-hidden />
                      </button>
                      <span className="flex-1 text-center text-sm font-bold tabular-nums">{formTarget}</span>
                      <button
                        onClick={() => setFormTarget((t) => Math.min(99, t + 1))}
                        aria-label="Increase target"
                        className="flex size-8 items-center justify-center rounded-lg text-zinc-300 hover:bg-white/10"
                      >
                        <Plus className="size-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                </div>

                <Button
                  onClick={addGoal}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
                >
                  Create goal
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
