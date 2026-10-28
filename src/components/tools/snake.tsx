'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Pause, Play, RotateCcw, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getGameStat, recordGameResult, unlockAchievement } from '@/lib/games/scores'

/* ================================================================== */
/* Snake — 20x20 grid, swipe + D-pad + keyboard, 4 speed levels,       */
/* persistent high score via the shared games store.                   */
/* ================================================================== */

const N = 20
const CELL = 100 / N
const SWIPE_THRESHOLD = 24

type Speed = 'slow' | 'normal' | 'fast' | 'insane'

const SPEEDS: Record<Speed, { label: string; ms: number }> = {
  slow: { label: 'Slow', ms: 200 },
  normal: { label: 'Normal', ms: 140 },
  fast: { label: 'Fast', ms: 95 },
  insane: { label: 'Insane', ms: 65 },
}

type Dir = 'up' | 'down' | 'left' | 'right'

const DELTA: Record<Dir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

interface Pt {
  x: number
  y: number
}

type Status = 'ready' | 'playing' | 'paused' | 'over'

function randomFood(snake: Pt[]): Pt {
  const taken = new Set(snake.map((s) => s.y * N + s.x))
  const free: number[] = []
  for (let i = 0; i < N * N; i++) if (!taken.has(i)) free.push(i)
  const pick = free[Math.floor(Math.random() * free.length)] ?? 0
  return { x: pick % N, y: Math.floor(pick / N) }
}

const START: Pt[] = [
  { x: 9, y: 10 },
  { x: 8, y: 10 },
  { x: 7, y: 10 },
]

export default function SnakeApp() {
  const [snake, setSnake] = useState<Pt[]>(START)
  const [food, setFood] = useState<Pt>({ x: 14, y: 10 })
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(() =>
    typeof window === 'undefined' ? 0 : getGameStat('snake').best
  )
  const [speed, setSpeed] = useState<Speed>('normal')
  const [status, setStatus] = useState<Status>('ready')
  const [newBest, setNewBest] = useState(false)

  const dirRef = useRef<Dir>('right')
  const queueRef = useRef<Dir[]>([])
  const snakeRef = useRef<Pt[]>(START)
  const foodRef = useRef<Pt>({ x: 14, y: 10 })
  const scoreRef = useRef(0)
  const swipeRef = useRef<{ x: number; y: number } | null>(null)

  const endGame = useCallback((finalScore: number) => {
    setStatus('over')
    if (navigator.vibrate) navigator.vibrate([25, 35, 25])
    const res = recordGameResult('snake', { value: finalScore })
    setBest(res.stat.best)
    setNewBest(res.isNewBest)
    unlockAchievement('snake-first-meal')
    if (finalScore >= 100) unlockAchievement('snake-100')
    if (finalScore >= 250) unlockAchievement('snake-250')
    if (finalScore >= 500) unlockAchievement('snake-500')
  }, [])

  /* Game loop */
  useEffect(() => {
    if (status !== 'playing') return
    const tick = () => {
      /* consume queued direction if it is not a reversal */
      const q = queueRef.current
      while (q.length) {
        const d = q.shift() as Dir
        if (d !== OPPOSITE[dirRef.current]) {
          dirRef.current = d
          break
        }
      }
      const body = snakeRef.current
      const head = body[0]
      const { x, y } = DELTA[dirRef.current]
      const nx = head.x + x
      const ny = head.y + y

      /* walls + self collision */
      if (nx < 0 || nx >= N || ny < 0 || ny >= N || body.some((s, i) => i < body.length - 1 && s.x === nx && s.y === ny)) {
        endGame(scoreRef.current)
        return
      }

      const next: Pt[] = [{ x: nx, y: ny }, ...body]
      const ate = nx === foodRef.current.x && ny === foodRef.current.y
      if (ate) {
        scoreRef.current += 10
        setScore(scoreRef.current)
        const nf = randomFood(next)
        foodRef.current = nf
        setFood(nf)
        if (navigator.vibrate) navigator.vibrate(8)
      } else {
        next.pop()
      }
      snakeRef.current = next
      setSnake(next)
    }
    const t = setInterval(tick, SPEEDS[speed].ms)
    return () => clearInterval(t)
  }, [status, speed, endGame])

  const start = useCallback((spd: Speed) => {
    const s: Pt[] = START
    snakeRef.current = s
    foodRef.current = { x: 14, y: 10 }
    scoreRef.current = 0
    dirRef.current = 'right'
    queueRef.current = []
    setSnake(s)
    setFood({ x: 14, y: 10 })
    setScore(0)
    setSpeed(spd)
    setNewBest(false)
    setStatus('playing')
  }, [])

  const turn = useCallback((d: Dir) => {
    if (status === 'ready') return
    const q = queueRef.current
    if (q.length < 2) q.push(d)
  }, [status])

  const togglePause = useCallback(() => {
    setStatus((s) => (s === 'playing' ? 'paused' : s === 'paused' ? 'playing' : s))
  }, [])

  /* Keyboard */
  useEffect(() => {
    const KEYS: Record<string, Dir> = {
      ArrowUp: 'up',
      w: 'up',
      W: 'up',
      ArrowDown: 'down',
      s: 'down',
      S: 'down',
      ArrowLeft: 'left',
      a: 'left',
      A: 'left',
      ArrowRight: 'right',
      d: 'right',
      D: 'right',
    }
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === ' ') {
        e.preventDefault()
        togglePause()
        return
      }
      const dir = KEYS[e.key]
      if (!dir) return
      e.preventDefault()
      turn(dir)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn, togglePause])

  /* Touch swipe on the board */
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0]
    swipeRef.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    const startPt = swipeRef.current
    swipeRef.current = null
    if (!startPt) return
    const t = e.changedTouches[0]
    const dx = t.clientX - startPt.x
    const dy = t.clientY - startPt.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up')
  }

  return (
    <Card className="overflow-hidden shadow-md">
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="bg-gradient-to-r from-lime-500 to-emerald-600 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
              Snake
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Eat, grow, don&apos;t bite yourself</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="min-w-[64px] rounded-xl bg-muted px-3 py-1.5 text-center ring-1 ring-border/60">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Score</div>
              <div className="text-lg font-bold tabular-nums text-foreground" aria-live="polite">
                {score}
              </div>
            </div>
            <div className="min-w-[64px] rounded-xl bg-muted px-3 py-1.5 text-center ring-1 ring-border/60">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Best</div>
              <div className="text-lg font-bold tabular-nums text-foreground">{best}</div>
            </div>
          </div>
        </div>

        {/* Speed chips */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5" role="tablist" aria-label="Speed">
            {(Object.keys(SPEEDS) as Speed[]).map((s) => (
              <button
                key={s}
                role="tab"
                aria-selected={speed === s}
                onClick={() => (status === 'playing' || status === 'paused' ? setSpeed(s) : start(s))}
                className={cn(
                  'h-9 rounded-xl px-3 text-sm font-semibold ring-1 transition-colors',
                  speed === s
                    ? 'bg-gradient-to-r from-lime-500 to-emerald-600 text-white ring-transparent shadow-md shadow-emerald-500/25'
                    : 'bg-muted/60 text-muted-foreground ring-border/60 hover:bg-muted'
                )}
              >
                {SPEEDS[s].label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={togglePause}
              disabled={status !== 'playing' && status !== 'paused'}
              aria-label={status === 'paused' ? 'Resume' : 'Pause'}
              className="size-11 rounded-xl"
            >
              {status === 'paused' ? <Play className="size-4" aria-hidden /> : <Pause className="size-4" aria-hidden />}
            </Button>
            <Button
              onClick={() => start(speed)}
              className="h-11 gap-1.5 rounded-xl bg-gradient-to-r from-lime-500 to-emerald-600 text-white shadow-md shadow-emerald-500/25 hover:from-lime-500/90 hover:to-emerald-600/90"
            >
              <RotateCcw className="size-4" aria-hidden />
              New Game
            </Button>
          </div>
        </div>

        {/* Board */}
        <div className="relative mx-auto w-full max-w-[min(92vw,420px)]">
          <div
            role="application"
            aria-label="Snake board. Swipe or use arrow keys to steer."
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            className="relative aspect-square w-full touch-none select-none overflow-hidden rounded-2xl bg-emerald-950/10 ring-1 ring-border dark:bg-black/40"
            style={{
              backgroundImage:
                'radial-gradient(circle at 1px 1px, rgba(16,185,129,0.10) 1px, transparent 0)',
              backgroundSize: `${CELL}% ${CELL}%`,
            }}
          >
            {/* Food */}
            <motion.div
              className="absolute rounded-full bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.7)]"
              style={{
                width: `${CELL}%`,
                height: `${CELL}%`,
                left: `${food.x * CELL}%`,
                top: `${food.y * CELL}%`,
                transform: 'scale(0.62)',
              }}
              animate={{ scale: [0.55, 0.7, 0.55] }}
              transition={{ repeat: Infinity, duration: 0.9, ease: 'easeInOut' }}
            />

            {/* Snake segments */}
            {snake.map((s, i) => (
              <div
                key={`${s.x}-${s.y}-${i}`}
                className={cn(
                  'absolute rounded-[4px]',
                  i === 0
                    ? 'bg-emerald-800 dark:bg-emerald-300'
                    : i % 2 === 0
                      ? 'bg-emerald-600/90'
                      : 'bg-emerald-500/90'
                )}
                style={{
                  width: `${CELL}%`,
                  height: `${CELL}%`,
                  left: `${s.x * CELL}%`,
                  top: `${s.y * CELL}%`,
                  transform: 'scale(0.92)',
                  opacity: i === 0 ? 1 : Math.max(0.55, 1 - i / (snake.length * 1.6)),
                }}
              />
            ))}

            {/* Overlays */}
            <AnimatePresence>
              {(status === 'ready' || status === 'over' || status === 'paused') && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/80 p-6 text-center backdrop-blur-sm"
                >
                  {status === 'ready' && (
                    <>
                      <Zap className="size-10 text-emerald-500" aria-hidden />
                      <p className="text-xl font-black text-foreground">Swipe to steer</p>
                      <p className="text-sm text-muted-foreground">Pick a speed, then tap New Game</p>
                    </>
                  )}
                  {status === 'paused' && (
                    <>
                      <p className="text-xl font-black text-foreground">Paused</p>
                      <Button
                        onClick={togglePause}
                        className="h-11 gap-1.5 rounded-xl bg-gradient-to-r from-lime-500 to-emerald-600 text-white shadow-md shadow-emerald-500/25"
                      >
                        <Play className="size-4" aria-hidden /> Resume
                      </Button>
                    </>
                  )}
                  {status === 'over' && (
                    <motion.div
                      initial={{ scale: 0.92 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                      className="flex flex-col items-center gap-2"
                    >
                      <p className="text-3xl font-black tracking-tight text-foreground">Game over</p>
                      <p className="text-sm text-muted-foreground" aria-live="polite">
                        You scored {score}
                        {newBest ? ' — new best! 🏆' : ''}
                      </p>
                      <Button
                        onClick={() => start(speed)}
                        className="mt-1 h-11 gap-1.5 rounded-xl bg-gradient-to-r from-lime-500 to-emerald-600 text-white shadow-md shadow-emerald-500/25"
                      >
                        <RotateCcw className="size-4" aria-hidden /> Play again
                      </Button>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* D-pad (touch-friendly alternative to swiping) */}
        <div className="mx-auto grid w-40 grid-cols-3 grid-rows-3 gap-1.5 sm:w-44" role="group" aria-label="Direction pad">
          <span />
          <Button variant="outline" size="icon" onClick={() => turn('up')} aria-label="Turn up" className="size-12 rounded-xl">
            <ChevronUp className="size-5" aria-hidden />
          </Button>
          <span />
          <Button variant="outline" size="icon" onClick={() => turn('left')} aria-label="Turn left" className="size-12 rounded-xl">
            <ChevronLeft className="size-5" aria-hidden />
          </Button>
          <span />
          <Button variant="outline" size="icon" onClick={() => turn('right')} aria-label="Turn right" className="size-12 rounded-xl">
            <ChevronRight className="size-5" aria-hidden />
          </Button>
          <span />
          <Button variant="outline" size="icon" onClick={() => turn('down')} aria-label="Turn down" className="size-12 rounded-xl">
            <ChevronDown className="size-5" aria-hidden />
          </Button>
          <span />
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          Swipe the board, use the D-pad or arrow keys / WASD to steer.
        </p>
      </CardContent>
    </Card>
  )
}
