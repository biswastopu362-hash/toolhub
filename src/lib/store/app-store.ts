'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type WallpaperId = 'sunset' | 'ocean' | 'forest' | 'midnight'

interface AppState {
  /** favorite app ids */
  favorites: string[]
  /** recently used app ids (max 8) */
  recents: string[]
  /** home screen wallpaper */
  wallpaper: WallpaperId
  toggleFavorite: (id: string) => void
  isFavorite: (id: string) => boolean
  addRecent: (id: string) => void
  clearRecents: () => void
  setWallpaper: (w: WallpaperId) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      favorites: [],
      recents: [],
      wallpaper: 'sunset',
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
    }),
    { name: 'toolhub-store' }
  )
)
