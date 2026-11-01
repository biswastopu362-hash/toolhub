'use client'

/**
 * Task Board — a daily kanban for small plans.
 *
 * Multiple boards with three fixed columns (To Do / Doing / Done). Cards carry
 * a title, optional note, due date and priority. Drag & drop reorders cards
 * within a column and across columns (dnd-kit), with chevron buttons as a
 * touch/keyboard fallback. Due-date badges flag overdue, due-today and
 * due-soon tasks. Everything persists in IndexedDB — private, offline, instant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Pencil,
  Plus,
  Sparkles,
  SquareKanban,
  Trash2,
  X,
} from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { DragEndEvent, DragOverEvent, DragStartEvent, Over } from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type ColumnId = 'todo' | 'doing' | 'done'

type Priority = 'low' | 'med' | 'high'

interface Card {
  id: string
  title: string
  note: string
  /** ISO date (YYYY-MM-DD) from the native date input */
  due?: string
  priority: Priority
  column: ColumnId
  /** integer position within the column, recomputed on every move */
  order: number
  createdAt: number
  doneAt?: number
}

interface Board {
  id: string
  name: string
  createdAt: number
  cards: Card[]
}

const COLUMN_IDS: ColumnId[] = ['todo', 'doing', 'done']

interface ColumnMeta {
  label: string
  dot: string
  headerBg: string
}

const COLUMN_META: Record<ColumnId, ColumnMeta> = {
  todo: {
    label: 'To Do',
    dot: 'bg-zinc-400',
    headerBg: 'bg-gradient-to-r from-zinc-400/[0.09] to-transparent',
  },
  doing: {
    label: 'Doing',
    dot: 'bg-amber-400',
    headerBg: 'bg-gradient-to-r from-amber-400/[0.11] to-transparent',
  },
  done: {
    label: 'Done',
    dot: 'bg-emerald-400',
    headerBg: 'bg-gradient-to-r from-emerald-400/[0.11] to-transparent',
  },
}

interface PriorityMeta {
  label: string
  chip: string
  dot: string
}

const PRIORITY_META: Record<Priority, PriorityMeta> = {
  low: {
    label: 'Low',
    chip: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    dot: 'bg-emerald-400',
  },
  med: {
    label: 'Med',
    chip: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    dot: 'bg-amber-400',
  },
  high: {
    label: 'High',
    chip: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    dot: 'bg-rose-400',
  },
}

/* ================================================================== */
/* IndexedDB — boards, fully on-device (write-through)                 */
/* ================================================================== */

const DB_NAME = 'toolhub-taskboard'
const DB_VERSION = 1
const BOARDS_STORE = 'boards'

let dbPromise: Promise<IDBDatabase> | null = null

function openBoardsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(BOARDS_STORE)) d.createObjectStore(BOARDS_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openBoardsDb()
  return dbPromise
}

function idbGetAll(store: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readonly').objectStore(store).getAll()
        req.onsuccess = () => resolve((req.result ?? []) as unknown[])
        req.onerror = () => reject(req.error ?? new Error('IndexedDB getAll failed'))
      })
      .catch(reject)
  })
}

function idbPut(value: Board): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(BOARDS_STORE, 'readwrite').objectStore(BOARDS_STORE).put(value)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'))
      })
      .catch(reject)
  })
}

function idbDelete(key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(BOARDS_STORE, 'readwrite').objectStore(BOARDS_STORE).delete(key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
      })
      .catch(reject)
  })
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

/** crypto.randomUUID() with a string-slice fallback. */
function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* fall through to the manual fallback */
  }
  return `tb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

/** Thin glass scrollbar for long lists. */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/** Dark-glass overrides for shadcn Input inside the always-dark shell. */
const INPUT_CLS =
  'h-11 w-full rounded-xl border-white/10 bg-white/5 dark:bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 shadow-none [color-scheme:dark] focus-visible:border-amber-400/50 focus-visible:ring-0'

/** Dark-glass overrides for shadcn Textarea inside the always-dark shell. */
const TEXTAREA_CLS =
  'min-h-24 w-full rounded-xl border-white/10 bg-white/5 dark:bg-white/5 p-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 shadow-none [color-scheme:dark] focus-visible:border-amber-400/50 focus-visible:ring-0'

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function byOrder(a: Card, b: Card): number {
  return a.order - b.order || a.createdAt - b.createdAt
}

function isColumnId(v: unknown): v is ColumnId {
  return v === 'todo' || v === 'doing' || v === 'done'
}

function isPriority(v: unknown): v is Priority {
  return v === 'low' || v === 'med' || v === 'high'
}

/** Re-assign dense integer positions 0..n-1 per column (stable: order, then createdAt). */
function normalizeOrders(cards: Card[]): Card[] {
  const columns: Record<ColumnId, Card[]> = { todo: [], doing: [], done: [] }
  for (const c of cards) columns[c.column].push(c)
  const out: Card[] = []
  for (const col of COLUMN_IDS) {
    const sorted = [...columns[col]].sort(byOrder)
    let i = 0
    for (const c of sorted) {
      out.push({ ...c, order: i })
      i++
    }
  }
  return out
}

/**
 * Move a card to `toColumn` at `toIndex` (index in the target column computed
 * WITHOUT the card itself) and recompute integer orders for all columns.
 * Moving into Done stamps doneAt; moving out clears it.
 */
function moveCard(cards: Card[], cardId: string, toColumn: ColumnId, toIndex: number): Card[] {
  const card = cards.find((c) => c.id === cardId)
  if (!card) return cards
  const columns: Record<ColumnId, Card[]> = { todo: [], doing: [], done: [] }
  for (const c of cards) {
    if (c.id === cardId) continue
    columns[c.column].push(c)
  }
  for (const col of COLUMN_IDS) columns[col].sort(byOrder)
  const moved: Card = {
    ...card,
    column: toColumn,
    doneAt: toColumn === 'done' ? (card.doneAt ?? Date.now()) : undefined,
  }
  const idx = clamp(toIndex, 0, columns[toColumn].length)
  columns[toColumn].splice(idx, 0, moved)
  const out: Card[] = []
  for (const col of COLUMN_IDS) {
    let i = 0
    for (const c of columns[col]) {
      out.push({ ...c, order: i })
      i++
    }
  }
  return out
}

/** Insert position for `activeId` before `overCardId` in `column` (active excluded). */
function insertIndex(cards: Card[], column: ColumnId, overCardId: string | null, activeId: string): number {
  const list = cards
    .filter((c) => c.column === column && c.id !== activeId)
    .sort(byOrder)
    .map((c) => c.id)
  if (!overCardId || overCardId === activeId) return list.length
  const idx = list.indexOf(overCardId)
  return idx === -1 ? list.length : idx
}

interface OverTarget {
  column: ColumnId
  cardId: string | null
}

/** Resolve a dnd-kit `over` into a column + optional card id, using live state. */
function resolveOver(cards: Card[], over: Over | null | undefined): OverTarget | null {
  if (!over) return null
  const data = (over.data.current ?? {}) as { type?: string; column?: unknown }
  if (data.type === 'column' && isColumnId(data.column)) return { column: data.column, cardId: null }
  if (typeof over.id !== 'string') return null
  const card = cards.find((c) => c.id === over.id)
  if (card) return { column: card.column, cardId: card.id }
  return null
}

/** Cheap change signature to avoid needless writes/rerenders. */
function sig(cards: Card[]): string {
  return cards.map((c) => `${c.id}:${c.column}:${c.order}`).join('|')
}

/* ---------------- due dates ---------------- */

function parseDue(due: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(due)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const dt = new Date(y, mo - 1, d)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function startOfToday(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

function formatDue(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

interface DueBadgeInfo {
  label: string
  className: string
}

/** Overdue (rose, "2d late") / today (amber) / soon ≤3d (amber outline) / future (neutral). */
function dueBadge(due: string): DueBadgeInfo | null {
  const d = parseDue(due)
  if (!d) return null
  const diffDays = Math.round((d.getTime() - startOfToday().getTime()) / 86400000)
  const dateLabel = formatDue(d)
  if (diffDays < 0) {
    return { label: `${dateLabel} · ${-diffDays}d late`, className: 'border-rose-500/40 bg-rose-500/15 text-rose-300' }
  }
  if (diffDays === 0) {
    return { label: 'Today', className: 'border-amber-500/40 bg-amber-500/15 text-amber-300' }
  }
  if (diffDays <= 3) {
    return { label: dateLabel, className: 'border-amber-500/40 bg-transparent text-amber-300/90' }
  }
  return { label: dateLabel, className: 'border-white/10 bg-white/[0.04] text-zinc-400' }
}

/** ISO date string offset from today (used by the sample board). */
function dateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/* ---------------- tolerant restore ---------------- */

function sanitizeBoard(raw: unknown): Board | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null
  const cardsRaw = Array.isArray(r.cards) ? r.cards : []
  const cards: Card[] = []
  for (const rc of cardsRaw) {
    if (typeof rc !== 'object' || rc === null) continue
    const c = rc as Record<string, unknown>
    if (typeof c.id !== 'string' || typeof c.title !== 'string') continue
    if (!isColumnId(c.column) || !isPriority(c.priority)) continue
    cards.push({
      id: c.id,
      title: c.title,
      note: typeof c.note === 'string' ? c.note : '',
      due: typeof c.due === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.due) ? c.due : undefined,
      priority: c.priority,
      column: c.column,
      order: typeof c.order === 'number' && Number.isFinite(c.order) ? c.order : 0,
      createdAt: typeof c.createdAt === 'number' && Number.isFinite(c.createdAt) ? c.createdAt : Date.now(),
      doneAt: typeof c.doneAt === 'number' && Number.isFinite(c.doneAt) ? c.doneAt : undefined,
    })
  }
  return {
    id: r.id,
    name: r.name,
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now(),
    cards: normalizeOrders(cards),
  }
}

/* ---------------- first-run sample board ---------------- */

function buildSampleBoard(): Board {
  const now = Date.now()
  const mk = (title: string, note: string, due: string | undefined, priority: Priority, column: ColumnId, order: number): Card => ({
    id: uid(),
    title,
    note,
    due,
    priority,
    column,
    order,
    createdAt: now,
    doneAt: column === 'done' ? now : undefined,
  })
  return {
    id: uid(),
    name: 'My tasks',
    createdAt: now,
    cards: [
      mk('Send project update to Maya', 'Include the revised timeline and budget.', dateOffset(1), 'high', 'todo', 0),
      mk('Book dentist appointment', '', dateOffset(-2), 'med', 'todo', 1),
      mk('Refactor auth middleware', 'Split into small, reviewable PRs.', undefined, 'low', 'todo', 2),
      mk('Write Q3 planning doc', 'Draft sections 1–3 first.', dateOffset(0), 'high', 'doing', 0),
      mk("Review Sam's pull request", '', undefined, 'med', 'doing', 1),
      mk('Water the plants', '', undefined, 'low', 'done', 0),
    ],
  }
}

/* ================================================================== */
/* Presentational card face (used by real cards and the drag ghost)    */
/* ================================================================== */

function CardFace({ card }: { card: Card }) {
  const meta = PRIORITY_META[card.priority]
  const badge = card.due ? dueBadge(card.due) : null
  const done = card.column === 'done'
  return (
    <div className="min-w-0">
      <div className="flex items-start gap-1.5">
        <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', meta.dot)} aria-hidden />
        <p
          className={cn(
            'min-w-0 flex-1 break-words text-sm font-medium leading-snug text-zinc-100',
            done && 'text-zinc-400 line-through decoration-zinc-600'
          )}
        >
          {card.title}
        </p>
      </div>
      {card.note && <p className="mt-1 line-clamp-2 pl-3 text-xs leading-snug text-zinc-500">{card.note}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-3">
        <Badge variant="outline" className={cn('border px-1.5 py-0 text-[10px] font-semibold', meta.chip)}>
          {meta.label}
        </Badge>
        {badge && (
          <Badge variant="outline" className={cn('gap-1 border px-1.5 py-0 text-[10px] font-semibold', badge.className)}>
            <CalendarDays className="size-3" aria-hidden />
            {badge.label}
          </Badge>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Sortable card                                                       */
/* ================================================================== */

function BoardCard({
  card,
  onEditCard,
  onMoveCard,
}: {
  card: Card
  onEditCard: (cardId: string) => void
  onMoveCard: (cardId: string, dir: -1 | 1) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card' },
  })
  const colIndex = COLUMN_IDS.indexOf(card.column)
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'relative touch-manipulation select-none rounded-xl border border-white/10 bg-zinc-900/80 p-2.5 shadow-sm transition-colors hover:border-white/20',
        'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-30 ring-1 ring-amber-400/40'
      )}
      {...attributes}
      {...listeners}
      onClick={() => onEditCard(card.id)}
    >
      <CardFace card={card} />
      {/* touch/keyboard fallback: nudge between columns */}
      <div className="-my-2.5 flex items-center justify-end gap-0.5">
        <button
          type="button"
          aria-label={`Move "${card.title}" to the previous column`}
          disabled={colIndex === 0}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onMoveCard(card.id, -1)
          }}
          className="flex size-11 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-25"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={`Move "${card.title}" to the next column`}
          disabled={colIndex === COLUMN_IDS.length - 1}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onMoveCard(card.id, 1)
          }}
          className="flex size-11 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-25"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </li>
  )
}

/* ================================================================== */
/* Priority picker (shared by composer + editor)                       */
/* ================================================================== */

function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Priority">
      {(Object.keys(PRIORITY_META) as Priority[]).map((p) => {
        const meta = PRIORITY_META[p]
        const active = value === p
        return (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(p)}
            className={cn(
              'flex h-11 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-semibold transition-colors',
              active ? meta.chip : 'border-white/10 bg-transparent text-zinc-500 hover:text-zinc-300'
            )}
          >
            <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden />
            {meta.label}
          </button>
        )
      })}
    </div>
  )
}

/* ================================================================== */
/* Column pane (droppable body + sortable cards + inline composer)     */
/* ================================================================== */

function ColumnPane({
  columnId,
  cards,
  onAdd,
  onEditCard,
  onMoveCard,
}: {
  columnId: ColumnId
  cards: Card[]
  onAdd: (columnId: ColumnId, title: string, note: string, due: string | undefined, priority: Priority) => void
  onEditCard: (cardId: string) => void
  onMoveCard: (cardId: string, dir: -1 | 1) => void
}) {
  const meta = COLUMN_META[columnId]
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [due, setDue] = useState('')
  const [priority, setPriority] = useState<Priority>('med')
  const { setNodeRef, isOver } = useDroppable({ id: `col:${columnId}`, data: { type: 'column', column: columnId } })
  const ids = useMemo(() => cards.map((c) => c.id), [cards])

  const closeComposer = useCallback(() => {
    setOpen(false)
    setTitle('')
    setNote('')
    setDue('')
    setPriority('med')
  }, [])

  const submit = useCallback(() => {
    const t = title.trim()
    if (!t) return
    onAdd(columnId, t, note.trim(), due || undefined, priority)
    closeComposer()
  }, [closeComposer, columnId, due, note, onAdd, priority, title])

  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-white/10 bg-white/[0.02]">
      {/* header */}
      <div className={cn('flex items-center gap-2 rounded-t-2xl border-b border-white/5 px-3 py-2.5', meta.headerBg)}>
        <span className={cn('size-2 rounded-full', meta.dot)} aria-hidden />
        <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-300">{meta.label}</h3>
        <span className="ml-auto rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-400">
          {cards.length}
        </span>
      </div>

      {/* droppable body */}
      <div
        ref={setNodeRef}
        className={cn(
          'min-h-[7.5rem] flex-1 rounded-b-2xl p-2 transition-colors',
          isOver && 'bg-amber-400/[0.05] ring-1 ring-inset ring-amber-400/20'
        )}
      >
        {cards.length > 0 ? (
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="max-h-96 space-y-2 overflow-y-auto pr-1">
              {cards.map((card) => (
                <BoardCard key={card.id} card={card} onEditCard={onEditCard} onMoveCard={onMoveCard} />
              ))}
            </ul>
          </SortableContext>
        ) : (
          <div
            className={cn(
              'flex h-28 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-3 text-center',
              isOver ? 'border-amber-400/40 text-amber-300/80' : 'border-white/10 text-zinc-600'
            )}
          >
            <Inbox className="size-5" aria-hidden />
            <span className="text-xs font-medium">{isOver ? 'Release to drop' : 'Drop tasks here'}</span>
          </div>
        )}
      </div>

      {/* inline composer */}
      <div className="border-t border-white/5 p-2">
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.16 }}
            className="space-y-2"
          >
            <Input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                } else if (e.key === 'Escape') {
                  closeComposer()
                }
              }}
              placeholder="Task title"
              aria-label="Task title"
              maxLength={120}
              className={INPUT_CLS}
            />
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional)"
              aria-label="Note"
              maxLength={500}
              className={INPUT_CLS}
            />
            <Input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              aria-label="Due date"
              className={INPUT_CLS}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <PriorityPicker value={priority} onChange={setPriority} />
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={closeComposer}
                  aria-label="Cancel new task"
                  className="flex size-11 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
                >
                  <X className="size-4" aria-hidden />
                </button>
                <Button
                  onClick={submit}
                  disabled={!title.trim()}
                  className="h-11 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 px-3.5 text-xs font-bold text-white shadow-lg hover:from-amber-300 hover:via-amber-400 hover:to-orange-400"
                >
                  Add
                </Button>
              </div>
            </div>
          </motion.div>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-semibold text-zinc-500 transition-colors hover:bg-white/[0.04] hover:text-zinc-300"
          >
            <Plus className="size-4" aria-hidden /> Add task
          </button>
        )}
      </div>
    </section>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function TaskBoardApp() {
  const { toast } = useToast()

  /* ---------------- data ---------------- */
  const [boards, setBoards] = useState<Board[]>([])
  const [loaded, setLoaded] = useState(false)
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null)

  /* ---------------- drag state ---------------- */
  const [activeId, setActiveId] = useState<string | null>(null)

  /* ---------------- board switcher ---------------- */
  const [addingBoard, setAddingBoard] = useState(false)
  const [newBoardName, setNewBoardName] = useState('')

  /* ---------------- board dialog (rename / delete) ---------------- */
  const [boardDialogOpen, setBoardDialogOpen] = useState(false)
  const [boardName, setBoardName] = useState('')
  const [confirmBoardDelete, setConfirmBoardDelete] = useState(false)

  /* ---------------- card editor dialog ---------------- */
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [edTitle, setEdTitle] = useState('')
  const [edNote, setEdNote] = useState('')
  const [edDue, setEdDue] = useState('')
  const [edPriority, setEdPriority] = useState<Priority>('med')
  const [confirmCardDelete, setConfirmCardDelete] = useState(false)

  /* ---------------- fresh-state refs for dnd handlers ---------------- */
  const boardsRef = useRef<Board[]>([])
  const activeBoardIdRef = useRef<string | null>(null)
  const dragStartCardsRef = useRef<Card[] | null>(null)
  const suppressClickUntil = useRef(0)

  useEffect(() => {
    boardsRef.current = boards
    activeBoardIdRef.current = activeBoardId
  })

  /* ---------------- two-tap confirm auto-reset ---------------- */
  useEffect(() => {
    if (!confirmCardDelete) return
    const t = setTimeout(() => setConfirmCardDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmCardDelete])

  useEffect(() => {
    if (!confirmBoardDelete) return
    const t = setTimeout(() => setConfirmBoardDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmBoardDelete])

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const all = await idbGetAll(BOARDS_STORE)
        if (!alive) return
        const clean = all
          .map(sanitizeBoard)
          .filter((b): b is Board => b !== null)
          .sort((a, b) => a.createdAt - b.createdAt)
        boardsRef.current = clean
        setBoards(clean)
        setActiveBoardId(clean[0]?.id ?? null)
      } catch {
        /* private mode / quota — keep in-memory data */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- derived ---------------- */
  const activeBoard = useMemo(
    () => boards.find((b) => b.id === activeBoardId) ?? boards[0] ?? null,
    [boards, activeBoardId]
  )

  const columnsMap = useMemo(() => {
    const map: Record<ColumnId, Card[]> = { todo: [], doing: [], done: [] }
    if (activeBoard) {
      for (const c of activeBoard.cards) map[c.column].push(c)
    }
    for (const col of COLUMN_IDS) map[col].sort(byOrder)
    return map
  }, [activeBoard])

  const totalCards = activeBoard?.cards.length ?? 0
  const doneCount = columnsMap.done.length
  const pct = totalCards === 0 ? 0 : Math.round((doneCount / totalCards) * 100)

  const activeCard = useMemo(
    () => (activeId && activeBoard ? activeBoard.cards.find((c) => c.id === activeId) ?? null : null),
    [activeBoard, activeId]
  )

  /* ---------------- write-through primitives ---------------- */

  const updateBoard = useCallback((boardId: string, patch: (b: Board) => Board, persist: boolean) => {
    const next = boardsRef.current.map((b) => (b.id === boardId ? patch(b) : b))
    boardsRef.current = next
    setBoards(next)
    const changed = next.find((b) => b.id === boardId)
    if (persist && changed) {
      void idbPut(changed).catch(() => {
        /* memory-only fallback */
      })
    }
  }, [])

  const updateActiveCards = useCallback(
    (compute: (cards: Card[]) => Card[], persist: boolean) => {
      const id = activeBoardIdRef.current
      if (!id) return
      updateBoard(id, (b) => ({ ...b, cards: compute(b.cards) }), persist)
    },
    [updateBoard]
  )

  /* ---------------- board mutations ---------------- */

  const createBoard = useCallback(
    (name: string) => {
      const board: Board = { id: uid(), name, createdAt: Date.now(), cards: [] }
      const next = [...boardsRef.current, board]
      boardsRef.current = next
      setBoards(next)
      void idbPut(board).catch(() => {
        /* memory-only fallback */
      })
      setActiveBoardId(board.id)
      haptic()
      toast({ title: 'Board created', description: name })
    },
    [toast]
  )

  const deleteBoard = useCallback(
    (boardId: string): boolean => {
      if (boardsRef.current.length <= 1) {
        toast({ title: "Can't delete the last board", description: 'Create another board first.', variant: 'destructive' })
        return false
      }
      const victim = boardsRef.current.find((b) => b.id === boardId)
      const next = boardsRef.current.filter((b) => b.id !== boardId)
      boardsRef.current = next
      setBoards(next)
      void idbDelete(boardId).catch(() => {
        /* memory-only fallback */
      })
      if (activeBoardIdRef.current === boardId) setActiveBoardId(next[0]?.id ?? null)
      haptic(18)
      toast({
        title: 'Board deleted',
        description: victim ? `${victim.name} and its ${victim.cards.length} card${victim.cards.length === 1 ? '' : 's'}` : undefined,
      })
      return true
    },
    [toast]
  )

  const submitNewBoard = useCallback(() => {
    const name = newBoardName.trim()
    if (!name) return
    createBoard(name)
    setAddingBoard(false)
    setNewBoardName('')
  }, [createBoard, newBoardName])

  const switchBoard = useCallback((id: string) => {
    setActiveBoardId(id)
    setAddingBoard(false)
    haptic()
  }, [])

  const openBoardDialog = useCallback(() => {
    setBoardName(activeBoard?.name ?? '')
    setConfirmBoardDelete(false)
    setBoardDialogOpen(true)
  }, [activeBoard])

  const saveBoardDialog = useCallback(() => {
    const name = boardName.trim()
    if (!name || !activeBoard) return
    updateBoard(activeBoard.id, (b) => ({ ...b, name }), true)
    setBoardDialogOpen(false)
    haptic()
    toast({ title: 'Board renamed' })
  }, [activeBoard, boardName, toast, updateBoard])

  const attemptDeleteBoard = useCallback(() => {
    if (!activeBoard) return
    if (!confirmBoardDelete) {
      setConfirmBoardDelete(true)
      return
    }
    const deleted = deleteBoard(activeBoard.id)
    setConfirmBoardDelete(false)
    if (deleted) setBoardDialogOpen(false)
  }, [activeBoard, confirmBoardDelete, deleteBoard])

  const loadSample = useCallback(() => {
    const board = buildSampleBoard()
    const next = [...boardsRef.current, board]
    boardsRef.current = next
    setBoards(next)
    void idbPut(board).catch(() => {
      /* memory-only fallback */
    })
    setActiveBoardId(board.id)
    haptic()
    toast({ title: 'Sample board loaded', description: 'Six example tasks across all columns.' })
  }, [toast])

  /* ---------------- card mutations ---------------- */

  const addCard = useCallback(
    (column: ColumnId, title: string, note: string, due: string | undefined, priority: Priority) => {
      const now = Date.now()
      updateActiveCards((cs) => {
        const colCount = cs.filter((c) => c.column === column).length
        const card: Card = {
          id: uid(),
          title,
          note,
          due,
          priority,
          column,
          order: colCount,
          createdAt: now,
          doneAt: column === 'done' ? now : undefined,
        }
        return normalizeOrders([...cs, card])
      }, true)
      haptic()
    },
    [updateActiveCards]
  )

  const openCardEditor = useCallback((cardId: string) => {
    if (Date.now() < suppressClickUntil.current) return
    const board = boardsRef.current.find((b) => b.id === activeBoardIdRef.current)
    const card = board?.cards.find((c) => c.id === cardId)
    if (!card) return
    setEditingId(card.id)
    setEdTitle(card.title)
    setEdNote(card.note)
    setEdDue(card.due ?? '')
    setEdPriority(card.priority)
    setConfirmCardDelete(false)
    setEditorOpen(true)
  }, [])

  const saveCardEdit = useCallback(() => {
    const title = edTitle.trim()
    if (!title || !editingId) return
    const due = edDue || undefined
    updateActiveCards((cs) =>
      cs.map((c) => (c.id === editingId ? { ...c, title, note: edNote.trim(), due, priority: edPriority } : c)),
      true
    )
    setEditorOpen(false)
    setEditingId(null)
    haptic()
    toast({ title: 'Task updated' })
  }, [edDue, edNote, edPriority, edTitle, editingId, toast, updateActiveCards])

  const deleteCard = useCallback(() => {
    if (!editingId) return
    updateActiveCards((cs) => cs.filter((c) => c.id !== editingId), true)
    setEditorOpen(false)
    setEditingId(null)
    setConfirmCardDelete(false)
    haptic(18)
    toast({ title: 'Task deleted' })
  }, [editingId, toast, updateActiveCards])

  const attemptDeleteCard = useCallback(() => {
    if (!confirmCardDelete) {
      setConfirmCardDelete(true)
      return
    }
    deleteCard()
  }, [confirmCardDelete, deleteCard])

  /** Chevron fallback: move a card one column left/right (to the end). */
  const moveCardDir = useCallback(
    (cardId: string, dir: -1 | 1) => {
      const board = boardsRef.current.find((b) => b.id === activeBoardIdRef.current)
      const card = board?.cards.find((c) => c.id === cardId)
      if (!board || !card) return
      const colIndex = COLUMN_IDS.indexOf(card.column)
      const target = COLUMN_IDS[colIndex + dir]
      if (!target) return
      const toIndex = insertIndex(board.cards, target, null, cardId)
      updateActiveCards((cs) => moveCard(cs, cardId, target, toIndex), true)
      haptic(12)
      if (target === 'done') toast({ title: 'Task completed', description: card.title })
    },
    [toast, updateActiveCards]
  )

  /* ---------------- drag & drop ---------------- */

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const onDragStart = useCallback((event: DragStartEvent) => {
    const board = boardsRef.current.find((b) => b.id === activeBoardIdRef.current)
    dragStartCardsRef.current = board?.cards ?? null
    setActiveId(String(event.active.id))
  }, [])

  /** Cross-column live preview: move the card between columns while dragging. */
  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const board = boardsRef.current.find((b) => b.id === activeBoardIdRef.current)
      const card = board?.cards.find((c) => c.id === event.active.id)
      if (!board || !card) return
      const target = resolveOver(board.cards, event.over)
      if (!target || target.column === card.column || target.cardId === card.id) return
      const toIndex = insertIndex(board.cards, target.column, target.cardId, card.id)
      updateBoard(board.id, (b) => ({ ...b, cards: moveCard(b.cards, card.id, target.column, toIndex) }), false)
    },
    [updateBoard]
  )

  /** Commit: final position + persist to IndexedDB. */
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      suppressClickUntil.current = Date.now() + 300
      const board = boardsRef.current.find((b) => b.id === activeBoardIdRef.current)
      const card = board?.cards.find((c) => c.id === event.active.id)
      setActiveId(null)
      if (!board || !card) return
      const target = resolveOver(board.cards, event.over)
      if (!target) {
        // Dropped outside any droppable: keep a legitimate cross-column preview, persist if changed.
        const snap = dragStartCardsRef.current
        if (snap && sig(snap) !== sig(board.cards)) {
          updateBoard(board.id, (b) => ({ ...b, cards: b.cards }), true)
        }
        return
      }
      const toIndex = insertIndex(board.cards, target.column, target.cardId, card.id)
      const next = moveCard(board.cards, card.id, target.column, toIndex)
      if (sig(next) === sig(board.cards)) return
      const moved = target.column !== card.column
      updateBoard(board.id, (b) => ({ ...b, cards: next }), true)
      haptic(moved ? [12, 30, 12] : 12)
      if (target.column === 'done' && card.column !== 'done') {
        toast({ title: 'Task completed', description: card.title })
      }
    },
    [toast, updateBoard]
  )

  const onDragCancel = useCallback(() => {
    suppressClickUntil.current = Date.now() + 300
    const snap = dragStartCardsRef.current
    const id = activeBoardIdRef.current
    if (snap && id) updateBoard(id, (b) => ({ ...b, cards: snap }), false)
    setActiveId(null)
  }, [updateBoard])

  /* ---------------- shared JSX bits ---------------- */

  const startNewBoard = useCallback(() => {
    setAddingBoard(true)
    setNewBoardName('')
  }, [])

  const cancelNewBoard = useCallback(() => {
    setAddingBoard(false)
    setNewBoardName('')
  }, [])

  const newBoardRow = (
    <div className="flex items-center gap-2">
      <Input
        autoFocus
        value={newBoardName}
        onChange={(e) => setNewBoardName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submitNewBoard()
          } else if (e.key === 'Escape') {
            cancelNewBoard()
          }
        }}
        placeholder="New board name"
        aria-label="New board name"
        maxLength={40}
        className={INPUT_CLS}
      />
      <Button
        onClick={submitNewBoard}
        disabled={!newBoardName.trim()}
        aria-label="Create board"
        className="h-11 w-11 shrink-0 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 p-0 text-white shadow-lg hover:from-amber-300 hover:via-amber-400 hover:to-orange-400"
      >
        <Check className="size-4" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        onClick={cancelNewBoard}
        aria-label="Cancel new board"
        className="h-11 w-11 shrink-0 rounded-xl p-0 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  )

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-amber-500/[0.1] via-transparent to-orange-600/[0.08] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-300 via-orange-400 to-orange-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(249_115_22/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <SquareKanban className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Task Board</h2>
              <p className="text-xs text-zinc-400">Plan, drag and finish — one board a day.</p>
            </div>
          </div>
        </div>

        {!loaded ? (
          /* ---------------- Hydrating ---------------- */
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
            ))}
          </div>
        ) : boards.length === 0 ? (
          /* ---------------- First run ---------------- */
          <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300/20 to-orange-500/20 text-amber-300 ring-1 ring-white/10">
              <SquareKanban className="size-7" strokeWidth={1.9} aria-hidden />
            </span>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-zinc-100">No boards yet</h3>
              <p className="mx-auto max-w-xs text-xs leading-relaxed text-zinc-500">
                Create a board to plan your day — or load a sample to see how it works. Everything stays on this device.
              </p>
            </div>
            {addingBoard ? (
              <div className="w-full max-w-sm">{newBoardRow}</div>
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  onClick={loadSample}
                  className="h-11 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 font-semibold text-white shadow-lg hover:from-amber-300 hover:via-amber-400 hover:to-orange-400"
                >
                  <Sparkles className="size-4" aria-hidden /> Load sample board
                </Button>
                <Button
                  variant="outline"
                  onClick={startNewBoard}
                  className="h-11 rounded-xl border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Plus className="size-4" aria-hidden /> New board
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* ---------------- Board switcher ---------------- */}
            <div className={cn('flex items-center gap-1.5 overflow-x-auto border-b border-white/5 px-4 py-2.5', THIN_SCROLLBAR)}>
              {boards.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => switchBoard(b.id)}
                  aria-pressed={b.id === activeBoard?.id}
                  className={cn(
                    'flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-xs font-semibold transition-colors',
                    b.id === activeBoard?.id
                      ? 'border-amber-400/40 bg-amber-500/15 text-amber-200'
                      : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/20 hover:text-zinc-200'
                  )}
                >
                  {b.name}
                  <span className="rounded-full bg-white/10 px-1.5 text-[10px] tabular-nums">{b.cards.length}</span>
                </button>
              ))}
              {!addingBoard && (
                <button
                  type="button"
                  onClick={startNewBoard}
                  className="flex h-11 shrink-0 items-center gap-1 rounded-full border border-dashed border-white/15 px-3.5 text-xs font-semibold text-zinc-500 transition-colors hover:border-amber-400/40 hover:text-amber-200"
                >
                  <Plus className="size-3.5" aria-hidden /> New board
                </button>
              )}
            </div>

            {/* ---------------- New-board inline input ---------------- */}
            {addingBoard && (
              <div className="border-b border-white/5 px-4 py-3">
                {newBoardRow}
              </div>
            )}

            {/* ---------------- Board header: name + progress ---------------- */}
            {!addingBoard && activeBoard && (
              <div className="flex items-center gap-2 px-4 pt-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-bold text-zinc-100">{activeBoard.name}</p>
                    <p className="shrink-0 text-[11px] font-medium tabular-nums text-zinc-500">
                      {doneCount}/{totalCards} done · {pct}%
                    </p>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.06]"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Board progress"
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 transition-[width] duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openBoardDialog}
                  aria-label="Board settings"
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
              </div>
            )}

            {/* ---------------- Columns ---------------- */}
            <div className="p-4 pt-3">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCorners}
                measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragEnd={onDragEnd}
                onDragCancel={onDragCancel}
              >
                {activeBoard && (
                  <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 md:grid md:grid-cols-3 md:overflow-x-visible md:snap-none">
                    {COLUMN_IDS.map((col, i) => (
                      <motion.div
                        key={col}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 26, delay: 0.05 * i }}
                        className="min-w-[85%] shrink-0 snap-center md:min-w-0 md:shrink"
                      >
                        <ColumnPane
                          columnId={col}
                          cards={columnsMap[col]}
                          onAdd={addCard}
                          onEditCard={openCardEditor}
                          onMoveCard={moveCardDir}
                        />
                      </motion.div>
                    ))}
                  </div>
                )}

                <DragOverlay>
                  {activeCard ? (
                    <div className="w-60 max-w-[80vw] rotate-1 rounded-xl border border-amber-400/30 bg-zinc-900 p-2.5 shadow-[0_20px_50px_-12px_rgb(0_0_0/0.8)] ring-1 ring-amber-400/20">
                      <CardFace card={activeCard} />
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          </>
        )}
      </motion.div>

      {/* ---------------- Card editor dialog ---------------- */}
      <Dialog open={editorOpen} onOpenChange={(o) => { setEditorOpen(o); if (!o) setConfirmCardDelete(false) }}>
        <DialogContent
          className={cn(
            'max-h-[90vh] overflow-y-auto rounded-3xl border-white/10 bg-zinc-950 text-zinc-100 sm:max-w-md',
            THIN_SCROLLBAR
          )}
        >
          <DialogHeader>
            <DialogTitle className="text-base">Edit task</DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">
              Update the details, or delete the card.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="tb-card-title" className="text-xs font-semibold text-zinc-400">
                Title
              </label>
              <Input
                id="tb-card-title"
                autoFocus
                value={edTitle}
                onChange={(e) => setEdTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    saveCardEdit()
                  }
                }}
                placeholder="What needs doing?"
                maxLength={120}
                className={INPUT_CLS}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="tb-card-note" className="text-xs font-semibold text-zinc-400">
                Note
              </label>
              <Textarea
                id="tb-card-note"
                rows={3}
                value={edNote}
                onChange={(e) => setEdNote(e.target.value)}
                placeholder="Details, links, context…"
                maxLength={500}
                className={TEXTAREA_CLS}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="tb-card-due" className="text-xs font-semibold text-zinc-400">
                  Due date
                </label>
                <div className="flex items-center gap-1.5">
                  <Input
                    id="tb-card-due"
                    type="date"
                    value={edDue}
                    onChange={(e) => setEdDue(e.target.value)}
                    className={INPUT_CLS}
                  />
                  {edDue && (
                    <button
                      type="button"
                      onClick={() => setEdDue('')}
                      aria-label="Clear due date"
                      className="flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-200"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-semibold text-zinc-400">Priority</span>
                <div>
                  <PriorityPicker value={edPriority} onChange={setEdPriority} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant={confirmCardDelete ? 'destructive' : 'ghost'}
              onClick={attemptDeleteCard}
              className={cn('h-11 rounded-xl', !confirmCardDelete && 'text-rose-400 hover:bg-rose-500/10 hover:text-rose-300')}
            >
              <Trash2 className="size-4" aria-hidden />
              {confirmCardDelete ? 'Confirm delete' : 'Delete'}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setEditorOpen(false)}
                className="h-11 rounded-xl text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              >
                Cancel
              </Button>
              <Button
                onClick={saveCardEdit}
                disabled={!edTitle.trim()}
                className="h-11 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 font-semibold text-white shadow-lg hover:from-amber-300 hover:via-amber-400 hover:to-orange-400"
              >
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- Board dialog (rename / delete) ---------------- */}
      <Dialog
        open={boardDialogOpen}
        onOpenChange={(o) => {
          setBoardDialogOpen(o)
          if (!o) setConfirmBoardDelete(false)
        }}
      >
        <DialogContent className="rounded-3xl border-white/10 bg-zinc-950 text-zinc-100 sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base">Board settings</DialogTitle>
            <DialogDescription className="text-xs text-zinc-500">
              Rename this board, or delete it and all of its cards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor="tb-board-name" className="text-xs font-semibold text-zinc-400">
              Name
            </label>
            <Input
              id="tb-board-name"
              value={boardName}
              onChange={(e) => setBoardName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  saveBoardDialog()
                }
              }}
              maxLength={40}
              className={INPUT_CLS}
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant={confirmBoardDelete ? 'destructive' : 'ghost'}
              onClick={attemptDeleteBoard}
              className={cn('h-11 rounded-xl', !confirmBoardDelete && 'text-rose-400 hover:bg-rose-500/10 hover:text-rose-300')}
            >
              <Trash2 className="size-4" aria-hidden />
              {confirmBoardDelete ? 'Confirm delete' : 'Delete'}
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                onClick={() => setBoardDialogOpen(false)}
                className="h-11 rounded-xl text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              >
                Cancel
              </Button>
              <Button
                onClick={saveBoardDialog}
                disabled={!boardName.trim()}
                className="h-11 rounded-xl bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500 font-semibold text-white shadow-lg hover:from-amber-300 hover:via-amber-400 hover:to-orange-400"
              >
                Save
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
