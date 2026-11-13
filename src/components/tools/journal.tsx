'use client'

/**
 * Journal — one entry per day with a mood, streaks and history.
 *
 * Pick how the day felt, write a few lines, keep the chain going. The
 * 14-day strip shows the streak at a glance, a 30-day mood ribbon paints
 * the bigger picture, and search finds any past entry. Everything stays
 * in localStorage — private by design.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { BookHeart, Flame, Search, SearchX, Sparkles, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { formatDateLang } from '@/lib/i18n'
import { useLang } from '@/hooks/use-lang'

const SCROLLBAR_Y =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

interface JournalEntry {
  /** 'yyyy-MM-dd' — the entry's day (one entry per day) */
  date: string
  /** 1..5 (awful → great) */
  mood: number
  text: string
  updatedAt: number
}

const LS_KEY = 'toolhub-journal'

interface MoodMeta {
  label: string
  color: string
  soft: string
}

const MOODS: MoodMeta[] = [
  { label: 'Terrible', color: '#f43f5e', soft: 'bg-rose-500/15 text-rose-600 dark:text-rose-300' },
  { label: 'Bad', color: '#f97316', soft: 'bg-orange-500/15 text-orange-600 dark:text-orange-300' },
  { label: 'Okay', color: '#eab308', soft: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-300' },
  { label: 'Good', color: '#84cc16', soft: 'bg-lime-500/15 text-lime-600 dark:text-lime-300' },
  { label: 'Great', color: '#10b981', soft: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' },
]

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function isoShift(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y ?? 2026, (m ?? 1) - 1, (d ?? 1) + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function loadEntries(): JournalEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is JournalEntry =>
        !!e &&
        typeof (e as JournalEntry).date === 'string' &&
        typeof (e as JournalEntry).text === 'string'
    )
  } catch {
    return []
  }
}

/* streak helpers */

function computeStreaks(entries: JournalEntry[], today: string): { current: number; longest: number } {
  const dates = new Set(entries.map((e) => e.date))
  if (dates.size === 0) return { current: 0, longest: 0 }
  /* current: walk back from today (or yesterday if today not written yet) */
  let current = 0
  let cursor = dates.has(today) ? today : isoShift(today, -1)
  while (dates.has(cursor)) {
    current++
    cursor = isoShift(cursor, -1)
  }
  /* longest: scan sorted dates */
  const sorted = [...dates].sort()
  let longest = 0
  let run = 0
  let prev = ''
  for (const d of sorted) {
    run = prev && isoShift(prev, 1) === d ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = d
  }
  return { current, longest }
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function JournalTool() {
  const { toast } = useToast()
  const { lang } = useLang()
  const [entries, setEntries] = useState<JournalEntry[]>(loadEntries) // lazy init — safe (ssr:false)
  const [editDate, setEditDate] = useState<string>(todayIso)
  const [mood, setMood] = useState<number>(0)
  const [text, setText] = useState<string>('')
  const [query, setQuery] = useState<string>('')

  const today = todayIso()

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(entries))
    } catch {
      /* private mode */
    }
  }, [entries])

  /* reset the editor fields when the target date changes — the React-documented
     "adjust state during render" pattern (no effect, no cascading renders) */
  const [prevEditDate, setPrevEditDate] = useState(editDate)
  if (prevEditDate !== editDate) {
    setPrevEditDate(editDate)
    const existing = entries.find((e) => e.date === editDate)
    setMood(existing?.mood ?? 0)
    setText(existing?.text ?? '')
  }

  const streaks = useMemo(() => computeStreaks(entries, today), [entries, today])
  const avgMood = useMemo(() => {
    if (entries.length === 0) return null
    return entries.reduce((a, e) => a + e.mood, 0) / entries.length
  }, [entries])

  /* last 14 days strip */
  const strip = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const date = isoShift(today, i - 13)
      const e = entries.find((x) => x.date === date)
      return { date, entry: e ?? null, isToday: date === today }
    })
  }, [entries, today])

  /* 30-day mood ribbon */
  const ribbon = useMemo(() => {
    return Array.from({ length: 30 }, (_, i) => {
      const date = isoShift(today, i - 29)
      const e = entries.find((x) => x.date === date)
      return { date, mood: e?.mood ?? 0 }
    })
  }, [entries, today])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = [...entries].sort((a, b) => b.date.localeCompare(a.date))
    if (!q) return list
    return list.filter((e) => e.text.toLowerCase().includes(q) || e.date.includes(q))
  }, [entries, query])

  const canSave = mood > 0 || text.trim().length > 0

  const save = (): void => {
    if (!canSave) return
    const entry: JournalEntry = {
      date: editDate,
      mood: Math.max(mood, 1),
      text: text.trim(),
      updatedAt: Date.now(),
    }
    setEntries((prev) => [...prev.filter((e) => e.date !== editDate), entry])
    toast({
      title: editDate === today ? 'Today saved' : 'Entry saved',
      description: `${MOODS[entry.mood - 1]?.label ?? ''} · ${entry.text.slice(0, 48)}${entry.text.length > 48 ? '…' : ''}`,
    })
  }

  const removeEntry = (date: string): void => {
    setEntries((prev) => prev.filter((e) => e.date !== date))
    if (date === editDate) {
      setMood(0)
      setText('')
    }
    toast({ title: 'Entry deleted' })
  }

  const editLabel =
    editDate === today
      ? 'Today'
      : editDate === isoShift(today, -1)
        ? 'Yesterday'
        : formatDateLang(new Date(`${editDate}T12:00:00`).getTime(), lang, 'medium')

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* ---------------- Header + streak ---------------- */}
      <Card className="border-border/70 p-4 shadow-lg shadow-black/5 sm:p-5">
        <div className="flex items-center gap-4">
          <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-rose-400 via-pink-500 to-fuchsia-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(236_72_153/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
            <BookHeart className="size-7" strokeWidth={1.9} aria-hidden />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight">Journal</h2>
            <p className="text-xs text-muted-foreground">
              {entries.length} entr{entries.length === 1 ? 'y' : 'ies'} · {streaks.current}-day streak
            </p>
          </div>
          <div
            className={cn(
              'flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-black',
              streaks.current > 0 ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/25' : 'bg-muted/50 text-muted-foreground'
            )}
            aria-label={`${streaks.current} day streak`}
          >
            <Flame className={cn('size-4.5', streaks.current > 0 && 'text-yellow-200')} aria-hidden />
            {streaks.current}
          </div>
        </div>

        {/* 14-day strip */}
        <div className="mt-4 flex items-center justify-between gap-1" aria-label="Last 14 days">
          {strip.map((d) => (
            <div key={d.date} className="flex flex-col items-center gap-1">
              <button
                onClick={() => {
                  setEditDate(d.date)
                }}
                aria-label={`Edit ${d.date}${d.entry ? '' : ' (empty)'}`}
                className={cn(
                  'size-6 rounded-full border transition-transform hover:scale-110',
                  d.entry ? 'border-transparent' : 'border-border bg-muted/40',
                  d.isToday && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                )}
                style={d.entry ? { backgroundColor: MOODS[d.entry.mood - 1]?.color } : undefined}
              />
              <span className="text-[8px] font-semibold text-muted-foreground">
                {d.date.slice(8)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* ---------------- Editor ---------------- */}
      <Card className="border-border/70 shadow-lg shadow-black/5">
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-bold tracking-tight">{editLabel}</h3>
            {editDate !== today && (
              <Button variant="ghost" size="sm" onClick={() => setEditDate(today)} className="h-9 rounded-lg text-xs">
                Back to today
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Mood">
            {MOODS.map((m, i) => (
              <button
                key={m.label}
                role="radio"
                aria-checked={mood === i + 1}
                onClick={() => setMood(i + 1)}
                className={cn(
                  'flex h-11 items-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-all',
                  mood === i + 1 ? `${m.soft} border-transparent scale-[1.03]` : 'border-border text-muted-foreground hover:bg-muted/40'
                )}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: m.color }} aria-hidden />
                {m.label}
              </button>
            ))}
          </div>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="How was the day? What mattered?"
            aria-label="Journal entry text"
            className="resize-y rounded-xl"
          />

          <div className="flex items-center justify-between gap-2">
            {editDate !== today && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => removeEntry(editDate)}
                className="h-10 gap-1.5 rounded-xl border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-4" aria-hidden /> Delete entry
              </Button>
            )}
            <div className="flex-1" />
            <Button
              onClick={save}
              disabled={!canSave}
              className="h-11 gap-1.5 rounded-xl bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-lg shadow-rose-500/25 hover:from-rose-600 hover:to-pink-700"
            >
              <Sparkles className="size-4" aria-hidden /> Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- Stats + mood ribbon ---------------- */}
      <Card className="border-border/70 p-4 shadow-lg shadow-black/5 sm:p-5">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xl font-black tracking-tight">{streaks.current}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Current streak</p>
          </div>
          <div>
            <p className="text-xl font-black tracking-tight">{streaks.longest}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Longest streak</p>
          </div>
          <div>
            <p className="text-xl font-black tracking-tight">{avgMood ? avgMood.toFixed(1) : '—'}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Avg mood</p>
          </div>
        </div>
        <div className="mt-4" aria-label="Mood over the last 30 days">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Last 30 days</p>
          <div className="flex h-8 items-end gap-[3px]">
            {ribbon.map((r) => (
              <div
                key={r.date}
                title={r.mood ? `${r.date} · ${MOODS[r.mood - 1]?.label}` : `${r.date} · no entry`}
                className={cn('min-w-[3px] flex-1 rounded-t-sm', r.mood ? '' : 'bg-muted/60')}
                style={r.mood ? { backgroundColor: MOODS[r.mood - 1]?.color, height: `${35 + (r.mood - 1) * 16}%` } : { height: '35%' }}
              />
            ))}
          </div>
        </div>
      </Card>

      {/* ---------------- History ---------------- */}
      <Card className="border-border/70 shadow-lg shadow-black/5">
        <CardContent className="space-y-3 p-4 sm:p-5">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search entries…"
              aria-label="Search entries"
              className="h-11 rounded-xl pl-10"
            />
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 py-8 text-center">
              {entries.length === 0 ? (
                <>
                  <BookHeart className="size-7 text-muted-foreground/50" aria-hidden />
                  <p className="text-sm font-semibold">No entries yet</p>
                  <p className="max-w-xs text-xs text-muted-foreground">
                    Write today&apos;s entry above — pick a mood first, then tap Save to start the streak.
                  </p>
                </>
              ) : (
                <>
                  <SearchX className="size-7 text-muted-foreground/50" aria-hidden />
                  <p className="text-sm font-semibold">No entries match “{query.trim()}”</p>
                </>
              )}
            </div>
          ) : (
            <ul className={cn('max-h-80 space-y-1.5 overflow-y-auto pr-1', SCROLLBAR_Y)}>
              {filtered.map((e) => (
                <li key={e.date}>
                  <button
                    onClick={() => setEditDate(e.date)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                  >
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: MOODS[e.mood - 1]?.color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold">
                        {formatDateLang(new Date(`${e.date}T12:00:00`).getTime(), lang, 'medium')}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {MOODS[e.mood - 1]?.label} · {e.text.slice(0, 60) || 'No text'}
                        {e.text.length > 60 ? '…' : ''}
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
                      {e.mood}/5
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
