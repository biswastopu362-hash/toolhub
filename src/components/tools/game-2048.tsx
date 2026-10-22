'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { RotateCcw, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* 2048 — 4x4 sliding-tile puzzle. Keyboard (arrows/WASD) + touch      */
/* swipe, animated tiles, one-step undo, persistent best score.        */
/* ================================================================== */

const SIZE = 4
const WIN_VALUE = 2048
const SWIPE_THRESHOLD = 24
const BEST_KEY = 'toolhub.2048.best'

/* Percent-based geometry so tiles and slots share one coordinate space */
const GAP_PCT = 2.5
const CELL_PCT = (100 - GAP_PCT * (SIZE - 1)) / SIZE /* 23.125 */
const STEP_PCT = CELL_PCT + GAP_PCT /* 25.625 */

type Dir = 'up' | 'down' | 'left' | 'right'

interface Tile {
  id: number
  r: number
  c: number
  v: number
  fresh?: boolean /* newly spawned → pop-in */
  mergedFrom?: boolean /* produced by a merge this move → pulse */
}

interface Snapshot {
  tiles: Tile[]
  score: number
}

type Status = 'playing' | 'won' | 'over'

const TILE_STYLES: Record<number, { bg: string; fg: string; glow?: string }> = {
  2: { bg: '#eee4da', fg: '#776e65' },
  4: { bg: '#ede0c8', fg: '#776e65' },
  8: { bg: '#f2b179', fg: '#f9f6f2' },
  16: { bg: '#f59563', fg: '#f9f6f2' },
  32: { bg: '#f67c5f', fg: '#f9f6f2' },
  64: { bg: '#f65e3b', fg: '#f9f6f2' },
  128: { bg: '#edcf72', fg: '#f9f6f2' },
  256: { bg: '#edcc61', fg: '#f9f6f2' },
  512: { bg: '#edc850', fg: '#f9f6f2' },
  1024: { bg: '#edc53f', fg: '#f9f6f2' },
  2048: { bg: '#edc22e', fg: '#f9f6f2', glow: '0 0 20px rgba(237, 194, 46, 0.55)' },
}

const TILE_STYLE_MAX = { bg: '#3c3a32', fg: '#f9f6f2' }

function tilePalette(v: number): { bg: string; fg: string; glow?: string } {
  return TILE_STYLES[v] ?? TILE_STYLE_MAX
}

function textSize(v: number): string {
  const digits = String(v).length
  if (digits <= 2) return 'text-2xl sm:text-3xl'
  if (digits === 3) return 'text-xl sm:text-2xl'
  if (digits === 4) return 'text-lg sm:text-xl'
  return 'text-sm sm:text-base'
}

/* ------------------------------------------------------------------ */
/* Pure game engine                                                    */
/* ------------------------------------------------------------------ */

let tileIdCounter = 0
function nextTileId(): number {
  tileIdCounter += 1
  return tileIdCounter
}

function emptyCells(tiles: Tile[]): Array<{ r: number; c: number }> {
  const taken = new Set(tiles.map((t) => t.r * SIZE + t.c))
  const out: Array<{ r: number; c: number }> = []
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!taken.has(r * SIZE + c)) out.push({ r, c })
    }
  }
  return out
}

function spawnTile(tiles: Tile[]): Tile[] {
  const empty = emptyCells(tiles)
  if (empty.length === 0) return tiles
  const cell = empty[Math.floor(Math.random() * empty.length)]
  const v = Math.random() < 0.9 ? 2 : 4
  return [...tiles, { id: nextTileId(), r: cell.r, c: cell.c, v, fresh: true }]
}

function initialTiles(): Tile[] {
  return spawnTile(spawnTile([]))
}

function buildGrid(tiles: Tile[]): Array<Array<Tile | null>> {
  const grid: Array<Array<Tile | null>> = Array.from({ length: SIZE }, () =>
    Array<Tile | null>(SIZE).fill(null)
  )
  for (const t of tiles) grid[t.r][t.c] = t
  return grid
}

/* Source cell of line i, index j counted from the move's origin */
function linePos(i: number, j: number, dir: Dir): { r: number; c: number } {
  switch (dir) {
    case 'left':
      return { r: i, c: j }
    case 'right':
      return { r: i, c: SIZE - 1 - j }
    case 'up':
      return { r: j, c: i }
    case 'down':
      return { r: SIZE - 1 - j, c: i }
  }
}

/* Destination cell of line i, index idx counted from the origin */
function placePos(i: number, idx: number, dir: Dir): { r: number; c: number } {
  switch (dir) {
    case 'left':
      return { r: i, c: idx }
    case 'right':
      return { r: i, c: SIZE - 1 - idx }
    case 'up':
      return { r: idx, c: i }
    case 'down':
      return { r: SIZE - 1 - idx, c: i }
  }
}

interface MoveResult {
  tiles: Tile[]
  gained: number
  moved: boolean
  bestMerge: number
}

function moveTiles(tiles: Tile[], dir: Dir): MoveResult {
  const grid = buildGrid(tiles)
  const result: Tile[] = []
  let gained = 0
  let moved = false
  let bestMerge = 0

  for (let i = 0; i < SIZE; i++) {
    /* Collect the line in traversal order (clones — state is untouched) */
    const line: Tile[] = []
    for (let j = 0; j < SIZE; j++) {
      const { r, c } = linePos(i, j, dir)
      const t = grid[r][c]
      if (t) line.push({ id: t.id, r: t.r, c: t.c, v: t.v })
    }

    /* Slide + merge (each tile merges at most once per move) */
    const out: Tile[] = []
    for (const t of line) {
      const last = out[out.length - 1]
      if (last && last.v === t.v && !last.mergedFrom) {
        last.v = t.v * 2
        last.mergedFrom = true
        gained += last.v
        if (last.v > bestMerge) bestMerge = last.v
        moved = true
      } else {
        out.push(t)
      }
    }

    /* Write the compressed line back at its final positions */
    for (let idx = 0; idx < out.length; idx++) {
      const t = out[idx]
      const { r, c } = placePos(i, idx, dir)
      if (t.r !== r || t.c !== c) moved = true
      result.push({ ...t, r, c })
    }
  }

  return { tiles: result, gained, moved, bestMerge }
}

function canMove(tiles: Tile[]): boolean {
  if (tiles.length < SIZE * SIZE) return true
  const grid = buildGrid(tiles)
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const t = grid[r][c]
      if (!t) return true
      const right = c + 1 < SIZE ? grid[r][c + 1] : null
      const down = r + 1 < SIZE ? grid[r + 1][c] : null
      if (right && right.v === t.v) return true
      if (down && down.v === t.v) return true
    }
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Tile view                                                           */
/* ------------------------------------------------------------------ */

function TileView({ tile }: { tile: Tile }) {
  const pal = tilePalette(tile.v)
  return (
    <motion.div
      className={cn(
        'absolute flex items-center justify-center rounded-xl font-extrabold tabular-nums shadow-sm',
        textSize(tile.v)
      )}
      style={{
        width: `${CELL_PCT}%`,
        height: `${CELL_PCT}%`,
        backgroundColor: pal.bg,
        color: pal.fg,
        boxShadow: pal.glow,
        zIndex: tile.mergedFrom ? 3 : 2,
      }}
      initial={tile.fresh ? { scale: 0, opacity: 0 } : false}
      animate={{
        left: `${tile.c * STEP_PCT}%`,
        top: `${tile.r * STEP_PCT}%`,
        scale: 1,
        opacity: 1,
      }}
      transition={{
        left: { duration: 0.14, ease: 'easeOut' },
        top: { duration: 0.14, ease: 'easeOut' },
        scale: { duration: 0.16, ease: 'easeOut' },
        opacity: { duration: 0.16, ease: 'easeOut' },
      }}
    >
      {/* Inner span re-mounts on each merge (key changes with v) → reliable pulse */}
      <motion.span
        key={tile.mergedFrom ? `m-${tile.v}` : 'n'}
        initial={{ scale: tile.mergedFrom ? 1.18 : 1 }}
        animate={{ scale: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="flex size-full items-center justify-center"
      >
        {tile.v}
      </motion.span>
    </motion.div>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function Game2048App() {
  const [tiles, setTiles] = useState<Tile[]>(initialTiles)
  const [score, setScore] = useState(0)
  const [best, setBest] = useState<number>(() => {
    if (typeof window === 'undefined') return 0
    try {
      return Math.max(0, Number(localStorage.getItem(BEST_KEY)) || 0)
    } catch {
      return 0
    }
  })
  const [undoState, setUndoState] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState<Status>('playing')
  const [keepGoing, setKeepGoing] = useState(false)

  const touchRef = useRef<{ x: number; y: number } | null>(null)

  const doMove = useCallback(
    (dir: Dir) => {
      if (status !== 'playing') return
      const res = moveTiles(tiles, dir)
      if (!res.moved) return
      const withSpawn = spawnTile(res.tiles)
      setUndoState({ tiles, score })
      setTiles(withSpawn)
      const nextScore = score + res.gained
      setScore(nextScore)
      if (nextScore > best) {
        setBest(nextScore)
        try {
          localStorage.setItem(BEST_KEY, String(nextScore))
        } catch {
          /* storage unavailable */
        }
      }
      if (!keepGoing && res.bestMerge >= WIN_VALUE) {
        setStatus('won')
        return
      }
      if (!canMove(withSpawn)) setStatus('over')
    },
    [tiles, score, best, status, keepGoing]
  )

  const newGame = useCallback(() => {
    setTiles(initialTiles())
    setScore(0)
    setUndoState(null)
    setStatus('playing')
    setKeepGoing(false)
  }, [])

  const undo = useCallback(() => {
    if (!undoState) return
    setTiles(undoState.tiles.map((t) => ({ id: t.id, r: t.r, c: t.c, v: t.v })))
    setScore(undoState.score)
    setUndoState(null)
    setStatus('playing')
  }, [undoState])

  const keepGoingFn = useCallback(() => {
    setKeepGoing(true)
    setStatus('playing')
  }, [])

  /* Keyboard: arrow keys + WASD while mounted */
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
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const dir = KEYS[e.key]
      if (!dir) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      e.preventDefault()
      doMove(dir)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doMove])

  /* Touch swipe on the board (threshold 24px; touch-action none stops scroll) */
  const onTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    const t = e.touches[0]
    touchRef.current = { x: t.clientX, y: t.clientY }
  }

  const onTouchEnd = (e: ReactTouchEvent<HTMLDivElement>) => {
    e.preventDefault()
    const start = touchRef.current
    touchRef.current = null
    if (!start) return
    const t = e.changedTouches[0]
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_THRESHOLD) return
    doMove(
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    )
  }

  return (
    <Card className="overflow-hidden shadow-md">
      <CardContent className="space-y-4 p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
              2048
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Merge tiles to reach 2048</p>
          </div>
          <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
            <div className="flex gap-2">
              <div className="min-w-[76px] rounded-xl bg-muted px-3 py-1.5 text-center ring-1 ring-border/60">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Score
                </div>
                <motion.div
                  key={score}
                  initial={{ y: 6, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="text-lg font-bold tabular-nums text-foreground"
                  aria-live="polite"
                  aria-label={`Score ${score}`}
                >
                  {score.toLocaleString('en-US')}
                </motion.div>
              </div>
              <div className="min-w-[76px] rounded-xl bg-muted px-3 py-1.5 text-center ring-1 ring-border/60">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Best
                </div>
                <div className="text-lg font-bold tabular-nums text-foreground">
                  {best.toLocaleString('en-US')}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={undo}
                disabled={!undoState}
                aria-label="Undo last move"
                className="size-11 rounded-xl"
              >
                <Undo2 className="size-4" aria-hidden />
              </Button>
              <Button
                onClick={newGame}
                className="h-11 gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/25 hover:from-amber-500/90 hover:to-orange-500/90"
              >
                <RotateCcw className="size-4" aria-hidden />
                New Game
              </Button>
            </div>
          </div>
        </div>

        {/* Board */}
        <div
          role="application"
          aria-label="2048 board. Use arrow keys or WASD, or swipe to move tiles."
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className="relative mx-auto aspect-square w-full max-w-[min(92vw,420px)] touch-none select-none rounded-3xl bg-amber-950/10 p-2 ring-1 ring-border sm:p-3"
        >
          <div className="relative h-full w-full">
            {/* Subtle cell slots */}
            <div className="grid h-full w-full grid-cols-4 grid-rows-4 gap-[2.5%]" aria-hidden>
              {Array.from({ length: SIZE * SIZE }, (_, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-muted/50 ring-1 ring-black/[0.03] dark:bg-white/[0.04] dark:ring-white/[0.06]"
                />
              ))}
            </div>

            {/* Animated tiles */}
            <div className="absolute inset-0">
              {tiles.map((t) => (
                <TileView key={t.id} tile={t} />
              ))}
            </div>

            {/* Win / game-over overlay */}
            <AnimatePresence>
              {status !== 'playing' && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-3xl bg-background/70 p-6 text-center backdrop-blur-sm"
                >
                  <motion.p
                    initial={{ y: 10, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.08, duration: 0.22, ease: 'easeOut' }}
                    className={cn(
                      'text-3xl font-black tracking-tight',
                      status === 'won'
                        ? 'bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent'
                        : 'text-foreground'
                    )}
                  >
                    {status === 'won' ? 'You win!' : 'Game over'}
                  </motion.p>
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    {status === 'won'
                      ? 'You reached 2048 — keep going for a higher score.'
                      : `No moves left. You scored ${score.toLocaleString('en-US')}.`}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    {status === 'won' && (
                      <Button variant="outline" onClick={keepGoingFn} className="h-11 rounded-xl">
                        Keep going
                      </Button>
                    )}
                    {status === 'over' && (
                      <Button
                        variant="outline"
                        onClick={undo}
                        disabled={!undoState}
                        className="h-11 gap-1.5 rounded-xl"
                      >
                        <Undo2 className="size-4" aria-hidden />
                        Undo
                      </Button>
                    )}
                    <Button
                      onClick={newGame}
                      className="h-11 gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/25 hover:from-amber-500/90 hover:to-orange-500/90"
                    >
                      <RotateCcw className="size-4" aria-hidden />
                      New Game
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <p className="text-center text-[11px] text-muted-foreground">
          Swipe or use arrow keys / WASD to move. Equal tiles merge — reach 2048!
        </p>
      </CardContent>
    </Card>
  )
}
