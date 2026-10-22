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
/* Unit data — factor = multiplier to convert to the 1 base unit       */
/* ================================================================== */

interface UnitDef {
  id: string
  name: string
  symbol: string
  factor?: number
  toBase?: (v: number) => number
  fromBase?: (v: number) => number
}

interface CategoryDef {
  id: string
  name: string
  units: UnitDef[]
}

const CATEGORIES: CategoryDef[] = [
  {
    id: 'length',
    name: 'Length',
    units: [
      { id: 'km', name: 'Kilometer', symbol: 'km', factor: 1000 },
      { id: 'm', name: 'Meter', symbol: 'm', factor: 1 },
      { id: 'cm', name: 'Centimeter', symbol: 'cm', factor: 0.01 },
      { id: 'mm', name: 'Millimeter', symbol: 'mm', factor: 0.001 },
      { id: 'mi', name: 'Mile', symbol: 'mi', factor: 1609.344 },
      { id: 'yd', name: 'Yard', symbol: 'yd', factor: 0.9144 },
      { id: 'ft', name: 'Foot', symbol: 'ft', factor: 0.3048 },
      { id: 'in', name: 'Inch', symbol: 'in', factor: 0.0254 },
      { id: 'nmi', name: 'Nautical mile', symbol: 'nmi', factor: 1852 },
    ],
  },
  {
    id: 'weight',
    name: 'Weight',
    units: [
      { id: 't', name: 'Metric ton', symbol: 't', factor: 1000 },
      { id: 'kg', name: 'Kilogram', symbol: 'kg', factor: 1 },
      { id: 'g', name: 'Gram', symbol: 'g', factor: 0.001 },
      { id: 'mg', name: 'Milligram', symbol: 'mg', factor: 1e-6 },
      { id: 'lb', name: 'Pound', symbol: 'lb', factor: 0.45359237 },
      { id: 'oz', name: 'Ounce', symbol: 'oz', factor: 0.028349523125 },
      { id: 'mond', name: 'Maund', symbol: 'maund', factor: 37.3242 },
      { id: 'ser', name: 'Seer', symbol: 'seer', factor: 0.933105 },
    ],
  },
  {
    id: 'temp',
    name: 'Temperature',
    units: [
      {
        id: 'c',
        name: 'Celsius',
        symbol: '°C',
        toBase: (v) => v,
        fromBase: (v) => v,
      },
      {
        id: 'f',
        name: 'Fahrenheit',
        symbol: '°F',
        toBase: (v) => ((v - 32) * 5) / 9,
        fromBase: (v) => (v * 9) / 5 + 32,
      },
      {
        id: 'k',
        name: 'Kelvin',
        symbol: 'K',
        toBase: (v) => v - 273.15,
        fromBase: (v) => v + 273.15,
      },
    ],
  },
  {
    id: 'area',
    name: 'Area',
    units: [
      { id: 'km2', name: 'Square kilometer', symbol: 'km²', factor: 1e6 },
      { id: 'ha', name: 'Hectare', symbol: 'ha', factor: 10000 },
      { id: 'acre', name: 'Acre', symbol: 'acre', factor: 4046.8564224 },
      { id: 'bigha', name: 'Bigha', symbol: 'bigha', factor: 1337.8038 },
      { id: 'katha', name: 'Katha', symbol: 'katha', factor: 66.89019 },
      { id: 'shotok', name: 'Shotok (Decimal)', symbol: 'decimal', factor: 40.46856 },
      { id: 'm2', name: 'Square meter', symbol: 'm²', factor: 1 },
      { id: 'ft2', name: 'Square foot', symbol: 'ft²', factor: 0.09290304 },
      { id: 'in2', name: 'Square inch', symbol: 'in²', factor: 0.00064516 },
    ],
  },
  {
    id: 'volume',
    name: 'Volume',
    units: [
      { id: 'm3', name: 'Cubic meter', symbol: 'm³', factor: 1000 },
      { id: 'l', name: 'Liter', symbol: 'L', factor: 1 },
      { id: 'ml', name: 'Milliliter', symbol: 'mL', factor: 0.001 },
      { id: 'galus', name: 'Gallon (US)', symbol: 'gal', factor: 3.785411784 },
      { id: 'galuk', name: 'Gallon (UK)', symbol: 'gal-UK', factor: 4.54609 },
      { id: 'ft3', name: 'Cubic foot (CFT)', symbol: 'ft³', factor: 28.316846592 },
      { id: 'cup', name: 'Cup', symbol: 'cup', factor: 0.2365882365 },
    ],
  },
  {
    id: 'speed',
    name: 'Speed',
    units: [
      { id: 'kmh', name: 'Kilometers/hour', symbol: 'km/h', factor: 1 / 3.6 },
      { id: 'ms', name: 'Meters/second', symbol: 'm/s', factor: 1 },
      { id: 'mph', name: 'Miles/hour', symbol: 'mph', factor: 0.44704 },
      { id: 'kn', name: 'Knot (nautical)', symbol: 'kn', factor: 0.514444 },
      { id: 'fts', name: 'Feet/second', symbol: 'ft/s', factor: 0.3048 },
    ],
  },
  {
    id: 'data',
    name: 'Data',
    units: [
      { id: 'tb', name: 'Terabyte', symbol: 'TB', factor: 1024 ** 4 },
      { id: 'gb', name: 'Gigabyte', symbol: 'GB', factor: 1024 ** 3 },
      { id: 'mb', name: 'Megabyte', symbol: 'MB', factor: 1024 ** 2 },
      { id: 'kb', name: 'Kilobyte', symbol: 'KB', factor: 1024 },
      { id: 'b', name: 'Byte', symbol: 'B', factor: 1 },
      { id: 'bit', name: 'Bit', symbol: 'bit', factor: 0.125 },
    ],
  },
  {
    id: 'time',
    name: 'Time',
    units: [
      { id: 'y', name: 'Year', symbol: 'yr', factor: 31556952 },
      { id: 'mo', name: 'Month', symbol: 'mo', factor: 2629746 },
      { id: 'w', name: 'Week', symbol: 'wk', factor: 604800 },
      { id: 'd', name: 'Day', symbol: 'd', factor: 86400 },
      { id: 'h', name: 'Hour', symbol: 'h', factor: 3600 },
      { id: 'min', name: 'Minute', symbol: 'min', factor: 60 },
      { id: 's', name: 'Second', symbol: 's', factor: 1 },
      { id: 'ms', name: 'Millisecond', symbol: 'ms', factor: 0.001 },
    ],
  },
  {
    id: 'pressure',
    name: 'Pressure',
    units: [
      { id: 'mpa', name: 'Megapascal', symbol: 'MPa', factor: 1e6 },
      { id: 'kpa', name: 'Kilopascal', symbol: 'kPa', factor: 1000 },
      { id: 'bar', name: 'Bar', symbol: 'bar', factor: 1e5 },
      { id: 'atm', name: 'Atmosphere', symbol: 'atm', factor: 101325 },
      { id: 'psi', name: 'PSI', symbol: 'psi', factor: 6894.757 },
      { id: 'mmhg', name: 'Millimeters of mercury (mmHg)', symbol: 'mmHg', factor: 133.322 },
      { id: 'pa', name: 'Pascal', symbol: 'Pa', factor: 1 },
    ],
  },
  {
    id: 'energy',
    name: 'Energy',
    units: [
      { id: 'kwh', name: 'Kilowatt-hour (Unit)', symbol: 'kWh', factor: 3.6e6 },
      { id: 'wh', name: 'Watt-hour', symbol: 'Wh', factor: 3600 },
      { id: 'mj', name: 'Megajoule', symbol: 'MJ', factor: 1e6 },
      { id: 'kj', name: 'Kilojoule', symbol: 'kJ', factor: 1000 },
      { id: 'kcal', name: 'Kilocalorie (Calorie)', symbol: 'kcal', factor: 4184 },
      { id: 'cal', name: 'Calorie', symbol: 'cal', factor: 4.184 },
      { id: 'btu', name: 'BTU', symbol: 'BTU', factor: 1055.05585 },
      { id: 'j', name: 'Joule', symbol: 'J', factor: 1 },
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
    toast({ title: 'Copied', description: `${fmt(result)} ${toUnit.symbol}` })
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
                    {c.name}
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
                <Label htmlFor="uc-from">From</Label>
                <Select value={from} onValueChange={setFrom}>
                  <SelectTrigger id="uc-from" className="h-11 w-full rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cat.units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.symbol})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Enter a number"
                  className="h-12 rounded-xl text-lg font-semibold"
                  aria-label="Value input"
                />
              </div>

              {/* Swap */}
              <div className="flex justify-center pb-1 sm:pb-8">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={swap}
                  aria-label="Swap units"
                  className="h-10 w-10 rounded-full border-primary/40 text-primary hover:bg-primary/10"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </Button>
              </div>

              {/* To */}
              <div className="space-y-2">
                <Label htmlFor="uc-to">To</Label>
                <Select value={to} onValueChange={setTo}>
                  <SelectTrigger id="uc-to" className="h-11 w-full rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {cat.units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({u.symbol})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  onClick={copyResult}
                  disabled={result === null}
                  className="flex h-12 w-full items-center justify-between gap-2 rounded-xl border bg-primary/5 px-3 text-left transition-colors hover:bg-primary/10 disabled:opacity-50"
                  aria-label="Copy result"
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
                'Enter a number to see the conversion'
              ) : (
                <>
                  <b className="text-foreground">{fmt(numValue)}</b> {fromUnit.name} ={' '}
                  <b className="text-foreground">{result === null ? '—' : fmt(result)}</b> {toUnit.name}
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
            {cat.name} — result in all units
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
                      <td className="px-3 py-2.5 font-medium">{u.name}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-muted-foreground">{u.symbol}</td>
                      <td className="px-3 py-2.5 text-right font-mono font-semibold" aria-label={`Result in ${u.name}`}>
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
