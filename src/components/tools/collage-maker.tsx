'use client'

/**
 * Collage Maker (ROADMAP D37 — media)
 *
 * Combine up to a dozen photos into 8 curated grid layouts, tune gap /
 * outer padding / corner radius / background / aspect ratio, then export a
 * 2× pixel-density PNG — download, Web Share, save to the local collage
 * library (IndexedDB `toolhub-collage` → `collages`) or hand off to the
 * shared Gallery media store (`toolhub-media` → `photos`).
 *
 * The live preview and the canvas export share one geometry function, so
 * what you see is exactly what gets rendered.
 *
 * Everything stays on-device: zero uploads, zero new dependencies.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookmarkPlus,
  Check,
  Download,
  Grid2x2Plus,
  ImagePlus,
  Images,
  LayoutGrid,
  Loader2,
  Plus,
  RefreshCw,
  Share2,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { fileToDataUrl, newPhotoId, putPhoto, type PhotoRecord } from '@/lib/media-db'

/* ================================================================== */
/* Layouts — normalized cell rects [x, y, w, h] in 0..1                */
/* ================================================================== */

type CellRect = [number, number, number, number]

interface LayoutDef {
  id: string
  label: string
  cells: CellRect[]
}

const GRID_3X2_CELLS: CellRect[] = Array.from({ length: 6 }, (_, i): CellRect => [
  (i % 3) / 3,
  Math.floor(i / 3) / 2,
  1 / 3,
  0.5,
])

const LAYOUTS: LayoutDef[] = [
  {
    id: 'grid-2x2',
    label: 'Grid 2×2',
    cells: [
      [0, 0, 0.5, 0.5],
      [0.5, 0, 0.5, 0.5],
      [0, 0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5, 0.5],
    ],
  },
  {
    id: 'big-left',
    label: 'Big Left',
    cells: [
      [0, 0, 0.6, 1],
      [0.6, 0, 0.4, 0.5],
      [0.6, 0.5, 0.4, 0.5],
    ],
  },
  {
    id: 'big-right',
    label: 'Big Right',
    cells: [
      [0, 0, 0.4, 0.5],
      [0, 0.5, 0.4, 0.5],
      [0.4, 0, 0.6, 1],
    ],
  },
  {
    id: 'big-top',
    label: 'Big Top',
    cells: [
      [0, 0, 1, 0.6],
      [0, 0.6, 0.5, 0.4],
      [0.5, 0.6, 0.5, 0.4],
    ],
  },
  {
    id: 'filmstrip',
    label: 'Filmstrip',
    cells: [
      [0, 0, 1, 1 / 3],
      [0, 1 / 3, 1, 1 / 3],
      [0, 2 / 3, 1, 1 / 3],
    ],
  },
  {
    id: 'column',
    label: 'Column',
    cells: [
      [0, 0, 1 / 3, 1],
      [1 / 3, 0, 1 / 3, 1],
      [2 / 3, 0, 1 / 3, 1],
    ],
  },
  {
    id: 'grid-3x2',
    label: 'Grid 3×2',
    cells: GRID_3X2_CELLS,
  },
  {
    id: 'center-frame',
    label: 'Center Frame',
    cells: [
      [0.33, 0.33, 0.34, 0.34],
      [0, 0, 0.34, 0.34],
      [0.66, 0, 0.34, 0.34],
      [0, 0.66, 0.34, 0.34],
      [0.66, 0.66, 0.34, 0.34],
    ],
  },
]

/* ================================================================== */
/* Aspect ratios + backgrounds                                         */
/* ================================================================== */

type AspectId = '1:1' | '4:5' | '3:4' | '16:9' | '9:16'

interface AspectDef {
  id: AspectId
  w: number
  h: number
}

const ASPECTS: AspectDef[] = [
  { id: '1:1', w: 1, h: 1 },
  { id: '4:5', w: 4, h: 5 },
  { id: '3:4', w: 3, h: 4 },
  { id: '16:9', w: 16, h: 9 },
  { id: '9:16', w: 9, h: 16 },
]

interface BgDef {
  id: string
  label: string
  /** CSS background used by the preview stage + swatch */
  css: string
  kind: 'solid' | 'gradient'
  color?: string
  stops?: string[]
}

const BACKGROUNDS: BgDef[] = [
  { id: 'white', label: 'White', css: '#ffffff', kind: 'solid', color: '#ffffff' },
  { id: 'black', label: 'Black', css: '#000000', kind: 'solid', color: '#000000' },
  { id: 'zinc', label: 'Zinc', css: '#18181b', kind: 'solid', color: '#18181b' },
  { id: 'cream', label: 'Cream', css: '#f7efdc', kind: 'solid', color: '#f7efdc' },
  {
    id: 'sunset',
    label: 'Sunset',
    css: 'linear-gradient(135deg, #fbbf24 0%, #f43f5e 55%, #d946ef 100%)',
    kind: 'gradient',
    stops: ['#fbbf24', '#f43f5e', '#d946ef'],
  },
  {
    id: 'mint',
    label: 'Mint',
    css: 'linear-gradient(135deg, #a7f3d0 0%, #14b8a6 100%)',
    kind: 'gradient',
    stops: ['#a7f3d0', '#14b8a6'],
  },
  {
    id: 'orchid',
    label: 'Orchid',
    css: 'linear-gradient(135deg, #f0abfc 0%, #a21caf 100%)',
    kind: 'gradient',
    stops: ['#f0abfc', '#a21caf'],
  },
]

/* ================================================================== */
/* Photo model + constants                                             */
/* ================================================================== */

interface Photo {
  id: string
  name: string
  dataUrl: string
  w: number
  h: number
}

interface StageBox {
  w: number
  h: number
}

interface CellPx {
  x: number
  y: number
  w: number
  h: number
}

type PickMode = { mode: 'add' } | { mode: 'replace'; index: number }

const MAX_PHOTOS = 12
const EXPORT_SCALE = 2
const EXPORT_BASE = 1080 // long edge at 1× (2160px at 2×)
const MAX_SAVED_BYTES = 2.5 * 1024 * 1024
const DEFAULT_GAP = 8
const DEFAULT_PADDING = 12
const DEFAULT_RADIUS = 12

/* ================================================================== */
/* IndexedDB — saved collages (write-through, fully on-device)         */
/* ================================================================== */

const DB_NAME = 'toolhub-collage'
const DB_VERSION = 1
const COLLAGE_STORE = 'collages'

interface SavedCollage {
  id: string
  imageDataUrl: string
  layout: string
  aspect: AspectId
  createdAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function openCollageDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(COLLAGE_STORE)) {
        d.createObjectStore(COLLAGE_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openCollageDb()
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
/* Geometry — shared by live preview AND canvas export                 */
/* ================================================================== */

/**
 * Normalized layout rects → pixel rects inside a stage of (stageW × stageH)
 * with outer `padding` and uniform `gap` (each cell shrinks gap/2 per side,
 * so adjacent cells always sit exactly `gap` apart).
 */
function cellRectsInStage(
  layout: LayoutDef,
  stageW: number,
  stageH: number,
  padding: number,
  gap: number
): CellPx[] {
  const cw = stageW - padding * 2
  const ch = stageH - padding * 2
  return layout.cells.map(([nx, ny, nw, nh]) => ({
    x: padding + nx * cw + gap / 2,
    y: padding + ny * ch + gap / 2,
    w: nw * cw - gap,
    h: nh * ch - gap,
  }))
}

/** 1× export stage for a given aspect — long edge = EXPORT_BASE. */
function exportStageFor(a: AspectDef): StageBox {
  const ar = a.w / a.h
  if (a.w >= a.h) return { w: EXPORT_BASE, h: Math.round(EXPORT_BASE / ar) }
  return { w: Math.round(EXPORT_BASE * ar), h: EXPORT_BASE }
}

/** Rounded-rect Path2D (radius clamped to half the cell). */
function roundedCellPath(x: number, y: number, w: number, h: number, radius: number): Path2D {
  const p = new Path2D()
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  p.roundRect(x, y, w, h, r)
  return p
}

/** Cover-fit draw: center crop from source aspect into the cell rect. */
function drawCoverCell(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  cell: CellPx,
  radius: number
): void {
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (iw === 0 || ih === 0 || cell.w <= 0 || cell.h <= 0) return
  const scale = Math.max(cell.w / iw, cell.h / ih)
  const sw = cell.w / scale
  const sh = cell.h / scale
  const sx = (iw - sw) / 2
  const sy = (ih - sh) / 2
  ctx.save()
  ctx.clip(roundedCellPath(cell.x, cell.y, cell.w, cell.h, radius))
  ctx.drawImage(img, sx, sy, sw, sh, cell.x, cell.y, cell.w, cell.h)
  ctx.restore()
}

function paintBackground(ctx: CanvasRenderingContext2D, bg: BgDef, w: number, h: number): void {
  if (bg.kind === 'gradient' && bg.stops && bg.stops.length > 1) {
    const g = ctx.createLinearGradient(0, 0, w, h)
    const n = bg.stops.length - 1
    bg.stops.forEach((c, i) => g.addColorStop(i / n, c))
    ctx.fillStyle = g
  } else {
    ctx.fillStyle = bg.color ?? '#ffffff'
  }
  ctx.fillRect(0, 0, w, h)
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), type)
  })
}

/* ================================================================== */
/* Small helpers                                                       */
/* ================================================================== */

function fileToPhoto(file: File): Promise<Photo> {
  return fileToDataUrl(file).then((dataUrl) => {
    if (!dataUrl) throw new Error('empty data url')
    return new Promise<Photo>((resolve, reject) => {
      const img = new Image()
      img.onload = () =>
        resolve({
          id: newPhotoId(),
          name: file.name.replace(/\.[^.]+$/, ''),
          dataUrl,
          w: img.naturalWidth,
          h: img.naturalHeight,
        })
      img.onerror = () => reject(new Error('decode failed'))
      img.src = dataUrl
    })
  })
}

function dataUrlBytes(dataUrl: string): number {
  const idx = dataUrl.indexOf(',')
  if (idx < 0) return dataUrl.length
  return Math.floor(((dataUrl.length - idx - 1) * 3) / 4)
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function stamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(
    d.getMinutes()
  )}${p(d.getSeconds())}`
}

function newCollageId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** File-sharing navigator surface (canShare/share with File payloads). */
interface ShareFilesNav {
  canShare?(data: { files?: File[]; title?: string; text?: string }): boolean
  share?(data: { files?: File[]; title?: string; text?: string }): Promise<void>
}

/* ================================================================== */
/* Slider row (shared control)                                         */
/* ================================================================== */

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-xs font-semibold text-zinc-400">
        {label}
        <span className="font-mono text-[11px] text-fuchsia-300">{value}px</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.currentTarget.value))}
        className="h-11 w-full cursor-pointer accent-fuchsia-500"
        aria-label={label}
      />
    </label>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function CollageMakerApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [layoutId, setLayoutId] = useState('grid-2x2')
  const [aspectId, setAspectId] = useState<AspectId>('1:1')
  const [bgId, setBgId] = useState('white')
  const [gap, setGap] = useState(DEFAULT_GAP)
  const [padding, setPadding] = useState(DEFAULT_PADDING)
  const [radius, setRadius] = useState(DEFAULT_RADIUS)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sheetIndex, setSheetIndex] = useState<number | null>(null)
  const [saved, setSaved] = useState<SavedCollage[]>([])
  const [savedLoaded, setSavedLoaded] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [clearArmed, setClearArmed] = useState(false)
  const [box, setBox] = useState<StageBox>({ w: 320, h: 320 })

  /* ---------------- refs ---------------- */
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const stageWrapRef = useRef<HTMLDivElement | null>(null)
  const decodeCache = useRef(new Map<string, Promise<HTMLImageElement>>())
  const urlsRef = useRef<string[]>([])
  const clearTimerRef = useRef<number | null>(null)
  /* latest pick mode for the input's onChange (stable across re-renders) */
  const pickModeRef = useRef<PickMode>({ mode: 'add' })

  /* ---------------- derived ---------------- */
  const layout = useMemo(() => LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0], [layoutId])
  const aspect = useMemo(() => ASPECTS.find((a) => a.id === aspectId) ?? ASPECTS[0], [aspectId])
  const background = useMemo(() => BACKGROUNDS.find((b) => b.id === bgId) ?? BACKGROUNDS[0], [bgId])
  const preview = useMemo(() => saved.find((s) => s.id === previewId) ?? null, [saved, previewId])
  const unusedPhotos = Math.max(0, photos.length - layout.cells.length)
  const usedCount = Math.min(photos.length, layout.cells.length)

  const buzz = useCallback(() => {
    navigator.vibrate?.(12)
  }, [])

  /* ---------------- hydration (saved collages) ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rows = await idbGetAll<SavedCollage>(COLLAGE_STORE)
        if (!alive) return
        setSaved(rows.sort((a, b) => b.createdAt - a.createdAt))
      } catch {
        /* private mode / quota — in-memory only */
      }
      if (alive) setSavedLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- preview box: fit aspect into card width, max ~60vh ---------------- */
  useEffect(() => {
    const el = stageWrapRef.current
    if (!el) return
    const measure = () => {
      const availW = el.clientWidth
      const availH = Math.max(220, Math.min(window.innerHeight * 0.6, 560))
      const ar = aspect.w / aspect.h
      let w = availW
      let h = w / ar
      if (h > availH) {
        h = availH
        w = h * ar
      }
      setBox({ w: Math.max(80, Math.round(w)), h: Math.max(80, Math.round(h)) })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    queueMicrotask(measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [aspect])

  /* ---------------- unmount cleanup: object URLs + timers ---------------- */
  useEffect(() => {
    return () => {
      for (const u of urlsRef.current) URL.revokeObjectURL(u)
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current)
    }
  }, [])

  /* ---------------- download via object URL (revoked after use) ---------------- */
  const downloadBlob = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob)
    urlsRef.current.push(url)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => {
      URL.revokeObjectURL(url)
      urlsRef.current = urlsRef.current.filter((u) => u !== url)
    }, 2000)
  }, [])

  /* ---------------- decode photo (cached) for export ---------------- */
  const decodePhoto = useCallback((photo: Photo): Promise<HTMLImageElement> => {
    const hit = decodeCache.current.get(photo.id)
    if (hit) return hit
    const p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('decode failed'))
      img.src = photo.dataUrl
    })
    decodeCache.current.set(photo.id, p)
    return p
  }, [])

  /* ---------------- photo ingestion ---------------- */
  const ingestFiles = useCallback(
    async (files: FileList | null, mode: PickMode) => {
      if (!files || files.length === 0) return
      const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (list.length === 0) {
        toast({
          title: 'No images selected',
          description: 'Pick JPG, PNG or WebP files.',
          variant: 'destructive',
        })
        return
      }
      setLoadingPhotos(true)
      try {
        if (mode.mode === 'replace') {
          const photo = await fileToPhoto(list[0])
          setPhotos((prev) => prev.map((p, i) => (i === mode.index ? photo : p)))
          buzz()
          toast({ title: 'Photo replaced' })
        } else {
          const capped = list.slice(0, MAX_PHOTOS)
          const loaded: Photo[] = []
          for (const f of capped) {
            try {
              loaded.push(await fileToPhoto(f))
            } catch {
              /* skip unreadable file */
            }
          }
          if (loaded.length === 0) throw new Error('no readable files')
          setPhotos((prev) => [...prev, ...loaded])
          buzz()
          toast({
            title: `${loaded.length} photo${loaded.length === 1 ? '' : 's'} added`,
            description:
              list.length > MAX_PHOTOS
                ? `First ${MAX_PHOTOS} kept — tap a filled cell to replace or remove.`
                : 'Tap any filled cell to replace or remove it.',
          })
        }
      } catch {
        toast({
          title: 'Could not read images',
          description: 'One or more files were skipped.',
          variant: 'destructive',
        })
      } finally {
        setLoadingPhotos(false)
      }
    },
    [buzz, toast]
  )

  const onFileInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.currentTarget.files
    const mode: PickMode = pickModeRef.current
    e.currentTarget.value = ''
    void ingestFiles(files, mode)
  }

  const openPicker = useCallback(
    (mode: PickMode) => {
      pickModeRef.current = mode
      buzz()
      fileInputRef.current?.click()
    },
    [buzz]
  )

  const onCellTap = (i: number) => {
    buzz()
    if (photos[i]) setSheetIndex(i)
    else openPicker({ mode: 'add' })
  }

  const removePhoto = (index: number) => {
    const name = photos[index]?.name ?? 'Photo'
    setPhotos((prev) => prev.filter((_, i) => i !== index))
    setSheetIndex(null)
    navigator.vibrate?.(12)
    toast({ title: 'Photo removed', description: name })
  }

  /* ---------------- render the collage to a 2× canvas ---------------- */
  const renderCollage = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const stage = exportStageFor(aspect)
    const canvas = document.createElement('canvas')
    canvas.width = stage.w * EXPORT_SCALE
    canvas.height = stage.h * EXPORT_SCALE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.scale(EXPORT_SCALE, EXPORT_SCALE)
    paintBackground(ctx, background, stage.w, stage.h)
    const cellsPx = cellRectsInStage(layout, stage.w, stage.h, padding, gap)
    for (let i = 0; i < cellsPx.length; i++) {
      const photo = photos[i]
      if (!photo) continue
      const img = await decodePhoto(photo).catch(() => null)
      if (!img) continue
      drawCoverCell(ctx, img, cellsPx[i], radius)
    }
    return canvas
  }, [aspect, background, layout, padding, gap, radius, photos, decodePhoto])

  /* ---------------- export: PNG download ---------------- */
  const exportPng = async () => {
    if (busy || photos.length === 0) return
    setBusy(true)
    buzz()
    try {
      const canvas = await renderCollage()
      if (!canvas) throw new Error('canvas unavailable')
      const blob = await canvasToBlob(canvas)
      const name = `collage-${stamp()}.png`
      downloadBlob(blob, name)
      toast({ title: 'PNG exported', description: `${name} · ${mb(blob.size)} · ${EXPORT_SCALE}×` })
    } catch {
      toast({
        title: 'Export failed',
        description: 'The collage could not be rendered.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- export: Web Share API ---------------- */
  const shareCollage = async () => {
    if (busy || photos.length === 0) return
    setBusy(true)
    buzz()
    try {
      const canvas = await renderCollage()
      if (!canvas) throw new Error('canvas unavailable')
      const blob = await canvasToBlob(canvas)
      const name = `collage-${stamp()}.png`
      const file = new File([blob], name, { type: 'image/png' })
      const nav = navigator as unknown as ShareFilesNav
      if (
        typeof nav.share === 'function' &&
        typeof nav.canShare === 'function' &&
        nav.canShare({ files: [file] })
      ) {
        await nav.share({ files: [file], title: 'Collage', text: 'Made with ToolHub Collage Maker' })
        toast({ title: 'Shared', description: `${name} is on its way.` })
        return
      }
      downloadBlob(blob, name)
      toast({
        title: 'Sharing not supported here',
        description: 'This device cannot share files directly — the PNG was downloaded instead.',
      })
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'AbortError') return /* sheet dismissed */
      toast({
        title: 'Share failed',
        description: 'The collage could not be rendered for sharing.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- save a copy to the local collage library ---------------- */
  const persistSave = (rec: SavedCollage) => {
    setSaved((prev) => [rec, ...prev])
    void idbPut(COLLAGE_STORE, rec).catch(() => {
      toast({
        title: 'Storage unavailable',
        description: 'Collage kept in memory for this session only.',
        variant: 'destructive',
      })
    })
  }

  const saveCopy = async () => {
    if (busy || photos.length === 0) return
    setBusy(true)
    buzz()
    try {
      const canvas = await renderCollage()
      if (!canvas) throw new Error('canvas unavailable')
      const dataUrl = canvas.toDataURL('image/png')
      if (dataUrlBytes(dataUrl) > MAX_SAVED_BYTES) {
        toast({
          title: 'Too large to keep',
          description: 'The PNG exceeds 2.5 MB — use Export PNG instead. Nothing was saved.',
          variant: 'destructive',
        })
        return
      }
      persistSave({
        id: newCollageId(),
        imageDataUrl: dataUrl,
        layout: layoutId,
        aspect: aspectId,
        createdAt: Date.now(),
      })
      toast({ title: 'Collage saved', description: 'Find it under Saved collages below.' })
    } catch {
      toast({
        title: 'Save failed',
        description: 'The collage could not be rendered.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- save to the shared Gallery media store ---------------- */
  const saveToGallery = async () => {
    if (busy || photos.length === 0) return
    setBusy(true)
    buzz()
    try {
      const canvas = await renderCollage()
      if (!canvas) throw new Error('canvas unavailable')
      let dataUrl = canvas.toDataURL('image/png')
      if (dataUrlBytes(dataUrl) > MAX_SAVED_BYTES) {
        /* keep the shared media store lean — fall back to high-quality JPEG */
        dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      }
      const rec: PhotoRecord = {
        id: newPhotoId(),
        dataUrl,
        createdAt: Date.now(),
        fav: false,
        source: 'design',
        name: `Collage · ${layout.label}`,
      }
      await putPhoto(rec)
      toast({ title: 'Saved to Gallery', description: 'Open Gallery to see it with your photos.' })
    } catch {
      toast({
        title: 'Gallery save failed',
        description: 'The photo library is unavailable right now.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- saved collage actions ---------------- */
  const reDownloadSaved = async (rec: SavedCollage) => {
    try {
      const blob = await (await fetch(rec.imageDataUrl)).blob()
      const name = `collage-${stamp(new Date(rec.createdAt))}.png`
      downloadBlob(blob, name)
      toast({ title: 'Download started', description: `${name} · ${mb(blob.size)}` })
    } catch {
      toast({
        title: 'Download failed',
        description: 'The saved copy could not be read.',
        variant: 'destructive',
      })
    }
  }

  const deleteSaved = (id: string) => {
    setSaved((prev) => prev.filter((s) => s.id !== id))
    setPreviewId(null)
    void idbDelete(COLLAGE_STORE, id).catch(() => {
      /* memory-only fallback */
    })
    navigator.vibrate?.(12)
    toast({ title: 'Collage deleted' })
  }

  const onClearAll = () => {
    if (!clearArmed) {
      setClearArmed(true)
      clearTimerRef.current = window.setTimeout(() => setClearArmed(false), 3000)
      return
    }
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    setClearArmed(false)
    setSaved([])
    setPreviewId(null)
    void idbClear(COLLAGE_STORE).catch(() => {
      /* memory-only fallback */
    })
    navigator.vibrate?.(12)
    toast({ title: 'Saved collages cleared' })
  }

  /* ---------------- render ---------------- */

  const cells = useMemo(
    () => cellRectsInStage(layout, box.w, box.h, padding, gap),
    [layout, box, padding, gap]
  )

  const sheetPhoto = sheetIndex !== null ? photos[sheetIndex] : undefined
  const savedLayoutLabel = (id: string) => LAYOUTS.find((l) => l.id === id)?.label ?? id

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-zinc-100">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onFileInputChange}
      />

      <div className="mx-auto max-w-4xl px-4 pb-10 pt-5">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="space-y-4"
        >
          {/* ---------------- identity header ---------------- */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-fuchsia-500 via-purple-600 to-rose-700 p-5 shadow-[0_18px_40px_-18px_rgb(217_70_239/0.55)]">
            <div className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-white/15 blur-2xl" />
            <div className="flex items-center gap-4">
              <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/15 ring-1 ring-white/30">
                <Grid2x2Plus className="size-7 text-white" strokeWidth={1.9} aria-hidden />
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold tracking-tight text-white">Collage Maker</h2>
                <p className="text-xs text-white/80">
                  8 grid layouts · gap &amp; radius control · share-ready PNG export
                </p>
              </div>
            </div>
          </div>

          {/* ---------------- live preview + export ---------------- */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold">Preview</p>
              <p className="text-[11px] text-zinc-500">
                {layout.label} · {aspect.id} · {usedCount}/{layout.cells.length} cells
              </p>
            </div>

            <div ref={stageWrapRef} className="flex min-h-[220px] w-full items-center justify-center">
              <div
                className="relative overflow-hidden shadow-[0_14px_36px_-16px_rgb(0_0_0/0.65)]"
                style={{ width: box.w, height: box.h, background: background.css }}
              >
                {cells.map((cell, i) => {
                  const photo = photos[i]
                  return (
                    <motion.button
                      key={i}
                      type="button"
                      layout
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      onClick={() => onCellTap(i)}
                      aria-label={
                        photo ? `Cell ${i + 1}: ${photo.name}` : `Cell ${i + 1}: empty, add photo`
                      }
                      className="absolute overflow-hidden border border-dashed border-zinc-500/40 bg-black/5"
                      style={{ left: cell.x, top: cell.y, width: cell.w, height: cell.h, borderRadius: radius }}
                    >
                      {photo ? (
                        <img
                          src={photo.dataUrl}
                          alt={photo.name}
                          draggable={false}
                          className="h-full w-full select-none object-cover"
                          style={{ objectPosition: 'center' }}
                        />
                      ) : (
                        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-zinc-500/80">
                          <Plus className="size-5" aria-hidden />
                          <span className="text-[10px] font-medium">Add</span>
                        </span>
                      )}
                    </motion.button>
                  )
                })}
              </div>
            </div>

            {unusedPhotos > 0 && (
              <p className="mt-2 text-[11px] text-amber-300/90">
                This layout uses {layout.cells.length} photos — {unusedPhotos} won&apos;t be placed.
              </p>
            )}

            <div className="mt-4 space-y-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={exportPng}
                  disabled={busy || photos.length === 0}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-600 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_rgb(192_38_211/0.8)] transition active:scale-[0.98] disabled:opacity-40"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
                  Export PNG
                </button>
                <button
                  type="button"
                  onClick={shareCollage}
                  disabled={busy || photos.length === 0}
                  aria-label="Share collage"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-200 transition active:scale-95 disabled:opacity-40"
                >
                  <Share2 className="size-4" aria-hidden />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={saveCopy}
                  disabled={busy || photos.length === 0}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-zinc-200 transition active:scale-[0.98] disabled:opacity-40"
                >
                  <BookmarkPlus className="size-4 text-fuchsia-300" aria-hidden /> Save copy
                </button>
                <button
                  type="button"
                  onClick={saveToGallery}
                  disabled={busy || photos.length === 0}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-zinc-200 transition active:scale-[0.98] disabled:opacity-40"
                >
                  <Images className="size-4 text-fuchsia-300" aria-hidden /> To Gallery
                </button>
              </div>
            </div>
          </section>

          {/* ---------------- layout picker ---------------- */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-bold">
                <LayoutGrid className="size-4 text-fuchsia-400" aria-hidden /> Layout
              </p>
              <p className="text-[11px] text-zinc-500">{layout.cells.length} cells</p>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {LAYOUTS.map((l) => {
                const active = l.id === layoutId
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      setLayoutId(l.id)
                      buzz()
                    }}
                    aria-pressed={active}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 transition active:scale-95 ${
                      active
                        ? 'border-fuchsia-400/60 bg-fuchsia-500/10'
                        : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                    }`}
                  >
                    <span
                      className={`relative block aspect-square w-full overflow-hidden rounded-md ${
                        active ? 'bg-white/20' : 'bg-white/10'
                      }`}
                    >
                      {l.cells.map((c, ci) => (
                        <span
                          key={ci}
                          className={`absolute rounded-[2px] ${active ? 'bg-white/90' : 'bg-white/40'}`}
                          style={{
                            left: `${c[0] * 100 + 1.5}%`,
                            top: `${c[1] * 100 + 1.5}%`,
                            width: `${c[2] * 100 - 3}%`,
                            height: `${c[3] * 100 - 3}%`,
                          }}
                        />
                      ))}
                    </span>
                    <span
                      className={`text-center text-[10px] leading-tight ${
                        active ? 'text-fuchsia-200' : 'text-zinc-500'
                      }`}
                    >
                      {l.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* ---------------- photos ---------------- */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-bold">
                <Images className="size-4 text-fuchsia-400" aria-hidden /> Photos
              </p>
              <p className="text-[11px] text-zinc-500">
                {photos.length === 0 ? 'None yet' : `${photos.length} loaded`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openPicker({ mode: 'add' })}
              disabled={loadingPhotos}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-fuchsia-400/30 bg-fuchsia-500/10 text-sm font-semibold text-fuchsia-200 transition active:scale-[0.98] disabled:opacity-50"
            >
              {loadingPhotos ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="size-4" aria-hidden />
              )}
              Add photos
            </button>
            {photos.length > 0 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {photos.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => onCellTap(i)}
                    aria-label={`Photo ${i + 1}: ${p.name}`}
                    className="relative size-16 shrink-0 overflow-hidden rounded-xl border border-white/10 transition active:scale-95"
                  >
                    <img src={p.dataUrl} alt={p.name} className="h-full w-full object-cover" draggable={false} />
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">
                      {i + 1}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ---------------- adjust ---------------- */}
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold">
              <SlidersHorizontal className="size-4 text-fuchsia-400" aria-hidden /> Adjust
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <SliderRow label="Gap between cells" value={gap} min={0} max={24} onChange={setGap} />
              <SliderRow label="Outer padding" value={padding} min={0} max={24} onChange={setPadding} />
              <SliderRow label="Corner radius" value={radius} min={0} max={32} onChange={setRadius} />
            </div>

            <p className="mb-2 mt-4 text-xs font-semibold text-zinc-400">Aspect ratio</p>
            <div className="flex flex-wrap gap-2">
              {ASPECTS.map((a) => {
                const active = a.id === aspectId
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setAspectId(a.id)
                      buzz()
                    }}
                    aria-pressed={active}
                    className={`h-11 min-w-14 rounded-xl border px-3 font-mono text-xs font-semibold transition active:scale-95 ${
                      active
                        ? 'border-fuchsia-400/60 bg-fuchsia-500/15 text-fuchsia-200'
                        : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]'
                    }`}
                  >
                    {a.id}
                  </button>
                )
              })}
            </div>

            <p className="mb-2 mt-4 text-xs font-semibold text-zinc-400">Background</p>
            <div className="flex flex-wrap gap-2">
              {BACKGROUNDS.map((b) => {
                const active = b.id === bgId
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setBgId(b.id)
                      buzz()
                    }}
                    aria-label={`Background: ${b.label}`}
                    aria-pressed={active}
                    title={b.label}
                    className={`relative flex size-11 items-center justify-center rounded-full border transition active:scale-90 ${
                      active ? 'border-white ring-2 ring-fuchsia-400' : 'border-white/20'
                    }`}
                    style={{ background: b.css }}
                  >
                    {active && <Check className="size-4 text-white drop-shadow" aria-hidden />}
                  </button>
                )
              })}
            </div>
          </section>

          {/* ---------------- saved collages ---------------- */}
          {savedLoaded && saved.length > 0 && (
            <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-bold">
                  <BookmarkPlus className="size-4 text-fuchsia-400" aria-hidden /> Saved collages
                </p>
                <button
                  type="button"
                  onClick={onClearAll}
                  className={`h-9 rounded-lg border px-3 text-[11px] font-semibold transition active:scale-95 ${
                    clearArmed
                      ? 'border-rose-400/50 bg-rose-500/20 text-rose-200'
                      : 'border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {clearArmed ? 'Tap again to confirm' : 'Clear all'}
                </button>
              </div>
              <div className="grid max-h-96 grid-cols-3 gap-2 overflow-y-auto pr-1">
                {saved.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setPreviewId(s.id)}
                    className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 transition active:scale-[0.97]"
                    aria-label={`Saved collage, ${savedLayoutLabel(s.layout)} layout, ${new Date(
                      s.createdAt
                    ).toLocaleDateString('en-US')}`}
                  >
                    <img
                      src={s.imageDataUrl}
                      alt="Saved collage"
                      loading="lazy"
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-left text-[9px] font-medium text-zinc-200">
                      {savedLayoutLabel(s.layout)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {savedLoaded && saved.length === 0 && (
            <p className="px-1 text-center text-[11px] text-zinc-600">
              Collages you &ldquo;Save copy&rdquo; stay on this device and appear here.
            </p>
          )}
        </motion.div>
      </div>

      {/* ---------------- cell action sheet ---------------- */}
      <AnimatePresence>
        {sheetPhoto && sheetIndex !== null && (
          <motion.div
            key="sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSheetIndex(null)}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 96 }}
              animate={{ y: 0 }}
              exit={{ y: 96 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-t-3xl border border-white/10 bg-zinc-900/95 p-4 pb-6"
            >
              <div className="flex items-center gap-3">
                <img
                  src={sheetPhoto.dataUrl}
                  alt={sheetPhoto.name}
                  className="size-14 rounded-xl border border-white/10 object-cover"
                  draggable={false}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">Photo {sheetIndex + 1}</p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {sheetPhoto.w}×{sheetPhoto.h}
                    {sheetPhoto.name ? ` · ${sheetPhoto.name}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSheetIndex(null)}
                  aria-label="Close"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition active:scale-95"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const index = sheetIndex
                    setSheetIndex(null)
                    openPicker({ mode: 'replace', index })
                  }}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/10 text-sm font-semibold text-zinc-100 transition active:scale-[0.98]"
                >
                  <RefreshCw className="size-4" aria-hidden /> Replace
                </button>
                <button
                  type="button"
                  onClick={() => removePhoto(sheetIndex)}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/15 text-sm font-semibold text-rose-300 transition active:scale-[0.98]"
                >
                  <Trash2 className="size-4" aria-hidden /> Remove
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- saved collage preview dialog ---------------- */}
      <AnimatePresence>
        {preview && (
          <motion.div
            key="dialog"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewId(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.94, y: 16 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.94, y: 16 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900/95 p-4"
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-bold">Saved collage</p>
                  <p className="truncate text-[11px] text-zinc-500">
                    {savedLayoutLabel(preview.layout)} · {preview.aspect} ·{' '}
                    {new Date(preview.createdAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewId(null)}
                  aria-label="Close preview"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition active:scale-95"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <img
                src={preview.imageDataUrl}
                alt="Saved collage preview"
                className="mt-3 max-h-[55vh] w-full rounded-xl border border-white/10 object-contain"
                draggable={false}
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void reDownloadSaved(preview)}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-600 text-sm font-semibold text-white transition active:scale-[0.98]"
                >
                  <Download className="size-4" aria-hidden /> Download
                </button>
                <button
                  type="button"
                  onClick={() => deleteSaved(preview.id)}
                  className="flex h-11 items-center justify-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/15 text-sm font-semibold text-rose-300 transition active:scale-[0.98]"
                >
                  <Trash2 className="size-4" aria-hidden /> Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
