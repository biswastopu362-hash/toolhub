'use client'

/**
 * Presentation Studio — slides that sell the story.
 *
 * A touch-first slide editor + presenter, fully on-device:
 *  - 16:9 canvas with normalized (0–1) element coordinates so every render
 *    (editor canvas, filmstrip thumbs, presenter, deck previews) is the same
 *    SlideView at a different pixel size.
 *  - Elements: text (double-tap to edit), rect, ellipse, line, image
 *    (file picker → canvas downscale to ≤1280px, JPEG ≤1.5MB, zero uploads).
 *  - Drag to move, single bottom-right handle to resize, floating glass
 *    toolbar (z-order, duplicate, delete, swatches, font size, bold, align).
 *  - 6 theme presets that restyle the background + the first two text
 *    elements (title/body colors).
 *  - Slide sorter filmstrip with add / duplicate / delete / reorder.
 *  - Presenter mode: fullscreen overlay, tap/swipe/arrow keys, next-slide
 *    preview + counter, ESC exits.
 *  - Export: vector PDF (jsPDF primitives — gradients degrade to the average
 *    gradient color via a token map), JSON export/import for moving devices.
 *
 * Persistence: IndexedDB 'toolhub-decks' v1, store 'decks' (keyPath 'id'),
 * optimistic setState then void idbPut(...).catch(() => {}), hydration with
 * an alive flag.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Download,
  FileDown,
  ImagePlus,
  Layers,
  Loader2,
  Minus,
  Palette,
  Pencil,
  Play,
  Plus,
  Presentation,
  Square,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                              */
/* ================================================================== */

type TemplateId = 'midnight' | 'sunrise' | 'ocean' | 'orchid' | 'paper' | 'forest'
type Align = 'left' | 'center' | 'right'

interface TextEl {
  id: string
  kind: 'text'
  /** 0–1 normalized box */
  x: number
  y: number
  w: number
  h: number
  text: string
  /** relative font size 0.5–3 */
  size: number
  weight: number
  color: string
  align: Align
}

interface ShapeEl {
  id: string
  kind: 'rect' | 'ellipse' | 'line'
  x: number
  y: number
  w: number
  h: number
  fill: string
  /** rect only — corner radius as a fraction (0–0.5) of the short side */
  radius?: number
}

interface ImageEl {
  id: string
  kind: 'image'
  x: number
  y: number
  w: number
  h: number
  /** dataURL, downscaled to ≤1280px and capped at ~1.5MB */
  src: string
}

type El = TextEl | ShapeEl | ImageEl

interface Slide {
  id: string
  template: TemplateId
  /** css color or gradient token */
  bg: string
  elements: El[]
}

interface Deck {
  id: string
  name: string
  updatedAt: number
  slides: Slide[]
}

type Screen = { kind: 'list' } | { kind: 'editor'; deckId: string; slideIdx: number }

/* ================================================================== */
/* Theme presets — bg token ↔ PDF fallback colors                     */
/* ================================================================== */

interface Template {
  id: TemplateId
  name: string
  /** css value used by the DOM renderer */
  bg: string
  /** gradient endpoints (or solid split) used when drawing the PDF */
  from: string
  to: string
  accent: string
  titleColor: string
  bodyColor: string
}

const TEMPLATES: Template[] = [
  {
    id: 'midnight',
    name: 'Midnight',
    bg: 'linear-gradient(135deg, #09090b 0%, #052e16 100%)',
    from: '#09090b',
    to: '#052e16',
    accent: '#34d399',
    titleColor: '#fafafa',
    bodyColor: '#a1a1aa',
  },
  {
    id: 'sunrise',
    name: 'Sunrise',
    bg: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
    from: '#f59e0b',
    to: '#ea580c',
    accent: '#fff7ed',
    titleColor: '#fffbeb',
    bodyColor: '#ffedd5',
  },
  {
    id: 'ocean',
    name: 'Ocean',
    bg: 'linear-gradient(135deg, #0d9488 0%, #164e63 100%)',
    from: '#0d9488',
    to: '#164e63',
    accent: '#67e8f9',
    titleColor: '#ecfeff',
    bodyColor: '#a5f3fc',
  },
  {
    id: 'orchid',
    name: 'Orchid',
    bg: 'linear-gradient(135deg, #6d28d9 0%, #c026d3 100%)',
    from: '#6d28d9',
    to: '#c026d3',
    accent: '#f0abfc',
    titleColor: '#faf5ff',
    bodyColor: '#e9d5ff',
  },
  {
    id: 'paper',
    name: 'Paper',
    bg: '#fafaf9',
    from: '#fafaf9',
    to: '#e7e5e4',
    accent: '#0f766e',
    titleColor: '#18181b',
    bodyColor: '#52525b',
  },
  {
    id: 'forest',
    name: 'Forest',
    bg: 'linear-gradient(135deg, #022c22 0%, #14532d 100%)',
    from: '#022c22',
    to: '#14532d',
    accent: '#a3e635',
    titleColor: '#f7fee7',
    bodyColor: '#bef264',
  },
]

function tplOf(slide: Slide | undefined): Template {
  if (!slide) return TEMPLATES[0]
  return TEMPLATES.find((t) => t.id === slide.template) ?? TEMPLATES[0]
}

/** swatch palette for text colors / shape fills — no blue, no indigo */
const SWATCHES = [
  '#ffffff',
  '#fde047',
  '#fb923c',
  '#fb7185',
  '#e879f9',
  '#a78bfa',
  '#34d399',
  '#2dd4bf',
  '#a3e635',
  '#18181b',
]

/** thin glass scrollbar for horizontal + vertical strips */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/* ================================================================== */
/* IndexedDB — 'toolhub-decks' v1, store 'decks', keyPath 'id'        */
/* ================================================================== */

const DB_NAME = 'toolhub-decks'
const DB_VERSION = 1
const DECKS_STORE = 'decks'

let dbPromise: Promise<IDBDatabase> | null = null

function openDecksDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(DECKS_STORE)) d.createObjectStore(DECKS_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openDecksDb()
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
/* Small utils                                                        */
/* ================================================================== */

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

function fmtUpdated(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/* ---------------- color parsing (CSS → RGB for the PDF) ---------------- */

interface RGB {
  r: number
  g: number
  b: number
}

function parseHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim())
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function parseCssColor(s: string): RGB | null {
  const t = s.trim()
  const hx = parseHex(t)
  if (hx) return hx
  const m = /^rgba?\(([^)]+)\)$/i.exec(t)
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean)
    if (parts.length >= 3) {
      const r = parseFloat(parts[0])
      const g = parseFloat(parts[1])
      const b = parseFloat(parts[2])
      if ([r, g, b].every((n) => Number.isFinite(n))) {
        return { r: clamp(Math.round(r), 0, 255), g: clamp(Math.round(g), 0, 255), b: clamp(Math.round(b), 0, 255) }
      }
    }
  }
  return null
}

function mixRgb(a: RGB, b: RGB): RGB {
  return {
    r: Math.round((a.r + b.r) / 2),
    g: Math.round((a.g + b.g) / 2),
    b: Math.round((a.b + b.b) / 2),
  }
}

/**
 * Resolve a css color/gradient token to flat RGB for the PDF exporter.
 * Gradients (template bg tokens) degrade to the average of their endpoints.
 */
function resolveFill(s: string, fallback: RGB): RGB {
  const c = parseCssColor(s)
  if (c) return c
  const t = TEMPLATES.find((tpl) => tpl.bg === s)
  if (t) {
    const a = parseHex(t.from) ?? fallback
    const b = parseHex(t.to) ?? fallback
    return mixRgb(a, b)
  }
  return fallback
}

/* ================================================================== */
/* Factories + import sanitization                                    */
/* ================================================================== */

const MAX_SLIDES = 100
const MAX_ELEMENTS = 60
const MAX_IMAGE_SRC_CHARS = 2_100_000 // ≈1.5MB binary once base64-decoded

function starterText(t: Template, title: boolean): El {
  if (title) {
    return {
      id: newId('el'),
      kind: 'text',
      x: 0.09,
      y: 0.2,
      w: 0.82,
      h: 0.22,
      text: 'Slide title',
      size: 1.4,
      weight: 700,
      color: t.titleColor,
      align: 'left',
    }
  }
  return {
    id: newId('el'),
    kind: 'text',
    x: 0.09,
    y: 0.47,
    w: 0.82,
    h: 0.14,
    text: 'Add your words…',
    size: 0.6,
    weight: 400,
    color: t.bodyColor,
    align: 'left',
  }
}

function freshSlide(t: Template, withText: boolean): Slide {
  return {
    id: newId('sl'),
    template: t.id,
    bg: t.bg,
    elements: withText ? [starterText(t, true)] : [],
  }
}

function cloneSlide(s: Slide): Slide {
  return {
    id: newId('sl'),
    template: s.template,
    bg: s.bg,
    elements: s.elements.map((e) => ({ ...e, id: newId('el') }) as El),
  }
}

function cloneDeck(d: Deck): Deck {
  return {
    id: newId('dk'),
    name: `${d.name} copy`.slice(0, 80),
    updatedAt: Date.now(),
    slides: d.slides.map(cloneSlide),
  }
}

function sanitizeElement(raw: unknown): El | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' && r.id ? r.id.slice(0, 48) : newId('el')
  const x = clamp(typeof r.x === 'number' && Number.isFinite(r.x) ? r.x : 0.1, -0.5, 1)
  const y = clamp(typeof r.y === 'number' && Number.isFinite(r.y) ? r.y : 0.1, -0.5, 1)
  const w = clamp(typeof r.w === 'number' && Number.isFinite(r.w) ? r.w : 0.5, 0.02, 1.5)
  const hRaw = typeof r.h === 'number' && Number.isFinite(r.h) ? r.h : 0.1
  if (r.kind === 'text') {
    return {
      id,
      kind: 'text',
      x,
      y,
      w,
      h: clamp(hRaw, 0.03, 1.5),
      text: typeof r.text === 'string' ? r.text.slice(0, 2000) : '',
      size: clamp(typeof r.size === 'number' && Number.isFinite(r.size) ? r.size : 1, 0.5, 3),
      weight: (typeof r.weight === 'number' && r.weight >= 550 ? 700 : 400) as number,
      color: typeof r.color === 'string' ? r.color.slice(0, 60) : '#fafafa',
      align: r.align === 'center' || r.align === 'right' ? r.align : 'left',
    }
  }
  if (r.kind === 'rect' || r.kind === 'ellipse' || r.kind === 'line') {
    return {
      id,
      kind: r.kind,
      x,
      y,
      w,
      h: r.kind === 'line' ? clamp(hRaw, 0.002, 0.1) : clamp(hRaw, 0.01, 1.5),
      fill: typeof r.fill === 'string' ? r.fill.slice(0, 60) : '#34d399',
      radius: r.kind === 'rect' ? clamp(typeof r.radius === 'number' && Number.isFinite(r.radius) ? r.radius : 0.12, 0, 0.5) : undefined,
    }
  }
  if (r.kind === 'image') {
    const src = typeof r.src === 'string' ? r.src : ''
    if (!src.startsWith('data:image/') || src.length > MAX_IMAGE_SRC_CHARS) return null
    return { id, kind: 'image', x, y, w, h: clamp(hRaw, 0.02, 1.5), src }
  }
  return null
}

function sanitizeSlide(raw: unknown): Slide | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const template: TemplateId = TEMPLATES.some((t) => t.id === r.template) ? (r.template as TemplateId) : 'midnight'
  const fallback = TEMPLATES.find((t) => t.id === template) ?? TEMPLATES[0]
  const els = Array.isArray(r.elements) ? r.elements.slice(0, MAX_ELEMENTS) : []
  const elements = els.map(sanitizeElement).filter((e): e is El => e !== null)
  return {
    id: typeof r.id === 'string' && r.id ? r.id.slice(0, 48) : newId('sl'),
    template,
    bg: typeof r.bg === 'string' && r.bg.length <= 200 ? r.bg : fallback.bg,
    elements,
  }
}

/** Tolerant import validation — returns null when the file is not a deck. */
function sanitizeDeck(raw: unknown, keepId = false): Deck | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 80) : 'Imported deck'
  const slidesRaw = Array.isArray(r.slides) ? r.slides : null
  if (!slidesRaw || slidesRaw.length === 0 || slidesRaw.length > MAX_SLIDES) return null
  const slides = slidesRaw.map(sanitizeSlide).filter((s): s is Slide => s !== null)
  if (slides.length === 0) return null
  return {
    id: keepId && typeof r.id === 'string' && r.id ? r.id.slice(0, 48) : newId('dk'),
    name,
    updatedAt: keepId && typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : Date.now(),
    slides,
  }
}

/* ================================================================== */
/* Image import — downscale to ≤1280px, ≤1.5MB, zero uploads          */
/* ================================================================== */

async function imageFileToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('Could not read that image'))
      i.src = url
    })
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight, 1))
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    ctx.drawImage(img, 0, 0, w, h)
    // keep PNG (with alpha) when it already fits the cap, else fall back to JPEG
    if (file.type === 'image/png') {
      const png = canvas.toDataURL('image/png')
      if (png.length <= MAX_IMAGE_SRC_CHARS) return png
    }
    for (const q of [0.85, 0.7, 0.5]) {
      const data = canvas.toDataURL('image/jpeg', q)
      if (data.length <= MAX_IMAGE_SRC_CHARS) return data
    }
    throw new Error('Image is too large even after downscaling')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* ================================================================== */
/* Pure slide rendering — one component at any pixel size             */
/* ================================================================== */

const FONT_FACTOR = 0.075 // fontSize = size × factor × canvasHeight(px)

function SlideElView({ el, designW, designH }: { el: El; designW: number; designH: number }) {
  if (el.kind === 'text') {
    return (
      <div
        className="h-full w-full overflow-hidden whitespace-pre-wrap break-words"
        style={{
          fontSize: Math.max(5, el.size * FONT_FACTOR * designH),
          lineHeight: 1.15,
          fontWeight: el.weight,
          color: el.color,
          textAlign: el.align,
        }}
      >
        {el.text}
      </div>
    )
  }
  if (el.kind === 'rect') {
    const radius = (el.radius ?? 0) * Math.min(el.w * designW, el.h * designH)
    return <div className="h-full w-full" style={{ background: el.fill, borderRadius: Math.max(0, radius) }} />
  }
  if (el.kind === 'ellipse') {
    return <div className="h-full w-full rounded-[50%]" style={{ background: el.fill }} />
  }
  if (el.kind === 'line') {
    return (
      <div
        className="h-full w-full rounded-full"
        style={{ background: el.fill, minHeight: Math.max(1.5, el.h * designH) }}
      />
    )
  }
  if (el.kind === 'image') {
    return (
       
      <img src={el.src} alt="" draggable={false} className="h-full w-full select-none object-cover" />
    )
  }
  return null
}

function SlideView({ slide, w, h }: { slide: Slide; w: number; h: number }) {
  return (
    <div className="relative select-none overflow-hidden" style={{ width: w, height: h, background: slide.bg }}>
      {slide.elements.map((el) => (
        <div
          key={el.id}
          className="absolute"
          style={{
            left: `${el.x * 100}%`,
            top: `${el.y * 100}%`,
            width: `${el.w * 100}%`,
            height: `${el.h * 100}%`,
          }}
        >
          <SlideElView el={el} designW={w} designH={h} />
        </div>
      ))}
    </div>
  )
}

/** Mini render: SlideView at 320×180 scaled down via CSS transform. */
function SlideThumb({ slide, width, className }: { slide: Slide; width: number; className?: string }) {
  const scale = width / 320
  return (
    <div className={cn('relative overflow-hidden', className)} style={{ width, height: width * (9 / 16) }}>
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ transform: `scale(${scale})`, width: 320, height: 180 }}
      >
        <SlideView slide={slide} w={320} h={180} />
      </div>
    </div>
  )
}

/* ================================================================== */
/* PDF export — vector primitives on landscape 16:9 pages             */
/* ================================================================== */

async function exportDeckPdf(deck: Deck): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const W = 960
  const H = 540
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [W, H], compress: true })

  deck.slides.forEach((slide, i) => {
    if (i > 0) doc.addPage([W, H], 'landscape')
    const bg = resolveFill(slide.bg, { r: 9, g: 9, b: 11 })
    doc.setFillColor(bg.r, bg.g, bg.b)
    doc.rect(0, 0, W, H, 'F')

    for (const el of slide.elements) {
      const x = el.x * W
      const y = el.y * H
      const w = el.w * W
      const h = el.h * H
      if (el.kind === 'text') {
        const c = resolveFill(el.color, { r: 250, g: 250, b: 250 })
        doc.setTextColor(c.r, c.g, c.b)
        doc.setFont('helvetica', el.weight >= 600 ? 'bold' : 'normal')
        doc.setFontSize(Math.max(6, el.size * FONT_FACTOR * H))
        const ax = el.align === 'left' ? x : el.align === 'center' ? x + w / 2 : x + w
        doc.text(el.text, ax, y + 2, {
          baseline: 'top',
          align: el.align,
          maxWidth: Math.max(8, w),
          lineHeightFactor: 1.15,
        })
      } else if (el.kind === 'rect') {
        const c = resolveFill(el.fill, { r: 52, g: 211, b: 153 })
        doc.setFillColor(c.r, c.g, c.b)
        const rx = Math.min((el.radius ?? 0) * Math.min(w, h), h / 2, w / 2)
        if (rx > 0.5) doc.roundedRect(x, y, w, h, rx, rx, 'F')
        else doc.rect(x, y, w, h, 'F')
      } else if (el.kind === 'ellipse') {
        const c = resolveFill(el.fill, { r: 52, g: 211, b: 153 })
        doc.setFillColor(c.r, c.g, c.b)
        doc.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 'F')
      } else if (el.kind === 'line') {
        const c = resolveFill(el.fill, { r: 52, g: 211, b: 153 })
        doc.setDrawColor(c.r, c.g, c.b)
        doc.setLineWidth(Math.max(1, h))
        doc.line(x, y + h / 2, x + w, y + h / 2)
      } else if (el.kind === 'image') {
        const fmt = el.src.slice(5, 30).includes('png') ? 'PNG' : 'JPEG'
        try {
          doc.addImage(el.src, fmt, x, y, w, h)
        } catch {
          /* skip unreadable image rather than failing the export */
        }
      }
    }
  })

  doc.save(`${deck.name.replace(/[^\w\- ]+/g, '').trim() || 'deck'}.pdf`)
}

/* ================================================================== */
/* Main component                                                     */
/* ================================================================== */

type DragMode = 'move' | 'resize'

interface DragState {
  mode: DragMode
  id: string
  sx: number
  sy: number
  ox: number
  oy: number
  ow: number
  oh: number
  moved: boolean
}

const INSERTS = [
  { key: 'text', label: 'Text', icon: Type },
  { key: 'rect', label: 'Rect', icon: Square },
  { key: 'ellipse', label: 'Ellipse', icon: Circle },
  { key: 'line', label: 'Line', icon: Minus },
  { key: 'image', label: 'Image', icon: ImagePlus },
] as const

type InsertKey = (typeof INSERTS)[number]['key']

export default function PresentationStudioApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [decks, setDecks] = useState<Deck[]>([])
  const [loaded, setLoaded] = useState(false)
  const [screen, setScreen] = useState<Screen>({ kind: 'list' })
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null)
  const [confirmDeckId, setConfirmDeckId] = useState<string | null>(null)
  const [confirmSlideDel, setConfirmSlideDel] = useState(false)
  const [busy, setBusy] = useState<'pdf' | null>(null)

  /* editor state */
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [canvasW, setCanvasW] = useState(0)

  /* presenter state */
  const [presenting, setPresenting] = useState(false)
  const [presIdx, setPresIdx] = useState(0)
  const [presArea, setPresArea] = useState({ w: 0, h: 0 })
  const [hint, setHint] = useState(true)

  /* ---------------- refs ---------------- */
  const decksRef = useRef<Deck[]>([])
  const dragRef = useRef<DragState | null>(null)
  const lastTapRef = useRef<{ id: string; t: number }>({ id: '', t: 0 })
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  const presAreaRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<{ x: number; y: number } | null>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const filmstripRef = useRef<HTMLDivElement>(null)
  const thumbRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const confirmTimer = useRef<number | null>(null)
  const enteredFsRef = useRef(false)

  /* ---------------- hydration (alive flag) ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rows = await idbGetAll<unknown>(DECKS_STORE)
        if (!alive) return
        const clean = rows
          .map((r) => sanitizeDeck(r, true))
          .filter((d): d is Deck => d !== null)
          .sort((a, b) => b.updatedAt - a.updatedAt)
        decksRef.current = clean
        setDecks(clean)
      } catch {
        /* private mode / quota — start with in-memory decks */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- deck state helpers (optimistic + write-through) --- */

  const applyDecks = useCallback((updater: (prev: Deck[]) => Deck[]) => {
    const next = updater(decksRef.current)
    decksRef.current = next
    setDecks(next)
  }, [])

  const persistDeck = useCallback((id: string) => {
    const d = decksRef.current.find((x) => x.id === id)
    if (d) void idbPut(DECKS_STORE, d).catch(() => {})
  }, [])

  /* ---------------- derived current deck / slide ---------------- */

  const deck = screen.kind === 'editor' ? decks.find((d) => d.id === screen.deckId) : undefined
  const slideIdx = deck ? clamp(screen.kind === 'editor' ? screen.slideIdx : 0, 0, deck.slides.length - 1) : 0
  const slide = deck?.slides[slideIdx]
  const selEl = slide?.elements.find((e) => e.id === selectedId) ?? null

  const sortedDecks = useMemo(() => [...decks].sort((a, b) => b.updatedAt - a.updatedAt), [decks])
  const totalSlides = useMemo(() => decks.reduce((s, d) => s + d.slides.length, 0), [decks])

  /* ---------------- canvas / presenter measuring ---------------- */

  useEffect(() => {
    if (screen.kind !== 'editor') return
    const el = canvasWrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setCanvasW(Math.round(w))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [screen.kind, screen.kind === 'editor' ? screen.deckId : ''])

  useEffect(() => {
    if (!presenting) return
    const el = presAreaRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect
      if (r) setPresArea({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [presenting])

  /* keep the current filmstrip thumb in view */
  useEffect(() => {
    if (screen.kind !== 'editor' || !slide) return
    const node = thumbRefs.current.get(slide.id)
    node?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
  }, [screen.kind, slide])

  /* two-tap confirm auto-reset */
  useEffect(() => {
    return () => {
      if (confirmTimer.current != null) window.clearTimeout(confirmTimer.current)
    }
  }, [])

  /* ---------------- deck CRUD ---------------- */

  const createDeck = useCallback(() => {
    const t = TEMPLATES[0]
    const d: Deck = {
      id: newId('dk'),
      name: 'Untitled deck',
      updatedAt: Date.now(),
      slides: [{ id: newId('sl'), template: t.id, bg: t.bg, elements: [starterText(t, true), starterText(t, false)] }],
    }
    applyDecks((prev) => [d, ...prev])
    void idbPut(DECKS_STORE, d).catch(() => {})
    haptic()
    setScreen({ kind: 'editor', deckId: d.id, slideIdx: 0 })
    setSelectedId(null)
    setEditingId(null)
    toast({ title: 'Deck created', description: 'Tap any text to start writing.' })
  }, [applyDecks, toast])

  const openDeck = useCallback((id: string) => {
    setScreen({ kind: 'editor', deckId: id, slideIdx: 0 })
    setSelectedId(null)
    setEditingId(null)
    setConfirmDeckId(null)
  }, [])

  const duplicateDeck = useCallback(
    (id: string) => {
      const src = decksRef.current.find((d) => d.id === id)
      if (!src) return
      const copy = cloneDeck(src)
      applyDecks((prev) => [copy, ...prev])
      void idbPut(DECKS_STORE, copy).catch(() => {})
      haptic()
      toast({ title: 'Deck duplicated', description: copy.name })
    },
    [applyDecks, toast],
  )

  const deleteDeck = useCallback(
    (id: string) => {
      applyDecks((prev) => prev.filter((d) => d.id !== id))
      void idbDelete(DECKS_STORE, id).catch(() => {})
      setConfirmDeckId(null)
      haptic(18)
      if (screen.kind === 'editor' && screen.deckId === id) setScreen({ kind: 'list' })
      toast({ title: 'Deck deleted' })
    },
    [applyDecks, screen, toast],
  )

  const twoTapDeleteDeck = useCallback(
    (id: string) => {
      if (confirmTimer.current != null) window.clearTimeout(confirmTimer.current)
      if (confirmDeckId === id) {
        deleteDeck(id)
        return
      }
      setConfirmDeckId(id)
      confirmTimer.current = window.setTimeout(() => setConfirmDeckId(null), 2600)
    },
    [confirmDeckId, deleteDeck],
  )

  const submitRename = useCallback(() => {
    if (!rename) return
    const name = rename.name.trim().slice(0, 80)
    if (!name) {
      toast({ title: 'Give the deck a name first' })
      return
    }
    applyDecks((prev) => prev.map((d) => (d.id === rename.id ? { ...d, name, updatedAt: Date.now() } : d)))
    persistDeck(rename.id)
    setRename(null)
    haptic()
    toast({ title: 'Renamed', description: name })
  }, [applyDecks, persistDeck, rename, toast])

  /* ---------------- slide ops ---------------- */

  const addSlide = useCallback(() => {
    if (!deck || !slide) return
    if (deck.slides.length >= MAX_SLIDES) {
      toast({ title: `Limit reached — ${MAX_SLIDES} slides max` })
      return
    }
    const t = tplOf(slide)
    const ns = freshSlide(t, true)
    applyDecks((prev) =>
      prev.map((d) =>
        d.id !== deck.id ? d : { ...d, updatedAt: Date.now(), slides: [...d.slides.slice(0, slideIdx + 1), ns, ...d.slides.slice(slideIdx + 1)] },
      ),
    )
    persistDeck(deck.id)
    setScreen({ kind: 'editor', deckId: deck.id, slideIdx: slideIdx + 1 })
    setSelectedId(null)
    setEditingId(null)
    setConfirmSlideDel(false)
    haptic()
  }, [applyDecks, deck, persistDeck, slide, slideIdx, toast])

  const duplicateSlide = useCallback(() => {
    if (!deck || !slide) return
    if (deck.slides.length >= MAX_SLIDES) {
      toast({ title: `Limit reached — ${MAX_SLIDES} slides max` })
      return
    }
    const copy = cloneSlide(slide)
    applyDecks((prev) =>
      prev.map((d) =>
        d.id !== deck.id
          ? d
          : { ...d, updatedAt: Date.now(), slides: [...d.slides.slice(0, slideIdx + 1), copy, ...d.slides.slice(slideIdx + 1)] },
      ),
    )
    persistDeck(deck.id)
    setScreen({ kind: 'editor', deckId: deck.id, slideIdx: slideIdx + 1 })
    setSelectedId(null)
    haptic()
    toast({ title: 'Slide duplicated' })
  }, [applyDecks, deck, persistDeck, slide, slideIdx, toast])

  const deleteSlide = useCallback(() => {
    if (!deck || !slide) return
    if (confirmTimer.current != null) window.clearTimeout(confirmTimer.current)
    if (!confirmSlideDel) {
      setConfirmSlideDel(true)
      confirmTimer.current = window.setTimeout(() => setConfirmSlideDel(false), 2600)
      return
    }
    if (deck.slides.length <= 1) {
      setConfirmSlideDel(false)
      toast({ title: 'A deck needs at least one slide' })
      return
    }
    const nextIdx = Math.max(0, slideIdx - 1)
    applyDecks((prev) =>
      prev.map((d) => (d.id !== deck.id ? d : { ...d, updatedAt: Date.now(), slides: d.slides.filter((s) => s.id !== slide.id) })),
    )
    persistDeck(deck.id)
    setScreen({ kind: 'editor', deckId: deck.id, slideIdx: nextIdx })
    setSelectedId(null)
    setEditingId(null)
    setConfirmSlideDel(false)
    haptic(18)
    toast({ title: 'Slide deleted' })
  }, [applyDecks, confirmSlideDel, deck, persistDeck, slide, slideIdx, toast])

  const moveSlide = useCallback(
    (dir: -1 | 1) => {
      if (!deck) return
      const to = slideIdx + dir
      if (to < 0 || to >= deck.slides.length) return
      applyDecks((prev) =>
        prev.map((d) => {
          if (d.id !== deck.id) return d
          const slides = [...d.slides]
          const [s] = slides.splice(slideIdx, 1)
          slides.splice(to, 0, s)
          return { ...d, updatedAt: Date.now(), slides }
        }),
      )
      persistDeck(deck.id)
      setScreen({ kind: 'editor', deckId: deck.id, slideIdx: to })
      haptic(8)
    },
    [applyDecks, deck, persistDeck, slideIdx],
  )

  /* ---------------- element ops ---------------- */

  const patchSlideState = useCallback(
    (fn: (s: Slide) => Slide) => {
      if (!deck || !slide) return
      applyDecks((prev) =>
        prev.map((d) => (d.id !== deck.id ? d : { ...d, slides: d.slides.map((s) => (s.id === slide.id ? fn(s) : s)) })),
      )
    },
    [applyDecks, deck, slide],
  )

  const patchElement = useCallback(
    (elId: string, patch: Partial<TextEl> & Partial<ShapeEl> & Partial<ImageEl>, persist = false) => {
      patchSlideState((s) => ({
        ...s,
        elements: s.elements.map((e) => (e.id === elId ? ({ ...e, ...patch } as El) : e)),
      }))
      if (persist && deck) persistDeck(deck.id)
    },
    [deck, patchSlideState, persistDeck],
  )

  const addElement = useCallback(
    (key: InsertKey) => {
      if (!deck || !slide) return
      if (slide.elements.length >= MAX_ELEMENTS) {
        toast({ title: `Limit reached — ${MAX_ELEMENTS} items per slide` })
        return
      }
      if (key === 'image') {
        imgInputRef.current?.click()
        return
      }
      const t = tplOf(slide)
      let el: El
      if (key === 'text') {
        el = {
          id: newId('el'),
          kind: 'text',
          x: 0.1,
          y: 0.42,
          w: 0.8,
          h: 0.14,
          text: 'Tap twice to edit',
          size: 0.6,
          weight: 400,
          color: t.bodyColor,
          align: 'left',
        }
      } else if (key === 'rect') {
        el = { id: newId('el'), kind: 'rect', x: 0.27, y: 0.32, w: 0.46, h: 0.3, fill: t.accent, radius: 0.12 }
      } else if (key === 'ellipse') {
        el = { id: newId('el'), kind: 'ellipse', x: 0.3, y: 0.28, w: 0.4, h: 0.4, fill: t.accent }
      } else {
        el = { id: newId('el'), kind: 'line', x: 0.15, y: 0.5, w: 0.7, h: 0.008, fill: t.accent }
      }
      patchSlideState((s) => ({ ...s, elements: [...s.elements, el] }))
      persistDeck(deck.id)
      setSelectedId(el.id)
      setEditingId(null)
      haptic()
    },
    [deck, patchSlideState, persistDeck, slide, toast],
  )

  const addImageElement = useCallback(
    async (file: File) => {
      if (!deck || !slide) return
      if (!file.type.startsWith('image/')) {
        toast({ title: 'That file is not an image' })
        return
      }
      if (slide.elements.length >= MAX_ELEMENTS) {
        toast({ title: `Limit reached — ${MAX_ELEMENTS} items per slide` })
        return
      }
      try {
        const src = await imageFileToDataUrl(file)
        const el: ImageEl = { id: newId('el'), kind: 'image', x: 0.2, y: 0.22, w: 0.6, h: 0.56, src }
        patchSlideState((s) => ({ ...s, elements: [...s.elements, el] }))
        persistDeck(deck.id)
        setSelectedId(el.id)
        haptic()
        toast({ title: 'Image added', description: 'Capped at 1280 px — never uploaded.' })
      } catch (err) {
        toast({ title: 'Could not add image', description: err instanceof Error ? err.message : 'Unknown error' })
      }
    },
    [deck, patchSlideState, persistDeck, slide, toast],
  )

  const duplicateElement = useCallback(() => {
    if (!deck || !slide || !selEl) return
    if (slide.elements.length >= MAX_ELEMENTS) {
      toast({ title: `Limit reached — ${MAX_ELEMENTS} items per slide` })
      return
    }
    const copy = {
      ...selEl,
      id: newId('el'),
      x: clamp(selEl.x + 0.04, 0, 1 - selEl.w),
      y: clamp(selEl.y + 0.04, 0, 1 - selEl.h),
    } as El
    const at = slide.elements.findIndex((e) => e.id === selEl.id) + 1
    patchSlideState((s) => ({
      ...s,
      elements: [...s.elements.slice(0, at), copy, ...s.elements.slice(at)],
    }))
    persistDeck(deck.id)
    setSelectedId(copy.id)
    haptic()
  }, [deck, patchSlideState, persistDeck, selEl, slide, toast])

  const deleteElement = useCallback(() => {
    if (!deck || !selEl) return
    patchSlideState((s) => ({ ...s, elements: s.elements.filter((e) => e.id !== selEl.id) }))
    persistDeck(deck.id)
    setSelectedId(null)
    setEditingId(null)
    haptic(18)
  }, [deck, patchSlideState, persistDeck, selEl])

  const reorderElement = useCallback(
    (dir: 'front' | 'back') => {
      if (!deck || !selEl) return
      patchSlideState((s) => {
        const els = [...s.elements]
        const i = els.findIndex((e) => e.id === selEl.id)
        if (i < 0) return s
        const [el] = els.splice(i, 1)
        els.splice(dir === 'front' ? els.length : 0, 0, el)
        return { ...s, elements: els }
      })
      persistDeck(deck.id)
      haptic(8)
    },
    [deck, patchSlideState, persistDeck, selEl],
  )

  const applyTemplate = useCallback(
    (t: Template) => {
      if (!deck || !slide) return
      if (slide.template === t.id && slide.bg === t.bg) return
      let seen = 0
      patchSlideState((s) => ({
        ...s,
        template: t.id,
        bg: t.bg,
        elements: s.elements.map((el) => {
          if (el.kind !== 'text') return el
          seen += 1
          if (seen === 1) return { ...el, color: t.titleColor, weight: 700 }
          if (seen === 2) return { ...el, color: t.bodyColor }
          return el
        }),
      }))
      persistDeck(deck.id)
      haptic()
      toast({ title: `${t.name} theme applied`, description: 'Title & body colors restyled.' })
    },
    [deck, patchSlideState, persistDeck, slide, toast],
  )

  /* ---------------- editor pointer interactions ---------------- */

  const onCanvasPointerDown = useCallback(() => {
    setSelectedId(null)
    setEditingId(null)
  }, [])

  const onElPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, el: El, mode: DragMode) => {
    if (editingId) return
    e.stopPropagation()
    setSelectedId(el.id)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* capture unavailable — drag still works while held */
    }
    dragRef.current = { mode, id: el.id, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h, moved: false }
  }, [editingId])

  const onElPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, el: El) => {
      const d = dragRef.current
      if (!d || d.id !== el.id) return
      const rect = canvasWrapRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return
      const dx = (e.clientX - d.sx) / rect.width
      const dy = (e.clientY - d.sy) / rect.height
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true
      if (!d.moved) return
      if (d.mode === 'move') {
        patchElement(el.id, {
          x: clamp(d.ox + dx, 0, 1 - d.ow),
          y: clamp(d.oy + dy, 0, 1 - d.oh),
        })
      } else {
        patchElement(el.id, {
          w: clamp(d.ow + dx, 0.05, 1 - d.ox),
          h: clamp(d.oh + dy, 0.03, 1 - d.oy),
        })
      }
    },
    [patchElement],
  )

  const onElPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, el: El) => {
      const d = dragRef.current
      if (!d || d.id !== el.id) return
      dragRef.current = null
      if (d.moved) {
        if (deck) persistDeck(deck.id)
        return
      }
      /* tap — detect double-tap on text to start editing */
      const now = performance.now()
      const last = lastTapRef.current
      if (last.id === el.id && now - last.t < 350) {
        lastTapRef.current = { id: '', t: 0 }
        if (el.kind === 'text') {
          setSelectedId(el.id)
          setEditingId(el.id)
          haptic(8)
        }
      } else {
        lastTapRef.current = { id: el.id, t: now }
      }
    },
    [deck, persistDeck],
  )

  const onElPointerCancel = useCallback(() => {
    dragRef.current = null
  }, [])

  /* ---------------- presenter ---------------- */

  const slidesLen = deck?.slides.length ?? 0

  const goNext = useCallback(() => {
    setPresIdx((i) => {
      const n = Math.min(i + 1, Math.max(0, slidesLen - 1))
      if (n !== i) haptic(8)
      return n
    })
  }, [slidesLen])

  const goPrev = useCallback(() => {
    setPresIdx((i) => {
      const n = Math.max(i - 1, 0)
      if (n !== i) haptic(8)
      return n
    })
  }, [])

  const openPresenter = useCallback(() => {
    if (!deck) return
    setPresIdx(slideIdx)
    setHint(true)
    setPresenting(true)
    haptic(10)
  }, [deck, slideIdx])

  /* fullscreen + keyboard + scroll lock while presenting */
  useEffect(() => {
    if (!presenting) return
    enteredFsRef.current = false
    try {
      const req = document.documentElement.requestFullscreen?.bind(document.documentElement)
      if (req) {
        void req()
          .then(() => {
            enteredFsRef.current = true
          })
          .catch(() => {})
      }
    } catch {
      /* fullscreen unavailable — fixed overlay fallback */
    }
    const onFsChange = () => {
      if (!document.fullscreenElement && enteredFsRef.current) setPresenting(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPresenting(false)
        return
      }
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') {
        e.preventDefault()
        goNext()
        setHint(false)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        goPrev()
        setHint(false)
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [presenting, goNext, goPrev])

  const onPresAreaPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    swipeRef.current = { x: e.clientX, y: e.clientY }
  }, [])

  const onPresAreaPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = swipeRef.current
      swipeRef.current = null
      if (!s) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) goNext()
        else goPrev()
        setHint(false)
      } else if (Math.hypot(dx, dy) < 10) {
        goNext()
        setHint(false)
      }
    },
    [goNext, goPrev],
  )

  /* ---------------- export / import ---------------- */

  const onExportPdf = useCallback(async () => {
    if (!deck || busy) return
    setBusy('pdf')
    try {
      await exportDeckPdf(deck)
      haptic()
      toast({ title: 'PDF exported', description: `${deck.slides.length} landscape slide${deck.slides.length === 1 ? '' : 's'} · ${deck.name}` })
    } catch (err) {
      toast({ title: 'PDF export failed', description: err instanceof Error ? err.message : 'Unknown error' })
    } finally {
      setBusy(null)
    }
  }, [busy, deck, toast])

  const onExportJson = useCallback(() => {
    if (!deck) return
    try {
      const blob = new Blob([JSON.stringify(deck)], { type: 'application/json' })
      const safe = deck.name.replace(/[^\w\- ]+/g, '').trim() || 'deck'
      downloadBlob(blob, `${safe}.deck.json`)
      haptic()
      toast({ title: 'Deck exported', description: 'Move it to any device and import it there.' })
    } catch {
      toast({ title: 'Export failed' })
    }
  }, [deck, toast])

  const onImportJson = useCallback(
    async (file: File) => {
      try {
        const text = await file.text()
        const parsed: unknown = JSON.parse(text)
        const d = sanitizeDeck(parsed)
        if (!d) {
          toast({ title: 'Invalid deck file', description: 'Expected a Presentation Studio JSON export.' })
          return
        }
        applyDecks((prev) => [d, ...prev])
        void idbPut(DECKS_STORE, d).catch(() => {})
        haptic()
        toast({ title: 'Deck imported', description: `${d.name} · ${d.slides.length} slides` })
      } catch (err) {
        toast({ title: 'Import failed', description: err instanceof Error ? err.message : 'Unreadable file' })
      }
    },
    [applyDecks, toast],
  )

  /* ---------------- render ---------------- */

  const editorActive = screen.kind === 'editor' && deck && slide

  return (
    <div className="mx-auto w-full max-w-4xl [color-scheme:dark]">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 p-3 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)] sm:p-4"
      >
        <div className="space-y-4">
      {/* hidden inputs */}
      <input
        ref={imgInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void addImageElement(f)
        }}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void onImportJson(f)
        }}
      />

      {/* header band */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24 }}
        className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-cyan-300 via-teal-400 to-teal-600 p-5 shadow-lg shadow-teal-950/40"
      >
        <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/25 blur-2xl" />
        <div className="relative flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 ring-1 ring-white/30">
            <Presentation className="h-6 w-6 text-white drop-shadow" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold tracking-tight text-white">Presentation Studio</h1>
            <p className="truncate text-[13px] text-white/85">Slides that sell the story.</p>
          </div>
        </div>
      </motion.div>

      {!loaded ? (
        <div className="space-y-3">
          <div className="h-24 animate-pulse rounded-3xl bg-white/[0.04]" />
          <div className="h-16 animate-pulse rounded-2xl bg-white/[0.03]" />
          <div className="h-16 animate-pulse rounded-2xl bg-white/[0.03]" />
        </div>
      ) : editorActive && deck && slide ? (
        <EditorScreen
          deck={deck}
          slideIdx={slideIdx}
          slide={slide}
          canvasW={canvasW}
          canvasWrapRef={canvasWrapRef}
          selectedId={selectedId}
          editingId={editingId}
          selEl={selEl}
          confirmSlideDel={confirmSlideDel}
          busy={busy}
          /* nav + deck actions */
          onBack={() => {
            setScreen({ kind: 'list' })
            setSelectedId(null)
            setEditingId(null)
          }}
          onOpenRename={() => setRename({ id: deck.id, name: deck.name })}
          onPresent={openPresenter}
          onExportPdf={onExportPdf}
          onExportJson={onExportJson}
          /* canvas */
          onCanvasPointerDown={onCanvasPointerDown}
          onElPointerDown={onElPointerDown}
          onElPointerMove={onElPointerMove}
          onElPointerUp={onElPointerUp}
          onElPointerCancel={onElPointerCancel}
          onPatchElement={patchElement}
          onCommitText={(elId) => {
            setEditingId(null)
            persistDeck(deck.id)
          }}
          /* toolbar */
          onReorderElement={reorderElement}
          onDuplicateElement={duplicateElement}
          onDeleteElement={deleteElement}
          /* insert + theme */
          onInsert={addElement}
          onApplyTemplate={applyTemplate}
          /* filmstrip */
          filmstripRef={filmstripRef}
          thumbRefs={thumbRefs}
          onSelectSlide={(i) => {
            setScreen({ kind: 'editor', deckId: deck.id, slideIdx: i })
            setSelectedId(null)
            setEditingId(null)
            setConfirmSlideDel(false)
          }}
          onAddSlide={addSlide}
          onDuplicateSlide={duplicateSlide}
          onDeleteSlide={deleteSlide}
          onMoveSlide={moveSlide}
        />
      ) : (
        <DeckListScreen
          decks={sortedDecks}
          totalSlides={totalSlides}
          confirmDeckId={confirmDeckId}
          onCreate={createDeck}
          onOpen={openDeck}
          onRename={(d) => setRename({ id: d.id, name: d.name })}
          onDuplicate={duplicateDeck}
          onDelete={twoTapDeleteDeck}
          onImport={() => importInputRef.current?.click()}
        />
      )}

      {/* rename modal */}
      <AnimatePresence>
        {rename && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
            onPointerDown={() => setRename(null)}
          >
            <motion.div
              initial={{ y: 60, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 40, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900 p-4 shadow-2xl"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center gap-2">
                <Pencil className="h-4 w-4 text-cyan-300" />
                <h2 className="text-[15px] font-semibold text-zinc-100">Rename deck</h2>
              </div>
              <input
                autoFocus
                value={rename.name}
                maxLength={80}
                onChange={(e) => setRename({ ...rename, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitRename()
                  if (e.key === 'Escape') setRename(null)
                }}
                placeholder="Deck name"
                aria-label="Deck name"
                className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.05] px-3 text-[15px] text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-cyan-300/60"
              />
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="ghost" className="h-11 rounded-xl" onClick={() => setRename(null)}>
                  Cancel
                </Button>
                <Button
                  className="h-11 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-500 font-semibold text-zinc-950 hover:from-cyan-300 hover:to-teal-400"
                  onClick={submitRename}
                >
                  Save
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* presenter overlay */}
      <AnimatePresence>
        {presenting && deck && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            role="dialog"
            aria-modal="true"
            aria-label="Presenter"
            className="fixed inset-0 z-[80] flex flex-col bg-zinc-950"
          >
            {/* top bar */}
            <div className="flex items-center gap-2 px-3 pt-3">
              <div className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold tabular-nums text-zinc-100">
                {presIdx + 1} / {deck.slides.length}
              </div>
              <div className="min-w-0 flex-1 truncate text-center text-xs text-zinc-500">{deck.name}</div>
              <button
                onClick={() => setPresenting(false)}
                aria-label="Exit presenter"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-zinc-200 transition hover:bg-white/20"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* slide stage — tap / swipe / keys */}
            <div
              ref={presAreaRef}
              className="flex min-h-0 flex-1 items-center justify-center p-3"
              style={{ touchAction: 'pan-y' }}
              onPointerDown={onPresAreaPointerDown}
              onPointerUp={onPresAreaPointerUp}
            >
              {presArea.w > 0 &&
                (() => {
                  const sw = Math.min(presArea.w, presArea.h * (16 / 9))
                  const sh = sw * (9 / 16)
                  const cur = deck.slides[Math.min(presIdx, deck.slides.length - 1)]
                  return (
                    <motion.div
                      key={cur.id}
                      initial={{ opacity: 0, scale: 0.985 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                      className="overflow-hidden rounded-lg shadow-2xl ring-1 ring-white/10"
                      style={{ width: sw, height: sh, cursor: 'pointer' }}
                    >
                      <SlideView slide={cur} w={Math.round(sw)} h={Math.round(sh)} />
                    </motion.div>
                  )
                })()}
            </div>

            {/* bottom bar: prev · next preview · next · hint */}
            <div className="flex flex-col items-center gap-2 px-4 pb-5">
              <AnimatePresence>
                {hint && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-[11px] text-zinc-500"
                  >
                    Tap or swipe to advance · arrow keys work too
                  </motion.p>
                )}
              </AnimatePresence>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    goPrev()
                    setHint(false)
                  }}
                  disabled={presIdx === 0}
                  aria-label="Previous slide"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-zinc-200 transition enabled:hover:bg-white/20 disabled:opacity-30"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                {presIdx < deck.slides.length - 1 ? (
                  <button
                    onClick={() => {
                      goNext()
                      setHint(false)
                    }}
                    aria-label="Next slide preview — tap to advance"
                    className="group relative overflow-hidden rounded-lg border border-white/15 ring-cyan-300/0 transition hover:ring-2 hover:ring-cyan-300/60"
                  >
                    <SlideThumb slide={deck.slides[presIdx + 1]} width={80} className="rounded-lg" />
                    <span className="absolute bottom-0.5 right-0.5 rounded bg-black/60 px-1 text-[9px] font-semibold text-white">
                      Next
                    </span>
                  </button>
                ) : (
                  <div className="flex h-[45px] w-20 items-center justify-center rounded-lg border border-dashed border-white/15 text-[10px] font-medium text-zinc-500">
                    End
                  </div>
                )}
                <button
                  onClick={() => {
                    goNext()
                    setHint(false)
                  }}
                  disabled={presIdx >= deck.slides.length - 1}
                  aria-label="Next slide"
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-teal-500 text-zinc-950 transition enabled:hover:from-cyan-300 enabled:hover:to-teal-400 disabled:opacity-30"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

/* ================================================================== */
/* Deck list screen                                                   */
/* ================================================================== */

function DeckListScreen({
  decks,
  totalSlides,
  confirmDeckId,
  onCreate,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onImport,
}: {
  decks: Deck[]
  totalSlides: number
  confirmDeckId: string | null
  onCreate: () => void
  onOpen: (id: string) => void
  onRename: (d: Deck) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onImport: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className="space-y-3"
    >
      {/* actions */}
      <div className="grid grid-cols-2 gap-2">
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onCreate}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-400 to-teal-500 text-[15px] font-semibold text-zinc-950 shadow-lg shadow-teal-950/40 transition hover:from-cyan-300 hover:to-teal-400"
        >
          <Plus className="h-5 w-5" /> New deck
        </motion.button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onImport}
          className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] text-[15px] font-medium text-zinc-200 transition hover:bg-white/10"
        >
          <Upload className="h-4.5 w-4.5" /> Import JSON
        </motion.button>
      </div>

      {decks.length === 0 ? (
        /* premium dashed empty state */
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.08, type: 'spring', stiffness: 240, damping: 24 }}
          className="flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-300/10 ring-1 ring-cyan-300/30">
            <Presentation className="h-7 w-7 text-cyan-300" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-zinc-200">No decks yet</p>
            <p className="mx-auto mt-1 max-w-[26ch] text-[13px] leading-relaxed text-zinc-500">
              Create your first deck — text, shapes and images, right on this device.
            </p>
          </div>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={onCreate}
            className="mt-1 flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-500 px-5 text-sm font-semibold text-zinc-950"
          >
            <Plus className="h-4 w-4" /> Create a deck
          </motion.button>
        </motion.div>
      ) : (
        <>
          <p className="px-1 text-xs text-zinc-500">
            {decks.length} deck{decks.length === 1 ? '' : 's'} · {totalSlides} slide{totalSlides === 1 ? '' : 's'}
          </p>
          <div
            className={cn(
              'space-y-2',
              decks.length > 5 && 'max-h-[460px] overflow-y-auto pr-1',
              THIN_SCROLLBAR,
            )}
          >
            {decks.map((d, i) => {
              const confirming = confirmDeckId === d.id
              return (
                <motion.div
                  key={d.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.25), type: 'spring', stiffness: 280, damping: 26 }}
                  whileTap={{ scale: 0.985 }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open deck ${d.name}`}
                  onClick={() => onOpen(d.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(d.id)
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition hover:border-white/20 hover:bg-white/[0.06]"
                >
                  <SlideThumb
                    slide={d.slides[0]}
                    width={80}
                    className="shrink-0 rounded-lg border border-white/10"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-zinc-100">{d.name}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500">
                      <Layers className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        {d.slides.length} slide{d.slides.length === 1 ? '' : 's'} · Updated {fmtUpdated(d.updatedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => onRename(d)}
                      aria-label={`Rename ${d.name}`}
                      title="Rename"
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-white/10 hover:text-zinc-200"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onDuplicate(d.id)}
                      aria-label={`Duplicate ${d.name}`}
                      title="Duplicate"
                      className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-white/10 hover:text-zinc-200"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => onDelete(d.id)}
                      aria-label={confirming ? `Tap again to delete ${d.name}` : `Delete ${d.name}`}
                      title={confirming ? 'Tap again' : 'Delete'}
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-xl transition',
                        confirming
                          ? 'bg-rose-500/20 text-rose-300 ring-1 ring-rose-400/40'
                          : 'text-zinc-400 hover:bg-rose-500/10 hover:text-rose-300',
                      )}
                    >
                      {confirming ? <span className="text-[11px] font-bold">Sure?</span> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        </>
      )}
    </motion.div>
  )
}

/* ================================================================== */
/* Editor screen                                                      */
/* ================================================================== */

function EditorScreen(props: {
  deck: Deck
  slideIdx: number
  slide: Slide
  canvasW: number
  canvasWrapRef: React.RefObject<HTMLDivElement | null>
  selectedId: string | null
  editingId: string | null
  selEl: El | null
  confirmSlideDel: boolean
  busy: 'pdf' | null
  onBack: () => void
  onOpenRename: () => void
  onPresent: () => void
  onExportPdf: () => void
  onExportJson: () => void
  onCanvasPointerDown: () => void
  onElPointerDown: (e: React.PointerEvent<HTMLDivElement>, el: El, mode: DragMode) => void
  onElPointerMove: (e: React.PointerEvent<HTMLDivElement>, el: El) => void
  onElPointerUp: (e: React.PointerEvent<HTMLDivElement>, el: El) => void
  onElPointerCancel: () => void
  onPatchElement: (elId: string, patch: Partial<TextEl> & Partial<ShapeEl> & Partial<ImageEl>, persist?: boolean) => void
  onCommitText: (elId: string) => void
  onReorderElement: (dir: 'front' | 'back') => void
  onDuplicateElement: () => void
  onDeleteElement: () => void
  onInsert: (key: InsertKey) => void
  onApplyTemplate: (t: Template) => void
  filmstripRef: React.RefObject<HTMLDivElement | null>
  thumbRefs: React.RefObject<Map<string, HTMLButtonElement>>
  onSelectSlide: (i: number) => void
  onAddSlide: () => void
  onDuplicateSlide: () => void
  onDeleteSlide: () => void
  onMoveSlide: (dir: -1 | 1) => void
}) {
  const {
    deck,
    slideIdx,
    slide,
    canvasW,
    canvasWrapRef,
    selectedId,
    editingId,
    selEl,
    confirmSlideDel,
    busy,
    onBack,
    onOpenRename,
    onPresent,
    onExportPdf,
    onExportJson,
    onCanvasPointerDown,
    onElPointerDown,
    onElPointerMove,
    onElPointerUp,
    onElPointerCancel,
    onPatchElement,
    onCommitText,
    onReorderElement,
    onDuplicateElement,
    onDeleteElement,
    onInsert,
    onApplyTemplate,
    filmstripRef,
    thumbRefs,
    onSelectSlide,
    onAddSlide,
    onDuplicateSlide,
    onDeleteSlide,
    onMoveSlide,
  } = props

  const canvasH = Math.round((canvasW * 9) / 16)

  const setSwatch = (hex: string) => {
    if (!selEl) return
    if (selEl.kind === 'text') onPatchElement(selEl.id, { color: hex }, true)
    else if (selEl.kind !== 'image') onPatchElement(selEl.id, { fill: hex }, true)
  }

  const swatchCurrent = selEl ? (selEl.kind === 'text' ? selEl.color : selEl.kind === 'image' ? null : selEl.fill) : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className="space-y-3"
    >
      {/* top bar */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to decks"
          className="h-11 w-11 shrink-0 rounded-xl text-zinc-300 hover:bg-white/10 hover:text-zinc-100"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <button
          onClick={onOpenRename}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-xl px-1.5 py-2 text-left transition hover:bg-white/5"
          aria-label="Rename deck"
        >
          <span className="truncate text-[15px] font-semibold text-zinc-100">{deck.name}</span>
          <Pencil className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        </button>
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onPresent}
          className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-gradient-to-r from-cyan-400 to-teal-500 px-3 text-sm font-semibold text-zinc-950 transition hover:from-cyan-300 hover:to-teal-400"
        >
          <Play className="h-4 w-4" />
          <span className="hidden sm:inline">Present</span>
        </motion.button>
        <button
          onClick={onExportPdf}
          disabled={busy !== null}
          aria-label="Export PDF"
          title="Export PDF"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-300 transition hover:bg-white/10 hover:text-zinc-100 disabled:opacity-40"
        >
          {busy === 'pdf' ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <FileDown className="h-4.5 w-4.5" />}
        </button>
        <button
          onClick={onExportJson}
          aria-label="Export JSON"
          title="Export JSON"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-300 transition hover:bg-white/10 hover:text-zinc-100"
        >
          <Download className="h-4.5 w-4.5" />
        </button>
      </div>

      {/* canvas */}
      <div
        ref={canvasWrapRef}
        className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50"
        onPointerDown={onCanvasPointerDown}
      >
        {canvasW > 0 ? (
          <SlideView slide={slide} w={canvasW} h={canvasH} />
        ) : (
          <div className="h-full w-full animate-pulse bg-zinc-900" />
        )}

        {/* interactive element layer (absolute, matches SlideView geometry) */}
        {canvasW > 0 &&
          slide.elements.map((el) => {
            const sel = el.id === selectedId
            const editing = el.id === editingId && el.kind === 'text'
            return (
              <div
                key={el.id}
                className={cn('absolute touch-none select-none', sel ? 'z-10' : 'z-0')}
                style={{
                  left: `${el.x * 100}%`,
                  top: `${el.y * 100}%`,
                  width: `${el.w * 100}%`,
                  height: `${el.h * 100}%`,
                  cursor: editing ? 'text' : 'move',
                }}
                onPointerDown={(e) => onElPointerDown(e, el, 'move')}
                onPointerMove={(e) => onElPointerMove(e, el)}
                onPointerUp={(e) => onElPointerUp(e, el)}
                onPointerCancel={onElPointerCancel}
              >
                {editing ? (
                  <textarea
                    autoFocus
                    value={el.text}
                    onChange={(e) => onPatchElement(el.id, { text: e.target.value.slice(0, 2000) })}
                    onPointerDown={(e) => e.stopPropagation()}
                    onBlur={() => onCommitText(el.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') e.currentTarget.blur()
                    }}
                    aria-label="Edit text"
                    className="h-full w-full select-text resize-none break-words bg-transparent p-0 outline-none"
                    style={{
                      fontSize: Math.max(5, el.size * FONT_FACTOR * canvasH),
                      lineHeight: 1.15,
                      fontWeight: el.weight,
                      color: el.color,
                      textAlign: el.align,
                      caretColor: '#22d3ee',
                    }}
                  />
                ) : (
                  <div className="pointer-events-none h-full w-full">
                    <SlideElView el={el} designW={canvasW} designH={canvasH} />
                  </div>
                )}
                {sel && (
                  <div className="pointer-events-none absolute inset-0 outline outline-2 -outline-offset-1 outline-cyan-300/90" />
                )}
                {sel && !editing && (
                  <div
                    className="absolute -bottom-2.5 -right-2.5 z-20 h-6 w-6 cursor-nwse-resize touch-none rounded-full border-[3px] border-zinc-950 bg-cyan-300 shadow"
                    role="button"
                    aria-label="Resize"
                    onPointerDown={(e) => onElPointerDown(e, el, 'resize')}
                  />
                )}
              </div>
            )
          })}

        {/* floating toolbar */}
        <AnimatePresence>
          {selEl && (
            <motion.div
              initial={{ opacity: 0, y: 14, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="absolute inset-x-1.5 bottom-1.5 z-30"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="mx-auto flex w-[min(100%,620px)] flex-wrap items-center justify-center gap-1 rounded-2xl border border-white/10 bg-zinc-900/95 p-1.5 shadow-2xl backdrop-blur">
                <ToolbarBtn label="Bring to front" onClick={() => onReorderElement('front')}>
                  <ArrowUpToLine className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn label="Send to back" onClick={() => onReorderElement('back')}>
                  <ArrowDownToLine className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn label="Duplicate" onClick={onDuplicateElement}>
                  <Copy className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn label="Delete" destructive onClick={onDeleteElement}>
                  <Trash2 className="h-4 w-4" />
                </ToolbarBtn>

                {selEl.kind === 'text' && (
                  <>
                    <span className="mx-0.5 h-6 w-px bg-white/10" />
                    <ToolbarBtn
                      label="Smaller text"
                      onClick={() => onPatchElement(selEl.id, { size: clamp(selEl.size - 0.15, 0.5, 3) }, true)}
                    >
                      <span className="text-xs font-bold">A−</span>
                    </ToolbarBtn>
                    <span className="w-9 text-center text-[11px] font-semibold tabular-nums text-zinc-300">
                      {selEl.size.toFixed(1)}×
                    </span>
                    <ToolbarBtn
                      label="Bigger text"
                      onClick={() => onPatchElement(selEl.id, { size: clamp(selEl.size + 0.15, 0.5, 3) }, true)}
                    >
                      <span className="text-sm font-bold">A+</span>
                    </ToolbarBtn>
                    <ToolbarBtn
                      label="Toggle bold"
                      active={selEl.weight >= 600}
                      onClick={() => onPatchElement(selEl.id, { weight: selEl.weight >= 600 ? 400 : 700 }, true)}
                    >
                      <Bold className="h-4 w-4" />
                    </ToolbarBtn>
                    <ToolbarBtn
                      label="Change alignment"
                      onClick={() =>
                        onPatchElement(
                          selEl.id,
                          { align: selEl.align === 'left' ? 'center' : selEl.align === 'center' ? 'right' : 'left' },
                          true,
                        )
                      }
                    >
                      {selEl.align === 'left' ? (
                        <AlignLeft className="h-4 w-4" />
                      ) : selEl.align === 'center' ? (
                        <AlignCenter className="h-4 w-4" />
                      ) : (
                        <AlignRight className="h-4 w-4" />
                      )}
                    </ToolbarBtn>
                  </>
                )}

                {selEl.kind !== 'image' && (
                  <>
                    <span className="mx-0.5 h-6 w-px bg-white/10" />
                    <div className="flex flex-wrap items-center justify-center gap-1">
                      {SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          onClick={() => setSwatch(hex)}
                          aria-label={`Set color ${hex}`}
                          title={hex}
                          className={cn(
                            'h-9 w-9 rounded-full border border-white/25 transition',
                            swatchCurrent?.toLowerCase() === hex.toLowerCase()
                              ? 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-zinc-900'
                              : 'hover:scale-105',
                          )}
                          style={{ background: hex }}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* insert row */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-2">
        <div className="grid grid-cols-5 gap-1.5">
          {INSERTS.map(({ key, label, icon: Icon }) => (
            <motion.button
              key={key}
              whileTap={{ scale: 0.94 }}
              onClick={() => onInsert(key)}
              className="flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-xl bg-white/[0.03] py-2 text-zinc-300 transition hover:bg-white/10 hover:text-zinc-100"
            >
              <Icon className="h-[18px] w-[18px]" />
              <span className="text-[10px] font-medium">{label}</span>
            </motion.button>
          ))}
        </div>
      </div>

      {/* theme presets */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <div className="mb-2 flex items-center gap-1.5 px-0.5">
          <Palette className="h-3.5 w-3.5 text-cyan-300" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Theme</span>
        </div>
        <div className={cn('flex gap-2 overflow-x-auto pb-1', THIN_SCROLLBAR)}>
          {TEMPLATES.map((t) => {
            const active = slide.template === t.id
            return (
              <motion.button
                key={t.id}
                whileTap={{ scale: 0.96 }}
                onClick={() => onApplyTemplate(t)}
                aria-pressed={active}
                className={cn(
                  'flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3 transition',
                  active
                    ? 'border-cyan-300/70 bg-cyan-300/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]',
                )}
              >
                <span className="h-5 w-5 shrink-0 rounded-full border border-white/25" style={{ background: t.bg }} />
                <span className="text-[13px] font-medium text-zinc-200">{t.name}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-cyan-300" />}
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* slide sorter filmstrip */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
        <div className="mb-2 flex items-center justify-between px-0.5">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-cyan-300" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Slides</span>
          </div>
          <Badge
            variant="outline"
            className="border-cyan-300/30 bg-cyan-300/10 text-[11px] font-semibold tabular-nums text-cyan-200"
          >
            {deck.slides.length} slide{deck.slides.length === 1 ? '' : 's'}
          </Badge>
        </div>

        <div ref={filmstripRef} className={cn('flex gap-2 overflow-x-auto pb-1', THIN_SCROLLBAR)}>
          {deck.slides.map((s, i) => {
            const active = i === slideIdx
            return (
              <button
                key={s.id}
                ref={(node) => {
                  if (node) thumbRefs.current?.set(s.id, node)
                  else thumbRefs.current?.delete(s.id)
                }}
                onClick={() => onSelectSlide(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={active}
                className={cn(
                  'relative aspect-video w-32 shrink-0 overflow-hidden rounded-xl border transition',
                  active
                    ? 'border-cyan-300 ring-2 ring-cyan-300/50'
                    : 'border-white/10 opacity-85 hover:opacity-100',
                )}
              >
                <SlideThumb slide={s} width={128} className="rounded-none border-0" />
                <span className="absolute left-1 top-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[9px] font-bold tabular-nums text-white">
                  {i + 1}
                </span>
              </button>
            )
          })}
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={onAddSlide}
            aria-label="Add slide"
            className="flex aspect-video w-32 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-white/15 text-zinc-400 transition hover:border-cyan-300/50 hover:text-cyan-300"
          >
            <Plus className="h-5 w-5" />
            <span className="text-[10px] font-medium">Add slide</span>
          </motion.button>
        </div>

        {/* slide controls */}
        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
          <button
            onClick={() => onMoveSlide(-1)}
            disabled={slideIdx === 0}
            aria-label="Move slide left"
            title="Move left"
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] text-zinc-300 transition enabled:hover:bg-white/10 disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
            <span className="text-[11px] font-medium">Left</span>
          </button>
          <button
            onClick={() => onMoveSlide(1)}
            disabled={slideIdx === deck.slides.length - 1}
            aria-label="Move slide right"
            title="Move right"
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] text-zinc-300 transition enabled:hover:bg-white/10 disabled:opacity-30"
          >
            <span className="text-[11px] font-medium">Right</span>
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={onDuplicateSlide}
            aria-label="Duplicate slide"
            title="Duplicate slide"
            className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] text-zinc-300 transition hover:bg-white/10"
          >
            <Copy className="h-4 w-4" />
            <span className="text-[11px] font-medium">Copy</span>
          </button>
          <button
            onClick={onDeleteSlide}
            aria-label={confirmSlideDel ? 'Tap again to delete slide' : 'Delete slide'}
            title={confirmSlideDel ? 'Tap again' : 'Delete slide'}
            className={cn(
              'flex h-11 items-center justify-center gap-1.5 rounded-xl border transition',
              confirmSlideDel
                ? 'border-rose-400/50 bg-rose-500/20 text-rose-200'
                : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-rose-500/10 hover:text-rose-300',
            )}
          >
            {confirmSlideDel ? (
              <span className="text-[11px] font-bold">Sure?</span>
            ) : (
              <>
                <Trash2 className="h-4 w-4" />
                <span className="text-[11px] font-medium">Delete</span>
              </>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

/* ================================================================== */
/* Toolbar button                                                     */
/* ================================================================== */

function ToolbarBtn({
  label,
  onClick,
  destructive,
  active,
  children,
}: {
  label: string
  onClick: () => void
  destructive?: boolean
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition',
        destructive
          ? 'text-rose-300 hover:bg-rose-500/15'
          : active
            ? 'bg-cyan-300/15 text-cyan-200'
            : 'text-zinc-300 hover:bg-white/10 hover:text-zinc-100',
      )}
    >
      {children}
    </button>
  )
}
