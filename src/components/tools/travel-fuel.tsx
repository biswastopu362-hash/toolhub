'use client'

/**
 * Travel & Fuel — road-trip money math.
 *
 * Split fuel costs between passengers, track real-world mileage from a
 * fill-up log (full-tank to full-tank), and settle group-trip expenses
 * with minimal transfers. Everything persists in IndexedDB — private,
 * offline, instant.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  CalendarDays,
  Car,
  Check,
  Copy,
  Fuel,
  Gauge,
  Minus,
  Plus,
  Repeat2,
  Route,
  Settings2,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import {
  CartesianGrid,
  Line,
  LineChart,
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

type FuelType = 'petrol' | 'diesel' | 'cng'

type TabId = 'fuel' | 'mileage' | 'split'

interface FillUp {
  id: string
  /** odometer reading, km */
  odo: number
  /** liters added */
  liters: number
  /** total amount paid at the pump, if logged */
  price?: number
  /** filled the tank to the brim? */
  fullTank: boolean
  /** local date key 'YYYY-MM-DD' */
  date: string
  createdAt: number
}

interface TripExpense {
  id: string
  payer: string
  /** major units, rounded to 2 decimals */
  amount: number
  note?: string
  createdAt: number
}

interface Trip {
  id: string
  people: string[]
  expenses: TripExpense[]
  createdAt: number
}

interface TravelSettings {
  currency: string
  /** last price per liter remembered for each fuel type */
  lastPrices: Record<FuelType, number | null>
  roundTrip: boolean
}

interface SettingsRow {
  key: 'settings'
  value: TravelSettings
}

interface Transfer {
  from: string
  to: string
  amount: number
}

interface NetRow {
  name: string
  paid: number
  share: number
  net: number
}

interface Settlement {
  total: number
  share: number
  nets: NetRow[]
  transfers: Transfer[]
}

interface MileagePoint {
  id: string
  label: string
  kmpl: number
}

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const TABS: { id: TabId; label: string; icon: typeof Fuel }[] = [
  { id: 'fuel', label: 'Fuel Cost', icon: Fuel },
  { id: 'mileage', label: 'Mileage', icon: Car },
  { id: 'split', label: 'Trip Split', icon: Users },
]

const FUEL_TYPES: { id: FuelType; label: string; dot: string }[] = [
  { id: 'petrol', label: 'Petrol', dot: '#fbbf24' },
  { id: 'diesel', label: 'Diesel', dot: '#a1a1aa' },
  { id: 'cng', label: 'CNG', dot: '#34d399' },
]

const CURRENCIES = ['৳', '$', '€', '£', '₹', '¥']

const DEFAULT_SETTINGS: TravelSettings = {
  currency: '৳',
  lastPrices: { petrol: null, diesel: null, cng: null },
  roundTrip: false,
}

/** Thin glass scrollbar for long lists. */
const THIN_SCROLL =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

const MAX_PEOPLE = 12

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function parseNum(s: string): number {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function dayLabel(key: string): string {
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (key === dateKey(now)) return 'Today'
  if (key === dateKey(yesterday)) return 'Yesterday'
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function haptic(): void {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

function tripTotal(t: Trip): number {
  return round2(t.expenses.reduce((s, e) => s + e.amount, 0))
}

/* ================================================================== */
/* IndexedDB — 'toolhub-travel', fully on-device                       */
/* ================================================================== */

const DB_NAME = 'toolhub-travel'
const DB_VERSION = 1
const SET_STORE = 'settings' // keyPath 'key' — singleton row
const FILL_STORE = 'fillups' // keyPath 'id'
const TRIP_STORE = 'trips' // keyPath 'id'

let dbPromise: Promise<IDBDatabase> | null = null

function openTravelDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(SET_STORE)) d.createObjectStore(SET_STORE, { keyPath: 'key' })
      if (!d.objectStoreNames.contains(FILL_STORE)) d.createObjectStore(FILL_STORE, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(TRIP_STORE)) d.createObjectStore(TRIP_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openTravelDb()
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
/* Pure calculations                                                   */
/* ================================================================== */

/**
 * Full-tank to full-tank mileage: for each full-tank entry that follows a
 * previous full-tank entry, the fuel burned in between equals the liters
 * added at the current stop, so km/l = (odoNow − odoPrevFull) / litersNow.
 */
function computeMileage(fillups: FillUp[]): {
  effById: Map<string, number>
  points: MileagePoint[]
  best: number
  avg: number
} {
  const sorted = [...fillups].sort((a, b) => a.odo - b.odo || a.createdAt - b.createdAt)
  const effById = new Map<string, number>()
  const points: MileagePoint[] = []
  let lastFull: FillUp | null = null
  let segDist = 0
  let segLiters = 0

  for (const f of sorted) {
    if (!f.fullTank) continue
    if (lastFull && f.odo > lastFull.odo && f.liters > 0) {
      const kmpl = round2((f.odo - lastFull.odo) / f.liters)
      if (kmpl > 0) {
        effById.set(f.id, kmpl)
        segDist += f.odo - lastFull.odo
        segLiters += f.liters
        points.push({ id: f.id, label: dayLabel(f.date), kmpl })
      }
    }
    lastFull = f
  }

  const best = points.length ? Math.max(...points.map((p) => p.kmpl)) : 0
  const avg = segLiters > 0 ? round2(segDist / segLiters) : 0
  return { effById, points, best, avg }
}

/**
 * Minimal-transfer settlement: greedy matching of the largest debtor with
 * the largest creditor until everyone is square.
 */
function computeSettlement(people: string[], expenses: TripExpense[]): Settlement {
  const total = round2(expenses.reduce((s, e) => s + e.amount, 0))

  if (people.length === 0 || expenses.length === 0) {
    return {
      total,
      share: 0,
      nets: people.map((name) => ({ name, paid: 0, share: 0, net: 0 })),
      transfers: [],
    }
  }

  const share = round2(total / people.length)
  const paidOf = new Map<string, number>(people.map((p) => [p, 0]))
  for (const e of expenses) {
    paidOf.set(e.payer, round2((paidOf.get(e.payer) ?? 0) + e.amount))
  }

  const nets: NetRow[] = people.map((name) => {
    const paid = paidOf.get(name) ?? 0
    return { name, paid, share, net: round2(paid - share) }
  })

  const debtors = nets
    .filter((x) => x.net < -0.004)
    .map((x) => ({ name: x.name, amt: -x.net }))
    .sort((a, b) => b.amt - a.amt)
  const creditors = nets
    .filter((x) => x.net > 0.004)
    .map((x) => ({ name: x.name, amt: x.net }))
    .sort((a, b) => b.amt - a.amt)

  const transfers: Transfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amt = round2(Math.min(debtors[i].amt, creditors[j].amt))
    if (amt > 0.004) transfers.push({ from: debtors[i].name, to: creditors[j].name, amount: amt })
    debtors[i].amt = round2(debtors[i].amt - amt)
    creditors[j].amt = round2(creditors[j].amt - amt)
    if (debtors[i].amt <= 0.004) i++
    if (creditors[j].amt <= 0.004) j++
  }

  return { total, share, nets, transfers }
}

/* ================================================================== */
/* Shared chart tooltip shell                                          */
/* ================================================================== */

const TOOLTIP_STYLE = {
  background: 'rgba(9,9,11,0.95)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  fontSize: 12,
  color: '#e4e4e7',
  padding: '8px 10px',
} as const

/* ================================================================== */
/* Two-tap delete button                                               */
/* ================================================================== */

function ConfirmTrash({ onConfirm, label }: { onConfirm: () => void; label: string }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 2600)
    return () => window.clearTimeout(t)
  }, [armed])

  if (!armed) {
    return (
      <button
        onClick={() => setArmed(true)}
        aria-label={label}
        className="flex size-9 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-rose-300"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    )
  }

  return (
    <button
      onClick={() => {
        setArmed(false)
        onConfirm()
      }}
      aria-label="Confirm delete"
      className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-rose-500/15 px-2.5 text-[11px] font-bold text-rose-300 ring-1 ring-rose-400/30 transition-colors hover:bg-rose-500/25"
    >
      <Check className="size-3.5" aria-hidden /> Sure?
    </button>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function TravelFuelTool() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [tab, setTab] = useState<TabId>('fuel')
  const [loaded, setLoaded] = useState(false)
  const [settings, setSettings] = useState<TravelSettings>(DEFAULT_SETTINGS)
  const [settingsOpen, setSettingsOpen] = useState(false)

  /* fuel cost tab */
  const [fuel, setFuel] = useState<FuelType>('petrol')
  const [distanceStr, setDistanceStr] = useState('')
  const [mileageStr, setMileageStr] = useState('')
  const [priceStr, setPriceStr] = useState('')
  const [passengers, setPassengers] = useState(1)

  /* mileage tab */
  const [fillups, setFillups] = useState<FillUp[]>([])
  const [odoStr, setOdoStr] = useState('')
  const [litersStr, setLitersStr] = useState('')
  const [fillPriceStr, setFillPriceStr] = useState('')
  const [fullTank, setFullTank] = useState(true)
  const [fillDate, setFillDate] = useState(() => dateKey(new Date()))

  /* trip split tab */
  const [trips, setTrips] = useState<Trip[]>([])
  const [activeTripId, setActiveTripId] = useState<string | null>(null)
  const [personDraft, setPersonDraft] = useState('')
  const [expPayer, setExpPayer] = useState<string | null>(null)
  const [expAmountStr, setExpAmountStr] = useState('')
  const [expNote, setExpNote] = useState('')

  const todayKey = useMemo(() => dateKey(new Date()), [])

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [allFills, allTrips, allSettings] = await Promise.all([
          idbGetAll<FillUp>(FILL_STORE),
          idbGetAll<Trip>(TRIP_STORE),
          idbGetAll<SettingsRow>(SET_STORE),
        ])
        if (!alive) return

        setFillups(allFills)
        const sortedTrips = [...allTrips].sort((a, b) => b.createdAt - a.createdAt)
        setTrips(sortedTrips)
        setActiveTripId(sortedTrips[0]?.id ?? null)

        const saved = allSettings.find((r) => r.key === 'settings')?.value
        if (saved) {
          const numOrNull = (v: unknown): number | null =>
            typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
          const lp = saved.lastPrices
          const next: TravelSettings = {
            currency: CURRENCIES.includes(saved.currency) ? saved.currency : DEFAULT_SETTINGS.currency,
            lastPrices: {
              petrol: numOrNull(lp?.petrol),
              diesel: numOrNull(lp?.diesel),
              cng: numOrNull(lp?.cng),
            },
            roundTrip: Boolean(saved.roundTrip),
          }
          setSettings(next)
          const last = next.lastPrices.petrol
          if (last != null) setPriceStr(String(last))
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

  /* ---------------- derived ---------------- */
  const activeTrip = useMemo(
    () => trips.find((t) => t.id === activeTripId) ?? null,
    [trips, activeTripId]
  )

  const tripsSorted = useMemo(() => [...trips].sort((a, b) => b.createdAt - a.createdAt), [trips])

  const allTripsTotal = useMemo(() => trips.reduce((s, t) => s + tripTotal(t), 0), [trips])

  const mileageCalc = useMemo(() => computeMileage(fillups), [fillups])

  const fillupsSorted = useMemo(
    () =>
      [...fillups].sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt
      ),
    [fillups]
  )

  const fillStats = useMemo(() => {
    const totalSpent = round2(fillups.reduce((s, f) => s + (f.price ?? 0), 0))
    const byOdo = [...fillups].sort((a, b) => a.odo - b.odo)
    const totalDistance =
      byOdo.length >= 2 ? Math.max(0, byOdo[byOdo.length - 1].odo - byOdo[0].odo) : 0
    return { totalSpent, totalDistance }
  }, [fillups])

  const chartDomain = useMemo(() => {
    const ks = mileageCalc.points.map((p) => p.kmpl)
    if (ks.length < 2) return undefined
    const min = Math.min(...ks)
    const max = Math.max(...ks)
    const pad = Math.max(0.5, (max - min) * 0.15)
    return [Math.max(0, Math.floor((min - pad) * 10) / 10), Math.ceil((max + pad) * 10) / 10]
  }, [mileageCalc.points])

  /* fuel cost live math */
  const dist = parseNum(distanceStr)
  const mileage = parseNum(mileageStr)
  const price = parseNum(priceStr)
  const effDist = settings.roundTrip ? dist * 2 : dist
  const fuelNeeded = mileage > 0 ? effDist / mileage : 0
  const totalCost = fuelNeeded * price
  const perPerson = totalCost / Math.max(1, passengers)
  const fuelValid = dist > 0 && mileage > 0 && price > 0

  const settlement = useMemo(
    () => (activeTrip ? computeSettlement(activeTrip.people, activeTrip.expenses) : null),
    [activeTrip]
  )

  /* ---------------- settings mutations (write-through) ---------------- */
  const saveSettings = useCallback((next: TravelSettings) => {
    setSettings(next)
    void idbPut(SET_STORE, { key: 'settings', value: next } satisfies SettingsRow).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const pickCurrency = useCallback(
    (c: string) => {
      if (c === settings.currency) return
      saveSettings({ ...settings, currency: c })
      haptic()
    },
    [saveSettings, settings]
  )

  const toggleRoundTrip = useCallback(() => {
    saveSettings({ ...settings, roundTrip: !settings.roundTrip })
    haptic()
  }, [saveSettings, settings])

  const changePrice = useCallback(
    (raw: string) => {
      const v = raw.replace(/[^0-9.]/g, '')
      setPriceStr(v)
      const num = parseNum(v)
      if (num > 0 && round2(num) !== settings.lastPrices[fuel]) {
        saveSettings({
          ...settings,
          lastPrices: { ...settings.lastPrices, [fuel]: round2(num) },
        })
      }
    },
    [fuel, saveSettings, settings]
  )

  const pickFuel = useCallback(
    (t: FuelType) => {
      setFuel(t)
      const lp = settings.lastPrices[t]
      setPriceStr(lp != null ? String(lp) : '')
      haptic()
    },
    [settings.lastPrices]
  )

  /* ---------------- fill-up mutations (write-through) ---------------- */
  const addFillup = useCallback(() => {
    const odo = round2(parseNum(odoStr))
    const liters = round2(parseNum(litersStr))
    const price = round2(parseNum(fillPriceStr))
    if (!(odo > 0)) {
      toast({ title: 'Odometer needed', description: 'Enter the odometer reading in km.' })
      return
    }
    if (!(liters > 0)) {
      toast({ title: 'Liters needed', description: 'Enter how much fuel you added.' })
      return
    }
    const f: FillUp = {
      id: uid('fu'),
      odo,
      liters,
      ...(fillPriceStr.trim() && price > 0 ? { price } : {}),
      fullTank,
      date: fillDate || todayKey,
      createdAt: Date.now(),
    }
    setFillups((prev) => [f, ...prev])
    void idbPut(FILL_STORE, f).catch(() => {
      /* memory-only fallback */
    })
    setOdoStr('')
    setLitersStr('')
    setFillPriceStr('')
    haptic()
    toast({ title: 'Fill-up logged', description: `${fmt(f.liters)} L at ${fmt(f.odo)} km` })
  }, [fillDate, fillPriceStr, fullTank, litersStr, odoStr, todayKey, toast])

  const removeFillup = useCallback((id: string) => {
    setFillups((prev) => prev.filter((f) => f.id !== id))
    void idbDelete(FILL_STORE, id).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  /* ---------------- trip mutations (write-through) ---------------- */
  const createTrip = useCallback(() => {
    const trip: Trip = { id: uid('tr'), people: [], expenses: [], createdAt: Date.now() }
    setTrips((prev) => [trip, ...prev])
    void idbPut(TRIP_STORE, trip).catch(() => {
      /* memory-only fallback */
    })
    setActiveTripId(trip.id)
    setPersonDraft('')
    setExpPayer(null)
    setExpAmountStr('')
    setExpNote('')
    haptic()
    toast({ title: 'Trip created', description: 'Add your travel buddies to start splitting.' })
  }, [toast])

  const deleteTrip = useCallback(
    (id: string) => {
      const rest = trips.filter((t) => t.id !== id)
      setTrips(rest)
      void idbDelete(TRIP_STORE, id).catch(() => {
        /* memory-only fallback */
      })
      if (activeTripId === id) setActiveTripId(rest[0]?.id ?? null)
      toast({ title: 'Trip deleted' })
    },
    [activeTripId, toast, trips]
  )

  const mutateTrip = useCallback((next: Trip) => {
    setTrips((prev) => prev.map((t) => (t.id === next.id ? next : t)))
    void idbPut(TRIP_STORE, next).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const addPerson = useCallback(() => {
    if (!activeTrip) return
    const name = personDraft.trim().replace(/\s+/g, ' ')
    if (!name) return
    if (activeTrip.people.some((p) => p.toLowerCase() === name.toLowerCase())) {
      toast({ title: 'Already in the crew', description: `“${name}” is on this trip.` })
      return
    }
    if (activeTrip.people.length >= MAX_PEOPLE) {
      toast({ title: 'Crew is full', description: `Up to ${MAX_PEOPLE} people per trip.` })
      return
    }
    mutateTrip({ ...activeTrip, people: [...activeTrip.people, name] })
    setPersonDraft('')
    if (!expPayer) setExpPayer(name)
    haptic()
  }, [activeTrip, expPayer, mutateTrip, personDraft, toast])

  const removePerson = useCallback(
    (name: string) => {
      if (!activeTrip) return
      if (activeTrip.expenses.some((e) => e.payer === name)) {
        toast({
          title: 'Cannot remove yet',
          description: `${name} paid for an expense — remove it first.`,
        })
        return
      }
      const people = activeTrip.people.filter((p) => p !== name)
      mutateTrip({ ...activeTrip, people })
      if (expPayer === name) setExpPayer(people[0] ?? null)
    },
    [activeTrip, expPayer, mutateTrip, toast]
  )

  const addExpense = useCallback(() => {
    if (!activeTrip) return
    if (activeTrip.people.length === 0) {
      toast({ title: 'Add crew first', description: 'Add people before logging expenses.' })
      return
    }
    if (!expPayer || !activeTrip.people.includes(expPayer)) {
      toast({ title: 'Pick a payer', description: 'Who paid for this expense?' })
      return
    }
    const amount = round2(parseNum(expAmountStr))
    if (!(amount > 0)) {
      toast({ title: 'Enter an amount', description: 'How much was paid?' })
      return
    }
    const note = expNote.trim()
    const e: TripExpense = {
      id: uid('ex'),
      payer: expPayer,
      amount,
      ...(note ? { note } : {}),
      createdAt: Date.now(),
    }
    mutateTrip({ ...activeTrip, expenses: [...activeTrip.expenses, e] })
    setExpAmountStr('')
    setExpNote('')
    haptic()
  }, [activeTrip, expAmountStr, expNote, expPayer, mutateTrip, toast])

  const removeExpense = useCallback(
    (id: string) => {
      if (!activeTrip) return
      mutateTrip({ ...activeTrip, expenses: activeTrip.expenses.filter((e) => e.id !== id) })
    },
    [activeTrip, mutateTrip]
  )

  /* ---------------- copy summary ---------------- */
  const copySummary = useCallback(async () => {
    if (!activeTrip || !settlement) return
    const cur = settings.currency
    const lines: string[] = []
    lines.push(`Trip · ${dayLabel(dateKey(new Date(activeTrip.createdAt)))}`)
    lines.push(
      `Crew: ${activeTrip.people.length ? activeTrip.people.join(', ') : '—'}`
    )
    lines.push(
      `Total: ${cur}${fmt(settlement.total)} (${activeTrip.expenses.length} ${
        activeTrip.expenses.length === 1 ? 'expense' : 'expenses'
      })`
    )
    if (activeTrip.expenses.length > 0) {
      lines.push('')
      lines.push('Expenses:')
      for (const e of activeTrip.expenses) {
        lines.push(`• ${e.payer} — ${cur}${fmt(e.amount)}${e.note ? ` (${e.note})` : ''}`)
      }
    }
    if (activeTrip.people.length > 0 && settlement.total > 0) {
      lines.push('')
      lines.push(`Share each: ${cur}${fmt(settlement.share)}`)
      lines.push('Per person (net):')
      for (const n of settlement.nets) {
        const sign = n.net > 0.004 ? '+' : n.net < -0.004 ? '−' : ''
        lines.push(`• ${n.name}: ${sign}${cur}${fmt(Math.abs(n.net))}`)
      }
      lines.push('')
      if (settlement.transfers.length > 0) {
        lines.push('Settlement:')
        for (const t of settlement.transfers) {
          lines.push(`• ${t.from} → ${t.to}: ${cur}${fmt(t.amount)}`)
        }
      } else {
        lines.push('All settled — no transfers needed.')
      }
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast({ title: 'Summary copied', description: 'Paste it in your group chat.' })
    } catch {
      toast({ title: 'Copy failed', description: 'Clipboard is unavailable on this device.' })
    }
  }, [activeTrip, settlement, settings.currency, toast])

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
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-yellow-300/[0.08] via-amber-500/[0.05] to-orange-600/[0.07] px-4 py-5 sm:px-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-yellow-300 via-amber-500 to-orange-600 text-zinc-950 ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(234_179_8/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Route className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Travel &amp; Fuel</h2>
              <p className="text-xs text-zinc-400">Split fuel, track mileage, settle trips.</p>
            </div>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Travel & Fuel settings"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Settings2 className="size-5" aria-hidden />
            </button>
          </div>

          {/* Tab bar */}
          <div
            className="mt-5 grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5"
            role="tablist"
            aria-label="Travel sections"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id)
                  haptic()
                }}
                role="tab"
                aria-selected={tab === t.id}
                className={cn(
                  'flex h-11 items-center justify-center gap-1.5 rounded-xl text-[11px] font-semibold transition-all sm:text-xs',
                  tab === t.id
                    ? 'bg-gradient-to-r from-yellow-300/20 via-amber-500/15 to-orange-600/15 text-amber-200 ring-1 ring-amber-400/30'
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
            {/* FUEL COST                                                    */}
            {/* ============================================================ */}
            {tab === 'fuel' && (
              <motion.section
                key="fuel"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                className="space-y-4"
                aria-label="Fuel cost calculator"
              >
                {/* fuel type */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Fuel type
                  </p>
                  <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Fuel type">
                    {FUEL_TYPES.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => pickFuel(t.id)}
                        role="radio"
                        aria-checked={fuel === t.id}
                        className={cn(
                          'flex h-11 items-center justify-center gap-1.5 rounded-xl border text-xs font-bold transition-all',
                          fuel === t.id
                            ? 'border-amber-400/60 bg-amber-500/15 text-amber-200 shadow-md'
                            : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                        )}
                      >
                        <span className="size-2 rounded-full" style={{ background: t.dot }} aria-hidden />
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-600">
                    Last price per fuel type is remembered on this device.
                  </p>
                </div>

                {/* inputs */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label
                      htmlFor="tf-distance"
                      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      Distance <span className="font-normal normal-case text-zinc-600">(km)</span>
                    </label>
                    <div className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 transition-colors focus-within:border-amber-400/50">
                      <input
                        id="tf-distance"
                        value={distanceStr}
                        onChange={(e) => setDistanceStr(e.target.value.replace(/[^0-9.]/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') haptic()
                        }}
                        inputMode="decimal"
                        placeholder="0"
                        aria-label="One-way distance in kilometers"
                        className="h-full w-full bg-transparent text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                      />
                      <span className="shrink-0 text-xs text-zinc-500">km</span>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="tf-mileage"
                      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      Mileage <span className="font-normal normal-case text-zinc-600">(km/l)</span>
                    </label>
                    <div className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 transition-colors focus-within:border-amber-400/50">
                      <input
                        id="tf-mileage"
                        value={mileageStr}
                        onChange={(e) => setMileageStr(e.target.value.replace(/[^0-9.]/g, ''))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') haptic()
                        }}
                        inputMode="decimal"
                        placeholder="e.g. 14"
                        aria-label="Vehicle mileage in kilometers per liter"
                        className="h-full w-full bg-transparent text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                      />
                      <span className="shrink-0 text-xs text-zinc-500">km/l</span>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="tf-price"
                      className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      Fuel price
                    </label>
                    <div className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 transition-colors focus-within:border-amber-400/50">
                      <span className="shrink-0 text-sm text-zinc-500">{settings.currency}</span>
                      <input
                        id="tf-price"
                        value={priceStr}
                        onChange={(e) => changePrice(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') haptic()
                        }}
                        inputMode="decimal"
                        placeholder="per liter"
                        aria-label="Fuel price per liter"
                        className="h-full w-full bg-transparent text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                      />
                      <span className="shrink-0 text-xs text-zinc-500">/L</span>
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Passengers
                    </p>
                    <div className="flex h-11 items-center justify-between rounded-xl border border-white/10 bg-white/5 px-1">
                      <button
                        onClick={() => setPassengers((p) => Math.max(1, p - 1))}
                        disabled={passengers <= 1}
                        aria-label="Remove one passenger"
                        className="flex size-9 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 disabled:opacity-30"
                      >
                        <Minus className="size-4" aria-hidden />
                      </button>
                      <span
                        className="min-w-7 text-center text-base font-bold tabular-nums text-zinc-100"
                        aria-live="polite"
                      >
                        {passengers}
                      </span>
                      <button
                        onClick={() => setPassengers((p) => Math.min(20, p + 1))}
                        aria-label="Add one passenger"
                        className="flex size-9 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10"
                      >
                        <Plus className="size-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                </div>

                {/* round trip toggle */}
                <button
                  onClick={toggleRoundTrip}
                  aria-pressed={settings.roundTrip}
                  className={cn(
                    'flex h-11 w-full items-center justify-between rounded-xl border px-3.5 text-sm font-semibold transition-all',
                    settings.roundTrip
                      ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                      : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Repeat2 className="size-4" aria-hidden /> Round trip (×2)
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-bold',
                      settings.roundTrip ? 'bg-amber-400/20 text-amber-200' : 'bg-white/10 text-zinc-500'
                    )}
                  >
                    {settings.roundTrip ? 'ON' : 'OFF'}
                  </span>
                </button>

                {/* result */}
                {fuelValid ? (
                  <div className="relative overflow-hidden rounded-2xl border border-amber-400/25 bg-gradient-to-br from-yellow-300/[0.09] via-amber-500/[0.07] to-orange-600/[0.06] p-4">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">
                      <Users className="size-3.5" aria-hidden /> Cost per person
                    </div>
                    <motion.p
                      key={perPerson.toFixed(2)}
                      initial={{ scale: 0.96, opacity: 0.6 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 340, damping: 24 }}
                      aria-live="polite"
                      aria-label={`Cost per person ${settings.currency}${fmt(perPerson)}`}
                      className="mt-1 bg-gradient-to-r from-yellow-200 via-amber-300 to-orange-400 bg-clip-text text-4xl font-black tracking-tight text-transparent tabular-nums sm:text-5xl"
                    >
                      {settings.currency}
                      {fmt(perPerson)}
                    </motion.p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2">
                        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          <Fuel className="size-3" aria-hidden /> Fuel needed
                        </p>
                        <p className="mt-0.5 text-lg font-bold tabular-nums text-zinc-100">
                          {fmt(fuelNeeded)} <span className="text-xs font-semibold text-zinc-500">L</span>
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2">
                        <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          <Wallet className="size-3" aria-hidden /> Total cost
                        </p>
                        <p className="mt-0.5 text-lg font-bold tabular-nums text-zinc-100">
                          {settings.currency}
                          {fmt(totalCost)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-2.5 text-[11px] text-zinc-500">
                      {fmt(dist)} km{settings.roundTrip ? ' × 2 round trip' : ''} · {fmt(mileage)} km/l ·{' '}
                      {passengers} {passengers === 1 ? 'person' : 'people'}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
                    <Fuel className="size-7 text-zinc-600" aria-hidden />
                    <p className="text-sm font-semibold text-zinc-300">Ready when you are</p>
                    <p className="text-xs text-zinc-500">
                      Enter distance, mileage and fuel price to see the split.
                    </p>
                  </div>
                )}

                <p className="text-center text-[11px] text-zinc-600">
                  All distances are in kilometers (km). Mileage = kilometers per liter.
                </p>
              </motion.section>
            )}

            {/* ============================================================ */}
            {/* MILEAGE                                                      */}
            {/* ============================================================ */}
            {tab === 'mileage' && (
              <motion.section
                key="mileage"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                className="space-y-4"
                aria-label="Mileage tracker"
              >
                {/* stats */}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      <Gauge className="size-3" aria-hidden /> Best
                    </p>
                    <p className="mt-1 text-xl font-black tabular-nums text-amber-300">
                      {mileageCalc.best > 0 ? fmt(mileageCalc.best) : '—'}
                      <span className="ml-1 text-[10px] font-semibold text-zinc-500">km/l</span>
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      <Gauge className="size-3" aria-hidden /> Average
                    </p>
                    <p className="mt-1 text-xl font-black tabular-nums text-zinc-100">
                      {mileageCalc.avg > 0 ? fmt(mileageCalc.avg) : '—'}
                      <span className="ml-1 text-[10px] font-semibold text-zinc-500">km/l</span>
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      <Wallet className="size-3" aria-hidden /> Total spent
                    </p>
                    <p className="mt-1 text-xl font-black tabular-nums text-zinc-100">
                      {fillStats.totalSpent > 0 ? settings.currency : ''}
                      {fillStats.totalSpent > 0 ? fmt(fillStats.totalSpent) : '—'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                    <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      <Route className="size-3" aria-hidden /> Distance
                    </p>
                    <p className="mt-1 text-xl font-black tabular-nums text-zinc-100">
                      {fillStats.totalDistance > 0 ? fmt(fillStats.totalDistance) : '—'}
                      <span className="ml-1 text-[10px] font-semibold text-zinc-500">km</span>
                    </p>
                  </div>
                </div>

                {/* add fill-up */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
                      <Fuel className="size-4" aria-hidden />
                    </span>
                    <h3 className="flex-1 text-sm font-bold">Log a fill-up</h3>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label
                        htmlFor="tf-odo"
                        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                      >
                        Odometer
                      </label>
                      <div className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 transition-colors focus-within:border-amber-400/50">
                        <input
                          id="tf-odo"
                          value={odoStr}
                          onChange={(e) => setOdoStr(e.target.value.replace(/[^0-9.]/g, ''))}
                          inputMode="decimal"
                          placeholder="e.g. 12400"
                          aria-label="Odometer reading in kilometers"
                          className="h-full w-full bg-transparent text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                        />
                        <span className="shrink-0 text-xs text-zinc-500">km</span>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="tf-liters"
                        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                      >
                        Fuel added
                      </label>
                      <div className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 transition-colors focus-within:border-amber-400/50">
                        <input
                          id="tf-liters"
                          value={litersStr}
                          onChange={(e) => setLitersStr(e.target.value.replace(/[^0-9.]/g, ''))}
                          inputMode="decimal"
                          placeholder="e.g. 40"
                          aria-label="Liters of fuel added"
                          className="h-full w-full bg-transparent text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                        />
                        <span className="shrink-0 text-xs text-zinc-500">L</span>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="tf-fill-price"
                        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                      >
                        Paid <span className="font-normal normal-case text-zinc-600">(optional)</span>
                      </label>
                      <div className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 transition-colors focus-within:border-amber-400/50">
                        <span className="shrink-0 text-sm text-zinc-500">{settings.currency}</span>
                        <input
                          id="tf-fill-price"
                          value={fillPriceStr}
                          onChange={(e) => setFillPriceStr(e.target.value.replace(/[^0-9.]/g, ''))}
                          inputMode="decimal"
                          placeholder="0"
                          aria-label="Total amount paid for this fill-up"
                          className="h-full w-full bg-transparent text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="tf-fill-date"
                        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                      >
                        Date
                      </label>
                      <input
                        id="tf-fill-date"
                        type="date"
                        value={fillDate}
                        onChange={(e) => setFillDate(e.target.value)}
                        aria-label="Fill-up date"
                        className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm font-semibold tabular-nums text-zinc-100 [color-scheme:dark] focus:border-amber-400/50 focus:outline-none"
                      />
                    </div>
                  </div>

                  <button
                    onClick={() => setFullTank((v) => !v)}
                    aria-pressed={fullTank}
                    className={cn(
                      'mt-2.5 flex h-11 w-full items-center justify-between rounded-xl border px-3.5 text-sm font-semibold transition-all',
                      fullTank
                        ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                        : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <Fuel className="size-4" aria-hidden /> Filled to the brim
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-bold',
                        fullTank ? 'bg-amber-400/20 text-amber-200' : 'bg-white/10 text-zinc-500'
                      )}
                    >
                      {fullTank ? 'FULL TANK' : 'PARTIAL'}
                    </span>
                  </button>

                  <Button
                    onClick={addFillup}
                    className="mt-2.5 h-11 w-full rounded-xl bg-gradient-to-r from-yellow-300 via-amber-500 to-orange-600 font-bold text-zinc-950 shadow-lg shadow-amber-500/20 hover:from-yellow-200 hover:via-amber-400 hover:to-orange-500"
                  >
                    <Plus className="size-4" aria-hidden /> Add fill-up
                  </Button>
                  <p className="mt-2 text-[11px] text-zinc-600">
                    km/l is measured between consecutive full-tank entries — partial stops are skipped.
                  </p>
                </div>

                {/* efficiency trend */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-orange-500/15 text-orange-300">
                      <TrendingUp className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold">Efficiency trend</h3>
                      <p className="text-[11px] text-zinc-500">km/l between full tanks</p>
                    </div>
                  </div>

                  {mileageCalc.points.length >= 2 && chartDomain ? (
                    <div className="mt-2 h-44 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={mileageCalc.points} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
                          <defs>
                            <linearGradient id="tfFuelLine" x1="0" y1="0" x2="1" y2="0">
                              <stop offset="0%" stopColor="#fde047" />
                              <stop offset="100%" stopColor="#ea580c" />
                            </linearGradient>
                          </defs>
                          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: '#71717a', fontSize: 9 }}
                            axisLine={false}
                            tickLine={false}
                            minTickGap={16}
                          />
                          <YAxis
                            width={32}
                            domain={chartDomain}
                            tick={{ fill: '#71717a', fontSize: 9 }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            formatter={(value) => [`${fmt(Number(value))} km/l`, 'Efficiency']}
                          />
                          <Line
                            type="monotone"
                            dataKey="kmpl"
                            stroke="url(#tfFuelLine)"
                            strokeWidth={2.5}
                            dot={{ r: 3, fill: '#eab308', strokeWidth: 0 }}
                            activeDot={{ r: 4.5, fill: '#fde047', strokeWidth: 0 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
                      <TrendingUp className="size-6 text-zinc-600" aria-hidden />
                      <p className="text-xs text-zinc-500">
                        {fillups.length === 0
                          ? 'Log your fill-ups to see the trend.'
                          : 'Log one more full-tank fill-up to draw the trend.'}
                      </p>
                    </div>
                  )}
                </div>

                {/* fill-up log */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
                      <CalendarDays className="size-4" aria-hidden />
                    </span>
                    <h3 className="flex-1 text-sm font-bold">Fill-up log</h3>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-zinc-400">
                      {fillups.length}
                    </span>
                  </div>

                  {fillupsSorted.length > 0 ? (
                    <div className={cn('max-h-96 space-y-2 overflow-y-auto pr-1', THIN_SCROLL)}>
                      {fillupsSorted.map((f) => {
                        const eff = mileageCalc.effById.get(f.id)
                        return (
                          <div
                            key={f.id}
                            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-bold text-zinc-100">
                                {dayLabel(f.date)}{' '}
                                <span className="font-medium tabular-nums text-zinc-400">
                                  · {fmt(f.odo)} km
                                </span>
                              </p>
                              <p className="truncate text-[11px] tabular-nums text-zinc-500">
                                {fmt(f.liters)} L
                                {f.price != null ? ` · ${settings.currency}${fmt(f.price)}` : ''}
                                {f.fullTank ? '' : ' · partial'}
                              </p>
                            </div>
                            {eff != null ? (
                              <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-amber-200">
                                {fmt(eff)} km/l
                              </span>
                            ) : f.fullTank ? (
                              <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-zinc-500">
                                base
                              </span>
                            ) : (
                              <span className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-zinc-500">
                                partial
                              </span>
                            )}
                            <ConfirmTrash
                              onConfirm={() => removeFillup(f.id)}
                              label="Delete fill-up"
                            />
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
                      <Car className="size-7 text-zinc-600" aria-hidden />
                      <p className="text-sm font-semibold text-zinc-300">No fill-ups yet</p>
                      <p className="text-xs text-zinc-500">
                        Log your first tank above to see real-world mileage.
                      </p>
                    </div>
                  )}
                </div>
              </motion.section>
            )}

            {/* ============================================================ */}
            {/* TRIP SPLIT                                                   */}
            {/* ============================================================ */}
            {tab === 'split' && (
              <motion.section
                key="split"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                className="space-y-4"
                aria-label="Trip expense splitter"
              >
                {/* summary + new trip */}
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs text-zinc-500">
                    {trips.length} {trips.length === 1 ? 'trip' : 'trips'} ·{' '}
                    {settings.currency}
                    {fmt(allTripsTotal)} all-time
                  </p>
                  <Button
                    onClick={createTrip}
                    className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-yellow-300 via-amber-500 to-orange-600 font-bold text-zinc-950 shadow-lg shadow-amber-500/20 hover:from-yellow-200 hover:via-amber-400 hover:to-orange-500"
                  >
                    <Plus className="size-4" aria-hidden /> New trip
                  </Button>
                </div>

                {/* trips list */}
                {tripsSorted.length > 0 && (
                  <div className={cn('max-h-60 space-y-2 overflow-y-auto pr-1', THIN_SCROLL)}>
                    {tripsSorted.map((t) => {
                      const active = t.id === activeTripId
                      return (
                        <div
                          key={t.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => setActiveTripId(t.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              setActiveTripId(t.id)
                            }
                          }}
                          aria-pressed={active}
                          className={cn(
                            'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-all',
                            active
                              ? 'border-amber-400/50 bg-amber-500/10 ring-1 ring-amber-400/30'
                              : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'
                          )}
                        >
                          <span
                            className={cn(
                              'flex size-9 shrink-0 items-center justify-center rounded-lg',
                              active ? 'bg-amber-500/20 text-amber-300' : 'bg-orange-500/15 text-orange-300'
                            )}
                          >
                            <Route className="size-4" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-zinc-100">
                              Trip · {dayLabel(dateKey(new Date(t.createdAt)))}
                            </p>
                            <p className="truncate text-[11px] tabular-nums text-zinc-500">
                              {t.people.length} {t.people.length === 1 ? 'person' : 'people'} ·{' '}
                              {t.expenses.length}{' '}
                              {t.expenses.length === 1 ? 'expense' : 'expenses'} · {settings.currency}
                              {fmt(tripTotal(t))}
                            </p>
                          </div>
                          <span onClick={(e) => e.stopPropagation()}>
                            <ConfirmTrash onConfirm={() => deleteTrip(t.id)} label="Delete trip" />
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}

                {activeTrip && settlement ? (
                  <>
                    {/* crew */}
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
                          <Users className="size-4" aria-hidden />
                        </span>
                        <h3 className="flex-1 text-sm font-bold">Crew</h3>
                        <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-zinc-400">
                          {activeTrip.people.length}
                        </span>
                      </div>

                      {activeTrip.people.length > 0 ? (
                        <div className="mb-2.5 flex flex-wrap gap-1.5">
                          {activeTrip.people.map((p) => (
                            <span
                              key={p}
                              className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 py-1 pl-3 pr-1 text-xs font-semibold text-zinc-200"
                            >
                              {p}
                              <button
                                onClick={() => removePerson(p)}
                                aria-label={`Remove ${p} from crew`}
                                className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/10 hover:text-rose-300"
                              >
                                <X className="size-3.5" aria-hidden />
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mb-2.5 text-xs text-zinc-500">
                          No crew yet — add everyone who is sharing costs.
                        </p>
                      )}

                      <div className="flex gap-2">
                        <input
                          value={personDraft}
                          onChange={(e) => setPersonDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') addPerson()
                          }}
                          placeholder="Add a name, e.g. Alex"
                          maxLength={24}
                          aria-label="New crew member name"
                          className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400/50 focus:outline-none"
                        />
                        <button
                          onClick={addPerson}
                          aria-label="Add crew member"
                          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-yellow-300 via-amber-500 to-orange-600 text-zinc-950 shadow-lg shadow-amber-500/20 transition-transform hover:scale-[1.03] active:scale-95"
                        >
                          <Plus className="size-5" aria-hidden />
                        </button>
                      </div>
                    </div>

                    {/* expenses */}
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3.5">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-300">
                          <Wallet className="size-4" aria-hidden />
                        </span>
                        <h3 className="flex-1 text-sm font-bold">Expenses</h3>
                        <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-amber-200">
                          {settings.currency}
                          {fmt(settlement.total)}
                        </span>
                      </div>

                      {activeTrip.people.length > 0 && (
                        <>
                          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                            Who paid?
                          </p>
                          <div
                            className="mb-2.5 flex flex-wrap gap-1.5"
                            role="radiogroup"
                            aria-label="Expense payer"
                          >
                            {activeTrip.people.map((p) => (
                              <button
                                key={p}
                                onClick={() => setExpPayer(p)}
                                role="radio"
                                aria-checked={expPayer === p}
                                className={cn(
                                  'flex min-h-11 items-center rounded-full border px-3.5 text-xs font-bold transition-all',
                                  expPayer === p
                                    ? 'border-amber-400/60 bg-amber-500/15 text-amber-200 shadow-md'
                                    : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                                )}
                              >
                                {p}
                              </button>
                            ))}
                          </div>

                          <div className="grid grid-cols-2 gap-2.5">
                            <div>
                              <label
                                htmlFor="tf-exp-amount"
                                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                              >
                                Amount
                              </label>
                              <div className="flex h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 transition-colors focus-within:border-amber-400/50">
                                <span className="shrink-0 text-sm text-zinc-500">
                                  {settings.currency}
                                </span>
                                <input
                                  id="tf-exp-amount"
                                  value={expAmountStr}
                                  onChange={(e) => setExpAmountStr(e.target.value.replace(/[^0-9.]/g, ''))}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') addExpense()
                                  }}
                                  inputMode="decimal"
                                  placeholder="0"
                                  aria-label="Expense amount"
                                  className="h-full w-full bg-transparent text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                                />
                              </div>
                            </div>
                            <div>
                              <label
                                htmlFor="tf-exp-note"
                                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
                              >
                                Note <span className="font-normal normal-case text-zinc-600">(optional)</span>
                              </label>
                              <input
                                id="tf-exp-note"
                                value={expNote}
                                onChange={(e) => setExpNote(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') addExpense()
                                }}
                                placeholder="e.g. Fuel, tolls"
                                maxLength={40}
                                aria-label="Expense note"
                                className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400/50 focus:outline-none"
                              />
                            </div>
                          </div>

                          <Button
                            onClick={addExpense}
                            className="mt-2.5 h-11 w-full rounded-xl bg-gradient-to-r from-yellow-300 via-amber-500 to-orange-600 font-bold text-zinc-950 shadow-lg shadow-amber-500/20 hover:from-yellow-200 hover:via-amber-400 hover:to-orange-500"
                          >
                            <Plus className="size-4" aria-hidden /> Add expense
                          </Button>
                        </>
                      )}

                      {activeTrip.expenses.length > 0 ? (
                        <div
                          className={cn(
                            'mt-3 max-h-72 space-y-2 overflow-y-auto pr-1',
                            THIN_SCROLL
                          )}
                        >
                          {activeTrip.expenses.map((e) => (
                            <div
                              key={e.id}
                              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
                            >
                              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-sm font-black text-amber-200">
                                {e.payer.charAt(0).toUpperCase()}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-bold text-zinc-100">{e.payer}</p>
                                {e.note ? (
                                  <p className="truncate text-[11px] text-zinc-500">{e.note}</p>
                                ) : null}
                              </div>
                              <p className="shrink-0 text-sm font-bold tabular-nums text-zinc-100">
                                {settings.currency}
                                {fmt(e.amount)}
                              </p>
                              <ConfirmTrash
                                onConfirm={() => removeExpense(e.id)}
                                label="Delete expense"
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-3 flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-6 text-center">
                          <Wallet className="size-6 text-zinc-600" aria-hidden />
                          <p className="text-xs text-zinc-500">
                            {activeTrip.people.length === 0
                              ? 'Add your crew above, then log the first expense.'
                              : 'No expenses yet — add the first one above.'}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* settlement */}
                    <div className="rounded-2xl border border-amber-400/25 bg-gradient-to-br from-yellow-300/[0.07] via-amber-500/[0.05] to-orange-600/[0.06] p-3.5">
                      <div className="mb-3 flex items-center gap-2">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
                          <Route className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-bold">Settlement</h3>
                          <p className="text-[11px] text-zinc-500">
                            {settlement.total > 0
                              ? `Each share ${settings.currency}${fmt(settlement.share)} · total ${settings.currency}${fmt(settlement.total)}`
                              : 'Minimal transfers so everyone is square'}
                          </p>
                        </div>
                      </div>

                      {activeTrip.people.length === 0 ? (
                        <p className="text-xs text-zinc-500">
                          Add crew members and expenses to compute who owes whom.
                        </p>
                      ) : (
                        <>
                          {/* per-person totals */}
                          <div className="space-y-1.5">
                            {settlement.nets.map((n) => (
                              <div
                                key={n.name}
                                className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2"
                              >
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200">
                                  {n.name}
                                </span>
                                <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                                  paid {settings.currency}
                                  {fmt(n.paid)}
                                </span>
                                <span
                                  className={cn(
                                    'w-20 shrink-0 text-right text-sm font-bold tabular-nums',
                                    n.net > 0.004
                                      ? 'text-emerald-300'
                                      : n.net < -0.004
                                        ? 'text-rose-300'
                                        : 'text-zinc-400'
                                  )}
                                >
                                  {n.net > 0.004 ? '+' : n.net < -0.004 ? '−' : ''}
                                  {settings.currency}
                                  {fmt(Math.abs(n.net))}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* transfers */}
                          <div className="mt-3 border-t border-white/10 pt-3">
                            {settlement.transfers.length > 0 ? (
                              <div className="space-y-1.5">
                                {settlement.transfers.map((t, idx) => (
                                  <div
                                    key={`${t.from}-${t.to}-${idx}`}
                                    className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/[0.07] px-3 py-2"
                                  >
                                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200">
                                      {t.from}
                                    </span>
                                    <ArrowRight className="size-4 shrink-0 text-amber-300" aria-hidden />
                                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-200">
                                      {t.to}
                                    </span>
                                    <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold tabular-nums text-amber-200">
                                      {settings.currency}
                                      {fmt(t.amount)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/[0.07] px-3 py-3 text-sm font-semibold text-emerald-300">
                                <Check className="size-4" aria-hidden />
                                {settlement.total > 0
                                  ? 'All settled — no transfers needed.'
                                  : 'Add expenses to compute transfers.'}
                              </div>
                            )}
                          </div>

                          <Button
                            onClick={() => void copySummary()}
                            variant="outline"
                            className="mt-3 h-11 w-full rounded-xl border-white/15 bg-white/5 font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
                          >
                            <Copy className="size-4" aria-hidden /> Copy summary
                          </Button>
                        </>
                      )}
                    </div>
                  </>
                ) : tripsSorted.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center">
                    <Route className="size-8 text-zinc-600" aria-hidden />
                    <p className="text-sm font-semibold text-zinc-300">No trips yet</p>
                    <p className="max-w-64 text-xs text-zinc-500">
                      Create a trip, add your crew, and log shared expenses — settlements are computed
                      for you.
                    </p>
                  </div>
                ) : null}
              </motion.section>
            )}
          </div>
        )}
      </motion.div>

      {/* ---------------- Settings modal ---------------- */}
      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            key="tf-settings"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSettingsOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Travel & Fuel settings"
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
                  <Settings2 className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">Travel &amp; Fuel settings</h3>
                <button
                  onClick={() => setSettingsOpen(false)}
                  aria-label="Close"
                  className="flex size-9 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Currency
                  </p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Currency symbol">
                    {CURRENCIES.map((c) => (
                      <button
                        key={c}
                        onClick={() => pickCurrency(c)}
                        role="radio"
                        aria-checked={settings.currency === c}
                        className={cn(
                          'flex size-11 items-center justify-center rounded-xl border text-base transition-all',
                          settings.currency === c
                            ? 'border-amber-400/60 bg-amber-500/15 text-amber-200 shadow-md'
                            : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500">
                    Applies to every amount in Travel &amp; Fuel.
                  </p>
                </div>

                <Button
                  onClick={() => setSettingsOpen(false)}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-yellow-300 via-amber-500 to-orange-600 font-bold text-zinc-950 shadow-lg hover:from-yellow-200 hover:via-amber-400 hover:to-orange-500"
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
