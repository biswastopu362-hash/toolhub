/**
 * Shared OS constants — tiny dependency-free module so the store,
 * registry and shell never create import cycles.
 */

/** Apps pinned to the dock (fixed, not draggable). */
export const DOCK_IDS = ['store', 'files', 'calculator', 'clock', 'settings'] as const

/** Apps that ship pre-installed on first run (dock + a friendly starter set). */
export const DEFAULT_INSTALLED = [
  'store',
  'settings',
  'files',
  'calculator',
  'clock',
  'weather',
  'notes',
  'unit-converter',
  'qr-generator',
  'gallery',
  'camera',
  'admin-console',
] as const

/** Everything in DEFAULT_INSTALLED, as a plain string[] for runtime use. */
export const DEFAULT_INSTALLED_IDS: string[] = [...DEFAULT_INSTALLED]

/** System apps can never be uninstalled. */
export const SYSTEM_APP_IDS = ['store', 'settings', 'files'] as const
