'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Copy, KeyRound, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toBn } from '@/lib/bn'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Character sets & cryptographically-secure generation                */
/* ================================================================== */

const SET_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const SET_LOWER = 'abcdefghijklmnopqrstuvwxyz'
const SET_DIGIT = '0123456789'
const SET_SYMBOL = '!@#$%^&*()-_=+[]{};:,.<>?/~'
const CONFUSABLE = new Set(['i', 'l', '1', 'L', 'O', '0', 'o'])

interface PwOptions {
  upper: boolean
  lower: boolean
  digits: boolean
  symbols: boolean
  noConfusable: boolean
}

function stripConfusable(set: string, no: boolean): string {
  if (!no) return set
  return set
    .split('')
    .filter((c) => !CONFUSABLE.has(c))
    .join('')
}

function buildPool(o: PwOptions): string {
  const parts: string[] = []
  if (o.upper) parts.push(stripConfusable(SET_UPPER, o.noConfusable))
  if (o.lower) parts.push(stripConfusable(SET_LOWER, o.noConfusable))
  if (o.digits) parts.push(stripConfusable(SET_DIGIT, o.noConfusable))
  if (o.symbols) parts.push(stripConfusable(SET_SYMBOL, o.noConfusable))
  return parts.join('')
}

/**
 * Cryptographically-secure random integer in [0, max).
 * Rejection sampling: bytes >= (256 - 256 % max) are discarded,
 * so every index has exactly equal probability (no modulo bias).
 */
function secureRandomIndex(max: number): number {
  const buf = new Uint8Array(1)
  const limit = 256 - (256 % max)
  let v = 0
  do {
    crypto.getRandomValues(buf)
    v = buf[0]
  } while (v >= limit)
  return v % max
}

function generatePassword(length: number, o: PwOptions): string {
  const pool = buildPool(o)
  let out = ''
  for (let i = 0; i < length; i++) out += pool[secureRandomIndex(pool.length)]
  return out
}

/* ================================================================== */
/* Strength meter (entropy based)                                      */
/* ================================================================== */

const LEVELS = [
  { label: 'দুর্বল', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  { label: 'মোট', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  { label: 'ভাল', bar: 'bg-lime-500', text: 'text-lime-600 dark:text-lime-400' },
  { label: 'দুর্দান্ত', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
] as const

function strengthLevel(entropy: number): 0 | 1 | 2 | 3 {
  if (entropy < 40) return 0
  if (entropy < 60) return 1
  if (entropy < 90) return 2
  return 3
}

/** Rough offline-attack estimate (~10^10 guesses/sec) in Bengali */
function crackTimeText(entropy: number): string {
  if (!isFinite(entropy) || entropy <= 0) return '—'
  const seconds = Math.pow(2, entropy) / 2 / 1e10
  if (seconds < 1) return 'তাৎক্ষণিকভাবে'
  if (seconds < 60) return `প্রায় ${toBn(Math.max(1, Math.round(seconds)))} সেকেন্ড`
  const minutes = seconds / 60
  if (minutes < 60) return `প্রায় ${toBn(Math.round(minutes))} মিনিট`
  const hours = minutes / 60
  if (hours < 24) return `প্রায় ${toBn(Math.round(hours))} ঘণ্টা`
  const days = hours / 24
  if (days < 365) return `প্রায় ${toBn(Math.round(days))} দিন`
  const years = days / 365.25
  if (years < 100) return `প্রায় ${toBn(Math.round(years))} বছর`
  if (years < 10_000) return 'শত শত বছর'
  if (years < 1_000_000) return 'হাজার হাজার বছর'
  if (years < 1e9) return 'লক্ষ লক্ষ বছর'
  return 'কোটি কোটি বছর'
}

/* ================================================================== */
/* UI                                                                  */
/* ================================================================== */

const CHECK_ITEMS: { key: keyof PwOptions; label: string; hint: string }[] = [
  { key: 'upper', label: 'বড় হাতের অক্ষর', hint: 'A-Z' },
  { key: 'lower', label: 'ছোট হাতের অক্ষর', hint: 'a-z' },
  { key: 'digits', label: 'সংখ্যা', hint: '0-9' },
  { key: 'symbols', label: 'প্রতীক', hint: '!@#$…' },
  { key: 'noConfusable', label: 'বিভ্রান্তিকর অক্ষর বাদ দিন', hint: 'i l 1 L O 0 o' },
]

export default function PasswordGeneratorTool() {
  const { toast } = useToast()
  const [length, setLength] = useState(16)
  const [opts, setOpts] = useState<PwOptions>({
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
    noConfusable: false,
  })
  const [password, setPassword] = useState('')
  const [history, setHistory] = useState<string[]>([])

  const pool = buildPool(opts)
  const noCharset = pool.length === 0

  /* Regenerate (initial mount + whenever options/length change).
     setState runs inside setTimeout — never synchronously in the effect body. */
  const regenerate = useCallback(() => {
    const p = buildPool(opts)
    if (p.length === 0) return
    setPassword(generatePassword(length, opts))
  }, [length, opts])

  useEffect(() => {
    const t = setTimeout(regenerate, 0)
    return () => clearTimeout(t)
  }, [regenerate])

  const copy = useCallback(
    async (text: string) => {
      if (!text) return
      try {
        await navigator.clipboard.writeText(text)
        toast({ title: 'কপি হয়েছে ✓', description: 'ক্লিপবোর্ডে সংরক্ষিত হয়েছে' })
      } catch {
        toast({
          title: 'কপি করা যায়নি',
          description: 'লেখাটি সিলেক্ট করে ম্যানুয়ালি কপি করুন',
          variant: 'destructive',
        })
      }
    },
    [toast]
  )

  const handleGenerate = () => {
    if (noCharset) return
    const pw = generatePassword(length, opts)
    setPassword(pw)
    setHistory((h) => [pw, ...h.filter((x) => x !== pw)].slice(0, 5))
  }

  const entropy = password && !noCharset ? password.length * Math.log2(pool.length) : 0
  const level = strengthLevel(entropy)

  return (
    <div className="mx-auto max-w-md">
      <Card className="overflow-hidden shadow-md">
        <CardContent className="space-y-4 p-4 sm:space-y-5 sm:p-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="gap-1.5">
              <KeyRound className="h-3.5 w-3.5" />
              দৈর্ঘ্য: {toBn(length)}
            </Badge>
            {password && !noCharset && (
              <span className="text-xs text-muted-foreground">
                এনট্রপি: {toBn(Math.round(entropy))} বিট
              </span>
            )}
          </div>

          {/* Password display */}
          <div className="flex items-center gap-2 rounded-2xl border bg-muted/40 p-3">
            <p
              className="min-h-[2rem] flex-1 break-all font-mono text-lg font-semibold sm:text-xl"
              aria-live="polite"
              aria-label="তৈরি করা পাসওয়ার্ড"
            >
              {password || <span className="font-normal opacity-40">…</span>}
            </p>
            <Button
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              onClick={() => copy(password)}
              disabled={!password}
              aria-label="পাসওয়ার্ড কপি করুন"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            disabled={noCharset}
            className="h-11 w-full text-base sm:h-10"
            aria-label="নতুন পাসওয়ার্ড তৈরি করুন"
          >
            <RefreshCw className="h-4 w-4" />
            নতুন পাসওয়ার্ড
          </Button>

          {/* Strength meter */}
          {password && !noCharset && (
            <div aria-label="পাসওয়ার্ডের শক্তি">
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-2 flex-1 rounded-full transition-colors duration-300',
                      i <= level ? LEVELS[level].bar : 'bg-muted'
                    )}
                    aria-hidden="true"
                  />
                ))}
              </div>
              <p className={cn('mt-1.5 text-xs font-medium', LEVELS[level].text)}>
                শক্তি: {LEVELS[level].label} — ভেঙে ফেলতে লাগবে {crackTimeText(entropy)}
              </p>
            </div>
          )}

          {/* No charset selected */}
          {noCharset && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>কোনো অক্ষর নির্বাচিত নয়</AlertTitle>
              <AlertDescription>
                পাসওয়ার্ড তৈরি করতে অন্তত একটি সেট (A-Z, a-z, 0-9 বা প্রতীক) বেছে নিন।
              </AlertDescription>
            </Alert>
          )}

          {/* Length slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">দৈর্ঘ্য</Label>
              <span
                className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm font-semibold"
                aria-label={`বর্তমান দৈর্ঘ্য ${toBn(length)}`}
              >
                {toBn(length)}
              </span>
            </div>
            <Slider
              min={6}
              max={64}
              step={1}
              value={[length]}
              onValueChange={(v) => setLength(v[0] ?? length)}
              aria-label="পাসওয়ার্ডের দৈর্ঘ্য নির্বাচন করুন"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>{toBn(6)}</span>
              <span>{toBn(64)}</span>
            </div>
          </div>

          {/* Charset checkboxes */}
          <fieldset>
            <legend className="sr-only">অক্ষরের সেট</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {CHECK_ITEMS.map((item) => (
                <Label
                  key={item.key}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 py-2 text-sm font-normal has-[button[data-state=checked]]:border-primary/50 has-[button[data-state=checked]]:bg-primary/5"
                >
                  <Checkbox
                    checked={opts[item.key]}
                    onCheckedChange={(c) => setOpts((o) => ({ ...o, [item.key]: c === true }))}
                    aria-label={item.label}
                  />
                  <span className="flex-1 leading-snug">{item.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{item.hint}</span>
                </Label>
              ))}
            </div>
          </fieldset>

          {/* Recent history */}
          {history.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">সাম্প্রতিক ({toBn(history.length)})</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1 text-muted-foreground"
                  onClick={() => setHistory([])}
                  aria-label="সাম্প্রতিক পাসওয়ার্ডের তালিকা মুছুন"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  মুছুন
                </Button>
              </div>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border bg-muted/30 p-2">
                {history.map((pw, i) => (
                  <li key={`${i}-${pw}`} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPassword(pw)}
                      className="min-h-11 flex-1 truncate rounded-lg px-2 text-left font-mono text-sm transition-colors hover:bg-accent"
                      aria-label={`পাসওয়ার্ড নির্বাচন করুন (${toBn(i + 1)} নম্বর)`}
                    >
                      {pw}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0"
                      onClick={() => copy(pw)}
                      aria-label={`পাসওয়ার্ড ${toBn(i + 1)} কপি করুন`}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                যেকোনো পাসওয়ার্ডে ক্লিক করলে সেটি উপরের বক্সে নির্বাচিত হবে।
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
