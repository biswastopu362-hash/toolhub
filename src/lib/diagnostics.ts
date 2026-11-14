/**
 * ToolHub Diagnostics Center — P9-W1 ("Fortify" wave 1).
 *
 * A batteries-included, client-side health check engine that sweeps the
 * whole platform from inside the Admin Console:
 *
 *  1. Registry integrity   — every builtin tool has a complete, well-formed definition
 *  2. Install drift        — persisted `installed` list vs the live registry (orphans / missing system apps)
 *  3. Storage quota        — navigator.storage.estimate() with a warn threshold
 *  4. localStorage health  — JSON validity + size budget for every platform key
 *  5. IndexedDB health     — every known database opens cleanly
 *  6. Service worker/cache — registration alive, stale toolhub caches purged
 *  7. Web manifest         — reachable, named, icons present
 *  8. Feature support      — platform API matrix (informational)
 *  9. Foreign-key scan     — localStorage keys ToolHub did not create
 *
 * Every check may offer an optional, explicit "fix" action (never automatic
 * except where lossless) — the owner decides. Zero data leaves the device.
 */

import { tools } from '@/lib/tools/registry'
import { SYSTEM_APP_IDS } from '@/lib/constants'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type DiagLevel = 'ok' | 'warn' | 'fail'

export interface DiagFix {
  /** Button label, e.g. "Purge stale caches". */
  label: string
  /**
   * Runs the fix. Returns `true` when the page must reload for the change
   * to take effect (the UI then schedules a reload).
   */
  run: () => Promise<boolean> | boolean
}

export interface DiagCheck {
  id: string
  title: string
  status: DiagLevel
  detail: string
  fix?: DiagFix
}

export const DIAG_TOTAL = 9

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

const PERSIST_KEY = 'toolhub-store'

/** Keys ToolHub owns. Anything else on this origin is flagged as foreign.
 * `nextauth` is included because our own sign-in dependency (NextAuth popup
 * messaging) writes its broadcast key on this origin. */
const OWNED_KEY_PREFIXES = ['toolhub', 'weather-cache', 'persist:', 'nextauth']

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function readPersistedState(): { state: Record<string, unknown>; version: number } | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown>; version?: number }
    if (!parsed || typeof parsed !== 'object' || !parsed.state) return null
    return { state: parsed.state, version: typeof parsed.version === 'number' ? parsed.version : 0 }
  } catch {
    return null
  }
}

function openDbOnce(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(name)
      req.onsuccess = () => {
        req.result.close()
        resolve(true)
      }
      req.onerror = () => resolve(false)
      req.onblocked = () => resolve(true)
    } catch {
      resolve(false)
    }
  })
}

/* ------------------------------------------------------------------ */
/* Fix actions                                                         */
/* ------------------------------------------------------------------ */

/** Remove installed ids that no longer exist + re-seat any missing system app. */
function fixInstallDrift(): boolean {
  const persisted = readPersistedState()
  if (!persisted) return false
  const registryIds = new Set(tools.map((t) => t.id))
  const installed = Array.isArray(persisted.state.installed)
    ? (persisted.state.installed as string[])
    : []
  const cleaned = installed.filter((id) => registryIds.has(id))
  for (const sid of SYSTEM_APP_IDS) {
    if (!cleaned.includes(sid)) cleaned.push(sid)
  }
  try {
    const raw = JSON.parse(localStorage.getItem(PERSIST_KEY) ?? '{}')
    raw.state = { ...raw.state, installed: cleaned }
    localStorage.setItem(PERSIST_KEY, JSON.stringify(raw))
    return true
  } catch {
    return false
  }
}

/** Delete every toolhub cache snapshot older than the newest one on disk. */
async function fixPurgeStaleCaches(): Promise<boolean> {
  if (!('caches' in window)) return false
  const names = await caches.keys()
  const toolhub = names
    .filter((n) => /^toolhub-v\d+$/.test(n))
    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)))
  const stale = toolhub.slice(0, -1)
  await Promise.all(stale.map((n) => caches.delete(n)))
  return false
}

/* ------------------------------------------------------------------ */
/* The nine checks                                                     */
/* ------------------------------------------------------------------ */

function checkRegistryIntegrity(): DiagCheck {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const t of tools) {
    if (seen.has(t.id)) issues.push(`duplicate id "${t.id}"`)
    seen.add(t.id)
    if (!t.name) issues.push(`${t.id || '(no id)'}: missing name`)
    if (!t.description && !t.tagline) issues.push(`${t.id}: missing description`)
    if (!t.icon) issues.push(`${t.id}: missing icon`)
    if (!t.gradient || !(t.gradient.includes('from-') || t.gradient.includes('bg-')))
      issues.push(`${t.id}: suspicious gradient`)
    if (!t.glow || !t.glow.startsWith('#')) issues.push(`${t.id}: glow is not a hex color`)
    if (typeof t.Component !== 'function') issues.push(`${t.id}: missing component`)
    if (!t.keywords || t.keywords.length === 0) issues.push(`${t.id}: no search keywords`)
  }
  if (issues.length === 0) {
    return {
      id: 'registry',
      title: 'Registry integrity',
      status: 'ok',
      detail: `${tools.length} tools · all definitions complete and unique`,
    }
  }
  return {
    id: 'registry',
    title: 'Registry integrity',
    status: 'fail',
    detail: `${issues.length} issue${issues.length === 1 ? '' : 's'}: ${issues.slice(0, 3).join(' · ')}`,
  }
}

function checkInstallDrift(): DiagCheck {
  const persisted = readPersistedState()
  if (!persisted) {
    return {
      id: 'drift',
      title: 'Installed list vs registry',
      status: 'warn',
      detail: 'Launcher state not found — first run may not have completed.',
    }
  }
  const registryIds = new Set(tools.map((t) => t.id))
  const installed = Array.isArray(persisted.state.installed)
    ? (persisted.state.installed as string[])
    : []
  const orphans = installed.filter((id) => !registryIds.has(id))
  const missingSystem = SYSTEM_APP_IDS.filter((id) => !installed.includes(id))
  const validCount = installed.length - orphans.length
  if (orphans.length === 0 && missingSystem.length === 0) {
    return {
      id: 'drift',
      title: 'Installed list vs registry',
      status: 'ok',
      detail: `${validCount}/${tools.length} installed ids valid · system apps seated · store v${persisted.version}`,
    }
  }
  const bits: string[] = []
  if (orphans.length) bits.push(`${orphans.length} orphan${orphans.length === 1 ? '' : 's'} (${orphans.slice(0, 3).join(', ')})`)
  if (missingSystem.length) bits.push(`missing system: ${missingSystem.join(', ')}`)
  return {
    id: 'drift',
    title: 'Installed list vs registry',
    status: 'warn',
    detail: bits.join(' · '),
    fix: { label: 'Repair list', run: fixInstallDrift },
  }
}

async function checkStorageQuota(): Promise<DiagCheck> {
  if (!navigator.storage?.estimate) {
    return {
      id: 'quota',
      title: 'Storage quota',
      status: 'ok',
      detail: 'Quota API unavailable on this browser — skipping (no action needed).',
    }
  }
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  const pct = quota > 0 ? (usage / quota) * 100 : 0
  const usedMb = (usage / (1024 * 1024)).toFixed(1)
  const quotaGb = (quota / (1024 * 1024 * 1024)).toFixed(1)
  if (pct > 90) {
    return {
      id: 'quota',
      title: 'Storage quota',
      status: 'fail',
      detail: `${usedMb} MB of ${quotaGb} GB used (${pct.toFixed(0)}%) — media may fail to save. Clean up Files or media apps.`,
    }
  }
  if (pct > 75) {
    return {
      id: 'quota',
      title: 'Storage quota',
      status: 'warn',
      detail: `${usedMb} MB of ${quotaGb} GB used (${pct.toFixed(0)}%) — getting close to the browser limit.`,
    }
  }
  return {
    id: 'quota',
    title: 'Storage quota',
    status: 'ok',
    detail: `${usedMb} MB of ${quotaGb} GB used (${pct.toFixed(1)}%)`,
  }
}

function checkLocalStorage(): DiagCheck {
  let totalBytes = 0
  let keyCount = 0
  const corrupt: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    keyCount++
    const value = localStorage.getItem(key) ?? ''
    totalBytes += (key.length + value.length) * 2
    const owned = OWNED_KEY_PREFIXES.some((p) => key.startsWith(p))
    if (owned && (value.startsWith('{') || value.startsWith('['))) {
      try {
        JSON.parse(value)
      } catch {
        corrupt.push(key)
      }
    }
  }
  const kb = (totalBytes / 1024).toFixed(0)
  if (corrupt.length > 0) {
    return {
      id: 'ls',
      title: 'localStorage health',
      status: 'fail',
      detail: `${keyCount} keys · ${kb} KB · corrupt JSON in: ${corrupt.slice(0, 2).join(', ')}`,
      fix: {
        label: 'Remove corrupt keys',
        run: () => {
          for (const key of corrupt) localStorage.removeItem(key)
          return true
        },
      },
    }
  }
  if (totalBytes > 4.5 * 1024 * 1024) {
    return {
      id: 'ls',
      title: 'localStorage health',
      status: 'warn',
      detail: `${keyCount} keys · ${kb} KB — near the ~5 MB browser budget; export + trim old data.`,
    }
  }
  return {
    id: 'ls',
    title: 'localStorage health',
    status: 'ok',
    detail: `${keyCount} keys · ${kb} KB · all platform keys parse cleanly`,
  }
}

const CORE_DBS = ['toolhub-docs', 'toolhub-media', 'toolhub-video']

async function checkIndexedDb(): Promise<DiagCheck> {
  if (!('indexedDB' in window)) {
    return {
      id: 'idb',
      title: 'IndexedDB health',
      status: 'fail',
      detail: 'IndexedDB unavailable — Documents, media and game scores cannot persist.',
    }
  }
  /* Discover every database on this origin. Any `toolhub*` name was created
   * by our own apps (34+ stores across the catalog), so it is ours; only
   * foreign names are suspicious. Core DBs are always open-tested even when
   * databases() is unsupported. */
  const discovered: string[] = []
  if (typeof indexedDB.databases === 'function') {
    try {
      const all = (await indexedDB.databases()) as Array<{ name?: string }>
      discovered.push(...all.map((d) => d.name).filter((n): n is string => !!n))
    } catch {
      /* databases() unsupported — fall back to the core list */
    }
  }
  const ours = Array.from(new Set([...CORE_DBS, ...discovered.filter((n) => n.startsWith('toolhub'))]))
  const foreign = discovered.filter((n) => !n.startsWith('toolhub'))
  const failed: string[] = []
  for (const name of ours) {
    const ok = await openDbOnce(name)
    if (!ok) failed.push(name)
    await sleep(15)
  }
  if (failed.length > 0) {
    return {
      id: 'idb',
      title: 'IndexedDB health',
      status: 'fail',
      detail: `${failed.length}/${ours.length} databases failed to open: ${failed.slice(0, 3).join(', ')}`,
    }
  }
  if (foreign.length > 0) {
    return {
      id: 'idb',
      title: 'IndexedDB health',
      status: 'warn',
      detail: `${ours.length} toolhub databases open cleanly · ${foreign.length} foreign DB${foreign.length === 1 ? '' : 's'} (${foreign.slice(0, 2).join(', ')})`,
    }
  }
  return {
    id: 'idb',
    title: 'IndexedDB health',
    status: 'ok',
    detail: `${ours.length} databases open cleanly (docs · media · video + every app store)`,
  }
}

async function checkServiceWorker(): Promise<DiagCheck> {
  if (!('serviceWorker' in navigator)) {
    return {
      id: 'sw',
      title: 'Service worker & caches',
      status: 'warn',
      detail: 'Service worker unsupported here — the offline shell will not engage.',
    }
  }
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) {
    return {
      id: 'sw',
      title: 'Service worker & caches',
      status: 'fail',
      detail: 'No service worker registered — offline mode and prefetch warming are down. Reload to re-register.',
      fix: { label: 'Reload to register', run: () => true },
    }
  }
  const names = await caches.keys()
  const toolhubCaches = names
    .filter((n) => /^toolhub-v\d+$/.test(n))
    .sort((a, b) => Number(a.slice(9)) - Number(b.slice(9)))
  const current = toolhubCaches.at(-1)
  const stale = toolhubCaches.slice(0, -1)
  let assetCount = 0
  if (current) {
    try {
      assetCount = (await (await caches.open(current)).keys()).length
    } catch {
      /* ignore */
    }
  }
  const scope = reg.scope.replace(/\/$/, '').split('/').pop() || '/'
  if (stale.length > 0) {
    return {
      id: 'sw',
      title: 'Service worker & caches',
      status: 'warn',
      detail: `SW live (${scope}) · ${assetCount} assets in ${current} · ${stale.length} stale snapshot${stale.length === 1 ? '' : 's'} wasting space`,
      fix: { label: 'Purge stale caches', run: fixPurgeStaleCaches },
    }
  }
  return {
    id: 'sw',
    title: 'Service worker & caches',
    status: 'ok',
    detail: `SW live (${scope}) · ${assetCount} assets cached in ${current ?? 'no cache yet'}`,
  }
}

async function checkManifest(): Promise<DiagCheck> {
  const href =
    document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href ??
    new URL('/manifest.webmanifest', window.location.origin).href
  try {
    const res = await fetch(href, { cache: 'no-store' })
    if (!res.ok) throw new Error(String(res.status))
    const json = (await res.json()) as { name?: string; icons?: unknown[]; shortcuts?: unknown[] }
    const iconCount = Array.isArray(json.icons) ? json.icons.length : 0
    if (!json.name || iconCount === 0) {
      return {
        id: 'manifest',
        title: 'Web manifest',
        status: 'warn',
        detail: `Manifest reachable but thin (name: ${json.name ? 'yes' : 'no'}, icons: ${iconCount}) — install prompts may degrade.`,
      }
    }
    return {
      id: 'manifest',
      title: 'Web manifest',
      status: 'ok',
      detail: `"${json.name}" · ${iconCount} icons · ${Array.isArray(json.shortcuts) ? json.shortcuts.length : 0} shortcuts`,
    }
  } catch {
    return {
      id: 'manifest',
      title: 'Web manifest',
      status: 'fail',
      detail: 'Manifest unreachable — PWA installability is broken. Redeploy or check the build.',
    }
  }
}

async function checkFeatureSupport(): Promise<DiagCheck> {
  const features: Array<[string, boolean]> = [
    ['Service worker', 'serviceWorker' in navigator],
    ['IndexedDB', 'indexedDB' in window],
    ['Storage quota', !!navigator.storage?.estimate],
    ['WebAuthn', 'PublicKeyCredential' in window],
    ['Clipboard', !!navigator.clipboard?.writeText],
    ['Web Share', !!navigator.share],
    ['Haptics', 'vibrate' in navigator],
    ['WebCrypto', !!window.crypto?.subtle],
  ]
  const missing = features.filter(([, has]) => !has).map(([name]) => name)
  const criticalMissing = missing.filter((n) => n === 'Service worker' || n === 'IndexedDB')
  return {
    id: 'features',
    title: 'Platform feature support',
    status: criticalMissing.length > 0 ? 'fail' : missing.length > 0 ? 'warn' : 'ok',
    detail:
      missing.length > 0
        ? `${features.length - missing.length}/${features.length} APIs available · missing: ${missing.join(', ')}`
        : `${features.length}/${features.length} platform APIs available on this browser`,
  }
}

function checkForeignKeys(): DiagCheck {
  const foreign: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key) continue
    if (!OWNED_KEY_PREFIXES.some((p) => key.startsWith(p))) foreign.push(key)
  }
  if (foreign.length === 0) {
    return {
      id: 'foreign',
      title: 'Foreign storage keys',
      status: 'ok',
      detail: 'Every key on this origin belongs to ToolHub',
    }
  }
  return {
    id: 'foreign',
    title: 'Foreign storage keys',
    status: 'warn',
    detail: `${foreign.length} key${foreign.length === 1 ? '' : 's'} ToolHub did not create: ${foreign.slice(0, 3).join(', ')}`,
  }
}

/* ------------------------------------------------------------------ */
/* Runner                                                              */
/* ------------------------------------------------------------------ */

/**
 * Runs all nine checks sequentially, streaming each result through
 * `onEach` so the UI can show live progress. Small sleeps between checks
 * keep the main thread responsive on phones.
 */
export async function runDiagnostics(onEach: (check: DiagCheck) => void): Promise<void> {
  const runners: Array<() => DiagCheck | Promise<DiagCheck>> = [
    () => checkRegistryIntegrity(),
    () => checkInstallDrift(),
    () => checkStorageQuota(),
    () => checkLocalStorage(),
    () => checkIndexedDb(),
    () => checkServiceWorker(),
    () => checkManifest(),
    () => checkFeatureSupport(),
    () => checkForeignKeys(),
  ]
  for (const run of runners) {
    await sleep(80)
    onEach(await run())
  }
}

/** 100 − 10 per warning − 25 per failure, floored at 0. */
export function healthScore(checks: DiagCheck[]): number {
  let score = 100
  for (const c of checks) {
    if (c.status === 'warn') score -= 10
    else if (c.status === 'fail') score -= 25
  }
  return Math.max(0, score)
}
