/**
 * Home-screen layout engine — pure functions over the persisted layout.
 *
 * A layout is an ordered list of items rendered on the home-screen grid:
 *  - `{ kind: 'app', id }`                      → a single app icon (id = tool id)
 *  - `{ kind: 'folder', id, appIds, name? }`    → a user-created folder
 *
 * The dock is fixed and never part of the layout. All functions are pure
 * (return new arrays) so the store can stay tiny and predictable.
 */

export interface HomeAppItem {
  kind: 'app'
  id: string
}

export interface HomeFolderItem {
  kind: 'folder'
  id: string
  appIds: string[]
  name?: string
}

export type HomeItem = HomeAppItem | HomeFolderItem

let folderSeq = 0

export function newFolderId(): string {
  folderSeq += 1
  return `f_${Date.now().toString(36)}_${folderSeq.toString(36)}`
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

/** Move the item at `from` so it lands at `to` (rest of the items shifts). */
export function moveItemOp(layout: HomeItem[], from: number, to: number): HomeItem[] {
  if (from === to || from < 0 || from >= layout.length) return layout
  const next = layout.slice()
  const [item] = next.splice(from, 1)
  const clamped = Math.max(0, Math.min(to, next.length))
  next.splice(clamped, 0, item)
  return next
}

/** Drop an app onto another app → both merge into a brand-new folder. */
export function createFolderOp(
  layout: HomeItem[],
  draggedId: string,
  targetId: string
): { layout: HomeItem[]; folderId: string | null } {
  const a = layout.findIndex((it) => it.kind === 'app' && it.id === draggedId)
  const b = layout.findIndex((it) => it.kind === 'app' && it.id === targetId)
  if (a < 0 || b < 0 || a === b) return { layout, folderId: null }

  const target = layout[b] as HomeAppItem
  const dragged = layout[a] as HomeAppItem
  const folder: HomeFolderItem = {
    kind: 'folder',
    id: newFolderId(),
    appIds: [target.id, dragged.id],
  }

  const next = layout.filter((_, i) => i !== a && i !== b)
  next.splice(Math.min(b, next.length), 0, folder)
  return { layout: next, folderId: folder.id }
}

/** Drop an app onto an existing folder → it joins the folder. */
export function addToFolderOp(
  layout: HomeItem[],
  draggedId: string,
  folderId: string
): HomeItem[] {
  const a = layout.findIndex((it) => it.kind === 'app' && it.id === draggedId)
  const f = layout.findIndex((it) => it.kind === 'folder' && it.id === folderId)
  if (a < 0 || f < 0) return layout
  const dragged = layout[a] as HomeAppItem
  const folder = layout[f] as HomeFolderItem
  if (folder.appIds.includes(draggedId)) return layout

  const next = layout.filter((_, i) => i !== a)
  const folderIdx = f > a ? f - 1 : f
  next[folderIdx] = { ...folder, appIds: [...folder.appIds, draggedId] }
  return next
}

/** Drop a folder onto another folder → merge, keeping the target's place. */
export function mergeFoldersOp(
  layout: HomeItem[],
  draggedId: string,
  targetId: string
): HomeItem[] {
  const a = layout.findIndex((it) => it.kind === 'folder' && it.id === draggedId)
  const b = layout.findIndex((it) => it.kind === 'folder' && it.id === targetId)
  if (a < 0 || b < 0 || a === b) return layout
  const dragged = layout[a] as HomeFolderItem
  const target = layout[b] as HomeFolderItem

  const merged = [...target.appIds]
  for (const id of dragged.appIds) if (!merged.includes(id)) merged.push(id)

  return layout
    .filter((_, i) => i !== a)
    .map((it, i) => (i === (b > a ? b - 1 : b) ? { ...target, appIds: merged } : it))
}

/** Pull an app out of a folder back onto the home grid (appended at the end). */
export function removeFromFolderOp(
  layout: HomeItem[],
  folderId: string,
  appId: string
): HomeItem[] {
  const f = layout.findIndex((it) => it.kind === 'folder' && it.id === folderId)
  if (f < 0) return layout
  const folder = layout[f] as HomeFolderItem
  if (!folder.appIds.includes(appId)) return layout

  const appIds = folder.appIds.filter((id) => id !== appId)
  const next = layout.slice()

  if (appIds.length <= 1) {
    // Folder dissolved — a folder never holds fewer than two apps.
    const rest = appIds.map((id) => ({ kind: 'app', id }) as HomeAppItem)
    next.splice(f, 1, ...rest)
  } else {
    next[f] = { ...folder, appIds }
  }
  next.push({ kind: 'app', id: appId })
  return next
}

export function renameFolderOp(layout: HomeItem[], folderId: string, name: string): HomeItem[] {
  return layout.map((it) =>
    it.kind === 'folder' && it.id === folderId ? { ...it, name: name.trim() || undefined } : it
  )
}

/**
 * Remove an uninstalled app from the layout:
 *  - drops its icon from the grid
 *  - pulls it out of any folder (folders that shrink below 2 apps dissolve,
 *    exactly like `removeFromFolderOp`)
 * Returns the same array reference when nothing had to change.
 */
export function uninstallPruneOp(layout: HomeItem[], appId: string): HomeItem[] {
  const touched =
    layout.some((it) => it.kind === 'app' && it.id === appId) ||
    layout.some((it) => it.kind === 'folder' && it.appIds.includes(appId))
  if (!touched) return layout

  const out: HomeItem[] = []
  for (const it of layout) {
    if (it.kind === 'app') {
      if (it.id !== appId) out.push(it)
      continue
    }
    if (!it.appIds.includes(appId)) {
      out.push(it)
      continue
    }
    const appIds = it.appIds.filter((id) => id !== appId)
    if (appIds.length >= 2) {
      out.push({ ...it, appIds })
    } else if (appIds.length === 1) {
      out.push({ kind: 'app', id: appIds[0] })
    }
    // 0 apps → folder dissolves entirely
  }
  return out
}

/** Fresh default layout — every non-dock app, in registry order. */
export function defaultLayout(allAppIds: string[], dockIds: string[]): HomeItem[] {
  const dock = new Set(dockIds)
  return allAppIds.filter((id) => !dock.has(id)).map((id) => ({ kind: 'app', id }))
}

/**
 * Make a persisted layout consistent with the current app registry:
 *  - items pointing at unknown/removed apps are dropped
 *  - folders that shrank below 2 apps dissolve
 *  - brand-new apps are appended at the end
 * Returns `null` when nothing changed (so callers can avoid store writes).
 */
export function migrateLayout(
  layout: HomeItem[] | undefined,
  allAppIds: string[],
  dockIds: string[]
): HomeItem[] | null {
  const known = new Set(allAppIds)
  const dock = new Set(dockIds)
  const placed = new Set<string>()
  const out: HomeItem[] = []
  const src = Array.isArray(layout) ? layout : []

  for (const item of src) {
    if (item.kind === 'app') {
      if (known.has(item.id) && !dock.has(item.id) && !placed.has(item.id)) {
        placed.add(item.id)
        out.push(item)
      }
    } else {
      const appIds = item.appIds.filter((id) => known.has(id) && !dock.has(id) && !placed.has(id))
      if (appIds.length === 1) {
        placed.add(appIds[0])
        out.push({ kind: 'app', id: appIds[0] })
      } else if (appIds.length >= 2) {
        appIds.forEach((id) => placed.add(id))
        out.push({ ...item, appIds })
      }
      // 0 apps → drop the empty folder
    }
  }

  for (const id of allAppIds) {
    if (!dock.has(id) && !placed.has(id)) {
      placed.add(id)
      out.push({ kind: 'app', id })
    }
  }

  return JSON.stringify(out) === JSON.stringify(src) ? null : out
}

/** Suggested folder title derived from the majority category of its apps. */
export function suggestFolderName(
  appIds: string[],
  categoryOf: (id: string) => string | undefined,
  categoryNameOf: (catId: string) => string | undefined
): string {
  const counts = new Map<string, number>()
  for (const id of appIds) {
    const cat = categoryOf(id)
    if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1)
  }
  let best: string | undefined
  let bestN = 0
  for (const [cat, n] of counts) {
    if (n > bestN) {
      best = categoryNameOf(cat)
      bestN = n
    }
  }
  return best ?? 'Folder'
}

export function isFolder(item: HomeItem): item is HomeFolderItem {
  return item.kind === 'folder'
}

export function isApp(item: HomeItem): item is HomeAppItem {
  return item.kind === 'app'
}
