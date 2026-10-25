'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_ACCENT,
  DEFAULT_MODE,
  DEFAULT_WALLPAPER,
  type AccentId,
  type ModeId,
  type WallpaperId,
} from '@/lib/theme'
import { DEFAULT_INSTALLED_IDS, DOCK_IDS, SYSTEM_APP_IDS } from '@/lib/constants'
import { uninstallPruneOp, type HomeItem } from '@/lib/home-layout'

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
    }),
    {
      name: 'toolhub-store',
      version: 5,
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
        return next
      },
      partialize: (s) => {
        const { storeDeepLink: _drop, ...rest } = s
        return rest as AppState
      },
    }
  )
)
