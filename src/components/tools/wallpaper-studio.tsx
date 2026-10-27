'use client'

/**
 * Wallpaper Studio (D39) — design your own launcher wallpaper.
 *
 * Composable CSS model rendered live:
 *   background:
 *     [grain url(...) repeat]?                        ← SVG feTurbulence tile
 *     [radial-gradient(ellipse …)]?                   ← vignette
 *     [radial-gradient(circle at x% y%, …)] × 0–6     ← mesh blobs
 *     linear-gradient(angle, 2–3 stops)               ← base
 *
 * Designs are applied through the theme engine (app-store: activeCustomId +
 * wallpaper:'custom') and can be exported as a 1080×1920 PNG rendered with
 * the same math on <canvas>. Everything is on-device; nothing is uploaded.
 */

import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Blend,
  Check,
  Download,
  Eye,
  Layers,
  Palette,
  Pencil,
  Plus,
  Save,
  Shuffle,
  Sparkles,
  Trash2,
  Wallpaper,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useHydrated } from '@/hooks/use-hydrated'
import { useAppStore } from '@/lib/store/app-store'
import type { CustomWallpaper } from '@/lib/theme'

/* ================================================================== */
/* Types & constants                                                   */
/* ================================================================== */

interface MeshBlob {
  color: string
  x: number
  y: number
  size: number
  opacity: number
}

interface Design {
  angle: number
  stops: string[]
  blobs: MeshBlob[]
  grain: boolean
  vignette: boolean
  /** true → light status text / light launcher labels */
  dark: boolean
}

interface PresetDef {
  name: string
  design: Design
}

const GRAIN_URL =
  'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'2\' stitchTiles=\'stitch\'/%3E%3CfeColorMatrix type=\'saturate\' values=\'0\'/%3E%3C/filter%3E%3Crect width=\'160\' height=\'160\' filter=\'url(%23n)\' opacity=\'0.32\'/%3E%3C/svg%3E")'

const MAX_BLOBS = 6
const MIN_STOPS = 2
const MAX_STOPS = 3

const BLOB_SEEDS = ['#ffffff', '#fbbf24', '#f472b6', '#34d399', '#60a5fa', '#c084fc']

/** 8 curated one-tap starting points — hand-tuned, never muddy. */
const PRESETS: PresetDef[] = [
  {
    name: 'Aurora Dusk',
    design: {
      angle: 160,
      stops: ['#1e1b4b', '#4c1d95', '#831843'],
      grain: true,
      vignette: true,
      dark: true,
      blobs: [
        { color: '#2dd4bf', x: 82, y: 18, size: 58, opacity: 0.5 },
        { color: '#a78bfa', x: 16, y: 84, size: 52, opacity: 0.45 },
        { color: '#f472b6', x: 58, y: 72, size: 42, opacity: 0.32 },
      ],
    },
  },
  {
    name: 'Deep Space',
    design: {
      angle: 185,
      stops: ['#020617', '#0f172a', '#1e293b'],
      grain: true,
      vignette: true,
      dark: true,
      blobs: [
        { color: '#3b82f6', x: 72, y: 14, size: 46, opacity: 0.42 },
        { color: '#6366f1', x: 20, y: 82, size: 55, opacity: 0.36 },
        { color: '#22d3ee', x: 86, y: 68, size: 30, opacity: 0.3 },
      ],
    },
  },
  {
    name: 'Mint Cream',
    design: {
      angle: 150,
      stops: ['#ecfdf5', '#d1fae5', '#a7f3d0'],
      grain: false,
      vignette: false,
      dark: false,
      blobs: [
        { color: '#34d399', x: 76, y: 20, size: 44, opacity: 0.35 },
        { color: '#7dd3fc', x: 18, y: 72, size: 50, opacity: 0.3 },
      ],
    },
  },
  {
    name: 'Rose Quartz',
    design: {
      angle: 155,
      stops: ['#fdf2f8', '#fce7f3', '#fbcfe8'],
      grain: false,
      vignette: false,
      dark: false,
      blobs: [
        { color: '#fb7185', x: 80, y: 24, size: 40, opacity: 0.4 },
        { color: '#c4b5fd', x: 14, y: 76, size: 48, opacity: 0.35 },
        { color: '#fcd34d', x: 54, y: 12, size: 30, opacity: 0.25 },
      ],
    },
  },
  {
    name: 'Forest Fog',
    design: {
      angle: 170,
      stops: ['#052e16', '#14532d', '#166534'],
      grain: true,
      vignette: true,
      dark: true,
      blobs: [
        { color: '#10b981', x: 22, y: 16, size: 52, opacity: 0.4 },
        { color: '#84cc16', x: 76, y: 80, size: 46, opacity: 0.3 },
        { color: '#64748b', x: 50, y: 42, size: 40, opacity: 0.18 },
      ],
    },
  },
  {
    name: 'Golden Hour',
    design: {
      angle: 195,
      stops: ['#7c2d12', '#b45309', '#f59e0b'],
      grain: false,
      vignette: true,
      dark: true,
      blobs: [
        { color: '#fde047', x: 70, y: 16, size: 48, opacity: 0.5 },
        { color: '#fb7185', x: 14, y: 76, size: 42, opacity: 0.38 },
      ],
    },
  },
  {
    name: 'Ink Wash',
    design: {
      angle: 205,
      stops: ['#f8fafc', '#e2e8f0', '#cbd5e1'],
      grain: true,
      vignette: false,
      dark: false,
      blobs: [
        { color: '#94a3b8', x: 70, y: 28, size: 52, opacity: 0.4 },
        { color: '#64748b', x: 20, y: 74, size: 44, opacity: 0.3 },
      ],
    },
  },
  {
    name: 'Neon Tide',
    design: {
      angle: 168,
      stops: ['#020617', '#701a75', '#0891b2'],
      grain: true,
      vignette: true,
      dark: true,
      blobs: [
        { color: '#22d3ee', x: 76, y: 86, size: 52, opacity: 0.5 },
        { color: '#e879f9', x: 18, y: 18, size: 46, opacity: 0.45 },
        { color: '#8b5cf6', x: 50, y: 52, size: 34, opacity: 0.35 },
      ],
    },
  },
]

/** Curated hue triads — analogous sets so randomize never goes muddy. */
const HUE_SETS: number[][] = [
  [262, 292, 322],
  [198, 218, 244],
  [168, 186, 208],
  [12, 28, 348],
  [86, 132, 162],
  [42, 22, 355],
  [282, 246, 312],
  [8, 20, 40],
]

/* ================================================================== */
/* Pure helpers (CSS composition, parsing, palette math)               */
/* ================================================================== */

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace('#', '')
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
  const num = Number.parseInt(full, 16)
  if (Number.isNaN(num)) return `rgba(255, 255, 255, ${alpha})`
  const r = (num >> 16) & 255
  const g = (num >> 8) & 255
  const b = num & 255
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`
}

function hslToHex(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + hue / 30) % 12
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** Compose the single `background` value the launcher renders. */
function composeCss(d: Design): string {
  const layers: string[] = []
  if (d.grain) layers.push(`${GRAIN_URL} repeat`)
  if (d.vignette) {
    layers.push('radial-gradient(ellipse at 50% 50%, rgba(0, 0, 0, 0) 55%, rgba(0, 0, 0, 0.42) 100%)')
  }
  for (const b of d.blobs) {
    layers.push(
      `radial-gradient(circle at ${Math.round(b.x)}% ${Math.round(b.y)}%, ` +
        `${hexToRgba(b.color, b.opacity)} 0%, ` +
        `${hexToRgba(b.color, b.opacity * 0.5)} ${Math.round(b.size * 0.45)}%, ` +
        `${hexToRgba(b.color, 0)} ${Math.round(b.size)}%)`
    )
  }
  const stops = d.stops
    .map((s, i) => `${s} ${Math.round((i / (d.stops.length - 1)) * 100)}%`)
    .join(', ')
  layers.push(`linear-gradient(${Math.round(d.angle)}deg, ${stops})`)
  return layers.join(', ')
}

/**
 * Parse back a CSS string produced by composeCss (the studio only ever
 * saves its own output, so the format is deterministic). Splitting is
 * paren-aware: commas inside rgba()/gradients are not layer separators.
 */
function parseCss(css: string): Design | null {
  const layers = css
    .split(/,(?![^(]*\))/)
    .map((l) => l.trim())
    .filter(Boolean)
  if (layers.length === 0) return null
  const design: Design = {
    angle: 160,
    stops: ['#312e81', '#7c3aed'],
    blobs: [],
    grain: false,
    vignette: false,
    dark: true,
  }
  const stops: string[] = []
  for (const layer of layers) {
    if (layer.startsWith('url(')) {
      design.grain = true
      continue
    }
    if (layer.startsWith('radial-gradient(ellipse')) {
      design.vignette = true
      continue
    }
    const head = /^radial-gradient\(circle at (-?\d+(?:\.\d+)?)% (-?\d+(?:\.\d+)?)%/.exec(layer)
    if (head) {
      const rgba = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(layer)
      const size = /(\d+(?:\.\d+)?)%\)$/.exec(layer)
      if (rgba && size) {
        const hex = `#${[rgba[1], rgba[2], rgba[3]]
          .map((v) => Number(v).toString(16).padStart(2, '0'))
          .join('')}`
        design.blobs.push({
          color: hex,
          x: Number(head[1]),
          y: Number(head[2]),
          size: Number(size[1]),
          opacity: Number(rgba[4]),
        })
      }
      continue
    }
    const lin = /^linear-gradient\((-?\d+(?:\.\d+)?)deg/.exec(layer)
    if (lin) {
      design.angle = Number(lin[1])
      for (const m of layer.matchAll(/#([0-9a-fA-F]{6}) \d+%/g)) stops.push(`#${m[1]}`)
    }
  }
  if (stops.length >= MIN_STOPS) design.stops = stops.slice(0, MAX_STOPS)
  return design
}

function cloneDesign(d: Design): Design {
  return { ...d, stops: [...d.stops], blobs: d.blobs.map((b) => ({ ...b })) }
}

/** Render the same composition on a 1080×1920 canvas (PNG export). */
function drawDesign(canvas: HTMLCanvasElement, d: Design): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  const cx = w / 2
  const cy = h / 2

  // base — CSS angle convention: 0deg points up, 90deg points right
  const rad = (d.angle * Math.PI) / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
  const lin = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half)
  d.stops.forEach((s, i) => lin.addColorStop(d.stops.length === 1 ? 0 : i / (d.stops.length - 1), s))
  ctx.fillStyle = lin
  ctx.fillRect(0, 0, w, h)

  // mesh blobs — same falloff as the CSS layers, % stops on the
  // farthest-corner ray (matches radial-gradient's default extent)
  const farthest = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy))
  for (const b of d.blobs) {
    const bx = (b.x / 100) * w
    const by = (b.y / 100) * h
    const r = (b.size / 100) * farthest
    if (r <= 0) continue
    const g = ctx.createRadialGradient(bx, by, 0, bx, by, r)
    g.addColorStop(0, hexToRgba(b.color, b.opacity))
    g.addColorStop(0.45, hexToRgba(b.color, b.opacity * 0.5))
    g.addColorStop(1, hexToRgba(b.color, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // vignette
  if (d.vignette) {
    const g = ctx.createRadialGradient(cx, cy, farthest * 0.55, cx, cy, farthest)
    g.addColorStop(0, 'rgba(0, 0, 0, 0)')
    g.addColorStop(1, 'rgba(0, 0, 0, 0.42)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // grain — random alpha dots stand in for the SVG turbulence tile
  if (d.grain) {
    ctx.globalAlpha = 0.055
    for (let i = 0; i < 30000; i += 1) {
      const v = Math.floor(Math.random() * 256)
      ctx.fillStyle = `rgb(${v}, ${v}, ${v})`
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2)
    }
    ctx.globalAlpha = 1
  }
}

function buzz(): void {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

/* ================================================================== */
/* Small shared UI atoms                                               */
/* ================================================================== */

function CardTitle({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold tracking-tight text-zinc-200">
        <Icon className="size-4 shrink-0 text-fuchsia-400" aria-hidden />
        <span className="truncate">{title}</span>
      </h3>
      {hint && (
        <span className="shrink-0 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
          {hint}
        </span>
      )}
    </div>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex min-h-11 items-center gap-2.5">
      <span className="w-11 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0] ?? value)}
        aria-label={label}
        className="min-w-0 flex-1"
      />
      <span className="w-11 shrink-0 text-right text-[11px] font-semibold tabular-nums text-zinc-300">
        {display}
      </span>
    </div>
  )
}

function ColorField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label
      title={label}
      className="relative block h-11 w-11 shrink-0 cursor-pointer overflow-hidden rounded-xl border border-white/15 shadow-inner"
    >
      <span className="absolute inset-0" style={{ backgroundColor: value }} aria-hidden />
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      />
    </label>
  )
}

function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl px-1 py-1 transition-colors hover:bg-white/5">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-zinc-200">{label}</span>
        <span className="block text-[11px] text-zinc-500">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </label>
  )
}

/* ================================================================== */
/* Phone-frame launcher preview                                        */
/* ================================================================== */

const ICON_GRADIENTS = [
  'from-emerald-400 to-teal-600',
  'from-sky-400 to-blue-600',
  'from-violet-500 to-purple-600',
  'from-rose-400 to-pink-600',
  'from-amber-400 to-orange-600',
  'from-lime-400 to-green-600',
  'from-cyan-400 to-sky-600',
  'from-fuchsia-500 to-purple-700',
  'from-orange-400 to-red-600',
]

const DOCK_GRADIENTS = [
  'from-zinc-200 to-zinc-400',
  'from-emerald-300 to-emerald-500',
  'from-sky-300 to-sky-500',
  'from-rose-300 to-rose-500',
]

function PhoneFrame({ css, dark }: { css: string; dark: boolean }) {
  return (
    <div className="mx-auto w-40 shrink-0 sm:w-44">
      <div className="overflow-hidden rounded-[1.7rem] border-2 border-white/15 bg-black shadow-[0_18px_44px_-16px_rgb(0_0_0/0.8)]">
        <div className="relative aspect-[9/18.5] overflow-hidden" style={{ background: css }}>
          {/* fake status bar */}
          <div
            className={cn(
              'flex items-center justify-between px-3 pt-2 text-[8px] font-bold tracking-tight',
              dark ? 'text-white/90' : 'text-zinc-900/90'
            )}
          >
            <span>9:41</span>
            <span className="flex items-center gap-1" aria-hidden>
              <span className="inline-block h-1 w-1 rounded-[1px] bg-current" />
              <span className="inline-block h-1.5 w-1 rounded-[1px] bg-current" />
              <span className="inline-block h-2 w-3.5 rounded-[2px] border border-current opacity-80">
                <span className="block h-full w-2/3 bg-current" />
              </span>
            </span>
          </div>
          {/* fake icon grid */}
          <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-2.5 px-3">
            {ICON_GRADIENTS.map((g, i) => (
              <div key={g} className="flex flex-col items-center gap-1">
                <span
                  className={cn('block aspect-square w-full rounded-[26%] bg-gradient-to-br shadow-sm ring-1 ring-white/20', g)}
                  aria-hidden
                />
                <span className={cn('block h-1 w-4/5 rounded-full', dark ? 'bg-white/45' : 'bg-zinc-900/35')} aria-hidden />
              </div>
            ))}
          </div>
          {/* fake dock */}
          <div
            className={cn(
              'absolute inset-x-2 bottom-2 flex items-center justify-around rounded-2xl p-2 backdrop-blur-[2px]',
              dark ? 'bg-white/15' : 'bg-white/40'
            )}
          >
            {DOCK_GRADIENTS.map((g) => (
              <span
                key={g}
                className={cn('block h-6 w-6 rounded-[28%] bg-gradient-to-br shadow-sm ring-1 ring-white/30', g)}
                aria-hidden
              />
            ))}
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-center text-[10px] text-zinc-500">Launcher preview</p>
    </div>
  )
}

/* ================================================================== */
/* Wallpaper Studio                                                    */
/* ================================================================== */

export default function WallpaperStudioApp() {
  const { toast } = useToast()
  const hydrated = useHydrated()

  const [design, setDesign] = useState<Design>(() => cloneDesign(PRESETS[0].design))
  const [name, setName] = useState('Aurora Dusk')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [armedId, setArmedId] = useState<string | null>(null)

  const customs = useAppStore((s) => s.customWallpapers)
  const activeCustomId = useAppStore((s) => s.activeCustomId)
  const saveCustomWallpaper = useAppStore((s) => s.saveCustomWallpaper)
  const deleteCustomWallpaper = useAppStore((s) => s.deleteCustomWallpaper)
  const setActiveCustom = useAppStore((s) => s.setActiveCustom)
  const setWallpaper = useAppStore((s) => s.setWallpaper)

  const css = useMemo(() => composeCss(design), [design])

  /* ---------------- designer mutations ---------------- */

  const patchDesign = useCallback((p: Partial<Design>) => setDesign((d) => ({ ...d, ...p })), [])

  const updateStop = useCallback((i: number, color: string) => {
    setDesign((d) => ({ ...d, stops: d.stops.map((s, idx) => (idx === i ? color : s)) }))
  }, [])

  const addStop = useCallback(() => {
    setDesign((d) => (d.stops.length >= MAX_STOPS ? d : { ...d, stops: [...d.stops, '#94a3b8'] }))
  }, [])

  const removeStop = useCallback((i: number) => {
    setDesign((d) => (d.stops.length <= MIN_STOPS ? d : { ...d, stops: d.stops.filter((_, idx) => idx !== i) }))
  }, [])

  const addBlob = useCallback(() => {
    setDesign((d) => {
      if (d.blobs.length >= MAX_BLOBS) return d
      const color = BLOB_SEEDS[d.blobs.length % BLOB_SEEDS.length]
      return { ...d, blobs: [...d.blobs, { color, x: 50, y: 42, size: 55, opacity: 0.4 }] }
    })
  }, [])

  const updateBlob = useCallback((i: number, p: Partial<MeshBlob>) => {
    setDesign((d) => ({ ...d, blobs: d.blobs.map((b, idx) => (idx === i ? { ...b, ...p } : b)) }))
  }, [])

  const removeBlob = useCallback((i: number) => {
    setDesign((d) => ({ ...d, blobs: d.blobs.filter((_, idx) => idx !== i) }))
  }, [])

  const applyPreset = useCallback((p: PresetDef) => {
    setDesign(cloneDesign(p.design))
    setName(p.name)
    setEditingId(null)
    buzz()
  }, [])

  const randomize = useCallback(() => {
    const set = HUE_SETS[Math.floor(Math.random() * HUE_SETS.length)]
    const light = Math.random() < 0.25
    const angle = Math.round(Math.random() * 359)
    const stops = light
      ? [hslToHex(set[0], 60, 92), hslToHex(set[1], 55, 82), hslToHex(set[2], 50, 72)]
      : [hslToHex(set[0], 62, 16), hslToHex(set[1], 58, 30), hslToHex(set[2], 64, 46)]
    const count = 2 + Math.floor(Math.random() * 2)
    const blobs: MeshBlob[] = Array.from({ length: count }, (_, i) => ({
      color: hslToHex(set[i % set.length] + (Math.random() * 24 - 12), light ? 55 : 78, light ? 62 : 58),
      x: Math.round(15 + Math.random() * 70),
      y: Math.round(12 + Math.random() * 76),
      size: Math.round(38 + Math.random() * 32),
      opacity: Number((light ? 0.28 + Math.random() * 0.2 : 0.35 + Math.random() * 0.3).toFixed(2)),
    }))
    setDesign((d) => ({ ...d, angle, stops, blobs, dark: !light }))
    buzz()
  }, [])

  /* ---------------- save / apply / delete / export ---------------- */

  const saveDesign = useCallback(
    (apply: boolean) => {
      const clean = name.trim() || 'Untitled wallpaper'
      const id = editingId ?? `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      saveCustomWallpaper({ id, name: clean, css, dark: design.dark })
      setEditingId(id)
      setName(clean)
      buzz()
      if (apply) {
        setActiveCustom(id)
        setWallpaper('custom')
        toast({ title: 'Wallpaper applied', description: `"${clean}" is now your launcher background.` })
      } else {
        toast({ title: 'Wallpaper saved', description: `"${clean}" saved — tap Apply to use it now.` })
      }
    },
    [css, design.dark, editingId, name, saveCustomWallpaper, setActiveCustom, setWallpaper, toast]
  )

  const applySaved = useCallback(
    (c: CustomWallpaper) => {
      setActiveCustom(c.id)
      setWallpaper('custom')
      buzz()
      toast({ title: 'Wallpaper applied', description: `"${c.name}" is now your launcher background.` })
    },
    [setActiveCustom, setWallpaper, toast]
  )

  const startEdit = useCallback(
    (c: CustomWallpaper) => {
      const parsed = parseCss(c.css)
      if (!parsed) {
        toast({ title: 'Could not load design', description: 'The saved CSS could not be read back.' })
        return
      }
      setDesign({ ...parsed, dark: c.dark })
      setName(c.name)
      setEditingId(c.id)
      buzz()
      toast({ title: 'Loaded into designer', description: `Editing "${c.name}" — saving updates it.` })
    },
    [toast]
  )

  const removeSaved = useCallback(
    (c: CustomWallpaper) => {
      if (armedId !== c.id) {
        setArmedId(c.id)
        window.setTimeout(() => setArmedId((cur) => (cur === c.id ? null : cur)), 2600)
        return
      }
      setArmedId(null)
      if (editingId === c.id) setEditingId(null)
      deleteCustomWallpaper(c.id)
      buzz()
      toast({ title: 'Wallpaper deleted', description: `"${c.name}" was removed.` })
    },
    [armedId, deleteCustomWallpaper, editingId, toast]
  )

  const exportPng = useCallback(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1080
    canvas.height = 1920
    drawDesign(canvas, design)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast({ title: 'Export failed', description: 'The PNG could not be rendered in this browser.' })
          return
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `wallpaper-${Date.now()}.png`
        a.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 4000)
        buzz()
        toast({ title: 'PNG exported', description: '1080×1920 portrait saved to your downloads.' })
      },
      'image/png'
    )
  }, [design, toast])

  /* ---------------- render ---------------- */

  const spring = { type: 'spring' as const, stiffness: 260, damping: 26 }

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-zinc-100">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        className="mx-auto max-w-2xl space-y-4 p-4 pb-10"
      >
        {/* ---------------- Header ---------------- */}
        <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-rose-500 p-5 shadow-[0_18px_44px_-16px_rgb(217_70_239/0.55)]">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent" aria-hidden />
          <div className="relative flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/30">
              <Wallpaper className="size-7" strokeWidth={1.9} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-bold tracking-tight text-white">Wallpaper Studio</h2>
              <p className="truncate text-xs text-white/85">Design your own launcher look</p>
            </div>
            <button
              type="button"
              onClick={randomize}
              aria-label="Randomize palette"
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-white ring-1 ring-white/30 transition-colors hover:bg-white/25"
            >
              <Shuffle className="size-5" aria-hidden />
            </button>
          </div>
        </header>

        {/* ---------------- Live preview ---------------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <CardTitle icon={Eye} title="Live preview" hint={`${design.blobs.length} blob${design.blobs.length === 1 ? '' : 's'}`} />
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="min-w-0 flex-1">
              <div
                className="relative h-48 overflow-hidden rounded-xl border border-white/10 shadow-inner sm:h-56"
                style={{ background: css }}
              >
                <span className="absolute left-2 top-2 rounded-md bg-black/35 px-1.5 py-0.5 text-[10px] font-semibold text-white/90 backdrop-blur-sm">
                  {design.dark ? 'Dark · light status text' : 'Light · dark status text'}
                </span>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                Exports at 1080×1920 portrait · the phone preview shows launcher icons on top.
              </p>
            </div>
            <PhoneFrame css={css} dark={design.dark} />
          </div>
        </section>

        {/* ---------------- Presets ---------------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <CardTitle icon={Palette} title="Preset styles" hint="tap to start" />
          <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            {PRESETS.map((p) => (
              <motion.button
                key={p.name}
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => applyPreset(p)}
                className="group rounded-xl border border-white/10 bg-black/20 p-1.5 text-left transition-colors hover:border-fuchsia-400/40"
              >
                <span className="block h-16 w-full rounded-lg ring-1 ring-white/10" style={{ background: composeCss(p.design) }} aria-hidden />
                <span className="mt-1.5 block truncate px-0.5 pb-0.5 text-[11px] font-semibold text-zinc-300 group-hover:text-white">
                  {p.name}
                </span>
              </motion.button>
            ))}
          </div>
        </section>

        {/* ---------------- Base gradient ---------------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <CardTitle icon={Blend} title="Base gradient" hint={`${design.stops.length} stops`} />
          <div className="mt-2">
            <SliderRow
              label="Angle"
              min={0}
              max={359}
              step={1}
              value={design.angle}
              display={`${design.angle}°`}
              onChange={(v) => patchDesign({ angle: v })}
            />
          </div>
          <div className="mt-2 space-y-2">
            {design.stops.map((c, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <ColorField value={c} onChange={(v) => updateStop(i, v)} label={`Stop ${i + 1} color`} />
                <span className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                  Stop {i + 1}
                </span>
                <span className="min-w-0 flex-1 font-mono text-[11px] uppercase text-zinc-500">{c}</span>
                {design.stops.length > MIN_STOPS && (
                  <button
                    type="button"
                    onClick={() => removeStop(i)}
                    aria-label={`Remove stop ${i + 1}`}
                    className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            ))}
          </div>
          {design.stops.length < MAX_STOPS && (
            <Button type="button" variant="ghost" size="sm" onClick={addStop} className="mt-2 h-10 text-zinc-300 hover:bg-white/10 hover:text-white">
              <Plus className="size-4" aria-hidden /> Add stop
            </Button>
          )}
        </section>

        {/* ---------------- Mesh blobs ---------------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <CardTitle icon={Layers} title="Mesh blobs" hint={`${design.blobs.length}/${MAX_BLOBS}`} />
          {design.blobs.length === 0 && (
            <p className="mt-2 text-xs text-zinc-500">No blobs — a pure gradient. Add one for a soft mesh look.</p>
          )}
          <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
            <AnimatePresence initial={false}>
              {design.blobs.map((b, i) => (
                <motion.div
                  key={`${i}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={spring}
                  className="rounded-xl border border-white/10 bg-black/20 p-3"
                >
                  <div className="flex items-center gap-2.5">
                    <ColorField value={b.color} onChange={(v) => updateBlob(i, { color: v })} label={`Blob ${i + 1} color`} />
                    <span className="text-xs font-semibold text-zinc-300">Blob {i + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeBlob(i)}
                      aria-label={`Remove blob ${i + 1}`}
                      className="ml-auto flex size-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                  <div className="mt-1 grid gap-x-5 sm:grid-cols-2">
                    <SliderRow
                      label="X"
                      min={0}
                      max={100}
                      step={1}
                      value={b.x}
                      display={`${b.x}%`}
                      onChange={(v) => updateBlob(i, { x: v })}
                    />
                    <SliderRow
                      label="Y"
                      min={0}
                      max={100}
                      step={1}
                      value={b.y}
                      display={`${b.y}%`}
                      onChange={(v) => updateBlob(i, { y: v })}
                    />
                    <SliderRow
                      label="Size"
                      min={5}
                      max={100}
                      step={1}
                      value={b.size}
                      display={`${b.size}%`}
                      onChange={(v) => updateBlob(i, { size: v })}
                    />
                    <SliderRow
                      label="Alpha"
                      min={0}
                      max={1}
                      step={0.05}
                      value={b.opacity}
                      display={`${Math.round(b.opacity * 100)}%`}
                      onChange={(v) => updateBlob(i, { opacity: v })}
                    />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addBlob}
            disabled={design.blobs.length >= MAX_BLOBS}
            className="mt-3 h-10 text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            <Plus className="size-4" aria-hidden /> Add blob
          </Button>
        </section>

        {/* ---------------- Finish ---------------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <CardTitle icon={Sparkles} title="Finish" />
          <div className="mt-2 space-y-1">
            <ToggleRow
              label="Film grain"
              description="Subtle SVG noise texture"
              checked={design.grain}
              onCheckedChange={(v) => patchDesign({ grain: v })}
            />
            <ToggleRow
              label="Vignette"
              description="Darkened edges for depth"
              checked={design.vignette}
              onCheckedChange={(v) => patchDesign({ vignette: v })}
            />
            <ToggleRow
              label="Dark background"
              description="Switch off for light wallpapers — status text goes dark"
              checked={design.dark}
              onCheckedChange={(v) => patchDesign({ dark: v })}
            />
          </div>
        </section>

        {/* ---------------- Save & export ---------------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="wp-name" className="text-sm font-bold text-zinc-200">
              Name
            </Label>
            {editingId && (
              <button
                type="button"
                onClick={() => setEditingId(null)}
                className="flex h-7 min-w-0 items-center gap-1 rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 px-2.5 text-[10px] font-semibold text-fuchsia-300 transition-colors hover:bg-fuchsia-500/20"
              >
                <span className="truncate">Editing saved — tap to save as copy</span>
                <X className="size-3 shrink-0" aria-hidden />
              </button>
            )}
          </div>
          <Input
            id="wp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Aurora Dusk"
            maxLength={40}
            className="mt-2 h-11 border-white/10 bg-black/30 text-sm font-semibold placeholder:text-zinc-600"
          />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Button type="button" variant="secondary" onClick={() => saveDesign(false)} className="h-11 font-semibold">
              <Save className="size-4" aria-hidden /> Save
            </Button>
            <Button
              type="button"
              onClick={() => saveDesign(true)}
              className="h-11 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500 font-semibold text-white shadow-lg hover:opacity-90"
            >
              <Check className="size-4" aria-hidden /> Apply
            </Button>
            <Button type="button" variant="outline" onClick={exportPng} className="col-span-2 h-11 font-semibold sm:col-span-1">
              <Download className="size-4" aria-hidden /> Export PNG
            </Button>
          </div>
          <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-500">
            Apply sets it as the launcher wallpaper (switch back to presets in Settings). Export saves a
            1080×1920 PNG to your device.
          </p>
        </section>

        {/* ---------------- Saved wallpapers ---------------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <CardTitle icon={Wallpaper} title="Saved wallpapers" hint={`${hydrated ? customs.length : 0}`} />
          {!hydrated ? (
            <div className="mt-3 space-y-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-white/[0.05]" />
              ))}
            </div>
          ) : customs.length === 0 ? (
            <p className="mt-3 text-xs text-zinc-500">
              Nothing saved yet — design one above and hit Save, then Apply from here any time.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              <AnimatePresence initial={false}>
                {customs.map((c) => {
                  const active = activeCustomId === c.id
                  const armed = armedId === c.id
                  return (
                    <motion.div
                      key={c.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96 }}
                      transition={spring}
                      className={cn(
                        'flex items-center gap-3 rounded-xl border p-2.5',
                        active ? 'border-fuchsia-400/40 bg-fuchsia-500/10' : 'border-white/10 bg-black/20'
                      )}
                    >
                      <span
                        className="h-14 w-9 shrink-0 rounded-lg border border-white/10 shadow-inner"
                        style={{ background: c.css }}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="truncate text-sm font-semibold text-zinc-100">{c.name}</p>
                          {active && (
                            <span className="shrink-0 rounded-full bg-fuchsia-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-fuchsia-300">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                          <span
                            className={cn(
                              'rounded-full border px-1.5 py-0.5 font-semibold',
                              c.dark
                                ? 'border-white/15 bg-black/40 text-zinc-300'
                                : 'border-amber-300/30 bg-amber-300/10 text-amber-200'
                            )}
                          >
                            {c.dark ? 'Dark' : 'Light'}
                          </span>
                          <span className="text-zinc-500">
                            {new Date(c.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => applySaved(c)}
                          aria-label={`Apply ${c.name}`}
                          title="Apply to launcher"
                          className="flex size-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-emerald-500/20 hover:text-emerald-300"
                        >
                          <Check className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          aria-label={`Edit ${c.name}`}
                          title="Edit in designer"
                          className="flex size-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <Pencil className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSaved(c)}
                          aria-label={armed ? `Confirm delete ${c.name}` : `Delete ${c.name}`}
                          title={armed ? 'Tap again to delete' : 'Delete'}
                          className={cn(
                            'flex size-10 items-center justify-center rounded-lg border transition-colors',
                            armed
                              ? 'border-rose-400/50 bg-rose-500/25 text-rose-200'
                              : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-300'
                          )}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )}
        </section>
      </motion.div>
    </div>
  )
}
