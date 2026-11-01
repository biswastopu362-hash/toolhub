'use client'

/**
 * Calendar — month grid with persistent local events, per-day agenda
 * panel, event editor dialog and an upcoming-events strip.
 */

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { Variants } from 'framer-motion'
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type EventColor = 'red' | 'orange' | 'amber' | 'green' | 'teal' | 'violet'

interface CalEvent {
  id: string
  /** 'yyyy-MM-dd' */
  date: string
  /** 'HH:mm' or '' for all-day */
  time: string
  title: string
  color: EventColor
  note?: string
}

const EVENTS_KEY = 'toolhub.calendar.events'
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

const COLOR_DOT: Record<EventColor, string> = {
  red: 'bg-red-500',
  orange: 'bg-orange-500',
  amber: 'bg-amber-500',
  green: 'bg-green-500',
  teal: 'bg-teal-500',
  violet: 'bg-violet-500',
}

const COLOR_SWATCH: EventColor[] = ['red', 'orange', 'amber', 'green', 'teal', 'violet']

function newEventId(): string {
  return `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function seedEvents(): CalEvent[] {
  const today = new Date()
  const iso = (d: Date) => format(d, 'yyyy-MM-dd')
  return [
    {
      id: 'seed-1',
      date: iso(today),
      time: '10:00',
      title: 'Team standup',
      color: 'teal',
      note: 'Daily sync with the product team.',
    },
    {
      id: 'seed-2',
      date: iso(addDays(today, 2)),
      time: '14:30',
      title: 'Design review',
      color: 'violet',
    },
    {
      id: 'seed-3',
      date: iso(addDays(today, 5)),
      time: '',
      title: 'Gym session',
      color: 'green',
      note: 'Leg day.',
    },
  ]
}

/** Hydration-safe lazy read: localStorage read inside a useState initializer. */
function loadEvents(): CalEvent[] {
  if (typeof window === 'undefined') return seedEvents()
  try {
    const raw = window.localStorage.getItem(EVENTS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as CalEvent[]
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    /* corrupted storage — fall through to seeds */
  }
  return seedEvents()
}

const monthVariants: Variants = {
  enter: (d: number) => ({ opacity: 0, x: d >= 0 ? 48 : -48 }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: d >= 0 ? -48 : 48 }),
}

const SCROLLBAR_Y =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border'
const SCROLLBAR_X =
  '[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border'

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function CalendarApp() {
  const { toast } = useToast()

  const [events, setEvents] = useState<CalEvent[]>(loadEvents)
  const [monthDate, setMonthDate] = useState<Date>(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState<Date>(() => new Date())
  const [dir, setDir] = useState(0)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CalEvent | null>(null)
  const [fTitle, setFTitle] = useState('')
  const [fDate, setFDate] = useState('')
  const [fTime, setFTime] = useState('')
  const [fColor, setFColor] = useState<EventColor>('teal')
  const [fNote, setFNote] = useState('')

  /* Persist on every change — also writes the seeds on first run. */
  useEffect(() => {
    try {
      window.localStorage.setItem(EVENTS_KEY, JSON.stringify(events))
    } catch {
      /* storage unavailable */
    }
  }, [events])

  /* ---- derived data ---- */

  const cells = useMemo(() => {
    const start = startOfWeek(startOfMonth(monthDate))
    const end = endOfWeek(endOfMonth(monthDate))
    const list = eachDayOfInterval({ start, end })
    let cursor = list[list.length - 1]
    while (list.length < 42) {
      cursor = addDays(cursor, 1)
      list.push(cursor)
    }
    return list
  }, [monthDate])

  const byDate = useMemo(() => {
    const map = new Map<string, CalEvent[]>()
    for (const ev of events) {
      const arr = map.get(ev.date)
      if (arr) arr.push(ev)
      else map.set(ev.date, [ev])
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'))
    }
    return map
  }, [events])

  const dayEvents = useMemo(() => byDate.get(format(selected, 'yyyy-MM-dd')) ?? [], [byDate, selected])

  const upcoming = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd')
    return events
      .filter((e) => e.date >= todayStr)
      .sort((a, b) => `${a.date}T${a.time || '00:00'}`.localeCompare(`${b.date}T${b.time || '00:00'}`))
      .slice(0, 5)
  }, [events])

  /* ---- navigation ---- */

  const goMonth = (next: Date, direction: 1 | -1) => {
    setDir(direction)
    setMonthDate(next)
  }

  const goToday = () => {
    const t = startOfMonth(new Date())
    setDir(isSameMonth(monthDate, t) ? 0 : monthDate < t ? 1 : -1)
    setMonthDate(t)
    setSelected(new Date())
  }

  const jumpToEventDate = (ev: CalEvent) => {
    const d = parseISO(ev.date)
    setSelected(d)
    if (!isSameMonth(d, monthDate)) {
      setDir(d > monthDate ? 1 : -1)
      setMonthDate(startOfMonth(d))
    }
  }

  /* ---- event CRUD ---- */

  const openAdd = () => {
    setEditing(null)
    setFTitle('')
    setFDate(format(selected, 'yyyy-MM-dd'))
    setFTime('')
    setFColor('teal')
    setFNote('')
    setDialogOpen(true)
  }

  const openEdit = (ev: CalEvent) => {
    setEditing(ev)
    setFTitle(ev.title)
    setFDate(ev.date)
    setFTime(ev.time)
    setFColor(ev.color)
    setFNote(ev.note ?? '')
    setDialogOpen(true)
  }

  const saveEvent = () => {
    const title = fTitle.trim()
    if (!title || !fDate) return
    if (editing) {
      setEvents((prev) =>
        prev.map((e) =>
          e.id === editing.id
            ? { ...e, title, date: fDate, time: fTime, color: fColor, note: fNote.trim() || undefined }
            : e
        )
      )
      toast({ title: 'Event updated', description: title })
    } else {
      setEvents((prev) => [
        ...prev,
        { id: newEventId(), date: fDate, time: fTime, title, color: fColor, note: fNote.trim() || undefined },
      ])
      toast({ title: 'Event added', description: title })
    }
    setDialogOpen(false)
    const d = parseISO(fDate)
    setSelected(d)
    if (!isSameMonth(d, monthDate)) {
      setDir(d > monthDate ? 1 : -1)
      setMonthDate(startOfMonth(d))
    }
  }

  const deleteEvent = (ev: CalEvent) => {
    setEvents((prev) => prev.filter((e) => e.id !== ev.id))
    toast({ title: 'Event deleted', description: ev.title })
  }

  const dotsFor = (d: Date): { evs: CalEvent[]; extra: number } => {
    const evs = byDate.get(format(d, 'yyyy-MM-dd')) ?? []
    return { evs: evs.slice(0, 3), extra: Math.max(0, evs.length - 3) }
  }

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      {/* Header + grid */}
      <Card className="border-border/70 p-4 shadow-lg shadow-black/5 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-orange-400 bg-clip-text text-2xl font-extrabold tracking-tight text-transparent">
              {format(monthDate, 'MMMM yyyy')}
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {events.length} event{events.length === 1 ? '' : 's'} scheduled
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous month"
              onClick={() => goMonth(subMonths(monthDate, 1), -1)}
              className="h-11 w-11 rounded-xl"
            >
              <ChevronLeft className="h-4.5 w-4.5" aria-hidden />
            </Button>
            <Button
              variant="outline"
              onClick={goToday}
              className="h-11 rounded-xl px-4 text-xs font-semibold"
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next month"
              onClick={() => goMonth(addMonths(monthDate, 1), 1)}
              className="h-11 w-11 rounded-xl"
            >
              <ChevronRight className="h-4.5 w-4.5" aria-hidden />
            </Button>
          </div>
        </div>

        {/* Weekday header */}
        <div className="mb-1.5 grid grid-cols-7 gap-1" aria-hidden>
          {WEEKDAYS.map((d) => (
            <span
              key={d}
              className="text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {d}
            </span>
          ))}
        </div>

        {/* Month grid with directional slide */}
        <div className="relative overflow-hidden">
          <AnimatePresence initial={false} mode="popLayout" custom={dir}>
            <motion.div
              key={format(monthDate, 'yyyy-MM')}
              custom={dir}
              variants={monthVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="grid grid-cols-7 gap-1"
            >
              {cells.map((d) => {
                const isSelected = isSameDay(d, selected)
                const { evs, extra } = dotsFor(d)
                return (
                  <button
                    key={d.toISOString()}
                    type="button"
                    onClick={() => setSelected(d)}
                    aria-pressed={isSelected}
                    aria-label={format(d, 'MMMM d, yyyy')}
                    className={cn(
                      'relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl text-sm transition-colors',
                      !isSameMonth(d, monthDate) && 'opacity-40',
                      !isSelected && 'hover:bg-muted',
                      isToday(d) && 'font-bold ring-2 ring-primary',
                      isSelected && 'bg-primary font-semibold text-primary-foreground shadow-md'
                    )}
                  >
                    <span className="leading-none tabular-nums">{format(d, 'd')}</span>
                    <span className="flex h-1.5 items-center gap-[3px]">
                      {evs.map((ev) => (
                        <span
                          key={ev.id}
                          className={cn('h-1.5 w-1.5 rounded-full', COLOR_DOT[ev.color])}
                          aria-hidden
                        />
                      ))}
                      {extra > 0 && (
                        <span className="text-[8px] font-bold leading-none text-muted-foreground">+{extra}</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </motion.div>
          </AnimatePresence>
        </div>
      </Card>

      {/* Selected day agenda */}
      <Card className="border-border/70 shadow-lg shadow-black/5">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold leading-tight tracking-tight">
                {format(selected, 'EEEE')}
              </h3>
              <p className="text-xs text-muted-foreground">{format(selected, 'MMMM d, yyyy')}</p>
            </div>
            <Button
              onClick={openAdd}
              className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-violet-500/25 hover:from-violet-600 hover:to-fuchsia-700"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add event
            </Button>
          </div>

          {dayEvents.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 py-8 text-center">
              <CalendarDays className="h-7 w-7 text-muted-foreground/60" aria-hidden />
              <p className="text-sm text-muted-foreground">No events this day. Enjoy the calm.</p>
            </div>
          ) : (
            <ul className={cn('max-h-56 space-y-1.5 overflow-y-auto pr-1', SCROLLBAR_Y)}>
              {dayEvents.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-2.5"
                >
                  <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', COLOR_DOT[ev.color])} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{ev.title}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {ev.time || 'All day'}
                      {ev.note ? ` · ${ev.note}` : ''}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${ev.title}`}
                    onClick={() => openEdit(ev)}
                    className="h-10 w-10 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${ev.title}`}
                    onClick={() => deleteEvent(ev)}
                    className="h-10 w-10 shrink-0 rounded-lg text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Upcoming strip */}
      {upcoming.length > 0 && (
        <section aria-label="Upcoming events">
          <h3 className="mb-2 px-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Upcoming
          </h3>
          <div className={cn('-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2', SCROLLBAR_X)}>
            {upcoming.map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => jumpToEventDate(ev)}
                className="min-w-[190px] max-w-[220px] shrink-0 snap-start rounded-2xl border border-border/70 bg-card p-3 text-left shadow-sm transition-all hover:scale-[1.02] hover:shadow-md"
              >
                <span className="mb-1.5 flex items-center gap-1.5">
                  <span className={cn('h-2 w-2 rounded-full', COLOR_DOT[ev.color])} aria-hidden />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {format(parseISO(ev.date), 'EEE, MMM d')}
                  </span>
                </span>
                <span className="block truncate text-sm font-semibold">{ev.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {ev.time || 'All day'}
                  {ev.note ? ` · ${ev.note}` : ''}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit event' : 'New event'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update the details of this event.' : 'Add an event to your calendar.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <label htmlFor="cal-title" className="text-xs font-medium text-muted-foreground">
                Title
              </label>
              <Input
                id="cal-title"
                value={fTitle}
                onChange={(e) => setFTitle(e.target.value)}
                placeholder="Event title"
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="cal-date" className="text-xs font-medium text-muted-foreground">
                  Date
                </label>
                <Input id="cal-date" type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="cal-time" className="text-xs font-medium text-muted-foreground">
                  Time <span className="font-normal opacity-60">(optional)</span>
                </label>
                <Input id="cal-time" type="time" value={fTime} onChange={(e) => setFTime(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Color</span>
              <div className="flex items-center gap-2" role="group" aria-label="Event color">
                {COLOR_SWATCH.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`${c} color`}
                    aria-pressed={fColor === c}
                    onClick={() => setFColor(c)}
                    className={cn(
                      'h-9 w-9 rounded-full transition-transform hover:scale-110',
                      COLOR_DOT[c],
                      fColor === c && 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                    )}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cal-note" className="text-xs font-medium text-muted-foreground">
                Note <span className="font-normal opacity-60">(optional)</span>
              </label>
              <Textarea
                id="cal-note"
                rows={2}
                value={fNote}
                onChange={(e) => setFNote(e.target.value)}
                placeholder="Any extra details…"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!fTitle.trim() || !fDate}
              onClick={saveEvent}
              className="bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-violet-500/25 hover:from-violet-600 hover:to-fuchsia-700"
            >
              {editing ? 'Save changes' : 'Add event'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
