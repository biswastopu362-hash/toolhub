'use client'

/**
 * Invoice Generator — get paid, look sharp.
 *
 * Build branded invoices with line items, discount/tax math, an optional logo
 * and six accent identities. Every invoice renders on a live white A4 paper
 * preview and exports to a vector PDF (jsPDF) or JSON. Everything persists in
 * IndexedDB — private, offline, instant.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Check,
  Copy,
  FileDown,
  FileJson2,
  FileUp,
  ImagePlus,
  Percent,
  PencilLine,
  Plus,
  Receipt,
  ReceiptText,
  RefreshCw,
  Sparkles,
  StickyNote,
  Trash2,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { jsPDF } from 'jspdf'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type InvoiceStatus = 'draft' | 'sent' | 'paid'

interface InvItem {
  id: string
  desc: string
  qty: number
  price: number
}

interface Discount {
  mode: 'pct' | 'flat'
  value: number
}

interface Invoice {
  id: string
  number: string
  status: InvoiceStatus
  accent: string
  currency: string
  /** dataURL (downscaled ≤256px PNG) or null */
  logo: string | null
  issue: string
  due: string
  from: { name: string; address: string; contact: string }
  to: { name: string; address: string; email: string }
  items: InvItem[]
  discount: Discount
  taxPct: number
  taxLabel: string
  notes: string
  createdAt: number
  updatedAt: number
}

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const ACCENTS: { id: string; name: string; hex: string }[] = [
  { id: 'emerald', name: 'Emerald', hex: '#10b981' },
  { id: 'teal', name: 'Teal', hex: '#14b8a6' },
  { id: 'lime', name: 'Lime', hex: '#84cc16' },
  { id: 'amber', name: 'Amber', hex: '#f59e0b' },
  { id: 'rose', name: 'Rose', hex: '#f43f5e' },
  { id: 'violet', name: 'Violet', hex: '#8b5cf6' },
]

const CURRENCIES = ['৳', '$', '€', '£', '₹', '¥']

/** Intl currency code per symbol; falls back to a raw symbol prefix. */
const CURRENCY_CODES: Record<string, string> = {
  '৳': 'BDT',
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY',
}

/**
 * PDF-safe replacements. jsPDF standard fonts use WinAnsi, which has €, £, ¥
 * but not ৳ / ₹ — those swap to their code / abbreviation prefix.
 */
const PDF_SYMBOL: Record<string, string> = {
  '৳': 'BDT ',
  '₹': 'Rs ',
  '$': '$',
  '€': '\u20AC',
  '£': '\u00A3',
  '¥': '\u00A5',
}

const STATUS_META: Record<InvoiceStatus, { label: string; chip: string; dot: string }> = {
  draft: { label: 'Draft', chip: 'border-white/15 bg-white/10 text-zinc-300', dot: 'bg-zinc-400' },
  sent: { label: 'Sent', chip: 'border-amber-400/30 bg-amber-400/15 text-amber-300', dot: 'bg-amber-400' },
  paid: { label: 'Paid', chip: 'border-emerald-400/30 bg-emerald-400/15 text-emerald-300', dot: 'bg-emerald-400' },
}

const STATUS_ORDER: InvoiceStatus[] = ['draft', 'sent', 'paid']

/** Thin glass scrollbar for long lists. */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

const INPUT =
  'h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-lime-400/50 focus:outline-none [color-scheme:dark]'

const AREA =
  'w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-500 focus:border-lime-400/50 focus:outline-none [color-scheme:dark] resize-none'

/** Fixed paper design width (px); height follows the 210/297 A4 ratio. */
const PAPER_W = 620
const PAPER_H = (PAPER_W * 297) / 210

/* ================================================================== */
/* Small helpers                                                       */
/* ================================================================== */

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function haptic(pattern: number | number[] = 12) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/** Local-timezone 'YYYY-MM-DD'. */
function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function todayISO(): string {
  return isoDay(new Date())
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(y, m - 1, d + days)
  return isoDay(dt)
}

/** '2026-03-08' → 'Mar 8, 2026' (timezone-safe manual parse). */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso || '—'
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Intl currency formatting with a symbol-prefix fallback for odd codes. */
function fmtMoney(n: number, symbol: string): string {
  const code = CURRENCY_CODES[symbol]
  if (code) {
    try {
      const s = new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(n)
      return s.includes(code) ? s.replace(code, symbol) : s
    } catch {
      /* fall through to the plain prefix */
    }
  }
  return `${symbol}${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** fmtMoney with WinAnsi-safe symbol for jsPDF standard fonts. */
function pdfMoney(n: number, symbol: string): string {
  const s = fmtMoney(n, symbol)
  const safe = PDF_SYMBOL[symbol]
  return safe ? s.replace(symbol, safe) : s
}

function fmtQty(qty: number): string {
  return qty.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const n = m ? parseInt(m[1], 16) : 0x10b981
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** rgba() string for CSS previews. */
function withAlpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

/** Mix toward white by t (0..1) — used for PDF row fills. */
function tintWhite(c: RGB, t: number): RGB {
  return [Math.round(c[0] + (255 - c[0]) * t), Math.round(c[1] + (255 - c[1]) * t), Math.round(c[2] + (255 - c[2]) * t)]
}

/** Darken by f (0..1) — used for PDF rules. */
function shade(c: RGB, f: number): RGB {
  return [Math.round(c[0] * (1 - f)), Math.round(c[1] * (1 - f)), Math.round(c[2] * (1 - f))]
}

function accentHexOf(id: string): string {
  return ACCENTS.find((a) => a.id === id)?.hex ?? ACCENTS[0].hex
}

function sanitizeFilename(s: string): string {
  const clean = s
    .trim()
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return clean || 'invoice'
}

function downloadBlob(data: BlobPart, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Downscale a picked image to ≤256px and return a PNG dataURL (no uploads). */
async function fileToLogoDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.onerror = () => reject(new Error('Not a readable image'))
      im.src = url
    })
    const scale = Math.min(1, 256 / Math.max(img.width || 1, img.height || 1))
    const w = Math.max(1, Math.round((img.width || 1) * scale))
    const h = Math.max(1, Math.round((img.height || 1) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(img, 0, 0, w, h)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/* ================================================================== */
/* Money math                                                          */
/* ================================================================== */

function computeTotals(inv: Invoice) {
  const subtotal = inv.items.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0)
  const raw =
    inv.discount.mode === 'pct' ? (subtotal * clamp(inv.discount.value || 0, 0, 100)) / 100 : inv.discount.value || 0
  const discount = clamp(raw, 0, subtotal)
  const taxable = subtotal - discount
  const tax = (taxable * clamp(inv.taxPct || 0, 0, 100)) / 100
  return { subtotal, discount, tax, total: taxable + tax }
}

/* ================================================================== */
/* IndexedDB — 'toolhub-invoices' v1, store 'invoices', keyPath 'id'   */
/* ================================================================== */

const DB_NAME = 'toolhub-invoices'
const DB_VERSION = 1
const STORE = 'invoices'

let dbPromise: Promise<IDBDatabase> | null = null

function openInvoiceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openInvoiceDb()
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
/* Invoice factory / coercion                                          */
/* ================================================================== */

function nextInvoiceNumber(invoices: Invoice[]): string {
  let max = 0
  for (const inv of invoices) {
    const m = /^INV-(\d+)$/i.exec(inv.number.trim())
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0)
  }
  return `INV-${String(max + 1).padStart(4, '0')}`
}

function blankItem(): InvItem {
  return { id: uid('it'), desc: '', qty: 1, price: 0 }
}

/** New invoice pre-filled with the "business card" of the most recent one. */
function newInvoice(invoices: Invoice[]): Invoice {
  const last = [...invoices].sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const now = Date.now()
  const today = todayISO()
  return {
    id: uid('inv'),
    number: nextInvoiceNumber(invoices),
    status: 'draft',
    accent: 'emerald',
    currency: last?.currency ?? '৳',
    logo: last?.logo ?? null,
    issue: today,
    due: addDaysISO(today, 14),
    from: last ? { ...last.from } : { name: '', address: '', contact: '' },
    to: { name: '', address: '', email: '' },
    items: [blankItem()],
    discount: { mode: 'pct', value: 0 },
    taxPct: last?.taxPct ?? 0,
    taxLabel: last?.taxLabel ?? 'VAT',
    notes: '',
    createdAt: now,
    updatedAt: now,
  }
}

function coerceInvoice(raw: unknown, fallbackNumber: string): Invoice | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (v: unknown, cap = 400): string => (typeof v === 'string' ? v.slice(0, cap) : '')
  const num = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})
  const items: InvItem[] = (Array.isArray(r.items) ? r.items : [])
    .slice(0, 200)
    .map((it) => {
      const o = obj(it)
      return { id: str(o.id, 40) || uid('it'), desc: str(o.desc, 300), qty: num(o.qty), price: num(o.price) }
    })
  const disc = obj(r.discount)
  const status = STATUS_ORDER.includes(r.status as InvoiceStatus) ? (r.status as InvoiceStatus) : 'draft'
  const accent = ACCENTS.some((a) => a.id === r.accent) ? (r.accent as string) : 'emerald'
  const currency = CURRENCIES.includes(r.currency as string) ? (r.currency as string) : '৳'
  const logo = typeof r.logo === 'string' && r.logo.startsWith('data:image/') && r.logo.length < 900_000 ? r.logo : null
  const now = Date.now()
  return {
    id: str(r.id, 40) || uid('inv'),
    number: str(r.number, 40) || fallbackNumber,
    status,
    accent,
    currency,
    logo,
    issue: str(r.issue, 10) || todayISO(),
    due: str(r.due, 10) || addDaysISO(todayISO(), 14),
    from: {
      name: str(obj(r.from).name, 120),
      address: str(obj(r.from).address, 400),
      contact: str(obj(r.from).contact, 160),
    },
    to: {
      name: str(obj(r.to).name, 120),
      address: str(obj(r.to).address, 400),
      email: str(obj(r.to).email, 160),
    },
    items: items.length > 0 ? items : [blankItem()],
    discount: { mode: disc.mode === 'flat' ? 'flat' : 'pct', value: num(disc.value) },
    taxPct: clamp(num(r.taxPct), 0, 100),
    taxLabel: str(r.taxLabel, 24) || 'VAT',
    notes: str(r.notes, 2000),
    createdAt: typeof r.createdAt === 'number' && r.createdAt > 0 ? r.createdAt : now,
    updatedAt: typeof r.updatedAt === 'number' && r.updatedAt > 0 ? r.updatedAt : now,
  }
}

/* ================================================================== */
/* PDF export — jsPDF portrait A4, vector primitives                   */
/* ================================================================== */

function buildInvoicePdf(inv: Invoice): jsPDF {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 40
  const accent = accentHexOf(inv.accent)
  const [ar, ag, ab] = hexToRgb(accent)
  const [dr, dg, db_] = hexToRgb('#1e293b') // slate-800 body text
  const [gr, gg, gb] = hexToRgb('#64748b') // slate-500 secondary
  const totals = computeTotals(inv)
  const money = (n: number) => pdfMoney(n, inv.currency)
  const clientName = inv.to.name.trim() || 'Client'

  /* ---- accent header band ---- */
  doc.setFillColor(ar, ag, ab)
  doc.rect(0, 0, W, 96, 'F')
  const [sr, sg, sb] = shade([ar, ag, ab], 0.72)
  doc.setDrawColor(sr, sg, sb)
  doc.setLineWidth(2)
  doc.line(0, 96, W, 96)

  let textX = M
  if (inv.logo) {
    doc.setFillColor(255, 255, 255)
    doc.roundedRect(M, 24, 48, 48, 8, 8, 'F')
    try {
      doc.addImage(inv.logo, 'PNG', M + 6, 30, 36, 36)
    } catch {
      /* unreadable logo — keep the tile, skip the image */
    }
    textX = M + 62
  }
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(inv.from.name.trim() || 'Your business', textX, 44)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(245, 245, 245)
  const senderLines = [inv.from.address.trim(), inv.from.contact.trim()].filter(Boolean).flatMap((l) =>
    (doc.splitTextToSize(l, 250) as string[]).slice(0, 2)
  )
  senderLines.slice(0, 4).forEach((l, i) => doc.text(l, textX, 58 + i * 10.5))

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(21)
  doc.setTextColor(255, 255, 255)
  doc.text('INVOICE', W - M, 44, { align: 'right' })
  doc.setFontSize(10.5)
  doc.text(inv.number.trim() || '—', W - M, 61, { align: 'right' })
  doc.setFontSize(7.5)
  doc.text(STATUS_META[inv.status].label.toUpperCase(), W - M, 76, { align: 'right', charSpace: 1.6 })

  /* ---- PAID stamp ---- */
  if (inv.status === 'paid') {
    doc.setTextColor(ar, ag, ab)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.text('PAID', W - 62, 140, { align: 'right', angle: 12, charSpace: 2 })
  }

  /* ---- from / bill to / dates ---- */
  const colY = 126
  const drawParty = (x: number, w: number, label: string, name: string, lines: string[]) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(ar, ag, ab)
    doc.text(label, x, colY)
    doc.setTextColor(dr, dg, db_)
    doc.setFontSize(10.5)
    doc.text(name || '—', x, colY + 15)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(gr, gg, gb)
    let yy = colY + 28
    for (const l of lines) {
      if (!l) continue
      for (const seg of (doc.splitTextToSize(l, w) as string[]).slice(0, 4)) {
        doc.text(seg, x, yy)
        yy += 10.5
      }
    }
    return yy
  }
  const yFrom = drawParty(M, 230, 'FROM', inv.from.name.trim(), [inv.from.address.trim(), inv.from.contact.trim()])
  const yTo = drawParty(250, 190, 'BILL TO', inv.to.name.trim(), [inv.to.address.trim(), inv.to.email.trim()])

  const dx = W - 140
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(ar, ag, ab)
  doc.text('INVOICE DETAILS', dx, colY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  let dy = colY + 18
  for (const [k, v] of [
    ['Issue date', fmtDate(inv.issue)],
    ['Due date', fmtDate(inv.due)],
  ] as const) {
    doc.setTextColor(gr, gg, gb)
    doc.text(k, dx, dy)
    doc.setTextColor(dr, dg, db_)
    doc.text(v, W - M, dy, { align: 'right' })
    dy += 15
  }

  /* ---- items table ---- */
  const cols = { qtyRight: 350, unitRight: 460, amtRight: W - M - 6 }
  const drawTableHeader = (y: number): number => {
    doc.setFillColor(ar, ag, ab)
    doc.rect(M, y, W - 2 * M, 22, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(255, 255, 255)
    doc.text('DESCRIPTION', M + 6, y + 14)
    doc.text('QTY', cols.qtyRight, y + 14, { align: 'right' })
    doc.text('UNIT PRICE', cols.unitRight, y + 14, { align: 'right' })
    doc.text('AMOUNT', cols.amtRight, y + 14, { align: 'right' })
    return y + 22
  }

  let y = Math.max(yFrom, yTo, dy) + 20
  y = drawTableHeader(y)
  const [tr, tg, tb] = tintWhite([ar, ag, ab], 0.94)
  inv.items.forEach((it, i) => {
    const lines = (doc.splitTextToSize(it.desc.trim() || '—', 280) as string[]).slice(0, 4)
    const rowH = Math.max(26, lines.length * 11 + 13)
    if (y + rowH > H - 60) {
      doc.addPage()
      y = drawTableHeader(M + 8)
    }
    if (i % 2 === 1) {
      doc.setFillColor(tr, tg, tb)
      doc.rect(M, y, W - 2 * M, rowH, 'F')
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(dr, dg, db_)
    lines.forEach((l, li) => doc.text(l, M + 6, y + 15 + li * 11))
    doc.setTextColor(gr, gg, gb)
    doc.text(fmtQty(it.qty || 0), cols.qtyRight, y + 15, { align: 'right' })
    doc.text(money(it.price || 0), cols.unitRight, y + 15, { align: 'right' })
    doc.setTextColor(dr, dg, db_)
    doc.text(money((Number(it.qty) || 0) * (Number(it.price) || 0)), cols.amtRight, y + 15, { align: 'right' })
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.6)
    doc.line(M, y + rowH, W - M, y + rowH)
    y += rowH
  })

  /* ---- totals (right-aligned block) ---- */
  if (y > H - 190) {
    doc.addPage()
    y = M + 10
  }
  y += 16
  const labelX = W - 215
  const row = (label: string, value: string, bold = false, color?: RGB) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(bold ? 11.5 : 9)
    if (color) doc.setTextColor(...color)
    else doc.setTextColor(gr, gg, gb)
    doc.text(label, labelX, y)
    doc.setTextColor(...(color ?? [dr, dg, db_]))
    doc.setFontSize(bold ? 12.5 : 9.5)
    doc.text(value, W - M, y, { align: 'right' })
    y += bold ? 20 : 15
  }
  row('Subtotal', money(totals.subtotal))
  if (totals.discount > 0) {
    row(inv.discount.mode === 'pct' ? `Discount (${clamp(inv.discount.value, 0, 100)}%)` : 'Discount', `-${money(totals.discount)}`)
  }
  row(`${inv.taxLabel.trim() || 'Tax'}${inv.taxPct > 0 ? ` (${clamp(inv.taxPct, 0, 100)}%)` : ''}`, money(totals.tax))
  doc.setDrawColor(203, 213, 225)
  doc.setLineWidth(0.8)
  doc.line(labelX, y - 9, W - M, y - 9)
  y += 6
  row('TOTAL', money(totals.total), true, [ar, ag, ab])

  /* ---- notes ---- */
  if (inv.notes.trim()) {
    y += 10
    if (y > H - 60) {
      doc.addPage()
      y = M + 10
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(ar, ag, ab)
    doc.text('NOTES / TERMS', M, y)
    y += 13
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(gr, gg, gb)
    for (const l of (doc.splitTextToSize(inv.notes.trim(), W - 2 * M) as string[]).slice(0, 8)) {
      if (y > H - 24) {
        doc.addPage()
        y = M + 14
      }
      doc.text(l, M, y)
      y += 11.5
    }
  }

  /* ---- footer on every page ---- */
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(148, 163, 184)
    doc.text(`${inv.number.trim() || 'Invoice'}  ·  Page ${p} of ${pages}`, W / 2, H - 16, { align: 'center' })
  }
  return doc
}

/* ================================================================== */
/* Shared UI atoms                                                     */
/* ================================================================== */

function Section({ icon: Icon, title, aside, children }: { icon: LucideIcon; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-lime-400/10 text-lime-300">
          <Icon className="size-4" aria-hidden />
        </span>
        <h3 className="flex-1 text-[13px] font-bold tracking-tight text-zinc-100">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
      {hint ? <span className="font-normal normal-case tracking-normal text-zinc-600"> {hint}</span> : null}
    </p>
  )
}

/** Numeric input that keeps an editing draft so "12." doesn't snap to "12". */
function NumInput({
  value,
  onChange,
  prefix,
  placeholder,
  ariaLabel,
  className,
}: {
  value: number
  onChange: (n: number) => void
  prefix?: string
  placeholder?: string
  ariaLabel: string
  className?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <div
      className={cn(
        'flex h-11 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 transition-colors focus-within:border-lime-400/50',
        className
      )}
    >
      {prefix ? <span className="text-xs text-zinc-500">{prefix}</span> : null}
      <input
        value={draft ?? (value ? String(value) : '')}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, '')
          setDraft(v)
          const n = parseFloat(v)
          onChange(Number.isNaN(n) ? 0 : n)
        }}
        onBlur={() => setDraft(null)}
        inputMode="decimal"
        placeholder={placeholder ?? '0'}
        aria-label={ariaLabel}
        className="h-full w-full bg-transparent text-sm font-semibold tabular-nums text-zinc-100 placeholder:font-normal placeholder:text-zinc-600 focus:outline-none"
      />
    </div>
  )
}

function StatusChip({ status, className }: { status: InvoiceStatus; className?: string }) {
  const meta = STATUS_META[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
        meta.chip,
        className
      )}
    >
      <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  )
}

/* ================================================================== */
/* Paper preview (fixed 620px design, scaled to fit)                   */
/* ================================================================== */

function InvoicePaper({ inv }: { inv: Invoice }) {
  const accent = accentHexOf(inv.accent)
  const totals = computeTotals(inv)
  const money = (n: number) => fmtMoney(n, inv.currency)
  const sender = inv.from

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-white font-sans text-zinc-900">
      {/* accent header strip */}
      <div className="flex items-center gap-4 px-8 pb-6 pt-8" style={{ background: accent }}>
        {inv.logo ? (
          <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1 shadow-sm">
            { }
            <img src={inv.logo} alt="Business logo" className="size-full object-contain" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-extrabold leading-tight text-white">
            {sender.name.trim() || 'Your business'}
          </p>
          <p className="mt-0.5 truncate text-[9px] leading-snug text-white/80">
            {[sender.address.trim().split('\n')[0], sender.contact.trim()].filter(Boolean).join('  ·  ') || 'Add your details'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[19px] font-black uppercase leading-none tracking-[0.22em] text-white">Invoice</p>
          <p className="mt-1 text-[10px] font-semibold tabular-nums text-white/90">{inv.number.trim() || '—'}</p>
        </div>
      </div>

      {/* paid corner stamp */}
      {inv.status === 'paid' ? (
        <div
          className="absolute right-6 top-[108px] -rotate-[9deg] rounded-md border-[2.5px] px-3 py-0.5 text-[15px] font-black tracking-[0.25em]"
          style={{ borderColor: accent, color: accent, opacity: 0.85 }}
        >
          PAID
        </div>
      ) : null}

      <div className="flex flex-1 flex-col px-8 pb-7 pt-5">
        {/* from / to */}
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
              From
            </p>
            <p className="mt-1.5 truncate text-[12px] font-bold text-zinc-900">{sender.name.trim() || '—'}</p>
            <p className="mt-0.5 whitespace-pre-line text-[9px] leading-[1.5] text-zinc-500">
              {sender.address.trim() || '—'}
            </p>
            <p className="mt-0.5 text-[9px] leading-[1.5] text-zinc-500">{sender.contact.trim()}</p>
          </div>
          <div>
            <p className="text-[8px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
              Bill to
            </p>
            <p className="mt-1.5 truncate text-[12px] font-bold text-zinc-900">{inv.to.name.trim() || '—'}</p>
            <p className="mt-0.5 whitespace-pre-line text-[9px] leading-[1.5] text-zinc-500">
              {inv.to.address.trim() || '—'}
            </p>
            <p className="mt-0.5 text-[9px] leading-[1.5] text-zinc-500">{inv.to.email.trim()}</p>
          </div>
        </div>

        {/* dates */}
        <div className="mt-4 flex gap-8">
          {(
            [
              ['Issue date', fmtDate(inv.issue)],
              ['Due date', fmtDate(inv.due)],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <p className="text-[7.5px] font-bold uppercase tracking-[0.16em] text-zinc-400">{k}</p>
              <p className="mt-0.5 text-[10px] font-semibold tabular-nums text-zinc-800">{v}</p>
            </div>
          ))}
        </div>

        {/* items table (borders via divs) */}
        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200">
          <div
            className="grid grid-cols-[minmax(0,1fr)_46px_84px_92px] items-center gap-2 px-3 py-2 text-[8px] font-bold uppercase tracking-[0.14em]"
            style={{ background: withAlpha(accent, 0.12), color: accent }}
          >
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit price</span>
            <span className="text-right">Amount</span>
          </div>
          {inv.items.length === 0 ? (
            <div className="border-t border-zinc-100 px-3 py-3.5 text-center text-[9px] text-zinc-400">
              No line items yet
            </div>
          ) : (
            inv.items.map((it, i) => (
              <div
                key={it.id}
                className={cn('grid grid-cols-[minmax(0,1fr)_46px_84px_92px] items-center gap-2 border-t border-zinc-100 px-3 py-[7px] text-[10px]')}
                style={i % 2 === 1 ? { background: withAlpha(accent, 0.05) } : undefined}
              >
                <span className="truncate text-zinc-800">{it.desc.trim() || '—'}</span>
                <span className="text-right tabular-nums text-zinc-600">{fmtQty(it.qty || 0)}</span>
                <span className="text-right tabular-nums text-zinc-600">{money(it.price || 0)}</span>
                <span className="text-right font-semibold tabular-nums text-zinc-900">
                  {money((Number(it.qty) || 0) * (Number(it.price) || 0))}
                </span>
              </div>
            ))
          )}
        </div>

        {/* totals */}
        <div className="ml-auto mt-4 w-[58%] space-y-[5px] text-[10px]">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Subtotal</span>
            <span className="font-medium tabular-nums text-zinc-800">{money(totals.subtotal)}</span>
          </div>
          {totals.discount > 0 ? (
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">
                Discount{inv.discount.mode === 'pct' ? ` (${clamp(inv.discount.value, 0, 100)}%)` : ''}
              </span>
              <span className="font-medium tabular-nums text-zinc-800">−{money(totals.discount)}</span>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">
              {inv.taxLabel.trim() || 'Tax'}
              {inv.taxPct > 0 ? ` (${clamp(inv.taxPct, 0, 100)}%)` : ''}
            </span>
            <span className="font-medium tabular-nums text-zinc-800">{money(totals.tax)}</span>
          </div>
          <div
            className="mt-1.5 flex items-center justify-between rounded-lg px-3 py-2 text-[12.5px] font-extrabold text-white"
            style={{ background: accent }}
          >
            <span className="uppercase tracking-[0.14em]">Total</span>
            <span className="tabular-nums">{money(totals.total)}</span>
          </div>
        </div>

        {/* notes */}
        {inv.notes.trim() ? (
          <div className="mt-5">
            <p className="text-[8px] font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>
              Notes / Terms
            </p>
            <p className="mt-1 whitespace-pre-line text-[9px] leading-[1.55] text-zinc-500">{inv.notes.trim()}</p>
          </div>
        ) : null}

        <p className="mt-auto pt-4 text-center text-[8px] uppercase tracking-[0.2em] text-zinc-300">
          Thank you for your business
        </p>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Main component                                                      */
/* ================================================================== */

export default function InvoiceGeneratorApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameNumber, setRenameNumber] = useState('')
  const [renameClient, setRenameClient] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  /* paper preview scaling */
  const paperBoxRef = useRef<HTMLDivElement>(null)
  const [paperScale, setPaperScale] = useState(0.6)

  /* hidden file inputs */
  const logoInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  /* delete-confirm auto reset */
  const confirmTimer = useRef<number | null>(null)

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const all = await idbGetAll<Invoice>(STORE)
        if (!alive) return
        setInvoices(all.filter((v) => v && typeof v.id === 'string'))
      } catch {
        /* private mode / quota — keep in-memory data */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- paper ResizeObserver ---------------- */
  useEffect(() => {
    const el = paperBoxRef.current
    if (!el || view !== 'editor') return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      if (w > 0) setPaperScale(w / PAPER_W)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [view, editingId])

  /* confirm-delete timer cleanup */
  useEffect(() => {
    if (!confirmDeleteId) return
    confirmTimer.current = window.setTimeout(() => setConfirmDeleteId(null), 2600)
    return () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current)
    }
  }, [confirmDeleteId])

  /* ---------------- derived ---------------- */
  const sorted = useMemo(() => [...invoices].sort((a, b) => b.updatedAt - a.updatedAt), [invoices])
  const counts = useMemo(() => {
    let outstanding = 0
    let paid = 0
    for (const v of invoices) {
      if (v.status === 'paid') paid++
      else outstanding++
    }
    return { total: invoices.length, outstanding, paid }
  }, [invoices])

  const draft = useMemo(() => invoices.find((v) => v.id === editingId) ?? null, [invoices, editingId])

  /* ---------------- mutations (write-through) ---------------- */
  function updateInvoice(id: string, patch: Partial<Invoice>) {
    const cur = invoices.find((v) => v.id === id)
    if (!cur) return
    const merged: Invoice = { ...cur, ...patch, updatedAt: Date.now() }
    setInvoices((prev) => prev.map((v) => (v.id === id ? merged : v)))
    void idbPut(STORE, merged).catch(() => {
      /* memory-only fallback */
    })
  }

  function patchDraft(patch: Partial<Invoice>) {
    if (draft) updateInvoice(draft.id, patch)
  }

  function createInvoice() {
    const inv = newInvoice(invoices)
    setInvoices((prev) => [inv, ...prev])
    void idbPut(STORE, inv).catch(() => {})
    setEditingId(inv.id)
    setView('editor')
    haptic()
    toast({ title: `Invoice ${inv.number} created`, description: 'Fill in the details — the preview updates live.' })
  }

  function loadSample() {
    const today = todayISO()
    const inv = coerceInvoice(
      {
        number: nextInvoiceNumber(invoices),
        status: 'sent',
        accent: 'emerald',
        currency: '৳',
        issue: today,
        due: addDaysISO(today, 14),
        from: {
          name: 'Lumen Studio',
          address: 'House 42, Road 11, Banani\nDhaka 1213, Bangladesh',
          contact: 'hello@lumen.studio · +880 1712 000 000',
        },
        to: {
          name: 'Nexa Café',
          address: '75 Gulshan Avenue, Dhaka 1212',
          email: 'accounts@nexacafe.com',
        },
        items: [
          { desc: 'Brand discovery workshop', qty: 1, price: 12000 },
          { desc: 'Logo & identity suite', qty: 1, price: 18000 },
          { desc: 'Menu design — print', qty: 2, price: 4500 },
          { desc: 'Social kit (12 templates)', qty: 1, price: 9000 },
        ],
        discount: { mode: 'pct', value: 5 },
        taxPct: 15,
        taxLabel: 'VAT',
        notes:
          'Payment via bank transfer or bKash within 14 days.\nInclude the invoice number as the payment reference. Thank you!',
      },
      nextInvoiceNumber(invoices)
    )
    if (!inv) return
    inv.id = uid('inv')
    inv.createdAt = Date.now()
    inv.updatedAt = Date.now()
    setInvoices((prev) => [inv, ...prev])
    void idbPut(STORE, inv).catch(() => {})
    setEditingId(inv.id)
    setView('editor')
    haptic()
    toast({ title: 'Sample invoice loaded', description: 'Try Export PDF — or tap the status chip to mark it Paid.' })
  }

  function duplicateInvoice(src: Invoice) {
    const copy: Invoice = {
      ...src,
      id: uid('inv'),
      number: nextInvoiceNumber(invoices),
      status: 'draft',
      items: src.items.map((it) => ({ ...it, id: uid('it') })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    setInvoices((prev) => [copy, ...prev])
    void idbPut(STORE, copy).catch(() => {})
    haptic()
    toast({ title: `Duplicated as ${copy.number}`, description: `${src.to.name.trim() || 'Untitled'} copy is ready to edit.` })
  }

  function deleteInvoice(id: string) {
    const victim = invoices.find((v) => v.id === id)
    setInvoices((prev) => prev.filter((v) => v.id !== id))
    setConfirmDeleteId(null)
    void idbDelete(STORE, id).catch(() => {})
    haptic(18)
    toast({ title: 'Invoice deleted', description: victim?.number ? `${victim.number} was removed.` : undefined })
  }

  function cycleStatus(inv: Invoice) {
    const next = STATUS_ORDER[(STATUS_ORDER.indexOf(inv.status) + 1) % STATUS_ORDER.length]
    updateInvoice(inv.id, { status: next })
    haptic()
    if (next === 'paid') toast({ title: 'Marked as Paid', description: `${fmtMoney(computeTotals(inv).total, inv.currency)} received. 🎉` })
  }

  function submitRename() {
    if (!renameId) return
    const cur = invoices.find((v) => v.id === renameId)
    if (!cur) return
    const number = renameNumber.trim() || cur.number
    const to = { ...cur.to, name: renameClient.trim() }
    updateInvoice(renameId, { number, to })
    setRenameId(null)
    haptic()
    toast({ title: 'Invoice renamed', description: `${number} · ${to.name.trim() || 'Untitled client'}` })
  }

  function openRename(inv: Invoice) {
    setRenameId(inv.id)
    setRenameNumber(inv.number)
    setRenameClient(inv.to.name)
  }

  /* ---------------- logo ---------------- */
  async function applyLogo(file: File) {
    if (!draft) return
    if (!file.type.startsWith('image/')) {
      toast({ title: 'Images only', description: 'Pick a PNG, JPG or WebP file for the logo.' })
      return
    }
    try {
      const dataUrl = await fileToLogoDataUrl(file)
      patchDraft({ logo: dataUrl })
      haptic()
      toast({ title: 'Logo added', description: 'Scaled to 256px — shown on the paper and in the PDF.' })
    } catch {
      toast({ title: "Couldn't read that image", description: 'Try a different file.' })
    }
  }

  /* ---------------- JSON export / import ---------------- */
  function exportAllJson() {
    const payload = { app: 'toolhub-invoices', version: 1, exportedAt: new Date().toISOString(), invoices }
    downloadBlob(JSON.stringify(payload, null, 2), `toolhub-invoices-${todayISO()}.json`, 'application/json')
    haptic()
    toast({ title: 'JSON exported', description: `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} saved to your downloads.` })
  }

  function exportOneJson(inv: Invoice) {
    const payload = { app: 'toolhub-invoices', version: 1, invoice: inv }
    downloadBlob(JSON.stringify(payload, null, 2), `${sanitizeFilename(`${inv.number}-data`)}.json`, 'application/json')
    haptic()
    toast({ title: 'Invoice JSON exported', description: inv.number })
  }

  async function importJson(file: File) {
    try {
      const text = await file.text()
      const parsed: unknown = JSON.parse(text)
      const rawList: unknown[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { invoices?: unknown[] })?.invoices)
          ? (parsed as { invoices: unknown[] }).invoices
          : [(parsed as { invoice?: unknown })?.invoice ?? parsed]
      const imported = rawList
        .map((raw, i) => coerceInvoice(raw, `INV-${String(invoices.length + i + 1).padStart(4, '0')}`))
        .filter((v): v is Invoice => v !== null)
      if (imported.length === 0) {
        toast({ title: 'Nothing to import', description: 'No invoice data found in that file.' })
        return
      }
      setInvoices((prev) => {
        const map = new Map(prev.map((v) => [v.id, v]))
        for (const inv of imported) map.set(inv.id, inv)
        return [...map.values()]
      })
      for (const inv of imported) void idbPut(STORE, inv).catch(() => {})
      haptic()
      toast({ title: `Imported ${imported.length} invoice${imported.length === 1 ? '' : 's'}`, description: 'Merged with your existing list.' })
    } catch {
      toast({ title: "Couldn't read that file", description: 'Expected a Toolhub invoices JSON export.' })
    }
  }

  /* ---------------- PDF ---------------- */
  function exportPdf(inv: Invoice) {
    try {
      const doc = buildInvoicePdf(inv)
      doc.save(`${sanitizeFilename(`${inv.number}-${inv.to.name}`)}.pdf`)
      haptic(18)
      toast({ title: 'PDF exported', description: `${inv.number} · ${inv.to.name.trim() || 'Client'}.pdf` })
    } catch {
      toast({ title: 'PDF export failed', description: 'Something went wrong while rendering the document.' })
    }
  }

  /* ---------------- item row ops ---------------- */
  function updateItem(itemId: string, patch: Partial<InvItem>) {
    if (!draft) return
    patchDraft({ items: draft.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) })
  }

  function addItem() {
    if (!draft) return
    patchDraft({ items: [...draft.items, blankItem()] })
    haptic()
  }

  function removeItem(itemId: string) {
    if (!draft) return
    patchDraft({ items: draft.items.filter((it) => it.id !== itemId) })
    haptic()
  }

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  const totals = draft ? computeTotals(draft) : null

  return (
    <div className="mx-auto max-w-6xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-lime-400/[0.09] via-transparent to-teal-500/[0.06] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-lime-300 via-emerald-400 to-teal-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(132_204_22/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Receipt className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Invoice Generator</h2>
              <p className="text-xs text-zinc-400">Get paid, look sharp.</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <button
                onClick={exportAllJson}
                disabled={invoices.length === 0}
                aria-label="Export all invoices as JSON"
                title="Export all invoices (JSON)"
                className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
              >
                <FileJson2 className="size-4.5" aria-hidden />
              </button>
              <button
                onClick={() => importInputRef.current?.click()}
                aria-label="Import invoices from JSON"
                title="Import invoices (JSON)"
                className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <FileUp className="size-4.5" aria-hidden />
              </button>
              <button
                onClick={loadSample}
                aria-label="Load sample invoice"
                title="Load sample invoice"
                className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Sparkles className="size-4.5" aria-hidden />
              </button>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={createInvoice}
                className="flex h-10 items-center gap-1.5 rounded-xl bg-gradient-to-r from-lime-300 to-emerald-500 px-4 text-sm font-semibold text-zinc-950 shadow-lg transition-colors hover:from-lime-200 hover:to-emerald-400"
              >
                <Plus className="size-4" aria-hidden /> New
              </motion.button>
            </div>
          </div>
        </div>

        {!loaded ? (
          /* ---------------- Hydrating ---------------- */
          <div className="space-y-3 p-5">
            <div className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-white/[0.05]" />
            ))}
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {view === 'list' || !draft ? (
              /* ==================== LIST ==================== */
              <motion.div
                key="list"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="p-4 sm:p-5"
              >
                {invoices.length === 0 ? (
                  /* ---------- Empty state ---------- */
                  <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-12 text-center">
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-lime-400/10 text-lime-300">
                      <Receipt className="size-7" aria-hidden />
                    </span>
                    <p className="text-sm font-bold text-zinc-200">No invoices yet</p>
                    <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                      Create a branded invoice in seconds — line items, tax, discount, logo and a print-ready PDF.
                    </p>
                    <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                      <Button
                        onClick={createInvoice}
                        className="h-11 rounded-xl bg-gradient-to-r from-lime-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-lime-200 hover:to-emerald-400"
                      >
                        <Plus className="size-4" aria-hidden /> New invoice
                      </Button>
                      <Button
                        onClick={loadSample}
                        variant="outline"
                        className="h-11 rounded-xl border-white/15 bg-white/5 font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
                      >
                        <Sparkles className="size-4" aria-hidden /> Load sample
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* ---------- Stats strip ---------- */}
                    <div className="grid grid-cols-3 gap-2.5">
                      {(
                        [
                          ['Invoices', counts.total],
                          ['Outstanding', counts.outstanding],
                          ['Paid', counts.paid],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 text-center">
                          <p className="text-xl font-extrabold tabular-nums tracking-tight text-zinc-100">{value}</p>
                          <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
                        </div>
                      ))}
                    </div>

                    {/* ---------- Invoice cards ---------- */}
                    <ul className="mt-3 space-y-2.5">
                      <AnimatePresence initial={false}>
                        {sorted.map((inv) => {
                          const t = computeTotals(inv)
                          const accent = accentHexOf(inv.accent)
                          const confirming = confirmDeleteId === inv.id
                          return (
                            <motion.li key={inv.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ type: 'spring', stiffness: 320, damping: 30 }}>
                              <div
                                role="button"
                                tabIndex={0}
                                aria-label={`Open invoice ${inv.number}`}
                                onClick={() => {
                                  setEditingId(inv.id)
                                  setView('editor')
                                  haptic()
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    setEditingId(inv.id)
                                    setView('editor')
                                  }
                                }}
                                className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 transition-colors hover:bg-white/[0.07]"
                              >
                                <span className="w-1.5 shrink-0 self-stretch rounded-full" style={{ background: accent }} aria-hidden />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="truncate text-sm font-bold tabular-nums tracking-tight text-zinc-100">{inv.number}</p>
                                    <StatusChip status={inv.status} />
                                  </div>
                                  <p className="mt-0.5 truncate text-xs text-zinc-400">
                                    {inv.to.name.trim() || 'No client'} · issued {fmtDate(inv.issue)}
                                  </p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-sm font-extrabold tabular-nums text-zinc-100">{fmtMoney(t.total, inv.currency)}</p>
                                  <p className="text-[10px] text-zinc-500">{inv.items.length} item{inv.items.length === 1 ? '' : 's'}</p>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      cycleStatus(inv)
                                    }}
                                    aria-label={`Cycle status of ${inv.number} (currently ${STATUS_META[inv.status].label})`}
                                    title="Tap to cycle status"
                                    className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                                  >
                                    <RefreshCw className="size-4" aria-hidden />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openRename(inv)
                                    }}
                                    aria-label={`Rename ${inv.number}`}
                                    title="Rename"
                                    className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                                  >
                                    <PencilLine className="size-4" aria-hidden />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      duplicateInvoice(inv)
                                    }}
                                    aria-label={`Duplicate ${inv.number}`}
                                    title="Duplicate"
                                    className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                                  >
                                    <Copy className="size-4" aria-hidden />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      if (confirming) deleteInvoice(inv.id)
                                      else {
                                        setConfirmDeleteId(inv.id)
                                        haptic()
                                      }
                                    }}
                                    aria-label={confirming ? `Confirm delete ${inv.number}` : `Delete ${inv.number}`}
                                    title={confirming ? 'Tap again to delete' : 'Delete'}
                                    className={cn(
                                      'flex h-10 items-center justify-center rounded-xl border text-zinc-400 transition-colors',
                                      confirming
                                        ? 'w-[4.4rem] border-rose-400/40 bg-rose-500/20 text-[10px] font-bold uppercase tracking-wider text-rose-300'
                                        : 'size-10 border-white/10 bg-white/5 hover:bg-rose-500/15 hover:text-rose-300'
                                    )}
                                  >
                                    {confirming ? 'Sure?' : <Trash2 className="size-4" aria-hidden />}
                                  </button>
                                </div>
                              </div>
                            </motion.li>
                          )
                        })}
                      </AnimatePresence>
                    </ul>
                    <p className="mt-3 text-center text-[11px] text-zinc-600">
                      Tap a card to edit · status chip cycles Draft → Sent → Paid
                    </p>
                  </>
                )}
              </motion.div>
            ) : (
              /* ==================== EDITOR ==================== */
              <motion.div
                key={`editor-${draft.id}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              >
                {/* editor action bar */}
                <div className="flex flex-wrap items-center gap-2 border-b border-white/5 px-4 py-3 sm:px-5">
                  <button
                    onClick={() => {
                      setView('list')
                      haptic()
                    }}
                    aria-label="Back to invoice list"
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <ArrowLeft className="size-4.5" aria-hidden />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold tabular-nums tracking-tight">{draft.number}</p>
                    <p className="truncate text-[11px] text-zinc-500">
                      {draft.to.name.trim() || 'No client'} · {STATUS_META[draft.status].label}
                    </p>
                  </div>
                  <button
                    onClick={() => exportOneJson(draft)}
                    aria-label="Export this invoice as JSON"
                    title="Export this invoice (JSON)"
                    className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <FileJson2 className="size-4.5" aria-hidden />
                  </button>
                  <motion.button
                    whileTap={{ scale: 0.96 }}
                    onClick={() => exportPdf(draft)}
                    className="flex h-11 items-center gap-1.5 rounded-xl bg-gradient-to-r from-lime-300 to-emerald-500 px-4 text-sm font-semibold text-zinc-950 shadow-lg transition-colors hover:from-lime-200 hover:to-emerald-400"
                  >
                    <FileDown className="size-4" aria-hidden /> Export PDF
                  </motion.button>
                </div>

                {/* form | preview */}
                <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
                  {/* ---------------- Form column ---------------- */}
                  <div className="min-w-0 space-y-4">
                    {/* ---- Invoice details ---- */}
                    <Section icon={CalendarDays} title="Invoice details">
                      <div className="space-y-3.5">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Number</Label>
                            <input
                              value={draft.number}
                              onChange={(e) => patchDraft({ number: e.target.value.slice(0, 40) })}
                              placeholder="INV-0001"
                              aria-label="Invoice number"
                              className={cn(INPUT, 'tabular-nums')}
                            />
                          </div>
                          <div>
                            <Label hint="days">Due in</Label>
                            <div className="flex h-11 items-center justify-between rounded-xl border border-white/10 bg-white/5 px-2">
                              {[0, 7, 14, 30].map((d) => {
                                const active = draft.due === addDaysISO(draft.issue, d)
                                return (
                                  <motion.button
                                    key={d}
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => patchDraft({ due: addDaysISO(draft.issue, d) })}
                                    aria-label={`Due ${d === 0 ? 'same day' : `in ${d} days`}`}
                                    aria-pressed={active}
                                    className={cn(
                                      'h-8 flex-1 rounded-lg text-[11px] font-bold tabular-nums transition-colors',
                                      active ? 'bg-lime-400/20 text-lime-300' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                                    )}
                                  >
                                    {d === 0 ? '0d' : `${d}d`}
                                  </motion.button>
                                )
                              })}
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>Issue date</Label>
                            <input
                              type="date"
                              value={draft.issue}
                              onChange={(e) => patchDraft({ issue: e.target.value || draft.issue })}
                              aria-label="Issue date"
                              className={INPUT}
                            />
                          </div>
                          <div>
                            <Label>Due date</Label>
                            <input
                              type="date"
                              value={draft.due}
                              onChange={(e) => patchDraft({ due: e.target.value || draft.due })}
                              aria-label="Due date"
                              className={INPUT}
                            />
                          </div>
                        </div>

                        <div>
                          <Label>Currency</Label>
                          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Currency symbol">
                            {CURRENCIES.map((c) => (
                              <motion.button
                                key={c}
                                whileTap={{ scale: 0.92 }}
                                onClick={() => {
                                  patchDraft({ currency: c })
                                  haptic()
                                }}
                                role="radio"
                                aria-checked={draft.currency === c}
                                className={cn(
                                  'flex size-10 items-center justify-center rounded-xl border text-base transition-all',
                                  draft.currency === c
                                    ? 'border-lime-400/60 bg-lime-400/15 text-lime-200 shadow-md'
                                    : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                                )}
                              >
                                {c}
                              </motion.button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <Label>Accent</Label>
                          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Accent color">
                            {ACCENTS.map((a) => (
                              <motion.button
                                key={a.id}
                                whileTap={{ scale: 0.92 }}
                                onClick={() => {
                                  patchDraft({ accent: a.id })
                                  haptic()
                                }}
                                role="radio"
                                aria-checked={draft.accent === a.id}
                                aria-label={a.name}
                                title={a.name}
                                className={cn(
                                  'relative flex size-10 items-center justify-center rounded-xl border transition-all',
                                  draft.accent === a.id ? 'border-white/60 shadow-md' : 'border-white/10 hover:border-white/30'
                                )}
                                style={{ background: withAlpha(a.hex, 0.28) }}
                              >
                                <span className="size-5 rounded-lg" style={{ background: a.hex }} aria-hidden />
                                {draft.accent === a.id ? <Check className="absolute size-3.5 text-white" aria-hidden /> : null}
                              </motion.button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <Label>Status</Label>
                          <div className="flex rounded-xl border border-white/10 bg-white/5 p-1" role="radiogroup" aria-label="Invoice status">
                            {STATUS_ORDER.map((s) => (
                              <button
                                key={s}
                                onClick={() => {
                                  patchDraft({ status: s })
                                  haptic()
                                }}
                                role="radio"
                                aria-checked={draft.status === s}
                                className={cn(
                                  'h-9 flex-1 rounded-lg text-xs font-bold transition-all',
                                  draft.status === s
                                    ? s === 'paid'
                                      ? 'bg-emerald-500 text-zinc-950'
                                      : s === 'sent'
                                        ? 'bg-amber-400 text-zinc-950'
                                        : 'bg-zinc-200 text-zinc-900'
                                    : 'text-zinc-400 hover:bg-white/5'
                                )}
                              >
                                {STATUS_META[s].label}
                              </button>
                            ))}
                          </div>
                          {draft.status === 'paid' ? (
                            <p className="mt-1.5 text-[11px] text-emerald-400/90">A “PAID” stamp is shown on the paper and PDF.</p>
                          ) : null}
                        </div>
                      </div>
                    </Section>

                    {/* ---- Your business ---- */}
                    <Section
                      icon={Building2}
                      title="Your business"
                      aside={
                        <button
                          onClick={() => logoInputRef.current?.click()}
                          aria-label="Upload logo"
                          className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 text-[11px] font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <ImagePlus className="size-3.5" aria-hidden /> Logo
                        </button>
                      }
                    >
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white text-zinc-300">
                            {draft.logo ? (
                               
                              <img src={draft.logo} alt="Logo preview" className="size-full object-contain" />
                            ) : (
                              <Receipt className="size-5" aria-hidden />
                            )}
                          </span>
                          <div className="min-w-0 flex-1 text-[11px] leading-snug text-zinc-500">
                            {draft.logo ? 'Logo attached — downscaled to 256px, stored locally.' : 'Optional. Picked files never leave this device.'}
                          </div>
                          {draft.logo ? (
                            <button
                              onClick={() => patchDraft({ logo: null })}
                              aria-label="Remove logo"
                              className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                            >
                              <X className="size-4" aria-hidden />
                            </button>
                          ) : null}
                        </div>
                        <div>
                          <Label>Business name</Label>
                          <input
                            value={draft.from.name}
                            onChange={(e) => patchDraft({ from: { ...draft.from, name: e.target.value.slice(0, 120) } })}
                            placeholder="Lumen Studio"
                            aria-label="Your business name"
                            className={INPUT}
                          />
                        </div>
                        <div>
                          <Label>Address</Label>
                          <textarea
                            value={draft.from.address}
                            onChange={(e) => patchDraft({ from: { ...draft.from, address: e.target.value.slice(0, 400) } })}
                            placeholder={'House 42, Road 11, Banani\nDhaka 1213'}
                            rows={2}
                            aria-label="Your business address"
                            className={AREA}
                          />
                        </div>
                        <div>
                          <Label hint="optional">Email / phone</Label>
                          <input
                            value={draft.from.contact}
                            onChange={(e) => patchDraft({ from: { ...draft.from, contact: e.target.value.slice(0, 160) } })}
                            placeholder="hello@studio.com · +880 1712 000 000"
                            aria-label="Your email or phone"
                            className={INPUT}
                          />
                        </div>
                      </div>
                    </Section>

                    {/* ---- Client ---- */}
                    <Section icon={UserRound} title="Bill to">
                      <div className="space-y-3">
                        <div>
                          <Label>Client name</Label>
                          <input
                            value={draft.to.name}
                            onChange={(e) => patchDraft({ to: { ...draft.to, name: e.target.value.slice(0, 120) } })}
                            placeholder="Nexa Café"
                            aria-label="Client name"
                            className={INPUT}
                          />
                        </div>
                        <div>
                          <Label>Address</Label>
                          <textarea
                            value={draft.to.address}
                            onChange={(e) => patchDraft({ to: { ...draft.to, address: e.target.value.slice(0, 400) } })}
                            placeholder="75 Gulshan Avenue, Dhaka 1212"
                            rows={2}
                            aria-label="Client address"
                            className={AREA}
                          />
                        </div>
                        <div>
                          <Label hint="optional">Email</Label>
                          <input
                            value={draft.to.email}
                            onChange={(e) => patchDraft({ to: { ...draft.to, email: e.target.value.slice(0, 160) } })}
                            placeholder="accounts@client.com"
                            aria-label="Client email"
                            className={INPUT}
                          />
                        </div>
                      </div>
                    </Section>

                    {/* ---- Line items ---- */}
                    <Section icon={ReceiptText} title="Line items" aside={<span className="text-[11px] tabular-nums text-zinc-500">{draft.items.length}</span>}>
                      <div className={cn('space-y-2.5', draft.items.length > 3 && 'max-h-[420px] overflow-y-auto pr-1', THIN_SCROLLBAR)}>
                        {draft.items.map((it, i) => (
                          <motion.div
                            key={it.id}
                            layout
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="rounded-xl border border-white/10 bg-white/[0.03] p-3"
                          >
                            <div className="flex items-center gap-2">
                              <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-white/5 text-[10px] font-bold tabular-nums text-zinc-500" aria-hidden>
                                {i + 1}
                              </span>
                              <input
                                value={it.desc}
                                onChange={(e) => updateItem(it.id, { desc: e.target.value.slice(0, 300) })}
                                placeholder="Description of work…"
                                aria-label={`Item ${i + 1} description`}
                                className="h-10 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-lime-400/50 focus:outline-none [color-scheme:dark]"
                              />
                              <button
                                onClick={() => removeItem(it.id)}
                                aria-label={`Remove item ${i + 1}`}
                                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </button>
                            </div>
                            <div className="mt-2.5 flex items-center gap-2">
                              <NumInput
                                value={it.qty}
                                onChange={(n) => updateItem(it.id, { qty: n })}
                                ariaLabel={`Item ${i + 1} quantity`}
                                className="w-20 shrink-0"
                              />
                              <span className="shrink-0 text-zinc-600" aria-hidden>×</span>
                              <NumInput
                                value={it.price}
                                onChange={(n) => updateItem(it.id, { price: n })}
                                prefix={draft.currency}
                                ariaLabel={`Item ${i + 1} unit price`}
                                className="min-w-0 flex-1"
                              />
                              <span className="w-24 shrink-0 truncate text-right text-sm font-bold tabular-nums text-zinc-200">
                                {fmtMoney((Number(it.qty) || 0) * (Number(it.price) || 0), draft.currency)}
                              </span>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={addItem}
                        className="mt-2.5 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 text-xs font-semibold text-zinc-400 transition-colors hover:border-lime-400/40 hover:text-lime-300"
                      >
                        <Plus className="size-4" aria-hidden /> Add line item
                      </motion.button>
                    </Section>

                    {/* ---- Discount & tax ---- */}
                    <Section icon={Percent} title="Discount & tax">
                      <div className="space-y-3.5">
                        <div className="grid grid-cols-[auto_1fr] items-end gap-2.5">
                          <div>
                            <Label>Discount type</Label>
                            <div className="flex rounded-xl border border-white/10 bg-white/5 p-1" role="radiogroup" aria-label="Discount type">
                              {(
                                [
                                  { id: 'pct', label: '%' },
                                  { id: 'flat', label: draft.currency },
                                ] as const
                              ).map((m) => (
                                <button
                                  key={m.id}
                                  onClick={() => patchDraft({ discount: { ...draft.discount, mode: m.id } })}
                                  role="radio"
                                  aria-checked={draft.discount.mode === m.id}
                                  className={cn(
                                    'h-9 w-12 rounded-lg text-xs font-bold transition-colors',
                                    draft.discount.mode === m.id ? 'bg-lime-400/20 text-lime-300' : 'text-zinc-500 hover:bg-white/5'
                                  )}
                                >
                                  {m.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <NumInput
                            value={draft.discount.value}
                            onChange={(n) => patchDraft({ discount: { ...draft.discount, value: n } })}
                            prefix={draft.discount.mode === 'pct' ? '%' : draft.currency}
                            ariaLabel="Discount value"
                          />
                        </div>
                        <div className="grid grid-cols-[1fr_auto] items-end gap-2.5">
                          <div>
                            <Label hint="e.g. VAT, GST">Tax name</Label>
                            <input
                              value={draft.taxLabel}
                              onChange={(e) => patchDraft({ taxLabel: e.target.value.slice(0, 24) })}
                              placeholder="VAT"
                              aria-label="Tax label"
                              className={INPUT}
                            />
                          </div>
                          <div className="w-28">
                            <Label>Tax %</Label>
                            <NumInput value={draft.taxPct} onChange={(n) => patchDraft({ taxPct: n })} prefix="%" ariaLabel="Tax percentage" />
                          </div>
                        </div>
                        {totals ? (
                          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 text-xs">
                            <div className="flex items-center justify-between text-zinc-500">
                              <span>Subtotal</span>
                              <span className="tabular-nums">{fmtMoney(totals.subtotal, draft.currency)}</span>
                            </div>
                            {totals.discount > 0 ? (
                              <div className="mt-1 flex items-center justify-between text-zinc-500">
                                <span>Discount</span>
                                <span className="tabular-nums">−{fmtMoney(totals.discount, draft.currency)}</span>
                              </div>
                            ) : null}
                            <div className="mt-1 flex items-center justify-between text-zinc-500">
                              <span>{draft.taxLabel.trim() || 'Tax'}</span>
                              <span className="tabular-nums">{fmtMoney(totals.tax, draft.currency)}</span>
                            </div>
                            <div className="mt-2 flex items-center justify-between border-t border-white/10 pt-2 text-sm font-extrabold text-lime-300">
                              <span>Total</span>
                              <span className="tabular-nums">{fmtMoney(totals.total, draft.currency)}</span>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </Section>

                    {/* ---- Notes ---- */}
                    <Section icon={StickyNote} title="Notes / terms">
                      <textarea
                        value={draft.notes}
                        onChange={(e) => patchDraft({ notes: e.target.value.slice(0, 2000) })}
                        placeholder={'Payment via bank transfer within 14 days.\nInclude the invoice number as reference. Thank you!'}
                        rows={3}
                        aria-label="Invoice notes or terms"
                        className={AREA}
                      />
                    </Section>
                  </div>

                  {/* ---------------- Preview column ---------------- */}
                  <div className="min-w-0 lg:sticky lg:top-6 lg:self-start">
                    <div className="mb-2.5 flex items-center justify-between px-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Live preview</p>
                      <span className="text-[10px] text-zinc-600">A4 · 210 × 297</span>
                    </div>
                    <div
                      ref={paperBoxRef}
                      className="relative mx-auto aspect-[210/297] w-full overflow-hidden rounded-2xl border border-black/20 bg-white shadow-[0_24px_60px_-24px_rgb(0_0_0/0.75)] lg:max-w-[calc((100dvh-8rem)*0.7071)]"
                    >
                      <div
                        className="absolute left-0 top-0 origin-top-left"
                        style={{ width: PAPER_W, height: PAPER_H, transform: `scale(${paperScale})` }}
                      >
                        <InvoicePaper inv={draft} />
                      </div>
                    </div>
                    <p className="mt-2.5 text-center text-[11px] leading-relaxed text-zinc-600">
                      Exactly what the PDF renders — export it from the header.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>

      {/* ---------------- hidden file inputs ---------------- */}
      <input
        ref={logoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void applyLogo(file)
          e.target.value = ''
        }}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void importJson(file)
          e.target.value = ''
        }}
      />

      {/* ---------------- Rename modal ---------------- */}
      <AnimatePresence>
        {renameId ? (
          <motion.div
            key="rename"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setRenameId(null)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Rename invoice"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-lime-400/15 text-lime-300">
                  <PencilLine className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">Rename invoice</h3>
                <button
                  onClick={() => setRenameId(null)}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <div className="space-y-3.5">
                <div>
                  <Label>Invoice number</Label>
                  <input
                    value={renameNumber}
                    onChange={(e) => setRenameNumber(e.target.value.slice(0, 40))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename()
                    }}
                    placeholder="INV-0001"
                    aria-label="Invoice number"
                    className={cn(INPUT, 'tabular-nums')}
                  />
                </div>
                <div>
                  <Label>Client name</Label>
                  <input
                    value={renameClient}
                    onChange={(e) => setRenameClient(e.target.value.slice(0, 120))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRename()
                    }}
                    placeholder="Client name"
                    aria-label="Client name"
                    className={INPUT}
                  />
                </div>
                <Button
                  onClick={submitRename}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-lime-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-lime-200 hover:to-emerald-400"
                >
                  Save changes
                </Button>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
