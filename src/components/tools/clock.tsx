'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Flag, Globe2, Pause, Play, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Shared helpers                                                      */
/* ================================================================== */

const pad2 = (n: number): string => String(n).padStart(2, '0')

function clampInt(raw: string, min: number, max: number): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

/** Three short rising beeps via WebAudio. Created lazily inside the
 *  user-gesture-driven start chain; silently no-ops when unavailable. */
function playBeep(): void {
  try {
    const AudioWindow = window as unknown as {
      AudioContext?: typeof AudioContext
      webkitAudioContext?: typeof AudioContext
    }
    const Ctx = AudioWindow.AudioContext ?? AudioWindow.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const t0 = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t0)
    gain.connect(ctx.destination)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t0)
    osc.connect(gain)
    for (let i = 0; i < 3; i++) {
      const s = t0 + i * 0.28
      gain.gain.setValueAtTime(0, s)
      gain.gain.linearRampToValueAtTime(0.22, s + 0.02)
      gain.gain.setValueAtTime(0.22, s + 0.18)
      gain.gain.linearRampToValueAtTime(0, s + 0.2)
    }
    osc.start(t0)
    osc.stop(t0 + 0.9)
    window.setTimeout(() => {
      void ctx.close()
    }, 1200)
  } catch {
    /* audio unavailable — stay silent */
  }
}

/* ================================================================== */
/* World Clock                                                         */
/* ================================================================== */

interface CityZone {
  city: string
  tz: string
}

const CITIES: CityZone[] = [
  { city: 'New York', tz: 'America/New_York' },
  { city: 'London', tz: 'Europe/London' },
  { city: 'Dubai', tz: 'Asia/Dubai' },
  { city: 'Kolkata', tz: 'Asia/Kolkata' },
  { city: 'Singapore', tz: 'Asia/Singapore' },
  { city: 'Tokyo', tz: 'Asia/Tokyo' },
  { city: 'Sydney', tz: 'Australia/Sydney' },
  { city: 'Los Angeles', tz: 'America/Los_Angeles' },
]

function cityTime(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now)
}

function cityDate(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(now)
}

/** Days between the calendar date in `tz` and the local calendar date. */
function dayOffset(now: Date, tz: string): number {
  const key = (zone?: string): string =>
    new Intl.DateTimeFormat('en-CA', zone ? { timeZone: zone } : undefined).format(now)
  const toUTC = (k: string): number => {
    const [y, m, d] = k.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  return Math.round((toUTC(key(tz)) - toUTC(key())) / 86_400_000)
}

function offsetLabel(offset: number): string | null {
  if (offset === -1) return 'Yesterday'
  if (offset === 1) return 'Tomorrow'
  return null
}

function WorldClockTab() {
  const [now, setNow] = useState<Date>(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const localTime = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const localDate = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-6 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Local time
          </p>
          <p
            className="mt-2 text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl"
            aria-label={`Local time ${localTime}`}
          >
            {localTime}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{localDate}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-muted-foreground" aria-hidden />
            <h3 className="text-sm font-medium text-muted-foreground">World clock</h3>
          </div>
          <ul className="mt-3 max-h-96 divide-y overflow-y-auto">
            {CITIES.map((c) => {
              const offset = dayOffset(now, c.tz)
              const label = offsetLabel(offset)
              return (
                <li
                  key={c.tz}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.city}</p>
                    <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      {cityDate(now, c.tz)}
                      {label !== null && (
                        <Badge
                          variant="outline"
                          className={cn(
                            'h-4 px-1.5 text-[10px] font-medium',
                            offset === 0
                              ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                              : 'text-muted-foreground'
                          )}
                        >
                          {label}
                        </Badge>
                      )}
                    </p>
                  </div>
                  <p className="text-xl font-semibold tabular-nums">
                    {cityTime(now, c.tz)}
                  </p>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}

/* ================================================================== */
/* Stopwatch                                                           */
/* ================================================================== */

interface Lap {
  n: number
  split: number
  total: number
}

function formatStopwatch(ms: number): string {
  const mm = Math.floor(ms / 60_000)
  const ss = Math.floor((ms % 60_000) / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${pad2(mm)}:${pad2(ss)}.${pad2(cs)}`
}

function StopwatchTab() {
  const [running, setRunning] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [laps, setLaps] = useState<Lap[]>([])
  const startAtRef = useRef(0)
  const accumRef = useRef(0)

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      setElapsed(accumRef.current + (performance.now() - startAtRef.current))
    }, 31)
    return () => clearInterval(id)
  }, [running])

  const toggleRun = (): void => {
    if (running) {
      accumRef.current += performance.now() - startAtRef.current
      setElapsed(accumRef.current)
      setRunning(false)
    } else {
      startAtRef.current = performance.now()
      setRunning(true)
    }
  }

  const reset = (): void => {
    accumRef.current = 0
    startAtRef.current = 0
    setRunning(false)
    setElapsed(0)
    setLaps([])
  }

  const addLap = (): void => {
    const total = accumRef.current + (performance.now() - startAtRef.current)
    setLaps((prev) => {
      const prevTotal = prev.length > 0 ? prev[prev.length - 1].total : 0
      return [...prev, { n: prev.length + 1, split: total - prevTotal, total }]
    })
  }

  const { bestIdx, worstIdx } = useMemo(() => {
    if (laps.length < 2) return { bestIdx: -1, worstIdx: -1 }
    let b = 0
    let w = 0
    laps.forEach((l, i) => {
      if (l.split < laps[b].split) b = i
      if (l.split > laps[w].split) w = i
    })
    return { bestIdx: b, worstIdx: w }
  }, [laps])

  const reversedLaps = useMemo(() => [...laps].reverse(), [laps])

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-6 text-center">
          <p
            className="text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl"
            aria-label={`Stopwatch ${formatStopwatch(elapsed)}`}
          >
            {formatStopwatch(elapsed)}
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              className="h-11 w-11 p-0"
              onClick={reset}
              disabled={elapsed === 0 && laps.length === 0}
              aria-label="Reset stopwatch"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant={running ? 'secondary' : 'default'}
              className="h-11 min-w-32 gap-2"
              onClick={toggleRun}
              aria-label={running ? 'Pause stopwatch' : 'Start stopwatch'}
            >
              {running ? (
                <Pause className="h-4 w-4" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              )}
              {running ? 'Pause' : 'Start'}
            </Button>
            <Button
              variant="outline"
              className="h-11 w-11 p-0"
              onClick={addLap}
              disabled={!running}
              aria-label="Record lap"
            >
              <Flag className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </CardContent>
      </Card>

      {laps.length > 0 && (
        <Card>
          <CardContent className="p-4 sm:p-6">
            <h3 className="text-sm font-medium text-muted-foreground">
              Laps ({laps.length})
            </h3>
            <ul className="mt-3 max-h-72 divide-y overflow-y-auto">
              {reversedLaps.map((l) => (
                <li
                  key={l.n}
                  className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-sm font-medium">Lap {l.n}</span>
                    {l.n - 1 === bestIdx && (
                      <Badge
                        variant="outline"
                        className="border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-400"
                      >
                        Fastest
                      </Badge>
                    )}
                    {l.n - 1 === worstIdx && (
                      <Badge
                        variant="outline"
                        className="border-rose-500/40 text-[10px] text-rose-600 dark:text-rose-400"
                      >
                        Slowest
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm tabular-nums">
                    <span
                      className={cn(
                        'w-20 text-right font-medium',
                        l.n - 1 === bestIdx && 'text-emerald-600 dark:text-emerald-400',
                        l.n - 1 === worstIdx && 'text-rose-600 dark:text-rose-400'
                      )}
                    >
                      {formatStopwatch(l.split)}
                    </span>
                    <span className="w-20 text-right text-muted-foreground">
                      {formatStopwatch(l.total)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/* ================================================================== */
/* Timer                                                               */
/* ================================================================== */

const PRESETS = [1, 3, 5, 10, 15, 30]

function formatTimer(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
}

function TimerTab() {
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(5)
  const [seconds, setSeconds] = useState(0)
  const [running, setRunning] = useState(false)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [totalMs, setTotalMs] = useState<number | null>(null)
  const [finished, setFinished] = useState(false)
  const [needsDuration, setNeedsDuration] = useState(false)
  const endAtRef = useRef(0)

  const inputTotalMs = (hours * 3600 + minutes * 60 + seconds) * 1000

  useEffect(() => {
    if (!running) return
    const id = setInterval(() => {
      const rem = endAtRef.current - performance.now()
      if (rem <= 0) {
        setRemaining(0)
        setRunning(false)
        setFinished(true)
        playBeep()
      } else {
        setRemaining(rem)
      }
    }, 100)
    return () => clearInterval(id)
  }, [running])

  const changeInput = (
    setter: (n: number) => void,
    raw: string,
    min: number,
    max: number
  ): void => {
    setter(clampInt(raw, min, max))
    setRemaining(null)
    setTotalMs(null)
    setFinished(false)
    setNeedsDuration(false)
  }

  const applyPreset = (mins: number): void => {
    setHours(0)
    setMinutes(mins)
    setSeconds(0)
    setRemaining(null)
    setTotalMs(null)
    setFinished(false)
    setNeedsDuration(false)
  }

  const toggleRun = (): void => {
    if (running) {
      setRunning(false)
      return
    }
    if (finished) {
      const t = totalMs ?? 0
      if (t <= 0) {
        setNeedsDuration(true)
        return
      }
      endAtRef.current = performance.now() + t
      setRemaining(t)
      setFinished(false)
      setNeedsDuration(false)
      setRunning(true)
      return
    }
    const t = remaining ?? inputTotalMs
    if (t <= 0) {
      setNeedsDuration(true)
      return
    }
    endAtRef.current = performance.now() + t
    if (totalMs === null) setTotalMs(t)
    setFinished(false)
    setNeedsDuration(false)
    setRunning(true)
  }

  const reset = (): void => {
    setRunning(false)
    setRemaining(null)
    setTotalMs(null)
    setFinished(false)
    setNeedsDuration(false)
  }

  const shownMs = remaining ?? inputTotalMs
  const progress =
    totalMs !== null && remaining !== null
      ? Math.min(100, Math.max(0, ((totalMs - remaining) / totalMs) * 100))
      : 0

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="p-6 text-center">
          {finished ? (
            <motion.p
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 18 }}
              className="text-4xl font-semibold tracking-tight text-rose-600 sm:text-5xl dark:text-rose-400"
              role="status"
            >
              Time&apos;s up!
            </motion.p>
          ) : (
            <p
              className={cn(
                'text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl',
                remaining === null && 'text-muted-foreground'
              )}
              aria-label={`Timer ${formatTimer(shownMs)}`}
            >
              {formatTimer(shownMs)}
            </p>
          )}
          <Progress value={progress} className="mx-auto mt-4 h-1.5 max-w-xs" />

          <div className="mt-5 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              className="h-11 w-11 p-0"
              onClick={reset}
              disabled={remaining === null && !finished}
              aria-label="Reset timer"
            >
              <RotateCcw className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant={finished ? 'default' : running ? 'secondary' : 'default'}
              className="h-11 min-w-32 gap-2"
              onClick={toggleRun}
              aria-label={
                finished ? 'Restart timer' : running ? 'Pause timer' : 'Start timer'
              }
            >
              {running ? (
                <Pause className="h-4 w-4" aria-hidden />
              ) : (
                <Play className="h-4 w-4" aria-hidden />
              )}
              {finished ? 'Restart' : running ? 'Pause' : 'Start'}
            </Button>
          </div>

          {needsDuration && (
            <p className="mt-3 text-xs text-rose-600 dark:text-rose-400" role="alert">
              Set a duration above 0 to start the timer.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Quick presets</h3>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Timer presets">
              {PRESETS.map((p) => (
                <Button
                  key={p}
                  variant="secondary"
                  className="h-11 px-4"
                  onClick={() => applyPreset(p)}
                  aria-label={`Set ${p} minute timer`}
                >
                  {p} min
                </Button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Custom duration</h3>
            <div className="mt-2 grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="timer-hours">Hours</Label>
                <Input
                  id="timer-hours"
                  type="number"
                  min={0}
                  max={99}
                  value={hours}
                  onChange={(e) => changeInput(setHours, e.target.value, 0, 99)}
                  className="h-11"
                  aria-label="Timer hours"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="timer-minutes">Minutes</Label>
                <Input
                  id="timer-minutes"
                  type="number"
                  min={0}
                  max={59}
                  value={minutes}
                  onChange={(e) => changeInput(setMinutes, e.target.value, 0, 59)}
                  className="h-11"
                  aria-label="Timer minutes"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="timer-seconds">Seconds</Label>
                <Input
                  id="timer-seconds"
                  type="number"
                  min={0}
                  max={59}
                  value={seconds}
                  onChange={(e) => changeInput(setSeconds, e.target.value, 0, 59)}
                  className="h-11"
                  aria-label="Timer seconds"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* ================================================================== */
/* ClockTool — default export                                          */
/* ================================================================== */

export default function ClockTool() {
  return (
    <Tabs defaultValue="world" className="gap-4">
      <TabsList className="grid h-11 w-full grid-cols-3">
        <TabsTrigger value="world">World Clock</TabsTrigger>
        <TabsTrigger value="stopwatch">Stopwatch</TabsTrigger>
        <TabsTrigger value="timer">Timer</TabsTrigger>
      </TabsList>
      {/* forceMount keeps stopwatch/timer state alive while switching tabs */}
      <TabsContent value="world" forceMount className="mt-2 data-[state=inactive]:hidden">
        <WorldClockTab />
      </TabsContent>
      <TabsContent value="stopwatch" forceMount className="mt-2 data-[state=inactive]:hidden">
        <StopwatchTab />
      </TabsContent>
      <TabsContent value="timer" forceMount className="mt-2 data-[state=inactive]:hidden">
        <TimerTab />
      </TabsContent>
    </Tabs>
  )
}
