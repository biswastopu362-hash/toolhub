'use client'

/* ================================================================== */
/* ToolHub Games — shared high-score / stats / achievements store      */
/*                                                                     */
/* One localStorage document (`toolhub.games.v1`) records every game's */
/* best result, plays, wins and last-played timestamp so the Game      */
/* Center (D69) can render a unified high-score board. Achievements    */
/* unlock from game code and persist with their unlock timestamps.     */
/* ================================================================== */

export interface GameStat {
  /** best score (higher-is-better) or best time in seconds (lower-is-better) */
  best: number
  plays: number
  wins: number
  lastPlayed: number
}

interface GamesDoc {
  v: 1
  scores: Record<string, GameStat>
  achievements: Record<string, number> /* achievement id → unlocked at (ms) */
}

const KEY = 'toolhub.games.v1'

const EMPTY_STAT: GameStat = { best: 0, plays: 0, wins: 0, lastPlayed: 0 }

function readDoc(): GamesDoc {
  if (typeof window === 'undefined') return { v: 1, scores: {}, achievements: {} }
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { v: 1, scores: {}, achievements: {} }
    const parsed = JSON.parse(raw) as Partial<GamesDoc>
    return {
      v: 1,
      scores: parsed.scores && typeof parsed.scores === 'object' ? parsed.scores : {},
      achievements:
        parsed.achievements && typeof parsed.achievements === 'object' ? parsed.achievements : {},
    }
  } catch {
    return { v: 1, scores: {}, achievements: {} }
  }
}

function writeDoc(doc: GamesDoc): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(doc))
  } catch {
    /* storage unavailable — scores stay session-only */
  }
}

export function getGameStat(gameId: string): GameStat {
  const stat = readDoc().scores[gameId]
  return stat ? { ...EMPTY_STAT, ...stat } : { ...EMPTY_STAT }
}

export function getAllGameStats(): Record<string, GameStat> {
  const out: Record<string, GameStat> = {}
  const doc = readDoc()
  for (const id of Object.keys(doc.scores)) out[id] = { ...EMPTY_STAT, ...doc.scores[id] }
  return out
}

export interface RecordOpts {
  /** this round's score (higher better) or elapsed seconds (when timeMode) */
  value?: number
  /** score is a time — lower wins */
  timeMode?: boolean
  /** round ended in a win */
  won?: boolean
  /** count this round in `plays` (default true; set false to only chase best) */
  countPlay?: boolean
}

export interface RecordResult {
  stat: GameStat
  isNewBest: boolean
}

/** Record a finished round. Safe no-op on the server. */
export function recordGameResult(gameId: string, opts: RecordOpts = {}): RecordResult {
  const { value = 0, timeMode = false, won = false, countPlay = true } = opts
  const doc = readDoc()
  const prev: GameStat = doc.scores[gameId]
    ? { ...EMPTY_STAT, ...doc.scores[gameId] }
    : { ...EMPTY_STAT }

  let isNewBest = false
  if (value > 0) {
    if (prev.best === 0) isNewBest = true
    else if (timeMode) isNewBest = value < prev.best
    else isNewBest = value > prev.best
  }

  const next: GameStat = {
    best: isNewBest ? value : prev.best,
    plays: prev.plays + (countPlay ? 1 : 0),
    wins: prev.wins + (won ? 1 : 0),
    lastPlayed: Date.now(),
  }
  doc.scores[gameId] = next
  writeDoc(doc)
  return { stat: next, isNewBest }
}

/* ------------------------------------------------------------------ */
/* Achievements                                                        */
/* ------------------------------------------------------------------ */

export function unlockAchievement(id: string): boolean {
  const doc = readDoc()
  if (doc.achievements[id]) return false
  doc.achievements[id] = Date.now()
  writeDoc(doc)
  return true
}

export function isAchievementUnlocked(id: string): boolean {
  return Boolean(readDoc().achievements[id])
}

export function getAllAchievements(): Record<string, number> {
  return { ...readDoc().achievements }
}

/** Listen for cross-tab/cross-view updates (Game Center live refresh). */
export function onGamesStoreChange(fn: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (e: StorageEvent) => {
    if (!e.key || e.key === KEY) fn()
  }
  window.addEventListener('storage', handler)
  return () => window.removeEventListener('storage', handler)
}
