'use client'

/**
 * Mind Map — two-sided tree editor on an infinite panning canvas.
 *
 * Nodes branch left/right from a single root, drag freely, recolor per
 * branch, collapse subtrees and tidy back into a balanced horizontal
 * layout. Maps persist to localStorage; export/import as JSON keeps
 * everything on-device — nothing ever uploads.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Download,
  Network,
  Plus,
  Trash2,
  Upload,
  Wand2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

interface MindNode {
  id: string
  text: string
  /** world coordinates; root sits at (0, 0) */
  x: number
  y: number
  parent: string | null
  /** index into NODE_COLORS */
  color: number
  /** -1 = left branch, 1 = right branch (root children); inherited */
  side: -1 | 1
  collapsed: boolean
}

interface MindMap {
  id: string
  name: string
  nodes: MindNode[]
  updatedAt: number
}

const LS_KEY = 'toolhub-mindmaps'

const NODE_COLORS = ['#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#06b6d4', '#ef4444']

const NODE_W = 132
const NODE_H = 40
const LEVEL_GAP = 190
const LEAF_GAP = 58

function newId(): string {
  return `mn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function emptyMap(name: string): MindMap {
  return {
    id: newId(),
    name,
    nodes: [
      { id: newId(), text: 'Central idea', x: 0, y: 0, parent: null, color: 0, side: 1, collapsed: false },
    ],
    updatedAt: Date.now(),
  }
}

function seedMaps(): MindMap[] {
  const root = newId()
  const plan = newId()
  const build = newId()
  const market = newId()
  const tasks = newId()
  const beta = newId()
  return [
    {
      id: newId(),
      name: 'Product launch',
      updatedAt: Date.now(),
      nodes: [
        { id: root, text: 'Launch plan', x: 0, y: 0, parent: null, color: 0, side: 1, collapsed: false },
        { id: plan, text: 'Timeline', x: LEVEL_GAP, y: -64, parent: root, color: 1, side: 1, collapsed: false },
        { id: build, text: 'Build v1', x: LEVEL_GAP * 2, y: -64, parent: plan, color: 1, side: 1, collapsed: false },
        { id: market, text: 'Marketing', x: LEVEL_GAP, y: 58, parent: root, color: 3, side: 1, collapsed: false },
        { id: tasks, text: 'Feedback', x: -LEVEL_GAP, y: -40, parent: root, color: 2, side: -1, collapsed: false },
        { id: beta, text: 'Beta list', x: -LEVEL_GAP * 2, y: -40, parent: tasks, color: 2, side: -1, collapsed: false },
      ],
    },
    emptyMap('Untitled map'),
  ]
}

function loadMaps(): MindMap[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return seedMaps()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return seedMaps()
    const maps = parsed.filter(
      (m): m is MindMap =>
        !!m &&
        typeof (m as MindMap).id === 'string' &&
        typeof (m as MindMap).name === 'string' &&
        Array.isArray((m as MindMap).nodes)
    )
    return maps.length > 0 ? maps : seedMaps()
  } catch {
    return seedMaps()
  }
}

/* ================================================================== */
/* Tree helpers                                                        */
/* ================================================================== */

function childrenOf(nodes: MindNode[]): Map<string, MindNode[]> {
  const map = new Map<string, MindNode[]>()
  for (const n of nodes) {
    if (!n.parent) continue
    const list = map.get(n.parent) ?? []
    list.push(n)
    map.set(n.parent, list)
  }
  return map
}

function descendantIds(nodes: MindNode[], rootId: string): Set<string> {
  const kids = childrenOf(nodes)
  const out = new Set<string>()
  const walk = (id: string): void => {
    for (const c of kids.get(id) ?? []) {
      out.add(c.id)
      walk(c.id)
    }
  }
  walk(rootId)
  return out
}

/** Balanced horizontal tidy: leaves stack per side, parents center on kids. */
function tidyNodes(nodes: MindNode[]): MindNode[] {
  const kids = childrenOf(nodes)
  const root = nodes.find((n) => !n.parent)
  if (!root) return nodes

  const out = new Map<string, { x: number; y: number }>([[root.id, { x: 0, y: 0 }]])

  const countLeaves = (id: string, side: -1 | 1): number => {
    const list = (kids.get(id) ?? []).filter((n) => n.side === side)
    if (list.length === 0) return 1
    return list.reduce((acc, c) => acc + countLeaves(c.id, side), 0)
  }

  const layoutSide = (side: -1 | 1): void => {
    let cursor = 0
    const walk = (id: string, depth: number): number => {
      const list = (kids.get(id) ?? []).filter((n) => n.side === side)
      if (list.length === 0) {
        const y = cursor
        cursor += LEAF_GAP
        out.set(id, { x: depth * LEVEL_GAP * side, y })
        return y
      }
      const ys = list.map((c) => walk(c.id, depth + 1))
      const y = ys.reduce((a, b) => a + b, 0) / ys.length
      out.set(id, { x: depth * LEVEL_GAP * side, y })
      return y
    }
    const top = (kids.get(root.id) ?? []).filter((n) => n.side === side)
    if (side === -1) {
      let count = 0
      for (const c of top) count += countLeaves(c.id, side)
      cursor = -(count * LEAF_GAP) / 2
    }
    for (const c of top) walk(c.id, 1)
  }

  layoutSide(1)
  layoutSide(-1)

  return nodes.map((n) => {
    const pos = out.get(n.id)
    return pos ? { ...n, x: pos.x, y: pos.y } : n
  })
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function MindMapTool() {
  const [maps, setMaps] = useState<MindMap[]>(loadMaps) // lazy init — safe (ssr:false)
  const [activeId, setActiveId] = useState<string>(() => '')
  const [selected, setSelected] = useState<string | null>(null)
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{
    kind: 'pan' | 'node'
    id?: string
    startClient: { x: number; y: number }
    startPan: { x: number; y: number }
    startPos?: { x: number; y: number }
    moved: boolean
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const active = maps.find((m) => m.id === activeId) ?? maps[0]

  /* resolve active id once maps are known */
  useEffect(() => {
    if (!activeId && maps.length > 0) setActiveId(maps[0].id)
  }, [activeId, maps])

  /* persist */
  useEffect(() => {
    if (maps.length === 0) return
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(maps))
    } catch {
      /* private mode */
    }
  }, [maps])

  /* center the view on first canvas measure */
  useEffect(() => {
    const el = canvasRef.current
    if (!el || pan) return
    const r = el.getBoundingClientRect()
    setPan({ x: r.width / 2, y: r.height / 2 })
  }, [pan])

  const updateMap = useCallback((id: string, fn: (m: MindMap) => MindMap) => {
    setMaps((prev) => prev.map((m) => (m.id === id ? { ...fn(m), updatedAt: Date.now() } : m)))
  }, [])

  const nodes = active?.nodes ?? []
  const kids = useMemo(() => childrenOf(nodes), [nodes])

  const visibleNodes = useMemo(() => {
    const hidden = new Set<string>()
    for (const n of nodes) {
      if (n.collapsed) {
        for (const d of descendantIds(nodes, n.id)) hidden.add(d)
      }
    }
    return nodes.filter((n) => !hidden.has(n.id))
  }, [nodes])

  /* ---------------- pointer interactions ---------------- */

  const onPointerDownCanvas = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    dragState.current = {
      kind: 'pan',
      startClient: { x: e.clientX, y: e.clientY },
      startPan: pan ?? { x: 0, y: 0 },
      moved: false,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerDownNode = (e: React.PointerEvent, node: MindNode): void => {
    e.stopPropagation()
    setSelected(node.id)
    dragState.current = {
      kind: 'node',
      id: node.id,
      startClient: { x: e.clientX, y: e.clientY },
      startPan: pan ?? { x: 0, y: 0 },
      startPos: { x: node.x, y: node.y },
      moved: false,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    const ds = dragState.current
    if (!ds || !active) return
    const dx = e.clientX - ds.startClient.x
    const dy = e.clientY - ds.startClient.y
    if (Math.abs(dx) + Math.abs(dy) > 3) ds.moved = true
    if (ds.kind === 'pan') {
      setPan({ x: ds.startPan.x + dx, y: ds.startPan.y + dy })
    } else if (ds.kind === 'node' && ds.id && ds.startPos) {
      const id = ds.id
      const nx = ds.startPos.x + dx
      const ny = ds.startPos.y + dy
      updateMap(active.id, (m) => ({
        ...m,
        nodes: m.nodes.map((n) => (n.id === id ? { ...n, x: Math.round(nx), y: Math.round(ny) } : n)),
      }))
    }
  }

  const onPointerUp = (): void => {
    dragState.current = null
  }

  /* ---------------- node actions ---------------- */

  const addChild = (parent: MindNode): void => {
    if (!active) return
    const count = (kids.get(parent.id) ?? []).length
    const side: -1 | 1 = parent.parent === null ? (count % 2 === 0 ? 1 : -1) : parent.side
    const sameSide = (kids.get(parent.id) ?? []).filter((n) => n.side === side).length
    const node: MindNode = {
      id: newId(),
      text: '',
      x: parent.x + LEVEL_GAP * side * 0.9,
      y: parent.y + (side === 1 ? sameSide * LEAF_GAP : -sameSide * LEAF_GAP),
      parent: parent.id,
      color: parent.parent === null ? count % NODE_COLORS.length : parent.color,
      side,
      collapsed: false,
    }
    updateMap(active.id, (m) => ({ ...m, nodes: [...m.nodes, node] }))
    setSelected(node.id)
  }

  const patchNode = (id: string, patch: Partial<MindNode>): void => {
    if (!active) return
    updateMap(active.id, (m) => ({
      ...m,
      nodes: m.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    }))
  }

  const deleteNode = (id: string): void => {
    if (!active) return
    const kill = descendantIds(active.nodes, id)
    kill.add(id)
    updateMap(active.id, (m) => ({ ...m, nodes: m.nodes.filter((n) => !kill.has(n.id)) }))
    setSelected(null)
  }

  const toggleCollapse = (node: MindNode): void => {
    patchNode(node.id, { collapsed: !node.collapsed })
  }

  const tidy = (): void => {
    if (!active) return
    updateMap(active.id, (m) => ({ ...m, nodes: tidyNodes(m.nodes) }))
  }

  /* ---------------- map management ---------------- */

  const createMap = (): void => {
    const m = emptyMap(`Map ${maps.length + 1}`)
    setMaps((prev) => [m, ...prev])
    setActiveId(m.id)
    setSelected(null)
    setPan(null)
  }

  const deleteMap = (id: string): void => {
    setMaps((prev) => {
      const next = prev.filter((m) => m.id !== id)
      if (next.length === 0) {
        const fresh = emptyMap('Untitled map')
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) setActiveId(next[0].id)
      return next
    })
    setSelected(null)
    setPan(null)
  }

  const exportJson = (): void => {
    if (!active) return
    const payload = JSON.stringify({ app: 'toolhub-mindmap', version: 1, name: active.name, nodes: active.nodes }, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${active.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'mind-map'}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const importJson = (file: File): void => {
    setImportError(null)
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as {
          name?: unknown
          nodes?: unknown
        }
        if (!parsed || !Array.isArray(parsed.nodes)) throw new Error('bad')
        const clean: MindNode[] = (parsed.nodes as MindNode[])
          .filter((n) => n && typeof n.id === 'string' && typeof n.text === 'string')
          .map((n) => ({
            id: String(n.id),
            text: String(n.text),
            x: Number(n.x) || 0,
            y: Number(n.y) || 0,
            parent: typeof n.parent === 'string' ? n.parent : null,
            color: Number.isInteger(n.color) ? (n.color as number) % NODE_COLORS.length : 0,
            side: n.side === -1 ? -1 : 1,
            collapsed: Boolean(n.collapsed),
          }))
        if (clean.length === 0) throw new Error('empty')
        const m: MindMap = {
          id: newId(),
          name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Imported map',
          nodes: clean,
          updatedAt: Date.now(),
        }
        setMaps((prev) => [m, ...prev])
        setActiveId(m.id)
        setSelected(null)
        setPan(null)
      } catch {
        setImportError('That file is not a Mind Map export')
        window.setTimeout(() => setImportError(null), 3200)
      }
    }
    reader.readAsText(file)
  }

  const selectedNode = selected ? nodes.find((n) => n.id === selected) ?? null : null
  const selectedChildCount = selectedNode ? (kids.get(selectedNode.id) ?? []).length : 0
  const hiddenByCollapse =
    selectedNode && selectedChildCount > 0 ? descendantIds(nodes, selectedNode.id).size : 0

  if (!active) return null

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* ---------------- Header ---------------- */}
      <Card className="border-border/70 p-4 shadow-lg shadow-black/5 sm:p-5">
        <div className="flex items-center gap-4">
          <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-400 via-purple-500 to-fuchsia-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(168_85_247/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
            <Network className="size-7" strokeWidth={1.9} aria-hidden />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold tracking-tight">{active.name}</h2>
            <p className="text-xs text-muted-foreground">
              {nodes.length} node{nodes.length === 1 ? '' : 's'} · drag to pan, drag nodes to rearrange
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={tidy} className="h-10 gap-1.5 rounded-xl">
              <Wand2 className="size-4" aria-hidden /> Tidy
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="h-10 gap-1.5 rounded-xl">
              <Upload className="size-4" aria-hidden /> Import
            </Button>
            <Button variant="outline" size="sm" onClick={exportJson} className="h-10 gap-1.5 rounded-xl">
              <Download className="size-4" aria-hidden /> Export
            </Button>
            <Button
              size="sm"
              onClick={createMap}
              className="h-10 gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-violet-500/25 hover:from-violet-600 hover:to-fuchsia-700"
            >
              <Plus className="size-4" aria-hidden /> New
            </Button>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) importJson(f)
            e.target.value = ''
          }}
        />
        {renameOpen && (
          <div className="mt-3 flex items-center gap-2">
            <Input
              value={active.name}
              onChange={(e) => updateMap(active.id, (m) => ({ ...m, name: e.target.value }))}
              aria-label="Map name"
              className="h-10 rounded-xl"
            />
            <Button variant="outline" size="icon" onClick={() => setRenameOpen(false)} aria-label="Done renaming" className="h-10 w-10 shrink-0 rounded-xl">
              <X className="size-4" aria-hidden />
            </Button>
          </div>
        )}
        {importError && (
          <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive" role="alert">
            {importError}
          </p>
        )}
      </Card>

      {/* ---------------- Maps strip ---------------- */}
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-0.5" role="tablist" aria-label="Saved maps">
        {maps.map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={m.id === activeId}
            onClick={() => {
              setActiveId(m.id)
              setSelected(null)
              setPan(null)
            }}
            onDoubleClick={() => setRenameOpen(true)}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-all',
              m.id === activeId
                ? 'border-violet-400/60 bg-violet-500/15 text-violet-600 dark:text-violet-300'
                : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60'
            )}
          >
            {m.name}
            <span className="text-[10px] tabular-nums opacity-70">{m.nodes.length}</span>
            {maps.length > 1 && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Delete ${m.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  deleteMap(m.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    deleteMap(m.id)
                  }
                }}
                className="ml-0.5 rounded-full p-0.5 opacity-50 transition-opacity hover:opacity-100"
              >
                <X className="size-3" aria-hidden />
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ---------------- Canvas ---------------- */}
      <Card className="overflow-hidden border-border/70 shadow-lg shadow-black/5">
        <div
          ref={canvasRef}
          className="relative h-[420px] touch-none select-none bg-[radial-gradient(circle_at_1px_1px,rgb(255_255_255/0.05)_1px,transparent_0)] bg-[size:22px_22px] sm:h-[520px] dark:bg-[radial-gradient(circle_at_1px_1px,rgb(255_255_255/0.07)_1px,transparent_0)]"
          onPointerDown={onPointerDownCanvas}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="application"
          aria-label="Mind map canvas"
        >
          {/* pan layer */}
          <div
            className="absolute left-0 top-0 will-change-transform"
            style={{ transform: `translate(${pan?.x ?? 0}px, ${pan?.y ?? 0}px)` }}
          >
            {/* edges */}
            <svg className="absolute left-0 top-0 h-px w-px overflow-visible" aria-hidden>
              {visibleNodes.map((n) => {
                if (!n.parent) return null
                const p = nodes.find((x) => x.id === n.parent)
                if (!p) return null
                const px = p.x + (n.side === 1 ? NODE_W / 2 : -NODE_W / 2)
                const py = p.y
                const cx = n.x + (n.side === 1 ? -NODE_W / 2 : NODE_W / 2)
                const cy = n.y
                const bend = Math.abs(cx - px) * 0.5
                return (
                  <path
                    key={`e-${n.id}`}
                    d={`M ${px} ${py} C ${px + bend * n.side} ${py}, ${cx - bend * n.side} ${cy}, ${cx} ${cy}`}
                    stroke={NODE_COLORS[n.color % NODE_COLORS.length]}
                    strokeWidth={2}
                    fill="none"
                    opacity={0.65}
                  />
                )
              })}
            </svg>

            {/* nodes */}
            {visibleNodes.map((n) => {
              const childCount = (kids.get(n.id) ?? []).length
              const hiddenDesc = childCount > 0 ? descendantIds(nodes, n.id).size : 0
              const isSelected = n.id === selected
              const color = NODE_COLORS[n.color % NODE_COLORS.length]
              return (
                <div
                  key={n.id}
                  onPointerDown={(e) => onPointerDownNode(e, n)}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className={cn(
                    'absolute flex items-center gap-2 rounded-2xl border bg-card px-3 py-2 shadow-sm transition-shadow',
                    isSelected ? 'border-transparent ring-2' : 'border-border/70'
                  )}
                  style={{
                    left: n.x - NODE_W / 2,
                    top: n.y - NODE_H / 2,
                    width: NODE_W,
                    minHeight: NODE_H,
                    ...(isSelected ? { '--tw-ring-color': color } as React.CSSProperties : {}),
                  }}
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                    {n.text || <span className="italic opacity-50">empty</span>}
                  </span>
                  {n.collapsed && hiddenDesc > 0 && (
                    <span className="shrink-0 rounded-full bg-muted px-1.5 text-[9px] font-bold tabular-nums">
                      +{hiddenDesc}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          {/* hint */}
          <p className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-full bg-background/70 px-3 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
            Drag the canvas to pan · tap a node to edit
          </p>
        </div>
      </Card>

      {/* ---------------- Editor sheet ---------------- */}
      {selectedNode && (
        <Card className="border-border/70 p-4 shadow-lg shadow-black/5">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: NODE_COLORS[selectedNode.color % NODE_COLORS.length] }} aria-hidden />
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {selectedNode.parent ? 'Branch' : 'Root node'}
              </p>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSelected(null)}
                aria-label="Close editor"
                className="size-9 rounded-lg"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>

            <Input
              value={selectedNode.text}
              onChange={(e) => patchNode(selectedNode.id, { text: e.target.value })}
              placeholder="Node text"
              aria-label="Node text"
              className="h-11 rounded-xl"
            />

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Branch color">
                {NODE_COLORS.map((c, i) => (
                  <button
                    key={c}
                    role="radio"
                    aria-checked={selectedNode.color === i}
                    aria-label={`Color ${i + 1}`}
                    onClick={() => patchNode(selectedNode.id, { color: i })}
                    className={cn(
                      'size-7 rounded-full transition-transform',
                      selectedNode.color === i ? 'scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background' : 'hover:scale-105'
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex-1" />
              {selectedChildCount > 0 && (
                <Button variant="outline" size="sm" onClick={() => toggleCollapse(selectedNode)} className="h-10 rounded-xl">
                  {selectedNode.collapsed ? `Expand (+${hiddenByCollapse})` : `Collapse (+${hiddenByCollapse})`}
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => addChild(selectedNode)}
                className="h-10 gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-violet-500/25 hover:from-violet-600 hover:to-fuchsia-700"
              >
                <Plus className="size-4" aria-hidden /> Add branch
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => deleteNode(selectedNode.id)}
                className="h-10 gap-1.5 rounded-xl border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="size-4" aria-hidden /> Delete
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
