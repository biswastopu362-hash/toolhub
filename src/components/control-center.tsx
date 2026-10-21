'use client'

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Check,
  Monitor,
  Moon,
  Palette,
  Settings2,
  Sparkles,
  Sun,
  X,
  type LucideIcon,
} from 'lucide-react'
import { ACCENTS, MODES, WALLPAPERS, type ModeId } from '@/lib/theme'
import { useAppStore } from '@/lib/store/app-store'
import { cn } from '@/lib/utils'

const MODE_ICONS: Record<ModeId, LucideIcon> = {
  light: Sun,
  dark: Moon,
  amoled: Sparkles,
  system: Monitor,
}

/**
 * iOS Control-Center-style bottom sheet for instant personalization:
 * color mode, accent palette and wallpaper — available from any home screen.
 */
export function ControlCenter({
  onClose,
  onOpenApp,
}: {
  onClose: () => void
  onOpenApp: (id: string) => void
}) {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const accent = useAppStore((s) => s.accent)
  const setAccent = useAppStore((s) => s.setAccent)
  const wallpaper = useAppStore((s) => s.wallpaper)
  const setWallpaper = useAppStore((s) => s.setWallpaper)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-[60] flex flex-col justify-end bg-black/35 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label="Quick settings"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 380, damping: 40 }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={(_, info) => {
          if (info.offset.y > 120 || info.velocity.y > 500) onClose()
        }}
        className="w-full rounded-t-[1.75rem] bg-background/90 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl ring-1 ring-border backdrop-blur-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* grabber */}
        <div className="flex cursor-grab justify-center pt-2.5 active:cursor-grabbing" aria-hidden>
          <span className="h-1.5 w-10 rounded-full bg-foreground/20" />
        </div>

        <div className="mx-auto w-full max-w-xl space-y-5 px-5 pb-2 pt-4">
          {/* ---------------- header ---------------- */}
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-bold">
              <Palette className="size-4.5 text-primary" aria-hidden />
              Quick settings
            </h2>
            <button
              onClick={onClose}
              aria-label="Close quick settings"
              className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground transition hover:bg-accent hover:text-accent-foreground active:scale-90"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* ---------------- mode ---------------- */}
          <section aria-label="Color mode">
            <div className="grid grid-cols-4 gap-2">
              {MODES.map((m) => {
                const active = mode === m.id
                const Icon = MODE_ICONS[m.id]
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMode(m.id)}
                    aria-pressed={active}
                    aria-label={`${m.name} mode — ${m.description}`}
                    title={m.description}
                    className={cn(
                      'flex h-[4.25rem] flex-col items-center justify-center gap-1.5 rounded-2xl border text-xs font-semibold transition-all active:scale-95',
                      active
                        ? 'border-transparent bg-primary text-primary-foreground shadow-md shadow-primary/30'
                        : 'border-border bg-muted/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {m.name}
                  </button>
                )
              })}
            </div>
          </section>

          {/* ---------------- accent ---------------- */}
          <section aria-label="Accent color">
            <div className="mb-2.5 flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Accent color
              </h3>
              <span className="text-xs font-semibold text-primary">
                {ACCENTS.find((a) => a.id === accent)?.name}
              </span>
            </div>
            <div className="flex flex-wrap gap-3" role="group">
              {ACCENTS.map((a) => {
                const active = accent === a.id
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setAccent(a.id)}
                    aria-pressed={active}
                    aria-label={`${a.name} accent`}
                    title={a.name}
                    className={cn(
                      'group relative grid size-10 place-items-center rounded-full bg-gradient-to-br shadow-md transition-all active:scale-90',
                      a.swatch,
                      active
                        ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                        : 'hover:scale-110'
                    )}
                  >
                    {active && <Check className="size-4.5 text-white drop-shadow-md" aria-hidden />}
                  </button>
                )
              })}
            </div>
          </section>

          {/* ---------------- wallpaper ---------------- */}
          <section aria-label="Wallpaper">
            <div className="mb-2.5 flex items-baseline justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Wallpaper
              </h3>
              <span className="text-xs font-semibold text-primary">
                {WALLPAPERS.find((w) => w.id === wallpaper)?.name}
              </span>
            </div>
            <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1" role="group">
              {WALLPAPERS.map((w) => {
                const active = wallpaper === w.id
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setWallpaper(w.id)}
                    aria-pressed={active}
                    aria-label={`${w.name} wallpaper`}
                    title={w.name}
                    className={cn(
                      'relative size-14 shrink-0 rounded-xl bg-gradient-to-br shadow-sm transition-all active:scale-90',
                      w.className,
                      active
                        ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                        : 'hover:scale-105'
                    )}
                  >
                    {active && (
                      <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground shadow">
                        <Check className="size-3" aria-hidden />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>

          {/* ---------------- footer ---------------- */}
          <button
            type="button"
            onClick={() => {
              onClose()
              onOpenApp('settings')
            }}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-muted/70 text-sm font-semibold text-foreground ring-1 ring-border transition hover:bg-accent active:scale-[0.98]"
          >
            <Settings2 className="size-4 text-primary" aria-hidden />
            More personalization in Settings
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
