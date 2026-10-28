'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import {
  ArrowLeft,
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Bell,
  Folder,
  Info,
  LayoutGrid,
  ListChecks,
  Palette,
  PencilLine,
  Play,
  Plus,
  Search,
  SearchX,
  Star,
  Trash2,
  WifiOff,
  X,
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
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { ControlCenter } from '@/components/control-center'
import { InstallBanner } from '@/components/pwa/install-banner'
import { LockGate } from '@/components/os/lock-gate'
import { WidgetStrip } from '@/components/os/home-widgets'
import { NotificationShade } from '@/components/os/notification-shade'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useHydrated } from '@/hooks/use-hydrated'
import { useAppStore } from '@/lib/store/app-store'
import { DEFAULT_WALLPAPER, getWallpaper, wallpaperIsDark, type WallpaperId } from '@/lib/theme'
import { setPendingShare } from '@/lib/share'
import { buildLiveFeed } from '@/lib/os/notifications'
import {
  addToFolderOp,
  createFolderOp,
  mergeFoldersOp,
  migrateLayout,
  moveItemOp,
  removeFromFolderOp,
  renameFolderOp,
  suggestFolderName,
  type HomeFolderItem,
  type HomeItem,
} from '@/lib/home-layout'
import {
  getToolById,
  searchTools,
  toolCategories,
  tools,
  type Tool,
  type ToolCategoryId,
} from '@/lib/tools/registry'
import { useExternalApps } from '@/lib/tools/external'
import { cn } from '@/lib/utils'
import { DOCK_IDS } from '@/lib/constants'
import { setPendingTransfer } from '@/lib/transfer'
import { useHomeDrag } from '@/components/home/use-home-drag'

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

type OpenFolder = { kind: 'user'; id: string } | { kind: 'category'; id: ToolCategoryId } | null

/** Viewport-space rect of the icon a window launched from (iPad-style zoom). */
interface IconRect {
  left: number
  top: number
  width: number
  height: number
}

function tileRectOf(el: HTMLElement | null | undefined): IconRect | null {
  const tile = el?.querySelector('[data-tile-id]') as HTMLElement | null
  if (!tile) return null
  const r = tile.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

/* ================================================================== */
/* Page — the whole "phone OS" lives on this single route              */
/* Home: #/        App: #/app/<id> (legacy #/tool/<id> also works)     */
/* ================================================================== */

export default function Home() {
  const [hash, navigate] = useHashRoute()
  const hydrated = useHydrated()
  const wallpaper = useAppStore((s) => s.wallpaper)
  /* D39: active user-designed wallpaper (stable ref; null when none) */
  const activeCustom = useAppStore(
    (s) => s.customWallpapers.find((c) => c.id === s.activeCustomId) ?? null
  )

  const appId = useMemo(() => {
    if (hash.startsWith('#/app/')) return decodeURIComponent(hash.replace('#/app/', ''))
    if (hash.startsWith('#/tool/')) return decodeURIComponent(hash.replace('#/tool/', ''))
    return null
  }, [hash])

  const app = getToolById(appId)
  const showApp = hydrated && Boolean(app)
  const wallpaperId = hydrated ? wallpaper : DEFAULT_WALLPAPER

  /* one-time consistency pass for the persisted home layout (installed only) */
  useEffect(() => {
    if (!hydrated) return
    const s = useAppStore.getState()
    if (s.layoutMigrated) return
    const next = migrateLayout(s.layout, s.installed, [...DOCK_IDS])
    if (next) s.setLayout(next)
    s.setLayoutMigrated()
  }, [hydrated])

  /* fetch the admin-curated linked platforms once per session */
  useEffect(() => {
    if (!hydrated) return
    void useExternalApps.getState().reload()
  }, [hydrated])

  /*
   * If the owner removes a linked platform server-side, home-screen
   * shortcuts would become ghosts — prune them quietly after each load.
   */
  const externalVersion = useExternalApps((s) => s.version)
  const externalsLoaded = useExternalApps((s) => s.loaded)
  useEffect(() => {
    if (!hydrated || !externalsLoaded) return
    const s = useAppStore.getState()
    const ghosts = s.installed.filter(
      (id) => !tools.some((t) => t.id === id) && !useExternalApps.getState().apps.some((a) => a.id === id)
    )
    if (ghosts.length === 0) return
    // Only touch ids that were linked platforms (never user data of built-ins).
    for (const id of ghosts) s.uninstallApp(id)
  }, [hydrated, externalsLoaded, externalVersion])

  /* icon rect the current window zoomed out of (for the open animation) */
  const [winOrigin, setWinOrigin] = useState<IconRect | null>(null)
  /* app currently waiting behind the App Lock PIN gate */
  const [lockAppId, setLockAppId] = useState<string | null>(null)

  /*
   * Wallpaper rendering: only the LIVE layer (+ the outgoing one during a
   * 700ms crossfade) is mounted. Stacking all 12 wallpapers used to cost
   * ~10× the GPU memory on phones — the #1 mobile-lag offender.
   */
  const [prevWp, setPrevWp] = useState<WallpaperId | null>(null)
  const [wpOn, setWpOn] = useState(false)
  const wpRef = useRef(wallpaperId)
  useEffect(() => {
    if (wpRef.current === wallpaperId) return
    setPrevWp(wpRef.current)
    wpRef.current = wallpaperId
    setWpOn(false)
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setWpOn(true))
    })
    const t = setTimeout(() => setPrevWp(null), 800)
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
      clearTimeout(t)
    }
  }, [wallpaperId])
  useEffect(() => {
    const raf = requestAnimationFrame(() => setWpOn(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const openApp = useCallback(
    (id: string, origin?: HTMLElement | null) => {
      try {
        navigator.vibrate?.(8)
      } catch {
        /* haptics unsupported */
      }
      /* D9 App Lock: locked apps open the PIN gate instead of the app */
      const lock = useAppStore.getState().appLock
      if (lock?.enabled && lock.lockedApps.includes(id)) {
        setLockAppId(id)
        return
      }
      setWinOrigin(tileRectOf(origin))
      useAppStore.getState().addRecent(id)
      navigate(`#/app/${id}`)
    },
    [navigate]
  )

  /** Deep-open the store on an app's detail page (from Spotlight / Library). */
  const openInStore = useCallback(
    (id: string) => {
      useAppStore.getState().setStoreDeepLink(id)
      openApp('store')
    },
    [openApp]
  )

  /* apps (e.g. the store) can request the shell to open another app */
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (typeof id === 'string') openApp(id)
    }
    window.addEventListener('toolhub:open-app', handler)
    return () => window.removeEventListener('toolhub:open-app', handler)
  }, [openApp])

  /* Deep links from queries: /?transfer=<id> (Video Studio relay),
     /?title=&text=&url= (D70 Web Share Target → Notes) and /?shortcut=<id>
     (D71 manifest shortcuts). The navigation is deferred to a microtask
     so no state is set synchronously inside the effect body. */
  useEffect(() => {
    if (!hydrated) return
    const sp = new URLSearchParams(window.location.search)
    const tid = sp.get('transfer')
    const shareTitle = sp.get('title')
    const shareText = sp.get('text')
    const shareUrl = sp.get('url')
    const shortcut = sp.get('shortcut')
    const hasShare = Boolean(shareTitle || shareText || shareUrl)
    if (!tid && !hasShare && !shortcut) return
    for (const k of ['transfer', 'title', 'text', 'url', 'shortcut']) sp.delete(k)
    const qs = sp.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`
    )

    if (tid) {
      setPendingTransfer(tid)
      queueMicrotask(() => {
        useAppStore.getState().addRecent('video-studio')
        if (window.location.hash !== '#/app/video-studio') window.location.hash = '#/app/video-studio'
        window.dispatchEvent(new CustomEvent('toolhub:transfer'))
      })
    }

    if (hasShare) {
      setPendingShare({
        title: shareTitle ?? undefined,
        text: shareText ?? undefined,
        url: shareUrl ?? undefined,
        source: 'share-target',
      })
      queueMicrotask(() => {
        useAppStore.getState().addRecent('notes')
        if (window.location.hash !== '#/app/notes') window.location.hash = '#/app/notes'
      })
    }

    if (shortcut && getToolById(shortcut)) {
      queueMicrotask(() => openApp(shortcut))
    }
  }, [hydrated, openApp])

  const goHome = useCallback(() => navigate('#/'), [navigate])

  const [spotlightOpen, setSpotlightOpen] = useState(false)
  const [ccOpen, setCcOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const liveCustom = wallpaperId === 'custom' ? activeCustom : null
  const wpDark = wallpaperIsDark(wallpaperId, liveCustom)

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative h-dvh w-full overflow-hidden">
        {/* live wallpaper (+ outgoing layer during a crossfade) */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {prevWp && (
            <div
              aria-hidden
              data-off="true"
              className={cn(
                'wp-layer',
                !(prevWp === 'custom' && activeCustom) && getWallpaper(prevWp).className
              )}
              style={{ background: prevWp === 'custom' ? activeCustom?.css : undefined, opacity: 1 }}
            />
          )}
          <div
            /* drift blobs pause while an app window covers the launcher —
               an always-on composite of two full-screen layers burned GPU
               on mid-range phones even when the wallpaper was invisible */
            data-off={showApp || !wpOn ? 'true' : 'false'}
            className={cn(
              'wp-layer',
              !liveCustom && getWallpaper(wallpaperId).className
            )}
            style={{
              /* D39: 'custom' renders the composed CSS; with no active def
                 the preset fallback (DEFAULT_WALLPAPER) is used instead */
              background: liveCustom?.css,
              opacity: wpOn ? 1 : 0,
            }}
          />
          {/* film grain + soft top light + gentle edge vignette */}
          <div className="wp-noise absolute inset-0" />
          <div className={cn('wp-veil absolute inset-0', wpDark ? 'wp-veil-dark' : 'wp-veil-light')} />
        </div>

        <motion.div
          aria-hidden={showApp}
          className="absolute inset-0"
          animate={showApp ? { scale: 0.92, opacity: 0.4 } : { scale: 1, opacity: 1 }}
          transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
        >
          <HomeScreen
            onOpenApp={openApp}
            onOpenSearch={() => setSpotlightOpen(true)}
            onOpenCustomize={() => setCcOpen(true)}
            onOpenNotifications={() => setNotifOpen(true)}
            onOpenInStore={openInStore}
            editing={editing}
            setEditing={setEditing}
          />
        </motion.div>

        {/* Quick-settings control center */}
        <AnimatePresence>
          {ccOpen && (
            <ControlCenter
              key="cc"
              onClose={() => setCcOpen(false)}
              onOpenApp={openApp}
              onEditIcons={() => {
                setCcOpen(false)
                setEditing(true)
              }}
            />
          )}
        </AnimatePresence>

        {/* Spotlight search overlay */}
        <AnimatePresence>
          {spotlightOpen && (
            <Spotlight
              key="spotlight"
              onOpenApp={(id, el) => {
                setSpotlightOpen(false)
                openApp(id, el)
              }}
              onOpenInStore={openInStore}
              onClose={() => setSpotlightOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* D73: notification center shade */}
        <AnimatePresence>
          {notifOpen && (
            <NotificationShade
              key="notif-shade"
              onOpenApp={(id, el) => {
                setNotifOpen(false)
                openApp(id, el)
              }}
              onClose={() => setNotifOpen(false)}
            />
          )}
        </AnimatePresence>

        {/* Full-screen app window with iPad-style zoom transition */}
        <AnimatePresence>
          {showApp && app && <AppWindow key={app.id} app={app} onHome={goHome} originRect={winOrigin} />}
        </AnimatePresence>

        {/* App Lock PIN gate (D9) */}
        <AnimatePresence>
          {lockAppId && (
            <LockGate
              key="app-lock"
              appId={lockAppId}
              onUnlock={() => {
                const id = lockAppId
                setLockAppId(null)
                if (id) {
                  useAppStore.getState().addRecent(id)
                  navigate(`#/app/${id}`)
                }
              }}
              onCancel={() => setLockAppId(null)}
            />
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}

/* ================================================================== */
/* Home screen: status bar + pages + dots + dock + drag engine         */
/* ================================================================== */

function HomeScreen({
  onOpenApp,
  onOpenSearch,
  onOpenCustomize,
  onOpenNotifications,
  onOpenInStore,
  editing,
  setEditing,
}: {
  onOpenApp: (id: string, origin?: HTMLElement | null) => void
  onOpenSearch: () => void
  onOpenCustomize: () => void
  onOpenNotifications: () => void
  onOpenInStore: (id: string) => void
  editing: boolean
  setEditing: (v: boolean) => void
}) {
  const pagesRef = useRef<HTMLDivElement>(null)
  const gridEls = useRef<Map<number, HTMLDivElement>>(new Map())
  const grid = useGridMetrics(pagesRef)
  const [activePage, setActivePage] = useState(0)
  const [openFolder, setOpenFolder] = useState<OpenFolder>(null)
  const [installHint, setInstallHint] = useState(false)

  const layout = useAppStore((s) => s.layout)
  const installed = useAppStore((s) => s.installed)
  const onLight = !wallpaperIsDark(
    useAppStore((s) => s.wallpaper),
    useAppStore((s) => s.customWallpapers.find((c) => c.id === s.activeCustomId) ?? null)
  )
  const externalApps = useExternalApps((s) => s.apps)

  const installedTools = useMemo(
    () => installed.map((id) => getToolById(id)).filter((t): t is Tool => Boolean(t)),
    [installed, externalApps]
  )

  const capacity = grid.cols * grid.rows
  const pageCount = Math.max(1, Math.ceil(layout.length / capacity)) + 1 // + App Library

  const pages = useMemo(() => {
    const out: HomeItem[][] = []
    for (let i = 0; i < layout.length; i += capacity) out.push(layout.slice(i, i + capacity))
    if (out.length === 0) out.push([])
    return out
  }, [layout, capacity])

  const dockApps = useMemo(
    () => DOCK_IDS.map((id) => getToolById(id)).filter((t): t is Tool => Boolean(t)),
    []
  )

  const scrollToPage = useCallback((index: number) => {
    const el = pagesRef.current
    if (!el) return
    el.scrollTo({ left: index * el.clientWidth, behavior: 'smooth' })
  }, [])

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setActivePage(Math.max(0, Math.round(el.scrollLeft / Math.max(1, el.clientWidth))))
  }, [])

  /* ---------------- drag engine ---------------- */
  const handleMove = useCallback((from: number, to: number) => {
    const s = useAppStore.getState()
    s.setLayout(moveItemOp(s.layout, from, to))
  }, [])

  const handleDrop = useCallback((draggedId: string, overId: string | null) => {
    if (!overId || overId === draggedId) return
    const s = useAppStore.getState()
    const dragged = s.layout.find((i) => i.id === draggedId)
    const target = s.layout.find((i) => i.id === overId)
    if (!dragged || !target) return

    if (dragged.kind === 'app' && target.kind === 'app') {
      const { layout: next } = createFolderOp(s.layout, draggedId, overId)
      s.setLayout(next)
      try {
        navigator.vibrate?.(16)
      } catch {}
    } else if (dragged.kind === 'app' && target.kind === 'folder') {
      s.setLayout(addToFolderOp(s.layout, draggedId, overId))
      try {
        navigator.vibrate?.(12)
      } catch {}
    } else if (dragged.kind === 'folder' && target.kind === 'folder') {
      s.setLayout(mergeFoldersOp(s.layout, draggedId, overId))
      try {
        navigator.vibrate?.(12)
      } catch {}
    }
  }, [])

  /* D71: suppress the drag engine's edit-mode entry while a quick-actions
     menu is opening — long-press means "context menu", not jiggle mode */
  const suppressEditRef = useRef(0)
  const { view, ghostRef, onItemPointerDown, shouldSuppressClick, armedRef } = useHomeDrag({
    scrollerRef: pagesRef,
    gridEls,
    getMetrics: () => ({
      cols: grid.cols,
      capacity,
      itemCount: layout.length,
      pageCount,
    }),
    isEditing: () => editing,
    onEnterEdit: () => {
      if (Date.now() < suppressEditRef.current) return
      setEditing(true)
    },
    onMove: handleMove,
    onDrop: handleDrop,
    scrollToPage,
  })

  /* Escape exits edit mode */
  useEffect(() => {
    if (!editing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setEditing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, setEditing])

  const dragItem = view.draggingId ? layout.find((i) => i.id === view.draggingId) ?? null : null
  const dragTool = dragItem?.kind === 'app' ? getToolById(dragItem.id) : undefined

  return (
    <>
      <StatusBar
        onLight={onLight}
        editing={editing}
        onDone={() => setEditing(false)}
        onOpenSearch={onOpenSearch}
        onOpenCustomize={onOpenCustomize}
        onOpenNotifications={onOpenNotifications}
      />

      {/* One-tap PWA install (hidden while rearranging icons) */}
      <InstallBanner suppressed={editing} onVisibleChange={setInstallHint} />

      {/* Pages (horizontal scroll-snap) */}
      <div
        ref={pagesRef}
        onScroll={onScroll}
        onContextMenu={(e) => e.preventDefault()}
        className="no-scrollbar absolute inset-0 flex snap-x snap-mandatory select-none overflow-x-auto overflow-y-hidden pb-32 pt-[max(3.25rem,calc(env(safe-area-inset-top)+2.5rem))]"
        aria-label="Home screen pages"
      >
        {pages.map((items, page) => (
          <section
            key={`page-${page}`}
            aria-label={`Page ${page + 1}`}
            onClick={(e) => {
              if (editing && e.target === e.currentTarget) setEditing(false)
            }}
            className="no-scrollbar h-full w-full shrink-0 snap-center overflow-y-auto px-4 sm:px-10"
          >
            {/* banner clears + D72 widgets + grid share one padding wrapper */}
            <div
              className={`transition-[padding] duration-300 ease-out ${
                installHint ? 'pt-16' : 'pt-2'
              }`}
            >
              {page === 0 && <WidgetStrip onOpenApp={onOpenApp} onLight={onLight} />}
              <div
                ref={(el) => {
                  if (el) gridEls.current.set(page, el)
                  else gridEls.current.delete(page)
                }}
                className="mx-auto grid w-full max-w-[1080px] content-start justify-items-center gap-x-2 gap-y-4 sm:gap-y-5"
                style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}
              >
              {items.map((item, slot) => (
                <HomeItemView
                  key={item.id}
                  item={item}
                  index={page * capacity + slot}
                  editing={editing}
                  dragging={view.draggingId === item.id}
                  hinted={view.overId === item.id}
                  onLight={onLight}
                  onPointerDown={onItemPointerDown}
                  armedRef={armedRef}
                  onOpenInStore={onOpenInStore}
                  onEnterEditMode={() => setEditing(true)}
                  onQuickMenuOpen={() => {
                    suppressEditRef.current = Date.now() + 2000
                  }}
                  onClick={(e) => {
                    if (editing || shouldSuppressClick()) return
                    if (item.kind === 'app') onOpenApp(item.id, e.currentTarget)
                    else setOpenFolder({ kind: 'user', id: item.id })
                  }}
                />
              ))}
              </div>
            </div>
          </section>
        ))}

        {/* App Library page — always the last page */}
        <section
          aria-label="App Library"
          className="no-scrollbar h-full w-full shrink-0 snap-center overflow-y-auto px-4 sm:px-10"
        >
          <AppLibrary
            installedTools={installedTools}
            onOpenApp={onOpenApp}
            onOpenFolder={(id) => setOpenFolder({ kind: 'category', id })}
            onOpenStore={() => onOpenApp('store')}
          />
        </section>
      </div>

      {/* Page dots */}
      <div className="absolute inset-x-0 bottom-28 z-20 flex select-none justify-center gap-2">
        {Array.from({ length: pageCount }).map((_, i) => (
          <button
            key={i}
            onClick={() => scrollToPage(i)}
            aria-label={`Go to page ${i + 1}`}
            aria-current={activePage === i}
            className={cn(
              'rounded-full p-1.5 focus-visible:outline-none focus-visible:ring-2',
              onLight ? 'focus-visible:ring-zinc-900/50' : 'focus-visible:ring-white/70'
            )}
          >
            <span
              className={cn(
                'block h-1.5 w-1.5 rounded-full transition-all duration-300',
                activePage === i
                  ? onLight
                    ? 'w-4 bg-zinc-900/90'
                    : 'w-4 bg-white/95'
                  : onLight
                    ? 'bg-zinc-900/25 hover:bg-zinc-900/45'
                    : 'bg-white/35 hover:bg-white/55'
              )}
            />
          </button>
        ))}
      </div>

      {/* Dock */}
      <div className="absolute inset-x-0 bottom-0 z-20 select-none pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div
          className={cn(
            'mx-auto w-fit max-w-[calc(100%-1.5rem)] rounded-[1.9rem] px-3.5 py-3 backdrop-blur-2xl sm:px-5 sm:py-3.5',
            onLight
              ? 'bg-white/60 ring-1 ring-black/[0.08] shadow-[0_16px_36px_-14px_rgb(0_0_0/0.28),inset_0_1px_1px_rgb(255_255_255/0.7)]'
              : 'bg-white/10 ring-1 ring-white/15 shadow-[0_16px_36px_-14px_rgb(0_0_0/0.45),inset_0_1px_1px_rgb(255_255_255/0.15)]'
          )}
        >
          <div className="flex items-end gap-3 sm:gap-5 md:gap-6">
            {dockApps.map((t) => (
              <motion.button
                key={`dock-${t.id}`}
                whileTap={{ scale: 0.86 }}
                transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                onClick={(e) => onOpenApp(t.id, e.currentTarget)}
                aria-label={`Open ${t.name}`}
                className="w-12 shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 sm:w-[56px] md:w-[62px]"
              >
                <IconTile tool={t} />
              </motion.button>
            ))}
          </div>
        </div>
      </div>

      {/* Folder overlay — lives OUTSIDE the scroll container so it covers the screen */}
      <AnimatePresence>
        {openFolder && (
          <FolderOverlay
            key="folder"
            target={openFolder}
            onOpenApp={(id, el) => {
              setOpenFolder(null)
              onOpenApp(id, el)
            }}
            onClose={() => setOpenFolder(null)}
          />
        )}
      </AnimatePresence>

      {/* Floating drag ghost (positioned imperatively by the drag engine) */}
      <div ref={ghostRef} className="drag-ghost" style={{ transform: 'translate3d(-9999px,-9999px,0)' }} aria-hidden>
        {dragItem?.kind === 'app' && dragTool && <IconTile tool={dragTool} />}
        {dragItem?.kind === 'folder' && <FolderTile item={dragItem} />}
      </div>
    </>
  )
}

/* ================================================================== */
/* Home item — app icon or folder, with jiggle + drag states           */
/* ================================================================== */

function HomeItemView({
  item,
  index,
  editing,
  dragging,
  hinted,
  onLight,
  onPointerDown,
  armedRef,
  onOpenInStore,
  onEnterEditMode,
  onQuickMenuOpen,
  onClick,
}: {
  item: HomeItem
  index: number
  editing: boolean
  dragging: boolean
  hinted: boolean
  onLight: boolean
  onPointerDown: (e: React.PointerEvent<HTMLElement>, id: string) => void
  armedRef: React.RefObject<boolean>
  onOpenInStore: (id: string) => void
  onEnterEditMode: () => void
  onQuickMenuOpen: () => void
  onClick: (e: React.MouseEvent<HTMLElement>) => void
}) {
  const { toast } = useToast()
  const [confirmRemove, setConfirmRemove] = useState(false)
  /* D71: long-press quick actions (context menu) */
  const [quickMenu, setQuickMenu] = useState(false)
  const lpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lpStartRef = useRef<{ x: number; y: number } | null>(null)
  const tool = item.kind === 'app' ? getToolById(item.id) : undefined
  const label =
    item.kind === 'app'
      ? (tool?.name ?? '')
      : item.name ||
        suggestFolderName(
          item.appIds,
          (id) => getToolById(id)?.category,
          (cid) => toolCategories.find((c) => c.id === cid)?.name
        )

  /*
   * While a drag is armed (edit mode active), cancel the browser's scroll
   * gesture on touchmove so the very first drag attempt works on mobile.
   * Requires a non-passive listener, hence the manual addEventListener.
   */
  const elRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    const onTouchMove = (e: TouchEvent) => {
      if (armedRef.current) e.preventDefault()
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [armedRef])

  /* long-press → quick actions (cancels on move/release/edit mode) */
  const clearLpTimer = () => {
    if (lpTimerRef.current) {
      clearTimeout(lpTimerRef.current)
      lpTimerRef.current = null
    }
  }
  useEffect(() => clearLpTimer, [])

  const onLpPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (editing || item.kind !== 'app') return
    lpStartRef.current = { x: e.clientX, y: e.clientY }
    clearLpTimer()
    lpTimerRef.current = setTimeout(() => {
      lpTimerRef.current = null
      lpStartRef.current = null
      onQuickMenuOpen()
      setQuickMenu(true)
      try {
        navigator.vibrate?.(12)
      } catch {}
    }, 400)
  }
  const onLpPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const start = lpStartRef.current
    if (!start) return
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
      lpStartRef.current = null
      clearLpTimer()
    }
  }
  const onLpPointerUp = () => {
    lpStartRef.current = null
    clearLpTimer()
  }

  return (
    <motion.div
      /* FLIP reflow only matters while rearranging icons — keeping `layout`
         always-on forces projection measurement on every render and made
         app open/close + scrolling janky on mid-range phones. */
      layout={editing ? true : undefined}
      data-item-id={item.id}
      data-item-index={index}
      initial={{ opacity: 0, scale: 0.55 }}
      animate={{ opacity: dragging ? 0.25 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.5 }}
      transition={{ type: 'spring', stiffness: 480, damping: 34, mass: 0.9 }}
      onPointerDown={(e) => {
        onLpPointerDown(e)
        onPointerDown(e, item.id)
      }}
      onPointerMove={onLpPointerMove}
      onPointerUp={onLpPointerUp}
      onPointerCancel={onLpPointerUp}
      onContextMenu={(e) => {
        e.preventDefault()
        if (item.kind === 'app' && !editing) setQuickMenu(true)
      }}
      onClick={onClick}
      className={cn('w-full cursor-pointer', editing && 'touch-none')}
      role="button"
      aria-label={item.kind === 'app' ? `Open ${label}` : `Open folder ${label}`}
      tabIndex={0}
      onKeyDown={(e) => {
        // keyboard activation reuses the keydown's currentTarget — identical element
        if (e.key === 'Enter' && !editing) onClick(e as unknown as React.MouseEvent<HTMLElement>)
      }}
    >
      {/* jiggle lives on an inner wrapper so framer's FLIP transform is untouched */}
      <div
        ref={elRef}
        className={cn('flex w-full flex-col items-center gap-1', editing && !dragging && 'jiggle')}
        style={
          editing && !dragging
            ? { animationDelay: `${(index % 7) * 45}ms`, animationDuration: `${0.3 + (index % 3) * 0.03}s` }
            : undefined
        }
      >
        {item.kind === 'app' && tool ? (
          <span className="relative block w-full">
            <IconTile tool={tool} hinted={hinted} />
            {/* edit-mode uninstall badge (system apps are protected) */}
            {editing && !dragging && !tool.system && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmRemove(true)
                }}
                aria-label={`Remove ${tool.name}`}
                className="absolute -left-2 -top-2 z-10 grid size-7 place-items-center rounded-full bg-white text-black shadow-lg ring-2 ring-black/10 transition hover:bg-red-500 hover:text-white active:scale-90"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
              </button>
            )}
          </span>
        ) : item.kind === 'folder' ? (
          <FolderTile item={item} hinted={hinted} />
        ) : null}
        <span
          className={cn(
            'w-full max-w-[4.75rem] truncate text-center text-[10.5px] font-medium leading-snug sm:text-xs',
            onLight
              ? 'text-zinc-900 drop-shadow-[0_1px_2px_rgba(255,255,255,0.7)]'
              : 'text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]'
          )}
        >
          {label}
        </span>
      </div>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {tool?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The app and its icon will be removed from this device. You can reinstall it anytime
              from the App Store.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (!tool) return
                useAppStore.getState().uninstallApp(tool.id)
                toast({
                  title: `${tool.name} uninstalled`,
                  description: 'Reinstall it anytime from the App Store.',
                })
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* D71: quick actions context menu */}
      <AnimatePresence>
        {quickMenu && tool && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-6 backdrop-blur-xl"
            /* close on pointerdown — the long-press release synthesizes a click
               on the backdrop that must NOT close the freshly opened menu */
            onPointerDown={() => setQuickMenu(false)}
            onClick={(e) => e.preventDefault()}
            role="dialog"
            aria-label={`${tool.name} quick actions`}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className="w-full max-w-xs overflow-hidden rounded-3xl bg-white/[0.14] p-4 ring-1 ring-white/25 backdrop-blur-2xl"
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center gap-3">
                <span className="w-12 shrink-0">
                  <IconTile tool={tool} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-white">{tool.name}</span>
                  <span className="block truncate text-[11px] text-white/60">{tool.tagline}</span>
                </span>
              </div>
              <div className="space-y-1">
                <button
                  onClick={() => {
                    setQuickMenu(false)
                    window.dispatchEvent(new CustomEvent<string>('toolhub:open-app', { detail: tool.id }))
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-white transition-colors hover:bg-white/15 active:bg-white/20"
                >
                  <Play className="size-4 text-emerald-400" aria-hidden /> Open
                </button>
                <button
                  onClick={() => {
                    const s = useAppStore.getState()
                    const wasFav = s.favorites.includes(tool.id)
                    s.toggleFavorite(tool.id)
                    toast({
                      title: wasFav ? `${tool.name} removed from favorites` : `${tool.name} favorited`,
                    })
                    setQuickMenu(false)
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-white transition-colors hover:bg-white/15 active:bg-white/20"
                >
                  <Star
                    className={cn(
                      'size-4 text-amber-400',
                      useAppStore.getState().favorites.includes(tool.id) && 'fill-amber-400'
                    )}
                    aria-hidden
                  />
                  {useAppStore.getState().favorites.includes(tool.id) ? 'Remove favorite' : 'Add to favorites'}
                </button>
                <button
                  onClick={() => {
                    setQuickMenu(false)
                    onOpenInStore(tool.id)
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-white transition-colors hover:bg-white/15 active:bg-white/20"
                >
                  <Info className="size-4 text-sky-400" aria-hidden /> App info
                </button>
                <button
                  onClick={() => {
                    setQuickMenu(false)
                    onEnterEditMode()
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-white transition-colors hover:bg-white/15 active:bg-white/20"
                >
                  <LayoutGrid className="size-4 text-violet-400" aria-hidden /> Edit Home Screen
                </button>
                {!tool.system && (
                  <button
                    onClick={() => {
                      setQuickMenu(false)
                      setConfirmRemove(true)
                    }}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm font-semibold text-rose-400 transition-colors hover:bg-rose-500/15 active:bg-rose-500/25"
                  >
                    <Trash2 className="size-4" aria-hidden /> Uninstall
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ================================================================== */
/* Premium icon tile — squircle, gloss, per-app glow shadow            */
/* ================================================================== */

function IconTile({ tool, hinted = false }: { tool: Tool; hinted?: boolean }) {
  return (
    <span
      data-tile-id={tool.id}
      style={{ '--glow': tool.glow } as CSSProperties}
      className={cn(
        'relative block aspect-square w-full overflow-hidden bg-gradient-to-br text-white ring-1 ring-white/20',
        '[border-radius:26%]',
        tool.gradient,
        'shadow-[0_10px_24px_-12px_var(--glow),0_4px_12px_-6px_rgb(0_0_0/0.32),inset_0_1px_1px_rgb(255_255_255/0.38),inset_0_-10px_18px_rgb(0_0_0/0.10)]',
        hinted && 'scale-[1.08] ring-2 ring-white/90'
      )}
    >
      {/* top gloss */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 via-white/[0.07] to-transparent [border-radius:inherit]"
      />
      <tool.icon className="absolute inset-0 m-auto h-[50%] w-[50%]" strokeWidth={1.85} aria-hidden />
    </span>
  )
}

/* ================================================================== */
/* Folder tile — blurred glass squircle with 2×2 mini icons            */
/* ================================================================== */

function FolderTile({ item, hinted = false }: { item: HomeFolderItem; hinted?: boolean }) {
  const minis = item.appIds
    .slice(0, 4)
    .map((id) => getToolById(id))
    .filter((t): t is Tool => Boolean(t))

  return (
    <span
      data-tile-id={item.id}
      className={cn(
        /* no backdrop-blur here — a blur per folder tile made page swipes
           janky on phones; the glass read comes from the alpha + gloss */
        'relative grid aspect-square w-full grid-cols-2 place-items-center gap-[7%] overflow-hidden bg-white/[0.2] p-[9%] ring-1 ring-white/25',
        '[border-radius:26%]',
        'shadow-[0_10px_24px_-12px_rgb(0_0_0/0.32),inset_0_1px_1px_rgb(255_255_255/0.35)]',
        hinted && 'scale-[1.08] ring-2 ring-white/90'
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 via-white/[0.04] to-transparent [border-radius:inherit]"
      />
      {minis.map((t) => (
        <span
          key={t.id}
          className={cn(
            'flex h-full w-full items-center justify-center rounded-[28%] bg-gradient-to-br text-white shadow-[0_3px_8px_-3px_rgb(0_0_0/0.4),inset_0_1px_1px_rgb(255_255_255/0.3)] ring-1 ring-white/15',
            t.gradient
          )}
        >
          <t.icon className="h-[58%] w-[58%]" strokeWidth={1.9} aria-hidden />
        </span>
      ))}
    </span>
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
      // Compact launcher density (~50-59px tiles on phones): columns grow
      // with width instead of tiles growing with width.
      const cols = Math.min(12, Math.max(4, Math.floor((el.clientWidth - 40) / 50)))
      const rows = Math.min(6, Math.max(2, Math.floor((el.clientHeight - 176) / 88)))
      setGrid((g) => (g.cols === cols && g.rows === rows ? g : { cols, rows }))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])

  return grid
}

/* ================================================================== */
/* Status bar — live clock, battery, online state, search, edit mode   */
/* ================================================================== */

function StatusBar({
  onLight,
  editing,
  onDone,
  onOpenSearch,
  onOpenCustomize,
  onOpenNotifications,
}: {
  onLight: boolean
  editing: boolean
  onDone: () => void
  onOpenSearch: () => void
  onOpenCustomize: () => void
  onOpenNotifications: () => void
}) {
  const [time, setTime] = useState<string | null>(null)
  const [online, setOnline] = useState(() => (typeof window !== 'undefined' ? navigator.onLine : true))
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null)
  const [notifDot, setNotifDot] = useState(false)

  /* D73: bell dot while the feed has anything to show */
  useEffect(() => {
    if (editing) return
    const check = () => {
      try {
        setNotifDot(buildLiveFeed().length > 0)
      } catch {
        setNotifDot(false)
      }
    }
    check()
    const t = setInterval(check, 30_000)
    return () => clearInterval(t)
  }, [editing])

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
    <header
      className={cn(
        'absolute inset-x-0 top-0 z-30 flex select-none items-center justify-between px-6 pb-2 pt-[max(0.9rem,env(safe-area-inset-top))] text-sm font-semibold',
        onLight
          ? 'text-zinc-900 drop-shadow-[0_1px_2px_rgba(255,255,255,0.65)]'
          : 'text-white drop-shadow-md'
      )}
    >
      <time suppressHydrationWarning className="tabular-nums tracking-wide">
        {time ?? '--:--'}
      </time>

      <div className="flex items-center gap-4">
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
        {editing ? (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={onDone}
            className="rounded-full bg-primary px-4 py-2 text-[13px] font-bold text-primary-foreground shadow-lg shadow-black/20 transition-transform active:scale-90"
          >
            Done
          </motion.button>
        ) : (
          <>
            <button
              onClick={onOpenNotifications}
              aria-label="Open Notification Center"
              title="Notifications"
              className={cn(
                'relative -m-2 rounded-full p-3 transition-colors active:scale-90',
                onLight ? 'hover:bg-zinc-900/10' : 'hover:bg-white/15'
              )}
            >
              <Bell className="h-5 w-5" />
              {notifDot && (
                <span
                  aria-hidden
                  className="absolute right-1.5 top-1.5 size-2 rounded-full bg-rose-500 ring-2 ring-white/80"
                />
              )}
            </button>
            <button
              onClick={onOpenCustomize}
              aria-label="Customize theme"
              title="Themes & wallpapers"
              className={cn(
                '-m-2 rounded-full p-3 transition-colors active:scale-90',
                onLight ? 'hover:bg-zinc-900/10' : 'hover:bg-white/15'
              )}
            >
              <Palette className="h-5 w-5" />
            </button>
            <button
              onClick={onOpenSearch}
              aria-label="Search apps"
              className={cn(
                '-m-2 rounded-full p-3 transition-colors active:scale-90',
                onLight ? 'hover:bg-zinc-900/10' : 'hover:bg-white/15'
              )}
            >
              <Search className="h-5 w-5" />
            </button>
          </>
        )}
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
/* Spotlight v2 answers (D74) — inline math, unit conversion and       */
/* deep app actions, all evaluated locally.                            */
/* ================================================================== */

const SAFE_MATH = /^[0-9+\-*\/().,%\s^]+$/

function evalMath(raw: string): number | null {
  if (!/[0-9]/.test(raw) || !/[+\-*\/^%]/.test(raw)) return null
  if (!SAFE_MATH.test(raw)) return null
  try {
    const expr = raw.replace(/\^/g, '**').replace(/%/g, '/100')
    const v = Function(`"use strict"; return (${expr})`)() as unknown
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/* unit table (base = m for length, kg for mass) */
const UNIT_TABLE: Record<string, { dim: string; f: number }> = {
  km: { dim: 'len', f: 1000 },
  m: { dim: 'len', f: 1 },
  cm: { dim: 'len', f: 0.01 },
  mm: { dim: 'len', f: 0.001 },
  mi: { dim: 'len', f: 1609.344 },
  miles: { dim: 'len', f: 1609.344 },
  mile: { dim: 'len', f: 1609.344 },
  ft: { dim: 'len', f: 0.3048 },
  feet: { dim: 'len', f: 0.3048 },
  foot: { dim: 'len', f: 0.3048 },
  in: { dim: 'len', f: 0.0254 },
  inch: { dim: 'len', f: 0.0254 },
  inches: { dim: 'len', f: 0.0254 },
  yd: { dim: 'len', f: 0.9144 },
  kg: { dim: 'mass', f: 1 },
  g: { dim: 'mass', f: 0.001 },
  mg: { dim: 'mass', f: 1e-6 },
  lb: { dim: 'mass', f: 0.45359237 },
  lbs: { dim: 'mass', f: 0.45359237 },
  pound: { dim: 'mass', f: 0.45359237 },
  pounds: { dim: 'mass', f: 0.45359237 },
  oz: { dim: 'mass', f: 0.028349523 },
  ton: { dim: 'mass', f: 1000 },
}

const UNIT_ALIASES: Record<string, string> = {
  kilometers: 'km',
  kilometer: 'km',
  meters: 'm',
  meter: 'm',
  centimeters: 'cm',
  millimeters: 'mm',
  inches2: 'in',
  yards: 'yd',
  kilograms: 'kg',
  gram: 'g',
  grams: 'g',
  milligrams: 'mg',
  ounces: 'oz',
  tons: 'ton',
}

function tempConvert(v: number, from: string, to: string): number | null {
  const norm = (u: string) => u.replace('°', '').toLowerCase()
  const f = norm(from)
  const t = norm(to)
  let c: number | null = null
  if (f === 'c') c = v
  else if (f === 'f') c = ((v - 32) * 5) / 9
  else if (f === 'k') c = v - 273.15
  if (c === null) return null
  if (t === 'c') return c
  if (t === 'f') return (c * 9) / 5 + 32
  if (t === 'k') return c + 273.15
  return null
}

function evalUnit(raw: string): { value: number; from: string; to: string; out: number } | null {
  const m = raw.match(/^\s*(-?[\d.]+)\s*([a-zA-Z°]+)\s*(?:to|in)\s*([a-zA-Z°]+)\s*$/)
  if (!m) return null
  const v = Number(m[1])
  const norm = (u: string) => UNIT_ALIASES[u.toLowerCase()] ?? u.toLowerCase()
  const from = norm(m[2])
  const to = norm(m[3])
  if (Number.isNaN(v)) return null
  /* temperature special-case */
  if (['c', 'f', 'k', '°c', '°f'].some((x) => from.replace('°', '') === x.replace('°', ''))) {
    const out = tempConvert(v, from, to)
    return out === null ? null : { value: v, from: from, to: to, out }
  }
  const a = UNIT_TABLE[from]
  const b = UNIT_TABLE[to]
  if (!a || !b || a.dim !== b.dim) return null
  return { value: v, from: from, to: to, out: (v * a.f) / b.f }
}

type SpotlightAnswer =
  | { kind: 'math'; expr: string; value: number }
  | { kind: 'unit'; text: string; value: number; from: string; to: string; out: number }
  | { kind: 'action'; verb: 'note' | 'reminder'; arg: string }
  | null

function computeAnswer(query: string): SpotlightAnswer {
  const q = query.trim()
  if (!q) return null

  const action = q.match(/^(note|reminder):\s*([\s\S]+)$/i)
  if (action) return { kind: 'action', verb: action[1].toLowerCase() as 'note' | 'reminder', arg: action[2].trim() }

  const unit = evalUnit(q)
  if (unit) return { kind: 'unit', text: q, ...unit }

  if (SAFE_MATH.test(q) && /[0-9]/.test(q) && /[+\-*\/^%]/.test(q)) {
    const v = evalMath(q)
    if (v !== null) return { kind: 'math', expr: q, value: v }
  }
  return null
}

/* ================================================================== */
/* Spotlight search overlay                                            */
/* ================================================================== */

function Spotlight({
  onOpenApp,
  onOpenInStore,
  onClose,
}: {
  onOpenApp: (id: string, el?: HTMLElement | null) => void
  onOpenInStore: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const hydrated = useHydrated()
  const { toast } = useToast()
  const recents = useAppStore((s) => s.recents)
  const installed = useAppStore((s) => s.installed)
  const externalVersion = useExternalApps((s) => s.version)

  /* D74: inline answers — math, units, deep actions */
  const answer = useMemo(() => computeAnswer(query), [query])

  const results = useMemo(() => searchTools(query, 'all'), [query, externalVersion])
  const installedResults = useMemo(() => results.filter((t) => installed.includes(t.id)), [results, installed])
  const availableResults = useMemo(() => results.filter((t) => !installed.includes(t.id)), [results, installed])
  const installedTools = useMemo(
    () => installed.map((id) => getToolById(id)).filter((t): t is Tool => Boolean(t)),
    [installed]
  )
  const recentTools = useMemo(
    () =>
      hydrated
        ? recents
            .filter((id) => installed.includes(id))
            .map((id) => getToolById(id))
            .filter((t): t is Tool => Boolean(t))
        : [],
    [recents, hydrated, installed]
  )
  const searching = query.trim().length > 0

  const list = searching ? installedResults : installedTools

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
              className="shrink-0 rounded-full bg-white/20 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-white/30"
            >
              Cancel
            </button>
          </div>
        </motion.div>

        <div className="no-scrollbar mt-4 max-h-[62vh] space-y-4 overflow-y-auto pb-8">
          {/* D74: inline answer card */}
          {searching && answer && (
            <section aria-label="Answer">
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-white/60">
                Answer
              </h2>
              {answer.kind === 'math' && (
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(String(answer.value))
                    toast({ title: 'Result copied', description: `${answer.expr} = ${answer.value}` })
                  }}
                  className="w-full rounded-2xl bg-white/10 p-4 text-left ring-1 ring-white/15 transition hover:bg-white/15"
                >
                  <span className="block text-xs text-white/55">{answer.expr} =</span>
                  <span className="mt-0.5 block text-3xl font-black tabular-nums text-white">
                    {Number.isInteger(answer.value) ? answer.value : Number(answer.value.toFixed(6))}
                  </span>
                  <span className="mt-1 block text-[10px] uppercase tracking-wide text-white/40">
                    Tap to copy
                  </span>
                </button>
              )}
              {answer.kind === 'unit' && (
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(`${answer.out}`)
                    toast({ title: 'Result copied', description: answer.text })
                  }}
                  className="w-full rounded-2xl bg-white/10 p-4 text-left ring-1 ring-white/15 transition hover:bg-white/15"
                >
                  <span className="block text-xs text-white/55">{answer.text}</span>
                  <span className="mt-0.5 block text-3xl font-black tabular-nums text-white">
                    {Number(answer.out.toFixed(4))}
                    <span className="ml-1.5 text-lg font-bold text-white/70">{answer.to}</span>
                  </span>
                  <span className="mt-1 block text-[10px] uppercase tracking-wide text-white/40">
                    Tap to copy
                  </span>
                </button>
              )}
              {answer.kind === 'action' && (
                <button
                  onClick={() => {
                    if (answer.verb === 'note') {
                      setPendingShare({ text: answer.arg, source: 'spotlight' })
                      onOpenApp('notes')
                    } else {
                      onOpenApp('reminders')
                    }
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white/10 p-4 text-left ring-1 ring-white/15 transition hover:bg-white/15"
                >
                  <span
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white',
                      answer.verb === 'note'
                        ? 'from-amber-400 via-yellow-500 to-amber-600'
                        : 'from-emerald-400 via-teal-500 to-emerald-600'
                    )}
                  >
                    {answer.verb === 'note' ? (
                      <PencilLine className="size-5" aria-hidden />
                    ) : (
                      <ListChecks className="size-5" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-white">
                      {answer.verb === 'note' ? `Create note “${answer.arg}”` : 'Open Reminders'}
                    </span>
                    <span className="block text-[11px] text-white/55">
                      {answer.verb === 'note'
                        ? 'Opens Notes with your text ready'
                        : 'Jump straight to your checklist'}
                    </span>
                  </span>
                </button>
              )}
            </section>
          )}

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

          {/* Installed / matching apps */}
          <section aria-label={searching ? 'Search results' : 'All apps'}>
            <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-white/60">
              {searching ? 'Installed' : 'All Apps'}
            </h2>
            {list.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-white/70">
                <SearchX className="h-8 w-8" aria-hidden />
                <p className="text-sm">
                  {searching ? `No installed apps found for “${query.trim()}”` : 'No apps installed yet'}
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/15">
                {list.map((t, i) => (
                  <button
                    key={t.id}
                    onClick={(e) => onOpenApp(t.id, e.currentTarget)}
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
                      <span className="block truncate text-sm font-semibold text-white">{t.name}</span>
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

          {/* Available from the store (only while searching) */}
          {searching && availableResults.length > 0 && (
            <section aria-label="Available from the App Store">
              <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-white/60">
                From the App Store
              </h2>
              <div className="overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/15">
                {availableResults.map((t, i) => (
                  <button
                    key={t.id}
                    onClick={() => onOpenInStore(t.id)}
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
                      <span className="block truncate text-sm font-semibold text-white">{t.name}</span>
                      <span className="block truncate text-xs text-white/60">{t.description}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-white/90 px-3.5 py-1 text-xs font-bold uppercase tracking-wide text-zinc-900">
                      Get
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/* ================================================================== */
/* App Library (last page) — auto-grouped folders                      */
/* ================================================================== */

function AppLibrary({
  installedTools,
  onOpenApp,
  onOpenFolder,
  onOpenStore,
}: {
  installedTools: Tool[]
  onOpenApp: (id: string, el?: HTMLElement | null) => void
  onOpenFolder: (id: ToolCategoryId) => void
  onOpenStore: () => void
}) {
  const folders = useMemo(
    () =>
      toolCategories
        .map((c) => ({ cat: c, items: installedTools.filter((t) => t.category === c.id) }))
        .filter(({ items }) => items.length > 0),
    [installedTools]
  )

  return (
    <div className="mx-auto max-w-3xl pt-6">
      <h1 className="mb-5 text-center text-lg font-bold tracking-tight text-white drop-shadow-md">
        App Library
      </h1>
      <div className="grid grid-cols-2 justify-items-center gap-x-3 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {folders.map(({ cat, items }) => (
          <button
            key={cat.id}
            onClick={() => onOpenFolder(cat.id)}
            aria-label={`Open ${cat.name} folder, ${items.length} apps`}
            className="group flex w-full max-w-[118px] flex-col items-center gap-2 rounded-2xl p-1 transition-transform hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <span className="grid w-full grid-cols-2 gap-1.5 rounded-[1.4rem] bg-white/[0.16] p-2.5 shadow-lg shadow-black/5 ring-1 ring-white/20">
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

        {/* Get more apps */}
        <button
          onClick={onOpenStore}
          aria-label="Open the App Store to get more apps"
          className="group flex w-full max-w-[118px] flex-col items-center gap-2 rounded-2xl p-1 transition-transform hover:scale-[1.03] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <span className="grid w-full place-items-center rounded-[1.4rem] bg-white/[0.16] p-2.5 shadow-lg shadow-black/5 ring-1 ring-white/20">
            <span className="grid aspect-square w-full place-items-center rounded-[0.7rem] bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-600 text-white shadow-sm ring-1 ring-white/20">
              <Plus className="h-[45%] w-[45%]" strokeWidth={2.2} aria-hidden />
            </span>
          </span>
          <span className="truncate text-xs font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
            Get more apps
          </span>
        </button>
      </div>
      <p className="mt-6 text-center text-[11px] text-white/60">
        Tip: long-press any icon on the home screen to rearrange it or create a folder. Visit the
        App Store to get more apps.
      </p>
    </div>
  )
}

/* ================================================================== */
/* Folder overlay — user folders (rename / remove apps) + categories   */
/* ================================================================== */

function FolderOverlay({
  target,
  onOpenApp,
  onClose,
}: {
  target: NonNullable<OpenFolder>
  onOpenApp: (id: string, el?: HTMLElement | null) => void
  onClose: () => void
}) {
  const layout = useAppStore((s) => s.layout)
  const setLayout = useAppStore((s) => s.setLayout)
  const installed = useAppStore((s) => s.installed)
  const [pick, setPick] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const folder = target.kind === 'user' ? layout.find((i) => i.kind === 'folder' && i.id === target.id) : undefined
  const cat = target.kind === 'category' ? toolCategories.find((c) => c.id === target.id) : undefined

  const items: Tool[] = useMemo(() => {
    if (target.kind === 'category')
      return tools.filter((t) => t.category === target.id && installed.includes(t.id))
    if (folder?.kind === 'folder')
      return folder.appIds.map((id) => getToolById(id)).filter((t): t is Tool => Boolean(t))
    return []
  }, [target, folder, installed])

  const suggested = useMemo(() => {
    if (folder?.kind !== 'folder') return cat?.name ?? 'Folder'
    return (
      folder.name ??
      suggestFolderName(
        folder.appIds,
        (id) => getToolById(id)?.category,
        (cid) => toolCategories.find((c) => c.id === cid)?.name
      )
    )
  }, [folder, cat])

  /* auto-close when a user folder dissolves below two apps */
  useEffect(() => {
    if (target.kind === 'user' && !folder) onClose()
  }, [target, folder, onClose])

  useEffect(() => {
    setNameDraft(suggested)
  }, [suggested])

  const commitName = () => {
    if (!folder || folder.kind !== 'folder') return
    const next = renameFolderOp(layout, folder.id, nameDraft)
    setLayout(next)
  }

  const removeApp = (appId: string) => {
    if (!folder || folder.kind !== 'folder') return
    const next = removeFromFolderOp(layout, folder.id, appId)
    setLayout(next)
    try {
      navigator.vibrate?.(10)
    } catch {}
  }

  const title = target.kind === 'category' ? (cat?.name ?? 'Folder') : suggested

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-6 backdrop-blur-2xl"
      onClick={() => {
        if (pick) setPick(false)
        else onClose()
      }}
      role="dialog"
      aria-label={`${title} apps`}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="w-full max-w-md rounded-3xl bg-white/[0.14] p-4 ring-1 ring-white/20 backdrop-blur-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          {target.kind === 'user' ? (
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              aria-label="Folder name"
              placeholder="Folder name"
              className="w-44 rounded-lg border-b border-white/25 bg-transparent px-1 pb-0.5 text-center text-base font-bold text-white placeholder:text-white/40 focus:border-white/70 focus:outline-none"
            />
          ) : (
            <h2 className="text-base font-bold text-white">{title}</h2>
          )}
          <div className="flex items-center gap-2">
            {target.kind === 'user' && (
              <button
                onClick={() => setPick((p) => !p)}
                className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white transition hover:bg-white/25 active:scale-95"
              >
                {pick ? 'Done' : 'Remove'}
              </button>
            )}
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
        </div>

        <div className="no-scrollbar grid max-h-[56vh] grid-cols-4 gap-x-2 gap-y-5 overflow-y-auto">
          {items.map((t) => (
            <div key={t.id} className="relative">
              <button
                onClick={(e) => {
                  if (pick) return
                  onOpenApp(t.id, e.currentTarget)
                }}
                aria-label={`Open ${t.name}`}
                className="group flex w-full flex-col items-center gap-1.5 rounded-2xl p-1 transition-transform duration-150 hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-90"
              >
                <IconTile tool={t} />
                <span className="max-w-[88px] truncate text-[11px] font-medium leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
                  {t.name}
                </span>
              </button>
              {pick && (
                <button
                  onClick={() => removeApp(t.id)}
                  aria-label={`Remove ${t.name} from folder`}
                  className="absolute -right-1.5 -top-1.5 grid size-7 place-items-center rounded-full bg-white text-black shadow-lg ring-2 ring-black/10 transition hover:bg-red-500 hover:text-white active:scale-90"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                </button>
              )}
            </div>
          ))}
          {items.length === 0 && <p className="col-span-4 py-8 text-center text-sm text-white/60">This folder is empty.</p>}
        </div>

        {target.kind === 'user' && !pick && (
          <p className="mt-4 text-center text-[11px] text-white/50">
            Tap “Remove”, then tap the badge on an app to pull it out of the folder.
          </p>
        )}
      </motion.div>
    </motion.div>
  )
}

/* ================================================================== */
/* App window — full-screen with zoom transition + home indicator      */
/* ================================================================== */

function AppWindow({ app, onHome, originRect }: { app: Tool; onHome: () => void; originRect: IconRect | null }) {
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

  /*
   * iPad-style zoom transition: the full-size window scales out of the
   * tapped icon (transform-origin = icon center), then relaxes to fill
   * the screen — so the window stays fully responsive once settled.
   */
  const vw = window.innerWidth
  const vh = window.innerHeight
  const md = window.matchMedia('(min-width: 768px)').matches
  const lg = window.matchMedia('(min-width: 1024px)').matches
  const inset = md ? (lg ? 32 : 16) : 0
  const boxW = Math.max(1, vw - inset * 2)
  const boxH = Math.max(1, vh - inset * 2)
  const origin = originRect
  const sx = origin ? origin.width / boxW : 1
  const sy = origin ? origin.height / boxH : 1
  const originRadius = origin ? origin.width * 0.26 : 24
  const targetRadius = md ? 28 : 0

  return (
    <motion.div
      initial={
        origin
          ? { scaleX: sx, scaleY: sy, borderRadius: originRadius, opacity: 0.92 }
          : { opacity: 0, scale: 0.86, y: 26 }
      }
      animate={
        origin
          ? { scaleX: 1, scaleY: 1, borderRadius: targetRadius, opacity: 1 }
          : { opacity: 1, scale: 1, y: 0 }
      }
      exit={
        origin
          ? {
              scaleX: sx,
              scaleY: sy,
              borderRadius: originRadius,
              opacity: 0.92,
              transition: { duration: 0.36, ease: [0.32, 0.72, 0, 1] },
            }
          : { opacity: 0, scale: 0.86, y: 26, transition: { duration: 0.24 } }
      }
      transition={{ duration: 0.44, ease: [0.32, 0.72, 0, 1] }}
      style={
        origin
          ? {
              transformOrigin: `${
                origin.left + origin.width / 2 - inset
              }px ${origin.top + origin.height / 2 - inset}px`,
            }
          : undefined
      }
      className="absolute inset-0 z-50 flex flex-col overflow-hidden bg-background text-foreground md:inset-4 md:rounded-[1.75rem] md:shadow-2xl md:ring-1 md:ring-black/10 lg:inset-8"
      role="dialog"
      aria-label={app.name}
    >
      {/* App header */}
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b bg-background/85 px-3 backdrop-blur md:rounded-t-[1.75rem]">
        <Button
          variant="ghost"
          size="icon"
          onClick={onHome}
          aria-label="Go home"
          className="h-11 w-11 shrink-0 rounded-xl"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span
          style={{ '--glow': app.glow } as CSSProperties}
          className={cn(
            'relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br text-white ring-1 ring-black/5',
            'shadow-[0_6px_16px_-6px_var(--glow),inset_0_1px_1px_rgb(255_255_255/0.4)]',
            app.gradient
          )}
        >
          <app.icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold leading-tight tracking-tight">{app.name}</h1>
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
          className="h-11 w-11 shrink-0 rounded-xl"
        >
          <Star className={cn('h-5 w-5', isFav && 'fill-amber-400 text-amber-500')} />
        </Button>
      </header>

      {/* App body */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {app.external ? (
          /* linked platforms run edge-to-edge, like a native app screen */
          <div className="h-full">
            <app.Component />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-5 sm:px-6">
            <app.Component />
          </div>
        )}
      </div>

      {/* Home indicator */}
      <button
        onClick={onHome}
        aria-label="Go home"
        className="group absolute bottom-[max(0.4rem,env(safe-area-inset-bottom))] left-1/2 z-10 -translate-x-1/2 p-3 focus-visible:outline-none"
      >
        <span className="block h-[5px] w-32 rounded-full bg-foreground/25 transition-colors group-hover:bg-foreground/50" />
      </button>
    </motion.div>
  )
}
