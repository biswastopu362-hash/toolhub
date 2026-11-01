'use client'

import { Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Temporary premium placeholder shown until an app's real UI ships.
 * Overwritten apps never render this in production.
 */
export function AppPlaceholder({
  name,
  blurb,
  icon: Icon,
  gradient,
}: {
  name: string
  blurb: string
  icon: LucideIcon
  gradient: string
}) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <span
        className={cn(
          'relative flex size-20 items-center justify-center overflow-hidden rounded-[1.4rem] bg-gradient-to-br text-white ring-1 ring-white/25',
          'shadow-[0_18px_40px_-14px_rgb(0_0_0/0.45),inset_0_1px_1px_rgb(255_255_255/0.4)]',
          gradient
        )}
      >
        <Icon className="size-9" strokeWidth={1.8} aria-hidden />
        <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
      </span>
      <div className="space-y-1">
        <h2 className="text-lg font-bold tracking-tight">{name}</h2>
        <p className="mx-auto max-w-xs text-sm text-muted-foreground">{blurb}</p>
      </div>
      <p className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        <Sparkles className="size-3.5" aria-hidden /> This app is being crafted
      </p>
    </div>
  )
}

export default AppPlaceholder
