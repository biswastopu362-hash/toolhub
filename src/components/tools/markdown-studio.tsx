'use client'

/**
 * Markdown Studio — write markdown, ship documents.
 *
 * A focused editor + live preview for multiple markdown documents:
 *  - formatting toolbar that wraps/inserts at the cursor selection
 *  - live react-markdown preview with dark-glass code cards & accent headings
 *  - multiple documents persisted in IndexedDB (write-through) with a 600 ms
 *    debounced autosave and a "Saved · 12:31" indicator
 *  - export: self-contained styled HTML (dark/paper), system print→PDF via a
 *    hidden srcdoc iframe, a guaranteed-offline jsPDF text fallback, and
 *    copy-markdown to the clipboard
 *
 * Everything is on-device. No servers, no uploads, no tracking.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  Bold,
  Check,
  ClipboardCopy,
  Code2,
  Copy,
  Eye,
  FileDown,
  FileText,
  Heading2,
  Italic,
  Link2,
  List,
  Loader2,
  NotebookPen,
  Pencil,
  PenLine,
  Plus,
  Printer,
  Table,
  TextQuote,
  Trash2,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

interface Doc {
  id: string
  name: string
  body: string
  createdAt: number
  updatedAt: number
}

/* ================================================================== */
/* IndexedDB — documents, fully on-device                              */
/* ================================================================== */

const DB_NAME = 'toolhub-markdown'
const DB_VERSION = 1
const DOC_STORE = 'docs'
/** localStorage mirror of the last-open document id (restored on reopen). */
const LAST_KEY = 'toolhub-markdown-last'
/** Debounce for the draft autosave, in ms. */
const AUTOSAVE_DELAY = 600

let dbPromise: Promise<IDBDatabase> | null = null

function openMarkdownDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(DOC_STORE)) d.createObjectStore(DOC_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openMarkdownDb()
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
/* Small shared helpers                                                */
/* ================================================================== */

/** Thin glass scrollbar for long lists / panes. */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

function makeId(): string {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || ''
  )
}

function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

function fmtUpdated(ms: number): string {
  const d = new Date(ms)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `Today · ${fmtClock(ms)}`
  const yest = new Date(now)
  yest.setDate(yest.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return `Yesterday · ${fmtClock(ms)}`
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  })
}

function asDoc(v: unknown): Doc | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string' || !o.id) return null
  return {
    id: o.id,
    name: typeof o.name === 'string' && o.name.trim() ? o.name : 'Untitled',
    body: typeof o.body === 'string' ? o.body : '',
    createdAt: typeof o.createdAt === 'number' ? o.createdAt : Date.now(),
    updatedAt: typeof o.updatedAt === 'number' ? o.updatedAt : Date.now(),
  }
}

function writeLastId(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_KEY, id)
    else localStorage.removeItem(LAST_KEY)
  } catch {
    /* storage unavailable */
  }
}

function readLastId(): string | null {
  try {
    const id = localStorage.getItem(LAST_KEY)
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/* ================================================================== */
/* Markdown → plain text (snippets + quick-PDF)                        */
/* ================================================================== */

type PlainKind = 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'li' | 'quote' | 'code' | 'hr'

interface PlainLine {
  text: string
  kind: PlainKind
}

function stripInline(s: string): string {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]*)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,!?])/g, '$1$2')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Line-based markdown → structured plain text (used by quick PDF + snippets). */
function mdToPlain(md: string): PlainLine[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: PlainLine[] = []
  let inFence = false
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      out.push({ text: line, kind: 'code' })
      continue
    }
    const t = line.trim()
    if (!t) continue
    const h = t.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      out.push({ text: stripInline(h[2]), kind: `h${Math.min(h[1].length, 4)}` as PlainKind })
      continue
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      out.push({ text: '', kind: 'hr' })
      continue
    }
    const q = t.match(/^>\s?(.*)$/)
    if (q) {
      out.push({ text: stripInline(q[1]), kind: 'quote' })
      continue
    }
    if (t.startsWith('|') && t.endsWith('|') && t.length >= 2) {
      if (/^\|[\s:|-]+\|$/.test(t)) continue // separator row
      const cells = t
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => stripInline(c.trim()))
      out.push({ text: cells.join('  ·  '), kind: 'p' })
      continue
    }
    const li = t.match(/^[-*+]\s+(.*)$/)
    if (li) {
      out.push({ text: `•  ${stripInline(li[1])}`, kind: 'li' })
      continue
    }
    const ol = t.match(/^(\d+)[.)]\s+(.*)$/)
    if (ol) {
      out.push({ text: `${ol[1]}. ${stripInline(ol[2])}`, kind: 'li' })
      continue
    }
    out.push({ text: stripInline(t), kind: 'p' })
  }
  return out
}

/** First meaningful line, for the documents list snippet. */
function snippetOf(body: string): string {
  const first = mdToPlain(body).find((l) => l.kind !== 'hr' && l.text.trim() !== '')
  const s = (first?.text ?? '').trim()
  if (!s) return ''
  return s.length > 96 ? `${s.slice(0, 96)}…` : s
}

/* ================================================================== */
/* Markdown → HTML (self-contained export)                             */
/* ================================================================== */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Inline markdown → HTML. Code spans are extracted first so their contents stay literal. */
function inlineMd(s: string): string {
  const parts = s.split(/(`[^`]*`)/g)
  return parts
    .map((p) => {
      if (p.length >= 2 && p.startsWith('`') && p.endsWith('`')) {
        return `<code>${escapeHtml(p.slice(1, -1))}</code>`
      }
      let out = escapeHtml(p)
      out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2" />')
      out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>')
      out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>')
      out = out.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      out = out.replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1<em>$2</em>')
      return out
    })
    .join('')
}

/** Compact block-level markdown → HTML for the HTML export. */
function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let inQuote = false
  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`)
      listType = null
    }
  }
  const closeQuote = () => {
    if (inQuote) {
      out.push('</blockquote>')
      inQuote = false
    }
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // fenced code block
    const fence = line.match(/^\s*```(\w*)\s*$/)
    if (fence) {
      closeList()
      closeQuote()
      const buf: string[] = []
      i += 1
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        buf.push(lines[i])
        i += 1
      }
      i += 1 // closing fence
      out.push(
        `<pre><code${fence[1] ? ` class="language-${fence[1]}"` : ''}>${escapeHtml(buf.join('\n'))}</code></pre>`
      )
      continue
    }

    // horizontal rule
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList()
      closeQuote()
      out.push('<hr />')
      i += 1
      continue
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      closeList()
      closeQuote()
      const lv = h[1].length
      out.push(`<h${lv}>${inlineMd(h[2])}</h${lv}>`)
      i += 1
      continue
    }

    // table (header row + |---|---| separator)
    if (line.includes('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
      closeList()
      closeQuote()
      const parseRow = (r: string) =>
        r
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim())
      const head = parseRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(parseRow(lines[i]))
        i += 1
      }
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inlineMd(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      )
      continue
    }

    // blockquote
    const q = line.match(/^\s*>\s?(.*)$/)
    if (q) {
      closeList()
      if (!inQuote) {
        out.push('<blockquote>')
        inQuote = true
      }
      out.push(`<p>${inlineMd(q[1])}</p>`)
      i += 1
      continue
    }

    // list items
    const ul = line.match(/^\s*[-*+]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ul || ol) {
      closeQuote()
      const want = ul ? 'ul' : 'ol'
      if (listType !== want) {
        closeList()
        out.push(`<${want}>`)
        listType = want
      }
      out.push(`<li>${inlineMd((ul ?? ol)![1])}</li>`)
      i += 1
      continue
    }

    // blank line
    if (line.trim() === '') {
      closeList()
      closeQuote()
      i += 1
      continue
    }

    // paragraph: gather consecutive plain lines
    closeList()
    closeQuote()
    const buf: string[] = [line]
    i += 1
    while (i < lines.length) {
      const l = lines[i]
      if (
        l.trim() === '' ||
        /^(#{1,6}\s|\s*```|\s*>|\s*[-*+]\s|\s*\d+[.)]\s)/.test(l) ||
        /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(l)
      ) {
        break
      }
      buf.push(l)
      i += 1
    }
    out.push(`<p>${inlineMd(buf.join(' '))}</p>`)
  }
  closeList()
  closeQuote()
  return out.join('\n')
}

const DARK_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html { background: #09090b; }
  body { margin: 0; padding: 44px 20px 64px; background: #09090b; color: #e4e4e7;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  .doc { max-width: 720px; margin: 0 auto; }
  .doc-title { margin: 0; font-size: 2em; line-height: 1.2; color: #f5f3ff; letter-spacing: -0.02em; }
  .doc-meta { margin: 10px 0 0; color: #8b8b94; font-size: 12.5px; letter-spacing: 0.02em; }
  .rule { border: 0; border-top: 1px solid rgba(216,180,254,0.18); margin: 22px 0 26px; }
  h1, h2, h3, h4, h5, h6 { color: #ede9fe; line-height: 1.28; margin: 1.6em 0 0.5em; letter-spacing: -0.01em; }
  h1 { font-size: 1.7em; } h2 { font-size: 1.4em; } h3 { font-size: 1.16em; }
  p { margin: 0.9em 0; }
  a { color: #d8b4fe; text-decoration: underline; text-underline-offset: 2px; }
  blockquote { margin: 1.2em 0; padding: 0.6em 1em; border-left: 3px solid #a78bfa;
    background: rgba(167,139,250,0.07); border-radius: 0 12px 12px 0; color: #b9b9c3; }
  blockquote p { margin: 0.35em 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; font-size: 0.88em; }
  p code, li code, td code, th code { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 6px; padding: 0.1em 0.35em; color: #e9d5ff; }
  pre { background: #101016; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px;
    padding: 14px 16px; overflow-x: auto; margin: 1.2em 0; }
  pre code { background: none; border: 0; padding: 0; color: #d4d4d8; font-size: 13px; line-height: 1.55; }
  ul, ol { margin: 0.9em 0; padding-left: 1.5em; }
  li { margin: 0.3em 0; }
  li::marker { color: #a78bfa; }
  table { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: 14.5px; }
  th, td { border: 1px solid rgba(255,255,255,0.12); padding: 8px 12px; text-align: left; }
  th { background: rgba(255,255,255,0.05); color: #f4f4f5; }
  hr { border: 0; border-top: 1px solid rgba(255,255,255,0.12); margin: 2em 0; }
  img { max-width: 100%; border-radius: 12px; }
  del { color: #71717a; }
`

const PAPER_CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html { background: #fbfaf8; }
  body { margin: 0; padding: 44px 20px 64px; background: #fbfaf8; color: #27272a;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
  .doc { max-width: 720px; margin: 0 auto; }
  .doc-title { margin: 0; font-size: 2em; line-height: 1.2; color: #1c1917; letter-spacing: -0.02em; }
  .doc-meta { margin: 10px 0 0; color: #78716c; font-size: 12.5px; letter-spacing: 0.02em; }
  .rule { border: 0; border-top: 1px solid #e7e5e4; margin: 22px 0 26px; }
  h1, h2, h3, h4, h5, h6 { color: #5b21b6; line-height: 1.28; margin: 1.6em 0 0.5em; letter-spacing: -0.01em; }
  h1 { font-size: 1.7em; } h2 { font-size: 1.4em; } h3 { font-size: 1.16em; }
  p { margin: 0.9em 0; }
  a { color: #7c3aed; text-decoration: underline; text-underline-offset: 2px; }
  blockquote { margin: 1.2em 0; padding: 0.6em 1em; border-left: 3px solid #8b5cf6;
    background: #f5f3ff; border-radius: 0 12px 12px 0; color: #52525b; }
  blockquote p { margin: 0.35em 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace; font-size: 0.88em; }
  p code, li code, td code, th code { background: #f4f4f5; border: 1px solid #e4e4e7;
    border-radius: 6px; padding: 0.1em 0.35em; color: #6d28d9; }
  pre { background: #f5f5f4; border: 1px solid #e7e5e4; border-radius: 14px;
    padding: 14px 16px; overflow-x: auto; margin: 1.2em 0; }
  pre code { background: none; border: 0; padding: 0; color: #3f3f46; font-size: 13px; line-height: 1.55; }
  ul, ol { margin: 0.9em 0; padding-left: 1.5em; }
  li { margin: 0.3em 0; }
  li::marker { color: #8b5cf6; }
  table { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: 14.5px; }
  th, td { border: 1px solid #d6d3d1; padding: 8px 12px; text-align: left; }
  th { background: #f5f3ff; color: #1c1917; }
  hr { border: 0; border-top: 1px solid #e7e5e4; margin: 2em 0; }
  img { max-width: 100%; border-radius: 12px; }
  del { color: #a8a29e; }
`

function buildHtmlDoc(doc: Doc, theme: 'dark' | 'paper'): string {
  const title = escapeHtml(doc.name.trim() || 'Untitled')
  const css = theme === 'dark' ? DARK_CSS : PAPER_CSS
  const meta = `Exported from Markdown Studio · ${new Date(doc.updatedAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })}`
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${title}</title>`,
    `<style>${css}\n@page { margin: 14mm; }</style>`,
    '</head>',
    '<body>',
    '<main class="doc">',
    `<h1 class="doc-title">${title}</h1>`,
    `<p class="doc-meta">${escapeHtml(meta)}</p>`,
    '<hr class="rule" />',
    mdToHtml(doc.body),
    '</main>',
    '</body>',
    '</html>',
  ].join('\n')
}

/** Hidden srcdoc iframe → contentWindow.print() — the system "Save as PDF" path. */
function printHtmlDoc(html: string): () => void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('title', 'Print preview')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;pointer-events:none;'
  let timerId = 0
  const cleanup = () => {
    window.clearTimeout(timerId)
    frame.remove()
  }
  frame.onload = () => {
    try {
      const win = frame.contentWindow
      win?.focus()
      win?.print()
    } catch {
      /* print blocked — fall back to the quick PDF path */
    }
    timerId = window.setTimeout(cleanup, 45_000)
  }
  frame.srcdoc = html
  document.body.appendChild(frame)
  return cleanup
}

/* ================================================================== */
/* Quick PDF (jsPDF text mode) — guaranteed-offline fallback           */
/* ================================================================== */

interface PdfStyle {
  size: number
  bold?: boolean
  italic?: boolean
  font?: 'helvetica' | 'courier'
  color: [number, number, number]
  indent?: number
  before?: number
}

const PDF_STYLES: Record<Exclude<PlainKind, 'hr'>, PdfStyle> = {
  h1: { size: 19, bold: true, color: [91, 33, 182], before: 7 },
  h2: { size: 15.5, bold: true, color: [91, 33, 182], before: 6 },
  h3: { size: 13, bold: true, color: [39, 39, 42], before: 5 },
  h4: { size: 11.5, bold: true, color: [39, 39, 42], before: 4 },
  p: { size: 11, color: [39, 39, 42] },
  li: { size: 11, color: [39, 39, 42], indent: 5 },
  quote: { size: 10.5, italic: true, color: [82, 82, 91], indent: 4, before: 2 },
  code: { size: 9.5, color: [68, 64, 60], font: 'courier', indent: 3 },
}

async function exportPdfQuickFile(doc: Doc): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true })
  const pageW = 210
  const pageH = 297
  const marginX = 17
  const maxW = pageW - marginX * 2 // ≈ 90 characters at 11 pt
  let y = 24

  // document header
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(21)
  pdf.setTextColor(24, 16, 40)
  const titleLines = pdf.splitTextToSize(doc.name.trim() || 'Untitled', maxW) as string[]
  for (const tl of titleLines) {
    pdf.text(tl, marginX, y)
    y += 8.8
  }
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor(130, 130, 138)
  pdf.text(
    `Markdown Studio · ${new Date(doc.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`,
    marginX,
    y + 1.5
  )
  y += 8
  pdf.setDrawColor(167, 139, 250)
  pdf.setLineWidth(0.5)
  pdf.line(marginX, y - 2.5, pageW - marginX, y - 2.5)
  y += 4

  const lines = mdToPlain(doc.body)
  if (lines.length === 0) lines.push({ text: '(empty document)', kind: 'p' })

  for (const line of lines) {
    if (line.kind === 'hr') {
      if (y > pageH - 20) {
        pdf.addPage()
        y = 22
      }
      pdf.setDrawColor(210, 206, 200)
      pdf.setLineWidth(0.3)
      pdf.line(marginX, y, pageW - marginX, y)
      y += 5
      continue
    }
    const st = PDF_STYLES[line.kind]
    y += st.before ?? 0
    pdf.setFont(st.font ?? 'helvetica', st.italic ? 'italic' : st.bold ? 'bold' : 'normal')
    pdf.setFontSize(st.size)
    pdf.setTextColor(st.color[0], st.color[1], st.color[2])
    const wrapped = pdf.splitTextToSize(line.text || ' ', maxW - (st.indent ?? 0)) as string[]
    const lh = st.size * 0.3528 * 1.42
    for (const w of wrapped) {
      if (y > pageH - 18) {
        pdf.addPage()
        y = 22
      }
      pdf.text(w, marginX + (st.indent ?? 0), y)
      y += lh
    }
    y += 1.2
  }

  pdf.save(`${slugify(doc.name) || 'document'}.pdf`)
}

/* ================================================================== */
/* Editor transforms — selection-aware toolbar actions                 */
/* ================================================================== */

interface EditResult {
  value: string
  start: number
  end: number
}

type EditTransform = (value: string, selStart: number, selEnd: number) => EditResult

type ToolId = 'bold' | 'italic' | 'heading' | 'link' | 'code' | 'quote' | 'list' | 'table'

/** Module-level pure data — the toolbar maps over this at render with zero
 *  closures, so the react-hooks refs rule can never trace a ref into render. */
const TOOL_ITEMS: { id: ToolId; icon: LucideIcon; label: string }[] = [
  { id: 'bold', icon: Bold, label: 'Bold' },
  { id: 'italic', icon: Italic, label: 'Italic' },
  { id: 'heading', icon: Heading2, label: 'Heading (cycles level)' },
  { id: 'link', icon: Link2, label: 'Insert link' },
  { id: 'code', icon: Code2, label: 'Code' },
  { id: 'quote', icon: TextQuote, label: 'Blockquote' },
  { id: 'list', icon: List, label: 'Bullet list' },
  { id: 'table', icon: Table, label: 'Insert table' },
]

/** Line span covering the current selection. */
function lineRange(value: string, selStart: number, selEnd: number): { ls: number; le: number } {
  const ls = value.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1
  const nl = value.indexOf('\n', selEnd)
  return { ls, le: nl === -1 ? value.length : nl }
}

function wrapSel(before: string, after: string, placeholder: string): EditTransform {
  return (value, selStart, selEnd) => {
    const sel = value.slice(selStart, selEnd)
    const inner = sel || placeholder
    return {
      value: value.slice(0, selStart) + before + inner + after + value.slice(selEnd),
      start: selStart + before.length,
      end: selStart + before.length + inner.length,
    }
  }
}

/** Cycle the current line's heading level: none → # → ## → ### → none. */
function cycleHeading(value: string, selStart: number, selEnd: number): EditResult {
  const { ls, le } = lineRange(value, selStart, selEnd)
  const line = value.slice(ls, le)
  const m = line.match(/^(#{1,6})\s/)
  let nextLine: string
  if (!m) nextLine = `# ${line}`
  else if (m[1].length >= 3) nextLine = line.replace(/^#{1,6}\s+/, '')
  else nextLine = `${'#'.repeat(m[1].length + 1)} ${line.replace(/^#{1,6}\s+/, '')}`
  return {
    value: value.slice(0, ls) + nextLine + value.slice(le),
    start: ls,
    end: ls + nextLine.length,
  }
}

/** Toggle a line prefix (quote / bullet list) across the selected lines. */
function togglePrefix(prefix: string): EditTransform {
  return (value, selStart, selEnd) => {
    const { ls, le } = lineRange(value, selStart, selEnd)
    const lines = value.slice(ls, le).split('\n')
    const all = lines.every((l) => l.startsWith(prefix))
    const block = lines.map((l) => (all ? l.slice(prefix.length) : prefix + l)).join('\n')
    return {
      value: value.slice(0, ls) + block + value.slice(le),
      start: ls,
      end: ls + block.length,
    }
  }
}

/** Inline code for short selections, fenced block for multi-line ones. */
function codeTransform(value: string, selStart: number, selEnd: number): EditResult {
  const sel = value.slice(selStart, selEnd)
  if (sel.includes('\n')) {
    const lead = selStart === 0 || value[selStart - 1] === '\n' ? '' : '\n'
    const inner = sel.endsWith('\n') ? sel.slice(0, -1) : sel
    const ins = `${lead}\`\`\`\n${inner}\n\`\`\``
    const start = selStart + lead.length + 4
    return {
      value: value.slice(0, selStart) + ins + value.slice(selEnd),
      start,
      end: start + inner.length,
    }
  }
  return wrapSel('`', '`', 'code')(value, selStart, selEnd)
}

/** `[text](url)` — inserts a link and pre-selects the URL for typing. */
function linkTransform(value: string, selStart: number, selEnd: number): EditResult {
  const sel = value.slice(selStart, selEnd)
  const text = sel || 'link text'
  const ins = `[${text}](https://)`
  const urlStart = selStart + text.length + 3
  return {
    value: value.slice(0, selStart) + ins + value.slice(selEnd),
    start: urlStart,
    end: urlStart + 8,
  }
}

/** Insert a small table snippet at the cursor. */
function tableTransform(value: string, selStart: number, selEnd: number): EditResult {
  const lead = selStart === 0 || value[selStart - 1] === '\n' ? '' : '\n'
  const snippet = `${lead}| Column A | Column B |\n| --- | --- |\n| Cell 1   | Cell 2   |\n`
  const pos = selStart + snippet.length
  return {
    value: value.slice(0, selStart) + snippet + value.slice(selEnd),
    start: pos,
    end: pos,
  }
}

/* ================================================================== */
/* Live preview — react-markdown with a dark-glass component map       */
/* ================================================================== */

const MD_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2 mt-6 text-xl font-bold tracking-tight text-purple-100 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-5 text-lg font-bold tracking-tight text-purple-200 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-4 text-[15px] font-semibold text-zinc-100 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-3 text-sm font-semibold text-zinc-200 first:mt-0">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mb-1 mt-3 text-[13px] font-semibold uppercase tracking-wide text-zinc-300 first:mt-0">
      {children}
    </h5>
  ),
  h6: ({ children }) => (
    <h6 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-zinc-400 first:mt-0">
      {children}
    </h6>
  ),
  p: ({ children }) => (
    <p className="my-2.5 text-[14.5px] leading-relaxed text-zinc-300 first:mt-0 last:mb-0">{children}</p>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-purple-300 underline decoration-purple-400/40 underline-offset-2 transition-colors hover:text-purple-200"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-zinc-200">{children}</em>,
  del: ({ children }) => <del className="text-zinc-500">{children}</del>,
  ul: ({ children }) => (
    <ul className="my-2.5 list-disc space-y-1 pl-5 marker:text-purple-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2.5 list-decimal space-y-1 pl-5 marker:text-purple-300">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="my-0.5 text-[14.5px] leading-relaxed text-zinc-300 [&>p]:my-0">{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-3 rounded-r-xl border-l-2 border-purple-400/60 bg-purple-400/[0.06] py-1.5 pl-3.5 pr-3 text-zinc-400 [&>p]:my-1.5">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-5 border-0 border-t border-white/10" />,
  pre: ({ children }) => (
    <div className="my-3 overflow-hidden rounded-xl border border-white/10 bg-black/50 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
      <pre
        className={cn(
          'overflow-x-auto p-3.5 font-mono text-[12.5px] leading-5 text-zinc-200',
          THIN_SCROLLBAR
        )}
      >
        {children}
      </pre>
    </div>
  ),
  code: ({ className, children }) =>
    className?.includes('language-') ? (
      <code className="font-mono text-[12.5px] text-zinc-200">{children}</code>
    ) : (
      <code className="rounded-md border border-white/10 bg-white/10 px-1 py-0.5 font-mono text-[12.5px] text-purple-200">
        {children}
      </code>
    ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full border-collapse text-left text-[13.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.05]">{children}</thead>,
  th: ({ children }) => (
    <th className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-zinc-200">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border-b border-white/5 px-3 py-2 align-top text-zinc-300">{children}</td>
  ),
  img: ({ src, alt }) => (
     
    <img src={src} alt={alt} loading="lazy" className="my-3 max-w-full rounded-xl border border-white/10" />
  ),
}

const MarkdownPreview = memo(function MarkdownPreview({ text }: { text: string }) {
  return (
    <div className="break-words text-[14.5px] leading-relaxed text-zinc-300">
      <ReactMarkdown components={MD_COMPONENTS}>{text}</ReactMarkdown>
    </div>
  )
})

/* ================================================================== */
/* Small presentational atoms                                          */
/* ================================================================== */

function IconBtn({
  onClick,
  icon: Icon,
  label,
  danger = false,
}: {
  onClick: () => void
  icon: LucideIcon
  label: string
  danger?: boolean
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88 }}
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 transition-colors',
        danger
          ? 'bg-rose-500/10 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-300'
          : 'bg-white/[0.03] text-zinc-400 hover:bg-white/10 hover:text-white'
      )}
    >
      <Icon className="size-4.5" aria-hidden />
    </motion.button>
  )
}

function ActionBtn({
  onClick,
  icon: Icon,
  label,
}: {
  onClick: () => void
  icon: LucideIcon
  label: string
}) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-[13px] font-medium text-zinc-200 transition-colors hover:bg-white/10 hover:text-white"
    >
      <Icon className="size-4 text-purple-300" aria-hidden />
      {label}
    </motion.button>
  )
}

/* ================================================================== */
/* Main component                                                      */
/* ================================================================== */

export default function MarkdownStudioApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [docs, setDocs] = useState<Doc[]>([])
  const [loaded, setLoaded] = useState(false)
  const [view, setView] = useState<'list' | 'editor'>('list')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<'write' | 'preview'>('write')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [htmlTheme, setHtmlTheme] = useState<'dark' | 'paper'>('dark')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [modalMode, setModalMode] = useState<'create' | 'rename' | null>(null)
  const [modalName, setModalName] = useState('')

  /* ---------------- refs ---------------- */
  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingSelRef = useRef<{ start: number; end: number } | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingDocRef = useRef<Doc | null>(null)
  const deleteTimerRef = useRef<number | null>(null)
  const printCleanupRef = useRef<(() => void) | null>(null)
  const docsRef = useRef<Doc[]>([])
  const activeIdRef = useRef<string | null>(null)
  const modalDocIdRef = useRef<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    docsRef.current = docs
  }, [docs])
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const activeDoc = useMemo(
    () => (activeId ? (docs.find((d) => d.id === activeId) ?? null) : null),
    [docs, activeId]
  )
  const body = activeDoc?.body ?? ''

  /* ---------------- hydration (alive flag) ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rows = await idbGetAll<unknown>(DOC_STORE)
        if (!alive) return
        const fromDb = rows
          .map(asDoc)
          .filter((d): d is Doc => d !== null)
          .sort((a, b) => b.updatedAt - a.updatedAt)
        const seen = new Set(fromDb.map((d) => d.id))
        const locals = docsRef.current.filter((d) => !seen.has(d.id))
        const merged = [...locals, ...fromDb].sort((a, b) => b.updatedAt - a.updatedAt)
        setDocs(merged)
        // restore the last-open document
        const lastId = readLastId()
        if (lastId && activeIdRef.current === null) {
          const doc = merged.find((d) => d.id === lastId)
          if (doc) {
            setActiveId(doc.id)
            setView('editor')
            setSaveState('saved')
            setSavedAt(doc.updatedAt)
          }
        }
      } catch {
        /* private mode / quota — keep working in memory */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- autosave (600 ms debounce → IndexedDB) ---------------- */
  const flushSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const d = pendingDocRef.current
    if (d) {
      pendingDocRef.current = null
      void idbPut(DOC_STORE, d).catch(() => {
        /* memory-only fallback */
      })
      setSaveState('saved')
      setSavedAt(d.updatedAt)
    }
  }, [])

  const queueSave = useCallback((doc: Doc) => {
    pendingDocRef.current = doc
    setSaveState('saving')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null
      const d = pendingDocRef.current
      pendingDocRef.current = null
      if (!d) return
      void idbPut(DOC_STORE, d).catch(() => {
        /* memory-only fallback */
      })
      setSaveState('saved')
      setSavedAt(Date.now())
    }, AUTOSAVE_DELAY)
  }, [])

  /* ---------------- unmount cleanup ---------------- */
  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      if (deleteTimerRef.current !== null) window.clearTimeout(deleteTimerRef.current)
      printCleanupRef.current?.()
      const d = pendingDocRef.current
      if (d) void idbPut(DOC_STORE, d).catch(() => {})
    },
    []
  )

  /* ---------------- document actions ---------------- */
  const openDoc = useCallback((doc: Doc) => {
    setActiveId(doc.id)
    setView('editor')
    setMobileTab('write')
    setSaveState('saved')
    setSavedAt(doc.updatedAt)
    writeLastId(doc.id)
    haptic()
  }, [])

  const backToList = useCallback(() => {
    flushSave()
    setView('list')
    setActiveId(null)
    writeLastId(null)
    haptic()
  }, [flushSave])

  const createDoc = useCallback(
    (name: string) => {
      const now = Date.now()
      const doc: Doc = { id: makeId(), name, body: `# ${name}\n\n`, createdAt: now, updatedAt: now }
      setDocs((prev) => [doc, ...prev])
      void idbPut(DOC_STORE, doc).catch(() => {})
      setActiveId(doc.id)
      setView('editor')
      setMobileTab('write')
      setSaveState('saved')
      setSavedAt(now)
      writeLastId(doc.id)
      haptic()
      toast({ title: 'Document created', description: name })
    },
    [toast]
  )

  const renameDoc = useCallback(
    (id: string, name: string) => {
      const doc = docsRef.current.find((d) => d.id === id)
      if (!doc) return
      const updated: Doc = { ...doc, name, updatedAt: Date.now() }
      setDocs((prev) => prev.map((d) => (d.id === id ? updated : d)))
      // a pending autosave must not resurrect the old name
      if (pendingDocRef.current?.id === id) pendingDocRef.current = updated
      void idbPut(DOC_STORE, updated).catch(() => {})
      if (activeIdRef.current === id) setSavedAt(updated.updatedAt)
      haptic()
      toast({ title: 'Renamed', description: name })
    },
    [toast]
  )

  const duplicateDoc = useCallback(
    (doc: Doc) => {
      const now = Date.now()
      const copy: Doc = { ...doc, id: makeId(), name: `${doc.name} (copy)`, createdAt: now, updatedAt: now }
      setDocs((prev) => [copy, ...prev])
      void idbPut(DOC_STORE, copy).catch(() => {})
      haptic()
      toast({ title: 'Duplicated', description: copy.name })
    },
    [toast]
  )

  const deleteDoc = useCallback(
    (id: string) => {
      const doc = docsRef.current.find((d) => d.id === id)
      setDocs((prev) => prev.filter((d) => d.id !== id))
      setConfirmDeleteId(null)
      void idbDelete(DOC_STORE, id).catch(() => {})
      try {
        if (localStorage.getItem(LAST_KEY) === id) localStorage.removeItem(LAST_KEY)
      } catch {
        /* storage unavailable */
      }
      haptic()
      toast({ title: 'Document deleted', description: doc?.name || 'Untitled' })
    },
    [toast]
  )

  const handleDeleteTap = useCallback((id: string) => {
    if (confirmDeleteId === id) {
      deleteDoc(id)
      return
    }
    setConfirmDeleteId(id)
    if (deleteTimerRef.current !== null) window.clearTimeout(deleteTimerRef.current)
    deleteTimerRef.current = window.setTimeout(() => setConfirmDeleteId(null), 2600)
  }, [confirmDeleteId, deleteDoc])

  /* ---------------- modal ---------------- */
  const openCreate = useCallback(() => {
    setModalName('')
    modalDocIdRef.current = null
    setModalMode('create')
    haptic()
  }, [])

  const openRename = useCallback((doc: Doc) => {
    setModalName(doc.name)
    modalDocIdRef.current = doc.id
    setModalMode('rename')
    haptic()
  }, [])

  useEffect(() => {
    if (!modalMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalMode(null)
    }
    window.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => {
      nameInputRef.current?.focus()
      nameInputRef.current?.select()
    }, 30)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [modalMode])

  const submitModal = useCallback(() => {
    const name = modalName.trim()
    if (!name) {
      toast({ title: 'Give the document a name' })
      nameInputRef.current?.focus()
      return
    }
    if (modalMode === 'create') createDoc(name)
    else if (modalMode === 'rename' && modalDocIdRef.current) renameDoc(modalDocIdRef.current, name)
    setModalMode(null)
  }, [createDoc, modalMode, modalName, renameDoc, toast])

  /* ---------------- editor edits ---------------- */
  const handleBodyChange = useCallback(
    (value: string) => {
      if (!activeDoc) return
      const updated: Doc = { ...activeDoc, body: value, updatedAt: Date.now() }
      setDocs((prev) => prev.map((d) => (d.id === updated.id ? updated : d)))
      queueSave(updated)
    },
    [activeDoc, queueSave]
  )

  const applyEdit = useCallback(
    (transform: EditTransform) => {
      const ta = taRef.current
      if (!ta || !activeDoc) return
      const start = ta.selectionStart ?? ta.value.length
      const end = ta.selectionEnd ?? start
      const r = transform(ta.value, start, end)
      handleBodyChange(r.value)
      pendingSelRef.current = { start: r.start, end: r.end }
      haptic()
    },
    [activeDoc, handleBodyChange]
  )

  // restore cursor/selection after toolbar transforms
  useEffect(() => {
    const sel = pendingSelRef.current
    if (!sel) return
    pendingSelRef.current = null
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    try {
      ta.setSelectionRange(sel.start, sel.end)
    } catch {
      /* selection out of range */
    }
  }, [body])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      applyEdit((value, s, se) => ({
        value: value.slice(0, s) + '  ' + value.slice(se),
        start: s + 2,
        end: s + 2,
      }))
    }
  }

  /* ---------------- exports ---------------- */
  const handleExportHtml = useCallback(() => {
    if (!activeDoc) return
    const html = buildHtmlDoc(activeDoc, htmlTheme)
    downloadBlob(
      new Blob([html], { type: 'text/html;charset=utf-8' }),
      `${slugify(activeDoc.name) || 'document'}.html`
    )
    haptic()
    toast({
      title: 'HTML exported',
      description: `${htmlTheme === 'dark' ? 'Dark' : 'Paper'} style · opens in any browser`,
    })
  }, [activeDoc, htmlTheme, toast])

  const handleExportPdfPrint = useCallback(() => {
    if (!activeDoc) return
    printCleanupRef.current?.()
    printCleanupRef.current = printHtmlDoc(buildHtmlDoc(activeDoc, 'paper'))
    haptic()
    toast({
      title: 'Print dialog opened',
      description: 'Choose “Save as PDF” as the destination',
    })
  }, [activeDoc, toast])

  const handleExportPdfQuick = useCallback(async () => {
    if (!activeDoc) return
    try {
      await exportPdfQuickFile(activeDoc)
      haptic()
      toast({ title: 'PDF downloaded', description: 'Plain-text layout · works fully offline' })
    } catch {
      toast({ title: 'Could not generate PDF', description: 'Your browser blocked the download' })
    }
  }, [activeDoc, toast])

  const handleCopyMarkdown = useCallback(async () => {
    if (!activeDoc) return
    try {
      await navigator.clipboard.writeText(activeDoc.body)
      haptic()
      toast({ title: 'Markdown copied', description: 'Paste it anywhere — it stays plain text' })
    } catch {
      toast({ title: 'Copy failed', description: 'Your browser blocked clipboard access' })
    }
  }, [activeDoc, toast])

  /* ---------------- toolbar ---------------- */
  /* formatting toolbar actions — dispatch by id at click time; the item list
     is module-level pure data so nothing ref-touching happens during render */
  const runTool = useCallback(
    (id: ToolId) => {
      switch (id) {
        case 'bold':
          return applyEdit(wrapSel('**', '**', 'bold text'))
        case 'italic':
          return applyEdit(wrapSel('*', '*', 'italic text'))
        case 'heading':
          return applyEdit(cycleHeading)
        case 'link':
          return applyEdit(linkTransform)
        case 'code':
          return applyEdit(codeTransform)
        case 'quote':
          return applyEdit(togglePrefix('> '))
        case 'list':
          return applyEdit(togglePrefix('- '))
        case 'table':
          return applyEdit(tableTransform)
      }
    },
    [applyEdit]
  )

  /* ---------------- stats ---------------- */
  const stats = useMemo(() => {
    const t = body.trim()
    const words = t ? t.split(/\s+/).length : 0
    return { words, chars: body.length, read: words ? Math.max(1, Math.round(words / 200)) : 0 }
  }, [body])

  const sortedDocs = useMemo(() => [...docs].sort((a, b) => b.updatedAt - a.updatedAt), [docs])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl [color-scheme:dark]">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        {view === 'list' ? (
          <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-purple-500/[0.1] via-violet-500/[0.06] to-transparent px-5 py-5">
            <div className="flex items-center gap-4">
              <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-purple-300 via-violet-400 to-purple-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(168_85_247/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
                <NotebookPen className="size-7" strokeWidth={1.9} aria-hidden />
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold tracking-tight">Markdown Studio</h2>
                <p className="truncate text-xs text-zinc-400">Write markdown, ship documents.</p>
              </div>
              <Button
                onClick={openCreate}
                className="h-10 shrink-0 rounded-xl bg-gradient-to-r from-purple-300 to-violet-500 font-semibold text-zinc-950 shadow-lg hover:from-purple-200 hover:to-violet-400"
              >
                <Plus className="size-4" aria-hidden /> New
              </Button>
            </div>
          </div>
        ) : (
          <div className="relative border-b border-white/5 bg-gradient-to-br from-purple-500/[0.1] via-transparent to-transparent px-3 py-3">
            <div className="flex items-center gap-2.5">
              <motion.button
                type="button"
                whileTap={{ scale: 0.9 }}
                onClick={backToList}
                aria-label="Back to documents"
                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ArrowLeft className="size-5" aria-hidden />
              </motion.button>
              <button
                type="button"
                onClick={() => activeDoc && openRename(activeDoc)}
                className="group min-w-0 flex-1 rounded-xl px-1.5 py-1 text-left"
                aria-label="Rename this document"
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[15px] font-bold tracking-tight text-zinc-100 transition-colors group-hover:text-white">
                    {activeDoc?.name || 'Untitled'}
                  </span>
                  <Pencil className="size-3 shrink-0 text-zinc-600 transition-colors group-hover:text-purple-300" aria-hidden />
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                  {saveState === 'saving' ? (
                    <>
                      <Loader2 className="size-3 animate-spin text-purple-300" aria-hidden /> Saving…
                    </>
                  ) : (
                    <>
                      <Check className="size-3 text-emerald-400" aria-hidden />
                      Saved{savedAt ? ` · ${fmtClock(savedAt)}` : ''}
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ---------------- Body ---------------- */}
        {!loaded ? (
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
            ))}
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            {view === 'list' ? (
              <motion.div
                key="list"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ type: 'spring', stiffness: 280, damping: 28 }}
                className="p-4 sm:p-5"
              >
                {sortedDocs.length === 0 ? (
                  /* -------- premium dashed empty state -------- */
                  <div className="flex flex-col items-center rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-10 text-center">
                    <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-300/20 to-violet-500/10 text-purple-300 ring-1 ring-white/10">
                      <NotebookPen className="size-7" aria-hidden />
                    </span>
                    <h3 className="mt-4 text-base font-bold text-zinc-100">No documents yet</h3>
                    <p className="mt-1 max-w-[250px] text-xs leading-5 text-zinc-500">
                      Create your first markdown document — it lives entirely on this device.
                    </p>
                    <Button
                      onClick={openCreate}
                      className="mt-5 h-11 rounded-xl bg-gradient-to-r from-purple-300 to-violet-500 px-5 font-semibold text-zinc-950 shadow-lg hover:from-purple-200 hover:to-violet-400"
                    >
                      <Plus className="size-4" aria-hidden /> New document
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between px-1">
                      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        Documents · {sortedDocs.length}
                      </h3>
                      <span className="text-[11px] text-zinc-600">Autosaves on this device</span>
                    </div>
                    <ul
                      className={cn(
                        'max-h-[54vh] space-y-2.5 overflow-y-auto pr-0.5',
                        THIN_SCROLLBAR
                      )}
                    >
                      <AnimatePresence initial={false}>
                        {sortedDocs.map((d) => (
                          <motion.li
                            key={d.id}
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                            className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]"
                          >
                            <div className="flex items-center gap-1 p-2">
                              <button
                                type="button"
                                onClick={() => openDoc(d)}
                                className="min-w-0 flex-1 rounded-xl p-2 text-left transition-colors hover:bg-white/[0.04]"
                                aria-label={`Open ${d.name}`}
                              >
                                <span className="block truncate text-sm font-bold text-zinc-100">
                                  {d.name || 'Untitled'}
                                </span>
                                <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-zinc-400">
                                  {snippetOf(d.body) || 'Empty document'}
                                </span>
                                <span className="mt-1.5 block text-[10.5px] font-medium uppercase tracking-wider text-zinc-600">
                                  {fmtUpdated(d.updatedAt)}
                                </span>
                              </button>
                              <div className="flex shrink-0 flex-col justify-center gap-1">
                                <IconBtn
                                  onClick={() => openRename(d)}
                                  icon={Pencil}
                                  label={`Rename ${d.name}`}
                                />
                                <IconBtn
                                  onClick={() => duplicateDoc(d)}
                                  icon={Copy}
                                  label={`Duplicate ${d.name}`}
                                />
                              </div>
                              <div className="flex shrink-0 items-center">
                                {confirmDeleteId === d.id ? (
                                  <motion.button
                                    type="button"
                                    whileTap={{ scale: 0.9 }}
                                    onClick={() => deleteDoc(d.id)}
                                    aria-label={`Confirm delete ${d.name}`}
                                    className="flex h-11 items-center gap-1.5 rounded-xl bg-rose-500/90 px-3 text-xs font-bold text-white shadow-lg shadow-rose-500/20"
                                  >
                                    <Trash2 className="size-4" aria-hidden /> Sure?
                                  </motion.button>
                                ) : (
                                  <IconBtn
                                    onClick={() => handleDeleteTap(d.id)}
                                    icon={Trash2}
                                    label={`Delete ${d.name}`}
                                    danger
                                  />
                                )}
                              </div>
                            </div>
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    </ul>
                  </>
                )}
              </motion.div>
            ) : activeDoc ? (
              <motion.div
                key="editor"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              >
                {/* -------- mobile Write/Preview tabs -------- */}
                <div className="px-3 pt-3 sm:hidden">
                  <div
                    className="grid grid-cols-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1"
                    role="tablist"
                    aria-label="Editor view"
                  >
                    {(['write', 'preview'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={mobileTab === t}
                        onClick={() => {
                          setMobileTab(t)
                          haptic()
                        }}
                        className="relative flex h-11 items-center justify-center rounded-xl text-sm font-semibold"
                      >
                        {mobileTab === t && (
                          <motion.span
                            layoutId="md-tab-pill"
                            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                            className="absolute inset-0 rounded-xl bg-gradient-to-r from-purple-500/90 to-violet-600/90 shadow-lg shadow-purple-500/20"
                          />
                        )}
                        <span
                          className={cn(
                            'relative z-10 flex items-center gap-1.5',
                            mobileTab === t ? 'text-white' : 'text-zinc-400'
                          )}
                        >
                          {t === 'write' ? (
                            <PenLine className="size-4" aria-hidden />
                          ) : (
                            <Eye className="size-4" aria-hidden />
                          )}
                          {t === 'write' ? 'Write' : 'Preview'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3 p-3 sm:p-4">
                  {/* -------- formatting toolbar -------- */}
                  <div
                    role="toolbar"
                    aria-label="Markdown formatting"
                    className={cn(
                      'grid grid-cols-4 gap-2 sm:grid-cols-8',
                      mobileTab !== 'write' && 'hidden sm:grid'
                    )}
                  >
                    {TOOL_ITEMS.map((t) => (
                      <motion.button
                        key={t.id}
                        type="button"
                        whileTap={{ scale: 0.9 }}
                        onClick={() => runTool(t.id)}
                        aria-label={t.label}
                        title={t.label}
                        className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.05] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                      >
                        <t.icon className="size-4.5" aria-hidden />
                      </motion.button>
                    ))}
                  </div>

                  {/* -------- split view: editor | preview -------- */}
                  <div className="sm:grid sm:grid-cols-2 sm:gap-3">
                    <div className={cn(mobileTab !== 'write' && 'hidden sm:block')}>
                      <textarea
                        ref={taRef}
                        value={body}
                        onChange={(e) => handleBodyChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={'# Title\n\nStart writing… **bold**, *italic*, `code`, > quotes, - lists, | tables |'}
                        aria-label="Markdown editor"
                        spellCheck={false}
                        className={cn(
                          'h-[46vh] min-h-[260px] w-full resize-none rounded-2xl border border-white/10 bg-black/30 p-4',
                          'font-mono text-[13.5px] leading-6 text-zinc-100 shadow-inner outline-none transition-colors',
                          'placeholder:text-zinc-600 focus:border-purple-400/40 focus:ring-2 focus:ring-purple-400/20',
                          'sm:h-[56vh]'
                        )}
                      />
                    </div>
                    <div className={cn(mobileTab !== 'preview' && 'hidden sm:block')}>
                      <div
                        className={cn(
                          'h-[46vh] min-h-[260px] overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.03] p-4',
                          'sm:h-[56vh]',
                          THIN_SCROLLBAR
                        )}
                      >
                        {body.trim() ? (
                          <MarkdownPreview text={body} />
                        ) : (
                          <div className="flex h-full flex-col items-center justify-center text-center">
                            <Eye className="size-8 text-zinc-700" aria-hidden />
                            <p className="mt-3 text-xs leading-5 text-zinc-600">
                              Nothing to preview yet —
                              <br />
                              start writing on the left.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* -------- counters + export -------- */}
                  <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-center gap-2 text-[11px] font-medium tracking-wide text-zinc-500">
                      <span>{stats.words} words</span>
                      <span aria-hidden>·</span>
                      <span>{stats.chars} characters</span>
                      <span aria-hidden>·</span>
                      <span>~{stats.read} min read</span>
                    </div>

                    <div className="flex items-center justify-between px-0.5">
                      <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                        <FileDown className="size-3.5 text-purple-300" aria-hidden /> Export
                      </span>
                      <div className="flex items-center gap-1" role="group" aria-label="HTML export theme">
                        <span className="mr-1 text-[10px] uppercase tracking-wider text-zinc-600">
                          HTML theme
                        </span>
                        {(['dark', 'paper'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => {
                              setHtmlTheme(t)
                              haptic()
                            }}
                            aria-pressed={htmlTheme === t}
                            className={cn(
                              'h-7 rounded-lg px-2.5 text-[11px] font-semibold capitalize transition-colors',
                              htmlTheme === t
                                ? 'bg-purple-400/20 text-purple-200 ring-1 ring-purple-400/40'
                                : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-300'
                            )}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <ActionBtn onClick={handleExportHtml} icon={FileDown} label="Export HTML" />
                      <ActionBtn onClick={() => void handleCopyMarkdown()} icon={ClipboardCopy} label="Copy markdown" />
                      <ActionBtn onClick={handleExportPdfPrint} icon={Printer} label="PDF (print)" />
                      <ActionBtn onClick={() => void handleExportPdfQuick()} icon={FileText} label="PDF (quick)" />
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              /* -------- missing document (edge case) -------- */
              <motion.div
                key="missing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center px-6 py-12 text-center"
              >
                <FileText className="size-8 text-zinc-700" aria-hidden />
                <h3 className="mt-4 text-base font-bold text-zinc-100">This document no longer exists</h3>
                <p className="mt-1 text-xs text-zinc-500">It may have been deleted on this device.</p>
                <Button
                  onClick={backToList}
                  className="mt-5 h-11 rounded-xl bg-gradient-to-r from-purple-300 to-violet-500 px-5 font-semibold text-zinc-950 shadow-lg hover:from-purple-200 hover:to-violet-400"
                >
                  <ArrowLeft className="size-4" aria-hidden /> Back to documents
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>

      {/* ---------------- create / rename modal ---------------- */}
      <AnimatePresence>
        {modalMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setModalMode(null)
            }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={modalMode === 'create' ? 'New document' : 'Rename document'}
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-900/95 p-5 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-100">
                  {modalMode === 'create' ? 'New document' : 'Rename document'}
                </h3>
                <button
                  type="button"
                  onClick={() => setModalMode(null)}
                  aria-label="Close"
                  className="flex size-9 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <label htmlFor="md-doc-name" className="mb-1.5 block text-xs font-medium text-zinc-400">
                Document name
              </label>
              <input
                ref={nameInputRef}
                id="md-doc-name"
                value={modalName}
                onChange={(e) => setModalName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitModal()
                  }
                }}
                maxLength={80}
                placeholder="e.g. Project notes"
                className="h-11 w-full rounded-xl border border-white/10 bg-black/40 px-3.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-purple-400/50 focus:ring-2 focus:ring-purple-400/20"
              />
              <div className="mt-4 grid grid-cols-2 gap-2">
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setModalMode(null)}
                  className="h-11 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/10"
                >
                  Cancel
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={submitModal}
                  className="h-11 rounded-xl bg-gradient-to-r from-purple-300 to-violet-500 text-sm font-bold text-zinc-950 shadow-lg transition-colors hover:from-purple-200 hover:to-violet-400"
                >
                  {modalMode === 'create' ? 'Create' : 'Save'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
