'use client'

import { useMemo, useState } from 'react'
import { Copy, Dices, Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { toBn } from '@/lib/bn'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Color conversion math (hand-rolled)                                 */
/* ================================================================== */

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

interface Rgb {
  r: number
  g: number
  b: number
}
interface Hsl {
  h: number
  s: number
  l: number
}
interface Cmyk {
  c: number
  m: number
  y: number
  k: number
}

function normalizeHex(input: string): string | null {
  if (!HEX_RE.test(input.trim())) return null
  return `#${input.trim().replace('#', '').toUpperCase()}`
}

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase()
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
    else if (max === gn) h = ((bn - rn) / d + 2) * 60
    else h = ((rn - gn) / d + 4) * 60
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sn = s / 100
  const ln = l / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = ln - c / 2
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

function rgbToCmyk({ r, g, b }: Rgb): Cmyk {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const k = 1 - Math.max(rn, gn, bn)
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 }
  return {
    c: Math.round(((1 - rn - k) / (1 - k)) * 100),
    m: Math.round(((1 - gn - k) / (1 - k)) * 100),
    y: Math.round(((1 - bn - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  }
}

/** WCAG relative luminance (0..1) */
function relativeLuminance({ r, g, b }: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Mix a hex color toward target (white/black) by amount 0..1 */
function mixHex(hex: string, target: Rgb, amount: number): string {
  const c = hexToRgb(hex)
  const mix = (v: number, t: number) => v + (t - v) * amount
  return rgbToHex({ r: mix(c.r, target.r), g: mix(c.g, target.g), b: mix(c.b, target.b) })
}

/* ================================================================== */
/* UI                                                                  */
/* ================================================================== */

const DEFAULT_HEX = '#10B981'

interface ValueRow {
  label: string
  value: string
}

export default function ColorToolTool() {
  const { toast } = useToast()
  const [hexText, setHexText] = useState(DEFAULT_HEX)
  const [lastValid, setLastValid] = useState(DEFAULT_HEX)

  const parsed = normalizeHex(hexText)
  const hex = parsed ?? lastValid

  const handleText = (v: string) => {
    setHexText(v)
    const n = normalizeHex(v)
    if (n) setLastValid(n)
  }

  const handlePicker = (v: string) => {
    const n = v.toUpperCase()
    setHexText(n)
    setLastValid(n)
  }

  const rgb = useMemo(() => hexToRgb(hex), [hex])
  const hsl = useMemo(() => rgbToHsl(rgb), [rgb])
  const cmyk = useMemo(() => rgbToCmyk(rgb), [rgb])
  const isLight = useMemo(() => relativeLuminance(rgb) > 0.45, [rgb])

  const complementary = useMemo(
    () => rgbToHex(hslToRgb({ h: hsl.h + 180, s: hsl.s, l: hsl.l })),
    [hsl]
  )

  const shades = useMemo(() => {
    const tints: string[] = []
    const darks: string[] = []
    for (let i = 1; i <= 5; i++) {
      tints.push(mixHex(hex, { r: 255, g: 255, b: 255 }, i / 6))
      darks.push(mixHex(hex, { r: 0, g: 0, b: 0 }, i / 6))
    }
    return [...tints, ...darks]
  }, [hex])

  const rows: ValueRow[] = [
    { label: 'HEX', value: hex },
    { label: 'RGB', value: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
    { label: 'HSL', value: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` },
    {
      label: 'CMYK',
      value: `cmyk(${cmyk.c}%, ${cmyk.m}%, ${cmyk.y}%, ${cmyk.k}%)`,
    },
  ]

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast({ title: 'কপি হয়েছে', description: `${label}: ${value}` })
    } catch {
      toast({ title: 'কপি করা যায়নি', description: 'ব্রাউজার ক্লিপবোর্ড অনুমতি দিচ্ছে না', variant: 'destructive' })
    }
  }

  const randomColor = () => {
    const bytes = new Uint8Array(3)
    crypto.getRandomValues(bytes)
    const v = `#${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
    setHexText(v)
    setLastValid(v)
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="h-4 w-4 text-primary" aria-hidden="true" />
            রং নির্বাচন করুন
          </CardTitle>
          <CardDescription className="text-xs">
            পিকার থেকে বাছুন বা HEX কোড লিখুন — RGB, HSL, CMYK সাথে সাথে দেখা যাবে
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0 sm:p-5 sm:pt-0">
          {/* Input row */}
          <div className="flex items-end gap-2">
            <div className="space-y-2">
              <Label htmlFor="color-picker" className="text-sm font-medium">
                পিকার
              </Label>
              <Input
                id="color-picker"
                type="color"
                value={hex}
                onChange={(e) => handlePicker(e.target.value)}
                aria-label="রঙের পিকার"
                className="h-11 w-16 cursor-pointer p-1"
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="color-hex" className="text-sm font-medium">
                HEX কোড
              </Label>
              <Input
                id="color-hex"
                value={hexText}
                onChange={(e) => handleText(e.target.value)}
                placeholder="#10B981"
                aria-label="HEX কোড লিখুন"
                aria-invalid={!parsed}
                className="h-11 font-mono text-base uppercase"
              />
            </div>
            <Button
              variant="outline"
              onClick={randomColor}
              className="h-11 shrink-0 gap-2"
              aria-label="র‍্যান্ডম রং বাছুন"
            >
              <Dices className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">র‍্যান্ডম রং</span>
            </Button>
          </div>
          {!parsed && (
            <p className="text-xs text-destructive">
              সঠিক HEX কোড দিন — ৬ ডিজিট, যেমন <span className="font-mono">10B981</span> বা{' '}
              <span className="font-mono">#10B981</span>
            </p>
          )}

          {/* Preview swatch */}
          <div
            className="flex h-24 items-center justify-between rounded-2xl border px-5"
            style={{ backgroundColor: hex }}
            role="img"
            aria-label={`প্রিভিউ ${hex}`}
          >
            <span
              className="font-mono text-lg font-bold"
              style={{ color: isLight ? '#111827' : '#FFFFFF' }}
            >
              {hex}
            </span>
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                color: isLight ? '#111827' : '#FFFFFF',
                backgroundColor: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.16)',
              }}
            >
              {isLight ? 'হালকা রং' : 'গাঢ় রং'}
            </span>
          </div>

          <Separator />

          {/* Value rows */}
          <div className="space-y-1.5">
            {rows.map((row) => (
              <div
                key={row.label}
                className="flex items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2"
              >
                <span className="w-12 shrink-0 text-xs font-bold text-muted-foreground">
                  {row.label}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{row.value}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => copyValue(row.value, row.label)}
                  aria-label={`${row.label} মান কপি করুন`}
                  className="h-11 w-11 shrink-0 text-muted-foreground"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>

          <Separator />

          {/* Shades palette */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">শেড প্যালেট ({toBn(10)} ধাপ)</Label>
              <span className="text-[11px] text-muted-foreground">ক্লিক করলে কপি হবে</span>
            </div>
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1 sm:grid sm:grid-cols-10 sm:overflow-visible sm:pb-0">
              {shades.map((s, i) => (
                <button
                  key={`${s}-${i}`}
                  type="button"
                  title={s}
                  aria-label={`রং কপি করুন ${s}`}
                  onClick={() => copyValue(s, 'HEX')}
                  className={cn(
                    'h-10 w-10 shrink-0 rounded-lg border border-black/10 transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 active:scale-95 sm:h-12 sm:w-full sm:hover:scale-105'
                  )}
                  style={{ backgroundColor: s }}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              প্রথম ৫টি সাদার সাথে মিশ্রিত (টিন্ট), পরের ৫টি কালোর সাথে (শেড)
            </p>
          </div>

          <Separator />

          {/* Complementary color */}
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <div
              className="h-12 w-12 shrink-0 rounded-xl border"
              style={{ backgroundColor: complementary }}
              role="img"
              aria-label={`পরিপূরক রং ${complementary}`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">পরিপূরক রং (বিপরীত)</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{complementary}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => copyValue(complementary, 'HEX')}
              aria-label="পরিপূরক রঙের HEX কপি করুন"
              className="h-11 w-11 shrink-0 text-muted-foreground"
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
