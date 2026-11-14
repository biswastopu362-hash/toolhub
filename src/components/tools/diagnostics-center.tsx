'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Loader2,
  Play,
  Stethoscope,
  TriangleAlert,
  Wrench,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  DIAG_TOTAL,
  healthScore,
  runDiagnostics,
  type DiagCheck,
} from '@/lib/diagnostics'

/**
 * Diagnostics Center — P9-W1. Lives inside the Admin Console; runs a
 * nine-point health check of the whole platform (registry, installs,
 * storage, databases, service worker, manifest, features, foreign keys)
 * with explicit, owner-triggered fixes. Auto-runs once per unlock.
 */
export function DiagnosticsCenter() {
  const { toast } = useToast()
  const [checks, setChecks] = useState<DiagCheck[]>([])
  const [running, setRunning] = useState(false)
  const [doneOnce, setDoneOnce] = useState(false)
  const ranRef = useRef(false)

  const startRun = useCallback(() => {
    if (running) return
    setRunning(true)
    setChecks([])
    void runDiagnostics((check) => {
      setChecks((prev) => [...prev, check])
    }).finally(() => {
      setRunning(false)
      setDoneOnce(true)
    })
  }, [running])

  /* auto-run once per unlock, slightly delayed so the embed sweep goes first */
  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    const t = setTimeout(startRun, 900)
    return () => clearTimeout(t)
  }, [])

  const score = healthScore(checks)
  const warnCount = checks.filter((c) => c.status === 'warn').length
  const failCount = checks.filter((c) => c.status === 'fail').length
  const complete = !running && doneOnce && checks.length === DIAG_TOTAL

  const scoreTone =
    score >= 90
      ? 'text-emerald-400 ring-emerald-400/30 bg-emerald-400/10'
      : score >= 60
        ? 'text-amber-400 ring-amber-400/30 bg-amber-400/10'
        : 'text-rose-400 ring-rose-400/30 bg-rose-400/10'

  const applyFix = useCallback(
    async (check: DiagCheck) => {
      if (!check.fix) return
      try {
        const needsReload = await check.fix.run()
        if (needsReload) {
          toast({ title: 'Fixed — reloading…', description: check.title })
          setTimeout(() => window.location.reload(), 700)
        } else {
          toast({ title: 'Fixed', description: check.fix.label })
          setChecks((prev) =>
            prev.map((c) =>
              c.id === check.id ? { ...c, status: 'ok' as const, detail: `${c.detail} · fixed just now`, fix: undefined } : c
            )
          )
        }
      } catch {
        toast({ title: 'Fix failed', description: `${check.title} — try again.`, variant: 'destructive' })
      }
    },
    [toast]
  )

  return (
    <section
      aria-label="Diagnostics Center"
      className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm"
    >
      {/* header */}
      <div className="flex items-start gap-3 border-b border-border/60 bg-gradient-to-r from-teal-950/60 via-slate-900 to-stone-950 p-4 text-white">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20">
          <Stethoscope className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/55">
            Fortify · P9-W1
          </p>
          <h2 className="text-base font-extrabold tracking-tight">Diagnostics Center</h2>
          <p className="mt-0.5 text-xs text-white/65">
            Nine-point health check — registry, installs, storage, databases, offline shell.
          </p>
        </div>
        {checks.length > 0 && (
          <span
            className={cn(
              'grid shrink-0 place-items-center rounded-full px-3 py-1.5 text-sm font-extrabold tabular-nums ring-1',
              scoreTone
            )}
            title="Overall health score"
          >
            {score}
            <span className="sr-only"> health score out of 100</span>
          </span>
        )}
      </div>

      <div className="p-4">
        {/* run row */}
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">
            {running
              ? `Checking ${Math.min(checks.length + 1, DIAG_TOTAL)}/${DIAG_TOTAL}…`
              : complete
                ? `${DIAG_TOTAL} checks complete · ${failCount} fail${failCount === 1 ? '' : 'ure'}${warnCount ? ` · ${warnCount} warning${warnCount === 1 ? '' : 's'}` : ''}`
                : 'No results yet — run the checkup to inspect this device.'}
          </p>
          <Button
            size="sm"
            className="h-8 shrink-0 gap-1.5 rounded-full"
            onClick={startRun}
            disabled={running}
          >
            {running ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="size-3.5" aria-hidden />
            )}
            {checks.length > 0 ? 'Re-run' : 'Run checkup'}
          </Button>
        </div>

        {/* results */}
        {checks.length > 0 && (
          <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-0.5 scrollbar-thin">
            {checks.map((c) => (
              <li
                key={c.id}
                className="flex items-start gap-2.5 rounded-2xl border border-border/50 bg-background/60 p-2.5"
              >
                {c.status === 'ok' ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
                ) : c.status === 'warn' ? (
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold leading-tight">{c.title}</p>
                  <p className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">
                    {c.detail}
                  </p>
                </div>
                {c.fix && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 gap-1 rounded-full px-2.5 text-[11px]"
                    onClick={() => void applyFix(c)}
                  >
                    <Wrench className="size-3" aria-hidden /> {c.fix.label}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
