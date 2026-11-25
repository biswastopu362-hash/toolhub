'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRightLeft,
  CircleCheck,
  Database,
  FileWarning,
  HardDriveDownload,
  Loader2,
  Play,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  discardQuarantine,
  listQuarantine,
  quarantineKey,
  readStoreIntegrity,
  runMigrationMatrix,
  scanCorruptKeys,
  scanDomainCoverage,
  type CoverageFinding,
  type KeyFinding,
  type MatrixResult,
  type QuarantineEntry,
  type StoreIntegrity,
} from '@/lib/storage-audit'

/**
 * StorageAuditPanel — P9-W7. Lives in the Admin Console under the Crash
 * & Error Telemetry card. Runs the three storage audits against this
 * device: the store-migration matrix (historical persisted shapes →
 * current shape through the real migrate fn), live store integrity +
 * corrupt-key scan (with explicit lossless quarantine), and backup
 * domain coverage (no data domain escapes Backup & Restore).
 */
export function StorageAuditPanel() {
  const { toast } = useToast()
  const [running, setRunning] = useState(false)
  const [doneOnce, setDoneOnce] = useState(false)
  const ranRef = useRef(false)
  const [matrix, setMatrix] = useState<MatrixResult[]>([])
  const [store, setStore] = useState<StoreIntegrity | null>(null)
  const [findings, setFindings] = useState<KeyFinding[]>([])
  const [quarantined, setQuarantined] = useState<QuarantineEntry[]>([])
  const [coverage, setCoverage] = useState<CoverageFinding[]>([])

  const refreshQuarantine = useCallback(() => setQuarantined(listQuarantine()), [])

  const runAudit = useCallback(() => {
    if (running) return
    setRunning(true)
    setMatrix([])
    setStore(null)
    setFindings([])
    setCoverage([])
    /* staged so the panel streams like the Diagnostics Center */
    const t1 = setTimeout(() => {
      setMatrix(runMigrationMatrix())
      setStore(readStoreIntegrity())
      setFindings(scanCorruptKeys())
      refreshQuarantine()
    }, 60)
    const t2 = setTimeout(() => {
      void scanDomainCoverage().then((cov) => {
        setCoverage(cov)
        setRunning(false)
        setDoneOnce(true)
      })
    }, 220)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [running, refreshQuarantine])

  /* auto-run once per unlock, after the embed sweep and diagnostics */
  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    const t = setTimeout(() => {
      setMatrix(runMigrationMatrix())
      setStore(readStoreIntegrity())
      setFindings(scanCorruptKeys())
      refreshQuarantine()
      void scanDomainCoverage().then((cov) => {
        setCoverage(cov)
        setDoneOnce(true)
      })
    }, 1400)
    return () => clearTimeout(t)
  }, [refreshQuarantine])

  const matrixPass = matrix.filter((m) => m.pass).length
  const fails = findings.filter((f) => f.severity === 'fail')
  const warns = findings.filter((f) => f.severity === 'warn')
  const uncovered = coverage.filter((c) => !c.covered)
  const allGreen =
    matrix.length > 0 &&
    matrixPass === matrix.length &&
    fails.length === 0 &&
    uncovered.length === 0 &&
    (store?.ok ?? true)

  const doQuarantine = useCallback(
    (key: string) => {
      if (quarantineKey(key)) {
        setFindings((prev) => prev.filter((f) => f.key !== key))
        refreshQuarantine()
        toast({ title: 'Quarantined', description: `${key} moved out of the live namespace.` })
      } else {
        toast({ title: 'Could not quarantine', description: key, variant: 'destructive' })
      }
    },
    [toast, refreshQuarantine]
  )

  const doDiscard = useCallback(
    (id: string) => {
      discardQuarantine(id)
      refreshQuarantine()
    },
    [refreshQuarantine]
  )

  return (
    <section
      aria-label="Storage audit"
      className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm"
    >
      {/* header */}
      <div className="flex items-start gap-3 border-b border-border/60 bg-gradient-to-r from-indigo-950/70 via-slate-900 to-stone-950 p-4 text-white">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20">
          <Database className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-white/55">
            Fortify · P9-W7
          </p>
          <h2 className="text-base font-extrabold tracking-tight">Storage Audit</h2>
          <p className="mt-0.5 text-xs text-white/65">
            Migration matrix, live-store integrity, corruption recovery and backup coverage.
          </p>
        </div>
        {doneOnce && allGreen && (
          <span
            className="grid shrink-0 place-items-center rounded-full bg-emerald-400/10 px-3 py-1.5 text-sm font-extrabold text-emerald-400 ring-1 ring-emerald-400/30"
            title="All storage audits passed"
          >
            <ShieldCheck className="size-4" aria-hidden />
            <span className="sr-only">all audits passed</span>
          </span>
        )}
      </div>

      <div className="space-y-4 p-4">
        {/* run row */}
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">
            {running
              ? 'Auditing stores…'
              : doneOnce
                ? allGreen
                  ? `Migration ${matrixPass}/${matrix.length} · ${findings.length} findings · coverage complete`
                  : `${fails.length} corruption · ${warns.length} coverage · ${matrix.length - matrixPass} migration issue${matrix.length - matrixPass === 1 ? '' : 's'}`
                : 'No results yet — run the audit to inspect this device.'}
          </p>
          <Button size="sm" className="h-8 shrink-0 gap-1.5 rounded-full" onClick={runAudit} disabled={running}>
            {running ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Play className="size-3.5" aria-hidden />
            )}
            {doneOnce ? 'Re-run' : 'Run audit'}
          </Button>
        </div>

        {/* migration matrix */}
        {matrix.length > 0 && (
          <div>
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <ArrowRightLeft className="size-3" aria-hidden /> Store-migration matrix ·{' '}
              {matrixPass}/{matrix.length} shapes pass
            </p>
            <ul className="mt-2 max-h-44 space-y-1.5 overflow-y-auto pr-0.5 scrollbar-thin">
              {matrix.map((m) => (
                <li key={m.label} className="flex items-start gap-2.5 rounded-2xl border border-border/50 bg-background/60 p-2.5">
                  {m.pass ? (
                    <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <XCircle className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold leading-tight">{m.label}</p>
                    {m.issues.length > 0 && (
                      <p className="mt-0.5 break-words text-[11px] text-rose-600 dark:text-rose-400">
                        {m.issues.join(' · ')}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* live store + corruption */}
        {store && (
          <div>
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <HardDriveDownload className="size-3" aria-hidden /> Live profile &amp; corrupt-key scan
            </p>
            <div
              className={cn(
                'mt-2 flex items-center gap-2 rounded-2xl border p-2.5',
                store.ok
                  ? 'border-emerald-500/25 bg-emerald-500/[0.07]'
                  : 'border-rose-500/30 bg-rose-500/[0.08]'
              )}
            >
              {store.ok ? (
                <CircleCheck className="size-4 shrink-0 text-emerald-500" aria-hidden />
              ) : (
                <XCircle className="size-4 shrink-0 text-rose-500" aria-hidden />
              )}
              <p className="text-xs">{store.summary}</p>
            </div>
            {findings.length === 0 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Every owned key parses cleanly · all keys are covered by the backup map.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {findings.map((f) => (
                  <li
                    key={f.key}
                    className="flex items-start gap-2.5 rounded-2xl border border-border/50 bg-background/60 p-2.5"
                  >
                    <FileWarning
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        f.severity === 'fail' ? 'text-rose-500' : 'text-amber-500'
                      )}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-xs font-bold">{f.key}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{f.reason}</p>
                    </div>
                    {f.severity === 'fail' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 gap-1 rounded-full px-2.5 text-[11px]"
                        onClick={() => doQuarantine(f.key)}
                      >
                        Quarantine
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {quarantined.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {quarantined.map((q) => (
                  <li
                    key={q.id}
                    className="flex items-center gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-xs font-bold">{q.originalKey}</p>
                      <p className="text-[11px] text-muted-foreground">
                        quarantined · {(q.bytes / 1024).toFixed(1)} KB kept for salvage
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 rounded-full px-2.5 text-[11px]"
                      onClick={() => doDiscard(q.id)}
                    >
                      Discard
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* coverage */}
        {coverage.length > 0 && (
          <div>
            <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              <Database className="size-3" aria-hidden /> Backup coverage
            </p>
            {uncovered.length === 0 ? (
              <div className="mt-2 flex items-center gap-2.5 rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.07] p-3">
                <ShieldCheck className="size-5 shrink-0 text-emerald-500" aria-hidden />
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  The Backup &amp; Restore map covers every ToolHub domain on this device —
                  {' '}
                  {coverage.filter((c) => c.kind === 'idb').length} databases, {coverage.filter((c) => c.kind === 'ls').length} keys.
                </p>
              </div>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {uncovered.map((u) => (
                  <li
                    key={u.domain}
                    className="flex items-start gap-2.5 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-2.5"
                  >
                    <FileWarning className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="break-all text-xs font-bold">{u.domain}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {u.kind === 'idb' ? 'database' : 'key'} missing from the backup domain map — its data would be lost in a backup/restore cycle.
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
          <p className="min-w-0 truncate text-[10px] text-muted-foreground">
            Quarantine keeps raw bytes until you discard them · nothing leaves this device
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-[11px]"
            onClick={() =>
              window.dispatchEvent(new CustomEvent<string>('toolhub:open-app', { detail: 'backup-restore' }))
            }
          >
            Open Backup &amp; Restore
          </Button>
        </div>
      </div>
    </section>
  )
}
