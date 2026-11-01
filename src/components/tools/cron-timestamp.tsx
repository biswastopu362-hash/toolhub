'use client'

/**
 * Cron & Timestamp — schedule decoding and Unix time, computed entirely on-device.
 *
 * Tab 1 ("Cron parser") parses standard 5-field cron expressions in plain
 * TypeScript — lists, ranges, steps, combinations like `0-30/10`, weekday
 * names (MON–SUN) and the @hourly/@daily/@weekly/@monthly/@yearly macros
 * (@reboot is explicitly unsupported) — with per-field inline validation,
 * a from-scratch piecewise human description ("At 09:00, Monday through
 * Friday"), quick-pick chips per field, and the next 5 execution times in
 * the local timezone via a fast field-skipping search bounded to 366 days.
 * Tab 2 ("Timestamp") shows a live epoch-seconds clock with local/UTC
 * strings and a two-way converter between epoch values (auto-detecting
 * seconds vs milliseconds by digit count) and datetime-local inputs, with
 * relative-time, weekday and ISO 8601 readouts. The expression and last
 * converter values persist in localStorage under `toolhub-cron-expr`,
 * `toolhub-ts-epoch`, and `toolhub-ts-dt`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRightLeft,
  Calendar,
  CalendarClock,
  Check,
  Clock,
  Copy,
  Globe,
  Sparkles,
  Timer,
  TriangleAlert,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

/** Current cron expression persists here (best effort, device-local). */
const CRON_KEY = 'toolhub-cron-expr'
/** Last epoch-side converter value. */
const TS_EPOCH_KEY = 'toolhub-ts-epoch'
/** Last datetime-side converter value. */
const TS_DT_KEY = 'toolhub-ts-dt'

/** Thin glass scrollbar for long lists (house convention). */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/** Tab trigger overrides — explicit zinc styling survives light/dark themes. */
const TAB_TRIGGER_CLS =
  'h-full rounded-lg text-xs font-semibold text-zinc-500! shadow-none data-[state=active]:bg-white/10! data-[state=active]:text-white! data-[state=active]:shadow-none!'

/** Search window for upcoming runs: hard-capped at one (leap) year. */
const MAX_SEARCH_MS = 366 * 24 * 60 * 60 * 1000
/** Iteration guard so impossible schedules can never loop forever. */
const MAX_SEARCH_ITERATIONS = 600_000

type CronField = 'minute' | 'hour' | 'dom' | 'month' | 'dow'

const FIELD_ORDER: readonly CronField[] = ['minute', 'hour', 'dom', 'month', 'dow']

const FIELD_SPEC: Record<CronField, { lo: number; hi: number }> = {
  minute: { lo: 0, hi: 59 },
  hour: { lo: 0, hi: 23 },
  dom: { lo: 1, hi: 31 },
  month: { lo: 1, hi: 12 },
  dow: { lo: 0, hi: 7 },
}

const FIELD_LABELS: Record<CronField, string> = {
  minute: 'Minute',
  hour: 'Hour',
  dom: 'Day of month',
  month: 'Month',
  dow: 'Day of week',
}

const FIELDS_SHORT: readonly { field: CronField; short: string }[] = [
  { field: 'minute', short: 'min' },
  { field: 'hour', short: 'hour' },
  { field: 'dom', short: 'dom' },
  { field: 'month', short: 'mon' },
  { field: 'dow', short: 'dow' },
]

const FIELD_INDEX: Record<CronField, number> = {
  minute: 0,
  hour: 1,
  dom: 2,
  month: 3,
  dow: 4,
}

/** Presets fill the whole expression in one tap. */
const PRESETS: readonly { label: string; expr: string }[] = [
  { label: 'Every minute', expr: '* * * * *' },
  { label: 'Every 5 min', expr: '*/5 * * * *' },
  { label: 'Hourly', expr: '0 * * * *' },
  { label: 'Daily 09:00', expr: '0 9 * * *' },
  { label: 'Weekdays 09:00', expr: '0 9 * * 1-5' },
  { label: 'Weekly Mon 09:00', expr: '0 9 * * 1' },
  { label: 'Monthly 1st 00:00', expr: '0 0 1 * *' },
]

/** Per-field helper rows: name, syntax hint, and quick-pick chips. */
const FIELD_HELPERS: readonly { field: CronField; label: string; hint: string; chips: readonly string[] }[] = [
  { field: 'minute', label: 'Minute', hint: '0–59 · * , - /', chips: ['*', '*/5', '*/15', '0,30'] },
  { field: 'hour', label: 'Hour', hint: '0–23 · * , - /', chips: ['*', '*/2', '9-18'] },
  { field: 'dom', label: 'Day of month', hint: '1–31 · * , - /', chips: ['*', '1', '15'] },
  { field: 'month', label: 'Month', hint: '1–12 · numbers only', chips: ['*', '1-12'] },
  { field: 'dow', label: 'Day of week', hint: '0–6 · 0=Sun · 7=Sun · MON, TUE…', chips: ['*', '0-6'] },
]

/* ================================================================== */
/* Cron core — pure parser, matcher, next-run search, describer        */
/* ================================================================== */

interface ParsedCron {
  minute: ReadonlySet<number>
  hour: ReadonlySet<number>
  dom: ReadonlySet<number>
  month: ReadonlySet<number>
  /** Normalized to 0=Sunday (cron 7 folds onto 0). */
  dow: ReadonlySet<number>
  /** True when the day-of-month field covers every day (`*`-like). */
  domUnrestricted: boolean
  /** True when the day-of-week field covers every day (`*`-like). */
  dowUnrestricted: boolean
  /** Canonical 5-field body (macro expressions expand here). */
  normalized: string
}

interface CronFieldError {
  field: CronField
  message: string
}

type CronParse =
  | { ok: true; cron: ParsedCron }
  | { ok: false; fieldErrors: CronFieldError[]; message: string | null }

/** @macro expansions — standard Vixie definitions. */
const CRON_MACROS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
}

/** Short weekday names — trivially mapped for the dow field. */
const DOW_ALIASES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function isFullSet(s: ReadonlySet<number>, lo: number, hi: number): boolean {
  if (s.size !== hi - lo + 1) return false
  for (let v = lo; v <= hi; v++) {
    if (!s.has(v)) return false
  }
  return true
}

interface Arithmetic {
  start: number
  step: number
  end: number
}

/** Detects evenly spaced sets like {0,15,30,45} → {start:0, step:15}. */
function isArithmetic(s: ReadonlySet<number>): Arithmetic | null {
  if (s.size < 2) return null
  const arr = [...s].sort((a, b) => a - b)
  const step = arr[1] - arr[0]
  if (step <= 0) return null
  for (let i = 2; i < arr.length; i++) {
    if (arr[i] - arr[i - 1] !== step) return null
  }
  return { start: arr[0], step, end: arr[arr.length - 1] }
}

/** "a, b and c" natural join. */
function joinNatural(items: readonly string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Resolves one endpoint token (number or weekday name) to its value. */
function resolveEndpoint(field: CronField, token: string): { value: number } | { error: string } {
  if (/^\d+$/.test(token)) {
    const v = Number.parseInt(token, 10)
    const spec = FIELD_SPEC[field]
    if (v < spec.lo || v > spec.hi) {
      return { error: `${v} is out of range (${spec.lo}–${spec.hi})` }
    }
    return { value: v }
  }
  if (field === 'dow') {
    const v = DOW_ALIASES[token]
    if (v === undefined) {
      return { error: `unknown day name "${token.toUpperCase()}" — use SUN, MON, TUE…` }
    }
    return { value: v }
  }
  if (field === 'month') {
    return { error: "month names aren't supported here — use numbers 1–12" }
  }
  return { error: `names aren't allowed in this field — use numbers` }
}

/**
 * Parses one cron field into a sorted value list. Supports `*`, `a`, `a-b`,
 * star-slash-step (`*`/n), `a-b/n`, `a/n` (start at a, step to max), and
 * comma lists of those.
 * Dow accepts 3-letter names and folds 7 onto 0 (Sunday).
 */
function parseCronField(field: CronField, raw: string): { values: number[]; error: string | null } {
  const spec = FIELD_SPEC[field]
  const text = raw.trim()
  if (text.length === 0) return { values: [], error: 'this field is empty' }
  const values = new Set<number>()
  for (const atomRaw of text.split(',')) {
    const atom = atomRaw.trim().toLowerCase()
    if (atom.length === 0) {
      return { values: [], error: `"${text}" has an empty list item` }
    }
    const match = /^(\*|\d+|[a-z]{3})(?:-(\d+|[a-z]{3}))?(?:\/(\d+))?$/.exec(atom)
    if (match === null) {
      return { values: [], error: `"${atomRaw.trim()}" isn't valid syntax here` }
    }
    const startTok = match[1]
    const endTok = match[2]
    const stepTok = match[3]
    let step = 1
    if (stepTok !== undefined) {
      step = Number.parseInt(stepTok, 10)
      if (step < 1) {
        return { values: [], error: `step "/${stepTok}" must be 1 or more` }
      }
    }
    let lo = spec.lo
    let hi = spec.hi
    if (startTok === '*') {
      if (endTok !== undefined) {
        return { values: [], error: `"${atomRaw.trim()}" isn't valid syntax here` }
      }
    } else {
      const startRes = resolveEndpoint(field, startTok)
      if ('error' in startRes) return { values: [], error: startRes.error }
      lo = startRes.value
      if (endTok !== undefined) {
        const endRes = resolveEndpoint(field, endTok)
        if ('error' in endRes) return { values: [], error: endRes.error }
        hi = endRes.value
        if (lo > hi) {
          return { values: [], error: `range ${lo}-${hi} runs backwards` }
        }
      } else if (stepTok !== undefined) {
        hi = spec.hi // "5/15" → start at 5, every 15 up to the field max
      } else {
        hi = lo
      }
    }
    for (let v = lo; v <= hi; v += step) {
      values.add(field === 'dow' ? v % 7 : v)
    }
  }
  return { values: [...values].sort((a, b) => a - b), error: null }
}

/** Parses a full 5-field expression (or @macro) into sets + flags. */
function parseCron(expr: string): CronParse {
  const trimmed = expr.trim()
  if (trimmed.length === 0) return { ok: false, fieldErrors: [], message: null }
  let body = trimmed
  let normalized = trimmed.replace(/\s+/g, ' ')
  if (body.startsWith('@')) {
    const macro = body.toLowerCase()
    if (macro === '@reboot') {
      return {
        ok: false,
        fieldErrors: [],
        message: "@reboot isn't supported — it fires once at boot time, not on a repeating schedule.",
      }
    }
    const expansion = CRON_MACROS[macro]
    if (expansion === undefined) {
      return {
        ok: false,
        fieldErrors: [],
        message:
          'Unknown macro — supported: @hourly, @daily, @midnight, @weekly, @monthly, @yearly, @annually.',
      }
    }
    body = expansion
    normalized = expansion
  }
  const parts = body.split(/\s+/)
  if (parts.length !== 5) {
    return {
      ok: false,
      fieldErrors: [],
      message:
        parts.length < 5
          ? `Expected 5 fields (minute · hour · day-of-month · month · day-of-week) — got ${parts.length}.`
          : `Too many fields — standard cron uses exactly 5 (seconds-level cron isn't supported).`,
    }
  }
  const fieldErrors: CronFieldError[] = []
  const sets: Partial<Record<CronField, Set<number>>> = {}
  FIELD_ORDER.forEach((field, i) => {
    const res = parseCronField(field, parts[i] ?? '')
    if (res.error !== null) {
      fieldErrors.push({ field, message: res.error })
    } else {
      sets[field] = new Set(res.values)
    }
  })
  if (fieldErrors.length > 0) return { ok: false, fieldErrors, message: null }
  const minute = sets.minute ?? new Set<number>()
  const hour = sets.hour ?? new Set<number>()
  const dom = sets.dom ?? new Set<number>()
  const month = sets.month ?? new Set<number>()
  const dow = sets.dow ?? new Set<number>()
  return {
    ok: true,
    cron: {
      minute,
      hour,
      dom,
      month,
      dow,
      domUnrestricted: isFullSet(dom, 1, 31),
      dowUnrestricted: isFullSet(dow, 0, 6),
      normalized,
    },
  }
}

/**
 * Day matching with the standard Vixie rule: when BOTH day-of-month and
 * day-of-week are restricted, a day matches if EITHER matches.
 */
function dayMatches(cron: ParsedCron, d: Date): boolean {
  if (cron.domUnrestricted && cron.dowUnrestricted) return true
  const domOk = cron.dom.has(d.getDate())
  const dowOk = cron.dow.has(d.getDay())
  if (cron.domUnrestricted) return dowOk
  if (cron.dowUnrestricted) return domOk
  return domOk || dowOk
}

/**
 * Next `count` runs strictly after `fromMs`, minute-by-minute with fast
 * skips (month → 1st of next month, day → next midnight, hour → next full
 * hour). Pure: every step builds a fresh Date. Bounded so impossible
 * schedules (Feb 30) exhaust the 366-day window and return [].
 */
function nextRuns(cron: ParsedCron, count: number, fromMs: number): Date[] {
  const limit = fromMs + MAX_SEARCH_MS
  const first = new Date(fromMs)
  const found: Date[] = []
  let t = new Date(
    first.getFullYear(),
    first.getMonth(),
    first.getDate(),
    first.getHours(),
    first.getMinutes() + 1
  ).getTime()
  let guard = 0
  while (t < limit && found.length < count && guard < MAX_SEARCH_ITERATIONS) {
    guard += 1
    const cur = new Date(t)
    const y = cur.getFullYear()
    const mo = cur.getMonth()
    const d = cur.getDate()
    const h = cur.getHours()
    if (!cron.month.has(mo + 1)) {
      t = new Date(y, mo + 1, 1).getTime()
      continue
    }
    if (!dayMatches(cron, cur)) {
      t = new Date(y, mo, d + 1).getTime()
      continue
    }
    if (!cron.hour.has(h)) {
      t = new Date(y, mo, d, h + 1).getTime()
      continue
    }
    if (!cron.minute.has(cur.getMinutes())) {
      t = new Date(y, mo, d, h, cur.getMinutes() + 1).getTime()
      continue
    }
    found.push(cur)
    t = new Date(y, mo, d, h, cur.getMinutes() + 1).getTime()
  }
  return found
}

/* ================================================================== */
/* Cron describer — piecewise human sentences                          */
/* ================================================================== */

const DOW_NAMES: readonly string[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const MONTH_NAMES: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

function describeMinuteSet(s: ReadonlySet<number>): string {
  const ar = isArithmetic(s)
  if (ar !== null && ar.step > 1) {
    return ar.start === 0
      ? `every ${ar.step} minutes`
      : `every ${ar.step} minutes from minute ${ar.start}`
  }
  const arr = [...s].sort((a, b) => a - b)
  if (arr.length === 1) return `minute ${arr[0]}`
  const shown = arr.slice(0, 6).map(String)
  return `minutes ${joinNatural(shown)}${arr.length > 6 ? '…' : ''}`
}

function describeHourSet(s: ReadonlySet<number>): string {
  const ar = isArithmetic(s)
  if (ar !== null && ar.step > 1) {
    return `every ${ar.step} hours from ${pad2(ar.start)}:00`
  }
  const arr = [...s].sort((a, b) => a - b)
  if (arr.length === 1) return `hour ${pad2(arr[0])}`
  const last = arr[arr.length - 1]
  if (last - arr[0] === arr.length - 1) {
    return `hours ${pad2(arr[0])} through ${pad2(last)}`
  }
  const shown = arr.slice(0, 6).map((v) => pad2(v))
  return `hours ${joinNatural(shown)}${arr.length > 6 ? '…' : ''}`
}

function describeDom(s: ReadonlySet<number>): string {
  const arr = [...s].sort((a, b) => a - b)
  if (arr.length === 1) return `on day ${arr[0]} of the month`
  const ar = isArithmetic(s)
  if (ar !== null && arr.length > 8) {
    return `on day ${ar.start}, then every ${ar.step} days of the month`
  }
  const last = arr[arr.length - 1]
  if (last - arr[0] === arr.length - 1 && arr.length >= 3) {
    return `on days ${arr[0]} through ${last} of the month`
  }
  const shown = arr.slice(0, 8).map(String)
  return `on day ${joinNatural(shown)}${arr.length > 8 ? '…' : ''} of the month`
}

function describeDow(s: ReadonlySet<number>): string {
  const arr = [...s].sort((a, b) => a - b)
  if (arr.length === 1) return DOW_NAMES[arr[0]] ?? 'day of week'
  const last = arr[arr.length - 1]
  if (last - arr[0] === arr.length - 1 && arr.length >= 3) {
    return `${DOW_NAMES[arr[0]] ?? '?'} through ${DOW_NAMES[last] ?? '?'}`
  }
  const shown = arr.slice(0, 8).map((v) => DOW_NAMES[v] ?? String(v))
  return joinNatural(shown)
}

function describeMonth(s: ReadonlySet<number>): string {
  const name = (v: number): string => MONTH_NAMES[v - 1] ?? String(v)
  const arr = [...s].sort((a, b) => a - b)
  if (arr.length === 1) return `in ${name(arr[0])}`
  const ar = isArithmetic(s)
  if (ar !== null && arr.length > 8) {
    return `in every ${ar.step} months from ${name(ar.start)}`
  }
  const last = arr[arr.length - 1]
  if (last - arr[0] === arr.length - 1 && arr.length >= 3) {
    return `in ${name(arr[0])} through ${name(last)}`
  }
  const shown = arr.slice(0, 8).map(name)
  return `in ${joinNatural(shown)}${arr.length > 8 ? '…' : ''}`
}

function describeTime(cron: ParsedCron): string {
  const m = cron.minute
  const h = cron.hour
  const mFull = isFullSet(m, 0, 59)
  const hFull = isFullSet(h, 0, 23)
  const mArr = [...m].sort((a, b) => a - b)
  const hArr = [...h].sort((a, b) => a - b)
  const mAr = isArithmetic(m)
  const hAr = isArithmetic(h)
  const at = (hh: number, mm: number): string => `${pad2(hh)}:${pad2(mm)}`

  // Every minute of every hour.
  if (mFull && hFull) return 'Every minute'

  // No hour restriction — describe the minute pattern.
  if (hFull) {
    if (mAr !== null && mAr.start === 0 && mAr.step > 1) return `Every ${mAr.step} minutes`
    if (mAr !== null && mAr.start > 0 && mAr.step > 1) {
      return `Every ${mAr.step} minutes from minute ${mAr.start}`
    }
    if (mArr.length === 1) return `At minute ${mArr[0]} past every hour`
    if (mArr.length <= 8) return `At minutes ${joinNatural(mArr.map(String))} past every hour`
    return 'At set minutes past every hour'
  }

  // A single hour — clock times.
  if (hArr.length === 1) {
    const hv = hArr[0]
    if (mFull) return `Every minute between ${at(hv, 0)} and ${at(hv, 59)}`
    if (mAr !== null && mAr.step > 1) {
      return `Every ${mAr.step} minutes between ${at(hv, 0)} and ${at(hv, 59)}`
    }
    if (mArr.length === 1) return `At ${at(hv, mArr[0])}`
    const shown = mArr.slice(0, 8).map((mm) => at(hv, mm))
    return `At ${joinNatural(shown)}${mArr.length > 8 ? '…' : ''}`
  }

  // Clean "every N hours" cadence with one minute value.
  if (
    hAr !== null &&
    hAr.step > 1 &&
    (hAr.start === 0 || hAr.end + hAr.step > 23) &&
    mArr.length === 1
  ) {
    const from = hAr.start === 0 ? '' : ` from ${at(hAr.start, 0)}`
    return `At minute ${mArr[0]} past every ${hAr.step} hours${from}`
  }

  // Small combination — enumerate the exact clock times.
  if (hArr.length * mArr.length <= 8) {
    const items: string[] = []
    for (const hv of hArr) {
      for (const mv of mArr) items.push(at(hv, mv))
    }
    return `At ${joinNatural(items)}`
  }

  // Generic fallback: describe minute and hour sets separately.
  const mDesc = describeMinuteSet(m)
  const hDesc = describeHourSet(h)
  return mDesc.startsWith('every') ? `${capitalize(mDesc)} during ${hDesc}` : `At ${mDesc} during ${hDesc}`
}

function describeDay(cron: ParsedCron): string {
  const domRestricted = !isFullSet(cron.dom, 1, 31)
  const dowRestricted = !isFullSet(cron.dow, 0, 6)
  const monthRestricted = !isFullSet(cron.month, 1, 12)
  const pieces: string[] = []
  if (domRestricted && dowRestricted) {
    pieces.push(`${describeDom(cron.dom)}, or on ${describeDow(cron.dow)}`)
  } else if (domRestricted) {
    pieces.push(describeDom(cron.dom))
  } else if (dowRestricted) {
    pieces.push(describeDow(cron.dow))
  }
  if (monthRestricted) pieces.push(describeMonth(cron.month))
  return pieces.join(', ')
}

function describeCron(cron: ParsedCron): string {
  const day = describeDay(cron)
  const sentence = day.length > 0 ? `${describeTime(cron)}, ${day}` : describeTime(cron)
  return capitalize(sentence)
}

/* ================================================================== */
/* Timestamp core — formatting, relative time, input parsing           */
/* ================================================================== */

const DOW_SHORT: readonly string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON_SHORT: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

/** "Mon, 13 Jan 2025 · 09:41:23" in the device timezone. */
function formatHumanLocal(d: Date): string {
  return `${DOW_SHORT[d.getDay()]}, ${pad2(d.getDate())} ${MON_SHORT[d.getMonth()]} ${d.getFullYear()} · ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** "Mon, 13 Jan 2025 · 09:41:23 UTC" shifted to UTC. */
function formatHumanUTC(d: Date): string {
  return `${DOW_SHORT[d.getUTCDay()]}, ${pad2(d.getUTCDate())} ${MON_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad2(
    d.getUTCHours()
  )}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC`
}

/** Value for `<input type="datetime-local">` in the device timezone. */
function formatDatetimeLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(
    d.getMinutes()
  )}`
}

/** "Mon 2025-01-13 09:00" for next-run rows. */
function formatRunLabel(d: Date): string {
  return `${DOW_SHORT[d.getDay()]} ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`
}

interface RelativeParts {
  text: string
  future: boolean
}

/** Compact two-unit magnitude like "2h 15m", "3d 4h", "5mo 12d". */
function relativeParts(deltaMs: number): RelativeParts {
  const future = deltaMs > 0
  const s = Math.round(Math.abs(deltaMs) / 1000)
  let text: string
  if (s < 60) {
    text = `${Math.max(s, 1)}s`
  } else {
    const m = Math.floor(s / 60)
    if (m < 60) {
      text = `${m}m`
    } else {
      const h = Math.floor(m / 60)
      const rm = m % 60
      if (h < 24) {
        text = rm > 0 ? `${h}h ${rm}m` : `${h}h`
      } else {
        const d = Math.floor(h / 24)
        const rh = h % 24
        if (d < 30) {
          text = rh > 0 ? `${d}d ${rh}h` : `${d}d`
        } else {
          const mo = Math.floor(d / 30)
          const rd = d - mo * 30
          if (d < 365) {
            text = rd > 0 ? `${mo}mo ${rd}d` : `${mo}mo`
          } else {
            const y = Math.floor(d / 365)
            const rmo = Math.floor((d - y * 365) / 30)
            text = rmo > 0 ? `${y}y ${rmo}mo` : `${y}y`
          }
        }
      }
    }
  }
  return { text, future }
}

const UNIT_NAMES: Record<string, string> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  mo: 'month',
  y: 'year',
}

/** "3d 4h" → "3 days 4 hours" for prose rows. */
function proseUnits(text: string): string {
  return text
    .split(' ')
    .map((tok) => {
      const numStr = tok.replace(/[a-z]+$/, '')
      const unit = tok.slice(numStr.length)
      const name = UNIT_NAMES[unit]
      const n = Number.parseInt(numStr, 10)
      if (name === undefined || Number.isNaN(n)) return tok
      return `${n} ${name}${n === 1 ? '' : 's'}`
    })
    .join(' ')
}

/** Chip style: "in 2h 15m" / "45s ago". */
function relativeLabel(deltaMs: number): string {
  if (Math.abs(deltaMs) < 1000) return 'now'
  const p = relativeParts(deltaMs)
  return p.future ? `in ${p.text}` : `${p.text} ago`
}

/** Prose style: "in 5 months" / "3 days ago". */
function relativeProse(deltaMs: number): string {
  if (Math.abs(deltaMs) < 1000) return 'just now'
  const p = relativeParts(deltaMs)
  return p.future ? `in ${proseUnits(p.text)}` : `${proseUnits(p.text)} ago`
}

interface EpochParseResult {
  date: Date | null
  unit: 'seconds' | 'milliseconds' | null
  error: string | null
}

/**
 * Epoch input: ≤11 significant digits → seconds, otherwise milliseconds.
 * Negative values (before 1970) supported; range-checked against the JS
 * Date limits (±8.64e15 ms) so nothing overflows downstream.
 */
function parseEpochInput(raw: string): EpochParseResult {
  const text = raw.trim()
  if (text.length === 0) return { date: null, unit: null, error: null }
  const negative = text.startsWith('-')
  const digits = negative ? text.slice(1) : text
  if (!/^\d+$/.test(digits)) {
    return { date: null, unit: null, error: 'digits only — e.g. 1736935380 or 1736935380000' }
  }
  const n = Number(text)
  if (!Number.isFinite(n)) {
    return { date: null, unit: null, error: 'that number is too large to be a timestamp' }
  }
  const significant = digits.replace(/^0+/, '').length
  const isMs = significant > 11
  const ms = isMs ? n : n * 1000
  if (Math.abs(ms) > 8.64e15) {
    return {
      date: null,
      unit: isMs ? 'milliseconds' : 'seconds',
      error: "outside the supported date range (±275,760 years)",
    }
  }
  return { date: new Date(ms), unit: isMs ? 'milliseconds' : 'seconds', error: null }
}

interface DtParseResult {
  date: Date | null
  error: string | null
}

/** datetime-local value → Date in the device timezone (or inline error). */
function parseDtInput(raw: string): DtParseResult {
  const text = raw.trim()
  if (text.length === 0) return { date: null, error: null }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text)
  if (match === null) {
    return { date: null, error: 'use the picker format — YYYY-MM-DD HH:MM' }
  }
  const y = Number.parseInt(match[1], 10)
  const mo = Number.parseInt(match[2], 10)
  const d = Number.parseInt(match[3], 10)
  const h = Number.parseInt(match[4], 10)
  const mi = Number.parseInt(match[5], 10)
  const sec = match[6] !== undefined ? Number.parseInt(match[6], 10) : 0
  if (mo < 1 || mo > 12) {
    return { date: null, error: `month ${mo} is out of range (1–12)` }
  }
  if (h > 23 || mi > 59 || sec > 59) {
    return { date: null, error: 'check the time — hours 0–23, minutes and seconds 0–59' }
  }
  // Round-trip check: JS silently rolls impossible days (Feb 30 → Mar 2),
  // and years 0–99 map to 1900+year unless setFullYear is used.
  const probe = new Date(2000, mo - 1, d, h, mi, sec)
  probe.setFullYear(y)
  if (
    probe.getFullYear() !== y ||
    probe.getMonth() !== mo - 1 ||
    probe.getDate() !== d ||
    probe.getHours() !== h ||
    probe.getMinutes() !== mi
  ) {
    return { date: null, error: "that date doesn't exist — check day and month values" }
  }
  return { date: probe, error: null }
}

/* ================================================================== */
/* Shared micro-components                                             */
/* ================================================================== */

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

/** Clipboard write with a legacy textarea fallback for insecure contexts. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

interface CopyIconButtonProps {
  value: string
  label: string
  onCopy: (value: string, label: string) => void
  disabled?: boolean
}

function CopyIconButton({ value, label, onCopy, disabled = false }: CopyIconButtonProps) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    },
    []
  )

  const handleCopy = (): void => {
    if (disabled) return
    onCopy(value, label)
    setCopied(true)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      aria-label={`Copy ${label}`}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white',
        copied && 'border-teal-400/40 bg-teal-400/10 text-teal-300',
        disabled && 'pointer-events-none opacity-40'
      )}
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
    </button>
  )
}

interface CopyRowProps {
  label: string
  value: string
  onCopy: (value: string, label: string) => void
}

/** One converter output row: label · mono value · copy. */
function CopyRow({ label, value, onCopy }: CopyRowProps) {
  return (
    <div className="flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] py-1.5 pl-3 pr-1.5">
      <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200" title={value}>
        {value}
      </span>
      <CopyIconButton value={value} label={`${label} value`} onCopy={onCopy} />
    </div>
  )
}

interface NextRunRowProps {
  index: number
  run: Date
  nowMs: number
}

/** One upcoming run: index · mono datetime · relative chip. */
function NextRunRow({ index, run, nowMs }: NextRunRowProps) {
  const label = formatRunLabel(run)
  return (
    <div className="flex h-11 items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 transition-colors hover:bg-white/[0.06]">
      <span className="w-5 shrink-0 text-right font-mono text-[10px] text-zinc-600">{index + 1}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-200" title={label}>
        {label}
      </span>
      <Badge
        variant="outline"
        className="shrink-0 border-teal-400/30 bg-teal-400/10 font-mono text-[10px] font-medium text-teal-300"
      >
        {relativeLabel(run.getTime() - nowMs)}
      </Badge>
    </div>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function CronTimestampApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  // Registry components load client-only (ssr:false), so lazy initializers
  // can safely read the clock and localStorage — no hydration dance needed.
  const [now, setNow] = useState(() => Date.now())
  const [expr, setExpr] = useState<string>(() => {
    try {
      return localStorage.getItem(CRON_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [epochInput, setEpochInput] = useState<string>(() => {
    try {
      return localStorage.getItem(TS_EPOCH_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [dtInput, setDtInput] = useState<string>(() => {
    try {
      return localStorage.getItem(TS_DT_KEY) ?? ''
    } catch {
      return ''
    }
  })

  /* ---------------- ticking clock (cleared on unmount) ---------------- */
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  /* ---------------- persistence (write-through) ---------------- */
  useEffect(() => {
    try {
      localStorage.setItem(CRON_KEY, expr.slice(0, 300))
    } catch {
      /* storage unavailable — memory only */
    }
  }, [expr])

  useEffect(() => {
    try {
      localStorage.setItem(TS_EPOCH_KEY, epochInput.slice(0, 40))
    } catch {
      /* storage unavailable — memory only */
    }
  }, [epochInput])

  useEffect(() => {
    try {
      localStorage.setItem(TS_DT_KEY, dtInput.slice(0, 40))
    } catch {
      /* storage unavailable — memory only */
    }
  }, [dtInput])

  /* ---------------- copy plumbing ---------------- */
  const copyValue = useCallback(
    (value: string, label: string) => {
      haptic(12)
      void (async () => {
        const ok = await copyToClipboard(value)
        if (ok) {
          toast({ title: 'Copied', description: label })
        } else {
          toast({ title: 'Copy failed', description: 'The clipboard is unavailable here.', variant: 'destructive' })
        }
      })()
    },
    [toast]
  )

  /* ---------------- cron actions ---------------- */
  const applyPreset = useCallback((next: string) => {
    setExpr(next)
    haptic(12)
  }, [])

  const applyFieldChip = useCallback((field: CronField, value: string) => {
    setExpr((prev) => {
      const parts = prev.trim().length > 0 ? prev.trim().split(/\s+/) : []
      const base = parts.length === 5 ? [...parts] : ['*', '*', '*', '*', '*']
      base[FIELD_INDEX[field]] = value
      return base.join(' ')
    })
    haptic(12)
  }, [])

  /* ---------------- timestamp actions ---------------- */
  const fillDtNow = useCallback(() => {
    setDtInput(formatDatetimeLocal(new Date()))
    haptic(12)
  }, [])

  const copyNowEpoch = useCallback(() => {
    copyValue(String(Math.floor(now / 1000)), 'Current epoch (seconds)')
  }, [copyValue, now])

  /* ---------------- derived: cron ---------------- */
  const cronParse = useMemo<CronParse>(() => parseCron(expr), [expr])
  const cronFieldErrors: CronFieldError[] = cronParse.ok ? [] : cronParse.fieldErrors
  const cronMessage: string | null = cronParse.ok ? null : cronParse.message
  const hasCronError = cronFieldErrors.length > 0 || cronMessage !== null
  const exprEmpty = expr.trim().length === 0

  // Recompute upcoming runs only when the expression changes or the minute flips.
  const nowMinuteMs = Math.floor(now / 60000) * 60000
  const nextRunList = useMemo<Date[] | null>(() => {
    if (!cronParse.ok) return null
    return nextRuns(cronParse.cron, 5, nowMinuteMs)
  }, [cronParse, nowMinuteMs])

  const exprParts = useMemo(() => (exprEmpty ? [] : expr.trim().split(/\s+/)), [expr, exprEmpty])
  const isMacro = expr.trim().startsWith('@')

  /* ---------------- derived: timestamp ---------------- */
  const epochSeconds = Math.floor(now / 1000)
  const nowDate = new Date(now)

  const epochParsed = useMemo<EpochParseResult>(() => parseEpochInput(epochInput), [epochInput])
  const dtParsed = useMemo<DtParseResult>(() => parseDtInput(dtInput), [dtInput])

  const epochRows = useMemo<CopyRowProps[]>(() => {
    const d = epochParsed.date
    if (d === null) return []
    return [
      { label: 'Local', value: formatHumanLocal(d), onCopy: copyValue },
      { label: 'UTC', value: formatHumanUTC(d), onCopy: copyValue },
      { label: 'ISO 8601', value: d.toISOString(), onCopy: copyValue },
      { label: 'Relative', value: relativeProse(d.getTime() - now), onCopy: copyValue },
      { label: 'Weekday', value: DOW_NAMES[d.getDay()] ?? '', onCopy: copyValue },
    ]
  }, [epochParsed, now, copyValue])

  const dtRows = useMemo<CopyRowProps[]>(() => {
    const d = dtParsed.date
    if (d === null) return []
    return [
      { label: 'Epoch s', value: String(Math.floor(d.getTime() / 1000)), onCopy: copyValue },
      { label: 'Epoch ms', value: String(d.getTime()), onCopy: copyValue },
      { label: 'ISO 8601', value: d.toISOString(), onCopy: copyValue },
      { label: 'UTC', value: formatHumanUTC(d), onCopy: copyValue },
    ]
  }, [dtParsed, copyValue])

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-teal-500/[0.1] via-transparent to-cyan-500/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-500 to-sky-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(6_182_212/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <CalendarClock className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Cron &amp; Timestamp</h2>
              <p className="text-xs text-zinc-400">Cron schedules and Unix time, decoded on this device.</p>
            </div>
          </div>
        </div>

        {/* ---------------- Tabs ---------------- */}
        <div className="p-4 sm:p-5">
          <Tabs defaultValue="cron">
            <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl border border-white/10 bg-white/[0.04] p-1 text-zinc-400">
              <TabsTrigger value="cron" className={TAB_TRIGGER_CLS}>
                Cron parser
              </TabsTrigger>
              <TabsTrigger value="timestamp" className={TAB_TRIGGER_CLS}>
                Timestamp
              </TabsTrigger>
            </TabsList>

            {/* ==================== TAB 1 — CRON PARSER ==================== */}
            <TabsContent value="cron" className="mt-4 space-y-4">
              {/* ---------- expression ---------- */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <label htmlFor="cron-expr" className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Cron expression
                  </label>
                  <span className="text-[11px] text-zinc-600">minute · hour · day · month · weekday</span>
                </div>
                <Input
                  id="cron-expr"
                  value={expr}
                  onChange={(e) => setExpr(e.target.value)}
                  placeholder="*/15 * * * *"
                  spellCheck={false}
                  autoComplete="off"
                  className={cn(
                    'mt-2.5 h-12 w-full rounded-xl border-white/10 bg-white/5! font-mono text-base tracking-wide text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus-visible:border-teal-400/50 focus-visible:ring-1 focus-visible:ring-teal-400/30',
                    hasCronError &&
                      'border-rose-400/50! focus-visible:border-rose-400/60! focus-visible:ring-rose-400/30!'
                  )}
                />

                {/* presets */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    <Zap className="size-3.5 text-teal-300" aria-hidden /> Presets
                  </span>
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => applyPreset(preset.expr)}
                      className="flex h-11 items-center rounded-xl border border-white/10 bg-white/5 px-3.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {/* live validation */}
                {!exprEmpty && (
                  <div className="mt-3">
                    <div className="grid grid-cols-5 gap-1.5">
                      {FIELDS_SHORT.map(({ field, short }) => {
                        const err = cronFieldErrors.find((e) => e.field === field) ?? null
                        return (
                          <div
                            key={field}
                            title={err ? err.message : undefined}
                            className={cn(
                              'rounded-lg border px-1 py-1.5 text-center',
                              err !== null
                                ? 'border-rose-400/40 bg-rose-400/10'
                                : cronParse.ok
                                  ? 'border-teal-400/25 bg-teal-400/[0.06]'
                                  : 'border-white/10 bg-white/[0.03]'
                            )}
                          >
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                              {short}
                            </div>
                            {err !== null ? (
                              <TriangleAlert className="mx-auto mt-0.5 size-3 text-rose-300" aria-hidden />
                            ) : cronParse.ok ? (
                              <Check className="mx-auto mt-0.5 size-3 text-teal-300" aria-hidden />
                            ) : (
                              <span className="mx-auto mt-0.5 block size-3" />
                            )}
                          </div>
                        )
                      })}
                    </div>
                    {cronMessage !== null && (
                      <p className="mt-2 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-3 py-2 text-xs leading-relaxed text-rose-200">
                        {cronMessage}
                      </p>
                    )}
                    {cronFieldErrors.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {cronFieldErrors.map((fe) => (
                          <p key={fe.field} className="flex items-start gap-1.5 text-xs text-rose-300">
                            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                            <span>
                              <span className="font-semibold">{FIELD_LABELS[fe.field]}</span> — {fe.message}
                            </span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* ---------- field quick picks ---------- */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    <Calendar className="size-3.5" aria-hidden /> Field quick picks
                  </span>
                  <span className="text-[11px] text-zinc-600">tap to fill one field</span>
                </div>
                <div className="mt-2 divide-y divide-white/5">
                  {FIELD_HELPERS.map((helper) => (
                    <div
                      key={helper.field}
                      className="flex flex-col gap-2 py-2.5 first:pt-1 last:pb-0 sm:flex-row sm:items-center"
                    >
                      <div className="w-full shrink-0 sm:w-32">
                        <div className="text-xs font-medium text-zinc-300">{helper.label}</div>
                        <div className="text-[10px] leading-snug text-zinc-600">{helper.hint}</div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {helper.chips.map((chip) => {
                          const active = exprParts.length === 5 && exprParts[FIELD_INDEX[helper.field]] === chip
                          return (
                            <button
                              key={chip}
                              type="button"
                              onClick={() => applyFieldChip(helper.field, chip)}
                              aria-pressed={active}
                              aria-label={`Set ${helper.label} to ${chip}`}
                              className={cn(
                                'flex h-11 items-center rounded-xl border px-3 font-mono text-xs transition-colors',
                                active
                                  ? 'border-teal-400/40 bg-teal-400/10 text-teal-200'
                                  : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
                              )}
                            >
                              {chip}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* ---------- empty state ---------- */}
              {exprEmpty && (
                <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-10 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500/20 to-cyan-500/20 text-teal-300">
                    <CalendarClock className="size-6" aria-hidden />
                  </span>
                  <p className="text-sm font-medium text-zinc-300">No expression yet</p>
                  <p className="text-xs text-zinc-500">
                    Type a cron expression or tap a preset — the next runs appear instantly.
                  </p>
                </div>
              )}

              {/* ---------- description + next runs (valid) ---------- */}
              {cronParse.ok && (
                <>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={cronParse.cron.normalized}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.16, ease: 'easeOut' }}
                      className="rounded-2xl border border-teal-400/25 bg-gradient-to-br from-teal-400/[0.08] to-cyan-400/[0.04] p-4"
                    >
                      <div className="flex items-start gap-2.5">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-teal-300" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold leading-relaxed text-teal-100">
                            {describeCron(cronParse.cron)}
                          </p>
                          {isMacro && (
                            <p className="mt-1 font-mono text-[11px] text-teal-200/60">
                              = {cronParse.cron.normalized}
                            </p>
                          )}
                          {!cronParse.cron.domUnrestricted && !cronParse.cron.dowUnrestricted && (
                            <p className="mt-1 text-[11px] leading-relaxed text-teal-200/60">
                              Day-of-month and day-of-week combine with OR — the standard cron rule.
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  </AnimatePresence>

                  <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        <Clock className="size-3.5" aria-hidden /> Next runs
                      </span>
                      <span className="text-[11px] text-zinc-600">local timezone</span>
                    </div>
                    {nextRunList !== null && nextRunList.length === 0 ? (
                      <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-3.5">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-amber-200">No occurrence within a year</p>
                          <p className="mt-0.5 text-xs leading-relaxed text-amber-200/70">
                            This schedule doesn&apos;t fire in the next 366 days — the day/month combination may be
                            impossible (e.g. February 30th).
                          </p>
                        </div>
                      </div>
                    ) : nextRunList !== null && nextRunList.length > 0 ? (
                      <motion.div
                        key={cronParse.cron.normalized}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                      >
                        <div className={cn('mt-3 max-h-96 space-y-1.5 overflow-y-auto pr-1', THIN_SCROLLBAR)}>
                          {nextRunList.map((run, i) => (
                            <NextRunRow key={i} index={i} run={run} nowMs={now} />
                          ))}
                        </div>
                        {nextRunList.length < 5 && (
                          <p className="mt-2 text-[11px] text-zinc-500">
                            {nextRunList.length} occurrence{nextRunList.length === 1 ? '' : 's'} within the next
                            year.
                          </p>
                        )}
                      </motion.div>
                    ) : null}
                  </section>
                </>
              )}
            </TabsContent>

            {/* ==================== TAB 2 — TIMESTAMP ==================== */}
            <TabsContent value="timestamp" className="mt-4 space-y-4">
              {/* ---------- right now ---------- */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    <Timer className="size-3.5" aria-hidden /> Right now
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <span className="relative flex size-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-60" />
                      <span className="relative inline-flex size-2 rounded-full bg-teal-400" />
                    </span>
                    live
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="font-mono text-4xl font-bold tabular-nums tracking-tight text-teal-300 sm:text-5xl">
                    {epochSeconds}
                  </span>
                  <span className="text-[11px] text-zinc-500">seconds since epoch</span>
                  <Button
                    onClick={copyNowEpoch}
                    className="ml-auto h-11 rounded-xl bg-gradient-to-r from-teal-400 via-cyan-500 to-sky-600 px-4 text-xs font-semibold text-white shadow-lg hover:from-teal-300 hover:via-cyan-400 hover:to-sky-500"
                  >
                    <Copy className="size-4" aria-hidden /> Copy
                  </Button>
                </div>
                <div className="mt-3 space-y-1.5 border-t border-white/5 pt-3">
                  <div className="flex items-center gap-2 text-xs">
                    <Clock className="size-3.5 shrink-0 text-zinc-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-zinc-200">
                      {formatHumanLocal(nowDate)}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">local</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Globe className="size-3.5 shrink-0 text-zinc-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-zinc-400">
                      {formatHumanUTC(nowDate)}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-600">UTC</span>
                  </div>
                </div>
              </section>

              {/* ---------- converter ---------- */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    <ArrowRightLeft className="size-3.5" aria-hidden /> Converter
                  </span>
                  <span className="text-[11px] text-zinc-600">two-way · type to convert</span>
                </div>

                {/* epoch → date */}
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="ts-epoch-in"
                      className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400"
                    >
                      Epoch → date
                    </label>
                    {epochParsed.unit !== null && (
                      <Badge
                        variant="outline"
                        className="border-teal-400/30 bg-teal-400/10 font-mono text-[10px] font-medium text-teal-300"
                      >
                        {epochParsed.unit}
                      </Badge>
                    )}
                  </div>
                  <Input
                    id="ts-epoch-in"
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    value={epochInput}
                    onChange={(e) => setEpochInput(e.target.value)}
                    placeholder="1736935380 · 1736935380000 · -86400"
                    className={cn(
                      'mt-1.5 h-11 w-full rounded-xl border-white/10 bg-white/5! font-mono text-sm text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus-visible:border-teal-400/50 focus-visible:ring-1 focus-visible:ring-teal-400/30',
                      epochParsed.error !== null &&
                        'border-rose-400/50! focus-visible:border-rose-400/60! focus-visible:ring-rose-400/30!'
                    )}
                  />
                  {epochParsed.error !== null && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-300">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {epochParsed.error}
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-zinc-600">
                    ≤ 11 digits → seconds · 12+ digits → milliseconds · negatives = before 1970
                  </p>
                  {epochRows.length > 0 && (
                    <div className="mt-2.5 space-y-1.5">
                      {epochRows.map((row) => (
                        <CopyRow key={row.label} label={row.label} value={row.value} onCopy={copyValue} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="my-4 border-t border-white/5" />

                {/* date → epoch */}
                <div>
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="ts-dt-in"
                      className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400"
                    >
                      Date → epoch
                    </label>
                    <span className="text-[10px] text-zinc-600">your local timezone</span>
                  </div>
                  <div className="mt-1.5 flex gap-2">
                    <Input
                      id="ts-dt-in"
                      type="datetime-local"
                      value={dtInput}
                      onChange={(e) => setDtInput(e.target.value)}
                      className={cn(
                        'h-11 min-w-0 flex-1 rounded-xl border-white/10 bg-white/5! font-mono text-sm text-zinc-100 [color-scheme:dark] focus-visible:border-teal-400/50 focus-visible:ring-1 focus-visible:ring-teal-400/30',
                        dtParsed.error !== null &&
                          'border-rose-400/50! focus-visible:border-rose-400/60! focus-visible:ring-rose-400/30!'
                      )}
                    />
                    <Button
                      variant="outline"
                      onClick={fillDtNow}
                      className="h-11 shrink-0 rounded-xl border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
                    >
                      <Clock className="size-4" aria-hidden /> Now
                    </Button>
                  </div>
                  {dtParsed.error !== null && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-xs text-rose-300">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {dtParsed.error}
                    </p>
                  )}
                  {dtRows.length > 0 && (
                    <div className="mt-2.5 space-y-1.5">
                      {dtRows.map((row) => (
                        <CopyRow key={row.label} label={row.label} value={row.value} onCopy={copyValue} />
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </TabsContent>
          </Tabs>
        </div>
      </motion.div>
    </div>
  )
}
