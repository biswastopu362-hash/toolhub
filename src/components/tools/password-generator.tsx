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
  { label: 'Weak', bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  { label: 'Fair', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  { label: 'Good', bar: 'bg-lime-500', text: 'text-lime-600 dark:text-lime-400' },
  { label: 'Excellent', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
] as const

function strengthLevel(entropy: number): 0 | 1 | 2 | 3 {
  if (entropy < 40) return 0
  if (entropy < 60) return 1
  if (entropy < 90) return 2
  return 3
}

/** Rough offline-attack estimate (~10^10 guesses/sec) */
function crackTimeText(entropy: number): string {
  if (!isFinite(entropy) || entropy <= 0) return '—'
  const seconds = Math.pow(2, entropy) / 2 / 1e10
  if (seconds < 1) return 'instantly'
  if (seconds < 60) {
    const n = Math.max(1, Math.round(seconds))
    return `about ${n} second${n === 1 ? '' : 's'}`
  }
  const minutes = seconds / 60
  if (minutes < 60) {
    const n = Math.round(minutes)
    return `about ${n} minute${n === 1 ? '' : 's'}`
  }
  const hours = minutes / 60
  if (hours < 24) {
    const n = Math.round(hours)
    return `about ${n} hour${n === 1 ? '' : 's'}`
  }
  const days = hours / 24
  if (days < 365) {
    const n = Math.round(days)
    return `about ${n} day${n === 1 ? '' : 's'}`
  }
  const years = days / 365.25
  if (years < 100) {
    const n = Math.round(years)
    return `about ${n} year${n === 1 ? '' : 's'}`
  }
  if (years < 10_000) return 'hundreds of years'
  if (years < 1_000_000) return 'thousands of years'
  if (years < 1e9) return 'millions of years'
  return 'billions of years'
}

/* ================================================================== */
/* UI                                                                  */
/* ================================================================== */

const CHECK_ITEMS: { key: keyof PwOptions; label: string; hint: string }[] = [
  { key: 'upper', label: 'Uppercase letters', hint: 'A-Z' },
  { key: 'lower', label: 'Lowercase letters', hint: 'a-z' },
  { key: 'digits', label: 'Digits', hint: '0-9' },
  { key: 'symbols', label: 'Symbols', hint: '!@#$…' },
  { key: 'noConfusable', label: 'Exclude confusing characters', hint: 'i l 1 L O 0 o' },
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
        toast({ title: 'Copied ✓', description: 'Saved to your clipboard' })
      } catch {
        toast({
          title: 'Copy failed',
          description: 'Select the text and copy it manually',
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
              Length: {length}
            </Badge>
            {password && !noCharset && (
              <span className="text-xs text-muted-foreground">
                Entropy: {Math.round(entropy)} bits
              </span>
            )}
          </div>

          {/* Password display */}
          <div className="flex items-center gap-2 rounded-2xl border bg-muted/40 p-3">
            <p
              className="min-h-[2rem] flex-1 break-all font-mono text-lg font-semibold sm:text-xl"
              aria-live="polite"
              aria-label="Generated password"
            >
              {password || <span className="font-normal opacity-40">…</span>}
            </p>
            <Button
              variant="outline"
              size="icon"
              className="size-11 shrink-0"
              onClick={() => copy(password)}
              disabled={!password}
              aria-label="Copy password"
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>

          {/* Generate button */}
          <Button
            onClick={handleGenerate}
            disabled={noCharset}
            className="h-11 w-full text-base sm:h-10"
            aria-label="Generate a new password"
          >
            <RefreshCw className="h-4 w-4" />
            New Password
          </Button>

          {/* Strength meter */}
          {password && !noCharset && (
            <div aria-label="Password strength">
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
                Strength: {LEVELS[level].label} — takes {crackTimeText(entropy)} to crack
              </p>
            </div>
          )}

          {/* No charset selected */}
          {noCharset && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>No character set selected</AlertTitle>
              <AlertDescription>
                Pick at least one set (A-Z, a-z, 0-9, or symbols) to generate a password.
              </AlertDescription>
            </Alert>
          )}

          {/* Length slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Length</Label>
              <span
                className="rounded-md bg-muted px-2 py-0.5 font-mono text-sm font-semibold"
                aria-label={`Current length ${length}`}
              >
                {length}
              </span>
            </div>
            <Slider
              min={6}
              max={64}
              step={1}
              value={[length]}
              onValueChange={(v) => setLength(v[0] ?? length)}
              aria-label="Select password length"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span>6</span>
              <span>64</span>
            </div>
          </div>

          {/* Charset checkboxes */}
          <fieldset>
            <legend className="sr-only">Character sets</legend>
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
                <p className="text-sm font-medium">Recent ({history.length})</p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1 text-muted-foreground"
                  onClick={() => setHistory([])}
                  aria-label="Clear recent passwords"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear
                </Button>
              </div>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border bg-muted/30 p-2">
                {history.map((pw, i) => (
                  <li key={`${i}-${pw}`} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPassword(pw)}
                      className="min-h-11 flex-1 truncate rounded-lg px-2 text-left font-mono text-sm transition-colors hover:bg-accent"
                      aria-label={`Select password ${i + 1}`}
                    >
                      {pw}
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-11 shrink-0"
                      onClick={() => copy(pw)}
                      aria-label={`Copy password ${i + 1}`}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Click any password to select it in the box above.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
