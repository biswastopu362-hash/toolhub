'use client'

/**
 * Design Studio v2 — a Canva-style design AND document editor, fully on-device.
 *
 * Pages model: the design is a stack of Pages, each with its own elements,
 * background and size (so imported PDF pages keep their real proportions).
 * Elements (text, shapes, stickers, photos, cover-ups) are absolutely
 * positioned in design coordinates, scaled to fit the viewport. Drag /
 * resize / rotate with pointer events (touch-first), full undo/redo and
 * draft autosave to IndexedDB (imported pages carry multi-MB data URLs).
 *
 * Documents: import a PDF (rendered page-by-page via pdf.js), a Word .docx
 * (flowed to editable text via mammoth) or a .txt file — then fix text,
 * white-out anything with color-matched cover boxes, add images and sign,
 * and export the whole stack back to a real PDF (jsPDF). Pages are
 * rasterized through the exact same React components via
 * renderToStaticMarkup + SVG foreignObject, so exports are WYSIWYG.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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
  Eraser,
  Expand,
  FileDown,
  FileImage,
  FileText,
  FolderOpen,
  Italic,
  LayoutTemplate,
  Loader2,
  Palette,
  Pipette,
  Plus,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { fileToDataUrl, listPhotos, newPhotoId, putPhoto } from '@/lib/media-db'
import { kvDel, kvGet, kvPut } from '@/lib/doc-db'
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
type ElType = 'text' | 'shape' | 'emoji' | 'image' | 'cover'

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
  /* shape + cover */
  shape?: ShapeKind
  fill?: string
  /* emoji */
  char?: string
  /* image */
  src?: string
}

interface Page {
  id: string
  els: DesignElement[]
  /** css color/gradient — or a data URL for imported document pages */
  bg: string
  w: number
  h: number
}

interface Snap {
  pages: Page[]
  idx: number
}

const DRAFT_KEY = 'toolhub-canva:draft:v2'
const LEGACY_DRAFT_KEY = 'toolhub-canva:draft:v1'
const HISTORY_CAP = 25
const ELEMENT_CAP = 80
const PAGE_CAP = 40

/* Document import/export targets — 150 dpi A4 basis */
const DOC_W = 1240
const DOC_H = 1754
const DOC_MARGIN = 130
const MAX_DOC_PAGES = PAGE_CAP

const uid = () => `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
const newPageId = () => `pg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
const cloneEls = (els: DesignElement[]): DesignElement[] => JSON.parse(JSON.stringify(els)) as DesignElement[]
/** Deep-clone pages for history — element data cloned, big immutable strings shared */
const clonePages = (ps: Page[]): Page[] => ps.map((p) => ({ ...p, els: cloneEls(p.els) }))
const blankPage = (w = 1080, h = 1080): Page => ({ id: newPageId(), els: [], bg: DEFAULT_BG, w, h })

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
  { id: 'a4', label: 'A4 page', w: DOC_W, h: DOC_H },
  { id: 'letter', label: 'US Letter', w: 1275, h: 1650 },
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
  {
    id: 'resume',
    name: 'Resume',
    bg: '#ffffff',
    w: DOC_W,
    h: DOC_H,
    els: [
      { type: 'text', text: 'YOUR NAME', x: 130, y: 140, w: 980, h: 90, fontSize: 72, font: FONTS[0].css, color: '#0c0a09', align: 'left', weight: 800 },
      { type: 'text', text: 'Product Designer · Dhaka · name@mail.com', x: 132, y: 240, w: 980, h: 46, fontSize: 28, font: FONTS[0].css, color: '#57534e', align: 'left', weight: 500 },
      { type: 'shape', shape: 'line', fill: '#0c0a09', x: 130, y: 320, w: 980, h: 8 },
      { type: 'text', text: 'EXPERIENCE', x: 130, y: 372, w: 420, h: 42, fontSize: 30, font: FONTS[0].css, color: '#0c0a09', align: 'left', weight: 800 },
      { type: 'text', text: 'Senior Designer — Studio North (2021 – now)\nLed a team of four, shipping two flagship apps.', x: 132, y: 432, w: 980, h: 140, fontSize: 28, font: FONTS[0].css, color: '#292524', align: 'left', weight: 500 },
      { type: 'text', text: 'Designer — Pixelworks (2018 – 2021)\nBranding and web for 30+ happy clients.', x: 132, y: 596, w: 980, h: 140, fontSize: 28, font: FONTS[0].css, color: '#292524', align: 'left', weight: 500 },
      { type: 'text', text: 'SKILLS', x: 130, y: 780, w: 420, h: 42, fontSize: 30, font: FONTS[0].css, color: '#0c0a09', align: 'left', weight: 800 },
      { type: 'text', text: 'Figma · Motion · Prototyping · HTML & CSS', x: 132, y: 840, w: 980, h: 50, fontSize: 28, font: FONTS[0].css, color: '#292524', align: 'left', weight: 500 },
      { type: 'text', text: 'EDUCATION', x: 130, y: 940, w: 420, h: 42, fontSize: 30, font: FONTS[0].css, color: '#0c0a09', align: 'left', weight: 800 },
      { type: 'text', text: 'BSc, Computer Science — University of Dhaka', x: 132, y: 1000, w: 980, h: 50, fontSize: 28, font: FONTS[0].css, color: '#292524', align: 'left', weight: 500 },
    ],
  },
  {
    id: 'letter',
    name: 'Document',
    bg: '#ffffff',
    w: DOC_W,
    h: DOC_H,
    els: [
      { type: 'text', text: 'Dear Sir or Madam,', x: 130, y: 200, w: 980, h: 56, fontSize: 30, font: FONTS[1].css, color: '#1c1917', align: 'left', weight: 500 },
      { type: 'text', text: 'I am writing to apply for the position posted this week. My background lines up closely with what your team is building, and I would love to walk you through a few ideas in person.', x: 130, y: 290, w: 980, h: 200, fontSize: 30, font: FONTS[1].css, color: '#1c1917', align: 'left', weight: 500 },
      { type: 'text', text: 'Over the past five years I have led projects from first sketch to final ship — including two products now used by hundreds of thousands of people every day.', x: 130, y: 520, w: 980, h: 200, fontSize: 30, font: FONTS[1].css, color: '#1c1917', align: 'left', weight: 500 },
      { type: 'text', text: 'Thank you for your time and consideration.', x: 130, y: 750, w: 980, h: 100, fontSize: 30, font: FONTS[1].css, color: '#1c1917', align: 'left', weight: 500 },
      { type: 'text', text: 'Sincerely,\nYour Name', x: 130, y: 940, w: 980, h: 120, fontSize: 30, font: FONTS[1].css, color: '#1c1917', align: 'left', weight: 600 },
    ],
  },
  {
    id: 'slide',
    name: 'Presentation',
    bg: GRADIENTS[8].css,
    w: 1920,
    h: 1080,
    els: [
      { type: 'shape', shape: 'line', fill: '#facc15', x: 150, y: 310, w: 170, h: 14 },
      { type: 'text', text: 'Q3 REVIEW', x: 145, y: 380, w: 1200, h: 190, fontSize: 130, font: FONTS[3].css, color: '#ffffff', align: 'left', weight: 400 },
      { type: 'text', text: 'Team Atlas · October 2025', x: 150, y: 600, w: 1000, h: 70, fontSize: 44, font: FONTS[0].css, color: '#a5b4fc', align: 'left', weight: 600 },
    ],
  },
]

function instantiateTemplate(t: Template): DesignElement[] {
  return t.els.map((e) => ({ ...e, id: uid(), rot: 0, opacity: 1 }))
}

/* --- Draft persistence (IndexedDB v2, migrates localStorage v1) --- */
interface DraftV2 {
  v: 2
  pages: Page[]
  idx: number
  at: number
}

function isPage(p: unknown): p is Page {
  const q = p as Page
  return !!q && typeof q.id === 'string' && Array.isArray(q.els) && typeof q.bg === 'string' && typeof q.w === 'number' && typeof q.h === 'number'
}

async function loadDraftV2(): Promise<DraftV2 | undefined> {
  const d = await kvGet<DraftV2>(DRAFT_KEY)
  if (!d || d.v !== 2 || !Array.isArray(d.pages) || d.pages.length === 0) return undefined
  const pages = d.pages.filter(isPage).map((p) => ({ ...p, els: p.els.slice(0, ELEMENT_CAP) }))
  if (pages.length === 0) return undefined
  return { v: 2, pages, idx: Math.max(0, Math.min(d.idx ?? 0, pages.length - 1)), at: d.at ?? Date.now() }
}

function loadLegacyDraft(): Page[] | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(LEGACY_DRAFT_KEY)
    if (!raw) return undefined
    const d = JSON.parse(raw) as { v?: number; els?: DesignElement[]; bg?: string; w?: number; h?: number }
    if (d.v !== 1 || !Array.isArray(d.els)) return undefined
    return [{ id: newPageId(), els: d.els, bg: d.bg || DEFAULT_BG, w: d.w || 1080, h: d.h || 1080 }]
  } catch {
    return undefined
  }
}

/* ================================================================== */
/* Rasterization (exports use the exact same components as the stage) */
/* ================================================================== */

const noopPd = () => {}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image failed to load'))
    img.src = src
  })
}

function svgDataUrl(innerHtml: string, w: number, h: number, bgStyle?: string): string {
  const wrap = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;position:relative;overflow:hidden;${bgStyle ?? ''}">${innerHtml}</div>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="100%" height="100%">${wrap}</foreignObject></svg>`
  // blob: URLs taint the canvas in Chromium — the SVG must ride on a data: URL
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function elementsMarkup(els: DesignElement[]): string {
  return renderToStaticMarkup(
    <div style={{ position: 'absolute', inset: 0 }}>
      {els.map((el) => (
        <ElementBox key={el.id} el={el} onPointerDown={noopPd} />
      ))}
    </div>
  )
}

/** Render one page to a canvas at an arbitrary scale — WYSIWYG with the stage. */
async function rasterizePage(page: Page, scale: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(page.w * scale))
  canvas.height = Math.max(1, Math.round(page.h * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas context')
  ctx.scale(scale, scale)

  // 1) background — imported pages are data URLs, drawn directly (crisp + fast)
  if (page.bg.startsWith('data:image')) {
    const img = await loadImage(page.bg)
    ctx.drawImage(img, 0, 0, page.w, page.h)
  } else {
    const img = await loadImage(svgDataUrl('', page.w, page.h, `background:${page.bg};`))
    ctx.drawImage(img, 0, 0, page.w, page.h)
  }

  // 2) elements layer (transparent, on top)
  if (page.els.length > 0) {
    const img = await loadImage(svgDataUrl(elementsMarkup(page.els), page.w, page.h))
    ctx.drawImage(img, 0, 0, page.w, page.h)
  }
  return canvas
}

/* ================================================================== */
/* Document text flow (Word / txt → editable text elements)           */
/* ================================================================== */

interface DocBlock {
  text: string
  kind: 'h1' | 'h2' | 'h3' | 'p' | 'li'
}

function flowDoc(blocks: DocBlock[], title?: string): Page[] {
  const pages: Page[] = []
  let y = DOC_MARGIN
  const fresh = () => {
    pages.push({ id: newPageId(), els: [], bg: '#ffffff', w: DOC_W, h: DOC_H })
    y = DOC_MARGIN
  }
  fresh()
  const addBlock = (text: string, fontSize: number, weight: number, gapBefore: number, indent = 0, color = '#1c1917') => {
    const w = DOC_W - DOC_MARGIN * 2 - indent
    const cpl = Math.max(12, Math.floor(w / (fontSize * 0.52)))
    const lines = Math.max(1, Math.ceil(text.length / cpl))
    const h = Math.ceil(lines * fontSize * 1.5)
    if (y + gapBefore + h > DOC_H - DOC_MARGIN && pages[pages.length - 1].els.length > 0) fresh()
    const p = pages[pages.length - 1]
    p.els.push({
      id: uid(),
      rot: 0,
      opacity: 1,
      type: 'text',
      text,
      x: DOC_MARGIN + indent,
      y: y + gapBefore,
      w,
      h,
      fontSize,
      weight,
      font: FONTS[0].css,
      color,
      align: 'left',
    })
    y += gapBefore + h + Math.round(fontSize * 0.45)
  }
  if (title) addBlock(title, 54, 800, 0, 0, '#0c0a09')
  for (const b of blocks) {
    if (b.kind === 'h1') addBlock(b.text, 50, 800, 30, 0, '#0c0a09')
    else if (b.kind === 'h2') addBlock(b.text, 40, 700, 26, 0, '#0c0a09')
    else if (b.kind === 'h3') addBlock(b.text, 33, 600, 22, 0, '#0c0a09')
    else if (b.kind === 'li') addBlock('•  ' + b.text, 30, 500, 8, 44)
    else addBlock(b.text, 30, 500, 14)
  }
  return pages
}

/* ================================================================== */
/* Element rendering (inline styles only — exports serialize this DOM) */
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
  if (el.type === 'emoji') return <span style={{ fontSize: Math.min(el.w, el.h), lineHeight: 1 }}>{el.char}</span>
  if (el.type === 'image')
    return <img src={el.src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 14, display: 'block' }} />
  if (el.type === 'cover') return <div style={{ width: '100%', height: '100%', background: el.fill ?? '#ffffff', borderRadius: 2 }} />
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
/* Page thumbnail strip                                               */
/* ================================================================== */

function PageThumb({
  page,
  index,
  active,
  canDelete,
  onSelect,
  onDuplicate,
  onDelete,
}: {
  page: Page
  index: number
  active: boolean
  canDelete: boolean
  onSelect: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const tw = 52
  const th = Math.round(Math.min(88, Math.max(40, (page.h / page.w) * tw)))
  return (
    <div className="relative shrink-0" style={{ width: tw + 10, height: th + 18 }}>
      <button
        onClick={onSelect}
        aria-label={`Go to page ${index + 1}`}
        aria-current={active}
        className={cn(
          'absolute left-0 top-0 block overflow-hidden rounded-md border-2 bg-white transition-all',
          active ? 'border-fuchsia-500 shadow-[0_6px_18px_-4px_rgb(217_70_239/0.55)]' : 'border-white/15 hover:border-white/40'
        )}
        style={{ width: tw, height: th }}
      >
        {page.bg.startsWith('data:image') ? (
          <img src={page.bg} alt="" className="absolute inset-0 size-full object-cover" loading="lazy" />
        ) : (
          <span className="absolute inset-0" style={{ background: page.bg }} />
        )}
        {page.els.slice(0, 14).map((el) => (
          <span
            key={el.id}
            className="absolute"
            style={{
              left: `${(el.x / page.w) * 100}%`,
              top: `${(el.y / page.h) * 100}%`,
              width: `${Math.min(100, (el.w / page.w) * 100)}%`,
              height: `${Math.min(100, (el.h / page.h) * 100)}%`,
              background: el.type === 'text' ? (el.color ?? '#111') : el.type === 'emoji' ? 'rgba(0,0,0,0.25)' : (el.fill ?? 'rgba(0,0,0,0.3)'),
              opacity: el.type === 'text' ? 0.7 : el.type === 'cover' ? 0.9 : 0.45,
              outline: el.type === 'cover' ? '1px dashed rgba(255,255,255,0.9)' : undefined,
              borderRadius: 1,
            }}
          />
        ))}
      </button>
      <span
        className={cn(
          'absolute -left-0.5 -top-1 z-10 flex h-4 min-w-4 items-center justify-center rounded-full border border-white/20 px-1 text-[9px] font-bold tabular-nums',
          active ? 'bg-fuchsia-600 text-white' : 'bg-zinc-900 text-zinc-400'
        )}
      >
        {index + 1}
      </span>
      {active && (
        <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDuplicate()
            }}
            aria-label={`Duplicate page ${index + 1}`}
            className="flex size-4 items-center justify-center rounded-full bg-zinc-800/95 text-zinc-300 ring-1 ring-white/15 hover:bg-zinc-700 hover:text-white"
          >
            <Copy className="size-2.5" aria-hidden />
          </button>
          {canDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              aria-label={`Delete page ${index + 1}`}
              className="flex size-4 items-center justify-center rounded-full bg-zinc-800/95 text-rose-400 ring-1 ring-white/15 hover:bg-rose-600 hover:text-white"
            >
              <Trash2 className="size-2.5" aria-hidden />
            </button>
          )}
        </span>
      )}
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
  const docInputRef = useRef<HTMLInputElement>(null)
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

  const [pages, setPages] = useState<Page[]>(() => [blankPage()])
  const [pageIdx, setPageIdx] = useState(0)
  const [hydrating, setHydrating] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<PanelTab>('templates')
  const [viewScale, setViewScale] = useState(0.3)
  const [exporting, setExporting] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [importingLabel, setImportingLabel] = useState<string | null>(null)
  const [addingPhoto, setAddingPhoto] = useState(false)
  const [armReset, setArmReset] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  const [eyedropping, setEyedropping] = useState(false)
  const [galleryPhotos, setGalleryPhotos] = useState<{ id: string; dataUrl: string; name?: string }[]>([])
  const [photosLoaded, setPhotosLoaded] = useState(false)

  const activeIdx = Math.min(pageIdx, pages.length - 1)
  const page = pages[activeIdx]
  const els = page.els
  const bg = page.bg
  const size = { w: page.w, h: page.h }

  const past = useRef<Snap[]>([])
  const future = useRef<Snap[]>([])
  const [, bumpHist] = useState(0)

  const selected = els.find((e) => e.id === selectedId) ?? null

  /* ---------- history ---------- */
  const snapshot = useCallback((): Snap => ({ pages: clonePages(pages), idx: activeIdx }), [activeIdx, pages])
  const pushHistory = useCallback(
    (before: Snap) => {
      past.current.push(before)
      if (past.current.length > HISTORY_CAP) past.current.shift()
      future.current = []
      bumpHist((v) => v + 1)
    },
    []
  )

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push({ pages: clonePages(pages), idx: activeIdx })
    setPages(prev.pages)
    setPageIdx(Math.min(prev.idx, prev.pages.length - 1))
    bumpHist((v) => v + 1)
  }, [activeIdx, pages])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push({ pages: clonePages(pages), idx: activeIdx })
    setPages(next.pages)
    setPageIdx(Math.min(next.idx, next.pages.length - 1))
    bumpHist((v) => v + 1)
  }, [activeIdx, pages])

  /* ---------- current-page mutators ---------- */
  const setEls = useCallback(
    (next: DesignElement[] | ((prev: DesignElement[]) => DesignElement[])) => {
      setPages((prev) => prev.map((p, i) => (i === activeIdx ? { ...p, els: typeof next === 'function' ? next(p.els) : next } : p)))
    },
    [activeIdx]
  )

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

  /* ---------- draft hydration (IndexedDB, migrates old localStorage draft) ---------- */
  const greetedRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const d = await loadDraftV2()
        if (cancelled) return
        if (d) {
          setPages(d.pages)
          setPageIdx(d.idx)
          if (!greetedRef.current) {
            greetedRef.current = true
            toast({ title: 'Draft restored', description: `${d.pages.length} page${d.pages.length > 1 ? 's' : ''} — picked up where you left off.` })
          }
        } else {
          const legacy = loadLegacyDraft()
          if (legacy && legacy.some((p) => p.els.length > 0)) {
            setPages(legacy)
            setPageIdx(0)
            if (!greetedRef.current) {
              greetedRef.current = true
              toast({ title: 'Draft restored', description: 'Your older design moved to the new format.' })
            }
          }
        }
      } finally {
        if (!cancelled) setHydrating(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [toast])

  /* ---------- draft autosave ---------- */
  useEffect(() => {
    if (hydrating) return
    const t = window.setTimeout(() => {
      void kvPut(DRAFT_KEY, { v: 2, pages, idx: pageIdx, at: Date.now() })
    }, 800)
    return () => window.clearTimeout(t)
  }, [hydrating, pageIdx, pages])

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
        startSnap: { pages: clonePages(pages), idx: activeIdx },
      }
    },
    [activeIdx, pages]
  )

  useEffect(() => {
    if (!selectedId) return
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = (e.clientX - d.sx) / viewScale
      const dy = (e.clientY - d.sy) / viewScale
      if (d.mode === 'move') {
        setEls((prev) =>
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
        setEls((prev) => prev.map((x) => (x.id === d.id ? { ...x, w, h } : x)))
      } else {
        const cx = d.orig.x + d.orig.w / 2
        const cy = d.orig.y + d.orig.h / 2
        let deg = (Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180) / Math.PI
        const snapped = Math.round(deg / 15) * 15
        if (Math.abs(deg - snapped) < 6) deg = snapped
        setEls((prev) => prev.map((x) => (x.id === d.id ? { ...x, rot: Math.round(deg) } : x)))
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
  }, [pushHistory, selectedId, setEls, size.h, size.w, viewScale])

  const removeSelected = useCallback(() => {
    if (!selectedId) return
    pushHistory(snapshot())
    setEls((prev) => prev.filter((x) => x.id !== selectedId))
    setSelectedId(null)
  }, [pushHistory, selectedId, setEls, snapshot])

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
        toast({ title: 'Page is full', description: `Up to ${ELEMENT_CAP} elements per page.`, variant: 'destructive' })
        return
      }
      pushHistory(snapshot())
      const full: DesignElement = { ...el, id: uid(), rot: 0, opacity: 1 }
      // center new elements with a slight cascade
      full.x = Math.round((size.w - full.w) / 2 + (els.length % 5) * 14 - 28)
      full.y = Math.round((size.h - full.h) / 2 + (els.length % 5) * 14 - 28)
      setEls((prev) => [...prev, full])
      setSelectedId(full.id)
      setTab('edit')
    },
    [els.length, pushHistory, setEls, size.h, size.w, snapshot, toast]
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
      setEls((prev) => prev.map((x) => (x.id === selectedId ? { ...x, ...patch } : x)))
    },
    [selectedId, setEls]
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
    setEls((prev) => [...prev, copy])
    setSelectedId(copy.id)
  }, [pushHistory, selected, setEls, size.h, size.w, snapshot])

  const layerShift = useCallback(
    (dir: 1 | -1) => {
      if (!selectedId) return
      const i = els.findIndex((x) => x.id === selectedId)
      const j = i + dir
      if (i < 0 || j < 0 || j >= els.length) return
      pushHistory(snapshot())
      const next = [...els]
      ;[next[i], next[j]] = [next[j], next[i]]
      setEls(next)
    },
    [els, pushHistory, selectedId, setEls, snapshot]
  )

  /* ---------- templates / size / background (apply to the current page) ---------- */
  const applyTemplate = useCallback(
    (t: Template) => {
      pushHistory(snapshot())
      setPages((prev) => prev.map((p, i) => (i === activeIdx ? { ...p, els: instantiateTemplate(t), bg: t.bg, w: t.w, h: t.h } : p)))
      setSelectedId(null)
      toast({ title: `${t.name} template applied`, description: 'Tap any element to edit it.' })
    },
    [activeIdx, pushHistory, snapshot, toast]
  )

  const changeSize = useCallback(
    (p: { w: number; h: number }) => {
      if (p.w === size.w && p.h === size.h) return
      pushHistory(snapshot())
      setPages((prev) =>
        prev.map((pp, i) => (i === activeIdx ? { ...pp, w: p.w, h: p.h, els: pp.els.map((e) => ({ ...e, x: Math.min(e.x, p.w - 40), y: Math.min(e.y, p.h - 40) })) } : pp))
      )
    },
    [activeIdx, pushHistory, size.h, size.w, snapshot]
  )

  const changeBg = useCallback(
    (css: string) => {
      pushHistory(snapshot())
      setPages((prev) => prev.map((p, i) => (i === activeIdx ? { ...p, bg: css } : p)))
    },
    [activeIdx, pushHistory, snapshot]
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
    setPages([blankPage()])
    setPageIdx(0)
    setSelectedId(null)
    void kvDel(DRAFT_KEY)
    try {
      localStorage.removeItem(LEGACY_DRAFT_KEY)
    } catch {
      /* ignore */
    }
    toast({ title: 'Fresh canvas ready' })
  }, [armReset, pushHistory, snapshot, toast])

  /* ---------- pages ---------- */
  const addPage = useCallback(() => {
    if (pages.length >= PAGE_CAP) {
      toast({ title: 'Document limit reached', description: `Up to ${PAGE_CAP} pages per document.`, variant: 'destructive' })
      return
    }
    pushHistory(snapshot())
    setPages((prev) => [...prev, blankPage(page.w, page.h)])
    setPageIdx(pages.length)
    setSelectedId(null)
  }, [page.h, page.w, pages.length, pushHistory, snapshot, toast])

  const duplicatePage = useCallback(
    (i: number) => {
      if (pages.length >= PAGE_CAP) {
        toast({ title: 'Document limit reached', description: `Up to ${PAGE_CAP} pages per document.`, variant: 'destructive' })
        return
      }
      pushHistory(snapshot())
      setPages((prev) => {
        const src = prev[Math.min(i, prev.length - 1)]
        const copy: Page = { ...src, id: newPageId(), els: cloneEls(src.els) }
        const next = [...prev]
        next.splice(i + 1, 0, copy)
        return next
      })
      setPageIdx(i + 1)
      setSelectedId(null)
    },
    [pages.length, pushHistory, snapshot, toast]
  )

  const deletePage = useCallback(
    (i: number) => {
      if (pages.length <= 1) return
      pushHistory(snapshot())
      setPages((prev) => prev.filter((_, j) => j !== i))
      setPageIdx(Math.max(0, Math.min(pageIdx > i ? pageIdx - 1 : pageIdx, pages.length - 2)))
      setSelectedId(null)
    },
    [pageIdx, pages.length, pushHistory, snapshot]
  )

  /* ---------- images ---------- */
  const addImage = useCallback(
    (dataUrl: string, name: string) => {
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

  /* ---------- document import (PDF / Word / text) ---------- */
  const commitDoc = useCallback(
    (newPages: Page[], title: string) => {
      pushHistory(snapshot())
      setPages(newPages)
      setPageIdx(0)
      setSelectedId(null)
      setTab('text')
      toast({ title, description: 'Add text, cover-ups or photos — then export as PDF.' })
    },
    [pushHistory, snapshot, toast]
  )

  const importPdf = useCallback(
    async (file: File) => {
      setImportingLabel('Reading PDF…')
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const data = new Uint8Array(await file.arrayBuffer())
        const loadingTask = pdfjs.getDocument({ data })
        const doc = await loadingTask.promise
        const total = doc.numPages
        const count = Math.min(total, MAX_DOC_PAGES)
        const out: Page[] = []
        for (let i = 1; i <= count; i++) {
          setImportingLabel(`Rendering page ${i} of ${count}…`)
          const p = await doc.getPage(i)
          const base = p.getViewport({ scale: 1 })
          const s = Math.min(2.4, DOC_W / base.width)
          const vp = p.getViewport({ scale: s })
          const c = document.createElement('canvas')
          c.width = Math.max(1, Math.floor(vp.width))
          c.height = Math.max(1, Math.floor(vp.height))
          const ctx = c.getContext('2d')
          if (!ctx) throw new Error('canvas unavailable')
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, c.width, c.height)
          await p.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise
          out.push({ id: newPageId(), els: [], bg: c.toDataURL('image/jpeg', 0.85), w: c.width, h: c.height })
        }
        await loadingTask.destroy()
        if (out.length === 0) throw new Error('empty pdf')
        commitDoc(out, `PDF imported — ${out.length} page${out.length > 1 ? 's' : ''}`)
        if (total > MAX_DOC_PAGES) {
          toast({ title: `Only the first ${MAX_DOC_PAGES} pages were imported`, description: `The PDF has ${total} pages.` })
        }
      } finally {
        setImportingLabel(null)
      }
    },
    [commitDoc, toast]
  )

  const importDocx = useCallback(
    async (file: File) => {
      setImportingLabel('Reading Word document…')
      try {
        const mammoth = await import('mammoth')
        const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
        const dom = new DOMParser().parseFromString(html, 'text/html')
        const blocks: DocBlock[] = []
        dom.body.querySelectorAll('h1, h2, h3, h4, p, li').forEach((n) => {
          const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (!text) return
          const tag = n.tagName.toLowerCase()
          blocks.push({ text, kind: tag === 'h1' ? 'h1' : tag === 'h2' ? 'h2' : tag === 'h3' || tag === 'h4' ? 'h3' : tag === 'li' ? 'li' : 'p' })
        })
        if (blocks.length === 0) throw new Error('no text found')
        commitDoc(flowDoc(blocks, file.name.replace(/\.[^.]+$/, '')), 'Word document imported')
      } finally {
        setImportingLabel(null)
      }
    },
    [commitDoc]
  )

  const importTxt = useCallback(
    async (file: File) => {
      setImportingLabel('Reading text file…')
      try {
        const raw = await file.text()
        const blocks: DocBlock[] = raw
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 900)
          .map((l) => ({ text: l, kind: 'p' as const }))
        if (blocks.length === 0) throw new Error('empty file')
        commitDoc(flowDoc(blocks, file.name.replace(/\.[^.]+$/, '')), 'Text file imported')
      } finally {
        setImportingLabel(null)
      }
    },
    [commitDoc]
  )

  const onDocFiles = useCallback(
    async (files: FileList | null) => {
      const f = files?.[0]
      if (docInputRef.current) docInputRef.current.value = ''
      if (!f) return
      const ext = (f.name.split('.').pop() ?? '').toLowerCase()
      try {
        if (ext === 'pdf') await importPdf(f)
        else if (ext === 'docx') await importDocx(f)
        else if (ext === 'doc')
          toast({
            title: 'Legacy .doc isn’t supported',
            description: 'Open it in Word and save as .docx — or export a PDF, then import here.',
            variant: 'destructive',
          })
        else if (ext === 'txt' || f.type === 'text/plain') await importTxt(f)
        else toast({ title: 'Unsupported file type', description: 'Import a PDF, Word (.docx) or .txt file.', variant: 'destructive' })
      } catch {
        toast({ title: 'Import failed', description: `${f.name} could not be read.`, variant: 'destructive' })
      }
    },
    [importDocx, importPdf, importTxt, toast]
  )

  const pickDoc = useCallback((accept: string) => {
    const el = docInputRef.current
    if (!el) return
    el.accept = accept
    el.value = ''
    el.click()
  }, [])

  /* ---------- cover-up color match (eyedropper over the imported page) ---------- */
  const matchPageColor = useCallback(async () => {
    if (!selected || selected.type !== 'cover') return
    if (!bg.startsWith('data:image')) {
      toast({ title: 'Match works on imported pages', description: 'Import a PDF or Word page first, then match its color.' })
      return
    }
    setEyedropping(true)
    try {
      const img = await loadImage(bg)
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('no canvas')
      ctx.drawImage(img, 0, 0)
      const sx = c.width / size.w
      const sy = c.height / size.h
      // sample just OUTSIDE the box (the page around the text we are hiding)
      const candidates: [number, number][] = [
        [selected.x - 18, selected.y + selected.h / 2],
        [selected.x + selected.w + 18, selected.y + selected.h / 2],
        [selected.x + selected.w / 2, selected.y - 18],
        [selected.x + selected.w / 2, selected.y + selected.h + 18],
        [selected.x + selected.w / 2, selected.y + selected.h / 2],
      ]
      const counts = new Map<string, { n: number; rgb: string }>()
      for (const [px, py] of candidates) {
        const ix = Math.round(px * sx)
        const iy = Math.round(py * sy)
        if (ix < 0 || iy < 0 || ix >= c.width || iy >= c.height) continue
        const d = ctx.getImageData(ix, iy, 1, 1).data
        if (d[3] < 200) continue
        const key = `${d[0] >> 4},${d[1] >> 4},${d[2] >> 4}`
        const cur = counts.get(key)
        if (cur) cur.n++
        else counts.set(key, { n: 1, rgb: `rgb(${d[0]},${d[1]},${d[2]})` })
      }
      if (counts.size === 0) throw new Error('nothing sampled')
      const best = [...counts.values()].sort((a, b) => b.n - a.n)[0]
      commitPatch({ fill: best.rgb })
      toast({ title: 'Page color matched', description: 'The cover now blends into the page.' })
    } catch {
      toast({ title: 'Could not sample the page', variant: 'destructive' })
    } finally {
      setEyedropping(false)
    }
  }, [bg, commitPatch, selected, size.h, size.w, toast])

  /* ---------- export ---------- */
  const exportPng = useCallback(async () => {
    setExporting(true)
    try {
      const scale = Math.min(2, 3200 / Math.max(size.w, size.h))
      const canvas = await rasterizePage(page, scale)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('png failed')
      const dl = document.createElement('a')
      dl.href = URL.createObjectURL(blob)
      dl.download = `design-${size.w}x${size.h}-${Date.now().toString(36)}.png`
      dl.click()
      window.setTimeout(() => URL.revokeObjectURL(dl.href), 4000)
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
  }, [page, size.h, size.w, toast])

  const exportPdf = useCallback(async () => {
    setExportingPdf(true)
    try {
      const { jsPDF } = await import('jspdf')
      let doc: import('jspdf').jsPDF | null = null
      for (const p of pages) {
        const canvas = await rasterizePage(p, 2)
        const img = canvas.toDataURL('image/jpeg', 0.92)
        const orient = p.w > p.h ? 'landscape' : 'portrait'
        if (!doc) doc = new jsPDF({ unit: 'px', format: [p.w, p.h], orientation: orient, compress: true })
        else doc.addPage([p.w, p.h], orient)
        doc.addImage(img, 'JPEG', 0, 0, p.w, p.h)
      }
      if (!doc) throw new Error('no pages')
      doc.save(`document-${pages.length}p-${Date.now().toString(36)}.pdf`)
      toast({ title: 'PDF exported', description: `${pages.length} page${pages.length > 1 ? 's' : ''} — check your downloads.` })
    } catch {
      toast({ title: 'PDF export failed', description: 'Try again with fewer pages.', variant: 'destructive' })
    } finally {
      setExportingPdf(false)
    }
  }, [pages, toast])

  /* ================================================================== */
  /* Render                                                             */
  /* ================================================================== */

  const sel = selected
  const stageW = Math.round(size.w * viewScale)
  const stageH = Math.round(size.h * viewScale)
  const busy = exporting || exportingPdf || importingLabel !== null
  const customSize = !SIZE_PRESETS.some((p) => p.w === size.w && p.h === size.h)

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
      <input ref={docInputRef} type="file" accept=".pdf,.docx,.doc,.txt" className="hidden" aria-hidden tabIndex={-1} onChange={(e) => void onDocFiles(e.target.files)} />

      {/* ---------- header ---------- */}
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-purple-950/60 via-zinc-950 to-zinc-950 shadow-[0_24px_60px_-24px_rgb(217_70_239/0.35)]">
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
          <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-purple-500 via-fuchsia-500 to-pink-500 text-white ring-1 ring-white/25 shadow-[0_10px_24px_-8px_rgb(217_70_239/0.7)]">
            <Shapes className="size-5" strokeWidth={1.9} aria-hidden />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
          </span>
          <div className="mr-auto min-w-0">
            <h2 className="flex items-center gap-1.5 truncate text-sm font-bold tracking-tight text-zinc-100 sm:text-base">
              Design Studio
              {pages.length > 1 && (
                <Badge variant="outline" className="border-fuchsia-500/40 bg-fuchsia-500/10 px-1.5 text-[10px] font-bold text-fuchsia-300">
                  {pages.length} pages
                </Badge>
              )}
            </h2>
            <p className="truncate text-[11px] text-zinc-400">Design & edit anything — PDF, Word, photos, posters</p>
          </div>

          <div className="flex items-center gap-1">
            <select
              value={`${size.w}x${size.h}`}
              onChange={(e) => {
                const p = SIZE_PRESETS.find((x) => `${x.w}x${x.h}` === e.target.value)
                if (p) changeSize(p)
              }}
              aria-label="Canvas size"
              className="h-9 max-w-[130px] rounded-lg border border-white/10 bg-white/5 px-2 text-xs font-semibold text-zinc-200 outline-none"
            >
              {customSize && (
                <option value={`${size.w}x${size.h}`} className="bg-zinc-900">
                  Custom · {size.w}×{size.h}
                </option>
              )}
              {SIZE_PRESETS.map((p) => (
                <option key={p.id} value={`${p.w}x${p.h}`} className="bg-zinc-900">
                  {p.label} · {p.w}×{p.h}
                </option>
              ))}
            </select>

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
              aria-label={armReset ? 'Tap again to clear everything' : 'New design'}
              title={armReset ? 'Tap again to confirm' : 'New design'}
              className={cn('size-9 rounded-full', armReset ? 'bg-rose-500/20 text-rose-300 hover:bg-rose-500/30' : 'text-zinc-300 hover:bg-white/10')}
            >
              {armReset ? <Check className="size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  disabled={busy}
                  className="h-9 rounded-full bg-gradient-to-r from-purple-500 to-fuchsia-500 px-3 text-xs font-bold text-white shadow-lg shadow-fuchsia-600/25 hover:from-purple-400 hover:to-fuchsia-400 sm:px-4 sm:text-sm"
                >
                  {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
                  <span className="hidden sm:inline">Export</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-white/10 bg-zinc-950/95 text-zinc-100">
                <DropdownMenuLabel className="text-[11px] text-zinc-500">Export this document</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => void exportPng()} className="gap-2.5 rounded-lg py-2.5">
                  <FileImage className="size-4 text-fuchsia-400" aria-hidden />
                  <span>
                    PNG image
                    <span className="block text-[10px] font-normal text-zinc-500">Current page only</span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem onClick={() => void exportPdf()} className="gap-2.5 rounded-lg py-2.5">
                  <FileDown className="size-4 text-fuchsia-400" aria-hidden />
                  <span>
                    PDF document
                    <span className="block text-[10px] font-normal text-zinc-500">
                      All {pages.length} page{pages.length > 1 ? 's' : ''}
                    </span>
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* ---------- canvas ---------- */}
        <div className="px-3 pb-3 sm:px-4">
          <div
            ref={canvasAreaRef}
            onPointerDown={() => setSelectedId(null)}
            className="relative flex h-[44vh] items-center justify-center overflow-hidden rounded-2xl bg-zinc-900/80 sm:h-[54vh]"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)',
              backgroundSize: '18px 18px',
            }}
          >
            <div style={{ width: stageW, height: stageH }} className="relative shadow-[0_18px_50px_-12px_rgb(0_0_0/0.7)]">
              <div
                className="absolute left-0 top-0 origin-top-left overflow-hidden"
                style={{ width: size.w, height: size.h, transform: `scale(${viewScale})`, background: bg.startsWith('data:image') ? '#ffffff' : bg }}
              >
                {/* imported document pages render their bitmap as an image layer */}
                {bg.startsWith('data:image') && (
                  <img src={bg} alt="" draggable={false} className="pointer-events-none absolute left-0 top-0" style={{ width: size.w, height: size.h }} />
                )}
                {/* elements layer — the same components get serialized for exports */}
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

            {hydrating && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/70">
                <Loader2 className="size-6 animate-spin text-fuchsia-400" aria-hidden />
              </div>
            )}

            {els.length === 0 && !hydrating && (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-1.5 px-6 text-center">
                <Sparkles className="size-5 text-fuchsia-400/80" aria-hidden />
                {bg.startsWith('data:image') ? (
                  <>
                    <p className="text-sm font-semibold text-zinc-300">This page is ready to edit</p>
                    <p className="text-[11px] text-zinc-500">Add text, cover-up boxes or photos on top — then export as PDF</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-zinc-300">Start with a template, import a document — or add text & stickers</p>
                    <p className="text-[11px] text-zinc-500">Everything stays on this device</p>
                  </>
                )}
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
                {sel.type === 'cover' && (
                  <>
                    <button
                      onClick={() => void matchPageColor()}
                      disabled={eyedropping}
                      aria-label="Match page color"
                      className="flex size-8 items-center justify-center rounded-full text-zinc-300 hover:bg-white/10"
                    >
                      {eyedropping ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Pipette className="size-3.5" aria-hidden />}
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

          {/* ---------- page strip ---------- */}
          <div className="mt-3 flex items-start gap-2 overflow-x-auto px-0.5 pb-1 pt-1 [scrollbar-width:thin]" role="list" aria-label="Pages">
            {pages.map((p, i) => (
              <PageThumb
                key={p.id}
                page={p}
                index={i}
                active={i === activeIdx}
                canDelete={pages.length > 1}
                onSelect={() => {
                  setPageIdx(i)
                  setSelectedId(null)
                }}
                onDuplicate={() => duplicatePage(i)}
                onDelete={() => deletePage(i)}
              />
            ))}
            <button
              onClick={addPage}
              className="flex h-[64px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border-2 border-dashed border-white/15 px-3 text-zinc-400 transition-colors hover:border-fuchsia-500/60 hover:text-fuchsia-300"
              aria-label="Add a blank page"
              style={{ minWidth: 64 }}
            >
              <Plus className="size-4" aria-hidden />
              <span className="text-[10px] font-semibold">Page</span>
            </button>
          </div>
        </div>
      </div>

      {/* ---------- bottom panel ---------- */}
      <div className="mt-3 overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]">
        <div className="flex items-center gap-1 px-3 pt-3">
          <div className="flex flex-1 gap-1 overflow-x-auto" role="tablist" aria-label="Design panels">
            {(
              [
                { id: 'templates', label: 'Create', icon: LayoutTemplate },
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
          <button
            onClick={() => setPanelOpen((v) => !v)}
            aria-label={panelOpen ? 'Collapse panel' : 'Expand panel'}
            aria-expanded={panelOpen}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-zinc-300 hover:bg-white/10"
          >
            <ChevronDown className={cn('size-4 transition-transform', !panelOpen && 'rotate-180')} aria-hidden />
          </button>
        </div>

        {panelOpen && (
          <div className="max-h-[38vh] overflow-y-auto p-4 pt-3 [scrollbar-width:thin]">
            {/* ----- templates + document import ----- */}
            {tab === 'templates' && (
              <div className="space-y-4">
                <div className="rounded-2xl border border-fuchsia-500/25 bg-gradient-to-br from-fuchsia-600/15 via-purple-600/10 to-transparent p-3.5">
                  <p className="text-xs font-bold text-zinc-100">Edit real documents</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-400">
                    Import a PDF, Word or text file — fix the text, white-out anything, add images, then export back to PDF.
                  </p>
                  <div className="mt-2.5 grid grid-cols-3 gap-2">
                    <button
                      onClick={() => pickDoc('.pdf,application/pdf')}
                      disabled={busy}
                      className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.05] px-2 py-2.5 text-zinc-100 transition-colors hover:border-fuchsia-500/50 hover:bg-white/[0.08] disabled:opacity-50"
                    >
                      <FileDown className="size-4 text-fuchsia-400" aria-hidden />
                      <span className="text-[11px] font-bold">PDF</span>
                    </button>
                    <button
                      onClick={() => pickDoc('.docx')}
                      disabled={busy}
                      className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.05] px-2 py-2.5 text-zinc-100 transition-colors hover:border-fuchsia-500/50 hover:bg-white/[0.08] disabled:opacity-50"
                    >
                      <FileText className="size-4 text-sky-400" aria-hidden />
                      <span className="text-[11px] font-bold">Word</span>
                    </button>
                    <button
                      onClick={() => pickDoc('.txt,text/plain')}
                      disabled={busy}
                      className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/[0.05] px-2 py-2.5 text-zinc-100 transition-colors hover:border-fuchsia-500/50 hover:bg-white/[0.08] disabled:opacity-50"
                    >
                      <FileText className="size-4 text-amber-400" aria-hidden />
                      <span className="text-[11px] font-bold">Text</span>
                    </button>
                  </div>
                  {importingLabel && (
                    <p className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-fuchsia-300">
                      <Loader2 className="size-3.5 animate-spin" aria-hidden /> {importingLabel}
                    </p>
                  )}
                </div>

                <div>
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Templates</p>
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
                </div>
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
                  <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-zinc-500">Document tools</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => addElement({ type: 'cover', fill: '#ffffff', x: 0, y: 0, w: 340, h: 110 })}
                      className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3 text-left transition-colors hover:border-fuchsia-500/40 hover:bg-white/[0.07]"
                    >
                      <Eraser className="size-4 shrink-0 text-fuchsia-400" aria-hidden />
                      <span>
                        <span className="block text-xs font-bold text-zinc-100">Cover-up box</span>
                        <span className="block text-[10px] leading-snug text-zinc-500">Hide letters, stains or stamps</span>
                      </span>
                    </button>
                  </div>
                </div>
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

                {(sel.type === 'shape' || sel.type === 'cover') && (
                  <ColorRow label={sel.type === 'cover' ? 'Cover color' : 'Shape color'} value={sel.fill ?? '#f43f5e'} onPick={(c) => commitPatch({ fill: c })} />
                )}

                {sel.type === 'cover' && (
                  <div>
                    <Button
                      onClick={() => void matchPageColor()}
                      disabled={eyedropping || !bg.startsWith('data:image')}
                      className="h-9 rounded-lg bg-white/5 text-xs font-semibold text-zinc-100 hover:bg-white/10"
                    >
                      {eyedropping ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Pipette className="size-3.5" aria-hidden />}
                      Match page color
                    </Button>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
                      Samples the page around the box so the cover blends in — perfect for removing letters on imported PDFs.
                    </p>
                  </div>
                )}

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
        )}
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
