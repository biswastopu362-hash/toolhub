'use client'

/**
 * Workout Planner — build routines, train with a guided player, keep the streak.
 *
 * Create named routines from a curated exercise library, then run them through
 * a full-screen coach: set-by-set progress, countdown rings for timed work,
 * an editable rest timer between exercises with Web Audio countdown beeps and
 * a haptic buzz. Every finished session lands in history with weekly stats and
 * a day streak. Everything persists in IndexedDB — private, offline, instant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  Flame,
  History as HistoryIcon,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  SkipForward,
  Timer,
  Trash2,
  Weight,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type ExType = 'reps' | 'time'

interface Ex {
  name: string
  type: ExType
  sets: number
  reps?: number
  seconds?: number
  weightNote?: string
}

interface Routine {
  id: string
  name: string
  exercises: Ex[]
  createdAt: number
}

interface HistEntry {
  id: string
  routineId: string
  routineName: string
  /** local date key 'YYYY-MM-DD' */
  date: string
  durationSec: number
  totalSets: number
  completedAt: number
}

interface AppSettings {
  /** rest between exercises, seconds */
  restSec: number
}

type LibGroup = 'Chest' | 'Back' | 'Shoulders' | 'Arms' | 'Legs' | 'Core' | 'Cardio' | 'Full Body'

interface LibEx {
  id: string
  name: string
  group: LibGroup
  type: ExType
  sets: number
  reps?: number
  seconds?: number
}

/* ================================================================== */
/* Built-in exercise library (~45 curated moves)                       */
/* ================================================================== */

const GROUPS = ['All', 'Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core', 'Cardio', 'Full Body'] as const

const LIB: LibEx[] = [
  /* Chest */
  { id: 'pushups', name: 'Push-ups', group: 'Chest', type: 'reps', sets: 3, reps: 12 },
  { id: 'bench-press', name: 'Bench Press', group: 'Chest', type: 'reps', sets: 3, reps: 10 },
  { id: 'incline-db-press', name: 'Incline Dumbbell Press', group: 'Chest', type: 'reps', sets: 3, reps: 10 },
  { id: 'chest-fly', name: 'Chest Fly', group: 'Chest', type: 'reps', sets: 3, reps: 12 },
  { id: 'dips', name: 'Dips', group: 'Chest', type: 'reps', sets: 3, reps: 10 },
  /* Back */
  { id: 'pull-ups', name: 'Pull-ups', group: 'Back', type: 'reps', sets: 3, reps: 8 },
  { id: 'chin-ups', name: 'Chin-ups', group: 'Back', type: 'reps', sets: 3, reps: 8 },
  { id: 'bent-over-row', name: 'Bent-over Row', group: 'Back', type: 'reps', sets: 3, reps: 10 },
  { id: 'lat-pulldown', name: 'Lat Pulldown', group: 'Back', type: 'reps', sets: 3, reps: 10 },
  { id: 'db-row', name: 'Dumbbell Row', group: 'Back', type: 'reps', sets: 3, reps: 10 },
  { id: 'face-pulls', name: 'Face Pulls', group: 'Back', type: 'reps', sets: 3, reps: 15 },
  /* Shoulders */
  { id: 'shoulder-press', name: 'Shoulder Press', group: 'Shoulders', type: 'reps', sets: 3, reps: 10 },
  { id: 'lateral-raise', name: 'Lateral Raise', group: 'Shoulders', type: 'reps', sets: 3, reps: 12 },
  { id: 'front-raise', name: 'Front Raise', group: 'Shoulders', type: 'reps', sets: 3, reps: 12 },
  { id: 'shrugs', name: 'Shrugs', group: 'Shoulders', type: 'reps', sets: 3, reps: 15 },
  /* Arms */
  { id: 'barbell-curl', name: 'Barbell Curl', group: 'Arms', type: 'reps', sets: 3, reps: 12 },
  { id: 'db-curl', name: 'Dumbbell Curl', group: 'Arms', type: 'reps', sets: 3, reps: 12 },
  { id: 'hammer-curl', name: 'Hammer Curl', group: 'Arms', type: 'reps', sets: 3, reps: 12 },
  { id: 'tricep-dips', name: 'Tricep Dips', group: 'Arms', type: 'reps', sets: 3, reps: 12 },
  { id: 'oh-tricep-ext', name: 'Overhead Tricep Extension', group: 'Arms', type: 'reps', sets: 3, reps: 12 },
  { id: 'skull-crushers', name: 'Skull Crushers', group: 'Arms', type: 'reps', sets: 3, reps: 12 },
  /* Legs */
  { id: 'squats', name: 'Squats', group: 'Legs', type: 'reps', sets: 3, reps: 15 },
  { id: 'deadlift', name: 'Deadlift', group: 'Legs', type: 'reps', sets: 3, reps: 8 },
  { id: 'lunges', name: 'Lunges', group: 'Legs', type: 'reps', sets: 3, reps: 12 },
  { id: 'bulgarian-split', name: 'Bulgarian Split Squat', group: 'Legs', type: 'reps', sets: 3, reps: 10 },
  { id: 'calf-raises', name: 'Calf Raises', group: 'Legs', type: 'reps', sets: 3, reps: 20 },
  { id: 'glute-bridge', name: 'Glute Bridge', group: 'Legs', type: 'reps', sets: 3, reps: 15 },
  /* Core */
  { id: 'plank', name: 'Plank', group: 'Core', type: 'time', sets: 3, seconds: 45 },
  { id: 'side-plank', name: 'Side Plank', group: 'Core', type: 'time', sets: 3, seconds: 30 },
  { id: 'crunches', name: 'Crunches', group: 'Core', type: 'reps', sets: 3, reps: 20 },
  { id: 'bicycle-crunches', name: 'Bicycle Crunches', group: 'Core', type: 'reps', sets: 3, reps: 20 },
  { id: 'leg-raises', name: 'Leg Raises', group: 'Core', type: 'reps', sets: 3, reps: 15 },
  { id: 'russian-twists', name: 'Russian Twists', group: 'Core', type: 'reps', sets: 3, reps: 20 },
  { id: 'superman-hold', name: 'Superman Hold', group: 'Core', type: 'time', sets: 3, seconds: 30 },
  { id: 'flutter-kicks', name: 'Flutter Kicks', group: 'Core', type: 'time', sets: 3, seconds: 30 },
  /* Cardio */
  { id: 'jumping-jacks', name: 'Jumping Jacks', group: 'Cardio', type: 'time', sets: 3, seconds: 45 },
  { id: 'burpees', name: 'Burpees', group: 'Cardio', type: 'reps', sets: 3, reps: 10 },
  { id: 'high-knees', name: 'High Knees', group: 'Cardio', type: 'time', sets: 3, seconds: 40 },
  { id: 'mountain-climbers', name: 'Mountain Climbers', group: 'Cardio', type: 'time', sets: 3, seconds: 40 },
  { id: 'jump-rope', name: 'Jump Rope', group: 'Cardio', type: 'time', sets: 3, seconds: 60 },
  { id: 'shadow-boxing', name: 'Shadow Boxing', group: 'Cardio', type: 'time', sets: 3, seconds: 60 },
  /* Full Body */
  { id: 'dead-bug', name: 'Dead Bug', group: 'Full Body', type: 'reps', sets: 3, reps: 12 },
  { id: 'bear-crawl', name: 'Bear Crawl', group: 'Full Body', type: 'time', sets: 3, seconds: 30 },
  { id: 'wall-sit', name: 'Wall Sit', group: 'Full Body', type: 'time', sets: 3, seconds: 45 },
  { id: 'jump-squats', name: 'Jump Squats', group: 'Full Body', type: 'reps', sets: 3, reps: 12 },
  { id: 'bird-dog', name: 'Bird Dog', group: 'Full Body', type: 'reps', sets: 3, reps: 12 },
]

const LIB_BY_ID = new Map<string, LibEx>(LIB.map((e) => [e.id, e] as [string, LibEx]))

const TEMPLATES: { id: string; label: string; exerciseIds: string[] }[] = [
  {
    id: 'push-day',
    label: 'Push Day',
    exerciseIds: ['bench-press', 'shoulder-press', 'incline-db-press', 'lateral-raise', 'tricep-dips', 'oh-tricep-ext'],
  },
  {
    id: 'leg-day',
    label: 'Leg Day',
    exerciseIds: ['squats', 'lunges', 'bulgarian-split', 'glute-bridge', 'calf-raises', 'wall-sit'],
  },
  {
    id: 'core-cardio',
    label: 'Core & Cardio',
    exerciseIds: ['plank', 'crunches', 'leg-raises', 'jumping-jacks', 'mountain-climbers', 'burpees'],
  },
]

function exFromLib(lib: LibEx): Ex {
  return lib.type === 'time'
    ? { name: lib.name, type: 'time', sets: lib.sets, seconds: lib.seconds ?? 30 }
    : { name: lib.name, type: 'reps', sets: lib.sets, reps: lib.reps ?? 10 }
}

const REST_PRESETS = [30, 45, 60, 90, 120] as const

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabelOf(key: string, today: Date): string {
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (key === dateKey(today)) return 'Today'
  if (key === dateKey(y)) return 'Yesterday'
  const [yy, mm, dd] = key.split('-').map(Number)
  if (!yy || !mm || !dd) return key
  return new Date(yy, mm - 1, dd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/** m:ss (or h:mm:ss) — used for durations & big timer numerals. */
function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
  return `${m}:${String(r).padStart(2, '0')}`
}

/** Rough session length so routines can be compared at a glance. */
function estSec(r: Routine): number {
  let work = 0
  for (const ex of r.exercises) {
    work += ex.sets * (ex.type === 'reps' ? 40 : (ex.seconds ?? 30) + 15)
  }
  return work + Math.max(0, r.exercises.length - 1) * 60
}

function fmtMin(sec: number): string {
  return `≈ ${Math.max(1, Math.round(sec / 60))} min`
}

function targetLabel(ex: Ex): string {
  return ex.type === 'reps' ? `${ex.sets} × ${ex.reps ?? 10} reps` : `${ex.sets} × ${ex.seconds ?? 30}s`
}

function totalSetsOf(r: Routine): number {
  return r.exercises.reduce((s, e) => s + e.sets, 0)
}

/** Thin glass scrollbar for long lists. */
const SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/* ================================================================== */
/* IndexedDB — routines + history + settings, fully on-device          */
/* ================================================================== */

const DB_NAME = 'toolhub-workouts'
const DB_VERSION = 1
const ROUTINE_STORE = 'routines'
const HIST_STORE = 'history'
const SET_STORE = 'settings'

let dbPromise: Promise<IDBDatabase> | null = null

function openWorkoutDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(ROUTINE_STORE)) d.createObjectStore(ROUTINE_STORE, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(HIST_STORE)) d.createObjectStore(HIST_STORE, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(SET_STORE)) d.createObjectStore(SET_STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openWorkoutDb()
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
  value: AppSettings
}

/* ================================================================== */
/* Session state machine                                               */
/* ================================================================== */

interface Session {
  phase: 'work' | 'rest' | 'done'
  exIndex: number
  setIndex: number
  /** countdown for time-based work sets (seconds) */
  timeLeft: number
  restLeft: number
  restTotal: number
  paused: boolean
  elapsedSec: number
  setsDone: number
  finishedAt: number | null
}

/* ================================================================== */
/* Countdown ring                                                      */
/* ================================================================== */

function Ring({ size, stroke, frac, color, glow }: { size: number; stroke: number; frac: number; color: string; glow?: boolean }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(1, Math.max(0, frac))
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - clamped)}
        className="transition-[stroke-dashoffset] duration-500 ease-linear"
        style={glow ? { filter: 'drop-shadow(0 0 8px rgb(245 158 11 / 0.5))' } : undefined}
      />
    </svg>
  )
}

/* ================================================================== */
/* Set stepper (sets / reps / seconds editing)                         */
/* ================================================================== */

function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`Decrease ${label}`}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <Minus className="size-4" aria-hidden />
        </button>
        <input
          value={String(value)}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10)
            onChange(Number.isNaN(n) ? min : Math.min(max, Math.max(min, n)))
          }}
          inputMode="numeric"
          aria-label={label}
          className="h-10 w-full min-w-0 bg-transparent text-center text-sm font-bold tabular-nums text-zinc-100 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`Increase ${label}`}
          className="flex size-10 shrink-0 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function WorkoutPlannerApp() {
  const { toast } = useToast()

  /* ---------------- persisted state ---------------- */
  const [routines, setRoutines] = useState<Routine[]>([])
  const [history, setHistory] = useState<HistEntry[]>([])
  const [settings, setSettings] = useState<AppSettings>({ restSec: 60 })
  const [loaded, setLoaded] = useState(false)

  /* ---------------- navigation state ---------------- */
  const [tab, setTab] = useState<'routines' | 'history'>('routines')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmRoutineDelete, setConfirmRoutineDelete] = useState<string | null>(null)
  const [confirmHistDelete, setConfirmHistDelete] = useState<string | null>(null)
  const [expandedHist, setExpandedHist] = useState<string | null>(null)

  /* ---------------- new-routine modal ---------------- */
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTpl, setNewTpl] = useState<string | null>(null)

  /* ---------------- builder state ---------------- */
  const [nameDraft, setNameDraft] = useState('')
  const [expandedEx, setExpandedEx] = useState<number | null>(null)
  const [confirmExDelete, setConfirmExDelete] = useState<number | null>(null)
  const [libOpen, setLibOpen] = useState(false)
  const [libGroup, setLibGroup] = useState<(typeof GROUPS)[number]>('All')
  const [libQuery, setLibQuery] = useState('')
  const [justAdded, setJustAdded] = useState<string | null>(null)

  /* ---------------- active session ---------------- */
  const [session, setSession] = useState<Session | null>(null)
  const [sessionRoutine, setSessionRoutine] = useState<Routine | null>(null)
  const [endOpen, setEndOpen] = useState(false)
  const sessionRef = useRef<Session | null>(null)
  const sessionRoutineRef = useRef<Routine | null>(null)

  /* ---------------- misc refs ---------------- */
  const routinesRef = useRef<Routine[]>([])
  const settingsRef = useRef<AppSettings>({ restSec: 60 })
  const ctxRef = useRef<AudioContext | null>(null)
  const today = useMemo(() => new Date(), [])
  const todayKey = dateKey(today)

  useEffect(() => {
    routinesRef.current = routines
  }, [routines])

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [rs, hs, ss] = await Promise.all([
          idbGetAll<Routine>(ROUTINE_STORE),
          idbGetAll<HistEntry>(HIST_STORE),
          idbGetAll<SetRow>(SET_STORE),
        ])
        if (!alive) return
        setRoutines(
          rs
            .filter((r) => r && typeof r.id === 'string' && Array.isArray(r.exercises))
            .sort((a, b) => a.createdAt - b.createdAt)
        )
        setHistory(
          hs
            .filter((h) => h && typeof h.id === 'string' && typeof h.completedAt === 'number')
            .sort((a, b) => b.completedAt - a.completedAt)
        )
        const saved = ss.find((r) => r.key === 'settings')?.value
        if (saved) {
          const next: AppSettings = { restSec: Math.min(300, Math.max(5, Math.round(Number(saved.restSec) || 60))) }
          settingsRef.current = next
          setSettings(next)
        }
      } catch {
        /* private mode / quota — keep in-memory data */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- audio (beeps created/resumed inside user taps) ---------------- */
  const ensureAudio = useCallback((): AudioContext | null => {
    try {
      if (!ctxRef.current) {
        const w = window as unknown as {
          AudioContext?: typeof AudioContext
          webkitAudioContext?: typeof AudioContext
        }
        const Ctx = w.AudioContext ?? w.webkitAudioContext
        if (!Ctx) return null
        ctxRef.current = new Ctx()
      }
      if (ctxRef.current.state === 'suspended') void ctxRef.current.resume()
      return ctxRef.current
    } catch {
      return null
    }
  }, [])

  /** Short beep at 3-2-1, long beep at 0. Fully guarded — silence if blocked. */
  const beep = useCallback(
    (long: boolean) => {
      try {
        const ctx = ensureAudio()
        if (!ctx) return
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(long ? 880 : 660, ctx.currentTime)
        gain.gain.setValueAtTime(0.0001, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(long ? 0.32 : 0.22, ctx.currentTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (long ? 0.55 : 0.14))
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + (long ? 0.6 : 0.18))
        osc.onended = () => {
          try {
            osc.disconnect()
          } catch {
            /* noop */
          }
          try {
            gain.disconnect()
          } catch {
            /* noop */
          }
        }
      } catch {
        /* audio unavailable — timers keep running silently */
      }
    },
    [ensureAudio]
  )

  /* ---------------- mutations (write-through to IndexedDB) ---------------- */
  const putRoutine = useCallback((r: Routine) => {
    void idbPut(ROUTINE_STORE, r).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const addRoutine = useCallback(
    (r: Routine) => {
      setRoutines((prev) => [...prev, r])
      putRoutine(r)
    },
    [putRoutine]
  )

  const mutateRoutine = useCallback(
    (id: string, fn: (r: Routine) => Routine) => {
      const next = routinesRef.current.map((r) => (r.id === id ? fn(r) : r))
      routinesRef.current = next
      setRoutines(next)
      const updated = next.find((r) => r.id === id)
      if (updated) putRoutine(updated)
    },
    [putRoutine]
  )

  const removeRoutine = useCallback(
    (id: string) => {
      const next = routinesRef.current.filter((r) => r.id !== id)
      routinesRef.current = next
      setRoutines(next)
      setConfirmRoutineDelete(null)
      void idbDelete(ROUTINE_STORE, id).catch(() => {
        /* memory-only fallback */
      })
    },
    []
  )

  const removeHist = useCallback((id: string) => {
    setHistory((prev) => prev.filter((h) => h.id !== id))
    setConfirmHistDelete(null)
    void idbDelete(HIST_STORE, id).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const saveSettings = useCallback((next: AppSettings) => {
    settingsRef.current = next
    setSettings(next)
    void idbPut(SET_STORE, { key: 'settings', value: next } satisfies SetRow).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  /* ---------------- session control ---------------- */
  const setSess = useCallback((s: Session | null) => {
    sessionRef.current = s
    setSession(s)
  }, [])

  const finishSession = useCallback(
    (s: Session) => {
      const routine = sessionRoutineRef.current
      const finished: Session = { ...s, phase: 'done', paused: false, finishedAt: Date.now() }
      sessionRef.current = finished
      setSession(finished)
      if (routine && s.setsDone > 0) {
        const entry: HistEntry = {
          id: genId('h'),
          routineId: routine.id,
          routineName: routine.name,
          date: dateKey(new Date()),
          durationSec: s.elapsedSec,
          totalSets: s.setsDone,
          completedAt: Date.now(),
        }
        setHistory((prev) => [entry, ...prev])
        void idbPut(HIST_STORE, entry).catch(() => {
          /* memory-only fallback */
        })
        try {
          navigator.vibrate?.([60, 40, 120])
        } catch {
          /* haptics unsupported */
        }
      }
    },
    []
  )

  /** Mark the current set done, then advance: next set → rest → finish. */
  const completeSet = useCallback(
    (s: Session) => {
      const routine = sessionRoutineRef.current
      if (!routine) return
      const ex = routine.exercises[s.exIndex]
      if (!ex) return
      const setsDone = s.setsDone + 1
      if (s.setIndex + 1 < ex.sets) {
        setSess({ ...s, setIndex: s.setIndex + 1, setsDone, timeLeft: ex.type === 'time' ? (ex.seconds ?? 30) : 0 })
        return
      }
      if (s.exIndex + 1 < routine.exercises.length) {
        const rest = Math.max(5, settingsRef.current.restSec)
        setSess({ ...s, phase: 'rest', restLeft: rest, restTotal: rest, timeLeft: 0, setsDone })
        return
      }
      finishSession({ ...s, setsDone })
    },
    [finishSession, setSess]
  )

  /* One tick per second while a session exists. Reads refs so the interval
     is created exactly once for the lifetime of the component. */
  useEffect(() => {
    const id = window.setInterval(() => {
      const s = sessionRef.current
      if (!s || s.paused || s.phase === 'done') return
      const routine = sessionRoutineRef.current
      if (!routine) return
      const elapsed = s.elapsedSec + 1
      if (s.phase === 'work') {
        const ex = routine.exercises[s.exIndex]
        if (ex && ex.type === 'time' && s.timeLeft > 0) {
          const t = s.timeLeft - 1
          if (t <= 0) {
            completeSet({ ...s, timeLeft: 0, elapsedSec: elapsed })
          } else {
            setSess({ ...s, timeLeft: t, elapsedSec: elapsed })
          }
          return
        }
        setSess({ ...s, elapsedSec: elapsed })
        return
      }
      /* rest countdown */
      const r = s.restLeft - 1
      if (r > 0 && r <= 3) beep(false)
      if (r <= 0) {
        beep(true)
        try {
          navigator.vibrate?.([100, 50, 100])
        } catch {
          /* haptics unsupported */
        }
        const nextEx = s.exIndex + 1
        if (nextEx >= routine.exercises.length) {
          finishSession({ ...s, elapsedSec: elapsed })
          return
        }
        const nEx = routine.exercises[nextEx]
        setSess({
          ...s,
          phase: 'work',
          exIndex: nextEx,
          setIndex: 0,
          timeLeft: nEx.type === 'time' ? (nEx.seconds ?? 30) : 0,
          restLeft: 0,
          elapsedSec: elapsed,
        })
        return
      }
      setSess({ ...s, restLeft: r, elapsedSec: elapsed })
    }, 1000)
    return () => window.clearInterval(id)
  }, [beep, completeSet, finishSession, setSess])

  const startSession = useCallback(
    (routine: Routine) => {
      if (routine.exercises.length === 0) {
        toast({ title: 'This routine is empty', description: 'Add a few exercises before starting.' })
        return
      }
      ensureAudio()
      const first = routine.exercises[0]
      const s: Session = {
        phase: 'work',
        exIndex: 0,
        setIndex: 0,
        timeLeft: first.type === 'time' ? (first.seconds ?? 30) : 0,
        restLeft: 0,
        restTotal: settingsRef.current.restSec,
        paused: false,
        elapsedSec: 0,
        setsDone: 0,
        finishedAt: null,
      }
      sessionRoutineRef.current = routine
      setSessionRoutine(routine)
      sessionRef.current = s
      setSession(s)
      setEndOpen(false)
    },
    [ensureAudio, toast]
  )

  const doneSet = useCallback(() => {
    const s = sessionRef.current
    if (!s || s.phase !== 'work' || s.paused) return
    try {
      navigator.vibrate?.(24)
    } catch {
      /* haptics unsupported */
    }
    completeSet(s)
  }, [completeSet])

  const skipRest = useCallback(() => {
    const s = sessionRef.current
    const routine = sessionRoutineRef.current
    if (!s || s.phase !== 'rest' || !routine) return
    const nextEx = s.exIndex + 1
    if (nextEx >= routine.exercises.length) {
      finishSession(s)
      return
    }
    const nEx = routine.exercises[nextEx]
    setSess({
      ...s,
      phase: 'work',
      exIndex: nextEx,
      setIndex: 0,
      timeLeft: nEx.type === 'time' ? (nEx.seconds ?? 30) : 0,
      restLeft: 0,
    })
  }, [finishSession, setSess])

  const togglePause = useCallback(() => {
    const s = sessionRef.current
    if (!s || s.phase === 'done') return
    setSess({ ...s, paused: !s.paused })
  }, [setSess])

  const pickRest = useCallback(
    (sec: number) => {
      saveSettings({ restSec: sec })
      const s = sessionRef.current
      if (s && s.phase === 'rest') setSess({ ...s, restLeft: sec, restTotal: sec })
    },
    [saveSettings, setSess]
  )

  const discardSession = useCallback(() => {
    setSess(null)
    sessionRoutineRef.current = null
    setSessionRoutine(null)
    setEndOpen(false)
  }, [setSess])

  const closeSummary = useCallback(() => {
    setSess(null)
    sessionRoutineRef.current = null
    setSessionRoutine(null)
    setTab('history')
  }, [setSess])

  /* ---------------- builder helpers ---------------- */
  const builderRoutine = useMemo(() => routines.find((r) => r.id === editingId) ?? null, [routines, editingId])

  const openBuilder = useCallback((r: Routine) => {
    setEditingId(r.id)
    setNameDraft(r.name)
    setExpandedEx(null)
    setConfirmExDelete(null)
    setLibGroup('All')
    setLibQuery('')
  }, [])

  const commitName = useCallback(() => {
    if (!editingId) return
    const current = routinesRef.current.find((r) => r.id === editingId)
    if (!current) return
    const trimmed = nameDraft.trim()
    if (!trimmed || trimmed === current.name) {
      setNameDraft(current.name)
      return
    }
    mutateRoutine(editingId, (r) => ({ ...r, name: trimmed.slice(0, 48) }))
  }, [editingId, mutateRoutine, nameDraft])

  const closeBuilder = useCallback(() => {
    commitName()
    setEditingId(null)
    setExpandedEx(null)
    setConfirmExDelete(null)
    setLibOpen(false)
  }, [commitName])

  const updateEx = useCallback(
    (idx: number, patch: Partial<Ex>) => {
      if (!editingId) return
      mutateRoutine(editingId, (r) => ({
        ...r,
        exercises: r.exercises.map((e, i) => (i === idx ? { ...e, ...patch } : e)),
      }))
    },
    [editingId, mutateRoutine]
  )

  const switchExType = useCallback(
    (idx: number, t: ExType) => {
      const ex = builderRoutine?.exercises[idx]
      if (!ex || ex.type === t) return
      updateEx(idx, t === 'time' ? { type: 'time', seconds: ex.seconds ?? 30 } : { type: 'reps', reps: ex.reps ?? 10 })
    },
    [builderRoutine, updateEx]
  )

  const removeEx = useCallback(
    (idx: number) => {
      if (!editingId) return
      mutateRoutine(editingId, (r) => ({ ...r, exercises: r.exercises.filter((_, i) => i !== idx) }))
      setExpandedEx(null)
      setConfirmExDelete(null)
    },
    [editingId, mutateRoutine]
  )

  const moveEx = useCallback(
    (idx: number, dir: -1 | 1) => {
      if (!editingId) return
      mutateRoutine(editingId, (r) => {
        const j = idx + dir
        if (j < 0 || j >= r.exercises.length) return r
        const list = [...r.exercises]
        const [item] = list.splice(idx, 1)
        if (item) list.splice(j, 0, item)
        return { ...r, exercises: list }
      })
      setExpandedEx((cur) => (cur === idx ? idx + dir : cur))
    },
    [editingId, mutateRoutine]
  )

  const addFromLibrary = useCallback(
    (lib: LibEx) => {
      if (!editingId) return
      mutateRoutine(editingId, (r) => ({ ...r, exercises: [...r.exercises, exFromLib(lib)] }))
      setJustAdded(lib.id)
      window.setTimeout(() => setJustAdded((cur) => (cur === lib.id ? null : cur)), 900)
    },
    [editingId, mutateRoutine]
  )

  const createRoutine = useCallback(() => {
    const tpl = TEMPLATES.find((t) => t.id === newTpl)
    const exercises: Ex[] = []
    if (tpl) {
      for (const tid of tpl.exerciseIds) {
        const lib = LIB_BY_ID.get(tid)
        if (lib) exercises.push(exFromLib(lib))
      }
    }
    const routine: Routine = {
      id: genId('r'),
      name: (newName.trim() || 'My Routine').slice(0, 48),
      exercises,
      createdAt: Date.now(),
    }
    addRoutine(routine)
    setNewOpen(false)
    setNewName('')
    setNewTpl(null)
    setTab('routines')
    openBuilder(routine)
    toast({
      title: 'Routine created',
      description: exercises.length > 0 ? `${exercises.length} exercises from the ${tpl?.label ?? ''} template.` : 'Add exercises from the library.',
    })
  }, [addRoutine, newName, newTpl, openBuilder, toast])

  /* ---------------- derived stats ---------------- */
  const weekKeys = useMemo(() => {
    const set = new Set<string>()
    for (let i = 0; i < 7; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      set.add(dateKey(d))
    }
    return set
  }, [today])

  const weekCount = useMemo(() => history.filter((h) => weekKeys.has(h.date)).length, [history, weekKeys])

  const streak = useMemo(() => {
    const dates = [...new Set(history.map((h) => h.date))].sort((a, b) => (a < b ? 1 : -1))
    if (dates.length === 0) return 0
    const y = new Date(today)
    y.setDate(today.getDate() - 1)
    const first = dates[0]
    if (first !== todayKey && first !== dateKey(y)) return 0
    const cursor = new Date(today)
    if (first === dateKey(y)) cursor.setDate(cursor.getDate() - 1)
    let count = 0
    for (;;) {
      if (!dates.includes(dateKey(cursor))) break
      count++
      cursor.setDate(cursor.getDate() - 1)
    }
    return count
  }, [history, today, todayKey])

  const libResults = useMemo(
    () =>
      LIB.filter(
        (e) =>
          (libGroup === 'All' || e.group === libGroup) &&
          e.name.toLowerCase().includes(libQuery.trim().toLowerCase())
      ),
    [libGroup, libQuery]
  )

  /* session render helpers */
  const curEx = session && sessionRoutine ? sessionRoutine.exercises[session.exIndex] : null
  const nextEx = session && sessionRoutine ? sessionRoutine.exercises[session.exIndex + 1] : undefined
  const sessionTotalSets = sessionRoutine ? totalSetsOf(sessionRoutine) : 0
  const exercisesDone = (() => {
    if (!session || !sessionRoutine || session.phase !== 'done') return 0
    const ex = sessionRoutine.exercises[session.exIndex]
    const full = ex ? session.setIndex + 1 >= ex.sets : false
    return Math.min(sessionRoutine.exercises.length, session.exIndex + (full ? 1 : 0))
  })()

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
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-orange-500/[0.1] via-transparent to-amber-500/[0.06] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-orange-300 via-amber-500 to-orange-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(245_158_11/0.65),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Dumbbell className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Workout Planner</h2>
              <p className="text-xs text-zinc-400">Routines, guided sets &amp; streaks — on-device.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                onClick={() => {
                  setNewName('')
                  setNewTpl(null)
                  setNewOpen(true)
                }}
                className="h-10 rounded-xl bg-gradient-to-r from-orange-300 via-amber-400 to-amber-500 font-semibold text-zinc-950 shadow-lg hover:from-orange-200 hover:via-amber-300 hover:to-amber-400"
              >
                <Plus className="size-4" aria-hidden /> New
              </Button>
            </div>
          </div>

          {/* Tabs */}
          <div className="mt-5 flex items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5" role="tablist" aria-label="Sections">
            {(
              [
                { id: 'routines', label: 'Routines', icon: Dumbbell, count: routines.length },
                { id: 'history', label: 'History', icon: HistoryIcon, count: history.length },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                role="tab"
                aria-selected={tab === t.id}
                className={cn(
                  'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all',
                  tab === t.id ? 'bg-amber-500/15 text-amber-200 shadow-inner' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                )}
              >
                <t.icon className="size-4" aria-hidden />
                {t.label}
                <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', tab === t.id ? 'bg-amber-500/25' : 'bg-white/10')}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {!loaded ? (
          /* ---------------- Hydrating ---------------- */
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.05]" />
            ))}
          </div>
        ) : tab === 'routines' ? (
          editingId && builderRoutine ? (
            /* ================= Builder ================= */
            <div className="space-y-4 p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <button
                  onClick={closeBuilder}
                  aria-label="Back to routines"
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <ArrowLeft className="size-4.5" aria-hidden />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Edit routine</p>
                  <p className="truncate text-sm font-bold">
                    {builderRoutine.exercises.length} exercises · {totalSetsOf(builderRoutine)} sets ·{' '}
                    {fmtMin(estSec(builderRoutine))}
                  </p>
                </div>
                <Button
                  onClick={closeBuilder}
                  className="h-10 shrink-0 rounded-xl bg-gradient-to-r from-orange-300 via-amber-400 to-amber-500 font-semibold text-zinc-950 shadow-lg hover:from-orange-200 hover:via-amber-300 hover:to-amber-400"
                >
                  Done
                </Button>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Routine name</p>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  }}
                  maxLength={48}
                  placeholder="e.g. Push Day"
                  aria-label="Routine name"
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm font-semibold text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400/50 focus:outline-none"
                />
              </div>

              <div>
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-sm font-bold">Exercises</p>
                  <button
                    onClick={() => setLibOpen(true)}
                    className="flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/10"
                  >
                    <Plus className="size-3.5" aria-hidden /> Add from library
                  </button>
                </div>

                {builderRoutine.exercises.length === 0 ? (
                  <button
                    onClick={() => setLibOpen(true)}
                    className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-8 text-center transition-colors hover:border-amber-400/40"
                  >
                    <Dumbbell className="size-8 text-zinc-600" aria-hidden />
                    <p className="text-sm font-semibold text-zinc-300">Empty routine</p>
                    <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                      Tap to open the exercise library and start building — {LIB.length} curated moves included.
                    </p>
                  </button>
                ) : (
                  <div className={cn('max-h-96 space-y-1.5 overflow-y-auto pr-1', SCROLLBAR)}>
                    <AnimatePresence initial={false}>
                      {builderRoutine.exercises.map((ex, idx) => {
                        const expanded = expandedEx === idx
                        const confirming = confirmExDelete === idx
                        return (
                          <motion.div
                            key={`${ex.name}-${idx}`}
                            layout
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.97 }}
                            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                            className={cn(
                              'rounded-xl border p-2.5',
                              expanded ? 'border-amber-400/40 bg-amber-500/[0.06]' : 'border-white/10 bg-white/[0.03]'
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[11px] font-bold text-zinc-400 tabular-nums">
                                {idx + 1}
                              </span>
                              <button
                                onClick={() => setExpandedEx(expanded ? null : idx)}
                                aria-expanded={expanded}
                                className="min-w-0 flex-1 text-left"
                              >
                                <p className="truncate text-sm font-semibold text-zinc-100">{ex.name}</p>
                                <p className="truncate text-[11px] text-zinc-500">
                                  {targetLabel(ex)}
                                  {ex.weightNote ? ` · ${ex.weightNote}` : ''}
                                </p>
                              </button>
                              <button
                                onClick={() => moveEx(idx, -1)}
                                disabled={idx === 0}
                                aria-label={`Move ${ex.name} up`}
                                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
                              >
                                <ChevronUp className="size-4" aria-hidden />
                              </button>
                              <button
                                onClick={() => moveEx(idx, 1)}
                                disabled={idx === builderRoutine.exercises.length - 1}
                                aria-label={`Move ${ex.name} down`}
                                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-25"
                              >
                                <ChevronDown className="size-4" aria-hidden />
                              </button>
                              <button
                                onClick={() => (confirming ? removeEx(idx) : setConfirmExDelete(idx))}
                                aria-label={confirming ? `Confirm delete ${ex.name}` : `Delete ${ex.name}`}
                                className={cn(
                                  'flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors',
                                  confirming
                                    ? 'bg-rose-500 text-white'
                                    : 'text-zinc-600 hover:bg-rose-500/15 hover:text-rose-300'
                                )}
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </button>
                            </div>

                            {expanded && (
                              <div className="mt-3 space-y-3 border-t border-white/5 pt-3">
                                <div className="flex rounded-xl border border-white/10 bg-white/5 p-1" role="radiogroup" aria-label="Exercise type">
                                  {(
                                    [
                                      { id: 'reps', label: 'Reps' },
                                      { id: 'time', label: 'Time' },
                                    ] as const
                                  ).map((t) => (
                                    <button
                                      key={t.id}
                                      onClick={() => switchExType(idx, t.id)}
                                      role="radio"
                                      aria-checked={ex.type === t.id}
                                      className={cn(
                                        'h-9 flex-1 rounded-lg text-xs font-bold transition-all',
                                        ex.type === t.id ? 'bg-amber-500 text-zinc-950' : 'text-zinc-300 hover:bg-white/5'
                                      )}
                                    >
                                      {t.label}
                                    </button>
                                  ))}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <Stepper
                                    label="Sets"
                                    value={ex.sets}
                                    min={1}
                                    max={20}
                                    onChange={(v) => updateEx(idx, { sets: v })}
                                  />
                                  {ex.type === 'reps' ? (
                                    <Stepper
                                      label="Reps"
                                      value={ex.reps ?? 10}
                                      min={1}
                                      max={200}
                                      onChange={(v) => updateEx(idx, { reps: v })}
                                    />
                                  ) : (
                                    <Stepper
                                      label="Seconds"
                                      value={ex.seconds ?? 30}
                                      min={5}
                                      max={600}
                                      onChange={(v) => updateEx(idx, { seconds: v })}
                                    />
                                  )}
                                </div>
                                <div>
                                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                                    Weight note <span className="font-normal normal-case text-zinc-600">(optional)</span>
                                  </p>
                                  <input
                                    value={ex.weightNote ?? ''}
                                    onChange={(e) => updateEx(idx, { weightNote: e.target.value.slice(0, 40) })}
                                    onBlur={(e) => {
                                      if (!e.target.value.trim()) updateEx(idx, { weightNote: undefined })
                                    }}
                                    placeholder="e.g. 2 × 12.5 kg"
                                    maxLength={40}
                                    aria-label={`Weight note for ${ex.name}`}
                                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400/50 focus:outline-none"
                                  />
                                </div>
                              </div>
                            )}
                          </motion.div>
                        )
                      })}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* ================= Routines list ================= */
            <div className="p-4 sm:p-5">
              {routines.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                  <Dumbbell className="size-10 text-zinc-600" aria-hidden />
                  <p className="text-sm font-semibold text-zinc-300">No routines yet</p>
                  <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                    Build a routine once — push day, leg day, a quick core blast — then run it any time with a coach
                    that counts every set. Data never leaves this device.
                  </p>
                  <Button
                    onClick={() => {
                      setNewName('')
                      setNewTpl(null)
                      setNewOpen(true)
                    }}
                    className="mt-1 h-11 rounded-xl bg-gradient-to-r from-orange-300 via-amber-400 to-amber-500 font-semibold text-zinc-950 hover:from-orange-200 hover:via-amber-300 hover:to-amber-400"
                  >
                    <Plus className="size-4" aria-hidden /> Create your first routine
                  </Button>
                </div>
              ) : (
                <div className={cn('max-h-96 space-y-2 overflow-y-auto pr-1', SCROLLBAR)}>
                  {routines.map((r) => {
                    const confirming = confirmRoutineDelete === r.id
                    const isEmpty = r.exercises.length === 0
                    return (
                      <motion.div
                        key={r.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                        className="rounded-2xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/20">
                            <Dumbbell className="size-5" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-zinc-100">{r.name}</p>
                            <p className="text-[11px] text-zinc-500">
                              {r.exercises.length} exercises · {totalSetsOf(r)} sets · {fmtMin(estSec(r))}
                            </p>
                          </div>
                        </div>
                        <div className="mt-2.5 flex items-center gap-2">
                          <Button
                            onClick={() => startSession(r)}
                            disabled={isEmpty}
                            className="h-10 flex-1 rounded-xl bg-gradient-to-r from-orange-300 via-amber-400 to-amber-500 font-semibold text-zinc-950 shadow-md hover:from-orange-200 hover:via-amber-300 hover:to-amber-400 disabled:from-zinc-700 disabled:via-zinc-700 disabled:to-zinc-700 disabled:text-zinc-500"
                          >
                            <Play className="size-4" aria-hidden /> Start
                          </Button>
                          <button
                            onClick={() => openBuilder(r)}
                            aria-label={`Edit ${r.name}`}
                            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            <Pencil className="size-4" aria-hidden />
                          </button>
                          <button
                            onClick={() => (confirming ? removeRoutine(r.id) : setConfirmRoutineDelete(r.id))}
                            aria-label={confirming ? `Confirm delete ${r.name}` : `Delete ${r.name}`}
                            className={cn(
                              'flex size-10 shrink-0 items-center justify-center rounded-xl border transition-colors',
                              confirming
                                ? 'border-rose-500 bg-rose-500 text-white'
                                : 'border-white/10 bg-white/5 text-zinc-600 hover:border-rose-500/30 hover:bg-rose-500/15 hover:text-rose-300'
                            )}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        ) : (
          /* ================= History ================= */
          <div className="space-y-4 p-4 sm:p-5">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-amber-500/[0.08] to-transparent p-3 text-center">
                <CalendarCheck className="mx-auto size-4 text-amber-300" aria-hidden />
                <p className="mt-1 text-xl font-black tabular-nums text-zinc-100">{weekCount}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">This week</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-center">
                <HistoryIcon className="mx-auto size-4 text-zinc-400" aria-hidden />
                <p className="mt-1 text-xl font-black tabular-nums text-zinc-100">{history.length}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">All-time</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-orange-500/[0.1] to-transparent p-3 text-center">
                <Flame className="mx-auto size-4 text-orange-400" aria-hidden />
                <p className="mt-1 text-xl font-black tabular-nums text-zinc-100">{streak}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Day streak</p>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-sm font-bold">Completed workouts</p>
                <p className="text-[11px] text-zinc-500">{history.length === 0 ? 'Nothing yet' : `${history.length} logged`}</p>
              </div>

              {history.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                  <HistoryIcon className="size-10 text-zinc-600" aria-hidden />
                  <p className="text-sm font-semibold text-zinc-300">No workouts logged yet</p>
                  <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                    Finish your first session and it lands here automatically — duration, sets and a growing day
                    streak.
                  </p>
                  <Button
                    onClick={() => setTab('routines')}
                    className="mt-1 h-11 rounded-xl bg-gradient-to-r from-orange-300 via-amber-400 to-amber-500 font-semibold text-zinc-950 hover:from-orange-200 hover:via-amber-300 hover:to-amber-400"
                  >
                    <Play className="size-4" aria-hidden /> Start a routine
                  </Button>
                </div>
              ) : (
                <div className={cn('max-h-[26rem] space-y-1.5 overflow-y-auto pr-1', SCROLLBAR)}>
                  {history.map((h) => {
                    const expanded = expandedHist === h.id
                    const confirming = confirmHistDelete === h.id
                    return (
                      <motion.div
                        key={h.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                        className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                      >
                        <button
                          onClick={() => setExpandedHist(expanded ? null : h.id)}
                          aria-expanded={expanded}
                          className="flex w-full items-center gap-3 text-left"
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
                            <Dumbbell className="size-4.5" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-zinc-100">{h.routineName}</p>
                            <p className="text-[11px] text-zinc-500">
                              {dayLabelOf(h.date, today)} · {h.totalSets} {h.totalSets === 1 ? 'set' : 'sets'}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-bold tabular-nums text-amber-300">{fmtClock(h.durationSec)}</p>
                            <p className="text-[10px] text-zinc-500">
                              {new Date(h.completedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                            </p>
                          </div>
                          <ChevronDown
                            className={cn('size-4 shrink-0 text-zinc-500 transition-transform', expanded && 'rotate-180')}
                            aria-hidden
                          />
                        </button>
                        <AnimatePresence initial={false}>
                          {expanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/5 pt-3 text-center">
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Duration</p>
                                  <p className="text-sm font-bold tabular-nums text-zinc-100">{fmtClock(h.durationSec)}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Sets done</p>
                                  <p className="text-sm font-bold tabular-nums text-zinc-100">{h.totalSets}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Finished</p>
                                  <p className="text-sm font-bold tabular-nums text-zinc-100">
                                    {new Date(h.completedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                                  </p>
                                </div>
                              </div>
                              <div className="mt-3 flex justify-end">
                                <button
                                  onClick={() => (confirming ? removeHist(h.id) : setConfirmHistDelete(h.id))}
                                  aria-label={confirming ? 'Confirm delete entry' : `Delete ${h.routineName} entry`}
                                  className={cn(
                                    'flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors',
                                    confirming
                                      ? 'bg-rose-500 text-white'
                                      : 'text-rose-300/80 hover:bg-rose-500/15 hover:text-rose-300'
                                  )}
                                >
                                  <Trash2 className="size-3.5" aria-hidden />
                                  {confirming ? 'Tap again to delete' : 'Delete entry'}
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </motion.div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {/* ---------------- New-routine modal ---------------- */}
      <AnimatePresence>
        {newOpen && (
          <motion.div
            key="new-routine"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setNewOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="New routine"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                  <Plus className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">New routine</h3>
                <button
                  onClick={() => setNewOpen(false)}
                  aria-label="Close"
                  className="flex size-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Name</p>
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createRoutine()
                    }}
                    maxLength={48}
                    placeholder="e.g. Push Day"
                    aria-label="Routine name"
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm font-semibold text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400/50 focus:outline-none"
                  />
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Start from a template <span className="font-normal normal-case text-zinc-600">(optional)</span>
                  </p>
                  <div className="space-y-1.5" role="radiogroup" aria-label="Template">
                    <button
                      onClick={() => setNewTpl(null)}
                      role="radio"
                      aria-checked={newTpl === null}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all',
                        newTpl === null ? 'border-amber-400/60 bg-amber-500/15' : 'border-white/10 bg-white/5 hover:bg-white/10'
                      )}
                    >
                      <Dumbbell className="size-4 shrink-0 text-zinc-400" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-zinc-100">Empty</span>
                        <span className="block text-[11px] text-zinc-500">Pick exercises yourself</span>
                      </span>
                      {newTpl === null && <Check className="size-4 shrink-0 text-amber-300" aria-hidden />}
                    </button>
                    {TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setNewTpl(t.id)}
                        role="radio"
                        aria-checked={newTpl === t.id}
                        className={cn(
                          'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all',
                          newTpl === t.id ? 'border-amber-400/60 bg-amber-500/15' : 'border-white/10 bg-white/5 hover:bg-white/10'
                        )}
                      >
                        <Flame className="size-4 shrink-0 text-amber-300" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold text-zinc-100">{t.label}</span>
                          <span className="block text-[11px] text-zinc-500">{t.exerciseIds.length} exercises pre-filled</span>
                        </span>
                        {newTpl === t.id && <Check className="size-4 shrink-0 text-amber-300" aria-hidden />}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={createRoutine}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-orange-300 via-amber-400 to-amber-500 font-semibold text-zinc-950 shadow-lg hover:from-orange-200 hover:via-amber-300 hover:to-amber-400"
                >
                  Create routine
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Exercise library modal ---------------- */}
      <AnimatePresence>
        {libOpen && (
          <motion.div
            key="library"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setLibOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Exercise library"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                  <Search className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold">Exercise library</h3>
                  <p className="text-[11px] text-zinc-500">{LIB.length} curated moves</p>
                </div>
                <button
                  onClick={() => setLibOpen(false)}
                  aria-label="Close"
                  className="flex size-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 transition-colors focus-within:border-amber-400/50">
                <Search className="size-4 shrink-0 text-zinc-500" aria-hidden />
                <input
                  value={libQuery}
                  onChange={(e) => setLibQuery(e.target.value)}
                  placeholder="Search exercises"
                  aria-label="Search exercises"
                  className="h-11 w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                />
                {libQuery && (
                  <button onClick={() => setLibQuery('')} aria-label="Clear search" className="text-zinc-500 hover:text-zinc-200">
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </div>

              <div className="no-scrollbar -mx-1 mt-3 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5" role="group" aria-label="Muscle groups">
                {GROUPS.map((g) => (
                  <button
                    key={g}
                    onClick={() => setLibGroup(g)}
                    aria-pressed={libGroup === g}
                    className={cn(
                      'h-9 shrink-0 rounded-lg px-3 text-[11px] font-bold transition-all',
                      libGroup === g ? 'bg-amber-500 text-zinc-950' : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>

              <div className={cn('mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1', SCROLLBAR)}>
                {libResults.length === 0 ? (
                  <p className="py-10 text-center text-xs text-zinc-500">No exercises match “{libQuery.trim()}”.</p>
                ) : (
                  libResults.map((lib) => {
                    const added = justAdded === lib.id
                    return (
                      <div key={lib.id} className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-zinc-100">{lib.name}</p>
                          <p className="text-[11px] text-zinc-500">
                            {lib.group} ·{' '}
                            {lib.type === 'reps' ? `${lib.sets} × ${lib.reps ?? 10} reps` : `${lib.sets} × ${lib.seconds ?? 30}s`}
                          </p>
                        </div>
                        <button
                          onClick={() => addFromLibrary(lib)}
                          aria-label={`Add ${lib.name} to routine`}
                          className={cn(
                            'flex h-10 shrink-0 items-center gap-1 rounded-lg px-3 text-xs font-bold transition-all',
                            added ? 'bg-emerald-500 text-zinc-950' : 'bg-amber-500/20 text-amber-200 hover:bg-amber-500 hover:text-zinc-950'
                          )}
                        >
                          {added ? <Check className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
                          {added ? 'Added' : 'Add'}
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Active workout player ---------------- */}
      <AnimatePresence>
        {session && sessionRoutine && (
          <motion.div
            key="player"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] overflow-y-auto bg-zinc-950 text-zinc-100"
            role="dialog"
            aria-modal="true"
            aria-label="Active workout"
          >
            <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 pb-10 pt-[max(0.75rem,env(safe-area-inset-top))]">
              {/* top bar */}
              <div className="flex items-center gap-2.5 pt-1">
                <button
                  onClick={() => setEndOpen(true)}
                  aria-label="End workout"
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                >
                  <X className="size-4.5" aria-hidden />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold leading-tight">{sessionRoutine.name}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    {session.phase === 'done' ? 'Workout complete' : session.paused ? 'Paused' : 'In progress'}
                  </p>
                </div>
                <span className="shrink-0 text-base font-black tabular-nums text-zinc-100">
                  {fmtClock(session.elapsedSec)}
                </span>
                {session.phase !== 'done' && (
                  <button
                    onClick={togglePause}
                    aria-label={session.paused ? 'Resume workout' : 'Pause workout'}
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-amber-300 transition-colors hover:bg-amber-500/15"
                  >
                    {session.paused ? <Play className="size-4.5" aria-hidden /> : <Pause className="size-4.5" aria-hidden />}
                  </button>
                )}
              </div>

              {/* overall progress */}
              <div className="mt-4">
                <div className="mb-1 flex items-baseline justify-between text-[11px]">
                  <span className="font-semibold text-zinc-400">Overall progress</span>
                  <span className="font-bold tabular-nums text-zinc-300">
                    {session.setsDone}/{sessionTotalSets} sets
                  </span>
                </div>
                <div
                  className="h-2.5 overflow-hidden rounded-full bg-white/[0.07]"
                  role="progressbar"
                  aria-valuenow={Math.round(Math.min(1, sessionTotalSets > 0 ? session.setsDone / sessionTotalSets : 0) * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Workout progress"
                >
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-orange-300 via-amber-400 to-orange-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, sessionTotalSets > 0 ? (session.setsDone / sessionTotalSets) * 100 : 0)}%` }}
                    transition={{ type: 'spring', stiffness: 120, damping: 24 }}
                  />
                </div>
              </div>

              {/* rest length chips */}
              {session.phase !== 'done' && (
                <div className="no-scrollbar -mx-1 mt-3 flex items-center gap-1.5 overflow-x-auto px-1" role="radiogroup" aria-label="Rest length">
                  <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    <Timer className="size-3.5" aria-hidden /> Rest
                  </span>
                  {REST_PRESETS.map((sec) => (
                    <button
                      key={sec}
                      onClick={() => pickRest(sec)}
                      role="radio"
                      aria-checked={settings.restSec === sec}
                      className={cn(
                        'h-8 shrink-0 rounded-lg px-2.5 text-[11px] font-bold tabular-nums transition-all',
                        settings.restSec === sec ? 'bg-amber-500 text-zinc-950' : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                      )}
                    >
                      {sec}s
                    </button>
                  ))}
                </div>
              )}

              {/* ---------------- main card ---------------- */}
              {session.phase === 'done' ? (
                /* ---- summary ---- */
                <motion.div
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                  className="mt-6 rounded-3xl border border-amber-400/25 bg-gradient-to-b from-amber-500/[0.1] to-white/[0.02] p-6 text-center"
                >
                  <motion.span
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 }}
                    className="mx-auto flex size-16 items-center justify-center rounded-full bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/30"
                  >
                    <CheckCircle2 className="size-9" aria-hidden />
                  </motion.span>
                  <h2 className="mt-3 text-2xl font-black tracking-tight">Workout complete</h2>
                  <p className="mt-1 text-xs text-zinc-400">{sessionRoutine.name} · saved to history</p>

                  <div className="mt-5 grid grid-cols-3 gap-2">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-lg font-black tabular-nums text-amber-300">{fmtClock(session.elapsedSec)}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Duration</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-lg font-black tabular-nums text-amber-300">{session.setsDone}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Sets</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <p className="text-lg font-black tabular-nums text-amber-300">{exercisesDone}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Exercises</p>
                    </div>
                  </div>

                  {streak > 0 && (
                    <p className="mt-4 flex items-center justify-center gap-1.5 text-xs font-semibold text-orange-300">
                      <Flame className="size-4" aria-hidden />
                      {streak}-day streak — keep it alive
                    </p>
                  )}

                  <Button
                    onClick={closeSummary}
                    className="mt-5 h-12 w-full rounded-xl bg-gradient-to-r from-orange-300 via-amber-400 to-amber-500 font-semibold text-zinc-950 shadow-lg hover:from-orange-200 hover:via-amber-300 hover:to-amber-400"
                  >
                    Done
                  </Button>
                </motion.div>
              ) : session.phase === 'rest' ? (
                /* ---- rest ---- */
                <motion.div
                  key="rest"
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                  className="mt-5 rounded-3xl border border-white/10 bg-gradient-to-b from-orange-500/[0.07] to-white/[0.02] p-5 text-center"
                >
                  <p className="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-300/80">
                    <Timer className="size-4" aria-hidden /> Rest between exercises
                  </p>
                  <motion.div
                    animate={session.paused ? undefined : { scale: [1, 1.03, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    className="relative mx-auto mt-3 w-fit"
                  >
                    <motion.div
                      animate={session.paused ? undefined : { opacity: [0.35, 0.65, 0.35] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                      className="absolute -inset-3 rounded-full bg-amber-500/25 blur-2xl"
                      aria-hidden
                    />
                    <div className={cn('relative', session.paused && 'opacity-60')}>
                      <Ring size={216} stroke={12} frac={session.restTotal > 0 ? session.restLeft / session.restTotal : 0} color="#f59e0b" glow />
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <p className="text-7xl font-black tabular-nums tracking-tight text-amber-300">{session.restLeft}</p>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">seconds</p>
                      </div>
                    </div>
                  </motion.div>

                  {nextEx && (
                    <p className="mt-4 text-sm text-zinc-300">
                      Next up: <span className="font-bold text-zinc-100">{nextEx.name}</span>
                      <span className="ml-1 text-zinc-500">({targetLabel(nextEx)})</span>
                    </p>
                  )}
                  {session.paused && (
                    <p className="mt-2 inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                      Paused
                    </p>
                  )}
                  <button
                    onClick={skipRest}
                    className="mx-auto mt-4 flex h-12 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 text-sm font-bold text-zinc-100 transition-colors hover:bg-white/10"
                  >
                    <SkipForward className="size-4" aria-hidden /> Skip rest
                  </button>
                  <p className="mt-3 text-[11px] text-zinc-500">Beeps at 3 · 2 · 1 · go</p>
                </motion.div>
              ) : (
                /* ---- work ---- */
                curEx && (
                  <motion.div
                    key={`work-${session.exIndex}-${session.setIndex}`}
                    initial={{ opacity: 0, y: 18, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                    className="mt-5 rounded-3xl border border-white/10 bg-gradient-to-b from-orange-500/[0.07] to-white/[0.02] p-5 text-center"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-300/80">
                      Exercise {session.exIndex + 1} of {sessionRoutine.exercises.length} · Set {session.setIndex + 1} of{' '}
                      {curEx.sets}
                    </p>
                    <h2 className="mt-1 break-words text-2xl font-black tracking-tight sm:text-3xl">{curEx.name}</h2>
                    <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-300">
                        {curEx.type === 'reps' ? `${curEx.reps ?? 10} reps` : `${curEx.seconds ?? 30}s`}
                      </span>
                      {curEx.weightNote && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                          <Weight className="size-3" aria-hidden /> {curEx.weightNote}
                        </span>
                      )}
                      {session.paused && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-zinc-300">
                          Paused
                        </span>
                      )}
                    </div>

                    {curEx.type === 'time' ? (
                      <div className="relative mx-auto mt-4 w-fit">
                        <div className={cn('relative', session.paused && 'opacity-60')}>
                          <Ring
                            size={216}
                            stroke={12}
                            frac={curEx.seconds ? session.timeLeft / curEx.seconds : 0}
                            color="#fb923c"
                            glow
                          />
                          <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <p className="text-7xl font-black tabular-nums tracking-tight text-orange-300">{session.timeLeft}</p>
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">seconds</p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-zinc-500">Auto-advances when the timer ends</p>
                      </div>
                    ) : (
                      <div className="mt-5">
                        <p className="text-7xl font-black tabular-nums tracking-tight text-orange-300 sm:text-8xl">
                          {curEx.reps ?? 10}
                        </p>
                        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">reps</p>
                      </div>
                    )}

                    {/* set dots */}
                    <div className="mt-4 flex items-center justify-center gap-1.5" aria-label={`Set ${session.setIndex + 1} of ${curEx.sets}`}>
                      {Array.from({ length: curEx.sets }, (_, i) => (
                        <span
                          key={i}
                          className={cn(
                            'h-2 rounded-full transition-all',
                            i < session.setIndex ? 'w-5 bg-amber-400' : i === session.setIndex ? 'w-5 animate-pulse bg-amber-400/50' : 'w-2 bg-white/15'
                          )}
                        />
                      ))}
                    </div>

                    <Button
                      onClick={doneSet}
                      className="mt-5 h-14 w-full rounded-2xl bg-gradient-to-r from-orange-300 via-amber-400 to-amber-500 text-base font-bold text-zinc-950 shadow-[0_12px_32px_-10px_rgb(245_158_11/0.6)] hover:from-orange-200 hover:via-amber-300 hover:to-amber-400"
                    >
                      <Check className="size-5" aria-hidden /> Done set
                    </Button>
                  </motion.div>
                )
              )}

              {/* upcoming exercises */}
              {session.phase !== 'done' && sessionRoutine.exercises.length > session.exIndex + (session.phase === 'work' ? 1 : 0) && (
                <div className="mt-5">
                  <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Up next</p>
                  <div className={cn('max-h-44 space-y-1.5 overflow-y-auto pr-1', SCROLLBAR)}>
                    {sessionRoutine.exercises.slice(session.exIndex + 1).map((ex, i) => (
                      <div
                        key={`${ex.name}-${i}`}
                        className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5"
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/5 text-[11px] font-bold text-zinc-400 tabular-nums">
                          {session.exIndex + i + 2}
                        </span>
                        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200">{ex.name}</p>
                        <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">{targetLabel(ex)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- End-workout confirm ---------------- */}
      <AnimatePresence>
        {endOpen && session && session.phase !== 'done' && (
          <motion.div
            key="end-workout"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setEndOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="End workout"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-rose-500/20 text-rose-300">
                  <X className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">End workout?</h3>
              </div>
              <p className="text-xs leading-relaxed text-zinc-400">
                You&apos;ve completed{' '}
                <span className="font-bold text-zinc-100">
                  {session.setsDone} of {sessionTotalSets}
                </span>{' '}
                sets in {fmtClock(session.elapsedSec)}
                {session.setsDone > 0 ? '. Save it to your history?' : '.'}
              </p>
              <div className="mt-5 space-y-2">
                {session.setsDone > 0 && (
                  <Button
                    onClick={() => {
                      const s = sessionRef.current
                      setEndOpen(false)
                      if (s) finishSession(s)
                    }}
                    className="h-11 w-full rounded-xl bg-gradient-to-r from-orange-300 via-amber-400 to-amber-500 font-semibold text-zinc-950 shadow-lg hover:from-orange-200 hover:via-amber-300 hover:to-amber-400"
                  >
                    <CheckCircle2 className="size-4" aria-hidden /> Save &amp; finish
                  </Button>
                )}
                <button
                  onClick={() => setEndOpen(false)}
                  className="h-11 w-full rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-100 transition-colors hover:bg-white/10"
                >
                  Keep going
                </button>
                <button
                  onClick={discardSession}
                  className="h-11 w-full rounded-xl text-sm font-semibold text-rose-300/80 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                >
                  Discard workout
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
