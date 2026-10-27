/**
 * ToolHub theme system — single source of truth.
 *
 * Three independent layers of personalization:
 *  1. Mode    — light / dark / amoled (pure black) / follow-system
 *  2. Accent  — 8 color palettes applied via [data-accent] CSS tokens
 *  3. Wallpaper — home-screen background (independent of accent)
 *
 * CSS side lives in globals.css: accent tokens are declared as
 * `[data-accent='<id>']` + `.dark[data-accent='<id>']` blocks.
 */

/* ---------------------------------------------------------------- */
/* Accent                                                            */
/* ---------------------------------------------------------------- */

export type AccentId =
  | 'emerald'
  | 'ocean'
  | 'azure'
  | 'violet'
  | 'rose'
  | 'sunset'
  | 'gold'
  | 'crimson'

export interface AccentDef {
  id: AccentId
  name: string
  /** tailwind gradient classes for swatch previews */
  swatch: string
  /** browser chrome color (PWA status bar tint on Android) */
  chrome: { light: string; dark: string }
}

export const ACCENTS: AccentDef[] = [
  {
    id: 'emerald',
    name: 'Emerald',
    swatch: 'from-emerald-500 to-teal-600',
    chrome: { light: '#f4faf7', dark: '#12211f' },
  },
  {
    id: 'ocean',
    name: 'Ocean',
    swatch: 'from-teal-400 to-cyan-600',
    chrome: { light: '#f3fafb', dark: '#0f2026' },
  },
  {
    id: 'azure',
    name: 'Azure',
    swatch: 'from-sky-400 to-blue-600',
    chrome: { light: '#f3f7fc', dark: '#101c2b' },
  },
  {
    id: 'violet',
    name: 'Violet',
    swatch: 'from-violet-500 to-purple-600',
    chrome: { light: '#faf7fd', dark: '#1b1426' },
  },
  {
    id: 'rose',
    name: 'Rose',
    swatch: 'from-pink-500 to-rose-600',
    chrome: { light: '#fdf5f7', dark: '#271318' },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    swatch: 'from-orange-500 to-red-500',
    chrome: { light: '#fdf6f2', dark: '#251512' },
  },
  {
    id: 'gold',
    name: 'Gold',
    swatch: 'from-amber-400 to-yellow-600',
    chrome: { light: '#fdfaf2', dark: '#241e10' },
  },
  {
    id: 'crimson',
    name: 'Crimson',
    swatch: 'from-red-500 to-rose-700',
    chrome: { light: '#fdf4f4', dark: '#261212' },
  },
]

export const DEFAULT_ACCENT: AccentId = 'emerald'

export function getAccent(id: string): AccentDef {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]
}

/* ---------------------------------------------------------------- */
/* Mode                                                              */
/* ---------------------------------------------------------------- */

export type ModeId = 'light' | 'dark' | 'amoled' | 'system'

export interface ModeDef {
  id: ModeId
  name: string
  description: string
}

export const MODES: ModeDef[] = [
  { id: 'light', name: 'Light', description: 'Bright and clean' },
  { id: 'dark', name: 'Dark', description: 'Easy on the eyes' },
  { id: 'amoled', name: 'AMOLED', description: 'True black, saves battery' },
  { id: 'system', name: 'System', description: 'Match your device' },
]

export const DEFAULT_MODE: ModeId = 'system'

/* ---------------------------------------------------------------- */
/* Wallpaper                                                         */
/* ---------------------------------------------------------------- */

export type WallpaperId =
  | 'sunset'
  | 'ocean'
  | 'forest'
  | 'midnight'
  | 'aurora'
  | 'nebula'
  | 'pearl'
  | 'mint'
  | 'blossom'
  | 'haze'
  | 'sand'
  | 'porcelain'
  /** D39 Wallpaper Studio — user-designed wallpaper resolved via activeCustomId */
  | 'custom'

export interface WallpaperDef {
  id: WallpaperId
  name: string
  className: string
  /** true → light-on-dark status text; false → dark-on-light */
  dark: boolean
}

export const WALLPAPERS: WallpaperDef[] = [
  // Dark wallpapers — vivid, cinematic gradient meshes
  { id: 'sunset', name: 'Sunset', className: 'wp-sunset', dark: true },
  { id: 'ocean', name: 'Ocean', className: 'wp-ocean', dark: true },
  { id: 'forest', name: 'Forest', className: 'wp-forest', dark: true },
  { id: 'midnight', name: 'Midnight', className: 'wp-midnight', dark: true },
  { id: 'aurora', name: 'Aurora', className: 'wp-aurora', dark: true },
  { id: 'nebula', name: 'Nebula', className: 'wp-nebula', dark: true },
  // Light wallpapers — soft, airy pastel meshes
  { id: 'pearl', name: 'Pearl', className: 'wp-pearl', dark: false },
  { id: 'mint', name: 'Mint', className: 'wp-mint', dark: false },
  { id: 'blossom', name: 'Blossom', className: 'wp-blossom', dark: false },
  { id: 'haze', name: 'Haze', className: 'wp-haze', dark: false },
  { id: 'sand', name: 'Sand', className: 'wp-sand', dark: false },
  { id: 'porcelain', name: 'Porcelain', className: 'wp-porcelain', dark: false },
]

export const DEFAULT_WALLPAPER: WallpaperId = 'sunset'

export function getWallpaper(id: string): WallpaperDef {
  return WALLPAPERS.find((w) => w.id === id) ?? WALLPAPERS[0]
}

/* ---------------------------------------------------------------- */
/* Custom wallpapers (D39 Wallpaper Studio)                          */
/* ---------------------------------------------------------------- */

/**
 * A user-designed wallpaper. `css` is a composed multi-layer CSS
 * `background` value (linear-gradient base + radial mesh blobs, optional
 * grain/vignette layers) produced by Wallpaper Studio. `dark` drives
 * status-bar / launcher-icon contrast the same way `WallpaperDef.dark`
 * does for presets.
 */
export interface CustomWallpaper {
  id: string
  name: string
  css: string
  /** true → light-on-dark status text; false → dark-on-light */
  dark: boolean
  createdAt: number
}

/**
 * Effective status-bar contrast for the active wallpaper. Custom
 * wallpapers carry their own `dark` flag; with `wallpaper === 'custom'`
 * but no active/known def the default preset is used instead.
 */
export function wallpaperIsDark(id: string, custom: CustomWallpaper | null): boolean {
  if (id === 'custom' && custom) return custom.dark
  return getWallpaper(id).dark
}
