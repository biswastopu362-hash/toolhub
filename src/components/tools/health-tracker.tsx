'use client'

/**
 * Health Tracker — your body's numbers, private and on-device.
 *
 * A heart-pulse flavored daily companion: a profile-driven BMI gauge ring
 * with BMR + calorie target (Mifflin-St Jeor), a water intake tracker with
 * an animated day ring and 7-day bars, a weight log with trend chart, and
 * a 30-day water-goal heatmap. Everything persists in IndexedDB.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  CalendarDays,
  Droplets,
  Flame,
  HeartPulse,
  Minus,
  Plus,
  Scale,
  Settings2,
  Trash2,
  TrendingDown,
  TrendingUp,
  UserRound,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type Sex = 'male' | 'female'
type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active'

interface Profile {
  heightCm: number
  weightKg: number
  age: number
  sex: Sex
  activity: ActivityLevel
  /** daily goal, in glasses */
  goalGlasses: number
  /** ml per glass */
  glassMl: number
}

interface ProfileRow extends Profile {
  key: 'profile'
}

interface WaterRow {
  /** local date key 'YYYY-MM-DD' */
  date: string
  /** glasses drunk */
  count: number
  /** day's total goal in ml (snapshot at write time) */
  goalMl: number
}

interface WeightRow {
  id: string
  kg: number
  date: string
  note: string
  createdAt: number
}

const DEFAULT_PROFILE: Profile = {
  heightCm: 0,
  weightKg: 0,
  age: 0,
  sex: 'male',
  activity: 'light',
  goalGlasses: 8,
  glassMl: 250,
}

const ACTIVITIES: { id: ActivityLevel; label: string; mult: number; hint: string }[] = [
  { id: 'sedentary', label: 'Sedentary', mult: 1.2, hint: 'Little or no exercise' },
  { id: 'light', label: 'Light', mult: 1.375, hint: '1–3 days / week' },
  { id: 'moderate', label: 'Moderate', mult: 1.55, hint: '3–5 days / week' },
  { id: 'active', label: 'Active', mult: 1.725, hint: '6–7 days / week' },
]

const GLASS_SIZES = [150, 200, 250, 300, 330, 500]

/* ---------------- date helpers (all local-time) ---------------- */

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(key: string, today: Date): string {
  const y = new Date(today)
  y.setDate(today.getDate() - 1)
  if (key === dateKey(today)) return 'Today'
  if (key === dateKey(y)) return 'Yesterday'
  const [yy, mm, dd] = key.split('-').map(Number)
  return new Date(yy, (mm ?? 1) - 1, dd ?? 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function weekdayLabel(key: string, today: Date): string {
  if (key === dateKey(today)) return 'Today'
  const [yy, mm, dd] = key.split('-').map(Number)
  return new Date(yy, (mm ?? 1) - 1, dd ?? 1).toLocaleDateString('en-US', { weekday: 'short' })
}

function shortDate(iso: string): string {
  const [yy, mm, dd] = iso.split('-').map(Number)
  return new Date(yy, (mm ?? 1) - 1, dd ?? 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function haptic(): void {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

/* ---------------- body math ---------------- */

function bmiOf(weightKg: number, heightCm: number): number {
  if (weightKg <= 0 || heightCm <= 0) return 0
  const m = heightCm / 100
  return weightKg / (m * m)
}

function bmiBand(bmi: number): { hex: string; label: string } {
  if (bmi < 18.5) return { hex: '#fbbf24', label: 'Underweight' }
  if (bmi < 25) return { hex: '#34d399', label: 'Healthy' }
  if (bmi < 30) return { hex: '#fbbf24', label: 'Overweight' }
  return { hex: '#fb7185', label: 'Obese' }
}

/** Mifflin-St Jeor basal metabolic rate (kcal/day) */
function bmrOf(p: Profile): number {
  if (p.weightKg <= 0 || p.heightCm <= 0 || p.age <= 0) return 0
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age
  return base + (p.sex === 'male' ? 5 : -161)
}

function multOf(id: ActivityLevel): number {
  return ACTIVITIES.find((a) => a.id === id)?.mult ?? 1.375
}

/* ================================================================== */
/* IndexedDB — profile, water days & weigh-ins, fully on-device        */
/* ================================================================== */

const DB_NAME = 'toolhub-health'
const DB_VERSION = 1
const METRICS_STORE = 'metrics'
const WATER_STORE = 'water'
const WEIGHTS_STORE = 'weights'

let dbPromise: Promise<IDBDatabase> | null = null

function openHealthDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(METRICS_STORE)) d.createObjectStore(METRICS_STORE, { keyPath: 'key' })
      if (!d.objectStoreNames.contains(WATER_STORE)) d.createObjectStore(WATER_STORE, { keyPath: 'date' })
      if (!d.objectStoreNames.contains(WEIGHTS_STORE)) d.createObjectStore(WEIGHTS_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openHealthDb()
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
/* Shared bits                                                         */
/* ================================================================== */

const TOOLTIP_STYLE = {
  background: 'rgba(9,9,11,0.95)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  fontSize: 12,
  color: '#e4e4e7',
  padding: '8px 10px',
} as const

const SCROLL =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

const ROSE_BTN =
  'bg-gradient-to-r from-rose-300 to-rose-500 font-semibold text-zinc-950 shadow-lg hover:from-rose-200 hover:to-rose-400'

/** gauge ring geometry (BMI 14 → 40 mapped to 0 → 100%) */
const G_MIN = 14
const G_MAX = 40
const G_R = 46
const G_C = 2 * Math.PI * G_R

function gaugeFrac(bmi: number): number {
  return clamp((bmi - G_MIN) / (G_MAX - G_MIN), 0, 1)
}

function gaugePoint(bmi: number): { x: number; y: number } {
  const rad = ((-90 + gaugeFrac(bmi) * 360) * Math.PI) / 180
  return { x: 56 + G_R * Math.cos(rad), y: 56 + G_R * Math.sin(rad) }
}

type TabId = 'today' | 'weight' | 'history'

const TABS: { id: TabId; label: string; icon: typeof Activity }[] = [
  { id: 'today', label: 'Today', icon: Activity },
  { id: 'weight', label: 'Weight', icon: Scale },
  { id: 'history', label: 'History', icon: Flame },
]

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function HealthTrackerApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [profile, setProfile] = useState<Profile>(DEFAULT_PROFILE)
  const [water, setWater] = useState<Record<string, WaterRow>>({})
  const [weights, setWeights] = useState<WeightRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<TabId>('today')
  const [profileOpen, setProfileOpen] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const today = useMemo(() => new Date(), [])
  const todayKey = dateKey(today)

  /* mirrors for write-through computations */
  const waterRef = useRef<Record<string, WaterRow>>({})
  const profileRef = useRef<Profile>(DEFAULT_PROFILE)
  useEffect(() => {
    waterRef.current = water
  }, [water])
  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  /* ---------------- profile draft (dialog) ---------------- */
  const [dHeight, setDHeight] = useState('')
  const [dWeight, setDWeight] = useState('')
  const [dAge, setDAge] = useState('')
  const [dSex, setDSex] = useState<Sex>('male')

  /* ---------------- weight form ---------------- */
  const [formKg, setFormKg] = useState('')
  const [formDate, setFormDate] = useState(todayKey)
  const [formNote, setFormNote] = useState('')
  const kgRef = useRef<HTMLInputElement>(null)

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [metricRows, waterRows, weightRows] = await Promise.all([
          idbGetAll<ProfileRow>(METRICS_STORE),
          idbGetAll<WaterRow>(WATER_STORE),
          idbGetAll<WeightRow>(WEIGHTS_STORE),
        ])
        if (!alive) return
        const saved = metricRows.find((r) => r.key === 'profile')
        if (saved) {
          const p: Profile = {
            heightCm: Number(saved.heightCm) || 0,
            weightKg: Number(saved.weightKg) || 0,
            age: Number(saved.age) || 0,
            sex: saved.sex === 'female' ? 'female' : 'male',
            activity: ACTIVITIES.some((a) => a.id === saved.activity) ? saved.activity : 'light',
            goalGlasses: clamp(Math.round(Number(saved.goalGlasses)) || 8, 1, 20),
            glassMl: GLASS_SIZES.includes(Number(saved.glassMl)) ? Number(saved.glassMl) : 250,
          }
          setProfile(p)
          if (p.weightKg > 0) setFormKg(String(p.weightKg))
        }
        const map: Record<string, WaterRow> = {}
        for (const r of waterRows) map[r.date] = r
        setWater(map)
        setWeights(weightRows)
      } catch {
        /* private mode / quota — keep in-memory data */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* auto-reset the two-tap delete confirmation */
  useEffect(() => {
    if (!confirmId) return
    const t = window.setTimeout(() => setConfirmId(null), 2600)
    return () => window.clearTimeout(t)
  }, [confirmId])

  /* ---------------- mutations (write-through to IndexedDB) ---------------- */

  const saveProfile = useCallback(
    (p: Profile) => {
      setProfile(p)
      void idbPut(METRICS_STORE, { ...p, key: 'profile' } satisfies ProfileRow).catch(() => {
        /* memory-only fallback */
      })
      /* keep today's water row goal snapshot in sync with the new goal */
      const cur = waterRef.current[todayKey]
      if (cur) {
        const next: WaterRow = { ...cur, goalMl: p.goalGlasses * p.glassMl }
        setWater((prev) => ({ ...prev, [todayKey]: next }))
        void idbPut(WATER_STORE, next).catch(() => {
          /* memory-only fallback */
        })
      }
    },
    [todayKey]
  )

  const applyDraft = useCallback(() => {
    const h = parseFloat(dHeight)
    const w = parseFloat(dWeight)
    const a = parseInt(dAge, 10)
    const p = profileRef.current
    const next: Profile = {
      ...p,
      heightCm: Number.isFinite(h) ? clamp(round2(h), 80, 250) : p.heightCm,
      weightKg: Number.isFinite(w) ? clamp(round2(w), 25, 400) : p.weightKg,
      age: Number.isFinite(a) ? clamp(a, 1, 120) : p.age,
      sex: dSex,
    }
    saveProfile(next)
    setProfileOpen(false)
    if (next.weightKg > 0 && formKg === '') setFormKg(String(next.weightKg))
    toast({
      title: 'Profile saved',
      description:
        next.heightCm > 0 && next.weightKg > 0
          ? `BMI & calorie target updated · goal ${next.goalGlasses} × ${next.glassMl} ml`
          : `Water goal set to ${next.goalGlasses} × ${next.glassMl} ml`,
    })
  }, [dAge, dHeight, dSex, dWeight, formKg, saveProfile, toast])

  const openProfile = useCallback(() => {
    const p = profileRef.current
    setDHeight(p.heightCm > 0 ? String(p.heightCm) : '')
    setDWeight(p.weightKg > 0 ? String(p.weightKg) : '')
    setDAge(p.age > 0 ? String(p.age) : '')
    setDSex(p.sex)
    setProfileOpen(true)
  }, [])

  /** add / remove glasses for today — goal snapshot is refreshed on every write */
  const bumpWater = useCallback(
    (delta: number) => {
      const p = profileRef.current
      const goalMl = p.goalGlasses * p.glassMl
      const cur = waterRef.current[todayKey] ?? { date: todayKey, count: 0, goalMl }
      const next: WaterRow = { date: todayKey, count: Math.max(0, cur.count + delta), goalMl }
      if (next.count === cur.count) return
      setWater((prev) => ({ ...prev, [todayKey]: next }))
      void idbPut(WATER_STORE, next).catch(() => {
        /* memory-only fallback */
      })
      if (delta > 0) {
        haptic()
        if (cur.count < p.goalGlasses && next.count >= p.goalGlasses) {
          toast({
            title: 'Daily water goal reached! 💧',
            description: `${next.count} glasses · ${fmt(next.count * p.glassMl)} ml. Nicely done.`,
          })
        }
      }
    },
    [todayKey, toast]
  )

  const addWeight = useCallback(() => {
    const kg = round2(parseFloat(formKg))
    if (!formKg.trim() || Number.isNaN(kg) || kg < 25 || kg > 400) {
      toast({ title: 'Enter a weight first', description: 'Between 25 and 400 kg.' })
      return
    }
    const prevKg = profileRef.current.weightKg
    const row: WeightRow = {
      id: `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      kg,
      date: formDate,
      note: formNote.trim(),
      createdAt: Date.now(),
    }
    setWeights((prev) => [row, ...prev])
    void idbPut(WEIGHTS_STORE, row).catch(() => {
      /* memory-only fallback */
    })
    setFormNote('')
    haptic()
    /* keep the profile (and BMI) in sync with the latest weigh-in */
    if (kg !== prevKg) {
      saveProfile({ ...profileRef.current, weightKg: kg })
    }
    const first = weights.length === 0
    toast({
      title: 'Weigh-in logged',
      description: first
        ? `${fmt(kg)} kg on ${dayLabel(formDate, today)} — your trend starts here.`
        : `${fmt(kg)} kg on ${dayLabel(formDate, today)}${kg !== prevKg && prevKg > 0 ? ` · ${kg > prevKg ? '+' : '−'}${fmt(Math.abs(round2(kg - prevKg)))} kg vs profile` : ''}`,
    })
  }, [formDate, formKg, formNote, saveProfile, toast, today, weights.length])

  const removeWeight = useCallback((id: string) => {
    setWeights((prev) => prev.filter((w) => w.id !== id))
    setConfirmId(null)
    void idbDelete(WEIGHTS_STORE, id).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  /* ---------------- derived ---------------- */

  const profileSet = profile.heightCm > 0 && profile.weightKg > 0
  const bmi = profileSet ? bmiOf(profile.weightKg, profile.heightCm) : 0
  const band = bmiBand(bmi || 18.5)
  const bmr = profileSet ? bmrOf(profile) : 0
  const target = profileSet && bmr > 0 ? Math.round(bmr * multOf(profile.activity)) : 0

  const goalMl = profile.goalGlasses * profile.glassMl
  const todayWater = water[todayKey]
  const todayCount = todayWater?.count ?? 0
  const waterFrac = clamp(todayCount / Math.max(1, profile.goalGlasses), 0, 1)

  const weightsAsc = useMemo(
    () =>
      [...weights].sort((a, b) =>
        a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1
      ),
    [weights]
  )
  const weightsDesc = useMemo(() => [...weightsAsc].reverse(), [weightsAsc])
  const deltaById = useMemo(() => {
    const m = new Map<string, number | null>()
    weightsAsc.forEach((w, i) => m.set(w.id, i === 0 ? null : round2(w.kg - weightsAsc[i - 1].kg)))
    return m
  }, [weightsAsc])

  const last7 = useMemo(() => {
    const rows: { label: string; ml: number; glasses: number; today: boolean }[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = dateKey(d)
      const row = water[key]
      rows.push({
        label: weekdayLabel(key, today),
        ml: (row?.count ?? 0) * profile.glassMl,
        glasses: row?.count ?? 0,
        today: i === 0,
      })
    }
    return rows
  }, [profile.glassMl, today, water])

  const last30 = useMemo(() => {
    const keys: string[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      keys.push(dateKey(d))
    }
    return keys
  }, [today])

  /** goal-hit state per day: hit / partial (≥ half) / miss */
  const heatStats = useMemo(() => {
    let hits = 0
    let glasses = 0
    let ml = 0
    let streak = 0
    let best = 0
    const state = new Map<string, 'hit' | 'partial' | 'miss'>()
    for (const key of last30) {
      const row = water[key]
      const count = row?.count ?? 0
      const rowGoal = row?.goalMl ?? goalMl
      glasses += count
      ml += count * profile.glassMl
      const drank = count * profile.glassMl
      let s: 'hit' | 'partial' | 'miss' = 'miss'
      if (rowGoal > 0 && drank >= rowGoal) s = 'hit'
      else if (rowGoal > 0 && drank >= rowGoal / 2) s = 'partial'
      state.set(key, s)
      if (s === 'hit') {
        streak += 1
        best = Math.max(best, streak)
        hits += 1
      } else {
        streak = 0
      }
    }
    return { hits, best, glasses, ml, avg: Math.round(ml / 30), state }
  }, [goalMl, last30, profile.glassMl, water])

  const waterYMax = useMemo(() => {
    const max = Math.max(goalMl, ...last7.map((r) => r.ml), 1)
    return Math.ceil((max * 1.15) / 100) * 100
  }, [goalMl, last7])

  const weightChart = useMemo(() => {
    if (weightsAsc.length < 2) return null
    const rows = weightsAsc.map((w) => ({ label: shortDate(w.date), kg: w.kg }))
    const kgs = weightsAsc.map((w) => w.kg)
    const min = Math.floor(Math.min(...kgs) - 1)
    const max = Math.ceil(Math.max(...kgs) + 1)
    return { rows, min, max }
  }, [weightsAsc])

  const latestDelta = weightsAsc.length >= 2 ? round2(weightsAsc[weightsAsc.length - 1].kg - weightsAsc[weightsAsc.length - 2].kg) : null

  const goWeightTab = useCallback(() => {
    setTab('weight')
    window.setTimeout(() => kgRef.current?.focus(), 160)
  }, [])

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
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-rose-500/[0.09] via-transparent to-red-600/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-rose-300 via-rose-500 to-red-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(244_63_94/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <HeartPulse className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Health Tracker</h2>
              <p className="text-xs text-zinc-400">BMI, water &amp; weight — private, on-device.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={goWeightTab}
                aria-label="Log a weigh-in"
                className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Scale className="size-5" aria-hidden />
              </button>
              <button
                onClick={openProfile}
                aria-label="Profile and goals settings"
                className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Settings2 className="size-5" aria-hidden />
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div className="mt-5 grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5" role="tablist" aria-label="Health sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                role="tab"
                aria-selected={tab === t.id}
                className={cn(
                  'flex h-11 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition-all',
                  tab === t.id
                    ? 'bg-gradient-to-r from-rose-500/25 to-red-600/20 text-rose-200 ring-1 ring-rose-400/30'
                    : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                )}
              >
                <t.icon className="size-4" aria-hidden />
                {t.label}
              </button>
            ))}
          </div>
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
            {/* ============================================================ */}
            {/* TODAY                                                        */}
            {/* ============================================================ */}
            {tab === 'today' && (
              <>
                {/* ---------------- BMI & calories ---------------- */}
                <motion.section
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 240, damping: 24 }}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-rose-500/[0.08] to-red-600/[0.05] p-4"
                  aria-label="Body metrics"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold">Body metrics</p>
                    <button
                      onClick={openProfile}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <UserRound className="size-3.5" aria-hidden />
                      Edit
                    </button>
                  </div>

                  {profileSet ? (
                    <>
                      <div className="mt-4 flex items-center gap-4">
                        {/* gauge ring */}
                        <div className="relative shrink-0" role="img" aria-label={`BMI ${bmi.toFixed(1)} — ${band.label}`}>
                          <svg viewBox="0 0 112 112" className="size-28 sm:size-32">
                            <circle cx={56} cy={56} r={G_R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={10} />
                            <motion.circle
                              cx={56}
                              cy={56}
                              r={G_R}
                              fill="none"
                              stroke={band.hex}
                              strokeWidth={10}
                              strokeLinecap="round"
                              strokeDasharray={G_C}
                              initial={{ strokeDashoffset: G_C }}
                              animate={{ strokeDashoffset: G_C * (1 - gaugeFrac(bmi)) }}
                              transition={{ type: 'spring', stiffness: 60, damping: 18 }}
                              transform="rotate(-90 56 56)"
                              style={{ filter: `drop-shadow(0 0 6px ${band.hex}66)` }}
                            />
                            {/* threshold ticks: 18.5 / 25 / 30 */}
                            {[18.5, 25, 30].map((v) => {
                              const p = gaugePoint(v)
                              return <circle key={v} cx={p.x} cy={p.y} r={2} fill="rgba(255,255,255,0.4)" />
                            })}
                          </svg>
                          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                            <p className="text-2xl font-black tabular-nums leading-none tracking-tight">
                              {bmi.toFixed(1)}
                            </p>
                            <p className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">BMI</p>
                          </div>
                        </div>

                        {/* stats */}
                        <div className="min-w-0 flex-1 space-y-2">
                          <span
                            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold"
                            style={{ backgroundColor: `${band.hex}1f`, borderColor: `${band.hex}44`, color: band.hex }}
                          >
                            <span className="size-1.5 rounded-full" style={{ backgroundColor: band.hex }} aria-hidden />
                            {band.label}
                          </span>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">BMR</p>
                              <p className="text-sm font-bold tabular-nums text-zinc-100">{fmt(bmr)} kcal</p>
                            </div>
                            <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2">
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">Target</p>
                              <p className="text-sm font-bold tabular-nums text-rose-200">{fmt(target)} kcal</p>
                            </div>
                          </div>
                          <p className="truncate text-[10px] text-zinc-500">
                            {profile.heightCm} cm · {fmt(profile.weightKg)} kg · {profile.age} yr ·{' '}
                            {profile.sex === 'male' ? 'Male' : 'Female'}
                          </p>
                        </div>
                      </div>

                      {/* activity picker */}
                      <div className="mt-4 border-t border-white/5 pt-3">
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                          Activity level
                        </p>
                        <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Activity level">
                          {ACTIVITIES.map((a) => (
                            <button
                              key={a.id}
                              onClick={() => saveProfile({ ...profile, activity: a.id })}
                              role="radio"
                              aria-checked={profile.activity === a.id}
                              title={a.hint}
                              className={cn(
                                'flex h-11 flex-col items-center justify-center rounded-xl border px-1 transition-all',
                                profile.activity === a.id
                                  ? 'border-rose-400/60 bg-rose-500/15 shadow-md'
                                  : 'border-white/10 bg-white/5 hover:bg-white/10'
                              )}
                            >
                              <span className="text-[10px] font-bold leading-tight">{a.label}</span>
                              <span className="text-[9px] tabular-nums text-zinc-500">×{a.mult}</span>
                            </button>
                          ))}
                        </div>
                        <p className="mt-1.5 text-[10px] text-zinc-500">
                          Mifflin-St Jeor · daily target = BMR × {multOf(profile.activity)} (
                          {ACTIVITIES.find((a) => a.id === profile.activity)?.hint})
                        </p>
                      </div>
                    </>
                  ) : (
                    /* premium empty state */
                    <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
                      <span className="flex size-14 items-center justify-center rounded-2xl border border-rose-400/20 bg-rose-500/10">
                        <HeartPulse className="size-7 text-rose-300" aria-hidden />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-zinc-200">Set up your profile</p>
                        <p className="mx-auto mt-1 max-w-xs text-xs text-zinc-500">
                          Add your height, weight and age to unlock your BMI gauge, BMR and a daily calorie target.
                        </p>
                      </div>
                      <Button onClick={openProfile} className={cn('h-11 rounded-xl px-5', ROSE_BTN)}>
                        <UserRound className="size-4" aria-hidden /> Set up profile
                      </Button>
                    </div>
                  )}
                </motion.section>

                {/* ---------------- Water ---------------- */}
                <motion.section
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 240, damping: 24, delay: 0.06 }}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  aria-label="Water intake"
                >
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 text-sm font-bold">
                      <Droplets className="size-4 text-rose-400" aria-hidden /> Water
                    </p>
                    <button
                      onClick={openProfile}
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Settings2 className="size-3.5" aria-hidden />
                      {profile.goalGlasses} × {profile.glassMl} ml
                    </button>
                  </div>

                  <div className="mt-4 flex items-center gap-4">
                    {/* day ring */}
                    <div className="relative shrink-0" role="img" aria-label={`${todayCount} of ${profile.goalGlasses} glasses today`}>
                      <svg viewBox="0 0 112 112" className="size-28 sm:size-32">
                        <defs>
                          <linearGradient id="ht-water-grad" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor="#fda4af" />
                            <stop offset="100%" stopColor="#e11d48" />
                          </linearGradient>
                        </defs>
                        <circle cx={56} cy={56} r={G_R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={10} />
                        <motion.circle
                          cx={56}
                          cy={56}
                          r={G_R}
                          fill="none"
                          stroke="url(#ht-water-grad)"
                          strokeWidth={10}
                          strokeLinecap="round"
                          strokeDasharray={G_C}
                          initial={{ strokeDashoffset: G_C }}
                          animate={{
                            strokeDashoffset: G_C * (1 - waterFrac),
                          }}
                          transition={{ type: 'spring', stiffness: 90, damping: 20 }}
                          transform="rotate(-90 56 56)"
                          style={waterFrac >= 1 ? { filter: 'drop-shadow(0 0 8px rgb(244 63 94 / 0.55))' } : undefined}
                        />
                      </svg>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <p className="text-2xl font-black tabular-nums leading-none tracking-tight">{todayCount}</p>
                        <p className="mt-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">
                          of {profile.goalGlasses} glasses
                        </p>
                      </div>
                    </div>

                    {/* actions */}
                    <div className="min-w-0 flex-1">
                      <p className="text-2xl font-black tracking-tight tabular-nums">
                        <span className={waterFrac >= 1 ? 'text-emerald-300' : 'text-rose-300'}>
                          {fmt(todayCount * profile.glassMl)}
                        </span>
                        <span className="text-sm font-bold text-zinc-500"> / {fmt(goalMl)} ml</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {waterFrac >= 1
                          ? 'Goal reached — hydration hero. 💧'
                          : `${Math.max(0, profile.goalGlasses - todayCount)} glass${profile.goalGlasses - todayCount === 1 ? '' : 'es'} to go`}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <button
                          onClick={() => bumpWater(-1)}
                          disabled={todayCount === 0}
                          aria-label="Remove one glass"
                          className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-35 disabled:hover:bg-white/5"
                        >
                          <Minus className="size-5" aria-hidden />
                        </button>
                        <button
                          onClick={() => bumpWater(1)}
                          className={cn(
                            'flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl text-sm font-bold shadow-lg transition-all active:scale-[0.98]',
                            ROSE_BTN
                          )}
                        >
                          <Plus className="size-5" aria-hidden />
                          <span className="truncate">Add a glass · +{profile.glassMl} ml</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 7-day bars */}
                  <div className="mt-4 border-t border-white/5 pt-3">
                    <div className="mb-1 flex items-baseline justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Last 7 days</p>
                      <p className="text-[11px] font-semibold tabular-nums text-zinc-400">
                        {fmt(heatStats.ml)} ml in 30d
                      </p>
                    </div>
                    <div className="h-36 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={last7} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
                          <XAxis
                            dataKey="label"
                            tick={{ fill: '#71717a', fontSize: 9 }}
                            axisLine={false}
                            tickLine={false}
                            interval={0}
                          />
                          <YAxis hide domain={[0, waterYMax]} />
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                            formatter={(value) => [`${fmt(Number(value))} ml`, 'Intake']}
                          />
                          <ReferenceLine
                            y={goalMl}
                            stroke="#f43f5e"
                            strokeDasharray="4 4"
                            strokeOpacity={0.55}
                            strokeWidth={1}
                          />
                          <Bar dataKey="ml" radius={[4, 4, 0, 0]} maxBarSize={22}>
                            {last7.map((r, i) => (
                              <Cell
                                key={i}
                                fill={r.today ? '#fb7185' : 'rgba(251,113,133,0.4)'}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-1 flex items-center justify-center gap-1.5 text-[10px] text-zinc-500">
                      <span className="inline-block h-0 w-4 border-t border-dashed border-rose-400/70" aria-hidden />
                      Goal line · {fmt(goalMl)} ml/day
                    </p>
                  </div>
                </motion.section>
              </>
            )}

            {/* ============================================================ */}
            {/* WEIGHT                                                       */}
            {/* ============================================================ */}
            {tab === 'weight' && (
              <>
                <motion.section
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 240, damping: 24 }}
                  className="rounded-2xl border border-white/10 bg-gradient-to-br from-rose-500/[0.08] to-red-600/[0.05] p-4"
                  aria-label="Log a weigh-in"
                >
                  <p className="text-sm font-bold">Log a weigh-in</p>
                  <div className="mt-3 flex gap-2">
                    <div className="flex h-14 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 transition-colors focus-within:border-rose-400/50">
                      <input
                        ref={kgRef}
                        value={formKg}
                        onChange={(e) => setFormKg(e.target.value.replace(/[^0-9.]/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') addWeight()
                        }}
                        inputMode="decimal"
                        placeholder="0.0"
                        aria-label="Weight in kilograms"
                        className="h-full w-full min-w-0 bg-transparent text-2xl font-bold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                      />
                      <span className="shrink-0 text-sm font-semibold text-zinc-500">kg</span>
                    </div>
                    <input
                      type="date"
                      value={formDate}
                      max={todayKey}
                      onChange={(e) => setFormDate(e.target.value)}
                      aria-label="Weigh-in date"
                      className="h-14 w-36 shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-semibold tabular-nums text-zinc-100 [color-scheme:dark] focus:border-rose-400/50 focus:outline-none"
                    />
                  </div>
                  <input
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addWeight()
                    }}
                    placeholder="Note (optional) — e.g. morning, after workout"
                    aria-label="Note (optional)"
                    className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-rose-400/50 focus:outline-none"
                  />
                  <Button onClick={addWeight} className={cn('mt-3 h-12 w-full rounded-xl text-sm', ROSE_BTN)}>
                    <Plus className="size-4" aria-hidden /> Add weigh-in
                  </Button>
                  <p className="mt-2 text-[10px] text-zinc-500">
                    The latest weigh-in also updates your profile weight and BMI.
                  </p>
                </motion.section>

                <motion.section
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 240, damping: 24, delay: 0.06 }}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                  aria-label="Weight trend"
                >
                  <div className="flex items-baseline justify-between">
                    <p className="text-sm font-bold">Trend</p>
                    {latestDelta !== null && (
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums',
                          latestDelta < 0
                            ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
                            : latestDelta > 0
                              ? 'border-rose-400/20 bg-rose-500/10 text-rose-300'
                              : 'border-white/10 bg-white/5 text-zinc-400'
                        )}
                      >
                        {latestDelta < 0 ? (
                          <TrendingDown className="size-3" aria-hidden />
                        ) : latestDelta > 0 ? (
                          <TrendingUp className="size-3" aria-hidden />
                        ) : null}
                        {latestDelta > 0 ? '+' : latestDelta < 0 ? '−' : '±'}
                        {fmt(Math.abs(latestDelta))} kg
                      </span>
                    )}
                  </div>

                  {weightChart ? (
                    <div className="mt-3 h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={weightChart.rows} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
                          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: '#71717a', fontSize: 9 }}
                            axisLine={false}
                            tickLine={false}
                            minTickGap={24}
                          />
                          <YAxis
                            width={34}
                            domain={[weightChart.min, weightChart.max]}
                            tick={{ fill: '#71717a', fontSize: 9 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            formatter={(value) => [`${fmt(Number(value))} kg`, 'Weight']}
                          />
                          <Line
                            type="monotone"
                            dataKey="kg"
                            stroke="#f43f5e"
                            strokeWidth={2}
                            dot={{ r: 2.5, fill: '#fb7185', strokeWidth: 0 }}
                            activeDot={{ r: 4, fill: '#fda4af', strokeWidth: 0 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
                      <TrendingUp className="size-6 text-zinc-600" aria-hidden />
                      <p className="text-xs text-zinc-500">
                        {weights.length === 0
                          ? 'Log at least two weigh-ins to draw your trend line.'
                          : 'One more weigh-in and your trend line appears.'}
                      </p>
                    </div>
                  )}
                </motion.section>

                <motion.section
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 240, damping: 24, delay: 0.12 }}
                  aria-label="Weigh-in history"
                >
                  <div className="mb-2.5 flex items-baseline justify-between">
                    <p className="text-sm font-bold">History</p>
                    <p className="text-[11px] text-zinc-500">
                      {weights.length === 0 ? 'Nothing yet' : `${weights.length} weigh-in${weights.length === 1 ? '' : 's'}`}
                    </p>
                  </div>

                  {weightsDesc.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                      <Scale className="size-10 text-zinc-600" aria-hidden />
                      <p className="text-sm font-semibold text-zinc-300">No weigh-ins yet</p>
                      <p className="max-w-[16rem] text-xs text-zinc-500">
                        Log your first weight above to start tracking changes over time.
                      </p>
                    </div>
                  ) : (
                    <ul className={cn('max-h-96 space-y-2 overflow-y-auto pr-1', SCROLL)}>
                      <AnimatePresence initial={false}>
                        {weightsDesc.map((w) => {
                          const delta = deltaById.get(w.id) ?? null
                          return (
                            <motion.li
                              key={w.id}
                              layout
                              initial={{ opacity: 0, y: -8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.96 }}
                              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                              className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                            >
                              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300">
                                <Scale className="size-4.5" aria-hidden />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold tabular-nums text-zinc-100">{fmt(w.kg)} kg</p>
                                <p className="truncate text-[11px] text-zinc-500">
                                  {dayLabel(w.date, today)}
                                  {w.note ? ` · ${w.note}` : ''}
                                </p>
                              </div>
                              {delta !== null && (
                                <span
                                  className={cn(
                                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold tabular-nums',
                                    delta < 0
                                      ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
                                      : delta > 0
                                        ? 'border-rose-400/20 bg-rose-500/10 text-rose-300'
                                        : 'border-white/10 bg-white/5 text-zinc-400'
                                  )}
                                >
                                  {delta > 0 ? '+' : delta < 0 ? '−' : '±'}
                                  {fmt(Math.abs(delta))} kg
                                </span>
                              )}
                              <button
                                onClick={() => (confirmId === w.id ? removeWeight(w.id) : setConfirmId(w.id))}
                                aria-label={confirmId === w.id ? 'Tap again to confirm delete' : 'Delete weigh-in'}
                                className={cn(
                                  'flex size-11 shrink-0 items-center justify-center rounded-xl border transition-all',
                                  confirmId === w.id
                                    ? 'border-rose-400/40 bg-rose-500 text-white'
                                    : 'border-white/10 bg-white/5 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-300'
                                )}
                              >
                                {confirmId === w.id ? (
                                  <span className="text-[9px] font-black leading-none">SURE?</span>
                                ) : (
                                  <Trash2 className="size-4" aria-hidden />
                                )}
                              </button>
                            </motion.li>
                          )
                        })}
                      </AnimatePresence>
                    </ul>
                  )}
                </motion.section>
              </>
            )}

            {/* ============================================================ */}
            {/* HISTORY                                                      */}
            {/* ============================================================ */}
            {tab === 'history' && (
              <motion.section
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 240, damping: 24 }}
                className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                aria-label="Water history"
              >
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <CalendarDays className="size-4 text-rose-400" aria-hidden /> Last 30 days
                  </p>
                  <p className="text-[11px] font-semibold text-zinc-400">Water goal heatmap</p>
                </div>

                {/* stats */}
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">Goal hit</p>
                    <p className="text-lg font-black tabular-nums text-emerald-200">
                      {heatStats.hits}
                      <span className="text-xs font-bold text-emerald-300/70">/30</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">Best streak</p>
                    <p className="text-lg font-black tabular-nums text-rose-200">
                      {heatStats.best}
                      <span className="text-xs font-bold text-rose-300/70"> day{heatStats.best === 1 ? '' : 's'}</span>
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Avg / day</p>
                    <p className="text-lg font-black tabular-nums text-zinc-100">{fmt(heatStats.avg)}</p>
                    <p className="-mt-0.5 text-[9px] font-semibold text-zinc-500">ml</p>
                  </div>
                </div>

                {/* heatmap */}
                <div
                  className="mt-4 grid grid-cols-10 gap-1.5"
                  role="img"
                  aria-label={`Water goal reached on ${heatStats.hits} of the last 30 days`}
                >
                  {last30.map((key) => {
                    const s = heatStats.state.get(key) ?? 'miss'
                    return (
                      <span
                        key={key}
                        title={`${dayLabel(key, today)} · ${(water[key]?.count ?? 0) * profile.glassMl} ml`}
                        className={cn(
                          'aspect-square rounded-[5px] transition-colors',
                          s === 'hit' && 'bg-emerald-400/90 shadow-[0_0_8px_rgb(52_211_153/0.4)]',
                          s === 'partial' && 'bg-emerald-400/35',
                          s === 'miss' && 'bg-white/[0.06]',
                          key === todayKey && 'ring-2 ring-white/30'
                        )}
                      />
                    )
                  })}
                </div>

                {/* legend */}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[10px] text-zinc-500">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-emerald-400/90" aria-hidden /> Goal hit
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-emerald-400/35" aria-hidden /> Halfway
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-white/[0.06]" aria-hidden /> Missed
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-[3px] bg-white/[0.06] ring-2 ring-white/30" aria-hidden /> Today
                  </span>
                </div>

                <p className="mt-4 border-t border-white/5 pt-3 text-center text-[10px] text-zinc-600">
                  {fmt(heatStats.glasses)} glasses · {fmt(heatStats.ml)} ml logged over 30 days · every check-in saves
                  on this device
                </p>
              </motion.section>
            )}
          </div>
        )}
      </motion.div>

      {/* ---------------- Profile & goals modal ---------------- */}
      <AnimatePresence>
        {profileOpen && (
          <motion.div
            key="health-profile"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setProfileOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Profile and goals"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-rose-500/20 text-rose-300">
                  <UserRound className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">Profile &amp; goals</h3>
                <button
                  onClick={() => setProfileOpen(false)}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-4">
                {/* body numbers */}
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { label: 'Height (cm)', value: dHeight, set: setDHeight, ph: '170' },
                      { label: 'Weight (kg)', value: dWeight, set: setDWeight, ph: '65' },
                      { label: 'Age', value: dAge, set: setDAge, ph: '30' },
                    ] as const
                  ).map((f) => (
                    <div key={f.label}>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        {f.label}
                      </p>
                      <input
                        value={f.value}
                        onChange={(e) => f.set(e.target.value.replace(/[^0-9.]/g, ''))}
                        inputMode="decimal"
                        placeholder={f.ph}
                        aria-label={f.label}
                        className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-center text-sm font-bold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:border-rose-400/50 focus:outline-none"
                      />
                    </div>
                  ))}
                </div>

                {/* sex */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Sex</p>
                  <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Sex">
                    {(
                      [
                        { id: 'male', label: 'Male' },
                        { id: 'female', label: 'Female' },
                      ] as const
                    ).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setDSex(s.id)}
                        role="radio"
                        aria-checked={dSex === s.id}
                        className={cn(
                          'h-11 rounded-xl border text-sm font-semibold transition-all',
                          dSex === s.id
                            ? 'border-rose-400/60 bg-rose-500/15 text-rose-200 shadow-md'
                            : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* daily goal */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Daily water goal
                  </p>
                  <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-1.5">
                    <button
                      onClick={() => saveProfile({ ...profile, goalGlasses: clamp(profile.goalGlasses - 1, 1, 20) })}
                      aria-label="One less glass per day"
                      className="flex size-11 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Minus className="size-4" aria-hidden />
                    </button>
                    <span className="text-sm font-bold tabular-nums">
                      {profile.goalGlasses} glasses · {fmt(profile.goalGlasses * profile.glassMl)} ml
                    </span>
                    <button
                      onClick={() => saveProfile({ ...profile, goalGlasses: clamp(profile.goalGlasses + 1, 1, 20) })}
                      aria-label="One more glass per day"
                      className="flex size-11 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <Plus className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>

                {/* glass size */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    ml per glass
                  </p>
                  <div className="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Milliliters per glass">
                    {GLASS_SIZES.map((ml) => (
                      <button
                        key={ml}
                        onClick={() => saveProfile({ ...profile, glassMl: ml })}
                        role="radio"
                        aria-checked={profile.glassMl === ml}
                        className={cn(
                          'h-11 rounded-xl border text-[11px] font-bold tabular-nums transition-all',
                          profile.glassMl === ml
                            ? 'border-rose-400/60 bg-rose-500/15 text-rose-200 shadow-md'
                            : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                        )}
                      >
                        {ml}
                      </button>
                    ))}
                  </div>
                </div>

                <Button onClick={applyDraft} className={cn('h-11 w-full rounded-xl', ROSE_BTN)}>
                  Save profile
                </Button>
                <p className="text-center text-[10px] text-zinc-600">
                  Goal &amp; glass size apply instantly · height, weight, age and sex save here
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
