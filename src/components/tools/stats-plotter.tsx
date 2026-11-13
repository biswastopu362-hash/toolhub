'use client'

/**
 * Stats Plotter — paste a table, get charts and summary statistics.
 *
 * Rows are "label, value1, value2, …" (CSV-ish, commas optional between
 * label and numbers). Line / bar / scatter / pie render as crisp SVG with
 * per-series colors; mean, median, mode, range and standard deviation are
 * computed offline. The dataset persists locally — nothing uploads.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  BarChart3,
  LineChart,
  PieChart,
  ScatterChart,
  Sparkles,
  Table2,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type ChartType = 'line' | 'bar' | 'scatter' | 'pie'

interface Series {
  label: string
  values: number[]
}

const LS_KEY = 'toolhub-stats-plotter'

const SERIES_COLORS = ['#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444']

const SAMPLE = `Mon, 12, 18
Tue, 19, 14
Wed, 15, 22
Thu, 24, 19
Fri, 30, 25
Sat, 26, 31
Sun, 22, 28`

const CHART_TYPES: { id: ChartType; label: string; icon: typeof LineChart }[] = [
  { id: 'line', label: 'Line', icon: LineChart },
  { id: 'bar', label: 'Bar', icon: BarChart3 },
  { id: 'scatter', label: 'Scatter', icon: ScatterChart },
  { id: 'pie', label: 'Pie', icon: PieChart },
]

function parseDataset(raw: string): { series: Series[]; error: string | null } {
  const rows = raw
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
  if (rows.length === 0) return { series: [], error: null }

  const labels: string[] = []
  const cols: number[][] = []
  for (const row of rows) {
    const parts = row
      .split(/[,;\t]+/)
      .map((p) => p.trim())
      .filter(Boolean)
    if (parts.length === 0) continue
    const label = parts[0]
    const nums: number[] = []
    for (const p of parts.slice(1)) {
      const n = Number(p.replace(',', '.'))
      if (!isFinite(n)) {
        return { series: [], error: `Could not read “${p}” in row “${label}”` }
      }
      nums.push(n)
    }
    if (nums.length === 0) {
      return { series: [], error: `Row “${label}” has no numbers` }
    }
    labels.push(label)
    nums.forEach((n, i) => {
      cols[i] = cols[i] ?? []
      cols[i].push(n)
    })
  }
  if (cols.length === 0) return { series: [], error: 'Add at least one number per row' }
  const series = cols.map((values, i) => ({
    label: cols.length === 1 ? 'Values' : `Series ${i + 1}`,
    values,
  }))
  void labels
  return { series, error: null }
}

/* ================================================================== */
/* Statistics                                                          */
/* ================================================================== */

function stats(values: number[]): {
  n: number
  mean: number
  median: number
  mode: string
  min: number
  max: number
  range: number
  stddev: number
  sum: number
} {
  const n = values.length
  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((a, b) => a + b, 0)
  const mean = n > 0 ? sum / n : 0
  const median =
    n === 0 ? 0 : n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
  const freq = new Map<number, number>()
  for (const v of values) freq.set(v, (freq.get(v) ?? 0) + 1)
  let best = 0
  let ties = 0
  for (const c of freq.values()) if (c > best) best = c
  for (const c of freq.values()) if (c === best) ties++
  const mode =
    n === 0 || best <= 1 ? '—' : ties > 1 ? 'multimodal' : String([...freq.entries()].find(([, c]) => c === best)?.[0])
  const min = n > 0 ? sorted[0] : 0
  const max = n > 0 ? sorted[n - 1] : 0
  const variance = n > 0 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / n : 0
  return {
    n,
    mean,
    median,
    mode,
    min,
    max,
    range: max - min,
    stddev: Math.sqrt(variance),
    sum,
  }
}

function fmt(x: number): string {
  if (Number.isInteger(x)) return String(x)
  return String(parseFloat(x.toFixed(4)))
}

/* ================================================================== */
/* Chart renderers (SVG, viewBox 400×250)                              */
/* ================================================================== */

const W = 400
const H = 250
const PAD = { l: 38, r: 12, t: 14, b: 26 }
const IW = W - PAD.l - PAD.r
const IH = H - PAD.t - PAD.b

function scale(values: number[]): { min: number; max: number } {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return { min: min - 1, max: max + 1 }
  const pad = (max - min) * 0.12
  return { min: min - pad, max: max + pad }
}

function Axes({ min, max, labels, showLabels }: { min: number; max: number; labels?: string[]; showLabels?: boolean }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  return (
    <g>
      {ticks.map((t) => {
        const y = PAD.t + IH - t * IH
        const v = min + t * (max - min)
        return (
          <g key={t}>
            <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} className="stroke-muted-foreground/25" strokeWidth={1} />
            <text x={PAD.l - 5} y={y + 3} textAnchor="end" className="fill-muted-foreground" fontSize={8}>
              {fmt(Math.round(v * 100) / 100)}
            </text>
          </g>
        )
      })}
      <line x1={PAD.l} y1={PAD.t + IH} x2={W - PAD.r} y2={PAD.t + IH} className="stroke-muted-foreground/50" strokeWidth={1} />
      {showLabels &&
        labels?.map((l, i) => {
          const step = Math.ceil(labels.length / 8)
          if (i % step !== 0 && i !== labels.length - 1) return null
          const x = PAD.l + (labels.length === 1 ? IW / 2 : (i / (labels.length - 1)) * IW)
          return (
            <text key={`${l}-${i}`} x={x} y={H - 8} textAnchor="middle" className="fill-muted-foreground" fontSize={8}>
              {l.length > 9 ? `${l.slice(0, 8)}…` : l}
            </text>
          )
        })}
    </g>
  )
}

function LineChartSvg({ series, labels }: { series: Series[]; labels: string[] }) {
  const all = series.flatMap((s) => s.values)
  const { min, max } = scale(all)
  const x = (i: number, count: number): number =>
    PAD.l + (count === 1 ? IW / 2 : (i / (count - 1)) * IW)
  const y = (v: number): number => PAD.t + IH - ((v - min) / (max - min)) * IH
  return (
    <>
      <Axes min={min} max={max} labels={labels} showLabels />
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => `${x(i, s.values.length)},${y(v)}`).join(' ')
        return (
          <g key={s.label}>
            <polyline points={pts} fill="none" stroke={SERIES_COLORS[si % SERIES_COLORS.length]} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i, s.values.length)} cy={y(v)} r={3} fill={SERIES_COLORS[si % SERIES_COLORS.length]} />
            ))}
          </g>
        )
      })}
    </>
  )
}

function BarChartSvg({ series, labels }: { series: Series[]; labels: string[] }) {
  const all = series.flatMap((s) => s.values)
  const { min, max } = scale([0, ...all])
  const rows = series[0]?.values.length ?? 0
  const groupW = IW / Math.max(rows, 1)
  const barW = Math.min((groupW * 0.7) / series.length, 26)
  const y = (v: number): number => PAD.t + IH - ((v - min) / (max - min)) * IH
  return (
    <>
      <Axes min={min} max={max} labels={labels} showLabels />
      {series.map((s, si) =>
        s.values.map((v, i) => {
          const cx = PAD.l + i * groupW + groupW / 2
          const off = (si - (series.length - 1) / 2) * barW
          const yy = y(v)
          return (
            <rect
              key={`${s.label}-${i}`}
              x={cx + off - barW / 2}
              y={yy}
              width={barW}
              height={PAD.t + IH - yy}
              rx={2}
              fill={SERIES_COLORS[si % SERIES_COLORS.length]}
              opacity={0.9}
            />
          )
        })
      )}
    </>
  )
}

function ScatterChartSvg({ series, labels }: { series: Series[]; labels: string[] }) {
  /* scatter pairs rows: first numeric column = x, second = y (needs 2+ series) */
  const pairs: { x: number; y: number; si: number }[] = []
  if (series.length >= 2) {
    const xs = series[0].values
    const ys = series[1].values
    const n = Math.min(xs.length, ys.length)
    for (let i = 0; i < n; i++) pairs.push({ x: xs[i], y: ys[i], si: 1 })
  } else {
    const s = series[0]
    s?.values.forEach((v, i) => pairs.push({ x: i, y: v, si: 0 }))
  }
  const xsAll = pairs.map((p) => p.x)
  const ysAll = pairs.map((p) => p.y)
  const sx = scale(xsAll)
  const sy = scale(ysAll)
  const px = (v: number): number => PAD.l + ((v - sx.min) / (sx.max - sx.min)) * IW
  const py = (v: number): number => PAD.t + IH - ((v - sy.min) / (sy.max - sy.min)) * IH
  void labels
  return (
    <>
      <Axes min={sy.min} max={sy.max} />
      {pairs.map((p, i) => (
        <circle key={i} cx={px(p.x)} cy={py(p.y)} r={4} fill={SERIES_COLORS[p.si % SERIES_COLORS.length]} opacity={0.85} />
      ))}
      {series.length >= 2 && (
        <text x={W - PAD.r} y={PAD.t + 2} textAnchor="end" className="fill-muted-foreground" fontSize={8}>
          x = Series 1 · y = Series 2
        </text>
      )}
    </>
  )
}

function PieChartSvg({ series }: { series: Series[]; labels: string[] }) {
  const values = series[0]?.values ?? []
  const total = values.reduce((a, b) => a + b, 0)
  const cx = W / 2 - 40
  const cy = H / 2
  const r = Math.min(IH, W / 2 - 60) / 1
  const slices = values.map((v, i) => {
    const startFrac = total > 0 ? values.slice(0, i).reduce((a, b) => a + b, 0) / total : 0
    const frac = total > 0 ? v / total : 0
    const angle = -Math.PI / 2 + startFrac * Math.PI * 2
    const a2 = angle + frac * Math.PI * 2
    const large = frac > 0.5 ? 1 : 0
    const x1 = cx + r * Math.cos(angle)
    const y1 = cy + r * Math.sin(angle)
    const x2 = cx + r * Math.cos(a2)
    const y2 = cy + r * Math.sin(a2)
    return { d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} z`, color: SERIES_COLORS[i % SERIES_COLORS.length], pct: frac * 100, i }
  })
  return (
    <>
      {slices.map((s) => (
        <path key={s.i} d={s.d} fill={s.color} opacity={0.88} stroke="var(--card)" strokeWidth={1.5} />
      ))}
      {slices.map((s) => (
        <g key={`l-${s.i}`}>
          <rect x={W - 118} y={PAD.t + 4 + s.i * 15} width={9} height={9} rx={2} fill={s.color} />
          <text x={W - 104} y={PAD.t + 11 + s.i * 15} className="fill-foreground" fontSize={9}>
            {`${s.pct.toFixed(0)}%`}
          </text>
        </g>
      ))}
      <text x={W - 118} y={PAD.t - 1} className="fill-muted-foreground" fontSize={8}>
        share of total
      </text>
    </>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function StatsPlotterTool() {
  const [raw, setRaw] = useState<string>(() => {
    if (typeof window === 'undefined') return SAMPLE
    return window.localStorage.getItem(LS_KEY) ?? SAMPLE
  })
  const [type, setType] = useState<ChartType>('line')
  const [editOpen, setEditOpen] = useState(false)

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, raw)
    } catch {
      /* private mode */
    }
  }, [raw])

  const { series, error } = useMemo(() => parseDataset(raw), [raw])
  const labels = useMemo(() => {
    const rows = raw.split('\n').map((r) => r.trim()).filter(Boolean)
    return rows.map((r) => (r.split(/[,;\t]+/)[0] ?? '').trim())
  }, [raw])

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* ---------------- Header ---------------- */}
      <Card className="border-border/70 p-4 shadow-lg shadow-black/5 sm:p-5">
        <div className="flex items-center gap-4">
          <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(249_115_22/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
            <Table2 className="size-7" strokeWidth={1.9} aria-hidden />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight">Stats Plotter</h2>
            <p className="text-xs text-muted-foreground">
              {series.length} series · {series[0]?.values.length ?? 0} rows · charts + summary stats, offline
            </p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setEditOpen((s) => !s)} className="h-10 gap-1.5 rounded-xl">
              <Table2 className="size-4" aria-hidden /> Data
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setRaw(SAMPLE)
                setEditOpen(true)
              }}
              className="h-10 gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25 hover:from-amber-600 hover:to-orange-700"
            >
              <Sparkles className="size-4" aria-hidden /> Sample
            </Button>
          </div>
        </div>
      </Card>

      {/* ---------------- Data editor ---------------- */}
      {editOpen && (
        <Card className="border-border/70 p-4 shadow-lg shadow-black/5">
          <CardContent className="space-y-2 p-0">
            <p className="text-xs font-semibold text-muted-foreground">
              One row per point — <code className="rounded bg-muted px-1 py-0.5">label, value1, value2…</code>
            </p>
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              rows={7}
              aria-label="Dataset"
              className="resize-y rounded-xl font-mono text-xs"
              placeholder={SAMPLE}
            />
            {error ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive" role="alert">
                {error}
              </p>
            ) : (
              <p className="px-1 text-[11px] text-muted-foreground">Parsed OK — the chart updates live.</p>
            )}
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)} className="rounded-xl">
              Done
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ---------------- Chart type ---------------- */}
      <div className="flex rounded-xl border bg-muted/30 p-1" role="tablist" aria-label="Chart type">
        {CHART_TYPES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={type === c.id}
            onClick={() => setType(c.id)}
            className={cn(
              'flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-colors',
              type === c.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <c.icon className="size-4" aria-hidden /> {c.label}
          </button>
        ))}
      </div>

      {/* ---------------- Chart ---------------- */}
      <Card className="overflow-hidden border-border/70 shadow-lg shadow-black/5">
        <CardContent className="p-4 sm:p-5">
          {series.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Table2 className="size-8 text-muted-foreground/50" aria-hidden />
              <p className="text-sm font-semibold">No data yet</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Tap Data and paste rows like <code className="rounded bg-muted px-1">Mon, 12</code> — or load the sample.
              </p>
            </div>
          ) : (
            <>
              <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${type} chart`}>
                {type === 'line' && <LineChartSvg series={series} labels={labels} />}
                {type === 'bar' && <BarChartSvg series={series} labels={labels} />}
                {type === 'scatter' && <ScatterChartSvg series={series} labels={labels} />}
                {type === 'pie' && <PieChartSvg series={series} labels={labels} />}
              </svg>
              {type !== 'pie' && series.length > 1 && (
                <div className="mt-2 flex flex-wrap items-center gap-3 px-1">
                  {series.map((s, i) => (
                    <span key={s.label} className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }} aria-hidden />
                      {s.label}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Summary stats ---------------- */}
      {series.length > 0 && (
        <Card className="border-border/70 p-4 shadow-lg shadow-black/5 sm:p-5">
          <h3 className="mb-3 text-sm font-bold tracking-tight">Summary statistics</h3>
          <div className="space-y-3">
            {series.map((s, si) => {
              const st = stats(s.values)
              const rows: { k: string; v: string }[] = [
                { k: 'Count', v: String(st.n) },
                { k: 'Sum', v: fmt(st.sum) },
                { k: 'Mean', v: fmt(st.mean) },
                { k: 'Median', v: fmt(st.median) },
                { k: 'Mode', v: st.mode },
                { k: 'Min · Max', v: `${fmt(st.min)} · ${fmt(st.max)}` },
                { k: 'Range', v: fmt(st.range) },
                { k: 'Std dev', v: fmt(st.stddev) },
              ]
              return (
                <div key={s.label} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                  <p className="mb-2 flex items-center gap-2 text-xs font-bold">
                    <span className="size-2.5 rounded-full" style={{ backgroundColor: SERIES_COLORS[si % SERIES_COLORS.length] }} aria-hidden />
                    {s.label}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                    {rows.map((r) => (
                      <div key={r.k} className="min-w-0">
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{r.k}</dt>
                        <dd className="truncate font-mono text-sm font-bold">{r.v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
