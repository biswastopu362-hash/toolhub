'use client'

import { useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import {
  CalendarDays,
  CalendarClock,
  Clock,
  Gift,
  Hourglass,
  PartyPopper,
  Timer,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Date helpers — calendar-accurate age math (no external lib)         */
/* ================================================================== */

const EN_WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

function toDateInput(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseDate(s: string): Date | null {
  if (!s) return null
  const parts = s.split('-').map(Number)
  if (parts.length !== 3) return null
  const [y, m, d] = parts
  if (!y || !m || !d) return null
  const date = new Date(y, m - 1, d)
  // reject rollovers like 2023-02-31
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return date
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate()
}

/** Add months to a date, clamping the day (Jan 31 + 1 month → Feb 28/29) */
function addMonthsClamped(base: Date, months: number): Date {
  const total = base.getMonth() + months
  const y = base.getFullYear() + Math.floor(total / 12)
  const m = ((total % 12) + 12) % 12
  const d = Math.min(base.getDate(), daysInMonth(y, m))
  return new Date(y, m, d)
}

/** Whole-day difference (UTC-normalised, DST-safe) */
function dayDiff(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((b - a) / 86_400_000)
}

interface AgeBreakdown {
  years: number
  months: number
  days: number
  totalMonths: number
  totalDays: number
  totalWeeks: number
  totalHours: number
  totalMinutes: number
}

/** Exact Y/M/D: count full calendar years/months by walking month anchors */
function computeAge(birth: Date, target: Date): AgeBreakdown {
  let years = target.getFullYear() - birth.getFullYear()
  while (years > 0 && addMonthsClamped(birth, 12 * years).getTime() > target.getTime()) years--
  let months = 11
  while (months > 0 && addMonthsClamped(birth, 12 * years + months).getTime() > target.getTime()) {
    months--
  }
  const anchor = addMonthsClamped(birth, 12 * years + months)
  const days = Math.max(0, dayDiff(anchor, target))
  const totalDays = Math.max(0, dayDiff(birth, target))
  return {
    years,
    months,
    days,
    totalMonths: years * 12 + months,
    totalDays,
    totalWeeks: Math.floor(totalDays / 7),
    totalHours: totalDays * 24,
    totalMinutes: totalDays * 1440,
  }
}

function nextBirthday(birth: Date, target: Date): { date: Date; until: number } {
  const build = (y: number) =>
    new Date(y, birth.getMonth(), Math.min(birth.getDate(), daysInMonth(y, birth.getMonth())))
  let candidate = build(target.getFullYear())
  if (dayDiff(target, candidate) < 0) {
    candidate = build(target.getFullYear() + 1)
  }
  return { date: candidate, until: dayDiff(target, candidate) }
}

/* ================================================================== */
/* UI                                                                  */
/* ================================================================== */

interface StatItem {
  label: string
  value: string
  icon: ComponentType<{ className?: string }>
}

export default function AgeCalculatorTool() {
  // client-only component (dynamic import, ssr:false) — safe to touch Date
  const [birth, setBirth] = useState('')
  const [target, setTarget] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return toDateInput(new Date())
  })

  const birthDate = useMemo(() => parseDate(birth), [birth])
  const targetDate = useMemo(() => parseDate(target), [target])

  const invalidRange =
    birthDate !== null && targetDate !== null && birthDate.getTime() > targetDate.getTime()

  const age = useMemo(
    () => (birthDate && targetDate && !invalidRange ? computeAge(birthDate, targetDate) : null),
    [birthDate, targetDate, invalidRange]
  )

  const birthday = useMemo(
    () => (birthDate && targetDate && !invalidRange ? nextBirthday(birthDate, targetDate) : null),
    [birthDate, targetDate, invalidRange]
  )

  const stats: StatItem[] = age
    ? [
        { label: 'Total months', value: age.totalMonths.toLocaleString('en-US'), icon: CalendarDays },
        { label: 'Total weeks', value: age.totalWeeks.toLocaleString('en-US'), icon: CalendarClock },
        { label: 'Total days', value: age.totalDays.toLocaleString('en-US'), icon: Hourglass },
        { label: 'Total hours', value: age.totalHours.toLocaleString('en-US'), icon: Clock },
        { label: 'Total minutes', value: age.totalMinutes.toLocaleString('en-US'), icon: Timer },
      ]
    : []

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {/* Inputs */}
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="space-y-2">
            <Label htmlFor="birth-date" className="text-sm font-medium">
              Date of birth
            </Label>
            <Input
              id="birth-date"
              type="date"
              value={birth}
              max={target || undefined}
              onChange={(e) => setBirth(e.target.value)}
              aria-label="Select date of birth"
              className="h-11 text-base"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="target-date" className="text-sm font-medium">
                Age at date
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1 px-2 text-xs text-muted-foreground"
                onClick={() => setTarget(toDateInput(new Date()))}
                aria-label="Set target date to today"
              >
                <CalendarClock className="h-3.5 w-3.5" />
                Today
              </Button>
            </div>
            <Input
              id="target-date"
              type="date"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              aria-label="Select target date"
              className="h-11 text-base"
            />
          </div>
        </CardContent>
      </Card>

      {/* Validation */}
      {invalidRange && (
        <Alert variant="destructive">
          <CalendarDays className="h-4 w-4" />
          <AlertTitle>Date of birth cannot be in the future</AlertTitle>
          <AlertDescription>
            <p>Date of birth must be on or before the target date.</p>
          </AlertDescription>
        </Alert>
      )}

      {/* Empty state */}
      {!birthDate && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
            <p className="text-sm font-medium">Select a date of birth</p>
            <p className="text-xs text-muted-foreground">
              Your age and next-birthday details will appear here as soon as you pick a date of birth
            </p>
          </CardContent>
        </Card>
      )}

      {age && !invalidRange && (
        <>
          {/* Big highlight */}
          <Card className="overflow-hidden border-0 shadow-md">
            <div className="bg-primary p-5 text-primary-foreground sm:p-6">
              <p className="text-sm font-medium text-white/80">Your age</p>
              <p
                className="mt-1 text-2xl font-bold leading-snug sm:text-3xl"
                aria-live="polite"
                aria-label={`Age: ${age.years} years ${age.months} months ${age.days} days`}
              >
                {age.years} years {age.months} months {age.days} days
              </p>
            </div>
          </Card>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {stats.map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <s.icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="text-xs font-medium">{s.label}</span>
                  </div>
                  <p className="mt-1.5 text-xl font-bold tracking-tight">{s.value}</p>
                </CardContent>
              </Card>
            ))}
            {/* Birthday card fills the 6th grid cell on desktop */}
            {birthday && (
              <Card
                className={cn(
                  birthday.until === 0 && 'border-amber-400/60 bg-amber-50 dark:bg-amber-950/30'
                )}
              >
                <CardContent className="flex h-full flex-col justify-center p-4 text-center">
                  {birthday.until === 0 ? (
                    <>
                      <PartyPopper className="mx-auto h-5 w-5 text-amber-600" aria-hidden="true" />
                      <p className="mt-1.5 text-sm font-bold text-amber-700 dark:text-amber-400">
                        Happy Birthday! 🎂
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Today is your birthday
                      </p>
                    </>
                  ) : (
                    <>
                      <Gift className="mx-auto h-5 w-5 text-primary" aria-hidden="true" />
                      <p className="mt-1.5 text-xl font-bold">{birthday.until} days</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Next birthday • {EN_WEEKDAYS[birthday.date.getDay()]}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Next birthday detail line */}
          {birthday && birthday.until > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline" className="gap-1.5 px-2.5 py-1">
                <Gift className="h-3.5 w-3.5" aria-hidden="true" />
                Next birthday
              </Badge>
              <span>
                {birthday.until} days to go — falls on{' '}
                <strong className="font-semibold text-foreground">
                  {EN_WEEKDAYS[birthday.date.getDay()]}
                </strong>{' '}
                ({birthday.date.getFullYear()})
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
