'use client'

/* ================================================================== */
/* ToolHub OS — notification feed (D73)                                */
/*                                                                     */
/* Two sources feed the in-OS notification shade:                      */
/*  1. LIVE feed, computed from on-device app data every time the      */
/*     shade opens — upcoming calendar events (next 7 days) and open   */
/*     reminders.                                                      */
/*  2. PERSISTENT notifications pushed by OS features (share target    */
/*     receipts, achievement unlocks) stored in localStorage with      */
/*     read/unread state.                                              */
/* ================================================================== */

export interface OsNotification {
  id: string
  appId: string
  title: string
  body: string
  ts: number
  read: boolean
}

const KEY = 'toolhub.notifs'
const CAP = 30

function load(): OsNotification[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as OsNotification[]) : []
  } catch {
    return []
  }
}

function save(items: OsNotification[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, CAP)))
  } catch {
    /* storage unavailable */
  }
}

export function pushOsNotification(n: Omit<OsNotification, 'ts' | 'read'> & { ts?: number }): void {
  const items = load()
  items.unshift({ ...n, ts: n.ts ?? Date.now(), read: false })
  save(items)
}

export function listOsNotifications(): OsNotification[] {
  return load()
}

export function markAllRead(): void {
  save(load().map((n) => ({ ...n, read: true })))
}

export function clearOsNotifications(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}

export function countUnread(): number {
  return load().filter((n) => !n.read).length
}

/* ------------------------------------------------------------------ */
/* Live feed — computed from local app data (never uploaded)           */
/* ------------------------------------------------------------------ */

function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function localArray(key: string): Array<Record<string, unknown>> {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function buildLiveFeed(): OsNotification[] {
  const out: OsNotification[] = []
  const now = new Date()
  const todayKey = dateKey(now)
  const in7 = new Date(now)
  in7.setDate(in7.getDate() + 7)
  const horizon = dateKey(in7)

  /* calendar events for today + the next 7 days */
  for (const ev of localArray('toolhub.calendar.events')) {
    const date = typeof ev.date === 'string' ? ev.date : ''
    if (date < todayKey || date > horizon) continue
    out.push({
      id: `live-cal-${String(ev.id ?? date)}`,
      appId: 'calendar',
      title: typeof ev.title === 'string' && ev.title ? ev.title : 'Event',
      body: `${date === todayKey ? 'Today' : date}${typeof ev.time === 'string' && ev.time ? ` · ${ev.time}` : ' · All day'}`,
      ts: Date.now(),
      read: false,
    })
  }

  /* open reminders */
  const open = localArray('toolhub-reminders').filter((r) => r.done === false)
  if (open.length > 0) {
    out.push({
      id: 'live-reminders',
      appId: 'reminders',
      title: `${open.length} open reminder${open.length === 1 ? '' : 's'}`,
      body: open
        .slice(0, 3)
        .map((r) => (typeof r.text === 'string' ? r.text : ''))
        .filter(Boolean)
        .join(' · '),
      ts: Date.now(),
      read: false,
    })
  }

  /* persistent notifications */
  out.push(...load())

  return out.sort((a, b) => b.ts - a.ts)
}
