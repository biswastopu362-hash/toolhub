'use client'

/**
 * Expense Tracker — know where your money goes.
 *
 * Income & expense entries with categories, a monthly budget with a live
 * progress bar, and two charts (category donut + daily bars) powered by
 * recharts. Everything persists in IndexedDB — private, offline, instant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CalendarDays,
  ChartColumn,
  ChartPie,
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings2,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
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

type TxType = 'income' | 'expense'

interface Tx {
  id: string
  type: TxType
  /** major units, rounded to 2 decimals */
  amount: number
  categoryId: string
  note: string
  /** local date key 'YYYY-MM-DD' */
  date: string
  createdAt: number
}

interface Category {
  id: string
  name: string
  emoji: string
  hex: string
  type: TxType
}

interface Prefs {
  /** monthly spending budget in major units; 0 = no budget */
  budget: number
  currency: string
}

const EXPENSE_CATS: Category[] = [
  { id: 'food', name: 'Food', emoji: '🍛', hex: '#f97316', type: 'expense' },
  { id: 'transport', name: 'Transport', emoji: '🚌', hex: '#38bdf8', type: 'expense' },
  { id: 'shopping', name: 'Shopping', emoji: '🛍️', hex: '#f472b6', type: 'expense' },
  { id: 'bills', name: 'Bills', emoji: '🧾', hex: '#facc15', type: 'expense' },
  { id: 'health', name: 'Health', emoji: '💊', hex: '#a78bfa', type: 'expense' },
  { id: 'fun', name: 'Fun', emoji: '🎮', hex: '#fb7185', type: 'expense' },
  { id: 'education', name: 'Education', emoji: '📚', hex: '#2dd4bf', type: 'expense' },
  { id: 'misc', name: 'Other', emoji: '📦', hex: '#94a3b8', type: 'expense' },
]

const INCOME_CATS: Category[] = [
  { id: 'salary', name: 'Salary', emoji: '💼', hex: '#34d399', type: 'income' },
  { id: 'business', name: 'Business', emoji: '🏪', hex: '#22d3ee', type: 'income' },
  { id: 'gift', name: 'Gift', emoji: '🎁', hex: '#c084fc', type: 'income' },
  { id: 'other-income', name: 'Other', emoji: '✨', hex: '#a3a3a3', type: 'income' },
]

const ALL_CATS = [...EXPENSE_CATS, ...INCOME_CATS]

function catOf(id: string): Category {
  return ALL_CATS.find((c) => c.id === id) ?? EXPENSE_CATS[EXPENSE_CATS.length - 1]
}

const CURRENCIES = ['৳', '$', '€', '£', '₹', '¥']
const DEFAULT_PREFS: Prefs = { budget: 0, currency: '৳' }

/* ---------------- date helpers (all local-time) ---------------- */

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthKeyOf(y: number, m: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

function dayLabel(key: string, today: Date): string {
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (key === dateKey(today)) return 'Today'
  if (key === dateKey(yesterday)) return 'Yesterday'
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmt(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/* ================================================================== */
/* IndexedDB — transactions + prefs, fully on-device                   */
/* ================================================================== */

const DB_NAME = 'toolhub-expenses'
const DB_VERSION = 1
const TX_STORE = 'transactions'
const SET_STORE = 'settings'

let dbPromise: Promise<IDBDatabase> | null = null

function openExpenseDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(TX_STORE)) d.createObjectStore(TX_STORE, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(SET_STORE)) d.createObjectStore(SET_STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openExpenseDb()
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

interface PrefRow {
  key: 'prefs'
  value: Prefs
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
/* Component                                                           */
/* ================================================================== */

export default function ExpenseTrackerApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [txs, setTxs] = useState<Tx[]>([])
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [loaded, setLoaded] = useState(false)
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return { y: n.getFullYear(), m: n.getMonth() }
  })
  const [addOpen, setAddOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [chartView, setChartView] = useState<'donut' | 'daily'>('donut')
  const today = useMemo(() => new Date(), [])
  const todayKey = dateKey(today)

  /* ---------------- add form ---------------- */
  const [formType, setFormType] = useState<TxType>('expense')
  const [formAmount, setFormAmount] = useState('')
  const [formCat, setFormCat] = useState(EXPENSE_CATS[0].id)
  const [formNote, setFormNote] = useState('')
  const [formDate, setFormDate] = useState(todayKey)
  const amountRef = useRef<HTMLInputElement>(null)

  /* ---------------- budget form ---------------- */
  const [budgetDraft, setBudgetDraft] = useState('')

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [allTx, allSettings] = await Promise.all([
          idbGetAll<Tx>(TX_STORE),
          idbGetAll<PrefRow>(SET_STORE),
        ])
        if (!alive) return
        setTxs(allTx)
        const saved = allSettings.find((r) => r.key === 'prefs')?.value
        if (saved) {
          setPrefs({
            budget: Number(saved.budget) || 0,
            currency: saved.currency || DEFAULT_PREFS.currency,
          })
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

  /* ---------------- mutations (write-through to IndexedDB) ---------------- */
  const addTx = useCallback((tx: Tx) => {
    setTxs((prev) => [tx, ...prev])
    void idbPut(TX_STORE, tx).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const removeTx = useCallback((id: string) => {
    setTxs((prev) => prev.filter((t) => t.id !== id))
    setConfirmDeleteId(null)
    void idbDelete(TX_STORE, id).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const savePrefs = useCallback((p: Prefs) => {
    setPrefs(p)
    void idbPut(SET_STORE, { key: 'prefs', value: p } satisfies PrefRow).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  /* ---------------- derived (selected month) ---------------- */
  const mKey = monthKeyOf(cursor.y, cursor.m)
  const monthTx = useMemo(() => txs.filter((t) => t.date.startsWith(mKey)), [txs, mKey])

  const income = useMemo(
    () => monthTx.reduce((s, t) => (t.type === 'income' ? s + t.amount : s), 0),
    [monthTx]
  )
  const expense = useMemo(
    () => monthTx.reduce((s, t) => (t.type === 'expense' ? s + t.amount : s), 0),
    [monthTx]
  )
  const net = income - expense

  const expenseByCat = useMemo(() => {
    const sums = new Map<string, number>()
    for (const t of monthTx) {
      if (t.type !== 'expense') continue
      sums.set(t.categoryId, (sums.get(t.categoryId) ?? 0) + t.amount)
    }
    return [...sums.entries()]
      .map(([id, value]) => ({ ...catOf(id), value }))
      .sort((a, b) => b.value - a.value)
  }, [monthTx])

  const dailyData = useMemo(() => {
    const n = daysInMonth(cursor.y, cursor.m)
    const sums = new Map<number, { income: number; expense: number }>()
    for (const t of monthTx) {
      const day = Number(t.date.slice(8, 10))
      const bucket = sums.get(day) ?? { income: 0, expense: 0 }
      if (t.type === 'income') bucket.income += t.amount
      else bucket.expense += t.amount
      sums.set(day, bucket)
    }
    const rows: { day: string; income: number; expense: number }[] = []
    for (let d = 1; d <= n; d++) {
      const b = sums.get(d)
      rows.push({ day: String(d), income: b?.income ?? 0, expense: b?.expense ?? 0 })
    }
    return rows
  }, [monthTx, cursor.y, cursor.m])

  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const budgetFrac = prefs.budget > 0 ? expense / prefs.budget : 0
  const budgetHex = budgetFrac > 1 ? '#fb7185' : budgetFrac >= 0.75 ? '#fbbf24' : '#34d399'

  /* group transactions by day, newest day first */
  const grouped = useMemo(() => {
    const map = new Map<string, Tx[]>()
    for (const t of monthTx) {
      const list = map.get(t.date) ?? []
      list.push(t)
      map.set(t.date, list)
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([key, rows]) => ({ key, rows: rows.sort((a, b) => b.createdAt - a.createdAt) }))
  }, [monthTx])

  /* ---------------- actions ---------------- */
  const openAdd = useCallback(() => {
    setFormType('expense')
    setFormAmount('')
    setFormCat(EXPENSE_CATS[0].id)
    setFormNote('')
    setFormDate(cursor.y === today.getFullYear() && cursor.m === today.getMonth() ? todayKey : `${mKey}-01`)
    setAddOpen(true)
    window.setTimeout(() => amountRef.current?.focus(), 140)
  }, [cursor.y, cursor.m, mKey, today, todayKey])

  const shiftMonth = useCallback((delta: number) => {
    setCursor((c) => {
      const d = new Date(c.y, c.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }, [])

  const submitTx = useCallback(() => {
    const parsed = Math.round(parseFloat(formAmount) * 100) / 100
    if (!formAmount.trim() || Number.isNaN(parsed) || parsed <= 0) {
      toast({ title: 'Enter an amount first' })
      return
    }
    const cat = catOf(formCat)
    const tx: Tx = {
      id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      type: formType,
      amount: parsed,
      categoryId: formCat,
      note: formNote.trim(),
      date: formDate,
      createdAt: Date.now(),
    }
    addTx(tx)
    setAddOpen(false)
    try {
      navigator.vibrate?.(12)
    } catch {
      /* haptics unsupported */
    }
    toast({
      title: formType === 'income' ? 'Income added' : 'Expense added',
      description: `${cat.emoji} ${cat.name} · ${prefs.currency}${fmt(parsed)}`,
    })
    // jump to the month the entry belongs to, so it is visible immediately
    const [yy, mm] = formDate.split('-').map(Number)
    if (yy && mm) setCursor({ y: yy, m: mm - 1 })
  }, [addTx, formAmount, formCat, formDate, formNote, formType, prefs.currency, toast])

  const saveBudget = useCallback(() => {
    const parsed = Math.round(parseFloat(budgetDraft) * 100) / 100
    const next: Prefs = { ...prefs, budget: Number.isNaN(parsed) || parsed <= 0 ? 0 : parsed }
    savePrefs(next)
    setPrefsOpen(false)
    toast({
      title: next.budget > 0 ? 'Budget updated' : 'Budget removed',
      description:
        next.budget > 0 ? `${next.currency}${fmt(next.budget)} per month` : 'Spending is no longer limited',
    })
  }, [budgetDraft, prefs, savePrefs, toast])

  const openPrefs = useCallback(() => {
    setBudgetDraft(prefs.budget > 0 ? String(prefs.budget) : '')
    setPrefsOpen(true)
  }, [prefs.budget])

  const formCats = formType === 'expense' ? EXPENSE_CATS : INCOME_CATS

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
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-emerald-500/[0.09] via-transparent to-teal-500/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-green-300 via-emerald-500 to-teal-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(16_185_129/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Wallet className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Expense Tracker</h2>
              <p className="text-xs text-zinc-400">Private, on-device money tracking.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={openPrefs}
                aria-label="Budget and currency settings"
                className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Settings2 className="size-4.5" aria-hidden />
              </button>
              <Button
                onClick={openAdd}
                className="h-10 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
              >
                <Plus className="size-4" aria-hidden /> Add
              </Button>
            </div>
          </div>

          {/* Month navigation */}
          <div className="mt-5 flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-1.5">
            <button
              onClick={() => shiftMonth(-1)}
              aria-label="Previous month"
              className="flex size-9 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="size-4.5" aria-hidden />
            </button>
            <span className="flex items-center gap-2 text-sm font-bold tracking-tight">
              <CalendarDays className="size-4 text-emerald-400" aria-hidden />
              {monthLabel}
            </span>
            <button
              onClick={() => shiftMonth(1)}
              aria-label="Next month"
              className="flex size-9 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ChevronRight className="size-4.5" aria-hidden />
            </button>
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
            {/* ---------------- Summary ---------------- */}
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-emerald-500/[0.08] to-teal-500/[0.05] p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Net this month
              </p>
              <p
                className={cn(
                  'mt-0.5 text-3xl font-black tracking-tight tabular-nums',
                  net > 0 ? 'text-emerald-300' : net < 0 ? 'text-rose-300' : 'text-zinc-200'
                )}
              >
                {net < 0 ? '−' : ''}
                {prefs.currency}
                {fmt(Math.abs(net))}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">Income</p>
                  <p className="text-sm font-bold tabular-nums text-emerald-200">
                    +{prefs.currency}
                    {fmt(income)}
                  </p>
                </div>
                <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">Spent</p>
                  <p className="text-sm font-bold tabular-nums text-rose-200">
                    −{prefs.currency}
                    {fmt(expense)}
                  </p>
                </div>
              </div>

              {/* Budget bar */}
              {prefs.budget > 0 ? (
                <div className="mt-3 border-t border-white/5 pt-3">
                  <div className="mb-1.5 flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-zinc-300">
                      Budget · {prefs.currency}
                      {fmt(prefs.budget)}
                    </span>
                    <span className={cn('font-bold tabular-nums', budgetFrac > 1 ? 'text-rose-300' : 'text-zinc-400')}>
                      {budgetFrac > 1
                        ? `Over by ${prefs.currency}${fmt(expense - prefs.budget)}`
                        : `${prefs.currency}${fmt(Math.max(0, prefs.budget - expense))} left`}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuenow={Math.round(Math.min(budgetFrac, 1) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Monthly budget usage">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: budgetHex }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.min(budgetFrac, 1) * 100}%` }}
                      transition={{ type: 'spring', stiffness: 120, damping: 24 }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  onClick={openPrefs}
                  className="mt-3 w-full rounded-xl border border-dashed border-white/15 py-2 text-xs font-semibold text-zinc-400 transition-colors hover:border-emerald-400/40 hover:text-emerald-300"
                >
                  + Set a monthly budget
                </button>
              )}
            </div>

            {/* ---------------- Charts ---------------- */}
            {monthTx.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-bold">This month in charts</p>
                  <div className="flex rounded-xl border border-white/10 bg-white/5 p-1" role="radiogroup" aria-label="Chart type">
                    {(
                      [
                        { id: 'donut', icon: ChartPie, label: 'Categories' },
                        { id: 'daily', icon: ChartColumn, label: 'Daily' },
                      ] as const
                    ).map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setChartView(v.id)}
                        role="radio"
                        aria-checked={chartView === v.id}
                        className={cn(
                          'flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-all',
                          chartView === v.id ? 'bg-emerald-500 text-zinc-950' : 'text-zinc-300 hover:bg-white/5'
                        )}
                      >
                        <v.icon className="size-3.5" aria-hidden />
                        {v.label}
                      </button>
                    ))}
                  </div>
                </div>

                {chartView === 'donut' ? (
                  expenseByCat.length > 0 ? (
                    <>
                      <div className="relative h-52 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={expenseByCat}
                              dataKey="value"
                              nameKey="name"
                              innerRadius="64%"
                              outerRadius="90%"
                              paddingAngle={2}
                              strokeWidth={0}
                            >
                              {expenseByCat.map((c) => (
                                <Cell key={c.id} fill={c.hex} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={TOOLTIP_STYLE}
                              itemStyle={{ color: '#e4e4e7' }}
                              formatter={(value) => `${prefs.currency}${fmt(Number(value))}`}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Spent</p>
                          <p className="text-lg font-black tabular-nums text-zinc-100">
                            {prefs.currency}
                            {fmt(expense)}
                          </p>
                        </div>
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {expenseByCat.map((c) => (
                          <li key={c.id} className="flex items-center gap-2.5 text-xs">
                            <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.hex }} aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-zinc-300">
                              {c.emoji} {c.name}
                            </span>
                            <span className="font-semibold tabular-nums text-zinc-400">
                              {Math.round((c.value / Math.max(expense, 1)) * 100)}%
                            </span>
                            <span className="w-20 shrink-0 text-right font-bold tabular-nums text-zinc-100">
                              {prefs.currency}
                              {fmt(c.value)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="py-10 text-center text-xs text-zinc-500">No expenses recorded this month.</p>
                  )
                ) : (
                  <>
                    <div className="h-48 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={dailyData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barGap={1}>
                          <XAxis
                            dataKey="day"
                            tick={{ fill: '#71717a', fontSize: 9 }}
                            axisLine={false}
                            tickLine={false}
                            interval={cursor.m === 1 ? 3 : 2}
                          />
                          <YAxis hide domain={[0, 'dataMax + 1']} />
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                            labelFormatter={(label) => `${monthLabel.split(' ')[0]} ${label}`}
                            formatter={(value, name) => [
                              `${prefs.currency}${fmt(Number(value))}`,
                              name === 'income' ? 'Income' : 'Spent',
                            ]}
                          />
                          <Bar dataKey="income" fill="#34d399" radius={[2, 2, 0, 0]} maxBarSize={9} />
                          <Bar dataKey="expense" fill="#fb7185" radius={[2, 2, 0, 0]} maxBarSize={9} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex items-center justify-center gap-4 text-[11px] text-zinc-400">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-[#34d399]" aria-hidden /> Income
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-[#fb7185]" aria-hidden /> Spent
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ---------------- Transactions ---------------- */}
            <div>
              <div className="mb-2.5 flex items-baseline justify-between">
                <p className="text-sm font-bold">Transactions</p>
                <p className="text-[11px] text-zinc-500">
                  {monthTx.length === 0 ? 'Nothing yet' : `${monthTx.length} this month`}
                </p>
              </div>

              {grouped.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                  <Wallet className="size-10 text-zinc-600" aria-hidden />
                  <p className="text-sm font-semibold text-zinc-300">No transactions in {monthLabel}</p>
                  <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                    Log income and expenses as they happen — charts and your budget fill in automatically. Data
                    never leaves this device.
                  </p>
                  <Button
                    onClick={openAdd}
                    className="mt-1 h-11 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 hover:from-teal-200 hover:to-emerald-400"
                  >
                    <Plus className="size-4" aria-hidden /> Add your first entry
                  </Button>
                </div>
              ) : (
                <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                  {grouped.map((g) => (
                    <div key={g.key}>
                      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        {dayLabel(g.key, today)}
                      </p>
                      <div className="space-y-1.5">
                        {g.rows.map((t) => {
                          const cat = catOf(t.categoryId)
                          const confirming = confirmDeleteId === t.id
                          return (
                            <motion.div
                              key={t.id}
                              layout
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.97 }}
                              transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                              className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5"
                            >
                              <span
                                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-lg"
                                style={{ backgroundColor: `${cat.hex}22` }}
                                aria-hidden
                              >
                                {cat.emoji}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-semibold text-zinc-100">
                                  {t.note || cat.name}
                                </p>
                                <p className="text-[11px] text-zinc-500">
                                  {cat.name} · {t.type === 'income' ? 'Income' : 'Expense'}
                                </p>
                              </div>
                              <p
                                className={cn(
                                  'shrink-0 text-sm font-bold tabular-nums',
                                  t.type === 'income' ? 'text-emerald-300' : 'text-rose-300'
                                )}
                              >
                                {t.type === 'income' ? '+' : '−'}
                                {prefs.currency}
                                {fmt(t.amount)}
                              </p>
                              <button
                                onClick={() => (confirming ? void removeTx(t.id) : setConfirmDeleteId(t.id))}
                                aria-label={confirming ? `Confirm delete ${t.note || cat.name}` : `Delete ${t.note || cat.name}`}
                                className={cn(
                                  'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
                                  confirming
                                    ? 'bg-rose-500 text-white'
                                    : 'text-zinc-600 hover:bg-rose-500/15 hover:text-rose-300'
                                )}
                              >
                                <Trash2 className="size-3.5" aria-hidden />
                              </button>
                            </motion.div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>

      {/* ---------------- Add-transaction modal ---------------- */}
      <AnimatePresence>
        {addOpen && (
          <motion.div
            key="add-tx"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setAddOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Add transaction"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
                  <Wallet className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">New entry</h3>
                <button
                  onClick={() => setAddOpen(false)}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-4">
                {/* type toggle */}
                <div className="flex rounded-xl border border-white/10 bg-white/5 p-1" role="radiogroup" aria-label="Entry type">
                  {(
                    [
                      { id: 'expense', label: '− Expense' },
                      { id: 'income', label: '+ Income' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      onClick={() => {
                        setFormType(t.id)
                        setFormCat(t.id === 'expense' ? EXPENSE_CATS[0].id : INCOME_CATS[0].id)
                      }}
                      role="radio"
                      aria-checked={formType === t.id}
                      className={cn(
                        'h-9 flex-1 rounded-lg text-xs font-bold transition-all',
                        formType === t.id
                          ? t.id === 'expense'
                            ? 'bg-rose-500 text-white'
                            : 'bg-emerald-500 text-zinc-950'
                          : 'text-zinc-300 hover:bg-white/5'
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* amount */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Amount</p>
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 transition-colors focus-within:border-emerald-400/50">
                    <span className="text-lg text-zinc-500">{prefs.currency}</span>
                    <input
                      ref={amountRef}
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitTx()
                      }}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label="Amount"
                      className="h-14 w-full bg-transparent text-2xl font-bold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                    />
                  </div>
                </div>

                {/* category */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Category</p>
                  <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Category">
                    {formCats.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setFormCat(c.id)}
                        role="radio"
                        aria-checked={formCat === c.id}
                        className={cn(
                          'flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 transition-all',
                          formCat === c.id
                            ? 'border-emerald-400/60 bg-emerald-500/15 shadow-md'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        )}
                      >
                        <span className="text-lg" aria-hidden>
                          {c.emoji}
                        </span>
                        <span className="w-full truncate text-center text-[9px] font-medium text-zinc-400">
                          {c.name}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* note */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Note <span className="font-normal normal-case text-zinc-600">(optional)</span>
                  </p>
                  <input
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitTx()
                    }}
                    placeholder="e.g. Groceries, Bus fare"
                    maxLength={60}
                    aria-label="Note"
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-emerald-400/50 focus:outline-none"
                  />
                </div>

                {/* date */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Date</p>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    aria-label="Date"
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 [color-scheme:dark] focus:border-emerald-400/50 focus:outline-none"
                  />
                </div>

                <Button
                  onClick={submitTx}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
                >
                  Save entry
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Budget & currency modal ---------------- */}
      <AnimatePresence>
        {prefsOpen && (
          <motion.div
            key="prefs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPrefsOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Budget and currency"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
                  <Settings2 className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">Budget &amp; currency</h3>
                <button
                  onClick={() => setPrefsOpen(false)}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Monthly spending budget
                  </p>
                  <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 transition-colors focus-within:border-emerald-400/50">
                    <span className="text-sm text-zinc-500">{prefs.currency}</span>
                    <input
                      value={budgetDraft}
                      onChange={(e) => setBudgetDraft(e.target.value.replace(/[^0-9.]/g, ''))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveBudget()
                      }}
                      inputMode="decimal"
                      placeholder="No budget"
                      aria-label="Monthly budget amount"
                      className="h-11 w-full bg-transparent text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500">
                    Leave empty to track without a budget. Progress turns amber at 75% and red when over.
                  </p>
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Currency</p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Currency symbol">
                    {CURRENCIES.map((c) => (
                      <button
                        key={c}
                        onClick={() => setPrefs((p) => ({ ...p, currency: c }))}
                        role="radio"
                        aria-checked={prefs.currency === c}
                        className={cn(
                          'flex size-10 items-center justify-center rounded-xl border text-base transition-all',
                          prefs.currency === c
                            ? 'border-emerald-400/60 bg-emerald-500/15 shadow-md'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        )}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={saveBudget}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
                >
                  Save settings
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
