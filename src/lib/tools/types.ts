import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'

export type ToolCategoryId =
  | 'calculator'
  | 'converter'
  | 'generator'
  | 'text'
  | 'developer'
  | 'daily'

export interface ToolCategoryMeta {
  id: ToolCategoryId
  nameBn: string
  nameEn: string
  icon: LucideIcon
}

export interface Tool {
  /** unique slug, used in hash route #/tool/<id> */
  id: string
  nameBn: string
  nameEn: string
  descBn: string
  category: ToolCategoryId
  icon: LucideIcon
  /** tailwind gradient classes for the icon tile, e.g. "from-emerald-500 to-teal-600" */
  gradient: string
  /** bn + en search keywords */
  keywords: string[]
  /** component that renders the tool body (lazy loaded) */
  Component: ComponentType
}
