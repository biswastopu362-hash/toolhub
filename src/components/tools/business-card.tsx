'use client'

/**
 * Business Card Maker — design, flip and export print-ready 3.5 × 2 in cards.
 *
 * A 1050 × 600 px (300 DPI) card is edited live; the preview renders the exact
 * same DOM markup scaled down with CSS, so what you see is what exports.
 * Six templates × front/back sides, accent colors, optional logo (downscaled
 * to ≤256 px), 3D flip preview, PNG front/back exports drawn programmatically
 * on canvas (pure `drawCard` renderer shared by PNG + PDF), and a jsPDF
 * two-page landscape deck. Saved cards persist in IndexedDB — private,
 * offline, instant.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, ReactElement, ReactNode, RefObject } from 'react'
import { motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  FileDown,
  FlipHorizontal2,
  Globe,
  IdCard,
  ImagePlus,
  Layers,
  Loader2,
  Mail,
  MapPin,
  Palette,
  Plus,
  RotateCw,
  ShieldCheck,
  Smartphone,
  Trash2,
  User,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { jsPDF } from 'jspdf'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type Side = 'front' | 'back'

type TemplateId = 'minimal' | 'bold' | 'gradient' | 'mono' | 'elegant' | 'corporate'

type IconKind = 'phone' | 'mail' | 'globe' | 'pin'

interface CardData {
  name: string
  title: string
  company: string
  tagline: string
  phone: string
  email: string
  website: string
  address: string
}

interface CardDoc {
  id: string
  /** switcher label — mirrors data.name at save time */
  name: string
  updatedAt: number
  template: TemplateId
  /** accent hex (#rrggbb) */
  accent: string
  /** optional logo dataURL (downscaled to ≤256 px) */
  logo?: string
  data: CardData
}

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

/** 3.5 × 2 in at 300 DPI. The DOM preview and canvas exports share it. */
const CARD_W = 1050
const CARD_H = 600

const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif'
const SERIF = 'Georgia, "Times New Roman", serif'

const DEFAULT_ACCENT = '#d946ef'

const DB_NAME = 'toolhub-businesscard'
const DB_VERSION = 1
const CARDS_STORE = 'cards'
const SEED_KEY = 'toolhub-businesscard-seeded'

interface AccentOption {
  name: string
  hex: string
}

const ACCENTS: AccentOption[] = [
  { name: 'Fuchsia', hex: '#d946ef' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Rose', hex: '#f43f5e' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Sky', hex: '#0ea5e9' },
  { name: 'Indigo', hex: '#6366f1' },
  { name: 'Violet', hex: '#8b5cf6' },
  { name: 'Slate', hex: '#475569' },
]

const TEMPLATES: { id: TemplateId; label: string }[] = [
  { id: 'minimal', label: 'Minimal' },
  { id: 'bold', label: 'Bold Accent' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'mono', label: 'Mono' },
  { id: 'elegant', label: 'Elegant' },
  { id: 'corporate', label: 'Corporate' },
]

const ICON_COMPONENTS: Record<IconKind, LucideIcon> = {
  phone: Smartphone,
  mail: Mail,
  globe: Globe,
  pin: MapPin,
}

/** Thin glass scrollbar for long lists. */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/* ================================================================== */
/* IndexedDB — saved cards, fully on-device (write-through)            */
/* ================================================================== */

let dbPromise: Promise<IDBDatabase> | null = null

function openCardsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(CARDS_STORE)) d.createObjectStore(CARDS_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openCardsDb()
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
/* Helpers                                                             */
/* ================================================================== */

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function slugify(s: string): string {
  const out = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return out || 'card'
}

function parseHex(v: string): string | null {
  const t = v
    .trim()
    .replace(/^#?/, '#')
    .toLowerCase()
  return /^#[0-9a-f]{6}$/.test(t) ? t : null
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h, 16)
  if (Number.isNaN(n)) return [0, 0, 0]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** f < 0 darkens toward black, f > 0 lightens toward white. */
function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex)
  const t = f < 0 ? 0 : 255
  const p = Math.abs(f)
  const mix = (c: number): number => Math.round(c + (t - c) * p)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]
  if (!first) return 'YN'
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined
  const second = last && last !== first ? last.charAt(0) : first.charAt(1) ?? ''
  return `${first.charAt(0)}${second}`.toUpperCase()
}

/* ================================================================== */
/* Template themes — shared by the DOM preview and the canvas renderer */
/* ================================================================== */

interface Theme {
  bg: string
  /** diagonal gradient pair (CSS + canvas linear gradient) */
  gradient?: [string, string]
  fg: string
  sub: string
  faint: string
  line: string
  icon: string
  rail?: string
  upper: boolean
  serif: boolean
}

function themeOf(template: TemplateId, accent: string): Theme {
  switch (template) {
    case 'minimal':
      return { bg: '#ffffff', fg: '#18181b', sub: '#52525b', faint: '#a1a1aa', line: '#e4e4e7', icon: accent, upper: false, serif: false }
    case 'bold':
      return { bg: '#ffffff', fg: '#18181b', sub: '#52525b', faint: '#71717a', line: '#e4e4e7', icon: accent, upper: false, serif: false }
    case 'gradient':
      return {
        bg: accent,
        gradient: [accent, shade(accent, -0.45)],
        fg: '#ffffff',
        sub: 'rgba(255,255,255,0.85)',
        faint: 'rgba(255,255,255,0.72)',
        line: 'rgba(255,255,255,0.35)',
        icon: '#ffffff',
        upper: false,
        serif: false,
      }
    case 'mono':
      return { bg: '#0b0b0d', fg: '#fafafa', sub: '#a1a1aa', faint: '#737373', line: 'rgba(255,255,255,0.22)', icon: accent, upper: true, serif: false }
    case 'elegant':
      return { bg: '#faf6ee', fg: '#292524', sub: '#57534e', faint: '#79716b', line: '#e7ddc9', icon: accent, upper: false, serif: true }
    case 'corporate':
      return { bg: '#ffffff', fg: '#18181b', sub: '#52525b', faint: '#71717a', line: '#e4e4e7', icon: accent, rail: '#18181b', upper: false, serif: false }
  }
}

/* ================================================================== */
/* Back-side contact rows — identical geometry for DOM + canvas        */
/* ================================================================== */

interface BackRow {
  kind: IconKind
  value: string
  top: number
  x: number
  textX: number
  maxW: number
}

function backRowLayout(template: TemplateId): { icon: number; text: number; maxW: number } {
  if (template === 'bold') return { icon: 300, text: 364, maxW: 620 }
  if (template === 'corporate') return { icon: 380, text: 444, maxW: 540 }
  return { icon: 96, text: 160, maxW: 540 }
}

function backRows(data: CardData, template: TemplateId): BackRow[] {
  const layout = backRowLayout(template)
  const allFields: { kind: IconKind; value: string }[] = [
    { kind: 'phone', value: data.phone.trim() },
    { kind: 'mail', value: data.email.trim() },
    { kind: 'globe', value: data.website.trim() },
    { kind: 'pin', value: data.address.trim() },
  ]
  const fields = allFields.filter((f) => f.value)
  return fields.slice(0, 4).map((f, i) => ({
    ...f,
    top: 132 + i * 92,
    x: layout.icon,
    textX: layout.text,
    maxW: layout.maxW,
  }))
}

/* ================================================================== */
/* Canvas renderer — pure drawCard used by PNG + PDF exports           */
/* ================================================================== */

function rrPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rad, y)
  ctx.lineTo(x + w - rad, y)
  ctx.arcTo(x + w, y, x + w, y + rad, rad)
  ctx.lineTo(x + w, y + h - rad)
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad)
  ctx.lineTo(x + rad, y + h)
  ctx.arcTo(x, y + h, x, y + h - rad, rad)
  ctx.lineTo(x, y + rad)
  ctx.arcTo(x, y, x + rad, y, rad)
  ctx.closePath()
}

function strokeFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string, lw: number): void {
  rrPath(ctx, x, y, w, h, r)
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  ctx.stroke()
}

function fillCircle(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
}

function fontShorthand(size: number, weight: number, family: string, italic?: boolean): string {
  return `${italic ? 'italic ' : ''}${weight} ${size}px ${family}`
}

function measureTextW(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  if (!tracking) return ctx.measureText(text).width
  let w = 0
  let n = 0
  for (const ch of text) {
    w += ctx.measureText(ch).width
    n++
  }
  return w + tracking * Math.max(0, n - 1)
}

interface TextOpts {
  x: number
  /** top of the text box (CSS-like, matches the absolutely-positioned DOM) */
  y: number
  size: number
  color: string
  weight?: number
  family?: string
  /** manual letter tracking in px (drawn char-by-char, no trailing space) */
  tracking?: number
  align?: 'left' | 'center' | 'right'
  /** shrink up to 20% then ellipsize to fit */
  maxW?: number
  italic?: boolean
}

function ctxText(ctx: CanvasRenderingContext2D, raw: string, o: TextOpts): void {
  if (!raw) return
  const family = o.family ?? SANS
  const weight = o.weight ?? 400
  const tracking = o.tracking ?? 0
  let size = o.size
  let text = raw
  ctx.font = fontShorthand(size, weight, family, o.italic)
  if (o.maxW !== undefined) {
    const minSize = Math.max(10, Math.round(o.size * 0.8))
    while (size > minSize && measureTextW(ctx, text, tracking) > o.maxW) {
      size -= 1
      ctx.font = fontShorthand(size, weight, family, o.italic)
    }
    if (measureTextW(ctx, text, tracking) > o.maxW) {
      let cut = text
      while (cut.length > 1 && measureTextW(ctx, `${cut}…`, tracking) > o.maxW) cut = cut.slice(0, -1)
      if (cut !== text) text = `${cut.trimEnd()}…`
    }
  }
  ctx.textBaseline = 'top'
  ctx.fillStyle = o.color
  const yTop = o.y + size * 0.075
  if (tracking) {
    ctx.textAlign = 'left'
    const total = measureTextW(ctx, text, tracking)
    let cx = o.align === 'center' ? o.x - total / 2 : o.align === 'right' ? o.x - total : o.x
    for (const ch of text) {
      ctx.fillText(ch, cx, yTop)
      cx += ctx.measureText(ch).width + tracking
    }
  } else {
    ctx.textAlign = o.align ?? 'left'
    ctx.fillText(text, o.x, yTop)
  }
}

interface MonogramOpts {
  cx: number
  cy: number
  r: number
  initials: string
  fill?: string
  stroke?: string
  strokeW?: number
  color: string
  size: number
  family?: string
  weight?: number
  tracking?: number
  square?: boolean
  radius?: number
}

function ctxMonogram(ctx: CanvasRenderingContext2D, o: MonogramOpts): void {
  if (o.square) {
    rrPath(ctx, o.cx - o.r, o.cy - o.r, o.r * 2, o.r * 2, o.radius ?? 22)
  } else {
    ctx.beginPath()
    ctx.arc(o.cx, o.cy, o.r, 0, Math.PI * 2)
  }
  if (o.fill) {
    ctx.fillStyle = o.fill
    ctx.fill()
  }
  if (o.stroke) {
    ctx.strokeStyle = o.stroke
    ctx.lineWidth = o.strokeW ?? 2
    ctx.stroke()
  }
  if (o.initials) {
    ctxText(ctx, o.initials, {
      x: o.cx,
      y: o.cy - o.size * 0.575,
      size: o.size,
      color: o.color,
      weight: o.weight ?? 700,
      family: o.family,
      tracking: o.tracking,
      align: 'center',
    })
  }
}

/** Lucide-style 24-grid stroke icons (Smartphone / Mail / Globe / MapPin). */
function ctxIcon(ctx: CanvasRenderingContext2D, kind: IconKind, x: number, y: number, size: number, color: string): void {
  const s = size / 24
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s, s)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (kind === 'phone') {
    rrPath(ctx, 5, 2, 14, 20, 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(12, 18, 1.2, 0, Math.PI * 2)
    ctx.fill()
  } else if (kind === 'mail') {
    rrPath(ctx, 2, 4, 20, 16, 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(2.6, 7.4)
    ctx.lineTo(12, 13.4)
    ctx.lineTo(21.4, 7.4)
    ctx.stroke()
  } else if (kind === 'globe') {
    ctx.beginPath()
    ctx.arc(12, 12, 10, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(12, 12, 4.6, 10, 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(2, 12)
    ctx.lineTo(22, 12)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(12, 10, 8, Math.PI * 0.77, Math.PI * 0.23)
    ctx.lineTo(12, 22)
    ctx.closePath()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(12, 10, 3, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

function drawLogoContain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, cx: number, cy: number, box: number): void {
  const iw = img.naturalWidth || img.width || 1
  const ih = img.naturalHeight || img.height || 1
  const k = Math.min(box / iw, box / ih)
  const w = iw * k
  const h = ih * k
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h)
}

function drawLogoOrMonogram(ctx: CanvasRenderingContext2D, logo: HTMLImageElement | null | undefined, cx: number, cy: number, box: number, mono: MonogramOpts): void {
  if (logo) drawLogoContain(ctx, logo, cx, cy, box)
  else ctxMonogram(ctx, mono)
}

/* ---------------- front faces ---------------- */

function drawFront(
  ctx: CanvasRenderingContext2D,
  data: CardData,
  template: TemplateId,
  th: Theme,
  accent: string,
  logo: HTMLImageElement | null,
): void {
  const initials = initialsOf(data.name)
  const name = data.name.trim() || 'Your Name'
  const up = (s: string): string => (th.upper ? s.toUpperCase() : s)

  switch (template) {
    case 'minimal': {
      ctx.fillStyle = accent
      rrPath(ctx, 96, 96, 96, 8, 4)
      ctx.fill()
      drawLogoOrMonogram(ctx, logo, 152, 200, 96, { cx: 152, cy: 200, r: 56, initials, fill: rgba(accent, 0.12), color: accent, size: 42 })
      ctxText(ctx, name, { x: 96, y: 296, size: 60, weight: 700, color: th.fg, maxW: 858 })
      ctxText(ctx, data.title.trim(), { x: 96, y: 384, size: 26, weight: 500, color: th.sub, maxW: 858 })
      ctx.fillStyle = th.line
      ctx.fillRect(96, 448, 524, 2)
      ctxText(ctx, data.company.trim(), { x: 96, y: 474, size: 25, weight: 600, color: th.fg, maxW: 858 })
      ctxText(ctx, data.tagline.trim(), { x: 96, y: 516, size: 21, color: th.faint, maxW: 858, italic: true })
      break
    }
    case 'bold': {
      drawLogoOrMonogram(ctx, logo, 170, 235, 150, { cx: 170, cy: 235, r: 75, initials, fill: 'rgba(255,255,255,0.16)', color: '#ffffff', size: 52 })
      if (data.company.trim()) {
        ctxText(ctx, data.company.trim(), { x: 170, y: 340, size: 26, weight: 700, color: '#ffffff', align: 'center', maxW: 260 })
      }
      ctxText(ctx, name, { x: 420, y: 210, size: 58, weight: 700, color: th.fg, maxW: 534 })
      ctxText(ctx, data.title.trim(), { x: 420, y: 296, size: 26, weight: 500, color: th.sub, maxW: 534 })
      ctx.fillStyle = th.line
      ctx.fillRect(420, 352, 534, 2)
      ctxText(ctx, data.tagline.trim(), { x: 420, y: 388, size: 22, color: th.faint, maxW: 534, italic: true })
      break
    }
    case 'gradient': {
      drawLogoOrMonogram(ctx, logo, 152, 200, 96, { cx: 152, cy: 200, r: 56, initials, fill: 'rgba(255,255,255,0.18)', color: '#ffffff', size: 42 })
      ctxText(ctx, name, { x: 96, y: 296, size: 60, weight: 700, color: th.fg, maxW: 858 })
      ctxText(ctx, data.title.trim(), { x: 96, y: 384, size: 26, weight: 500, color: th.sub, maxW: 858 })
      ctxText(ctx, data.company.trim(), { x: 96, y: 436, size: 24, weight: 600, color: th.sub, maxW: 858 })
      ctxText(ctx, data.tagline.trim(), { x: 96, y: 494, size: 21, color: th.faint, maxW: 858, italic: true })
      break
    }
    case 'mono': {
      drawLogoOrMonogram(ctx, logo, 152, 166, 100, {
        cx: 152,
        cy: 166,
        r: 56,
        initials,
        stroke: 'rgba(255,255,255,0.28)',
        strokeW: 2,
        color: '#ffffff',
        size: 38,
        tracking: 3,
        square: true,
        radius: 22,
      })
      ctxText(ctx, up(name), { x: 96, y: 296, size: 54, weight: 700, color: th.fg, maxW: 858, tracking: 6 })
      ctxText(ctx, up(data.title.trim()), { x: 96, y: 372, size: 23, weight: 500, color: th.sub, maxW: 858, tracking: 4 })
      ctx.fillStyle = accent
      ctx.fillRect(96, 424, 120, 4)
      ctxText(ctx, up(data.company.trim()), { x: 96, y: 458, size: 23, weight: 600, color: th.fg, maxW: 858, tracking: 4 })
      ctxText(ctx, up(data.tagline.trim()), { x: 96, y: 506, size: 19, color: th.faint, maxW: 858, tracking: 3 })
      break
    }
    case 'elegant': {
      drawLogoOrMonogram(ctx, logo, 152, 196, 92, {
        cx: 152,
        cy: 196,
        r: 54,
        initials,
        stroke: accent,
        strokeW: 2,
        color: accent,
        size: 36,
        family: SERIF,
      })
      ctxText(ctx, name, { x: 96, y: 288, size: 62, weight: 700, color: th.fg, family: SERIF, maxW: 858 })
      ctxText(ctx, data.title.trim(), { x: 96, y: 382, size: 25, weight: 500, color: th.sub, maxW: 858 })
      ctx.fillStyle = th.line
      ctx.fillRect(96, 434, 464, 2)
      ctxText(ctx, data.company.trim(), { x: 96, y: 462, size: 22, weight: 600, color: th.sub, maxW: 858, tracking: 2 })
      ctxText(ctx, data.tagline.trim(), { x: 96, y: 508, size: 22, color: th.faint, family: SERIF, italic: true, maxW: 858 })
      break
    }
    case 'corporate': {
      drawLogoOrMonogram(ctx, logo, 150, 225, 140, { cx: 150, cy: 225, r: 70, initials, fill: accent, color: '#ffffff', size: 46 })
      if (data.company.trim()) {
        ctxText(ctx, data.company.trim(), { x: 150, y: 330, size: 25, weight: 700, color: '#ffffff', align: 'center', maxW: 240 })
      }
      ctxText(ctx, name, { x: 370, y: 200, size: 54, weight: 700, color: th.fg, maxW: 580 })
      ctxText(ctx, data.title.trim(), { x: 370, y: 284, size: 26, weight: 500, color: th.sub, maxW: 580 })
      ctx.fillStyle = th.line
      ctx.fillRect(370, 340, 610, 2)
      ctxText(ctx, data.tagline.trim(), { x: 370, y: 376, size: 22, color: th.faint, maxW: 610, italic: true })
      break
    }
  }
}

/* ---------------- back faces ---------------- */

function drawBack(
  ctx: CanvasRenderingContext2D,
  data: CardData,
  template: TemplateId,
  th: Theme,
  accent: string,
  logo: HTMLImageElement | null,
): void {
  const initials = initialsOf(data.name)
  const company = data.company.trim()
  const up = (s: string): string => (th.upper ? s.toUpperCase() : s)

  switch (template) {
    case 'bold': {
      drawLogoOrMonogram(ctx, logo, 120, 270, 130, { cx: 120, cy: 270, r: 62, initials, fill: 'rgba(255,255,255,0.16)', color: '#ffffff', size: 44 })
      break
    }
    case 'corporate': {
      drawLogoOrMonogram(ctx, logo, 150, 250, 140, { cx: 150, cy: 250, r: 70, initials, fill: accent, color: '#ffffff', size: 46 })
      if (company) {
        ctxText(ctx, company, { x: 150, y: 350, size: 24, weight: 700, color: '#ffffff', align: 'center', maxW: 240 })
      }
      break
    }
    case 'minimal': {
      drawLogoOrMonogram(ctx, logo, 830, 260, 190, { cx: 830, cy: 260, r: 96, initials, fill: rgba(accent, 0.12), color: accent, size: 54 })
      if (company) {
        ctxText(ctx, company, { x: 830, y: 390, size: 22, weight: 600, color: th.sub, align: 'center', maxW: 320 })
      }
      break
    }
    case 'elegant': {
      drawLogoOrMonogram(ctx, logo, 830, 250, 180, {
        cx: 830,
        cy: 250,
        r: 92,
        initials,
        stroke: accent,
        strokeW: 2,
        color: accent,
        size: 50,
        family: SERIF,
      })
      if (company) {
        ctxText(ctx, company, { x: 830, y: 372, size: 22, weight: 600, color: th.sub, align: 'center', maxW: 320, tracking: 2 })
      }
      break
    }
    case 'gradient': {
      drawLogoOrMonogram(ctx, logo, 830, 260, 190, { cx: 830, cy: 260, r: 96, initials, fill: 'rgba(255,255,255,0.22)', color: '#ffffff', size: 54 })
      if (company) {
        ctxText(ctx, company, { x: 830, y: 390, size: 22, weight: 600, color: th.sub, align: 'center', maxW: 320 })
      }
      break
    }
    case 'mono': {
      drawLogoOrMonogram(ctx, logo, 830, 250, 130, {
        cx: 830,
        cy: 250,
        r: 70,
        initials,
        stroke: 'rgba(255,255,255,0.28)',
        strokeW: 2,
        color: '#ffffff',
        size: 46,
        tracking: 2,
        square: true,
        radius: 24,
      })
      if (company) {
        ctxText(ctx, up(company), { x: 830, y: 360, size: 21, weight: 600, color: th.sub, align: 'center', maxW: 300, tracking: 3 })
      }
      break
    }
  }

  const rows = backRows(data, template)
  const rowSize = template === 'mono' ? 25 : template === 'elegant' ? 28 : 29
  for (const r of rows) {
    ctxIcon(ctx, r.kind, r.x, r.top + 1, 40, th.icon)
    ctxText(ctx, up(r.value), {
      x: r.textX,
      y: r.top,
      size: rowSize,
      weight: 500,
      color: th.fg,
      maxW: r.maxW,
      tracking: template === 'mono' ? 2 : undefined,
    })
  }
}

/* ---------------- card renderer ---------------- */

function drawCard(
  ctx: CanvasRenderingContext2D,
  side: Side,
  data: CardData,
  template: TemplateId,
  accentHex: string,
  logoEl?: HTMLImageElement | null,
): void {
  const th = themeOf(template, accentHex)

  /* background */
  if (th.gradient) {
    const g = ctx.createLinearGradient(0, 0, CARD_W, CARD_H)
    g.addColorStop(0, th.gradient[0])
    g.addColorStop(1, th.gradient[1])
    ctx.fillStyle = g
  } else {
    ctx.fillStyle = th.bg
  }
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  /* shared decorations */
  if (template === 'minimal') strokeFrame(ctx, 36, 36, CARD_W - 72, CARD_H - 72, 18, th.line, 2)
  if (template === 'elegant') {
    strokeFrame(ctx, 30, 30, CARD_W - 60, CARD_H - 60, 14, th.line, 2)
    strokeFrame(ctx, 42, 42, CARD_W - 84, CARD_H - 84, 10, th.line, 1)
  }
  if (template === 'gradient') {
    fillCircle(ctx, 930, 80, 230, 'rgba(255,255,255,0.07)')
    fillCircle(ctx, 1010, 560, 150, 'rgba(255,255,255,0.05)')
  }
  if (template === 'bold') {
    ctx.fillStyle = accentHex
    ctx.fillRect(0, 0, side === 'front' ? 340 : 240, CARD_H)
  }
  if (template === 'corporate') {
    ctx.fillStyle = th.rail ?? '#18181b'
    ctx.fillRect(0, 0, 300, CARD_H)
    ctx.fillStyle = accentHex
    ctx.fillRect(0, 0, 300, 12)
  }
  if (side === 'back' && (template === 'minimal' || template === 'elegant' || template === 'gradient' || template === 'mono')) {
    ctx.fillStyle = template === 'gradient' ? 'rgba(255,255,255,0.4)' : accentHex
    ctx.fillRect(0, 0, CARD_W, template === 'elegant' ? 10 : 12)
  }

  if (side === 'front') drawFront(ctx, data, template, th, accentHex, logoEl ?? null)
  else drawBack(ctx, data, template, th, accentHex, logoEl ?? null)
}

/* ================================================================== */
/* Image + export helpers                                              */
/* ================================================================== */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

/** File → dataURL, downscaled so the longest edge is ≤256 px. */
async function fileToLogoDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(String(fr.result))
    fr.onerror = () => reject(fr.error ?? new Error('read failed'))
    fr.readAsDataURL(file)
  })
  const img = await loadImage(raw)
  const max = 256
  const w0 = img.naturalWidth || img.width || max
  const h0 = img.naturalHeight || img.height || max
  const k = Math.min(1, max / Math.max(w0, h0))
  const w = Math.max(1, Math.round(w0 * k))
  const h = Math.max(1, Math.round(h0 * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(img, 0, 0, w, h)
  return c.toDataURL('image/png')
}

/** Render one side of a card doc to a PNG dataURL at 1050 × 600. */
async function renderSideDataUrl(side: Side, doc: CardDoc): Promise<string | null> {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  let logoEl: HTMLImageElement | null = null
  if (doc.logo) {
    logoEl = await loadImage(doc.logo).catch(() => null)
  }
  drawCard(ctx, side, doc.data, doc.template, doc.accent, logoEl)
  return canvas.toDataURL('image/png')
}

/* ================================================================== */
/* Saved-card docs — sample seed + tolerant normalize                  */
/* ================================================================== */

function blankCard(): CardDoc {
  return {
    id: uid('card'),
    name: 'Untitled card',
    updatedAt: Date.now(),
    template: 'minimal',
    accent: DEFAULT_ACCENT,
    data: { name: '', title: '', company: '', tagline: '', phone: '', email: '', website: '', address: '' },
  }
}

function sampleCard(): CardDoc {
  return {
    id: uid('card'),
    name: 'Ava Thornton',
    updatedAt: Date.now(),
    template: 'gradient',
    accent: '#d946ef',
    data: {
      name: 'Ava Thornton',
      title: 'Creative Director',
      company: 'Northwind Studio',
      tagline: 'Design that tells your story.',
      phone: '+1 (415) 555-0134',
      email: 'ava@northwind.studio',
      website: 'northwind.studio',
      address: '600 Market St, San Francisco, CA',
    },
  }
}

function normalizeCard(r: unknown): CardDoc | null {
  if (!r || typeof r !== 'object') return null
  const o = r as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return null
  const d = (o.data ?? {}) as Record<string, unknown>
  const data: CardData = {
    name: str(d.name, 80),
    title: str(d.title, 80),
    company: str(d.company, 80),
    tagline: str(d.tagline, 160),
    phone: str(d.phone, 40),
    email: str(d.email, 120),
    website: str(d.website, 120),
    address: str(d.address, 160),
  }
  const template = TEMPLATES.some((t) => t.id === o.template) ? (o.template as TemplateId) : 'minimal'
  const accent = typeof o.accent === 'string' && parseHex(o.accent) ? parseHex(o.accent)! : DEFAULT_ACCENT
  const now = Date.now()
  return {
    id: o.id,
    name: str(o.name, 80) || data.name.trim() || 'Untitled card',
    updatedAt: typeof o.updatedAt === 'number' && o.updatedAt > 0 ? o.updatedAt : now,
    template,
    accent,
    logo: typeof o.logo === 'string' && o.logo.startsWith('data:image/') ? o.logo : undefined,
    data,
  }
}

function hasSeeded(): boolean {
  try {
    return localStorage.getItem(SEED_KEY) === '1'
  } catch {
    return true // SSR / private mode — never reseed
  }
}

function markSeeded(): void {
  try {
    localStorage.setItem(SEED_KEY, '1')
  } catch {
    /* ignore */
  }
}

/* ================================================================== */
/* Card DOM — mirrors drawCard exactly (same numbers, same palette)    */
/* ================================================================== */

interface AbsTextProps {
  x: number
  y: number
  size: number
  color: string
  weight?: number
  family?: string
  tracking?: number
  align?: 'left' | 'center' | 'right'
  maxW?: number
  italic?: boolean
  children: ReactNode
}

function AbsText({ x, y, size, color, weight = 400, family = SANS, tracking, align = 'left', maxW, italic, children }: AbsTextProps) {
  return (
    <div
      className="absolute whitespace-nowrap"
      style={{
        left: align === 'center' ? x - (maxW ?? 0) / 2 : align === 'right' ? x - (maxW ?? 0) : x,
        top: y,
        fontSize: size,
        lineHeight: 1.15,
        fontWeight: weight,
        fontFamily: family,
        letterSpacing: tracking,
        color,
        fontStyle: italic ? 'italic' : undefined,
        width: maxW,
        textAlign: align,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {children}
    </div>
  )
}

function Frame({ x, y, w, h, r, color, strokeW }: { x: number; y: number; w: number; h: number; r: number; color: string; strokeW: number }) {
  return <div className="absolute" style={{ left: x, top: y, width: w, height: h, borderRadius: r, border: `${strokeW}px solid ${color}` }} />
}

interface MonogramProps {
  cx: number
  cy: number
  r: number
  initials: string
  fill?: string
  stroke?: string
  strokeW?: number
  color: string
  size: number
  family?: string
  tracking?: number
  square?: boolean
  radius?: number
}

function Monogram({ cx, cy, r, initials, fill, stroke, strokeW = 2, color, size, family, tracking, square, radius = 22 }: MonogramProps) {
  const shape: CSSProperties = square ? { borderRadius: radius } : { borderRadius: 9999 }
  return (
    <div
      className="absolute flex items-center justify-center"
      style={{ left: cx - r, top: cy - r, width: r * 2, height: r * 2, background: fill, border: stroke ? `${strokeW}px solid ${stroke}` : undefined, ...shape }}
    >
      <span style={{ fontSize: size, fontWeight: 700, color, fontFamily: family ?? SANS, letterSpacing: tracking, lineHeight: 1 }}>{initials}</span>
    </div>
  )
}

function LogoOrMonogram({ logo, cx, cy, box, monogram }: { logo: string | null; cx: number; cy: number; box: number; monogram: ReactElement }) {
  if (logo) {
    return <img src={logo} alt="" aria-hidden className="absolute object-contain" style={{ left: cx - box / 2, top: cy - box / 2, width: box, height: box }} />
  }
  return monogram
}

interface FaceNodesProps {
  template: TemplateId
  th: Theme
  accent: string
  data: CardData
  logo: string | null
  initials: string
}

function FrontNodes({ template, th, accent, data, logo, initials }: FaceNodesProps): ReactElement {
  const name = data.name.trim() || 'Your Name'
  switch (template) {
    case 'minimal':
      return (
        <>
          <div className="absolute" style={{ left: 96, top: 96, width: 96, height: 8, borderRadius: 4, background: accent }} />
          <LogoOrMonogram
            logo={logo}
            cx={152}
            cy={200}
            box={96}
            monogram={<Monogram cx={152} cy={200} r={56} fill={rgba(accent, 0.12)} color={accent} size={42} initials={initials} />}
          />
          <AbsText x={96} y={296} size={60} weight={700} color={th.fg} maxW={858}>
            {name}
          </AbsText>
          <AbsText x={96} y={384} size={26} weight={500} color={th.sub} maxW={858}>
            {data.title}
          </AbsText>
          <div className="absolute" style={{ left: 96, top: 448, width: 524, height: 2, background: th.line }} />
          <AbsText x={96} y={474} size={25} weight={600} color={th.fg} maxW={858}>
            {data.company}
          </AbsText>
          <AbsText x={96} y={516} size={21} color={th.faint} maxW={858} italic>
            {data.tagline}
          </AbsText>
        </>
      )
    case 'bold':
      return (
        <>
          <LogoOrMonogram
            logo={logo}
            cx={170}
            cy={235}
            box={150}
            monogram={<Monogram cx={170} cy={235} r={75} fill="rgba(255,255,255,0.16)" color="#ffffff" size={52} initials={initials} />}
          />
          {data.company && (
            <AbsText x={170} y={340} size={26} weight={700} color="#ffffff" align="center" maxW={260}>
              {data.company}
            </AbsText>
          )}
          <AbsText x={420} y={210} size={58} weight={700} color={th.fg} maxW={534}>
            {name}
          </AbsText>
          <AbsText x={420} y={296} size={26} weight={500} color={th.sub} maxW={534}>
            {data.title}
          </AbsText>
          <div className="absolute" style={{ left: 420, top: 352, width: 534, height: 2, background: th.line }} />
          <AbsText x={420} y={388} size={22} color={th.faint} maxW={534} italic>
            {data.tagline}
          </AbsText>
        </>
      )
    case 'gradient':
      return (
        <>
          <LogoOrMonogram
            logo={logo}
            cx={152}
            cy={200}
            box={96}
            monogram={<Monogram cx={152} cy={200} r={56} fill="rgba(255,255,255,0.18)" color="#ffffff" size={42} initials={initials} />}
          />
          <AbsText x={96} y={296} size={60} weight={700} color={th.fg} maxW={858}>
            {name}
          </AbsText>
          <AbsText x={96} y={384} size={26} weight={500} color={th.sub} maxW={858}>
            {data.title}
          </AbsText>
          <AbsText x={96} y={436} size={24} weight={600} color={th.sub} maxW={858}>
            {data.company}
          </AbsText>
          <AbsText x={96} y={494} size={21} color={th.faint} maxW={858} italic>
            {data.tagline}
          </AbsText>
        </>
      )
    case 'mono':
      return (
        <>
          <LogoOrMonogram
            logo={logo}
            cx={152}
            cy={166}
            box={100}
            monogram={
              <Monogram cx={152} cy={166} r={56} stroke="rgba(255,255,255,0.28)" color="#ffffff" size={38} tracking={3} square radius={22} initials={initials} />
            }
          />
          <AbsText x={96} y={296} size={54} weight={700} color={th.fg} maxW={858} tracking={6}>
            {th.upper ? name.toUpperCase() : name}
          </AbsText>
          <AbsText x={96} y={372} size={23} weight={500} color={th.sub} maxW={858} tracking={4}>
            {th.upper ? data.title.toUpperCase() : data.title}
          </AbsText>
          <div className="absolute" style={{ left: 96, top: 424, width: 120, height: 4, background: accent }} />
          <AbsText x={96} y={458} size={23} weight={600} color={th.fg} maxW={858} tracking={4}>
            {th.upper ? data.company.toUpperCase() : data.company}
          </AbsText>
          <AbsText x={96} y={506} size={19} color={th.faint} maxW={858} tracking={3}>
            {th.upper ? data.tagline.toUpperCase() : data.tagline}
          </AbsText>
        </>
      )
    case 'elegant':
      return (
        <>
          <LogoOrMonogram
            logo={logo}
            cx={152}
            cy={196}
            box={92}
            monogram={<Monogram cx={152} cy={196} r={54} stroke={accent} color={accent} size={36} family={SERIF} initials={initials} />}
          />
          <AbsText x={96} y={288} size={62} weight={700} color={th.fg} family={SERIF} maxW={858}>
            {name}
          </AbsText>
          <AbsText x={96} y={382} size={25} weight={500} color={th.sub} maxW={858}>
            {data.title}
          </AbsText>
          <div className="absolute" style={{ left: 96, top: 434, width: 464, height: 2, background: th.line }} />
          <AbsText x={96} y={462} size={22} weight={600} color={th.sub} maxW={858} tracking={2}>
            {data.company}
          </AbsText>
          <AbsText x={96} y={508} size={22} color={th.faint} family={SERIF} italic maxW={858}>
            {data.tagline}
          </AbsText>
        </>
      )
    case 'corporate':
      return (
        <>
          <LogoOrMonogram
            logo={logo}
            cx={150}
            cy={225}
            box={140}
            monogram={<Monogram cx={150} cy={225} r={70} fill={accent} color="#ffffff" size={46} initials={initials} />}
          />
          {data.company && (
            <AbsText x={150} y={330} size={25} weight={700} color="#ffffff" align="center" maxW={240}>
              {data.company}
            </AbsText>
          )}
          <AbsText x={370} y={200} size={54} weight={700} color={th.fg} maxW={580}>
            {name}
          </AbsText>
          <AbsText x={370} y={284} size={26} weight={500} color={th.sub} maxW={580}>
            {data.title}
          </AbsText>
          <div className="absolute" style={{ left: 370, top: 340, width: 610, height: 2, background: th.line }} />
          <AbsText x={370} y={376} size={22} color={th.faint} maxW={610} italic>
            {data.tagline}
          </AbsText>
        </>
      )
  }
}

function BackNodes({ template, th, accent, data, logo, initials }: FaceNodesProps): ReactElement {
  const up = (s: string): string => (th.upper ? s.toUpperCase() : s)
  const rows = backRows(data, template)
  const rowSize = template === 'mono' ? 25 : template === 'elegant' ? 28 : 29
  return (
    <>
      {template === 'bold' && (
        <LogoOrMonogram
          logo={logo}
          cx={120}
          cy={270}
          box={130}
          monogram={<Monogram cx={120} cy={270} r={62} fill="rgba(255,255,255,0.16)" color="#ffffff" size={44} initials={initials} />}
        />
      )}
      {template === 'corporate' && (
        <>
          <LogoOrMonogram
            logo={logo}
            cx={150}
            cy={250}
            box={140}
            monogram={<Monogram cx={150} cy={250} r={70} fill={accent} color="#ffffff" size={46} initials={initials} />}
          />
          {data.company && (
            <AbsText x={150} y={350} size={24} weight={700} color="#ffffff" align="center" maxW={240}>
              {data.company}
            </AbsText>
          )}
        </>
      )}
      {template === 'minimal' && (
        <>
          <LogoOrMonogram
            logo={logo}
            cx={830}
            cy={260}
            box={190}
            monogram={<Monogram cx={830} cy={260} r={96} fill={rgba(accent, 0.12)} color={accent} size={54} initials={initials} />}
          />
          {data.company && (
            <AbsText x={830} y={390} size={22} weight={600} color={th.sub} align="center" maxW={320}>
              {data.company}
            </AbsText>
          )}
        </>
      )}
      {template === 'elegant' && (
        <>
          <LogoOrMonogram
            logo={logo}
            cx={830}
            cy={250}
            box={180}
            monogram={<Monogram cx={830} cy={250} r={92} stroke={accent} color={accent} size={50} family={SERIF} initials={initials} />}
          />
          {data.company && (
            <AbsText x={830} y={372} size={22} weight={600} color={th.sub} align="center" maxW={320} tracking={2}>
              {data.company}
            </AbsText>
          )}
        </>
      )}
      {template === 'gradient' && (
        <>
          <LogoOrMonogram
            logo={logo}
            cx={830}
            cy={260}
            box={190}
            monogram={<Monogram cx={830} cy={260} r={96} fill="rgba(255,255,255,0.22)" color="#ffffff" size={54} initials={initials} />}
          />
          {data.company && (
            <AbsText x={830} y={390} size={22} weight={600} color={th.sub} align="center" maxW={320}>
              {data.company}
            </AbsText>
          )}
        </>
      )}
      {template === 'mono' && (
        <>
          <LogoOrMonogram
            logo={logo}
            cx={830}
            cy={250}
            box={130}
            monogram={
              <Monogram cx={830} cy={250} r={70} stroke="rgba(255,255,255,0.28)" color="#ffffff" size={46} tracking={2} square radius={24} initials={initials} />
            }
          />
          {data.company && (
            <AbsText x={830} y={360} size={21} weight={600} color={th.sub} align="center" maxW={300} tracking={3}>
              {up(data.company)}
            </AbsText>
          )}
        </>
      )}
      {rows.map((r) => {
        const Icon = ICON_COMPONENTS[r.kind]
        return (
          <Fragment key={r.kind}>
            <Icon className="absolute" style={{ left: r.x, top: r.top + 1, width: 40, height: 40, color: th.icon }} strokeWidth={2} aria-hidden />
            <AbsText x={r.textX} y={r.top} size={rowSize} weight={500} color={th.fg} maxW={r.maxW} tracking={template === 'mono' ? 2 : undefined}>
              {up(r.value)}
            </AbsText>
          </Fragment>
        )
      })}
    </>
  )
}

interface CardFaceProps {
  side: Side
  template: TemplateId
  accent: string
  data: CardData
  logo: string | null
}

function CardFace({ side, template, accent, data, logo }: CardFaceProps) {
  const th = themeOf(template, accent)
  const initials = initialsOf(data.name)
  return (
    <div className="relative overflow-hidden" style={{ width: CARD_W, height: CARD_H, background: th.bg, fontFamily: SANS, color: th.fg }}>
      {th.gradient && (
        <>
          <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${th.gradient[0]}, ${th.gradient[1]})` }} />
          <div className="absolute rounded-full" style={{ left: 700, top: -150, width: 460, height: 460, background: 'rgba(255,255,255,0.07)' }} />
          <div className="absolute rounded-full" style={{ left: 860, top: 410, width: 300, height: 300, background: 'rgba(255,255,255,0.05)' }} />
        </>
      )}
      {template === 'minimal' && <Frame x={36} y={36} w={978} h={528} r={18} color={th.line} strokeW={2} />}
      {template === 'elegant' && (
        <>
          <Frame x={30} y={30} w={990} h={540} r={14} color={th.line} strokeW={2} />
          <Frame x={42} y={42} w={966} h={516} r={10} color={th.line} strokeW={1} />
        </>
      )}
      {(template === 'bold' || template === 'corporate') && (
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: template === 'bold' ? (side === 'front' ? 340 : 240) : 300, background: template === 'corporate' ? th.rail : accent }}
        >
          {template === 'corporate' && <div className="absolute inset-x-0 top-0" style={{ height: 12, background: accent }} />}
        </div>
      )}
      {side === 'back' && (template === 'minimal' || template === 'elegant' || template === 'gradient' || template === 'mono') && (
        <div
          className="absolute inset-x-0 top-0"
          style={{ height: template === 'elegant' ? 10 : 12, background: template === 'gradient' ? 'rgba(255,255,255,0.4)' : accent }}
        />
      )}
      {side === 'front' ? (
        <FrontNodes template={template} th={th} accent={accent} data={data} logo={logo} initials={initials} />
      ) : (
        <BackNodes template={template} th={th} accent={accent} data={data} logo={logo} initials={initials} />
      )}
    </div>
  )
}

/* ================================================================== */
/* Scale-to-fit stages (preview + template thumbnails)                 */
/* ================================================================== */

function useFitScale<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [scale, setScale] = useState(0.28)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = (): void => {
      const w = el.clientWidth
      if (w > 0) setScale(w / CARD_W)
    }
    const ro = new ResizeObserver(() => apply())
    ro.observe(el)
    const t = setTimeout(apply, 0)
    return () => {
      ro.disconnect()
      clearTimeout(t)
    }
  }, [])
  return [ref, scale]
}

/** Renders fixed 1050×600 children scaled down to the container width. */
function ScaledStage({ children }: { children: ReactNode }) {
  const [ref, scale] = useFitScale<HTMLDivElement>()
  return (
    <div ref={ref} className="relative h-full w-full">
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  )
}

/** Mini 16:9 thumbnail used by the template picker chips. */
function MiniThumb({ children }: { children: ReactNode }) {
  const [ref, scale] = useFitScale<HTMLSpanElement>()
  return (
    <span ref={ref} className="relative block aspect-[1050/600] w-full overflow-hidden rounded-md border border-white/10">
      <span className="absolute left-0 top-0 block origin-top-left" style={{ width: CARD_W, height: CARD_H, transform: `scale(${scale})` }}>
        {children}
      </span>
    </span>
  )
}

/* ================================================================== */
/* Editor atoms                                                        */
/* ================================================================== */

const SECTIONS = [
  { id: 'template', label: 'Template', icon: Layers },
  { id: 'details', label: 'Card details', icon: User },
  { id: 'contact', label: 'Contact', icon: Smartphone },
  { id: 'accent', label: 'Accent color', icon: Palette },
  { id: 'logo', label: 'Logo', icon: ImagePlus },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

function Section({ label, icon: Icon, open, onToggle, children }: { label: string; icon: LucideIcon; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
      <button type="button" onClick={onToggle} className="flex h-11 w-full items-center justify-between px-4 text-left" aria-expanded={open}>
        <span className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          <Icon className="size-4 text-fuchsia-400" aria-hidden />
          {label}
        </span>
        <ChevronDown className={cn('size-4 text-zinc-500 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && <div className="border-t border-white/5 px-4 pb-4 pt-3">{children}</div>}
    </div>
  )
}

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  maxLength?: number
  inputMode?: 'text' | 'tel' | 'email' | 'url'
}

function Field({ label, value, onChange, placeholder, maxLength, inputMode }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        className="h-11 border-white/10 bg-white/[0.04] text-sm text-zinc-100 placeholder:text-zinc-600"
      />
    </label>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

type ExportKind = 'png-front' | 'png-back' | 'pdf' | null

export default function BusinessCardApp() {
  const { toast } = useToast()

  /* ---------------- saved cards (IndexedDB) ---------------- */
  const [cards, setCards] = useState<CardDoc[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  /* ---------------- working draft ---------------- */
  const [draft, setDraft] = useState<CardDoc>(() => blankCard())
  const [flipped, setFlipped] = useState(false)
  const [exporting, setExporting] = useState<ExportKind>(null)
  const [pdfIncludeBack, setPdfIncludeBack] = useState(true)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [sections, setSections] = useState<Record<SectionId, boolean>>({
    template: true,
    details: true,
    contact: false,
    accent: false,
    logo: false,
  })

  /* hex input mirrors draft.accent (swatches / card switches rewrite it) */
  const [hexInput, setHexInput] = useState(draft.accent)
  const [lastAccent, setLastAccent] = useState(draft.accent)
  if (lastAccent !== draft.accent) {
    setLastAccent(draft.accent)
    setHexInput(draft.accent)
  }

  const logoInputRef = useRef<HTMLInputElement | null>(null)

  /* ---------------- hydration + first-run seed ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const all = await idbGetAll<unknown>(CARDS_STORE)
        if (!alive) return
        const clean = all
          .map(normalizeCard)
          .filter((c): c is CardDoc => c !== null)
          .sort((a, b) => b.updatedAt - a.updatedAt)
        let list = clean
        if (list.length === 0 && !hasSeeded()) {
          const sample = sampleCard()
          list = [sample]
          void idbPut(CARDS_STORE, sample).catch(() => {
            /* memory-only fallback */
          })
          markSeeded()
        }
        setCards(list)
        const first = list[0]
        if (first) {
          setActiveId(first.id)
          setDraft(first)
        }
      } catch {
        /* private mode / quota — keep in-memory draft */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- derived ---------------- */
  const activeDoc = useMemo(() => cards.find((c) => c.id === activeId) ?? null, [cards, activeId])

  const dirty = useMemo(() => {
    if (!activeDoc) return true
    const a: CardDoc = { ...draft, updatedAt: 0 }
    const b: CardDoc = { ...activeDoc, updatedAt: 0 }
    return JSON.stringify(a) !== JSON.stringify(b)
  }, [draft, activeDoc])

  /* ---------------- mutations (write-through) ---------------- */
  const saveCard = useCallback(() => {
    const doc: CardDoc = { ...draft, name: draft.data.name.trim() || 'Untitled card', updatedAt: Date.now() }
    setCards((prev) => (prev.some((c) => c.id === doc.id) ? prev.map((c) => (c.id === doc.id ? doc : c)) : [doc, ...prev]))
    setActiveId(doc.id)
    setDraft(doc)
    void idbPut(CARDS_STORE, doc).catch(() => {
      /* memory-only fallback */
    })
    haptic()
    toast({ title: 'Card saved', description: `${doc.name} — stored on this device` })
  }, [draft, toast])

  const saveAsNew = useCallback(() => {
    const doc: CardDoc = { ...draft, id: uid('card'), name: `${draft.data.name.trim() || 'Untitled card'} copy`, updatedAt: Date.now() }
    setCards((prev) => [doc, ...prev])
    setActiveId(doc.id)
    setDraft(doc)
    void idbPut(CARDS_STORE, doc).catch(() => {
      /* memory-only fallback */
    })
    haptic()
    toast({ title: 'Saved as new card', description: doc.name })
  }, [draft, toast])

  const deleteCard = useCallback(() => {
    const target = cards.find((c) => c.id === activeId)
    if (!target) {
      setDeleteOpen(false)
      return
    }
    const rest = cards.filter((c) => c.id !== target.id)
    setCards(rest)
    void idbDelete(CARDS_STORE, target.id).catch(() => {
      /* memory-only fallback */
    })
    const next = rest[0]
    if (next) {
      setActiveId(next.id)
      setDraft(next)
    } else {
      setActiveId(null)
      setDraft(blankCard())
    }
    setDeleteOpen(false)
    haptic()
    toast({ title: 'Card deleted', description: target.name })
  }, [cards, activeId, toast])

  const newCard = useCallback(() => {
    setActiveId(null)
    setDraft(blankCard())
    setFlipped(false)
    toast({ title: 'New card', description: 'Fill in the details, then hit Save.' })
  }, [toast])

  /* ---------------- draft edits ---------------- */
  const setDataField = useCallback((key: keyof CardData, value: string) => {
    setDraft((d) => ({ ...d, data: { ...d.data, [key]: value } }))
  }, [])

  const applyTemplate = useCallback((t: TemplateId) => {
    setDraft((d) => ({ ...d, template: t }))
  }, [])

  const applyAccent = useCallback((hex: string) => {
    setDraft((d) => ({ ...d, accent: hex }))
  }, [])

  const onHexChange = useCallback(
    (v: string) => {
      setHexInput(v)
      const parsed = parseHex(v)
      if (parsed) applyAccent(parsed)
    },
    [applyAccent],
  )

  const onLogoFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      if (!file.type.startsWith('image/')) {
        toast({ title: 'Unsupported file', description: 'Pick a PNG, JPG, WebP or SVG image.', variant: 'destructive' })
        return
      }
      if (file.size > 8 * 1024 * 1024) {
        toast({ title: 'Image too large', description: 'Logos must be under 8 MB.', variant: 'destructive' })
        return
      }
      try {
        const url = await fileToLogoDataUrl(file)
        setDraft((d) => ({ ...d, logo: url }))
        haptic()
        toast({ title: 'Logo added', description: 'It replaces the initials monogram on the card.' })
      } catch {
        toast({ title: 'Could not read image', description: 'That file could not be processed.', variant: 'destructive' })
      }
    },
    [toast],
  )

  /* ---------------- exports ---------------- */
  const exportPng = useCallback(
    async (side: Side) => {
      setExporting(side === 'front' ? 'png-front' : 'png-back')
      try {
        const url = await renderSideDataUrl(side, draft)
        if (!url) throw new Error('render failed')
        const a = document.createElement('a')
        a.href = url
        a.download = `${slugify(draft.data.name)}-card-${side}.png`
        document.body.appendChild(a)
        a.click()
        a.remove()
        haptic()
        toast({ title: `PNG ${side} exported`, description: '1050 × 600 px — 3.5 × 2 in at 300 DPI' })
      } catch {
        toast({ title: 'Export failed', description: 'Could not render the card to PNG on this device.', variant: 'destructive' })
      } finally {
        setExporting(null)
      }
    },
    [draft, toast],
  )

  const exportPdf = useCallback(async () => {
    setExporting('pdf')
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'px', format: [CARD_W, CARD_H] })
      const front = await renderSideDataUrl('front', draft)
      if (!front) throw new Error('render failed')
      doc.addImage(front, 'PNG', 0, 0, CARD_W, CARD_H)
      if (pdfIncludeBack) {
        const back = await renderSideDataUrl('back', draft)
        if (!back) throw new Error('render failed')
        doc.addPage([CARD_W, CARD_H], 'landscape')
        doc.addImage(back, 'PNG', 0, 0, CARD_W, CARD_H)
      }
      doc.save(`${slugify(draft.data.name)}-card.pdf`)
      haptic()
      toast({ title: 'PDF exported', description: pdfIncludeBack ? 'Two pages — front and back' : 'Front side only' })
    } catch {
      toast({ title: 'Export failed', description: 'Could not build the PDF on this device.', variant: 'destructive' })
    } finally {
      setExporting(null)
    }
  }, [draft, pdfIncludeBack, toast])

  /* ---------------- render ---------------- */
  const hexValid = parseHex(hexInput) !== null

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className="rounded-3xl border border-white/10 bg-zinc-950 p-4 shadow-2xl shadow-black/40 sm:p-6"
    >
      {/* ---------- header ---------- */}
      <div className="rounded-2xl bg-gradient-to-r from-fuchsia-500/15 via-pink-500/10 to-transparent p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-pink-600 shadow-lg shadow-fuchsia-500/25">
            <IdCard className="size-6 text-white" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold text-white">Business Card Maker</h2>
            <p className="truncate text-xs text-zinc-400">Design, flip and export print-ready 3.5 × 2 in cards</p>
          </div>
          <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
            <Badge variant="outline" className="border-white/10 bg-white/5 text-zinc-300">
              1050 × 600
            </Badge>
            <Badge variant="outline" className="border-white/10 bg-white/5 text-zinc-300">
              300 DPI
            </Badge>
          </div>
        </div>
      </div>

      {/* ---------- saved-card switcher ---------- */}
      <div className="mt-4 flex items-center gap-2">
        <div className={cn('flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-1', THIN_SCROLLBAR)}>
          {cards.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setActiveId(c.id)
                setDraft(c)
              }}
              aria-pressed={activeId === c.id}
              className={cn(
                'flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-colors',
                activeId === c.id
                  ? 'border-fuchsia-400/50 bg-fuchsia-500/15 text-fuchsia-100'
                  : 'border-white/10 bg-white/[0.04] text-zinc-400 hover:border-white/20 hover:text-zinc-200',
              )}
            >
              <span className="size-2 shrink-0 rounded-full" style={{ background: c.accent }} aria-hidden />
              <span className="max-w-36 truncate">{c.name}</span>
            </button>
          ))}
          {loaded && cards.length === 0 && <span className="px-1 text-xs text-zinc-500">No saved cards yet — hit Save below</span>}
        </div>
        <Button
          variant="outline"
          onClick={newCard}
          aria-label="New blank card"
          className="size-11 shrink-0 border-white/10 bg-white/[0.04] p-0 text-zinc-300 hover:bg-white/10 hover:text-white"
        >
          <Plus className="size-4" aria-hidden />
        </Button>
      </div>

      {/* ---------- save / save-as-new / delete ---------- */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          onClick={saveCard}
          className="h-11 min-w-32 flex-1 bg-gradient-to-r from-fuchsia-500 to-pink-600 text-white shadow-lg shadow-fuchsia-500/25 hover:opacity-90 sm:flex-none sm:px-6"
        >
          <Check className="size-4" aria-hidden />
          Save
        </Button>
        <Button
          variant="outline"
          onClick={saveAsNew}
          className="h-11 border-white/10 bg-white/[0.04] text-zinc-100 hover:bg-white/10 hover:text-white"
        >
          <Copy className="size-4" aria-hidden />
          Save as new
        </Button>
        <Button
          variant="outline"
          onClick={() => setDeleteOpen(true)}
          disabled={!activeDoc}
          className="h-11 border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20 hover:text-rose-100"
        >
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
        {dirty && (
          <Badge className="border-transparent bg-amber-400/15 text-amber-300" aria-live="polite">
            Unsaved changes
          </Badge>
        )}
      </div>

      {/* ---------- main grid: preview + editor ---------- */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* ---------- preview column ---------- */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 sm:p-4">
          <div className="relative w-full [perspective:1600px]">
            <motion.div
              className="relative aspect-[1050/600] w-full cursor-pointer select-none [transform-style:preserve-3d]"
              animate={{ rotateY: flipped ? 180 : 0 }}
              whileTap={{ scale: 0.985 }}
              transition={{ type: 'spring', stiffness: 220, damping: 26 }}
              onClick={() => setFlipped((f) => !f)}
              role="button"
              tabIndex={0}
              aria-label={flipped ? 'Show front of card' : 'Show back of card'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  setFlipped((f) => !f)
                }
              }}
            >
              {/* front face */}
              <div className="absolute inset-0 overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50 [backface-visibility:hidden]">
                <ScaledStage>
                  <CardFace side="front" template={draft.template} accent={draft.accent} data={draft.data} logo={draft.logo ?? null} />
                </ScaledStage>
              </div>
              {/* back face */}
              <div className="absolute inset-0 overflow-hidden rounded-2xl border border-white/10 shadow-2xl shadow-black/50 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <ScaledStage>
                  <CardFace side="back" template={draft.template} accent={draft.accent} data={draft.data} logo={draft.logo ?? null} />
                </ScaledStage>
              </div>
            </motion.div>
          </div>

          <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] font-medium text-zinc-500">
            <RotateCw className="size-3" aria-hidden /> Tap the card to flip — exports match exactly what you see
          </p>

          {/* front / back toggle */}
          <div className="mt-3 flex gap-2">
            <div className="flex flex-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {(['front', 'back'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFlipped(s === 'back')}
                  aria-pressed={(s === 'back') === flipped}
                  className={cn(
                    'h-11 flex-1 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors',
                    (s === 'back') === flipped ? 'bg-fuchsia-500/20 text-fuchsia-200' : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              onClick={() => setFlipped((f) => !f)}
              className="h-11 border-white/10 bg-white/[0.04] px-4 text-zinc-200 hover:bg-white/10 hover:text-white"
            >
              <FlipHorizontal2 className="size-4" aria-hidden />
              Flip
            </Button>
          </div>

          {/* exports */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Button
              onClick={() => void exportPng('front')}
              disabled={exporting !== null}
              className="h-11 border-white/10 bg-white/[0.06] text-zinc-100 hover:bg-white/10"
            >
              {exporting === 'png-front' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
              PNG front
            </Button>
            <Button
              onClick={() => void exportPng('back')}
              disabled={exporting !== null}
              className="h-11 border-white/10 bg-white/[0.06] text-zinc-100 hover:bg-white/10"
            >
              {exporting === 'png-back' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
              PNG back
            </Button>
            <Button
              onClick={() => void exportPdf()}
              disabled={exporting !== null}
              className="col-span-2 h-11 bg-gradient-to-r from-fuchsia-500 to-pink-600 text-white shadow-lg shadow-fuchsia-500/25 hover:opacity-90 sm:col-span-1"
            >
              {exporting === 'pdf' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileDown className="size-4" aria-hidden />}
              PDF{pdfIncludeBack ? ' · 2 pages' : ''}
            </Button>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-300">Include back side in PDF</p>
              <p className="text-[11px] text-zinc-500">Off exports a single-sided page</p>
            </div>
            <Switch checked={pdfIncludeBack} onCheckedChange={setPdfIncludeBack} aria-label="Include back side in PDF" />
          </div>

          <div className="mt-3 flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400" aria-hidden />
            <p className="text-[11px] leading-relaxed text-zinc-500">
              Private by design — cards, logos and exports never leave your device. PNG/PDF render at 1050 × 600 px (3.5 × 2 in at 300 DPI).
            </p>
          </div>
        </section>

        {/* ---------- editor column ---------- */}
        <section className="space-y-3">
          {/* template picker */}
          <Section
            label="Template"
            icon={Layers}
            open={sections.template}
            onToggle={() => setSections((s) => ({ ...s, template: !s.template }))}
          >
            <div className={cn('grid max-h-96 grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3', THIN_SCROLLBAR)}>
              {TEMPLATES.map((t) => {
                const active = draft.template === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => applyTemplate(t.id)}
                    aria-pressed={active}
                    className={cn(
                      'flex min-h-24 flex-col rounded-xl border p-2 text-left transition-colors',
                      active ? 'border-fuchsia-400/60 bg-fuchsia-500/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.05]',
                    )}
                  >
                    <MiniThumb>
                      <CardFace side="front" template={t.id} accent={draft.accent} data={draft.data} logo={draft.logo ?? null} />
                    </MiniThumb>
                    <span className="mt-1.5 flex items-center justify-between px-0.5">
                      <span className="text-[11px] font-semibold text-zinc-300">{t.label}</span>
                      {active && <Check className="size-3.5 text-fuchsia-400" aria-hidden />}
                    </span>
                  </button>
                )
              })}
            </div>
          </Section>

          {/* card details */}
          <Section
            label="Card details"
            icon={User}
            open={sections.details}
            onToggle={() => setSections((s) => ({ ...s, details: !s.details }))}
          >
            <div className="space-y-3">
              <Field label="Name" value={draft.data.name} onChange={(v) => setDataField('name', v)} placeholder="Ava Thornton" maxLength={80} />
              <Field label="Title / Role" value={draft.data.title} onChange={(v) => setDataField('title', v)} placeholder="Creative Director" maxLength={80} />
              <Field label="Company" value={draft.data.company} onChange={(v) => setDataField('company', v)} placeholder="Northwind Studio" maxLength={80} />
              <Field label="Tagline" value={draft.data.tagline} onChange={(v) => setDataField('tagline', v)} placeholder="Design that tells your story." maxLength={160} />
            </div>
          </Section>

          {/* contact */}
          <Section
            label="Contact"
            icon={Smartphone}
            open={sections.contact}
            onToggle={() => setSections((s) => ({ ...s, contact: !s.contact }))}
          >
            <div className="space-y-3">
              <Field label="Phone" value={draft.data.phone} onChange={(v) => setDataField('phone', v)} placeholder="+1 (415) 555-0134" maxLength={40} inputMode="tel" />
              <Field label="Email" value={draft.data.email} onChange={(v) => setDataField('email', v)} placeholder="ava@northwind.studio" maxLength={120} inputMode="email" />
              <Field label="Website" value={draft.data.website} onChange={(v) => setDataField('website', v)} placeholder="northwind.studio" maxLength={120} inputMode="url" />
              <Field label="Address" value={draft.data.address} onChange={(v) => setDataField('address', v)} placeholder="600 Market St, San Francisco, CA" maxLength={160} />
              <p className="text-[11px] text-zinc-500">Empty fields are skipped on the back side.</p>
            </div>
          </Section>

          {/* accent color */}
          <Section
            label="Accent color"
            icon={Palette}
            open={sections.accent}
            onToggle={() => setSections((s) => ({ ...s, accent: !s.accent }))}
          >
            <div className="flex flex-wrap gap-2" role="group" aria-label="Accent color presets">
              {ACCENTS.map((a) => {
                const active = draft.accent === a.hex
                return (
                  <button
                    key={a.hex}
                    type="button"
                    onClick={() => applyAccent(a.hex)}
                    aria-label={`Accent ${a.name}`}
                    aria-pressed={active}
                    className={cn(
                      'size-11 rounded-full border-2 transition-transform',
                      active ? 'scale-110 border-white' : 'border-white/20 hover:scale-105',
                    )}
                    style={{ background: a.hex }}
                  />
                )
              })}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Input
                value={hexInput}
                onChange={(e) => onHexChange(e.target.value)}
                placeholder="#d946ef"
                maxLength={7}
                aria-label="Custom accent hex color"
                className={cn(
                  'h-11 flex-1 border-white/10 bg-white/[0.04] font-mono text-sm text-zinc-100 placeholder:text-zinc-600',
                  hexInput.trim() !== '' && !hexValid && 'border-rose-400/50',
                )}
              />
              {hexValid ? (
                <Check className="size-4 shrink-0 text-emerald-400" aria-label="Valid hex" />
              ) : hexInput.trim() !== '' ? (
                <X className="size-4 shrink-0 text-rose-400" aria-label="Invalid hex" />
              ) : null}
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">Six-digit hex like #d946ef — drives rails, strips, rules and monograms.</p>
          </Section>

          {/* logo */}
          <Section label="Logo" icon={ImagePlus} open={sections.logo} onToggle={() => setSections((s) => ({ ...s, logo: !s.logo }))}>
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onLogoFile(e)} />
            {draft.logo ? (
              <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                <img src={draft.logo} alt="Card logo preview" className="size-11 rounded-lg border border-white/10 object-contain" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-zinc-300">Logo added</p>
                  <p className="text-[11px] text-zinc-500">Downscaled to fit 256 px</p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setDraft((d) => ({ ...d, logo: undefined }))}
                  className="h-11 border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  Remove
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.03] text-sm font-medium text-zinc-300 hover:border-fuchsia-400/40 hover:text-white"
              >
                <ImagePlus className="size-4" aria-hidden />
                Upload logo (PNG / JPG / SVG)
              </button>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
              Optional. Shown in place of the initials monogram; resized to 256 px and stored locally with the card.
            </p>
          </Section>

          {loaded && cards.length === 0 && !dirty && (
            <p className="px-1 text-[11px] text-zinc-500">Tip — use Save as new to keep multiple card variants.</p>
          )}
        </section>
      </div>

      {/* ---------- delete confirm dialog ---------- */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm rounded-2xl border-white/10 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle>Delete “{activeDoc?.name ?? 'this card'}”?</DialogTitle>
            <DialogDescription className="text-zinc-400">
              This removes the saved card from this device. Your current edits stay on screen.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} className="h-11 flex-1 border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/10 hover:text-white">
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteCard} className="h-11 flex-1">
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
