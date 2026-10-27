'use client'

/**
 * Camera v2.0.0 — live getUserMedia viewfinder with Photo and Scan modes,
 * filters, timer ring, grid and mirror controls.
 *
 * Scan mode (ROADMAP D42): capture or pick a document photo → auto
 * edge-detect pre-places 4 draggable corner handles → perspective flatten
 * via triangle-subdivision warp (pure canvas math, no deps) → enhance
 * presets (Original / Grayscale / Boosted / Magic Color) → saved through
 * the shared IndexedDB media store (source: 'camera') like any capture.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Camera,
  CameraOff,
  Check,
  Crop,
  Download,
  FlipHorizontal2,
  Grid3x3,
  ImagePlus,
  Loader2,
  RotateCcw,
  ScanLine,
  Sparkles,
  SwitchCamera,
  Timer,
  TimerOff,
  Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { deletePhoto, listPhotos, newPhotoId, putPhoto, type PhotoRecord } from '@/lib/media-db'

/* ================================================================== */
/* Filters & timer                                                     */
/* ================================================================== */

interface FilterDef {
  id: string
  label: string
  css: string
}

const FILTERS: FilterDef[] = [
  { id: 'normal', label: 'Normal', css: 'none' },
  { id: 'mono', label: 'Mono', css: 'grayscale(1)' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.6) contrast(1.1)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.35) saturate(1.4)' },
  { id: 'cool', label: 'Cool', css: 'hue-rotate(15deg) saturate(1.2)' },
  { id: 'sepia', label: 'Sepia', css: 'sepia(1)' },
]

const TIMER_OPTIONS: number[] = [0, 3, 10]

/* ================================================================== */
/* Scan pipeline constants                                             */
/* ================================================================== */

/** Working width for the Sobel edge-detect pass (kept small + fast). */
const SCAN_DETECT_WIDTH = 240
/** Longest allowed side of the flattened output canvas. */
const SCAN_MAX_OUTPUT = 1600
/** Subdivisions per side when warping each quad half (60×60). */
const SCAN_WARP_SUBDIVISIONS = 60
/** Outward bleed (px) per clipped sub-triangle to hide seams. */
const SCAN_WARP_BLEED_PX = 0.6

interface Pt {
  x: number
  y: number
}

/** Quad corners in normalized image space: TL, TR, BR, BL. */
type Corners = [Pt, Pt, Pt, Pt]

type CameraMode = 'photo' | 'scan'
type ScanStage = 'idle' | 'corners' | 'result'
type EnhanceId = 'original' | 'gray' | 'boost' | 'magic'

interface EnhanceDef {
  id: EnhanceId
  label: string
  css: string
}

const ENHANCE_PRESETS: EnhanceDef[] = [
  { id: 'original', label: 'Original', css: 'none' },
  { id: 'gray', label: 'Grayscale', css: 'grayscale(1)' },
  { id: 'boost', label: 'Boosted', css: 'contrast(1.3) brightness(1.04) saturate(1.12)' },
  { id: 'magic', label: 'Magic Color', css: 'brightness(1.1) saturate(1.5) contrast(1.06)' },
]

const CORNER_LABELS = ['Top-left corner', 'Top-right corner', 'Bottom-right corner', 'Bottom-left corner'] as const

interface ScanJob {
  url: string
  img: HTMLImageElement
  /** Revoke callback for object URLs (picked files); null for data URLs. */
  revoke: (() => void) | null
}

type CameraStatus = 'starting' | 'ready' | 'denied' | 'nodevice' | 'error' | 'unsupported'

/* ================================================================== */
/* Pure helpers — geometry, edge detect, perspective warp              */
/* ================================================================== */

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function buzz(): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(12)
}

function defaultCorners(): Corners {
  const inset = 0.07
  return [
    { x: inset, y: inset },
    { x: 1 - inset, y: inset },
    { x: 1 - inset, y: 1 - inset },
    { x: inset, y: 1 - inset },
  ]
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image decode failed'))
    img.src = src
  })
}

/** Waits two animation frames so a "processing" overlay paints first. */
function nextPaintFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function quadArea(q: Corners): number {
  let sum = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/** Cheap sanity gate so a garbage quad never replaces usable defaults. */
function quadIsPlausible(q: Corners): boolean {
  if (quadArea(q) < 0.12) return false
  const side = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y)
  const sides = [side(q[0], q[1]), side(q[1], q[2]), side(q[2], q[3]), side(q[3], q[0])]
  if (Math.min(...sides) < 0.1) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const c = q[(i + 2) % 4]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1e-9) return false
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * Best-effort document quad: downscale → grayscale → Sobel gradient
 * magnitude → strongest-edge extreme points (min/max of x±y). Returns
 * normalized TL/TR/BR/BL or null when nothing plausible is found.
 */
function detectQuad(img: HTMLImageElement): Corners | null {
  try {
    const iw = img.naturalWidth || img.width
    const ih = img.naturalHeight || img.height
    if (!iw || !ih) return null
    const w = Math.min(SCAN_DETECT_WIDTH, iw)
    const h = Math.max(2, Math.round((ih / iw) * w))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, w, h)
    const px = ctx.getImageData(0, 0, w, h).data
    const n = w * h
    const gray = new Float32Array(n)
    for (let p = 0, o = 0; p < n; p++, o += 4) {
      gray[p] = 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]
    }
    const mag = new Float32Array(n)
    let mean = 0
    let samples = 0
    for (let y = 1; y < h - 1; y++) {
      const row = y * w
      for (let x = 1; x < w - 1; x++) {
        const i = row + x
        const gx =
          -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
          gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1]
        const gy =
          -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
          gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1]
        const m = Math.abs(gx) + Math.abs(gy)
        mag[i] = m
        mean += m
        samples++
      }
    }
    if (samples < 100) return null
    mean /= samples
    let variance = 0
    for (let y = 1; y < h - 1; y++) {
      const row = y * w
      for (let x = 1; x < w - 1; x++) {
        const d = mag[row + x] - mean
        variance += d * d
      }
    }
    const threshold = mean + 1.6 * Math.sqrt(variance / samples)

    let strong = 0
    let tlScore = Infinity
    let brScore = -Infinity
    let trScore = -Infinity
    let blScore = Infinity
    const tl: Pt = { x: 0, y: 0 }
    const tr: Pt = { x: 0, y: 0 }
    const br: Pt = { x: 0, y: 0 }
    const bl: Pt = { x: 0, y: 0 }
    for (let y = 1; y < h - 1; y++) {
      const row = y * w
      for (let x = 1; x < w - 1; x++) {
        const m = mag[row + x]
        if (m < threshold) continue
        strong++
        const sum = x + y
        const diff = x - y
        if (sum < tlScore) {
          tlScore = sum
          tl.x = x
          tl.y = y
        }
        if (sum > brScore) {
          brScore = sum
          br.x = x
          br.y = y
        }
        if (diff > trScore) {
          trScore = diff
          tr.x = x
          tr.y = y
        }
        if (diff < blScore) {
          blScore = diff
          bl.x = x
          bl.y = y
        }
      }
    }
    if (strong < 40) return null
    const quad: Corners = [
      { x: tl.x / (w - 1), y: tl.y / (h - 1) },
      { x: tr.x / (w - 1), y: tr.y / (h - 1) },
      { x: br.x / (w - 1), y: br.y / (h - 1) },
      { x: bl.x / (w - 1), y: bl.y / (h - 1) },
    ]
    return quadIsPlausible(quad) ? quad : null
  } catch {
    return null
  }
}

/**
 * Maps one source triangle onto one destination triangle by subdividing it
 * into SCAN_WARP_SUBDIVISIONS² tiny affine-mapped triangles: each sub-tri
 * is clipped in destination space, an affine (solved from the 3-point
 * correspondence) is installed via setTransform, and the full image is
 * drawn — the clip does the rest. Fixed 0.6px outward bleed hides seams.
 */
function drawSubTri(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  s0: Pt,
  s1: Pt,
  s2: Pt,
  d0: Pt,
  d1: Pt,
  d2: Pt,
): void {
  // Determinant of [[s0.x, s0.y, 1], [s1.x, s1.y, 1], [s2.x, s2.y, 1]]
  const det = s0.x * (s1.y - s2.y) - s0.y * (s1.x - s2.x) + s1.x * s2.y - s2.x * s1.y
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return
  const m00 = (s1.y - s2.y) / det
  const m01 = (s2.y - s0.y) / det
  const m02 = (s0.y - s1.y) / det
  const m10 = (s2.x - s1.x) / det
  const m11 = (s0.x - s2.x) / det
  const m12 = (s1.x - s0.x) / det
  const m20 = (s1.x * s2.y - s2.x * s1.y) / det
  const m21 = (s2.x * s0.y - s0.x * s2.y) / det
  const m22 = (s0.x * s1.y - s1.x * s0.y) / det

  // Affine source→destination: x' = a·x + c·y + e, y' = b·x + d·y + f
  const a = m00 * d0.x + m01 * d1.x + m02 * d2.x
  const b = m00 * d0.y + m01 * d1.y + m02 * d2.y
  const c = m10 * d0.x + m11 * d1.x + m12 * d2.x
  const d = m10 * d0.y + m11 * d1.y + m12 * d2.y
  const e = m20 * d0.x + m21 * d1.x + m22 * d2.x
  const f = m20 * d0.y + m21 * d1.y + m22 * d2.y

  const cx = (d0.x + d1.x + d2.x) / 3
  const cy = (d0.y + d1.y + d2.y) / 3
  const bleed = (p: Pt): Pt => {
    const vx = p.x - cx
    const vy = p.y - cy
    const len = Math.hypot(vx, vy)
    if (len < 1e-6) return { x: p.x, y: p.y }
    const k = SCAN_WARP_BLEED_PX / len
    return { x: p.x + vx * k, y: p.y + vy * k }
  }
  const q0 = bleed(d0)
  const q1 = bleed(d1)
  const q2 = bleed(d2)

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.beginPath()
  ctx.moveTo(q0.x, q0.y)
  ctx.lineTo(q1.x, q1.y)
  ctx.lineTo(q2.x, q2.y)
  ctx.closePath()
  ctx.clip()
  ctx.setTransform(a, b, c, d, e, f)
  ctx.drawImage(img, 0, 0)
  ctx.restore()
}

function warpTriangle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  src: readonly [Pt, Pt, Pt],
  dst: readonly [Pt, Pt, Pt],
): void {
  const [a, b, c] = src
  const [da, db, dc] = dst
  const ex = b.x - a.x
  const ey = b.y - a.y
  const fx = c.x - a.x
  const fy = c.y - a.y
  const duX = (db.x - da.x) / SCAN_WARP_SUBDIVISIONS
  const duY = (db.y - da.y) / SCAN_WARP_SUBDIVISIONS
  const dvX = (dc.x - da.x) / SCAN_WARP_SUBDIVISIONS
  const dvY = (dc.y - da.y) / SCAN_WARP_SUBDIVISIONS

  const srcPt = (i: number, j: number): Pt => ({
    x: a.x + ex * (i / SCAN_WARP_SUBDIVISIONS) + fx * (j / SCAN_WARP_SUBDIVISIONS),
    y: a.y + ey * (i / SCAN_WARP_SUBDIVISIONS) + fy * (j / SCAN_WARP_SUBDIVISIONS),
  })
  const dstPt = (i: number, j: number): Pt => ({
    x: da.x + duX * i + dvX * j,
    y: da.y + duY * i + dvY * j,
  })

  for (let i = 0; i < SCAN_WARP_SUBDIVISIONS; i++) {
    for (let j = 0; i + j < SCAN_WARP_SUBDIVISIONS; j++) {
      drawSubTri(ctx, img, srcPt(i, j), srcPt(i + 1, j), srcPt(i, j + 1), dstPt(i, j), dstPt(i + 1, j), dstPt(i, j + 1))
      if (i + j + 1 < SCAN_WARP_SUBDIVISIONS) {
        drawSubTri(
          ctx,
          img,
          srcPt(i + 1, j),
          srcPt(i + 1, j + 1),
          srcPt(i, j + 1),
          dstPt(i + 1, j),
          dstPt(i + 1, j + 1),
          dstPt(i, j + 1),
        )
      }
    }
  }
}

/**
 * Perspective-flattens the quad into `out`: output size derives from the
 * quad's average edge lengths (capped at SCAN_MAX_OUTPUT), the quad is
 * split into two triangles and each is warped with affine subdivision.
 */
function warpQuad(img: HTMLImageElement, corners: Corners, out: HTMLCanvasElement): void {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) throw new Error('Cannot warp an empty image')
  const q: Corners = [
    { x: corners[0].x * iw, y: corners[0].y * ih },
    { x: corners[1].x * iw, y: corners[1].y * ih },
    { x: corners[2].x * iw, y: corners[2].y * ih },
    { x: corners[3].x * iw, y: corners[3].y * ih },
  ]
  const wTop = Math.hypot(q[1].x - q[0].x, q[1].y - q[0].y)
  const wBottom = Math.hypot(q[2].x - q[3].x, q[2].y - q[3].y)
  const hLeft = Math.hypot(q[3].x - q[0].x, q[3].y - q[0].y)
  const hRight = Math.hypot(q[2].x - q[1].x, q[2].y - q[1].y)
  const outW = Math.max(16, Math.min(SCAN_MAX_OUTPUT, Math.round((wTop + wBottom) / 2)))
  const outH = Math.max(16, Math.min(SCAN_MAX_OUTPUT, Math.round((hLeft + hRight) / 2)))
  out.width = outW
  out.height = outH
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, outW, outH)
  const d0: Pt = { x: 0, y: 0 }
  const d1: Pt = { x: outW, y: 0 }
  const d2: Pt = { x: outW, y: outH }
  const d3: Pt = { x: 0, y: outH }
  warpTriangle(ctx, img, [q[0], q[1], q[2]], [d0, d1, d2])
  warpTriangle(ctx, img, [q[0], q[2], q[3]], [d0, d2, d3])
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

const MODES: { id: CameraMode; label: string; icon: LucideIcon }[] = [
  { id: 'photo', label: 'Photo', icon: Camera },
  { id: 'scan', label: 'Scan', icon: ScanLine },
]

export default function CameraApp() {
  const { toast } = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const scanBoxRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const warpedRef = useRef<HTMLCanvasElement | null>(null)
  const scanJobRef = useRef<ScanJob | null>(null)
  const dragIdxRef = useRef<number | null>(null)
  const autoChipTimerRef = useRef<number | null>(null)

  const [status, setStatus] = useState<CameraStatus>('starting')
  const [errorMsg, setErrorMsg] = useState('')
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [mirror, setMirror] = useState(true)
  const [grid, setGrid] = useState(false)
  const [filterId, setFilterId] = useState('normal')
  const [timer, setTimer] = useState(0)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [flash, setFlash] = useState(false)
  const [recent, setRecent] = useState<PhotoRecord[]>([])
  const [dialogShot, setDialogShot] = useState<PhotoRecord | null>(null)

  // Scan state
  const [mode, setMode] = useState<CameraMode>('photo')
  const [scanStage, setScanStage] = useState<ScanStage>('idle')
  const [scanJob, setScanJob] = useState<ScanJob | null>(null)
  const [scanCorners, setScanCorners] = useState<Corners>(defaultCorners)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [autoChip, setAutoChip] = useState(false)
  const [scanResultUrl, setScanResultUrl] = useState<string | null>(null)
  const [enhanceId, setEnhanceId] = useState<EnhanceId>('original')
  const [processing, setProcessing] = useState(false)

  const activeFilter = FILTERS.find((f) => f.id === filterId) ?? FILTERS[0]
  const activeEnhance = ENHANCE_PRESETS.find((e) => e.id === enhanceId) ?? ENHANCE_PRESETS[0]

  /* -------- Stream lifecycle -------- */

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const startCamera = useCallback(
    async (facingMode: 'user' | 'environment') => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStatus('unsupported')
        setErrorMsg('This browser does not support camera access.')
        return
      }
      setStatus('starting')
      setErrorMsg('')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        stopStream()
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          try {
            await videoRef.current.play()
          } catch {
            /* autoplay edge cases — muted+playsInline normally covers it */
          }
        }
        const [track] = stream.getVideoTracks()
        track?.addEventListener('ended', () => {
          setStatus('error')
          setErrorMsg('The camera stream ended unexpectedly. Tap try again to restart.')
        })
        setStatus('ready')
      } catch (err) {
        const name = err instanceof DOMException ? err.name : ''
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          setStatus('denied')
          setErrorMsg(
            'Camera access was blocked. Allow camera permission for this site in your browser settings, then try again.'
          )
        } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
          setStatus('nodevice')
          setErrorMsg('No camera was found on this device. Connect one and try again.')
        } else if (name === 'NotReadableError') {
          setStatus('error')
          setErrorMsg('The camera is already in use by another app. Close it and try again.')
        } else {
          setStatus('error')
          setErrorMsg('Could not start the camera. Please try again.')
        }
      }
    },
    [stopStream]
  )

  /* Mount: start camera + restore recent captures. Unmount: full teardown. */
  useEffect(() => {
    // Defer so the initial setStatus happens outside the effect body
    const kick = window.setTimeout(() => void startCamera('user'), 0)
    let cancelled = false
    void listPhotos().then((all) => {
      if (!cancelled) setRecent(all.filter((p) => p.source === 'camera').slice(0, 10))
    })
    return () => {
      cancelled = true
      window.clearTimeout(kick)
      stopStream()
      if (countdownRef.current) clearInterval(countdownRef.current)
      if (autoChipTimerRef.current) window.clearTimeout(autoChipTimerRef.current)
      scanJobRef.current?.revoke?.()
    }
  }, [startCamera, stopStream])

  /* The viewfinder unmounts while the scan editor is open; re-attach the
     still-running stream when it comes back. */
  useEffect(() => {
    if (scanStage !== 'idle') return
    const video = videoRef.current
    const stream = streamRef.current
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream
      void video.play().catch(() => {
        /* autoplay edge cases — muted+playsInline normally covers it */
      })
    }
  }, [scanStage, status])

  /* -------- Capture helpers -------- */

  const shutterFeedback = useCallback(() => {
    setFlash(true)
    buzz()
    window.setTimeout(() => setFlash(false), 230)
  }, [])

  /** Draws the current video frame (filters + mirroring applied) to a JPEG. */
  const grabFrame = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    try {
      ctx.filter = activeFilter.css
    } catch {
      /* very old browsers ignore filters */
    }
    if (mirror && facing === 'user') {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.92)
  }, [activeFilter.css, mirror, facing])

  const clearChip = useCallback(() => {
    if (autoChipTimerRef.current) window.clearTimeout(autoChipTimerRef.current)
    autoChipTimerRef.current = null
    setAutoChip(false)
  }, [])

  const scheduleChipDismiss = useCallback(() => {
    if (autoChipTimerRef.current) window.clearTimeout(autoChipTimerRef.current)
    autoChipTimerRef.current = window.setTimeout(() => setAutoChip(false), 5000)
  }, [])

  /** Discards any scan in progress and returns to the live viewfinder. */
  const resetScan = useCallback(() => {
    scanJobRef.current?.revoke?.()
    scanJobRef.current = null
    warpedRef.current = null
    clearChip()
    setScanJob(null)
    setScanResultUrl(null)
    setScanStage('idle')
    setProcessing(false)
    setDragIdx(null)
    dragIdxRef.current = null
  }, [clearChip])

  /** Loads a captured/picked image, auto-detects the document quad and
   *  opens the corner editor. Never blocks: detect failure = defaults. */
  const beginScan = useCallback(
    async (src: string, revoke: (() => void) | null) => {
      try {
        const img = await loadImage(src)
        scanJobRef.current?.revoke?.()
        const job: ScanJob = { url: src, img, revoke }
        scanJobRef.current = job
        setScanJob(job)
        const quad = detectQuad(img)
        if (quad) {
          setScanCorners(quad)
          setAutoChip(true)
          scheduleChipDismiss()
        } else {
          setScanCorners(defaultCorners())
          setAutoChip(false)
        }
        setEnhanceId('original')
        setScanStage('corners')
        buzz()
      } catch {
        revoke?.()
        toast({ title: 'Could not read that image', description: 'Try another photo.', variant: 'destructive' })
      }
    },
    [scheduleChipDismiss, toast]
  )

  const runAutoDetect = useCallback(() => {
    const job = scanJobRef.current
    if (!job) return
    const quad = detectQuad(job.img)
    if (quad) {
      setScanCorners(quad)
      setAutoChip(true)
      scheduleChipDismiss()
      buzz()
    } else {
      clearChip()
      toast({ title: 'Auto-detect unavailable', description: 'Drag the corners to frame the document manually.' })
    }
  }, [clearChip, scheduleChipDismiss, toast])

  const capture = useCallback(() => {
    shutterFeedback()
    const frame = grabFrame()
    if (!frame) return
    if (mode === 'scan') {
      void beginScan(frame, null)
      return
    }
    const record: PhotoRecord = {
      id: newPhotoId(),
      dataUrl: frame,
      createdAt: Date.now(),
      fav: false,
      source: 'camera',
      name: `Shot ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
    }
    void putPhoto(record)
      .then(() => {
        setRecent((prev) => [record, ...prev].slice(0, 10))
      })
      .catch(() => {
        toast({ title: 'Could not save photo', description: 'Storage may be full.', variant: 'destructive' })
      })
  }, [shutterFeedback, grabFrame, mode, beginScan, toast])

  const cancelCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = null
    setCountdown(null)
  }, [])

  const onShutter = useCallback(() => {
    // Tapping the shutter mid-countdown cancels it
    if (countdown !== null) {
      cancelCountdown()
      return
    }
    if (status !== 'ready') return
    if (timer > 0) {
      let n = timer
      setCountdown(n)
      countdownRef.current = setInterval(() => {
        n -= 1
        if (n <= 0) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          countdownRef.current = null
          setCountdown(null)
          capture()
        } else {
          setCountdown(n)
        }
      }, 1000)
    } else {
      capture()
    }
  }, [countdown, cancelCountdown, status, timer, capture])

  /* -------- Camera switch & mode switch -------- */

  const flipCamera = useCallback(() => {
    cancelCountdown()
    const next = facing === 'user' ? 'environment' : 'user'
    setFacing(next)
    setMirror(next === 'user')
    void startCamera(next)
  }, [facing, cancelCountdown, startCamera])

  const switchMode = useCallback(
    (next: CameraMode) => {
      if (next === mode) return
      cancelCountdown()
      resetScan()
      setMode(next)
    },
    [mode, cancelCountdown, resetScan]
  )

  /* -------- Scan corner dragging (pointer events, ≥44px targets) -------- */

  const startCornerDrag = useCallback(
    (index: number, event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault()
      dragIdxRef.current = index
      setDragIdx(index)
      clearChip()
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* pointer capture unsupported — implicit capture still works */
      }
      buzz()
    },
    [clearChip]
  )

  const moveCornerDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const index = dragIdxRef.current
    const box = scanBoxRef.current
    if (index === null || !box) return
    const rect = box.getBoundingClientRect()
    const x = clamp01((event.clientX - rect.left) / Math.max(1, rect.width))
    const y = clamp01((event.clientY - rect.top) / Math.max(1, rect.height))
    setScanCorners((prev) => {
      const next: Corners = [prev[0], prev[1], prev[2], prev[3]]
      next[index] = { x, y }
      return next
    })
  }, [])

  const endCornerDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    dragIdxRef.current = null
    setDragIdx(null)
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      /* capture may already be released */
    }
  }, [])

  /* -------- Scan flatten & save -------- */

  const buildScanResult = useCallback(async () => {
    const job = scanJobRef.current
    if (!job || processing) return
    setProcessing(true)
    await nextPaintFrames()
    try {
      let canvas = warpedRef.current
      if (!canvas) {
        canvas = document.createElement('canvas')
        warpedRef.current = canvas
      }
      warpQuad(job.img, scanCorners, canvas)
      setScanResultUrl(canvas.toDataURL('image/jpeg', 0.92))
      setScanStage('result')
      buzz()
    } catch {
      toast({
        title: 'Could not flatten the scan',
        description: 'Adjust the corners and try again.',
        variant: 'destructive',
      })
    } finally {
      setProcessing(false)
    }
  }, [processing, scanCorners, toast])

  const saveScan = useCallback(() => {
    const canvas = warpedRef.current
    if (!canvas || processing) return
    let dataUrl: string | null = scanResultUrl
    if (activeEnhance.css !== 'none') {
      const out = document.createElement('canvas')
      out.width = canvas.width
      out.height = canvas.height
      const ctx = out.getContext('2d')
      if (ctx) {
        try {
          ctx.filter = activeEnhance.css
        } catch {
          /* very old browsers ignore filters */
        }
        ctx.drawImage(canvas, 0, 0)
        dataUrl = out.toDataURL('image/jpeg', 0.92)
      }
    }
    if (!dataUrl) return
    const record: PhotoRecord = {
      id: newPhotoId(),
      dataUrl,
      createdAt: Date.now(),
      fav: false,
      source: 'camera',
      name: `Scan ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
    }
    void putPhoto(record)
      .then(() => {
        setRecent((prev) => [record, ...prev].slice(0, 10))
      })
      .catch(() => {
        toast({ title: 'Could not save scan', description: 'Storage may be full.', variant: 'destructive' })
      })
    buzz()
    toast({ title: 'Scan saved', description: 'Find it in the Gallery app.' })
    resetScan()
  }, [activeEnhance.css, processing, scanResultUrl, resetScan, toast])

  /* -------- Picked document photo -------- */

  const onPickFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) return
      const url = URL.createObjectURL(file)
      void beginScan(url, () => URL.revokeObjectURL(url))
    },
    [beginScan]
  )

  /* -------- Film strip actions -------- */

  const deleteShot = useCallback(
    async (shot: PhotoRecord) => {
      try {
        await deletePhoto(shot.id)
        setRecent((prev) => prev.filter((p) => p.id !== shot.id))
        setDialogShot(null)
        toast({ title: 'Capture deleted' })
      } catch {
        toast({ title: 'Could not delete capture', variant: 'destructive' })
      }
    },
    [toast]
  )

  const mirroring = mirror && facing === 'user'
  const editorOpen = scanStage !== 'idle'

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-lg">
      {editorOpen ? (
        /* ================= Scan editor ================= */
        <div className="relative mt-3 overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.6)]">
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                {scanStage === 'corners' ? 'Frame the document' : 'Scan preview'}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {scanStage === 'corners'
                  ? 'Drag the four corner handles to fit the page'
                  : 'Pick an enhance preset, then save'}
              </p>
            </div>
            <AnimatePresence>
              {autoChip && scanStage === 'corners' && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 26 }}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30"
                >
                  <Sparkles className="size-3" aria-hidden /> Auto-detected
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {scanStage === 'corners' && scanJob ? (
            <div className="p-3">
              <div className="flex justify-center">
                <div ref={scanBoxRef} className="relative touch-none select-none">
                  <img
                    src={scanJob.url}
                    alt="Document photo to scan"
                    draggable={false}
                    className="block max-h-[58vh] max-w-full select-none rounded-xl bg-black"
                  />
                  <svg
                    className="pointer-events-none absolute inset-0 size-full"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    aria-hidden
                  >
                    <polygon
                      points={scanCorners.map((p) => `${p.x * 100},${p.y * 100}`).join(' ')}
                      fill="rgb(244 63 94 / 0.12)"
                      stroke="rgb(255 255 255 / 0.95)"
                      strokeWidth={2}
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                  {scanCorners.map((corner, i) => (
                    <button
                      key={CORNER_LABELS[i]}
                      type="button"
                      aria-label={CORNER_LABELS[i]}
                      onPointerDown={(event) => startCornerDrag(i, event)}
                      onPointerMove={moveCornerDrag}
                      onPointerUp={endCornerDrag}
                      onPointerCancel={endCornerDrag}
                      onLostPointerCapture={endCornerDrag}
                      className="absolute z-10 flex size-11 -translate-x-1/2 -translate-y-1/2 touch-none items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
                    >
                      <span
                        className={cn(
                          'pointer-events-none block rounded-full bg-white shadow-[0_2px_10px_rgb(0_0_0/0.55)] ring-2 transition-[width,height] duration-150',
                          dragIdx === i ? 'size-5 ring-rose-400' : 'size-3.5 ring-rose-400/80'
                        )}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={resetScan}
                  className="h-12 flex-1 gap-1.5 rounded-xl border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <RotateCcw className="size-4" aria-hidden /> Retake
                </Button>
                <Button
                  variant="outline"
                  onClick={runAutoDetect}
                  className="h-12 flex-1 gap-1.5 rounded-xl border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Sparkles className="size-4" aria-hidden /> Auto
                </Button>
                <Button
                  onClick={() => void buildScanResult()}
                  disabled={processing}
                  className="h-12 flex-[1.4] gap-1.5 rounded-xl bg-white text-zinc-950 hover:bg-white/90"
                >
                  <Crop className="size-4" aria-hidden /> Flatten
                </Button>
              </div>
            </div>
          ) : scanStage === 'result' && scanResultUrl ? (
            <div className="p-3">
              <div className="flex justify-center rounded-xl bg-black">
                <img
                  src={scanResultUrl}
                  alt="Flattened scan preview"
                  draggable={false}
                  className="block max-h-[52vh] max-w-full"
                  style={{ filter: activeEnhance.css === 'none' ? undefined : activeEnhance.css }}
                />
              </div>
              <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Scan enhance presets">
                {ENHANCE_PRESETS.map((preset) => {
                  const selected = preset.id === enhanceId
                  return (
                    <button
                      key={preset.id}
                      onClick={() => setEnhanceId(preset.id)}
                      aria-pressed={selected}
                      className={cn(
                        'flex h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-all',
                        selected
                          ? 'border-transparent bg-white text-zinc-950 shadow-md ring-2 ring-rose-400/60'
                          : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                      )}
                    >
                      <span
                        className="size-3.5 shrink-0 rounded-full bg-gradient-to-br from-rose-400 via-amber-300 to-emerald-400"
                        style={{ filter: preset.css === 'none' ? undefined : preset.css }}
                        aria-hidden
                      />
                      {preset.label}
                    </button>
                  )
                })}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setScanStage('corners')}
                  className="h-12 flex-1 gap-1.5 rounded-xl border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Crop className="size-4" aria-hidden /> Corners
                </Button>
                <Button
                  variant="outline"
                  onClick={resetScan}
                  className="h-12 flex-1 gap-1.5 rounded-xl border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <RotateCcw className="size-4" aria-hidden /> Retake
                </Button>
                <Button
                  onClick={saveScan}
                  disabled={processing}
                  className="h-12 flex-[1.4] gap-1.5 rounded-xl bg-white text-zinc-950 hover:bg-white/90"
                >
                  <Check className="size-4" aria-hidden /> Save
                </Button>
              </div>
            </div>
          ) : null}

          {processing && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
              <Loader2 className="size-8 animate-spin text-white/85" aria-hidden />
              <p className="text-sm font-medium text-white/85">Flattening…</p>
            </div>
          )}
        </div>
      ) : (
        /* ================= Live camera ================= */
        <>
          {/* Viewfinder stage */}
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black shadow-[0_20px_50px_-20px_rgb(0_0_0/0.6)]">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={cn(
                'h-[52vh] w-full bg-black object-cover transition-[filter] duration-300 sm:h-[60vh]',
                mirroring && '-scale-x-100'
              )}
              style={{ filter: activeFilter.css === 'none' ? undefined : activeFilter.css }}
            />

            {/* Thirds grid overlay */}
            {grid && status === 'ready' && (
              <div className="pointer-events-none absolute inset-0" aria-hidden>
                <div className="absolute left-1/3 top-0 h-full w-px bg-white/30" />
                <div className="absolute left-2/3 top-0 h-full w-px bg-white/30" />
                <div className="absolute left-0 top-1/3 h-px w-full bg-white/30" />
                <div className="absolute left-0 top-2/3 h-px w-full bg-white/30" />
              </div>
            )}

            {/* Shutter flash */}
            <AnimatePresence>
              {flash && (
                <motion.div
                  initial={{ opacity: 0.95 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="pointer-events-none absolute inset-0 z-20 bg-white"
                  aria-hidden
                />
              )}
            </AnimatePresence>

            {/* Countdown overlay with depleting ring */}
            <AnimatePresence>
              {countdown !== null && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-10 flex items-center justify-center bg-black/30"
                >
                  <div className="relative flex size-44 items-center justify-center">
                    <svg viewBox="0 0 100 100" className="absolute inset-0 size-full -rotate-90" aria-hidden>
                      <circle cx="50" cy="50" r="46" fill="none" stroke="rgb(255 255 255 / 0.18)" strokeWidth="4" />
                      <motion.circle
                        key={countdown}
                        cx="50"
                        cy="50"
                        r="46"
                        fill="none"
                        stroke="rgb(255 255 255 / 0.95)"
                        strokeWidth="4"
                        strokeLinecap="round"
                        pathLength={100}
                        strokeDasharray="100 100"
                        initial={{ strokeDashoffset: 0 }}
                        animate={{ strokeDashoffset: 100 }}
                        transition={{ duration: 1, ease: 'linear' }}
                      />
                    </svg>
                    <AnimatePresence mode="popLayout">
                      <motion.span
                        key={countdown}
                        initial={{ scale: 1.7, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.6, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                        className="text-7xl font-bold text-white drop-shadow-[0_4px_18px_rgb(0_0_0/0.6)]"
                      >
                        {countdown}
                      </motion.span>
                    </AnimatePresence>
                  </div>
                  <p className="absolute bottom-6 w-full text-center text-xs font-medium text-white/80">
                    Tap the shutter to cancel
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Status overlays */}
            {status !== 'ready' && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-zinc-950 px-8 text-center">
                {status === 'starting' && (
                  <>
                    <Loader2 className="size-9 animate-spin text-white/80" aria-hidden />
                    <p className="text-sm font-medium text-white/80">Starting camera…</p>
                  </>
                )}
                {(status === 'denied' || status === 'nodevice' || status === 'error' || status === 'unsupported') && (
                  <>
                    <span className="flex size-16 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                      <CameraOff className="size-8" aria-hidden />
                    </span>
                    <h3 className="text-base font-semibold text-white">
                      {status === 'denied'
                        ? 'Camera access blocked'
                        : status === 'nodevice'
                          ? 'No camera found'
                          : status === 'unsupported'
                            ? 'Camera not supported'
                            : 'Camera unavailable'}
                    </h3>
                    <p className="max-w-xs text-sm text-white/65">{errorMsg}</p>
                    {status !== 'unsupported' && (
                      <Button
                        onClick={() => void startCamera(facing)}
                        className="mt-1 h-11 rounded-xl bg-white text-zinc-900 hover:bg-white/90"
                      >
                        Try again
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Mode switcher */}
          <div className="mt-3 flex justify-center">
            <div role="tablist" aria-label="Camera mode" className="flex gap-1 rounded-full border border-white/10 bg-white/5 p-1">
              {MODES.map((m) => {
                const active = mode === m.id
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchMode(m.id)}
                    className="relative flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {active && (
                      <motion.span
                        layoutId="camera-mode-pill"
                        className="absolute inset-0 rounded-full bg-white shadow-md"
                        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      />
                    )}
                    <span className={cn('relative z-10 flex items-center gap-2', active ? 'text-zinc-950' : 'text-zinc-300')}>
                      <m.icon className="size-4.5" aria-hidden />
                      {m.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Filter strip */}
          <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Live filters">
            {FILTERS.map((f) => {
              const selected = f.id === filterId
              return (
                <button
                  key={f.id}
                  onClick={() => setFilterId(f.id)}
                  aria-pressed={selected}
                  className={cn(
                    'flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-all',
                    selected
                      ? 'border-transparent bg-white text-zinc-950 shadow-md ring-2 ring-rose-400/60'
                      : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                  )}
                >
                  <span
                    className="size-3.5 shrink-0 rounded-full bg-gradient-to-br from-rose-400 via-amber-300 to-emerald-400"
                    style={{ filter: f.css === 'none' ? undefined : f.css }}
                    aria-hidden
                  />
                  {f.label}
                </button>
              )
            })}
          </div>

          {/* Film strip */}
          {recent.length > 0 && (
            <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Recent captures">
              {recent.map((shot) => (
                <button
                  key={shot.id}
                  onClick={() => setDialogShot(shot)}
                  aria-label={`Preview capture ${shot.name ?? ''}`}
                  className="group relative shrink-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <img
                    src={shot.dataUrl}
                    alt={shot.name ?? 'Camera capture'}
                    className="size-14 rounded-xl object-cover ring-1 ring-white/15 transition-all group-hover:ring-2 group-hover:ring-white/50"
                  />
                </button>
              ))}
            </div>
          )}

          {/* Control bar */}
          <div className="mt-4 flex items-center justify-between gap-2 rounded-3xl border border-white/10 bg-zinc-950 px-4 py-3.5 shadow-lg">
            <div className="flex gap-2">
              {/* Pick a document photo (scan mode) */}
              {mode === 'scan' && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  aria-label="Pick a document photo from this device"
                  className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-200 transition-colors hover:bg-white/10"
                >
                  <ImagePlus className="size-5" aria-hidden />
                </button>
              )}
              {/* Timer cycle: Off -> 3s -> 10s */}
              <button
                onClick={() => setTimer((t) => TIMER_OPTIONS[(TIMER_OPTIONS.indexOf(t) + 1) % TIMER_OPTIONS.length])}
                aria-label={`Self-timer: ${timer === 0 ? 'off' : `${timer} seconds`}. Tap to change.`}
                className={cn(
                  'flex h-12 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors',
                  timer > 0
                    ? 'border-amber-400/50 bg-amber-400/15 text-amber-300'
                    : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                )}
              >
                {timer > 0 ? <Timer className="size-4.5" aria-hidden /> : <TimerOff className="size-4.5" aria-hidden />}
                {timer === 0 ? 'Off' : `${timer}s`}
              </button>
              {/* Flip camera */}
              <button
                onClick={flipCamera}
                aria-label={facing === 'user' ? 'Switch to back camera' : 'Switch to front camera'}
                className="flex size-12 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-200 transition-colors hover:bg-white/10"
              >
                <SwitchCamera className="size-5" aria-hidden />
              </button>
            </div>

            {/* Shutter */}
            <motion.button
              whileTap={{ scale: 0.86 }}
              transition={{ type: 'spring', stiffness: 480, damping: 20 }}
              onClick={onShutter}
              disabled={status !== 'ready'}
              aria-label={mode === 'scan' ? 'Capture document for scanning' : 'Take photo'}
              className="relative size-16 shrink-0 rounded-full border-[3px] border-white/90 bg-white/10 p-[5px] shadow-[0_10px_28px_-8px_rgb(244_63_94/0.65)] transition-opacity disabled:opacity-40 disabled:hover:scale-100 sm:size-20"
            >
              <span
                className={cn(
                  'block size-full rounded-full ring-1 ring-white/40',
                  mode === 'scan'
                    ? 'bg-gradient-to-br from-sky-400 to-indigo-600'
                    : 'bg-gradient-to-br from-rose-400 to-red-600'
                )}
              />
            </motion.button>

            <div className="flex gap-2">
              {/* Grid overlay toggle */}
              <Toggle
                pressed={grid}
                onPressedChange={setGrid}
                aria-label="Toggle composition grid"
                className="size-12 rounded-full border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 data-[state=on]:bg-white/20 data-[state=on]:text-white"
              >
                <Grid3x3 className="size-5" aria-hidden />
              </Toggle>
              {/* Mirror toggle (front camera only) */}
              <Toggle
                pressed={mirror}
                onPressedChange={setMirror}
                disabled={facing !== 'user'}
                aria-label="Toggle mirror preview"
                className="size-12 rounded-full border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 data-[state=on]:bg-white/20 data-[state=on]:text-white disabled:opacity-35"
              >
                <FlipHorizontal2 className="size-5" aria-hidden />
              </Toggle>
            </div>
          </div>

          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            Captures and scans are saved on this device and appear in the Gallery app.
          </p>
        </>
      )}

      {/* Hidden picker for document photos */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickFile}
        aria-hidden
        tabIndex={-1}
      />

      {/* Film strip preview dialog */}
      <Dialog open={dialogShot !== null} onOpenChange={(open) => !open && setDialogShot(null)}>
        <DialogContent className="max-w-md p-4 sm:p-5">
          <DialogHeader className="sr-only">
            <DialogTitle>Capture preview</DialogTitle>
            <DialogDescription>Download or delete this camera capture.</DialogDescription>
          </DialogHeader>
          {dialogShot && (
            <>
              <img
                src={dialogShot.dataUrl}
                alt={dialogShot.name ?? 'Camera capture'}
                className="max-h-[56vh] w-full rounded-xl object-contain"
              />
              <div className="mt-3 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{dialogShot.name ?? 'Capture'}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(dialogShot.createdAt).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <Button variant="outline" size="sm" asChild className="h-10 gap-1.5 rounded-lg">
                  <a href={dialogShot.dataUrl} download={`${(dialogShot.name ?? 'capture').replace(/\s+/g, '-')}.jpg`}>
                    <Download className="size-4" aria-hidden /> Save
                  </a>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void deleteShot(dialogShot)}
                  className="h-10 gap-1.5 rounded-lg"
                >
                  <Trash2 className="size-4" aria-hidden /> Delete
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
