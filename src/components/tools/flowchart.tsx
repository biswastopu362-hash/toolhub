'use client'

/**
 * Flowchart — shape-based diagram editor on a panning, snap-to-grid canvas.
 *
 * Four classic shapes (terminal, process, decision, I/O) are placed freely,
 * linked with arrowed connectors, and labeled inline. Charts persist to
 * localStorage and export/import as JSON — everything stays on-device.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Download,
  Magnet,
  Plus,
  Trash2,
  Upload,
  Workflow,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type BlockShape = 'terminal' | 'process' | 'decision' | 'io'

interface FlowBlock {
  id: string
  shape: BlockShape
  text: string
  /** world coordinates — snapped center */
  x: number
  y: number
}

interface FlowEdge {
  id: string
  from: string
  to: string
}

interface FlowChart {
  id: string
  name: string
  blocks: FlowBlock[]
  edges: FlowEdge[]
  updatedAt: number
}

const LS_KEY = 'toolhub-flowcharts'
const GRID = 20

const SHAPE_META: { id: BlockShape; label: string }[] = [
  { id: 'terminal', label: 'Start / End' },
  { id: 'process', label: 'Process' },
  { id: 'decision', label: 'Decision' },
  { id: 'io', label: 'Input / Output' },
]

const SHAPE_SIZE: Record<BlockShape, { w: number; h: number }> = {
  terminal: { w: 140, h: 46 },
  process: { w: 136, h: 48 },
  decision: { w: 150, h: 88 },
  io: { w: 140, h: 46 },
}

function newId(): string {
  return `fb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function snap(v: number): number {
  return Math.round(v / GRID) * GRID
}

function emptyChart(name: string): FlowChart {
  return {
    id: newId(),
    name,
    blocks: [{ id: newId(), shape: 'terminal', text: 'Start', x: 0, y: 0 }],
    edges: [],
    updatedAt: Date.now(),
  }
}

function seedCharts(): FlowChart[] {
  const start = newId()
  const triage = newId()
  const dec = newId()
  const fix = newId()
  const close = newId()
  return [
    {
      id: newId(),
      name: 'Bug triage',
      updatedAt: Date.now(),
      blocks: [
        { id: start, shape: 'terminal', text: 'New bug', x: 0, y: -140 },
        { id: triage, shape: 'process', text: 'Triage & label', x: 0, y: -60 },
        { id: dec, shape: 'decision', text: 'Reproduces?', x: 0, y: 40 },
        { id: fix, shape: 'process', text: 'Fix it', x: 160, y: 40 },
        { id: close, shape: 'io', text: 'Ask for details', x: -160, y: 40 },
      ],
      edges: [
        { id: newId(), from: start, to: triage },
        { id: newId(), from: triage, to: dec },
        { id: newId(), from: dec, to: fix },
        { id: newId(), from: dec, to: close },
      ],
    },
    emptyChart('Untitled flow'),
  ]
}

function loadCharts(): FlowChart[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return seedCharts()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return seedCharts()
    const charts = parsed.filter(
      (c): c is FlowChart =>
        !!c &&
        typeof (c as FlowChart).id === 'string' &&
        typeof (c as FlowChart).name === 'string' &&
        Array.isArray((c as FlowChart).blocks)
    )
    return charts.length > 0 ? charts : seedCharts()
  } catch {
    return seedCharts()
  }
}

/* ================================================================== */
/* Geometry helpers                                                    */
/* ================================================================== */

function blockRect(b: FlowBlock): { w: number; h: number } {
  return SHAPE_SIZE[b.shape]
}

/** Trim a center→center segment to the boundary of each block. */
function edgePoints(a: FlowBlock, b: FlowBlock): { x1: number; y1: number; x2: number; y2: number } {
  const ra = blockRect(a)
  const rb = blockRect(b)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const denom = Math.abs(ux) + Math.abs(uy) || 1
  const trimA = (Math.abs(ux) * ra.w) / 2 / denom + (Math.abs(uy) * ra.h) / 2 / denom
  const trimB = (Math.abs(ux) * rb.w) / 2 / denom + (Math.abs(uy) * rb.h) / 2 / denom
  return {
    x1: a.x + ux * Math.min(trimA, len * 0.45),
    y1: a.y + uy * Math.min(trimA, len * 0.45),
    x2: b.x - ux * Math.min(trimB, len * 0.55),
    y2: b.y - uy * Math.min(trimB, len * 0.55),
  }
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function FlowchartTool() {
  const [charts, setCharts] = useState<FlowChart[]>(loadCharts) // lazy init — safe (ssr:false)
  const [activeId, setActiveId] = useState<string>(() => '')
  const [selected, setSelected] = useState<string | null>(null)
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null)
  const [snapOn, setSnapOn] = useState(true)
  const [linkFrom, setLinkFrom] = useState<string | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{
    kind: 'pan' | 'block'
    id?: string
    startClient: { x: number; y: number }
    startPan: { x: number; y: number }
    startPos?: { x: number; y: number }
    moved: boolean
  } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const active = charts.find((c) => c.id === activeId) ?? charts[0]

  useEffect(() => {
    if (!activeId && charts.length > 0) setActiveId(charts[0].id)
  }, [activeId, charts])

  useEffect(() => {
    if (charts.length === 0) return
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(charts))
    } catch {
      /* private mode */
    }
  }, [charts])

  useEffect(() => {
    const el = canvasRef.current
    if (!el || pan) return
    const r = el.getBoundingClientRect()
    setPan({ x: r.width / 2, y: r.height / 2 - 40 })
  }, [pan])

  const updateChart = useCallback((id: string, fn: (c: FlowChart) => FlowChart) => {
    setCharts((prev) => prev.map((c) => (c.id === id ? { ...fn(c), updatedAt: Date.now() } : c)))
  }, [])

  const blocks = active?.blocks ?? []
  const edges = active?.edges ?? []
  const byId = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks])

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

  const onPointerDownBlock = (e: React.PointerEvent, block: FlowBlock): void => {
    e.stopPropagation()
    if (linkFrom && linkFrom !== block.id) {
      if (!active) return
      const exists = edges.some(
        (ed) =>
          (ed.from === linkFrom && ed.to === block.id) ||
          (ed.from === block.id && ed.to === linkFrom)
        )
      if (!exists) {
        updateChart(active.id, (c) => ({
          ...c,
          edges: [...c.edges, { id: newId(), from: linkFrom, to: block.id }],
        }))
      }
      setLinkFrom(null)
      setSelected(block.id)
      return
    }
    setSelected(block.id)
    dragState.current = {
      kind: 'block',
      id: block.id,
      startClient: { x: e.clientX, y: e.clientY },
      startPan: pan ?? { x: 0, y: 0 },
      startPos: { x: block.x, y: block.y },
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
    } else if (ds.kind === 'block' && ds.id && ds.startPos) {
      const id = ds.id
      const raw = { x: ds.startPos.x + dx, y: ds.startPos.y + dy }
      const p = snapOn ? { x: snap(raw.x), y: snap(raw.y) } : { x: Math.round(raw.x), y: Math.round(raw.y) }
      updateChart(active.id, (c) => ({
        ...c,
        blocks: c.blocks.map((b) => (b.id === id ? { ...b, x: p.x, y: p.y } : b)),
      }))
    }
  }

  const onPointerUp = (): void => {
    dragState.current = null
  }

  const onCanvasTap = (): void => {
    /* tap empty space cancels linking and deselects */
    if (linkFrom) setLinkFrom(null)
    setSelected(null)
  }

  /* ---------------- block & edge actions ---------------- */

  const addBlock = (shape: BlockShape): void => {
    if (!active) return
    const offset = active.blocks.length * GRID * 2
    const block: FlowBlock = {
      id: newId(),
      shape,
      text: '',
      x: snap(-120 + offset),
      y: snap(-80 + offset),
    }
    updateChart(active.id, (c) => ({ ...c, blocks: [...c.blocks, block] }))
    setSelected(block.id)
  }

  const patchBlock = (id: string, patch: Partial<FlowBlock>): void => {
    if (!active) return
    updateChart(active.id, (c) => ({
      ...c,
      blocks: c.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }))
  }

  const deleteBlock = (id: string): void => {
    if (!active) return
    updateChart(active.id, (c) => ({
      ...c,
      blocks: c.blocks.filter((b) => b.id !== id),
      edges: c.edges.filter((e) => e.from !== id && e.to !== id),
    }))
    setSelected(null)
    if (linkFrom === id) setLinkFrom(null)
  }

  const deleteEdge = (id: string): void => {
    if (!active) return
    updateChart(active.id, (c) => ({ ...c, edges: c.edges.filter((e) => e.id !== id) }))
  }

  /* ---------------- chart management ---------------- */

  const createChart = (): void => {
    const c = emptyChart(`Flow ${charts.length + 1}`)
    setCharts((prev) => [c, ...prev])
    setActiveId(c.id)
    setSelected(null)
    setLinkFrom(null)
    setPan(null)
  }

  const deleteChart = (id: string): void => {
    setCharts((prev) => {
      const next = prev.filter((c) => c.id !== id)
      if (next.length === 0) {
        const fresh = emptyChart('Untitled flow')
        setActiveId(fresh.id)
        return [fresh]
      }
      if (id === activeId) setActiveId(next[0].id)
      return next
    })
    setSelected(null)
    setLinkFrom(null)
    setPan(null)
  }

  const exportJson = (): void => {
    if (!active) return
    const payload = JSON.stringify({ app: 'toolhub-flowchart', version: 1, name: active.name, blocks: active.blocks, edges: active.edges }, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${active.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'flowchart'}.json`
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
          blocks?: unknown
          edges?: unknown
        }
        if (!parsed || !Array.isArray(parsed.blocks)) throw new Error('bad')
        const ids = new Set<string>()
        const blocks: FlowBlock[] = (parsed.blocks as FlowBlock[])
          .filter((b) => b && typeof b.id === 'string')
          .map((b) => {
            ids.add(String(b.id))
            return {
              id: String(b.id),
              shape: (['terminal', 'process', 'decision', 'io'] as BlockShape[]).includes(b.shape)
                ? b.shape
                : 'process',
              text: typeof b.text === 'string' ? b.text : '',
              x: snap(Number(b.x) || 0),
              y: snap(Number(b.y) || 0),
            }
          })
        if (blocks.length === 0) throw new Error('empty')
        const edges: FlowEdge[] = Array.isArray(parsed.edges)
          ? (parsed.edges as FlowEdge[])
              .filter((e) => e && ids.has(String(e.from)) && ids.has(String(e.to)) && e.from !== e.to)
              .map((e) => ({ id: newId(), from: String(e.from), to: String(e.to) }))
          : []
        const c: FlowChart = {
          id: newId(),
          name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'Imported flow',
          blocks,
          edges,
          updatedAt: Date.now(),
        }
        setCharts((prev) => [c, ...prev])
        setActiveId(c.id)
        setSelected(null)
        setLinkFrom(null)
        setPan(null)
      } catch {
        setImportError('That file is not a Flowchart export')
        window.setTimeout(() => setImportError(null), 3200)
      }
    }
    reader.readAsText(file)
  }

  const selectedBlock = selected ? byId.get(selected) ?? null : null

  if (!active) return null

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* ---------------- Header ---------------- */}
      <Card className="border-border/70 p-4 shadow-lg shadow-black/5 sm:p-5">
        <div className="flex items-center gap-4">
          <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-teal-400 via-emerald-500 to-green-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(16_185_129/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
            <Workflow className="size-7" strokeWidth={1.9} aria-hidden />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-bold tracking-tight">{active.name}</h2>
            <p className="text-xs text-muted-foreground">
              {blocks.length} step{blocks.length === 1 ? '' : 's'} · {edges.length} connector{edges.length === 1 ? '' : 's'}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <Button
              variant={snapOn ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSnapOn((s) => !s)}
              aria-pressed={snapOn}
              className="h-10 gap-1.5 rounded-xl"
            >
              <Magnet className="size-4" aria-hidden /> Snap
            </Button>
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="h-10 gap-1.5 rounded-xl">
              <Upload className="size-4" aria-hidden /> Import
            </Button>
            <Button variant="outline" size="sm" onClick={exportJson} className="h-10 gap-1.5 rounded-xl">
              <Download className="size-4" aria-hidden /> Export
            </Button>
            <Button
              size="sm"
              onClick={createChart}
              className="h-10 gap-1.5 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/25 hover:from-teal-600 hover:to-emerald-700"
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
              onChange={(e) => updateChart(active.id, (c) => ({ ...c, name: e.target.value }))}
              aria-label="Flow name"
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

      {/* ---------------- Charts strip ---------------- */}
      <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-0.5" role="tablist" aria-label="Saved flows">
        {charts.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === activeId}
            onClick={() => {
              setActiveId(c.id)
              setSelected(null)
              setLinkFrom(null)
              setPan(null)
            }}
            onDoubleClick={() => setRenameOpen(true)}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-all',
              c.id === activeId
                ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60'
            )}
          >
            {c.name}
            <span className="text-[10px] tabular-nums opacity-70">{c.blocks.length}</span>
            {charts.length > 1 && (
              <span
                role="button"
                tabIndex={0}
                aria-label={`Delete ${c.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  deleteChart(c.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation()
                    deleteChart(c.id)
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

      {/* ---------------- Shape palette ---------------- */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Add a shape">
        {SHAPE_META.map((s) => (
          <Button key={s.id} variant="outline" size="sm" onClick={() => addBlock(s.id)} className="h-10 gap-1.5 rounded-xl">
            <Plus className="size-3.5" aria-hidden /> {s.label}
          </Button>
        ))}
        <div className="flex-1" />
        {linkFrom && (
          <p className="rounded-full bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-600 dark:text-amber-400" role="status">
            Tap a target block to connect
          </p>
        )}
      </div>

      {/* ---------------- Canvas ---------------- */}
      <Card className="overflow-hidden border-border/70 shadow-lg shadow-black/5">
        <div
          ref={canvasRef}
          className="relative h-[420px] touch-none select-none bg-[radial-gradient(circle_at_1px_1px,rgb(255_255_255/0.05)_1px,transparent_0)] bg-[size:20px_20px] sm:h-[520px] dark:bg-[radial-gradient(circle_at_1px_1px,rgb(255_255_255/0.07)_1px,transparent_0)]"
          onPointerDown={onPointerDownCanvas}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={(e) => {
            if (e.target === e.currentTarget) onCanvasTap()
          }}
          role="application"
          aria-label="Flowchart canvas"
        >
          <div
            className="absolute left-0 top-0 will-change-transform"
            style={{ transform: `translate(${pan?.x ?? 0}px, ${pan?.y ?? 0}px)` }}
          >
            {/* connectors */}
            <svg className="absolute left-0 top-0 h-px w-px overflow-visible" aria-hidden>
              <defs>
                <marker id="fc-arrow" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse">
                  <path d="M0,0 L9,4 L0,8 z" className="fill-muted-foreground" />
                </marker>
              </defs>
              {edges.map((ed) => {
                const a = byId.get(ed.from)
                const b = byId.get(ed.to)
                if (!a || !b) return null
                const p = edgePoints(a, b)
                return (
                  <g key={ed.id}>
                    <path
                      d={`M ${p.x1} ${p.y1} L ${p.x2} ${p.y2}`}
                      className="stroke-muted-foreground"
                      strokeWidth={2}
                      markerEnd="url(#fc-arrow)"
                      fill="none"
                      opacity={0.75}
                    />
                    {/* fat invisible hit area for tap-to-delete */}
                    <path
                      d={`M ${p.x1} ${p.y1} L ${p.x2} ${p.y2}`}
                      stroke="transparent"
                      strokeWidth={16}
                      fill="none"
                      style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        deleteEdge(ed.id)
                      }}
                    >
                      <title>Delete connector</title>
                    </path>
                  </g>
                )
              })}
            </svg>

            {/* blocks */}
            {blocks.map((b) => {
              const size = SHAPE_SIZE[b.shape]
              const isSelected = b.id === selected
              const isLinkSource = b.id === linkFrom
              return (
                <div
                  key={b.id}
                  onPointerDown={(e) => onPointerDownBlock(e, b)}
                  className={cn(
                    'absolute flex items-center justify-center border-2 bg-card px-3 text-center shadow-sm transition-shadow',
                    b.shape === 'terminal' && 'rounded-full border-emerald-500/70 bg-emerald-500/5',
                    b.shape === 'process' && 'rounded-lg border-sky-500/70 bg-sky-500/5',
                    b.shape === 'decision' && 'border-amber-500/70 bg-amber-500/5',
                    b.shape === 'io' && 'border-violet-500/70 bg-violet-500/5',
                    isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
                    isLinkSource && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-background'
                  )}
                  style={{
                    left: b.x - size.w / 2,
                    top: b.y - size.h / 2,
                    width: size.w,
                    height: size.h,
                    ...(b.shape === 'decision'
                      ? { clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' }
                      : b.shape === 'io'
                        ? { clipPath: 'polygon(11% 0, 100% 0, 89% 100%, 0 100%)' }
                        : {}),
                  }}
                >
                  {b.shape === 'decision' ? (
                    <span className="text-[11px] font-bold leading-tight" style={{ width: size.w * 0.62 }}>
                      {b.text || <span className="italic opacity-50">decision</span>}
                    </span>
                  ) : b.shape === 'io' ? (
                    <span className="text-[11px] font-bold leading-tight" style={{ width: size.w * 0.74 }}>
                      {b.text || <span className="italic opacity-50">I / O</span>}
                    </span>
                  ) : (
                    <span className="text-[11px] font-bold leading-tight">
                      {b.text || <span className="italic opacity-50">{b.shape === 'terminal' ? 'start' : 'step'}</span>}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          <p className="pointer-events-none absolute bottom-2.5 left-1/2 -translate-x-1/2 rounded-full bg-background/70 px-3 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
            Drag to pan · tap a step to edit · connectors tap to delete
          </p>
        </div>
      </Card>

      {/* ---------------- Editor sheet ---------------- */}
      {selectedBlock && (
        <Card className="border-border/70 p-4 shadow-lg shadow-black/5">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {SHAPE_META.find((s) => s.id === selectedBlock.shape)?.label ?? 'Step'}
              </p>
              <div className="flex-1" />
              <Button
                variant={linkFrom === selectedBlock.id ? 'default' : 'outline'}
                size="sm"
                onClick={() => setLinkFrom((f) => (f === selectedBlock.id ? null : selectedBlock.id))}
                className="h-10 rounded-xl"
              >
                {linkFrom === selectedBlock.id ? 'Cancel link' : 'Connect from here'}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setSelected(null)} aria-label="Close editor" className="size-9 rounded-lg">
                <X className="size-4" aria-hidden />
              </Button>
            </div>

            <Input
              value={selectedBlock.text}
              onChange={(e) => patchBlock(selectedBlock.id, { text: e.target.value })}
              placeholder="Step text"
              aria-label="Step text"
              className="h-11 rounded-xl"
            />

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Shape">
                {SHAPE_META.map((s) => (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={selectedBlock.shape === s.id}
                    onClick={() => patchBlock(selectedBlock.id, { shape: s.id })}
                    className={cn(
                      'rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                      selectedBlock.shape === s.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border text-muted-foreground hover:bg-muted/50'
                    )}
                  >
                    {s.id}
                  </button>
                ))}
              </div>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => deleteBlock(selectedBlock.id)}
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
