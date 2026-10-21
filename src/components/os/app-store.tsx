'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  BadgeCheck,
  ChevronRight,
  Download,
  LayoutGrid,
  Search,
  SearchX,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  TrendingUp,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store/app-store'
import {
  searchTools,
  storeStats,
  toolCategories,
  tools,
  type Tool,
  type ToolCategoryId,
} from '@/lib/tools/registry'

/* ================================================================== */
/* View model + helpers                                                */
/* ================================================================== */

type View =
  | { type: 'home' }
  | { type: 'category'; id: ToolCategoryId }
  | { type: 'app'; id: string }
  | { type: 'myapps' }
  | { type: 'search' }

/** Ask the OS shell to open an app window. */
function requestOpenApp(id: string) {
  window.dispatchEvent(new CustomEvent<string>('toolhub:open-app', { detail: id }))
}

function viewKey(v: View): string {
  return v.type === 'category' ? `category-${v.id}` : v.type === 'app' ? `app-${v.id}` : v.type
}

/** "12.3 MB" → 12.3 (fallback 0) */
function sizeInMb(size: string): number {
  const n = parseFloat(size)
  return Number.isFinite(n) ? n : 0
}

/* ================================================================== */
/* Get pill — GET / progress ring / OPEN                               */
/* ================================================================== */

function ProgressRing({ value, className }: { value: number; className?: string }) {
  const r = 9
  const c = 2 * Math.PI * r
  return (
    <span className={cn('relative grid size-8 place-items-center', className)} aria-hidden>
      <svg viewBox="0 0 24 24" className="size-8 -rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" className="stroke-muted" />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-150"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value / 100)))}
        />
      </svg>
      <span className="absolute text-[9px] font-bold tabular-nums text-primary">
        {Math.round(value)}
      </span>
    </span>
  )
}

function GetPill({
  tool,
  installed,
  progress,
  onInstall,
  onOpen,
  large = false,
}: {
  tool: Tool
  installed: boolean
  progress?: number
  onInstall?: () => void
  onOpen?: () => void
  large?: boolean
}) {
  if (progress !== undefined) {
    return <ProgressRing value={progress} />
  }
  if (installed) {
    if (!onOpen) {
      return (
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-semibold text-muted-foreground',
            large && 'px-4 py-1.5 text-sm'
          )}
        >
          <BadgeCheck className="size-3.5" aria-hidden /> Installed
        </span>
      )
    }
    return (
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${tool.name}`}
        className={cn(
          'inline-flex items-center rounded-full bg-primary font-bold uppercase tracking-wide text-primary-foreground shadow-sm shadow-primary/25 transition-transform active:scale-90',
          large ? 'h-9 px-6 text-sm' : 'h-8 min-w-16 px-4 text-xs'
        )}
      >
        Open
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={onInstall}
      aria-label={`Install ${tool.name}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-primary font-bold uppercase tracking-wide text-primary-foreground shadow-sm shadow-primary/25 transition-transform active:scale-90',
        large ? 'h-9 gap-2 px-6 text-sm' : 'h-8 min-w-16 px-4 text-xs'
      )}
    >
      <Download className={large ? 'size-4' : 'size-3.5'} aria-hidden />
      Get
    </button>
  )
}

/* ================================================================== */
/* App row / card                                                      */
/* ================================================================== */

function AppRow({
  tool,
  rank,
  installed,
  progress,
  onInstall,
  onOpen,
  onShow,
}: {
  tool: Tool
  rank?: number
  installed: boolean
  progress?: number
  onInstall: () => void
  onOpen?: () => void
  onShow: () => void
}) {
  const s = storeStats(tool)
  return (
    <div className="flex items-center gap-3 py-2.5">
      {rank !== undefined && (
        <span className="w-5 shrink-0 text-center text-sm font-bold tabular-nums text-muted-foreground/70">
          {rank}
        </span>
      )}
      <button
        type="button"
        onClick={onShow}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition-colors hover:bg-muted/60"
        aria-label={`View ${tool.name}`}
      >
        <span
          style={{ '--glow': tool.glow } as React.CSSProperties}
          className={cn(
            'relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[0.95rem] bg-gradient-to-br text-white ring-1 ring-black/5',
            'shadow-[0_8px_18px_-8px_var(--glow),inset_0_1px_1px_rgb(255_255_255/0.35)]',
            tool.gradient
          )}
        >
          <tool.icon className="size-6" strokeWidth={1.9} aria-hidden />
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{tool.name}</span>
            {tool.system && <ShieldCheck className="size-3.5 shrink-0 text-primary" aria-label="System app" />}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{s.tagline}</span>
          <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden />
            {s.rating.toFixed(1)}
            <span className="text-muted-foreground/50">·</span>
            {s.downloads}
            <span className="text-muted-foreground/50">·</span>
            {s.size}
          </span>
        </span>
      </button>
      <GetPill tool={tool} installed={installed} progress={progress} onInstall={onInstall} onOpen={onOpen} />
    </div>
  )
}

function AppCard({ tool, installed, onShow }: { tool: Tool; installed: boolean; onShow: () => void }) {
  const s = storeStats(tool)
  return (
    <button
      type="button"
      onClick={onShow}
      className="group w-[9.5rem] shrink-0 snap-start rounded-2xl border border-border/70 bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
      aria-label={`View ${tool.name}`}
    >
      <span
        style={{ '--glow': tool.glow } as React.CSSProperties}
        className={cn(
          'relative mb-2.5 flex aspect-square items-center justify-center overflow-hidden rounded-[1.15rem] bg-gradient-to-br text-white ring-1 ring-black/5',
          'shadow-[0_10px_22px_-10px_var(--glow),inset_0_1px_1px_rgb(255_255_255/0.35)] transition-transform group-hover:scale-[1.03]',
          tool.gradient
        )}
      >
        <tool.icon className="size-9" strokeWidth={1.8} aria-hidden />
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
      </span>
      <span className="block truncate text-sm font-semibold">{tool.name}</span>
      <span className="block truncate text-[11px] text-muted-foreground">{s.tagline}</span>
      <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
        <Star className="size-3 fill-amber-400 text-amber-400" aria-hidden />
        {s.rating.toFixed(1)}
        <span className="text-muted-foreground/50">·</span>
        {installed ? 'Installed' : s.size}
      </span>
    </button>
  )
}

/* ================================================================== */
/* Screenshot mock — pure-CSS "preview" panels                         */
/* ================================================================== */

function ScreenshotMock({ tool, variant }: { tool: Tool; variant: 0 | 1 | 2 }) {
  return (
    <div
      className={cn(
        'relative flex h-64 w-40 shrink-0 snap-center flex-col overflow-hidden rounded-2xl bg-gradient-to-br p-3 text-white ring-1 ring-black/10 shadow-lg',
        tool.gradient
      )}
      aria-hidden
    >
      <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent" />
      {/* fake status / nav chrome */}
      <div className="relative flex items-center justify-between text-[9px] font-semibold opacity-80">
        <span>9:41</span>
        <span className="flex gap-1">
          <span className="h-1.5 w-4 rounded-full bg-white/60" />
          <span className="h-1.5 w-2 rounded-full bg-white/60" />
        </span>
      </div>
      {variant === 0 && (
        <div className="relative mt-4 flex flex-1 flex-col items-center justify-center gap-3">
          <span className="grid size-14 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/30 backdrop-blur">
            <tool.icon className="size-7" strokeWidth={1.8} />
          </span>
          <span className="h-2 w-20 rounded-full bg-white/50" />
          <span className="h-1.5 w-14 rounded-full bg-white/30" />
          <span className="mt-2 h-7 w-24 rounded-full bg-white/85 shadow" />
        </div>
      )}
      {variant === 1 && (
        <div className="relative mt-4 grid flex-1 grid-cols-3 content-start gap-2">
          {Array.from({ length: 9 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                'aspect-square rounded-lg',
                i % 4 === 0 ? 'bg-white/45' : i % 3 === 0 ? 'bg-white/25' : 'bg-white/15'
              )}
            />
          ))}
        </div>
      )}
      {variant === 2 && (
        <div className="relative mt-4 flex flex-1 flex-col gap-2">
          <span className="h-7 rounded-lg bg-white/40" />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="flex items-center gap-2 rounded-xl bg-white/15 p-2">
              <span className="size-7 shrink-0 rounded-lg bg-white/40" />
              <span className="flex-1 space-y-1.5">
                <span className="block h-1.5 w-4/5 rounded-full bg-white/50" />
                <span className="block h-1.5 w-3/5 rounded-full bg-white/25" />
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="relative mt-2 flex justify-center">
        <span className="h-1 w-16 rounded-full bg-white/40" />
      </div>
    </div>
  )
}

/* ================================================================== */
/* Section header                                                      */
/* ================================================================== */

function SectionHead({
  title,
  icon: Icon,
  action,
  onAction,
}: {
  title: string
  icon?: LucideIcon
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-base font-bold tracking-tight">
        {Icon && <Icon className="size-4.5 text-primary" aria-hidden />}
        {title}
      </h2>
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="flex items-center gap-0.5 text-sm font-medium text-primary transition-colors hover:opacity-80"
        >
          {action}
          <ChevronRight className="size-4" aria-hidden />
        </button>
      )}
    </div>
  )
}

/* ================================================================== */
/* App detail view                                                     */
/* ================================================================== */

function AppDetail({
  tool,
  installed,
  progress,
  onInstall,
  onOpen,
  onUninstall,
  onShow,
  installedIds,
}: {
  tool: Tool
  installed: boolean
  progress?: number
  onInstall: () => void
  onOpen: () => void
  onUninstall: () => void
  onShow: (id: string) => void
  installedIds: string[]
}) {
  const [expanded, setExpanded] = useState(false)
  const s = storeStats(tool)
  const related = tools.filter((t) => t.category === tool.category && t.id !== tool.id).slice(0, 8)
  const catName = toolCategories.find((c) => c.id === tool.category)?.name ?? 'App'

  return (
    <div className="space-y-6 pb-6">
      {/* hero */}
      <div className="flex items-start gap-4">
        <span
          style={{ '--glow': tool.glow } as React.CSSProperties}
          className={cn(
            'relative flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-[1.6rem] bg-gradient-to-br text-white ring-1 ring-black/10',
            'shadow-[0_18px_36px_-14px_var(--glow),inset_0_1px_1px_rgb(255_255_255/0.4)]',
            tool.gradient
          )}
        >
          <tool.icon className="size-12" strokeWidth={1.7} aria-hidden />
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-bold tracking-tight">{tool.name}</h1>
            {tool.system && (
              <Badge variant="secondary" className="shrink-0 gap-1">
                <ShieldCheck className="size-3" aria-hidden /> System
              </Badge>
            )}
          </div>
          <p className="truncate text-sm text-muted-foreground">{s.developer}</p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground/90">{s.tagline}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <GetPill tool={tool} installed={installed} progress={progress} onInstall={onInstall} onOpen={onOpen} large />
            {!tool.system && installed && (
              <Button
                variant="outline"
                size="sm"
                className="h-9 gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={onUninstall}
              >
                <Trash2 className="size-4" aria-hidden /> Uninstall
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* stats row */}
      <div className="grid grid-cols-4 divide-x divide-border rounded-2xl border border-border/70 bg-card py-3 text-center shadow-sm">
        <div className="px-1">
          <p className="text-xs font-medium text-muted-foreground">RATING</p>
          <p className="text-base font-bold tabular-nums">
            {s.rating.toFixed(1)}
            <Star className="mb-0.5 ml-0.5 inline size-3.5 fill-amber-400 text-amber-400" aria-hidden />
          </p>
        </div>
        <div className="px-1">
          <p className="text-xs font-medium text-muted-foreground">DOWNLOADS</p>
          <p className="text-base font-bold">{s.downloads}</p>
        </div>
        <div className="px-1">
          <p className="text-xs font-medium text-muted-foreground">SIZE</p>
          <p className="text-base font-bold">{s.size}</p>
        </div>
        <div className="px-1">
          <p className="text-xs font-medium text-muted-foreground">AGE</p>
          <p className="text-base font-bold">4+</p>
        </div>
      </div>

      {/* previews */}
      <div>
        <SectionHead title="Preview" />
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          <ScreenshotMock tool={tool} variant={0} />
          <ScreenshotMock tool={tool} variant={1} />
          <ScreenshotMock tool={tool} variant={2} />
        </div>
      </div>

      {/* description */}
      <div>
        <SectionHead title="About this app" />
        <p className={cn('text-sm leading-relaxed text-muted-foreground', !expanded && 'line-clamp-3')}>
          {tool.description}. {s.tagline} — designed for phones, tablets and laptops with a
          responsive layout that feels at home on every screen. Everything runs on your device,
          works offline and never sends your data anywhere. Long-press your home screen to drag the
          icon anywhere you like, drop it onto another app to create a folder, and personalize your
          device with themes and wallpapers from Settings.
        </p>
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-sm font-medium text-primary"
        >
          {expanded ? 'less' : 'more'}
        </button>
      </div>

      {/* what's new */}
      <div>
        <SectionHead title="What's new" />
        <div className="rounded-2xl border border-border/70 bg-card p-4 text-sm shadow-sm">
          <p className="mb-1 font-semibold">Version {s.version}</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Refreshed visuals with smoother, native-feeling animations</li>
            <li>Improved responsiveness across phones, tablets and desktops</li>
            <li>Performance optimizations and bug fixes</li>
          </ul>
        </div>
      </div>

      {/* info grid */}
      <div>
        <SectionHead title="Information" />
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border/70 bg-card text-sm shadow-sm">
          {[
            ['Category', catName],
            ['Size', s.size],
            ['Developer', s.developer],
            ['Version', s.version],
            ['Compatibility', 'Works on all your devices'],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between px-4 py-2.5">
              <span className="text-muted-foreground">{k}</span>
              <span className="font-medium">{v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* related */}
      {related.length > 0 && (
        <div>
          <SectionHead title="You may also like" />
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {related.map((t) => (
              <AppCard key={t.id} tool={t} installed={installedIds.includes(t.id)} onShow={() => onShow(t.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ================================================================== */
/* My apps view                                                        */
/* ================================================================== */

function MyApps({
  installedIds,
  progress,
  onInstall,
  onOpen,
  onUninstall,
  onShow,
}: {
  installedIds: string[]
  progress: Record<string, number>
  onInstall: (id: string) => void
  onOpen: (id: string) => void
  onUninstall: (id: string) => void
  onShow: (id: string) => void
}) {
  const installedTools = useMemo(
    () => installedIds.map((id) => tools.find((t) => t.id === id)).filter((t): t is Tool => Boolean(t)),
    [installedIds]
  )
  const available = useMemo(() => tools.filter((t) => !installedIds.includes(t.id)), [installedIds])
  const totalMb = installedTools.reduce((acc, t) => acc + sizeInMb(storeStats(t).size), 0)

  return (
    <div className="space-y-6 pb-6">
      <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-card p-4 shadow-sm">
        <div>
          <p className="text-sm font-semibold">
            {installedTools.length} app{installedTools.length === 1 ? '' : 's'} installed
          </p>
          <p className="text-xs text-muted-foreground">About {totalMb.toFixed(1)} MB on this device</p>
        </div>
        <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
          <LayoutGrid className="size-5" aria-hidden />
        </span>
      </div>

      <div>
        <SectionHead title="Installed" icon={BadgeCheck} />
        <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card px-4 shadow-sm">
          {installedTools.map((t) => (
            <AppRow
              key={t.id}
              tool={t}
              installed
              progress={progress[t.id]}
              onInstall={() => onInstall(t.id)}
              onOpen={t.system ? undefined : () => onOpen(t.id)}
              onShow={() => onShow(t.id)}
            />
          ))}
        </div>
      </div>

      {available.length > 0 && (
        <div>
          <SectionHead title="Available apps" icon={Sparkles} />
          <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card px-4 shadow-sm">
            {available.map((t) => (
              <AppRow
                key={t.id}
                tool={t}
                installed={false}
                progress={progress[t.id]}
                onInstall={() => onInstall(t.id)}
                onShow={() => onShow(t.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ================================================================== */
/* Main store component                                                */
/* ================================================================== */

export default function AppStoreApp() {
  const { toast } = useToast()
  const rootRef = useRef<HTMLDivElement>(null)
  const installed = useAppStore((s) => s.installed)
  const installApp = useAppStore((s) => s.installApp)
  const uninstallApp = useAppStore((s) => s.uninstallApp)

  const [view, setView] = useState<View>({ type: 'home' })
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null)

  /* deep link from Spotlight / App Library → open that app's detail page */
  useEffect(() => {
    const link = useAppStore.getState().storeDeepLink
    if (link) {
      useAppStore.getState().setStoreDeepLink(null)
      setView({ type: 'app', id: link })
    }
  }, [])

  /* reset scroll of the app-window body whenever the view changes */
  useEffect(() => {
    let el: HTMLElement | null = rootRef.current
    while (el) {
      const cs = getComputedStyle(el)
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
        el.scrollTo({ top: 0 })
        break
      }
      el = el.parentElement
    }
  }, [view])

  const timers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  const progressRef = useRef<Record<string, number>>({})
  useEffect(() => {
    const map = timers.current
    return () => map.forEach((t) => clearInterval(t))
  }, [])

  const startInstall = useCallback(
    (id: string) => {
      const app = tools.find((t) => t.id === id)
      if (!app) return
      if (progressRef.current[id] !== undefined) return

      progressRef.current = { ...progressRef.current, [id]: 4 }
      setProgress((m) => (m[id] !== undefined ? m : { ...m, [id]: 4 }))

      const timer = setInterval(() => {
        const cur = progressRef.current[id]
        if (cur === undefined) {
          clearInterval(timer)
          timers.current.delete(id)
          return
        }
        const next = cur + Math.max(2.5, (100 - cur) * 0.16)
        if (next >= 100) {
          // finish: all side effects live outside state updaters
          clearInterval(timer)
          timers.current.delete(id)
          delete progressRef.current[id]
          setProgress((m) => {
            const { [id]: _done, ...rest } = m
            return rest
          })
          installApp(id)
          toast({
            title: `${app.name} installed ✓`,
            description: 'Find it on your home screen — long-press icons to rearrange.',
          })
        } else {
          progressRef.current = { ...progressRef.current, [id]: next }
          setProgress((m) => ({ ...m, [id]: next }))
        }
      }, 90)
      timers.current.set(id, timer)
    },
    [installApp, toast]
  )

  const confirmUninstall = useCallback(() => {
    if (!pendingUninstall) return
    const app = tools.find((t) => t.id === pendingUninstall)
    uninstallApp(pendingUninstall)
    setPendingUninstall(null)
    if (app) {
      toast({
        title: `${app.name} uninstalled`,
        description: 'Reinstall it anytime from the App Store.',
      })
    }
  }, [pendingUninstall, uninstallApp, toast])

  const pendingTool = pendingUninstall ? tools.find((t) => t.id === pendingUninstall) : undefined

  const openTool = useCallback((id: string) => requestOpenApp(id), [])
  const showTool = useCallback((id: string) => setView({ type: 'app', id }), [])

  const installedIds = useMemo(() => installed, [installed])

  /* ---------------- derived lists ---------------- */
  const featured = useMemo(() => tools.filter((t) => t.featured), [])
  const topCharts = useMemo(
    () => [...tools].sort((a, b) => storeStats(b).rating - storeStats(a).rating).slice(0, 6),
    []
  )
  const fresh = useMemo(() => tools.filter((t) => !installedIds.includes(t.id)).slice(0, 8), [installedIds])
  const searchResults = useMemo(() => (query.trim() ? searchTools(query, 'all') : []), [query])
  const installedResults = searchResults.filter((t) => installedIds.includes(t.id))
  const availableResults = searchResults.filter((t) => !installedIds.includes(t.id))
  const currentApp = view.type === 'app' ? tools.find((t) => t.id === view.id) : undefined
  const currentCategory = view.type === 'category' ? toolCategories.find((c) => c.id === view.id) : undefined

  const goBack = useCallback(
    () => setView((v) => (v.type === 'app' || v.type === 'category' ? { type: 'home' } : v)),
    []
  )

  return (
    <div ref={rootRef} className="relative">
      {/* nav bar */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 bg-background/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-2">
          {(view.type === 'app' || view.type === 'category') && (
            <Button variant="ghost" size="icon" className="size-9 rounded-full" onClick={goBack} aria-label="Back">
              <ArrowLeft className="size-5" />
            </Button>
          )}
          {view.type === 'search' ? (
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search apps and games"
                className="h-10 rounded-xl pl-9"
                aria-label="Search apps"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
          ) : (
            <h1 className="flex-1 text-lg font-extrabold tracking-tight">
              {view.type === 'app' && currentApp
                ? currentApp.name
                : view.type === 'category' && currentCategory
                  ? currentCategory.name
                  : view.type === 'myapps'
                    ? 'My Apps'
                    : 'App Store'}
            </h1>
          )}
          {view.type !== 'search' && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 rounded-full"
                onClick={() => setView({ type: 'search' })}
                aria-label="Search the store"
              >
                <Search className="size-5" />
              </Button>
              <Button
                variant={view.type === 'myapps' ? 'secondary' : 'ghost'}
                size="icon"
                className="size-9 rounded-full"
                onClick={() => setView({ type: 'myapps' })}
                aria-label="My apps"
              >
                <LayoutGrid className="size-5" />
              </Button>
            </>
          )}
          {view.type === 'search' && (
            <Button
              variant="ghost"
              className="h-9 shrink-0 rounded-full px-3 text-sm"
              onClick={() => {
                setQuery('')
                setView({ type: 'home' })
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={viewKey(view)}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          {/* ---------------- HOME ---------------- */}
          {view.type === 'home' && (
            <div className="space-y-7 pb-6">
              {/* featured carousel */}
              <div>
                <SectionHead title="Featured" icon={Sparkles} />
                <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                  {featured.map((t) => {
                    const s = storeStats(t)
                    const inst = installedIds.includes(t.id)
                    return (
                      <div
                        key={t.id}
                        className={cn(
                          'relative flex h-44 w-[19rem] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-3xl p-4 text-white ring-1 ring-black/10 shadow-xl',
                          'bg-gradient-to-br',
                          t.gradient
                        )}
                      >
                        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" aria-hidden />
                        <span className="pointer-events-none absolute -right-6 -top-8 opacity-20" aria-hidden>
                          <t.icon className="size-36" strokeWidth={1.2} />
                        </span>
                        <div className="relative">
                          <p className="text-[11px] font-bold uppercase tracking-widest text-white/85">Editor&apos;s choice</p>
                          <h3 className="mt-0.5 text-lg font-extrabold leading-tight drop-shadow-sm">{t.name}</h3>
                          <p className="text-xs text-white/85 line-clamp-2">{s.tagline}</p>
                        </div>
                        <div className="relative flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => showTool(t.id)}
                            className="flex items-center gap-2 rounded-full py-1 pr-3 text-sm font-semibold text-white/95 transition-colors hover:text-white"
                            aria-label={`View ${t.name}`}
                          >
                            <span className="grid size-9 place-items-center rounded-xl bg-white/20 ring-1 ring-white/30 backdrop-blur">
                              <t.icon className="size-5" aria-hidden />
                            </span>
                            Learn more
                          </button>
                          <span className="rounded-full bg-white/90 p-0.5 shadow-sm [&_button]:text-foreground">
                            <GetPill
                              tool={t}
                              installed={inst}
                              progress={progress[t.id]}
                              onInstall={() => startInstall(t.id)}
                              onOpen={() => openTool(t.id)}
                            />
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* categories */}
              <div>
                <SectionHead
                  title="Browse categories"
                  icon={LayoutGrid}
                  action="My apps"
                  onAction={() => setView({ type: 'myapps' })}
                />
                <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
                  {toolCategories.map((c) => {
                    const count = tools.filter((t) => t.category === c.id).length
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setView({ type: 'category', id: c.id })}
                        className="group flex flex-col items-center gap-1.5 rounded-2xl border border-border/70 bg-card p-3 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                          <c.icon className="size-5" aria-hidden />
                        </span>
                        <span className="text-xs font-semibold leading-tight">{c.name}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {count} {count === 1 ? 'app' : 'apps'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* top charts */}
              <div>
                <SectionHead title="Top charts" icon={TrendingUp} />
                <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card px-4 shadow-sm">
                  {topCharts.map((t, i) => (
                    <AppRow
                      key={t.id}
                      tool={t}
                      rank={i + 1}
                      installed={installedIds.includes(t.id)}
                      progress={progress[t.id]}
                      onInstall={() => startInstall(t.id)}
                      onOpen={installedIds.includes(t.id) ? () => openTool(t.id) : undefined}
                      onShow={() => showTool(t.id)}
                    />
                  ))}
                </div>
              </div>

              {/* available for you */}
              {fresh.length > 0 && (
                <div>
                  <SectionHead title="Available for you" />
                  <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                    {fresh.map((t) => (
                      <AppCard key={t.id} tool={t} installed={false} onShow={() => showTool(t.id)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ---------------- CATEGORY ---------------- */}
          {view.type === 'category' && currentCategory && (
            <div className="pb-6">
              <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card px-4 shadow-sm">
                {tools
                  .filter((t) => t.category === currentCategory.id)
                  .map((t) => (
                    <AppRow
                      key={t.id}
                      tool={t}
                      installed={installedIds.includes(t.id)}
                      progress={progress[t.id]}
                      onInstall={() => startInstall(t.id)}
                      onOpen={installedIds.includes(t.id) ? () => openTool(t.id) : undefined}
                      onShow={() => showTool(t.id)}
                    />
                  ))}
              </div>
            </div>
          )}

          {/* ---------------- APP DETAIL ---------------- */}
          {view.type === 'app' && currentApp && (
            <AppDetail
              tool={currentApp}
              installed={installedIds.includes(currentApp.id)}
              progress={progress[currentApp.id]}
              onInstall={() => startInstall(currentApp.id)}
              onOpen={() => openTool(currentApp.id)}
              onUninstall={() => setPendingUninstall(currentApp.id)}
              onShow={showTool}
              installedIds={installedIds}
            />
          )}

          {/* ---------------- MY APPS ---------------- */}
          {view.type === 'myapps' && (
            <MyApps
              installedIds={installedIds}
              progress={progress}
              onInstall={startInstall}
              onOpen={openTool}
              onUninstall={(id) => setPendingUninstall(id)}
              onShow={showTool}
            />
          )}

          {/* ---------------- SEARCH ---------------- */}
          {view.type === 'search' && (
            <div className="space-y-5 pb-6">
              {!query.trim() ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
                  <Search className="size-8 opacity-50" aria-hidden />
                  <p className="text-sm">Search {tools.length} apps — try “photo”, “convert” or “game”</p>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
                  <SearchX className="size-8 opacity-50" aria-hidden />
                  <p className="text-sm">No apps found for “{query.trim()}”</p>
                </div>
              ) : (
                <>
                  {installedResults.length > 0 && (
                    <div>
                      <SectionHead title="Installed" />
                      <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card px-4 shadow-sm">
                        {installedResults.map((t) => (
                          <AppRow
                            key={t.id}
                            tool={t}
                            installed
                            progress={progress[t.id]}
                            onInstall={() => startInstall(t.id)}
                            onOpen={() => openTool(t.id)}
                            onShow={() => showTool(t.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  {availableResults.length > 0 && (
                    <div>
                      <SectionHead title="From the App Store" />
                      <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card px-4 shadow-sm">
                        {availableResults.map((t) => (
                          <AppRow
                            key={t.id}
                            tool={t}
                            installed={false}
                            progress={progress[t.id]}
                            onInstall={() => startInstall(t.id)}
                            onShow={() => showTool(t.id)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* uninstall confirm */}
      <AlertDialog open={Boolean(pendingUninstall)} onOpenChange={(o) => !o && setPendingUninstall(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Uninstall {pendingTool?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The app and its home-screen icon will be removed. Your data inside the app stays on
              this device and is restored if you install it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirmUninstall}
            >
              Uninstall
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
