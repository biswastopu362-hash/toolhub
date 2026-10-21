'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_ACCENT, DEFAULT_MODE, DEFAULT_WALLPAPER, type AccentId, type ModeId, type WallpaperId } from '@/lib/theme'

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
  toggleFavorite: (id: string) => void
  isFavorite: (id: string) => boolean
  addRecent: (id: string) => void
  clearRecents: () => void
  setWallpaper: (w: WallpaperId) => void
  setMode: (m: ModeId) => void
  setAccent: (a: AccentId) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      favorites: [],
      recents: [],
      wallpaper: DEFAULT_WALLPAPER,
      mode: DEFAULT_MODE,
      accent: DEFAULT_ACCENT,
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
    }),
    { name: 'toolhub-store' }
  )
)
