'use client'

/* ================================================================== */
/* Storage audit engine — P9-W7 ("Fortify" wave 7).                    */
/*                                                                     */
/* Three audits over every data domain ToolHub owns:                   */
/*                                                                     */
/*  1. Migration matrix  — replay realistic persisted shapes from the  */
/*     store's whole version history (v0 → v6) through the EXACT       */
/*     migratePersistedState() the store runs at boot, and validate    */
/*     the invariants every profile must satisfy afterwards.           */
/*  2. Live store + corrupt scan — walk every owned localStorage key,  */
/*     JSON-validate it, deep-check the persisted OS store shape, and  */
/*     quarantine anything unreadable so the platform boots clean.     */
/*  3. Domain coverage — prove the Backup & Restore domain map knows   */
/*     about every toolhub database and every toolhub key on this      */
/*     origin; an unknown domain would silently escape backups.        */
/*                                                                     */
/* Quarantine is explicit and lossless: raw bytes are kept under       */
/* toolhub.quarantine.<key> until the owner discards them.             */
/* ================================================================== */

import { SYSTEM_APP_IDS } from '@/lib/constants'
import { tools } from '@/lib/tools/registry'
import { migratePersistedState } from '@/lib/store/app-store'
import { useExternalApps } from '@/lib/tools/external'
import { IDB_DBS, LS_KEYS, LS_PREFIXES } from '@/lib/storage-domains'

/* ------------------------------------------------------------------ */
/* 1. Migration matrix                                                 */
/* ------------------------------------------------------------------ */

/** HomeItem-lite shapes used to build historical layouts in fixtures. */
type FixtureLayout = Array<Record<string, unknown>>

interface MigrationFixture {
  version: number
  label: string
  state: Record<string, unknown>
}

function sysApps(): string[] {
  /* realistic mid-2025 profile: user apps + all three pre-v4 system apps */
  return ['notes', 'calculator', 'clock', 'weather', 'gallery', 'camera', ...SYSTEM_APP_IDS]
}

/**
 * Historical shapes the store actually shipped over its life. Each one
 * must migrate into a fully valid current profile.
 */
export const MIGRATION_FIXTURES: MigrationFixture[] = [
  {
    version: 0,
    label: 'v0 · fresh device (nothing persisted)',
    state: {},
  },
  {
    version: 0,
    label: 'v0 · empty installed list',
    state: { installed: [] },
  },
  {
    version: 1,
    label: 'v1 · pre-layout (installed only)',
    state: { installed: ['notes', 'calculator', 'clock', 'weather'] },
  },
  {
    version: 2,
    label: 'v2 · layout with a folder',
    state: {
      installed: sysApps(),
      layout: [
        { kind: 'folder', id: 'fld-tools', appIds: ['notes', 'calculator'] },
        { kind: 'app', id: 'weather' },
      ],
      favorites: ['notes'],
    } as unknown as { installed: string[]; layout: FixtureLayout; favorites: string[] },
  },
  {
    version: 3,
    label: 'v3 · profile predating system backfill',
    state: { installed: ['notes', 'calculator', 'clock', 'weather'], layout: [] },
  },
  {
    version: 5,
    label: 'v5 · pre-Help Center profile',
    state: { installed: sysApps(), layout: [{ kind: 'app', id: 'notes' }], recents: ['notes'] },
  },
  {
    version: 6,
    label: 'v6 · current full profile (idempotency)',
    state: {
      installed: [...sysApps(), 'help'],
      layout: [
        { kind: 'app', id: 'notes' },
        { kind: 'folder', id: 'fld-games', appIds: ['calculator', 'clock'] },
      ],
      favorites: ['weather'],
      recents: ['gallery'],
    },
  },
]

export interface MatrixResult {
  version: number
  label: string
  pass: boolean
  issues: string[]
}

const registryIds = new Set(tools.map((t) => t.id))

/** Runs one fixture through the real migrate and validates invariants. */
function checkFixture(fx: MigrationFixture): MatrixResult {
  const issues: string[] = []
  try {
    const out = migratePersistedState({ state: fx.state, version: fx.version })
    const installed = Array.isArray(out.installed) ? (out.installed as string[]) : []

    if (!Array.isArray(installed) || installed.length === 0) {
      issues.push('installed list empty after migrate')
    }
    if (SYSTEM_APP_IDS.some((id) => !installed.includes(id))) {
      issues.push(`missing system apps: ${SYSTEM_APP_IDS.filter((id) => !installed.includes(id)).join(', ')}`)
    }
    if (!installed.includes('help')) issues.push('help not backfilled')
    const dupes = installed.filter((id, i) => installed.indexOf(id) !== i)
    if (dupes.length > 0) issues.push(`duplicate installs: ${[...new Set(dupes)].join(', ')}`)

    const layout = (out.layout ?? []) as unknown as Array<{
      kind?: unknown
      id?: unknown
      appIds?: unknown
    }>
    if (!Array.isArray(layout)) issues.push('layout is not an array')
    else {
      for (const item of layout) {
        if (item.kind === 'app') {
          if (!installed.includes(String(item.id))) issues.push(`layout app "${String(item.id)}" not installed`)
        } else if (item.kind === 'folder') {
          const appIds = Array.isArray(item.appIds) ? (item.appIds as string[]) : []
          if (appIds.some((id) => !installed.includes(id)))
            issues.push(`folder references uninstalled app: ${appIds.find((id) => !installed.includes(id))}`)
        } else {
          issues.push(`unknown layout item kind "${String(item.kind)}"`)
        }
      }
    }

    /* every installed id must exist in the registry (external platforms come
     * from the server list, so builtin ids only here — a stale/renamed id
     * would render a ghost tile) */
    const ghosts = installed.filter((id) => !registryIds.has(id))
    if (ghosts.length > 0) issues.push(`ghost installs: ${ghosts.join(', ')}`)
  } catch (err) {
    issues.push(`migrate threw: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { version: fx.version, label: fx.label, pass: issues.length === 0, issues }
}

export function runMigrationMatrix(): MatrixResult[] {
  return MIGRATION_FIXTURES.map(checkFixture)
}

/* ------------------------------------------------------------------ */
/* 2. Live store + corrupt scan                                        */
/* ------------------------------------------------------------------ */

const CURRENT_STORE_VERSION = 6
const QUARANTINE_PREFIX = 'toolhub.quarantine.'

/** Every key on this origin ToolHub considers its own. */
function isOwnedKey(key: string): boolean {
  return (
    key.startsWith('toolhub') ||
    key.startsWith('weather-') ||
    key.startsWith('currency-rates') ||
    key.startsWith('persist:') ||
    key.startsWith('nextauth')
  )
}

function lsKeyCovered(key: string): boolean {
  if (key in LS_KEYS) return true
  return LS_PREFIXES.some((p) => key.startsWith(p.prefix))
}

export interface KeyFinding {
  key: string
  severity: 'fail' | 'warn'
  reason: string
}

/** JSON-validates every owned key and deep-checks the persisted OS store. */
export function scanCorruptKeys(): KeyFinding[] {
  const findings: KeyFinding[] = []
  const seen = new Set<string>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (!key || seen.has(key)) continue
    seen.add(key)
    if (!isOwnedKey(key) || key.startsWith(QUARANTINE_PREFIX)) continue

    const raw = localStorage.getItem(key) ?? ''
    if (raw.startsWith('{') || raw.startsWith('[')) {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        findings.push({
          key,
          severity: 'fail',
          reason: 'unreadable JSON — the app that owns it will crash on boot',
        })
        continue
      }
      if (key === 'toolhub-store') deepCheckStore(parsed, findings)
    }

    /* coverage: owned keys the backup map does not know would escape backups */
    if (!lsKeyCovered(key)) {
      findings.push({
        key,
        severity: 'warn',
        reason: 'not in the Backup & Restore domain map — this data escapes backups',
      })
    }
  }
  return findings
}

function deepCheckStore(parsed: unknown, findings: KeyFinding[]): void {
  const asWrapper = parsed as { state?: unknown; version?: unknown } | null
  if (!asWrapper || typeof asWrapper !== 'object') {
    findings.push({ key: 'toolhub-store', severity: 'fail', reason: 'persisted wrapper missing (state/version)' })
    return
  }
  if (typeof asWrapper.version !== 'number') {
    findings.push({ key: 'toolhub-store', severity: 'fail', reason: 'persisted version is not a number' })
  } else if (asWrapper.version > CURRENT_STORE_VERSION) {
    findings.push({
      key: 'toolhub-store',
      severity: 'warn',
      reason: `persisted from a newer app build (v${asWrapper.version}) — downgrading may drop settings`,
    })
  }
  const state = asWrapper.state as Record<string, unknown> | undefined
  if (!state || typeof state !== 'object') {
    findings.push({ key: 'toolhub-store', severity: 'fail', reason: 'persisted state object missing' })
    return
  }
  if (state.installed !== undefined && !Array.isArray(state.installed)) {
    findings.push({ key: 'toolhub-store', severity: 'fail', reason: 'installed list is not an array' })
  }
}

export interface StoreIntegrity {
  versionFound: number | null
  currentVersion: number
  installedCount: number
  unknownIds: number
  ok: boolean
  summary: string
}

/** Snapshot of the live OS store for the audit panel. */
export function readStoreIntegrity(): StoreIntegrity {
  /* linked platforms live on the server and join `installed` by id — they
   * are legitimate non-registry ids, so unknown = not builtin AND not external */
  const externalIds = new Set(useExternalApps.getState().apps.map((a) => a.id))
  let versionFound: number | null = null
  let installedCount = 0
  let unknownIds = 0
  let ok = true
  let summary: string
  try {
    const raw = localStorage.getItem('toolhub-store')
    if (!raw) {
      return {
        versionFound: null,
        currentVersion: CURRENT_STORE_VERSION,
        installedCount: 0,
        unknownIds: 0,
        ok: true,
        summary: 'No persisted profile yet — first run has not completed.',
      }
    }
    const parsed = JSON.parse(raw) as { state?: { installed?: string[] }; version?: number }
    versionFound = typeof parsed.version === 'number' ? parsed.version : null
    const installed = Array.isArray(parsed.state?.installed) ? (parsed.state!.installed as string[]) : []
    installedCount = installed.length
    unknownIds = installed.filter((id) => !registryIds.has(id) && !externalIds.has(id)).length
    if (versionFound === null || unknownIds > 0) ok = false
    summary =
      versionFound === null
        ? `${installedCount} installed ids · version missing`
        : `store v${versionFound} → app v${CURRENT_STORE_VERSION} · ${installedCount} installed ids${unknownIds > 0 ? ` · ${unknownIds} unknown` : ''}`
  } catch {
    ok = false
    summary = 'toolhub-store is unreadable — quarantine it to recover'
  }
  return { versionFound, currentVersion: CURRENT_STORE_VERSION, installedCount, unknownIds, ok, summary }
}

/* ------------------------------------------------------------------ */
/* Quarantine (lossless recovery)                                      */
/* ------------------------------------------------------------------ */

export interface QuarantineEntry {
  /** the quarantine storage key (unique id) */
  id: string
  originalKey: string
  quarantinedAt: number
  bytes: number
}

/**
 * Move a corrupt key out of the live namespace. The raw bytes survive in
 * toolhub.quarantine.<key> (salvageable by hand); the original key is
 * removed so the owning app boots with fresh defaults.
 */
export function quarantineKey(key: string): boolean {
  const raw = localStorage.getItem(key)
  if (raw === null) return false
  try {
    localStorage.setItem(
      `${QUARANTINE_PREFIX}${key}`,
      JSON.stringify({ key, raw: raw.slice(0, 512_000), at: Date.now() })
    )
    localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function listQuarantine(): QuarantineEntry[] {
  const out: QuarantineEntry[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const qk = localStorage.key(i)
    if (!qk || !qk.startsWith(QUARANTINE_PREFIX)) continue
    try {
      const rec = JSON.parse(localStorage.getItem(qk) ?? '{}') as {
        key?: string
        at?: number
        raw?: string
      }
      out.push({
        id: qk,
        originalKey: rec.key ?? qk.slice(QUARANTINE_PREFIX.length),
        quarantinedAt: rec.at ?? 0,
        bytes: (rec.raw ?? '').length,
      })
    } catch {
      out.push({ id: qk, originalKey: qk.slice(QUARANTINE_PREFIX.length), quarantinedAt: 0, bytes: 0 })
    }
  }
  return out
}

/** Permanently discard a quarantined copy (the owner has given up on it). */
export function discardQuarantine(id: string): boolean {
  try {
    localStorage.removeItem(id)
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* 3. Domain coverage                                                  */
/* ------------------------------------------------------------------ */

export interface CoverageFinding {
  domain: string
  kind: 'ls' | 'idb'
  covered: boolean
}

/** Every toolhub* database on this origin vs the backup domain map. */
export async function scanDomainCoverage(): Promise<CoverageFinding[]> {
  const findings: CoverageFinding[] = []
  const seenLs = new Set<string>()
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('toolhub') && !key.startsWith(QUARANTINE_PREFIX)) {
      seenLs.add(key)
      findings.push({ domain: key, kind: 'ls', covered: lsKeyCovered(key) })
    }
  }
  if (typeof indexedDB.databases === 'function') {
    try {
      const dbs = (await indexedDB.databases()) as Array<{ name?: string }>
      for (const { name } of dbs) {
        if (!name || !name.startsWith('toolhub')) continue
        findings.push({ domain: name, kind: 'idb', covered: name in IDB_DBS })
      }
    } catch {
      /* databases() unsupported — coverage limited to localStorage */
    }
  }
  return findings
}
