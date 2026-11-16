'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  Bug,
  CircleCheck,
  HeartPulse,
  ShieldAlert,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { tools } from '@/lib/tools/registry'
import { useExternalApps } from '@/lib/tools/external'
import {
  clearErrorHistory,
  getAppErrorStats,
  getDailyErrors,
  getLastSession,
  getSessionHealth,
  type AppErrorStat,
  type DailyErrors,
  type SessionSummary,
} from '@/lib/crash-telemetry'

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function nameOf(
  id: string,
  registryNames: Map<string, string>,
  externalNames: Map<string, string>
): string {
  if (id === 'system') return 'OS shell · system'
  return registryNames.get(id) ?? externalNames.get(id) ?? id
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hrs = Math.round(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

function uptimeLabel(startedAt: number, now: number): string {
  const min = Math.max(0, Math.floor((now - startedAt) / 60_000))
  if (min < 60) return `${min} min`
  const hrs = Math.floor(min / 60)
  return `${hrs}h ${min % 60}m`
}

/**
 * CrashTelemetryPanel — P9-W5. Lives in the Admin Console under the
 * Diagnostics Center. Shows the live session health score, a 14-day
 * crash/error trend chart and the per-app offender list — all read from
 * the local `toolhub.crashes.v1` store (never uploaded).
 */
export function CrashTelemetryPanel() {
  const { toast } = useToast()
  const extApps = useExternalApps((s) => s.apps)
  const [health, setHealth] = useState(() => getSessionHealth())
  const [daily, setDaily] = useState<DailyErrors[]>(() => getDailyErrors(14))
  const [offenders, setOffenders] = useState<AppErrorStat[]>(() => getAppErrorStats())
  const [lastSession, setLastSession] = useState<SessionSummary | null>(() => getLastSession())
  const [now, setNow] = useState(() => Date.now())

  /* light poll keeps uptime + fresh crashes visible while the console is open */
  useEffect(() => {
    const refresh = () => {
      setHealth(getSessionHealth())
      setDaily(getDailyErrors(14))
      setOffenders(getAppErrorStats())
      setLastSession(getLastSession())
      setNow(Date.now())
    }
    const t = setInterval(refresh, 15_000)
    return () => clearInterval(t)
  }, [])

  const registryNames = new Map(tools.map((t) => [t.id, t.name]))
  const externalNames = new Map(extApps.map((a) => [a.id, a.name]))

  const total14 = daily.reduce((acc, d) => acc + d.crashes + d.errors, 0)
  const maxDaily = Math.max(...daily.map((d) => d.crashes + d.errors), 1)
  const crashes14 = daily.reduce((acc, d) => acc + d.crashes, 0)
  const errors14 = daily.reduce((acc, d) => acc + d.errors, 0)
  const pristine = total14 === 0

  const scoreTone =
    health.score >= 90
      ? 'text-emerald-400 ring-emerald-400/30 bg-emerald-400/10'
      : health.score >= 60
        ? 'text-amber-400 ring-amber-400/30 bg-amber-400/10'
        : 'text-rose-400 ring-rose-400/30 bg-rose-400/10'

  const clearHistory = useCallback(() => {
    clearErrorHistory()
    setDaily(getDailyErrors(14))
    setOffenders(getAppErrorStats())
    setLastSession(getLastSession())
    toast({ title: 'History cleared', description: 'Recorded crashes and errors were wiped.' })
  }, [toast])

  return (
    <section
      aria-label="Crash and error telemetry"
      className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm"
    >
      {/* header */}
      <div className="flex items-start gap-3 border-b border-border/60 bg-gradient-to-r from-rose-950/70 via-slate-900 to-stone-950 p-4 text-white">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20">
          <HeartPulse className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/55">
            Fortify · P9-W5
          </p>
          <h2 className="text-base font-extrabold tracking-tight">Crash &amp; Error Telemetry</h2>
          <p className="mt-0.5 text-xs text-white/65">
            Live session health, 14-day trend and per-app error counts — local-only, never uploaded.
          </p>
        </div>
        <span
          className={cn(
            'grid shrink-0 place-items-center rounded-full px-3 py-1.5 text-sm font-extrabold tabular-nums ring-1',
            scoreTone
          )}
          title="Session health score"
        >
          {health.score}
          <span className="sr-only"> session health score out of 100</span>
        </span>
      </div>

      <div className="space-y-4 p-4">
        {/* session strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-2xl border border-border/50 bg-background/60 p-2.5">
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <Activity className="size-3" aria-hidden /> Uptime
            </p>
            <p className="mt-0.5 text-sm font-extrabold tabular-nums">
              {uptimeLabel(health.startedAt, now)}
            </p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/60 p-2.5">
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <ShieldAlert className="size-3 text-rose-500" aria-hidden /> Crashes
            </p>
            <p className="mt-0.5 text-sm font-extrabold tabular-nums">{health.crashes}</p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/60 p-2.5">
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <Bug className="size-3 text-amber-500" aria-hidden /> Errors
            </p>
            <p className="mt-0.5 text-sm font-extrabold tabular-nums">{health.errors}</p>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/60 p-2.5">
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <CircleCheck className="size-3 text-emerald-500" aria-hidden /> Last session
            </p>
            <p className="mt-0.5 text-sm font-extrabold tabular-nums">
              {lastSession ? lastSession.score : '—'}
            </p>
          </div>
        </div>

        {/* 14-day trend */}
        <div>
          <p className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            <span className="flex items-center gap-1">
              <TriangleAlert className="size-3" aria-hidden /> Errors · last 14 days
            </span>
            <span className="normal-case text-foreground/70">
              {pristine
                ? 'all clear'
                : `${crashes14} crash${crashes14 === 1 ? '' : 'es'} · ${errors14} error${errors14 === 1 ? '' : 's'}`}
            </span>
          </p>
          <div
            className="mt-2 flex h-14 items-end gap-1"
            role="img"
            aria-label="Crashes and errors per day, last 14 days"
          >
            {daily.map((d) => {
              const total = d.crashes + d.errors
              const crashH = total > 0 ? (d.crashes / maxDaily) * 100 : 0
              const errH = total > 0 ? (d.errors / maxDaily) * 100 : 0
              return (
                <div
                  key={d.date}
                  title={`${d.label}: ${d.crashes} crash${d.crashes === 1 ? '' : 'es'}, ${d.errors} error${d.errors === 1 ? '' : 's'}`}
                  className="flex h-full flex-1 flex-col justify-end"
                >
                  {total > 0 ? (
                    <>
                      {d.errors > 0 && (
                        <div
                          className="w-full rounded-t-[3px] bg-gradient-to-t from-amber-500 to-amber-400"
                          style={{ height: `${Math.max(errH, 4)}%` }}
                        />
                      )}
                      {d.crashes > 0 && (
                        <div
                          className={cn(
                            'w-full bg-gradient-to-t from-rose-600 to-rose-400',
                            d.errors === 0 && 'rounded-t-[3px]'
                          )}
                          style={{ height: `${Math.max(crashH, 4)}%` }}
                        />
                      )}
                    </>
                  ) : (
                    <div className="h-[3px] w-full rounded-full bg-muted" />
                  )}
                </div>
              )
            })}
          </div>
          <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-[3px] bg-gradient-to-t from-rose-600 to-rose-400" />
              app crashes
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-[3px] bg-gradient-to-t from-amber-500 to-amber-400" />
              script errors
            </span>
            <span className="ml-auto">Oldest → today</span>
          </div>
        </div>

        {/* per-app offenders */}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            Per-app error counts · 30-day window
          </p>
          {offenders.length === 0 ? (
            <div className="mt-2 flex items-center gap-2.5 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3">
              <CircleCheck className="size-5 shrink-0 text-emerald-500" aria-hidden />
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                Zero crashes and zero script errors in 30 days — pristine.
              </p>
            </div>
          ) : (
            <ul className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-0.5 scrollbar-thin">
              {offenders.map((s) => (
                <li
                  key={s.id}
                  className="rounded-2xl border border-border/50 bg-background/60 p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-xs font-bold">
                      {nameOf(s.id, registryNames, externalNames)}
                    </p>
                    {s.crashes > 0 && (
                      <span
                        className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] font-extrabold tabular-nums text-rose-600 ring-1 ring-rose-500/25 dark:text-rose-400"
                        title={`${s.crashes} app crash${s.crashes === 1 ? '' : 'es'}`}
                      >
                        {s.crashes} crash{s.crashes === 1 ? '' : 'es'}
                      </span>
                    )}
                    {s.errors > 0 && (
                      <span
                        className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-extrabold tabular-nums text-amber-600 ring-1 ring-amber-500/25 dark:text-amber-400"
                        title={`${s.errors} script error${s.errors === 1 ? '' : 's'}`}
                      >
                        {s.errors} error{s.errors === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 break-words text-[11px] leading-snug text-muted-foreground">
                    {s.last || 'no message recorded'}
                    <span className="ml-1 shrink-0 text-muted-foreground/60">
                      · {relativeTime(s.lastTs)}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* footer actions */}
        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
          <p className="min-w-0 truncate text-[10px] text-muted-foreground">
            Score = 100 − 15 per crash − 3 per error · stored on this device only
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-[11px]"
                disabled={pristine && !lastSession}
              >
                <Trash2 className="size-3.5" aria-hidden /> Clear history
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear error history?</AlertDialogTitle>
                <AlertDialogDescription>
                  All recorded crashes, script errors and past session scores will be deleted from
                  this device. The current session keeps counting from its existing tally.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={clearHistory}>Clear history</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </section>
  )
}
