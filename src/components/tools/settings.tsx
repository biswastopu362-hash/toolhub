'use client'

import {
  Check,
  Info,
  LayoutGrid,
  Monitor,
  Moon,
  MoreVertical,
  RotateCcw,
  Share,
  Sparkles,
  Sun,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store/app-store'
import { ACCENTS, MODES, WALLPAPERS, type ModeId } from '@/lib/theme'
import { defaultLayout } from '@/lib/home-layout'
import { InstallAppButton } from '@/components/pwa/install-app-button'
import { tools } from '@/lib/tools/registry'

/* ================================================================== */
/* Options                                                             */
/* ================================================================== */

const MODE_ICONS: Record<ModeId, LucideIcon> = {
  light: Sun,
  dark: Moon,
  amoled: Sparkles,
  system: Monitor,
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function SettingsTool() {
  const { toast } = useToast()

  const favorites = useAppStore((s) => s.favorites)
  const recents = useAppStore((s) => s.recents)
  const wallpaper = useAppStore((s) => s.wallpaper)
  const setWallpaper = useAppStore((s) => s.setWallpaper)
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const accent = useAppStore((s) => s.accent)
  const setAccent = useAppStore((s) => s.setAccent)
  const clearRecents = useAppStore((s) => s.clearRecents)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const resetLayout = useAppStore((s) => s.resetLayout)
  const folderCount = useAppStore((s) => s.layout.filter((i) => i.kind === 'folder').length)

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

  const activeAccent = ACCENTS.find((a) => a.id === accent)
  const activeWallpaper = WALLPAPERS.find((w) => w.id === wallpaper)

  return (
    <div className="space-y-4">
      {/* ---------------- Appearance · Mode ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">Color mode</h3>
          <p className="text-sm text-muted-foreground">
            Light, dark, true-black AMOLED — or follow your device automatically.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Color mode">
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
                className={cn(
                  'flex h-20 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 text-sm font-medium transition-all active:scale-95',
                  active
                    ? 'border-transparent bg-primary text-primary-foreground shadow-md shadow-primary/25'
                    : 'border-border text-muted-foreground hover:bg-muted'
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {m.name}
                <span
                  className={cn(
                    'text-center text-[10px] leading-tight',
                    active ? 'text-primary-foreground/75' : 'text-muted-foreground/80'
                  )}
                >
                  {m.description}
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      {/* ---------------- Appearance · Accent ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">Accent color</h3>
          <p className="text-sm text-muted-foreground">
            Tints every app, button and highlight — currently{' '}
            <span className="font-semibold text-foreground">{activeAccent?.name}</span>.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-8" role="group" aria-label="Accent color">
          {ACCENTS.map((a) => {
            const active = accent === a.id
            return (
              <div key={a.id} className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setAccent(a.id)}
                  aria-pressed={active}
                  aria-label={`${a.name} accent`}
                  title={a.name}
                  className={cn(
                    'relative grid size-12 place-items-center rounded-full bg-gradient-to-br shadow-md transition-all active:scale-90',
                    a.swatch,
                    active
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'hover:scale-110'
                  )}
                >
                  {active && <Check className="size-5 text-white drop-shadow-md" aria-hidden="true" />}
                </button>
                <span
                  className={cn(
                    'text-[11px]',
                    active ? 'font-semibold text-primary' : 'text-muted-foreground'
                  )}
                >
                  {a.name}
                </span>
              </div>
            )
          })}
        </div>
      </Card>

      {/* ---------------- Appearance · Wallpaper ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">Wallpaper</h3>
          <p className="text-sm text-muted-foreground">
            Pick a background for your home screen — currently{' '}
            <span className="font-semibold text-foreground">{activeWallpaper?.name}</span>.
          </p>
        </div>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-8" role="group" aria-label="Wallpaper">
          {WALLPAPERS.map((wp) => {
            const active = wallpaper === wp.id
            return (
              <div key={wp.id} className="flex flex-col items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setWallpaper(wp.id)}
                  aria-pressed={active}
                  aria-label={`${wp.name} wallpaper`}
                  title={wp.name}
                  className={cn(
                    'relative size-16 rounded-xl transition-all',
                    wp.className,
                    active
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'hover:scale-105'
                  )}
                >
                  {active && (
                    <span className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow">
                      <Check className="size-3.5" aria-hidden="true" />
                    </span>
                  )}
                </button>
                <span
                  className={cn(
                    'text-xs',
                    active ? 'font-semibold text-primary' : 'text-muted-foreground'
                  )}
                >
                  {wp.name}
                </span>
              </div>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Tip: the palette button in the status bar opens quick settings from anywhere.
        </p>
      </Card>

      {/* ---------------- Home screen layout ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">Home screen layout</h3>
          <p className="text-sm text-muted-foreground">
            Long-press any icon on the home screen to rearrange apps, stack two apps together to
            create a folder, or hold near a screen edge to flip pages.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{tools.length.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">Apps</p>
          </div>
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{folderCount.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">Folders</p>
          </div>
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{favorites.length.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">Favorites</p>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="h-11 gap-2">
              <RotateCcw className="size-4" /> Reset home screen layout
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset home screen layout?</AlertDialogTitle>
              <AlertDialogDescription>
                All folders will be dissolved and every app returns to its original position. Your
                notes, reminders and favorites are not affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  resetLayout(
                    defaultLayout(
                      tools.map((t) => t.id),
                      ['calculator', 'clock', 'weather', 'notes']
                    )
                  )
                  toast({
                    title: 'Home screen reset ✓',
                    description: 'Every app is back in its original place.',
                  })
                }}
              >
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <LayoutGrid className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Tip: you can also tap “Rearrange icons &amp; folders” in quick settings.
        </p>
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
              <Badge variant="secondary">v2.2</Badge>
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
