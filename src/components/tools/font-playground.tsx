'use client'

/**
 * Font Playground — find your voice, style your words.
 *
 * Two tabs:
 *  1. Type Tester — 14 curated *system* font stacks previewed live against
 *     shared controls (size / weight / line-height / tracking / align /
 *     italic / colors). No webfonts are ever loaded: instant + offline.
 *  2. Quote Cards — text-on-image composer with gradient / solid / photo
 *     backgrounds, a WYSIWYG div preview that exactly mirrors a 1080-wide
 *     logical design space, and canvas export at 2× (PNG download, Web
 *     Share, save to IndexedDB).
 *
 * Everything runs on-device. Zero uploads. Zero new dependencies.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  CaseSensitive,
  ChevronDown,
  Download,
  Image as ImageIcon,
  Italic,
  Languages,
  Palette,
  Pencil,
  Quote,
  Save,
  Share2,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type TabKey = 'tester' | 'cards'
type TextAlign = 'left' | 'center' | 'right'

interface FontStack {
  id: string
  name: string
  note: string
  /** full CSS font-family stack (display) */
  stack: string
  /** parse-safe family list for canvas ctx.font (first entries) */
  canvas: string
}

interface GradPreset {
  id: string
  name: string
  stops: string[]
}

interface SavedCard {
  id: string
  /** PNG data URL — only persisted when ≤ MAX_SAVE_BYTES */
  imageDataUrl: string
  quote: string
  author: string
  stackId: string
  createdAt: number
}

interface QuoteLayout {
  W: number
  H: number
  qSize: number
  lines: string[]
  lineH: number
  markH: number
  markBaseline: number
  totalH: number
  centerY: number
  bandTop: number
  bandH: number
  aSize: number
  hasQuote: boolean
  hasAuthor: boolean
}

/* ================================================================== */
/* Data — curated system stacks (no webfonts, instant + offline)       */
/* ================================================================== */

const FONT_STACKS: FontStack[] = [
  {
    id: 'system',
    name: 'System UI',
    note: 'Native app feel',
    stack: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    canvas: "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  },
  {
    id: 'geometric',
    name: 'Geometric',
    note: 'Futura / Century Gothic vibe',
    stack: "'Avenir Next', Avenir, 'Century Gothic', Futura, 'Trebuchet MS', sans-serif",
    canvas: "'Avenir Next', 'Century Gothic', 'Trebuchet MS', sans-serif",
  },
  {
    id: 'humanist',
    name: 'Humanist',
    note: 'Gill Sans warmth',
    stack: "Seravek, 'Gill Sans Nova', Calibri, 'DejaVu Sans', 'Gill Sans', sans-serif",
    canvas: "Seravek, 'Gill Sans', Calibri, sans-serif",
  },
  {
    id: 'rounded',
    name: 'Rounded',
    note: 'Soft, friendly terminals',
    stack: "ui-rounded, 'Hiragino Maru Gothic ProN', 'Arial Rounded MT Bold', Quicksand, sans-serif",
    canvas: "'Hiragino Maru Gothic ProN', 'Arial Rounded MT Bold', sans-serif",
  },
  {
    id: 'serif',
    name: 'Serif',
    note: 'Georgia classic',
    stack: "Georgia, 'Times New Roman', Times, serif",
    canvas: "Georgia, 'Times New Roman', serif",
  },
  {
    id: 'editorial',
    name: 'Editorial',
    note: 'High-contrast Didone',
    stack: "'Playfair Display', Didot, 'Bodoni MT', 'Times New Roman', serif",
    canvas: "'Playfair Display', Didot, 'Bodoni MT', Georgia, serif",
  },
  {
    id: 'mono',
    name: 'Mono',
    note: 'Code & terminals',
    stack: "ui-monospace, 'SF Mono', 'Cascadia Code', Consolas, Menlo, monospace",
    canvas: "ui-monospace, 'SF Mono', Consolas, Menlo, monospace",
  },
  {
    id: 'typewriter',
    name: 'Typewriter',
    note: 'Courier ribbons',
    stack: "'Courier New', Courier, 'Nimbus Mono PS', monospace",
    canvas: "'Courier New', Courier, monospace",
  },
  {
    id: 'impact',
    name: 'Impact Display',
    note: 'Posters & memes',
    stack: "Impact, 'Arial Black', 'Franklin Gothic Bold', sans-serif",
    canvas: "Impact, 'Arial Black', sans-serif",
  },
  {
    id: 'cursive',
    name: 'Cursive Hand',
    note: 'Script penmanship',
    stack: "'Segoe Script', 'Bradley Hand', 'Comic Sans MS', cursive",
    canvas: "'Segoe Script', 'Bradley Hand', cursive",
  },
  {
    id: 'fantasy',
    name: 'Fantasy',
    note: 'Papyrus adventure',
    stack: "Papyrus, 'Papyrus Condensed', fantasy",
    canvas: "Papyrus, fantasy",
  },
  {
    id: 'bengali',
    name: 'Bengali',
    note: 'বাংলা unicode text',
    stack: "'Noto Sans Bengali', 'Bangla Sangam MN', 'Nirmala UI', 'Vrinda', sans-serif",
    canvas: "'Noto Sans Bengali', 'Bangla Sangam MN', 'Nirmala UI', sans-serif",
  },
  {
    id: 'slab',
    name: 'Slab',
    note: 'Rockwell sturdiness',
    stack: "Rockwell, 'Rockwell Nova', 'Roboto Slab', 'DejaVu Serif', serif",
    canvas: "Rockwell, 'Roboto Slab', serif",
  },
  {
    id: 'condensed',
    name: 'Condensed',
    note: 'Narrow headlines',
    stack: "'Arial Narrow', 'Helvetica Neue', 'Liberation Sans Narrow', sans-serif",
    canvas: "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
  },
]

function stackById(id: string): FontStack {
  return FONT_STACKS.find((s) => s.id === id) ?? FONT_STACKS[0]
}

const GRADIENTS: GradPreset[] = [
  { id: 'sunset', name: 'Sunset', stops: ['#f97316', '#db2777', '#7c3aed'] },
  { id: 'ocean', name: 'Ocean', stops: ['#22d3ee', '#2563eb', '#1e1b4b'] },
  { id: 'forest', name: 'Forest', stops: ['#4ade80', '#059669', '#064e3b'] },
  { id: 'grape', name: 'Grape', stops: ['#c084fc', '#7c3aed', '#312e81'] },
  { id: 'candy', name: 'Candy', stops: ['#f9a8d4', '#f472b6', '#e11d48'] },
  { id: 'ember', name: 'Ember', stops: ['#fbbf24', '#dc2626', '#7f1d1d'] },
  { id: 'mint', name: 'Mint', stops: ['#99f6e4', '#2dd4bf', '#0f766e'] },
  { id: 'midnight', name: 'Midnight', stops: ['#334155', '#0f172a', '#020617'] },
]

function gradCss(id: string): string {
  const g = GRADIENTS.find((x) => x.id === id) ?? GRADIENTS[0]
  return `linear-gradient(135deg, ${g.stops.join(', ')})`
}

const SOLIDS = ['#fafafa', '#0a0a0a', '#18181b', '#f43f5e', '#f59e0b', '#10b981', '#38bdf8', '#8b5cf6']

const RATIOS = [
  { id: '1:1', label: 'Square', w: 1080, h: 1080 },
  { id: '4:5', label: 'Portrait', w: 1080, h: 1350 },
  { id: '9:16', label: 'Story', w: 1080, h: 1920 },
] as const

type RatioId = (typeof RATIOS)[number]['id']

function ratioOf(id: RatioId): (typeof RATIOS)[number] {
  return RATIOS.find((r) => r.id === id) ?? RATIOS[0]
}

const WEIGHTS = [
  { value: 300, label: '300 · Light' },
  { value: 400, label: '400 · Regular' },
  { value: 500, label: '500 · Medium' },
  { value: 600, label: '600 · Semibold' },
  { value: 700, label: '700 · Bold' },
  { value: 800, label: '800 · Extrabold' },
]

const DEFAULT_SAMPLE = 'The quick brown fox jumps over the lazy dog'
const BENGALI_SAMPLE = 'অসংখ্য ধন্যবাদ, সবাই মিলে এমন সুন্দর করে সাহায্য করছ।'
const DEFAULT_QUOTE = 'Simplicity is the ultimate sophistication.'
const QUOTE_MARK = '“'

/* quote-card logical design space (preview is a scaled mirror of this) */
const LOGICAL_W = 1080
const PAD = 84
const AUTHOR_GAP = 34
const MAX_SAVE_BYTES = 2_500_000
const EXPORT_SCALE = 2

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

/** Thin glass scrollbar for long lists. */
const SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

function buzz(): void {
  navigator.vibrate?.(12)
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function shortDate(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function scrimCss(alpha: number): string {
  const a = alpha.toFixed(3)
  return `linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,${a}) 50%, rgba(0,0,0,0) 100%)`
}

/** ctx.font assembled from the stack's first real families + weight. */
function canvasFont(s: FontStack, weight: number, italic: boolean, px: number): string {
  return `${italic ? 'italic ' : ''}${weight} ${px}px ${s.canvas}`
}

/** Word-wrap for canvas export — mirrors the preview's native wrapping. */
function wrapText(ctx: CanvasRenderingContext2D, text: string, font: string, maxW: number): string[] {
  ctx.font = font
  const out: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      out.push('')
      continue
    }
    let line = ''
    for (const w of words) {
      const test = line ? `${line} ${w}` : w
      if (ctx.measureText(test).width <= maxW || !line) {
        if (!line && ctx.measureText(w).width > maxW) {
          /* single word wider than the box — hard-break by code point */
          let chunk = ''
          for (const ch of w) {
            if (chunk && ctx.measureText(chunk + ch).width > maxW) {
              out.push(chunk)
              chunk = ch
            } else {
              chunk += ch
            }
          }
          line = chunk
        } else {
          line = test
        }
      } else {
        out.push(line)
        line = w
      }
    }
    if (line) out.push(line)
  }
  return out.length > 0 ? out : ['']
}

/* lazy shared 2D context for text measurement (client only) */
let measureCtx: CanvasRenderingContext2D | null = null
function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')
  return measureCtx
}

function paintGradient(ctx: CanvasRenderingContext2D, id: string, W: number, H: number): void {
  const g = GRADIENTS.find((x) => x.id === id) ?? GRADIENTS[0]
  const grad = ctx.createLinearGradient(0, 0, W, H)
  g.stops.forEach((c, i) => grad.addColorStop(i / (g.stops.length - 1), c))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, W: number, H: number): void {
  const s = Math.max(W / img.width, H / img.height)
  const dw = img.width * s
  const dh = img.height * s
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh)
}

function triggerDownload(dataUrl: string, name: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/* ================================================================== */
/* IndexedDB — saved quote cards, fully on-device                      */
/* ================================================================== */

const DB_NAME = 'toolhub-fontplay'
const DB_VERSION = 1
const CARD_STORE = 'cards'

let dbPromise: Promise<IDBDatabase> | null = null

function openFontDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(CARD_STORE)) d.createObjectStore(CARD_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openFontDb()
  return dbPromise
}

function idbGetAll<T>(store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readonly').objectStore(store).getAll()
        req.onsuccess = () => resolve((req.result ?? []) as T[])
        req.onerror = () => reject(req.error ?? new Error('IndexedDB getAll failed'))
      })
      .catch(reject)
  })
}

function idbPut<T>(store: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).put(value as object)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'))
      })
      .catch(reject)
  })
}

function idbDelete(store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).delete(key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
      })
      .catch(reject)
  })
}

function idbClear(store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).clear()
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB clear failed'))
      })
      .catch(reject)
  })
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function FontPlaygroundApp() {
  const { toast } = useToast()

  /* ---------------- shared state ---------------- */
  const [tab, setTab] = useState<TabKey>('tester')

  /* ---------------- type tester state ---------------- */
  const [sample, setSample] = useState(DEFAULT_SAMPLE)
  const [useBn, setUseBn] = useState(false)
  const [tSize, setTSize] = useState(28)
  const [tWeight, setTWeight] = useState(400)
  const [tLine, setTLine] = useState(1.4)
  const [tTrack, setTTrack] = useState(0)
  const [tAlign, setTAlign] = useState<TextAlign>('left')
  const [tItalic, setTItalic] = useState(false)
  const [tColor, setTColor] = useState('#fafafa')
  const [tBg, setTBg] = useState('#101014')
  const [openStack, setOpenStack] = useState<string | null>(null)

  /* ---------------- quote card editor state ---------------- */
  const [quote, setQuote] = useState(DEFAULT_QUOTE)
  const [author, setAuthor] = useState('Leonardo da Vinci')
  const [qStackId, setQStackId] = useState('serif')
  const [qSize, setQSize] = useState(56)
  const [qColor, setQColor] = useState('#ffffff')
  const [qAlign, setQAlign] = useState<TextAlign>('center')
  const [qPos, setQPos] = useState(50)
  const [scrimOn, setScrimOn] = useState(true)
  const [scrim, setScrim] = useState(35)
  const [showMark, setShowMark] = useState(true)
  const [ratioId, setRatioId] = useState<RatioId>('1:1')
  const [bgKind, setBgKind] = useState<'gradient' | 'solid' | 'image'>('gradient')
  const [gradId, setGradId] = useState(GRADIENTS[0].id)
  const [solidHex, setSolidHex] = useState(SOLIDS[1])
  const [imgUrl, setImgUrl] = useState<string | null>(null)

  /* ---------------- stage measuring ---------------- */
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [stageW, setStageW] = useState(0)

  /* ---------------- saved cards ---------------- */
  const [cards, setCards] = useState<SavedCard[]>([])
  const [loaded, setLoaded] = useState(false)
  const [armedDeleteId, setArmedDeleteId] = useState<string | null>(null)
  const [armedClear, setArmedClear] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)

  /* ---------------- refs ---------------- */
  const fileRef = useRef<HTMLInputElement | null>(null)
  const imgUrlRef = useRef<string | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [imgReady, setImgReady] = useState(false)

  /* ---------------- hydration (IndexedDB → state) ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rows = await idbGetAll<SavedCard>(CARD_STORE)
        if (!alive) return
        rows.sort((a, b) => b.createdAt - a.createdAt)
        setCards(rows)
      } catch {
        /* private mode / quota — keep in-memory cards */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- armed confirms expire ---------------- */
  useEffect(() => {
    if (!armedDeleteId && !armedClear) return
    const t = window.setTimeout(() => {
      setArmedDeleteId(null)
      setArmedClear(false)
    }, 2600)
    return () => window.clearTimeout(t)
  }, [armedDeleteId, armedClear])

  /* ---------------- stage width measuring ---------------- */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = Math.max(0, Math.floor(e.contentRect.width))
        setStageW((prev) => (prev === w ? prev : w))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [tab])

  /* ---------------- decode uploaded background image ---------------- */
  useEffect(() => {
    if (!imgUrl) {
      imgRef.current = null
      queueMicrotask(() => setImgReady(false))
      return
    }
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (alive) {
        imgRef.current = img
        setImgReady(true)
      }
    }
    img.onerror = () => {
      if (alive) {
        imgRef.current = null
        setImgReady(false)
      }
    }
    img.src = imgUrl
    return () => {
      alive = false
      img.onload = null
      img.onerror = null
    }
  }, [imgUrl])

  /* ---------------- revoke the object URL on unmount ---------------- */
  useEffect(() => {
    return () => {
      if (imgUrlRef.current) {
        URL.revokeObjectURL(imgUrlRef.current)
        imgUrlRef.current = null
      }
    }
  }, [])

  /* ---------------- derived ---------------- */
  const activeStack = useMemo(() => stackById(qStackId), [qStackId])
  const ratio = useMemo(() => ratioOf(ratioId), [ratioId])
  const previewCard = useMemo(() => cards.find((c) => c.id === previewId) ?? null, [cards, previewId])
  const testerText = useBn ? BENGALI_SAMPLE : sample.trim() || DEFAULT_SAMPLE

  /**
   * Shared quote layout in the 1080-wide logical space. One source of truth
   * for BOTH the div preview and the canvas export → exact mirror.
   */
  const layout = useMemo<QuoteLayout>(() => {
    const W = ratio.w
    const H = ratio.h
    const hasQuote = quote.trim().length > 0
    const hasAuthor = author.trim().length > 0
    const lineH = Math.round(qSize * 1.3)
    const markH = showMark ? Math.round(qSize * 1.9) : 0
    const aSize = Math.max(20, Math.round(qSize * 0.42))
    const maxW = W - PAD * 2
    let lines: string[] = ['Your quote here…']
    if (hasQuote) {
      const mctx = getMeasureCtx()
      lines = mctx
        ? wrapText(mctx, quote.trim(), canvasFont(activeStack, 600, false, qSize), maxW)
        : [quote.trim()]
    }
    const totalH = markH + lines.length * lineH + (hasAuthor ? AUTHOR_GAP + aSize * 1.5 : 0)
    const raw = (qPos / 100) * H
    const centerY = Math.min(Math.max(raw, totalH / 2 + 40), H - totalH / 2 - 40)
    const bandH = Math.min(Math.round(totalH + 150), Math.round(H * 0.9))
    const bandTop = Math.max(0, Math.round(centerY - bandH / 2))
    return {
      W,
      H,
      qSize,
      lines,
      lineH,
      markH,
      markBaseline: markH - Math.round(qSize * 0.35),
      totalH,
      centerY,
      bandTop,
      bandH,
      aSize,
      hasQuote,
      hasAuthor,
    }
  }, [ratio, quote, author, qSize, qPos, showMark, activeStack])

  /* ---------------- canvas export (2× the logical space) ---------------- */
  const renderCard = useCallback(
    (scale: number): HTMLCanvasElement | null => {
      const canvas = document.createElement('canvas')
      canvas.width = layout.W * scale
      canvas.height = layout.H * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      ctx.scale(scale, scale)

      /* background — image (object-cover) falls back to gradient until decoded */
      if (bgKind === 'image') {
        if (imgRef.current) drawCover(ctx, imgRef.current, layout.W, layout.H)
        else paintGradient(ctx, gradId, layout.W, layout.H)
      } else if (bgKind === 'gradient') {
        paintGradient(ctx, gradId, layout.W, layout.H)
      } else {
        ctx.fillStyle = solidHex
        ctx.fillRect(0, 0, layout.W, layout.H)
      }

      /* readability scrim band behind the text block */
      if (scrimOn && layout.bandH > 0) {
        const g = ctx.createLinearGradient(0, layout.bandTop, 0, layout.bandTop + layout.bandH)
        g.addColorStop(0, 'rgba(0,0,0,0)')
        g.addColorStop(0.5, `rgba(0,0,0,${(scrim / 100).toFixed(3)})`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, layout.bandTop, layout.W, layout.bandH)
      }

      /* text block */
      ctx.fillStyle = qColor
      ctx.textAlign = qAlign
      const x = qAlign === 'left' ? PAD : qAlign === 'right' ? layout.W - PAD : layout.W / 2
      const top = layout.centerY - layout.totalH / 2

      if (showMark && layout.hasQuote) {
        ctx.globalAlpha = 0.55
        ctx.font = canvasFont(activeStack, 700, false, Math.round(layout.qSize * 1.9))
        ctx.textBaseline = 'alphabetic'
        ctx.fillText(QUOTE_MARK, x, top + layout.markBaseline)
        ctx.globalAlpha = 1
      }

      ctx.font = canvasFont(activeStack, 600, false, layout.qSize)
      ctx.textBaseline = 'middle'
      layout.lines.forEach((line, i) => {
        ctx.fillText(line, x, top + layout.markH + layout.lineH * (i + 0.5))
      })

      if (layout.hasAuthor) {
        ctx.globalAlpha = 0.85
        ctx.font = canvasFont(activeStack, 500, false, layout.aSize)
        ctx.fillText(
          author.trim(),
          x,
          top + layout.markH + layout.lines.length * layout.lineH + AUTHOR_GAP + layout.aSize * 0.75
        )
        ctx.globalAlpha = 1
      }
      return canvas
    },
    [layout, bgKind, gradId, solidHex, scrimOn, scrim, qColor, qAlign, showMark, activeStack, author]
  )

  const exportDataUrl = useCallback((): string | null => {
    const canvas = renderCard(EXPORT_SCALE)
    if (!canvas) {
      toast({ title: 'Export failed', description: 'Canvas is unavailable on this device.' })
      return null
    }
    try {
      return canvas.toDataURL('image/png')
    } catch {
      toast({ title: 'Export failed', description: 'The card could not be rasterized.' })
      return null
    }
  }, [renderCard, toast])

  /* ---------------- export actions ---------------- */
  const downloadNow = useCallback(() => {
    const dataUrl = exportDataUrl()
    if (!dataUrl) return
    triggerDownload(dataUrl, `quote-${Date.now()}.png`)
    toast({ title: 'PNG downloaded', description: `Rendered at ${layout.W * EXPORT_SCALE}×${layout.H * EXPORT_SCALE}.` })
    buzz()
  }, [exportDataUrl, toast, layout.W, layout.H])

  const shareNow = useCallback(() => {
    const canvas = renderCard(EXPORT_SCALE)
    if (!canvas) {
      toast({ title: 'Export failed', description: 'Canvas is unavailable on this device.' })
      return
    }
    buzz()
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          toast({ title: 'Export failed', description: 'The card could not be rasterized.' })
          return
        }
        const file = new File([blob], `quote-${Date.now()}.png`, { type: 'image/png' })
        if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
          navigator
            .share({ files: [file], title: 'Quote card', text: quote.trim() })
            .then(() => toast({ title: 'Shared' }))
            .catch((err: unknown) => {
              if (!(err instanceof DOMException && err.name === 'AbortError')) {
                toast({ title: 'Sharing cancelled', description: 'Try downloading instead.' })
              }
            })
        } else {
          toast({ title: 'Share unavailable here', description: 'Saved the PNG to your device instead.' })
          triggerDownload(canvas.toDataURL('image/png'), `quote-${Date.now()}.png`)
        }
      },
      'image/png'
    )
  }, [renderCard, quote, toast])

  const saveCard = useCallback(() => {
    const dataUrl = exportDataUrl()
    if (!dataUrl) return
    const approxBytes = Math.round(dataUrl.length * 0.75)
    if (approxBytes > MAX_SAVE_BYTES) {
      toast({
        title: 'Too large to save',
        description: 'Card exceeds the 2.5 MB save limit — use Download instead.',
      })
      return
    }
    const card: SavedCard = {
      id: uid(),
      imageDataUrl: dataUrl,
      quote: quote.trim(),
      author: author.trim(),
      stackId: qStackId,
      createdAt: Date.now(),
    }
    setCards((prev) => [card, ...prev])
    void idbPut(CARD_STORE, card).catch(() => {
      toast({ title: 'Saved for this session', description: 'IndexedDB write failed — card kept in memory.' })
    })
    toast({ title: 'Card saved', description: 'Find it in Saved cards below.' })
    buzz()
  }, [exportDataUrl, quote, author, qStackId, toast])

  /* ---------------- background image handling ---------------- */
  const onPickImage = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Not an image', description: 'Pick a photo or graphics file.' })
        return
      }
      const url = URL.createObjectURL(file)
      if (imgUrlRef.current) URL.revokeObjectURL(imgUrlRef.current)
      imgUrlRef.current = url
      setImgUrl(url)
      setBgKind('image')
      buzz()
    },
    [toast]
  )

  const clearImage = useCallback(() => {
    if (imgUrlRef.current) {
      URL.revokeObjectURL(imgUrlRef.current)
      imgUrlRef.current = null
    }
    setImgUrl(null)
  }, [])

  /* ---------------- saved card actions ---------------- */
  const deleteCard = useCallback(
    (id: string) => {
      if (armedDeleteId !== id) {
        setArmedDeleteId(id)
        return
      }
      setArmedDeleteId(null)
      setCards((prev) => prev.filter((c) => c.id !== id))
      if (previewId === id) setPreviewId(null)
      void idbDelete(CARD_STORE, id).catch(() => {
        toast({ title: 'Delete failed', description: 'Card removed from view only.' })
      })
      buzz()
    },
    [armedDeleteId, previewId, toast]
  )

  const clearAll = useCallback(() => {
    if (!armedClear) {
      setArmedClear(true)
      return
    }
    setArmedClear(false)
    setCards([])
    setPreviewId(null)
    void idbClear(CARD_STORE).catch(() => {
      toast({ title: 'Clear failed', description: 'Cards removed from view only.' })
    })
    toast({ title: 'All cards cleared' })
    buzz()
  }, [armedClear, toast])

  const editCard = useCallback(
    (c: SavedCard) => {
      setQuote(c.quote)
      setAuthor(c.author)
      setQStackId(FONT_STACKS.some((s) => s.id === c.stackId) ? c.stackId : FONT_STACKS[0].id)
      setPreviewId(null)
      toast({ title: 'Settings restored', description: 'Quote, author and font loaded into the editor.' })
      buzz()
    },
    [toast]
  )

  /* ================================================================ */
  /* Render                                                           */
  /* ================================================================ */

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-zinc-100">
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-16">
        {/* ---------------- identity header ---------------- */}
        <header className="rounded-2xl bg-gradient-to-br from-rose-400 via-pink-500 to-fuchsia-600 p-5 text-white shadow-[0_18px_44px_-18px_rgb(244_63_94/0.6)]">
          <div className="flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30 shadow-[inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <CaseSensitive className="size-7" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight">Font Playground</h1>
              <p className="text-sm text-white/85">Find your voice, style your words</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {['14 system stacks', 'Quote cards', 'Offline · no uploads'].map((chip) => (
              <span
                key={chip}
                className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white/90 ring-1 ring-white/20"
              >
                {chip}
              </span>
            ))}
          </div>
        </header>

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="gap-0">
          <TabsList className="grid h-12 w-full grid-cols-2 rounded-2xl border border-white/10 bg-white/5 p-1">
            <TabsTrigger
              value="tester"
              className="h-10 rounded-xl text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white"
            >
              <Type className="size-4" aria-hidden /> Type Tester
            </TabsTrigger>
            <TabsTrigger
              value="cards"
              className="h-10 rounded-xl text-sm data-[state=active]:bg-white/10 data-[state=active]:text-white"
            >
              <Quote className="size-4" aria-hidden /> Quote Cards
            </TabsTrigger>
          </TabsList>

          {/* ================= TAB 1 · TYPE TESTER ================= */}
          <TabsContent value="tester" className="mt-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className="space-y-4"
            >
              {/* controls */}
              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex gap-2">
                  <Input
                    value={useBn ? BENGALI_SAMPLE : sample}
                    onChange={(e) => {
                      setSample(e.target.value)
                      setUseBn(false)
                    }}
                    placeholder="Type a sample sentence…"
                    aria-label="Sample text"
                    className="h-11 min-w-0 flex-1 bg-black/30"
                  />
                  <Button
                    type="button"
                    variant={useBn ? 'default' : 'outline'}
                    className={cn('h-11 shrink-0 px-3', !useBn && 'bg-white/5')}
                    aria-pressed={useBn}
                    onClick={() => {
                      setUseBn((v) => !v)
                      buzz()
                    }}
                  >
                    <Languages className="size-4" aria-hidden /> বাংলা
                  </Button>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
                      <span>Size</span>
                      <span className="tabular-nums text-zinc-500">{tSize}px</span>
                    </div>
                    <Slider
                      min={12}
                      max={72}
                      step={1}
                      value={[tSize]}
                      onValueChange={(v) => setTSize(v[0] ?? 28)}
                      aria-label="Font size"
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
                      <span>Line height</span>
                      <span className="tabular-nums text-zinc-500">{tLine.toFixed(2)}</span>
                    </div>
                    <Slider
                      min={0.9}
                      max={2.2}
                      step={0.05}
                      value={[tLine]}
                      onValueChange={(v) => setTLine(v[0] ?? 1.4)}
                      aria-label="Line height"
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
                      <span>Letter spacing</span>
                      <span className="tabular-nums text-zinc-500">{tTrack.toFixed(1)}px</span>
                    </div>
                    <Slider
                      min={-2}
                      max={10}
                      step={0.5}
                      value={[tTrack]}
                      onValueChange={(v) => setTTrack(v[0] ?? 0)}
                      aria-label="Letter spacing"
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 text-xs text-zinc-400">Weight</div>
                    <Select value={String(tWeight)} onValueChange={(v) => setTWeight(Number(v))}>
                      <SelectTrigger className="h-9 w-full bg-black/30" aria-label="Font weight">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEIGHTS.map((w) => (
                          <SelectItem key={w.value} value={String(w.value)}>
                            {w.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="flex overflow-hidden rounded-xl border border-white/10">
                    {(
                      [
                        ['left', AlignLeft],
                        ['center', AlignCenter],
                        ['right', AlignRight],
                      ] as const
                    ).map(([a, Icon]) => (
                      <button
                        key={a}
                        type="button"
                        aria-label={`Align ${a}`}
                        aria-pressed={tAlign === a}
                        onClick={() => {
                          setTAlign(a)
                          buzz()
                        }}
                        className={cn(
                          'flex h-11 w-11 items-center justify-center transition-colors',
                          tAlign === a ? 'bg-white/15 text-white' : 'bg-white/5 text-zinc-400 hover:bg-white/10'
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle italic"
                    aria-pressed={tItalic}
                    onClick={() => {
                      setTItalic((v) => !v)
                      buzz()
                    }}
                    className={cn(
                      'flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 transition-colors',
                      tItalic ? 'bg-white/15 text-white' : 'bg-white/5 text-zinc-400 hover:bg-white/10'
                    )}
                  >
                    <Italic className="size-4" aria-hidden />
                  </button>

                  <div className="ml-auto flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <input
                        type="color"
                        value={tColor}
                        onChange={(e) => setTColor(e.target.value)}
                        aria-label="Text colour"
                        className="h-11 w-11 cursor-pointer rounded-xl border border-white/10 bg-transparent p-1"
                      />
                      Text
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <input
                        type="color"
                        value={tBg}
                        onChange={(e) => setTBg(e.target.value)}
                        aria-label="Backdrop colour"
                        className="h-11 w-11 cursor-pointer rounded-xl border border-white/10 bg-transparent p-1"
                      />
                      Backdrop
                    </label>
                  </div>
                </div>
              </section>

              {/* stack preview list */}
              <section>
                <h2 className="mb-2 flex items-center gap-2 px-1 text-xs font-medium uppercase tracking-wider text-zinc-500">
                  <Palette className="size-3.5" aria-hidden /> {FONT_STACKS.length} stacks · tap a card for the full
                  specimen
                </h2>
                <div className={cn('max-h-96 space-y-3 overflow-y-auto pr-1', SCROLLBAR)}>
                  {FONT_STACKS.map((s) => {
                    const open = openStack === s.id
                    return (
                      <div key={s.id} className="rounded-2xl border border-white/10 bg-white/5">
                        <button
                          type="button"
                          onClick={() => {
                            setOpenStack(open ? null : s.id)
                            buzz()
                          }}
                          aria-expanded={open}
                          className="flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left"
                        >
                          <Badge
                            variant="outline"
                            className="shrink-0 border-white/15 bg-black/30 text-[11px] text-zinc-100"
                          >
                            {s.name}
                          </Badge>
                          <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{s.note}</span>
                          <ChevronDown
                            className={cn(
                              'size-4 shrink-0 text-zinc-400 transition-transform duration-200',
                              open && 'rotate-180'
                            )}
                            aria-hidden
                          />
                        </button>
                        <div className="px-4 pb-4">
                          <div className="overflow-hidden rounded-xl p-4" style={{ background: tBg }}>
                            <p
                              className="break-words"
                              style={{
                                fontFamily: s.stack,
                                fontSize: tSize,
                                fontWeight: tWeight,
                                lineHeight: tLine,
                                letterSpacing: `${tTrack}px`,
                                fontStyle: tItalic ? 'italic' : 'normal',
                                textAlign: tAlign,
                                color: tColor,
                              }}
                            >
                              {testerText}
                            </p>
                          </div>
                          <AnimatePresence initial={false}>
                            {open && (
                              <motion.div
                                key="specimen"
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                transition={{ type: 'spring', stiffness: 380, damping: 36 }}
                                className="overflow-hidden"
                              >
                                <div className="mt-3 overflow-hidden rounded-xl border border-white/10 p-4" style={{ background: tBg }}>
                                  <p
                                    className="break-words"
                                    style={{
                                      fontFamily: s.stack,
                                      fontSize: Math.max(13, Math.round(tSize * 0.72)),
                                      fontWeight: tWeight,
                                      lineHeight: 1.5,
                                      letterSpacing: `${tTrack}px`,
                                      fontStyle: tItalic ? 'italic' : 'normal',
                                      color: tColor,
                                    }}
                                  >
                                    ABCDEFGHIJKLMNOPQRSTUVWXYZ
                                    <br />
                                    abcdefghijklmnopqrstuvwxyz
                                    <br />
                                    0123456789 · !?&amp;@#%()
                                  </p>
                                  <p
                                    className="mt-3 break-words border-t border-white/10 pt-3"
                                    style={{
                                      fontFamily: s.stack,
                                      fontSize: Math.min(52, Math.round(tSize * 1.5)),
                                      fontWeight: tWeight,
                                      lineHeight: 1.25,
                                      letterSpacing: `${tTrack}px`,
                                      fontStyle: tItalic ? 'italic' : 'normal',
                                      textAlign: tAlign,
                                      color: tColor,
                                    }}
                                  >
                                    {testerText}
                                  </p>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            </motion.div>
          </TabsContent>

          {/* ================= TAB 2 · QUOTE CARDS ================= */}
          <TabsContent value="cards" className="mt-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className="space-y-4"
            >
              {/* live preview + export */}
              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    <ImageIcon className="size-4 text-pink-400" aria-hidden /> Preview
                  </h2>
                  <span className="text-xs tabular-nums text-zinc-500">
                    {ratio.w * EXPORT_SCALE} × {ratio.h * EXPORT_SCALE} px
                  </span>
                </div>

                <div
                  ref={stageRef}
                  className="relative mx-auto w-full overflow-hidden rounded-xl ring-1 ring-white/10"
                  style={{
                    aspectRatio: `${ratio.w} / ${ratio.h}`,
                    maxWidth: Math.round(560 * (ratio.w / ratio.h)),
                  }}
                >
                  {stageW > 0 ? (
                    <div className="absolute inset-0 overflow-hidden" aria-hidden>
                      <div
                        className="relative"
                        style={{
                          width: LOGICAL_W,
                          height: layout.H,
                          transform: `scale(${stageW / LOGICAL_W})`,
                          transformOrigin: '0 0',
                        }}
                      >
                        {/* background — exact mirror of the canvas export */}
                        {bgKind === 'gradient' && (
                          <div className="absolute inset-0" style={{ background: gradCss(gradId) }} />
                        )}
                        {bgKind === 'solid' && (
                          <div className="absolute inset-0" style={{ background: solidHex }} />
                        )}
                        {bgKind === 'image' && imgUrl && (
                          <img
                            src={imgUrl}
                            alt=""
                            draggable={false}
                            className="absolute inset-0 size-full object-cover"
                          />
                        )}
                        {bgKind === 'image' && !imgUrl && <div className="absolute inset-0 bg-zinc-800" />}

                        {/* scrim band */}
                        {scrimOn && layout.bandH > 0 && (
                          <div
                            className="absolute inset-x-0"
                            style={{
                              top: layout.bandTop,
                              height: layout.bandH,
                              background: scrimCss(scrim / 100),
                            }}
                          />
                        )}

                        {/* text block */}
                        <div
                          className="absolute inset-x-0"
                          style={{
                            top: layout.centerY,
                            transform: 'translateY(-50%)',
                            textAlign: qAlign,
                            paddingLeft: PAD,
                            paddingRight: PAD,
                          }}
                        >
                          {showMark && (
                            <div
                              style={{
                                fontFamily: activeStack.stack,
                                fontWeight: 700,
                                fontSize: Math.round(layout.qSize * 1.9),
                                lineHeight: 1,
                                height: layout.markH,
                                color: qColor,
                                opacity: 0.55,
                              }}
                            >
                              {QUOTE_MARK}
                            </div>
                          )}
                          <p
                            style={{
                              fontFamily: activeStack.stack,
                              fontWeight: 600,
                              fontSize: layout.qSize,
                              lineHeight: 1.3,
                              color: qColor,
                              opacity: layout.hasQuote ? 1 : 0.5,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              margin: 0,
                            }}
                          >
                            {layout.hasQuote ? quote : 'Your quote here…'}
                          </p>
                          {layout.hasAuthor && (
                            <div
                              style={{
                                marginTop: AUTHOR_GAP,
                                fontFamily: activeStack.stack,
                                fontWeight: 500,
                                fontSize: layout.aSize,
                                lineHeight: 1.5,
                                color: qColor,
                                opacity: 0.85,
                              }}
                            >
                              {author}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-zinc-500">Measuring…</div>
                  )}
                </div>

                {!layout.hasQuote && (
                  <p className="mt-2 text-center text-xs text-amber-400/90">
                    Write a quote to enable export — the placeholder is preview-only.
                  </p>
                )}

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Button className="h-11" onClick={downloadNow} disabled={!layout.hasQuote}>
                    <Download className="size-4" aria-hidden /> PNG
                  </Button>
                  <Button variant="outline" className="h-11 bg-white/5" onClick={shareNow} disabled={!layout.hasQuote}>
                    <Share2 className="size-4" aria-hidden /> Share
                  </Button>
                  <Button variant="outline" className="h-11 bg-white/5" onClick={saveCard} disabled={!layout.hasQuote}>
                    <Save className="size-4" aria-hidden /> Save
                  </Button>
                </div>
                <p className="mt-2 text-center text-[11px] text-zinc-500">
                  Export renders offscreen at 2× — nothing ever leaves your device.
                </p>
              </section>

              {/* editor controls */}
              <section className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                {/* background */}
                <div>
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Background</h3>
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Card size">
                    {RATIOS.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        aria-pressed={ratioId === r.id}
                        onClick={() => {
                          setRatioId(r.id)
                          buzz()
                        }}
                        className={cn(
                          'flex h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors',
                          ratioId === r.id
                            ? 'border-pink-400/60 bg-pink-500/15 text-white'
                            : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10'
                        )}
                      >
                        {r.id}
                        <span className="text-zinc-500">{r.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-2" role="group" aria-label="Gradient presets">
                    {GRADIENTS.map((g) => (
                      <button
                        key={g.id}
                        type="button"
                        title={g.name}
                        aria-label={`${g.name} gradient`}
                        aria-pressed={bgKind === 'gradient' && gradId === g.id}
                        onClick={() => {
                          setGradId(g.id)
                          setBgKind('gradient')
                          buzz()
                        }}
                        className={cn(
                          'h-11 rounded-xl ring-offset-2 ring-offset-zinc-950 transition-transform active:scale-95',
                          bgKind === 'gradient' && gradId === g.id
                            ? 'ring-2 ring-pink-400'
                            : 'ring-1 ring-white/10 hover:ring-white/25'
                        )}
                        style={{ background: gradCss(g.id) }}
                      />
                    ))}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Solid colours">
                    {SOLIDS.map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        title={hex}
                        aria-label={`Solid ${hex}`}
                        aria-pressed={bgKind === 'solid' && solidHex === hex}
                        onClick={() => {
                          setSolidHex(hex)
                          setBgKind('solid')
                          buzz()
                        }}
                        className={cn(
                          'size-11 rounded-full transition-transform active:scale-95',
                          bgKind === 'solid' && solidHex === hex
                            ? 'ring-2 ring-pink-400 ring-offset-2 ring-offset-zinc-950'
                            : 'ring-1 ring-white/15 hover:ring-white/40'
                        )}
                        style={{ background: hex }}
                      />
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 bg-white/5"
                      onClick={() => fileRef.current?.click()}
                    >
                      <Upload className="size-4" aria-hidden /> Photo
                    </Button>
                    {imgUrl && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 bg-white/5"
                        onClick={() => {
                          clearImage()
                          buzz()
                        }}
                      >
                        <X className="size-4" aria-hidden /> Remove
                      </Button>
                    )}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={onPickImage}
                      aria-label="Upload background photo"
                    />
                  </div>
                  {bgKind === 'image' && imgUrl && !imgReady && (
                    <p className="mt-2 text-xs text-zinc-500">Decoding photo… exports wait for it automatically.</p>
                  )}
                </div>

                {/* text */}
                <div className="border-t border-white/10 pt-4">
                  <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Text</h3>
                  <Textarea
                    value={quote}
                    onChange={(e) => setQuote(e.target.value)}
                    placeholder="Your quote…"
                    aria-label="Quote text"
                    rows={3}
                    className="min-h-20 resize-none bg-black/30"
                  />
                  <Input
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                    placeholder="Author (optional)"
                    aria-label="Author"
                    className="mt-2 h-11 bg-black/30"
                  />

                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-4">
                    <div className="col-span-2">
                      <div className="mb-1.5 text-xs text-zinc-400">Font stack</div>
                      <Select value={qStackId} onValueChange={(v) => setQStackId(v)}>
                        <SelectTrigger className="h-11 w-full bg-black/30" aria-label="Font stack">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FONT_STACKS.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                              <span className="ml-1.5 text-xs text-zinc-500">{s.note}</span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-2">
                      <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
                        <span>Quote size</span>
                        <span className="tabular-nums text-zinc-500">{qSize}px</span>
                      </div>
                      <Slider
                        min={24}
                        max={96}
                        step={2}
                        value={[qSize]}
                        onValueChange={(v) => setQSize(v[0] ?? 56)}
                        aria-label="Quote size"
                      />
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div className="flex overflow-hidden rounded-xl border border-white/10">
                      {(
                        [
                          ['left', AlignLeft],
                          ['center', AlignCenter],
                          ['right', AlignRight],
                        ] as const
                      ).map(([a, Icon]) => (
                        <button
                          key={a}
                          type="button"
                          aria-label={`Align ${a}`}
                          aria-pressed={qAlign === a}
                          onClick={() => {
                            setQAlign(a)
                            buzz()
                          }}
                          className={cn(
                            'flex h-11 w-11 items-center justify-center transition-colors',
                            qAlign === a ? 'bg-white/15 text-white' : 'bg-white/5 text-zinc-400 hover:bg-white/10'
                          )}
                        >
                          <Icon className="size-4" aria-hidden />
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <input
                        type="color"
                        value={qColor}
                        onChange={(e) => setQColor(e.target.value)}
                        aria-label="Text colour"
                        className="h-11 w-11 cursor-pointer rounded-xl border border-white/10 bg-transparent p-1"
                      />
                      Colour
                    </label>
                    <div className="ml-auto min-w-40 flex-1 sm:max-w-56">
                      <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
                        <span>Vertical position</span>
                        <span className="tabular-nums text-zinc-500">{qPos}%</span>
                      </div>
                      <Slider
                        min={10}
                        max={90}
                        step={1}
                        value={[qPos]}
                        onValueChange={(v) => setQPos(v[0] ?? 50)}
                        aria-label="Vertical position"
                      />
                    </div>
                  </div>

                  <div className="mt-4 space-y-3 rounded-xl bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor="scrim-toggle" className="text-sm text-zinc-300">
                        Scrim behind text
                        <span className="block text-xs text-zinc-500">Subtle dark band for readability</span>
                      </label>
                      <Switch id="scrim-toggle" checked={scrimOn} onCheckedChange={setScrimOn} />
                    </div>
                    <div className={cn(!scrimOn && 'pointer-events-none opacity-40')}>
                      <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-400">
                        <span>Scrim strength</span>
                        <span className="tabular-nums text-zinc-500">{scrim}%</span>
                      </div>
                      <Slider
                        min={0}
                        max={80}
                        step={5}
                        value={[scrim]}
                        onValueChange={(v) => setScrim(v[0] ?? 35)}
                        aria-label="Scrim strength"
                        disabled={!scrimOn}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-3">
                      <label htmlFor="mark-toggle" className="text-sm text-zinc-300">
                        Decorative quote mark
                        <span className="block text-xs text-zinc-500">Oversized “ above the quote</span>
                      </label>
                      <Switch id="mark-toggle" checked={showMark} onCheckedChange={setShowMark} />
                    </div>
                  </div>
                </div>
              </section>

              {/* saved cards */}
              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                    Saved cards
                    <Badge variant="outline" className="border-white/15 bg-black/30 text-zinc-300">
                      {cards.length}
                    </Badge>
                  </h2>
                  {cards.length > 0 && (
                    <Button
                      type="button"
                      variant={armedClear ? 'destructive' : 'ghost'}
                      className="h-10 px-3 text-xs"
                      onClick={clearAll}
                    >
                      <Trash2 className="size-4" aria-hidden />
                      {armedClear ? 'Tap to confirm' : 'Clear all'}
                    </Button>
                  )}
                </div>

                {cards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 py-10 text-center">
                    <Quote className="size-6 text-zinc-600" aria-hidden />
                    <p className="text-sm text-zinc-500">
                      {loaded ? 'No saved cards yet — export one above.' : 'Loading saved cards…'}
                    </p>
                  </div>
                ) : (
                  <div className={cn('grid max-h-96 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4', SCROLLBAR)}>
                    {cards.map((c) => (
                      <div key={c.id} className="relative overflow-hidden rounded-xl ring-1 ring-white/10">
                        <img
                          src={c.imageDataUrl}
                          alt={`Quote card: ${c.quote.slice(0, 60)}`}
                          draggable={false}
                          loading="lazy"
                          className="aspect-square w-full object-cover"
                        />
                        <button
                          type="button"
                          className="absolute inset-0 focus-visible:ring-2 focus-visible:ring-pink-400 focus-visible:outline-none"
                          aria-label={`Preview card: ${c.quote.slice(0, 40)}`}
                          onClick={() => {
                            setPreviewId(c.id)
                            buzz()
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => deleteCard(c.id)}
                          aria-label={armedDeleteId === c.id ? 'Confirm delete card' : 'Delete card'}
                          className={cn(
                            'absolute right-1 top-1 z-10 flex h-8 w-8 items-center justify-center rounded-lg backdrop-blur transition-colors',
                            armedDeleteId === c.id
                              ? 'bg-rose-600 text-white'
                              : 'bg-black/55 text-zinc-200 hover:bg-black/80'
                          )}
                        >
                          {armedDeleteId === c.id ? (
                            <span className="text-[10px] font-bold leading-none">SURE?</span>
                          ) : (
                            <Trash2 className="size-4" aria-hidden />
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </motion.div>
          </TabsContent>
        </Tabs>

        {/* ---------------- saved-card preview dialog ---------------- */}
        <Dialog open={previewCard !== null} onOpenChange={(o) => { if (!o) setPreviewId(null) }}>
          <DialogContent className="max-w-sm border-white/10 bg-zinc-950 text-zinc-100">
            {previewCard && (
              <>
                <DialogHeader>
                  <DialogTitle className="text-base">Saved quote card</DialogTitle>
                  <DialogDescription className="text-xs text-zinc-500">
                    {shortDate(previewCard.createdAt)} · {stackById(previewCard.stackId).name}
                  </DialogDescription>
                </DialogHeader>
                <img
                  src={previewCard.imageDataUrl}
                  alt={`Quote card: ${previewCard.quote.slice(0, 60)}`}
                  className="w-full rounded-xl ring-1 ring-white/10"
                />
                <p className="line-clamp-2 text-sm text-zinc-300">
                  {QUOTE_MARK}
                  {previewCard.quote}
                  {QUOTE_MARK}
                  {previewCard.author ? ` — ${previewCard.author}` : ''}
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    className="h-11"
                    onClick={() => {
                      triggerDownload(previewCard.imageDataUrl, `quote-${previewCard.createdAt}.png`)
                      buzz()
                    }}
                  >
                    <Download className="size-4" aria-hidden /> Save
                  </Button>
                  <Button variant="outline" className="h-11 bg-white/5" onClick={() => editCard(previewCard)}>
                    <Pencil className="size-4" aria-hidden /> Edit
                  </Button>
                  <Button
                    variant="destructive"
                    className="h-11"
                    onClick={() => {
                      setCards((prev) => prev.filter((x) => x.id !== previewCard.id))
                      void idbDelete(CARD_STORE, previewCard.id).catch(() => {
                        toast({ title: 'Delete failed', description: 'Card removed from view only.' })
                      })
                      setPreviewId(null)
                      toast({ title: 'Card deleted' })
                      buzz()
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden /> Delete
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
