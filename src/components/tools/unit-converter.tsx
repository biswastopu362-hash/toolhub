'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowLeftRight, Copy } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Unit data — factor = 1 base unit এ রূপান্তরের গুণক                  */
/* ================================================================== */

interface UnitDef {
  id: string
  nameBn: string
  symbol: string
  factor?: number
  toBase?: (v: number) => number
  fromBase?: (v: number) => number
}

interface CategoryDef {
  id: string
  nameBn: string
  units: UnitDef[]
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'length',
    nameBn: 'দৈর্ঘ্য',
    units: [
      { id: 'km', nameBn: 'কিলোমিটার', symbol: 'km', factor: 1000 },
      { id: 'm', nameBn: 'মিটার', symbol: 'm', factor: 1 },
      { id: 'cm', nameBn: 'সেন্টিমিটার', symbol: 'cm', factor: 0.01 },
      { id: 'mm', nameBn: 'মিলিমিটার', symbol: 'mm', factor: 0.001 },
      { id: 'mi', nameBn: 'মাইল', symbol: 'mi', factor: 1609.344 },
      { id: 'yd', nameBn: 'ইয়ার্ড', symbol: 'yd', factor: 0.9144 },
      { id: 'ft', nameBn: 'ফুট', symbol: 'ft', factor: 0.3048 },
      { id: 'in', nameBn: 'ইঞ্চি', symbol: 'in', factor: 0.0254 },
      { id: 'nmi', nameBn: 'নটিক্যাল মাইল', symbol: 'nmi', factor: 1852 },
    ],
  },
  {
    id: 'weight',
    nameBn: 'ওজন',
    units: [
      { id: 't', nameBn: 'মেট্রিক টন', symbol: 't', factor: 1000 },
      { id: 'kg', nameBn: 'কিলোগ্রাম', symbol: 'kg', factor: 1 },
      { id: 'g', nameBn: 'গ্রাম', symbol: 'g', factor: 0.001 },
      { id: 'mg', nameBn: 'মিলিগ্রাম', symbol: 'mg', factor: 1e-6 },
      { id: 'lb', nameBn: 'পাউন্ড', symbol: 'lb', factor: 0.45359237 },
      { id: 'oz', nameBn: 'আউন্স', symbol: 'oz', factor: 0.028349523125 },
      { id: 'mond', nameBn: 'মণ', symbol: 'মণ', factor: 37.3242 },
      { id: 'ser', nameBn: 'সের', symbol: 'সের', factor: 0.933105 },
    ],
  },
  {
    id: 'temp',
    nameBn: 'তাপমাত্রা',
    units: [
      {
        id: 'c',
        nameBn: 'সেলসিয়াস',
        symbol: '°C',
        toBase: (v) => v,
        fromBase: (v) => v,
      },
      {
        id: 'f',
        nameBn: 'ফারেনহাইট',
        symbol: '°F',
        toBase: (v) => ((v - 32) * 5) / 9,
        fromBase: (v) => (v * 9) / 5 + 32,
      },
      {
        id: 'k',
        nameBn: 'কেলভিন',
        symbol: 'K',
        toBase: (v) => v - 273.15,
        fromBase: (v) => v + 273.15,
      },
    ],
  },
  {
    id: 'area',
    nameBn: 'ক্ষেত্রফল',
    units: [
      { id: 'km2', nameBn: 'বর্গ কিলোমিটার', symbol: 'km²', factor: 1e6 },
      { id: 'ha', nameBn: 'হেক্টর', symbol: 'ha', factor: 10000 },
      { id: 'acre', nameBn: 'একর', symbol: 'acre', factor: 4046.8564224 },
      { id: 'bigha', nameBn: 'বিঘা', symbol: 'বিঘা', factor: 1337.8038 },
      { id: 'katha', nameBn: 'কাঠা', symbol: 'কাঠা', factor: 66.89019 },
      { id: 'shotok', nameBn: 'শতক (ডেসিমেল)', symbol: 'শতক', factor: 40.46856 },
      { id: 'm2', nameBn: 'বর্গ মিটার', symbol: 'm²', factor: 1 },
      { id: 'ft2', nameBn: 'বর্গ ফুট', symbol: 'ft²', factor: 0.09290304 },
      { id: 'in2', nameBn: 'বর্গ ইঞ্চি', symbol: 'in²', factor: 0.00064516 },
    ],
  },
  {
    id: 'volume',
    nameBn: 'আয়তন',
    units: [
      { id: 'm3', nameBn: 'ঘন মিটার', symbol: 'm³', factor: 1000 },
      { id: 'l', nameBn: 'লিটার', symbol: 'L', factor: 1 },
      { id: 'ml', nameBn: 'মিলিলিটার', symbol: 'mL', factor: 0.001 },
      { id: 'galus', nameBn: 'গ্যালন (US)', symbol: 'gal', factor: 3.785411784 },
      { id: 'galuk', nameBn: 'গ্যালন (UK)', symbol: 'gal-UK', factor: 4.54609 },
      { id: 'ft3', nameBn: 'ঘন ফুট (সিএফটি)', symbol: 'ft³', factor: 28.316846592 },
      { id: 'cup', nameBn: 'কাপ', symbol: 'cup', factor: 0.2365882365 },
    ],
  },
  {
    id: 'speed',
    nameBn: 'গতি',
    units: [
      { id: 'kmh', nameBn: 'কিমি/ঘণ্টা', symbol: 'km/h', factor: 1 / 3.6 },
      { id: 'ms', nameBn: 'মিটার/সেকেন্ড', symbol: 'm/s', factor: 1 },
      { id: 'mph', nameBn: 'মাইল/ঘণ্টা', symbol: 'mph', factor: 0.44704 },
      { id: 'kn', nameBn: 'নট (সামুদ্রিক)', symbol: 'kn', factor: 0.514444 },
      { id: 'fts', nameBn: 'ফুট/সেকেন্ড', symbol: 'ft/s', factor: 0.3048 },
    ],
  },
  {
    id: 'data',
    nameBn: 'ডেটা',
    units: [
      { id: 'tb', nameBn: 'টেরাবাইট', symbol: 'TB', factor: 1024 ** 4 },
      { id: 'gb', nameBn: 'গিগাবাইট', symbol: 'GB', factor: 1024 ** 3 },
      { id: 'mb', nameBn: 'মেগাবাইট', symbol: 'MB', factor: 1024 ** 2 },
      { id: 'kb', nameBn: 'কিলোবাইট', symbol: 'KB', factor: 1024 },
      { id: 'b', nameBn: 'বাইট', symbol: 'B', factor: 1 },
      { id: 'bit', nameBn: 'বিট', symbol: 'bit', factor: 0.125 },
    ],
  },
  {
    id: 'time',
    nameBn: 'সময়',
    units: [
      { id: 'y', nameBn: 'বছর', symbol: 'yr', factor: 31556952 },
      { id: 'mo', nameBn: 'মাস', symbol: 'mo', factor: 2629746 },
      { id: 'w', nameBn: 'সপ্তাহ', symbol: 'wk', factor: 604800 },
      { id: 'd', nameBn: 'দিন', symbol: 'd', factor: 86400 },
      { id: 'h', nameBn: 'ঘণ্টা', symbol: 'h', factor: 3600 },
      { id: 'min', nameBn: 'মিনিট', symbol: 'min', factor: 60 },
      { id: 's', nameBn: 'সেকেন্ড', symbol: 's', factor: 1 },
      { id: 'ms', nameBn: 'মিলিসেকেন্ড', symbol: 'ms', factor: 0.001 },
    ],
  },
  {
    id: 'pressure',
    nameBn: 'চাপ',
    units: [
      { id: 'mpa', nameBn: 'মেগাপাসকেল', symbol: 'MPa', factor: 1e6 },
      { id: 'kpa', nameBn: 'কিলোপাসকেল', symbol: 'kPa', factor: 1000 },
      { id: 'bar', nameBn: 'বার', symbol: 'bar', factor: 1e5 },
      { id: 'atm', nameBn: 'অ্যাটমোস্ফিয়ার', symbol: 'atm', factor: 101325 },
      { id: 'psi', nameBn: 'PSI', symbol: 'psi', factor: 6894.757 },
      { id: 'mmhg', nameBn: 'মিমি পারদ (mmHg)', symbol: 'mmHg', factor: 133.322 },
      { id: 'pa', nameBn: 'পাসকেল', symbol: 'Pa', factor: 1 },
    ],
  },
  {
    id: 'energy',
    nameBn: 'শক্তি',
    units: [
      { id: 'kwh', nameBn: 'কিলোওয়াট-ঘণ্টা (ইউনিট)', symbol: 'kWh', factor: 3.6e6 },
      { id: 'wh', nameBn: 'ওয়াট-ঘণ্টা', symbol: 'Wh', factor: 3600 },
      { id: 'mj', nameBn: 'মেগাজুল', symbol: 'MJ', factor: 1e6 },
      { id: 'kj', nameBn: 'কিলোজুল', symbol: 'kJ', factor: 1000 },
      { id: 'kcal', nameBn: 'কিলোক্যালরি (ক্যালরি)', symbol: 'kcal', factor: 4184 },
      { id: 'cal', nameBn: 'ক্যালরি', symbol: 'cal', factor: 4.184 },
      { id: 'btu', nameBn: 'BTU', symbol: 'BTU', factor: 1055.05585 },
      { id: 'j', nameBn: 'জুল', symbol: 'J', factor: 1 },
    ],
  },
]

/* ================================================================== */

function fmt(n: number): string {
  if (!isFinite(n)) return '—'
  if (n === 0) return '0'
  if (Math.abs(n) >= 1e12 || Math.abs(n) < 1e-6) return n.toExponential(4)
  const rounded = parseFloat(n.toPrecision(10))
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

export default function UnitConverterTool() {
  const { toast } = useToast()
  const [catId, setCatId] = useState('length')
  const cat = CATEGORIES.find((c) => c.id === catId) ?? CATEGORIES[0]

  const [from, setFrom] = useState(cat.units[0].id)
  const [to, setTo] = useState(cat.units[1]?.id ?? cat.units[0].id)
  const [value, setValue] = useState('1')

  const fromUnit = cat.units.find((u) => u.id === from) ?? cat.units[0]
  const toUnit = cat.units.find((u) => u.id === to) ?? cat.units[1] ?? cat.units[0]

  const changeCategory = (id: string) => {
    const c = CATEGORIES.find((x) => x.id === id)!
    setCatId(id)
    setFrom(c.units[0].id)
    setTo(c.units[1]?.id ?? c.units[0].id)
  }

  const numValue = useMemo(() => {
    const v = parseFloat(value.replace(/,/g, ''))
    return isNaN(v) ? null : v
  }, [value])

  const convert = (val: number | null, f: UnitDef, t: UnitDef): number | null => {
    if (val === null) return null
    let base: number
    if (f.toBase && t.fromBase) base = f.toBase(val)
    else if (f.factor !== undefined && t.factor !== undefined) base = val * f.factor
    else return null
    if (t.fromBase && f.toBase) return t.fromBase(base)
    if (t.factor !== undefined) return base / t.factor
    return null
  }

  const result = convert(numValue, fromUnit, toUnit)

  const swap = () => {
    setFrom(toUnit.id)
    setTo(fromUnit.id)
  }

  const copyResult = async () => {
    if (result === null) return
    await navigator.clipboard.writeText(`${fmt(result)} ${toUnit.symbol}`)
    toast({ title: 'কপি হয়েছে', description: `${fmt(result)} ${toUnit.symbol}` })
  }

  return (
    <div className="space-y-4">
      <Card className="shadow-md">
        <CardContent className="p-4 sm:p-6">
          <Tabs value={catId} onValueChange={changeCategory}>
            <div className="overflow-x-auto pb-1">
              <TabsList className="h-auto w-max gap-1 rounded-xl bg-muted p-1">
                {CATEGORIES.map((c) => (
                  <TabsTrigger key={c.id} value={c.id} className="rounded-lg px-3 py-1.5 text-xs sm:text-sm">
                    {c.nameBn}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>

          {/* Converter form */}
          <div className="mt-5 space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
              {/* From */}
              <div className="space-y-2">
                <Label htmlFor="uc-from">থেকে (From)</Label>
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger id="uc-from" className="h-11 w-full rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cat.units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.nameBn} ({u.symbol})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="সংখ্যা লিখুন"
                  className="h-12 rounded-xl text-lg font-semibold"
                  aria-label="মান ইনপুট"
                />
              </div>

              {/* Swap */}
              <div className="flex justify-center pb-1 sm:pb-8">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={swap}
                  aria-label="উল্টো করুন"
                  className="h-10 w-10 rounded-full border-primary/40 text-primary hover:bg-primary/10"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </Button>
              </div>

              {/* To */}
              <div className="space-y-2">
                <Label htmlFor="uc-to">এতে (To)</Label>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger id="uc-to" className="h-11 w-full rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cat.units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.nameBn} ({u.symbol})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={copyResult}
                  disabled={result === null}
                  className="flex h-12 w-full items-center justify-between gap-2 rounded-xl border bg-primary/5 px-3 text-left transition-colors hover:bg-primary/10 disabled:opacity-50"
                  aria-label="ফলাফল কপি করুন"
                >
                  <span className="truncate text-lg font-bold text-primary">
                    {result === null ? '—' : fmt(result)}
                    <span className="ml-1.5 text-sm font-medium text-muted-foreground">{toUnit.symbol}</span>
                  </span>
                  <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Sentence summary */}
            <p className="rounded-xl bg-muted/50 px-3 py-2 text-center text-sm text-muted-foreground" aria-live="polite">
              {numValue === null ? (
                'রূপান্তর দেখতে একটি সংখ্যা লিখুন'
              ) : (
                <>
                  <b className="text-foreground">{fmt(numValue)}</b> {fromUnit.nameBn} ={' '}
                  <b className="text-foreground">{result === null ? '—' : fmt(result)}</b> {toUnit.nameBn}
                </>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* All units table */}
      <Card>
        <CardContent className="p-4 sm:p-6">
          <h3 className="mb-3 text-sm font-semibold text-muted-foreground">
            {cat.nameBn} — সব ইউনিটে ফলাফল
          </h3>
          <div className="max-h-72 overflow-y-auto rounded-xl border">
            <table className="w-full text-sm">
              <tbody>
                {cat.units.map((u, i) => {
                  const v = convert(numValue, fromUnit, u)
                  return (
                    <tr
                      key={u.id}
                      className={i % 2 === 0 ? 'bg-muted/30' : 'bg-card'}
                    >
                      <td className="px-3 py-2.5 font-medium">{u.nameBn}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{u.symbol}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold" aria-label={`${u.nameBn} এ ফলাফল`}>
                        {v === null ? '—' : fmt(v)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
