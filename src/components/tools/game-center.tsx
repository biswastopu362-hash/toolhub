'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Gamepad2, Lock, Play, RefreshCw, Trophy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import {
  getAllAchievements,
  getAllGameStats,
  onGamesStoreChange,
  type GameStat,
} from '@/lib/games/scores'
import { ACHIEVEMENTS, ACHIEVEMENTS_BY_GAME } from '@/lib/games/achievements'

/* ================================================================== */
/* Game Center (D69) — the high-score hub for every built-in game:     */
/* best results per game/difficulty, plays & wins totals, and the      */
/* full achievement badge wall (unlocked vs locked).                   */
/* ================================================================== */

interface GameRowDef {
  id: string
  label: string
  group: string
  timeMode: boolean
}

interface GameGroupDef {
  key: string
  name: string
  emoji: string
  /** hash route of the game app */
  appId: string
  rows: GameRowDef[]
}

const GROUPS: GameGroupDef[] = [
  {
    key: 'sudoku',
    name: 'Sudoku',
    emoji: '🔢',
    appId: 'sudoku',
    rows: [
      { id: 'sudoku-easy', label: 'Easy best time', group: 'sudoku', timeMode: true },
      { id: 'sudoku-medium', label: 'Medium best time', group: 'sudoku', timeMode: true },
      { id: 'sudoku-hard', label: 'Hard best time', group: 'sudoku', timeMode: true },
    ],
  },
  {
    key: 'minesweeper',
    name: 'Minesweeper',
    emoji: '💣',
    appId: 'minesweeper',
    rows: [
      { id: 'minesweeper-easy', label: 'Easy best time', group: 'minesweeper', timeMode: true },
      { id: 'minesweeper-medium', label: 'Medium best time', group: 'minesweeper', timeMode: true },
      { id: 'minesweeper-hard', label: 'Hard best time', group: 'minesweeper', timeMode: true },
    ],
  },
  {
    key: 'snake',
    name: 'Snake',
    emoji: '🐍',
    appId: 'snake',
    rows: [{ id: 'snake', label: 'High score', group: 'snake', timeMode: false }],
  },
  {
    key: 'memory',
    name: 'Memory Match',
    emoji: '🧠',
    appId: 'memory-match',
    rows: [{ id: 'memory', label: 'Best points', group: 'memory', timeMode: false }],
  },
  {
    key: 'wordle',
    name: 'Bangla Wordle',
    emoji: '🟩',
    appId: 'bangla-wordle',
    rows: [{ id: 'bangla-wordle', label: 'Best score', group: 'wordle', timeMode: false }],
  },
  {
    key: 'arcade',
    name: '2P Arcade',
    emoji: '🎮',
    appId: '2p-arcade',
    rows: [
      { id: 'ttt', label: 'Tic-Tac-Toe wins', group: 'arcade', timeMode: false },
      { id: 'connect4', label: 'Connect-4 wins', group: 'arcade', timeMode: false },
    ],
  },
  {
    key: 'solitaire',
    name: 'Solitaire',
    emoji: '♠️',
    appId: 'solitaire',
    rows: [{ id: 'solitaire', label: 'Best time', group: 'solitaire', timeMode: true }],
  },
  {
    key: 'trivia',
    name: 'Trivia Quiz',
    emoji: '🎓',
    appId: 'trivia-quiz',
    rows: [{ id: 'trivia', label: 'Best score', group: 'trivia', timeMode: false }],
  },
  {
    key: '2048',
    name: '2048',
    emoji: '🟨',
    appId: 'game-2048',
    rows: [{ id: '2048', label: 'High score', group: '2048', timeMode: false }],
  },
]

function fmtTime(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function fmtValue(row: GameRowDef, stat: GameStat | undefined, legacy2048: number): string {
  const best = row.id === '2048' && legacy2048 > (stat?.best ?? 0) ? legacy2048 : stat?.best ?? 0
  if (!best) return '—'
  return row.timeMode ? fmtTime(best) : best.toLocaleString('en-US')
}

export default function GameCenterApp() {
  const [stats, setStats] = useState<Record<string, GameStat>>(() =>
    typeof window === 'undefined' ? {} : getAllGameStats()
  )
  const [unlocked, setUnlocked] = useState<Record<string, number>>(() =>
    typeof window === 'undefined' ? {} : getAllAchievements()
  )
  const [legacy2048, setLegacy2048] = useState(() => {
    if (typeof window === 'undefined') return 0
    try {
      return Number(localStorage.getItem('toolhub.2048.best')) || 0
    } catch {
      return 0
    }
  })

  const refresh = useCallback(() => {
    setStats(getAllGameStats())
    setUnlocked(getAllAchievements())
    try {
      setLegacy2048(Number(localStorage.getItem('toolhub.2048.best')) || 0)
    } catch {
      setLegacy2048(0)
    }
  }, [])

  useEffect(() => {
    const off = onGamesStoreChange(refresh)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      off()
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const totals = useMemo(() => {
    const plays = Object.values(stats).reduce((n, s) => n + s.plays, 0)
    const wins = Object.values(stats).reduce((n, s) => n + s.wins, 0)
    const bests = Object.keys(stats).filter((k) => stats[k].best > 0).length
    return { plays, wins, bests }
  }, [stats])

  const unlockedCount = Object.keys(unlocked).length
  const totalAchievements = ACHIEVEMENTS.length

  const openGame = (appId: string) => {
    window.dispatchEvent(new CustomEvent<string>('toolhub:open-app', { detail: appId }))
  }

  return (
    <Card className="overflow-hidden shadow-md">
      <CardContent className="space-y-4 p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="bg-gradient-to-r from-fuchsia-500 via-pink-500 to-rose-500 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
              Game Center
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Scores, streaks and glory — all in one place</p>
          </div>
          <Button variant="outline" size="icon" onClick={refresh} aria-label="Refresh stats" className="size-11 shrink-0 rounded-xl">
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        </div>

        {/* Totals strip */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-muted/50 p-3 text-center ring-1 ring-border/60">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Rounds</div>
            <div className="text-2xl font-black tabular-nums text-foreground">{totals.plays}</div>
          </div>
          <div className="rounded-2xl bg-emerald-500/10 p-3 text-center ring-1 ring-emerald-500/25">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Wins</div>
            <div className="text-2xl font-black tabular-nums text-foreground">{totals.wins}</div>
          </div>
          <div className="rounded-2xl bg-amber-500/10 p-3 text-center ring-1 ring-amber-500/25">
            <div className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              <Trophy className="size-3" aria-hidden /> Badges
            </div>
            <div className="text-2xl font-black tabular-nums text-foreground">
              {unlockedCount}
              <span className="text-sm text-muted-foreground">/{totalAchievements}</span>
            </div>
          </div>
        </div>

        {/* High scores per game */}
        <section aria-label="High scores" className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Gamepad2 className="size-4" aria-hidden /> High scores
          </h3>
          <div className="max-h-[380px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
            {GROUPS.map((g) => {
              const gameAchievements = ACHIEVEMENTS_BY_GAME[g.key] ?? []
              const gotGame = gameAchievements.filter((a) => unlocked[a.id]).length
              const hasData = g.rows.some((r) => (stats[r.id]?.best ?? 0) > 0 || (r.id === '2048' && legacy2048 > 0))
              return (
                <motion.div
                  key={g.key}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-2xl bg-muted/30 p-3 ring-1 ring-border/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <button
                      onClick={() => openGame(g.appId)}
                      className="flex min-w-0 items-center gap-2 rounded-lg text-left"
                      aria-label={`Open ${g.name}`}
                    >
                      <span className="text-xl" aria-hidden>
                        {g.emoji}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-foreground">{g.name}</span>
                        <span className="block text-[10px] text-muted-foreground">
                          {gotGame}/{gameAchievements.length} badges{hasData ? '' : ' · not played yet'}
                        </span>
                      </span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openGame(g.appId)}
                      aria-label={`Play ${g.name}`}
                      className="size-9 rounded-lg"
                    >
                      <Play className="size-4" aria-hidden />
                    </Button>
                  </div>
                  <div className="mt-2 grid gap-1.5">
                    {g.rows.map((r) => (
                      <div key={r.id} className="flex items-center justify-between rounded-xl bg-background/60 px-2.5 py-1.5 text-xs ring-1 ring-border/40">
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className="font-bold tabular-nums text-foreground">
                          {fmtValue(r, stats[r.id], legacy2048)}
                        </span>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )
            })}
          </div>
        </section>

        {/* Achievements wall */}
        <section aria-label="Achievements" className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wider text-muted-foreground">
            <Trophy className="size-4" aria-hidden /> Achievements
            <span className="ml-auto font-normal normal-case tracking-normal">
              {unlockedCount}/{totalAchievements} unlocked
            </span>
          </h3>
          <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto pr-1 scrollbar-thin sm:grid-cols-3">
            {ACHIEVEMENTS.map((a, i) => {
              const isUnlocked = Boolean(unlocked[a.id])
              return (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.16, delay: Math.min(0.15, i * 0.008) }}
                  className={cn(
                    'flex items-start gap-2 rounded-2xl p-2.5 ring-1',
                    isUnlocked
                      ? 'bg-gradient-to-br from-amber-500/10 to-orange-500/10 ring-amber-500/30'
                      : 'bg-muted/30 ring-border/40'
                  )}
                  title={a.desc}
                >
                  <span
                    className={cn(
                      'text-xl leading-none',
                      !isUnlocked && 'opacity-40 grayscale'
                    )}
                    aria-hidden
                  >
                    {a.emoji}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={cn(
                        'block truncate text-xs font-bold',
                        isUnlocked ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {a.name}
                    </span>
                    <span className={cn('block text-[10px] leading-tight', isUnlocked ? 'text-muted-foreground' : 'text-muted-foreground/60')}>
                      {a.desc}
                    </span>
                    {isUnlocked ? (
                      <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                        Unlocked ✓
                      </span>
                    ) : (
                      <span className="mt-0.5 flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground/50">
                        <Lock className="size-2.5" aria-hidden /> Locked
                      </span>
                    )}
                  </span>
                </motion.div>
              )
            })}
          </div>
        </section>

        <p className="text-center text-[11px] text-muted-foreground">
          Everything is stored on this device only — your records never leave your pocket.
        </p>
      </CardContent>
    </Card>
  )
}
