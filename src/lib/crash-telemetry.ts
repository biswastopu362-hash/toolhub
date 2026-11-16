'use client'

/* ================================================================== */
/* Crash & error telemetry — P9-W5 ("Fortify" wave 5).                 */
/*                                                                     */
/* Two error streams feed one local store:                             */
/*   1. App crashes   — React error boundaries (AppErrorBoundary)      */
/*   2. Global errors — window `error` + `unhandledrejection` events,  */
/*      attributed to the currently-open app, or to `system` when the  */
/*      launcher itself throws.                                        */
/*                                                                     */
/* Storage: localStorage `toolhub.crashes.v1`, shaped as               */
/*                                                                     */
/*   { days: { "2026-02-10": { notes: { crashes, errors,               */
/*                                     last, lastTs }, ... } },        */
/*     sessions: [{ startedAt, endedAt, score, crashes, errors }] }    */
/*                                                                     */
/* 30-day retention · 20-session history · local-only (never           */
/* uploaded — the platform's privacy stance).                          */
/*                                                                     */
/* Scoring: session health = 100 − 15 per app crash − 3 per global     */
/* error, floored at 0. A crash is a boundary-level React failure;     */
/* a global error is any other script exception / rejected promise.    */
/* ================================================================== */

const KEY = 'toolhub.crashes.v1'
const RETAIN_DAYS = 30
const SESSION_HISTORY = 20
const CRASH_DEDUP_MS = 2000

export type GlobalErrorKind = 'error' | 'rejection'

interface AppDayRecord {
  /** React error-boundary catches (app windows only). */
  crashes: number
  /** window error / unhandledrejection events. */
  errors: number
  /** Last message seen, truncated (drives the offender list). */
  last: string
  lastTs: number
}

type DayMap = Record<string, Record<string, AppDayRecord>>

export interface SessionSummary {
  startedAt: number
  endedAt: number
  score: number
  crashes: number
  errors: number
}

interface CrashStore {
  days: DayMap
  sessions: SessionSummary[]
}

const EMPTY_STORE: CrashStore = { days: {}, sessions: [] }

/* ------------------------------------------------------------------ */
/* Store primitives                                                    */
/* ------------------------------------------------------------------ */

function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function read(): CrashStore {
  if (typeof window === 'undefined') return EMPTY_STORE
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as CrashStore | null
    if (!raw || typeof raw !== 'object') return EMPTY_STORE
    return {
      days: raw.days && typeof raw.days === 'object' ? raw.days : {},
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    }
  } catch {
    return EMPTY_STORE
  }
}

function write(store: CrashStore): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* quota — crash telemetry is disposable, never block the app */
  }
}

function prune(store: CrashStore): CrashStore {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RETAIN_DAYS)
  const cutoffKey = dayKey(cutoff)
  const days: DayMap = {}
  for (const [k, v] of Object.entries(store.days)) {
    if (k >= cutoffKey) days[k] = v
  }
  return { days, sessions: store.sessions.slice(-SESSION_HISTORY) }
}

function truncate(msg: string): string {
  const s = String(msg).replace(/\s+/g, ' ').trim()
  return s.length > 240 ? `${s.slice(0, 237)}…` : s
}

/* ------------------------------------------------------------------ */
/* Session + attribution state (module-level, per page load)           */
/* ------------------------------------------------------------------ */

let session: { startedAt: number; crashes: number; errors: number } | null = null
let activeApp: string | null = null
let lastCrashSig = ''
let lastCrashTs = 0

/** Mark which app global errors should be attributed to (null = system). */
export function setActiveCrashApp(id: string | null): void {
  activeApp = id
}

/** Start a fresh health session. Called once when the OS shell mounts. */
export function markSessionStart(): void {
  session = { startedAt: Date.now(), crashes: 0, errors: 0 }
  /* opportunistic prune so the store never grows unbounded */
  write(prune(read()))
}

/** Persist the current session's summary (kept for the "last session" row). */
export function finishSession(): void {
  if (!session) return
  try {
    const store = prune(read())
    const { startedAt, crashes, errors } = session
    store.sessions.push({
      startedAt,
      endedAt: Date.now(),
      score: scoreOf(crashes, errors),
      crashes,
      errors,
    })
    write({ days: store.days, sessions: store.sessions.slice(-SESSION_HISTORY) })
  } catch {
    /* never let telemetry break unload */
  }
  session = null
}

function scoreOf(crashes: number, errors: number): number {
  return Math.max(0, Math.min(100, 100 - crashes * 15 - errors * 3))
}

/* ------------------------------------------------------------------ */
/* Recording                                                           */
/* ------------------------------------------------------------------ */

function bump(kind: 'crashes' | 'errors', appId: string, message: string): void {
  const store = read()
  const today = dayKey(new Date())
  const day = store.days[today] ?? {}
  const rec = day[appId] ?? { crashes: 0, errors: 0, last: '', lastTs: 0 }
  rec[kind] += 1
  rec.last = truncate(message)
  rec.lastTs = Date.now()
  day[appId] = rec
  store.days[today] = day
  write(store)
}

/** Record a React error-boundary crash for an app window. */
export function recordAppCrash(appId: string, message: string): void {
  if (!appId || typeof window === 'undefined') return
  try {
    bump('crashes', appId, message)
    if (session) session.crashes += 1
    /* remember the signature so the window `error` re-dispatch (React
     * reportError) is not double-counted as a global error */
    lastCrashSig = truncate(message)
    lastCrashTs = Date.now()
  } catch {
    /* telemetry must never break crash recovery */
  }
}

/**
 * Record a window `error` / `unhandledrejection` event, attributed to the
 * open app (or `system`). Crashes already recorded by a boundary within
 * the dedup window are ignored to avoid double counting.
 */
export function recordGlobalError(message: string, kind: GlobalErrorKind = 'error'): void {
  if (typeof window === 'undefined') return
  try {
    const clean = truncate(message)
    if (!clean) return
    const now = Date.now()
    if (clean === lastCrashSig && now - lastCrashTs < CRASH_DEDUP_MS) return
    bump('errors', activeApp ?? 'system', clean)
    if (session) session.errors += 1
    if (kind === 'rejection') lastCrashSig = '' /* no boundary echo for rejections */
  } catch {
    /* telemetry must never break the shell */
  }
}

/* ------------------------------------------------------------------ */
/* Readers (Admin Console)                                             */
/* ------------------------------------------------------------------ */

export interface DailyErrors {
  date: string
  label: string
  crashes: number
  errors: number
  isToday: boolean
}

/** Per-day crash/error totals for the last `days` days, oldest → newest. */
export function getDailyErrors(days = 14): DailyErrors[] {
  const map = read().days
  const out: DailyErrors[] = []
  const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = dayKey(d)
    const counts = map[key] ?? {}
    let crashes = 0
    let errors = 0
    for (const rec of Object.values(counts)) {
      crashes += rec.crashes ?? 0
      errors += rec.errors ?? 0
    }
    out.push({ date: key, label: fmt.format(d), crashes, errors, isToday: i === 0 })
  }
  return out
}

export interface AppErrorStat {
  id: string
  crashes: number
  errors: number
  last: string
  lastTs: number
}

/** Per-app aggregates across the whole retention window, worst first. */
export function getAppErrorStats(): AppErrorStat[] {
  const map = read().days
  const agg = new Map<string, AppErrorStat>()
  for (const day of Object.values(map)) {
    for (const [id, rec] of Object.entries(day)) {
      const cur = agg.get(id) ?? { id, crashes: 0, errors: 0, last: '', lastTs: 0 }
      cur.crashes += rec.crashes ?? 0
      cur.errors += rec.errors ?? 0
      if (rec.lastTs > cur.lastTs) {
        cur.last = rec.last
        cur.lastTs = rec.lastTs
      }
      agg.set(id, cur)
    }
  }
  return [...agg.values()]
    .filter((s) => s.crashes + s.errors > 0)
    .sort((a, b) => b.crashes + b.errors - (a.crashes + a.errors))
}

export interface SessionHealth {
  score: number
  crashes: number
  errors: number
  startedAt: number
}

/** Health of the CURRENT session (100 since the last page load, minus hits). */
export function getSessionHealth(): SessionHealth {
  const crashes = session?.crashes ?? 0
  const errors = session?.errors ?? 0
  return {
    score: scoreOf(crashes, errors),
    crashes,
    errors,
    startedAt: session?.startedAt ?? Date.now(),
  }
}

/** Summary of the previous session, if one was recorded. */
export function getLastSession(): SessionSummary | null {
  const sessions = read().sessions
  return sessions.length > 0 ? sessions[sessions.length - 1] : null
}

/** Wipe all recorded history (days + past sessions). Current session keeps counting. */
export function clearErrorHistory(): void {
  if (typeof window === 'undefined') return
  try {
    const store = prune(read())
    write({ days: {}, sessions: [] })
    /* keep the module session alive — only persisted history is cleared */
    void store
  } catch {
    /* ignore */
  }
}
