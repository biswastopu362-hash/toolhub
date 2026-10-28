'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Flag, PartyPopper, RotateCcw, Skull, Timer as TimerIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getGameStat, recordGameResult, unlockAchievement } from '@/lib/games/scores'

/* ================================================================== */
/* Minesweeper — classic grid with flag-mode toggle, long-press flag,  */
/* chording, first-click safety and per-difficulty best times.         */
/* All state transitions are computed from a snapshot (pure updaters). */
/* ================================================================== */

type Difficulty = 'easy' | 'medium' | 'hard'

interface Level {
  label: string
  rows: number
  cols: number
  mines: number
  gameId: string
}

const LEVELS: Record<Difficulty, Level> = {
  easy: { label: 'Easy', rows: 9, cols: 9, mines: 10, gameId: 'minesweeper-easy' },
  medium: { label: 'Medium', rows: 12, cols: 12, mines: 24, gameId: 'minesweeper-medium' },
  hard: { label: 'Hard', rows: 12, cols: 16, mines: 45, gameId: 'minesweeper-hard' },
}

const NUM_COLORS = [
  '',
  'text-teal-600 dark:text-teal-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-rose-600 dark:text-rose-400',
  'text-violet-600 dark:text-violet-400',
  'text-amber-600 dark:text-amber-400',
  'text-cyan-600 dark:text-cyan-400',
  'text-zinc-600 dark:text-zinc-300',
  'text-zinc-500 dark:text-zinc-400',
]

interface Cell {
  mine: boolean
  revealed: boolean
  flagged: boolean
  count: number /* neighboring mines */
}

function neighborsOf(i: number, rows: number, cols: number): number[] {
  const r = Math.floor(i / cols)
  const c = i % cols
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      const nr = r + dr
      const nc = c + dc
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc)
    }
  }
  return out
}

function makeBoard(size: number): Cell[] {
  return Array.from({ length: size }, () => ({
    mine: false,
    revealed: false,
    flagged: false,
    count: 0,
  }))
}

function cloneBoard(board: Cell[]): Cell[] {
  return board.map((c) => ({ ...c }))
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

type Status = 'ready' | 'playing' | 'won' | 'lost'

export default function MinesweeperApp() {
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const [cells, setCells] = useState<Cell[]>(() => makeBoard(LEVELS.easy.rows * LEVELS.easy.cols))
  const [status, setStatus] = useState<Status>('ready')
  const [flagMode, setFlagMode] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [flagsUsed, setFlagsUsed] = useState(0)
  const [best, setBest] = useState(() =>
    typeof window === 'undefined' ? 0 : getGameStat(LEVELS.easy.gameId).best
  )
  const [newBest, setNewBest] = useState(false)
  const [boomAt, setBoomAt] = useState<number | null>(null)

  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)
  const lastTouchAtRef = useRef(0)
  const genRef = useRef(0)

  const level = LEVELS[difficulty]

  const reset = useCallback((diff: Difficulty) => {
    const id = ++genRef.current
    const lv = LEVELS[diff]
    setDifficulty(diff)
    setCells(makeBoard(lv.rows * lv.cols))
    setStatus('ready')
    setElapsed(0)
    setFlagsUsed(0)
    setNewBest(false)
    setBoomAt(null)
    setBest(getGameStat(lv.gameId).best)
    longPressFiredRef.current = false
    void id
  }, [])

  useEffect(() => {
    if (status !== 'playing') return
    const t = setInterval(() => setElapsed((e) => Math.min(999, e + 1)), 1000)
    return () => clearInterval(t)
  }, [status])

  /** Lay mines after the first reveal, keeping the first tap + neighbors safe. */
  const plantMines = useCallback(
    (safe: number): Cell[] => {
      const size = level.rows * level.cols
      const forbidden = new Set<number>([safe, ...neighborsOf(safe, level.rows, level.cols)])
      const mines = new Set<number>()
      while (mines.size < level.mines) {
        const i = Math.floor(Math.random() * size)
        if (!forbidden.has(i)) mines.add(i)
      }
      const next = makeBoard(size)
      for (let i = 0; i < size; i++) next[i].mine = mines.has(i)
      for (let i = 0; i < size; i++) {
        if (!next[i].mine)
          next[i].count = neighborsOf(i, level.rows, level.cols).filter((n) => next[n].mine).length
      }
      return next
    },
    [level]
  )

  /** Flood-fill reveal from a safe cell. */
  const revealFrom = useCallback(
    (board: Cell[], start: number): Cell[] => {
      const next = cloneBoard(board)
      const stack = [start]
      while (stack.length) {
        const i = stack.pop() as number
        const c = next[i]
        if (c.revealed || c.flagged) continue
        c.revealed = true
        if (c.count === 0 && !c.mine) {
          for (const n of neighborsOf(i, level.rows, level.cols)) {
            if (!next[n].revealed && !next[n].flagged) stack.push(n)
          }
        }
      }
      return next
    },
    [level]
  )

  /** Win when every safe cell is revealed. Pure check + result side effects. */
  const checkWin = useCallback(
    (board: Cell[], timeAtWin: number) => {
      if (board.some((c) => !c.revealed && !c.mine)) return board
      const done = board.map((c) => (c.mine ? { ...c, flagged: true } : c))
      setStatus('won')
      const res = recordGameResult(level.gameId, { value: timeAtWin, timeMode: true, won: true })
      setBest(res.stat.best)
      setNewBest(res.isNewBest)
      unlockAchievement('mines-first-win')
      unlockAchievement(`mines-${difficulty}-win`)
      if (flagsUsed === 0) unlockAchievement('mines-no-flag-win')
      if (difficulty === 'hard' && timeAtWin <= 300) unlockAchievement('mines-hard-sub5')
      return done
    },
    [level.gameId, difficulty, flagsUsed]
  )

  const tapCell = useCallback(
    (i: number) => {
      if (status === 'won' || status === 'lost') return
      let board = cloneBoard(cells)
      if (status === 'ready') board = plantMines(i)
      const cell = board[i]

      /* Flag mode → toggle instead of reveal */
      if (flagMode && !cell.revealed) {
        board[i] = { ...cell, flagged: !cell.flagged }
        setCells(board)
        setFlagsUsed(board.filter((c) => c.flagged).length)
        if (status === 'ready') setStatus('playing')
        if (navigator.vibrate) navigator.vibrate(10)
        return
      }

      if (cell.flagged) return

      /* Chord: revealed number with matching flag count reveals neighbors */
      if (cell.revealed) {
        if (cell.count === 0) return
        const ns = neighborsOf(i, level.rows, level.cols)
        if (ns.filter((n) => board[n].flagged).length !== cell.count) return
        let exploded = false
        for (const n of ns) {
          if (board[n].revealed || board[n].flagged) continue
          if (board[n].mine) {
            exploded = true
            setBoomAt(n)
            break
          }
          board = revealFrom(board, n)
        }
        if (exploded) {
          setStatus('lost')
          recordGameResult(level.gameId, { won: false })
          setCells(board.map((c) => (c.mine ? { ...c, revealed: true } : c)))
          if (navigator.vibrate) navigator.vibrate([30, 40, 60])
          return
        }
        setCells(checkWin(board, elapsed))
        return
      }

      if (cell.mine) {
        setBoomAt(i)
        setStatus('lost')
        recordGameResult(level.gameId, { won: false })
        setCells(board.map((c) => (c.mine ? { ...c, revealed: true } : c)))
        if (navigator.vibrate) navigator.vibrate([30, 40, 60])
        return
      }

      const after = revealFrom(board, i)
      setCells(checkWin(after, elapsed))
      if (status === 'ready') setStatus('playing')
    },
    [cells, status, flagMode, plantMines, revealFrom, checkWin, elapsed, level]
  )

  const toggleFlag = useCallback(
    (i: number) => {
      if (status === 'won' || status === 'lost') return
      const cell = cells[i]
      if (cell.revealed) return
      const next = cloneBoard(cells)
      next[i] = { ...cell, flagged: !cell.flagged }
      setCells(next)
      setFlagsUsed(next.filter((c) => c.flagged).length)
      if (navigator.vibrate) navigator.vibrate(10)
    },
    [cells, status]
  )

  /* Long-press flag (touch) */
  const onTouchStart = (i: number) => {
    lastTouchAtRef.current = Date.now()
    longPressFiredRef.current = false
    longPressRef.current = setTimeout(() => {
      longPressFiredRef.current = true
      toggleFlag(i)
    }, 420)
  }
  const onTouchEnd = (i: number) => {
    lastTouchAtRef.current = Date.now()
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
    if (!longPressFiredRef.current) tapCell(i)
  }
  const onTouchMove = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }
  /* Mouse click — ignored right after a real touch to avoid double-firing */
  const onCellClick = (i: number) => {
    if (Date.now() - lastTouchAtRef.current < 800) return
    tapCell(i)
  }

  const flagsLeft = level.mines - flagsUsed

  return (
    <Card className="overflow-hidden shadow-md">
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="bg-gradient-to-r from-rose-500 to-red-600 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
              Minesweeper
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {level.label} · {level.mines} mines
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="min-w-[62px] rounded-xl bg-muted px-2.5 py-1.5 text-center ring-1 ring-border/60">
              <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Flag className="size-3" aria-hidden /> Left
              </div>
              <div className="text-base font-bold tabular-nums text-foreground">{flagsLeft}</div>
            </div>
            <div className="min-w-[62px] rounded-xl bg-muted px-2.5 py-1.5 text-center ring-1 ring-border/60">
              <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <TimerIcon className="size-3" aria-hidden /> Time
              </div>
              <div className="text-base font-bold tabular-nums text-foreground">{fmtTime(elapsed)}</div>
            </div>
          </div>
        </div>

        {/* Controls row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5" role="tablist" aria-label="Difficulty">
            {(Object.keys(LEVELS) as Difficulty[]).map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={difficulty === d}
                onClick={() => reset(d)}
                className={cn(
                  'h-9 rounded-xl px-3 text-sm font-semibold ring-1 transition-colors',
                  difficulty === d
                    ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white ring-transparent shadow-md shadow-red-500/25'
                    : 'bg-muted/60 text-muted-foreground ring-border/60 hover:bg-muted'
                )}
              >
                {LEVELS[d].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={flagMode ? 'default' : 'outline'}
              onClick={() => setFlagMode((v) => !v)}
              aria-pressed={flagMode}
              className={cn(
                'h-10 gap-1.5 rounded-xl px-3 text-sm',
                flagMode &&
                  'bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-md shadow-red-500/25'
              )}
            >
              <Flag className="size-4" aria-hidden />
              Flag mode
            </Button>
            <Button
              variant="outline"
              onClick={() => reset(difficulty)}
              aria-label="New game"
              className="size-10 rounded-xl p-0"
            >
              <RotateCcw className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        {/* Board */}
        <div className="relative mx-auto w-full max-w-[min(94vw,430px)] select-none">
          <div
            role="grid"
            aria-label={`Minesweeper board, ${level.cols} by ${level.rows}`}
            className="grid overflow-hidden rounded-xl bg-zinc-100 p-1 ring-1 ring-border dark:bg-zinc-900"
            style={{ gridTemplateColumns: `repeat(${level.cols}, minmax(0, 1fr))` }}
          >
            {cells.map((cell, i) => (
              <button
                key={i}
                role="gridcell"
                aria-label={`Cell ${Math.floor(i / level.cols) + 1},${(i % level.cols) + 1}${
                  cell.revealed
                    ? cell.mine
                      ? ', mine'
                      : `, ${cell.count}`
                    : cell.flagged
                      ? ', flagged'
                      : ', hidden'
                }`}
                onContextMenu={(e) => {
                  e.preventDefault()
                  toggleFlag(i)
                }}
                onClick={() => onCellClick(i)}
                onTouchStart={() => onTouchStart(i)}
                onTouchEnd={() => onTouchEnd(i)}
                onTouchMove={onTouchMove}
                className={cn(
                  'flex aspect-square items-center justify-center border border-zinc-200/70 text-[11px] font-extrabold tabular-nums transition-colors dark:border-zinc-800 sm:text-[13px]',
                  cell.revealed
                    ? cell.mine
                      ? 'bg-rose-500/80 text-white'
                      : 'bg-zinc-50 dark:bg-zinc-950/60'
                    : 'bg-gradient-to-b from-zinc-200 to-zinc-300 text-transparent hover:from-zinc-300 hover:to-zinc-400 active:from-zinc-400 dark:from-zinc-800 dark:to-zinc-700 dark:hover:from-zinc-700',
                  boomAt === i && 'ring-2 ring-rose-500',
                  !cell.revealed && cell.flagged && 'text-rose-500'
                )}
              >
                {cell.revealed ? (
                  cell.mine ? (
                    <Skull className="size-3.5" aria-hidden />
                  ) : cell.count > 0 ? (
                    <span className={NUM_COLORS[cell.count]}>{cell.count}</span>
                  ) : null
                ) : cell.flagged ? (
                  <Flag className="size-3.5 fill-rose-500 text-rose-500 sm:size-4" aria-hidden />
                ) : null}
              </button>
            ))}
          </div>

          {/* Win / lose overlay */}
          <AnimatePresence>
            {(status === 'won' || status === 'lost') && (
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
                  {status === 'won' ? (
                    <PartyPopper className="size-12 text-emerald-500" aria-hidden />
                  ) : (
                    <Skull className="size-12 text-rose-500" aria-hidden />
                  )}
                </motion.div>
                <p className="text-2xl font-black text-foreground">
                  {status === 'won' ? 'Swept clean!' : 'Boom!'}
                </p>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {status === 'won'
                    ? `${level.label} · ${fmtTime(elapsed)}${newBest ? ' — new best time! 🏆' : ''}`
                    : 'You hit a mine. Try again.'}
                </p>
                <Button
                  onClick={() => reset(difficulty)}
                  className="mt-1 h-11 gap-1.5 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 text-white shadow-md shadow-red-500/25"
                >
                  <RotateCcw className="size-4" aria-hidden /> Play again
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Long-press or Flag mode to mark mines. Tap a number to chord.</span>
          <span>
            Best{' '}
            <b className="tabular-nums text-rose-600 dark:text-rose-400">
              {best ? fmtTime(best) : '—'}
            </b>
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
