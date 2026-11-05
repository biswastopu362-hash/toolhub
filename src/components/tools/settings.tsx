'use client'

import {
  Check,
  Info,
  Languages,
  LayoutGrid,
  LifeBuoy,
  Monitor,
  Moon,
  MoreVertical,
  RotateCcw,
  Share,
  Sparkles,
  Store,
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
import { DOCK_IDS, APP_VERSION } from '@/lib/constants'
import { InstallAppButton } from '@/components/pwa/install-app-button'
import { AppLockCard } from '@/components/os/app-lock-card'
import { AccountCard } from '@/components/os/account-card'
import { WidgetsCard } from '@/components/os/widgets-card'
import { useLang } from '@/hooks/use-lang'
import type { TKey } from '@/lib/i18n'
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

const MODE_NAME_KEY: Record<ModeId, TKey> = {
  light: 'modeLight',
  dark: 'modeDark',
  amoled: 'modeAmoled',
  system: 'modeSystem',
}

const MODE_DESC_KEY: Record<ModeId, TKey> = {
  light: 'descLight',
  dark: 'descDark',
  amoled: 'descAmoled',
  system: 'descSystem',
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function SettingsTool() {
  const { toast } = useToast()
  const { t, lang, setLang } = useLang()

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
  const installed = useAppStore((s) => s.installed)
  const folderCount = useAppStore((s) => s.layout.filter((i) => i.kind === 'folder').length)
  const iconShape = useAppStore((s) => s.iconShape)
  const setIconShape = useAppStore((s) => s.setIconShape)
  const density = useAppStore((s) => s.density)
  const setDensity = useAppStore((s) => s.setDensity)
  const customAccent = useAppStore((s) => s.customAccent)
  const setCustomAccent = useAppStore((s) => s.setCustomAccent)

  const clearFavorites = () => {
    if (favorites.length === 0) return
    ;[...favorites].forEach((id) => toggleFavorite(id))
    toast({
      title: t('favoritesCleared'),
      description: t('removedFromFavorites', {
        n: favorites.length,
        s: favorites.length === 1 ? t('appWord') : t('appsWord'),
      }),
    })
  }

  const onClearRecents = () => {
    if (recents.length === 0) return
    const count = recents.length
    clearRecents()
    toast({
      title: t('recentsCleared'),
      description: t('removedFromFavorites', {
        n: count,
        s: count === 1 ? t('entry') : t('entries'),
      }),
    })
  }

  const activeAccent = ACCENTS.find((a) => a.id === accent)
  const activeWallpaper = WALLPAPERS.find((w) => w.id === wallpaper)

  return (
    <div className="space-y-4">
      {/* ---------------- Language (D78) ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">{t('language')}</h3>
          <p className="text-sm text-muted-foreground">{t('languageDesc')}</p>
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('language')}>
          {(['en', 'bn'] as const).map((l) => {
            const active = lang === l
            return (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                aria-pressed={active}
                aria-label={l === 'en' ? 'English' : 'বাংলা'}
                className={cn(
                  'flex h-14 items-center justify-center gap-2 rounded-xl border px-2 text-sm font-semibold transition-all active:scale-95',
                  active
                    ? 'border-transparent bg-primary text-primary-foreground shadow-md shadow-primary/25'
                    : 'border-border text-muted-foreground hover:bg-muted'
                )}
              >
                <Languages className="size-4" aria-hidden="true" />
                {l === 'en' ? 'English' : 'বাংলা'}
                {active && <Check className="size-4" aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      </Card>

      {/* ---------------- Appearance · Mode ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">{t('colorMode')}</h3>
          <p className="text-sm text-muted-foreground">{t('colorModeDesc')}</p>
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
                aria-label={`${t(MODE_NAME_KEY[m.id])} — ${t(MODE_DESC_KEY[m.id])}`}
                className={cn(
                  'flex h-20 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 text-sm font-medium transition-all active:scale-95',
                  active
                    ? 'border-transparent bg-primary text-primary-foreground shadow-md shadow-primary/25'
                    : 'border-border text-muted-foreground hover:bg-muted'
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {t(MODE_NAME_KEY[m.id])}
                <span
                  className={cn(
                    'text-center text-[10px] leading-tight',
                    active ? 'text-primary-foreground/75' : 'text-muted-foreground/80'
                  )}
                >
                  {t(MODE_DESC_KEY[m.id])}
                </span>
              </button>
            )
          })}
        </div>
      </Card>

      {/* ---------------- Appearance · Accent ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">{t('accent')}</h3>
          <p className="text-sm text-muted-foreground">{t('accentDesc', { name: activeAccent?.name ?? '' })}</p>
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
          <h3 className="font-semibold">{t('wallpaper')}</h3>
          <p className="text-sm text-muted-foreground">{t('wallpaperDesc', { name: activeWallpaper?.name ?? '' })}</p>
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
        <p className="text-xs text-muted-foreground">{t('wallpaperTip')}</p>
      </Card>

      {/* ---------------- Home screen look (D79 Theme Engine v3) ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">{t('homeLook')}</h3>
          <p className="text-sm text-muted-foreground">{t('homeLookDesc')}</p>
        </div>

        {/* Icon shape */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('iconShape')}
          </h4>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('iconShape')}>
            {(['squircle', 'rounded', 'sharp'] as const).map((shape) => {
              const active = iconShape === shape
              const radius = shape === 'squircle' ? '30%' : shape === 'rounded' ? '14px' : '4px'
              return (
                <button
                  key={shape}
                  type="button"
                  onClick={() => setIconShape(shape)}
                  aria-pressed={active}
                  className={cn(
                    'flex h-20 flex-col items-center justify-center gap-2 rounded-xl border text-xs font-medium transition-all active:scale-95',
                    active
                      ? 'border-transparent bg-primary text-primary-foreground shadow-md shadow-primary/25'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  <span
                    aria-hidden
                    className="size-8 bg-gradient-to-br from-emerald-400 to-teal-600 shadow"
                    style={{ borderRadius: radius }}
                  />
                  {t(shape === 'squircle' ? 'shapeSquircle' : shape === 'rounded' ? 'shapeRounded' : 'shapeSharp')}
                </button>
              )
            })}
          </div>
        </div>

        {/* Grid density */}
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('densityLabel')}
          </h4>
          <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('densityLabel')}>
            {(['compact', 'cozy', 'roomy'] as const).map((d) => {
              const active = density === d
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDensity(d)}
                  aria-pressed={active}
                  className={cn(
                    'flex h-14 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-all active:scale-95',
                    active
                      ? 'border-transparent bg-primary text-primary-foreground shadow-md shadow-primary/25'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  )}
                >
                  {t(d === 'compact' ? 'densityCompact' : d === 'cozy' ? 'densityCozy' : 'densityRoomy')}
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom accent */}
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('customAccent')}
          </h4>
          <p className="mb-2 text-xs text-muted-foreground">{t('customAccentDesc')}</p>
          <div className="flex items-center gap-2">
            <label
              className="relative grid size-12 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full border-2 border-border shadow-inner"
              style={{ background: customAccent ?? 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #10b981, #06b6d4, #8b5cf6, #f43f5e)' }}
            >
              <input
                type="color"
                value={customAccent ?? '#10b981'}
                onChange={(e) => setCustomAccent(e.target.value)}
                aria-label={t('colorInput')}
                className="absolute inset-0 cursor-pointer opacity-0"
              />
            </label>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {customAccent ? customAccent.toUpperCase() : '—'}
            </span>
            {customAccent && (
              <Button variant="outline" className="h-11 shrink-0 gap-2" onClick={() => setCustomAccent(null)}>
                <RotateCcw className="size-4" /> {t('usePreset')}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* ---------------- Apps ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">{t('appsHeading')}</h3>
          <p className="text-sm text-muted-foreground">{t('appsInstalled', { n: installed.length, m: tools.length })}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{installed.length.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">{t('installed')}</p>
          </div>
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">
              {(tools.length - installed.length).toLocaleString('en-US')}
            </p>
            <p className="text-xs text-muted-foreground">{t('availableLabel')}</p>
          </div>
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{folderCount.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">{t('foldersLabel')}</p>
          </div>
        </div>
        <Button
          className="h-11 gap-2"
          onClick={() => window.dispatchEvent(new CustomEvent<string>('toolhub:open-app', { detail: 'store' }))}
        >
          <Store className="size-4" /> {t('openAppStore')}
        </Button>
      </Card>

      {/* ---------------- Account & Cloud Sync (D76/D77) ---------------- */}
      <AccountCard />

      {/* ---------------- Home widgets (v2.1) ---------------- */}
      <WidgetsCard />

      {/* ---------------- App Lock (D9) ---------------- */}
      <AppLockCard />

      {/* ---------------- Home screen layout ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">{t('homeLayout')}</h3>
          <p className="text-sm text-muted-foreground">{t('homeLayoutDesc')}</p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{installed.length.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">{t('appsHeading')}</p>
          </div>
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{folderCount.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">{t('foldersLabel')}</p>
          </div>
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{favorites.length.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">{t('favorites')}</p>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="h-11 gap-2">
              <RotateCcw className="size-4" /> {t('resetLayout')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('resetLayoutTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('resetLayoutDesc')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  resetLayout(defaultLayout(installed, [...DOCK_IDS]))
                  toast({
                    title: t('resetDone'),
                    description: t('resetDoneDesc'),
                  })
                }}
              >
                {t('reset')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <LayoutGrid className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {t('layoutTip')}
        </p>
      </Card>

      {/* ---------------- Install ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">{t('installApp')}</h3>
          <p className="text-sm text-muted-foreground">{t('installAppDesc')}</p>
        </div>
        <InstallAppButton className="h-11 gap-2 px-4" />
        <Separator />
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <Share className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-medium text-foreground">{t('iphoneLabel')}</span> {t('iphoneTip')}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <MoreVertical className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              <span className="font-medium text-foreground">{t('androidLabel')}</span> {t('androidTip')}
            </span>
          </li>
        </ul>
      </Card>

      {/* ---------------- Data ---------------- */}
      <Card className="gap-4 p-4">
        <div>
          <h3 className="font-semibold">{t('yourData')}</h3>
          <p className="text-sm text-muted-foreground">{t('yourDataDesc')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{favorites.length.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">{t('favorites')}</p>
          </div>
          <div className="rounded-lg bg-muted p-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{recents.length.toLocaleString('en-US')}</p>
            <p className="text-xs text-muted-foreground">{t('recents')}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Button
            variant="outline"
            className="h-11 gap-2"
            onClick={() =>
              window.dispatchEvent(new CustomEvent<string>('toolhub:open-app', { detail: 'backup-restore' }))
            }
          >
            {t('backupRestore')}
          </Button>
          <Button
            variant="outline"
            className="h-11 gap-2"
            onClick={onClearRecents}
            disabled={recents.length === 0}
            aria-label={t('clearRecents')}
          >
            <Trash2 className="size-4" /> {t('clearRecents')}
          </Button>
        </div>
        <Button
          variant="outline"
          className="h-11 gap-2"
          onClick={clearFavorites}
          disabled={favorites.length === 0}
          aria-label={t('clearFavorites')}
        >
          <Trash2 className="size-4" /> {t('clearFavorites')}
        </Button>
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
              <Badge variant="secondary">v{APP_VERSION}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">{t('allYourApps')}</p>
          </div>
        </div>
        <Separator />
        <div className="space-y-1.5 text-sm">
          <p>
            <span className="font-semibold">{t('andCounting', { n: tools.length })}</span>
          </p>
          <p className="flex items-start gap-2 text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t('pwaNote')}
          </p>
        </div>
        <Button
          variant="outline"
          className="h-11 gap-2"
          onClick={() =>
            window.dispatchEvent(new CustomEvent<string>('toolhub:open-app', { detail: 'help' }))
          }
        >
          <LifeBuoy className="size-4" aria-hidden="true" />
          Open Help Center
        </Button>
      </Card>
    </div>
  )
}
