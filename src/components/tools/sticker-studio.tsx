'use client'

/**
 * Sticker Studio — compose emoji & text stickers on a transparent canvas.
 *
 * • Transparent base (checkerboard backdrop) with an optional gradient that
 *   is only baked into the export when toggled on.
 * • 6 curated emoji packs, drag-to-move items, per-item scale/rotate/delete.
 * • Export a single transparent PNG (512/1024) or a print & cut sticker
 *   sheet (2×2 / 3×3 bounding-box fit per cell).
 * • Download, Web Share (files guard) and Save to Gallery (shared
 *   toolhub-media photo store, source 'design') for every export.
 * • Saved stickers persist in IndexedDB `toolhub-stickers` v1, store
 *   `stickers` — dataUrl + items JSON so any sticker can be re-opened
 *   straight back into the editor.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { AnimatePresence, motion, type Transition } from 'framer-motion'
import {
  Bold,
  Check,
  Download,
  Grid2x2,
  ImagePlus,
  Images,
  Palette,
  Plus,
  Share2,
  SmilePlus,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { newPhotoId, putPhoto, type PhotoRecord } from '@/lib/media-db'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

interface StickerItem {
  id: string
  kind: 'emoji' | 'text'
  emoji: string
  text: string
  color: string
  bold: boolean
  /** normalized center on a square canvas, 0..1 */
  x: number
  y: number
  /** multiplier on the base size */
  scale: number
  /** degrees */
  rotation: number
}

interface SavedSticker {
  id: string
  imageDataUrl: string
  /** JSON array of StickerItem so the sticker can be re-edited */
  itemsJson: string
  bgGradient: boolean
  itemCount: number
  createdAt: number
}

interface HitBox {
  cx: number
  cy: number
  hw: number
  hh: number
}

/** Same escape hatch the rest of the suite uses for file sharing. */
interface ShareFilesNavigator extends Navigator {
  canShare: (data?: ShareData) => boolean
}

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const DB_NAME = 'toolhub-stickers'
const DB_VERSION = 1
const STICKERS_STORE = 'stickers'

/** Backing store of the on-screen preview (CSS-scaled, keeps text crisp). */
const PREVIEW = 720
const BASE_EMOJI = 0.26
const BASE_TEXT = 0.13
/** Saved-record dataUrl cap (≈2 MB). */
const MAX_SAVE_CHARS = 2_000_000

const EMOJI_FONT = `'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji','Twemoji Mozilla',sans-serif`
const UI_FONT = `system-ui,-apple-system,'Segoe UI',Roboto,sans-serif`

const EXPORT_SIZES = [512, 1024] as const
const SHEET_COLS = [2, 3] as const

interface EmojiPack {
  id: string
  name: string
  emojis: string[]
}

const PACKS: EmojiPack[] = [
  { id: 'smileys', name: 'Smileys', emojis: ['😀', '😍', '🤣', '😎', '🥳', '🤔', '😭', '🤯', '🥰', '😴'] },
  { id: 'animals', name: 'Animals', emojis: ['🐶', '🐱', '🦊', '🐼', '🐨', '🦁', '🐸', '🦄', '🐙', '🦋'] },
  { id: 'food', name: 'Food', emojis: ['🍕', '🍔', '🍟', '🌮', '🍩', '🍎', '🍉', '🧁', '☕', '🍺'] },
  { id: 'hearts', name: 'Hearts', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💖', '💫', '🔥', '✨'] },
  { id: 'hands', name: 'Hands', emojis: ['👍', '👎', '👏', '🙏', '💪', '🤙', '👋', '🫶', '✌️', '🤝'] },
  { id: 'symbols', name: 'Symbols', emojis: ['⭐', '🎵', '⚡', '💯', '✅', '❌', '❗', '🆒', '🎯', '🌈'] },
]

const TEXT_COLORS = ['#fafafa', '#f87171', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa', '#f471b5']

/** Transparency signal behind the canvas + saved thumbnails. */
const CHECKER: CSSProperties = {
  backgroundColor: '#18181b',
  backgroundImage: 'conic-gradient(#2e2e33 0 25%, #232327 0 50%, #2e2e33 0 75%, #232327 0)',
  backgroundSize: '16px 16px',
}

/** Thin glass scrollbar (house convention for long scroll areas). */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

const SPRING: Transition = { type: 'spring', stiffness: 320, damping: 26 }

function haptic(): void {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return clamp(n, min, max)
}

function spawnJitter(): number {
  return (Math.random() - 0.5) * 0.1
}

/* ================================================================== */
/* IndexedDB — toolhub-stickers v1 / store 'stickers'                  */
/* ================================================================== */

let dbPromise: Promise<IDBDatabase> | null = null

function openStickerDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STICKERS_STORE)) d.createObjectStore(STICKERS_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openStickerDb()
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

/* ================================================================== */
/* Canvas rendering (shared by preview, export and sheet)              */
/* ================================================================== */

function fillGradient(ctx: CanvasRenderingContext2D, S: number): void {
  const g = ctx.createLinearGradient(0, 0, S, S)
  g.addColorStop(0, '#a3e635')
  g.addColorStop(0.55, '#10b981')
  g.addColorStop(1, '#0d9488')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
}

function itemFontSize(item: StickerItem, S: number): number {
  return (item.kind === 'emoji' ? BASE_EMOJI : BASE_TEXT) * item.scale * S
}

function fontFor(item: StickerItem, size: number): string {
  if (item.kind === 'emoji') return `${size}px ${EMOJI_FONT}`
  return `${item.bold ? '700' : '400'} ${size}px ${UI_FONT}`
}

/** Draws one item centered on its (x·S, y·S) coordinates with rotation. */
function drawItem(ctx: CanvasRenderingContext2D, item: StickerItem, S: number): void {
  const size = itemFontSize(item, S)
  ctx.save()
  ctx.translate(item.x * S, item.y * S)
  ctx.rotate((item.rotation * Math.PI) / 180)
  ctx.font = fontFor(item, size)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  if (item.kind === 'text') {
    ctx.fillStyle = item.color || '#fafafa'
    ctx.fillText(item.text, 0, 0)
  } else {
    ctx.fillText(item.emoji, 0, 0)
  }
  ctx.restore()
}

/** Measured footprint (canvas units) — also used for hit testing. */
function measureHit(ctx: CanvasRenderingContext2D, item: StickerItem, S: number): HitBox {
  const size = itemFontSize(item, S)
  ctx.font = fontFor(item, size)
  const w =
    item.kind === 'emoji' ? size * 1.1 : Math.max(ctx.measureText(item.text).width, size * 0.9)
  const h = size * 1.3
  return { cx: item.x * S, cy: item.y * S, hw: w / 2, hh: h / 2 }
}

interface DrawOpts {
  /** bake the gradient background into this render */
  bg: boolean
  selectedId?: string | null
  /** optional sink filled with per-item hit boxes (canvas units) */
  hitSink?: Map<string, HitBox>
}

function drawSticker(ctx: CanvasRenderingContext2D, S: number, items: StickerItem[], opts: DrawOpts): void {
  ctx.clearRect(0, 0, S, S)
  if (opts.bg) fillGradient(ctx, S)
  opts.hitSink?.clear()
  for (const item of items) {
    if (opts.hitSink) opts.hitSink.set(item.id, measureHit(ctx, item, S))
    drawItem(ctx, item, S)
  }
  const sel = opts.selectedId ? items.find((i) => i.id === opts.selectedId) : undefined
  if (sel) {
    const hb = measureHit(ctx, sel, S)
    ctx.save()
    ctx.translate(hb.cx, hb.cy)
    ctx.rotate((sel.rotation * Math.PI) / 180)
    ctx.strokeStyle = 'rgba(163,230,53,0.95)'
    ctx.lineWidth = Math.max(2, S * 0.004)
    ctx.setLineDash([S * 0.02, S * 0.015])
    const pad = S * 0.012
    ctx.strokeRect(-hb.hw - pad, -hb.hh - pad, hb.hw * 2 + pad * 2, hb.hh * 2 + pad * 2)
    ctx.restore()
  }
}

/**
 * Sheet mode: distributes the current items across cols×cols cells (round
 * robin), then fits each cell's group via its measured bounding box so
 * every cell is evenly filled on one transparent PNG.
 */
function drawSheet(ctx: CanvasRenderingContext2D, S: number, items: StickerItem[], cols: number, bg: boolean): void {
  ctx.clearRect(0, 0, S, S)
  if (bg) fillGradient(ctx, S)
  const cells = cols * cols
  const buckets: StickerItem[][] = Array.from({ length: cells }, () => [])
  items.forEach((item, i) => {
    buckets[i % cells]?.push(item)
  })
  const cellW = S / cols
  for (let row = 0; row < cols; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const bucket = buckets[row * cols + col]
      if (!bucket || bucket.length === 0) continue
      let minX = Number.POSITIVE_INFINITY
      let minY = Number.POSITIVE_INFINITY
      let maxX = Number.NEGATIVE_INFINITY
      let maxY = Number.NEGATIVE_INFINITY
      for (const item of bucket) {
        const hb = measureHit(ctx, item, S)
        minX = Math.min(minX, hb.cx - hb.hw)
        maxX = Math.max(maxX, hb.cx + hb.hw)
        minY = Math.min(minY, hb.cy - hb.hh)
        maxY = Math.max(maxY, hb.cy + hb.hh)
      }
      const bw = Math.max(maxX - minX, 1)
      const bh = Math.max(maxY - minY, 1)
      const fit = Math.min((cellW * 0.84) / bw, (cellW * 0.84) / bh, 2.6)
      const gcx = (minX + maxX) / 2
      const gcy = (minY + maxY) / 2
      ctx.save()
      ctx.translate(col * cellW + cellW / 2, row * cellW + cellW / 2)
      ctx.scale(fit, fit)
      ctx.translate(-gcx, -gcy)
      for (const item of bucket) drawItem(ctx, item, S)
      ctx.restore()
    }
  }
}

function downloadDataUrl(dataUrl: string, fileName: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fileName
  a.click()
}

/** Restores persisted items with defensive validation. */
function parseItems(json: string): StickerItem[] {
  try {
    const raw: unknown = JSON.parse(json)
    if (!Array.isArray(raw)) return []
    const out: StickerItem[] = []
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue
      const o = entry as Record<string, unknown>
      const kind = o.kind === 'text' ? 'text' : 'emoji'
      const emoji = typeof o.emoji === 'string' ? o.emoji : ''
      const text = typeof o.text === 'string' ? o.text : ''
      if (kind === 'emoji' && emoji === '') continue
      if (kind === 'text' && text === '') continue
      out.push({
        id: typeof o.id === 'string' ? o.id : uid('it'),
        kind,
        emoji,
        text,
        color: typeof o.color === 'string' ? o.color : '#fafafa',
        bold: o.bold === true,
        x: clampNum(o.x, 0.02, 0.98, 0.5),
        y: clampNum(o.y, 0.02, 0.98, 0.5),
        scale: clampNum(o.scale, 0.4, 2.5, 1),
        rotation: clampNum(o.rotation, -180, 180, 0),
      })
    }
    return out
  } catch {
    return []
  }
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function StickerStudioApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [items, setItems] = useState<StickerItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [bgGradient, setBgGradient] = useState(false)
  const [exportSize, setExportSize] = useState<512 | 1024>(512)
  const [sheetCols, setSheetCols] = useState<2 | 3>(2)

  const [packId, setPackId] = useState<string>(PACKS[0]?.id ?? 'smileys')

  const [textDraft, setTextDraft] = useState('')
  const [textColor, setTextColor] = useState('#fafafa')
  const [textBold, setTextBold] = useState(true)

  const [saved, setSaved] = useState<SavedSticker[]>([])
  const [confirmArm, setConfirmArm] = useState<'canvas' | 'saved' | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hitRef = useRef<Map<string, HitBox>>(new Map())
  const dragRef = useRef<{ id: string; gx: number; gy: number } | null>(null)
  const armTimerRef = useRef<number | null>(null)

  const selected = items.find((i) => i.id === selectedId) ?? null
  const selectedTextItem = selected && selected.kind === 'text' ? selected : null
  const pack = PACKS.find((p) => p.id === packId) ?? PACKS[0]

  /* ---------------- hydrate saved stickers ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const all = await idbGetAll<SavedSticker>(STICKERS_STORE)
        if (!alive) return
        all.sort((a, b) => b.createdAt - a.createdAt)
        setSaved(all)
      } catch {
        /* private mode / quota — keep in-memory only */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  /* clear the pending "confirm" timer on the way out */
  useEffect(() => {
    return () => {
      if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current)
    }
  }, [])

  /* ---------------- preview render ---------------- */
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    drawSticker(ctx, PREVIEW, items, { bg: bgGradient, selectedId, hitSink: hitRef.current })
    if (items.length === 0) {
      ctx.save()
      ctx.fillStyle = bgGradient ? 'rgba(255,255,255,0.92)' : 'rgba(161,161,170,0.7)'
      ctx.font = `600 ${Math.round(PREVIEW * 0.042)}px ${UI_FONT}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Tap an emoji below to start', PREVIEW / 2, PREVIEW / 2)
      ctx.restore()
    }
  }, [items, bgGradient, selectedId])

  /* ---------------- pointer drag on canvas ---------------- */

  const canvasPoint = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect()
    const k = PREVIEW / Math.max(rect.width, 1)
    return { x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k }
  }

  const onCanvasPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const pt = canvasPoint(e)
    let hitId: string | null = null
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i]
      const hb = item ? hitRef.current.get(item.id) : undefined
      if (!item || !hb) continue
      if (Math.abs(pt.x - hb.cx) <= hb.hw && Math.abs(pt.y - hb.cy) <= hb.hh) {
        hitId = item.id
        break
      }
    }
    setSelectedId(hitId)
    if (!hitId) {
      dragRef.current = null
      return
    }
    const item = items.find((it) => it.id === hitId)
    if (item) dragRef.current = { id: item.id, gx: pt.x - item.x * PREVIEW, gy: pt.y - item.y * PREVIEW }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* pointer already gone */
    }
    haptic()
  }

  const onCanvasPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const pt = canvasPoint(e)
    const nx = clamp((pt.x - drag.gx) / PREVIEW, 0.02, 0.98)
    const ny = clamp((pt.y - drag.gy) / PREVIEW, 0.02, 0.98)
    setItems((prev) => prev.map((it) => (it.id === drag.id ? { ...it, x: nx, y: ny } : it)))
  }

  const endCanvasDrag = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!dragRef.current) return
    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* capture already released */
    }
  }

  /* ---------------- item mutations ---------------- */

  const updateSelected = (patch: Partial<StickerItem>): void => {
    if (!selectedId) return
    setItems((prev) => prev.map((it) => (it.id === selectedId ? { ...it, ...patch } : it)))
  }

  const addEmoji = (emoji: string): void => {
    haptic()
    const item: StickerItem = {
      id: uid('it'),
      kind: 'emoji',
      emoji,
      text: '',
      color: '#fafafa',
      bold: false,
      x: 0.5 + spawnJitter(),
      y: 0.5 + spawnJitter(),
      scale: 1,
      rotation: 0,
    }
    setItems((prev) => [...prev, item])
    setSelectedId(item.id)
  }

  const addText = (): void => {
    const value = (selectedTextItem ? selectedTextItem.text : textDraft).trim()
    if (value === '') {
      toast({ title: 'Type something first', description: 'Enter the text for your sticker above.' })
      return
    }
    haptic()
    const item: StickerItem = {
      id: uid('it'),
      kind: 'text',
      emoji: '',
      text: value,
      color: selectedTextItem ? selectedTextItem.color : textColor,
      bold: selectedTextItem ? selectedTextItem.bold : textBold,
      x: 0.5 + spawnJitter(),
      y: 0.42 + spawnJitter(),
      scale: 1,
      rotation: 0,
    }
    setItems((prev) => [...prev, item])
    setSelectedId(item.id)
    if (!selectedTextItem) setTextDraft('')
    toast({ title: 'Text added', description: 'Drag it on the canvas to position it.' })
  }

  const deleteSelected = (): void => {
    if (!selectedId) return
    haptic()
    setItems((prev) => prev.filter((it) => it.id !== selectedId))
    setSelectedId(null)
    toast({ title: 'Item removed' })
  }

  const clearCanvas = (): void => {
    haptic()
    if (confirmArm === 'canvas') {
      disarm()
      setItems([])
      setSelectedId(null)
      toast({ title: 'Canvas cleared' })
    } else {
      arm('canvas')
    }
  }

  /* two-tap confirm helper: arm → auto-disarm after 2.6 s */
  const arm = (target: 'canvas' | 'saved'): void => {
    setConfirmArm(target)
    if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current)
    armTimerRef.current = window.setTimeout(() => setConfirmArm(null), 2600)
  }
  const disarm = (): void => {
    if (armTimerRef.current !== null) window.clearTimeout(armTimerRef.current)
    armTimerRef.current = null
    setConfirmArm(null)
  }

  /* ---------------- text controls (draft ⇄ selected item) ---------------- */

  const activeText = selectedTextItem ? selectedTextItem.text : textDraft
  const activeColor = selectedTextItem ? selectedTextItem.color : textColor
  const activeBold = selectedTextItem ? selectedTextItem.bold : textBold

  const handleText = (v: string): void => {
    if (selectedTextItem) updateSelected({ text: v })
    else setTextDraft(v)
  }
  const handleColor = (v: string): void => {
    if (selectedTextItem) updateSelected({ color: v })
    else setTextColor(v)
  }
  const handleBold = (v: boolean): void => {
    if (selectedTextItem) updateSelected({ bold: v })
    else setTextBold(v)
  }

  /* ---------------- export ---------------- */

  const renderPng = (opts: { size: number; bg: boolean; sheetCols?: number }): string | null => {
    const canvas = document.createElement('canvas')
    canvas.width = opts.size
    canvas.height = opts.size
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    if (opts.sheetCols) drawSheet(ctx, opts.size, items, opts.sheetCols, opts.bg)
    else drawSticker(ctx, opts.size, items, { bg: opts.bg })
    return canvas.toDataURL('image/png')
  }

  const guardEmpty = (): boolean => {
    if (items.length > 0) return false
    toast({ title: 'Canvas is empty', description: 'Add an emoji or text item first.' })
    return true
  }

  const exportFail = (): void => {
    toast({
      title: 'Export failed',
      description: 'Canvas rendering is unavailable on this device.',
      variant: 'destructive',
    })
  }

  const downloadSticker = (): void => {
    if (guardEmpty()) return
    haptic()
    const url = renderPng({ size: exportSize, bg: bgGradient })
    if (!url) {
      exportFail()
      return
    }
    const fileName = `sticker-${Date.now()}.png`
    downloadDataUrl(url, fileName)
    toast({
      title: 'Sticker exported',
      description: `${fileName} · ${exportSize}×${exportSize} ${bgGradient ? 'with gradient' : 'transparent'} PNG`,
    })
  }

  const shareSticker = async (): Promise<void> => {
    if (guardEmpty()) return
    haptic()
    const canvas = document.createElement('canvas')
    canvas.width = exportSize
    canvas.height = exportSize
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      exportFail()
      return
    }
    drawSticker(ctx, exportSize, items, { bg: bgGradient })
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) {
      exportFail()
      return
    }
    const fileName = `sticker-${Date.now()}.png`
    const file = new File([blob], fileName, { type: 'image/png' })
    const nav = navigator as ShareFilesNavigator
    const canShareFiles =
      typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })
    if (canShareFiles) {
      try {
        await nav.share({ files: [file], title: 'My sticker' })
        toast({ title: 'Shared', description: `${fileName} is on its way.` })
      } catch {
        /* user dismissed the share sheet — nothing to do */
      }
      return
    }
    downloadDataUrl(canvas.toDataURL('image/png'), fileName)
    toast({
      title: 'Sharing not supported here',
      description: 'This device can’t share files directly — the sticker was downloaded instead.',
    })
  }

  const saveToGallery = async (): Promise<void> => {
    if (guardEmpty()) return
    haptic()
    const url = renderPng({ size: exportSize, bg: bgGradient })
    if (!url) {
      exportFail()
      return
    }
    const fileName = `sticker-${Date.now()}.png`
    const rec: PhotoRecord = {
      id: newPhotoId(),
      dataUrl: url,
      createdAt: Date.now(),
      fav: false,
      source: 'design',
      name: fileName,
    }
    try {
      await putPhoto(rec)
      toast({ title: 'Saved to Gallery', description: 'Find it in Photos — ready for Design Studio.' })
    } catch {
      toast({
        title: 'Could not save to Gallery',
        description: 'The shared photo store is unavailable on this device.',
        variant: 'destructive',
      })
    }
  }

  const exportSheet = (): void => {
    if (guardEmpty()) return
    haptic()
    const url = renderPng({ size: exportSize, bg: bgGradient, sheetCols })
    if (!url) {
      exportFail()
      return
    }
    const fileName = `sticker-sheet-${Date.now()}.png`
    downloadDataUrl(url, fileName)
    toast({
      title: 'Sticker sheet exported',
      description: `${sheetCols}×${sheetCols} grid · ${fileName}`,
    })
  }

  /* ---------------- saved stickers ---------------- */

  const saveSticker = (): void => {
    if (guardEmpty()) return
    haptic()
    const url = renderPng({ size: 512, bg: bgGradient })
    if (!url) {
      exportFail()
      return
    }
    if (url.length > MAX_SAVE_CHARS) {
      toast({
        title: 'Sticker too large to save',
        description: 'Try fewer items, smaller scale, or export at 512 px instead.',
        variant: 'destructive',
      })
      return
    }
    const rec: SavedSticker = {
      id: uid('stk'),
      imageDataUrl: url,
      itemsJson: JSON.stringify(items),
      bgGradient,
      itemCount: items.length,
      createdAt: Date.now(),
    }
    setSaved((prev) => [rec, ...prev])
    void idbPut(STICKERS_STORE, rec).catch(() => {
      toast({
        title: 'Could not save sticker',
        description: 'Storage is unavailable — the sticker lives in this session only.',
        variant: 'destructive',
      })
    })
    toast({ title: 'Sticker saved', description: 'Tap it any time to keep editing.' })
  }

  const loadSaved = (rec: SavedSticker): void => {
    haptic()
    const parsed = parseItems(rec.itemsJson)
    if (parsed.length === 0) {
      toast({
        title: 'Sticker is empty',
        description: 'This sticker has no editable items left.',
        variant: 'destructive',
      })
      return
    }
    setItems(parsed)
    setBgGradient(rec.bgGradient)
    setSelectedId(null)
    toast({
      title: 'Sticker loaded',
      description: `${parsed.length} item${parsed.length === 1 ? '' : 's'} back on the canvas.`,
    })
  }

  const removeSaved = (id: string): void => {
    haptic()
    setSaved((prev) => prev.filter((r) => r.id !== id))
    void idbDelete(STICKERS_STORE, id).catch(() => {
      toast({ title: 'Could not delete sticker', variant: 'destructive' })
    })
  }

  const clearSaved = (): void => {
    haptic()
    if (confirmArm === 'saved') {
      disarm()
      const ids = saved.map((r) => r.id)
      setSaved([])
      for (const id of ids) {
        void idbDelete(STICKERS_STORE, id).catch(() => {
          /* best effort */
        })
      }
      toast({ title: 'Saved stickers cleared' })
    } else {
      arm('saved')
    }
  }

  /* ---------------- render ---------------- */

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-zinc-100">
      <div className="mx-auto w-full max-w-xl space-y-4 px-4 pb-16 pt-5">
        {/* ---------- identity header ---------- */}
        <motion.header
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING}
          className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-lime-400 via-emerald-500 to-teal-600 p-4 shadow-[0_14px_32px_-10px_rgb(16_185_129/0.55),inset_0_1px_1px_rgb(255_255_255/0.4)]"
        >
          <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white/15 ring-1 ring-white/25">
            <SmilePlus className="size-7 text-white" strokeWidth={1.9} aria-hidden />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold tracking-tight text-white">Sticker Studio</h1>
            <p className="text-xs text-emerald-50/90">Emoji stickers · transparent PNG · print-ready sheets</p>
          </div>
        </motion.header>

        {/* ---------- canvas ---------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-200">Canvas</h2>
            <div className="flex items-center gap-1.5">
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[11px] font-medium text-zinc-400 ring-1 ring-white/10">
                {items.length} item{items.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={bgGradient}
                onClick={() => {
                  haptic()
                  setBgGradient((v) => !v)
                }}
                className={cn(
                  'flex h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors',
                  bgGradient
                    ? 'bg-lime-400/15 text-lime-300 ring-1 ring-lime-400/40'
                    : 'bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:text-zinc-200',
                )}
              >
                <Palette className="size-4" aria-hidden /> BG
              </button>
              {items.length > 0 && (
                <button
                  type="button"
                  onClick={clearCanvas}
                  className={cn(
                    'flex h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors',
                    confirmArm === 'canvas'
                      ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/50'
                      : 'bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:text-rose-300',
                  )}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {confirmArm === 'canvas' ? 'Sure?' : 'Clear'}
                </button>
              )}
            </div>
          </div>

          <div
            className="relative mx-auto w-full max-w-[420px] overflow-hidden rounded-xl ring-1 ring-white/10"
            style={CHECKER}
          >
            <canvas
              ref={canvasRef}
              width={PREVIEW}
              height={PREVIEW}
              className="relative block h-auto w-full touch-none select-none"
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onCanvasPointerMove}
              onPointerUp={endCanvasDrag}
              onPointerCancel={endCanvasDrag}
            />
          </div>

          <AnimatePresence>
            {selected && (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={SPRING}
                className="mt-3 space-y-3 rounded-xl border border-lime-400/25 bg-lime-400/5 p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/30 text-lg ring-1 ring-white/10">
                    {selected.kind === 'emoji' ? selected.emoji : <Type className="size-4 text-lime-300" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                    {selected.kind === 'text' ? `“${selected.text}”` : 'Drag it on the canvas to move'}
                  </span>
                  <button
                    type="button"
                    onClick={deleteSelected}
                    className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-rose-500/15 px-3 text-xs font-semibold text-rose-300 ring-1 ring-rose-400/30 transition-colors hover:bg-rose-500/25"
                  >
                    <Trash2 className="size-4" aria-hidden /> Delete
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-zinc-400">
                    Scale <b className="text-zinc-200">{selected.scale.toFixed(2)}×</b>
                  </span>
                  <input
                    type="range"
                    min={0.4}
                    max={2.5}
                    step={0.05}
                    value={selected.scale}
                    onChange={(e) => updateSelected({ scale: Number(e.target.value) })}
                    className="h-11 flex-1 accent-lime-400"
                    aria-label="Item scale"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-zinc-400">
                    Rotate <b className="text-zinc-200">{Math.round(selected.rotation)}°</b>
                  </span>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={5}
                    value={selected.rotation}
                    onChange={(e) => updateSelected({ rotation: Number(e.target.value) })}
                    className="h-11 flex-1 accent-lime-400"
                    aria-label="Item rotation"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!selected && (
            <p className="mt-3 text-center text-xs text-zinc-500">
              Tap an item to select it · drag to move · sliders resize &amp; rotate
            </p>
          )}
        </section>

        {/* ---------- emoji packs ---------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <SmilePlus className="size-4 text-lime-300" aria-hidden /> Emoji packs
          </h2>
          <div className={cn('mb-2 flex gap-1.5 overflow-x-auto pb-1', THIN_SCROLLBAR)}>
            {PACKS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  haptic()
                  setPackId(p.id)
                }}
                className={cn(
                  'h-11 shrink-0 rounded-xl px-3.5 text-xs font-semibold transition-colors',
                  p.id === pack?.id
                    ? 'bg-lime-400/15 text-lime-300 ring-1 ring-lime-400/40'
                    : 'bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:text-zinc-200',
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
          <motion.div
            key={pack?.id ?? 'pack'}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING}
            className={cn('grid max-h-56 grid-cols-6 gap-1 overflow-y-auto pr-1 sm:grid-cols-8', THIN_SCROLLBAR)}
          >
            {(pack?.emojis ?? []).map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => addEmoji(emoji)}
                aria-label={`Add ${emoji} to canvas`}
                className="flex size-11 items-center justify-center rounded-xl bg-white/5 text-2xl ring-1 ring-white/10 transition-transform hover:bg-white/10 active:scale-90"
              >
                {emoji}
              </button>
            ))}
          </motion.div>
        </section>

        {/* ---------- text stickers ---------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <Type className="size-4 text-emerald-300" aria-hidden /> Text sticker
            </h2>
            {selectedTextItem && (
              <span className="rounded-full bg-lime-400/10 px-2.5 py-1 text-[11px] font-medium text-lime-300 ring-1 ring-lime-400/30">
                editing selected
              </span>
            )}
          </div>
          <input
            type="text"
            value={activeText}
            onChange={(e) => handleText(e.target.value)}
            placeholder="Type sticker text…"
            maxLength={40}
            className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-lime-400/40"
            aria-label="Sticker text"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {TEXT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => handleColor(color)}
                aria-label={`Text color ${color}`}
                className={cn(
                  'size-11 rounded-full transition-transform active:scale-90',
                  activeColor.toLowerCase() === color.toLowerCase()
                    ? 'ring-2 ring-lime-300 ring-offset-2 ring-offset-zinc-950'
                    : 'ring-1 ring-white/20',
                )}
                style={{ backgroundColor: color }}
              />
            ))}
            <input
              type="color"
              value={activeColor}
              onChange={(e) => handleColor(e.target.value)}
              aria-label="Custom text color"
              className="size-11 cursor-pointer rounded-xl border border-white/10 bg-transparent p-1"
            />
            <button
              type="button"
              onClick={() => handleBold(!activeBold)}
              aria-pressed={activeBold}
              aria-label={activeBold ? 'Bold on' : 'Bold off'}
              className={cn(
                'flex size-11 items-center justify-center rounded-xl transition-colors',
                activeBold
                  ? 'bg-lime-400/15 text-lime-300 ring-1 ring-lime-400/40'
                  : 'bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:text-zinc-200',
              )}
            >
              <Bold className="size-4" aria-hidden />
            </button>
            <Button
              onClick={addText}
              className="ml-auto h-11 rounded-xl bg-gradient-to-r from-lime-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-lime-200 hover:to-emerald-400"
            >
              <Plus className="size-4" aria-hidden /> Add text
            </Button>
          </div>
        </section>

        {/* ---------- export ---------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <Download className="size-4 text-teal-300" aria-hidden /> Export
            </h2>
            <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
              {EXPORT_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => {
                    haptic()
                    setExportSize(size)
                  }}
                  aria-pressed={exportSize === size}
                  className={cn(
                    'h-11 rounded-lg px-3.5 text-xs font-semibold transition-colors',
                    exportSize === size
                      ? 'bg-teal-500/25 text-teal-200 ring-1 ring-teal-400/40'
                      : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {size} px
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={downloadSticker}
              className="col-span-2 h-11 rounded-xl bg-gradient-to-r from-lime-300 via-emerald-400 to-teal-500 font-semibold text-zinc-950 shadow-lg hover:brightness-110"
            >
              <Download className="size-4" aria-hidden /> Download sticker PNG
            </Button>
            <Button
              variant="outline"
              onClick={() => void shareSticker()}
              className="h-11 rounded-xl border-white/15 bg-white/5 font-semibold hover:bg-white/10 hover:text-white"
            >
              <Share2 className="size-4" aria-hidden /> Share
            </Button>
            <Button
              variant="outline"
              onClick={() => void saveToGallery()}
              className="h-11 rounded-xl border-white/15 bg-white/5 font-semibold hover:bg-white/10 hover:text-white"
            >
              <ImagePlus className="size-4" aria-hidden /> Save to Gallery
            </Button>
          </div>

          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                <Grid2x2 className="size-4 text-teal-300" aria-hidden /> Sticker sheet — print &amp; cut
              </span>
              <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
                {SHEET_COLS.map((cols) => (
                  <button
                    key={cols}
                    type="button"
                    onClick={() => {
                      haptic()
                      setSheetCols(cols)
                    }}
                    aria-pressed={sheetCols === cols}
                    className={cn(
                      'h-11 rounded-lg px-3.5 text-xs font-semibold transition-colors',
                      sheetCols === cols
                        ? 'bg-teal-500/25 text-teal-200 ring-1 ring-teal-400/40'
                        : 'text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    {cols}×{cols}
                  </button>
                ))}
              </div>
            </div>
            <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
              Arranges your {items.length} item{items.length === 1 ? '' : 's'} evenly across {sheetCols}×{sheetCols}{' '}
              cells (bounding-box fit per cell) on one transparent PNG.
            </p>
            <Button
              variant="outline"
              onClick={exportSheet}
              className="h-11 w-full rounded-xl border-teal-400/30 bg-teal-500/15 font-semibold text-teal-200 hover:bg-teal-500/25 hover:text-teal-100"
            >
              <Grid2x2 className="size-4" aria-hidden /> Export sheet
            </Button>
          </div>
        </section>

        {/* ---------- saved stickers ---------- */}
        <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
              <Images className="size-4 text-emerald-300" aria-hidden /> Saved stickers
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium text-zinc-400 ring-1 ring-white/10">
                {saved.length}
              </span>
            </h2>
            <div className="flex items-center gap-1.5">
              <Button
                onClick={saveSticker}
                className="h-11 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 font-semibold text-zinc-950 shadow-lg hover:from-emerald-300 hover:to-teal-400"
              >
                <Check className="size-4" aria-hidden /> Save current
              </Button>
              {saved.length > 0 && (
                <button
                  type="button"
                  onClick={clearSaved}
                  className={cn(
                    'flex h-11 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors',
                    confirmArm === 'saved'
                      ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/50'
                      : 'bg-white/5 text-zinc-400 ring-1 ring-white/10 hover:text-rose-300',
                  )}
                >
                  <Trash2 className="size-4" aria-hidden />
                  {confirmArm === 'saved' ? 'Sure?' : 'Clear all'}
                </button>
              )}
            </div>
          </div>

          {saved.length === 0 ? (
            <p className="py-4 text-center text-xs text-zinc-500">
              No saved stickers yet — compose one and tap “Save current”.
            </p>
          ) : (
            <div className={cn('grid max-h-96 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4', THIN_SCROLLBAR)}>
              {saved.map((rec) => (
                <div key={rec.id} className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => loadSaved(rec)}
                    aria-label={`Open sticker with ${rec.itemCount} items`}
                    className="block aspect-square w-full rounded-xl p-1 ring-1 ring-white/10 transition hover:ring-lime-400/50"
                    style={CHECKER}
                  >
                    <img
                      src={rec.imageDataUrl}
                      alt=""
                      className="h-full w-full object-contain"
                      loading="lazy"
                      decoding="async"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSaved(rec.id)}
                    aria-label="Delete saved sticker"
                    className="flex h-11 w-full items-center justify-center gap-1 rounded-xl bg-white/5 text-[11px] font-medium text-zinc-400 ring-1 ring-white/10 transition-colors hover:text-rose-300"
                  >
                    <X className="size-3.5" aria-hidden /> Remove
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-zinc-600">
            Saved stickers keep their items — tap one to re-open it in the editor.
          </p>
        </section>
      </div>
    </div>
  )
}
