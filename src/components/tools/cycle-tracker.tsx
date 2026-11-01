'use client'

/**
 * Cycle Tracker — a private period & cycle companion.
 *
 * Log periods (start + optional end), browse a paged month calendar with
 * period days, predicted next period, fertile window and ovulation estimate,
 * and keep a small daily journal (note + mood + flow) behind any tap. The
 * average cycle length is learned from the last up-to-6 logged cycles and
 * powers all predictions. Everything persists in IndexedDB — private,
 * offline, instant, never uploaded.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CalendarClock,
  CalendarDays,
  CalendarHeart,
  Check,
  ChevronLeft,
  ChevronRight,
  Droplet,
  Flower2,
  Heart,
  Minus,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type Mood = 'none' | 'calm' | 'happy' | 'tired' | 'cramps'
type Flow = 'none' | 'light' | 'medium' | 'heavy'

interface Period {
  id: string
  /** local date key 'YYYY-MM-DD' */
  start: string
  /** optional local date key — missing means "ongoing" */
  end?: string
  createdAt: number
}

interface DayEntry {
  /** local date key 'YYYY-MM-DD' — also the store key */
  date: string
  note: string
  mood: Mood
  flow: Flow
}

interface SettingRow {
  key: string
  value: { dismissed?: boolean }
}

const MOODS: { id: Mood; label: string; emoji: string }[] = [
  { id: 'calm', label: 'Calm', emoji: '😌' },
  { id: 'happy', label: 'Happy', emoji: '😊' },
  { id: 'tired', label: 'Tired', emoji: '😴' },
  { id: 'cramps', label: 'Cramps', emoji: '😣' },
  { id: 'none', label: 'None', emoji: '' },
]

const FLOWS: { id: Flow; label: string; drops: number }[] = [
  { id: 'none', label: 'None', drops: 0 },
  { id: 'light', label: 'Light', drops: 1 },
  { id: 'medium', label: 'Medium', drops: 2 },
  { id: 'heavy', label: 'Heavy', drops: 3 },
]

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** assumed period length (days) for predictions when no end was ever logged */
const DEFAULT_PERIOD_LEN = 5
/** assumed cycle length (days) until two logged periods allow a real average */
const DEFAULT_CYCLE_LEN = 28

/* ---------------- date helpers (all local-time) ---------------- */

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

function addDaysKey(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number)
  // constructor arithmetic rolls over months/years — no Date mutation anywhere
  return dateKey(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + n))
}

/** whole days from b to a (a - b) */
function diffDays(a: string, b: string): number {
  return Math.round((parseKey(a).getTime() - parseKey(b).getTime()) / 86400000)
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

function fmtShort(key: string): string {
  return parseKey(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtLong(key: string): string {
  return parseKey(key).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function fmtFull(key: string): string {
  return parseKey(key).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

function fmtRange(a: string, b?: string): string {
  if (!b || b === a) return fmtShort(a)
  return `${fmtShort(a)} – ${fmtShort(b)}`
}

function countdownLabel(days: number): string {
  if (days > 1) return `in ${days} days`
  if (days === 1) return 'tomorrow'
  if (days === 0) return 'today'
  if (days === -1) return '1 day late'
  return `${Math.abs(days)} days late`
}

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

/* ================================================================== */
/* IndexedDB — periods, day notes, settings; fully on-device           */
/* ================================================================== */

const DB_NAME = 'toolhub-cycle'
const DB_VERSION = 1
const PERIOD_STORE = 'periods'
const NOTE_STORE = 'notes'
const SET_STORE = 'settings'

let dbPromise: Promise<IDBDatabase> | null = null

function openCycleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(PERIOD_STORE)) d.createObjectStore(PERIOD_STORE, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(NOTE_STORE)) d.createObjectStore(NOTE_STORE, { keyPath: 'date' })
      if (!d.objectStoreNames.contains(SET_STORE)) d.createObjectStore(SET_STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openCycleDb()
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

function DayCell({
  k,
  isPeriod,
  isPredicted,
  isFertile,
  isOvu,
  isToday,
  hasNote,
  onSelect,
}: {
  k: string
  isPeriod: boolean
  isPredicted: boolean
  isFertile: boolean
  isOvu: boolean
  isToday: boolean
  hasNote: boolean
  onSelect: (key: string) => void
}) {
  const day = parseKey(k)
  const states: string[] = []
  if (isPeriod) states.push('period day')
  if (isPredicted) states.push('predicted period')
  if (isFertile) states.push('fertile day')
  if (isOvu) states.push('estimated ovulation')
  if (hasNote) states.push('has a note')

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88 }}
      transition={{ type: 'spring', stiffness: 500, damping: 20 }}
      onClick={() => onSelect(k)}
      aria-label={`${day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${states.length > 0 ? ` — ${states.join(', ')}` : ''}`}
      className={cn(
        'relative flex aspect-square w-full items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-colors',
        isPeriod
          ? 'bg-gradient-to-br from-rose-400 to-pink-600 text-white shadow-[0_4px_12px_-3px_rgb(236_72_153/0.55)]'
          : isPredicted
            ? 'border border-dashed border-rose-400/80 bg-rose-500/[0.06] text-rose-300 hover:bg-rose-500/[0.12]'
            : isFertile
              ? 'bg-pink-500/[0.13] text-pink-200 hover:bg-pink-500/20'
              : 'text-zinc-300 hover:bg-white/[0.06] hover:text-white',
        isToday && 'ring-2 ring-pink-300/90 ring-offset-1 ring-offset-zinc-950'
      )}
    >
      {Number(k.slice(8, 10))}
      {isOvu && (
        <span
          className="absolute bottom-[3px] left-1/2 size-1 -translate-x-1/2 rounded-full bg-fuchsia-300 shadow-[0_0_5px_rgb(232_121_249/0.9)]"
          aria-hidden
        />
      )}
      {hasNote && (
        <span
          className={cn('absolute right-[3px] top-[3px] size-1 rounded-full', isPeriod ? 'bg-white/90' : 'bg-zinc-500')}
          aria-hidden
        />
      )}
    </motion.button>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function CycleTrackerApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [periods, setPeriods] = useState<Period[]>([])
  const [notes, setNotes] = useState<Record<string, DayEntry>>({})
  const [dismissed, setDismissed] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return { y: n.getFullYear(), m: n.getMonth() }
  })
  const [navDir, setNavDir] = useState<1 | -1>(1)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formStart, setFormStart] = useState('')
  const [formEnd, setFormEnd] = useState('')
  const startRef = useRef<HTMLInputElement>(null)

  const [sheetKey, setSheetKey] = useState<string | null>(null)
  const [draftNote, setDraftNote] = useState('')
  const [draftMood, setDraftMood] = useState<Mood>('none')
  const [draftFlow, setDraftFlow] = useState<Flow>('none')
  const noteRef = useRef<HTMLTextAreaElement>(null)

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmTimer = useRef<number | null>(null)

  const touchX = useRef<number | null>(null)
  const touchY = useRef<number | null>(null)

  const today = useMemo(() => new Date(), [])
  const todayKey = dateKey(today)
  const todayLabel = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [allPeriods, allNotes, allSettings] = await Promise.all([
          idbGetAll<Period>(PERIOD_STORE),
          idbGetAll<DayEntry>(NOTE_STORE),
          idbGetAll<SettingRow>(SET_STORE),
        ])
        if (!alive) return
        setPeriods(allPeriods)
        const map: Record<string, DayEntry> = {}
        for (const n of allNotes) map[n.date] = n
        setNotes(map)
        const privacy = allSettings.find((r) => r.key === 'privacy')?.value
        if (privacy?.dismissed) setDismissed(true)
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
  const putPeriod = useCallback((p: Period) => {
    setPeriods((prev) => {
      const idx = prev.findIndex((x) => x.id === p.id)
      if (idx === -1) return [...prev, p]
      return prev.map((x) => (x.id === p.id ? p : x))
    })
    void idbPut(PERIOD_STORE, p).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const removePeriod = useCallback(
    (id: string) => {
      setPeriods((prev) => prev.filter((p) => p.id !== id))
      setConfirmDeleteId(null)
      void idbDelete(PERIOD_STORE, id).catch(() => {
        /* memory-only fallback */
      })
      haptic(16)
      toast({ title: 'Period deleted', description: 'Predictions recalculated.' })
    },
    [toast]
  )

  const armDelete = useCallback((id: string) => {
    setConfirmDeleteId(id)
    if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    confirmTimer.current = window.setTimeout(() => setConfirmDeleteId(null), 2600)
  }, [])

  const dismissPrivacy = useCallback(() => {
    setDismissed(true)
    void idbPut(SET_STORE, { key: 'privacy', value: { dismissed: true } } satisfies SettingRow).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  /* ---------------- derived: cycle math ---------------- */
  const sorted = useMemo(
    () => [...periods].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : a.createdAt - b.createdAt)),
    [periods]
  )

  /** day gaps between consecutive period starts, oldest first */
  const intervals = useMemo(() => {
    const out: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const gap = diffDays(sorted[i].start, sorted[i - 1].start)
      if (gap > 0) out.push(gap)
    }
    return out
  }, [sorted])

  /** average of the last up-to-6 cycles; default 28 while learning */
  const avgCycle = useMemo(() => {
    const recent = intervals.slice(-6)
    if (recent.length === 0) return DEFAULT_CYCLE_LEN
    return Math.round(recent.reduce((s, x) => s + x, 0) / recent.length)
  }, [intervals])

  const learning = sorted.length < 2

  const trend = useMemo(() => {
    if (intervals.length < 2) return null
    const last = intervals[intervals.length - 1]
    const prior = intervals.slice(0, -1)
    const priorAvg = prior.reduce((s, x) => s + x, 0) / prior.length
    const delta = Math.round(last - priorAvg)
    if (delta > 1) return { dir: 'up' as const, delta }
    if (delta < -1) return { dir: 'down' as const, delta }
    return { dir: 'flat' as const, delta: 0 }
  }, [intervals])

  const lastPeriod = sorted.length > 0 ? sorted[sorted.length - 1] : null
  const lastLen = lastPeriod?.end ? diffDays(lastPeriod.end, lastPeriod.start) + 1 : null
  const lastOngoing = !!lastPeriod && !lastPeriod.end

  const predictedStart = lastPeriod ? addDaysKey(lastPeriod.start, avgCycle) : null
  const predictedLen = lastLen ?? DEFAULT_PERIOD_LEN
  const ovuKey = predictedStart ? addDaysKey(predictedStart, -14) : null
  // plain derivations — the React Compiler memoizes these automatically
  const fertileKeys: string[] = ovuKey
    ? [
        addDaysKey(ovuKey, -2),
        addDaysKey(ovuKey, -1),
        ovuKey,
        addDaysKey(ovuKey, 1),
        addDaysKey(ovuKey, 2),
      ]
    : []
  const fertileSet = new Set(fertileKeys)

  const countdown = predictedStart ? diffDays(predictedStart, todayKey) : null

  /* ---------------- derived: calendar data ---------------- */
  /** dateKey -> period id, for every logged period day (start..end inclusive) */
  const periodDays = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of sorted) {
      const end = p.end ?? p.start
      let guard = 0
      let k = p.start
      while (k <= end && guard < 45) {
        m.set(k, p.id)
        k = addDaysKey(k, 1)
        guard++
      }
    }
    return m
  }, [sorted])

  const predictedDays = new Set<string>()
  if (predictedStart) {
    for (let i = 0; i < predictedLen; i++) predictedDays.add(addDaysKey(predictedStart, i))
  }

  const monthCells = useMemo(() => {
    const lead = new Date(cursor.y, cursor.m, 1).getDay()
    const n = daysInMonth(cursor.y, cursor.m)
    const cells: (string | null)[] = Array.from({ length: lead }, () => null)
    for (let d = 1; d <= n; d++) cells.push(dateKey(new Date(cursor.y, cursor.m, d)))
    return cells
  }, [cursor])

  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  const offMonth = cursor.y !== today.getFullYear() || cursor.m !== today.getMonth()
  const tabMonths = useMemo(
    () =>
      [-1, 0, 1].map((o) => {
        const d = new Date(cursor.y, cursor.m + o, 1)
        return {
          y: d.getFullYear(),
          m: d.getMonth(),
          short: d.toLocaleDateString('en-US', { month: 'short' }),
        }
      }),
    [cursor]
  )

  /* ---------------- calendar navigation ---------------- */
  const shiftBy = useCallback((delta: number) => {
    if (delta === 0) return
    setNavDir(delta > 0 ? 1 : -1)
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }, [])

  const onCalTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0]
    touchX.current = t ? t.clientX : null
    touchY.current = t ? t.clientY : null
  }, [])

  const onCalTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchX.current == null) return
      const t = e.changedTouches[0]
      const dx = t ? t.clientX - touchX.current : 0
      const dy = t ? t.clientY - (touchY.current ?? 0) : 0
      touchX.current = null
      touchY.current = null
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.2) shiftBy(dx < 0 ? 1 : -1)
    },
    [shiftBy]
  )

  /* ---------------- period form actions ---------------- */
  const openLog = () => {
    setEditingId(null)
    setFormStart(todayKey)
    setFormEnd('')
    setFormOpen(true)
    window.setTimeout(() => startRef.current?.focus(), 140)
  }

  const openEdit = useCallback((p: Period) => {
    setEditingId(p.id)
    setFormStart(p.start)
    setFormEnd(p.end ?? '')
    setFormOpen(true)
  }, [])

  const submitPeriod = useCallback(() => {
    if (!formStart) {
      toast({ title: 'Pick a start date first' })
      return
    }
    if (formEnd && formEnd < formStart) {
      toast({ title: 'Check the dates', description: 'The end date must be on or after the start date.' })
      return
    }
    if (editingId) {
      const existing = periods.find((p) => p.id === editingId)
      if (existing) {
        putPeriod({ ...existing, start: formStart, end: formEnd || undefined })
        toast({ title: 'Period updated', description: fmtRange(formStart, formEnd || undefined) })
      }
    } else {
      putPeriod({
        id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        start: formStart,
        end: formEnd || undefined,
        createdAt: Date.now(),
      })
      toast({ title: 'Period logged', description: fmtRange(formStart, formEnd || undefined) })
    }
    haptic()
    setFormOpen(false)
    // bring the logged month into view
    const [yy, mm] = formStart.split('-').map(Number)
    if (yy && mm) shiftBy((yy - cursor.y) * 12 + (mm - 1 - cursor.m))
  }, [cursor.y, cursor.m, editingId, formEnd, formStart, periods, putPeriod, shiftBy, toast])

  /* ---------------- day sheet actions ---------------- */
  const openSheet = useCallback(
    (k: string) => {
      const existing = notes[k]
      setDraftNote(existing?.note ?? '')
      setDraftMood(existing?.mood ?? 'none')
      setDraftFlow(existing?.flow ?? 'none')
      setSheetKey(k)
      haptic(8)
    },
    [notes]
  )

  useEffect(() => {
    if (!sheetKey) return
    const t = window.setTimeout(() => noteRef.current?.focus(), 180)
    return () => window.clearTimeout(t)
  }, [sheetKey])

  const saveSheet = useCallback(() => {
    if (!sheetKey) return
    const note = draftNote.trim()
    const mood = draftMood
    const flow = draftFlow
    const isEmpty = !note && mood === 'none' && flow === 'none'
    if (isEmpty && notes[sheetKey]) {
      setNotes((prev) => {
        const next = { ...prev }
        delete next[sheetKey]
        return next
      })
      void idbDelete(NOTE_STORE, sheetKey).catch(() => {
        /* memory-only fallback */
      })
      toast({ title: 'Day cleared' })
    } else if (!isEmpty) {
      const row: DayEntry = { date: sheetKey, note, mood, flow }
      setNotes((prev) => ({ ...prev, [sheetKey]: row }))
      void idbPut(NOTE_STORE, row).catch(() => {
        /* memory-only fallback */
      })
      toast({ title: 'Day saved', description: 'Notes stay on this device.' })
    }
    setSheetKey(null)
    haptic()
  }, [draftFlow, draftMood, draftNote, notes, sheetKey, toast])

  const clearSheet = useCallback(() => {
    if (!sheetKey) return
    setNotes((prev) => {
      const next = { ...prev }
      delete next[sheetKey]
      return next
    })
    void idbDelete(NOTE_STORE, sheetKey).catch(() => {
      /* memory-only fallback */
    })
    setDraftNote('')
    setDraftMood('none')
    setDraftFlow('none')
    setSheetKey(null)
    haptic(16)
    toast({ title: 'Day cleared' })
  }, [sheetKey, toast])

  const sheetIsPeriodDay = sheetKey ? periodDays.has(sheetKey) : false
  const sheetHasEntry = sheetKey ? !!notes[sheetKey] : false

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
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-pink-500/[0.1] via-transparent to-fuchsia-600/[0.08] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-pink-300 via-rose-400 to-fuchsia-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(236_72_153/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <CalendarHeart className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Cycle Tracker</h2>
              <p className="text-xs text-zinc-400">Private period &amp; cycle companion.</p>
            </div>
            <Button
              onClick={openLog}
              className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-pink-300 via-rose-400 to-fuchsia-500 font-semibold text-zinc-950 shadow-lg hover:from-pink-200 hover:via-rose-300 hover:to-fuchsia-400"
            >
              <Plus className="size-4" aria-hidden /> Log
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
            {/* ---------------- Privacy notice (first run) ---------------- */}
            {loaded && !dismissed && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                className="flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.07] p-3.5"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                  <ShieldCheck className="size-4.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-emerald-200">Private by design</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
                    Everything stays on this device — no accounts, no uploads. For extra privacy, enable App
                    Lock for Cycle Tracker in Settings.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={dismissPrivacy}
                  aria-label="Dismiss privacy notice"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </motion.div>
            )}

            {/* ---------------- Insights ---------------- */}
            <section aria-label="Cycle insights" className="space-y-3">
              <p className="px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Insights</p>

              {/* Next period hero */}
              <div className="col-span-2 rounded-2xl border border-rose-400/25 bg-gradient-to-br from-rose-500/[0.12] via-fuchsia-500/[0.06] to-transparent p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">
                      <CalendarClock className="size-3.5" aria-hidden /> Next period
                    </p>
                    <p className="mt-1 truncate text-xl font-black tracking-tight text-zinc-100 sm:text-2xl">
                      {predictedStart ? fmtLong(predictedStart) : '—'}
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                      {predictedStart
                        ? learning
                          ? 'Using a default 28-day cycle — log another period to personalize.'
                          : `Based on your ${avgCycle}-day average.`
                        : 'Log a period to see predictions.'}
                    </p>
                  </div>
                  {countdown != null && (
                    <motion.span
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 20 }}
                      className="flex shrink-0 items-center gap-1.5 rounded-xl border border-rose-400/30 bg-rose-500/15 px-3 py-2 text-xs font-bold text-rose-200 shadow-[0_10px_24px_-10px_rgb(236_72_153/0.6)]"
                    >
                      <CalendarClock className="size-3.5" aria-hidden />
                      <span className="tabular-nums">{countdownLabel(countdown)}</span>
                    </motion.span>
                  )}
                </div>
              </div>

              {/* Small insight cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    <CalendarDays className="size-3.5 text-rose-300/80" aria-hidden /> Avg cycle
                  </p>
                  <p className="mt-1 text-lg font-black tabular-nums text-zinc-100">{avgCycle} days</p>
                  {trend ? (
                    <p className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-zinc-400">
                      {trend.dir === 'up' ? (
                        <>
                          <TrendingUp className="size-3.5 text-rose-300" aria-hidden /> {trend.delta}d longer than
                          usual
                        </>
                      ) : trend.dir === 'down' ? (
                        <>
                          <TrendingDown className="size-3.5 text-pink-300" aria-hidden /> {trend.delta}d shorter
                          than usual
                        </>
                      ) : (
                        <>
                          <Minus className="size-3.5 text-zinc-500" aria-hidden /> Steady vs your usual
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-zinc-500">
                      {learning ? 'Learning your cycle…' : 'One more cycle unlocks trends'}
                    </p>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    <Heart className="size-3.5 text-rose-300/80" aria-hidden /> Last period
                  </p>
                  <p className="mt-1 text-lg font-black tabular-nums text-zinc-100">
                    {lastLen != null ? `${lastLen} days` : lastOngoing ? 'Ongoing' : '—'}
                  </p>
                  <p className="mt-1 truncate text-[11px] text-zinc-500">
                    {lastPeriod
                      ? `${fmtRange(lastPeriod.start, lastPeriod.end)}${lastOngoing ? ' · add end date' : ''}`
                      : 'Not logged yet'}
                  </p>
                </div>

                <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        <Sparkles className="size-3.5 text-fuchsia-300/80" aria-hidden /> Ovulation estimate
                      </p>
                      <p className="mt-1 text-lg font-black text-zinc-100">{ovuKey ? fmtLong(ovuKey) : '—'}</p>
                    </div>
                    {fertileKeys.length === 5 && (
                      <span className="shrink-0 rounded-lg border border-pink-400/25 bg-pink-500/10 px-2.5 py-1.5 text-[11px] font-bold text-pink-200">
                        Fertile {fmtShort(fertileKeys[0])} – {fmtShort(fertileKeys[4])}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-zinc-500">
                    {ovuKey
                      ? 'Estimated 14 days before your next period — the fertile window spans ±2 days around it.'
                      : 'Log a period first — ovulation is estimated 14 days before the next one.'}
                  </p>
                </div>
              </div>
            </section>

            {/* ---------------- Calendar ---------------- */}
            <section
              aria-label={`Period calendar, ${monthLabel}`}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
            >
              {/* section title row */}
              <div className="mb-3 flex items-center justify-between px-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Calendar</p>
                {offMonth && (
                  <button
                    type="button"
                    onClick={() => shiftBy((today.getFullYear() - cursor.y) * 12 + (today.getMonth() - cursor.m))}
                    className="flex h-9 items-center rounded-lg border border-white/10 bg-white/5 px-3 text-[11px] font-bold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    Today
                  </button>
                )}
              </div>

              {/* pager: chevrons + 3-month tabs */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => shiftBy(-1)}
                  aria-label="Previous month"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <ChevronLeft className="size-4.5" aria-hidden />
                </button>
                <div className="grid flex-1 grid-cols-3 gap-1" role="tablist" aria-label="Month picker">
                  {tabMonths.map((t, i) => (
                    <button
                      key={`${t.y}-${t.m}`}
                      type="button"
                      role="tab"
                      aria-selected={i === 1}
                      onClick={() => shiftBy(i - 1)}
                      className={cn(
                        'flex h-11 items-center justify-center rounded-xl text-xs font-bold transition-colors',
                        i === 1
                          ? 'bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30'
                          : 'text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300'
                      )}
                    >
                      {i === 1
                        ? new Date(t.y, t.m, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                        : t.short}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => shiftBy(1)}
                  aria-label="Next month"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <ChevronRight className="size-4.5" aria-hidden />
                </button>
              </div>

              {/* weekday initials */}
              <div className="mt-3 grid grid-cols-7 gap-px" aria-hidden>
                {WEEKDAY_INITIALS.map((d, i) => (
                  <span
                    key={i}
                    className="flex h-6 items-center justify-center text-[10px] font-bold uppercase tracking-wide text-zinc-600"
                  >
                    {d}
                  </span>
                ))}
              </div>

              {/* month grid — swipe or page */}
              <div className="touch-pan-y" onTouchStart={onCalTouchStart} onTouchEnd={onCalTouchEnd}>
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={`${cursor.y}-${cursor.m}`}
                    initial={{ opacity: 0, x: navDir * 40 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: navDir * -40 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 38 }}
                  >
                    <div className="grid grid-cols-7 gap-px" aria-label={`Days in ${monthLabel}`}>
                      {monthCells.map((k, i) =>
                        k === null ? (
                          <div key={`blank-${i}`} aria-hidden className="aspect-square" />
                        ) : (
                          <DayCell
                            key={k}
                            k={k}
                            isPeriod={periodDays.has(k)}
                            isPredicted={!periodDays.has(k) && predictedDays.has(k)}
                            isFertile={!periodDays.has(k) && !predictedDays.has(k) && fertileSet.has(k)}
                            isOvu={k === ovuKey && !periodDays.has(k) && !predictedDays.has(k)}
                            isToday={k === todayKey}
                            hasNote={!!notes[k]}
                            onSelect={openSheet}
                          />
                        )
                      )}
                    </div>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* legend */}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-[10px] font-medium text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[4px] bg-gradient-to-br from-rose-400 to-pink-600" aria-hidden />
                  Period
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[4px] border border-dashed border-rose-400/80" aria-hidden />
                  Predicted
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[4px] bg-pink-500/25" aria-hidden />
                  Fertile
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="flex size-2.5 items-center justify-center rounded-[4px] bg-white/[0.06]" aria-hidden>
                    <span className="size-1 rounded-full bg-fuchsia-300" />
                  </span>
                  Ovulation
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-[4px] ring-2 ring-pink-300/80" aria-hidden />
                  Today
                </span>
              </div>
            </section>

            {/* ---------------- Logged periods ---------------- */}
            <section aria-label="Logged periods">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Logged periods</p>
                {sorted.length > 0 && <span className="text-[10px] text-zinc-600">{sorted.length} total</span>}
              </div>

              {sorted.length === 0 ? (
                <div className="flex flex-col items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-8 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-300/15 to-fuchsia-500/15 text-rose-300 ring-1 ring-white/10">
                    <Flower2 className="size-6" aria-hidden />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-zinc-300">No periods logged yet</p>
                  <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
                    Tap Log to add your first period. Predictions and insights appear as you go — quietly, and
                    only here.
                  </p>
                </div>
              ) : (
                <div className={cn('max-h-72 space-y-2 overflow-y-auto pr-1', SCROLL_CLS)}>
                  <AnimatePresence initial={false}>
                    {[...sorted].reverse().map((p) => {
                      const confirming = confirmDeleteId === p.id
                      const day = parseKey(p.start)
                      return (
                        <motion.div
                          key={p.id}
                          layout
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.96 }}
                          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5"
                        >
                          <span className="flex size-11 shrink-0 flex-col items-center justify-center rounded-xl bg-rose-500/15 ring-1 ring-rose-400/20">
                            <span className="text-[9px] font-bold uppercase leading-none text-rose-300/80">
                              {day.toLocaleDateString('en-US', { month: 'short' })}
                            </span>
                            <span className="mt-0.5 text-sm font-black leading-none tabular-nums text-rose-200">
                              {day.getDate()}
                            </span>
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-zinc-100">
                              {fmtRange(p.start, p.end)}
                            </p>
                            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                              {p.end ? (
                                <span className="tabular-nums">{diffDays(p.end, p.start) + 1} days</span>
                              ) : (
                                <span className="rounded-md border border-rose-400/25 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                                  Ongoing
                                </span>
                              )}
                              {lastPeriod?.id === p.id && <span>· latest</span>}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => openEdit(p)}
                            aria-label={`Edit period starting ${fmtShort(p.start)}`}
                            className="flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            <Pencil className="size-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => (confirming ? removePeriod(p.id) : armDelete(p.id))}
                            aria-label={confirming ? `Confirm delete period starting ${fmtShort(p.start)}` : `Delete period starting ${fmtShort(p.start)}`}
                            className={cn(
                              'flex size-11 shrink-0 items-center justify-center rounded-xl font-semibold transition-colors',
                              confirming
                                ? 'bg-rose-500 text-white ring-1 ring-rose-400/50'
                                : 'text-zinc-400 hover:bg-rose-500/10 hover:text-rose-300'
                            )}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </div>
              )}
            </section>

            <p className="px-1 text-center text-[10px] leading-relaxed text-zinc-600">
              Tap any calendar day for notes, mood &amp; flow · Everything stays on this device
            </p>
          </div>
        )}
      </motion.div>

      {/* ---------------- Log / edit period modal ---------------- */}
      <AnimatePresence>
        {formOpen && (
          <motion.div
            key="period-form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setFormOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? 'Edit period' : 'Log period'}
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-pink-300 to-fuchsia-500 text-zinc-950">
                  <CalendarHeart className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">{editingId ? 'Edit period' : 'Log period'}</h3>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  aria-label="Close"
                  className="flex size-11 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <label
                htmlFor="cycle-start"
                className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
              >
                Start date
              </label>
              <input
                id="cycle-start"
                ref={startRef}
                type="date"
                value={formStart}
                onChange={(e) => setFormStart(e.target.value)}
                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 [color-scheme:dark] focus:border-rose-400/50 focus:outline-none"
              />

              <label
                htmlFor="cycle-end"
                className="mb-1.5 mt-4 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
              >
                End date <span className="normal-case text-zinc-600">(optional)</span>
              </label>
              <input
                id="cycle-end"
                type="date"
                value={formEnd}
                min={formStart || undefined}
                onChange={(e) => setFormEnd(e.target.value)}
                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 [color-scheme:dark] focus:border-rose-400/50 focus:outline-none"
              />
              <p className="mt-1.5 text-[11px] text-zinc-500">
                Leave empty if your period hasn&rsquo;t ended yet — it shows as ongoing.
              </p>

              <div className="mt-5 flex gap-2">
                <Button
                  onClick={() => setFormOpen(false)}
                  variant="outline"
                  className="h-11 flex-1 rounded-xl border-white/10 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitPeriod}
                  className="h-11 flex-[1.4] rounded-xl bg-gradient-to-r from-pink-300 via-rose-400 to-fuchsia-500 font-semibold text-zinc-950 hover:from-pink-200 hover:via-rose-300 hover:to-fuchsia-400"
                >
                  <Check className="size-4" aria-hidden /> {editingId ? 'Save changes' : 'Log period'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Day notes bottom sheet ---------------- */}
      <AnimatePresence>
        {sheetKey && (
          <motion.div
            key="day-sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSheetKey(null)
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Day notes for ${fmtFull(sheetKey)}`}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className={cn(
                'max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border-x border-t border-white/10 bg-zinc-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-zinc-100 shadow-2xl',
                SCROLL_CLS
              )}
            >
              <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-white/15" aria-hidden />

              {/* sheet header */}
              <div className="mb-4 flex items-start gap-2.5">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold">{fmtFull(sheetKey)}</h3>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {sheetIsPeriodDay && (
                      <span className="rounded-md border border-rose-400/30 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                        Period day
                      </span>
                    )}
                    {!sheetIsPeriodDay && sheetKey === ovuKey && (
                      <span className="rounded-md border border-fuchsia-400/30 bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-bold text-fuchsia-300">
                        Est. ovulation
                      </span>
                    )}
                    {!sheetIsPeriodDay && sheetKey !== ovuKey && fertileSet.has(sheetKey) && (
                      <span className="rounded-md border border-pink-400/25 bg-pink-500/10 px-1.5 py-0.5 text-[10px] font-bold text-pink-300">
                        Fertile window
                      </span>
                    )}
                    {sheetKey === todayKey && (
                      <span className="rounded-md border border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-bold text-zinc-300">
                        Today
                      </span>
                    )}
                    {sheetHasEntry && (
                      <span className="text-[10px] text-zinc-600">saved entry</span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSheetKey(null)}
                  aria-label="Close"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              {/* flow (period days only) */}
              {sheetIsPeriodDay && (
                <>
                  <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    <Droplet className="size-3.5 text-rose-300/80" aria-hidden /> Flow
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {FLOWS.map((f) => (
                      <motion.button
                        key={f.id}
                        type="button"
                        whileTap={{ scale: 0.9 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                        onClick={() => {
                          setDraftFlow(f.id)
                          haptic(8)
                        }}
                        aria-pressed={draftFlow === f.id}
                        aria-label={`Flow ${f.label}`}
                        className={cn(
                          'flex h-14 flex-col items-center justify-center gap-1 rounded-xl transition-colors',
                          draftFlow === f.id
                            ? 'bg-rose-400/15 ring-2 ring-rose-300/70'
                            : 'bg-white/[0.04] ring-1 ring-white/10 hover:bg-white/[0.08]'
                        )}
                      >
                        <span className="flex h-4 items-center gap-0.5" aria-hidden>
                          {f.drops === 0 ? (
                            <span className="text-[11px] font-semibold text-zinc-500">—</span>
                          ) : (
                            Array.from({ length: f.drops }).map((_, i) => (
                              <Droplet
                                key={i}
                                className={cn('size-3.5', f.id === 'heavy' ? 'text-rose-300' : 'text-pink-300')}
                                fill="currentColor"
                                strokeWidth={1}
                              />
                            ))
                          )}
                        </span>
                        <span className="text-[10px] font-semibold text-zinc-400">{f.label}</span>
                      </motion.button>
                    ))}
                  </div>
                </>
              )}

              {/* mood */}
              <p className="mb-1.5 mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Mood</p>
              <div className="grid grid-cols-5 gap-1.5">
                {MOODS.map((m) => (
                  <motion.button
                    key={m.id}
                    type="button"
                    whileTap={{ scale: 0.9 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                    onClick={() => {
                      setDraftMood(m.id)
                      haptic(8)
                    }}
                    aria-pressed={draftMood === m.id}
                    aria-label={`Mood ${m.label}`}
                    className={cn(
                      'flex h-14 flex-col items-center justify-center gap-0.5 rounded-xl transition-colors',
                      draftMood === m.id
                        ? 'bg-rose-400/15 ring-2 ring-rose-300/70'
                        : 'bg-white/[0.04] ring-1 ring-white/10 hover:bg-white/[0.08]'
                    )}
                  >
                    {m.emoji && (
                      <span className="text-lg leading-none" aria-hidden>
                        {m.emoji}
                      </span>
                    )}
                    <span className="text-[9px] font-semibold text-zinc-400">{m.label}</span>
                  </motion.button>
                ))}
              </div>

              {/* note */}
              <label
                htmlFor="cycle-note"
                className="mb-1.5 mt-4 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
              >
                Note
              </label>
              <textarea
                id="cycle-note"
                ref={noteRef}
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                placeholder="How did you feel today?"
                rows={4}
                maxLength={600}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-rose-400/50 focus:outline-none"
              />

              {/* actions */}
              {sheetHasEntry && (
                <button
                  type="button"
                  onClick={clearSheet}
                  className="mt-3 h-11 w-full rounded-xl border border-rose-400/25 text-xs font-semibold text-rose-300/90 transition-colors hover:bg-rose-500/10"
                >
                  Clear this day
                </button>
              )}
              <div className="mt-3 flex gap-2">
                <Button
                  onClick={() => setSheetKey(null)}
                  variant="outline"
                  className="h-11 flex-1 rounded-xl border-white/10 bg-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
                >
                  Cancel
                </Button>
                <Button
                  onClick={saveSheet}
                  className="h-11 flex-[1.4] rounded-xl bg-gradient-to-r from-pink-300 via-rose-400 to-fuchsia-500 font-semibold text-zinc-950 hover:from-pink-200 hover:via-rose-300 hover:to-fuchsia-400"
                >
                  <Check className="size-4" aria-hidden /> Save
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
