'use client'

/**
 * Time Tracker — lightweight project timers that keep running per task.
 *
 * Add tasks, start/stop them (starting one pauses the others), reset or
 * delete any of them. Totals persist in localStorage so a reload never
 * loses the clock — everything stays on-device.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Pause, Play, Plus, RotateCcw, Timer as TimerIcon, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

interface TrackTask {
  id: string
  name: string
  /** accumulated ms while paused */
  totalMs: number
  /** epoch ms when the task was started — null while paused */
  runningSince: number | null
  color?: string
}

const LS_KEY = 'toolhub-timetracker'

const TASK_COLORS = ['#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444']

function newId(): string {
  return `tt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function loadTasks(): TrackTask[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (t): t is TrackTask =>
          !!t &&
          typeof (t as TrackTask).id === 'string' &&
          typeof (t as TrackTask).name === 'string'
      )
      .map((t) => ({
        id: t.id,
        name: t.name,
        totalMs: typeof t.totalMs === 'number' && isFinite(t.totalMs) ? t.totalMs : 0,
        /* a task that was running when the app closed is resumed into paused state */
        runningSince: null,
      }))
  } catch {
    return []
  }
}

function fmtDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function TimeTrackerTool() {
  const { toast } = useToast()
  const [tasks, setTasks] = useState<TrackTask[]>(loadTasks) // lazy init — safe (ssr:false)
  const [draft, setDraft] = useState<string>('')
  const [, setTick] = useState(0)
  const tickerRef = useRef<number | null>(null)

  /* persist */
  useEffect(() => {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(tasks))
    } catch {
      /* private mode */
    }
  }, [tasks])

  /* 1s re-render while anything runs — the math itself reads live clocks */
  const anyRunning = tasks.some((t) => t.runningSince !== null)
  useEffect(() => {
    if (!anyRunning) return
    tickerRef.current = window.setInterval(() => setTick((n) => n + 1), 1000)
    return () => {
      if (tickerRef.current !== null) window.clearInterval(tickerRef.current)
    }
  }, [anyRunning])

  const elapsedOf = (t: TrackTask): number =>
    t.totalMs + (t.runningSince !== null ? Date.now() - t.runningSince : 0)

  const totalAll = useMemo(() => tasks.reduce((a, t) => a + elapsedOf(t), 0), [tasks])

  const toggle = useCallback(
    (id: string): void => {
      setTasks((prev) => {
        const now = Date.now()
        return prev.map((t) => {
          if (t.id === id) {
            if (t.runningSince !== null) {
              /* pause: bank the time */
              return { ...t, totalMs: t.totalMs + (now - t.runningSince), runningSince: null }
            }
            return { ...t, runningSince: now }
          }
          /* starting one pauses the others */
          if (t.runningSince !== null) {
            return { ...t, totalMs: t.totalMs + (now - t.runningSince), runningSince: null }
          }
          return t
        })
      })
    },
    []
  )

  const reset = (id: string): void => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, totalMs: 0, runningSince: null } : t))
    )
  }

  const remove = (id: string): void => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }

  const add = (): void => {
    const name = draft.trim()
    if (!name) return
    setTasks((prev) => [
      ...prev,
      {
        id: newId(),
        name,
        totalMs: 0,
        runningSince: null,
        color: TASK_COLORS[prev.length % TASK_COLORS.length],
      },
    ])
    setDraft('')
    toast({ title: 'Task added', description: name })
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* ---------------- Header ---------------- */}
      <Card className="border-border/70 p-4 shadow-lg shadow-black/5 sm:p-5">
        <div className="flex items-center gap-4">
          <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-400 via-teal-500 to-emerald-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(20_184_166/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
            <TimerIcon className="size-7" strokeWidth={1.9} aria-hidden />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight">Time Tracker</h2>
            <p className="text-xs text-muted-foreground">
              {tasks.length} task{tasks.length === 1 ? '' : 's'} · {tasks.filter((t) => t.runningSince !== null).length} running
            </p>
          </div>
          <div className="shrink-0 rounded-xl border border-border/60 bg-muted/30 px-3.5 py-2 text-right">
            <p className="font-mono text-sm font-black tabular-nums">{fmtDuration(totalAll)}</p>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">All tasks</p>
          </div>
        </div>

        {/* add row */}
        <div className="mt-4 flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
            placeholder="New task or project…"
            aria-label="New task name"
            className="h-11 rounded-xl"
          />
          <Button
            onClick={add}
            disabled={!draft.trim()}
            className="h-11 shrink-0 gap-1.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/25 hover:from-teal-600 hover:to-emerald-700"
          >
            <Plus className="size-4" aria-hidden /> Add
          </Button>
        </div>
      </Card>

      {/* ---------------- Task list ---------------- */}
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
          <TimerIcon className="size-9 text-muted-foreground/50" aria-hidden />
          <p className="text-sm font-semibold">No tasks yet</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Add a task above and press play — starting one task pauses the others, so the total always adds up.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => {
            const running = t.runningSince !== null
            const color = t.color ?? TASK_COLORS[0]
            return (
              <Card key={t.id} className="border-border/70 shadow-md shadow-black/5 transition-shadow hover:shadow-lg">
                <CardContent className="flex items-center gap-3 p-3.5">
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{t.name}</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {running ? 'Running' : t.totalMs > 0 ? 'Paused' : 'Ready'}
                    </p>
                  </div>
                  <p
                    className={cn(
                      'shrink-0 font-mono text-lg font-black tabular-nums',
                      running ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'
                    )}
                    aria-label={`Elapsed ${fmtDuration(elapsedOf(t))}`}
                  >
                    {fmtDuration(elapsedOf(t))}
                  </p>
                  <button
                    onClick={() => toggle(t.id)}
                    aria-label={running ? `Pause ${t.name}` : `Start ${t.name}`}
                    aria-pressed={running}
                    className={cn(
                      'flex size-12 shrink-0 items-center justify-center rounded-2xl transition-colors',
                      running
                        ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25'
                        : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25'
                    )}
                  >
                    {running ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
                  </button>
                  <button
                    onClick={() => reset(t.id)}
                    disabled={elapsedOf(t) === 0}
                    aria-label={`Reset ${t.name}`}
                    className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-border/60 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RotateCcw className="size-4.5" aria-hidden />
                  </button>
                  <button
                    onClick={() => remove(t.id)}
                    aria-label={`Delete ${t.name}`}
                    className="flex size-12 shrink-0 items-center justify-center rounded-2xl text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="size-4.5" aria-hidden />
                  </button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
