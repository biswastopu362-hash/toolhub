'use client'

/**
 * Loan Calculator (EMI) v2 — premium dark-glass finance UI.
 *
 * Calculator tab: EMI + totals, principal-vs-interest donut, payoff timeline
 * chart (yearly bars / monthly cumulative areas), prepayment insight and the
 * yearly amortization schedule. Compare tab: side-by-side two-loan matchup
 * with a "Better" verdict and interest savings. All inputs persist in
 * localStorage ('toolhub-emi') — private, offline, instant.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from 'framer-motion'
import {
  BadgeCheck,
  Banknote,
  Calculator,
  CalendarClock,
  ChartColumn,
  ChartPie,
  ChevronDown,
  Landmark,
  Percent,
  PiggyBank,
  Scale,
  TrendingDown,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

const money = (x: number, currency: string): string =>
  `${currency}${Math.round(x).toLocaleString('en-US')}`

const compact = (x: number): string =>
  new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(x)

/** "3y 6m" style tenure label */
const fmtTenure = (months: number): string => {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m} mo`
  if (m === 0) return `${y} yr`
  return `${y} yr ${m} mo`
}

const MAX_MONTHS = 1200 // sanity cap: 100 years

interface MonthRow {
  m: number
  principal: number
  interest: number
  cumPrincipal: number
  cumInterest: number
  balance: number
}

interface YearRow {
  year: number
  principal: number
  interest: number
  balance: number
}

interface Schedule {
  emi: number
  /** actual payoff months (shorter than scheduled when prepaying) */
  months: number
  scheduledMonths: number
  totalInterest: number
  totalPayment: number
  principalPct: number
  interestPct: number
  monthly: MonthRow[]
  yearly: YearRow[]
}

/**
 * Full amortization simulation. `extra` is an additional principal payment
 * added to every EMI; with extra > 0 the loan closes earlier than scheduled.
 */
function computeSchedule(
  amount: number,
  annualRate: number,
  months: number,
  extra = 0
): Schedule | null {
  if (!(amount > 0) || !(annualRate >= 0) || months < 1 || months > MAX_MONTHS) return null

  const r = annualRate / 12 / 100
  const pow = Math.pow(1 + r, months)
  const emi = r === 0 ? amount / months : (amount * r * pow) / (pow - 1)
  const pay = emi + extra

  const monthly: MonthRow[] = []
  const yearly: YearRow[] = []
  let balance = amount
  let cumP = 0
  let cumI = 0
  let yP = 0
  let yI = 0
  let yearNo = 1

  for (let m = 1; m <= months && balance > 0.005; m++) {
    const interest = balance * r
    let principalPart = pay - interest
    if (principalPart > balance || m === months) principalPart = balance
    if (principalPart <= 0) return null // payment can't cover interest — never amortizes
    balance -= principalPart
    cumP += principalPart
    cumI += interest
    yP += principalPart
    yI += interest
    monthly.push({
      m,
      principal: principalPart,
      interest,
      cumPrincipal: cumP,
      cumInterest: cumI,
      balance: Math.max(0, balance),
    })
    if (m % 12 === 0 || m === months || balance <= 0.005) {
      yearly.push({
        year: yearNo++,
        principal: yP,
        interest: yI,
        balance: Math.max(0, balance),
      })
      yP = 0
      yI = 0
    }
  }

  const totalPayment = cumP + cumI
  if (!(totalPayment > 0)) return null

  return {
    emi,
    months: monthly.length,
    scheduledMonths: months,
    totalInterest: cumI,
    totalPayment,
    principalPct: (amount / totalPayment) * 100,
    interestPct: (cumI / totalPayment) * 100,
    monthly,
    yearly,
  }
}

/* ================================================================== */
/* Persistence — localStorage 'toolhub-emi'                            */
/* ================================================================== */

type Unit = 'years' | 'months'

interface LoanInput {
  label: string
  amount: string
  rate: string
  tenure: string
  unit: Unit
}

const DEFAULT_LOAN_A: LoanInput = {
  label: 'Bank A',
  amount: '500000',
  rate: '9',
  tenure: '5',
  unit: 'years',
}
const DEFAULT_LOAN_B: LoanInput = {
  label: 'Bank B',
  amount: '500000',
  rate: '8.5',
  tenure: '5',
  unit: 'years',
}

const STORAGE_KEY = 'toolhub-emi'
const CURRENCIES = ['৳', '$', '€', '£', '₹', '¥']
const DEFAULT_CURRENCY = '৳'

const asString = (v: unknown, fallback: string): string =>
  typeof v === 'string' ? v : fallback

const asUnit = (v: unknown): Unit => (v === 'months' ? 'months' : 'years')

const asLoan = (v: unknown, fallback: LoanInput): LoanInput => {
  if (!v || typeof v !== 'object') return fallback
  const o = v as Record<string, unknown>
  return {
    label: asString(o.label, fallback.label),
    amount: asString(o.amount, fallback.amount),
    rate: asString(o.rate, fallback.rate),
    tenure: asString(o.tenure, fallback.tenure),
    unit: asUnit(o.unit),
  }
}

/* ================================================================== */
/* Chart styling                                                       */
/* ================================================================== */

const TOOLTIP_STYLE = {
  background: 'rgba(9,9,11,0.95)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  fontSize: 12,
  color: '#e4e4e7',
  padding: '8px 10px',
} as const

const PRINCIPAL_HEX = '#2dd4bf'
const INTEREST_HEX = '#fbbf24'
const TICK_STYLE = { fill: '#71717a', fontSize: 9 } as const

function validateLoan(l: LoanInput): { months: number; ok: boolean } {
  const amountNum = parseFloat(l.amount)
  const rateNum = parseFloat(l.rate)
  const tenureNum = parseFloat(l.tenure)
  const months = isFinite(tenureNum)
    ? l.unit === 'years'
      ? Math.round(tenureNum * 12)
      : Math.round(tenureNum)
    : 0
  const ok =
    isFinite(amountNum) &&
    amountNum > 0 &&
    isFinite(rateNum) &&
    rateNum >= 0 &&
    rateNum <= 100 &&
    months >= 1 &&
    months <= MAX_MONTHS
  return { months, ok }
}

/* ================================================================== */
/* Animated money — cheap spring-count-up number                       */
/* ================================================================== */

function AnimatedMoney({
  value,
  currency,
  className,
}: {
  value: number
  currency: string
  className?: string
}) {
  const mv = useMotionValue(value)
  const spring = useSpring(mv, { stiffness: 300, damping: 32 })
  /** Computed text — re-evaluates on spring frames and whenever `currency` re-renders. */
  const text = useTransform(() => money(spring.get(), currency))

  useEffect(() => {
    mv.set(value)
  }, [mv, value])

  return <motion.span className={cn('tabular-nums', className)}>{text}</motion.span>
}

/* ================================================================== */
/* UI                                                                  */
/* ================================================================== */

type Tab = 'calc' | 'compare'

export default function EmiCalculatorTool() {
  /* ---------------- state ---------------- */
  const [tab, setTab] = useState<Tab>('calc')
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY)
  const [amount, setAmount] = useState('500000')
  const [rate, setRate] = useState('9')
  const [tenure, setTenure] = useState('5')
  const [unit, setUnit] = useState<Unit>('years')
  const [extra, setExtra] = useState('')
  const [granularity, setGranularity] = useState<Unit>('years')
  const [openTable, setOpenTable] = useState(false)
  const [loanA, setLoanA] = useState<LoanInput>(DEFAULT_LOAN_A)
  const [loanB, setLoanB] = useState<LoanInput>(DEFAULT_LOAN_B)
  const [loaded, setLoaded] = useState(false)

  /* ---------------- hydration (restore) ---------------- */
  useEffect(() => {
    // Deferred to a microtask: first paint uses SSR-safe defaults and the
    // stored values apply before the user can interact — no hydration
    // mismatch, no cascading synchronous setState inside the effect body.
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
          const p: unknown = JSON.parse(raw)
          if (p && typeof p === 'object') {
            const o = p as Record<string, unknown>
            const cur = asString(o.currency, DEFAULT_CURRENCY)
            if (CURRENCIES.includes(cur)) setCurrency(cur)
            setAmount(asString(o.amount, '500000'))
            setRate(asString(o.rate, '9'))
            setTenure(asString(o.tenure, '5'))
            setUnit(asUnit(o.unit))
            setExtra(asString(o.extra, ''))
            setGranularity(asUnit(o.granularity))
            setLoanA(asLoan(o.a, DEFAULT_LOAN_A))
            setLoanB(asLoan(o.b, DEFAULT_LOAN_B))
          }
        }
      } catch {
        /* corrupted storage — start fresh */
      }
      setLoaded(true)
    })
  }, [])

  /* ---------------- persistence (save) ---------------- */
  useEffect(() => {
    if (!loaded) return
    try {
      const payload = {
        v: 1,
        currency,
        amount,
        rate,
        tenure,
        unit,
        extra,
        granularity,
        a: loanA,
        b: loanB,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
      /* storage unavailable — ignore */
    }
  }, [loaded, currency, amount, rate, tenure, unit, extra, granularity, loanA, loanB])

  /* ---------------- derived: calculator ---------------- */
  const amountNum = parseFloat(amount)
  const rateNum = parseFloat(rate)
  const tenureNum = parseFloat(tenure)
  const months = useMemo(() => {
    if (!isFinite(tenureNum)) return 0
    return unit === 'years' ? Math.round(tenureNum * 12) : Math.round(tenureNum)
  }, [tenureNum, unit])

  const amountError = !(isFinite(amountNum) && amountNum > 0)
  const rateError = !(isFinite(rateNum) && rateNum >= 0 && rateNum <= 100)
  const tenureError = months < 1 || months > MAX_MONTHS

  const result = useMemo(
    () =>
      amountError || rateError || tenureError
        ? null
        : computeSchedule(amountNum, rateNum, months, 0),
    [amountNum, rateNum, months, amountError, rateError, tenureError]
  )

  const extraNum = Math.max(0, parseFloat(extra) || 0)

  const preResult = useMemo<Schedule | null>(() => {
    if (!result || extraNum <= 0) return null
    return computeSchedule(amountNum, rateNum, months, extraNum)
  }, [result, extraNum, amountNum, rateNum, months])

  const monthsSaved = result && preResult ? result.months - preResult.months : 0
  const interestSaved = result && preResult ? result.totalInterest - preResult.totalInterest : 0

  /* ---------------- derived: compare ---------------- */
  const checkA = useMemo(() => validateLoan(loanA), [loanA])
  const checkB = useMemo(() => validateLoan(loanB), [loanB])

  const resA = useMemo(
    () => (checkA.ok ? computeSchedule(parseFloat(loanA.amount), parseFloat(loanA.rate), checkA.months, 0) : null),
    [checkA.ok, checkA.months, loanA.amount, loanA.rate]
  )
  const resB = useMemo(
    () => (checkB.ok ? computeSchedule(parseFloat(loanB.amount), parseFloat(loanB.rate), checkB.months, 0) : null),
    [checkB.ok, checkB.months, loanB.amount, loanB.rate]
  )

  const verdict = useMemo(() => {
    if (!resA || !resB) return null
    const diff = resA.totalInterest - resB.totalInterest // > 0 → B cheaper
    const savings = Math.abs(diff)
    if (savings < 0.5) return { better: 'tie' as const, winnerLabel: '', loserLabel: '', savings, emiDiff: 0 }
    const better = diff > 0 ? 'b' : 'a'
    const winner = better === 'a' ? loanA : loanB
    const loser = better === 'a' ? loanB : loanA
    return {
      better,
      winnerLabel: winner.label.trim() || (better === 'a' ? 'Bank A' : 'Bank B'),
      loserLabel: loser.label.trim() || (better === 'a' ? 'Bank B' : 'Bank A'),
      savings,
      emiDiff: Math.abs(resA.emi - resB.emi),
    }
  }, [resA, resB, loanA, loanB])

  /* ---------------- chart data ---------------- */
  const payoffData = useMemo(() => {
    if (!result) return []
    if (granularity === 'years') {
      return result.yearly.map((r) => ({
        name: String(r.year),
        principal: r.principal,
        interest: r.interest,
      }))
    }
    return result.monthly.map((r) => ({
      name: String(r.m),
      principal: r.cumPrincipal,
      interest: r.cumInterest,
    }))
  }, [result, granularity])

  const pieData = useMemo(
    () =>
      result
        ? [
            { name: 'Principal', value: result.totalPayment - result.totalInterest },
            { name: 'Interest', value: result.totalInterest },
          ]
        : [],
    [result]
  )

  const compareData = useMemo(() => {
    if (!resA || !resB) return []
    return [
      { name: loanA.label.trim() || 'Bank A', interest: resA.totalInterest },
      { name: loanB.label.trim() || 'Bank B', interest: resB.totalInterest },
    ]
  }, [resA, resB, loanA.label, loanB.label])

  /* ---------------- actions ---------------- */
  const patchLoan = (which: 'a' | 'b', patch: Partial<LoanInput>) => {
    const setter = which === 'a' ? setLoanA : setLoanB
    setter((p) => ({ ...p, ...patch }))
  }

  const switchTab = (next: Tab) => {
    if (next === tab) return
    try {
      navigator.vibrate?.(12)
    } catch {
      /* haptics unsupported */
    }
    setTab(next)
  }

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
        <div className="border-b border-white/5 bg-gradient-to-br from-teal-500/[0.09] via-transparent to-emerald-500/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-teal-400 via-teal-500 to-emerald-700 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(13_148_136/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Landmark className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Loan Calculator</h2>
              <p className="text-xs text-zinc-400">EMI, amortization, prepayment &amp; comparison.</p>
            </div>
            <Select value={currency} onValueChange={(v) => setCurrency(v)}>
              <SelectTrigger
                className="h-11 w-[76px] shrink-0 rounded-xl border-white/10 bg-white/5 text-base font-bold text-zinc-100 hover:bg-white/10 focus:ring-emerald-400/30"
                aria-label="Select currency"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-xl border-white/10 bg-zinc-900 text-zinc-100">
                {CURRENCIES.map((c) => (
                  <SelectItem
                    key={c}
                    value={c}
                    className="rounded-lg focus:bg-white/10 focus:text-white"
                  >
                    <span className="text-base font-bold">{c}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ---------------- Tabs ---------------- */}
        <div className="px-4 pt-4 sm:px-5" role="tablist" aria-label="Calculator sections">
          <div className="flex rounded-2xl border border-white/10 bg-white/5 p-1">
            {(
              [
                { id: 'calc' as const, icon: Calculator, label: 'Calculator' },
                { id: 'compare' as const, icon: Scale, label: 'Compare' },
              ]
            ).map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => switchTab(t.id)}
                className="relative flex h-11 flex-1 items-center justify-center rounded-xl text-xs font-bold transition-colors"
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="emi-tab-pill"
                    className="absolute inset-0 rounded-xl bg-gradient-to-r from-teal-400 via-teal-500 to-emerald-600 shadow-lg"
                    transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                  />
                )}
                <span
                  className={cn(
                    'relative z-10 flex items-center gap-1.5',
                    tab === t.id ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
                  )}
                >
                  <t.icon className="size-4" aria-hidden />
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          {/* ============================================================ */}
          {/* CALCULATOR TAB                                               */}
          {/* ============================================================ */}
          {tab === 'calc' ? (
            <motion.section
              key="calc"
              role="tabpanel"
              aria-label="Loan calculator"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.14, ease: 'easeIn' } }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="space-y-4 p-4 sm:p-5"
            >
              {/* Inputs */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Calculator className="size-4 text-teal-400" aria-hidden />
                  <p className="text-sm font-bold">Loan details</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="emi-amount" className="text-xs font-medium text-zinc-300">
                      Loan amount ({currency})
                    </Label>
                    <Input
                      id="emi-amount"
                      type="number"
                      inputMode="decimal"
                      min={1}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="e.g. 500000"
                      aria-label={`Loan amount in ${currency}`}
                      aria-invalid={amountError}
                      className="h-11 rounded-xl border-white/10 bg-white/5 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:border-emerald-400/50 focus-visible:ring-emerald-400/30"
                    />
                    {amountError && (
                      <p className="text-xs text-rose-400">Enter a valid loan amount (greater than 0)</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="emi-rate" className="text-xs font-medium text-zinc-300">
                      Annual interest rate (%)
                    </Label>
                    <Input
                      id="emi-rate"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="0.01"
                      value={rate}
                      onChange={(e) => setRate(e.target.value)}
                      placeholder="e.g. 9"
                      aria-label="Annual interest rate in percent"
                      aria-invalid={rateError}
                      className="h-11 rounded-xl border-white/10 bg-white/5 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:border-emerald-400/50 focus-visible:ring-emerald-400/30"
                    />
                    {rateError && (
                      <p className="text-xs text-rose-400">Interest rate must be between 0 and 100</p>
                    )}
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="emi-tenure" className="text-xs font-medium text-zinc-300">
                      Tenure
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        id="emi-tenure"
                        type="number"
                        inputMode="decimal"
                        min={1}
                        value={tenure}
                        onChange={(e) => setTenure(e.target.value)}
                        placeholder="e.g. 5"
                        aria-label={`Tenure (${unit === 'years' ? 'years' : 'months'})`}
                        aria-invalid={tenureError}
                        className="h-11 flex-1 rounded-xl border-white/10 bg-white/5 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:border-emerald-400/50 focus-visible:ring-emerald-400/30"
                      />
                      <Select
                        value={unit}
                        onValueChange={(v) => setUnit(v === 'months' ? 'months' : 'years')}
                      >
                        <SelectTrigger
                          className="h-11 w-[110px] shrink-0 rounded-xl border-white/10 bg-white/5 text-sm text-zinc-100 hover:bg-white/10 focus:ring-emerald-400/30"
                          aria-label="Select tenure unit"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-white/10 bg-zinc-900 text-zinc-100">
                          <SelectItem value="years" className="rounded-lg focus:bg-white/10 focus:text-white">
                            Years
                          </SelectItem>
                          <SelectItem value="months" className="rounded-lg focus:bg-white/10 focus:text-white">
                            Months
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {tenureError && (
                      <p className="text-xs text-rose-400">
                        Tenure must be between 1 and {MAX_MONTHS.toLocaleString('en-US')} months
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {result ? (
                <>
                  {/* EMI hero */}
                  <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-400 via-teal-500 to-emerald-700 p-4 text-white shadow-[0_18px_44px_-18px_rgb(13_148_136/0.75)]">
                    <span className="pointer-events-none absolute -right-8 -top-10 size-32 rounded-full bg-white/10 blur-2xl" aria-hidden />
                    <div className="flex items-center gap-1.5 text-white/85">
                      <Banknote className="h-4 w-4" aria-hidden />
                      <span className="text-xs font-semibold uppercase tracking-wider">Monthly payment</span>
                    </div>
                    <p
                      className="mt-1.5 text-[28px] font-black leading-none tracking-tight"
                      aria-live="polite"
                      aria-label={`Monthly payment ${money(result.emi, currency)}`}
                    >
                      <AnimatedMoney value={result.emi} currency={currency} />
                    </p>
                    <p className="mt-2 text-[11px] text-white/80">
                      {result.scheduledMonths.toLocaleString('en-US')} months total · {rate || 0}% p.a.
                    </p>
                  </div>

                  {/* Stat cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <Percent className="h-3.5 w-3.5" aria-hidden />
                        <span className="text-xs font-semibold">Total interest</span>
                      </div>
                      <p className="mt-1.5 text-lg font-bold tracking-tight text-amber-300">
                        {money(result.totalInterest, currency)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        {result.interestPct.toFixed(1)}% of what you pay
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <PiggyBank className="h-3.5 w-3.5" aria-hidden />
                        <span className="text-xs font-semibold">Total payment</span>
                      </div>
                      <p className="mt-1.5 text-lg font-bold tracking-tight text-zinc-100">
                        {money(result.totalPayment, currency)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-500">
                        Principal + interest
                      </p>
                    </div>
                  </div>

                  {/* Donut */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <ChartPie className="size-4 text-teal-400" aria-hidden />
                      <p className="text-sm font-bold">Where your money goes</p>
                    </div>
                    <div className="relative h-48 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius="64%"
                            outerRadius="90%"
                            paddingAngle={2}
                            strokeWidth={0}
                          >
                            <Cell fill={PRINCIPAL_HEX} />
                            <Cell fill={INTEREST_HEX} />
                          </Pie>
                          <Tooltip
                            contentStyle={TOOLTIP_STYLE}
                            itemStyle={{ color: '#e4e4e7' }}
                            formatter={(value, name) => [money(Number(value), currency), String(name)]}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          Total payment
                        </p>
                        <p className="text-lg font-black tabular-nums text-zinc-100">
                          <AnimatedMoney value={result.totalPayment} currency={currency} />
                        </p>
                      </div>
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      <li className="flex items-center gap-2.5 text-xs">
                        <span className="size-2.5 shrink-0 rounded-full bg-[#2dd4bf]" aria-hidden />
                        <span className="min-w-0 flex-1 text-zinc-300">Principal</span>
                        <span className="font-semibold tabular-nums text-zinc-400">
                          {result.principalPct.toFixed(1)}%
                        </span>
                        <span className="w-24 shrink-0 text-right font-bold tabular-nums text-zinc-100">
                          {money(amountNum, currency)}
                        </span>
                      </li>
                      <li className="flex items-center gap-2.5 text-xs">
                        <span className="size-2.5 shrink-0 rounded-full bg-[#fbbf24]" aria-hidden />
                        <span className="min-w-0 flex-1 text-zinc-300">Interest</span>
                        <span className="font-semibold tabular-nums text-zinc-400">
                          {result.interestPct.toFixed(1)}%
                        </span>
                        <span className="w-24 shrink-0 text-right font-bold tabular-nums text-zinc-100">
                          {money(result.totalInterest, currency)}
                        </span>
                      </li>
                    </ul>
                  </div>

                  {/* Payoff timeline chart */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <ChartColumn className="size-4 shrink-0 text-teal-400" aria-hidden />
                        <p className="min-w-0 truncate text-sm font-bold">Payoff timeline</p>
                      </div>
                      <div
                        className="flex shrink-0 rounded-xl border border-white/10 bg-white/5 p-1"
                        role="radiogroup"
                        aria-label="Chart granularity"
                      >
                        {(
                          [
                            { id: 'years' as const, label: 'Yearly' },
                            { id: 'months' as const, label: 'Monthly' },
                          ]
                        ).map((g) => (
                          <button
                            key={g.id}
                            onClick={() => setGranularity(g.id)}
                            role="radio"
                            aria-checked={granularity === g.id}
                            className={cn(
                              'flex h-11 items-center rounded-xl px-3.5 text-[11px] font-bold transition-all',
                              granularity === g.id
                                ? 'bg-teal-500 text-zinc-950'
                                : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                            )}
                          >
                            {g.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <p className="mb-2 text-[11px] text-zinc-500">
                      {granularity === 'years'
                        ? 'Principal vs interest paid each year'
                        : 'Cumulative principal vs interest paid to date'}
                    </p>
                    <div className="h-52 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        {granularity === 'years' ? (
                          <BarChart data={payoffData} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
                            <XAxis
                              dataKey="name"
                              tick={TICK_STYLE}
                              axisLine={false}
                              tickLine={false}
                              interval="preserveStartEnd"
                              minTickGap={16}
                            />
                            <YAxis
                              width={44}
                              tick={TICK_STYLE}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v) => compact(Number(v))}
                            />
                            <Tooltip
                              contentStyle={TOOLTIP_STYLE}
                              cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                              labelFormatter={(label) => `Year ${label}`}
                              formatter={(value, name) => [money(Number(value), currency), String(name)]}
                            />
                            <Bar
                              dataKey="principal"
                              name="Principal"
                              stackId="a"
                              fill={PRINCIPAL_HEX}
                              maxBarSize={18}
                              isAnimationActive={payoffData.length <= 120}
                            />
                            <Bar
                              dataKey="interest"
                              name="Interest"
                              stackId="a"
                              fill={INTEREST_HEX}
                              radius={[3, 3, 0, 0]}
                              maxBarSize={18}
                              isAnimationActive={payoffData.length <= 120}
                            />
                          </BarChart>
                        ) : (
                          <AreaChart data={payoffData} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                            <defs>
                              <linearGradient id="emi-grad-principal" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={PRINCIPAL_HEX} stopOpacity={0.55} />
                                <stop offset="100%" stopColor={PRINCIPAL_HEX} stopOpacity={0.08} />
                              </linearGradient>
                              <linearGradient id="emi-grad-interest" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={INTEREST_HEX} stopOpacity={0.5} />
                                <stop offset="100%" stopColor={INTEREST_HEX} stopOpacity={0.08} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
                            <XAxis
                              dataKey="name"
                              tick={TICK_STYLE}
                              axisLine={false}
                              tickLine={false}
                              interval="preserveStartEnd"
                              minTickGap={28}
                            />
                            <YAxis
                              width={44}
                              tick={TICK_STYLE}
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v) => compact(Number(v))}
                            />
                            <Tooltip
                              contentStyle={TOOLTIP_STYLE}
                              cursor={{ stroke: 'rgba(255,255,255,0.2)' }}
                              labelFormatter={(label) => `Month ${label}`}
                              formatter={(value, name) => [money(Number(value), currency), String(name)]}
                            />
                            <Area
                              type="monotone"
                              dataKey="principal"
                              name="Principal paid"
                              stackId="1"
                              stroke={PRINCIPAL_HEX}
                              strokeWidth={1.5}
                              fill="url(#emi-grad-principal)"
                              isAnimationActive={payoffData.length <= 400}
                            />
                            <Area
                              type="monotone"
                              dataKey="interest"
                              name="Interest paid"
                              stackId="1"
                              stroke={INTEREST_HEX}
                              strokeWidth={1.5}
                              fill="url(#emi-grad-interest)"
                              isAnimationActive={payoffData.length <= 400}
                            />
                          </AreaChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex items-center justify-center gap-4 text-[11px] text-zinc-400">
                      <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-[#2dd4bf]" aria-hidden /> Principal
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-[#fbbf24]" aria-hidden /> Interest
                      </span>
                    </div>
                  </div>

                  {/* Prepayment insight */}
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <TrendingDown className="size-4 text-emerald-400" aria-hidden />
                      <p className="text-sm font-bold">Prepayment insight</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="emi-extra" className="text-xs font-medium text-zinc-300">
                        Extra amount added to every EMI ({currency})
                      </Label>
                      <Input
                        id="emi-extra"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={extra}
                        onChange={(e) => setExtra(e.target.value)}
                        placeholder="e.g. 2000"
                        aria-label={`Extra monthly payment in ${currency}`}
                        className="h-11 rounded-xl border-white/10 bg-white/5 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:border-emerald-400/50 focus-visible:ring-emerald-400/30"
                      />
                    </div>
                    {extraNum > 0 && preResult ? (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                        className="mt-3"
                      >
                        <div className="grid grid-cols-3 gap-2">
                          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                              New tenure
                            </p>
                            <p className="mt-0.5 text-sm font-bold tabular-nums text-zinc-100">
                              {fmtTenure(preResult.months)}
                            </p>
                          </div>
                          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                              Earlier by
                            </p>
                            <p className="mt-0.5 text-sm font-bold tabular-nums text-teal-300">
                              {monthsSaved.toLocaleString('en-US')} mo
                            </p>
                          </div>
                          <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-2.5">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">
                              Interest saved
                            </p>
                            <p className="mt-0.5 text-sm font-bold tabular-nums text-emerald-300">
                              {money(interestSaved, currency)}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 text-[11px] text-zinc-500">
                          Paying {money(result.emi + extraNum, currency)}/month closes the loan in{' '}
                          {preResult.months.toLocaleString('en-US')} months instead of{' '}
                          {result.months.toLocaleString('en-US')}.
                        </p>
                      </motion.div>
                    ) : (
                      <p className="mt-2 text-[11px] text-zinc-500">
                        Add a little extra each month and see how much interest you dodge.
                      </p>
                    )}
                  </div>

                  {/* Amortization table */}
                  <Collapsible open={openTable} onOpenChange={setOpenTable}>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="outline"
                        className="h-11 w-full justify-between rounded-xl border-white/10 bg-white/5 px-4 text-sm text-zinc-100 hover:bg-white/10 hover:text-white"
                        aria-expanded={openTable}
                      >
                        View amortization schedule
                        <ChevronDown
                          className={cn('h-4 w-4 transition-transform', openTable && 'rotate-180')}
                          aria-hidden="true"
                        />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
                        <div className="max-h-96 overflow-y-auto rounded-lg border border-white/10">
                          <Table>
                            <TableHeader className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur">
                              <TableRow className="border-white/10 hover:bg-transparent">
                                <TableHead className="text-xs text-zinc-400">Year</TableHead>
                                <TableHead className="text-right text-xs text-zinc-400">
                                  Principal paid
                                </TableHead>
                                <TableHead className="text-right text-xs text-zinc-400">Interest</TableHead>
                                <TableHead className="text-right text-xs text-zinc-400">Balance</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {result.yearly.map((row) => (
                                <TableRow key={row.year} className="border-white/5 hover:bg-white/[0.04]">
                                  <TableCell className="font-medium text-zinc-100">
                                    Year {row.year}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs text-zinc-100 sm:text-sm">
                                    {money(row.principal, currency)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs text-amber-400 sm:text-sm">
                                    {money(row.interest, currency)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs text-zinc-300 sm:text-sm">
                                    {money(row.balance, currency)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                        <p className="mt-2 text-[11px] text-zinc-500">
                          All figures are estimates — your bank&apos;s actual calculation may differ
                          (processing fees, rate changes, etc.).
                        </p>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-10 text-center">
                  <Banknote className="size-8 text-zinc-600" aria-hidden />
                  <p className="text-sm font-semibold text-zinc-300">Enter valid values</p>
                  <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                    Results will appear as soon as the loan amount, interest rate and tenure are valid
                  </p>
                </div>
              )}
            </motion.section>
          ) : (
            /* ============================================================ */
            /* COMPARE TAB                                                  */
            /* ============================================================ */
            <motion.section
              key="compare"
              role="tabpanel"
              aria-label="Loan comparison"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.14, ease: 'easeIn' } }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="space-y-4 p-4 sm:p-5"
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    { which: 'a' as const, loan: loanA, res: resA, ok: checkA.ok, accent: 'text-teal-400' },
                    { which: 'b' as const, loan: loanB, res: resB, ok: checkB.ok, accent: 'text-amber-400' },
                  ]
                ).map(({ which, loan, res, ok, accent }) => {
                  const isWinner = verdict?.better === which
                  return (
                    <motion.div
                      key={which}
                      layout
                      className={cn(
                        'rounded-2xl border bg-white/[0.03] p-4 transition-colors',
                        isWinner ? 'border-emerald-400/40 bg-emerald-500/[0.06]' : 'border-white/10'
                      )}
                    >
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <Scale className={cn('size-4 shrink-0', accent)} aria-hidden />
                          <p className="min-w-0 truncate text-sm font-bold">Loan {which.toUpperCase()}</p>
                        </div>
                        {isWinner && (
                          <motion.span
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: 'spring', stiffness: 340, damping: 22 }}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300"
                          >
                            <BadgeCheck className="size-3" aria-hidden />
                            Better
                          </motion.span>
                        )}
                      </div>

                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label htmlFor={`emi-${which}-label`} className="text-xs font-medium text-zinc-300">
                            Lender name
                          </Label>
                          <Input
                            id={`emi-${which}-label`}
                            type="text"
                            value={loan.label}
                            onChange={(e) => patchLoan(which, { label: e.target.value })}
                            placeholder={which === 'a' ? 'Bank A' : 'BRAC'}
                            aria-label={`Lender name for loan ${which.toUpperCase()}`}
                            className="h-11 rounded-xl border-white/10 bg-white/5 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:border-emerald-400/50 focus-visible:ring-emerald-400/30"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`emi-${which}-amount`} className="text-xs font-medium text-zinc-300">
                            Amount ({currency})
                          </Label>
                          <Input
                            id={`emi-${which}-amount`}
                            type="number"
                            inputMode="decimal"
                            min={1}
                            value={loan.amount}
                            onChange={(e) => patchLoan(which, { amount: e.target.value })}
                            placeholder="e.g. 500000"
                            aria-label={`Loan amount for loan ${which.toUpperCase()} in ${currency}`}
                            className="h-11 rounded-xl border-white/10 bg-white/5 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:border-emerald-400/50 focus-visible:ring-emerald-400/30"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`emi-${which}-rate`} className="text-xs font-medium text-zinc-300">
                            Rate (% p.a.)
                          </Label>
                          <Input
                            id={`emi-${which}-rate`}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="0.01"
                            value={loan.rate}
                            onChange={(e) => patchLoan(which, { rate: e.target.value })}
                            placeholder="e.g. 9"
                            aria-label={`Interest rate for loan ${which.toUpperCase()} in percent`}
                            className="h-11 rounded-xl border-white/10 bg-white/5 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:border-emerald-400/50 focus-visible:ring-emerald-400/30"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`emi-${which}-tenure`} className="text-xs font-medium text-zinc-300">
                            Tenure
                          </Label>
                          <div className="flex gap-2">
                            <Input
                              id={`emi-${which}-tenure`}
                              type="number"
                              inputMode="decimal"
                              min={1}
                              value={loan.tenure}
                              onChange={(e) => patchLoan(which, { tenure: e.target.value })}
                              placeholder="e.g. 5"
                              aria-label={`Tenure for loan ${which.toUpperCase()} (${loan.unit === 'years' ? 'years' : 'months'})`}
                              className="h-11 flex-1 rounded-xl border-white/10 bg-white/5 text-base text-zinc-100 placeholder:text-zinc-500 focus-visible:border-emerald-400/50 focus-visible:ring-emerald-400/30"
                            />
                            <Select
                              value={loan.unit}
                              onValueChange={(v) => patchLoan(which, { unit: v === 'months' ? 'months' : 'years' })}
                            >
                              <SelectTrigger
                                className="h-11 w-[104px] shrink-0 rounded-xl border-white/10 bg-white/5 text-sm text-zinc-100 hover:bg-white/10 focus:ring-emerald-400/30"
                                aria-label={`Select tenure unit for loan ${which.toUpperCase()}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="rounded-xl border-white/10 bg-zinc-900 text-zinc-100">
                                <SelectItem
                                  value="years"
                                  className="rounded-lg focus:bg-white/10 focus:text-white"
                                >
                                  Years
                                </SelectItem>
                                <SelectItem
                                  value="months"
                                  className="rounded-lg focus:bg-white/10 focus:text-white"
                                >
                                  Months
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>

                      {/* Per-loan results */}
                      {ok && res ? (
                        <dl className="mt-4 space-y-1.5 border-t border-white/10 pt-3 text-sm">
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className="text-xs text-zinc-400">Monthly EMI</dt>
                            <dd className="font-bold tabular-nums text-zinc-100">
                              <AnimatedMoney value={res.emi} currency={currency} />
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className="text-xs text-zinc-400">Total interest</dt>
                            <dd className="font-semibold tabular-nums text-amber-300">
                              {money(res.totalInterest, currency)}
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className="text-xs text-zinc-400">Total payment</dt>
                            <dd className="font-semibold tabular-nums text-zinc-100">
                              {money(res.totalPayment, currency)}
                            </dd>
                          </div>
                          <div className="flex items-baseline justify-between gap-2">
                            <dt className="text-xs text-zinc-400">Tenure</dt>
                            <dd className="font-medium tabular-nums text-zinc-300">
                              {res.scheduledMonths.toLocaleString('en-US')} mo
                            </dd>
                          </div>
                        </dl>
                      ) : (
                        <p className="mt-4 rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-xs text-zinc-500">
                          Enter valid amount, rate and tenure
                        </p>
                      )}
                    </motion.div>
                  )
                })}
              </div>

              {/* Verdict */}
              {resA && resB && verdict && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                  className={cn(
                    'rounded-2xl border p-4',
                    verdict.better === 'tie'
                      ? 'border-white/10 bg-white/[0.03]'
                      : 'border-emerald-400/25 bg-emerald-500/10'
                  )}
                >
                  {verdict.better === 'tie' ? (
                    <div className="flex items-center gap-2.5">
                      <Scale className="size-4 shrink-0 text-zinc-400" aria-hidden />
                      <p className="text-sm font-semibold text-zinc-200">
                        Both loans cost about the same in interest.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <BadgeCheck className="size-4 shrink-0 text-emerald-400" aria-hidden />
                        <p className="text-sm font-bold text-emerald-200">
                          {verdict.winnerLabel} comes out ahead
                        </p>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-zinc-300">
                        Saves{' '}
                        <span className="font-bold text-emerald-300">
                          {money(verdict.savings, currency)}
                        </span>{' '}
                        in interest over the full term
                        {verdict.emiDiff >= 0.5 && (
                          <> · EMI differs by {money(verdict.emiDiff, currency)}/month</>
                        )}
                        .
                      </p>
                    </>
                  )}
                </motion.div>
              )}

              {/* Interest comparison chart */}
              {resA && resB && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <ChartColumn className="size-4 text-teal-400" aria-hidden />
                    <p className="text-sm font-bold">Total interest comparison</p>
                  </div>
                  <div className="h-36 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={compareData} margin={{ top: 8, right: 4, bottom: 0, left: -8 }}>
                        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
                        <XAxis
                          dataKey="name"
                          tick={TICK_STYLE}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)}
                          interval={0}
                        />
                        <YAxis
                          width={44}
                          tick={TICK_STYLE}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(v) => compact(Number(v))}
                        />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                          formatter={(value) => [money(Number(value), currency), 'Total interest']}
                        />
                        <Bar dataKey="interest" radius={[6, 6, 0, 0]} maxBarSize={56}>
                          <Cell
                            fill={verdict?.better === 'b' ? INTEREST_HEX : PRINCIPAL_HEX}
                          />
                          <Cell
                            fill={verdict?.better === 'a' ? INTEREST_HEX : PRINCIPAL_HEX}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-1 text-center text-[11px] text-zinc-500">
                    Lower is better — teal bar pays less interest
                  </p>
                </div>
              )}

              <p className="px-1 text-[11px] leading-relaxed text-zinc-500">
                Tip: loans can differ in amount, rate and tenure — the verdict compares total interest
                across each loan&apos;s full term. Edit the lender names to whatever you like (e.g.
                &quot;BRAC&quot;, &quot;City Bank&quot;).
              </p>
            </motion.section>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
