import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

export type ToolCategoryId =
  | 'calculator'
  | 'converter'
  | 'generator'
  | 'text'
  | 'developer'
  | 'productivity'
  | 'daily'
  | 'media'
  | 'games'
  | 'utilities'

export interface ToolCategoryMeta {
  id: ToolCategoryId
  name: string
  icon: LucideIcon
}

export interface Tool {
  /** unique slug, used in hash route #/app/<id> */
  id: string
  /** display name (English) */
  name: string
  /** short description (English) — shown under the name on the store */
  description: string
  category: ToolCategoryId
  icon: LucideIcon
  /** tailwind gradient classes for the icon tile, e.g. "from-emerald-500 to-teal-600" */
  gradient: string
  /** hex glow color used for the premium ambient shadow under the icon */
  glow: string
  /** search keywords */
  keywords: string[]
  /** component that renders the app body (lazy loaded) */
  Component: ComponentType
  /** one-line store tagline (defaults to description) */
  tagline?: string
  /** publisher shown on the store page */
  developer?: string
  /** human readable download size, e.g. "4.2 MB" (derived when omitted) */
  size?: string
  /** store rating 4.x (derived when omitted) */
  rating?: number
  /** download badge, e.g. "1M+" (derived when omitted) */
  downloads?: string
  /** surfaced in the store's featured carousel */
  featured?: boolean
  /** system apps cannot be uninstalled */
  system?: boolean
  /** app store version string */
  version?: string
  /**
   * Linked platform (admin-curated external PWA/site). The component embeds
   * `url` in a window instead of shipping local functionality.
   */
  external?: boolean
  /** absolute URL of a linked platform (only when external) */
  url?: string
}
