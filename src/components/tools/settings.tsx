'use client'

import { useTheme } from 'next-themes'
import {
  Check,
  Info,
  Monitor,
  Moon,
  MoreVertical,
  Share,
  Sun,
  Trash2,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store/app-store'
import type { WallpaperId } from '@/lib/store/app-store'
import { InstallAppButton } from '@/components/pwa/install-app-button'
import { tools } from '@/lib/tools/registry'

/* ================================================================== */
/* Options                                                             */
/* ================================================================== */

const THEME_OPTIONS = [
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
  { id: 'system', label: 'System', icon: Monitor },
] as const

const WALLPAPERS: { id: WallpaperId; name: string; className: string }[] = [
  { id: 'sunset', name: 'Sunset', className: 'wallpaper wp-sunset' },
  { id: 'ocean', name: 'Ocean', className: 'wallpaper wp-ocean' },
  { id: 'forest', name: 'Forest', className: 'wallpaper wp-forest' },
  { id: 'midnight', name: 'Midnight', className: 'wallpaper wp-midnight' },
]

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function SettingsTool() {
  const { toast } = useToast()
  const { theme, setTheme } = useTheme()

  const favorites = useAppStore((s) => s.favorites)
  const recents = useAppStore((s) => s.recents)
  const wallpaper = useAppStore((s) => s.wallpaper)
  const setWallpaper = useAppStore((s) => s.setWallpaper)
  const clearRecents = useAppStore((s) => s.clearRecents)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)

  const clearFavorites = () => {
    if (favorites.length === 0) return
    ;[...favorites].forEach((id) => toggleFavorite(id))
    toast({
      title: 'Favorites cleared ✓',
      description: `${favorites.length.toLocaleString('en-US')} ${favorites.length === 1 ? 'app' : 'apps'} removed from favorites.`,
    })
  }

  const onClearRecents = () => {
    if (recents.length === 0) return
    const count = recents.length
    clearRecents()
    toast({
      title: 'Recents cleared ✓',
      description: `${count.toLocaleString('en-US')} ${count === 1 ? 'entry' : 'entries'} removed from recents.`,
    })
  }

  return (
    <div className="space-y-4">
      {/* ---------------- Appearance ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">Appearance</h3>
          <p className="text-sm text-muted-foreground">Choose how ToolHub looks on this device.</p>
        </div>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Theme">
          {THEME_OPTIONS.map((opt) => {
            const active = theme === opt.id
            const Icon = opt.icon
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setTheme(opt.id)}
                aria-pressed={active}
                aria-label={`${opt.label} theme`}
                className={cn(
                  'flex h-11 items-center justify-center gap-2 rounded-lg border text-sm font-medium transition-colors',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted'
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                {opt.label}
                {active && <Check className="size-3.5" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </Card>

      {/* ---------------- Wallpaper ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">Wallpaper</h3>
          <p className="text-sm text-muted-foreground">Pick a background for your home screen.</p>
        </div>
        <div className="flex flex-wrap gap-4" role="group" aria-label="Wallpaper">
          {WALLPAPERS.map((wp) => {
            const active = wallpaper === wp.id
            return (
              <div key={wp.id} className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setWallpaper(wp.id)}
                  aria-pressed={active}
                  aria-label={`${wp.name} wallpaper`}
                  className={cn(
                    'relative size-16 rounded-xl transition-all',
                    wp.className,
                    active ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'hover:scale-105'
                  )}
                >
                  {active && (
                    <span className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow">
                      <Check className="size-3.5" aria-hidden="true" />
                    </span>
                  )}
                </button>
                <span className={cn('text-xs', active ? 'font-semibold text-primary' : 'text-muted-foreground')}>
                  {wp.name}
                </span>
              </div>
            )
          })}
        </div>
      </Card>

      {/* ---------------- Install ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">Install app</h3>
          <p className="text-sm text-muted-foreground">
            Add ToolHub to your home screen for a full-screen, offline experience.
          </p>
        </div>
        <InstallAppButton className="h-11 gap-2 px-4" />
        <Separator />
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <Share className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-medium text-foreground">iPhone / iPad:</span> open in Safari, tap Share, then
              “Add to Home Screen”.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <MoreVertical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-medium text-foreground">Android &amp; desktop Chrome:</span> open the browser
              menu (⋮), then tap “Install app”.
            </span>
          </li>
        </ul>
      </Card>

      {/* ---------------- Data ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">Your data</h3>
          <p className="text-sm text-muted-foreground">Stored only on this device — cleared data cannot be restored.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{favorites.length.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">Favorites</p>
          </div>
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{recents.length.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">Recents</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            variant="outline"
            className="h-11 gap-2"
            onClick={onClearRecents}
            disabled={recents.length === 0}
            aria-label="Clear recents"
          >
            <Trash2 className="size-4" /> Clear recents
          </Button>
          <Button
            variant="outline"
            className="h-11 gap-2"
            onClick={clearFavorites}
            disabled={favorites.length === 0}
            aria-label="Clear favorites"
          >
            <Trash2 className="size-4" /> Clear favorites
          </Button>
        </div>
      </Card>

      {/* ---------------- About ---------------- */}
      <Card className="gap-4 p-4">
        <div className="flex items-center gap-3">
          <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow">
            <Wrench className="size-7" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold">ToolHub</h3>
              <Badge variant="secondary">v2.0</Badge>
            </div>
            <p className="text-sm text-muted-foreground">All your apps, one hub</p>
          </div>
        </div>
        <Separator />
        <div className="space-y-1.5 text-sm">
          <p>
            <span className="font-semibold">{tools.length.toLocaleString('en-US')}</span> apps and counting —
            calculators, converters, generators and more.
          </p>
          <p className="flex items-start gap-2 text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Built as a Progressive Web App — works offline on every device.
          </p>
        </div>
      </Card>
    </div>
  )
}
