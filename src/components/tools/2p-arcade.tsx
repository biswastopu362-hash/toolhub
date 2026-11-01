'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Bot, RotateCcw, Trophy, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { recordGameResult, unlockAchievement } from '@/lib/games/scores'

/* ================================================================== */
/* 2P Arcade — pass-and-play game night: Tic-Tac-Toe (with optional    */
/* unbeatable CPU) and Connect-4 (7×6 gravity drops). Shared win       */
/* counters per game, win-line highlight, spring drop animations.      */
/* ================================================================== */

type Game = 'ttt' | 'c4'

/* ------------------------------------------------------------------ */
/* Tic-Tac-Toe                                                         */
/* ------------------------------------------------------------------ */

type XO = 'X' | 'O' | null

const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

function tttWinner(b: XO[]): { player: XO; line: number[] } | null {
  for (const line of TTT_LINES) {
    const [a, c, d] = line
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return { player: b[a], line }
  }
  return null
}

function tttFull(b: XO[]): boolean {
  return b.every((v) => v !== null)
}

function minimax(b: XO[], me: XO, turn: XO): { score: number; move: number } {
  const win = tttWinner(b)
  if (win) return { score: win.player === me ? 10 : -10, move: -1 }
  if (tttFull(b)) return { score: 0, move: -1 }
  let bestScore = turn === me ? -Infinity : Infinity
  let bestMove = -1
  for (let i = 0; i < 9; i++) {
    if (b[i]) continue
    const next = [...b]
    next[i] = turn
    const { score } = minimax(next, me, turn === 'X' ? 'O' : 'X')
    if (turn === me ? score > bestScore : score < bestScore) {
      bestScore = score
      bestMove = i
    }
  }
  return { score: bestScore, move: bestMove }
}

/* ------------------------------------------------------------------ */
/* Connect-4                                                           */
/* ------------------------------------------------------------------ */

const C4_ROWS = 6
const C4_COLS = 7
type Disc = 'R' | 'Y' | null

function c4Winner(b: Disc[]): { player: Disc; cells: number[] } | null {
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ]
  for (let r = 0; r < C4_ROWS; r++) {
    for (let c = 0; c < C4_COLS; c++) {
      const start = r * C4_COLS + c
      const p = b[start]
      if (!p) continue
      for (const [dr, dc] of dirs) {
        const cells = [start]
        let nr = r + dr
        let nc = c + dc
        while (
          nr >= 0 && nr < C4_ROWS && nc >= 0 && nc < C4_COLS &&
          b[nr * C4_COLS + nc] === p
        ) {
          cells.push(nr * C4_COLS + nc)
          nr += dr
          nc += dc
        }
        if (cells.length >= 4) return { player: p, cells }
      }
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function TwoPlayerArcadeApp() {
  const [game, setGame] = useState<Game>('ttt')

  /* --- Tic-Tac-Toe state --- */
  const [ttt, setTtt] = useState<XO[]>(Array(9).fill(null))
  const [xTurn, setXTurn] = useState(true)
  const [tttScores, setTttScores] = useState<{ X: number; O: number; draw: number }>({ X: 0, O: 0, draw: 0 })
  const [vsCpu, setVsCpu] = useState(false)

  /* --- Connect-4 state --- */
  const [c4, setC4] = useState<Disc[]>(Array(C4_ROWS * C4_COLS).fill(null))
  const [rTurn, setRTurn] = useState(true)
  const [c4Scores, setC4Scores] = useState<{ R: number; Y: number; draw: number }>({ R: 0, Y: 0, draw: 0 })
  const [dropCol, setDropCol] = useState<number | null>(null)
  const dropTimers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => () => dropTimers.current.forEach(clearTimeout), [])

  const tttWin = tttWinner(ttt)
  const tttDraw = !tttWin && tttFull(ttt)
  const c4Win = c4Winner(c4)
  const c4Full = c4.every((v) => v !== null)
  const c4Draw = !c4Win && c4Full

  /* record results once per finished round */
  const tttRecorded = useRef(false)
  useEffect(() => {
    if (!tttWin && !tttDraw) return
    if (tttRecorded.current) return
    tttRecorded.current = true
    if (tttWin) {
      recordGameResult('ttt', { won: true })
      unlockAchievement('ttt-first-win')
      if (tttWin.player === 'X' && vsCpu) unlockAchievement('ttt-beat-cpu')
    }
  }, [tttWin, tttDraw, vsCpu])

  const c4Recorded = useRef(false)
  useEffect(() => {
    if (!c4Win && !c4Draw) return
    if (c4Recorded.current) return
    c4Recorded.current = true
    if (c4Win) {
      recordGameResult('connect4', { won: true })
      unlockAchievement('c4-first-win')
    }
  }, [c4Win, c4Draw])

  const resetTtt = useCallback((nextStarter?: boolean) => {
    setTtt(Array(9).fill(null))
    setXTurn(nextStarter ?? true)
    tttRecorded.current = false
  }, [])

  const resetC4 = useCallback(() => {
    setC4(Array(C4_ROWS * C4_COLS).fill(null))
    setRTurn(true)
    setDropCol(null)
    c4Recorded.current = false
  }, [])

  /* CPU move for tic-tac-toe */
  useEffect(() => {
    if (game !== 'ttt' || !vsCpu || xTurn) return
    if (tttWin || tttDraw) return
    const t = setTimeout(() => {
      const { move } = minimax(ttt, 'O', 'O')
      if (move >= 0) {
        const next = [...ttt]
        next[move] = 'O'
        setTtt(next)
      }
      setXTurn(true)
    }, 420)
    return () => clearTimeout(t)
  }, [game, vsCpu, xTurn, ttt, tttWin, tttDraw])

  const tapTtt = (i: number) => {
    if (ttt[i] || tttWin || tttDraw || (vsCpu && !xTurn)) return
    const next = [...ttt]
    next[i] = xTurn ? 'X' : 'O'
    setTtt(next)
    const w = tttWinner(next)
    if (w) setTttScores((s) => ({ ...s, [w.player as 'X' | 'O']: s[w.player as 'X' | 'O'] + 1 }))
    else if (tttFull(next)) setTttScores((s) => ({ ...s, draw: s.draw + 1 }))
    else if (!vsCpu) setXTurn(!xTurn)
    else setXTurn(false)
    if (navigator.vibrate) navigator.vibrate(8)
  }

  const dropDisc = (col: number) => {
    if (c4Win || c4Draw || dropCol !== null) return
    /* find lowest empty row in this column */
    let row = -1
    for (let r = C4_ROWS - 1; r >= 0; r--) {
      if (!c4[r * C4_COLS + col]) {
        row = r
        break
      }
    }
    if (row < 0) return
    const player: Disc = rTurn ? 'R' : 'Y'
    const next = [...c4]
    next[row * C4_COLS + col] = player
    setC4(next)
    const w = c4Winner(next)
    if (w) setC4Scores((s) => ({ ...s, [w.player as 'R' | 'Y']: s[w.player as 'R' | 'Y'] + 1 }))
    else if (next.every((v) => v !== null)) setC4Scores((s) => ({ ...s, draw: s.draw + 1 }))
    else setRTurn(!rTurn)
    if (navigator.vibrate) navigator.vibrate(8)
  }

  return (
    <Card className="overflow-hidden shadow-md">
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="bg-gradient-to-r from-orange-500 to-rose-600 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
              2P Arcade
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Pass-and-play classics for two</p>
          </div>
          {game === 'ttt' && (
            <Button
              variant={vsCpu ? 'default' : 'outline'}
              onClick={() => {
                setVsCpu((v) => !v)
                resetTtt(true)
              }}
              className={cn(
                'h-10 gap-1.5 rounded-xl px-3 text-sm',
                vsCpu && 'bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow-md shadow-rose-500/25'
              )}
            >
              {vsCpu ? <Bot className="size-4" aria-hidden /> : <Users className="size-4" aria-hidden />}
              {vsCpu ? 'vs CPU' : '2 Players'}
            </Button>
          )}
        </div>

        {/* Game switcher */}
        <div className="flex gap-1.5" role="tablist" aria-label="Arcade game">
          {(
            [
              ['ttt', 'Tic-Tac-Toe'],
              ['c4', 'Connect 4'],
            ] as Array<[Game, string]>
          ).map(([g, label]) => (
            <button
              key={g}
              role="tab"
              aria-selected={game === g}
              onClick={() => setGame(g)}
              className={cn(
                'h-9 flex-1 rounded-xl text-sm font-semibold ring-1 transition-colors',
                game === g
                  ? 'bg-gradient-to-r from-orange-500 to-rose-600 text-white ring-transparent shadow-md shadow-rose-500/25'
                  : 'bg-muted/60 text-muted-foreground ring-border/60 hover:bg-muted'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ---------------- Tic-Tac-Toe ---------------- */}
        {game === 'ttt' && (
          <>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Score">
              <div className="rounded-xl bg-emerald-500/10 p-2 text-center ring-1 ring-emerald-500/25">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                  {vsCpu ? 'You (X)' : 'Player X'}
                </div>
                <div className="text-2xl font-black tabular-nums text-foreground">{tttScores.X}</div>
              </div>
              <div className="rounded-xl bg-muted/60 p-2 text-center ring-1 ring-border/60">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Draws</div>
                <div className="text-2xl font-black tabular-nums text-foreground">{tttScores.draw}</div>
              </div>
              <div className="rounded-xl bg-amber-500/10 p-2 text-center ring-1 ring-amber-500/25">
                <div className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  {vsCpu ? 'CPU (O)' : 'Player O'}
                </div>
                <div className="text-2xl font-black tabular-nums text-foreground">{tttScores.O}</div>
              </div>
            </div>

            <div className="relative mx-auto grid w-full max-w-[min(88vw,380px)] grid-cols-3 gap-2">
              {ttt.map((v, i) => {
                const isWinCell = tttWin?.line.includes(i)
                return (
                  <button
                    key={i}
                    onClick={() => tapTtt(i)}
                    disabled={Boolean(v) || Boolean(tttWin) || tttDraw || (vsCpu && !xTurn)}
                    aria-label={`Cell ${Math.floor(i / 3) + 1},${(i % 3) + 1}${v ? `, ${v}` : ', empty'}`}
                    className={cn(
                      'flex aspect-square items-center justify-center rounded-2xl text-5xl font-black ring-1 transition-colors sm:text-6xl',
                      isWinCell
                        ? v === 'X'
                          ? 'bg-emerald-500/15 ring-emerald-500'
                          : 'bg-amber-500/15 ring-amber-500'
                        : 'bg-muted/40 ring-border/60 hover:bg-muted/70'
                    )}
                  >
                    {v && (
                      <motion.span
                        key={v + i}
                        initial={{ scale: 0.4, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                        className={v === 'X' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}
                      >
                        {v}
                      </motion.span>
                    )}
                  </button>
                )
              })}

              <AnimatePresence>
                {(tttWin || tttDraw) && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-2xl bg-background/85 backdrop-blur-sm"
                  >
                    <Trophy className={cn('size-10', tttWin?.player === 'X' ? 'text-emerald-500' : 'text-amber-500')} aria-hidden />
                    <p className="text-xl font-black text-foreground" aria-live="polite">
                      {tttWin ? `${vsCpu && tttWin.player === 'O' ? 'CPU' : `Player ${tttWin.player}`} wins!` : "It's a draw!"}
                    </p>
                    <Button
                      onClick={() => resetTtt(tttWin?.player === 'O' && vsCpu ? true : !xTurn)}
                      className="h-10 gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow-md shadow-rose-500/25"
                    >
                      <RotateCcw className="size-4" aria-hidden /> Next round
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <p className="text-center text-[11px] text-muted-foreground">
              {vsCpu ? 'You are X — CPU (O) never loses. Can you draw it out?' : 'Pass the device after every turn.'}
            </p>
          </>
        )}

        {/* ---------------- Connect 4 ---------------- */}
        {game === 'c4' && (
          <>
            <div className="grid grid-cols-3 gap-2" role="group" aria-label="Score">
              <div className="rounded-xl bg-rose-500/10 p-2 text-center ring-1 ring-rose-500/25">
                <div className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400">Player R</div>
                <div className="text-2xl font-black tabular-nums text-foreground">{c4Scores.R}</div>
              </div>
              <div className="rounded-xl bg-muted/60 p-2 text-center ring-1 ring-border/60">
                <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Draws</div>
                <div className="text-2xl font-black tabular-nums text-foreground">{c4Scores.draw}</div>
              </div>
              <div className="rounded-xl bg-yellow-500/10 p-2 text-center ring-1 ring-yellow-500/25">
                <div className="text-xs font-bold uppercase tracking-wider text-yellow-700 dark:text-yellow-400">Player Y</div>
                <div className="text-2xl font-black tabular-nums text-foreground">{c4Scores.Y}</div>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-[min(94vw,440px)]">
              {/* column tap zones */}
              <div className="absolute inset-x-0 top-0 z-10 grid h-8 grid-cols-7" aria-hidden>
                {Array.from({ length: C4_COLS }, (_, c) => (
                  <button key={c} tabIndex={-1} onClick={() => dropDisc(c)} className="h-full" />
                ))}
              </div>
              <div
                role="grid"
                aria-label="Connect 4 board, 7 columns by 6 rows"
                className="grid grid-cols-7 gap-1 rounded-2xl bg-sky-600/90 p-1.5 shadow-inner dark:bg-sky-900/80"
              >
                {Array.from({ length: C4_COLS }, (_, c) => (
                  <button
                    key={`h-${c}`}
                    onClick={() => dropDisc(c)}
                    aria-label={`Drop disc in column ${c + 1}`}
                    className="mx-auto size-2 rounded-full bg-white/40"
                  />
                ))}
                {c4.map((disc, i) => {
                  const isWin = c4Win?.cells.includes(i)
                  return (
                    <button
                      key={i}
                      onClick={() => dropDisc(i % C4_COLS)}
                      role="gridcell"
                      aria-label={`Row ${Math.floor(i / C4_COLS) + 1} column ${(i % C4_COLS) + 1}${disc ? `, ${disc === 'R' ? 'red' : 'yellow'}` : ', empty'}`}
                      className="flex aspect-square items-center justify-center rounded-full bg-background/90 p-[3px] ring-1 ring-black/10 focus-visible:ring-2 focus-visible:ring-white"
                    >
                      {disc && (
                        <motion.span
                          initial={{ y: -((Math.floor(i / C4_COLS) + 1) * 44), opacity: 0.6 }}
                          animate={{ y: 0, opacity: 1 }}
                          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                          className={cn(
                            'block size-full rounded-full shadow-sm',
                            disc === 'R'
                              ? 'bg-gradient-to-b from-rose-400 to-rose-600'
                              : 'bg-gradient-to-b from-amber-300 to-amber-500',
                            isWin && 'ring-[3px] ring-emerald-400'
                          )}
                        />
                      )}
                    </button>
                  )
                })}
              </div>

              <AnimatePresence>
                {(c4Win || c4Draw) && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl bg-background/85 backdrop-blur-sm"
                  >
                    <Trophy className={cn('size-10', c4Win?.player === 'R' ? 'text-rose-500' : 'text-amber-500')} aria-hidden />
                    <p className="text-xl font-black text-foreground" aria-live="polite">
                      {c4Win ? `Player ${c4Win.player} wins!` : 'Board full — draw!'}
                    </p>
                    <Button
                      onClick={resetC4}
                      className="h-10 gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-rose-600 text-white shadow-md shadow-rose-500/25"
                    >
                      <RotateCcw className="size-4" aria-hidden /> Next round
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <p className="text-center text-[11px] text-muted-foreground">
              Tap any cell in a column (or the dots above) to drop. Connect four to win.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
