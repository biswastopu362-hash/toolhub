'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_ACCENT,
  DEFAULT_MODE,
  DEFAULT_WALLPAPER,
  type AccentId,
  type CustomWallpaper,
  type ModeId,
  type WallpaperId,
} from '@/lib/theme'
import type { Lang } from '@/lib/i18n'
import { DEFAULT_INSTALLED_IDS, DOCK_IDS, SYSTEM_APP_IDS } from '@/lib/constants'
import { uninstallPruneOp, type HomeItem } from '@/lib/home-layout'

export type IconShape = 'squircle' | 'rounded' | 'sharp'
export type Density = 'compact' | 'cozy' | 'roomy'
/** v2.1 home-widget ids (ordered enabled list, rendered on launcher page 1) */
export type WidgetId = 'clock' | 'weather' | 'notes' | 'calendar' | 'habits' | 'goals'
export const ALL_WIDGET_IDS: WidgetId[] = ['clock', 'weather', 'notes', 'calendar', 'habits', 'goals']

/** CSS border-radius applied to launcher icon tiles per shape (D79) */
export const ICON_SHAPE_RADIUS: Record<IconShape, string> = {
  squircle: '30%',
  rounded: '14px',
  sharp: '4px',
}

/** Vertical grid rhythm per density (D79) */
export const DENSITY_GAP: Record<Density, string> = {
  compact: '0.55rem',
  cozy: '0.9rem',
  roomy: '1.4rem',
}

interface AppState {
  /** favorite app ids */
  favorites: string[]
  /** recently used app ids (max 8) */
  recents: string[]
  /** home screen wallpaper */
  wallpaper: WallpaperId
  /** UI color mode: light / dark / amoled / system */
  mode: ModeId
  /** accent palette id */
  accent: AccentId
  /** ordered home-screen layout: apps + user folders (dock excluded) */
  layout: HomeItem[]
  /** set on first run once the store has rehydrated */
  layoutMigrated: boolean
  /** ids of apps the user has installed from the App Store */
  installed: string[]
  /** app id the App Store should deep-link to on next open, or null */
  storeDeepLink: string | null
  /**
   * App Lock configuration (D9). null = never set up.
   * pinHash is a SHA-256 hex of the 4-digit PIN (never the PIN itself).
   */
  appLock: { enabled: boolean; pinHash: string; lockedApps: string[] } | null
  /** user-designed wallpapers from Wallpaper Studio (D39) */
  customWallpapers: CustomWallpaper[]
  /** id of the custom wallpaper currently applied to the launcher, or null */
  activeCustomId: string | null
  /** UI language for the OS chrome (D78): English or Bangla */
  lang: Lang
  /** D79 icon shape: iOS-style squircle, rounded, or sharp */
  iconShape: IconShape
  /** D79 launcher grid density: compact / cozy (default) / roomy */
  density: Density
  /** D79 custom accent hex (overrides the 8 preset palettes when set) */
  customAccent: string | null
  /** v2.1 Automatic backup — push changed domains ~5s after they change (signed-in only) */
  autoSync: boolean
  /** v2.1 end-to-end encryption — seal sync blobs with AES-GCM on-device */
  e2eEnabled: boolean
  /** v2.1 ordered list of enabled home widgets (page-1 strip) */
  widgets: WidgetId[]

  toggleFavorite: (id: string) => void
  isFavorite: (id: string) => boolean
  addRecent: (id: string) => void
  clearRecents: () => void
  setWallpaper: (w: WallpaperId) => void
  setMode: (m: ModeId) => void
  setAccent: (a: AccentId) => void
  setLayout: (l: HomeItem[]) => void
  setLayoutMigrated: () => void
  resetLayout: (l: HomeItem[]) => void
  installApp: (id: string) => void
  uninstallApp: (id: string) => void
  isInstalled: (id: string) => boolean
  setStoreDeepLink: (id: string | null) => void
  setAppLock: (lock: AppState['appLock']) => void
  /** upsert a Wallpaper Studio design (pass `id` to update an existing one) */
  saveCustomWallpaper: (wp: Omit<CustomWallpaper, 'id' | 'createdAt'> & { id?: string }) => void
  /** remove a custom wallpaper; clears activeCustomId if it was active */
  deleteCustomWallpaper: (id: string) => void
  setActiveCustom: (id: string | null) => void
  setLang: (l: Lang) => void
  setIconShape: (s: IconShape) => void
  setDensity: (d: Density) => void
  setCustomAccent: (hex: string | null) => void
  setAutoSync: (on: boolean) => void
  setE2eEnabled: (on: boolean) => void
  setWidgets: (ids: WidgetId[]) => void
}

/** v2 → v3: installed apps didn't exist — derive them from the old layout. */
function deriveInstalled(persisted: Partial<AppState>): string[] {
  const ids = new Set<string>(DOCK_IDS)
  if (Array.isArray(persisted.layout)) {
    for (const item of persisted.layout) {
      if (item.kind === 'app') ids.add(item.id)
      else item.appIds.forEach((id) => ids.add(id))
    }
  }
  // A brand-new visitor gets the curated starter set instead.
  return ids.size <= DOCK_IDS.length ? [...new Set([...ids, ...DEFAULT_INSTALLED_IDS])] : [...ids]
}

function newCustomId(): string {
  return `cw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      favorites: [],
      recents: [],
      wallpaper: DEFAULT_WALLPAPER,
      mode: DEFAULT_MODE,
      accent: DEFAULT_ACCENT,
      layout: [],
      layoutMigrated: false,
      installed: DEFAULT_INSTALLED_IDS,
      storeDeepLink: null,
      appLock: null,
      customWallpapers: [],
      activeCustomId: null,
      lang: 'en',
      iconShape: 'squircle',
      density: 'cozy',
      customAccent: null,
      autoSync: false,
      e2eEnabled: false,
      widgets: ['clock', 'weather', 'notes'],

      toggleFavorite: (id) =>
        set((s) => ({
          favorites: s.favorites.includes(id)
            ? s.favorites.filter((f) => f !== id)
            : [...s.favorites, id],
        })),
      isFavorite: (id) => get().favorites.includes(id),
      addRecent: (id) =>
        set((s) => ({
          recents: [id, ...s.recents.filter((r) => r !== id)].slice(0, 8),
        })),
      clearRecents: () => set({ recents: [] }),
      setWallpaper: (w) => set({ wallpaper: w }),
      setMode: (m) => set({ mode: m }),
      setAccent: (a) => set({ accent: a }),
      setLayout: (l) => set({ layout: l }),
      setLayoutMigrated: () => set({ layoutMigrated: true }),
      resetLayout: (l) => set({ layout: l, layoutMigrated: true }),

      installApp: (id) =>
        set((s) => {
          if (s.installed.includes(id)) return s
          // Drop the new icon at the end of the home grid (unless it is
          // already on the grid or inside a folder).
          const alreadyPlaced = s.layout.some(
            (it) => it.kind === 'app' ? it.id === id : it.appIds.includes(id)
          )
          return {
            installed: [...s.installed, id],
            layout: alreadyPlaced ? s.layout : [...s.layout, { kind: 'app', id } as HomeItem],
          }
        }),
      uninstallApp: (id) =>
        set((s) => ({
          installed: s.installed.filter((a) => a !== id),
          layout: uninstallPruneOp(s.layout, id),
          favorites: s.favorites.filter((f) => f !== id),
        })),
      isInstalled: (id) => get().installed.includes(id),
      setStoreDeepLink: (id) => set({ storeDeepLink: id }),
      setAppLock: (lock) => set({ appLock: lock }),

      saveCustomWallpaper: (wp) =>
        set((s) => {
          if (wp.id) {
            const idx = s.customWallpapers.findIndex((c) => c.id === wp.id)
            if (idx >= 0) {
              const next = [...s.customWallpapers]
              next[idx] = { ...next[idx], name: wp.name, css: wp.css, dark: wp.dark }
              return { customWallpapers: next }
            }
          }
          const entry: CustomWallpaper = {
            id: wp.id ?? newCustomId(),
            name: wp.name,
            css: wp.css,
            dark: wp.dark,
            createdAt: Date.now(),
          }
          return { customWallpapers: [...s.customWallpapers, entry] }
        }),
      deleteCustomWallpaper: (id) =>
        set((s) => ({
          customWallpapers: s.customWallpapers.filter((c) => c.id !== id),
          activeCustomId: s.activeCustomId === id ? null : s.activeCustomId,
        })),
      setActiveCustom: (id) => set({ activeCustomId: id }),
      setLang: (l) => set({ lang: l }),
      setIconShape: (s) => set({ iconShape: s }),
      setDensity: (d) => set({ density: d }),
      setCustomAccent: (hex) => set({ customAccent: hex }),
      setAutoSync: (on) => set({ autoSync: on }),
      setE2eEnabled: (on) => set({ e2eEnabled: on }),
      setWidgets: (ids) => set({ widgets: ids }),
    }),
    {
      name: 'toolhub-store',
      version: 6,
      migrate: (persisted) => {
        const state = persisted as Partial<AppState>
        const next = { ...state, layout: state.layout ?? [], layoutMigrated: false }
        const installed = Array.isArray(state.installed) ? state.installed : deriveInstalled(state)
        next.installed = installed
        /* v4: system apps (App Store, Settings, Files) are always present —
         * backfill installs for profiles created before they existed. */
        const missing = SYSTEM_APP_IDS.filter((id) => !installed.includes(id))
        if (missing.length > 0) {
          next.installed = [...installed, ...missing]
          const docked = DOCK_IDS as readonly string[]
          const placed = new Set<string>()
          for (const it of next.layout) {
            if (it.kind === 'app') placed.add(it.id)
            else for (const a of it.appIds) placed.add(a)
          }
          for (const id of missing) {
            if (!docked.includes(id) && !placed.has(id)) {
              next.layout.push({ kind: 'app', id } as HomeItem)
            }
          }
        }
        /* v6: Help Center (D86) ships on every device — backfill for
         * profiles that predate it, placed at the end of the home layout. */
        if (!next.installed.includes('help')) {
          next.installed = [...next.installed, 'help']
          const docked = DOCK_IDS as readonly string[]
          const placed = new Set<string>()
          for (const it of next.layout) {
            if (it.kind === 'app') placed.add(it.id)
            else for (const a of it.appIds) placed.add(a)
          }
          if (!docked.includes('help') && !placed.has('help')) {
            next.layout.push({ kind: 'app', id: 'help' } as HomeItem)
          }
        }
        return next
      },
      partialize: (s) => {
        const { storeDeepLink: _drop, ...rest } = s
        return rest as AppState
      },
    }
  )
)
