'use client'

/**
 * Diff Checker — compare two texts line by line, fully offline.
 *
 * Paste an "Original" and a "Changed" text; a from-scratch LCS line diff
 * (Hirschberg's linear-space divide & conquer — O(n·m) time, O(min(n, m))
 * memory) aligns both sides. Removed lines get a red tint, added lines a
 * green tint, and adjacent removed+added pairs get word-level highlighting
 * inside the line. Two view modes: synced side-by-side panes or a unified
 * −/＋ gutter list. Options (ignore case / ignore trailing whitespace) feed
 * the comparison while the display always shows the original text. A
 * git-style unified patch (`--- a` / `+++ b` / `@@` headers) can be copied
 * to the clipboard. Inputs and options persist in localStorage.
 */

import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  AlignJustify,
  ArrowLeftRight,
  Columns2,
  Copy,
  Eraser,
  GitCompare,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type Eq<T> = (a: T, b: T) => boolean

type LineOpType = 'equal' | 'delete' | 'insert'

interface LineOp {
  type: LineOpType
  /** index into the original (a) lines; null for pure inserts */
  a: number | null
  /** index into the changed (b) lines; null for pure deletes */
  b: number | null
}

interface WordSeg {
  text: string
  changed: boolean
}

type RowTone = 'equal' | 'del' | 'add' | 'empty'

interface RowView {
  /** 1-based source line number, or null for a placeholder row */
  no: number | null
  text: string
  words: WordSeg[] | null
  tone: RowTone
}

interface UnifiedRow {
  marker: ' ' | '-' | '+'
  aNo: number | null
  bNo: number | null
  text: string
  words: WordSeg[] | null
}

interface DiffStats {
  added: number
  removed: number
  unchanged: number
}

interface DiffResult {
  left: RowView[]
  right: RowView[]
  unified: UnifiedRow[]
  stats: DiffStats
}

type ViewMode = 'split' | 'unified'

interface StoredOpts {
  ignoreCase: boolean
  ignoreTrailing: boolean
  view: ViewMode
}

/* ================================================================== */
/* Constants + persistence (localStorage)                              */
/* ================================================================== */

const KEY_LEFT = 'toolhub-diff-left'
const KEY_RIGHT = 'toolhub-diff-right'
const KEY_OPTS = 'toolhub-diff-opts'

const DEFAULT_OPTS: StoredOpts = { ignoreCase: false, ignoreTrailing: false, view: 'split' }

const AUTO_COMPARE_MS = 400
const PERSIST_MS = 300

/** Above this line count (on either side) a performance warning is shown. */
const DIFF_LINE_WARN = 3000

/** Word-level highlighting bails out on absurdly long single lines. */
const WORD_TOKEN_LIMIT = 800

/** Context lines shown around each hunk in the copied patch. */
const PATCH_CONTEXT = 3

/** Thin glass scrollbar for long lists. */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

function loadStoredText(key: string): string {
  if (typeof window === 'undefined') return ''
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function loadStoredOpts(): StoredOpts {
  if (typeof window === 'undefined') return DEFAULT_OPTS
  try {
    const raw = localStorage.getItem(KEY_OPTS)
    if (!raw) return DEFAULT_OPTS
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_OPTS
    const o = parsed as Record<string, unknown>
    return {
      ignoreCase: o.ignoreCase === true,
      ignoreTrailing: o.ignoreTrailing === true,
      view: o.view === 'unified' ? 'unified' : 'split',
    }
  } catch {
    return DEFAULT_OPTS
  }
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** Split text into display lines; a single trailing "\n" does not add a line. */
function splitLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Key used for line equality (display always renders the original text). */
function normLine(line: string, ignoreCase: boolean, ignoreTrailing: boolean): string {
  let s = line
  if (ignoreTrailing) s = s.replace(/\s+$/, '')
  if (ignoreCase) s = s.toLowerCase()
  return s
}

/** Split a line into word/whitespace tokens (whitespace runs are kept). */
function tokenize(line: string): string[] {
  return line.split(/(\s+)/).filter((t) => t.length > 0)
}

function isWsToken(t: string): boolean {
  return /^\s+$/.test(t)
}

/* ================================================================== */
/* Diff engine — Hirschberg linear-space LCS (from scratch, no deps)   */
/* ================================================================== */

/**
 * LCS score row for `a[ai0..ai1)` against `b[bi0..bi1)`.
 * Forward: entry j = LCS(a-range, b[bi0..bi0+j)).
 * Reverse: entry j = LCS(a-range, b[bi1-j..bi1)) (suffix of length j).
 * Two rows only → O(min-range) memory.
 */
function lcsRow<T>(
  a: readonly T[],
  ai0: number,
  ai1: number,
  b: readonly T[],
  bi0: number,
  bi1: number,
  eq: Eq<T>,
  reverse: boolean
): Int32Array {
  const m = bi1 - bi0
  let prev = new Int32Array(m + 1)
  let curr = new Int32Array(m + 1)
  if (ai1 <= ai0 || bi1 <= bi0) return prev
  const iStart = reverse ? ai1 - 1 : ai0
  const iEnd = reverse ? ai0 - 1 : ai1
  const iStep = reverse ? -1 : 1
  for (let i = iStart; reverse ? i > iEnd : i < iEnd; i += iStep) {
    for (let j = 0; j < m; j++) {
      const bj = reverse ? bi1 - 1 - j : bi0 + j
      curr[j + 1] = eq(a[i], b[bj]) ? prev[j] + 1 : Math.max(prev[j + 1], curr[j])
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev
}

/** Recursive Hirschberg divide & conquer emitting matched index pairs. */
function collectMatches<T>(
  a: readonly T[],
  b: readonly T[],
  eq: Eq<T>,
  ai0: number,
  ai1: number,
  bi0: number,
  bi1: number,
  out: Array<[number, number]>
): void {
  const n = ai1 - ai0
  const m = bi1 - bi0
  if (n <= 0 || m <= 0) return
  if (n === 1) {
    const av = a[ai0]
    for (let j = bi0; j < bi1; j++) {
      if (eq(av, b[j])) {
        out.push([ai0, j])
        return
      }
    }
    return
  }
  if (m === 1) {
    const bv = b[bi0]
    for (let i = ai0; i < ai1; i++) {
      if (eq(a[i], bv)) {
        out.push([i, bi0])
        return
      }
    }
    return
  }
  const mid = ai0 + (n >> 1)
  const forward = lcsRow(a, ai0, mid, b, bi0, bi1, eq, false)
  const backward = lcsRow(a, mid, ai1, b, bi0, bi1, eq, true)
  let bestK = 0
  let bestScore = -1
  for (let k = 0; k <= m; k++) {
    const score = forward[k] + backward[m - k]
    if (score > bestScore) {
      bestScore = score
      bestK = k
    }
  }
  collectMatches(a, b, eq, ai0, mid, bi0, bi0 + bestK, out)
  collectMatches(a, b, eq, mid, ai1, bi0 + bestK, bi1, out)
}

/** LCS index pairs [i, j], ascending on both coordinates. */
function lcsMatches<T>(a: readonly T[], b: readonly T[], eq: Eq<T>): Array<[number, number]> {
  const out: Array<[number, number]> = []
  collectMatches(a, b, eq, 0, a.length, 0, b.length, out)
  out.sort((p, q) => p[0] - q[0] || p[1] - q[1])
  return out
}

/** Expand sorted LCS matches into a full ordered op list (indices absolute). */
function buildLineOps(
  aLen: number,
  bLen: number,
  matches: Array<[number, number]>,
  aiStart: number,
  biStart: number
): LineOp[] {
  const ops: LineOp[] = []
  let ai = aiStart
  let bi = biStart
  for (const [mi, mj] of matches) {
    while (ai < mi) {
      ops.push({ type: 'delete', a: ai, b: null })
      ai++
    }
    while (bi < mj) {
      ops.push({ type: 'insert', a: null, b: bi })
      bi++
    }
    ops.push({ type: 'equal', a: mi, b: mj })
    ai = mi + 1
    bi = mj + 1
  }
  while (ai < aLen) {
    ops.push({ type: 'delete', a: ai, b: null })
    ai++
  }
  while (bi < bLen) {
    ops.push({ type: 'insert', a: null, b: bi })
    bi++
  }
  return ops
}

/** Full line diff with common prefix/suffix trimmed for speed. */
function diffLines(a: readonly string[], b: readonly string[], eq: Eq<string>): LineOp[] {
  const nA = a.length
  const nB = b.length
  let pre = 0
  while (pre < nA && pre < nB && eq(a[pre], b[pre])) pre++
  const sufCap = Math.min(nA, nB) - pre
  let suf = 0
  while (suf < sufCap && eq(a[nA - 1 - suf], b[nB - 1 - suf])) suf++
  const ops: LineOp[] = []
  for (let i = 0; i < pre; i++) ops.push({ type: 'equal', a: i, b: i })
  if (pre + suf < nA || pre + suf < nB) {
    const midMatches = lcsMatches(a.slice(pre, nA - suf), b.slice(pre, nB - suf), eq).map(
      ([i, j]) => [i + pre, j + pre] as [number, number]
    )
    for (const op of buildLineOps(nA - suf, nB - suf, midMatches, pre, pre)) ops.push(op)
  }
  for (let s = 0; s < suf; s++) ops.push({ type: 'equal', a: nA - suf + s, b: nB - suf + s })
  return ops
}

function makeWordEq(ignoreCase: boolean): Eq<string> {
  if (!ignoreCase) return (x, y) => x === y
  return (x, y) => x.toLowerCase() === y.toLowerCase()
}

function markAllChanged(tokens: string[]): WordSeg[] {
  return tokens.map((t) => ({ text: t, changed: !isWsToken(t) }))
}

function toSegments(tokens: string[], changed: boolean[]): WordSeg[] {
  return tokens.map((t, i) => ({ text: t, changed: !isWsToken(t) && changed[i] }))
}

/** Word-level segments for an adjacent removed+added line pair. */
function wordDiff(aLine: string, bLine: string, eq: Eq<string>): [WordSeg[], WordSeg[]] {
  const at = tokenize(aLine)
  const bt = tokenize(bLine)
  if (at.length > WORD_TOKEN_LIMIT || bt.length > WORD_TOKEN_LIMIT) {
    return [markAllChanged(at), markAllChanged(bt)]
  }
  const matched = lcsMatches(at, bt, eq)
  const aChanged: boolean[] = at.map(() => true)
  const bChanged: boolean[] = bt.map(() => true)
  for (const [x, y] of matched) {
    aChanged[x] = false
    bChanged[y] = false
  }
  return [toSegments(at, aChanged), toSegments(bt, bChanged)]
}

/**
 * Build the render models from ops: two pane row lists (kept in lockstep so
 * side-by-side rows align 1:1), one unified row list, and the stats.
 */
function buildViews(a: readonly string[], b: readonly string[], ops: LineOp[], eqWord: Eq<string>): DiffResult {
  const left: RowView[] = []
  const right: RowView[] = []
  const unified: UnifiedRow[] = []
  const stats: DiffStats = { added: 0, removed: 0, unchanged: 0 }
  let i = 0
  while (i < ops.length) {
    const op = ops[i]
    if (op.type === 'equal') {
      const ai = op.a ?? 0
      const bi = op.b ?? 0
      const text = a[ai] ?? ''
      left.push({ no: ai + 1, text, words: null, tone: 'equal' })
      right.push({ no: bi + 1, text: b[bi] ?? '', words: null, tone: 'equal' })
      unified.push({ marker: ' ', aNo: ai + 1, bNo: bi + 1, text, words: null })
      stats.unchanged++
      i++
      continue
    }
    // Gather the whole change block (consecutive deletes + inserts).
    const dels: number[] = []
    const ins: number[] = []
    while (i < ops.length && ops[i].type !== 'equal') {
      const o = ops[i]
      if (o.type === 'delete' && o.a !== null) dels.push(o.a)
      else if (o.type === 'insert' && o.b !== null) ins.push(o.b)
      i++
    }
    // Pair adjacent removed+added lines; extras become pure del/add rows.
    const pairs = Math.min(dels.length, ins.length)
    for (let k = 0; k < pairs; k++) {
      const ai = dels[k]
      const bi = ins[k]
      const lt = a[ai] ?? ''
      const rt = b[bi] ?? ''
      const [ls, rs] = wordDiff(lt, rt, eqWord)
      left.push({ no: ai + 1, text: lt, words: ls, tone: 'del' })
      right.push({ no: bi + 1, text: rt, words: rs, tone: 'add' })
      unified.push({ marker: '-', aNo: ai + 1, bNo: null, text: lt, words: ls })
      unified.push({ marker: '+', aNo: null, bNo: bi + 1, text: rt, words: rs })
      stats.removed++
      stats.added++
    }
    for (let k = pairs; k < dels.length; k++) {
      const ai = dels[k]
      const lt = a[ai] ?? ''
      left.push({ no: ai + 1, text: lt, words: null, tone: 'del' })
      right.push({ no: null, text: '', words: null, tone: 'empty' })
      unified.push({ marker: '-', aNo: ai + 1, bNo: null, text: lt, words: null })
      stats.removed++
    }
    for (let k = pairs; k < ins.length; k++) {
      const bi = ins[k]
      const rt = b[bi] ?? ''
      left.push({ no: null, text: '', words: null, tone: 'empty' })
      right.push({ no: bi + 1, text: rt, words: null, tone: 'add' })
      unified.push({ marker: '+', aNo: null, bNo: bi + 1, text: rt, words: null })
      stats.added++
    }
  }
  return { left, right, unified, stats }
}

/* ================================================================== */
/* Git-style unified patch generation                                  */
/* ================================================================== */

interface Hunk {
  start: number
  end: number
}

function buildHunks(rows: UnifiedRow[]): Hunk[] {
  const changes: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].marker !== ' ') changes.push(i)
  }
  if (changes.length === 0) return []
  const hunks: Hunk[] = []
  let start = Math.max(0, changes[0] - PATCH_CONTEXT)
  let last = changes[0]
  for (let k = 1; k < changes.length; k++) {
    const c = changes[k]
    if (c - last - 1 <= PATCH_CONTEXT * 2) {
      last = c
      continue
    }
    hunks.push({ start, end: Math.min(rows.length, last + 1 + PATCH_CONTEXT) })
    start = Math.max(0, c - PATCH_CONTEXT)
    last = c
  }
  hunks.push({ start, end: Math.min(rows.length, last + 1 + PATCH_CONTEXT) })
  return hunks
}

/** 1-based start + count of one side of a hunk (git semantics for empty sides). */
function hunkSide(rows: UnifiedRow[], hunk: Hunk, side: 'a' | 'b'): { start: number; count: number } {
  let count = 0
  let first: number | null = null
  for (let i = hunk.start; i < hunk.end; i++) {
    const r = rows[i]
    if (side === 'a' ? r.marker === '+' : r.marker === '-') continue
    count++
    const no = side === 'a' ? r.aNo : r.bNo
    if (first === null && no !== null) first = no
  }
  if (count > 0 && first !== null) return { start: first, count }
  // Empty side (pure insertion/deletion): anchor at the previous line number.
  let anchor = 0
  for (let i = hunk.start - 1; i >= 0; i--) {
    const no = side === 'a' ? rows[i].aNo : rows[i].bNo
    if (no !== null) {
      anchor = no
      break
    }
  }
  return { start: anchor, count: 0 }
}

function buildPatch(rows: UnifiedRow[]): string {
  const hunks = buildHunks(rows)
  if (hunks.length === 0) return ''
  const out: string[] = ['--- a/original', '+++ b/changed']
  for (const h of hunks) {
    const sa = hunkSide(rows, h, 'a')
    const sb = hunkSide(rows, h, 'b')
    const ra = sa.count === 1 ? String(sa.start) : `${sa.start},${sa.count}`
    const rb = sb.count === 1 ? String(sb.start) : `${sb.start},${sb.count}`
    out.push(`@@ -${ra} +${rb} @@`)
    for (let i = h.start; i < h.end; i++) {
      const r = rows[i]
      out.push(`${r.marker}${r.text}`)
    }
  }
  return `${out.join('\n')}\n`
}

/* ================================================================== */
/* Sample data — two package.json revisions with visible diffs          */
/* (line 4 has trailing spaces to demo "ignore trailing whitespace")    */
/* ================================================================== */

const SAMPLE_ORIGINAL = [
  '{',
  '  "name": "toolhub-api",',
  '  "version": "1.4.2",',
  '  "private": true,  ',
  '  "scripts": {',
  '    "dev": "next dev",',
  '    "build": "next build",',
  '    "lint": "eslint src"',
  '  },',
  '  "dependencies": {',
  '    "next": "16.0.1",',
  '    "react": "19.0.0"',
  '  },',
  '  "engines": {',
  '    "bun": ">=1.1.0"',
  '  }',
  '}',
].join('\n')

const SAMPLE_CHANGED = [
  '{',
  '  "name": "toolhub-api",',
  '  "version": "1.5.0",',
  '  "private": true,',
  '  "scripts": {',
  '    "dev": "next dev",',
  '    "build": "next build",',
  '    "start": "next start",',
  '    "lint": "eslint src"',
  '  },',
  '  "dependencies": {',
  '    "next": "16.1.0",',
  '    "zod": "3.24.1",',
  '    "react": "19.0.0"',
  '  },',
  '  "engines": {',
  '    "bun": ">=1.2.0"',
  '  }',
  '}',
].join('\n')

/* ================================================================== */
/* UI atoms                                                            */
/* ================================================================== */

function renderWords(words: WordSeg[], side: 'left' | 'right'): ReactNode {
  return words.map((seg, i) =>
    seg.changed ? (
      <span
        key={i}
        className={cn(
          'rounded-[3px]',
          side === 'left' ? 'bg-rose-400/25 text-rose-50' : 'bg-emerald-400/25 text-emerald-50'
        )}
      >
        {seg.text}
      </span>
    ) : (
      <span key={i}>{seg.text}</span>
    )
  )
}

function StatChip(props: { label: string; value: number; className: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums',
        props.className
      )}
    >
      {props.value.toLocaleString('en-US')} {props.label}
    </span>
  )
}

function ToggleOption(props: { id: string; label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 transition-colors hover:bg-white/[0.06]">
      <label htmlFor={props.id} className="min-w-0 cursor-pointer select-none">
        <span className="block text-sm font-medium text-zinc-200">{props.label}</span>
        <span className="block text-[11px] leading-tight text-zinc-500">{props.hint}</span>
      </label>
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onChange} aria-label={props.label} />
    </div>
  )
}

const DiffPane = forwardRef<HTMLDivElement, {
  title: string
  lineCount: number
  rows: RowView[]
  side: 'left' | 'right'
  onScroll: () => void
}>(function DiffPane(props, ref) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{props.title}</span>
        <span className="text-[11px] tabular-nums text-zinc-600">
          {props.lineCount.toLocaleString('en-US')} lines
        </span>
      </div>
      <div
        ref={ref}
        onScroll={props.onScroll}
        className={cn('max-h-96 flex-1 overflow-auto py-1 pr-1 font-mono text-xs leading-[1.55]', THIN_SCROLLBAR)}
      >
        {props.rows.map((row, idx) => (
          <div
            key={idx}
            className={cn(
              'flex min-h-[1.55em] items-start gap-2 px-2',
              row.tone === 'del' && 'bg-rose-500/[0.13] text-rose-200',
              row.tone === 'add' && 'bg-emerald-500/[0.13] text-emerald-200',
              row.tone === 'equal' && 'text-zinc-500',
              row.tone === 'empty' && 'bg-white/[0.015]'
            )}
          >
            <span className="w-10 shrink-0 select-none text-right text-[10px] leading-[1.55] tabular-nums text-zinc-600">
              {row.no ?? ''}
            </span>
            <span className="whitespace-pre">{row.words ? renderWords(row.words, props.side) : row.text}</span>
          </div>
        ))}
        {props.rows.length === 0 && (
          <div className="px-3 py-6 text-center font-sans text-xs text-zinc-600">No lines on this side.</div>
        )}
      </div>
    </div>
  )
})

function UnifiedPane(props: { rows: UnifiedRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] font-mono text-xs leading-[1.55]">
      <div className={cn('max-h-96 overflow-auto py-1 pr-1', THIN_SCROLLBAR)}>
        {props.rows.map((row, idx) => (
          <div
            key={idx}
            className={cn(
              'flex min-h-[1.55em] items-start gap-1.5 px-2',
              row.marker === '-' && 'bg-rose-500/[0.13] text-rose-200',
              row.marker === '+' && 'bg-emerald-500/[0.13] text-emerald-200',
              row.marker === ' ' && 'text-zinc-500'
            )}
          >
            <span className="w-9 shrink-0 select-none text-right text-[10px] leading-[1.55] tabular-nums text-zinc-600">
              {row.aNo ?? ''}
            </span>
            <span className="w-9 shrink-0 select-none text-right text-[10px] leading-[1.55] tabular-nums text-zinc-600">
              {row.bNo ?? ''}
            </span>
            <span
              className={cn(
                'w-4 shrink-0 select-none text-center',
                row.marker === '-' && 'text-rose-400',
                row.marker === '+' && 'text-emerald-400'
              )}
            >
              {row.marker === '-' ? '−' : row.marker === '+' ? '＋' : ''}
            </span>
            <span className="whitespace-pre">
              {row.words ? renderWords(row.words, row.marker === '-' ? 'left' : 'right') : row.text}
            </span>
          </div>
        ))}
        {props.rows.length === 0 && (
          <div className="px-3 py-6 text-center font-sans text-xs text-zinc-600">Nothing to compare.</div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function DiffCheckerApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [original, setOriginal] = useState<string>(() => loadStoredText(KEY_LEFT))
  const [changed, setChanged] = useState<string>(() => loadStoredText(KEY_RIGHT))
  const [opts, setOpts] = useState<StoredOpts>(() => loadStoredOpts())
  const [result, setResult] = useState<DiffResult | null>(null)
  const [runId, setRunId] = useState(0)

  const { ignoreCase, ignoreTrailing, view } = opts

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leftPaneRef = useRef<HTMLDivElement | null>(null)
  const rightPaneRef = useRef<HTMLDivElement | null>(null)
  const scrollLockRef = useRef(false)

  /* ---------------- derived ---------------- */
  const aLines = useMemo(() => splitLines(original), [original])
  const bLines = useMemo(() => splitLines(changed), [changed])
  const bigWarning = aLines.length > DIFF_LINE_WARN || bLines.length > DIFF_LINE_WARN
  const hasChanges = result !== null && result.stats.added + result.stats.removed > 0

  /* ---------------- compare (debounced auto + manual) ---------------- */
  const compute = useCallback(() => {
    const an = aLines.map((l) => normLine(l, ignoreCase, ignoreTrailing))
    const bn = bLines.map((l) => normLine(l, ignoreCase, ignoreTrailing))
    const ops = diffLines(an, bn, (x, y) => x === y)
    setResult(buildViews(aLines, bLines, ops, makeWordEq(ignoreCase)))
    setRunId((r) => r + 1)
  }, [aLines, bLines, ignoreCase, ignoreTrailing])

  useEffect(() => {
    timerRef.current = setTimeout(compute, AUTO_COMPARE_MS)
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [compute])

  const handleCompare = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    compute()
    haptic(12)
  }, [compute])

  /* ---------------- persistence (debounced write-through) ---------------- */
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(KEY_LEFT, original)
        localStorage.setItem(KEY_RIGHT, changed)
        localStorage.setItem(KEY_OPTS, JSON.stringify({ ignoreCase, ignoreTrailing, view }))
      } catch {
        /* private mode / quota — keep session-only */
      }
    }, PERSIST_MS)
    return () => clearTimeout(t)
  }, [original, changed, ignoreCase, ignoreTrailing, view])

  /* ---------------- actions ---------------- */
  const handleSwap = useCallback(() => {
    setOriginal(changed)
    setChanged(original)
  }, [changed, original])

  const handleClear = useCallback(() => {
    setOriginal('')
    setChanged('')
    leftPaneRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    rightPaneRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [])

  const handleSample = useCallback(() => {
    setOriginal(SAMPLE_ORIGINAL)
    setChanged(SAMPLE_CHANGED)
    toast({ title: 'Sample loaded ✓', description: 'Two package.json revisions are ready to compare.' })
  }, [toast])

  const handleCopyPatch = useCallback(async () => {
    if (!result) return
    const patch = buildPatch(result.unified)
    if (patch === '') {
      toast({ title: 'Nothing to copy', description: 'The two inputs are identical (with current options).' })
      return
    }
    const ok = await copyToClipboard(patch)
    haptic(12)
    if (ok) {
      toast({ title: 'Unified diff copied ✓', description: 'Git-style patch text is on your clipboard.' })
    } else {
      toast({ title: 'Copy failed', description: 'Clipboard access was blocked by the browser.', variant: 'destructive' })
    }
  }, [result, toast])

  /** Keep the side-by-side panes' vertical scroll in sync. */
  const syncScroll = useCallback((from: 'left' | 'right') => {
    if (scrollLockRef.current) return
    const src = from === 'left' ? leftPaneRef.current : rightPaneRef.current
    const dst = from === 'left' ? rightPaneRef.current : leftPaneRef.current
    if (!src || !dst || src.scrollTop === dst.scrollTop) return
    scrollLockRef.current = true
    dst.scrollTop = src.scrollTop
    requestAnimationFrame(() => {
      scrollLockRef.current = false
    })
  }, [])

  /* ---------------- option setters ---------------- */
  const updateIgnoreCase = (checked: boolean) => setOpts((o) => ({ ...o, ignoreCase: checked }))
  const updateIgnoreTrailing = (checked: boolean) => setOpts((o) => ({ ...o, ignoreTrailing: checked }))
  const updateView = (mode: ViewMode) => setOpts((o) => ({ ...o, view: mode }))

  return (
    <div className="mx-auto max-w-3xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-sky-500/[0.1] via-transparent to-indigo-500/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(56_189_248/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <GitCompare className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Diff Checker</h2>
              <p className="text-xs text-zinc-400">Line &amp; word-level text comparison — private, offline.</p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          {/* ---------------- Inputs ---------------- */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 px-0.5">
                <label htmlFor="diff-original" className="text-sm font-semibold text-zinc-300">
                  Original
                </label>
                <span className="text-[11px] tabular-nums text-zinc-500">
                  {aLines.length.toLocaleString('en-US')} lines · {original.length.toLocaleString('en-US')} chars
                </span>
              </div>
              <textarea
                id="diff-original"
                value={original}
                onChange={(e) => setOriginal(e.target.value)}
                placeholder="Paste the original text…"
                spellCheck={false}
                wrap="off"
                className="h-40 w-full resize-y rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus:border-sky-400/50 focus:outline-none"
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-baseline justify-between gap-2 px-0.5">
                <label htmlFor="diff-changed" className="text-sm font-semibold text-zinc-300">
                  Changed
                </label>
                <span className="text-[11px] tabular-nums text-zinc-500">
                  {bLines.length.toLocaleString('en-US')} lines · {changed.length.toLocaleString('en-US')} chars
                </span>
              </div>
              <textarea
                id="diff-changed"
                value={changed}
                onChange={(e) => setChanged(e.target.value)}
                placeholder="Paste the changed text…"
                spellCheck={false}
                wrap="off"
                className="h-40 w-full resize-y rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 font-mono text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus:border-sky-400/50 focus:outline-none"
              />
            </div>
          </div>

          {/* ---------------- Toolbar ---------------- */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleCompare}
              className="h-11 min-w-40 flex-1 rounded-xl bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-600 font-semibold text-white shadow-lg hover:from-sky-300 hover:via-blue-400 hover:to-indigo-500 sm:flex-none sm:px-6"
            >
              <GitCompare className="size-4" aria-hidden /> Compare
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleSwap}
              aria-label="Swap the two sides"
              className="h-11 rounded-xl border-white/10 bg-white/5 px-3.5 hover:bg-white/10"
            >
              <ArrowLeftRight className="size-4" aria-hidden />
              <span className="hidden sm:inline">Swap</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleSample}
              aria-label="Load sample texts"
              className="h-11 rounded-xl border-white/10 bg-white/5 px-3.5 hover:bg-white/10"
            >
              <Sparkles className="size-4" aria-hidden />
              <span className="hidden sm:inline">Sample</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleCopyPatch()}
              aria-label="Copy git-style unified diff"
              className="h-11 rounded-xl border-white/10 bg-white/5 px-3.5 hover:bg-white/10"
            >
              <Copy className="size-4" aria-hidden />
              <span className="hidden sm:inline">Copy diff</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClear}
              aria-label="Clear both inputs"
              className="h-11 rounded-xl border-white/10 bg-white/5 px-3.5 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
            >
              <Eraser className="size-4" aria-hidden />
              <span className="hidden sm:inline">Clear</span>
            </Button>
          </div>

          {/* ---------------- Large-input warning ---------------- */}
          {bigWarning && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Large input — up to {Math.max(aLines.length, bLines.length).toLocaleString('en-US')} lines. It still
                works, but comparison may take a moment on older phones.
              </span>
            </div>
          )}

          {/* ---------------- Stats ---------------- */}
          {result && (
            <div className="flex flex-wrap items-center gap-2">
              <StatChip
                label="added"
                value={result.stats.added}
                className="border-emerald-400/20 bg-emerald-500/10 text-emerald-300"
              />
              <StatChip
                label="removed"
                value={result.stats.removed}
                className="border-rose-400/20 bg-rose-500/10 text-rose-300"
              />
              <StatChip
                label="unchanged"
                value={result.stats.unchanged}
                className="border-white/10 bg-white/[0.04] text-zinc-400"
              />
              {!hasChanges && aLines.length + bLines.length > 0 && (
                <span className="text-[11px] text-zinc-500">· inputs match with current options</span>
              )}
            </div>
          )}

          {/* ---------------- Options ---------------- */}
          <div className="space-y-2">
            <p className="px-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Comparison options
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <ToggleOption
                id="diff-opt-ignore-case"
                label="Ignore case"
                hint="'Foo' matches 'foo'"
                checked={ignoreCase}
                onChange={updateIgnoreCase}
              />
              <ToggleOption
                id="diff-opt-ignore-trailing"
                label="Ignore trailing whitespace"
                hint="Skip spaces & tabs at line ends"
                checked={ignoreTrailing}
                onChange={updateIgnoreTrailing}
              />
            </div>
          </div>

          {/* ---------------- Diff views ---------------- */}
          {!result || result.unified.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500/20 to-indigo-500/20 text-sky-300">
                <GitCompare className="size-6" aria-hidden />
              </span>
              <p className="max-w-xs text-sm text-zinc-500">
                Paste text on both sides or load the sample — the comparison appears here automatically.
              </p>
            </div>
          ) : (
            <Tabs value={view} onValueChange={(v) => updateView(v === 'unified' ? 'unified' : 'split')}>
              <TabsList className="grid h-12 w-full grid-cols-2 rounded-xl border border-white/10 bg-white/[0.04] p-1 text-zinc-400">
                <TabsTrigger value="split" className="h-full rounded-lg text-xs font-semibold text-zinc-500! shadow-none data-[state=active]:bg-white/10! data-[state=active]:text-white! data-[state=active]:shadow-none! sm:text-sm">
                  <Columns2 className="size-4" aria-hidden /> Side-by-side
                </TabsTrigger>
                <TabsTrigger value="unified" className="h-full rounded-lg text-xs font-semibold text-zinc-500! shadow-none data-[state=active]:bg-white/10! data-[state=active]:text-white! data-[state=active]:shadow-none! sm:text-sm">
                  <AlignJustify className="size-4" aria-hidden /> Unified
                </TabsTrigger>
              </TabsList>
              <TabsContent value="split" className="mt-0">
                <motion.div
                  key={`split-${runId}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="grid gap-2 sm:grid-cols-2"
                >
                  <DiffPane
                    title="Original"
                    lineCount={aLines.length}
                    rows={result.left}
                    side="left"
                    ref={leftPaneRef}
                    onScroll={() => syncScroll('left')}
                  />
                  <DiffPane
                    title="Changed"
                    lineCount={bLines.length}
                    rows={result.right}
                    side="right"
                    ref={rightPaneRef}
                    onScroll={() => syncScroll('right')}
                  />
                </motion.div>
              </TabsContent>
              <TabsContent value="unified" className="mt-0">
                <motion.div
                  key={`unified-${runId}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                  <UnifiedPane rows={result.unified} />
                </motion.div>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </motion.div>
    </div>
  )
}
