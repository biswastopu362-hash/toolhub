'use client'

/**
 * Photo Editor (v2) — a pocket darkroom.
 *
 * Editor tab: canvas pipeline with brightness/contrast/saturation sliders,
 * filter presets, rotate/flip, aspect-guided draggable crop, and a draggable
 * before/after compare divider. Saves to the shared Gallery (IndexedDB
 * 'toolhub-media' / 'photos') or downloads — everything on-device.
 *
 * Tools tab: the v1 feature set — compress, resize and convert — kept intact.
 *
 * Memory: imports are capped at 2560 px on the long edge (downscaled once on
 * import); previews render at ≤1280 px; exports render at full working res.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  Columns2,
  Crop,
  Download,
  FlipHorizontal2,
  GalleryHorizontalEnd,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Lock,
  LockOpen,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { listPhotos, newPhotoId, putPhoto, type PhotoRecord } from '@/lib/media-db'

/* ================================================================== */
/* Constants & model                                                   */
/* ================================================================== */

const MAX_BYTES = 20 * 1024 * 1024 // 20 MB import limit
const MAX_EDGE = 2560 // working-resolution cap (long edge)
const PREVIEW_EDGE = 1280 // preview canvas cap (long edge)
const CROP_MIN = 0.08 // minimum crop size, normalized

type TargetFormat = 'image/png' | 'image/jpeg' | 'image/webp'

const EXTENSIONS: Record<TargetFormat, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

const FORMAT_LABELS: Record<TargetFormat, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
}

interface SrcImage {
  el: HTMLImageElement
  width: number
  height: number
  name: string
  bytes: number
  mime: string
  downscaled: boolean
}

interface ResultInfo {
  url: string
  blob: Blob
  width: number
  height: number
  mime: TargetFormat
  suffix: string
}

interface CropRect {
  /** all normalized 0..1 against the displayed (rotated) image box */
  x: number
  y: number
  w: number
  h: number
}

const DEFAULT_CROP: CropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }

interface FilterPreset {
  id: string
  label: string
  filter: string
}

const PRESETS: FilterPreset[] = [
  { id: 'none', label: 'None', filter: '' },
  { id: 'vivid', label: 'Vivid', filter: 'saturate(1.4) contrast(1.15)' },
  { id: 'mono', label: 'Mono', filter: 'grayscale(1) contrast(1.08)' },
  { id: 'sepia', label: 'Sepia', filter: 'sepia(0.6)' },
  { id: 'cool', label: 'Cool', filter: 'hue-rotate(-18deg) saturate(1.1) brightness(1.04)' },
  { id: 'warm', label: 'Warm', filter: 'sepia(0.22) saturate(1.2) hue-rotate(-8deg)' },
  { id: 'fade', label: 'Fade', filter: 'contrast(0.82) brightness(1.12) saturate(0.85)' },
  { id: 'dramatic', label: 'Dramatic', filter: 'contrast(1.4) saturate(1.3) brightness(0.94)' },
]

interface AspectPreset {
  id: string
  label: string
  /** width / height in pixels; 0 = free */
  ratio: number
}

const ASPECTS: AspectPreset[] = [
  { id: 'free', label: 'Free', ratio: 0 },
  { id: '1:1', label: '1:1', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
]

type HandleId = 'nw' | 'ne' | 'sw' | 'se'
type DragMode = 'move' | HandleId

const HANDLE_POS: Record<HandleId, string> = {
  nw: '-left-5.5 -top-5.5 cursor-nwse-resize',
  ne: '-right-5.5 -top-5.5 cursor-nesw-resize',
  sw: '-left-5.5 -bottom-5.5 cursor-nesw-resize',
  se: '-right-5.5 -bottom-5.5 cursor-nwse-resize',
}

/* Dark-glass override for the shadcn Slider inside the zinc-950 card */
const SLIDER_CLS =
  '[&_[data-slot=slider-track]]:bg-white/10 [&_[data-slot=slider-range]]:bg-gradient-to-r [&_[data-slot=slider-range]]:from-fuchsia-500 [&_[data-slot=slider-range]]:to-pink-600 [&_[data-slot=slider-thumb]]:border-fuchsia-400 [&_[data-slot=slider-thumb]]:bg-zinc-950'

const INPUT_CLS =
  'h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors focus:border-fuchsia-400/60 focus:ring-2 focus:ring-fuchsia-500/20'

const SELECT_CLS = `${INPUT_CLS} [color-scheme:dark] appearance-none`

const CHECKER_STYLE: React.CSSProperties = {
  backgroundImage:
    'conic-gradient(rgb(39 39 42) 0% 25%, rgb(24 24 27) 0% 50%, rgb(39 39 42) 0% 75%, rgb(24 24 27) 0%)',
  backgroundSize: '16px 16px',
}

/* ================================================================== */
/* Pure helpers                                                        */
/* ================================================================== */

function haptic() {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString('en-US')} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('en-US', { maximumFractionDigits: 2 })} MB`
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'image'
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = src
  })
}

/**
 * Draw `el` rotated by `rot` degrees CW and optionally flipped horizontally,
 * filling a target rect of `tw × th` (the rotated frame rw×rh mapped onto it —
 * uniform when the aspect matches, stretched for free-form resize).
 */
function drawT(
  ctx: CanvasRenderingContext2D,
  el: HTMLImageElement,
  w: number,
  h: number,
  rot: number,
  flipH: boolean,
  tw: number,
  th: number
) {
  const rw = rot % 180 === 0 ? w : h
  const rh = rot % 180 === 0 ? h : w
  ctx.save()
  ctx.translate(tw / 2, th / 2)
  ctx.scale(tw / rw, th / rh)
  ctx.rotate((rot * Math.PI) / 180)
  if (flipH) ctx.scale(-1, 1)
  ctx.drawImage(el, -w / 2, -h / 2, w, h)
  ctx.restore()
}

/** One combined ctx.filter string: preset base × manual sliders on top. */
function buildFilter(presetId: string, brightness: number, contrast: number, saturation: number): string {
  const preset = PRESETS.find((p) => p.id === presetId)?.filter ?? ''
  const manual = `brightness(${brightness / 100}) contrast(${contrast / 100}) saturate(${saturation / 100})`
  return preset ? `${preset} ${manual}` : manual
}

/** Next crop rect after a drag, honoring aspect (ratio = px w / px h). */
function cropRectAfterDrag(
  mode: DragMode,
  start: CropRect,
  dx: number,
  dy: number,
  rw: number,
  rh: number,
  ratio: number
): CropRect {
  if (mode === 'move') {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    }
  }

  let l = start.x
  let t = start.y
  let r = start.x + start.w
  let b = start.y + start.h

  if (mode.includes('w')) l = clamp(start.x + dx, 0, r - CROP_MIN)
  if (mode.includes('e')) r = clamp(start.x + start.w + dx, l + CROP_MIN, 1)
  if (mode.includes('n')) t = clamp(start.y + dy, 0, b - CROP_MIN)
  if (mode.includes('s')) b = clamp(start.y + start.h + dy, t + CROP_MIN, 1)

  let w = r - l
  let h = b - t

  if (ratio > 0) {
    /* normalized h per unit normalized w so that (w·rw)/(h·rh) = ratio */
    const nhPerNw = rw / (ratio * rh)
    const horiz = mode.includes('e') || mode.includes('w')
    if (horiz) {
      h = w * nhPerNw
      if (h > 1) {
        h = 1
        w = h / nhPerNw
      }
    } else {
      w = h / nhPerNw
      if (w > 1) {
        w = 1
        h = w * nhPerNw
      }
    }
    if (mode.includes('w')) l = r - w
    if (mode.includes('n')) t = b - h
    l = clamp(l, 0, 1 - w)
    t = clamp(t, 0, 1 - h)
  }

  return { x: l, y: t, w, h }
}

/* ================================================================== */
/* Small presentational bits                                           */
/* ================================================================== */

function ToolButton({
  icon: Icon,
  label,
  active,
  disabled,
  title,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  active?: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-pressed={active}
      className={cn(
        'flex h-14 flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-semibold transition-all',
        active
          ? 'border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-200'
          : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/10 hover:text-white',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      <Icon className="size-4.5" aria-hidden />
      {label}
    </button>
  )
}

function AdjustSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-zinc-300">{label}</span>
        <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-bold tabular-nums text-zinc-300">
          {value}%
        </span>
      </div>
      <Slider
        min={0}
        max={200}
        step={1}
        value={[value]}
        onValueChange={(v) => onChange(v[0] ?? 100)}
        aria-label={label}
        className={SLIDER_CLS}
      />
    </div>
  )
}

function Badge({ children, tone = 'zinc' }: { children: React.ReactNode; tone?: 'zinc' | 'emerald' }) {
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
        tone === 'emerald' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-zinc-300'
      )}
    >
      {children}
    </span>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function ImageToolsTool() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [tab, setTab] = useState<'editor' | 'tools'>('editor')
  const [src, setSrc] = useState<SrcImage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busyLoad, setBusyLoad] = useState(false)

  /* editor state */
  const [rot, setRot] = useState(0)
  const [flipH, setFlipH] = useState(false)
  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [saturation, setSaturation] = useState(100)
  const [presetId, setPresetId] = useState('none')
  const [compare, setCompare] = useState(false)
  const [compareX, setCompareX] = useState(0.5)
  const [cropMode, setCropMode] = useState(false)
  const [aspectId, setAspectId] = useState('free')
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP)
  const [baking, setBaking] = useState(false)
  const [saving, setSaving] = useState(false)

  /* tools state (v1 feature set) */
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ResultInfo | null>(null)
  const [quality, setQuality] = useState(80)
  const [compressFormat, setCompressFormat] = useState<TargetFormat>('image/jpeg')
  const [resizeWidth, setResizeWidth] = useState('')
  const [resizeHeight, setResizeHeight] = useState('')
  const [lockAspect, setLockAspect] = useState(true)
  const [resizeFormat, setResizeFormat] = useState<'keep' | TargetFormat>('keep')
  const [convertFormat, setConvertFormat] = useState<TargetFormat>('image/png')
  const [convertQuality, setConvertQuality] = useState(90)

  /* gallery picker */
  const [galleryOpen, setGalleryOpen] = useState(false)
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [galleryPhotos, setGalleryPhotos] = useState<PhotoRecord[]>([])

  /* ---------------- refs ---------------- */
  const inputRef = useRef<HTMLInputElement>(null)
  const editCanvasRef = useRef<HTMLCanvasElement>(null)
  const origCanvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const resultUrlRef = useRef<string | null>(null)
  const cropDragRef = useRef<{ mode: DragMode; startX: number; startY: number; rect: CropRect } | null>(null)
  const compareDragRef = useRef(false)

  /* ---------------- derived ---------------- */
  const rw = src ? (rot % 180 === 0 ? src.width : src.height) : 0
  const rh = src ? (rot % 180 === 0 ? src.height : src.width) : 0

  const filterStr = useMemo(
    () => buildFilter(presetId, brightness, contrast, saturation),
    [presetId, brightness, contrast, saturation]
  )

  const aspectRatio = ASPECTS.find((a) => a.id === aspectId)?.ratio ?? 0

  const resultFilename = result && src ? `${baseName(src.name)}${result.suffix}.${EXTENSIONS[result.mime]}` : ''
  const savedPct = result && src ? Math.round((1 - result.blob.size / src.bytes) * 100) : 0

  /* ---------------- cleanup ---------------- */

  const clearResult = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    setResult(null)
  }, [])

  useEffect(() => {
    return () => {
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    }
  }, [])

  /* ---------------- import pipeline ---------------- */

  const loadFile = useCallback(
    async (f: File) => {
      if (!f.type.startsWith('image/')) {
        setError(`"${f.name}" is not an image file. Please choose a PNG, JPEG, WebP or GIF image.`)
        return
      }
      if (f.size > MAX_BYTES) {
        setError(
          `"${f.name}" is ${formatBytes(f.size)}, which is larger than the 20 MB limit. Please choose a smaller image.`
        )
        return
      }

      setError(null)
      setBusyLoad(true)
      try {
        const url = URL.createObjectURL(f)
        let el: HTMLImageElement
        try {
          el = await loadHtmlImage(url)
        } finally {
          URL.revokeObjectURL(url)
        }

        let w = el.naturalWidth
        let h = el.naturalHeight
        let downscaled = false

        /* cap working resolution at 2560 px on the long edge */
        const long = Math.max(w, h)
        if (long > MAX_EDGE) {
          const s = MAX_EDGE / long
          const cw = Math.max(1, Math.round(w * s))
          const ch = Math.max(1, Math.round(h * s))
          const c = document.createElement('canvas')
          c.width = cw
          c.height = ch
          const cx = c.getContext('2d')
          if (!cx) throw new Error('Canvas unavailable')
          cx.imageSmoothingEnabled = true
          cx.imageSmoothingQuality = 'high'
          cx.drawImage(el, 0, 0, cw, ch)
          el = await loadHtmlImage(c.toDataURL(f.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.92))
          w = cw
          h = ch
          downscaled = true
        }

        clearResult()
        setSrc({ el, width: w, height: h, name: f.name, bytes: f.size, mime: f.type, downscaled })
        setRot(0)
        setFlipH(false)
        setBrightness(100)
        setContrast(100)
        setSaturation(100)
        setPresetId('none')
        setCompare(false)
        setCompareX(0.5)
        setCropMode(false)
        setAspectId('free')
        setCrop(DEFAULT_CROP)

        if (downscaled) {
          toast({
            title: 'Image downscaled',
            description: `Large photos are capped at ${MAX_EDGE.toLocaleString('en-US')} px on the long edge for smooth editing.`,
          })
        }
      } catch {
        setError('This file could not be decoded as an image. It may be corrupted or an unsupported format.')
      } finally {
        setBusyLoad(false)
      }
    },
    [clearResult, toast]
  )

  const importFromGallery = useCallback(
    async (rec: PhotoRecord) => {
      setGalleryOpen(false)
      try {
        const blob = await (await fetch(rec.dataUrl)).blob()
        const f = new File([blob], rec.name || 'gallery-photo.jpg', { type: blob.type || 'image/jpeg' })
        await loadFile(f)
      } catch {
        toast({ title: 'Could not open that photo', variant: 'destructive' })
      }
    },
    [loadFile, toast]
  )

  const openGallery = useCallback(async () => {
    setGalleryOpen(true)
    setGalleryLoading(true)
    try {
      setGalleryPhotos(await listPhotos())
    } catch {
      setGalleryPhotos([])
    } finally {
      setGalleryLoading(false)
    }
  }, [])

  /* ---------------- canvas rendering ---------------- */

  const renderLayer = useCallback(
    (canvas: HTMLCanvasElement | null, filter: string | null) => {
      if (!canvas || !src) return
      const layerW = rot % 180 === 0 ? src.width : src.height
      const layerH = rot % 180 === 0 ? src.height : src.width
      const cap = Math.min(1, PREVIEW_EDGE / Math.max(layerW, layerH))
      const cw = Math.max(1, Math.round(layerW * cap))
      const ch = Math.max(1, Math.round(layerH * cap))
      if (canvas.width !== cw) canvas.width = cw
      if (canvas.height !== ch) canvas.height = ch
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, cw, ch)
      if (filter) ctx.filter = filter
      drawT(ctx, src.el, src.width, src.height, rot, flipH, cw, ch)
      if (filter) ctx.filter = 'none'
    },
    [src, rot, flipH]
  )

  /* edited layer: redraw on any visual change (and when the tab remounts the canvas) */
  useEffect(() => {
    renderLayer(editCanvasRef.current, filterStr)
  }, [renderLayer, filterStr, tab])

  /* original layer: geometry only — unaffected by slider/filter changes */
  useEffect(() => {
    renderLayer(origCanvasRef.current, null)
  }, [renderLayer, tab])

  /* ---------------- full-res export ---------------- */

  const exportDataUrl = useCallback(async (): Promise<{ dataUrl: string; w: number; h: number }> => {
    if (!src) throw new Error('No image loaded')
    const c = document.createElement('canvas')
    c.width = rw
    c.height = rh
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('Canvas is not supported in this browser')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rw, rh)
    ctx.filter = filterStr
    drawT(ctx, src.el, src.width, src.height, rot, flipH, rw, rh)
    ctx.filter = 'none'
    return { dataUrl: c.toDataURL('image/jpeg', 0.9), w: rw, h: rh }
  }, [src, rw, rh, rot, flipH, filterStr])

  const saveToGallery = useCallback(async () => {
    if (!src || saving) return
    setSaving(true)
    try {
      const { dataUrl, w, h } = await exportDataUrl()
      const name = `${baseName(src.name)}-edited.jpg`
      await putPhoto({
        id: newPhotoId(),
        dataUrl,
        createdAt: Date.now(),
        fav: false,
        source: 'upload',
        name,
      })
      haptic()
      toast({ title: 'Saved to Gallery ✓', description: `${name} · ${w} × ${h} px` })
    } catch (e) {
      toast({
        title: 'Could not save',
        description: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [src, saving, exportDataUrl, toast])

  const downloadEdited = useCallback(async () => {
    if (!src) return
    try {
      const { dataUrl, w, h } = await exportDataUrl()
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `${baseName(src.name)}-edited.jpg`
      a.click()
      haptic()
      toast({ title: 'Download started ✓', description: `${w} × ${h} px JPEG` })
    } catch (e) {
      toast({
        title: 'Could not export',
        description: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'destructive',
      })
    }
  }, [src, exportDataUrl, toast])

  /* ---------------- editor actions ---------------- */

  const rotateCw = useCallback(() => {
    haptic()
    setRot((r) => (r + 90) % 360)
  }, [])

  const toggleFlip = useCallback(() => {
    haptic()
    setFlipH((v) => !v)
  }, [])

  const toggleCrop = useCallback(() => {
    haptic()
    setCropMode((v) => !v)
    setCompare(false)
  }, [])

  const toggleCompare = useCallback(() => {
    haptic()
    setCompare((v) => !v)
  }, [])

  const resetAdjustments = useCallback(() => {
    haptic()
    setBrightness(100)
    setContrast(100)
    setSaturation(100)
  }, [])

  const applyAspect = useCallback(
    (a: AspectPreset) => {
      setAspectId(a.id)
      if (!src || a.ratio === 0) return
      /* normalized h per unit normalized w for this ratio on the rotated frame */
      const nhPerNw = rw / (a.ratio * rh)
      let w = 0.9
      let h = w * nhPerNw
      if (h > 0.9) {
        h = 0.9
        w = h / nhPerNw
      }
      setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h })
    },
    [src, rw, rh]
  )

  const cancelCrop = useCallback(() => {
    setCropMode(false)
    setAspectId('free')
    setCrop(DEFAULT_CROP)
  }, [])

  const applyCrop = useCallback(async () => {
    if (!src || baking) return
    setBaking(true)
    try {
      /* bake the current rotation/flip, then cut the crop rect out of it */
      const layer = document.createElement('canvas')
      layer.width = rw
      layer.height = rh
      const lctx = layer.getContext('2d')
      if (!lctx) throw new Error('Canvas unavailable')
      drawT(lctx, src.el, src.width, src.height, rot, flipH, rw, rh)

      const cx = clamp(Math.round(crop.x * rw), 0, rw - 1)
      const cy = clamp(Math.round(crop.y * rh), 0, rh - 1)
      const cw = Math.max(1, Math.min(Math.round(crop.w * rw), rw - cx))
      const ch = Math.max(1, Math.min(Math.round(crop.h * rh), rh - cy))

      const out = document.createElement('canvas')
      out.width = cw
      out.height = ch
      const octx = out.getContext('2d')
      if (!octx) throw new Error('Canvas unavailable')
      if (src.mime !== 'image/png') {
        octx.fillStyle = '#ffffff'
        octx.fillRect(0, 0, cw, ch)
      }
      octx.drawImage(layer, cx, cy, cw, ch, 0, 0, cw, ch)

      const mime = src.mime === 'image/png' ? 'image/png' : 'image/jpeg'
      const el = await loadHtmlImage(out.toDataURL(mime, 0.92))
      setSrc({ ...src, el, width: cw, height: ch, downscaled: false })
      setRot(0)
      setFlipH(false)
      setCropMode(false)
      setAspectId('free')
      setCrop(DEFAULT_CROP)
      haptic()
      toast({ title: 'Crop applied ✓', description: `${cw} × ${ch} px` })
    } catch (e) {
      toast({
        title: 'Crop failed',
        description: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'destructive',
      })
    } finally {
      setBaking(false)
    }
  }, [src, baking, rw, rh, rot, flipH, crop, toast])

  /* ---------------- crop overlay pointer handling ---------------- */

  const onCropPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement
      const handleEl = target.closest<HTMLElement>('[data-handle]')
      const mode = (handleEl?.dataset.handle as DragMode | undefined) ?? (target.closest('[data-crop-move]') ? 'move' : null)
      if (!mode) return
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      cropDragRef.current = { mode, startX: e.clientX, startY: e.clientY, rect: crop }
    },
    [crop]
  )

  const onCropPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = cropDragRef.current
      if (!d) return
      const box = e.currentTarget.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) return
      const dx = (e.clientX - d.startX) / box.width
      const dy = (e.clientY - d.startY) / box.height
      setCrop(cropRectAfterDrag(d.mode, d.rect, dx, dy, rw, rh, aspectRatio))
    },
    [rw, rh, aspectRatio]
  )

  const onCropPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    cropDragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }, [])

  /* ---------------- compare divider ---------------- */

  const updateCompareX = useCallback((clientX: number) => {
    const box = stageRef.current?.getBoundingClientRect()
    if (!box || box.width === 0) return
    setCompareX(clamp((clientX - box.left) / box.width, 0, 1))
  }, [])

  const onComparePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!compare || cropMode) return
      e.preventDefault()
      compareDragRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      updateCompareX(e.clientX)
    },
    [compare, cropMode, updateCompareX]
  )

  /* ---------------- tools (v1) rendering ---------------- */

  const renderBlob = useCallback(
    (targetW: number, targetH: number, mime: TargetFormat, q?: number): Promise<Blob> =>
      new Promise<Blob>((resolve, reject) => {
        if (!src) {
          reject(new Error('No image loaded.'))
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = targetW
        canvas.height = targetH
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas is not supported in this browser.'))
          return
        }
        /* JPEG has no alpha channel — flatten onto white */
        if (mime === 'image/jpeg') {
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, targetW, targetH)
        }
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        drawT(ctx, src.el, src.width, src.height, rot, flipH, targetW, targetH)
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size > 0) resolve(blob)
            else reject(new Error('The browser could not export this image in the selected format.'))
          },
          mime,
          q
        )
      }),
    [src, rot, flipH]
  )

  const applyResult = useCallback((blob: Blob, w: number, h: number, mime: TargetFormat, suffix: string) => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    const url = URL.createObjectURL(blob)
    resultUrlRef.current = url
    setResult({ url, blob, width: w, height: h, mime, suffix })
  }, [])

  const resolveMime = (mode: 'keep' | TargetFormat): TargetFormat => {
    if (mode !== 'keep') return mode
    if (src && (src.mime === 'image/png' || src.mime === 'image/jpeg' || src.mime === 'image/webp')) {
      return src.mime
    }
    return 'image/png'
  }

  const doCompress = async () => {
    if (!src || busy) return
    setBusy(true)
    try {
      const blob = await renderBlob(rw, rh, compressFormat, quality / 100)
      applyResult(blob, rw, rh, compressFormat, '-compressed')
      const saved = Math.round((1 - blob.size / src.bytes) * 100)
      toast({
        title: 'Image compressed ✓',
        description: `${formatBytes(src.bytes)} → ${formatBytes(blob.size)} (${saved}% ${saved >= 0 ? 'smaller' : 'larger'})`,
      })
    } catch (e) {
      toast({
        title: 'Compression failed',
        description: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const doResize = async () => {
    if (!src || busy) return
    const w = Math.round(Number(resizeWidth))
    const h = Math.round(Number(resizeHeight))
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 20000 || h > 20000) {
      toast({
        title: 'Invalid dimensions',
        description: 'Width and height must be between 1 and 20,000 pixels.',
        variant: 'destructive',
      })
      return
    }
    setBusy(true)
    try {
      const mime = resolveMime(resizeFormat)
      const blob = await renderBlob(w, h, mime)
      applyResult(blob, w, h, mime, '-resized')
      toast({
        title: 'Image resized ✓',
        description: `New size: ${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} px`,
      })
    } catch (e) {
      toast({
        title: 'Resize failed',
        description: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const doConvert = async () => {
    if (!src || busy) return
    setBusy(true)
    try {
      const lossy = convertFormat !== 'image/png'
      const blob = await renderBlob(rw, rh, convertFormat, lossy ? convertQuality / 100 : undefined)
      applyResult(blob, rw, rh, convertFormat, '-converted')
      toast({ title: 'Image converted ✓', description: `Format: ${FORMAT_LABELS[convertFormat]} · ${formatBytes(blob.size)}` })
    } catch (e) {
      toast({
        title: 'Conversion failed',
        description: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  /* resize inputs follow the (rotated) source dims */
  useEffect(() => {
    if (!src) return
    setResizeWidth(String(rw))
    setResizeHeight(String(rh))
  }, [src, rw, rh])

  const sourceRatio = rh > 0 ? rw / rh : 1

  const onWidthChange = (v: string) => {
    const clean = v.replace(/[^0-9]/g, '')
    setResizeWidth(clean)
    if (lockAspect && clean) {
      const w = Number(clean)
      if (w > 0) setResizeHeight(String(Math.max(1, Math.round(w / sourceRatio))))
    }
  }

  const onHeightChange = (v: string) => {
    const clean = v.replace(/[^0-9]/g, '')
    setResizeHeight(clean)
    if (lockAspect && clean) {
      const h = Number(clean)
      if (h > 0) setResizeWidth(String(Math.max(1, Math.round(h * sourceRatio))))
    }
  }

  const applyPreset = (pct: number) => {
    if (!src) return
    setResizeWidth(String(Math.max(1, Math.round(rw * pct))))
    setResizeHeight(String(Math.max(1, Math.round(rh * pct))))
  }

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Choose an image file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void loadFile(f)
          e.target.value = ''
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-fuchsia-500/[0.12] via-transparent to-pink-600/[0.09] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-fuchsia-400 via-fuchsia-500 to-pink-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(217_70_239/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <ImageIcon className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Photo Editor</h2>
              <p className="text-xs text-zinc-400">Crop, tune and filter — right on your device.</p>
            </div>
            {src && (
              <button
                onClick={() => inputRef.current?.click()}
                aria-label="Import a new image"
                className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                title="Import a new image"
              >
                <ImagePlus className="size-4.5" aria-hidden />
              </button>
            )}
          </div>
        </div>

        {/* ---------------- Pill switcher ---------------- */}
        <div className="px-4 pt-4 sm:px-5">
          <div className="flex rounded-2xl border border-white/10 bg-white/[0.04] p-1" role="tablist" aria-label="Photo Editor sections">
            {(
              [
                { id: 'editor', label: 'Editor', icon: SlidersHorizontal },
                { id: 'tools', label: 'Tools', icon: Wand2 },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all',
                  tab === t.id
                    ? 'bg-gradient-to-r from-fuchsia-500 to-pink-600 text-white shadow-lg shadow-fuchsia-500/25'
                    : 'text-zinc-300 hover:bg-white/5'
                )}
              >
                <t.icon className="size-4" aria-hidden />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          {/* ---------------- Error ---------------- */}
          {error && (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 p-3.5">
              <TriangleAlert className="mt-0.5 size-4.5 shrink-0 text-rose-300" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-bold text-rose-200">File problem</p>
                <p className="mt-0.5 text-xs leading-relaxed text-rose-200/80">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                aria-label="Dismiss error"
                className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-lg text-rose-200/70 hover:bg-white/10 hover:text-rose-100"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )}

          {/* ---------------- Import ---------------- */}
          {!src && (
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose or drop an image"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  inputRef.current?.click()
                }
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                const f = e.dataTransfer.files?.[0]
                if (f) void loadFile(f)
              }}
              className={cn(
                'flex min-h-60 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-6 text-center transition-colors',
                dragging
                  ? 'border-fuchsia-400/70 bg-fuchsia-500/10'
                  : 'border-white/15 hover:border-fuchsia-400/40 hover:bg-white/[0.03]'
              )}
            >
              <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-fuchsia-400 via-fuchsia-500 to-pink-600 text-white shadow-lg shadow-fuchsia-500/30">
                {busyLoad ? <Loader2 className="size-6 animate-spin" aria-hidden /> : <ImagePlus className="size-6" aria-hidden />}
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-zinc-100">Drop a photo here, or tap to browse</p>
                <p className="text-xs text-zinc-500">
                  PNG · JPEG · WebP · GIF — up to 20 MB. Large photos are capped at 2560 px for smooth editing.
                </p>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
                <Button
                  onClick={(e) => {
                    e.stopPropagation()
                    inputRef.current?.click()
                  }}
                  className="h-11 rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-600 font-semibold text-white shadow-lg hover:from-fuchsia-400 hover:to-pink-500"
                >
                  <Upload className="size-4" aria-hidden /> Browse
                </Button>
                <Button
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    void openGallery()
                  }}
                  className="h-11 gap-2 rounded-xl border border-white/10 bg-white/5 font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <GalleryHorizontalEnd className="size-4" aria-hidden /> Pick from Gallery
                </Button>
              </div>
            </div>
          )}

          {/* ---------------- Editor tab ---------------- */}
          {src && tab === 'editor' && (
            <>
              {/* Stage */}
              <div className="flex justify-center rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div
                  ref={stageRef}
                  className={cn(
                    'relative overflow-hidden rounded-xl',
                    (compare || cropMode) && 'touch-none'
                  )}
                  style={CHECKER_STYLE}
                  onPointerDown={compare && !cropMode ? onComparePointerDown : undefined}
                  onPointerMove={
                    compare && !cropMode
                      ? (e) => {
                          if (compareDragRef.current) updateCompareX(e.clientX)
                        }
                      : undefined
                  }
                  onPointerUp={() => {
                    compareDragRef.current = false
                  }}
                  onPointerCancel={() => {
                    compareDragRef.current = false
                  }}
                >
                  {/* ORIGINAL (under) — visible on the left of the divider */}
                  <canvas
                    ref={origCanvasRef}
                    aria-label="Original photo"
                    className={cn(
                      'absolute inset-0 size-full rounded-xl object-contain',
                      !compare && 'hidden'
                    )}
                  />
                  {/* EDITED (over) — clipped to the right of the divider */}
                  <canvas
                    ref={editCanvasRef}
                    aria-label="Edited photo"
                    className="relative block h-auto max-h-[70vh] w-auto max-w-full rounded-xl"
                    style={compare ? { clipPath: `inset(0 0 0 ${compareX * 100}%)` } : undefined}
                  />

                  {/* Compare divider */}
                  {compare && !cropMode && (
                    <>
                      <div
                        className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white shadow-[0_0_8px_rgb(0_0_0/0.6)]"
                        style={{ left: `${compareX * 100}%` }}
                      />
                      <div
                        className="pointer-events-none absolute top-1/2 z-10 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white text-zinc-900 shadow-lg"
                        style={{ left: `${compareX * 100}%` }}
                      >
                        <Columns2 className="size-4" aria-hidden />
                      </div>
                      <span className="pointer-events-none absolute left-2 top-2 z-10 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/90">
                        Original
                      </span>
                      <span className="pointer-events-none absolute right-2 top-2 z-10 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-fuchsia-200">
                        Edited
                      </span>
                    </>
                  )}

                  {/* Crop overlay */}
                  {cropMode && (
                    <div
                      className="absolute inset-0 touch-none"
                      style={{ touchAction: 'none' }}
                      onPointerDown={onCropPointerDown}
                      onPointerMove={onCropPointerMove}
                      onPointerUp={onCropPointerEnd}
                      onPointerCancel={onCropPointerEnd}
                    >
                      <div
                        data-crop-move
                        className="absolute cursor-move rounded-lg ring-1 ring-white/90"
                        style={{
                          left: `${crop.x * 100}%`,
                          top: `${crop.y * 100}%`,
                          width: `${crop.w * 100}%`,
                          height: `${crop.h * 100}%`,
                          boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.6)',
                        }}
                      >
                        {/* rule-of-thirds guides */}
                        <div className="pointer-events-none absolute inset-0">
                          <div className="absolute inset-y-0 left-1/3 w-px bg-white/35" />
                          <div className="absolute inset-y-0 left-2/3 w-px bg-white/35" />
                          <div className="absolute inset-x-0 top-1/3 h-px bg-white/35" />
                          <div className="absolute inset-x-0 top-2/3 h-px bg-white/35" />
                        </div>
                        {/* corner handles — 44 px hit area */}
                        {(['nw', 'ne', 'sw', 'se'] as const).map((h) => (
                          <span
                            key={h}
                            data-handle={h}
                            aria-label={`Crop handle ${h}`}
                            role="button"
                            className={cn('absolute z-10 flex size-11 items-center justify-center', HANDLE_POS[h])}
                          >
                            <span className="size-3.5 rounded-[4px] border-2 border-white bg-white/25 shadow" />
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Stage meta */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-zinc-500">
                <span className="max-w-full truncate font-medium text-zinc-400" title={src.name}>
                  {src.name} · {rw.toLocaleString('en-US')} × {rh.toLocaleString('en-US')} px
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {src.downscaled && <span className="text-amber-300/80">capped at 2560 px</span>}
                  <button
                    onClick={() => {
                      haptic()
                      setSrc(null)
                      setError(null)
                      clearResult()
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-lg px-2 font-semibold text-rose-300/90 transition-colors hover:bg-rose-500/10 hover:text-rose-200"
                  >
                    <Trash2 className="size-3.5" aria-hidden /> Remove
                  </button>
                </span>
              </div>

              {/* Toolbar */}
              <div className="grid grid-cols-4 gap-2">
                <ToolButton icon={RotateCw} label="Rotate 90°" onClick={rotateCw} disabled={cropMode} title="Rotate 90° clockwise" />
                <ToolButton
                  icon={FlipHorizontal2}
                  label="Flip H"
                  active={flipH}
                  onClick={toggleFlip}
                  disabled={cropMode}
                  title="Flip horizontally"
                />
                <ToolButton
                  icon={Crop}
                  label="Crop"
                  active={cropMode}
                  onClick={toggleCrop}
                  title="Crop the photo"
                />
                <ToolButton
                  icon={Columns2}
                  label="Compare"
                  active={compare}
                  onClick={toggleCompare}
                  disabled={cropMode}
                  title="Before / after compare"
                />
              </div>

              {/* Crop panel */}
              {cropMode && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                  className="space-y-3 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-500/[0.06] p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 text-sm font-bold">
                      <Crop className="size-4 text-fuchsia-400" aria-hidden /> Crop
                    </p>
                    <span className="text-[11px] font-semibold tabular-nums text-zinc-400">
                      {Math.max(1, Math.round(crop.w * rw)).toLocaleString('en-US')} ×{' '}
                      {Math.max(1, Math.round(crop.h * rh)).toLocaleString('en-US')} px
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ASPECTS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => applyAspect(a)}
                        aria-pressed={aspectId === a.id}
                        className={cn(
                          'h-9 rounded-full border px-3.5 text-xs font-semibold transition-all',
                          aspectId === a.id
                            ? 'border-transparent bg-gradient-to-r from-fuchsia-500 to-pink-600 text-white shadow'
                            : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                        )}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      onClick={() => void applyCrop()}
                      disabled={baking}
                      className="h-11 rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-600 font-semibold text-white shadow-lg hover:from-fuchsia-400 hover:to-pink-500"
                    >
                      {baking ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                      {baking ? 'Applying…' : 'Apply crop'}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={cancelCrop}
                      className="h-11 gap-2 rounded-xl border border-white/10 bg-white/5 font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
                    >
                      <X className="size-4" aria-hidden /> Cancel
                    </Button>
                  </div>
                </motion.div>
              )}

              {/* Adjustments */}
              <div className="space-y-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    <SlidersHorizontal className="size-4 text-fuchsia-400" aria-hidden /> Adjustments
                  </p>
                  <button
                    onClick={resetAdjustments}
                    className="flex h-8 items-center rounded-lg px-2.5 text-[11px] font-bold text-fuchsia-300 transition-colors hover:bg-fuchsia-500/10 hover:text-fuchsia-200"
                  >
                    Reset
                  </button>
                </div>
                <AdjustSlider label="Brightness" value={brightness} onChange={setBrightness} />
                <AdjustSlider label="Contrast" value={contrast} onChange={setContrast} />
                <AdjustSlider label="Saturation" value={saturation} onChange={setSaturation} />
              </div>

              {/* Filter presets */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="mb-2.5 flex items-center gap-2 text-sm font-bold">
                  <Sparkles className="size-4 text-fuchsia-400" aria-hidden /> Filters
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setPresetId(p.id)
                        haptic()
                      }}
                      aria-pressed={presetId === p.id}
                      className={cn(
                        'h-9 rounded-full border px-3.5 text-xs font-semibold transition-all',
                        presetId === p.id
                          ? 'border-transparent bg-gradient-to-r from-fuchsia-500 to-pink-600 text-white shadow'
                          : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Save / Download */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={() => void saveToGallery()}
                  disabled={saving || cropMode}
                  className="h-12 rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-600 font-semibold text-white shadow-lg shadow-fuchsia-500/25 hover:from-fuchsia-400 hover:to-pink-500"
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <ImageIcon className="size-4" aria-hidden />
                  )}
                  {saving ? 'Saving…' : 'Save to Gallery'}
                </Button>
                <Button
                  onClick={() => void downloadEdited()}
                  disabled={cropMode}
                  className="h-12 gap-2 rounded-xl border border-white/15 bg-white/5 font-semibold text-zinc-100 hover:bg-white/10 hover:text-white"
                >
                  <Download className="size-4" aria-hidden /> Download
                </Button>
              </div>
              {cropMode && (
                <p className="-mt-2 text-center text-[11px] text-zinc-500">
                  Apply or cancel the crop to save your photo.
                </p>
              )}
            </>
          )}

          {/* ---------------- Tools tab (v1 feature set) ---------------- */}
          {src && tab === 'tools' && (
            <>
              {/* Compress */}
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <ImageIcon className="size-4 text-fuchsia-400" aria-hidden /> Compress
                </p>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-zinc-300">Quality</span>
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-bold tabular-nums text-zinc-300">{quality}%</span>
                  </div>
                  <Slider
                    min={10}
                    max={100}
                    step={1}
                    value={[quality]}
                    onValueChange={(v) => setQuality(v[0] ?? 80)}
                    aria-label="Compression quality"
                    className={SLIDER_CLS}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="compress-format" className="w-24 shrink-0 text-xs font-semibold text-zinc-400">
                    Format
                  </label>
                  <select
                    id="compress-format"
                    value={compressFormat}
                    onChange={(e) => setCompressFormat(e.target.value as TargetFormat)}
                    className={SELECT_CLS}
                  >
                    <option value="image/jpeg">JPEG — smallest files</option>
                    <option value="image/webp">WebP — modern &amp; efficient</option>
                  </select>
                </div>
                <Button
                  onClick={() => void doCompress()}
                  disabled={busy}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-600 font-semibold text-white shadow-lg hover:from-fuchsia-400 hover:to-pink-500"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                  {busy ? 'Compressing…' : 'Compress image'}
                </Button>
              </div>

              {/* Resize */}
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <Crop className="size-4 text-fuchsia-400" aria-hidden /> Resize
                </p>
                <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                  <div className="space-y-1.5">
                    <label htmlFor="resize-w" className="text-xs font-semibold text-zinc-400">
                      Width (px)
                    </label>
                    <input
                      id="resize-w"
                      inputMode="numeric"
                      value={resizeWidth}
                      onChange={(e) => onWidthChange(e.target.value)}
                      placeholder="Width"
                      className={INPUT_CLS}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setLockAspect((v) => !v)}
                    aria-label={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                    aria-pressed={lockAspect}
                    title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                    className="mb-0.5 flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10"
                  >
                    {lockAspect ? (
                      <Lock className="size-4 text-fuchsia-400" aria-hidden />
                    ) : (
                      <LockOpen className="size-4 text-zinc-500" aria-hidden />
                    )}
                  </button>
                  <div className="space-y-1.5">
                    <label htmlFor="resize-h" className="text-xs font-semibold text-zinc-400">
                      Height (px)
                    </label>
                    <input
                      id="resize-h"
                      inputMode="numeric"
                      value={resizeHeight}
                      onChange={(e) => onHeightChange(e.target.value)}
                      placeholder="Height"
                      className={INPUT_CLS}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-zinc-500">Quick scale:</span>
                  <div className="flex flex-1 gap-1.5">
                    {[25, 50, 75].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => applyPreset(p / 100)}
                        aria-label={`Scale to ${p}%`}
                        className="h-9 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="resize-format" className="w-24 shrink-0 text-xs font-semibold text-zinc-400">
                    Format
                  </label>
                  <select
                    id="resize-format"
                    value={resizeFormat}
                    onChange={(e) => setResizeFormat(e.target.value as 'keep' | TargetFormat)}
                    className={SELECT_CLS}
                  >
                    <option value="keep">Keep original format</option>
                    <option value="image/png">PNG</option>
                    <option value="image/jpeg">JPEG</option>
                    <option value="image/webp">WebP</option>
                  </select>
                </div>
                <Button
                  onClick={() => void doResize()}
                  disabled={busy}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-600 font-semibold text-white shadow-lg hover:from-fuchsia-400 hover:to-pink-500"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                  {busy ? 'Resizing…' : 'Apply resize'}
                </Button>
              </div>

              {/* Convert */}
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <Wand2 className="size-4 text-fuchsia-400" aria-hidden /> Convert
                </p>
                <div className="flex items-center gap-2">
                  <label htmlFor="convert-format" className="w-24 shrink-0 text-xs font-semibold text-zinc-400">
                    Format
                  </label>
                  <select
                    id="convert-format"
                    value={convertFormat}
                    onChange={(e) => setConvertFormat(e.target.value as TargetFormat)}
                    className={SELECT_CLS}
                  >
                    <option value="image/png">PNG — lossless, transparency</option>
                    <option value="image/jpeg">JPEG — lossy, small files</option>
                    <option value="image/webp">WebP — modern, efficient</option>
                  </select>
                </div>
                {convertFormat !== 'image/png' && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-300">Quality</span>
                      <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-bold tabular-nums text-zinc-300">
                        {convertQuality}%
                      </span>
                    </div>
                    <Slider
                      min={10}
                      max={100}
                      step={1}
                      value={[convertQuality]}
                      onValueChange={(v) => setConvertQuality(v[0] ?? 90)}
                      aria-label="Conversion quality"
                      className={SLIDER_CLS}
                    />
                  </div>
                )}
                <Button
                  onClick={() => void doConvert()}
                  disabled={busy}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-600 font-semibold text-white shadow-lg hover:from-fuchsia-400 hover:to-pink-500"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
                  {busy ? 'Converting…' : `Convert to ${FORMAT_LABELS[convertFormat]}`}
                </Button>
              </div>

              {/* Result card */}
              {result && (
                <div className="space-y-3 rounded-2xl border border-fuchsia-400/25 bg-fuchsia-500/[0.05] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold">Result</h3>
                    <Badge>{FORMAT_LABELS[result.mime]}</Badge>
                    <Badge>
                      {result.width.toLocaleString('en-US')} × {result.height.toLocaleString('en-US')} px
                    </Badge>
                    {result.suffix === '-compressed' && (
                      <Badge tone="emerald">
                        {savedPct > 0 ? `${savedPct}% smaller` : savedPct < 0 ? `${-savedPct}% larger` : 'same size'}
                      </Badge>
                    )}
                  </div>
                  <div className="grid place-items-center rounded-xl bg-white/[0.04] p-3">
                    <img src={result.url} alt="Processed result" className="max-h-64 w-auto rounded-lg object-contain" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-white/[0.04] p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Original</p>
                      <p className="mt-0.5 font-bold text-zinc-200">{formatBytes(src.bytes)}</p>
                    </div>
                    <div className="rounded-xl bg-emerald-500/10 p-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        {result.suffix === '-compressed' ? 'Compressed' : 'New file'}
                      </p>
                      <p className="mt-0.5 font-bold text-emerald-300">{formatBytes(result.blob.size)}</p>
                    </div>
                  </div>
                  <Button asChild className="h-11 w-full gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-600 font-semibold text-white hover:from-fuchsia-400 hover:to-pink-500">
                    <a href={result.url} download={resultFilename}>
                      <Download className="size-4" aria-hidden />
                      Download {resultFilename}
                    </a>
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </motion.div>

      {/* ---------------- Gallery picker modal ---------------- */}
      <AnimatePresence>
        {galleryOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
          >
            <button
              aria-label="Close gallery picker"
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setGalleryOpen(false)}
            />
            <motion.div
              initial={{ y: 64, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 48, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="relative z-10 flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.8)] sm:rounded-3xl"
            >
              <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <GalleryHorizontalEnd className="size-4 text-fuchsia-400" aria-hidden /> Pick from Gallery
                </p>
                <button
                  onClick={() => setGalleryOpen(false)}
                  aria-label="Close"
                  className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4.5" aria-hidden />
                </button>
              </div>
              <div className="overflow-y-auto p-4">
                {galleryLoading ? (
                  <div className="flex items-center justify-center gap-2 py-14 text-sm text-zinc-400">
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Loading photos…
                  </div>
                ) : galleryPhotos.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-14 text-center">
                    <GalleryHorizontalEnd className="size-8 text-zinc-600" aria-hidden />
                    <p className="text-sm font-semibold text-zinc-300">No photos in Gallery yet</p>
                    <p className="max-w-xs text-xs text-zinc-500">
                      Photos you take with Camera or save from other apps appear here.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {galleryPhotos.slice(0, 30).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => void importFromGallery(p)}
                        aria-label={`Import photo ${p.name ?? p.id}`}
                        className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 transition-colors hover:border-fuchsia-400/60"
                      >
                        <img
                          src={p.dataUrl}
                          alt={p.name ?? 'Gallery photo'}
                          loading="lazy"
                          className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
