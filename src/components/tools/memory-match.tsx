'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PartyPopper, RotateCcw, Timer as TimerIcon, Trophy, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getGameStat, recordGameResult, unlockAchievement } from '@/lib/games/scores'

/* ================================================================== */
/* Memory Match — 4 emoji themes, 3 board sizes, solo scoring and      */
/* pass-and-play 2-player mode with 3D card flips.                     */
/* ================================================================== */

type ThemeId = 'animals' | 'fruits' | 'space' | 'ocean'
type SizeId = 'small' | 'medium' | 'large'
type Mode = 'solo' | 'duo'

const THEMES: Record<ThemeId, { label: string; emojis: string[]; grad: string; glow: string }> = {
  animals: {
    label: 'Animals',
    emojis: ['🦁', '🐯', '🐻', '🐼', '🐨', '🦊', '🐸', '🐵', '🐔', '🐧', '🦉', '🦄', '🐙', '🦋', '🐢', '🦜', '🐬', '🦩'],
    grad: 'from-amber-400 to-orange-600',
    glow: 'shadow-orange-500/25',
  },
  fruits: {
    label: 'Fruits',
    emojis: ['🍎', '🍌', '🍇', '🍓', '🍒', '🍑', '🍍', '🥝', '🍉', '🍋', '🥑', '🥭', '🫐', '🥥', '🍐', '🍈', '🍅', '🍏'],
    grad: 'from-rose-400 to-pink-600',
    glow: 'shadow-pink-500/25',
  },
  space: {
    label: 'Space',
    emojis: ['🚀', '🛸', '🌙', '⭐', '☀️', '🪐', '🌍', '☄️', '👽', '🌌', '🔭', '🛰️', '🌠', '✨', '🌟', '🌕', '💫', '🌑'],
    grad: 'from-violet-400 to-purple-600',
    glow: 'shadow-purple-500/25',
  },
  ocean: {
    label: 'Ocean',
    emojis: ['🐠', '🐙', '🐡', '🦈', '🐬', '🐳', '🦀', '🦞', '🦐', '🐚', '🪼', '🌊', '🦭', '🐢', '⚓', '🚤', '🫧', '🪸'],
    grad: 'from-teal-400 to-cyan-600',
    glow: 'shadow-cyan-500/25',
  },
}

const SIZES: Record<SizeId, { label: string; cols: number; pairs: number }> = {
  small: { label: '4×4', cols: 4, pairs: 8 },
  medium: { label: '6×4', cols: 6, pairs: 12 },
  large: { label: '6×6', cols: 6, pairs: 18 },
}

interface CardT {
  id: number
  emoji: string
  matched: boolean
  flipped: boolean
}

function buildDeck(theme: ThemeId, pairs: number): CardT[] {
  const picks = THEMES[theme].emojis.slice(0, pairs)
  const deck = [...picks, ...picks].map((emoji, i) => ({ id: i, emoji, matched: false, flipped: false }))
  /* Fisher–Yates */
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck.map((c, i) => ({ ...c, id: i }))
}

const PLAYER_COLORS = ['from-emerald-500 to-teal-600', 'from-amber-500 to-orange-600']

export default function MemoryMatchApp() {
  const [theme, setTheme] = useState<ThemeId>('animals')
  const [size, setSize] = useState<SizeId>('small')
  const [mode, setMode] = useState<Mode>('solo')
  const [cards, setCards] = useState<CardT[]>(() => buildDeck('animals', 8))
  const [flippedIds, setFlippedIds] = useState<number[]>([])
  const [lock, setLock] = useState(false)
  const [player, setPlayer] = useState(0)
  const [pairWins, setPairWins] = useState<[number, number]>([0, 0])
  const [moves, setMoves] = useState(0)
  const [misses, setMisses] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [points, setPoints] = useState(0)
  const [streak, setStreak] = useState(0)
  const [best, setBest] = useState(() =>
    typeof window === 'undefined' ? 0 : getGameStat('memory').best
  )
  const [finished, setFinished] = useState(false)
  const [winner, setWinner] = useState<number | null>(null)
  const [newBest, setNewBest] = useState(false)
  const missTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sizeCfg = SIZES[size]
  const themeCfg = THEMES[theme]

  const startGame = useCallback((t: ThemeId, s: SizeId, m: Mode) => {
    if (missTimerRef.current) clearTimeout(missTimerRef.current)
    setTheme(t)
    setSize(s)
    setMode(m)
    setCards(buildDeck(t, SIZES[s].pairs))
    setFlippedIds([])
    setLock(false)
    setPlayer(0)
    setPairWins([0, 0])
    setMoves(0)
    setMisses(0)
    setElapsed(0)
    setPoints(0)
    setStreak(0)
    setFinished(false)
    setWinner(null)
    setNewBest(false)
    if (m === 'solo') setBest(getGameStat('memory').best)
  }, [])

  /* Solo timer */
  useEffect(() => {
    if (mode !== 'solo' || finished) return
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [mode, finished])

  const finishGame = useCallback(
    (finalCards: CardT[], finalPoints: number, finalMisses: number, pairWinsFinal: [number, number]) => {
      setFinished(true)
      unlockAchievement('memory-first-finish')
      if (mode === 'solo') {
        recordGameResult('memory', { value: finalPoints, won: true })
        if (size === 'large') unlockAchievement('memory-large-finish')
        if (finalMisses === 0) unlockAchievement('memory-perfect')
        if (finalPoints > getGameStat('memory').best) setNewBest(true)
      } else {
        const w = pairWinsFinal[0] === pairWinsFinal[1] ? -1 : pairWinsFinal[0] > pairWinsFinal[1] ? 0 : 1
        setWinner(w)
        if (w >= 0) {
          recordGameResult('memory', { won: true })
          unlockAchievement('memory-duo-win')
        } else {
          unlockAchievement('memory-duo-draw')
        }
      }
      void finalCards
    },
    [mode, size]
  )

  const flipCard = useCallback(
    (id: number) => {
      if (lock || finished) return
      const card = cards[id]
      if (card.flipped || card.matched) return
      if (flippedIds.length >= 2) return

      const nextCards = cards.map((c) => (c.id === id ? { ...c, flipped: true } : c))
      const nextFlipped = [...flippedIds, id]
      setCards(nextCards)
      setFlippedIds(nextFlipped)

      if (nextFlipped.length === 2) {
        setMoves((m) => m + 1)
        const [a, b] = nextFlipped
        if (nextCards[a].emoji === nextCards[b].emoji) {
          /* match */
          const matched = nextCards.map((c) => (c.id === a || c.id === b ? { ...c, matched: true } : c))
          const newStreak = streak + 1
          const gained = 100 + (mode === 'solo' ? Math.max(0, newStreak - 1) * 25 : 0)
          const nextPairWins: [number, number] = [...pairWins]
          if (mode === 'duo') nextPairWins[player] += 1
          setTimeout(() => {
            setCards(matched)
            setFlippedIds([])
            setStreak(newStreak)
            setPoints((p) => p + gained)
            if (mode === 'duo') setPairWins(nextPairWins)
            if (matched.every((c) => c.matched)) finishGame(matched, points + gained, misses, nextPairWins)
          }, 450)
          if (navigator.vibrate) navigator.vibrate(10)
        } else {
          /* miss */
          const nextMisses = misses + 1
          setMisses(nextMisses)
          setStreak(0)
          setLock(true)
          if (mode === 'solo') setPoints((p) => Math.max(0, p - 10))
          missTimerRef.current = setTimeout(() => {
            setCards((prev) => prev.map((c) => (c.id === a || c.id === b ? { ...c, flipped: false } : c)))
            setFlippedIds([])
            setLock(false)
            if (mode === 'duo') setPlayer((p) => (p === 0 ? 1 : 0))
          }, 850)
        }
      }
    },
    [lock, finished, cards, flippedIds, streak, mode, pairWins, player, points, misses, finishGame]
  )

  useEffect(() => {
    return () => {
      if (missTimerRef.current) clearTimeout(missTimerRef.current)
    }
  }, [])

  const matchedPairs = useMemo(() => cards.filter((c) => c.matched).length / 2, [cards])
  const totalPairs = sizeCfg.pairs

  const fmtTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  return (
    <Card className="overflow-hidden shadow-md">
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="bg-gradient-to-r from-fuchsia-500 to-purple-600 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
              Memory Match
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {themeCfg.label} · {matchedPairs}/{totalPairs} pairs
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mode === 'solo' ? (
              <>
                <div className="min-w-[64px] rounded-xl bg-muted px-3 py-1.5 text-center ring-1 ring-border/60">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Points</div>
                  <div className="text-lg font-bold tabular-nums text-foreground" aria-live="polite">
                    {points}
                  </div>
                </div>
                <div className="min-w-[64px] rounded-xl bg-muted px-3 py-1.5 text-center ring-1 ring-border/60">
                  <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <TimerIcon className="size-3" aria-hidden /> Time
                  </div>
                  <div className="text-base font-bold tabular-nums text-foreground">{fmtTime(elapsed)}</div>
                </div>
              </>
            ) : (
              <div className="min-w-[64px] rounded-xl bg-muted px-3 py-1.5 text-center ring-1 ring-border/60">
                <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Users className="size-3" aria-hidden /> Turn
                </div>
                <div className="text-base font-bold text-foreground">P{player + 1}</div>
              </div>
            )}
          </div>
        </div>

        {/* Mode / size / theme selectors */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex gap-1" role="tablist" aria-label="Mode">
            {(['solo', 'duo'] as Mode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => startGame(theme, size, m)}
                className={cn(
                  'h-9 rounded-xl px-3 text-sm font-semibold ring-1 transition-colors',
                  mode === m
                    ? 'bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white ring-transparent shadow-md shadow-purple-500/25'
                    : 'bg-muted/60 text-muted-foreground ring-border/60 hover:bg-muted'
                )}
              >
                {m === 'solo' ? 'Solo' : '2 Players'}
              </button>
            ))}
          </div>
          <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <div className="flex gap-1" role="tablist" aria-label="Board size">
            {(Object.keys(SIZES) as SizeId[]).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={size === s}
                onClick={() => startGame(theme, s, mode)}
                className={cn(
                  'h-9 rounded-xl px-2.5 text-sm font-semibold ring-1 transition-colors',
                  size === s
                    ? 'bg-foreground text-background ring-transparent'
                    : 'bg-muted/60 text-muted-foreground ring-border/60 hover:bg-muted'
                )}
              >
                {SIZES[s].label}
              </button>
            ))}
          </div>
          <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <div className="flex gap-1" role="tablist" aria-label="Card theme">
            {(Object.keys(THEMES) as ThemeId[]).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={theme === t}
                onClick={() => startGame(t, size, mode)}
                className={cn(
                  'h-9 rounded-xl px-2.5 text-sm font-semibold ring-1 transition-colors',
                  theme === t
                    ? 'bg-foreground text-background ring-transparent'
                    : 'bg-muted/60 text-muted-foreground ring-border/60 hover:bg-muted'
                )}
              >
                {THEMES[t].label}
              </button>
            ))}
          </div>
        </div>

        {/* Duo scoreboard */}
        {mode === 'duo' && (
          <div className="grid grid-cols-2 gap-2">
            {[0, 1].map((p) => (
              <div
                key={p}
                className={cn(
                  'rounded-xl p-2.5 text-center ring-1 transition-all',
                  player === p && !finished
                    ? `bg-gradient-to-r ${PLAYER_COLORS[p]} text-white ring-transparent shadow-md ${THEMES[theme].glow}`
                    : 'bg-muted/60 text-muted-foreground ring-border/60'
                )}
              >
                <div className="text-xs font-bold uppercase tracking-wider">Player {p + 1}</div>
                <div className="text-xl font-black tabular-nums">{pairWins[p]} pairs</div>
              </div>
            ))}
          </div>
        )}

        {/* Board */}
        <div className="relative mx-auto w-full max-w-[min(94vw,460px)]">
          <div
            role="grid"
            aria-label={`Memory board with ${totalPairs} pairs`}
            className="grid select-none gap-1.5 sm:gap-2"
            style={{ gridTemplateColumns: `repeat(${sizeCfg.cols}, minmax(0, 1fr))` }}
          >
            {cards.map((card) => {
              const faceUp = card.flipped || card.matched
              return (
                <button
                  key={card.id}
                  role="gridcell"
                  aria-label={faceUp ? `Card ${card.emoji}` : 'Hidden card'}
                  onClick={() => flipCard(card.id)}
                  className="relative aspect-square outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
                  style={{ perspective: '600px' }}
                >
                  <motion.div
                    className="relative size-full"
                    animate={{ rotateY: faceUp ? 180 : 0 }}
                    transition={{ duration: 0.32, ease: 'easeOut' }}
                    style={{ transformStyle: 'preserve-3d' }}
                  >
                    {/* Back face (hidden state) */}
                    <div
                      className={cn(
                        'absolute inset-0 flex items-center justify-center rounded-xl bg-gradient-to-br shadow-sm',
                        themeCfg.grad
                      )}
                      style={{ backfaceVisibility: 'hidden' }}
                    >
                      <span className="text-lg font-black text-white/80 opacity-70 sm:text-xl">✦</span>
                    </div>
                    {/* Front face (revealed) */}
                    <div
                      className={cn(
                        'absolute inset-0 flex items-center justify-center rounded-xl text-2xl ring-1 sm:text-3xl',
                        card.matched
                          ? 'bg-emerald-100 ring-emerald-400/60 dark:bg-emerald-500/15'
                          : 'bg-background ring-border'
                      )}
                      style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
                    >
                      {card.emoji}
                    </div>
                  </motion.div>
                </button>
              )
            })}
          </div>

          {/* Finish overlay */}
          <AnimatePresence>
            {finished && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-background/85 p-6 text-center backdrop-blur-sm"
              >
                <motion.div
                  initial={{ scale: 0.5, rotate: -12 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 260, damping: 14 }}
                >
                  {mode === 'duo' && winner === -1 ? (
                    <Users className="size-12 text-purple-500" aria-hidden />
                  ) : (
                    <PartyPopper className="size-12 text-fuchsia-500" aria-hidden />
                  )}
                </motion.div>
                <p className="text-2xl font-black text-foreground">
                  {mode === 'solo'
                    ? 'All pairs found!'
                    : winner === -1
                      ? "It's a tie!"
                      : `Player ${winner! + 1} wins!`}
                </p>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {mode === 'solo'
                    ? `${points} points · ${moves} moves · ${fmtTime(elapsed)}${newBest ? ' — new best! 🏆' : ''}`
                    : `${pairWins[0]} – ${pairWins[1]}`}
                </p>
                <Button
                  onClick={() => startGame(theme, size, mode)}
                  className="mt-1 h-11 gap-1.5 rounded-xl bg-gradient-to-r from-fuchsia-500 to-purple-600 text-white shadow-md shadow-purple-500/25"
                >
                  <RotateCcw className="size-4" aria-hidden /> Play again
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            Moves <b className="tabular-nums">{moves}</b>
            {streak > 1 && <span className="ml-2 font-bold text-fuchsia-500">🔥 {streak}x streak</span>}
          </span>
          {mode === 'solo' ? (
            <span className="flex items-center gap-1">
              <Trophy className="size-3 text-amber-500" aria-hidden />
              Best <b className="tabular-nums">{best}</b>
            </span>
          ) : (
            <span>Pass the device after every miss!</span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
