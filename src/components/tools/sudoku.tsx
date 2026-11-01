'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Eraser,
  Lightbulb,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Timer as TimerIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getGameStat, recordGameResult, unlockAchievement } from '@/lib/games/scores'

/* ================================================================== */
/* Sudoku — 3 difficulties, pencil-mark notes mode, 3 hints, timer.    */
/* Puzzles are generated on-device (backtracking + unique-solution     */
/* digging). Best time per difficulty is stored via the games store.   */
/* ================================================================== */

type Difficulty = 'easy' | 'medium' | 'hard'

const DIFFS: Record<
  Difficulty,
  { label: string; givens: number; gameId: string; chip: string }
> = {
  easy: { label: 'Easy', givens: 38, gameId: 'sudoku-easy', chip: 'text-emerald-600' },
  medium: { label: 'Medium', givens: 30, gameId: 'sudoku-medium', chip: 'text-amber-600' },
  hard: { label: 'Hard', givens: 24, gameId: 'sudoku-hard', chip: 'text-rose-600' },
}

const ALL = 0x1ff /* bits 0..8 → digits 1..9 */

function bitFor(d: number): number {
  return 1 << (d - 1)
}
function digitOf(bit: number): number {
  return Math.log2(bit) + 1
}

/* ------------------------------------------------------------------ */
/* Solver / generator (pure, on-device)                                */
/* ------------------------------------------------------------------ */

function peersOf(i: number): number[] {
  const r = Math.floor(i / 9)
  const c = i % 9
  const out: number[] = []
  for (let k = 0; k < 9; k++) {
    const a = r * 9 + k
    const b = k * 9 + c
    if (a !== i) out.push(a)
    if (b !== i) out.push(b)
  }
  const br = Math.floor(r / 3) * 3
  const bc = Math.floor(c / 3) * 3
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      const j = (br + dr) * 9 + bc + dc
      if (j !== i) out.push(j)
    }
  }
  return out
}

const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => peersOf(i))

function findBestEmpty(grid: number[]): number {
  let best = -1
  let bestCount = 10
  for (let i = 0; i < 81; i++) {
    if (grid[i] !== 0) continue
    let used = 0
    for (const p of PEERS[i]) if (grid[p]) used |= bitFor(grid[p])
    const mask = ALL & ~used
    const count = popcount(mask)
    if (count === 0) return -1 /* dead end */
    if (count < bestCount) {
      best = i
      bestCount = count
      if (count === 1) break
    }
  }
  return best /* -1 = no empty cell (solved or caller handles contradiction) */
}

function popcount(x: number): number {
  let n = 0
  while (x) {
    x &= x - 1
    n++
  }
  return n
}

function solveWithLimit(grid: number[], cap: number): number {
  const i = findBestEmpty(grid)
  if (i === -1) {
    /* either solved or contradiction — count only if fully solved */
    for (let k = 0; k < 81; k++) if (!grid[k]) return 0
    return 1
  }
  let used = 0
  for (const p of PEERS[i]) if (grid[p]) used |= bitFor(grid[p])
  const mask = ALL & ~used
  if (!mask) return 0
  let count = 0
  for (let d = 1; d <= 9 && count < cap; d++) {
    const bit = bitFor(d)
    if (mask & bit) {
      grid[i] = d
      count += solveWithLimit(grid, cap - count)
      grid[i] = 0
    }
  }
  return count
}

function generateSolved(): number[] {
  const grid = new Array<number>(81).fill(0)
  const fill = (pos: number): boolean => {
    if (pos === 81) return true
    let used = 0
    for (const p of PEERS[pos]) if (grid[p]) used |= bitFor(grid[p])
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !(used & bitFor(d)))
    /* shuffle */
    for (let i = digits.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[digits[i], digits[j]] = [digits[j], digits[i]]
    }
    for (const d of digits) {
      grid[pos] = d
      if (fill(pos + 1)) return true
      grid[pos] = 0
    }
    return false
  }
  fill(0)
  return grid
}

/** Dig holes while the puzzle keeps a unique solution. */
function digHoles(solution: number[], targetGivens: number): number[] {
  const puzzle = [...solution]
  const order = Array.from({ length: 81 }, (_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  let givens = 81
  for (const i of order) {
    if (givens <= targetGivens) break
    const backup = puzzle[i]
    puzzle[i] = 0
    const probe = [...puzzle]
    if (solveWithLimit(probe, 2) !== 1) puzzle[i] = backup
    else givens--
  }
  return puzzle
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

function fmtTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function SudokuApp() {
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const [puzzle, setPuzzle] = useState<number[]>([])
  const [solution, setSolution] = useState<number[]>([])
  const [cells, setCells] = useState<number[]>([])
  const [notes, setNotes] = useState<number[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [noteMode, setNoteMode] = useState(false)
  const [mistakes, setMistakes] = useState(0)
  const [hintsLeft, setHintsLeft] = useState(3)
  const [elapsed, setElapsed] = useState(0)
  const [paused, setPaused] = useState(false)
  const [status, setStatus] = useState<'playing' | 'won'>('playing')
  const [best, setBest] = useState(0)
  const [newBest, setNewBest] = useState(false)
  const [generating, setGenerating] = useState(true)
  const genRef = useRef(0)

  const newGame = useCallback((diff: Difficulty) => {
    const id = ++genRef.current
    setGenerating(true)
    setStatus('playing')
    setSelected(null)
    setMistakes(0)
    setHintsLeft(3)
    setElapsed(0)
    setPaused(false)
    setNoteMode(false)
    setNewBest(false)
    setDifficulty(diff)
    /* Defer generation a tick so the UI paints the skeleton first */
    setTimeout(() => {
      if (genRef.current !== id) return
      const sol = generateSolved()
      const puz = digHoles(sol, DIFFS[diff].givens)
      setSolution(sol)
      setPuzzle(puz)
      setCells([...puz])
      setNotes(new Array<number>(81).fill(0))
      setGenerating(false)
    }, 30)
  }, [])

  /* First mount */
  useEffect(() => {
    newGame('easy')
  }, [newGame])

  /* Best-time readout for the active difficulty */
  useEffect(() => {
    setBest(getGameStat(DIFFS[difficulty].gameId).best)
  }, [difficulty])

  /* Timer */
  useEffect(() => {
    if (status !== 'playing' || paused || generating) return
    const t = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(t)
  }, [status, paused, generating])

  const placeDigit = useCallback(
    (d: number) => {
      if (status !== 'playing' || selected === null || generating) return
      if (puzzle[selected] !== 0) return /* given cells are locked */
      if (noteMode) {
        if (cells[selected] !== 0) return
        setNotes((prev) => {
          const next = [...prev]
          next[selected] = next[selected] ^ bitFor(d)
          return next
        })
        return
      }
      if (cells[selected] === d) {
        /* tapping the same digit erases */
        setCells((prev) => {
          const next = [...prev]
          next[selected] = 0
          return next
        })
        return
      }
      const correct = solution[selected] === d
      setCells((prev) => {
        const next = [...prev]
        next[selected] = d
        return next
      })
      if (correct) {
        /* clear this digit from peer notes */
        setNotes((prev) => {
          const next = [...prev]
          let changed = false
          for (const p of PEERS[selected]) {
            if (next[p] & bitFor(d)) {
              next[p] &= ~bitFor(d)
              changed = true
            }
          }
          return changed ? next : prev
        })
        /* win? */
        const after = [...cells]
        after[selected] = d
        if (after.every((v, i) => v === solution[i])) {
          const time = elapsed
          const res = recordGameResult(DIFFS[difficulty].gameId, {
            value: time,
            timeMode: true,
            won: true,
          })
          setBest(res.stat.best)
          setNewBest(res.isNewBest)
          unlockAchievement('sudoku-first-solve')
          unlockAchievement(`sudoku-${difficulty}-solve`)
          if (difficulty === 'hard' && time <= 600) unlockAchievement('sudoku-hard-sub10')
          setStatus('won')
        }
      } else {
        setMistakes((m) => m + 1)
      }
    },
    [status, selected, generating, puzzle, noteMode, cells, solution, elapsed, difficulty]
  )

  const eraseCell = useCallback(() => {
    if (selected === null || status !== 'playing') return
    if (puzzle[selected] !== 0) return
    setCells((prev) => {
      const next = [...prev]
      next[selected] = 0
      return next
    })
    setNotes((prev) => {
      const next = [...prev]
      next[selected] = 0
      return next
    })
  }, [selected, status, puzzle])

  const doHint = useCallback(() => {
    if (status !== 'playing' || hintsLeft <= 0 || generating) return
    /* prefer the selected cell if it needs solving, else the first empty */
    let target = selected !== null && cells[selected] !== solution[selected] ? selected : -1
    if (target === -1) {
      target = cells.findIndex((v, i) => v !== solution[i])
      if (target === -1) return
    }
    const d = solution[target]
    setCells((prev) => {
      const next = [...prev]
      next[target] = d
      return next
    })
    setNotes((prev) => {
      const next = [...prev]
      next[target] = 0
      for (const p of PEERS[target]) next[p] &= ~bitFor(d)
      return next
    })
    setHintsLeft((h) => h - 1)
    const after = [...cells]
    after[target] = d
    if (after.every((v, i) => v === solution[i])) {
      const time = elapsed
      const res = recordGameResult(DIFFS[difficulty].gameId, {
        value: time,
        timeMode: true,
        won: true,
      })
      setBest(res.stat.best)
      setNewBest(res.isNewBest)
      unlockAchievement('sudoku-first-solve')
      unlockAchievement(`sudoku-${difficulty}-solve`)
      setStatus('won')
    }
  }, [status, hintsLeft, generating, selected, cells, solution, elapsed, difficulty])

  /* Keyboard controls */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return
      if (e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        placeDigit(Number(e.key))
      } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'e') {
        e.preventDefault()
        eraseCell()
      } else if (e.key === 'n') {
        setNoteMode((v) => !v)
      } else if (e.key === 'h') {
        doHint()
      } else if (e.key.startsWith('Arrow') && selected !== null) {
        e.preventDefault()
        const r = Math.floor(selected / 9)
        const c = selected % 9
        if (e.key === 'ArrowUp' && r > 0) setSelected(selected - 9)
        if (e.key === 'ArrowDown' && r < 8) setSelected(selected + 9)
        if (e.key === 'ArrowLeft' && c > 0) setSelected(selected - 1)
        if (e.key === 'ArrowRight' && c < 8) setSelected(selected + 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placeDigit, eraseCell, doHint, selected])

  const selectedDigit = useMemo(
    () => (selected !== null && cells[selected] ? cells[selected] : 0),
    [selected, cells]
  )

  const givensRemaining = useMemo(
    () => cells.reduce((n, v, i) => n + (v === 0 || v !== solution[i] ? 1 : 0), 0),
    [cells, solution]
  )

  return (
    <Card className="overflow-hidden shadow-md">
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="bg-gradient-to-r from-violet-500 to-purple-600 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
              Sudoku
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {DIFFS[difficulty].label} · {givensRemaining} cells left
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="min-w-[70px] rounded-xl bg-muted px-3 py-1.5 text-center ring-1 ring-border/60">
              <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <TimerIcon className="size-3" aria-hidden /> Time
              </div>
              <div className="text-base font-bold tabular-nums text-foreground" aria-live="off">
                {fmtTime(elapsed)}
              </div>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPaused((p) => !p)}
              disabled={status !== 'playing' || generating}
              aria-label={paused ? 'Resume' : 'Pause'}
              className="size-11 rounded-xl"
            >
              {paused ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
            </Button>
          </div>
        </div>

        {/* Difficulty + stats row */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5" role="tablist" aria-label="Difficulty">
            {(Object.keys(DIFFS) as Difficulty[]).map((d) => (
              <button
                key={d}
                role="tab"
                aria-selected={difficulty === d}
                onClick={() => newGame(d)}
                className={cn(
                  'h-9 rounded-xl px-3.5 text-sm font-semibold ring-1 transition-colors',
                  difficulty === d
                    ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white ring-transparent shadow-md shadow-purple-500/25'
                    : 'bg-muted/60 text-muted-foreground ring-border/60 hover:bg-muted'
                )}
              >
                {DIFFS[d].label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>
              Best{' '}
              <b className={cn('tabular-nums', DIFFS[difficulty].chip)}>
                {best ? fmtTime(best) : '—'}
              </b>
            </span>
            <span className="text-rose-500">
              Mistakes <b className="tabular-nums">{mistakes}</b>
            </span>
          </div>
        </div>

        {/* Board */}
        <div className="relative mx-auto w-full max-w-[min(92vw,420px)] select-none">
          {generating ? (
            <div className="grid aspect-square grid-cols-9 grid-rows-9 overflow-hidden rounded-xl bg-muted/40 ring-1 ring-border">
              {Array.from({ length: 81 }, (_, i) => (
                <div
                  key={i}
                  className={cn(
                    'animate-pulse bg-muted/60',
                    i % 2 ? '' : 'bg-muted/30'
                  )}
                />
              ))}
            </div>
          ) : (
            <div
              role="grid"
              aria-label="Sudoku board"
              className="grid aspect-square grid-cols-9 grid-rows-9 overflow-hidden rounded-xl bg-zinc-50 ring-2 ring-zinc-400/70 dark:bg-zinc-900 dark:ring-zinc-600"
            >
              {cells.map((v, i) => {
                const r = Math.floor(i / 9)
                const c = i % 9
                const isGiven = puzzle[i] !== 0
                const isWrong = v !== 0 && !isGiven && v !== solution[i]
                const isSelected = selected === i
                const sameDigit =
                  !isSelected && v === 0 && selectedDigit > 0 && (notes[i] & bitFor(selectedDigit)) > 0
                return (
                  <button
                    key={i}
                    role="gridcell"
                    aria-label={`Row ${r + 1} column ${c + 1}${v ? `, value ${v}` : ', empty'}`}
                    aria-selected={isSelected}
                    onClick={() => setSelected(i)}
                    className={cn(
                      'relative flex items-center justify-center border-zinc-300 text-[15px] font-semibold tabular-nums transition-colors dark:border-zinc-700/80 sm:text-lg',
                      c % 3 !== 2 && c !== 8 && 'border-r',
                      r % 3 !== 2 && r !== 8 && 'border-b',
                      c % 3 === 2 && c !== 8 && 'border-r-2 border-r-zinc-400/80 dark:border-r-zinc-500',
                      r % 3 === 2 && r !== 8 && 'border-b-2 border-b-zinc-400/80 dark:border-b-zinc-500',
                      isSelected
                        ? 'bg-violet-200/70 dark:bg-violet-500/25'
                        : sameDigit
                          ? 'bg-violet-100/60 dark:bg-violet-500/10'
                          : 'hover:bg-muted/70',
                      isWrong && 'text-rose-500',
                      isGiven
                        ? 'text-foreground'
                        : !isWrong && v
                          ? 'text-violet-600 dark:text-violet-400'
                          : ''
                    )}
                  >
                    {v !== 0 ? (
                      <motion.span
                        key={`${i}-${v}`}
                        initial={{ scale: 0.6, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ duration: 0.12, ease: 'easeOut' }}
                      >
                        {v}
                      </motion.span>
                    ) : notes[i] ? (
                      <span className="grid h-full w-full grid-cols-3 grid-rows-3 p-[1px] text-[8px] font-medium leading-none text-muted-foreground sm:text-[9px]">
                        {Array.from({ length: 9 }, (_, k) => (
                          <span key={k} className="flex items-center justify-center">
                            {notes[i] & bitFor(k + 1) ? k + 1 : ''}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}

          {/* Pause overlay */}
          <AnimatePresence>
            {paused && status === 'playing' && !generating && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-xl bg-background/90 backdrop-blur-sm"
              >
                <p className="text-lg font-bold text-foreground">Paused</p>
                <Button
                  onClick={() => setPaused(false)}
                  className="h-11 gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-md shadow-purple-500/25"
                >
                  <Play className="size-4" aria-hidden /> Resume
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Win overlay */}
          <AnimatePresence>
            {status === 'won' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-background/85 p-6 text-center backdrop-blur-sm"
              >
                <motion.p
                  initial={{ y: 10, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.08, duration: 0.22 }}
                  className="bg-gradient-to-r from-violet-500 to-purple-600 bg-clip-text text-3xl font-black text-transparent"
                >
                  Solved!
                </motion.p>
                <p className="text-sm text-muted-foreground" aria-live="polite">
                  {DIFFS[difficulty].label} · {fmtTime(elapsed)}
                  {newBest ? ' — new best time! 🏆' : ''}
                </p>
                <Button
                  onClick={() => newGame(difficulty)}
                  className="mt-1 h-11 gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-md shadow-purple-500/25"
                >
                  <RotateCcw className="size-4" aria-hidden /> New puzzle
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Tools row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1.5">
            <Button
              variant={noteMode ? 'default' : 'outline'}
              onClick={() => setNoteMode((v) => !v)}
              aria-pressed={noteMode}
              className={cn(
                'h-11 gap-1.5 rounded-xl px-3 text-sm',
                noteMode &&
                  'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-md shadow-purple-500/25'
              )}
            >
              <Pencil className="size-4" aria-hidden />
              Notes
            </Button>
            <Button variant="outline" onClick={eraseCell} aria-label="Erase cell" className="h-11 gap-1.5 rounded-xl px-3">
              <Eraser className="size-4" aria-hidden />
            </Button>
            <Button
              variant="outline"
              onClick={doHint}
              disabled={hintsLeft <= 0 || status !== 'playing'}
              aria-label={`Hint, ${hintsLeft} remaining`}
              className="h-11 gap-1.5 rounded-xl px-3 text-sm"
            >
              <Lightbulb className="size-4 text-amber-500" aria-hidden />
              <span className="tabular-nums">{hintsLeft}</span>
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={() => newGame(difficulty)}
            className="h-11 gap-1.5 rounded-xl text-sm"
          >
            <RotateCcw className="size-4" aria-hidden />
            <span className="hidden sm:inline">Restart</span>
          </Button>
        </div>

        {/* Number pad */}
        <div className="grid grid-cols-9 gap-1.5" role="group" aria-label="Number pad">
          {Array.from({ length: 9 }, (_, i) => i + 1).map((d) => (
            <button
              key={d}
              onClick={() => placeDigit(d)}
              aria-label={`Place ${d}`}
              className={cn(
                'flex h-12 items-center justify-center rounded-xl text-lg font-bold tabular-nums ring-1 transition-all active:scale-95 sm:h-12',
                selectedDigit === d
                  ? 'bg-gradient-to-b from-violet-500 to-purple-600 text-white ring-transparent shadow-md shadow-purple-500/25'
                  : 'bg-muted/60 text-foreground ring-border/60 hover:bg-muted'
              )}
            >
              {d}
            </button>
          ))}
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          Tap a cell, then a number. Toggle Notes for pencil marks · keys 1–9, N, H, arrows work too.
        </p>
      </CardContent>
    </Card>
  )
}
