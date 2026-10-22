'use client'

/**
 * Design Studio — a Canva-style graphics editor that runs entirely on-device.
 *
 * Canvas model: absolutely-positioned elements (text, shapes, stickers, photos)
 * in design coordinates, scaled to fit the viewport. Drag / resize / rotate
 * with pointer events (touch-first), full undo/redo, draft autosave to
 * localStorage and one-tap PNG export rasterized through SVG foreignObject.
 *
 * Photos come from three places: this device's real folders (File System
 * Access API), the shared Gallery library, or a plain file picker — all
 * normalized to data URLs so exports never taint the canvas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Expand,
  FolderOpen,
  Italic,
  LayoutTemplate,
  Loader2,
  Palette,
  Redo2,
  RotateCw,
  Shapes,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { fileToDataUrl, listPhotos, newPhotoId, putPhoto } from '@/lib/media-db'
import { useDeviceThumb } from '@/hooks/use-device-thumb'
import {
  accessState,
  connectRoot,
  ensureFreshIndex,
  fsSupported,
  getRoot,
  getFileFor,
  listEntries,
  requestAccess,
  type DeviceEntry,
} from '@/lib/device-media'

/* ================================================================== */
/* Data                                                               */
/* ================================================================== */

type ShapeKind = 'rect' | 'circle' | 'triangle' | 'star' | 'heart' | 'line'
type ElType = 'text' | 'shape' | 'emoji' | 'image'

interface DesignElement {
  id: string
  type: ElType
  x: number
  y: number
  w: number
  h: number
  rot: number
  opacity: number
  /* text */
  text?: string
  fontSize?: number
  font?: string
  weight?: number
  italic?: boolean
  color?: string
  align?: 'left' | 'center' | 'right'
  /* shape */
  shape?: ShapeKind
  fill?: string
  /* emoji */
  char?: string
  /* image */
  src?: string
}

interface Snap {
  els: DesignElement[]
  bg: string
  w: number
  h: number
}

const DRAFT_KEY = 'toolhub-canva:draft:v1'
const HISTORY_CAP = 25
const ELEMENT_CAP = 80

const uid = () => `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
const cloneSnap = (s: Snap): Snap => JSON.parse(JSON.stringify(s)) as Snap

const FONTS = [
  { name: 'Modern', css: "'Inter', system-ui, sans-serif" },
  { name: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { name: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  { name: 'Impact', css: "Impact, 'Arial Black', sans-serif" },
  { name: 'Courier', css: "'Courier New', monospace" },
  { name: 'Comic', css: "'Comic Sans MS', 'Chalkboard SE', cursive" },
  { name: 'Trebuchet', css: "'Trebuchet MS', sans-serif" },
  { name: 'Palatino', css: "'Palatino Linotype', Palatino, Georgia, serif" },
]

const SHAPE_LIST: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'circle', label: 'Circle' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'star', label: 'Star' },
  { kind: 'heart', label: 'Heart' },
  { kind: 'line', label: 'Line' },
]

const STICKERS = ['✨', '🔥', '💎', '🌸', '🎉', '🎯', '⚡', '🌈', '❤️', '⭐', '🍃', '☀️', '🌙', '🎨', '🎵', '📸', '🚀', '🏆', '💡', '🎈', '🎁', '🛍️', '🌵', '🦋']

const SOLIDS = ['#ffffff', '#0f172a', '#f43f5e', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#06b6d4', '#8b5cf6', '#ec4899', '#a8a29e', '#1e293b']

const GRADIENTS: { name: string; css: string }[] = [
  { name: 'Sunset', css: 'linear-gradient(135deg,#f97316,#ef4444,#db2777)' },
  { name: 'Ocean', css: 'linear-gradient(135deg,#06b6d4,#3b82f6,#8b5cf6)' },
  { name: 'Forest', css: 'linear-gradient(135deg,#34d399,#059669,#065f46)' },
  { name: 'Candy', css: 'linear-gradient(135deg,#f9a8d4,#e879f9,#a78bfa)' },
  { name: 'Grape', css: 'linear-gradient(135deg,#c4b5fd,#8b5cf6,#7c3aed)' },
  { name: 'Gold', css: 'linear-gradient(135deg,#fde68a,#f59e0b,#b45309)' },
  { name: 'Peach', css: 'linear-gradient(135deg,#fecaca,#fda4af,#fdba74)' },
  { name: 'Mint', css: 'linear-gradient(135deg,#a7f3d0,#6ee7b7,#34d399)' },
  { name: 'Midnight', css: 'linear-gradient(160deg,#1e293b,#0f172a)' },
  { name: 'Studio', css: 'linear-gradient(160deg,#f8fafc,#e2e8f0)' },
]

const DEFAULT_BG = 'linear-gradient(160deg,#f8fafc,#e2e8f0)'

const SIZE_PRESETS = [
  { id: 'square', label: 'Square post', w: 1080, h: 1080 },
  { id: 'portrait', label: 'Portrait post', w: 1080, h: 1350 },
  { id: 'story', label: 'Story', w: 1080, h: 1920 },
  { id: 'wide', label: 'Thumbnail', w: 1920, h: 1080 },
]

/* --- Templates: instant, premium starting points --- */
interface Template {
  id: string
  name: string
  bg: string
  w: number
  h: number
  els: Omit<DesignElement, 'id' | 'rot' | 'opacity'>[]
}

const TEMPLATES: Template[] = [
  {
    id: 'quote',
    name: 'Quote',
    bg: GRADIENTS[4].css,
    w: 1080,
    h: 1080,
    els: [
      { type: 'emoji', char: '✨', x: 465, y: 165, w: 150, h: 150, fontSize: 150 },
      { type: 'text', text: 'Design is intelligence made visible.', x: 120, y: 340, w: 840, h: 330, fontSize: 68, font: FONTS[2].css, color: '#ffffff', align: 'center', weight: 500 },
      { type: 'text', text: '— ALINA WHEELER', x: 120, y: 710, w: 840, h: 60, fontSize: 30, font: FONTS[0].css, color: '#e9d5ff', align: 'center', weight: 700 },
    ],
  },
  {
    id: 'sale',
    name: 'Mega Sale',
    bg: GRADIENTS[5].css,
    w: 1080,
    h: 1080,
    els: [
      { type: 'shape', shape: 'star', fill: '#ffffff', x: 55, y: 55, w: 190, h: 190 },
      { type: 'shape', shape: 'star', fill: '#ffffff', x: 830, y: 830, w: 200, h: 200 },
      { type: 'text', text: 'MEGA SALE', x: 90, y: 300, w: 900, h: 190, fontSize: 132, font: FONTS[3].css, color: '#ffffff', align: 'center', weight: 400 },
      { type: 'text', text: 'UP TO 50% OFF', x: 190, y: 540, w: 700, h: 90, fontSize: 52, font: FONTS[0].css, color: '#7c2d12', align: 'center', weight: 800 },
      { type: 'text', text: 'Limited time only', x: 290, y: 660, w: 500, h: 60, fontSize: 30, font: FONTS[0].css, color: '#7c2d12', align: 'center', weight: 500 },
    ],
  },
  {
    id: 'invite',
    name: 'Invite',
    bg: GRADIENTS[3].css,
    w: 1080,
    h: 1350,
    els: [
      { type: 'shape', shape: 'circle', fill: '#ffffff', x: 420, y: 200, w: 240, h: 240 },
      { type: 'emoji', char: '🎉', x: 470, y: 250, w: 140, h: 140, fontSize: 140 },
      { type: 'text', text: "You're invited!", x: 90, y: 520, w: 900, h: 150, fontSize: 84, font: FONTS[2].css, color: '#831843', align: 'center', weight: 600 },
      { type: 'text', text: 'SATURDAY · NOV 24 · 7 PM', x: 140, y: 730, w: 800, h: 80, fontSize: 38, font: FONTS[0].css, color: '#9d174d', align: 'center', weight: 800 },
      { type: 'text', text: 'Rooftop Garden, Dhaka', x: 190, y: 840, w: 700, h: 60, fontSize: 30, font: FONTS[0].css, color: '#9f1239', align: 'center', weight: 500 },
    ],
  },
  {
    id: 'minimal',
    name: 'Minimal',
    bg: '#fafaf9',
    w: 1080,
    h: 1350,
    els: [
      { type: 'text', text: 'LESS IS MORE', x: 90, y: 540, w: 900, h: 140, fontSize: 96, font: FONTS[6].css, color: '#0f172a', align: 'center', weight: 800 },
      { type: 'shape', shape: 'line', fill: '#0f172a', x: 440, y: 730, w: 200, h: 10 },
      { type: 'text', text: 'A poster about clarity', x: 290, y: 790, w: 500, h: 60, fontSize: 28, font: FONTS[0].css, color: '#57534e', align: 'center', weight: 500 },
    ],
  },
  {
    id: 'thumb',
    name: 'Thumbnail',
    bg: GRADIENTS[8].css,
    w: 1920,
    h: 1080,
    els: [
      { type: 'text', text: 'TOP 10 TRICKS!', x: 80, y: 300, w: 1240, h: 260, fontSize: 148, font: FONTS[3].css, color: '#facc15', align: 'left', weight: 400 },
      { type: 'text', text: 'that actually work', x: 90, y: 600, w: 1000, h: 90, fontSize: 54, font: FONTS[0].css, color: '#ffffff', align: 'left', weight: 700 },
      { type: 'emoji', char: '🔥', x: 1420, y: 300, w: 380, h: 380, fontSize: 380 },
    ],
  },
  {
    id: 'story',
    name: 'Story',
    bg: GRADIENTS[1].css,
    w: 1080,
    h: 1920,
    els: [
      { type: 'text', text: 'NEW DROP', x: 90, y: 620, w: 900, h: 180, fontSize: 148, font: FONTS[3].css, color: '#ffffff', align: 'center', weight: 400 },
      { type: 'text', text: "Fresh collection · Summer '25", x: 140, y: 850, w: 800, h: 80, fontSize: 42, font: FONTS[0].css, color: '#e0f2fe', align: 'center', weight: 600 },
      { type: 'shape', shape: 'circle', fill: '#ffffff', x: 390, y: 1060, w: 300, h: 300 },
      { type: 'emoji', char: '🛍️', x: 475, y: 1140, w: 130, h: 130, fontSize: 130 },
    ],
  },
]

function instantiateTemplate(t: Template): DesignElement[] {
  return t.els.map((e) => ({ ...e, id: uid(), rot: 0, opacity: 1 }))
}

/* --- Draft persistence --- */
function loadDraft(): Snap | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return undefined
    const d = JSON.parse(raw) as Snap & { v?: number }
    if (d.v !== 1 || !Array.isArray(d.els)) return undefined
    return { els: d.els, bg: d.bg || DEFAULT_BG, w: d.w || 1080, h: d.h || 1080 }
  } catch {
    return undefined
  }
}

/* ================================================================== */
/* Element rendering (inline styles only — export serializes this DOM) */
/* ================================================================== */

function ShapeSvg({ shape, fill }: { shape: ShapeKind; fill: string }) {
  if (shape === 'triangle')
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <polygon points="50,4 97,96 3,96" fill={fill} />
      </svg>
    )
  if (shape === 'star')
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <polygon points="50,4 61.8,36.5 96.5,36.5 68.4,57.5 79.4,91 50,70.5 20.6,91 31.6,57.5 3.5,36.5 38.2,36.5" fill={fill} />
      </svg>
    )
  if (shape === 'heart')
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
        <path d="M50 90 C22 66 5 47 5 29 C5 13 17 4 30 4 C39 4 46 9 50 17 C54 9 61 4 70 4 C83 4 95 13 95 29 C95 47 78 66 50 90 Z" fill={fill} />
      </svg>
    )
  return <div style={{ width: '100%', height: '100%', background: fill, borderRadius: shape === 'circle' ? '50%' : shape === 'line' ? 999 : 18 }} />
}

function ElementContent({ el }: { el: DesignElement }) {
  if (el.type === 'text')
    return (
      <span
        style={{
          width: '100%',
          fontFamily: el.font ?? FONTS[0].css,
          fontSize: el.fontSize ?? 48,
          fontWeight: el.weight ?? 500,
          fontStyle: el.italic ? 'italic' : 'normal',
          color: el.color ?? '#0f172a',
          textAlign: el.align ?? 'center',
          lineHeight: 1.18,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {el.text}
      </span>
    )
  if (el.type === 'emoji')
    return <span style={{ fontSize: Math.min(el.w, el.h), lineHeight: 1 }}>{el.char}</span>
  if (el.type === 'image')
    return <img src={el.src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 14, display: 'block' }} />
  return <ShapeSvg shape={el.shape ?? 'rect'} fill={el.fill ?? '#f43f5e'} />
}

function ElementBox({
  el,
  onPointerDown,
}: {
  el: DesignElement
  onPointerDown: (e: React.PointerEvent, el: DesignElement) => void
}) {
  return (
    <div
      onPointerDown={(e) => onPointerDown(e, el)}
      style={{
        position: 'absolute',
        left: el.x,
        top: el.y,
        width: el.w,
        height: el.h,
        transform: el.rot ? `rotate(${el.rot}deg)` : undefined,
        opacity: el.opacity,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'move',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      data-el-id={el.id}
    >
      <ElementContent el={el} />
    </div>
  )
}

/* ================================================================== */
/* Device photos picker (real folders via File System Access API)     */
/* ================================================================== */

function DeviceImg({ entry }: { entry: DeviceEntry }) {
  const poster = useDeviceThumb(entry)
  if (poster) return <img src={poster} alt="" className="size-full object-cover" loading="lazy" />
  return <div className="size-full animate-pulse bg-white/5" />
}

function DevicePhotoPicker({ onPick, busy }: { onPick: (dataUrl: string, name: string) => void; busy: (b: boolean) => void }) {
  const { toast } = useToast()
  const [state, setState] = useState<'idle' | 'loading' | 'connect' | 'allow' | 'ready' | 'unsupported'>('idle')
  const [entries, setEntries] = useState<DeviceEntry[]>([])

  const boot = useCallback(async () => {
    if (!fsSupported()) {
      setState('unsupported')
      return
    }
    setState('loading')
    const root = await getRoot()
    if (!root) return setState('connect')
    if ((await accessState(root)) !== 'granted') return setState('allow')
    setState('ready')
    try {
      await ensureFreshIndex()
      setEntries((await listEntries({ dir: false, kinds: ['image'] })).slice(0, 60))
    } catch {
      toast({ title: 'Could not read the device index', variant: 'destructive' })
    }
  }, [toast])

  useEffect(() => {
    if (state === 'idle') void boot()
  }, [state, boot])

  const pick = useCallback(
    async (entry: DeviceEntry) => {
      busy(true)
      try {
        const file = await getFileFor(entry)
        const dataUrl = await fileToDataUrl(file, 1600, 0.85)
        onPick(dataUrl, entry.name)
      } catch {
        toast({ title: 'Could not load that photo', variant: 'destructive' })
      } finally {
        busy(false)
      }
    },
    [busy, onPick, toast]
  )

  if (state === 'unsupported' || state === 'connect')
    return (
      <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[11px] leading-relaxed text-zinc-500">
        {fsSupported()
          ? 'Connect a folder in the Files app to design with photos straight from this device.'
          : 'This browser can’t open device folders — use Gallery photos or upload below.'}
      </p>
    )
  if (state === 'allow')
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void getRoot()
            .then((r) => (r ? requestAccess(r) : false))
            .then((ok) => (ok ? boot() : undefined))
            .catch(() => undefined)
        }}
        className="h-9 rounded-lg bg-white/5 text-xs text-zinc-200 hover:bg-white/10"
      >
        <FolderOpen className="size-3.5" aria-hidden /> Re-allow folder access
      </Button>
    )
  if (state !== 'ready')
    return (
      <div className="flex items-center gap-2 py-3 text-xs text-zinc-500">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading photos…
      </div>
    )
  if (entries.length === 0) return <p className="py-2 text-[11px] text-zinc-500">No photos found in the connected folder.</p>
  return (
    <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
      {entries.map((e) => (
        <button
          key={e.id}
          onClick={() => void pick(e)}
          className="aspect-square overflow-hidden rounded-lg border border-white/10 transition-transform hover:scale-105 active:scale-95"
          title={e.name}
          aria-label={`Add ${e.name} to the design`}
        >
          <DeviceImg entry={e} />
        </button>
      ))}
    </div>
  )
}

/* ================================================================== */
/* Main component                                                     */
/* ================================================================== */

type PanelTab = 'templates' | 'text' | 'elements' | 'photos' | 'background' | 'edit'

export default function CanvaStudioApp() {
  const { toast } = useToast()
  const canvasAreaRef = useRef<HTMLDivElement>(null)
  const elementsRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<
    | null
    | {
        mode: 'move' | 'resize' | 'rotate'
        id: string
        sx: number
        sy: number
        orig: DesignElement
        startSnap: Snap
      }
  >(null)
  const resetTimerRef = useRef(0)

  const initial = useMemo(loadDraft, [])
  const [els, setEls] = useState<DesignElement[]>(initial?.els ?? [])
  const [bg, setBg] = useState(initial?.bg ?? DEFAULT_BG)
  const [size, setSize] = useState({ w: initial?.w ?? 1080, h: initial?.h ?? 1080 })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<PanelTab>('templates')
  const [viewScale, setViewScale] = useState(0.3)
  const [exporting, setExporting] = useState(false)
  const [addingPhoto, setAddingPhoto] = useState(false)
  const [armReset, setArmReset] = useState(false)
  const [galleryPhotos, setGalleryPhotos] = useState<{ id: string; dataUrl: string; name?: string }[]>([])
  const [photosLoaded, setPhotosLoaded] = useState(false)

  const past = useRef<Snap[]>([])
  const future = useRef<Snap[]>([])
  const [, bumpHist] = useState(0)

  const selected = els.find((e) => e.id === selectedId) ?? null

  /* ---------- history ---------- */
  const snapshot = useCallback((): Snap => ({ els: JSON.parse(JSON.stringify(els)) as DesignElement[], bg, w: size.w, h: size.h }), [bg, els, size])
  const pushHistory = useCallback(
    (before: Snap) => {
      past.current.push(before)
      if (past.current.length > HISTORY_CAP) past.current.shift()
      future.current = []
      bumpHist((v) => v + 1)
    },
    []
  )
  const mutate = useCallback((next: DesignElement[] | ((prev: DesignElement[]) => DesignElement[])) => setEls(next), [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(cloneSnap({ els, bg, w: size.w, h: size.h }))
    setEls(prev.els)
    setBg(prev.bg)
    setSize({ w: prev.w, h: prev.h })
    bumpHist((v) => v + 1)
  }, [bg, els, size.h, size.w])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(cloneSnap({ els, bg, w: size.w, h: size.h }))
    setEls(next.els)
    setBg(next.bg)
    setSize({ w: next.w, h: next.h })
    bumpHist((v) => v + 1)
  }, [bg, els, size.h, size.w])

  /* ---------- fit-to-view ---------- */
  useEffect(() => {
    const area = canvasAreaRef.current
    if (!area) return
    const measure = () => {
      const s = Math.min((area.clientWidth - 36) / size.w, (area.clientHeight - 36) / size.h)
      setViewScale(Math.max(0.05, Math.min(1, s)))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(area)
    return () => ro.disconnect()
  }, [size.w, size.h])

  /* ---------- draft autosave ---------- */
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, els, bg, w: size.w, h: size.h, at: Date.now() }))
      } catch {
        /* storage full — draft not saved */
      }
    }, 700)
    return () => window.clearTimeout(t)
  }, [bg, els, size.h, size.w])

  /* ---------- draft restored notice ---------- */
  const greetedRef = useRef(false)
  useEffect(() => {
    if (initial && initial.els.length > 0 && !greetedRef.current) {
      greetedRef.current = true
      toast({ title: 'Draft restored', description: 'Picked up right where you left off.' })
    }
  }, [initial, toast])

  /* ---------- pointer interactions ---------- */
  const beginDrag = useCallback(
    (e: React.PointerEvent, el: DesignElement, mode: 'move' | 'resize' | 'rotate') => {
      e.stopPropagation()
      setSelectedId(el.id)
      dragRef.current = {
        mode,
        id: el.id,
        sx: e.clientX,
        sy: e.clientY,
        orig: { ...el },
        startSnap: { els: JSON.parse(JSON.stringify(els)) as DesignElement[], bg, w: size.w, h: size.h },
      }
    },
    [bg, els, size.h, size.w]
  )

  useEffect(() => {
    if (!selectedId) return
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = (e.clientX - d.sx) / viewScale
      const dy = (e.clientY - d.sy) / viewScale
      if (d.mode === 'move') {
        mutate((prev) =>
          prev.map((x) =>
            x.id === d.id
              ? {
                  ...x,
                  x: Math.round(Math.min(Math.max(d.orig.x + dx, -d.orig.w / 2), size.w - d.orig.w / 2)),
                  y: Math.round(Math.min(Math.max(d.orig.y + dy, -d.orig.h / 2), size.h - d.orig.h / 2)),
                }
              : x
          )
        )
      } else if (d.mode === 'resize') {
        const keepAspect = d.orig.type === 'image' || (d.orig.type === 'shape' && d.orig.shape !== 'line')
        const w = Math.max(40, Math.round(d.orig.w + dx))
        const h = keepAspect ? Math.max(40, Math.round(w * (d.orig.h / d.orig.w))) : Math.max(24, Math.round(d.orig.h + dy))
        mutate((prev) => prev.map((x) => (x.id === d.id ? { ...x, w, h } : x)))
      } else {
        const cx = d.orig.x + d.orig.w / 2
        const cy = d.orig.y + d.orig.h / 2
        let deg = (Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180) / Math.PI
        const snapped = Math.round(deg / 15) * 15
        if (Math.abs(deg - snapped) < 6) deg = snapped
        mutate((prev) => prev.map((x) => (x.id === d.id ? { ...x, rot: Math.round(deg) } : x)))
      }
    }
    const onUp = () => {
      const d = dragRef.current
      dragRef.current = null
      if (d) pushHistory(d.startSnap)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [mutate, pushHistory, selectedId, size.h, size.w, viewScale])

  const removeSelected = useCallback(() => {
    if (!selectedId) return
    pushHistory(snapshot())
    mutate((prev) => prev.filter((x) => x.id !== selectedId))
    setSelectedId(null)
  }, [mutate, pushHistory, selectedId, snapshot])

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        removeSelected()
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [redo, removeSelected, selectedId, undo])
  const addElement = useCallback(
    (el: Omit<DesignElement, 'id' | 'rot' | 'opacity'>) => {
      if (els.length >= ELEMENT_CAP) {
        toast({ title: 'Design is full', description: `Up to ${ELEMENT_CAP} elements per design.`, variant: 'destructive' })
        return
      }
      pushHistory(snapshot())
      const full: DesignElement = { ...el, id: uid(), rot: 0, opacity: 1 }
      // center new elements with a slight cascade
      full.x = Math.round((size.w - full.w) / 2 + (els.length % 5) * 14 - 28)
      full.y = Math.round((size.h - full.h) / 2 + (els.length % 5) * 14 - 28)
      mutate((prev) => [...prev, full])
      setSelectedId(full.id)
      setTab('edit')
    },
    [els.length, mutate, pushHistory, size.h, size.w, snapshot, toast]
  )

  const addText = useCallback(
    (kind: 'heading' | 'sub' | 'body') => {
      const map = {
        heading: { fontSize: 96, weight: 800, h: 150 },
        sub: { fontSize: 56, weight: 700, h: 90 },
        body: { fontSize: 32, weight: 500, h: 60 },
      } as const
      addElement({ type: 'text', text: kind === 'heading' ? 'Your heading' : kind === 'sub' ? 'Subheading' : 'Add a little body text', x: 0, y: 0, w: Math.min(760, size.w - 80), ...map[kind], font: FONTS[0].css, color: '#0f172a', align: 'center' })
    },
    [addElement, size.w]
  )

  const patchSelected = useCallback(
    (patch: Partial<DesignElement>) => {
      if (!selectedId) return
      mutate((prev) => prev.map((x) => (x.id === selectedId ? { ...x, ...patch } : x)))
    },
    [mutate, selectedId]
  )

  const commitPatch = useCallback(
    (patch: Partial<DesignElement>) => {
      if (!selected) return
      pushHistory(snapshot())
      patchSelected(patch)
    },
    [patchSelected, pushHistory, selected, snapshot]
  )

  /* sliders: arm the history snapshot on first change, commit on release */
  const sliderSnapRef = useRef<Snap | null>(null)
  const armSlider = useCallback(() => {
    if (!sliderSnapRef.current) sliderSnapRef.current = snapshot()
  }, [snapshot])
  const commitSlider = useCallback(() => {
    const s = sliderSnapRef.current
    sliderSnapRef.current = null
    if (s) pushHistory(s)
  }, [pushHistory])

  const duplicateSelected = useCallback(() => {
    if (!selected) return
    pushHistory(snapshot())
    const copy: DesignElement = { ...selected, id: uid(), x: Math.min(selected.x + 40, size.w - 40), y: Math.min(selected.y + 40, size.h - 40) }
    mutate((prev) => [...prev, copy])
    setSelectedId(copy.id)
  }, [mutate, pushHistory, selected, size.h, size.w, snapshot])

  const layerShift = useCallback(
    (dir: 1 | -1) => {
      if (!selectedId) return
      const i = els.findIndex((x) => x.id === selectedId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= els.length) return
      pushHistory(snapshot())
      const next = [...els]
      ;[next[i], next[j]] = [next[j], next[i]]
      mutate(next)
    },
    [els, mutate, pushHistory, selectedId, snapshot]
  )

  const applyTemplate = useCallback(
    (t: Template) => {
      pushHistory(snapshot())
      setEls(instantiateTemplate(t))
      setBg(t.bg)
      setSize({ w: t.w, h: t.h })
      setSelectedId(null)
      toast({ title: `${t.name} template added`, description: 'Tap any element to edit it.' })
    },
    [pushHistory, snapshot, toast]
  )

  const changeSize = useCallback(
    (p: (typeof SIZE_PRESETS)[number]) => {
      if (p.w === size.w && p.h === size.h) return
      pushHistory(snapshot())
      setSize({ w: p.w, h: p.h })
      mutate((prev) => prev.map((e) => ({ ...e, x: Math.min(e.x, p.w - 40), y: Math.min(e.y, p.h - 40) })))
    },
    [mutate, pushHistory, size.h, size.w, snapshot]
  )

  const changeBg = useCallback(
    (css: string) => {
      pushHistory(snapshot())
      setBg(css)
    },
    [pushHistory, snapshot]
  )

  const resetAll = useCallback(() => {
    if (!armReset) {
      setArmReset(true)
      window.clearTimeout(resetTimerRef.current)
      resetTimerRef.current = window.setTimeout(() => setArmReset(false), 2600)
      return
    }
    window.clearTimeout(resetTimerRef.current)
    setArmReset(false)
    pushHistory(snapshot())
    setEls([])
    setBg(DEFAULT_BG)
    setSize({ w: 1080, h: 1080 })
    setSelectedId(null)
    try {
      localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* ignore */
    }
    toast({ title: 'Fresh canvas ready' })
  }, [armReset, pushHistory, snapshot, toast])

  const addImage = useCallback(
    (dataUrl: string, name: string) => {
      // read natural size to fit nicely inside the canvas
      const img = new Image()
      img.onload = () => {
        const maxW = size.w * 0.6
        const maxH = size.h * 0.6
        const s = Math.min(maxW / img.width, maxH / img.height)
        addElement({ type: 'image', src: dataUrl, x: 0, y: 0, w: Math.round(img.width * s), h: Math.round(img.height * s) })
        toast({ title: 'Photo added', description: name })
      }
      img.onerror = () => toast({ title: 'Unsupported image', variant: 'destructive' })
      img.src = dataUrl
    },
    [addElement, size.h, size.w, toast]
  )

  const onPickFiles = useCallback(
    async (files: FileList | null) => {
      const list = files ? Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 12) : []
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (list.length === 0) return
      setAddingPhoto(true)
      try {
        for (const f of list) addImage(await fileToDataUrl(f, 1600, 0.85), f.name)
      } catch {
        toast({ title: 'Could not read those images', variant: 'destructive' })
      } finally {
        setAddingPhoto(false)
      }
    },
    [addImage, toast]
  )

  const pickFiles = useCallback(() => fileInputRef.current?.click(), [])

  const loadGallery = useCallback(async () => {
    const all = await listPhotos()
    setGalleryPhotos(all.slice(0, 60).map((p) => ({ id: p.id, dataUrl: p.dataUrl, name: p.name })))
    setPhotosLoaded(true)
  }, [])

  useEffect(() => {
    if (tab === 'photos' && !photosLoaded) void loadGallery()
  }, [loadGallery, photosLoaded, tab])

  /* ---------- export ---------- */
  const exportPng = useCallback(async () => {
    const layer = elementsRef.current
    if (!layer) return
    setExporting(true)
    try {
      const wrapper = document.createElement('div')
      wrapper.setAttribute('style', `width:${size.w}px;height:${size.h}px;position:relative;overflow:hidden;background:${bg};`)
      wrapper.appendChild(layer.cloneNode(true))
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}"><foreignObject x="0" y="0" width="100%" height="100%">${new XMLSerializer().serializeToString(wrapper)}</foreignObject></svg>`
      // blob: URLs taint the canvas in Chromium — the SVG must ride on a data: URL
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('raster failed'))
        img.src = url
      })
      const canvas = document.createElement('canvas')
      canvas.width = size.w
      canvas.height = size.h
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('no canvas')
      ctx.drawImage(img, 0, 0, size.w, size.h)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('png failed')
      // download
      const dl = document.createElement('a')
      dl.href = URL.createObjectURL(blob)
      dl.download = `design-${size.w}x${size.h}-${Date.now().toString(36)}.png`
      dl.click()
      window.setTimeout(() => URL.revokeObjectURL(dl.href), 4000)
      // also drop into the shared Gallery library
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result))
          r.onerror = () => reject(r.error)
          r.readAsDataURL(blob)
        })
        await putPhoto({ id: newPhotoId(), dataUrl, createdAt: Date.now(), fav: false, source: 'design', name: 'Design export' })
        toast({ title: 'PNG exported', description: 'Downloaded — and saved to your Gallery.' })
      } catch {
        toast({ title: 'PNG exported', description: 'Check your downloads.' })
      }
    } catch {
      toast({ title: 'Export failed', description: 'Try removing very large photos and retry.', variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }, [bg, size.h, size.w, toast])

  /* ================================================================== */
  /* Render                                                             */
  /* ================================================================== */

  const sel = selected
  const stageW = Math.round(size.w * viewScale)
  const stageH = Math.round(size.h * viewScale)

  return (
    <div className="mx-auto max-w-5xl select-none">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void onPickFiles(e.target.files)}
      />

      {/* ---------- header ---------- */}
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-purple-950/60 via-zinc-950 to-zinc-950 shadow-[0_24px_60px_-24px_rgb(217_70_239/0.35)]">
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
          <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 text-white ring-1 ring-white/25 shadow-[0_10px_24px_-8px_rgb(217_70_239/0.7)]">
            <Shapes className="size-5" strokeWidth={1.9} aria-hidden />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
          </span>
          <div className="mr-auto min-w-0">
            <h2 className="truncate text-sm font-bold tracking-tight text-zinc-100 sm:text-base">Design Studio</h2>
            <p className="text-[11px] text-zinc-400">Posters · posts · thumbnails — export in one tap</p>
          </div>

          <select
            value={`${size.w}x${size.h}`}
            onChange={(e) => {
              const p = SIZE_PRESETS.find((x) => `${x.w}x${x.h}` === e.target.value)
              if (p) changeSize(p)
            }}
            aria-label="Canvas size"
            className="h-9 rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-semibold text-zinc-200 outline-none"
          >
            {SIZE_PRESETS.map((p) => (
              <option key={p.id} value={`${p.w}x${p.h}`} className="bg-zinc-900">
                {p.label} · {p.w}×{p.h}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={undo} disabled={past.current.length === 0} aria-label="Undo" className="size-9 rounded-full text-zinc-300 hover:bg-white/10">
              <Undo2 className="size-4" aria-hidden />
            </Button>
            <Button size="icon" variant="ghost" onClick={redo} disabled={future.current.length === 0} aria-label="Redo" className="size-9 rounded-full text-zinc-300 hover:bg-white/10">
              <Redo2 className="size-4" aria-hidden />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={resetAll}
              aria-label={armReset ? 'Tap again to clear the canvas' : 'New design'}
              title={armReset ? 'Tap again to confirm' : 'New design'}
              className={cn('size-9 rounded-full', armReset ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30' : 'text-zinc-300 hover:bg-white/10')}
            >
              {armReset ? <Check className="size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
            </Button>
            <Button
              onClick={() => void exportPng()}
              disabled={exporting}
              className="h-9 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 px-3 text-xs font-bold text-white shadow-lg shadow-fuchsia-600/25 hover:from-purple-400 hover:to-fuchsia-400 sm:px-4 sm:text-sm"
            >
              {exporting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
              <span className="hidden sm:inline">Export PNG</span>
            </Button>
          </div>
        </div>

        {/* ---------- canvas ---------- */}
        <div className="px-3 pb-3 sm:px-4">
          <div
            ref={canvasAreaRef}
            onPointerDown={() => setSelectedId(null)}
            className="relative flex h-[46vh] items-center justify-center overflow-hidden rounded-2xl bg-zinc-900/80 sm:h-[54vh]"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)',
              backgroundSize: '18px 18px',
            }}
          >
            <div style={{ width: stageW, height: stageH }} className="relative shadow-[0_18px_50px_-12px_rgb(0_0_0/0.7)]">
              <div
                className="absolute left-0 top-0 origin-top-left overflow-hidden"
                style={{ width: size.w, height: size.h, transform: `scale(${viewScale})`, background: bg }}
              >
                {/* elements layer — serialized verbatim for PNG export */}
                <div ref={elementsRef} className="absolute inset-0">
                  {els.map((el) => (
                    <ElementBox key={el.id} el={el} onPointerDown={(e, target) => beginDrag(e, target, 'move')} />
                  ))}
                </div>

                {/* selection ring + handles (excluded from export: outside elementsRef) */}
                {sel && (
                  <div className="pointer-events-none absolute inset-0">
                    <span
                      aria-hidden
                      className="absolute"
                      style={{
                        left: sel.x,
                        top: sel.y,
                        width: sel.w,
                        height: sel.h,
                        transform: sel.rot ? `rotate(${sel.rot}deg)` : undefined,
                        border: `${2 / viewScale}px solid #d946ef`,
                        borderRadius: 6 / viewScale,
                        boxShadow: `0 0 0 ${1 / viewScale}px rgba(217,70,239,0.35)`,
                      }}
                    />
                    <button
                      aria-label="Rotate element"
                      onPointerDown={(e) => beginDrag(e, sel, 'rotate')}
                      className="pointer-events-auto absolute flex items-center justify-center rounded-full bg-white shadow-md ring-2 ring-fuchsia-500"
                      style={{ width: 26 / viewScale, height: 26 / viewScale, left: sel.x + sel.w / 2 - 13 / viewScale, top: sel.y - 44 / viewScale, touchAction: 'none' }}
                    >
                      <RotateCw className="text-fuchsia-600" style={{ width: 14 / viewScale, height: 14 / viewScale }} aria-hidden />
                    </button>
                    <button
                      aria-label="Resize element"
                      onPointerDown={(e) => beginDrag(e, sel, 'resize')}
                      className="pointer-events-auto absolute flex items-center justify-center rounded-full bg-white shadow-md ring-2 ring-fuchsia-500"
                      style={{ width: 26 / viewScale, height: 26 / viewScale, left: sel.x + sel.w - 13 / viewScale, top: sel.y + sel.h - 13 / viewScale, touchAction: 'none' }}
                    >
                      <Expand className="text-fuchsia-600" style={{ width: 13 / viewScale, height: 13 / viewScale }} aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {els.length === 0 && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-1.5 text-center">
                <Sparkles className="size-5 text-fuchsia-400/80" aria-hidden />
                <p className="text-sm font-semibold text-zinc-300">Start with a template — or add text, stickers & photos</p>
                <p className="text-[11px] text-zinc-500">Everything stays on this device</p>
              </div>
            )}

            {/* floating selection toolbar */}
            {sel && (
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-zinc-950/90 px-1.5 py-1.5 shadow-2xl backdrop-blur-md">
                {sel.type === 'text' && (
                  <>
                    <Button size="icon" variant="ghost" onClick={() => commitPatch({ weight: (sel.weight ?? 500) >= 700 ? 500 : 800 })} aria-label="Toggle bold" className={cn('size-8 rounded-full text-zinc-300 hover:bg-white/10', (sel.weight ?? 500) >= 700 && 'bg-fuchsia-500/20 text-fuchsia-300')}>
                      <Bold className="size-3.5" aria-hidden />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => commitPatch({ italic: !sel.italic })} aria-label="Toggle italic" className={cn('size-8 rounded-full text-zinc-300 hover:bg-white/10', sel.italic && 'bg-fuchsia-500/20 text-fuchsia-300')}>
                      <Italic className="size-3.5" aria-hidden />
                    </Button>
                    <button
                      onClick={() => commitPatch({ align: sel.align === 'left' ? 'center' : sel.align === 'center' ? 'right' : 'left' })}
                      aria-label={`Align ${sel.align ?? 'center'}`}
                      className="flex size-8 items-center justify-center rounded-full text-zinc-300 hover:bg-white/10"
                    >
                      {sel.align === 'left' ? <AlignLeft className="size-3.5" aria-hidden /> : sel.align === 'right' ? <AlignRight className="size-3.5" aria-hidden /> : <AlignCenter className="size-3.5" aria-hidden />}
                    </button>
                    <span className="mx-0.5 h-5 w-px bg-white/10" />
                  </>
                )}
                <Button size="icon" variant="ghost" onClick={duplicateSelected} aria-label="Duplicate" className="size-8 rounded-full text-zinc-300 hover:bg-white/10">
                  <Copy className="size-3.5" aria-hidden />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => layerShift(1)} aria-label="Bring forward" className="size-8 rounded-full text-zinc-300 hover:bg-white/10">
                  <ChevronUp className="size-3.5" aria-hidden />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => layerShift(-1)} aria-label="Send backward" className="size-8 rounded-full text-zinc-300 hover:bg-white/10">
                  <ChevronDown className="size-3.5" aria-hidden />
                </Button>
                <Button size="icon" variant="ghost" onClick={removeSelected} aria-label="Delete element" className="size-8 rounded-full text-rose-400 hover:bg-rose-500/20">
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------- bottom panel ---------- */}
      <div className="mt-3 overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]">
        <div className="flex gap-1 overflow-x-auto px-3 pt-3" role="tablist" aria-label="Design panels">
          {(
            [
              { id: 'templates', label: 'Templates', icon: LayoutTemplate },
              { id: 'text', label: 'Text', icon: Type },
              { id: 'elements', label: 'Elements', icon: Shapes },
              { id: 'photos', label: 'Photos', icon: Upload },
              { id: 'background', label: 'Background', icon: Palette },
              ...(sel ? ([{ id: 'edit', label: 'Edit', icon: Wand2 }] as const) : []),
            ] as { id: PanelTab; label: string; icon: typeof Type }[]
          ).map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-all',
                tab === t.id ? 'bg-fuchsia-600 text-white shadow-md shadow-fuchsia-600/30' : 'bg-white/5 text-zinc-300 hover:bg-white/10'
              )}
            >
              <t.icon className="size-3.5" aria-hidden /> {t.label}
            </button>
          ))}
        </div>

        <div className="max-h-[40vh] overflow-y-auto p-4 pt-3 [scrollbar-width:thin]">
          {/* ----- templates ----- */}
          {tab === 'templates' && (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              {TEMPLATES.map((t) => (
                <button key={t.id} onClick={() => applyTemplate(t)} className="group text-left" aria-label={`Use the ${t.name} template`}>
                  <span className="relative block overflow-hidden rounded-xl border border-white/10 shadow-md transition-all group-hover:border-fuchsia-500/50 group-hover:shadow-fuchsia-600/20" style={{ aspectRatio: `${t.w}/${t.h}` }}>
                    <span className="absolute inset-0" style={{ background: t.bg }} />
                    <span className="absolute inset-x-[12%] top-[16%] space-y-[7%]">
                      <span className="block h-[8%] w-4/5 rounded-full bg-white/60" />
                      <span className="block h-[8%] w-3/5 rounded-full bg-white/35" />
                      <span className="mx-auto block h-[8%] w-2/5 rounded-full bg-white/25" />
                    </span>
                    <span className="absolute inset-x-0 bottom-0 bg-black/45 px-1.5 py-1 text-[10px] font-bold text-white backdrop-blur-sm">{t.name}</span>
                  </span>
                  <span className="mt-1 block text-center text-[11px] font-semibold text-zinc-400 group-hover:text-zinc-200">
                    {t.w}×{t.h}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ----- text ----- */}
          {tab === 'text' && (
            <div>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { k: 'heading', label: 'Add a heading', cls: 'text-xl font-extrabold' },
                    { k: 'sub', label: 'Add a subheading', cls: 'text-base font-bold' },
                    { k: 'body', label: 'Add body text', cls: 'text-xs font-medium' },
                  ] as const
                ).map((b) => (
                  <button key={b.k} onClick={() => addText(b.k)} className="rounded-xl border border-white/10 bg-white/[0.04] px-2 py-4 text-center text-zinc-100 transition-colors hover:border-fuchsia-500/40 hover:bg-white/[0.07]">
                    <span className={cn('block', b.cls)}>{b.label}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">Tap the text on the canvas to move it — style it under the Edit tab.</p>
            </div>
          )}

          {/* ----- elements ----- */}
          {tab === 'elements' && (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Shapes</p>
                <div className="grid grid-cols-6 gap-2">
                  {SHAPE_LIST.map((s) => (
                    <button
                      key={s.kind}
                      onClick={() =>
                        addElement({
                          type: 'shape',
                          shape: s.kind,
                          fill: '#f43f5e',
                          x: 0,
                          y: 0,
                          w: s.kind === 'line' ? 260 : 220,
                          h: s.kind === 'line' ? 12 : 220,
                        })
                      }
                      aria-label={`Add ${s.label}`}
                      className="flex aspect-square items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-200 transition-colors hover:border-fuchsia-500/40 hover:bg-white/[0.07]"
                    >
                      <MiniShape kind={s.kind} />
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Stickers</p>
                <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
                  {STICKERS.map((c) => (
                    <button
                      key={c}
                      onClick={() => addElement({ type: 'emoji', char: c, x: 0, y: 0, w: 160, h: 160, fontSize: 160 })}
                      className="flex aspect-square items-center justify-center rounded-lg bg-white/[0.04] text-2xl transition-transform hover:scale-110 hover:bg-white/10 active:scale-95"
                      aria-label={`Add ${c} sticker`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ----- photos ----- */}
          {tab === 'photos' && (
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">From this device</p>
                  {addingPhoto && <Loader2 className="size-3.5 animate-spin text-zinc-500" aria-hidden />}
                </div>
                <DevicePhotoPicker onPick={(d, n) => addImage(d, n)} busy={setAddingPhoto} />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">From your Gallery</p>
                  <Button size="sm" variant="ghost" onClick={pickFiles} className="h-7 rounded-full bg-white/5 px-2 text-[11px] text-zinc-200 hover:bg-white/10">
                    <Upload className="size-3" aria-hidden /> Upload
                  </Button>
                </div>
                {galleryPhotos.length === 0 ? (
                  <p className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[11px] leading-relaxed text-zinc-500">
                    Nothing in the Gallery yet — photos you take, import or export land here.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                    {galleryPhotos.map((p) => (
                      <button key={p.id} onClick={() => addImage(p.dataUrl, p.name ?? 'Gallery photo')} className="aspect-square overflow-hidden rounded-lg border border-white/10 transition-transform hover:scale-105 active:scale-95" aria-label="Add gallery photo">
                        <img src={p.dataUrl} alt="" className="size-full object-cover" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ----- background ----- */}
          {tab === 'background' && (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Gradients</p>
                <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
                  {GRADIENTS.map((g) => (
                    <button key={g.name} onClick={() => changeBg(g.css)} aria-label={`Background ${g.name}`} className={cn('aspect-square rounded-xl border-2 transition-transform hover:scale-105', bg === g.css ? 'border-fuchsia-500' : 'border-white/10')} style={{ background: g.css }} />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Solid colors</p>
                <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                  {SOLIDS.map((c) => (
                    <button key={c} onClick={() => changeBg(c)} aria-label={`Background ${c}`} className={cn('aspect-square rounded-xl border-2 transition-transform hover:scale-105', bg === c ? 'border-fuchsia-500' : 'border-white/10')} style={{ background: c }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ----- edit selected ----- */}
          {tab === 'edit' && sel && (
            <div className="space-y-4">
              {sel.type === 'text' && (
                <>
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Text</p>
                    <textarea
                      value={sel.text ?? ''}
                      onChange={(e) => patchSelected({ text: e.target.value })}
                      rows={2}
                      className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-fuchsia-500/60"
                      placeholder="Type something…"
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Font</p>
                    <div className="flex flex-wrap gap-1.5">
                      {FONTS.map((f) => (
                        <button
                          key={f.name}
                          onClick={() => commitPatch({ font: f.css })}
                          style={{ fontFamily: f.css }}
                          className={cn('h-9 rounded-full border px-3 text-xs font-semibold transition-all', sel.font === f.css ? 'border-transparent bg-fuchsia-600 text-white shadow' : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10')}
                        >
                          {f.name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Size</p>
                      <Badge variant="outline" className="border-white/15 text-[10px] tabular-nums text-zinc-300">{sel.fontSize ?? 48}px</Badge>
                    </div>
                    <Slider
                      value={[sel.fontSize ?? 48]}
                      min={14}
                      max={220}
                      step={2}
                      onValueChange={(v) => {
                        armSlider()
                        patchSelected({ fontSize: v[0] })
                      }}
                      onValueCommit={() => commitSlider()}
                      aria-label="Font size"
                      className="[&_[data-slot=slider-range]]:bg-fuchsia-500 [&_[data-slot=slider-thumb]]:border-fuchsia-500 [&_[data-slot=slider-track]]:bg-white/15"
                    />
                  </div>
                  <ColorRow label="Color" value={sel.color ?? '#0f172a'} onPick={(c) => commitPatch({ color: c })} />
                </>
              )}

              {sel.type === 'shape' && <ColorRow label="Shape color" value={sel.fill ?? '#f43f5e'} onPick={(c) => commitPatch({ fill: c })} />}

              {sel.type === 'image' && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Opacity</p>
                    <Badge variant="outline" className="border-white/15 text-[10px] tabular-nums text-zinc-300">{Math.round(sel.opacity * 100)}%</Badge>
                  </div>
                  <Slider
                    value={[sel.opacity]}
                    min={0.15}
                    max={1}
                    step={0.05}
                    onValueChange={(v) => {
                      armSlider()
                      patchSelected({ opacity: v[0] ?? 1 })
                    }}
                    onValueCommit={() => commitSlider()}
                    aria-label="Image opacity"
                    className="[&_[data-slot=slider-range]]:bg-fuchsia-500 [&_[data-slot=slider-thumb]]:border-fuchsia-500 [&_[data-slot=slider-track]]:bg-white/15"
                  />
                </div>
              )}

              <p className="text-[11px] leading-relaxed text-zinc-500">
                Drag to move · corner handle to resize · top handle to rotate (snaps to 15°).
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Small shared pieces                                                */
/* ================================================================== */

function ColorRow({ label, value, onPick }: { label: string; value: string; onPick: (c: string) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">{label}</p>
      <div className="flex flex-wrap gap-2">
        {['#ffffff', '#0f172a', '#f43f5e', '#f97316', '#facc15', '#22c55e', '#14b8a6', '#06b6d4', '#8b5cf6', '#ec4899', '#a8a29e', '#7c2d12'].map((c) => (
          <button
            key={c}
            onClick={() => onPick(c)}
            aria-label={`${label} ${c}`}
            className={cn('size-8 rounded-full border-2 transition-transform hover:scale-110', value.toLowerCase() === c ? 'border-fuchsia-500 ring-2 ring-fuchsia-500/40' : 'border-white/20')}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  )
}

function MiniShape({ kind }: { kind: ShapeKind }) {
  const common = { width: 22, height: 22, display: 'block' as const }
  if (kind === 'rect') return <div style={{ ...common, background: '#e4e4e7', borderRadius: 5 }} />
  if (kind === 'circle') return <div style={{ ...common, background: '#e4e4e7', borderRadius: '50%' }} />
  if (kind === 'line') return <div style={{ ...common, height: 4, background: '#e4e4e7', borderRadius: 999 }} />
  if (kind === 'triangle')
    return (
      <svg viewBox="0 0 100 100" style={common}>
        <polygon points="50,4 97,96 3,96" fill="#e4e4e7" />
      </svg>
    )
  if (kind === 'star')
    return (
      <svg viewBox="0 0 100 100" style={common}>
        <polygon points="50,4 61.8,36.5 96.5,36.5 68.4,57.5 79.4,91 50,70.5 20.6,91 31.6,57.5 3.5,36.5 38.2,36.5" fill="#e4e4e7" />
      </svg>
    )
  return (
    <svg viewBox="0 0 100 100" style={common}>
      <path d="M50 90 C22 66 5 47 5 29 C5 13 17 4 30 4 C39 4 46 9 50 17 C54 9 61 4 70 4 C83 4 95 13 95 29 C95 47 78 66 50 90 Z" fill="#e4e4e7" />
    </svg>
  )
}
