'use client'

/**
 * Flashcards v2 — build decks, flip, grade, remember.
 *
 * Decks of front/back cards with a 3D flip study mode, now backed by a lite
 * SM-2 spaced-repetition scheduler. Every card carries { ease, intervalDays,
 * due, reps, lapses }; grading with Again / Hard / Good / Easy updates the
 * schedule and pushes the next due date forward. Study "All cards" or just
 * "Due now" (ordered by due date, then most-lapsed first), and watch per-deck
 * chips for due / learning / mature buckets plus a 7-day due forecast.
 * Everything persists in IndexedDB — private, offline, instant.
 *
 * Backward compatibility: decks saved by v1 (cards without scheduling fields,
 * lastResult 'correct' | 'wrong') are migrated in memory on load with safe
 * defaults — old data never crashes and keeps its counters/accuracy.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  BookOpen,
  Check,
  Clock,
  Flame,
  GraduationCap,
  Layers,
  Minus,
  PartyPopper,
  Pencil,
  Play,
  Plus,
  RotateCw,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Trash2,
  Trophy,
  X,
  Zap,
} from 'lucide-react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

/** Four-way grading — 'correct'/'wrong' from v1 maps to good/again on load. */
type Grade = 'again' | 'hard' | 'good' | 'easy'

const GRADES: Grade[] = ['again', 'hard', 'good', 'easy']

type StudyMode = 'all' | 'due'

interface FlashCard {
  id: string
  front: string
  back: string
  correct: number
  wrong: number
  lastResult?: Grade
  /* ---- SM-2 lite scheduling ---- */
  /** ease factor; starts 2.5, clamped [1.3, 3.5] */
  ease: number
  /** current gap in days (0 = due today / learning) */
  intervalDays: number
  /** next due date as local YYYY-MM-DD key */
  due: string
  /** total times the card has been graded */
  reps: number
  /** times graded Again */
  lapses: number
}

interface Deck {
  id: string
  name: string
  emoji: string
  /** accent id from ACCENTS */
  color: string
  createdAt: number
  cards: FlashCard[]
  /** reviews per local date key — feeds the per-deck streak */
  reviewLog: Record<string, number>
}

interface Session {
  mode: StudyMode
  /** card ids; may contain repeats (Again cards re-queued at the end) */
  queue: string[]
  index: number
  got: number
  again: number
  /** first-attempt grade per card id (accuracy basis) */
  first: Record<string, Grade>
  counts: { again: number; hard: number; good: number; easy: number }
}

/* ================================================================== */
/* Accent palette + emoji choices                                      */
/* ================================================================== */

interface Accent {
  id: string
  name: string
  hex: string
}

const ACCENTS: Accent[] = [
  { id: 'violet', name: 'Violet', hex: '#a78bfa' },
  { id: 'fuchsia', name: 'Fuchsia', hex: '#e879f9' },
  { id: 'pink', name: 'Pink', hex: '#f472b6' },
  { id: 'rose', name: 'Rose', hex: '#fb7185' },
  { id: 'emerald', name: 'Emerald', hex: '#34d399' },
  { id: 'teal', name: 'Teal', hex: '#2dd4bf' },
  { id: 'amber', name: 'Amber', hex: '#fbbf24' },
  { id: 'orange', name: 'Orange', hex: '#fb923c' },
]

function accentOf(color: string): Accent {
  return ACCENTS.find((a) => a.id === color) ?? ACCENTS[0]
}

const DECK_EMOJIS = [
  '📚', '🧠', '🌍', '🧪', '🧮',
  '💻', '🎨', '🎵', '🏛️', '⚖️',
  '🚀', '🌱', '🔤', '🗣️', '🧬',
  '📐', '🍳', '⚽', '💡', '✨',
]

/* ================================================================== */
/* IndexedDB — decks, fully on-device (write-through)                  */
/* ================================================================== */

const DB_NAME = 'toolhub-flashcards'
const DB_VERSION = 1
const DECKS_STORE = 'decks'
const SHUFFLE_KEY = 'toolhub-flashcards-shuffle'

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
/* Dates — local YYYY-MM-DD keys (lexicographically comparable)        */
/* ================================================================== */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

function dateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function todayKey(): string {
  return dateKey(new Date())
}

function addDaysKey(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return dateKey(d)
}

/** Parse a YYYY-MM-DD key at local midnight. */
function parseKey(key: string): Date {
  const parts = key.split('-').map(Number)
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1)
}

/** Whole days from key a to key b (b - a). */
function daysBetweenKeys(a: string, b: string): number {
  return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86_400_000)
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

function shuffleArr<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = out[i]
    const b = out[j]
    if (a === undefined || b === undefined) continue
    out[i] = b
    out[j] = a
  }
  return out
}

/** Thin glass scrollbar for long lists. */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/** Dark-glass tooltip shell shared by recharts charts. */
const TOOLTIP_STYLE: CSSProperties = {
  backgroundColor: 'rgba(9,9,11,0.95)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 12,
  fontSize: 11,
  color: '#e4e4e7',
  padding: '6px 10px',
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s
}

/* ================================================================== */
/* Migration — v1 decks/cards get scheduling defaults, never crash     */
/* ================================================================== */

function asNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function normalizeLastResult(v: unknown): Grade | undefined {
  if (v === 'correct') return 'good'
  if (v === 'wrong') return 'again'
  return GRADES.find((g) => g === v)
}

function normalizeCard(raw: {
  id: string
  front?: unknown
  back?: unknown
  correct?: unknown
  wrong?: unknown
  lastResult?: unknown
  ease?: unknown
  intervalDays?: unknown
  due?: unknown
  reps?: unknown
  lapses?: unknown
}): FlashCard {
  return {
    id: raw.id,
    front: typeof raw.front === 'string' ? raw.front : '',
    back: typeof raw.back === 'string' ? raw.back : '',
    correct: Math.max(0, Math.round(asNum(raw.correct, 0))),
    wrong: Math.max(0, Math.round(asNum(raw.wrong, 0))),
    lastResult: normalizeLastResult(raw.lastResult),
    ease: Math.min(3.5, Math.max(1.3, Math.round(asNum(raw.ease, 2.5) * 100) / 100)),
    intervalDays: Math.max(0, Math.round(asNum(raw.intervalDays, 0))),
    due: typeof raw.due === 'string' && DATE_KEY_RE.test(raw.due) ? raw.due : todayKey(),
    reps: Math.max(0, Math.round(asNum(raw.reps, 0))),
    lapses: Math.max(0, Math.round(asNum(raw.lapses, 0))),
  }
}

function normalizeReviewLog(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!DATE_KEY_RE.test(k)) continue
    const n = asNum(v, 0)
    if (n > 0) out[k] = Math.round(n)
  }
  return out
}

/* ================================================================== */
/* SM-2 lite scheduler                                                 */
/* ================================================================== */

interface Schedule {
  ease: number
  intervalDays: number
  due: string
  reps: number
  lapses: number
}

function clampEase(e: number): number {
  return Math.min(3.5, Math.max(1.3, Math.round(e * 100) / 100))
}

/**
 * SM-2 lite:
 *  Again — interval 0, due today, ease −0.2 (min 1.3), lapse++
 *  Hard  — interval ×1.2 (first step 1 day), ease −0.15
 *  Good  — interval ×ease (first success 1 day)
 *  Easy  — interval ×ease×1.3 (first success 4 days), ease +0.15
 * Due = today + interval days.
 */
function nextSchedule(card: FlashCard, grade: Grade): Schedule {
  const reps = card.reps + 1
  if (grade === 'again') {
    return {
      ease: clampEase(card.ease - 0.2),
      intervalDays: 0,
      due: todayKey(),
      reps,
      lapses: card.lapses + 1,
    }
  }
  const I = card.intervalDays
  const E = card.ease
  if (grade === 'hard') {
    const interval = I === 0 ? 1 : Math.max(1, Math.round(I * 1.2))
    return { ease: clampEase(E - 0.15), intervalDays: interval, due: addDaysKey(interval), reps, lapses: card.lapses }
  }
  if (grade === 'good') {
    const interval = I === 0 ? 1 : Math.max(1, Math.round(I * E))
    return { ease: clampEase(E), intervalDays: interval, due: addDaysKey(interval), reps, lapses: card.lapses }
  }
  const interval = I === 0 ? 4 : Math.max(4, Math.round(I * E * 1.3))
  return { ease: clampEase(E + 0.15), intervalDays: interval, due: addDaysKey(interval), reps, lapses: card.lapses }
}

/** Short next-interval label for the grading buttons. */
function gradePreview(card: FlashCard, grade: Grade): string {
  if (grade === 'again') return 'today'
  return `${nextSchedule(card, grade).intervalDays}d`
}

/* ================================================================== */
/* Stats — accuracy, buckets, streak, forecast, due labels             */
/* ================================================================== */

/** All-time grading accuracy across a deck's cards; null when never graded. */
function deckAccuracy(d: Deck): number | null {
  let correct = 0
  let wrong = 0
  for (const c of d.cards) {
    correct += c.correct
    wrong += c.wrong
  }
  const total = correct + wrong
  return total === 0 ? null : Math.round((correct / total) * 100)
}

interface DeckStats {
  correct: number
  wrong: number
  gradings: number
  mastered: number
  accuracy: number | null
}

function deckStats(d: Deck): DeckStats {
  let correct = 0
  let wrong = 0
  let mastered = 0
  for (const c of d.cards) {
    correct += c.correct
    wrong += c.wrong
    if (c.correct > c.wrong) mastered++
  }
  const gradings = correct + wrong
  return { correct, wrong, gradings, mastered, accuracy: gradings === 0 ? null : Math.round((correct / gradings) * 100) }
}

interface DeckBuckets {
  due: number
  learning: number
  young: number
  mature: number
  total: number
}

/**
 * Maturity buckets are mutually exclusive: mature (interval ≥ 21d),
 * learning (reps < 2 or interval < 4), young = the rest.
 * `due` is a temporal overlay (due ≤ today) and may overlap maturity.
 */
function deckBuckets(d: Deck): DeckBuckets {
  const today = todayKey()
  let due = 0
  let learning = 0
  let mature = 0
  for (const c of d.cards) {
    if (c.due <= today) due++
    if (c.intervalDays >= 21) mature++
    else if (c.reps < 2 || c.intervalDays < 4) learning++
  }
  return { due, learning, mature, young: d.cards.length - mature - learning, total: d.cards.length }
}

/** Consecutive days (ending today or yesterday) with ≥ 1 review. */
function reviewStreak(log: Record<string, number>): number {
  let streak = 0
  const cursor = new Date()
  if ((log[dateKey(cursor)] ?? 0) === 0) cursor.setDate(cursor.getDate() - 1)
  while ((log[dateKey(cursor)] ?? 0) > 0) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** Cards due per day for the next 7 days; overdue folds into today. */
function dueForecast(d: Deck): { day: string; count: number }[] {
  const today = todayKey()
  const counts = new Array<number>(7).fill(0)
  for (const c of d.cards) {
    let idx = 0
    if (c.due > today) {
      const diff = daysBetweenKeys(today, c.due)
      if (diff <= 6) idx = diff
      else continue
    }
    counts[idx] = (counts[idx] ?? 0) + 1
  }
  const base = new Date()
  return counts.map((count, i) => {
    const day = new Date(base)
    day.setDate(day.getDate() + i)
    return {
      day: i === 0 ? 'Today' : day.toLocaleDateString('en-US', { weekday: 'short' }),
      count,
    }
  })
}

function dueLabelOf(c: FlashCard): { text: string; tone: 'amber' | 'emerald' | 'zinc' } {
  const today = todayKey()
  if (c.reps === 0 && c.intervalDays === 0) return { text: 'new', tone: 'zinc' }
  if (c.due <= today) return { text: 'due now', tone: 'amber' }
  const d = daysBetweenKeys(today, c.due)
  if (d === 1) return { text: 'due tomorrow', tone: 'zinc' }
  return c.intervalDays >= 21 ? { text: `in ${d}d`, tone: 'emerald' } : { text: `in ${d}d`, tone: 'zinc' }
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

type Screen = 'home' | 'deck' | 'study' | 'summary' | 'caught'

export default function FlashcardsApp() {
  const { toast } = useToast()

  /* ---------------- data ---------------- */
  const [decks, setDecks] = useState<Deck[]>([])
  const [loaded, setLoaded] = useState(false)
  const [screen, setScreen] = useState<Screen>('home')
  const [activeDeckId, setActiveDeckId] = useState<string | null>(null)
  const [shuffle, setShuffle] = useState(() => {
    if (typeof window === 'undefined') return true
    try {
      return localStorage.getItem(SHUFFLE_KEY) !== '0'
    } catch {
      return true
    }
  })

  /* ---------------- session ---------------- */
  const [session, setSession] = useState<Session | null>(null)
  const [flipped, setFlipped] = useState(false)

  /* ---------------- deck modal ---------------- */
  const [deckFormOpen, setDeckFormOpen] = useState(false)
  const [deckEditingId, setDeckEditingId] = useState<string | null>(null)
  const [deckName, setDeckName] = useState('')
  const [deckEmoji, setDeckEmoji] = useState('')
  const [deckColor, setDeckColor] = useState(ACCENTS[0]?.id ?? 'violet')

  /* ---------------- card modal ---------------- */
  const [cardFormOpen, setCardFormOpen] = useState(false)
  const [cardEditingId, setCardEditingId] = useState<string | null>(null)
  const [cardFront, setCardFront] = useState('')
  const [cardBack, setCardBack] = useState('')

  /* ---------------- two-tap delete confirms ---------------- */
  const [confirmCardId, setConfirmCardId] = useState<string | null>(null)
  const [confirmDeckDelete, setConfirmDeckDelete] = useState(false)

  useEffect(() => {
    if (!confirmCardId) return
    const t = setTimeout(() => setConfirmCardId(null), 3000)
    return () => clearTimeout(t)
  }, [confirmCardId])

  useEffect(() => {
    if (!confirmDeckDelete) return
    const t = setTimeout(() => setConfirmDeckDelete(false), 3000)
    return () => clearTimeout(t)
  }, [confirmDeckDelete])

  /* ---------------- hydration (migrates v1 cards in memory) ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const all = await idbGetAll<Deck>(DECKS_STORE)
        if (!alive) return
        const clean = all
          .filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string')
          .map<Deck>((d) => ({
            id: d.id,
            name: d.name,
            emoji: typeof d.emoji === 'string' ? d.emoji : '',
            color: ACCENTS.some((a) => a.id === d.color) ? d.color : 'violet',
            createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
            reviewLog: normalizeReviewLog(d.reviewLog),
            cards: Array.isArray(d.cards)
              ? d.cards
                  .filter((c) => c && typeof c.id === 'string')
                  .map<FlashCard>((c) => normalizeCard(c))
              : [],
          }))
          .sort((a, b) => b.createdAt - a.createdAt)
        setDecks(clean)
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
  const activeDeck = useMemo(() => decks.find((d) => d.id === activeDeckId) ?? null, [decks, activeDeckId])
  const activeAccent = activeDeck ? accentOf(activeDeck.color) : ACCENTS[0]

  const totals = useMemo(() => {
    let cards = 0
    let mastered = 0
    for (const d of decks) {
      for (const c of d.cards) {
        cards++
        if (c.correct > c.wrong) mastered++
      }
    }
    return { cards, mastered }
  }, [decks])

  const sessionSummary = useMemo(() => {
    if (!session) return null
    const ids = Object.keys(session.first)
    let firstTry = 0
    for (const id of ids) {
      const g = session.first[id]
      if (g && g !== 'again') firstTry++
    }
    return {
      unique: ids.length,
      firstTry,
      accuracy: ids.length === 0 ? 0 : Math.round((firstTry / ids.length) * 100),
    }
  }, [session])

  const activeDeckStats = useMemo(() => (activeDeck ? deckStats(activeDeck) : null), [activeDeck])

  const studyCard =
    session && activeDeck ? activeDeck.cards.find((c) => c.id === session.queue[session.index]) ?? null : null

  /* ---------------- mutations (write-through to IndexedDB) ---------------- */
  const persistDeck = useCallback((deck: Deck) => {
    setDecks((prev) => prev.map((d) => (d.id === deck.id ? deck : d)))
    void idbPut(DECKS_STORE, deck).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const createDeck = useCallback(
    (name: string, emoji: string, color: string) => {
      const deck: Deck = { id: uid('deck'), name, emoji, color, createdAt: Date.now(), cards: [], reviewLog: {} }
      setDecks((prev) => [deck, ...prev])
      void idbPut(DECKS_STORE, deck).catch(() => {
        /* memory-only fallback */
      })
      return deck
    },
    []
  )

  const removeDeck = useCallback((id: string) => {
    setDecks((prev) => prev.filter((d) => d.id !== id))
    void idbDelete(DECKS_STORE, id).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  /* ---------------- deck form ---------------- */
  const openDeckForm = useCallback((deck?: Deck) => {
    setDeckEditingId(deck?.id ?? null)
    setDeckName(deck?.name ?? '')
    setDeckEmoji(deck?.emoji ?? '')
    setDeckColor(deck?.color ?? ACCENTS[0]?.id ?? 'violet')
    setDeckFormOpen(true)
  }, [])

  const submitDeckForm = useCallback(() => {
    const name = deckName.trim()
    if (!name) return
    if (deckEditingId) {
      const current = decks.find((d) => d.id === deckEditingId)
      if (current) {
        persistDeck({ ...current, name, emoji: deckEmoji, color: deckColor })
        toast({ title: 'Deck updated', description: `${deckEmoji || '🃏'} ${name}` })
      }
    } else {
      const deck = createDeck(name, deckEmoji, deckColor)
      toast({ title: 'Deck created', description: `${deckEmoji || '🃏'} ${name} — add some cards to get studying` })
      setActiveDeckId(deck.id)
      setScreen('deck')
    }
    setDeckFormOpen(false)
    haptic()
  }, [createDeck, deckColor, deckEditingId, deckEmoji, deckName, decks, persistDeck, toast])

  /* ---------------- card form ---------------- */
  const openCardForm = useCallback((card?: FlashCard) => {
    setCardEditingId(card?.id ?? null)
    setCardFront(card?.front ?? '')
    setCardBack(card?.back ?? '')
    setCardFormOpen(true)
  }, [])

  const submitCardForm = useCallback(() => {
    const front = cardFront.trim()
    const back = cardBack.trim()
    if (!activeDeck || !front || !back) return
    if (cardEditingId) {
      persistDeck({
        ...activeDeck,
        cards: activeDeck.cards.map((c) => (c.id === cardEditingId ? { ...c, front, back } : c)),
      })
      toast({ title: 'Card updated', description: truncate(front, 48) })
    } else {
      const card: FlashCard = {
        id: uid('card'),
        front,
        back,
        correct: 0,
        wrong: 0,
        ease: 2.5,
        intervalDays: 0,
        due: todayKey(),
        reps: 0,
        lapses: 0,
      }
      persistDeck({ ...activeDeck, cards: [card, ...activeDeck.cards] })
      toast({ title: 'Card added', description: truncate(front, 48) })
    }
    setCardFormOpen(false)
    haptic()
  }, [activeDeck, cardBack, cardEditingId, cardFront, persistDeck, toast])

  const deleteCard = useCallback(
    (cardId: string) => {
      if (!activeDeck) return
      persistDeck({ ...activeDeck, cards: activeDeck.cards.filter((c) => c.id !== cardId) })
      setConfirmCardId(null)
      haptic()
      toast({ title: 'Card deleted' })
    },
    [activeDeck, persistDeck, toast]
  )

  const deleteActiveDeck = useCallback(() => {
    if (!activeDeck) return
    removeDeck(activeDeck.id)
    setConfirmDeckDelete(false)
    setActiveDeckId(null)
    setScreen('home')
    haptic(18)
    toast({ title: 'Deck deleted', description: `${activeDeck.emoji || '🃏'} ${activeDeck.name} and its cards` })
  }, [activeDeck, removeDeck, toast])

  /* ---------------- navigation ---------------- */
  const openDeck = useCallback((id: string) => {
    setActiveDeckId(id)
    setConfirmDeckDelete(false)
    setConfirmCardId(null)
    setScreen('deck')
    haptic()
  }, [])

  const goHome = useCallback(() => {
    setActiveDeckId(null)
    setConfirmDeckDelete(false)
    setScreen('home')
    haptic()
  }, [])

  /* ---------------- study session ---------------- */
  const startStudy = useCallback(
    (deck: Deck, mode: StudyMode) => {
      if (deck.cards.length === 0) return
      let ids: string[]
      if (mode === 'due') {
        const today = todayKey()
        const dueCards = deck.cards
          .filter((c) => c.due <= today)
          .sort((a, b) => (a.due === b.due ? b.lapses - a.lapses : a.due < b.due ? -1 : 1))
          .map((c) => c.id)
        if (dueCards.length === 0) {
          // celebratory "all caught up" state — nothing due right now
          setSession(null)
          setFlipped(false)
          setScreen('caught')
          haptic([10, 30, 10])
          return
        }
        ids = dueCards
      } else {
        ids = deck.cards.map((c) => c.id)
        if (shuffle) ids = shuffleArr(ids)
      }
      setSession({
        mode,
        queue: ids,
        index: 0,
        got: 0,
        again: 0,
        first: {},
        counts: { again: 0, hard: 0, good: 0, easy: 0 },
      })
      setFlipped(false)
      setScreen('study')
      haptic()
    },
    [shuffle]
  )

  const exitStudy = useCallback(() => {
    setSession(null)
    setFlipped(false)
    setScreen('deck')
    haptic()
  }, [])

  const backToDeck = useCallback(() => {
    setFlipped(false)
    setScreen('deck')
    haptic()
  }, [])

  const flipCard = useCallback(() => {
    if (!session) return
    setFlipped((f) => !f)
    haptic()
  }, [session])

  const grade = useCallback(
    (g: Grade) => {
      if (!session || !activeDeck || !flipped) return
      const cardId = session.queue[session.index]
      if (!cardId) return
      const card = activeDeck.cards.find((c) => c.id === cardId)
      if (!card) return

      // 1) update the card's counters + schedule, log the review, persist
      const sched = nextSchedule(card, g)
      const today = todayKey()
      const log = { ...activeDeck.reviewLog }
      log[today] = (log[today] ?? 0) + 1
      persistDeck({
        ...activeDeck,
        reviewLog: log,
        cards: activeDeck.cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                correct: c.correct + (g === 'again' ? 0 : 1),
                wrong: c.wrong + (g === 'again' ? 1 : 0),
                lastResult: g,
                ...sched,
              }
            : c
        ),
      })

      // 2) advance the session; Again cards re-queue at the end
      const first = { ...session.first }
      if (!(cardId in first)) first[cardId] = g
      const next: Session = {
        ...session,
        queue: g === 'again' ? [...session.queue, cardId] : session.queue,
        index: session.index + 1,
        got: session.got + (g === 'again' ? 0 : 1),
        again: session.again + (g === 'again' ? 1 : 0),
        first,
        counts: {
          again: session.counts.again + (g === 'again' ? 1 : 0),
          hard: session.counts.hard + (g === 'hard' ? 1 : 0),
          good: session.counts.good + (g === 'good' ? 1 : 0),
          easy: session.counts.easy + (g === 'easy' ? 1 : 0),
        },
      }
      setSession(next)
      setFlipped(false)
      haptic(g === 'again' ? [12, 40, 12] : 12)

      // 3) session complete → summary (same event, no cascading effect)
      if (next.index >= next.queue.length) setScreen('summary')
    },
    [activeDeck, flipped, persistDeck, session]
  )

  const toggleShuffle = useCallback(() => {
    const next = !shuffle
    setShuffle(next)
    try {
      localStorage.setItem(SHUFFLE_KEY, next ? '1' : '0')
    } catch {
      /* storage unavailable */
    }
    // mid-session: shuffle only the cards still ahead
    if (next && screen === 'study') {
      setSession((p) => {
        if (!p || p.mode === 'due') return p
        const head = p.queue.slice(0, p.index + 1)
        const tail = shuffleArr(p.queue.slice(p.index + 1))
        return { ...p, queue: [...head, ...tail] }
      })
    }
    haptic()
  }, [screen, shuffle])

  // keyboard shortcuts while studying (Space/Enter flip · 1 Again · 2 Hard · 3 Good · 4 Easy · ←/→ Again/Good)
  useEffect(() => {
    if (screen !== 'study' || !session) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const onControl = !!target?.closest('button, input, textarea, select, a')
      if ((e.key === ' ' || e.key === 'Enter') && !onControl) {
        e.preventDefault()
        flipCard()
      } else if (flipped && (e.key === '1' || e.key === 'ArrowLeft')) {
        e.preventDefault()
        grade('again')
      } else if (flipped && e.key === '2') {
        e.preventDefault()
        grade('hard')
      } else if (flipped && (e.key === '3' || e.key === 'ArrowRight')) {
        e.preventDefault()
        grade('good')
      } else if (flipped && e.key === '4') {
        e.preventDefault()
        grade('easy')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipCard, flipped, grade, screen, session])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-violet-500/[0.1] via-transparent to-fuchsia-500/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-400 via-purple-500 to-fuchsia-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(168_85_247/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Layers className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Flashcards</h2>
              <p className="text-xs text-zinc-400">Flip, grade and remember — spaced repetition on this device.</p>
            </div>
            {screen === 'home' && (
              <Button
                onClick={() => openDeckForm()}
                className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-600 font-semibold text-white shadow-lg hover:from-violet-300 hover:via-purple-400 hover:to-fuchsia-500"
              >
                <Plus className="size-4" aria-hidden /> Deck
              </Button>
            )}
          </div>
        </div>

        {!loaded ? (
          /* ---------------- Hydrating ---------------- */
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
            ))}
          </div>
        ) : screen === 'home' ? (
          <HomeScreen decks={decks} totals={totals} onOpenDeck={openDeck} onStudy={(d) => startStudy(d, 'all')} onNewDeck={() => openDeckForm()} />
        ) : screen === 'deck' && activeDeck ? (
          <DeckScreen
            deck={activeDeck}
            shuffle={shuffle}
            confirmDeckDelete={confirmDeckDelete}
            confirmCardId={confirmCardId}
            onBack={goHome}
            onEditDeck={() => openDeckForm(activeDeck)}
            onDeleteDeck={() => setConfirmDeckDelete(true)}
            onStudy={() => startStudy(activeDeck, 'all')}
            onStudyDue={() => startStudy(activeDeck, 'due')}
            onAddCard={() => openCardForm()}
            onEditCard={(c) => openCardForm(c)}
            onAskDeleteCard={(id) => setConfirmCardId(id)}
            onDeleteCard={(id) => deleteCard(id)}
            onToggleShuffle={toggleShuffle}
          />
        ) : screen === 'caught' && activeDeck ? (
          <CaughtUpScreen deck={activeDeck} onStudyAll={() => startStudy(activeDeck, 'all')} onBack={backToDeck} />
        ) : (screen === 'study' || screen === 'summary') && session && activeDeck ? (
          screen === 'summary' && sessionSummary && activeDeckStats ? (
            <SummaryScreen
              deck={activeDeck}
              stats={activeDeckStats}
              summary={sessionSummary}
              counts={session.counts}
              mode={session.mode}
              onAgain={() => startStudy(activeDeck, session.mode)}
              onBack={backToDeck}
            />
          ) : screen === 'study' && studyCard ? (
            <StudyScreen
              deck={activeDeck}
              card={studyCard}
              session={session}
              flipped={flipped}
              shuffle={shuffle}
              onFlip={flipCard}
              onGrade={grade}
              onExit={exitStudy}
              onToggleShuffle={toggleShuffle}
            />
          ) : null
        ) : null}
      </motion.div>

      {/* ---------------- Deck modal (create / rename) ---------------- */}
      <AnimatePresence>
        {deckFormOpen && (
          <motion.div
            key="deck-form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setDeckFormOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label={deckEditingId ? 'Edit deck' : 'New deck'}
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-violet-500/20 text-violet-300">
                  <Layers className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">{deckEditingId ? 'Edit deck' : 'New deck'}</h3>
                <button
                  onClick={() => setDeckFormOpen(false)}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-4">
                {/* name */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Name</p>
                  <input
                    value={deckName}
                    onChange={(e) => setDeckName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitDeckForm()
                    }}
                    placeholder="e.g. Spanish verbs"
                    maxLength={40}
                    aria-label="Deck name"
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus:border-violet-400/50 focus:outline-none"
                  />
                </div>

                {/* emoji */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Icon <span className="font-normal normal-case text-zinc-600">(optional)</span>
                  </p>
                  <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Deck icon">
                    <button
                      type="button"
                      onClick={() => setDeckEmoji('')}
                      role="radio"
                      aria-checked={deckEmoji === ''}
                      aria-label="No icon"
                      className={cn(
                        'flex h-11 w-11 items-center justify-center rounded-xl border transition-all',
                        deckEmoji === ''
                          ? 'border-violet-400/60 bg-violet-500/15 text-violet-300 shadow-md'
                          : 'border-white/10 bg-white/5 text-zinc-500 hover:bg-white/10'
                      )}
                    >
                      <Layers className="size-4" aria-hidden />
                    </button>
                    {DECK_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setDeckEmoji(emoji)}
                        role="radio"
                        aria-checked={deckEmoji === emoji}
                        aria-label={`Icon ${emoji}`}
                        className={cn(
                          'flex h-11 w-11 items-center justify-center rounded-xl border text-lg transition-all',
                          deckEmoji === emoji
                            ? 'border-violet-400/60 bg-violet-500/15 shadow-md'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        )}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {/* accent */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Accent color</p>
                  <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Accent color">
                    {ACCENTS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => setDeckColor(a.id)}
                        role="radio"
                        aria-checked={deckColor === a.id}
                        aria-label={a.name}
                        style={{ backgroundColor: a.hex }}
                        className={cn(
                          'flex h-11 w-11 items-center justify-center rounded-xl transition-all',
                          deckColor === a.id
                            ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-950'
                            : 'opacity-70 hover:opacity-100'
                        )}
                      >
                        {deckColor === a.id && <Check className="size-4 text-zinc-950" strokeWidth={3} aria-hidden />}
                      </button>
                    ))}
                  </div>
                </div>

                <Button
                  onClick={submitDeckForm}
                  disabled={!deckName.trim()}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-600 font-semibold text-white shadow-lg hover:from-violet-300 hover:via-purple-400 hover:to-fuchsia-500 disabled:opacity-40"
                >
                  {deckEditingId ? 'Save deck' : 'Create deck'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Card modal (add / edit) ---------------- */}
      <AnimatePresence>
        {cardFormOpen && activeDeck && (
          <motion.div
            key="card-form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setCardFormOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label={cardEditingId ? 'Edit card' : 'New card'}
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span
                  className="flex size-9 items-center justify-center rounded-xl text-base"
                  style={{
                    backgroundColor: activeAccent ? `${activeAccent.hex}22` : undefined,
                    color: activeAccent?.hex,
                  }}
                  aria-hidden
                >
                  {activeDeck.emoji || <Layers className="size-4.5" />}
                </span>
                <h3 className="flex-1 truncate text-sm font-bold">
                  {cardEditingId ? 'Edit card' : `New card · ${activeDeck.name}`}
                </h3>
                <button
                  onClick={() => setCardFormOpen(false)}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Front</p>
                    <p className="text-[10px] tabular-nums text-zinc-600">{cardFront.length} / 1000</p>
                  </div>
                  <textarea
                    value={cardFront}
                    onChange={(e) => setCardFront(e.target.value.slice(0, 1000))}
                    placeholder="The question or prompt…"
                    rows={3}
                    maxLength={1000}
                    aria-label="Card front"
                    className="min-h-24 w-full resize-none rounded-xl border border-white/10 bg-white/5 p-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus:border-violet-400/50 focus:outline-none"
                  />
                </div>

                <div>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Back</p>
                    <p className="text-[10px] tabular-nums text-zinc-600">{cardBack.length} / 1000</p>
                  </div>
                  <textarea
                    value={cardBack}
                    onChange={(e) => setCardBack(e.target.value.slice(0, 1000))}
                    placeholder="The answer…"
                    rows={3}
                    maxLength={1000}
                    aria-label="Card back"
                    className="min-h-24 w-full resize-none rounded-xl border border-white/10 bg-white/5 p-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus:border-violet-400/50 focus:outline-none"
                  />
                </div>

                <Button
                  onClick={submitCardForm}
                  disabled={!cardFront.trim() || !cardBack.trim()}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-600 font-semibold text-white shadow-lg hover:from-violet-300 hover:via-purple-400 hover:to-fuchsia-500 disabled:opacity-40"
                >
                  {cardEditingId ? 'Save card' : 'Add card'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ================================================================== */
/* Shared bits — chips                                                 */
/* ================================================================== */

function StatChip({
  icon,
  label,
  count,
  tone,
}: {
  icon: ReactNode
  label: string
  count: number
  tone: 'amber' | 'sky' | 'emerald' | 'zinc'
}) {
  const tones: Record<'amber' | 'sky' | 'emerald' | 'zinc', string> = {
    amber: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
    sky: 'border-sky-400/25 bg-sky-400/10 text-sky-200',
    emerald: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
    zinc: 'border-white/10 bg-white/5 text-zinc-300',
  }
  return (
    <span className={cn('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold', tones[tone])}>
      {icon}
      {label}
      <span className="rounded-full bg-black/25 px-1.5 py-px tabular-nums">{count}</span>
    </span>
  )
}

function SrsChip({ card }: { card: FlashCard }) {
  const l = dueLabelOf(card)
  return (
    <span
      className={cn(
        'shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider',
        l.tone === 'amber'
          ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
          : l.tone === 'emerald'
            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
            : 'border-white/10 bg-white/5 text-zinc-400'
      )}
    >
      {l.text}
    </span>
  )
}

/* ================================================================== */
/* Home screen — stats strip + deck grid                               */
/* ================================================================== */

function HomeScreen({
  decks,
  totals,
  onOpenDeck,
  onStudy,
  onNewDeck,
}: {
  decks: Deck[]
  totals: { cards: number; mastered: number }
  onOpenDeck: (id: string) => void
  onStudy: (deck: Deck) => void
  onNewDeck: () => void
}) {
  return (
    <div className="space-y-5 p-4 sm:p-5">
      {/* ---------------- Stats strip ---------------- */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <Layers className="size-3.5 text-violet-300" aria-hidden /> Cards
          </p>
          <p className="mt-0.5 text-xl font-black tabular-nums tracking-tight text-zinc-100">{totals.cards}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <Trophy className="size-3.5 text-emerald-300" aria-hidden /> Mastered
          </p>
          <p className="mt-0.5 text-xl font-black tabular-nums tracking-tight text-emerald-300">{totals.mastered}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <BookOpen className="size-3.5 text-fuchsia-300" aria-hidden /> Decks
          </p>
          <p className="mt-0.5 text-xl font-black tabular-nums tracking-tight text-zinc-100">{decks.length}</p>
        </div>
      </div>

      {/* ---------------- Decks ---------------- */}
      <div>
        <div className="mb-2.5 flex items-baseline justify-between">
          <p className="text-sm font-bold">Your decks</p>
          <p className="text-[11px] text-zinc-500">{decks.length === 0 ? 'Nothing yet' : `${decks.length} total`}</p>
        </div>

        {decks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-violet-300">
              <Layers className="size-7" aria-hidden />
            </span>
            <p className="text-sm font-semibold text-zinc-300">No decks yet</p>
            <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
              Create a deck of front/back cards, then flip through them. Spaced repetition schedules reviews so cards
              come back right before you forget — all on this device.
            </p>
            <Button
              onClick={onNewDeck}
              className="mt-1 h-11 rounded-xl bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-600 font-semibold text-white shadow-lg hover:from-violet-300 hover:via-purple-400 hover:to-fuchsia-500"
            >
              <Plus className="size-4" aria-hidden /> Create your first deck
            </Button>
          </div>
        ) : (
          <div
            className={cn(
              'grid gap-3 sm:grid-cols-2',
              decks.length > 4 && 'max-h-96 overflow-y-auto pr-1',
              THIN_SCROLLBAR
            )}
          >
            {decks.map((deck) => {
              const accent = accentOf(deck.color)
              const accuracy = deckAccuracy(deck)
              const dueCount = deckBuckets(deck).due
              return (
                <motion.div
                  key={deck.id}
                  layout
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                  whileTap={{ scale: 0.97 }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open deck ${deck.name}`}
                  onClick={() => onOpenDeck(deck.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenDeck(deck.id)
                    }
                  }}
                  className="cursor-pointer rounded-2xl border border-white/10 bg-white/[0.04] p-3 transition-colors hover:bg-white/[0.07]"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border text-2xl"
                      style={{ backgroundColor: `${accent.hex}1a`, borderColor: `${accent.hex}44` }}
                      aria-hidden
                    >
                      {deck.emoji || <Layers className="size-5" style={{ color: accent.hex }} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-zinc-100">{deck.name}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-zinc-500">
                        <span>
                          {deck.cards.length} {deck.cards.length === 1 ? 'card' : 'cards'} ·{' '}
                          {accuracy === null ? 'New' : `${accuracy}% accuracy`}
                        </span>
                        {dueCount > 0 && (
                          <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-px text-[10px] font-bold text-amber-300">
                            {dueCount} due
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ backgroundColor: accent.hex }}
                          initial={{ width: 0 }}
                          animate={{ width: `${accuracy ?? 0}%` }}
                          transition={{ type: 'spring', stiffness: 120, damping: 24 }}
                        />
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onStudy(deck)
                      }}
                      disabled={deck.cards.length === 0}
                      aria-label={`Study ${deck.name} now`}
                      style={{ color: accent.hex, backgroundColor: `${accent.hex}14`, borderColor: `${accent.hex}33` }}
                      className="flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors hover:brightness-125 disabled:opacity-30"
                    >
                      <Play className="size-4.5" aria-hidden />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Deck screen — meta, insights, actions, card list                    */
/* ================================================================== */

function DeckScreen({
  deck,
  shuffle,
  confirmDeckDelete,
  confirmCardId,
  onBack,
  onEditDeck,
  onDeleteDeck,
  onStudy,
  onStudyDue,
  onAddCard,
  onEditCard,
  onAskDeleteCard,
  onDeleteCard,
  onToggleShuffle,
}: {
  deck: Deck
  shuffle: boolean
  confirmDeckDelete: boolean
  confirmCardId: string | null
  onBack: () => void
  onEditDeck: () => void
  onDeleteDeck: () => void
  onStudy: () => void
  onStudyDue: () => void
  onAddCard: () => void
  onEditCard: (card: FlashCard) => void
  onAskDeleteCard: (id: string) => void
  onDeleteCard: (id: string) => void
  onToggleShuffle: () => void
}) {
  const accent = accentOf(deck.color)
  const stats = deckStats(deck)
  const buckets = deckBuckets(deck)
  const streak = reviewStreak(deck.reviewLog)
  const forecast = dueForecast(deck)
  const canStudy = deck.cards.length > 0
  const totalForBar = Math.max(buckets.total, 1)

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {/* nav row */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          aria-label="All decks"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-4.5" aria-hidden />
        </button>
        <span
          className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border text-xl"
          style={{ backgroundColor: `${accent.hex}1a`, borderColor: `${accent.hex}44` }}
          aria-hidden
        >
          {deck.emoji || <Layers className="size-5" style={{ color: accent.hex }} />}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-base font-bold tracking-tight">{deck.name}</h3>
        <button
          onClick={onEditDeck}
          aria-label="Edit deck"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <Pencil className="size-4" aria-hidden />
        </button>
        <button
          onClick={onDeleteDeck}
          aria-label={confirmDeckDelete ? 'Confirm delete deck' : 'Delete deck'}
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors',
            confirmDeckDelete
              ? 'border-rose-400/50 bg-rose-500 text-white'
              : 'border-white/10 bg-white/5 text-zinc-400 hover:border-rose-400/40 hover:bg-rose-500/15 hover:text-rose-300'
          )}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>

      {/* meta card */}
      <div
        className="rounded-2xl border p-4"
        style={{ backgroundColor: `${accent.hex}0d`, borderColor: `${accent.hex}33` }}
      >
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">All-time accuracy</p>
            <p className="mt-0.5 text-3xl font-black tracking-tight" style={{ color: accent.hex }}>
              {stats.accuracy === null ? '—' : `${stats.accuracy}%`}
            </p>
          </div>
          <p className="pb-1 text-right text-[11px] leading-relaxed text-zinc-500">
            {deck.cards.length} {deck.cards.length === 1 ? 'card' : 'cards'}
            <br />
            {stats.mastered} mastered · {stats.gradings} graded
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.07]">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: accent.hex }}
            initial={{ width: 0 }}
            animate={{ width: `${stats.accuracy ?? 0}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 24 }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 font-semibold text-zinc-300">
            <Flame className={cn('size-3.5', streak > 0 ? 'text-amber-400' : 'text-zinc-600')} aria-hidden />
            {streak === 0 ? 'No streak yet' : `${streak}-day streak`}
          </span>
          <span className="text-zinc-500">
            {stats.gradings} {stats.gradings === 1 ? 'review' : 'reviews'} all-time
          </span>
        </div>
      </div>

      {/* insights card — buckets + maturity mix + 7-day forecast */}
      {deck.cards.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex flex-wrap gap-1.5">
            <StatChip
              icon={<Clock className="size-3" aria-hidden />}
              label="Due today"
              count={buckets.due}
              tone="amber"
            />
            <StatChip
              icon={<Sparkles className="size-3" aria-hidden />}
              label="Learning"
              count={buckets.learning}
              tone="sky"
            />
            <StatChip
              icon={<ShieldCheck className="size-3" aria-hidden />}
              label="Mature"
              count={buckets.mature}
              tone="emerald"
            />
            <StatChip icon={<Layers className="size-3" aria-hidden />} label="Total" count={buckets.total} tone="zinc" />
          </div>

          {/* maturity mix — learning / young / mature */}
          <div
            className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
            role="img"
            aria-label={`Card maturity: ${buckets.learning} learning, ${buckets.young} young, ${buckets.mature} mature`}
          >
            {[
              { key: 'learning', color: '#38bdf8', value: buckets.learning },
              { key: 'young', color: '#52525b', value: buckets.young },
              { key: 'mature', color: '#34d399', value: buckets.mature },
            ]
              .filter((s) => s.value > 0)
              .map((s) => (
                <motion.div
                  key={s.key}
                  className="h-full"
                  style={{ backgroundColor: s.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(s.value / totalForBar) * 100}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 24 }}
                />
              ))}
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-[10px] text-zinc-500">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-sky-400" aria-hidden /> Learning
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-zinc-600" aria-hidden /> Young
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-full bg-emerald-400" aria-hidden /> Mature
            </span>
          </div>

          {/* 7-day due forecast */}
          <div className="mt-4 border-t border-white/5 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Due next 7 days</p>
            <div className="mt-1 h-24 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={forecast} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="day"
                    tick={{ fill: '#71717a', fontSize: 9 }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis hide domain={[0, 'dataMax + 1']} allowDecimals={false} />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    formatter={(value) => [`${Number(value)} ${Number(value) === 1 ? 'card' : 'cards'}`, 'Due']}
                  />
                  <Bar dataKey="count" fill="#fbbf24" radius={[3, 3, 0, 0]} maxBarSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* actions */}
      <div className="space-y-2.5">
        <div className="flex gap-2.5">
          <Button
            onClick={onStudy}
            disabled={!canStudy}
            className="h-11 flex-1 rounded-xl bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-600 font-semibold text-white shadow-lg hover:from-violet-300 hover:via-purple-400 hover:to-fuchsia-500 disabled:opacity-40"
          >
            <Play className="size-4" aria-hidden /> Study all
          </Button>
          <Button
            onClick={onStudyDue}
            disabled={!canStudy}
            variant="ghost"
            className="h-11 flex-1 rounded-xl border border-amber-400/30 bg-amber-400/15 font-semibold text-amber-200 shadow-none hover:bg-amber-400/25 disabled:opacity-40"
          >
            <Clock className="size-4" aria-hidden /> Due now
            <span className="ml-0.5 rounded-full bg-amber-400/20 px-1.5 py-px text-[11px] font-bold tabular-nums">
              {buckets.due}
            </span>
          </Button>
        </div>
        <Button
          onClick={onAddCard}
          className="h-11 w-full rounded-xl border border-white/10 bg-white/5 font-semibold text-zinc-100 shadow-none hover:bg-white/10"
          variant="ghost"
        >
          <Plus className="size-4" aria-hidden /> Add card
        </Button>
      </div>

      {/* shuffle toggle */}
      <button
        onClick={onToggleShuffle}
        aria-pressed={shuffle}
        className="flex h-11 w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3.5 transition-colors hover:bg-white/[0.06]"
      >
        <span className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
          <Shuffle className={cn('size-4', shuffle ? 'text-violet-300' : 'text-zinc-500')} aria-hidden />
          Shuffle in “Study all”
        </span>
        <span
          className={cn(
            'flex h-6 w-11 items-center rounded-full p-0.5 transition-colors',
            shuffle ? 'bg-violet-500' : 'bg-white/10'
          )}
          aria-hidden
        >
          <span
            className={cn(
              'size-5 rounded-full bg-white shadow transition-transform',
              shuffle ? 'translate-x-5' : 'translate-x-0'
            )}
          />
        </span>
      </button>

      {/* card list */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <p className="text-sm font-bold">Cards</p>
          <p className="text-[11px] text-zinc-500">
            {deck.cards.length === 0 ? 'Empty' : `${deck.cards.length} in this deck`}
          </p>
        </div>

        {deck.cards.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
            <Layers className="size-8 text-zinc-600" aria-hidden />
            <p className="text-sm font-semibold text-zinc-300">No cards in this deck yet</p>
            <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
              Add front/back cards, then hit Study to flip through them. Grading schedules each card&apos;s next
              review automatically.
            </p>
            <Button
              onClick={onAddCard}
              className="mt-1 h-11 rounded-xl bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-600 font-semibold text-white shadow-lg hover:from-violet-300 hover:via-purple-400 hover:to-fuchsia-500"
            >
              <Plus className="size-4" aria-hidden /> Add your first card
            </Button>
          </div>
        ) : (
          <div className={cn('space-y-1.5', deck.cards.length > 5 && 'max-h-96 overflow-y-auto pr-1', THIN_SCROLLBAR)}>
            {deck.cards.map((card) => {
              const confirming = confirmCardId === card.id
              const due = dueLabelOf(card)
              return (
                <motion.div
                  key={card.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                  className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5"
                >
                  <span
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      card.lastResult === 'again'
                        ? 'bg-rose-400'
                        : card.lastResult === 'hard'
                          ? 'bg-amber-400'
                          : card.lastResult === 'good'
                            ? 'bg-emerald-400'
                            : card.lastResult === 'easy'
                              ? 'bg-violet-400'
                              : 'bg-zinc-700'
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-100">{card.front}</p>
                    <p className="truncate text-[11px] text-zinc-500">{card.back}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <p className="text-[10px] font-semibold tabular-nums text-zinc-500" aria-hidden>
                      <span className="text-emerald-400/80">{card.correct}✓</span>{' '}
                      <span className="text-rose-400/80">{card.wrong}✗</span>
                    </p>
                    <span
                      className={cn(
                        'text-[10px] font-semibold',
                        due.tone === 'amber'
                          ? 'text-amber-300'
                          : due.tone === 'emerald'
                            ? 'text-emerald-300/80'
                            : 'text-zinc-600'
                      )}
                    >
                      {due.text}
                    </span>
                  </div>
                  <button
                    onClick={() => onEditCard(card)}
                    aria-label={`Edit card ${truncate(card.front, 24)}`}
                    className="flex size-11 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
                  >
                    <Pencil className="size-4" aria-hidden />
                  </button>
                  <button
                    onClick={() => (confirming ? onDeleteCard(card.id) : onAskDeleteCard(card.id))}
                    aria-label={confirming ? `Confirm delete card ${truncate(card.front, 24)}` : `Delete card ${truncate(card.front, 24)}`}
                    className={cn(
                      'flex size-11 shrink-0 items-center justify-center rounded-full transition-colors',
                      confirming
                        ? 'bg-rose-500 text-white'
                        : 'text-zinc-500 hover:bg-rose-500/15 hover:text-rose-300'
                    )}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Study screen — 3D flip card, 4-way grading, progress                */
/* ================================================================== */

const GRADE_BUTTONS: { grade: Grade; label: string; icon: ReactNode; btn: string }[] = [
  {
    grade: 'again',
    label: 'Again',
    icon: <X className="size-4" aria-hidden />,
    btn: 'bg-gradient-to-r from-rose-400 to-rose-600 text-white shadow-lg shadow-rose-500/20 hover:from-rose-300 hover:to-rose-500',
  },
  {
    grade: 'hard',
    label: 'Hard',
    icon: <Minus className="size-4" aria-hidden />,
    btn: 'bg-gradient-to-r from-amber-300 to-amber-500 text-zinc-950 shadow-lg shadow-amber-500/20 hover:from-amber-200 hover:to-amber-400',
  },
  {
    grade: 'good',
    label: 'Good',
    icon: <Check className="size-4" aria-hidden />,
    btn: 'bg-gradient-to-r from-emerald-300 to-emerald-500 text-zinc-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-200 hover:to-emerald-400',
  },
  {
    grade: 'easy',
    label: 'Easy',
    icon: <Zap className="size-4" aria-hidden />,
    btn: 'bg-gradient-to-r from-violet-400 to-fuchsia-600 text-white shadow-lg shadow-violet-500/25 hover:from-violet-300 hover:to-fuchsia-500',
  },
]

function StudyScreen({
  deck,
  card,
  session,
  flipped,
  shuffle,
  onFlip,
  onGrade,
  onExit,
  onToggleShuffle,
}: {
  deck: Deck
  card: FlashCard
  session: Session
  flipped: boolean
  shuffle: boolean
  onFlip: () => void
  onGrade: (grade: Grade) => void
  onExit: () => void
  onToggleShuffle: () => void
}) {
  const accent = accentOf(deck.color)
  const progress = session.queue.length === 0 ? 0 : Math.round((session.index / session.queue.length) * 100)
  const isDue = session.mode === 'due'

  return (
    <div className="p-4 sm:p-5">
      {/* session top bar */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onExit}
          aria-label="End session"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="size-4.5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-zinc-100">
            {deck.emoji ? `${deck.emoji} ` : ''}
            {deck.name}
          </p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span
              className={cn(
                'rounded-full px-2 py-px text-[9px] font-bold uppercase tracking-wider',
                isDue ? 'bg-amber-400/15 text-amber-300' : 'bg-violet-400/15 text-violet-300'
              )}
            >
              {isDue ? 'Due now' : 'All cards'}
            </span>
            <span className="text-[11px] tabular-nums text-zinc-500">
              {session.index} of {session.queue.length} graded
            </span>
          </div>
        </div>
        {!isDue && (
          <button
            onClick={onToggleShuffle}
            aria-pressed={shuffle}
            aria-label="Shuffle remaining cards"
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors',
              shuffle
                ? 'border-violet-400/30 bg-violet-500/15 text-violet-300'
                : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'
            )}
          >
            <Shuffle className="size-4.5" aria-hidden />
          </button>
        )}
      </div>

      {/* progress bar */}
      <div
        className="mt-3.5 h-2 overflow-hidden rounded-full bg-white/[0.07]"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Session progress"
      >
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-500"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 24 }}
        />
      </div>

      {/* flip card */}
      <div className="mt-5 [perspective:1400px]">
        <motion.div
          className="relative h-72 w-full cursor-pointer select-none [transform-style:preserve-3d] sm:h-80"
          animate={{ rotateY: flipped ? 180 : 0 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 220, damping: 24 }}
          onClick={onFlip}
          role="button"
          tabIndex={0}
          aria-label={flipped ? 'Show front of card' : 'Show back of card'}
        >
          {/* front face */}
          <div className="absolute inset-0 flex flex-col rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-5 [backface-visibility:hidden]">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Front
              </span>
              <div className="flex items-center gap-2">
                <SrsChip card={card} />
                <span className="text-[10px] font-semibold tabular-nums text-zinc-500">
                  {card.correct}✓ · {card.wrong}✗
                </span>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center overflow-y-auto py-3">
              <p className="w-full whitespace-pre-wrap break-words text-xl font-semibold leading-snug text-zinc-100">
                {card.front}
              </p>
            </div>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
              <RotateCw className="size-3.5" aria-hidden /> Tap card to flip
            </p>
          </div>

          {/* back face */}
          <div
            className="absolute inset-0 flex flex-col rounded-3xl border bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-5 [backface-visibility:hidden] [transform:rotateY(180deg)]"
            style={{ borderColor: `${accent.hex}55` }}
          >
            <div className="flex items-center justify-between gap-2">
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: accent.hex, backgroundColor: `${accent.hex}1f` }}
              >
                Back
              </span>
              <div className="flex items-center gap-2">
                <SrsChip card={card} />
                <span className="text-[10px] font-semibold tabular-nums text-zinc-500">
                  {card.correct}✓ · {card.wrong}✗
                </span>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center overflow-y-auto py-3">
              <p className="w-full whitespace-pre-wrap break-words text-xl font-semibold leading-snug text-zinc-100">
                {card.back}
              </p>
            </div>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
              <GraduationCap className="size-3.5" aria-hidden /> How did you do?
            </p>
          </div>
        </motion.div>
      </div>

      {/* actions */}
      <div className="mt-5">
        <AnimatePresence mode="wait" initial={false}>
          {flipped ? (
            <motion.div
              key="grade"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            >
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {GRADE_BUTTONS.map((g) => (
                  <button
                    key={g.grade}
                    onClick={() => onGrade(g.grade)}
                    aria-label={`Grade ${g.label}, next review ${gradePreview(card, g.grade)}`}
                    className={cn(
                      'flex h-12 flex-col items-center justify-center rounded-xl text-sm font-bold shadow-md transition-all active:scale-95',
                      g.btn
                    )}
                  >
                    <span className="flex items-center gap-1">
                      {g.icon} {g.label}
                    </span>
                    <span className="text-[10px] font-semibold opacity-80">{gradePreview(card, g.grade)}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="flip"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            >
              <button
                onClick={onFlip}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-100 transition-colors hover:bg-white/10"
              >
                <RotateCw className="size-4" aria-hidden /> Flip card
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        <p className="mt-3 text-center text-[11px] text-zinc-600">
          Again cards come back at the end of the session · keys 1–4 grade
        </p>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Summary screen — graded counts, next due preview, all-time stats    */
/* ================================================================== */

function SummaryScreen({
  deck,
  stats,
  summary,
  counts,
  mode,
  onAgain,
  onBack,
}: {
  deck: Deck
  stats: DeckStats
  summary: { unique: number; firstTry: number; accuracy: number }
  counts: { again: number; hard: number; good: number; easy: number }
  mode: StudyMode
  onAgain: () => void
  onBack: () => void
}) {
  const accent = accentOf(deck.color)
  const today = todayKey()
  const tomorrow = addDaysKey(1)
  let dueTomorrow = 0
  let dueToday = 0
  for (const c of deck.cards) {
    if (c.due === tomorrow) dueTomorrow++
    else if (c.due <= today) dueToday++
  }
  const streak = reviewStreak(deck.reviewLog)

  const tiles: { grade: Grade; label: string; cls: string }[] = [
    { grade: 'again', label: 'Again', cls: 'border-rose-400/20 bg-rose-500/10' },
    { grade: 'hard', label: 'Hard', cls: 'border-amber-400/20 bg-amber-500/10' },
    { grade: 'good', label: 'Good', cls: 'border-emerald-400/20 bg-emerald-500/10' },
    { grade: 'easy', label: 'Easy', cls: 'border-violet-400/20 bg-violet-500/10' },
  ]
  const tileText: Record<Grade, string> = {
    again: 'text-rose-200',
    hard: 'text-amber-200',
    good: 'text-emerald-200',
    easy: 'text-violet-200',
  }
  const tileLabel: Record<Grade, string> = {
    again: 'text-rose-300/80',
    hard: 'text-amber-300/80',
    good: 'text-emerald-300/80',
    easy: 'text-violet-300/80',
  }

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {/* session result */}
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-500/[0.1] to-fuchsia-500/[0.06] p-5 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 via-purple-500 to-fuchsia-600 text-white shadow-lg">
          <GraduationCap className="size-6" aria-hidden />
        </span>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {mode === 'due' ? 'Due session complete' : 'Session complete'}
        </p>
        <p className="mt-1 text-5xl font-black tracking-tight text-white">{summary.accuracy}%</p>
        <p className="mt-1 text-xs text-zinc-400">
          first-try accuracy · {summary.unique} {summary.unique === 1 ? 'card' : 'cards'}
        </p>
        <div className="mt-4 grid grid-cols-4 gap-1.5">
          {tiles.map((t) => (
            <div key={t.grade} className={cn('rounded-xl border px-1.5 py-2', t.cls)}>
              <p className={cn('text-[9px] font-semibold uppercase tracking-wider', tileLabel[t.grade])}>{t.label}</p>
              <p className={cn('text-lg font-black tabular-nums', tileText[t.grade])}>{counts[t.grade]}</p>
            </div>
          ))}
        </div>
      </div>

      {/* next due preview */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="flex items-center gap-2 text-sm font-bold">
          <Clock className="size-4 text-amber-300" aria-hidden /> What&apos;s next
        </p>
        <div className="mt-2 space-y-1.5 text-xs">
          {dueTomorrow > 0 && (
            <p className="flex items-center gap-2 text-zinc-300">
              <CalendarGlyph /> <span>
                <b className="tabular-nums text-zinc-100">{dueTomorrow}</b> {dueTomorrow === 1 ? 'card' : 'cards'} due
                tomorrow
              </span>
            </p>
          )}
          {dueToday > 0 && (
            <p className="flex items-center gap-2 text-amber-300/90">
              <Clock className="size-3.5 shrink-0" aria-hidden /> <span>
                <b className="tabular-nums">{dueToday}</b> {dueToday === 1 ? 'card' : 'cards'} still due today
              </span>
            </p>
          )}
          {dueTomorrow === 0 && dueToday === 0 && (
            <p className="text-zinc-500">Nothing scheduled — check back in a few days ☕</p>
          )}
        </div>
      </div>

      {/* all-time deck stats */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between">
          <p className="flex min-w-0 items-center gap-2 text-sm font-bold">
            <span aria-hidden>{deck.emoji || '🃏'}</span>
            <span className="truncate">{deck.name}</span>
          </p>
          <p className="shrink-0 text-xs font-bold tabular-nums" style={{ color: accent.hex }}>
            {stats.accuracy === null ? 'New' : `${stats.accuracy}% all-time`}
          </p>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.07]">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: accent.hex }}
            initial={{ width: 0 }}
            animate={{ width: `${stats.accuracy ?? 0}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 24 }}
          />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <div className="rounded-xl bg-white/[0.04] px-2 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Graded</p>
            <p className="text-sm font-bold tabular-nums text-zinc-100">{stats.gradings}</p>
          </div>
          <div className="rounded-xl bg-white/[0.04] px-2 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">Mastered</p>
            <p className="text-sm font-bold tabular-nums text-emerald-300">
              {stats.mastered}/{deck.cards.length}
            </p>
          </div>
          <div className="rounded-xl bg-white/[0.04] px-2 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/80">Streak</p>
            <p className="text-sm font-bold tabular-nums text-amber-300">{streak}d</p>
          </div>
          <div className="rounded-xl bg-white/[0.04] px-2 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Cards</p>
            <p className="text-sm font-bold tabular-nums text-zinc-100">{deck.cards.length}</p>
          </div>
        </div>
      </div>

      {/* actions */}
      <div className="flex gap-2.5">
        <Button
          onClick={onAgain}
          className="h-11 flex-1 rounded-xl bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-600 font-semibold text-white shadow-lg hover:from-violet-300 hover:via-purple-400 hover:to-fuchsia-500"
        >
          <RotateCw className="size-4" aria-hidden /> {mode === 'due' ? 'Review again' : 'Study again'}
        </Button>
        <Button
          onClick={onBack}
          className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 font-semibold text-zinc-100 shadow-none hover:bg-white/10"
          variant="ghost"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to deck
        </Button>
      </div>
    </div>
  )
}

/** Small calendar glyph for the "due tomorrow" line. */
function CalendarGlyph() {
  return (
    <span
      className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border border-zinc-500 text-[7px] font-black leading-none text-zinc-400"
      aria-hidden
    >
      31
    </span>
  )
}

/* ================================================================== */
/* Caught-up screen — celebratory empty due queue                      */
/* ================================================================== */

function CaughtUpScreen({
  deck,
  onStudyAll,
  onBack,
}: {
  deck: Deck
  onStudyAll: () => void
  onBack: () => void
}) {
  const today = todayKey()
  const tomorrow = addDaysKey(1)
  let dueTomorrow = 0
  let earliest: string | null = null
  for (const c of deck.cards) {
    if (c.due === tomorrow) dueTomorrow++
    if (c.due > today && (earliest === null || c.due < earliest)) earliest = c.due
  }
  const nextIn = earliest ? daysBetweenKeys(today, earliest) : null

  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <motion.span
        initial={{ scale: 0.3, rotate: -14, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 13 }}
        className="relative flex size-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-400 via-purple-500 to-fuchsia-600 text-white shadow-[0_18px_44px_-12px_rgb(168_85_247/0.75)]"
      >
        <PartyPopper className="size-9" aria-hidden />
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className={cn(
              'absolute size-1.5 rounded-full',
              i === 0 ? 'bg-amber-300' : i === 1 ? 'bg-fuchsia-300' : 'bg-emerald-300'
            )}
            style={{ left: `${20 + i * 28}%`, top: `${i === 1 ? -6 : 8}%` }}
            initial={{ y: 6, opacity: 0 }}
            animate={{ y: -10 - i * 4, opacity: [0, 1, 0] }}
            transition={{ duration: 1.2, delay: 0.25 + i * 0.18, repeat: Infinity, repeatDelay: 1.6 }}
            aria-hidden
          />
        ))}
      </motion.span>

      <motion.h3
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, type: 'spring', stiffness: 320, damping: 26 }}
        className="mt-5 text-xl font-black tracking-tight text-white"
      >
        All caught up! 🎉
      </motion.h3>
      <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-zinc-400">
        Nothing is due in {deck.emoji || ''} {deck.name} right now. Spaced repetition will bring the right cards back
        at the right time.
      </p>

      {(dueTomorrow > 0 || nextIn !== null) && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, type: 'spring', stiffness: 320, damping: 26 }}
          className="mt-4 flex flex-wrap items-center justify-center gap-2"
        >
          {dueTomorrow > 0 && (
            <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300">
              {dueTomorrow} {dueTomorrow === 1 ? 'card' : 'cards'} due tomorrow
            </span>
          )}
          {nextIn !== null && nextIn > 1 && (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-zinc-300">
              Next review in {nextIn} days
            </span>
          )}
        </motion.div>
      )}

      <div className="mt-7 flex w-full max-w-xs flex-col gap-2.5">
        <Button
          onClick={onStudyAll}
          className="h-11 w-full rounded-xl bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-600 font-semibold text-white shadow-lg hover:from-violet-300 hover:via-purple-400 hover:to-fuchsia-500"
        >
          <Play className="size-4" aria-hidden /> Study all cards anyway
        </Button>
        <Button
          onClick={onBack}
          className="h-11 w-full rounded-xl border border-white/10 bg-white/5 font-semibold text-zinc-100 shadow-none hover:bg-white/10"
          variant="ghost"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back to deck
        </Button>
      </div>
    </div>
  )
}
