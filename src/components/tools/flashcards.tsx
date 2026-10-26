'use client'

/**
 * Flashcards — build decks, flip, grade, remember.
 *
 * Decks of front/back cards with a 3D flip study mode. Grading ("Again" /
 * "Got it") updates per-card counters, re-queues missed cards to the end of
 * the session queue, and feeds all-time deck accuracy. Everything persists
 * in IndexedDB — private, offline, instant.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  BookOpen,
  Check,
  GraduationCap,
  Layers,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Shuffle,
  Trash2,
  Trophy,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type Grade = 'correct' | 'wrong'

interface FlashCard {
  id: string
  front: string
  back: string
  correct: number
  wrong: number
  lastResult?: Grade
}

interface Deck {
  id: string
  name: string
  emoji: string
  /** accent id from ACCENTS */
  color: string
  createdAt: number
  cards: FlashCard[]
}

interface Session {
  /** card ids; may contain repeats (wrong cards re-queued at the end) */
  queue: string[]
  index: number
  got: number
  again: number
  /** first-attempt result per card id (accuracy basis) */
  first: Record<string, Grade>
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

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n).trimEnd()}…` : s
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

type Screen = 'home' | 'deck' | 'study' | 'summary'

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

  /* ---------------- hydration ---------------- */
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
            cards: Array.isArray(d.cards)
              ? d.cards
                  .filter((c) => c && typeof c.id === 'string')
                  .map<FlashCard>((c) => ({
                    id: c.id,
                    front: typeof c.front === 'string' ? c.front : '',
                    back: typeof c.back === 'string' ? c.back : '',
                    correct: Number(c.correct) || 0,
                    wrong: Number(c.wrong) || 0,
                    lastResult: c.lastResult === 'correct' || c.lastResult === 'wrong' ? c.lastResult : undefined,
                  }))
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
    const firstTry = ids.filter((id) => session.first[id] === 'correct').length
    return {
      unique: ids.length,
      firstTry,
      accuracy: ids.length === 0 ? 0 : Math.round((firstTry / ids.length) * 100),
    }
  }, [session])

  const activeDeckStats = useMemo(() => (activeDeck ? deckStats(activeDeck) : null), [activeDeck])

  /* ---------------- mutations (write-through to IndexedDB) ---------------- */
  const persistDeck = useCallback((deck: Deck) => {
    setDecks((prev) => prev.map((d) => (d.id === deck.id ? deck : d)))
    void idbPut(DECKS_STORE, deck).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const createDeck = useCallback(
    (name: string, emoji: string, color: string) => {
      const deck: Deck = { id: uid('deck'), name, emoji, color, createdAt: Date.now(), cards: [] }
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
      const card: FlashCard = { id: uid('card'), front, back, correct: 0, wrong: 0 }
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
    (deck: Deck) => {
      if (deck.cards.length === 0) return
      const ids = deck.cards.map((c) => c.id)
      setSession({
        queue: shuffle ? shuffleArr(ids) : ids,
        index: 0,
        got: 0,
        again: 0,
        first: {},
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

  const flipCard = useCallback(() => {
    if (!session) return
    setFlipped((f) => !f)
    haptic()
  }, [session])

  const grade = useCallback(
    (result: Grade) => {
      if (!session || !activeDeck || !flipped) return
      const cardId = session.queue[session.index]
      if (!cardId) return

      // 1) update the card's all-time counters and persist the deck
      persistDeck({
        ...activeDeck,
        cards: activeDeck.cards.map((c) =>
          c.id === cardId
            ? {
                ...c,
                correct: c.correct + (result === 'correct' ? 1 : 0),
                wrong: c.wrong + (result === 'wrong' ? 1 : 0),
                lastResult: result,
              }
            : c
        ),
      })

      // 2) advance the session; wrong cards re-queue at the end
      const first = { ...session.first }
      if (!(cardId in first)) first[cardId] = result
      const next = {
        ...session,
        queue: result === 'wrong' ? [...session.queue, cardId] : session.queue,
        index: session.index + 1,
        got: session.got + (result === 'correct' ? 1 : 0),
        again: session.again + (result === 'wrong' ? 1 : 0),
        first,
      }
      setSession(next)
      setFlipped(false)
      haptic(result === 'correct' ? 12 : [12, 40, 12])

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
        if (!p) return p
        const head = p.queue.slice(0, p.index + 1)
        const tail = shuffleArr(p.queue.slice(p.index + 1))
        return { ...p, queue: [...head, ...tail] }
      })
    }
    haptic()
  }, [screen, shuffle])

  // keyboard shortcuts while studying (Space/Enter flip · 1/← Again · 2/→ Got it)
  useEffect(() => {
    if (screen !== 'study' || !session) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const onControl = !!target?.closest('button, input, textarea, select, a')
      if ((e.key === ' ' || e.key === 'Enter') && !onControl) {
        e.preventDefault()
        flipCard()
      } else if (flipped && (e.key === '1' || e.key === 'ArrowLeft')) {
        grade('wrong')
      } else if (flipped && (e.key === '2' || e.key === 'ArrowRight')) {
        grade('correct')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipCard, flipped, grade, screen, session])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  const studyCard =
    session && activeDeck ? activeDeck.cards.find((c) => c.id === session.queue[session.index]) ?? null : null

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
              <p className="text-xs text-zinc-400">Flip, grade and remember — all on this device.</p>
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
          <HomeScreen
            decks={decks}
            totals={totals}
            onOpenDeck={openDeck}
            onStudy={(d) => startStudy(d)}
            onNewDeck={() => openDeckForm()}
          />
        ) : screen === 'deck' && activeDeck ? (
          <DeckScreen
            deck={activeDeck}
            shuffle={shuffle}
            confirmDeckDelete={confirmDeckDelete}
            confirmCardId={confirmCardId}
            onBack={goHome}
            onEditDeck={() => openDeckForm(activeDeck)}
            onDeleteDeck={() => setConfirmDeckDelete(true)}
            onStudy={() => startStudy(activeDeck)}
            onAddCard={() => openCardForm()}
            onEditCard={(c) => openCardForm(c)}
            onAskDeleteCard={(id) => setConfirmCardId(id)}
            onDeleteCard={(id) => deleteCard(id)}
            onToggleShuffle={toggleShuffle}
          />
        ) : (screen === 'study' || screen === 'summary') && session && activeDeck ? (
          screen === 'summary' && sessionSummary && activeDeckStats ? (
            <SummaryScreen
              deck={activeDeck}
              stats={activeDeckStats}
              summary={sessionSummary}
              got={session.got}
              again={session.again}
              onAgain={() => startStudy(activeDeck)}
              onBack={() => {
                setSession(null)
                setScreen('deck')
              }}
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
              Create a deck of front/back cards, then flip through it. Grading builds your all-time stats — data never
              leaves this device.
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
                      <p className="text-[11px] text-zinc-500">
                        {deck.cards.length} {deck.cards.length === 1 ? 'card' : 'cards'} ·{' '}
                        {accuracy === null ? 'New' : `${accuracy}% accuracy`}
                      </p>
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
/* Deck screen — meta, actions, card list                              */
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
  onAddCard: () => void
  onEditCard: (card: FlashCard) => void
  onAskDeleteCard: (id: string) => void
  onDeleteCard: (id: string) => void
  onToggleShuffle: () => void
}) {
  const accent = accentOf(deck.color)
  const stats = deckStats(deck)
  const canStudy = deck.cards.length > 0

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
      </div>

      {/* actions */}
      <div className="flex gap-2.5">
        <Button
          onClick={onStudy}
          disabled={!canStudy}
          className="h-11 flex-1 rounded-xl bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-600 font-semibold text-white shadow-lg hover:from-violet-300 hover:via-purple-400 hover:to-fuchsia-500 disabled:opacity-40"
        >
          <Play className="size-4" aria-hidden /> Study
        </Button>
        <Button
          onClick={onAddCard}
          className="h-11 flex-1 rounded-xl border border-white/10 bg-white/5 font-semibold text-zinc-100 shadow-none hover:bg-white/10"
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
          Shuffle cards
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
              Add front/back cards, then hit Study to flip through them.
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
                      card.lastResult === 'correct'
                        ? 'bg-emerald-400'
                        : card.lastResult === 'wrong'
                          ? 'bg-rose-400'
                          : 'bg-zinc-700'
                    )}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-100">{card.front}</p>
                    <p className="truncate text-[11px] text-zinc-500">{card.back}</p>
                  </div>
                  <p className="shrink-0 text-[10px] font-semibold tabular-nums text-zinc-500" aria-hidden>
                    <span className="text-emerald-400/80">{card.correct}✓</span>{' '}
                    <span className="text-rose-400/80">{card.wrong}✗</span>
                  </p>
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
/* Study screen — 3D flip card, grading, progress                      */
/* ================================================================== */

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
  onGrade: (result: Grade) => void
  onExit: () => void
  onToggleShuffle: () => void
}) {
  const accent = accentOf(deck.color)
  const progress = session.queue.length === 0 ? 0 : Math.round((session.index / session.queue.length) * 100)

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
          <p className="text-[11px] tabular-nums text-zinc-500">
            {session.index} of {session.queue.length} graded
          </p>
        </div>
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
            <div className="flex items-center justify-between">
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Front
              </span>
              <span className="text-[10px] font-semibold tabular-nums text-zinc-500">
                {card.correct}✓ · {card.wrong}✗
              </span>
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
            <div className="flex items-center justify-between">
              <span
                className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: accent.hex, backgroundColor: `${accent.hex}1f` }}
              >
                Back
              </span>
              <span className="text-[10px] font-semibold tabular-nums text-zinc-500">
                {card.correct}✓ · {card.wrong}✗
              </span>
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
              className="flex gap-2.5"
            >
              <Button
                onClick={() => onGrade('wrong')}
                className="h-12 flex-1 rounded-xl bg-gradient-to-r from-rose-400 to-rose-600 text-base font-bold text-white shadow-lg shadow-rose-500/20 hover:from-rose-300 hover:to-rose-500"
              >
                <X className="size-4.5" aria-hidden /> Again
              </Button>
              <Button
                onClick={() => onGrade('correct')}
                className="h-12 flex-1 rounded-xl bg-gradient-to-r from-emerald-300 to-emerald-500 text-base font-bold text-zinc-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-200 hover:to-emerald-400"
              >
                <Check className="size-4.5" aria-hidden /> Got it
              </Button>
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
          Missed cards come back at the end of the session
        </p>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Summary screen — session results + all-time stats                   */
/* ================================================================== */

function SummaryScreen({
  deck,
  stats,
  summary,
  got,
  again,
  onAgain,
  onBack,
}: {
  deck: Deck
  stats: DeckStats
  summary: { unique: number; firstTry: number; accuracy: number }
  got: number
  again: number
  onAgain: () => void
  onBack: () => void
}) {
  const accent = accentOf(deck.color)

  return (
    <div className="space-y-4 p-4 sm:p-5">
      {/* session result */}
      <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-violet-500/[0.1] to-fuchsia-500/[0.06] p-5 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 via-purple-500 to-fuchsia-600 text-white shadow-lg">
          <GraduationCap className="size-6" aria-hidden />
        </span>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Session complete</p>
        <p className="mt-1 text-5xl font-black tracking-tight text-white">{summary.accuracy}%</p>
        <p className="mt-1 text-xs text-zinc-400">
          first-try accuracy · {summary.unique} {summary.unique === 1 ? 'card' : 'cards'}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/80">Got it</p>
            <p className="text-xl font-black tabular-nums text-emerald-200">{got}</p>
          </div>
          <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-300/80">Again</p>
            <p className="text-xl font-black tabular-nums text-rose-200">{again}</p>
          </div>
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
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
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
          <RotateCw className="size-4" aria-hidden /> Study again
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
