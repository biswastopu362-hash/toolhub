'use client'

/**
 * Meme Maker — classic top/bottom text memes, directly on the canvas.
 *
 * • Pick any image (file picker) or load a generated sample background.
 * • TOP + BOTTOM text blocks: bold white with black stroke, auto-wrapped,
 *   Impact stack by default — plus Chalk / Clean / Neon style presets.
 * • Direct manipulation: drag text on the canvas (hit-test by y proximity),
 *   with per-block position sliders, sizes, colors and glow for a11y.
 * • Export true-resolution PNG / JPEG, Web Share API (guarded), download
 *   meme-<ts>.png, save into the shared Gallery (toolhub-media/photos) and
 *   a local meme library (IndexedDB 'toolhub-memes' v1, store 'memes').
 *
 * Zero uploads — everything stays on device.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Download,
  FileImage,
  History,
  Image as ImageIcon,
  ImagePlus,
  Images,
  Laugh,
  MessageSquareQuote,
  Move,
  RotateCcw,
  Save,
  Share2,
  Stamp,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { newPhotoId, putPhoto } from '@/lib/media-db'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type BlockKey = 'top' | 'bottom'
type FontKey = 'impact' | 'black' | 'chalk' | 'system'
type PresetKey = 'classic' | 'chalk' | 'clean' | 'neon'

interface TextBlock {
  text: string
  /** 0..1 — anchor line: top of first line for 'top', bottom of last line for 'bottom' */
  yFrac: number
  /** font size as % of image width */
  sizePct: number
  /** stroke width as % of image width (0 = no stroke) */
  strokePct: number
  uppercase: boolean
  fontKey: FontKey
  fill: string
  stroke: string
  /** shadow blur as % of font size (0 = off) */
  glowPct: number
  glowColor: string
}

type BlockStyle = Omit<TextBlock, 'text'>

interface Preset {
  label: string
  blurb: string
  watermark: boolean
  top: BlockStyle
  bottom: BlockStyle
}

interface StyleSnapshot {
  preset: PresetKey
  watermark: boolean
  top: BlockStyle
  bottom: BlockStyle
}

/** Saved meme record — IndexedDB 'toolhub-memes' v1, store 'memes'. */
interface MemeRecord {
  id: string
  imageDataUrl: string
  topText: string
  bottomText: string
  createdAt: number
  /** optional full-style restore (non-breaking extension of the base shape) */
  style?: StyleSnapshot
}

const BLOCK_KEYS: readonly BlockKey[] = ['top', 'bottom']

const FONT_STACKS: Record<FontKey, string> = {
  impact: 'Impact, "Arial Black", "Franklin Gothic Bold", sans-serif',
  black: '"Arial Black", Impact, sans-serif',
  chalk: '"Comic Sans MS", "Segoe Print", "Bradley Hand", Chalkboard, cursive',
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
}

const FONT_WEIGHTS: Record<FontKey, number> = {
  impact: 400,
  black: 900,
  chalk: 700,
  system: 800,
}

const PRESETS: Record<PresetKey, Preset> = {
  classic: {
    label: 'Classic Impact',
    blurb: 'White Impact, thick black stroke',
    watermark: true,
    top: { yFrac: 0.02, sizePct: 9, strokePct: 0.9, uppercase: true, fontKey: 'impact', fill: '#ffffff', stroke: '#000000', glowPct: 0, glowColor: '#000000' },
    bottom: { yFrac: 0.98, sizePct: 9, strokePct: 0.9, uppercase: true, fontKey: 'impact', fill: '#ffffff', stroke: '#000000', glowPct: 0, glowColor: '#000000' },
  },
  chalk: {
    label: 'Chalk',
    blurb: 'Handwritten, chalk on board',
    watermark: true,
    top: { yFrac: 0.03, sizePct: 7.5, strokePct: 0.5, uppercase: false, fontKey: 'chalk', fill: '#fefce8', stroke: '#292524', glowPct: 0, glowColor: '#000000' },
    bottom: { yFrac: 0.97, sizePct: 7.5, strokePct: 0.5, uppercase: false, fontKey: 'chalk', fill: '#fefce8', stroke: '#292524', glowPct: 0, glowColor: '#000000' },
  },
  clean: {
    label: 'Clean',
    blurb: 'System font, soft shadow',
    watermark: true,
    top: { yFrac: 0.03, sizePct: 7, strokePct: 0, uppercase: false, fontKey: 'system', fill: '#ffffff', stroke: '#000000', glowPct: 45, glowColor: 'rgba(0,0,0,0.55)' },
    bottom: { yFrac: 0.97, sizePct: 7, strokePct: 0, uppercase: false, fontKey: 'system', fill: '#ffffff', stroke: '#000000', glowPct: 45, glowColor: 'rgba(0,0,0,0.55)' },
  },
  neon: {
    label: 'Neon',
    blurb: 'Glowing cyan and magenta',
    watermark: true,
    top: { yFrac: 0.03, sizePct: 8.5, strokePct: 0.55, uppercase: true, fontKey: 'black', fill: '#a5f3fc', stroke: '#155e75', glowPct: 75, glowColor: '#22d3ee' },
    bottom: { yFrac: 0.97, sizePct: 8.5, strokePct: 0.55, uppercase: true, fontKey: 'black', fill: '#f5d0fe', stroke: '#701a75', glowPct: 75, glowColor: '#e879f9' },
  },
}

const PRESET_ORDER: readonly PresetKey[] = ['classic', 'chalk', 'clean', 'neon']

function styleOf(b: TextBlock): BlockStyle {
  return {
    yFrac: b.yFrac,
    sizePct: b.sizePct,
    strokePct: b.strokePct,
    uppercase: b.uppercase,
    fontKey: b.fontKey,
    fill: b.fill,
    stroke: b.stroke,
    glowPct: b.glowPct,
    glowColor: b.glowColor,
  }
}

function defaultBlocks(): Record<BlockKey, TextBlock> {
  const classic = PRESETS.classic
  return {
    top: { ...classic.top, text: 'ME AFTER ONE COFFEE' },
    bottom: { ...classic.bottom, text: 'FEELING PRODUCTIVE' },
  }
}

const WATERMARK_TEXT = 'made with ToolHub'
const MAX_SAVE_BYTES = 2.5 * 1024 * 1024
const MAX_EXPORT_DIM = 8192
/** Thin glass scrollbar (house convention). */
const SCROLL_X =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/* ================================================================== */
/* Small pure helpers                                                  */
/* ================================================================== */

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

function haptic(): void {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',')
  if (i < 0) return dataUrl.length
  return Math.floor(((dataUrl.length - i - 1) * 3) / 4)
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)
  if (!m) return null
  const mime = m[1] ?? 'application/octet-stream'
  const bin = atob(m[2] ?? '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes.buffer as ArrayBuffer], { type: mime })
}

function triggerDownload(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Word-wrap with a hard character break for words wider than the box. */
function wrapCanvasText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    for (const raw of words) {
      let word = raw
      while (ctx.measureText(word).width > maxWidth && word.length > 1) {
        if (line !== '') {
          lines.push(line)
          line = ''
        }
        let cut = word.length - 1
        while (cut > 1 && ctx.measureText(word.slice(0, cut)).width > maxWidth) cut--
        lines.push(word.slice(0, cut))
        word = word.slice(cut)
      }
      const test = line === '' ? word : `${line} ${word}`
      if (ctx.measureText(test).width <= maxWidth) {
        line = test
      } else {
        if (line !== '') lines.push(line)
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

/* ================================================================== */
/* Canvas renderer (shared by display + true-resolution export)        */
/* ================================================================== */

interface BlockLayout {
  centerYFrac: number
}

type DrawLayout = Record<BlockKey, BlockLayout | null>

function drawMeme(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  img: HTMLImageElement | null,
  blocks: Record<BlockKey, TextBlock>,
  watermark: boolean,
): DrawLayout {
  const layout: DrawLayout = { top: null, bottom: null }

  if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
    ctx.drawImage(img, 0, 0, W, H)
  } else {
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, '#27272a')
    g.addColorStop(1, '#000000')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }

  const sidePad = Math.max(8, W * 0.03)
  const edgePad = Math.max(6, H * 0.015)

  for (const key of BLOCK_KEYS) {
    const b = blocks[key]
    const raw = b.uppercase ? b.text.toLocaleUpperCase('en-US') : b.text
    if (raw.trim() === '') continue

    const fontPx = Math.max(10, (W * b.sizePct) / 100)
    ctx.font = `${FONT_WEIGHTS[b.fontKey]} ${fontPx}px ${FONT_STACKS[b.fontKey]}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    ctx.miterLimit = 2

    const lines = wrapCanvasText(ctx, raw, Math.max(24, W - sidePad * 2))
    const lineH = fontPx * 1.12
    const totalH = lines.length * lineH

    let firstTop: number
    if (key === 'top') {
      firstTop = clamp(b.yFrac * H, edgePad, Math.max(edgePad, H - totalH - edgePad))
    } else {
      const lastBottom = clamp(b.yFrac * H, Math.min(H - edgePad, totalH + edgePad), H - edgePad)
      firstTop = lastBottom - totalH
    }

    if (b.glowPct > 0) {
      ctx.shadowColor = b.glowColor
      ctx.shadowBlur = (fontPx * b.glowPct) / 100
      ctx.shadowOffsetY = fontPx * 0.04
    }

    lines.forEach((text, i) => {
      const y = firstTop + i * lineH
      if (b.strokePct > 0) {
        ctx.lineWidth = Math.max(1, (W * b.strokePct) / 100)
        ctx.strokeStyle = b.stroke
        ctx.strokeText(text, W / 2, y)
      }
      ctx.fillStyle = b.fill
      ctx.fillText(text, W / 2, y)
    })

    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0

    layout[key] = { centerYFrac: (firstTop + totalH / 2) / H }
  }

  if (watermark) {
    const wmFont = Math.max(9, H * 0.022)
    ctx.font = `600 ${wmFont}px ${FONT_STACKS.system}`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = wmFont * 0.35
    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    ctx.fillText(WATERMARK_TEXT, W - Math.max(8, W * 0.02), H - Math.max(6, H * 0.012))
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.shadowOffsetY = 0
  }

  return layout
}

/* ================================================================== */
/* IndexedDB — 'toolhub-memes' v1, store 'memes' (write-through)       */
/* ================================================================== */

const MEME_DB = 'toolhub-memes'
const MEME_DB_VERSION = 1
const MEME_STORE = 'memes'

let dbPromise: Promise<IDBDatabase> | null = null

function openMemeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MEME_DB, MEME_DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(MEME_STORE)) d.createObjectStore(MEME_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function memeDb(): Promise<IDBDatabase> {
  dbPromise ??= openMemeDb()
  return dbPromise
}

function idbGetAll<T>(store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    memeDb()
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
    memeDb()
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
    memeDb()
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
    memeDb()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).clear()
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB clear failed'))
      })
      .catch(reject)
  })
}

/* ================================================================== */
/* Web Share guard (files)                                             */
/* ================================================================== */

interface ShareFilesNavigator extends Navigator {
  canShare: (data?: ShareData) => boolean
}

/* ================================================================== */
/* Reusable pieces                                                     */
/* ================================================================== */

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
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-medium text-zinc-400">{label}</span>
        <span className="tabular-nums text-zinc-500">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0] ?? value)}
        aria-label={label}
      />
    </div>
  )
}

function ColorSwatch({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      title={label}
      className="size-7 cursor-pointer rounded-md border border-white/15 bg-transparent p-0.5"
    />
  )
}

/* ================================================================== */
/* App                                                                 */
/* ================================================================== */

export default function MemeMakerApp() {
  const { toast } = useToast()

  /* ---------------- refs ---------------- */
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const layoutRef = useRef<DrawLayout>({ top: null, bottom: null })
  const dragRef = useRef<{ block: BlockKey; pointerId: number; moved: boolean } | null>(null)

  /* ---------------- state ---------------- */
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [blocks, setBlocks] = useState<Record<BlockKey, TextBlock>>(defaultBlocks)
  const [preset, setPreset] = useState<PresetKey>('classic')
  const [watermark, setWatermark] = useState(true)
  const [activeBlock, setActiveBlock] = useState<BlockKey | null>(null)
  const [memes, setMemes] = useState<MemeRecord[]>([])
  const [loaded, setLoaded] = useState(false)

  const hasImage = imgUrl !== null && dims !== null

  /* ---------------- image loading (object URLs revoked) ---------------- */
  const loadIntoEditor = useCallback(
    (url: string) => {
      const im = new Image()
      im.onload = () => {
        const prev = urlRef.current
        if (prev && prev !== url && prev.startsWith('blob:')) URL.revokeObjectURL(prev)
        urlRef.current = url
        imgRef.current = im
        setImgUrl(url)
        setDims({ w: im.naturalWidth, h: im.naturalHeight })
      }
      im.onerror = () => {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url)
        toast({ title: 'Could not load image', description: 'Try a different file.', variant: 'destructive' })
      }
      im.src = url
    },
    [toast],
  )

  useEffect(() => {
    return () => {
      const url = urlRef.current
      if (url && url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
  }, [])

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Not an image', description: 'Choose a JPG, PNG, WebP or GIF file.', variant: 'destructive' })
        return
      }
      loadIntoEditor(URL.createObjectURL(file))
      haptic()
      toast({ title: 'Image loaded', description: file.name })
    },
    [loadIntoEditor, toast],
  )

  const loadSample = useCallback(() => {
    const cv = document.createElement('canvas')
    cv.width = 1280
    cv.height = 720
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const g = ctx.createLinearGradient(0, 0, 1280, 720)
    g.addColorStop(0, '#f59e0b')
    g.addColorStop(0.5, '#ef4444')
    g.addColorStop(1, '#7c3aed')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 1280, 720)
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.arc(980, 180, 110, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.beginPath()
    ctx.moveTo(0, 720)
    ctx.quadraticCurveTo(420, 470, 760, 720)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = 'rgba(0,0,0,0.4)'
    ctx.beginPath()
    ctx.moveTo(520, 720)
    ctx.quadraticCurveTo(980, 430, 1280, 720)
    ctx.closePath()
    ctx.fill()
    loadIntoEditor(cv.toDataURL('image/jpeg', 0.9))
    haptic()
    toast({ title: 'Sample background loaded', description: 'Replace it anytime with your own image.' })
  }, [loadIntoEditor, toast])

  /* ---------------- display canvas redraw (no setState in effect body) ---------------- */
  const redraw = useCallback(() => {
    const cv = canvasRef.current
    const wrap = canvasWrapRef.current
    if (!cv || !wrap) return
    const cssW = wrap.clientWidth
    if (cssW < 8) return
    const img = imgRef.current
    const aspect = img && img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 9 / 16
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const W = Math.round(cssW * dpr)
    const H = Math.round(cssW * aspect * dpr)
    if (cv.width !== W) cv.width = W
    if (cv.height !== H) cv.height = H
    const ctx = cv.getContext('2d')
    if (!ctx) return
    layoutRef.current = drawMeme(ctx, W, H, img, blocks, watermark)
  }, [blocks, watermark, imgUrl])

  useEffect(() => {
    redraw()
    const wrap = canvasWrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => redraw())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [redraw])

  /* ---------------- direct manipulation (pointer drag) ---------------- */
  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.height <= 0) return
    const yFrac = (e.clientY - rect.top) / rect.height
    const layout = layoutRef.current
    const topY = layout.top?.centerYFrac
    const bottomY = layout.bottom?.centerYFrac
    let target: BlockKey | null = null
    if (topY !== undefined && bottomY !== undefined) {
      target = Math.abs(yFrac - topY) <= Math.abs(yFrac - bottomY) ? 'top' : 'bottom'
    } else if (topY !== undefined) {
      target = 'top'
    } else if (bottomY !== undefined) {
      target = 'bottom'
    }
    if (!target) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { block: target, pointerId: e.pointerId, moved: false }
    setActiveBlock(target)
    haptic()
  }

  const onCanvasPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.height <= 0) return
    const yFrac = clamp((e.clientY - rect.top) / rect.height, 0, 1)
    drag.moved = true
    const key = drag.block
    setBlocks((prev) => ({ ...prev, [key]: { ...prev[key], yFrac } }))
  }

  const endCanvasDrag = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* capture already released */
    }
    dragRef.current = null
  }

  /* ---------------- block + preset mutations ---------------- */
  const updateBlock = useCallback((key: BlockKey, patch: Partial<TextBlock>) => {
    setBlocks((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))
  }, [])

  const applyPreset = useCallback(
    (key: PresetKey) => {
      const p = PRESETS[key]
      setBlocks((prev) => ({
        top: { ...prev.top, ...p.top },
        bottom: { ...prev.bottom, ...p.bottom },
      }))
      setPreset(key)
      setWatermark(p.watermark)
      haptic()
      toast({ title: `${p.label} style applied`, description: p.blurb })
    },
    [toast],
  )

  /* ---------------- export helpers ---------------- */
  const renderExportDataUrl = useCallback(
    (mime: 'image/png' | 'image/jpeg', quality = 0.92): string | null => {
      const img = imgRef.current
      if (!img || img.naturalWidth === 0) return null
      const scale = Math.min(1, MAX_EXPORT_DIM / Math.max(img.naturalWidth, img.naturalHeight))
      const W = Math.max(1, Math.round(img.naturalWidth * scale))
      const H = Math.max(1, Math.round(img.naturalHeight * scale))
      const cv = document.createElement('canvas')
      cv.width = W
      cv.height = H
      const ctx = cv.getContext('2d')
      if (!ctx) return null
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#000000'
        ctx.fillRect(0, 0, W, H)
      }
      drawMeme(ctx, W, H, img, blocks, watermark)
      return cv.toDataURL(mime, quality)
    },
    [blocks, watermark],
  )

  /** PNG first, then progressively compressed JPEG — first under the cap wins. */
  const encodeForSave = useCallback((): { dataUrl: string; ext: 'png' | 'jpg' } | null => {
    const png = renderExportDataUrl('image/png')
    if (png && dataUrlBytes(png) <= MAX_SAVE_BYTES) return { dataUrl: png, ext: 'png' }
    const q90 = renderExportDataUrl('image/jpeg', 0.9)
    if (q90 && dataUrlBytes(q90) <= MAX_SAVE_BYTES) return { dataUrl: q90, ext: 'jpg' }
    const q75 = renderExportDataUrl('image/jpeg', 0.75)
    if (q75 && dataUrlBytes(q75) <= MAX_SAVE_BYTES) return { dataUrl: q75, ext: 'jpg' }
    return null
  }, [renderExportDataUrl])

  const requireImage = useCallback((): boolean => {
    if (hasImage) return true
    toast({ title: 'Pick an image first', description: 'Choose a photo to meme-ify.', variant: 'destructive' })
    return false
  }, [hasImage, toast])

  const downloadAs = useCallback(
    (mime: 'image/png' | 'image/jpeg') => {
      if (!requireImage()) return
      const dataUrl = renderExportDataUrl(mime)
      if (!dataUrl) {
        toast({ title: 'Export failed', description: 'The canvas could not be rendered.', variant: 'destructive' })
        return
      }
      const ext = mime === 'image/png' ? 'png' : 'jpg'
      const filename = `meme-${Date.now()}.${ext}`
      triggerDownload(dataUrl, filename)
      haptic()
      toast({ title: 'Downloaded', description: filename })
    },
    [renderExportDataUrl, requireImage, toast],
  )

  const shareMeme = useCallback(async () => {
    if (!requireImage()) return
    const dataUrl = renderExportDataUrl('image/png')
    if (!dataUrl) {
      toast({ title: 'Export failed', description: 'The canvas could not be rendered.', variant: 'destructive' })
      return
    }
    const filename = `meme-${Date.now()}.png`
    const blob = dataUrlToBlob(dataUrl)
    if (!blob) {
      triggerDownload(dataUrl, filename)
      toast({ title: 'Sharing not available here', description: 'Downloaded the PNG instead.' })
      return
    }
    const file = new File([blob], filename, { type: 'image/png' })
    const nav = navigator as ShareFilesNavigator
    const canShareFiles =
      typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })
    if (!canShareFiles) {
      triggerDownload(dataUrl, filename)
      toast({ title: 'Sharing not supported here', description: 'Downloaded the PNG — share it from your Files app.' })
      return
    }
    try {
      await nav.share({
        files: [file],
        title: 'My ToolHub meme',
        text: blocks.top.text || blocks.bottom.text || 'Made with ToolHub Meme Maker',
      })
      haptic()
      toast({ title: 'Shared', description: `${filename} is on its way.` })
    } catch {
      /* user dismissed the share sheet — nothing to do */
    }
  }, [blocks.bottom.text, blocks.top.text, renderExportDataUrl, requireImage, toast])

  /* ---------------- Gallery write (shared toolhub-media store) ---------------- */
  const saveToGallery = useCallback(async () => {
    if (!requireImage()) return
    const pick = encodeForSave()
    if (!pick) {
      toast({
        title: 'Image too large for Gallery',
        description: 'Could not encode it under 2.5 MB — try downloading instead.',
        variant: 'destructive',
      })
      return
    }
    try {
      await putPhoto({
        id: newPhotoId(),
        dataUrl: pick.dataUrl,
        createdAt: Date.now(),
        fav: false,
        source: 'design',
        name: `meme-${Date.now()}.${pick.ext}`,
      })
      haptic()
      toast({ title: 'Saved to Gallery', description: 'Open the Gallery app to see it.' })
    } catch {
      toast({ title: 'Could not save to Gallery', description: 'Storage may be full or unavailable.', variant: 'destructive' })
    }
  }, [encodeForSave, requireImage, toast])

  /* ---------------- saved memes (toolhub-memes / memes) ---------------- */
  const saveMeme = useCallback(() => {
    if (!requireImage()) return
    const pick = encodeForSave()
    if (!pick) {
      toast({
        title: 'Meme too large to save',
        description: 'It exceeds the 2.5 MB limit — try downloading instead.',
        variant: 'destructive',
      })
      return
    }
    const rec: MemeRecord = {
      id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      imageDataUrl: pick.dataUrl,
      topText: blocks.top.text,
      bottomText: blocks.bottom.text,
      createdAt: Date.now(),
      style: {
        preset,
        watermark,
        top: styleOf(blocks.top),
        bottom: styleOf(blocks.bottom),
      },
    }
    setMemes((prev) => [rec, ...prev])
    void idbPut(MEME_STORE, rec).catch(() => {
      toast({ title: 'Could not save meme', description: 'Storage may be unavailable.', variant: 'destructive' })
    })
    haptic()
    toast({ title: 'Meme saved', description: 'Tap a thumbnail below to keep editing.' })
  }, [blocks.bottom, blocks.top, encodeForSave, preset, requireImage, toast, watermark])

  const restoreMeme = useCallback(
    (rec: MemeRecord) => {
      loadIntoEditor(rec.imageDataUrl)
      setBlocks((prev) => ({
        top: { ...prev.top, text: rec.topText, ...(rec.style?.top ?? {}) },
        bottom: { ...prev.bottom, text: rec.bottomText, ...(rec.style?.bottom ?? {}) },
      }))
      if (rec.style) {
        setPreset(rec.style.preset)
        setWatermark(rec.style.watermark)
      }
      haptic()
      toast({ title: 'Meme restored', description: 'Image, texts and style are back in the editor.' })
    },
    [loadIntoEditor, toast],
  )

  const deleteMeme = useCallback(
    (id: string) => {
      setMemes((prev) => prev.filter((m) => m.id !== id))
      void idbDelete(MEME_STORE, id).catch(() => {
        /* memory-only fallback */
      })
      haptic()
      toast({ title: 'Meme deleted' })
    },
    [toast],
  )

  const clearMemes = useCallback(() => {
    setMemes([])
    void idbClear(MEME_STORE).catch(() => {
      /* memory-only fallback */
    })
    haptic()
    toast({ title: 'Saved memes cleared' })
  }, [toast])

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const all = await idbGetAll<MemeRecord>(MEME_STORE)
        if (!alive) return
        all.sort((a, b) => b.createdAt - a.createdAt)
        setMemes(all)
      } catch {
        /* private mode / quota — keep in-memory data */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ================================================================== */
  /* Render                                                             */
  /* ================================================================== */

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-zinc-100">
      <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-5 sm:px-5">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="space-y-4"
        >
          {/* ---------------- Identity header ---------------- */}
          <header className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-yellow-400 via-orange-500 to-red-600 p-5 shadow-[0_18px_44px_-18px_rgb(249_115_22/0.55)]">
            <MessageSquareQuote
              className="pointer-events-none absolute -right-4 -top-4 size-28 text-white/15"
              strokeWidth={1.4}
              aria-hidden
            />
            <div className="relative flex items-center gap-4">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white ring-1 ring-white/40 backdrop-blur-sm">
                <Laugh className="size-7" strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-black tracking-tight text-white drop-shadow-sm">Meme Maker</h1>
                <p className="text-xs font-medium text-white/90">
                  Top text, bottom text, instant classic — nothing leaves your phone.
                </p>
              </div>
            </div>
          </header>

          {/* ---------------- Editor ---------------- */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <AnimatePresence mode="wait" initial={false}>
              {!hasImage ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                  className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-white/15 bg-black/20 p-6 text-center"
                >
                  <span className="grid size-14 place-items-center rounded-2xl bg-white/5 text-zinc-400">
                    <ImageIcon className="size-7" aria-hidden />
                  </span>
                  <h2 className="mt-3 text-sm font-bold tracking-tight">Start with an image</h2>
                  <p className="mt-1 max-w-xs text-xs text-zinc-500">
                    Pick a picture from your device, or try a generated sample background.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <Button
                      onClick={() => fileRef.current?.click()}
                      className="h-11 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-300 hover:to-orange-400"
                    >
                      <ImagePlus className="size-4" aria-hidden /> Pick an image
                    </Button>
                    <Button
                      onClick={loadSample}
                      variant="outline"
                      className="h-11 rounded-xl border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
                    >
                      <WandSparkles className="size-4" aria-hidden /> Sample background
                    </Button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="editor"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                >
                  <div
                    ref={canvasWrapRef}
                    className="w-full max-w-full overflow-hidden rounded-xl border border-white/10 bg-black/40"
                  >
                    <canvas
                      ref={canvasRef}
                      className="block h-auto w-full select-none touch-none"
                      onPointerDown={onCanvasPointerDown}
                      onPointerMove={onCanvasPointerMove}
                      onPointerUp={endCanvasDrag}
                      onPointerCancel={endCanvasDrag}
                      aria-label="Meme editor canvas — drag the top or bottom text to reposition it"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Move className="size-3.5 shrink-0 text-amber-400" aria-hidden />
                      Drag the text on the image to move it
                    </span>
                    {dims && (
                      <span className="shrink-0 tabular-nums">
                        {dims.w}×{dims.h}px
                      </span>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Action grid */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Button
                onClick={() => downloadAs('image/png')}
                disabled={!hasImage}
                className="h-11 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-zinc-950 shadow-md hover:from-amber-300 hover:to-orange-400"
              >
                <Download className="size-4" aria-hidden /> PNG
              </Button>
              <Button
                onClick={() => downloadAs('image/jpeg')}
                disabled={!hasImage}
                variant="outline"
                className="h-11 rounded-xl border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
              >
                <FileImage className="size-4" aria-hidden /> JPEG
              </Button>
              <Button
                onClick={() => void shareMeme()}
                disabled={!hasImage}
                variant="outline"
                className="h-11 rounded-xl border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
              >
                <Share2 className="size-4" aria-hidden /> Share
              </Button>
              <Button
                onClick={() => void saveToGallery()}
                disabled={!hasImage}
                variant="outline"
                className="h-11 rounded-xl border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
              >
                <Images className="size-4" aria-hidden /> Gallery
              </Button>
              <Button
                onClick={saveMeme}
                disabled={!hasImage}
                variant="outline"
                className="h-11 rounded-xl border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
              >
                <Save className="size-4" aria-hidden /> Save
              </Button>
              <Button
                onClick={() => fileRef.current?.click()}
                variant="outline"
                className="h-11 rounded-xl border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
              >
                <ImagePlus className="size-4" aria-hidden /> Change
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
                e.target.value = ''
              }}
            />
          </section>

          {/* ---------------- Style presets ---------------- */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-tight">
              <WandSparkles className="size-4 text-amber-400" aria-hidden /> Style presets
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {PRESET_ORDER.map((key) => {
                const p = PRESETS[key]
                const s = p.top
                const preview: CSSProperties = { fontFamily: FONT_STACKS[s.fontKey], color: s.fill }
                if (s.strokePct > 0) preview.WebkitTextStroke = `1px ${s.stroke}`
                if (s.glowPct > 0) preview.textShadow = `0 0 7px ${s.glowColor}`
                return (
                  <motion.button
                    key={key}
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 24 }}
                    onClick={() => applyPreset(key)}
                    aria-pressed={preset === key}
                    className={cn(
                      'flex min-h-11 items-center gap-2 rounded-xl border p-2 text-left transition-colors',
                      preset === key
                        ? 'border-amber-400/50 bg-amber-400/10'
                        : 'border-white/10 bg-white/5 hover:bg-white/10',
                    )}
                  >
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-lg bg-black/40 text-sm font-black"
                      style={preview}
                      aria-hidden
                    >
                      Aa
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-semibold">{p.label}</span>
                      <span className="block truncate text-[10px] text-zinc-500">{p.blurb}</span>
                    </span>
                  </motion.button>
                )
              })}
            </div>
          </section>

          {/* ---------------- Text blocks ---------------- */}
          <section className="space-y-3">
            {BLOCK_KEYS.map((key) => {
              const b = blocks[key]
              return (
                <div
                  key={key}
                  onPointerDown={() => setActiveBlock(key)}
                  className={cn(
                    'rounded-2xl border p-4 transition-colors',
                    activeBlock === key
                      ? 'border-amber-400/40 bg-white/[0.07]'
                      : 'border-white/10 bg-white/5',
                  )}
                >
                  <div className="mb-2.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-amber-400">
                      {key === 'top' ? 'Top text' : 'Bottom text'}
                      {activeBlock === key && (
                        <span className="size-1.5 rounded-full bg-amber-400" aria-hidden />
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateBlock(key, { yFrac: PRESETS[preset][key].yFrac })}
                      className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                      aria-label={`Reset ${key} text position`}
                      title="Reset position"
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                    </button>
                  </div>

                  <Input
                    value={b.text}
                    onChange={(e) => updateBlock(key, { text: e.target.value })}
                    placeholder={key === 'top' ? 'TOP TEXT' : 'BOTTOM TEXT'}
                    aria-label={`${key} meme text`}
                    className="h-11 border-white/10 bg-black/30 text-sm font-semibold placeholder:text-zinc-600"
                    style={{ textTransform: b.uppercase ? 'uppercase' : 'none' }}
                  />

                  <div className="mt-3 space-y-3">
                    <SliderRow
                      label="Position"
                      value={Math.round(b.yFrac * 100)}
                      min={0}
                      max={100}
                      step={1}
                      display={`${Math.round(b.yFrac * 100)}%`}
                      onChange={(v) => updateBlock(key, { yFrac: v / 100 })}
                    />
                    <SliderRow
                      label="Font size"
                      value={b.sizePct}
                      min={4}
                      max={18}
                      step={0.5}
                      display={`${b.sizePct.toFixed(1)}% w`}
                      onChange={(v) => updateBlock(key, { sizePct: v })}
                    />
                    <SliderRow
                      label="Stroke"
                      value={b.strokePct}
                      min={0}
                      max={3}
                      step={0.1}
                      display={b.strokePct === 0 ? 'off' : `${b.strokePct.toFixed(1)}% w`}
                      onChange={(v) => updateBlock(key, { strokePct: Math.round(v * 10) / 10 })}
                    />
                    <SliderRow
                      label="Glow"
                      value={b.glowPct}
                      min={0}
                      max={100}
                      step={5}
                      display={b.glowPct === 0 ? 'off' : `${b.glowPct}%`}
                      onChange={(v) => updateBlock(key, { glowPct: v })}
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
                    <label className="flex items-center gap-2 text-xs font-medium text-zinc-300">
                      <Switch
                        checked={b.uppercase}
                        onCheckedChange={(c) => updateBlock(key, { uppercase: c })}
                        aria-label={`Uppercase ${key} text`}
                      />
                      UPPERCASE
                    </label>
                    <div className="flex items-center gap-2">
                      <ColorSwatch
                        label={`Fill color (${key})`}
                        value={b.fill}
                        onChange={(v) => updateBlock(key, { fill: v })}
                      />
                      <ColorSwatch
                        label={`Stroke color (${key})`}
                        value={b.stroke}
                        onChange={(v) => updateBlock(key, { stroke: v })}
                      />
                    </div>
                  </div>
                </div>
              )
            })}

            {/* Watermark */}
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/5 text-zinc-300">
                  <Stamp className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold tracking-tight">Watermark</p>
                  <p className="text-[11px] text-zinc-500">Stamp “{WATERMARK_TEXT}” in the corner</p>
                </div>
              </div>
              <Switch checked={watermark} onCheckedChange={setWatermark} aria-label="Toggle watermark" />
            </div>
          </section>

          {/* ---------------- Saved memes ---------------- */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold tracking-tight">
                <History className="size-4 text-amber-400" aria-hidden /> Saved memes
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-400">
                  {memes.length}
                </span>
              </h2>
              {memes.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      className="h-11 gap-1.5 rounded-xl px-3 text-xs text-zinc-400 hover:bg-white/10 hover:text-red-400"
                    >
                      <Trash2 className="size-3.5" aria-hidden /> Clear all
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="border border-white/10 bg-zinc-950 text-zinc-100">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clear all saved memes?</AlertDialogTitle>
                      <AlertDialogDescription className="text-zinc-400">
                        All {memes.length} saved meme{memes.length === 1 ? '' : 's'} will be permanently removed
                        from this device. Downloaded copies are not affected.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="h-11 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white">
                        Keep them
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={clearMemes}
                        className="h-11 rounded-xl bg-red-600 font-semibold text-white hover:bg-red-500"
                      >
                        Clear all
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            {!loaded ? (
              <div className="flex gap-3 overflow-hidden">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-24 w-24 shrink-0 animate-pulse rounded-xl bg-white/[0.05] sm:h-28 sm:w-28" />
                ))}
              </div>
            ) : memes.length === 0 ? (
              <p className="py-6 text-center text-xs text-zinc-500">
                Nothing saved yet — tap <span className="font-semibold text-zinc-300">Save</span> after exporting and
                your memes will live here on this device.
              </p>
            ) : (
              <div
                className={cn('flex max-h-40 gap-3 overflow-x-auto pb-1 pt-1', SCROLL_X)}
                role="list"
                aria-label="Saved memes"
              >
                {memes.map((m) => (
                  <motion.div
                    key={m.id}
                    role="listitem"
                    layout
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                    className="group relative shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() => restoreMeme(m)}
                      className="block size-24 overflow-hidden rounded-xl border border-white/10 bg-black/40 transition-transform active:scale-95 sm:size-28"
                      aria-label={`Restore meme: ${m.topText || m.bottomText || 'untitled'}`}
                    >
                      <img
                        src={m.imageDataUrl}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        className="h-full w-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMeme(m.id)}
                      className="absolute -right-1.5 -top-1.5 flex size-9 items-center justify-center rounded-full border border-white/10 bg-zinc-900 text-zinc-400 transition-colors hover:text-red-400"
                      aria-label={`Delete meme: ${m.topText || m.bottomText || 'untitled'}`}
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                    <p className="mt-1 w-24 truncate text-center text-[10px] text-zinc-500 sm:w-28">
                      {m.topText || m.bottomText || 'Untitled'}
                    </p>
                  </motion.div>
                ))}
              </div>
            )}
          </section>

          <p className="pb-2 text-center text-[10px] text-zinc-600">
            Everything is processed on this device — no uploads, ever.
          </p>
        </motion.div>
      </div>
    </div>
  )
}
