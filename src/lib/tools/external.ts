'use client'

import dynamic from 'next/dynamic'
import { create } from 'zustand'
import { externalIcon } from './external-icons'
import type { Tool, ToolCategoryId } from './types'
import type { ExternalAppPayload } from '../external-apps-server'

/**
 * Linked Platforms — admin-curated external apps, fetched from the hub's
 * API and merged into the local catalog at runtime. Installing one adds a
 * home-screen shortcut that opens the platform in an embedded window.
 */

const ExternalAppView = dynamic(
  () => import('@/components/os/external-app-view'),
  { ssr: false }
)

export type { ExternalAppPayload }

/** Convert an API payload into a catalog-ready Tool. */
export function defToTool(def: ExternalAppPayload): Tool {
  const autoKeywords = def.keywords
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  let host = ''
  try {
    host = new URL(def.url).hostname.replace(/^www\./, '')
  } catch {
    /* keep empty */
  }
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    tagline: def.tagline || def.description,
    category: (def.category as ToolCategoryId) || 'utilities',
    icon: externalIcon(def.icon),
    gradient: def.gradient,
    glow: def.glow,
    keywords: [...autoKeywords, def.name.toLowerCase(), host].filter(Boolean),
    developer: def.developer || 'Linked platform',
    version: '1.0.0',
    featured: def.featured,
    external: true,
    url: def.url,
    Component: ExternalAppView,
  }
}

/* ------------------------------------------------------------------ */
/* Sync mirror — getToolById / searchTools are synchronous, so the     */
/* fetched apps are also kept in a plain module-level map.             */
/* ------------------------------------------------------------------ */

const syncTools = new Map<string, Tool>()

export function getExternalToolById(id: string): Tool | undefined {
  return syncTools.get(id)
}

export function getExternalTools(): Tool[] {
  return Array.from(syncTools.values())
}

function setSyncTools(apps: Tool[]): void {
  syncTools.clear()
  for (const t of apps) syncTools.set(t.id, t)
}

/* ------------------------------------------------------------------ */
/* Reactive store — components subscribe for live updates              */
/* ------------------------------------------------------------------ */

interface ExternalAppsState {
  /** converted Tool objects, server order */
  apps: Tool[]
  /** at least one successful fetch has completed */
  loaded: boolean
  /** bumps on every successful reload — cheap reactivity for memos */
  version: number
  reload: () => Promise<void>
}

let inFlight: Promise<void> | null = null

export const useExternalApps = create<ExternalAppsState>((set, get) => ({
  apps: [],
  loaded: false,
  version: 0,

  reload: async () => {
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const res = await fetch('/api/external-apps', { cache: 'no-store' })
        const data = (await res.json()) as { apps?: ExternalAppPayload[] }
        const list = Array.isArray(data?.apps) ? data.apps : []
        const apps = list.map(defToTool)
        setSyncTools(apps)
        set({ apps, loaded: true, version: get().version + 1 })
      } catch {
        // Offline or API hiccup — keep whatever we already have.
        set({ loaded: true })
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  },
}))
