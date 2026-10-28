'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PartyPopper, RotateCcw, Timer as TimerIcon, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getGameStat, recordGameResult, unlockAchievement } from '@/lib/games/scores'

/* ================================================================== */
/* Solitaire — classic Klondike (draw-1). Drag runs with pointer or    */
/* tap for auto-move; foundations, recycling stock, undo, timer and    */
/* a staggered win cascade. Best time via the shared games store.      */
/*                                                                     */
/* Card layout is pure CSS flow: piles are flex columns, each card     */
/* overlaps the previous via negative percentage margins (relative to  */
/* the pile width), so everything scales with the viewport.            */
/* ================================================================== */

type Suit = 'S' | 'H' | 'D' | 'C'

interface CardT {
  id: number
  suit: Suit
  rank: number /* 1 = A … 13 = K */
  faceUp: boolean
}

interface GameState {
  stock: CardT[]
  waste: CardT[]
  foundations: CardT[][]
  tableau: CardT[][]
  moves: number
  undos: number
}

const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }
const SUIT_RED: Record<Suit, boolean> = { S: false, C: false, H: true, D: true }
const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

/* overlap as negative top margin, % of pile width (card height = 140%) */
const OVERLAP_DOWN = '-116%' /* shows ~24% of a face-down card */
const OVERLAP_UP = '-99%' /* shows ~41% of a face-up card */

function freshDeck(): CardT[] {
  const cards: CardT[] = []
  let id = 0
  for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) {
    for (let rank = 1; rank <= 13; rank++) cards.push({ id: id++, suit, rank, faceUp: false })
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[cards[i], cards[j]] = [cards[j], cards[i]]
  }
  return cards
}

function deal(): GameState {
  const deck = freshDeck()
  const tableau: CardT[][] = []
  for (let i = 0; i < 7; i++) {
    const pile = deck.splice(0, i + 1)
    pile[pile.length - 1].faceUp = true
    tableau.push(pile)
  }
  return { stock: deck, waste: [], foundations: [[], [], [], []], tableau, moves: 0, undos: 0 }
}

function cloneState(s: GameState): GameState {
  return {
    stock: s.stock.map((c) => ({ ...c })),
    waste: s.waste.map((c) => ({ ...c })),
    foundations: s.foundations.map((f) => f.map((c) => ({ ...c }))),
    tableau: s.tableau.map((t) => t.map((c) => ({ ...c }))),
    moves: s.moves,
    undos: s.undos,
  }
}

const isRed = (c: CardT) => SUIT_RED[c.suit]

function canDropTableau(card: CardT, pile: CardT[]): boolean {
  if (pile.length === 0) return card.rank === 13
  const top = pile[pile.length - 1]
  if (!top.faceUp) return false
  return isRed(card) !== isRed(top) && card.rank === top.rank - 1
}

function foundationSlot(foundations: CardT[][], card: CardT): number {
  for (let i = 0; i < 4; i++) {
    const f = foundations[i]
    if (f.length === 0) {
      if (card.rank === 1) return i
    } else {
      const top = f[f.length - 1]
      if (top.suit === card.suit && card.rank === top.rank + 1) return i
    }
  }
  return -1
}

function isValidRun(pile: CardT[], idx: number): boolean {
  for (let i = idx; i < pile.length - 1; i++) {
    const a = pile[i]
    const b = pile[i + 1]
    if (!a.faceUp || !b.faceUp) return false
    if (isRed(a) === isRed(b) || b.rank !== a.rank - 1) return false
  }
  return true
}

function flipExposed(s: GameState): GameState {
  for (const pile of s.tableau) {
    const last = pile[pile.length - 1]
    if (last && !last.faceUp) last.faceUp = true
  }
  return s
}

function fmtTime(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

interface DragInfo {
  from: 'waste' | 'tableau'
  pile: number
  cardIdx: number
  x: number
  y: number
}

export default function SolitaireApp() {
  const [state, setState] = useState<GameState>(deal)
  const [history, setHistory] = useState<GameState[]>([])
  const [elapsed, setElapsed] = useState(0)
  const [status, setStatus] = useState<'playing' | 'won'>('playing')
  const [best, setBest] = useState(() =>
    typeof window === 'undefined' ? 0 : getGameStat('solitaire').best
  )
  const [newBest, setNewBest] = useState(false)
  const [dragging, setDragging] = useState<DragInfo | null>(null)

  const pileRefs = useRef<Array<HTMLDivElement | null>>([null, null, null, null, null, null, null])
  const foundationRefs = useRef<Array<HTMLDivElement | null>>([null, null, null, null])
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)

  const won = status === 'won'

  useEffect(() => {
    if (status !== 'playing') return
    const t = setInterval(() => setElapsed((e) => Math.min(3599, e + 1)), 1000)
    return () => clearInterval(t)
  }, [status])

  /** Called with the next state by every foundation-touching move. */
  const finalizeIfWon = useCallback(
    (snap: GameState): GameState => {
      if (snap.foundations.every((f) => f.length === 13)) {
        setStatus('won')
        const res = recordGameResult('solitaire', { value: elapsed, timeMode: true, won: true })
        setBest(res.stat.best)
        setNewBest(res.isNewBest)
        unlockAchievement('solitaire-first-win')
        if (elapsed <= 300) unlockAchievement('solitaire-sub5')
        if (snap.undos === 0) unlockAchievement('solitaire-noundo')
        if (navigator.vibrate) navigator.vibrate([20, 40, 20, 40, 60])
      }
      return snap
    },
    [elapsed]
  )

  const newGame = useCallback(() => {
    setState(deal())
    setHistory([])
    setElapsed(0)
    setStatus('playing')
    setNewBest(false)
    setDragging(null)
  }, [])

  const undo = useCallback(() => {
    if (!history.length) return
    const prev = history[history.length - 1]
    setState(cloneState(prev))
    setHistory(history.slice(0, -1))
  }, [history])

  /* ---------------- core moves ---------------- */

  const drawStock = useCallback(() => {
    if (status !== 'playing') return
    const pre = cloneState(state)
    const snap = cloneState(state)
    snap.moves += 1
    if (snap.stock.length) {
      const card = snap.stock.pop() as CardT
      card.faceUp = true
      snap.waste.push(card)
      setHistory((h) => [...h.slice(-80), pre])
      setState(snap)
    } else if (snap.waste.length) {
      snap.stock = snap.waste
        .reverse()
        .map((c) => ({ ...c, faceUp: false }))
      snap.waste = []
      setHistory((h) => [...h.slice(-80), pre])
      setState(snap)
    }
  }, [state, status])

  const moveWasteToFoundation = useCallback(
    (slot: number) => {
      const pre = cloneState(state)
      const snap = cloneState(state)
      const card = snap.waste[snap.waste.length - 1]
      if (!card || foundationSlot(snap.foundations, card) !== slot) return
      snap.waste.pop()
      snap.foundations[slot].push(card)
      snap.moves += 1
      setHistory((h) => [...h.slice(-80), pre])
      setState(finalizeIfWon(flipExposed(snap)))
    },
    [state, finalizeIfWon]
  )

  const moveWasteToTableau = useCallback(
    (p: number) => {
      const pre = cloneState(state)
      const snap = cloneState(state)
      const card = snap.waste[snap.waste.length - 1]
      if (!card || !canDropTableau(card, snap.tableau[p])) return
      snap.waste.pop()
      snap.tableau[p].push(card)
      snap.moves += 1
      setHistory((h) => [...h.slice(-80), pre])
      setState(flipExposed(snap))
    },
    [state]
  )

  const moveRunTo = useCallback(
    (from: 'tableau' | 'foundation', pile: number, idx: number, to: { kind: 'tableau' | 'foundation'; pile: number }) => {
      const pre = cloneState(state)
      const snap = cloneState(state)
      const source = from === 'tableau' ? snap.tableau[pile] : snap.foundations[pile]
      const run = source.slice(idx)
      if (!run.length || !run[0].faceUp || !isValidRun(source, idx)) return

      if (to.kind === 'foundation') {
        if (run.length !== 1) return
        const f = snap.foundations[to.pile]
        if (f.length === 0 ? run[0].rank !== 1 : !(f[f.length - 1].suit === run[0].suit && run[0].rank === f[f.length - 1].rank + 1)) return
      } else if (!canDropTableau(run[0], snap.tableau[to.pile])) {
        return
      }
      if (from === 'tableau' && to.kind === 'tableau' && to.pile === pile) return

      source.splice(idx)
      if (to.kind === 'foundation') snap.foundations[to.pile].push(run[0])
      else snap.tableau[to.pile].push(...run)
      snap.moves += 1
      setHistory((h) => [...h.slice(-80), pre])
      setState(finalizeIfWon(flipExposed(snap)))
    },
    [state, finalizeIfWon]
  )

  /** Tap = smart auto-move for the tapped card/run. */
  const autoMove = useCallback(
    (from: 'waste' | 'tableau' | 'foundation', pile: number, idx: number) => {
      if (status !== 'playing') return
      const source =
        from === 'waste' ? state.waste : from === 'tableau' ? state.tableau[pile] : state.foundations[pile]
      if (!source.length) return
      const card = from === 'waste' ? source[source.length - 1] : source[idx]
      if (!card || !card.faceUp) return

      /* single top card → foundation first */
      const isTop = from === 'waste' ? true : idx === source.length - 1
      if (isTop && from !== 'foundation') {
        const slot = foundationSlot(state.foundations, card)
        if (slot >= 0) {
          if (from === 'waste') moveWasteToFoundation(slot)
          else moveRunTo(from, pile, idx, { kind: 'foundation', pile: slot })
          return
        }
      }
      /* then try each tableau pile */
      for (let p = 0; p < 7; p++) {
        if (from === 'tableau' && p === pile) continue
        const target = state.tableau[p]
        if (canDropTableau(card, target)) {
          if (from === 'waste') moveWasteToTableau(p)
          else moveRunTo(from, pile, idx, { kind: 'tableau', pile: p })
          return
        }
      }
    },
    [state, status, moveWasteToFoundation, moveWasteToTableau, moveRunTo]
  )

  /* ---------------- pointer drag ---------------- */

  const onPointerDown = (
    e: React.PointerEvent,
    from: 'waste' | 'tableau',
    pile: number,
    idx: number
  ) => {
    if (status !== 'playing') return
    const source = from === 'waste' ? state.waste : state.tableau[pile]
    const card = source[idx]
    if (!card || !card.faceUp) return
    if (from === 'tableau' && !isValidRun(state.tableau[pile], idx)) return
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    setDragging({ from, pile, cardIdx: idx, x: e.clientX, y: e.clientY })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return
    setDragging((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return
    const start = dragStartRef.current
    const d = dragging
    dragStartRef.current = null
    setDragging(null)

    const moved = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : 0
    if (moved < 8) {
      autoMove(d.from, d.pile, d.cardIdx)
      return
    }

    const source = d.from === 'waste' ? state.waste : state.tableau[d.pile]
    const card = source[d.cardIdx]
    if (!card) return

    /* foundations */
    for (let i = 0; i < 4; i++) {
      const el = foundationRefs.current[i]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        if (d.from === 'waste' && d.cardIdx === state.waste.length - 1 && foundationSlot(state.foundations, card) === i) {
          moveWasteToFoundation(i)
        } else if (d.from !== 'waste') {
          moveRunTo('tableau', d.pile, d.cardIdx, { kind: 'foundation', pile: i })
        }
        return
      }
    }
    /* tableau */
    for (let i = 0; i < 7; i++) {
      const el = pileRefs.current[i]
      if (!el) continue
      const r = el.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 40 && e.clientY <= r.bottom + 60) {
        if (d.from === 'waste') moveWasteToTableau(i)
        else moveRunTo('tableau', d.pile, d.cardIdx, { kind: 'tableau', pile: i })
        return
      }
    }
  }

  /* ---------------- render ---------------- */

  const dragRun: CardT[] =
    dragging !== null
      ? dragging.from === 'waste'
        ? state.waste.length > 0
          ? [state.waste[state.waste.length - 1]]
          : []
        : state.tableau[dragging.pile].slice(dragging.cardIdx)
      : []

  const renderCardFace = (card: CardT, extra?: string) => (
    <div
      className={cn(
        'flex size-full select-none flex-col justify-between rounded-lg bg-white p-1 shadow ring-1 ring-black/15',
        extra
      )}
    >
      <div className={cn('text-[11px] font-black leading-none sm:text-sm', isRed(card) ? 'text-rose-600' : 'text-zinc-800')}>
        {RANK_LABEL[card.rank]}
      </div>
      <div className={cn('self-center text-base leading-none sm:text-xl', isRed(card) ? 'text-rose-500' : 'text-zinc-700')} aria-hidden>
        {SUIT_GLYPH[card.suit]}
      </div>
      <div className={cn('self-end text-[11px] font-black leading-none sm:text-sm', isRed(card) ? 'text-rose-600' : 'text-zinc-800')}>
        {RANK_LABEL[card.rank]}
      </div>
    </div>
  )

  const cardBack = (
    <div className="size-full select-none rounded-lg bg-gradient-to-br from-emerald-600 to-teal-800 shadow ring-1 ring-black/20">
      <div className="size-full rounded-lg border border-white/25 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.08)_0_4px,transparent_4px_8px)]" />
    </div>
  )

  return (
    <Card className="overflow-hidden shadow-md">
      <CardContent className="space-y-3 p-3 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="bg-gradient-to-r from-teal-500 to-emerald-600 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
              Solitaire
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Klondike · draw one</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="min-w-[58px] rounded-xl bg-muted px-2.5 py-1.5 text-center ring-1 ring-border/60">
              <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <TimerIcon className="size-3" aria-hidden /> Time
              </div>
              <div className="text-base font-bold tabular-nums text-foreground">{fmtTime(elapsed)}</div>
            </div>
            <div className="min-w-[58px] rounded-xl bg-muted px-2.5 py-1.5 text-center ring-1 ring-border/60">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Moves</div>
              <div className="text-base font-bold tabular-nums text-foreground">{state.moves}</div>
            </div>
          </div>
        </div>

        {/* Top row: stock / waste / foundations */}
        <div className="mx-auto grid w-full max-w-[min(96vw,520px)] grid-cols-7 gap-1 sm:gap-1.5">
          <button
            onClick={drawStock}
            aria-label={state.stock.length ? 'Draw a card' : state.waste.length ? 'Recycle waste into stock' : 'Stock empty'}
            className="aspect-[100/140]"
          >
            {state.stock.length ? (
              cardBack
            ) : (
              <div className="flex size-full items-center justify-center rounded-lg border-2 border-dashed border-border/70 bg-muted/30 text-lg text-muted-foreground">
                ↻
              </div>
            )}
          </button>
          <div
            className={cn('aspect-[100/140]', !state.waste.length && 'rounded-lg border-2 border-dashed border-border/40')}
            onPointerDown={(e) => state.waste.length && onPointerDown(e, 'waste', 0, state.waste.length - 1)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            role={state.waste.length ? 'button' : undefined}
            aria-label={state.waste.length ? `Waste top: ${RANK_LABEL[state.waste[state.waste.length - 1].rank]}${SUIT_GLYPH[state.waste[state.waste.length - 1].suit]}` : 'Waste empty'}
          >
            {!dragging && state.waste.length
              ? renderCardFace(state.waste[state.waste.length - 1], 'cursor-grab active:cursor-grabbing')
              : !state.waste.length && <div className="size-full rounded-lg bg-muted/20" />}
          </div>
          <div aria-hidden className="hidden sm:block" />
          {state.foundations.map((f, i) => (
            <div
              key={i}
              ref={(el) => {
                foundationRefs.current[i] = el
              }}
              className="aspect-[100/140] rounded-lg border-2 border-dashed border-border/60 bg-muted/20"
            >
              {f.length > 0 && renderCardFace(f[f.length - 1])}
            </div>
          ))}
        </div>

        {/* Tableau */}
        <div className="mx-auto flex w-full max-w-[min(96vw,520px)] gap-1 sm:gap-1.5">
          {state.tableau.map((pile, p) => (
            <div
              key={p}
              ref={(el) => {
                pileRefs.current[p] = el
              }}
              className="relative min-w-0 flex-1"
            >
              {pile.length === 0 && (
                <div className="aspect-[100/140] rounded-lg border-2 border-dashed border-border/50 bg-muted/20" />
              )}
              {pile.map((card, idx) => {
                const isDragOrigin =
                  dragging !== null && dragging.from === 'tableau' && dragging.pile === p && idx >= dragging.cardIdx
                return (
                  <div
                    key={card.id}
                    role="button"
                    aria-label={`${RANK_LABEL[card.rank]}${SUIT_GLYPH[card.suit]}${card.faceUp ? '' : ' face down'}`}
                    className={cn('relative aspect-[100/140] touch-none', isDragOrigin && 'opacity-25')}
                    style={{ marginTop: idx === 0 ? 0 : card.faceUp ? OVERLAP_UP : OVERLAP_DOWN }}
                    onPointerDown={(e) => onPointerDown(e, 'tableau', p, idx)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  >
                    {card.faceUp
                      ? renderCardFace(card, 'cursor-grab active:cursor-grabbing')
                      : cardBack}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        {/* Floating dragged run */}
        {dragging !== null && dragRun.length > 0 && (
          <div
            className="pointer-events-none fixed z-50"
            style={{
              left: dragging.x - 30,
              top: dragging.y - 26,
              width: 'max(44px, 12.5vw)',
              maxWidth: 64,
            }}
          >
            <div className="relative w-full">
              {dragRun.map((card, i) => (
                <div
                  key={card.id}
                  className="absolute inset-x-0 top-0 aspect-[100/140]"
                  style={{ transform: `translateY(${i * 42}%)` }}
                >
                  {renderCardFace(card)}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={undo}
            disabled={!history.length || won}
            className="h-11 gap-1.5 rounded-xl"
          >
            <Undo2 className="size-4" aria-hidden /> Undo
          </Button>
          <span className="text-[11px] text-muted-foreground">
            Best{' '}
            <b className="tabular-nums text-emerald-600 dark:text-emerald-400">
              {best ? fmtTime(best) : '—'}
            </b>
          </span>
          <Button
            onClick={newGame}
            className="h-11 gap-1.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md shadow-emerald-500/25"
          >
            <RotateCcw className="size-4" aria-hidden /> New deal
          </Button>
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          Drag cards or tap for auto-move. Build K→A piles in alternating colors.
        </p>

        {/* Win overlay with cascade */}
        <AnimatePresence>
          {won && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
            >
              <motion.div
                initial={{ scale: 0.9, y: 16 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                className="mx-4 flex w-full max-w-xs flex-col items-center gap-2 rounded-3xl bg-background p-6 text-center shadow-2xl ring-1 ring-border"
              >
                <PartyPopper className="size-12 text-emerald-500" aria-hidden />
                <p className="text-2xl font-black text-foreground">You won!</p>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {fmtTime(elapsed)} · {state.moves} moves
                  {newBest ? ' — new best time! 🏆' : ''}
                </p>
                <div className="flex h-10 items-end gap-1" aria-hidden>
                  {Array.from({ length: 12 }, (_, i) => (
                    <motion.span
                      key={i}
                      initial={{ y: 0 }}
                      animate={{ y: [0, -18, 0] }}
                      transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.09 }}
                      className="text-xl"
                    >
                      {['♠', '♥', '♦', '♣'][i % 4]}
                    </motion.span>
                  ))}
                </div>
                <Button
                  onClick={newGame}
                  className="mt-1 h-11 w-full gap-1.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-md shadow-emerald-500/25"
                >
                  <RotateCcw className="size-4" aria-hidden /> Deal again
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}
