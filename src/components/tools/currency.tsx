'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeftRight, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'

/* ================================================================== */
/* Constants + types                                                   */
/* ================================================================== */

interface CurrencyMeta {
  code: string
  name: string
  symbol: string
}

const CURRENCIES: CurrencyMeta[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: '₨' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SR' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'Dh' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QR' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
]

/** Approximate fallback rates per 1 USD — used only when live rates fail. */
const FALLBACK_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 155,
  CNY: 7.25,
  INR: 83.5,
  BDT: 117.5,
  PKR: 278,
  NPR: 133.6,
  LKR: 300,
  AUD: 1.53,
  CAD: 1.37,
  CHF: 0.88,
  SGD: 1.35,
  MYR: 4.7,
  THB: 36.5,
  IDR: 16300,
  PHP: 58.5,
  VND: 25400,
  KRW: 1380,
  SAR: 3.75,
  AED: 3.67,
  QAR: 3.64,
  TRY: 32.3,
  RUB: 90,
  BRL: 5.15,
  MXN: 17.1,
  ZAR: 18.4,
  NGN: 1450,
  KES: 130,
  EGP: 47.5,
}

const CACHE_KEY = 'currency-rates'
/** Refetch when the cached rates are older than 12 hours. */
const FRESH_MS = 12 * 60 * 60 * 1000

interface RatesResponse {
  result?: string
  rates?: Record<string, number>
  time_last_update_unix?: number
}

interface RatesCache {
  rates: Record<string, number>
  fetchedAt: number
}

function readRatesCache(): RatesCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RatesCache
    if (!parsed || typeof parsed.fetchedAt !== 'number' || !parsed.rates) return null
    return parsed
  } catch {
    return null
  }
}

function writeRatesCache(cache: RatesCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  } catch {
    /* storage unavailable — ignore */
  }
}

/** Big result: max 2 decimals at 1000+, otherwise up to 4. */
function formatResult(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: v >= 1000 ? 2 : 4 })
}

function formatRate(v: number): string {
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function symbolOf(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? ''
}

/* ================================================================== */
/* CurrencyTool — default export                                       */
/* ================================================================== */

export default function CurrencyTool() {
  const [rates, setRates] = useState<Record<string, number> | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [usingFallback, setUsingFallback] = useState(false)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('1')
  const [from, setFrom] = useState('USD')
  const [to, setTo] = useState('BDT')

  const loadRates = useCallback(async (force = false): Promise<void> => {
    if (!force) {
      const cached = readRatesCache()
      if (cached && Date.now() - cached.fetchedAt < FRESH_MS) {
        setRates(cached.rates)
        setUpdatedAt(cached.fetchedAt)
        setUsingFallback(false)
        setLoading(false)
        return
      }
    }
    setLoading(true)
    if (!navigator.onLine) {
      setRates((r) => r ?? FALLBACK_RATES)
      setUsingFallback(true)
      setLoading(false)
      return
    }
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as RatesResponse
      if (!json.rates || Object.keys(json.rates).length === 0) throw new Error('No rates')
      setRates(json.rates)
      setUpdatedAt((json.time_last_update_unix ?? Math.floor(Date.now() / 1000)) * 1000)
      setUsingFallback(false)
      setLoading(false)
      writeRatesCache({ rates: json.rates, fetchedAt: Date.now() })
    } catch {
      setRates((r) => r ?? FALLBACK_RATES)
      setUsingFallback(true)
      setLoading(false)
    }
  }, [])

  /* Initial load — cache first, then network if stale/missing (async callback). */
  useEffect(() => {
    const t = setTimeout(() => {
      void loadRates(false)
    }, 0)
    return () => clearTimeout(t)
  }, [loadRates])

  const swap = (): void => {
    setFrom(to)
    setTo(from)
  }

  const parsedAmount = Number(amount)
  const amountValid = amount.trim() !== '' && Number.isFinite(parsedAmount) && parsedAmount >= 0

  const crossRate = useMemo(() => {
    if (!rates) return null
    const rf = rates[from]
    const rt = rates[to]
    if (typeof rf !== 'number' || typeof rt !== 'number' || rf === 0) return null
    return rt / rf
  }, [rates, from, to])

  const converted = amountValid && crossRate !== null ? parsedAmount * crossRate : null

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------- Fallback warning ---------------- */}
      {usingFallback && (
        <Alert className="border-amber-500/40 text-amber-700 dark:text-amber-400 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
          <TriangleAlert className="h-4 w-4" aria-hidden />
          <AlertTitle>Showing approximate rates</AlertTitle>
          <AlertDescription>
            Live exchange rates are unavailable right now, so built-in reference rates are being
            used. Values are approximate — tap Refresh to retry.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          {/* ---------------- Amount ---------------- */}
          <div className="space-y-1.5">
            <Label htmlFor="currency-amount">Amount</Label>
            <Input
              id="currency-amount"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-11 text-lg"
              aria-label="Amount to convert"
            />
          </div>

          {/* ---------------- From / swap / To ---------------- */}
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="currency-from">From</Label>
              <Select value={from} onValueChange={(v) => setFrom(v)}>
                <SelectTrigger id="currency-from" className="h-11 w-full">
                  <SelectValue placeholder="From currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11"
                onClick={swap}
                aria-label="Swap currencies"
              >
                <ArrowLeftRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="currency-to">To</Label>
              <Select value={to} onValueChange={(v) => setTo(v)}>
                <SelectTrigger id="currency-to" className="h-11 w-full">
                  <SelectValue placeholder="To currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* ---------------- Result ---------------- */}
          <div
            className="rounded-xl border bg-muted/40 p-5 text-center"
            role="status"
            aria-live="polite"
          >
            {loading && rates === null ? (
              <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Loading exchange rates…
              </p>
            ) : converted === null ? (
              <p className="text-sm text-muted-foreground">
                {amountValid
                  ? 'Exchange rate for this pair is unavailable.'
                  : 'Enter a valid amount to convert.'}
              </p>
            ) : (
              <>
                <p className="break-all text-4xl font-semibold tracking-tight tabular-nums sm:text-5xl">
                  <span className="mr-1 align-middle text-2xl text-muted-foreground sm:text-3xl">
                    {symbolOf(to)}
                  </span>
                  {formatResult(converted)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground tabular-nums">
                  {formatResult(parsedAmount)} {from} equals
                </p>
              </>
            )}
          </div>

          {/* ---------------- Rate line + updated ---------------- */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-sm text-muted-foreground tabular-nums">
              {crossRate !== null ? (
                <>
                  1 {from} ={' '}
                  <span className="font-medium text-foreground">{formatRate(crossRate)}</span> {to}
                </>
              ) : (
                'Rate unavailable'
              )}
            </p>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {updatedAt !== null
                  ? `Updated ${new Date(updatedAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}`
                  : 'Last updated: unknown'}
              </span>
              <Button
                variant="outline"
                className="h-9 gap-1.5 px-3"
                onClick={() => void loadRates(true)}
                disabled={loading}
                aria-label="Refresh exchange rates"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5${loading ? ' animate-spin' : ''}`}
                  aria-hidden
                />
                Refresh
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
