'use client'

/**
 * Paint Studio — freeform drawing canvas with smooth pointer strokes,
 * undo/redo snapshots, brush/eraser tools, background modes and PNG
 * export (download or save into the shared media gallery).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { motion } from 'framer-motion'
import {
  Brush,
  Download,
  Eraser,
  Grip,
  Moon,
  Save,
  Sun,
  Trash2,
  Undo2,
  Redo2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { newPhotoId, putPhoto } from '@/lib/media-db'

/* ================================================================== */
/* Config                                                              */
/* ================================================================== */

type Tool = 'brush' | 'eraser'
type BgMode = 'white' | 'dark' | 'transparent'

const MAX_SNAPSHOTS = 30

const SWATCHES = [
  '#0a0a0a',
  '#ffffff',
  '#9ca3af',
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#facc15',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]

const BG_MODES: { value: BgMode; icon: LucideIcon; label: string }[] = [
  { value: 'white', icon: Sun, label: 'White background' },
  { value: 'dark', icon: Moon, label: 'Dark background' },
  { value: 'transparent', icon: Grip, label: 'Transparent background' },
]

interface Pt {
  x: number
  y: number
}

function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function PaintStudio() {
  const { toast } = useToast()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#0a0a0a')
  const [size, setSize] = useState(6)
  const [bg, setBg] = useState<BgMode>('white')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const drawingRef = useRef(false)
  const ptsRef = useRef<Pt[]>([])
  const stackRef = useRef<{ stack: string[]; idx: number }>({ stack: [], idx: -1 })
  const prevSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 })
  const initializedRef = useRef(false)

  /* ================================================================== */
  /* Snapshot stack (undo / redo)                                        */
  /* ================================================================== */

  const applySnapshot = useCallback((url: string) => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    const cssW = canvas.width / dpr
    const cssH = canvas.height / dpr
    const img = new Image()
    img.onload = () => {
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.drawImage(img, 0, 0, cssW, cssH)
      ctx.restore()
    }
    img.src = url
  }, [])

  const pushSnapshot = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let url = ''
    try {
      url = canvas.toDataURL('image/png')
    } catch {
      return
    }
    const s = stackRef.current
    s.stack = s.stack.slice(0, s.idx + 1)
    s.stack.push(url)
    if (s.stack.length > MAX_SNAPSHOTS) s.stack.shift()
    s.idx = s.stack.length - 1
    setCanUndo(s.idx > 0)
    setCanRedo(s.idx < s.stack.length - 1)
  }, [])

  const undo = useCallback(() => {
    const s = stackRef.current
    if (s.idx <= 0) return
    s.idx -= 1
    applySnapshot(s.stack[s.idx])
    setCanUndo(s.idx > 0)
    setCanRedo(s.idx < s.stack.length - 1)
  }, [applySnapshot])

  const redo = useCallback(() => {
    const s = stackRef.current
    if (s.idx >= s.stack.length - 1) return
    s.idx += 1
    applySnapshot(s.stack[s.idx])
    setCanUndo(s.idx > 0)
    setCanRedo(s.idx < s.stack.length - 1)
  }, [applySnapshot])

  /* Ctrl+Z / Ctrl+Y */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const k = e.key.toLowerCase()
      if (k === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (k === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  /* ================================================================== */
  /* Canvas sizing — DPR aware, preserves content via offscreen copy     */
  /* ================================================================== */

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const applySize = () => {
      const canvas = canvasRef.current
      if (!container) return
      if (!canvas) return
      /*
       * offsetWidth/offsetHeight are layout sizes — immune to the ancestor
       * scale transform of the window open animation (getBoundingClientRect
       * would measure the mid-animation scaled box and shrink the canvas).
       */
      const cssW = Math.max(1, Math.round(container.offsetWidth))
      const cssH = Math.max(1, Math.round(container.offsetHeight))
      const dpr = window.devicePixelRatio || 1
      if (canvas.width === Math.round(cssW * dpr) && canvas.height === Math.round(cssH * dpr)) return

      /* offscreen copy of the current pixels */
      let old: HTMLCanvasElement | null = null
      if (canvas.width > 0 && canvas.height > 0) {
        old = document.createElement('canvas')
        old.width = canvas.width
        old.height = canvas.height
        old.getContext('2d')?.drawImage(canvas, 0, 0)
      }
      const prevW = prevSizeRef.current.w
      const prevH = prevSizeRef.current.h

      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      prevSizeRef.current = { w: cssW, h: cssH }

      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.globalCompositeOperation = 'source-over'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (old && prevW > 0 && prevH > 0) ctx.drawImage(old, 0, 0, prevW, prevH)

      if (!initializedRef.current) {
        initializedRef.current = true
        pushSnapshot() // blank baseline for undo
      }
    }

    applySize()
    const ro = new ResizeObserver(applySize)
    ro.observe(container)
    return () => ro.disconnect()
  }, [pushSnapshot])

  /* ================================================================== */
  /* Drawing                                                             */
  /* ================================================================== */

  const getPos = (e: ReactPointerEvent<HTMLCanvasElement>): Pt => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const applyStroke = (ctx: CanvasRenderingContext2D) => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = size
    if (tool === 'eraser') {
      /* the canvas itself is transparent — erasing reveals the stage background */
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
      ctx.fillStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = color
      ctx.fillStyle = color
    }
  }

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const p = getPos(e)
    ptsRef.current = [p]
    applyStroke(ctx)
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(0.5, size / 2), 0, Math.PI * 2)
    ctx.fill()
  }

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = getPos(e)
    const pts = ptsRef.current
    pts.push(p)
    applyStroke(ctx)
    const n = pts.length
    if (n === 2) {
      const m1 = mid(pts[0], pts[1])
      ctx.beginPath()
      ctx.moveTo(pts[0].x, pts[0].y)
      ctx.lineTo(m1.x, m1.y)
      ctx.stroke()
    } else if (n >= 3) {
      const a = pts[n - 3]
      const b = pts[n - 2]
      const c = pts[n - 1]
      const m0 = mid(a, b)
      const m1 = mid(b, c)
      ctx.beginPath()
      ctx.moveTo(m0.x, m0.y)
      ctx.quadraticCurveTo(b.x, b.y, m1.x, m1.y)
      ctx.stroke()
    }
  }

  const endStroke = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    ptsRef.current = []
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* capture already released */
    }
    pushSnapshot()
  }

  /* ================================================================== */
  /* Actions                                                             */
  /* ================================================================== */

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    pushSnapshot()
    toast({ title: 'Canvas cleared', description: 'Press Undo to restore your drawing.' })
  }, [pushSnapshot, toast])

  const compositeDataUrl = useCallback((): string | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    try {
      if (bg === 'transparent') return canvas.toDataURL('image/png')
      const out = document.createElement('canvas')
      out.width = canvas.width
      out.height = canvas.height
      const octx = out.getContext('2d')
      if (!octx) return null
      octx.fillStyle = bg === 'dark' ? '#18181b' : '#ffffff'
      octx.fillRect(0, 0, out.width, out.height)
      octx.drawImage(canvas, 0, 0)
      return out.toDataURL('image/png')
    } catch {
      return null
    }
  }, [bg])

  const downloadPng = () => {
    const url = compositeDataUrl()
    if (!url) {
      toast({ title: 'Export failed', description: 'The canvas could not be exported.' })
      return
    }
    const a = document.createElement('a')
    a.href = url
    a.download = `paint-${new Date().toISOString().slice(0, 10)}.png`
    a.click()
    toast({ title: 'Image downloaded', description: 'Saved as a PNG file.' })
  }

  const saveToGallery = async () => {
    const url = compositeDataUrl()
    if (!url) {
      toast({ title: 'Save failed', description: 'The canvas could not be exported.' })
      return
    }
    try {
      await putPhoto({
        id: newPhotoId(),
        dataUrl: url,
        createdAt: Date.now(),
        fav: false,
        source: 'paint',
        name: `Painting ${new Date().toLocaleDateString()}`,
      })
      toast({ title: 'Saved to Gallery', description: 'Find it in the Gallery app.' })
    } catch {
      toast({ title: 'Save failed', description: 'Could not write to the gallery storage.' })
    }
  }

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      {/* Slim top bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-lg shadow-orange-500/25">
            <Brush className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold leading-tight tracking-tight">Paint Studio</h2>
            <p className="truncate text-[11px] text-muted-foreground">Sketch, doodle and save to your gallery</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={undo}
            className="h-11 w-11 rounded-xl"
          >
            <Undo2 className="h-4.5 w-4.5" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={redo}
            className="h-11 w-11 rounded-xl"
          >
            <Redo2 className="h-4.5 w-4.5" aria-hidden />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                aria-label="Clear canvas"
                className="h-11 w-11 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-4.5 w-4.5" aria-hidden />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear the canvas?</AlertDialogTitle>
                <AlertDialogDescription>
                  This erases everything you have drawn so far. You can still press Undo to bring it back.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={clearCanvas}>Clear</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Stage */}
      <div
        ref={containerRef}
        style={
          bg === 'transparent'
            ? {
                backgroundImage:
                  'conic-gradient(#d4d4d8 25%, #fafafa 0 50%, #d4d4d8 0 75%, #fafafa 0)',
                backgroundSize: '16px 16px',
              }
            : undefined
        }
        className={cn(
          'relative h-[min(55vh,520px)] min-h-[380px] w-full overflow-hidden rounded-3xl border border-border shadow-inner transition-colors',
          bg === 'white' && 'bg-white',
          bg === 'dark' && 'bg-zinc-900'
        )}
      >
        <canvas
          ref={canvasRef}
          aria-label="Painting canvas"
          className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onLostPointerCapture={endStroke}
        />
      </div>

      {/* Floating glass toolbar */}
      <motion.div
        initial={{ y: 26, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30, delay: 0.08 }}
        className="sticky bottom-4 z-30 mt-4 flex justify-center"
      >
        <div className="flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-2 rounded-[1.75rem] border border-border/70 bg-background/80 p-2.5 shadow-xl shadow-black/10 backdrop-blur-xl">
          {/* Tool toggle */}
          <div className="flex items-center gap-0.5 rounded-full bg-muted p-1" role="group" aria-label="Tool">
            <button
              type="button"
              aria-label="Brush"
              aria-pressed={tool === 'brush'}
              onClick={() => setTool('brush')}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                tool === 'brush' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Brush className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Eraser"
              aria-pressed={tool === 'eraser'}
              onClick={() => setTool('eraser')}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                tool === 'eraser' ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Eraser className="h-4 w-4" aria-hidden />
            </button>
          </div>

          {/* Size */}
          <div className="flex items-center gap-2">
            <Slider
              value={[size]}
              min={1}
              max={48}
              step={1}
              onValueChange={(vals) => setSize(vals[0] ?? size)}
              className="w-20 sm:w-28"
              aria-label="Brush size"
            />
            <span className="flex h-9 w-9 items-center justify-center" aria-hidden>
              {tool === 'eraser' ? (
                <span
                  className="rounded-full border-2 border-dashed border-muted-foreground bg-transparent"
                  style={{ width: Math.max(4, Math.min(size, 26)), height: Math.max(4, Math.min(size, 26)) }}
                />
              ) : (
                <span
                  className="rounded-full"
                  style={{
                    width: Math.max(3, Math.min(size, 26)),
                    height: Math.max(3, Math.min(size, 26)),
                    backgroundColor: color,
                  }}
                />
              )}
            </span>
          </div>

          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />

          {/* Swatches */}
          <div className="flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label="Colors">
            {SWATCHES.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                onClick={() => {
                  setColor(c)
                  if (tool === 'eraser') setTool('brush')
                }}
                className={cn(
                  'h-8 w-8 shrink-0 rounded-full border border-black/10 shadow-sm transition-transform hover:scale-110',
                  color === c && 'ring-2 ring-foreground ring-offset-2 ring-offset-background'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <label
              className="relative h-8 w-8 shrink-0 cursor-pointer overflow-hidden rounded-full border border-border shadow-sm"
              aria-label="Custom color"
            >
              <span
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    'conic-gradient(#ef4444, #f59e0b, #22c55e, #3b82f6, #8b5cf6, #ec4899, #ef4444)',
                }}
                aria-hidden
              />
              <input
                type="color"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value)
                  setTool('brush')
                }}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                tabIndex={0}
              />
            </label>
          </div>

          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />

          {/* Background */}
          <div className="flex items-center gap-0.5 rounded-full bg-muted p-1" role="group" aria-label="Background">
            {BG_MODES.map(({ value, icon: Icon, label }) => (
              <button
                key={value}
                type="button"
                aria-label={label}
                aria-pressed={bg === value}
                onClick={() => setBg(value)}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                  bg === value ? 'bg-background text-foreground shadow' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
              </button>
            ))}
          </div>

          <span className="hidden h-6 w-px bg-border sm:block" aria-hidden />

          {/* Export actions */}
          <Button
            variant="outline"
            onClick={downloadPng}
            className="h-10 rounded-full px-3.5 text-xs font-semibold"
          >
            <Download className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">PNG</span>
          </Button>
          <Button
            onClick={() => void saveToGallery()}
            className="h-10 rounded-full bg-gradient-to-r from-orange-500 to-rose-500 px-3.5 text-xs font-semibold text-white shadow-lg shadow-orange-500/25 hover:from-orange-600 hover:to-rose-600"
          >
            <Save className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Save to Gallery</span>
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
