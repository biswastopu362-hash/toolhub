'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AppState {
  /** favorite tool ids */
  favorites: string[]
  /** recently used tool ids (max 8) */
  recents: string[]
  toggleFavorite: (id: string) => void
  isFavorite: (id: string) => boolean
  addRecent: (id: string) => void
  clearRecents: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      favorites: [],
      recents: [],
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
    }),
    { name: 'toolhub-store' }
  )
)
