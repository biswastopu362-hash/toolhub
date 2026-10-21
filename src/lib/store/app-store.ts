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
import type { HomeItem } from '@/lib/home-layout'

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
    }),
    {
      name: 'toolhub-store',
      version: 2,
      migrate: (persisted) => {
        const state = persisted as Partial<AppState>
        // v1 → v2: layout did not exist yet
        return { ...state, layout: state.layout ?? [], layoutMigrated: false }
      },
    }
  )
)
