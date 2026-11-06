'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  BadgeCheck,
  Braces,
  ChevronRight,
  Copy,
  Download,
  Gamepad2,
  Globe,
  LayoutGrid,
  Link2,
  Palette,
  Search,
  SearchX,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
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
  getToolById,
  storeStats,
  toolCategories,
  tools,
  type Tool,
  type ToolCategoryId,
} from '@/lib/tools/registry'
import { useExternalApps } from '@/lib/tools/external'

/* ================================================================== */
/* View model + helpers                                                */
/* ================================================================== */

type View =
  | { type: 'home' }
  | { type: 'category'; id: ToolCategoryId }
  | { type: 'collection'; id: string }
  | { type: 'app'; id: string }
  | { type: 'myapps' }
  | { type: 'search' }

/* ================================================================== */
/* v2.1 Store v2 — editorial collections + update badges               */
/* ================================================================== */

interface Collection {
  id: string
  title: string
  blurb: string
  icon: LucideIcon
  gradient: string
  appIds: string[]
}

const COLLECTIONS: Collection[] = [
  {
    id: 'creators',
    title: 'Creator’s Studio',
    blurb: 'Design, film, edit — a pocket studio',
    icon: Palette,
    gradient: 'from-fuchsia-500 via-purple-600 to-indigo-600',
    appIds: ['design-studio', 'video-studio', 'image-tools', 'paint-studio', 'audio-studio', 'sticker-studio', 'collage-maker', 'meme-maker', 'wallpaper-studio'],
  },
  {
    id: 'focus',
    title: 'Focus & Rituals',
    blurb: 'Habits, goals and gentle structure',
    icon: Target,
    gradient: 'from-emerald-500 via-teal-600 to-cyan-600',
    appIds: ['habit-tracker', 'goal-tracker', 'flashcards', 'task-board', 'notes', 'reminders', 'calendar', 'shopping-list'],
  },
  {
    id: 'game-night',
    title: 'Game Night',
    blurb: 'Nine classics, zero loading screens',
    icon: Gamepad2,
    gradient: 'from-amber-500 via-orange-600 to-rose-600',
    appIds: ['game-2048', 'sudoku', 'minesweeper', 'snake', 'memory-match', 'bangla-wordle', '2p-arcade', 'solitaire', 'trivia-quiz'],
  },
  {
    id: 'dev-toolkit',
    title: 'Dev Toolkit',
    blurb: 'JSON, regex, diffs — all offline',
    icon: Braces,
    gradient: 'from-sky-500 via-blue-600 to-violet-600',
    appIds: ['json-formatter', 'regex-tester', 'diff-checker', 'hash-uuid', 'jwt-decoder', 'cron-timestamp', 'code-editor', 'base64-tool'],
  },
]

/** Apps that genuinely shipped changes in the v2.1 release — seeded as
 *  “unseen” so the update badges reflect the real changelog. */
const UPDATED_IN_21 = new Set([
  'notes',
  'settings',
  'calendar',
  'habit-tracker',
  'goal-tracker',
  'game-2048',
])

/** Ask the OS shell to open an app window. */
function requestOpenApp(id: string) {
  window.dispatchEvent(new CustomEvent<string>('toolhub:open-app', { detail: id }))
}

function viewKey(v: View): string {
  if (v.type === 'category') return `category-${v.id}`
  if (v.type === 'collection') return `collection-${v.id}`
  return v.type === 'app' ? `app-${v.id}` : v.type
}

/** "12.3 MB" → 12.3 (fallback 0) */
function sizeInMb(size: string): number {
  const n = parseFloat(size)
  return Number.isFinite(n) ? n : 0
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
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
  onCopyLink,
  onShow,
  installedIds,
  catalog,
  updateAvailable,
  onUpdate,
}: {
  tool: Tool
  installed: boolean
  progress?: number
  onInstall: () => void
  onOpen: () => void
  onUninstall: () => void
  onCopyLink?: () => void
  onShow: (id: string) => void
  installedIds: string[]
  catalog: Tool[]
  /** v2.1: registry version differs from the acknowledged one */
  updateAvailable?: boolean
  /** v2.1: acknowledge the new version */
  onUpdate?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const s = storeStats(tool)
  /* v2.1 — keyword-overlap scored "similar apps" (same-category fallback) */
  const related = useMemo(() => {
    const kw = new Set((tool.keywords ?? []).map((k) => k.toLowerCase()))
    return catalog
      .filter((t) => t.id !== tool.id)
      .map((t) => {
        let score = 0
        for (const k of t.keywords ?? []) if (kw.has(k.toLowerCase())) score += 2
        if (t.category === tool.category) score += 1
        return { t, score }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name))
      .slice(0, 8)
      .map((x) => x.t)
  }, [catalog, tool])
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
            {tool.external && (
              <Badge variant="secondary" className="shrink-0 gap-1">
                <Globe className="size-3" aria-hidden /> Linked platform
              </Badge>
            )}
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
            {tool.external && onCopyLink && (
              <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={onCopyLink}>
                <Link2 className="size-4" aria-hidden /> Copy link
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
          {tool.external ? (
            <>
              {tool.description}. This platform is curated by the hub owner and lives at{' '}
              {hostOf(tool.url ?? '')} — installing it simply places a shortcut on your home
              screen and opens it inside ToolHub in a secure embedded window. Nothing is bundled
              or stored on your device. If the platform ever blocks embedding, the window offers
              a one-tap escape hatch to open it in a new tab.
            </>
          ) : (
            <>
              {tool.description}. {s.tagline} — designed for phones, tablets and laptops with a
              responsive layout that feels at home on every screen. Everything runs on your
              device, works offline and never sends your data anywhere. Long-press your home
              screen to drag the icon anywhere you like, drop it onto another app to create a
              folder, and personalize your device with themes and wallpapers from Settings.
            </>
          )}
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
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="font-semibold">Version {s.version}</p>
            {/* v2.1 — acknowledge the update straight from the detail page */}
            {installed && updateAvailable && onUpdate && (
              <Button size="sm" className="h-8 rounded-full px-3.5" onClick={onUpdate}>
                Update
              </Button>
            )}
          </div>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {(tool.changelog ?? [
              'Refreshed visuals with smoother, native-feeling animations',
              'Improved responsiveness across phones, tablets and desktops',
              'Performance optimizations and bug fixes',
            ]).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
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
            tool.external ? ['Platform', hostOf(tool.url ?? '')] : ['Runs', 'On this device — no upload'],
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
  catalog,
}: {
  installedIds: string[]
  progress: Record<string, number>
  onInstall: (id: string) => void
  onOpen: (id: string) => void
  onUninstall: (id: string) => void
  onShow: (id: string) => void
  catalog: Tool[]
}) {
  const installedTools = useMemo(
    () => installedIds.map((id) => catalog.find((t) => t.id === id)).filter((t): t is Tool => Boolean(t)),
    [installedIds, catalog]
  )
  const available = useMemo(() => catalog.filter((t) => !installedIds.includes(t.id)), [catalog, installedIds])
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
  const externalApps = useExternalApps((s) => s.apps)

  const [view, setView] = useState<View>({ type: 'home' })
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [query, setQuery] = useState('')
  const [pendingUninstall, setPendingUninstall] = useState<string | null>(null)
  /* D84 — category filter inside the My Platforms rail */
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  /* v2.1 — update badges: appId → last acknowledged version */
  const seenVersions = useAppStore((s) => s.seenVersions)
  const markVersionSeen = useAppStore((s) => s.markVersionSeen)

  /* seed the seen-version map: everything current EXCEPT the apps that
   * genuinely changed in this release — those surface as real updates */
  const [seenSeeded, setSeenSeeded] = useState(false)
  useEffect(() => {
    if (seenSeeded) return
    setSeenSeeded(true)
    const s = useAppStore.getState()
    for (const t of tools) {
      if (t.version && s.seenVersions[t.id] === undefined && !UPDATED_IN_21.has(t.id)) {
        s.markVersionSeen(t.id, t.version)
      }
    }
  }, [seenSeeded])

  const updates = useMemo(
    () =>
      tools.filter((t) => {
        if (!t.version || !installed.includes(t.id)) return false
        const seen = seenVersions[t.id]
        if (seen !== undefined) return seen !== t.version
        /* never-seen apps count as updates only when this release really
           shipped changes for them (v2.1 set) — fresh installs are current */
        return UPDATED_IN_21.has(t.id)
      }),
    [installed, seenVersions]
  )

  /* linked platforms live server-side — make sure the catalog is fresh */
  useEffect(() => {
    void useExternalApps.getState().reload()
  }, [])

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

  const installedIds = useMemo(() => installed, [installed])

  /* full catalog = built-ins + admin-linked platforms */
  const allTools = useMemo(() => [...externalApps, ...tools], [externalApps])

  const startInstall = useCallback(
    (id: string) => {
      const app = allTools.find((t) => t.id === id)
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
            description: app.external
              ? 'A shortcut is waiting on your home screen.'
              : 'Find it on your home screen — long-press icons to rearrange.',
          })
        } else {
          progressRef.current = { ...progressRef.current, [id]: next }
          setProgress((m) => ({ ...m, [id]: next }))
        }
      }, 90)
      timers.current.set(id, timer)
    },
    [allTools, installApp, toast]
  )

  const confirmUninstall = useCallback(() => {
    if (!pendingUninstall) return
    const app = allTools.find((t) => t.id === pendingUninstall)
    uninstallApp(pendingUninstall)
    setPendingUninstall(null)
    if (app) {
      toast({
        title: `${app.name} uninstalled`,
        description: 'Reinstall it anytime from the App Store.',
      })
    }
  }, [pendingUninstall, allTools, uninstallApp, toast])

  const pendingTool = pendingUninstall ? allTools.find((t) => t.id === pendingUninstall) : undefined

  const copyPlatformLink = useCallback(async (id: string, name: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/#/app/${id}`)
      toast({ title: 'Link copied', description: `${name} can be shared with this link.` })
    } catch {
      toast({ title: 'Copy failed', description: 'Long-press the address bar to copy manually.', variant: 'destructive' })
    }
  }, [toast])

  const openTool = useCallback((id: string) => requestOpenApp(id), [])
  const showTool = useCallback((id: string) => setView({ type: 'app', id }), [])

  /* ---------------- derived lists ---------------- */
  const featured = useMemo(() => tools.filter((t) => t.featured), [])
  const platformCats = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of externalApps) counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
    return Array.from(counts.entries()).map(([id, n]) => ({
      id,
      name: toolCategories.find((c) => c.id === id)?.name ?? 'Other',
      count: n,
    }))
  }, [externalApps])
  const shownPlatforms = useMemo(
    () => (platformFilter === 'all' ? externalApps : externalApps.filter((t) => t.category === platformFilter)),
    [externalApps, platformFilter]
  )
  const topCharts = useMemo(
    () => [...tools].sort((a, b) => storeStats(b).rating - storeStats(a).rating).slice(0, 6),
    []
  )
  const fresh = useMemo(() => tools.filter((t) => !installedIds.includes(t.id)).slice(0, 8), [installedIds])
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return allTools.filter((t) => {
      const catName = toolCategories.find((c) => c.id === t.category)?.name.toLowerCase() ?? ''
      return [t.name, t.description, t.keywords.join(' '), catName].join(' ').toLowerCase().includes(q)
    })
  }, [query, allTools])
  const installedResults = searchResults.filter((t) => installedIds.includes(t.id))
  const availableResults = searchResults.filter((t) => !installedIds.includes(t.id))
  const currentApp = view.type === 'app' ? allTools.find((t) => t.id === view.id) : undefined
  const currentCategory = view.type === 'category' ? toolCategories.find((c) => c.id === view.id) : undefined
  /* v2.1 — editorial collection view */
  const currentCollection = view.type === 'collection' ? COLLECTIONS.find((c) => c.id === view.id) : undefined
  const collectionTools = useMemo(
    () => (currentCollection ? currentCollection.appIds.map((id) => getToolById(id)).filter((t): t is Tool => Boolean(t)) : []),
    [currentCollection]
  )

  const goBack = useCallback(
    () => setView((v) => (v.type === 'app' || v.type === 'category' || v.type === 'collection' ? { type: 'home' } : v)),
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
                  : view.type === 'collection'
                    ? (COLLECTIONS.find((c) => c.id === view.id)?.title ?? 'Collection')
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
              {/* v2.1 — updates available (real version diffs) */}
              {updates.length > 0 && (
                <div>
                  <SectionHead title={`Updates available · ${updates.length}`} icon={Download} />
                  <div className="space-y-2">
                    {updates.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-primary/[0.06] p-3"
                      >
                        <span
                          className={cn(
                            'flex size-11 shrink-0 items-center justify-center rounded-[0.9rem] bg-gradient-to-br text-white ring-1 ring-black/5',
                            t.gradient
                          )}
                        >
                          <t.icon className="size-5.5" strokeWidth={1.9} aria-hidden />
                        </span>
                        <button
                          type="button"
                          onClick={() => showTool(t.id)}
                          className="min-w-0 flex-1 text-left"
                          aria-label={`See what's new in ${t.name}`}
                        >
                          <p className="truncate text-sm font-semibold">
                            {t.name}
                            <span className="ml-1.5 text-xs font-medium text-primary">v{t.version}</span>
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {t.changelog?.[0] ?? 'Improvements and fixes'}
                          </p>
                        </button>
                        <Button
                          size="sm"
                          className="h-9 shrink-0 rounded-full px-4"
                          onClick={() => {
                            markVersionSeen(t.id, t.version!)
                            toast({ title: `${t.name} updated ✓`, description: `Now on v${t.version}` })
                          }}
                        >
                          Update
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* v2.1 — editorial collections */}
              <div>
                <SectionHead title="Collections" icon={Sparkles} />
                <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                  {COLLECTIONS.map((c) => {
                    const picks = c.appIds.map((id) => getToolById(id)).filter((t): t is Tool => Boolean(t))
                    const Icon = c.icon
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setView({ type: 'collection', id: c.id })}
                        aria-label={`Open collection ${c.title}`}
                        className={cn(
                          'relative flex h-36 w-64 shrink-0 flex-col justify-between overflow-hidden rounded-3xl p-4 text-left text-white ring-1 ring-black/10 shadow-lg transition-transform active:scale-[0.98]',
                          'bg-gradient-to-br',
                          c.gradient
                        )}
                      >
                        <span className="pointer-events-none absolute -right-4 -top-6 opacity-20" aria-hidden>
                          <Icon className="size-28" strokeWidth={1.2} />
                        </span>
                        <span className="relative">
                          <span className="block text-base font-extrabold leading-tight">{c.title}</span>
                          <span className="mt-0.5 block text-xs text-white/85">{c.blurb}</span>
                        </span>
                        <span className="relative flex items-center gap-1.5">
                          {picks.slice(0, 4).map((t) => (
                            <span
                              key={t.id}
                              className="grid size-7 place-items-center rounded-lg bg-white/20 ring-1 ring-white/30 backdrop-blur"
                            >
                              <t.icon className="size-4" aria-hidden />
                            </span>
                          ))}
                          <span className="ml-auto flex items-center gap-0.5 text-xs font-semibold text-white/90">
                            {picks.length} <ChevronRight className="size-3.5" aria-hidden />
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* owner-curated linked platforms */}
              {externalApps.length > 0 && (
                <div>
                  <SectionHead title="My Platforms" icon={Globe} />
                  {platformCats.length > 1 && (
                    <div className="no-scrollbar -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                      <button
                        type="button"
                        onClick={() => setPlatformFilter('all')}
                        aria-pressed={platformFilter === 'all'}
                        className={cn(
                          'h-7 shrink-0 rounded-full px-3 text-xs font-semibold transition',
                          platformFilter === 'all'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-muted/70'
                        )}
                      >
                        All · {externalApps.length}
                      </button>
                      {platformCats.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setPlatformFilter(c.id)}
                          aria-pressed={platformFilter === c.id}
                          className={cn(
                            'h-7 shrink-0 rounded-full px-3 text-xs font-semibold transition',
                            platformFilter === c.id
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-muted/70'
                          )}
                        >
                          {c.name} · {c.count}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
                    {shownPlatforms.map((t) => (
                      <AppCard
                        key={t.id}
                        tool={t}
                        installed={installedIds.includes(t.id)}
                        onShow={() => showTool(t.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

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
                    const count = allTools.filter((t) => t.category === c.id).length
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

          {/* ---------------- COLLECTION (v2.1) ---------------- */}
          {view.type === 'collection' && currentCollection && (
            <div className="space-y-4 pb-6">
              <div className={cn('rounded-3xl bg-gradient-to-br p-5 text-white shadow-lg ring-1 ring-black/10', currentCollection.gradient)}>
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/80">Editorial collection</p>
                <h2 className="mt-0.5 text-xl font-extrabold">{currentCollection.title}</h2>
                <p className="mt-1 text-sm text-white/85">{currentCollection.blurb}</p>
              </div>
              <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card px-4 shadow-sm">
                {collectionTools.map((t) => (
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

          {/* ---------------- CATEGORY ---------------- */}
          {view.type === 'category' && currentCategory && (
            <div className="pb-6">
              <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card px-4 shadow-sm">
                {allTools
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
              onCopyLink={
                currentApp.external ? () => void copyPlatformLink(currentApp.id, currentApp.name) : undefined
              }
              onShow={showTool}
              installedIds={installedIds}
              catalog={allTools}
              updateAvailable={updates.some((u) => u.id === currentApp.id)}
              onUpdate={() => {
                if (currentApp.version) {
                  markVersionSeen(currentApp.id, currentApp.version)
                  toast({ title: `${currentApp.name} updated ✓`, description: `Now on v${currentApp.version}` })
                }
              }}
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
              catalog={allTools}
            />
          )}

          {/* ---------------- SEARCH ---------------- */}
          {view.type === 'search' && (
            <div className="space-y-5 pb-6">
              {!query.trim() ? (
                <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
                  <Search className="size-8 opacity-50" aria-hidden />
                  <p className="text-sm">Search {allTools.length} apps — try “photo”, “convert” or “game”</p>
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
