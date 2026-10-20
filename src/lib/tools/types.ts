import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

export type ToolCategoryId =
  | 'calculator'
  | 'converter'
  | 'generator'
  | 'text'
  | 'developer'
  | 'daily'
  | 'media'
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
  /** short description (English) */
  description: string
  category: ToolCategoryId
  icon: LucideIcon
  /** tailwind gradient classes for the icon tile, e.g. "from-emerald-500 to-teal-600" */
  gradient: string
  /** search keywords */
  keywords: string[]
  /** component that renders the app body (lazy loaded) */
  Component: ComponentType
}
