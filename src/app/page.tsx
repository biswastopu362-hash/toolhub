'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Folder,
  Search,
  SearchX,
  Star,
  WifiOff,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useHydrated } from '@/hooks/use-hydrated'
import { useAppStore, type WallpaperId } from '@/lib/store/app-store'
import {
  getToolById,
  searchTools,
  toolCategories,
  tools,
  type Tool,
  type ToolCategoryId,
} from '@/lib/tools/registry'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const DOCK_IDS = ['calculator', 'clock', 'weather', 'notes']

const WALLPAPER_CLASS: Record<WallpaperId, string> = {
  sunset: 'wp-sunset',
  ocean: 'wp-ocean',
  forest: 'wp-forest',
  midnight: 'wp-midnight',
}

/* ================================================================== */
/* Page — the whole "phone OS" lives on this single route              */
/* Home: #/        App: #/app/<id> (legacy #/tool/<id> also works)     */
/* ================================================================== */

export default function Home() {
  const [hash, navigate] = useHashRoute()
  const hydrated = useHydrated()
  const wallpaper = useAppStore((s) => s.wallpaper)

  const appId = useMemo(() => {
    if (hash.startsWith('#/app/')) return decodeURIComponent(hash.replace('#/app/', ''))
    if (hash.startsWith('#/tool/')) return decodeURIComponent(hash.replace('#/tool/', ''))
    return null
  }, [hash])

  const app = getToolById(appId)
  const showApp = hydrated && Boolean(app)
  const wallpaperId = hydrated ? wallpaper : 'sunset'

  const openApp = useCallback(
    (id: string) => {
      useAppStore.getState().addRecent(id)
      navigate(`#/app/${id}`)
    },
    [navigate]
  )

  const goHome = useCallback(() => navigate('#/'), [navigate])

  const [spotlightOpen, setSpotlightOpen] = useState(false)

  return (
    <div
      className={cn(
        'wallpaper relative h-dvh w-full overflow-hidden',
        WALLPAPER_CLASS[wallpaperId] ?? WALLPAPER_CLASS.sunset
      )}
    >
      {/* subtle vignette for depth */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/10" />

      <HomeScreen onOpenApp={openApp} onOpenSearch={() => setSpotlightOpen(true)} />

      {/* Spotlight search overlay */}
      <AnimatePresence>
        {spotlightOpen && (
          <Spotlight
            key="spotlight"
            onOpenApp={(id) => {
              setSpotlightOpen(false)
              openApp(id)
            }}
            onClose={() => setSpotlightOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Full-screen app window with iOS-like zoom transition */}
      <AnimatePresence>
        {showApp && app && (
          <AppWindow key={app.id} app={app} onHome={goHome} />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ================================================================== */
/* Home screen: status bar + pages + dots + dock                       */
/* ================================================================== */

function HomeScreen({
  onOpenApp,
  onOpenSearch,
}: {
  onOpenApp: (id: string) => void
  onOpenSearch: () => void
}) {
  const pagesRef = useRef<HTMLDivElement>(null)
  const grid = useGridMetrics(pagesRef)
  const [activePage, setActivePage] = useState(0)
  const [openFolder, setOpenFolder] = useState<ToolCategoryId | null>(null)

  const capacity = grid.cols * grid.rows

  const pages = useMemo(() => {
    const out: Tool[][] = []
    for (let i = 0; i < tools.length; i += capacity) out.push(tools.slice(i, i + capacity))
    return out
  }, [capacity])

  const dockApps = useMemo(
    () => DOCK_IDS.map((id) => getToolById(id)).filter((t): t is Tool => Boolean(t)),
    []
  )

  const pageCount = pages.length + 1 // + App Library page

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setActivePage(Math.max(0, Math.round(el.scrollLeft / Math.max(1, el.clientWidth))))
  }, [])

  const scrollToPage = useCallback(
    (index: number) => {
      const el = pagesRef.current
      if (!el) return
      el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' })
    },
    []
  )

  return (
    <>
      <StatusBar onOpenSearch={onOpenSearch} />

      {/* Pages (horizontal scroll-snap) */}
      <div
        ref={pagesRef}
        onScroll={onScroll}
        className="no-scrollbar absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden pb-32 pt-[max(3.25rem,calc(env(safe-area-inset-top)+2.5rem))]"
        aria-label="Home screen pages"
      >
        {pages.map((pageApps, i) => (
          <section
            key={`page-${i}`}
            aria-label={`Page ${i + 1}`}
            className="no-scrollbar h-full w-full shrink-0 snap-center overflow-y-auto px-5 sm:px-10"
          >
            <div
              className="grid content-start justify-items-center gap-x-1 gap-y-4 pt-2"
              style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}
            >
              {pageApps.map((t) => (
                <AppIcon key={t.id} tool={t} onOpen={() => onOpenApp(t.id)} />
              ))}
            </div>
          </section>
        ))}

        {/* App Library page — always the last page */}
        <section
          aria-label="App Library"
          className="h-full w-full shrink-0 snap-center overflow-y-auto px-5 sm:px-10"
        >
          <AppLibrary onOpenApp={onOpenApp} onOpenFolder={setOpenFolder} />
        </section>
      </div>

      {/* Page dots */}
      <div className="absolute inset-x-0 bottom-28 z-20 flex justify-center gap-2">
        {Array.from({ length: pageCount }).map((_, i) => (
          <button
            key={i}
            onClick={() => scrollToPage(i)}
            aria-label={`Go to page ${i + 1}`}
            aria-current={activePage === i}
            className="p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded-full"
          >
            <span
              className={cn(
                'block h-1.5 w-1.5 rounded-full transition-colors',
                activePage === i ? 'bg-white' : 'bg-white/40 hover:bg-white/60'
              )}
            />
          </button>
        ))}
      </div>

      {/* Dock */}
      <div className="absolute inset-x-0 bottom-0 z-20 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto w-fit max-w-[calc(100%-2rem)] rounded-[1.75rem] bg-white/15 px-4 py-3 shadow-lg ring-1 ring-white/25 backdrop-blur-xl">
          <div className="flex gap-6">
            {dockApps.map((t) => (
              <AppIcon key={`dock-${t.id}`} tool={t} onOpen={() => onOpenApp(t.id)} noLabel />
            ))}
          </div>
        </div>
      </div>

      {/* Folder overlay — lives OUTSIDE the scroll container so it covers the screen */}
      <AnimatePresence>
        {openFolder && (
          <FolderOverlay
            key="folder"
            categoryId={openFolder}
            onOpenApp={(id) => {
              setOpenFolder(null)
              onOpenApp(id)
            }}
            onClose={() => setOpenFolder(null)}
          />
        )}
      </AnimatePresence>
    </>
  )
}

/* ================================================================== */
/* Grid metrics — responsive cols/rows via ResizeObserver              */
/* ================================================================== */

function useGridMetrics(ref: React.RefObject<HTMLDivElement | null>) {
  const [grid, setGrid] = useState({ cols: 4, rows: 4 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const cols = Math.min(8, Math.max(4, Math.floor((el.clientWidth - 40) / 92)))
      const rows = Math.min(5, Math.max(2, Math.floor((el.clientHeight - 176) / 106)))
      setGrid((g) => (g.cols === cols && g.rows === rows ? g : { cols, rows }))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return grid
}

/* ================================================================== */
/* Status bar — live clock, battery, online state, search              */
/* ================================================================== */

function StatusBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const [time, setTime] = useState<string | null>(null)
  const [online, setOnline] = useState(() =>
    typeof window !== 'undefined' ? navigator.onLine : true
  )
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null)

  useEffect(() => {
    const update = () =>
      setTime(
        new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      )
    update()
    const id = setInterval(update, 15_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    interface BatteryLike extends EventTarget {
      level: number
      charging: boolean
      addEventListener: (type: string, cb: () => void) => void
      removeEventListener: (type: string, cb: () => void) => void
    }
    let active = true
    let battery: BatteryLike | null = null
    const sync = () => {
      if (battery && active) setBattery({ level: battery.level, charging: battery.charging })
    }
    if ('getBattery' in navigator) {
      ;(navigator as unknown as { getBattery: () => Promise<BatteryLike> })
        .getBattery()
        .then((b) => {
          battery = b
          sync()
          b.addEventListener('levelchange', sync)
          b.addEventListener('chargingchange', sync)
        })
        .catch(() => {})
    }
    return () => {
      active = false
      if (battery) {
        battery.removeEventListener('levelchange', sync)
        battery.removeEventListener('chargingchange', sync)
      }
    }
  }, [])

  return (
    <header className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 pb-2 pt-[max(0.9rem,env(safe-area-inset-top))] text-sm font-semibold text-white drop-shadow-md">
      <time suppressHydrationWarning>{time ?? '--:--'}</time>

      <div className="flex items-center gap-3">
        {!online && (
          <span className="flex items-center gap-1" title="Offline">
            <WifiOff className="h-4 w-4" aria-label="Offline" />
          </span>
        )}
        {battery && (
          <span className="flex items-center gap-1 tabular-nums">
            <span className="text-xs">{Math.round(battery.level * 100)}%</span>
            <BatteryGlyph level={battery.level} charging={battery.charging} />
          </span>
        )}
        <button
          onClick={onOpenSearch}
          aria-label="Search apps"
          className="rounded-full p-1 transition-colors hover:bg-white/15 active:scale-90"
        >
          <Search className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  )
}

function BatteryGlyph({ level, charging }: { level: number; charging: boolean }) {
  if (charging) return <BatteryCharging className="h-4.5 w-4.5" />
  if (level > 0.75) return <BatteryFull className="h-4.5 w-4.5" />
  if (level > 0.35) return <BatteryMedium className="h-4.5 w-4.5" />
  return <BatteryLow className="h-4.5 w-4.5" />
}

/* ================================================================== */
/* App icon                                                            */
/* ================================================================== */

function AppIcon({
  tool,
  onOpen,
  noLabel = false,
}: {
  tool: Tool
  onOpen: () => void
  noLabel?: boolean
}) {
  return (
    <button
      onClick={onOpen}
      aria-label={`Open ${tool.name}`}
      className="group flex w-full flex-col items-center gap-1.5 rounded-2xl p-1 transition-transform duration-150 ease-out hover:scale-[1.04] active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      <span
        className={cn(
          'flex size-[60px] items-center justify-center rounded-[1.15rem] bg-gradient-to-br text-white shadow-[0_6px_16px_rgba(0,0,0,0.35),inset_0_1px_1px_rgba(255,255,255,0.35)] ring-1 ring-white/20 sm:size-[66px] sm:rounded-[1.3rem]',
          tool.gradient
        )}
      >
        <tool.icon className="h-[52%] w-[52%]" strokeWidth={1.9} aria-hidden />
      </span>
      {!noLabel && (
        <span className="max-w-[88px] truncate text-[11px] font-medium leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)] sm:text-xs">
          {tool.name}
        </span>
      )}
    </button>
  )
}

/* ================================================================== */
/* Spotlight search overlay                                            */
/* ================================================================== */

function Spotlight({
  onOpenApp,
  onClose,
}: {
  onOpenApp: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const hydrated = useHydrated()
  const recents = useAppStore((s) => s.recents)

  const results = useMemo(() => searchTools(query, 'all'), [query])
  const recentTools = useMemo(
    () =>
      hydrated
        ? recents.map((id) => getToolById(id)).filter((t): t is Tool => Boolean(t))
        : [],
    [recents, hydrated]
  )
  const searching = query.trim().length > 0

  const list = searching ? results : tools

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && list.length > 0) onOpenApp(list[0].id)
  }

  return (
    <motion.div
      initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
      animate={{ opacity: 1, backdropFilter: 'blur(24px)' }}
      exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
      transition={{ duration: 0.22 }}
      className="absolute inset-0 z-40 flex flex-col bg-black/40 px-4 pt-[max(3rem,calc(env(safe-area-inset-top)+2rem))] backdrop-blur-2xl"
      onClick={onClose}
      role="dialog"
      aria-label="Search apps"
    >
      <div className="mx-auto w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
        <motion.div
          initial={{ y: -12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.05 }}
        >
          <div className="flex items-center gap-2 rounded-2xl bg-white/15 px-4 ring-1 ring-white/25 focus-within:ring-white/50">
            <Search className="h-5 w-5 shrink-0 text-white/80" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search apps"
              aria-label="Search apps"
              className="h-12 w-full bg-transparent text-base text-white placeholder:text-white/50 focus:outline-none"
            />
            <button
              onClick={onClose}
              aria-label="Close search"
              className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-sm font-medium text-white transition hover:bg-white/30"
            >
              Cancel
            </button>
          </div>
        </motion.div>

        <div className="no-scrollbar mt-4 max-h-[62vh] space-y-4 overflow-y-auto pb-8">
          {/* Recents (only when not searching) */}
          {!searching && recentTools.length > 0 && (
            <section aria-label="Recent apps">
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-white/60">
                Recent
              </h2>
              <div className="flex flex-wrap gap-2">
                {recentTools.map((t) => (
                  <button
                    key={`recent-${t.id}`}
                    onClick={() => onOpenApp(t.id)}
                    className="flex items-center gap-2 rounded-full bg-white/15 py-1.5 pl-1.5 pr-4 text-sm font-medium text-white ring-1 ring-white/20 transition hover:bg-white/25 active:scale-95"
                  >
                    <span
                      className={cn(
                        'flex size-7 items-center justify-center rounded-full bg-gradient-to-br text-white',
                        t.gradient
                      )}
                    >
                      <t.icon className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    {t.name}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* All / matching apps */}
          <section aria-label={searching ? 'Search results' : 'All apps'}>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-white/60">
              {searching ? `Results for “${query.trim()}”` : 'All Apps'}
            </h2>
            {list.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-white/70">
                <SearchX className="h-8 w-8" aria-hidden />
                <p className="text-sm">No apps found for “{query.trim()}”</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/15">
                {list.map((t, i) => (
                  <button
                    key={t.id}
                    onClick={() => onOpenApp(t.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition hover:bg-white/15 active:bg-white/20',
                      i > 0 && 'border-t border-white/10'
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ring-1 ring-white/20',
                        t.gradient
                      )}
                    >
                      <t.icon className="h-4.5 w-4.5" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">
                        {t.name}
                      </span>
                      <span className="block truncate text-xs text-white/60">{t.description}</span>
                    </span>
                    <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-white/45">
                      {toolCategories.find((c) => c.id === t.category)?.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </motion.div>
  )
}

/* ================================================================== */
/* App Library (last page) — auto-grouped folders                      */
/* ================================================================== */

function AppLibrary({
  onOpenApp,
  onOpenFolder,
}: {
  onOpenApp: (id: string) => void
  onOpenFolder: (id: ToolCategoryId) => void
}) {
  const folders = useMemo(
    () =>
      toolCategories
        .map((c) => ({ cat: c, items: tools.filter((t) => t.category === c.id) }))
        .filter(({ items }) => items.length > 0),
    []
  )

  return (
    <div className="mx-auto max-w-2xl pt-6">
      <h1 className="mb-5 text-center text-lg font-bold text-white drop-shadow-md">App Library</h1>
      <div className="grid grid-cols-2 justify-items-center gap-x-3 gap-y-6 sm:grid-cols-3">
        {folders.map(({ cat, items }) => (
          <button
            key={cat.id}
            onClick={() => onOpenFolder(cat.id)}
            aria-label={`Open ${cat.name} folder, ${items.length} apps`}
            className="group flex w-full max-w-[150px] flex-col items-center gap-2 rounded-2xl p-1 transition-transform hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <span className="grid w-full grid-cols-2 gap-1.5 rounded-[1.4rem] bg-white/15 p-2.5 shadow-lg ring-1 ring-white/25 backdrop-blur-xl">
              {items.slice(0, 4).map((t) => (
                <span
                  key={t.id}
                  className={cn(
                    'flex aspect-square items-center justify-center rounded-[0.7rem] bg-gradient-to-br text-white shadow-sm ring-1 ring-white/20',
                    t.gradient
                  )}
                >
                  <t.icon className="h-[55%] w-[55%]" strokeWidth={1.9} aria-hidden />
                </span>
              ))}
              {items.length > 4 && (
                <span className="col-span-2 flex items-center justify-center gap-1 pt-0.5 text-[10px] font-semibold text-white/80">
                  <Folder className="h-3 w-3" aria-hidden /> {items.length} apps
                </span>
              )}
            </span>
            <span className="truncate text-xs font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
              {cat.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function FolderOverlay({
  categoryId,
  onOpenApp,
  onClose,
}: {
  categoryId: ToolCategoryId
  onOpenApp: (id: string) => void
  onClose: () => void
}) {
  const cat = toolCategories.find((c) => c.id === categoryId)
  const items = tools.filter((t) => t.category === categoryId)

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-6 backdrop-blur-2xl"
      onClick={onClose}
      role="dialog"
      aria-label={`${cat?.name ?? 'Folder'} apps`}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="w-full max-w-md rounded-3xl bg-white/12 p-5 ring-1 ring-white/25 backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold text-white">{cat?.name}</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close folder"
            className="h-8 w-8 rounded-full text-white hover:bg-white/20"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="no-scrollbar grid max-h-[56vh] grid-cols-4 gap-x-2 gap-y-5 overflow-y-auto">
          {items.map((t) => (
            <AppIcon key={t.id} tool={t} onOpen={() => onOpenApp(t.id)} />
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ================================================================== */
/* App window — full-screen with zoom transition + home indicator      */
/* ================================================================== */

function AppWindow({ app, onHome }: { app: Tool; onHome: () => void }) {
  const favorites = useAppStore((s) => s.favorites)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const isFav = favorites.includes(app.id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onHome()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onHome])

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.84, y: 30 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.84, y: 30 }}
      transition={{ type: 'spring', stiffness: 380, damping: 36 }}
      className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground"
      role="dialog"
      aria-label={app.name}
    >
      {/* App header */}
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b bg-background/85 px-3 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          onClick={onHome}
          aria-label="Go home"
          className="h-10 w-10 shrink-0 rounded-xl"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ring-1 ring-black/5',
            app.gradient
          )}
        >
          <app.icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold leading-tight">{app.name}</h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {toolCategories.find((c) => c.id === app.category)?.name}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => toggleFavorite(app.id)}
          aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={isFav}
          className="h-10 w-10 shrink-0 rounded-xl"
        >
          <Star className={cn('h-5 w-5', isFav && 'fill-amber-400 text-amber-500')} />
        </Button>
      </header>

      {/* App body */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-5">
          <app.Component />
        </div>
      </div>

      {/* Home indicator */}
      <button
        onClick={onHome}
        aria-label="Go home"
        className="group absolute bottom-[max(0.4rem,env(safe-area-inset-bottom))] left-1/2 z-10 -translate-x-1/2 p-2 focus-visible:outline-none"
      >
        <span className="block h-[5px] w-32 rounded-full bg-foreground/25 transition-colors group-hover:bg-foreground/50" />
      </button>
    </motion.div>
  )
}
