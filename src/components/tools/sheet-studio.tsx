'use client'

/**
 * Sheet Studio — a professional on-device spreadsheet editor (Excel / CSV / ODS).
 *
 * Zero-upload privacy stance: every byte is parsed and written inside the
 * browser. SheetJS (xlsx) is imported dynamically inside async handlers only,
 * so the main bundle stays lean. Data model is deliberately simple — a
 * workbook is a list of sheets, each sheet a rectangular array of RAW cell
 * strings. Formulas ("=SUM(A1:B9)", "=A1*B2", …) are stored raw and evaluated
 * by a tiny recursive-descent engine at render/export time; the cell shows
 * the computed value, the formula bar always shows the raw text.
 *
 * Grid rendering is virtualized (fixed row/column metrics + spacer math) so
 * imported workbooks scroll smoothly; navigation is capped at the first
 * RENDER_ROWS × RENDER_COLS cells with a footer note — exports always include
 * the FULL data. Draft autosave (800 ms debounce) keeps the workbook in
 * localStorage so a reload picks up where you left off.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Columns3,
  Ellipsis,
  Eraser,
  FilePlus2,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  ListPlus,
  Loader2,
  Pencil,
  Plus,
  Redo2,
  ShieldCheck,
  Sigma,
  Sparkles,
  Table2,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Data model                                                          */
/* ================================================================== */

interface SheetT {
  id: string
  name: string
  /** rows[r][c] — raw cell text. '' = empty. '=…' = formula. */
  rows: string[][]
}

type Sel = { r: number; c: number }

interface Snap {
  sheets: SheetT[]
  active: number
}

const DRAFT_KEY = 'toolhub-sheet-draft'
const HISTORY_CAP = 40
const RENDER_ROWS = 500
const RENDER_COLS = 60
const ROW_H = 36
const HEADER_H = 40
const ROW_NUM_W = 48
const COL_W = 104
const MAX_SHEETS = 20
const IMPORT_ROW_CAP = 50_000
const IMPORT_COL_CAP = 256
const BLANK_ROWS = 6
const BLANK_COLS = 12
const FLIMIT = 250_000

const uid = () => `sh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`

const colLabel = (c: number): string => {
  let n = c + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const fmtNum = (n: number): string => {
  if (!Number.isFinite(n)) return '#ERR'
  if (Number.isInteger(n)) return String(n)
  return String(parseFloat(n.toPrecision(12)))
}

const fmtDate = (d: Date): string => {
  const p = (x: number) => String(x).padStart(2, '0')
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  if (d.getHours() || d.getMinutes() || d.getSeconds()) return `${day} ${p(d.getHours())}:${p(d.getMinutes())}`
  return day
}

/** strict numeric text — '42', '-3.5', '1e9' yes; '007', '1,200', '50%' no */
const numeric = (s: string): number | null => {
  const t = s.trim()
  if (t === '' || !/^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const padRows = (rows: string[][]): string[][] => {
  const width = rows.reduce((m, r) => Math.max(m, r.length), 1)
  return rows.map((r) => (r.length === width ? r : [...r, ...Array<string>(width - r.length).fill('')]))
}

/** drop trailing all-empty rows/cols so imported sheets feel tight (min 1×1) */
const trimEmpty = (rows: string[][]): string[][] => {
  let lastRow = -1
  let width = 1
  rows.forEach((row, r) => {
    const last = row.reduce((m, v, c) => (v.trim() !== '' ? c : m), -1)
    if (last >= 0) {
      lastRow = r
      width = Math.max(width, last + 1)
    }
  })
  if (lastRow < 0) return [['']]
  return rows.slice(0, lastRow + 1).map((row) => row.slice(0, width))
}

const cloneSheets = (sheets: SheetT[]): SheetT[] => JSON.parse(JSON.stringify(sheets)) as SheetT[]

const makeBlank = (name: string, rows = BLANK_ROWS, cols = BLANK_COLS): SheetT => ({
  id: uid(),
  name,
  rows: Array.from({ length: rows }, () => Array<string>(cols).fill('')),
})

const sanitizeSheetName = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, 28) || 'Sheet'

const uniqueName = (name: string, taken: Iterable<string>): string => {
  const set = new Set(taken)
  let base = name
  let i = 2
  while (set.has(base)) {
    base = `${name} (${i})`
    i += 1
  }
  return base
}

/** xlsx sheet names: ≤31 chars, no []:*?/\ */
const exportSheetName = (s: string, taken: Set<string>): string => {
  let base = s.replace(/[\\/:*?[\]]/g, ' ').trim().slice(0, 31) || 'Sheet'
  let i = 2
  while (taken.has(base)) {
    base = `${s.slice(0, 27)} (${i})`.trim()
    i += 1
  }
  return base
}

const fileBase = (name: string): string => name.replace(/\.[a-z0-9]+$/i, '').replace(/[\\/:*?"<>|]/g, '').trim() || 'sheet-studio'

const downloadBlob = (data: BlobPart, name: string, mime: string) => {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

const toRaw = (v: unknown): string => {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? fmtNum(v) : ''
  if (v instanceof Date) return fmtDate(v)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

const rangeArr = (a: number, b: number): number[] => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i)

const isSheetT = (v: unknown): v is SheetT => {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Partial<SheetT>
  if (typeof s.name !== 'string' || !Array.isArray(s.rows) || s.rows.length === 0) return false
  if (s.rows.length > 200_000) return false
  return s.rows.every(
    (row) =>
      Array.isArray(row) &&
      row.length <= 4096 &&
      row.every((cell) => typeof cell === 'string' || cell == null),
  )
}

/* ================================================================== */
/* Formula engine — tiny, safe, no eval()                              */
/* supports =SUM/AVERAGE/MIN/MAX/COUNT over ranges, cell refs and      */
/* arithmetic (=A1+B2*2, parentheses, unary minus)                     */
/* ================================================================== */

type Tok =
  | { t: 'num'; v: number }
  | { t: 'ref'; r: number; c: number }
  | { t: 'rng'; r1: number; c1: number; r2: number; c2: number }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'comma' }

const REF_RE = /^([A-Za-z]{1,3})(\d+)$/
const NUM_RE = /^\d*\.?\d+/
const WORD_RE = /^[A-Za-z_][A-Za-z0-9_]*/

const refToCell = (s: string): { r: number; c: number } | null => {
  const m = REF_RE.exec(s)
  if (!m) return null
  let c = 0
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r: parseInt(m[2], 10) - 1, c: c - 1 }
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (ch === ' ' || ch === '\t') {
      i += 1
      continue
    }
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      const m = NUM_RE.exec(src.slice(i))
      if (!m) throw new Error('bad number')
      toks.push({ t: 'num', v: parseFloat(m[0]) })
      i += m[0].length
      continue
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = WORD_RE.exec(src.slice(i))
      if (!m) throw new Error('bad name')
      const word = m[0]
      i += word.length
      let j = i
      while (j < src.length && (src[j] === ' ' || src[j] === '\t')) j += 1
      if (src[j] === '(') {
        toks.push({ t: 'id', v: word.toUpperCase() })
        continue
      }
      const cell = refToCell(word)
      if (!cell) throw new Error(`unknown name "${word}"`)
      let k = i
      while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k += 1
      if (src[k] === ':') {
        k += 1
        while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k += 1
        const m2 = /^[A-Za-z]{1,3}\d+/.exec(src.slice(k))
        if (!m2) throw new Error('bad range')
        const cell2 = refToCell(m2[0])
        if (!cell2) throw new Error('bad range')
        i = k + m2[0].length
        toks.push({ t: 'rng', r1: cell.r, c1: cell.c, r2: cell2.r, c2: cell2.c })
        continue
      }
      toks.push({ t: 'ref', r: cell.r, c: cell.c })
      continue
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      toks.push({ t: 'op', v: ch })
      i += 1
      continue
    }
    if (ch === '(') {
      toks.push({ t: 'lp' })
      i += 1
      continue
    }
    if (ch === ')') {
      toks.push({ t: 'rp' })
      i += 1
      continue
    }
    if (ch === ',' || ch === ';') {
      toks.push({ t: 'comma' })
      i += 1
      continue
    }
    throw new Error(`unexpected "${ch}"`)
  }
  return toks
}

type FNode =
  | { k: 'num'; v: number }
  | { k: 'ref'; r: number; c: number }
  | { k: 'rng'; r1: number; c1: number; r2: number; c2: number }
  | { k: 'bin'; op: string; a: FNode; b: FNode }
  | { k: 'neg'; a: FNode }
  | { k: 'fn'; name: string; args: FNode[] }

function parseTokens(toks: Tok[]): FNode {
  let p = 0
  const peek = (): Tok | undefined => toks[p]
  const next = (): Tok | undefined => toks[p++]

  const parseExpr = (): FNode => {
    let a = parseTerm()
    for (;;) {
      const tk = peek()
      if (tk?.t === 'op' && (tk.v === '+' || tk.v === '-')) {
        next()
        a = { k: 'bin', op: tk.v, a, b: parseTerm() }
      } else return a
    }
  }
  const parseTerm = (): FNode => {
    let a = parseUnary()
    for (;;) {
      const tk = peek()
      if (tk?.t === 'op' && (tk.v === '*' || tk.v === '/')) {
        next()
        a = { k: 'bin', op: tk.v, a, b: parseUnary() }
      } else return a
    }
  }
  const parseUnary = (): FNode => {
    const tk = peek()
    if (tk?.t === 'op' && tk.v === '-') {
      next()
      return { k: 'neg', a: parseUnary() }
    }
    if (tk?.t === 'op' && tk.v === '+') {
      next()
      return parseUnary()
    }
    return parsePrimary()
  }
  const parsePrimary = (): FNode => {
    const tk = next()
    if (!tk) throw new Error('unexpected end')
    if (tk.t === 'num') return { k: 'num', v: tk.v }
    if (tk.t === 'ref') return { k: 'ref', r: tk.r, c: tk.c }
    if (tk.t === 'lp') {
      const e = parseExpr()
      if (next()?.t !== 'rp') throw new Error('missing )')
      return e
    }
    if (tk.t === 'id') {
      if (next()?.t !== 'lp') throw new Error('expected (')
      const args: FNode[] = []
      if (peek()?.t === 'rp') next()
      else {
        for (;;) {
          const nk = peek()
          if (nk?.t === 'rng') {
            next()
            args.push({ k: 'rng', r1: nk.r1, c1: nk.c1, r2: nk.r2, c2: nk.c2 })
          } else args.push(parseExpr())
          const sep = next()
          if (!sep) throw new Error('unexpected end')
          if (sep.t === 'rp') break
          if (sep.t !== 'comma') throw new Error('bad argument list')
        }
      }
      return { k: 'fn', name: tk.v, args }
    }
    if (tk.t === 'rng') throw new Error('range not allowed here')
    throw new Error('unexpected token')
  }

  const ast = parseExpr()
  if (p !== toks.length) throw new Error('unexpected trailing input')
  return ast
}

type RefFn = (r: number, c: number) => number
type RngFn = (r1: number, c1: number, r2: number, c2: number) => number[]

function evalNode(n: FNode, ref: RefFn, rng: RngFn): number {
  switch (n.k) {
    case 'num':
      return n.v
    case 'ref':
      return ref(n.r, n.c)
    case 'neg':
      return -evalNode(n.a, ref, rng)
    case 'bin': {
      const a = evalNode(n.a, ref, rng)
      const b = evalNode(n.b, ref, rng)
      if (n.op === '+') return a + b
      if (n.op === '-') return a - b
      if (n.op === '*') return a * b
      return b === 0 ? NaN : a / b
    }
    case 'rng':
      throw new Error('range not allowed here')
    case 'fn': {
      const nums: number[] = []
      for (const arg of n.args) {
        if (arg.k === 'rng') {
          for (const v of rng(arg.r1, arg.c1, arg.r2, arg.c2)) nums.push(v)
          continue
        }
        const v = evalNode(arg, ref, rng)
        if (Number.isFinite(v)) nums.push(v)
      }
      switch (n.name) {
        case 'SUM': {
          let s = 0
          for (const v of nums) s += v
          return s
        }
        case 'COUNT':
          return nums.length
        case 'AVERAGE': {
          if (!nums.length) return NaN
          let s = 0
          for (const v of nums) s += v
          return s / nums.length
        }
        case 'MIN': {
          if (!nums.length) return 0
          let m = Infinity
          for (const v of nums) if (v < m) m = v
          return m
        }
        case 'MAX': {
          if (!nums.length) return 0
          let m = -Infinity
          for (const v of nums) if (v > m) m = v
          return m
        }
        default:
          throw new Error(`unknown function ${n.name}`)
      }
    }
  }
}

function evalFormula(src: string, ref: RefFn, rng: RngFn): number {
  const toks = tokenize(src)
  if (!toks.length) throw new Error('empty formula')
  return evalNode(parseTokens(toks), ref, rng)
}

/**
 * Numeric value of a cell: null = empty/non-numeric text, NaN = formula error.
 * `cache` memoizes per sheet-content generation; `stack` guards cycles.
 */
function sheetNum(rows: string[][], r: number, c: number, cache: Map<string, number>, stack: Set<string>): number | null {
  const raw = rows[r]?.[c] ?? ''
  if (raw.trim() === '') return null
  if (!raw.startsWith('=')) return numeric(raw)
  const key = `${r}:${c}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  if (stack.has(key)) return NaN
  stack.add(key)
  let out: number
  try {
    out = evalFormula(
      raw.slice(1),
      (rr, cc) => sheetNum(rows, rr, cc, cache, stack) ?? 0,
      (r1, c1, r2, c2) => {
        const ra = Math.min(r1, r2)
        const rb = Math.max(r1, r2)
        const ca = Math.min(c1, c2)
        const cb = Math.max(c1, c2)
        if ((rb - ra + 1) * (cb - ca + 1) > FLIMIT) throw new Error('range too large')
        const nums: number[] = []
        for (let rr = ra; rr <= rb; rr += 1) {
          for (let cc = ca; cc <= cb; cc += 1) {
            const v = sheetNum(rows, rr, cc, cache, stack)
            if (v !== null && Number.isFinite(v)) nums.push(v)
          }
        }
        return nums
      },
    )
  } catch {
    out = NaN
  }
  stack.delete(key)
  cache.set(key, out)
  return out
}

/* ================================================================== */
/* Sample workbook                                                     */
/* ================================================================== */

const SAMPLE: string[][] = [
  ['Item', 'Category', 'Qty', 'Unit cost', 'Total'],
  ['Basmati rice 5kg', 'Grocery', '2', '480', '=C2*D2'],
  ['Chicken 1kg', 'Grocery', '3', '320', '=C3*D3'],
  ['Milk crate', 'Grocery', '1', '960', '=C4*D4'],
  ['Internet bill', 'Utilities', '1', '1200', '=C5*D5'],
  ['Electricity', 'Utilities', '1', '850', '=C6*D6'],
  ['Uber rides', 'Transport', '6', '150', '=C7*D7'],
  ['Movie night', 'Fun', '2', '400', '=C8*D8'],
  ['Gym membership', 'Health', '1', '2000', '=C9*D9'],
  ['', '', '', '', ''],
  ['Monthly total', '', '', '', '=SUM(E2:E9)'],
  ['Average spend', '', '', '', '=AVERAGE(E2:E9)'],
  ['Cheapest item', '', '', '', '=MIN(E2:E9)'],
  ['Priciest item', '', '', '', '=MAX(E2:E9)'],
  ['Items counted', '', '', '', '=COUNT(E2:E9)'],
]

/* ================================================================== */
/* Small presentational pieces                                         */
/* ================================================================== */

function ToolBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
  spinning,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  spinning?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="size-11 rounded-xl border-border/60 bg-card/60 hover:bg-accent dark:bg-card/40"
        >
          {spinning ? <Loader2 className="size-4 animate-spin text-emerald-500" /> : <Icon className="size-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function TabActionBtn({
  icon: Icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className={cn(
            'size-11 rounded-xl text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            danger && 'hover:bg-rose-500/10 hover:text-rose-500',
          )}
        >
          <Icon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

/* ================================================================== */
/* Sheet Studio                                                        */
/* ================================================================== */

export default function SheetStudio() {
  const { toast } = useToast()

  const [book, setBook] = useState<SheetT[] | null>(null) // null → hero
  const [active, setActive] = useState(0)
  const [sel, setSel] = useState<Sel>({ r: 0, c: 0 })
  const [editing, setEditing] = useState(false)
  const [editSource, setEditSource] = useState<'cell' | 'bar'>('cell')
  const [editValue, setEditValue] = useState('')
  const [importing, setImporting] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameText, setRenameText] = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [vp, setVp] = useState({ w: 900, h: 420 })
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [, bumpHist] = useState(0)

  const past = useRef<Snap[]>([])
  const future = useRef<Snap[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const editRef = useRef<Sel | null>(null)
  const cancelRef = useRef(false)
  const quotaToasted = useRef(false)
  const scrollRaf = useRef(0)

  const sheet = book ? (book[Math.min(active, book.length - 1)] ?? book[0]) : null
  const rows = sheet?.rows ?? [['']]
  const dims = { r: rows.length, c: rows[0]?.length ?? 0 }
  const curSel = {
    r: Math.max(0, Math.min(sel.r, Math.max(0, dims.r - 1))),
    c: Math.max(0, Math.min(sel.c, Math.max(0, dims.c - 1))),
  }

  /* formula cache — fresh per active-sheet content generation */
  const fcache = useMemo(() => new Map<string, number>(), [sheet])

  const cellDisplay = useCallback(
    (r: number, c: number): { raw: string; text: string; num: boolean; err: boolean } => {
      const raw = rows[r]?.[c] ?? ''
      if (!raw.startsWith('=')) return { raw, text: raw, num: numeric(raw) !== null, err: false }
      const v = sheetNum(rows, r, c, fcache, new Set<string>())
      if (v === null) return { raw, text: '', num: false, err: false }
      if (!Number.isFinite(v)) return { raw, text: '#ERR', num: false, err: true }
      return { raw, text: fmtNum(v), num: true, err: false }
    },
    [rows, fcache],
  )

  /* ---------- history ---------- */

  const pushHistory = useCallback(() => {
    past.current.push({ sheets: cloneSheets(book ?? []), active })
    if (past.current.length > HISTORY_CAP) past.current.shift()
    future.current = []
    bumpHist((v) => v + 1)
  }, [book, active])

  const resetHistory = useCallback(() => {
    past.current = []
    future.current = []
    bumpHist((v) => v + 1)
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push({ sheets: cloneSheets(book ?? []), active })
    setBook(prev.sheets)
    setActive(Math.min(prev.active, prev.sheets.length - 1))
    bumpHist((v) => v + 1)
  }, [book, active])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push({ sheets: cloneSheets(book ?? []), active })
    setBook(next.sheets)
    setActive(Math.min(next.active, next.sheets.length - 1))
    bumpHist((v) => v + 1)
  }, [book, active])

  const canUndo = past.current.length > 0
  const canRedo = future.current.length > 0

  /* ---------- mutations ---------- */

  const setRows = useCallback(
    (next: string[][]) => {
      if (!book) return
      const idx = Math.min(active, book.length - 1)
      setBook(book.map((s, i) => (i === idx ? { ...s, rows: next } : s)))
    },
    [book, active],
  )

  const setCellAt = useCallback(
    (r: number, c: number, v: string, history: boolean) => {
      if (history) pushHistory()
      const next = rows.slice()
      while (next.length <= r) next.push(Array<string>(Math.max(1, rows[0]?.length ?? 1)).fill(''))
      const row = (next[r] ?? []).slice()
      while (row.length <= c) row.push('')
      row[c] = v
      next[r] = row
      setRows(next)
    },
    [rows, setRows, pushHistory],
  )

  const moveSel = useCallback(
    (dr: number, dc: number) => {
      setSel({
        r: Math.max(0, Math.min(curSel.r + dr, dims.r - 1)),
        c: Math.max(0, Math.min(curSel.c + dc, dims.c - 1)),
      })
    },
    [curSel.r, curSel.c, dims.r, dims.c],
  )

  /* ---------- editing ---------- */

  const beginEdit = useCallback(
    (r: number, c: number, initial?: string, source: 'cell' | 'bar' = 'cell') => {
      if (!book) return
      cancelRef.current = false
      editRef.current = { r, c }
      setEditSource(source)
      setEditValue(initial ?? (rows[r]?.[c] ?? ''))
      setSel({ r, c })
      setEditing(true)
    },
    [book, rows],
  )

  const commitEdit = useCallback(
    (move: 'down' | 'right' | 'none') => {
      const t = editRef.current
      if (t) {
        const cur = rows[t.r]?.[t.c] ?? ''
        if (editValue !== cur) setCellAt(t.r, t.c, editValue, true)
      }
      editRef.current = null
      cancelRef.current = false
      setEditing(false)
      if (move === 'down') moveSel(1, 0)
      else if (move === 'right') moveSel(0, 1)
      gridRef.current?.focus({ preventScroll: true })
    },
    [editValue, rows, setCellAt, moveSel],
  )

  const cancelEdit = useCallback(() => {
    editRef.current = null
    cancelRef.current = true
    setEditing(false)
    gridRef.current?.focus({ preventScroll: true })
  }, [])

  /* caret-at-end focus for the in-cell editor (stable ref — never re-fires) */
  const attachEditor = useCallback((el: HTMLInputElement | null) => {
    if (!el) return
    el.focus()
    const len = el.value.length
    el.setSelectionRange(len, len)
  }, [])

  const onCellPointerDown = useCallback(
    (r: number, c: number) => {
      if (!book) return
      if (editing) {
        if (editRef.current && editRef.current.r === r && editRef.current.c === c) return
        commitEdit('none')
        setSel({ r, c })
        return
      }
      if (curSel.r === r && curSel.c === c) beginEdit(r, c)
      else setSel({ r, c })
    },
    [book, editing, curSel.r, curSel.c, commitEdit, beginEdit],
  )

  const onGridKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!book || editing) return
      const k = e.key
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        const u = k.toLowerCase()
        if (u === 'z') {
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
          return
        }
        if (u === 'y') {
          e.preventDefault()
          redo()
          return
        }
        return
      }
      switch (k) {
        case 'ArrowDown':
          moveSel(1, 0)
          break
        case 'ArrowUp':
          moveSel(-1, 0)
          break
        case 'ArrowLeft':
          moveSel(0, -1)
          break
        case 'ArrowRight':
          moveSel(0, 1)
          break
        case 'Tab':
          moveSel(0, e.shiftKey ? -1 : 1)
          break
        case 'Enter':
        case 'F2':
          beginEdit(curSel.r, curSel.c)
          break
        case 'Backspace':
        case 'Delete': {
          const raw = rows[curSel.r]?.[curSel.c] ?? ''
          if (raw !== '') {
            pushHistory()
            setCellAt(curSel.r, curSel.c, '', false)
          }
          break
        }
        case 'Escape':
          return
        default:
          if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault()
            beginEdit(curSel.r, curSel.c, k)
          }
          return
      }
      e.preventDefault()
    },
    [book, editing, curSel.r, curSel.c, rows, moveSel, beginEdit, pushHistory, setCellAt, undo, redo],
  )

  /* ---------- structural ops ---------- */

  const addRow = useCallback(() => {
    if (!book) return
    pushHistory()
    setRows([...rows, Array<string>(dims.c).fill('')])
  }, [book, pushHistory, setRows, rows, dims.c])

  const addCol = useCallback(() => {
    if (!book) return
    pushHistory()
    setRows(rows.map((row) => [...row, '']))
  }, [book, pushHistory, setRows, rows])

  const delRow = useCallback(() => {
    if (!book) return
    if (rows.length <= 1) {
      toast({ title: 'Cannot delete row', description: 'A sheet needs at least one row.' })
      return
    }
    pushHistory()
    setRows(rows.filter((_, i) => i !== curSel.r))
  }, [book, rows, curSel.r, pushHistory, setRows, toast])

  const delCol = useCallback(() => {
    if (!book) return
    if (dims.c <= 1) {
      toast({ title: 'Cannot delete column', description: 'A sheet needs at least one column.' })
      return
    }
    pushHistory()
    setRows(rows.map((row) => row.filter((_, i) => i !== curSel.c)))
  }, [book, dims.c, curSel.c, rows, pushHistory, setRows, toast])

  const clearCell = useCallback(() => {
    if (!book) return
    const raw = rows[curSel.r]?.[curSel.c] ?? ''
    if (raw === '') return
    pushHistory()
    setCellAt(curSel.r, curSel.c, '', false)
  }, [book, rows, curSel.r, curSel.c, pushHistory, setCellAt])

  /* ---------- sheets ---------- */

  const addSheet = useCallback(() => {
    if (!book) return
    if (book.length >= MAX_SHEETS) {
      toast({ title: 'Sheet limit reached', description: `Up to ${MAX_SHEETS} sheets per workbook.` })
      return
    }
    pushHistory()
    setBook([...book, makeBlank(`Sheet${book.length + 1}`)])
    setActive(book.length)
    setSel({ r: 0, c: 0 })
  }, [book, pushHistory, toast])

  const delSheet = useCallback(() => {
    if (!book) return
    if (book.length <= 1) {
      toast({ title: 'Cannot delete sheet', description: 'Keep at least one sheet in the workbook.' })
      return
    }
    pushHistory()
    const idx = Math.min(active, book.length - 1)
    const next = book.filter((_, i) => i !== idx)
    setBook(next)
    setActive(Math.max(0, Math.min(active, next.length - 1)))
    setSel({ r: 0, c: 0 })
  }, [book, active, pushHistory, toast])

  const commitRename = useCallback(() => {
    if (!book) return
    const name = sanitizeSheetName(renameText)
    setRenameOpen(false)
    if (!renameText.trim() || name === sheet?.name) return
    pushHistory()
    const idx = Math.min(active, book.length - 1)
    setBook(book.map((s, i) => (i === idx ? { ...s, name } : s)))
    toast({ title: 'Sheet renamed', description: name })
  }, [book, active, renameText, sheet?.name, pushHistory, toast])

  const switchSheet = useCallback(
    (i: number) => {
      if (!book || i === Math.min(active, book.length - 1)) return
      if (editing) commitEdit('none')
      setActive(i)
      setSel({ r: 0, c: 0 })
      setScroll({ top: 0, left: 0 })
    },
    [book, active, editing, commitEdit],
  )

  /* ---------- document lifecycle ---------- */

  const startBlank = useCallback(() => {
    resetHistory()
    setBook([makeBlank('Sheet1')])
    setActive(0)
    setSel({ r: 0, c: 0 })
    setFileName('')
    setScroll({ top: 0, left: 0 })
    toast({ title: 'Blank workbook ready', description: `${BLANK_COLS} columns × ${BLANK_ROWS} rows — add more anytime.` })
  }, [resetHistory, toast])

  const loadSample = useCallback(() => {
    resetHistory()
    setBook([{ id: uid(), name: 'Budget sample', rows: padRows(SAMPLE.map((row) => [...row])) }])
    setActive(0)
    setSel({ r: 0, c: 0 })
    setFileName('')
    setScroll({ top: 0, left: 0 })
    toast({ title: 'Sample loaded', description: 'Tap the Total column — formulas recalculate live.' })
  }, [resetHistory, toast])

  /* ---------- import (SheetJS, dynamic) ---------- */

  const onImportFile = useCallback(
    async (f: File) => {
      setImporting(true)
      try {
        const XLSX = await import('xlsx')
        const isText = /\.(csv|tsv|txt)$/i.test(f.name)
        const wb = isText
          ? XLSX.read(await f.text(), { type: 'string', cellDates: true })
          : XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true })
        const sheets: SheetT[] = []
        let cappedRows = false
        let cappedCols = false
        let cappedSheets = false
        for (const rawName of wb.SheetNames) {
          if (sheets.length >= MAX_SHEETS) {
            cappedSheets = true
            break
          }
          const ws = wb.Sheets[rawName]
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }) as unknown[][]
          let imported = aoa.map((row) => row.map(toRaw))
          if (imported.length > IMPORT_ROW_CAP) {
            imported = imported.slice(0, IMPORT_ROW_CAP)
            cappedRows = true
          }
          if (imported.some((row) => row.length > IMPORT_COL_CAP)) {
            imported = imported.map((row) => row.slice(0, IMPORT_COL_CAP))
            cappedCols = true
          }
          imported = padRows(trimEmpty(imported.length > 0 ? imported : [['']]))
          sheets.push({ id: uid(), name: uniqueName(sanitizeSheetName(rawName), sheets.map((s) => s.name)), rows: imported })
        }
        if (!sheets.length) throw new Error('empty workbook')
        resetHistory()
        setBook(sheets)
        setActive(0)
        setSel({ r: 0, c: 0 })
        setFileName(f.name)
        setScroll({ top: 0, left: 0 })
        const totalRows = sheets.reduce((s, sh) => s + sh.rows.length, 0)
        const notes = [
          cappedRows ? `first ${IMPORT_ROW_CAP.toLocaleString()} rows/sheet` : '',
          cappedCols ? `first ${IMPORT_COL_CAP} columns` : '',
          cappedSheets ? `first ${MAX_SHEETS} sheets` : '',
        ].filter(Boolean)
        toast({
          title: 'Imported successfully',
          description: `${sheets.length} sheet${sheets.length > 1 ? 's' : ''} · ${totalRows.toLocaleString()} rows — parsed on-device, nothing uploaded.${notes.length ? ` Kept ${notes.join(', ')}.` : ''}`,
        })
      } catch {
        toast({
          title: 'Could not read that file',
          description: 'It may be corrupted or in an unsupported format. Try .xlsx, .xls, .csv or .ods.',
          variant: 'destructive',
        })
      } finally {
        setImporting(false)
      }
    },
    [resetHistory, toast],
  )

  /* ---------- export ---------- */

  const exportBase = useCallback(() => fileBase(fileName || 'sheet-studio'), [fileName])

  const exportXlsx = useCallback(async () => {
    if (!book) return
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()
      const taken = new Set<string>()
      for (const s of book) {
        const name = exportSheetName(s.name, taken)
        taken.add(name)
        /* plain numeric text becomes real numbers; formulas patched below */
        const aoa = s.rows.map((row) => row.map((raw) => numeric(raw) ?? raw))
        const ws = XLSX.utils.aoa_to_sheet(aoa)
        const cache = new Map<string, number>()
        s.rows.forEach((row, r) => {
          row.forEach((raw, c) => {
            if (!raw.startsWith('=')) return
            const v = sheetNum(s.rows, r, c, cache, new Set<string>())
            const addr = XLSX.utils.encode_cell({ r, c })
            if (v !== null && Number.isFinite(v)) ws[addr] = { t: 'n', f: raw.slice(1), v }
            else ws[addr] = { t: 's', v: raw }
          })
        })
        XLSX.utils.book_append_sheet(wb, ws, name)
      }
      const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
      downloadBlob(out, `${exportBase()}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      toast({
        title: 'XLSX exported',
        description: `${book.length} sheet${book.length > 1 ? 's' : ''} · formulas included — check your downloads.`,
      })
    } catch {
      toast({ title: 'Export failed', description: 'Something went wrong while building the workbook.', variant: 'destructive' })
    }
  }, [book, exportBase, toast])

  const exportCsv = useCallback(() => {
    if (!book) return
    const esc = (s: string) => (/[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    const cache = new Map<string, number>()
    const lines = rows.map((row, r) =>
      row
        .map((_, c) => {
          const raw = row[c] ?? ''
          if (!raw.startsWith('=')) return esc(raw)
          const v = sheetNum(rows, r, c, cache, new Set<string>())
          return esc(v !== null && Number.isFinite(v) ? fmtNum(v) : raw)
        })
        .join(','),
    )
    downloadBlob(`\uFEFF${lines.join('\r\n')}`, `${exportBase()}.csv`, 'text/csv;charset=utf-8')
    toast({ title: 'CSV exported', description: `“${sheet?.name ?? 'Sheet'}” with computed values — check your downloads.` })
  }, [book, rows, sheet?.name, exportBase, toast])

  /* ---------- draft autosave + hydration ---------- */

  useEffect(() => {
    if (!hydrated) return
    const t = window.setTimeout(() => {
      try {
        if (!book) {
          localStorage.removeItem(DRAFT_KEY)
          return
        }
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ v: 1, at: Date.now(), active, fileName, sheets: book }))
        quotaToasted.current = false
      } catch {
        if (!quotaToasted.current) {
          quotaToasted.current = true
          toast({
            title: 'Draft too large to autosave',
            description: 'Your edits stay in memory — export the file to keep them.',
          })
        }
      }
    }, 800)
    return () => window.clearTimeout(t)
  }, [book, active, fileName, hydrated, toast])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let restored: SheetT[] | null = null
      let restoredActive = 0
      let restoredName = ''
      try {
        await Promise.resolve() // async boundary — hydration after paint
        const raw = localStorage.getItem(DRAFT_KEY)
        if (raw) {
          const d = JSON.parse(raw) as { active?: unknown; fileName?: unknown; sheets?: unknown }
          if (Array.isArray(d.sheets) && d.sheets.length > 0 && d.sheets.every(isSheetT)) {
            restored = (d.sheets as SheetT[]).map((s) => ({
              id: uid(),
              name: s.name,
              rows: padRows(s.rows.map((row) => row.map((cell) => cell ?? ''))),
            }))
            restoredActive =
              typeof d.active === 'number' && d.active >= 0
                ? Math.min(Math.floor(d.active), restored.length - 1)
                : 0
            restoredName = typeof d.fileName === 'string' ? d.fileName : ''
          }
        }
      } catch {
        /* corrupt draft — start fresh */
      }
      if (cancelled) return
      if (restored) {
        setBook(restored)
        setActive(restoredActive)
        if (restoredName) setFileName(restoredName)
        toast({ title: 'Draft restored', description: 'Your workbook was autosaved on this device.' })
      }
      setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [toast])

  /* ---------- viewport measure + scroll windowing ---------- */

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setVp({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [book, hydrated])

  useEffect(() => {
    return () => {
      if (scrollRaf.current) window.cancelAnimationFrame(scrollRaf.current)
    }
  }, [])

  const onGridScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (scrollRaf.current) return
    scrollRaf.current = window.requestAnimationFrame(() => {
      scrollRaf.current = 0
      setScroll({ top: el.scrollTop, left: el.scrollLeft })
    })
  }, [])

  /* keep the selected cell inside the viewport (header/row-num aware) */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !book) return
    if (scroll.top === 0 && scroll.left === 0 && (el.scrollTop !== 0 || el.scrollLeft !== 0)) {
      el.scrollTop = 0
      el.scrollLeft = 0
      return
    }
    const top = HEADER_H + curSel.r * ROW_H
    const bottom = top + ROW_H
    if (top - HEADER_H < el.scrollTop) el.scrollTop = top - HEADER_H
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    const left = ROW_NUM_W + curSel.c * COL_W
    const right = left + COL_W
    if (left - ROW_NUM_W < el.scrollLeft) el.scrollLeft = left - ROW_NUM_W
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth
  }, [book, curSel.r, curSel.c, scroll.top, scroll.left])

  /* ---------- derived grid window ---------- */

  const viewRows = Math.min(dims.r, RENDER_ROWS)
  const viewCols = Math.min(dims.c, RENDER_COLS)
  const truncated = dims.r > RENDER_ROWS || dims.c > RENDER_COLS
  const r0 = Math.max(0, Math.min(Math.floor(scroll.top / ROW_H) - 4, viewRows - 1))
  const r1 = Math.min(viewRows, r0 + Math.ceil(vp.h / ROW_H) + 8)
  const c0 = Math.max(0, Math.min(Math.floor(scroll.left / COL_W) - 2, viewCols - 1))
  const c1 = Math.min(viewCols, c0 + Math.ceil(vp.w / COL_W) + 4)
  const barRaw = rows[curSel.r]?.[curSel.c] ?? ''
  const barValue = editing ? editValue : barRaw

  /* ================================================================== */
  /* Empty state hero                                                    */
  /* ================================================================== */

  if (!book) {
    return (
      <div className="flex flex-col gap-4">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv,.ods,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet,text/csv"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void onImportFile(f)
          }}
        />
        {hydrated ? (
          <div className="flex min-h-[62dvh] flex-col items-center justify-center px-2 py-10 text-center">
            <div className="relative mb-6">
              <div className="absolute -inset-3 rounded-[2rem] bg-emerald-500/25 blur-2xl" aria-hidden />
              <div className="relative flex size-20 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-400 via-teal-500 to-teal-700 text-white shadow-lg shadow-emerald-500/25 ring-1 ring-black/10">
                <Table2 className="size-10" aria-hidden />
              </div>
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Sheet Studio</h2>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Edit Excel, CSV and ODS spreadsheets right on your device — multiple sheets, live formulas and clean
              exports included.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
              <Button
                size="lg"
                onClick={startBlank}
                className="h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 px-5 text-white shadow-md shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-500"
              >
                <FilePlus2 className="size-4" aria-hidden /> New blank sheet
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={importing}
                className="h-11 rounded-xl border-border/60 bg-card/60 px-5 backdrop-blur"
              >
                {importing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FolderOpen className="size-4" aria-hidden />}
                Import file
              </Button>
              <Button
                size="lg"
                variant="ghost"
                onClick={loadSample}
                className="h-11 rounded-xl px-5 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                <Sparkles className="size-4" aria-hidden /> Load sample
              </Button>
            </div>
            <p className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3.5 py-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="size-3.5" aria-hidden />
              Files never leave your device — 100% offline parsing
            </p>
          </div>
        ) : (
          <div className="flex min-h-[62dvh] items-center justify-center">
            <Loader2 className="size-6 animate-spin text-emerald-500" aria-hidden />
          </div>
        )}
      </div>
    )
  }

  /* ================================================================== */
  /* Editor                                                              */
  /* ================================================================== */

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv,.ods,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet,text/csv"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void onImportFile(f)
        }}
      />

      {/* ---------- sticky toolbar + formula bar ---------- */}
      <div className="sticky top-0 z-30 -mx-4 mb-1 border-b bg-background/85 px-3 py-2 backdrop-blur-xl sm:-mx-6 sm:px-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <ToolBtn icon={Undo2} label="Undo" onClick={undo} disabled={!canUndo} />
          <ToolBtn icon={Redo2} label="Redo" onClick={redo} disabled={!canRedo} />
          <Separator orientation="vertical" className="mx-1 h-7" />
          <ToolBtn icon={ListPlus} label="Add row" onClick={addRow} />
          <ToolBtn icon={Columns3} label="Add column" onClick={addCol} />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="More cell and sheet actions"
                    className="size-11 rounded-xl border-border/60 bg-card/60 hover:bg-accent dark:bg-card/40"
                  >
                    <Ellipsis className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">More actions</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="rounded-xl">
              <DropdownMenuItem onClick={delRow}>
                <Trash2 className="size-4 text-rose-500" aria-hidden /> Delete row {curSel.r + 1}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={delCol}>
                <Trash2 className="size-4 text-rose-500" aria-hidden /> Delete column {colLabel(curSel.c)}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={clearCell}>
                <Eraser className="size-4" aria-hidden /> Clear cell
                <DropdownMenuShortcut>Del</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setRenameText(sheet?.name ?? '')
                  setRenameOpen(true)
                }}
              >
                <Pencil className="size-4" aria-hidden /> Rename sheet
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Separator orientation="vertical" className="mx-1 h-7" />
          <ToolBtn icon={FilePlus2} label="New workbook" onClick={() => setNewOpen(true)} />
          <ToolBtn icon={FolderOpen} label="Import file" onClick={() => fileRef.current?.click()} disabled={importing} spinning={importing} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                className="h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 px-4 text-white shadow-md shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-500"
              >
                <FileSpreadsheet className="size-4" aria-hidden />
                Export
                <ChevronDown className="size-4 opacity-80" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="rounded-xl">
              <DropdownMenuItem onClick={() => void exportXlsx()}>
                <FileSpreadsheet className="size-4 text-emerald-500" aria-hidden /> XLSX workbook
                <span className="ml-1 text-[11px] text-muted-foreground">all sheets · formulas</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportCsv}>
                <FileText className="size-4 text-emerald-500" aria-hidden /> CSV file
                <span className="ml-1 text-[11px] text-muted-foreground">“{sheet?.name}” only</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Badge
            variant="outline"
            aria-live="polite"
            aria-label={`Selected cell ${colLabel(curSel.c)}${curSel.r + 1}`}
            className="h-10 w-14 shrink-0 justify-center rounded-lg border-emerald-500/40 bg-emerald-500/10 font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-300"
          >
            {colLabel(curSel.c)}
            {curSel.r + 1}
          </Badge>
          <div className="relative min-w-0 flex-1">
            <Sigma
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-emerald-500/80"
              aria-hidden
            />
            <Input
              value={barValue}
              placeholder="Value or =SUM(A1:B9) · =A1*B2"
              aria-label="Formula bar — shows the raw content of the selected cell"
              spellCheck={false}
              autoComplete="off"
              className="h-10 rounded-lg border-border/60 bg-card/60 pl-8 font-mono text-[13px]"
              onChange={(e) => {
                const v = e.target.value
                if (editing && editRef.current) setEditValue(v)
                else beginEdit(curSel.r, curSel.c, v, 'bar')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitEdit('down')
                } else if (e.key === 'Tab') {
                  e.preventDefault()
                  commitEdit('right')
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  cancelEdit()
                }
              }}
              onBlur={() => {
                if (editing && !cancelRef.current) commitEdit('none')
              }}
            />
          </div>
        </div>
      </div>

      {/* ---------- grid ---------- */}
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur">
        <div
          ref={scrollRef}
          role="grid"
          aria-label="Spreadsheet grid"
          aria-rowcount={dims.r}
          aria-colcount={dims.c}
          tabIndex={0}
          onScroll={onGridScroll}
          onKeyDown={onGridKeyDown}
          className="relative h-[calc(100dvh-24rem)] max-h-[760px] min-h-[300px] overflow-auto overscroll-contain bg-card/40 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-emerald-500/40"
        >
          <div
            className="relative"
            style={{ width: ROW_NUM_W + viewCols * COL_W, height: HEADER_H + viewRows * ROW_H }}
          >
            {/* column header row */}
            <div
              role="row"
              className="sticky top-0 z-20 flex border-b bg-card shadow-[0_1px_2px_0_rgb(0_0_0/0.06)]"
              style={{ height: HEADER_H }}
            >
              <div
                role="columnheader"
                aria-label="Row numbers"
                className="sticky left-0 z-10 flex shrink-0 items-center justify-center border-r bg-card text-muted-foreground/50"
                style={{ width: ROW_NUM_W, height: HEADER_H }}
              >
                <Table2 className="size-3.5" aria-hidden />
              </div>
              <div className="shrink-0" style={{ width: c0 * COL_W }} aria-hidden />
              {rangeArr(c0, c1).map((c) => (
                <div
                  key={c}
                  role="columnheader"
                  aria-label={`Column ${colLabel(c)}`}
                  className={cn(
                    'flex shrink-0 items-center justify-center border-r text-[11px] font-semibold tracking-wider text-muted-foreground transition-colors',
                    c === curSel.c && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                  )}
                  style={{ width: COL_W, height: HEADER_H }}
                >
                  {colLabel(c)}
                </div>
              ))}
            </div>

            {/* virtualized body */}
            <div style={{ height: r0 * ROW_H }} aria-hidden />
            {rangeArr(r0, r1).map((r) => (
              <div key={r} role="row" className="flex" style={{ height: ROW_H }}>
                <div
                  role="rowheader"
                  aria-label={`Row ${r + 1}`}
                  className={cn(
                    'sticky left-0 z-10 flex shrink-0 items-center justify-center border-b border-r bg-card text-[11px] font-medium text-muted-foreground transition-colors',
                    r === curSel.r && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                  )}
                  style={{ width: ROW_NUM_W, height: ROW_H }}
                >
                  {r + 1}
                </div>
                <div className="shrink-0" style={{ width: c0 * COL_W }} aria-hidden />
                {rangeArr(c0, c1).map((c) => {
                  const d = cellDisplay(r, c)
                  const isSel = r === curSel.r && c === curSel.c
                  const isEdit = isSel && editing && editSource === 'cell'
                  return (
                    <div
                      key={c}
                      data-cell={`${r}:${c}`}
                      role="gridcell"
                      aria-selected={isSel}
                      aria-label={`${colLabel(c)}${r + 1}`}
                      title={d.err || d.raw.startsWith('=') ? `${d.raw} → ${d.text}` : d.text}
                      onPointerDown={() => onCellPointerDown(r, c)}
                      onDoubleClick={() => {
                        if (!editing) beginEdit(r, c)
                      }}
                      className={cn(
                        'relative shrink-0 overflow-hidden border-b border-r border-border/40 px-2 text-[13px] leading-none outline-none transition-colors hover:bg-accent/30',
                        d.num ? 'text-right font-mono' : 'text-left',
                        (r & 1) === 1 && 'bg-muted/20',
                        isSel && 'z-[5] bg-emerald-500/10 ring-2 ring-inset ring-emerald-500 hover:bg-emerald-500/10',
                        d.err && 'font-semibold text-rose-500',
                      )}
                      style={{ width: COL_W, height: ROW_H }}
                    >
                      {!isEdit && d.text !== '' && <span className="flex h-full items-center truncate">{d.text}</span>}
                      {isEdit && (
                        <input
                          ref={attachEditor}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              commitEdit('down')
                            } else if (e.key === 'Tab') {
                              e.preventDefault()
                              commitEdit('right')
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              cancelEdit()
                            }
                            e.stopPropagation()
                          }}
                          onBlur={() => {
                            if (!cancelRef.current) commitEdit('none')
                          }}
                          aria-label={`Edit ${colLabel(c)}${r + 1}`}
                          spellCheck={false}
                          autoComplete="off"
                          className="absolute inset-0 z-20 h-full w-full bg-background px-2 font-mono text-[13px] outline-none ring-2 ring-inset ring-emerald-500"
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* grid footer */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t bg-card/60 px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="font-mono">
            {dims.r.toLocaleString()} rows × {dims.c.toLocaleString()} cols
            {truncated && (
              <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 font-sans font-medium text-amber-700 dark:text-amber-400">
                showing first {RENDER_ROWS}×{RENDER_COLS}
              </span>
            )}
          </span>
          <span className={cn('hidden sm:inline', truncated && 'sm:hidden')}>
            Tap a cell · tap again to edit · Enter ↓ · Tab →
          </span>
          {truncated && (
            <span className="text-amber-700 dark:text-amber-400">
              Large sheet — exports always include every row and column.
            </span>
          )}
        </div>
      </div>

      {/* ---------- sheet tabs ---------- */}
      <div className="flex items-center gap-1.5">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" aria-label="Workbook sheets">
          {book.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={i === Math.min(active, book.length - 1)}
              onClick={() => switchSheet(i)}
              className={cn(
                'h-11 shrink-0 rounded-xl px-3.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50',
                i === Math.min(active, book.length - 1)
                  ? 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/40 dark:text-emerald-300'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              <span className="block max-w-28 truncate">{s.name}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <TabActionBtn icon={Plus} label="Add sheet" onClick={addSheet} disabled={book.length >= MAX_SHEETS} />
          <TabActionBtn
            icon={Pencil}
            label="Rename sheet"
            onClick={() => {
              setRenameText(sheet?.name ?? '')
              setRenameOpen(true)
            }}
          />
          <TabActionBtn icon={Trash2} label="Delete sheet" onClick={delSheet} disabled={book.length <= 1} danger />
        </div>
      </div>

      {/* ---------- rename dialog ---------- */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="max-w-sm rounded-2xl">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              commitRename()
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename sheet</DialogTitle>
              <DialogDescription>Give “{sheet?.name}” a clearer name.</DialogDescription>
            </DialogHeader>
            <Input
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              maxLength={28}
              autoFocus
              aria-label="Sheet name"
              className="mt-2 h-10 rounded-lg"
            />
            <DialogFooter className="mt-4 gap-2">
              <Button type="button" variant="ghost" className="rounded-xl" onClick={() => setRenameOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!renameText.trim()}
                className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white hover:from-emerald-400 hover:to-teal-500"
              >
                Save name
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ---------- new workbook confirm ---------- */}
      <AlertDialog open={newOpen} onOpenChange={setNewOpen}>
        <AlertDialogContent className="max-w-sm rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Start a new workbook?</AlertDialogTitle>
            <AlertDialogDescription>
              All current sheets will be cleared and the autosaved draft replaced. Export first if you still need them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={startBlank}
              className="rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white hover:from-emerald-400 hover:to-teal-500"
            >
              New workbook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
