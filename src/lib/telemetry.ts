'use client'

/* ================================================================== */
/* Local opens telemetry (v2.1 Telemetry v2).                          */
/*                                                                     */
/* Every app open (built-in or linked platform) bumps a per-day        */
/* counter in localStorage — `toolhub.telemetry.v1`:                   */
/*                                                                     */
/*   { "2026-11-05": { notes: 3, "wordle-bn": 1, ... }, ... }          */
/*                                                                     */
/* 30-day retention, local-only (never uploaded — privacy stance).     */
/* The Admin Console renders the last 14 days as a mini bar chart.     */
/* ================================================================== */

const KEY = 'toolhub.telemetry.v1'
const RETAIN_DAYS = 30

type DayMap = Record<string, Record<string, number>>

function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function read(): DayMap {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as DayMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function write(map: DayMap): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* quota — telemetry is disposable */
  }
}

function prune(map: DayMap): DayMap {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RETAIN_DAYS)
  const cutoffKey = dayKey(cutoff)
  const next: DayMap = {}
  for (const [k, v] of Object.entries(map)) {
    if (k >= cutoffKey) next[k] = v
  }
  return next
}

/** Bump today's counter for an app. Cheap, fire-and-forget. */
export function recordAppOpen(id: string): void {
  if (!id) return
  const map = prune(read())
  const today = dayKey(new Date())
  const day = map[today] ?? {}
  day[id] = (day[id] ?? 0) + 1
  map[today] = day
  write(map)
}

export interface DailyOpens {
  /** local-timezone YYYY-MM-DD */
  date: string
  /** short weekday label, e.g. "Mon" */
  label: string
  total: number
  isToday: boolean
}

/** Per-day open totals for the last `days` days, oldest → newest. */
export function getDailyOpens(days = 14): DailyOpens[] {
  const map = read()
  const out: DailyOpens[] = []
  const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short' })
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = dayKey(d)
    const counts = map[key] ?? {}
    let total = 0
    for (const v of Object.values(counts)) total += v
    out.push({ date: key, label: fmt.format(d), total, isToday: i === 0 })
  }
  return out
}

/** Total opens recorded for one app across the retention window. */
export function getAppOpenTotal(id: string): number {
  const map = read()
  let total = 0
  for (const day of Object.values(map)) total += day[id] ?? 0
  return total
}
