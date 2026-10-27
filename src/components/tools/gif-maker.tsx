'use client'

/**
 * GIF Maker — turn any video moment into a looping GIF.
 *
 * Source:  pick a video from the device (file picker) or record a fresh clip
 *          with the front/back camera. Both stay 100% on-device — nothing is
 *          ever uploaded.
 * Create:  trim a start/end window, choose FPS + output width, then encode
 *          frame-by-frame with gifenc (per-frame 256-colour palette
 *          quantization) while a live progress bar tracks the render —
 *          cancellable at any moment.
 * History: finished GIFs land in IndexedDB `toolhub-gifmaker` (the GIF blob
 *          itself only when ≤ 6 MB) so past creations can be previewed,
 *          re-downloaded, deleted or cleared.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Camera,
  Check,
  Download,
  Film,
  History,
  ImagePlay,
  Info,
  Loader2,
  Scissors,
  Settings2,
  Square,
  SwitchCamera,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const DB_NAME = 'toolhub-gifmaker'
const DB_VERSION = 1
const HISTORY_STORE = 'history'

/** Hard cap of encoded frames per GIF — the render guard refuses beyond this. */
const MAX_FRAMES = 300
/** Persist the GIF blob into history only up to this size. */
const MAX_SAVED_BLOB = 6 * 1024 * 1024
/** Minimum trim window in seconds — end must exceed start by this. */
const MIN_SPAN = 0.5
/** Per-seek watchdog so one stalled seek can't hang the encode loop. */
const SEEK_TIMEOUT_MS = 4000

const FPS_OPTIONS: readonly number[] = [5, 10, 15, 24]
const WIDTH_OPTIONS: readonly number[] = [160, 240, 320, 480]

/** Thin glass scrollbar for long lists (house convention). */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/** Tab trigger overrides — explicit zinc styling survives light/dark themes. */
const TRIGGER_CLS =
  'flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-1 pb-1.5 pt-2 text-[10px] font-medium text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-zinc-50 sm:text-[11px]'

const SELECT_TRIGGER_CLS = 'h-11 w-full rounded-xl border-white/10 bg-white/[0.04] text-zinc-100'
const SELECT_CONTENT_CLS = 'rounded-2xl border-white/10 bg-zinc-900 text-zinc-100'

const SLIDER_CLS =
  '[&_[data-slot=slider-range]]:bg-gradient-to-r [&_[data-slot=slider-range]]:from-amber-400 [&_[data-slot=slider-range]]:to-pink-500 [&_[data-slot=slider-thumb]]:border-amber-400 [&_[data-slot=slider-track]]:bg-white/15'

/** mm:ss readout (minutes zero-padded). */
const fmtTime = (t: number) => {
  const safe = isFinite(t) && t > 0 ? t : 0
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const fmtBytes = (n: number) => {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

const haptic = () => {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

/** Pick the first MediaRecorder video mime type this browser supports. */
function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? ''
}

/** Yield one macrotask so the browser can paint between heavy encode steps. */
const nextTick = () => new Promise<void>((resolve) => window.setTimeout(resolve, 0))

/**
 * Seek a <video> to `time` and resolve once the new frame is presented.
 * Resolves anyway after a watchdog timeout so a stalled seek can never hang
 * the caller; all listeners/timeouts are always cleaned up.
 */
function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.005) {
      resolve()
      return
    }
    let done = false
    const finish = () => {
      if (done) return
      done = true
      video.removeEventListener('seeked', finish)
      video.removeEventListener('error', finish)
      window.clearTimeout(timer)
      resolve()
    }
    const timer = window.setTimeout(finish, SEEK_TIMEOUT_MS)
    video.addEventListener('seeked', finish)
    video.addEventListener('error', finish)
    video.currentTime = time
  })
}

/* ================================================================== */
/* IndexedDB — 'toolhub-gifmaker' v1 · store 'history' (write-through) */
/* ================================================================== */

let dbPromise: Promise<IDBDatabase> | null = null

function openGifDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(HISTORY_STORE)) {
        d.createObjectStore(HISTORY_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openGifDb()
  return dbPromise
}

function idbGetAll<T>(store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readonly').objectStore(store).getAll()
        req.onsuccess = () => resolve((req.result ?? []) as T[])
        req.onerror = () => reject(req.error ?? new Error('IndexedDB getAll failed'))
      })
      .catch(reject)
  })
}

function idbPut<T>(store: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).put(value as object)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'))
      })
      .catch(reject)
  })
}

function idbDelete(store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).delete(key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
      })
      .catch(reject)
  })
}

function idbClear(store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).clear()
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB clear failed'))
      })
      .catch(reject)
  })
}

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type TabId = 'create' | 'camera' | 'history'
type Facing = 'user' | 'environment'

interface HistoryRecord {
  id: string
  sourceName: string
  fps: number
  width: number
  frames: number
  sizeBytes: number
  /** Stored only when the GIF is ≤ 6 MB. */
  gifBlob?: Blob
  createdAt: number
}

interface EncodeResult {
  url: string
  name: string
  width: number
  height: number
  frames: number
  sizeBytes: number
}

/** Renders a Blob as an <img> with a self-managed object URL (revoked on unmount). */
function GifImage({ blob, alt, className }: { blob: Blob; alt: string; className?: string }) {
  const [url] = useState(() => URL.createObjectURL(blob))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return <img src={url} alt={alt} className={className} loading="lazy" />
}

/** Download anchor whose href is a one-time object URL (revoked on unmount). */
function GifDownloadLink({
  blob,
  name,
  className,
  children,
}: {
  blob: Blob
  name: string
  className?: string
  children: ReactNode
}) {
  const [url] = useState(() => URL.createObjectURL(blob))
  useEffect(() => () => URL.revokeObjectURL(url), [url])
  return (
    <a href={url} download={name} onClick={haptic} className={className}>
      {children}
    </a>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function GifMakerApp() {
  const { toast } = useToast()

  /* ---------------- source video ---------------- */
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const srcUrlRef = useRef<string | null>(null)
  const resultUrlRef = useRef<string | null>(null)
  const durTimerRef = useRef<number | null>(null)
  const metaReadyRef = useRef(false)
  const mountedRef = useRef(true)

  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [duration, setDuration] = useState(0)
  const [videoDims, setVideoDims] = useState<{ w: number; h: number } | null>(null)
  const [metaReady, setMetaReady] = useState(false)

  /* ---------------- trim + output settings ---------------- */
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [fps, setFps] = useState(10)
  const [outWidth, setOutWidth] = useState(320)

  /* ---------------- render pipeline ---------------- */
  const abortRenderRef = useRef(false)
  const [rendering, setRendering] = useState<{ done: number; total: number } | null>(null)
  const [result, setResult] = useState<EncodeResult | null>(null)

  /* ---------------- camera capture ---------------- */
  const camVideoRef = useRef<HTMLVideoElement>(null)
  const camStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recTimerRef = useRef<number | null>(null)
  const facingRef = useRef<Facing>('user')
  const manualStopRef = useRef(false)

  const [camOn, setCamOn] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [facing, setFacing] = useState<Facing>('user')
  const [recording, setRecording] = useState(false)
  const [recSecs, setRecSecs] = useState(0)

  /* ---------------- tabs + history ---------------- */
  const [tab, setTab] = useState<TabId>('create')
  const [history, setHistory] = useState<HistoryRecord[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const confirmTimerRef = useRef<number | null>(null)

  /* ---------------- derived ---------------- */
  const span = Math.max(0, trimEnd - trimStart)
  const rawFrames = span > 0 ? Math.ceil(span * fps) : 0
  const overCap = rawFrames > MAX_FRAMES
  const nearCap = !overCap && rawFrames >= MAX_FRAMES * 0.8
  const outHeight =
    videoDims && videoDims.w > 0 ? Math.max(1, Math.round((outWidth * videoDims.h) / videoDims.w)) : 0
  const pct = rendering ? Math.min(100, Math.round((rendering.done / Math.max(1, rendering.total)) * 100)) : 0
  const previewRec = history.find((r) => r.id === previewId) ?? null

  /* ================================================================== */
  /* Unmount cleanup — URLs, timers, camera, in-flight encode            */
  /* ================================================================== */

  const stopCameraStream = useCallback(() => {
    if (camStreamRef.current) {
      camStreamRef.current.getTracks().forEach((t) => t.stop())
      camStreamRef.current = null
    }
    if (camVideoRef.current) camVideoRef.current.srcObject = null
  }, [])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      abortRenderRef.current = true
      if (srcUrlRef.current) URL.revokeObjectURL(srcUrlRef.current)
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
      if (recTimerRef.current) window.clearInterval(recTimerRef.current)
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
      if (durTimerRef.current) window.clearTimeout(durTimerRef.current)
      stopCameraStream()
    }
  }, [stopCameraStream])

  /* ================================================================== */
  /* History — hydrate once (IndexedDB, private-mode tolerant)           */
  /* ================================================================== */

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rows = await idbGetAll<HistoryRecord>(HISTORY_STORE)
        if (!alive) return
        rows.sort((a, b) => b.createdAt - a.createdAt)
        setHistory(rows)
      } catch {
        /* private mode / quota — keep in-memory history */
      }
      if (alive) setHistoryLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  const removeHistory = useCallback(
    (id: string) => {
      setHistory((prev) => prev.filter((r) => r.id !== id))
      setPreviewId((prev) => (prev === id ? null : prev))
      setConfirmDeleteId(null)
      void idbDelete(HISTORY_STORE, id).catch(() => {
        toast({ title: 'Could not delete', description: 'Storage may be unavailable.', variant: 'destructive' })
      })
    },
    [toast],
  )

  const clearHistory = useCallback(() => {
    setHistory([])
    setPreviewId(null)
    setConfirmClear(false)
    void idbClear(HISTORY_STORE).catch(() => {
      toast({ title: 'Could not clear history', description: 'Storage may be unavailable.', variant: 'destructive' })
    })
  }, [toast])

  /** Two-tap delete confirmation with auto-revert (house pattern). */
  const armDelete = useCallback((id: string) => {
    setConfirmClear(false)
    setConfirmDeleteId((prev) => (prev === id ? null : id))
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = window.setTimeout(() => setConfirmDeleteId(null), 2600)
  }, [])

  const armClear = useCallback(() => {
    setConfirmDeleteId(null)
    setConfirmClear(true)
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = window.setTimeout(() => setConfirmClear(false), 2600)
  }, [])

  /* ================================================================== */
  /* Source video — import / camera clip / replace / metadata            */
  /* ================================================================== */

  const loadVideoBlob = useCallback((blob: Blob, name: string) => {
    abortRenderRef.current = true // cancel any in-flight encode of the old source
    const url = URL.createObjectURL(blob)
    if (srcUrlRef.current) URL.revokeObjectURL(srcUrlRef.current)
    srcUrlRef.current = url
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    metaReadyRef.current = false
    setVideoUrl(url)
    setSourceName(name)
    setDuration(0)
    setVideoDims(null)
    setMetaReady(false)
    setTrimStart(0)
    setTrimEnd(0)
    setRendering(null)
    setResult(null)
    setTab('create')
  }, [])

  const changeSource = useCallback(() => {
    abortRenderRef.current = true
    if (srcUrlRef.current) {
      URL.revokeObjectURL(srcUrlRef.current)
      srcUrlRef.current = null
    }
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    metaReadyRef.current = false
    setVideoUrl(null)
    setSourceName('')
    setDuration(0)
    setVideoDims(null)
    setMetaReady(false)
    setTrimStart(0)
    setTrimEnd(0)
    setRendering(null)
    setResult(null)
  }, [])

  const importFile = useCallback(
    (file: File | undefined) => {
      if (!file) return
      if (!file.type.startsWith('video/')) {
        toast({
          title: 'Not a video file',
          description: 'Choose an MP4, WebM or MOV clip.',
          variant: 'destructive',
        })
        return
      }
      loadVideoBlob(file, file.name)
    },
    [loadVideoBlob, toast],
  )

  /** Apply metadata; only reset the trim window for a *fresh* source. */
  const applyMeta = useCallback((v: HTMLVideoElement) => {
    const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0
    setDuration(d)
    setVideoDims({ w: v.videoWidth || 0, h: v.videoHeight || 0 })
    setMetaReady(true)
    const fresh = !metaReadyRef.current
    metaReadyRef.current = true
    v.currentTime = 0
    if (!fresh) return
    if (d > 0) {
      // Default window: the first 3 s (or the whole clip when shorter).
      setTrimStart(0)
      setTrimEnd(Math.min(d, Math.max(MIN_SPAN, Math.min(3, d))))
    }
  }, [])

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (Number.isFinite(v.duration) && v.duration > 0) {
      applyMeta(v)
      return
    }
    // Chrome writes WebM recordings without duration metadata — poke it once:
    // jump to the far end, which forces the browser to resolve the duration.
    const onDurationChange = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        if (durTimerRef.current) {
          window.clearTimeout(durTimerRef.current)
          durTimerRef.current = null
        }
        v.removeEventListener('durationchange', onDurationChange)
        applyMeta(v)
      }
    }
    v.addEventListener('durationchange', onDurationChange)
    if (durTimerRef.current) window.clearTimeout(durTimerRef.current)
    durTimerRef.current = window.setTimeout(() => {
      v.removeEventListener('durationchange', onDurationChange)
      applyMeta(v)
      durTimerRef.current = null
    }, 2500)
    v.currentTime = 1e101
  }, [applyMeta])

  const handleVideoError = useCallback(() => {
    setMetaReady(false)
    toast({
      title: 'Could not read this video',
      description: 'The codec may be unsupported on this device.',
      variant: 'destructive',
    })
  }, [toast])

  /* ---------------- trim sliders (also scrub the preview) ---------------- */

  const onTrimStartChange = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(0, next), Math.max(0, trimEnd - MIN_SPAN))
      setTrimStart(clamped)
      const v = videoRef.current
      if (v && !rendering) {
        v.pause()
        v.currentTime = clamped
      }
    },
    [trimEnd, rendering],
  )

  const onTrimEndChange = useCallback(
    (next: number) => {
      const lower = Math.min(duration, trimStart + MIN_SPAN)
      const clamped = Math.min(Math.max(next, lower), duration || 0)
      setTrimEnd(clamped)
      const v = videoRef.current
      if (v && !rendering) {
        v.pause()
        v.currentTime = clamped
      }
    },
    [duration, trimStart, rendering],
  )

  /* ================================================================== */
  /* Camera — getUserMedia preview + MediaRecorder segment               */
  /* ================================================================== */

  const startCamera = useCallback(
    async (mode: Facing) => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCamError('Camera capture is not supported on this device.')
        return
      }
      stopCameraStream()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        })
        camStreamRef.current = stream
        facingRef.current = mode
        setFacing(mode)
        setCamError(null)
        setCamOn(true)
        const v = camVideoRef.current
        if (v) {
          v.srcObject = stream
          void v.play().catch(() => {
            /* muted preview — autoplay policies should still allow this */
          })
        }
      } catch {
        stopCameraStream()
        setCamOn(false)
        setCamError('Camera unavailable — permission denied or in use by another app.')
      }
    },
    [stopCameraStream],
  )

  /* Auto-start the preview when the Camera tab opens; stop on leave. */
  useEffect(() => {
    if (tab !== 'camera') return
    const t = window.setTimeout(() => {
      void startCamera(facingRef.current)
    }, 80)
    return () => {
      window.clearTimeout(t)
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop()
        } catch {
          /* already stopped */
        }
      }
      recorderRef.current = null
      if (recTimerRef.current) {
        window.clearInterval(recTimerRef.current)
        recTimerRef.current = null
      }
      stopCameraStream()
      queueMicrotask(() => {
        setCamOn(false)
        setRecording(false)
        setRecSecs(0)
      })
    }
  }, [tab, startCamera, stopCameraStream])

  const startRecording = useCallback(() => {
    const stream = camStreamRef.current
    if (!stream || recording) return
    const mime = pickRecorderMime()
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    } catch {
      setCamError('Video recording is not supported in this browser.')
      return
    }
    chunksRef.current = []
    manualStopRef.current = false
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'video/webm'
      const blob = new Blob(chunksRef.current, { type })
      chunksRef.current = []
      if (recTimerRef.current) {
        window.clearInterval(recTimerRef.current)
        recTimerRef.current = null
      }
      setRecording(false)
      setRecSecs(0)
      if (blob.size === 0) {
        toast({
          title: 'Recording empty',
          description: 'Nothing was captured — try again.',
          variant: 'destructive',
        })
        return
      }
      const ext = type.includes('mp4') ? 'mp4' : 'webm'
      loadVideoBlob(blob, `camera-clip-${Date.now().toString(36)}.${ext}`)
      if (manualStopRef.current) {
        manualStopRef.current = false
        haptic()
        toast({ title: 'Clip captured', description: 'Trim the segment you want, then render the GIF.' })
      }
    }
    rec.start()
    recorderRef.current = rec
    setRecording(true)
    setRecSecs(0)
    recTimerRef.current = window.setInterval(() => setRecSecs((s) => s + 1), 1000)
    haptic()
  }, [recording, loadVideoBlob, toast])

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return
    manualStopRef.current = true
    try {
      rec.stop()
    } catch {
      /* already stopped */
    }
  }, [])

  const switchFacing = useCallback(() => {
    void startCamera(facing === 'user' ? 'environment' : 'user')
  }, [facing, startCamera])

  /* ================================================================== */
  /* Render pipeline — video frames → gifenc → Blob                      */
  /* ================================================================== */

  const cancelRender = useCallback(() => {
    abortRenderRef.current = true
  }, [])

  const encodeGif = useCallback(async () => {
    const v = videoRef.current
    if (!v || !metaReady || duration <= 0) {
      toast({ title: 'Video not ready', description: 'Wait for the clip to finish loading.' })
      return
    }
    if (!v.videoWidth) {
      toast({
        title: 'No video track found',
        description: 'This file has no readable picture — try another clip.',
        variant: 'destructive',
      })
      return
    }
    if (span <= 0.05) {
      toast({
        title: 'Selection too short',
        description: 'Drag the end slider to keep at least half a second.',
      })
      return
    }
    if (overCap) {
      toast({
        title: 'Over the frame cap',
        description: `Trim shorter or lower the FPS — max ${MAX_FRAMES} frames.`,
        variant: 'destructive',
      })
      return
    }

    const W = outWidth
    const H = outHeight
    if (W <= 0 || H <= 0) return
    const total = Math.min(MAX_FRAMES, rawFrames)

    v.pause()
    abortRenderRef.current = false
    setRendering({ done: 0, total })
    haptic()

    const canvas = document.createElement('canvas')
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      setRendering(null)
      toast({
        title: 'Canvas unavailable',
        description: 'This browser blocked 2D canvas rendering.',
        variant: 'destructive',
      })
      return
    }

    // Make sure a first frame actually exists before we start seeking.
    if (v.readyState < 2) {
      await new Promise<void>((resolve) => {
        const done = () => {
          v.removeEventListener('loadeddata', done)
          window.clearTimeout(waiter)
          resolve()
        }
        const waiter = window.setTimeout(done, 3000)
        v.addEventListener('loadeddata', done)
      })
    }

    const gif = GIFEncoder()
    const delay = Math.round(1000 / fps)
    const endT = Math.min(trimEnd, Math.max(0, duration))

    try {
      for (let i = 0; i < total; i++) {
        if (abortRenderRef.current) {
          setRendering(null)
          if (mountedRef.current) toast({ title: 'Render cancelled' })
          return
        }
        const t = Math.max(0, Math.min(endT - 0.001, trimStart + i / fps))
        await seekTo(v, t)
        ctx.drawImage(v, 0, 0, W, H)
        const { data } = ctx.getImageData(0, 0, W, H)
        const palette = quantize(data, 256, { format: 'rgb565' })
        const index = applyPalette(data, palette, 'rgb565')
        gif.writeFrame(index, W, H, { palette, delay })
        setRendering({ done: i + 1, total })
        await nextTick() // let the progress bar paint between heavy frames
      }
      if (abortRenderRef.current) {
        setRendering(null)
        if (mountedRef.current) toast({ title: 'Render cancelled' })
        return
      }

      gif.finish()
      // Copy into a plain ArrayBuffer-backed view — TS's BlobPart rejects
      // the generic ArrayBufferLike flavor gifenc returns.
      const bytes = new Uint8Array(gif.bytes())
      const blob = new Blob([bytes], { type: 'image/gif' })
      const name = `gif-maker-${Date.now()}.gif`

      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
      const url = URL.createObjectURL(blob)
      resultUrlRef.current = url

      setResult({ url, name, width: W, height: H, frames: total, sizeBytes: blob.size })
      setRendering(null)
      haptic()
      toast({
        title: 'GIF ready',
        description: `${W}×${H} · ${total} frames · ${fmtBytes(blob.size)}`,
      })

      // Write-through history (blob only when ≤ 6 MB).
      const rec: HistoryRecord = {
        id: `gif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        sourceName: sourceName || 'video',
        fps,
        width: W,
        frames: total,
        sizeBytes: blob.size,
        gifBlob: blob.size <= MAX_SAVED_BLOB ? blob : undefined,
        createdAt: Date.now(),
      }
      setHistory((prev) => [rec, ...prev])
      void idbPut(HISTORY_STORE, rec).catch(() => {
        if (mountedRef.current) {
          toast({ title: 'History unavailable', description: 'This GIF was kept for the session only.' })
        }
      })
    } catch {
      setRendering(null)
      toast({
        title: 'Encode failed',
        description: 'The clip could not be read while rendering — try another video.',
        variant: 'destructive',
      })
    }
  }, [metaReady, duration, span, overCap, rawFrames, outWidth, outHeight, fps, trimStart, trimEnd, sourceName, toast])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-zinc-100">
      <div className="mx-auto max-w-2xl px-4 pb-12 pt-5 sm:px-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            importFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />

        {/* ---------------- identity header ---------------- */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 via-orange-500 to-pink-600 px-4 py-4 text-white shadow-[0_18px_44px_-18px_rgb(249_115_22/0.6)] sm:px-5"
        >
          <div className="flex items-center gap-3.5">
            <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/20 ring-1 ring-white/40 backdrop-blur-sm">
              <ImagePlay className="size-6" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-extrabold tracking-tight">GIF Maker</h1>
              <p className="truncate text-xs text-white/85">
                Video → looping GIF · trim, fps &amp; size · nothing uploaded
              </p>
            </div>
            <Badge
              variant="outline"
              className="hidden shrink-0 border-white/40 bg-white/10 text-[10px] font-bold uppercase tracking-wider text-white sm:inline-flex"
            >
              gifenc
            </Badge>
          </div>
        </motion.div>

        {/* ---------------- tabs ---------------- */}
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as TabId)}
          className="mt-4"
        >
          <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
            <TabsTrigger value="create" className={TRIGGER_CLS} aria-label="Create a GIF">
              <Film className="size-4" aria-hidden />
              Create
            </TabsTrigger>
            <TabsTrigger value="camera" className={TRIGGER_CLS} aria-label="Record a clip with the camera">
              <Camera className="size-4" aria-hidden />
              Camera
            </TabsTrigger>
            <TabsTrigger
              value="history"
              className={TRIGGER_CLS}
              aria-label={`History, ${history.length} saved GIFs`}
            >
              <History className="size-4" aria-hidden />
              History
              {history.length > 0 && (
                <span className="rounded-full bg-amber-400/20 px-1.5 text-[9px] font-bold tabular-nums text-amber-300">
                  {history.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ==================== TAB 1 — CREATE ==================== */}
          <TabsContent value="create" className="mt-4 space-y-4">
            {!videoUrl ? (
              /* ---------- empty state ---------- */
              <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                <span className="flex size-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                  <ImagePlay className="size-8 text-amber-300" strokeWidth={1.6} aria-hidden />
                </span>
                <p className="text-base font-bold tracking-tight">Turn a video into a GIF</p>
                <p className="max-w-xs text-sm text-zinc-400">
                  Pick a clip from your device or record one with the camera. Everything is processed on this
                  phone — zero uploads.
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    className="h-11 rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-pink-600 font-semibold text-white shadow-lg hover:from-amber-300 hover:via-orange-400 hover:to-pink-500"
                  >
                    <Upload className="size-4" aria-hidden /> Choose a video
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setTab('camera')}
                    className="h-11 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white"
                  >
                    <Camera className="size-4" aria-hidden /> Use camera
                  </Button>
                </div>
              </section>
            ) : (
              <>
                {/* ---------- source stage ---------- */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="relative flex items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      preload="auto"
                      playsInline
                      muted
                      onLoadedMetadata={handleLoadedMetadata}
                      onError={handleVideoError}
                      className={cn('max-h-56 w-full object-contain sm:max-h-72', rendering && 'pointer-events-none opacity-80')}
                    />
                    {!metaReady && (
                      <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 text-sm text-zinc-300">
                        <Loader2 className="size-5 animate-spin text-amber-400" aria-hidden /> Loading video…
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
                    <Film className="size-4 shrink-0 text-amber-400" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{sourceName}</span>
                    {metaReady && videoDims && (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-white/15 text-[11px] tabular-nums text-zinc-300"
                      >
                        {fmtTime(duration)} · {videoDims.w}×{videoDims.h}
                      </Badge>
                    )}
                    <button
                      onClick={changeSource}
                      aria-label="Remove this video"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>

                  {metaReady && duration <= 0 && (
                    <p className="mt-3 flex items-center gap-1.5 text-[11px] text-amber-300">
                      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                      This clip reports no duration — try re-importing it.
                    </p>
                  )}
                </section>

                {/* ---------- trim window ---------- */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <Scissors className="size-4 text-amber-400" aria-hidden />
                    <h3 className="text-sm font-bold tracking-tight">Trim window</h3>
                    <Badge
                      variant="outline"
                      className="ml-auto border-white/15 text-[11px] tabular-nums text-zinc-300"
                    >
                      {fmtTime(span)} · ≈{rawFrames} frames
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs">
                        <span className="font-semibold text-zinc-300">Start</span>
                        <span className="font-mono tabular-nums text-amber-300">{fmtTime(trimStart)}</span>
                      </div>
                      <Slider
                        value={[trimStart]}
                        min={0}
                        max={Math.max(0.05, Math.max(0, trimEnd - MIN_SPAN))}
                        step={0.05}
                        disabled={!metaReady || !!rendering || duration <= 0}
                        onValueChange={(v) => onTrimStartChange(v[0] ?? 0)}
                        aria-label="Trim start time"
                        className={SLIDER_CLS}
                      />
                    </div>
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs">
                        <span className="font-semibold text-zinc-300">End</span>
                        <span className="font-mono tabular-nums text-pink-300">{fmtTime(trimEnd)}</span>
                      </div>
                      <Slider
                        value={[trimEnd]}
                        min={Math.min(duration, trimStart + MIN_SPAN)}
                        max={Math.max(Math.min(duration, trimStart + MIN_SPAN), duration, 0.05)}
                        step={0.05}
                        disabled={!metaReady || !!rendering || duration <= 0}
                        onValueChange={(v) => onTrimEndChange(v[0] ?? 0)}
                        aria-label="Trim end time"
                        className={SLIDER_CLS}
                      />
                    </div>
                  </div>
                  <p className="mt-3 text-[11px] text-zinc-500">
                    Keep at least {MIN_SPAN} s — drag the sliders to frame the moment.
                  </p>
                </section>

                {/* ---------- output controls ---------- */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2">
                    <Settings2 className="size-4 text-amber-400" aria-hidden />
                    <h3 className="text-sm font-bold tracking-tight">Output</h3>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Frame rate
                      </p>
                      <Select value={String(fps)} onValueChange={(v) => setFps(Number(v))}>
                        <SelectTrigger className={SELECT_TRIGGER_CLS} aria-label="Frames per second">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className={SELECT_CONTENT_CLS}>
                          {FPS_OPTIONS.map((f) => (
                            <SelectItem key={f} value={String(f)}>
                              {f} fps
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                        Width · height auto
                      </p>
                      <Select value={String(outWidth)} onValueChange={(v) => setOutWidth(Number(v))}>
                        <SelectTrigger className={SELECT_TRIGGER_CLS} aria-label="Output width in pixels">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className={SELECT_CONTENT_CLS}>
                          {WIDTH_OPTIONS.map((w) => (
                            <SelectItem key={w} value={String(w)}>
                              {w} px
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className="border-white/15 text-[11px] tabular-nums text-zinc-300"
                    >
                      {outWidth}×{outHeight || '–'}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-white/15 text-[11px] tabular-nums text-zinc-300"
                    >
                      {fps} fps
                    </Badge>
                    <Badge
                      variant="outline"
                      className="border-white/15 text-[11px] tabular-nums text-zinc-300"
                    >
                      cap {MAX_FRAMES} frames
                    </Badge>
                    {nearCap && (
                      <Badge className="border-0 bg-amber-400/15 text-[11px] font-semibold text-amber-300">
                        <AlertTriangle className="size-3" aria-hidden /> close to cap
                      </Badge>
                    )}
                    {overCap && (
                      <Badge className="border-0 bg-rose-500/15 text-[11px] font-semibold text-rose-300">
                        <AlertTriangle className="size-3" aria-hidden /> over the {MAX_FRAMES}-frame cap
                      </Badge>
                    )}
                  </div>
                </section>

                {/* ---------- render / progress ---------- */}
                {rendering ? (
                  <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="size-4 shrink-0 animate-spin text-amber-400" aria-hidden />
                      <span className="min-w-0 flex-1 font-semibold">
                        Encoding frame {rendering.done} / {rendering.total}
                      </span>
                      <Button
                        variant="outline"
                        onClick={cancelRender}
                        className="h-9 shrink-0 gap-1.5 rounded-full border-rose-400/40 px-3 text-xs font-semibold text-rose-200 hover:bg-rose-500/20"
                      >
                        <X className="size-3.5" aria-hidden /> Cancel
                      </Button>
                    </div>
                    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 transition-[width] duration-150"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-2 text-[11px] tabular-nums text-zinc-500">
                      {pct}% · quantizing every frame to a 256-colour palette
                    </p>
                  </section>
                ) : (
                  <div>
                    <Button
                      onClick={() => void encodeGif()}
                      disabled={!metaReady || duration <= 0 || overCap || span <= 0.05}
                      className="h-12 w-full rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-pink-600 text-base font-bold text-white shadow-[0_14px_32px_-12px_rgb(249_115_22/0.6)] transition hover:from-amber-300 hover:via-orange-400 hover:to-pink-500 disabled:opacity-40"
                    >
                      <ImagePlay className="size-5" aria-hidden /> Render GIF
                    </Button>
                    {overCap && (
                      <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-rose-300">
                        <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                        Trim shorter or lower the FPS to stay under {MAX_FRAMES} frames.
                      </p>
                    )}
                  </div>
                )}

                {/* ---------- result card ---------- */}
                <AnimatePresence>
                  {result && (
                    <motion.section
                      key="result"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                      className="rounded-2xl border border-amber-400/30 bg-white/5 p-4"
                    >
                      <div className="flex items-center gap-2">
                        <ImagePlay className="size-4 shrink-0 text-amber-400" aria-hidden />
                        <h3 className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight">
                          Your GIF is ready
                        </h3>
                        <button
                          onClick={() => setResult(null)}
                          aria-label="Dismiss result"
                          className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      </div>

                      <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-2">
                        <img
                          src={result.url}
                          alt={`Generated GIF preview — ${result.width}×${result.height}, ${result.frames} frames`}
                          className="mx-auto max-h-72 w-auto max-w-full rounded-lg"
                        />
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2 text-center">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Size</p>
                          <p className="text-[13px] font-bold tabular-nums text-zinc-100">
                            {result.width}×{result.height}
                          </p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2 text-center">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Frames</p>
                          <p className="text-[13px] font-bold tabular-nums text-zinc-100">{result.frames}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-2 text-center">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">File</p>
                          <p className="text-[13px] font-bold tabular-nums text-zinc-100">
                            {fmtBytes(result.sizeBytes)}
                          </p>
                        </div>
                      </div>

                      <a
                        href={result.url}
                        download={result.name}
                        onClick={haptic}
                        className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 font-semibold text-zinc-950 shadow-lg transition hover:from-emerald-300 hover:to-teal-400"
                      >
                        <Download className="size-4" aria-hidden /> Download GIF
                      </a>
                      <p className="mt-2 truncate text-center text-[11px] text-zinc-500">{result.name}</p>
                    </motion.section>
                  )}
                </AnimatePresence>
              </>
            )}

            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-zinc-500">
              <Info className="size-3.5 shrink-0" aria-hidden />
              Frames are decoded and encoded on this device — nothing is uploaded.
            </p>
          </TabsContent>

          {/* ==================== TAB 2 — CAMERA ==================== */}
          <TabsContent value="camera" className="mt-4 space-y-4">
            <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-white/10 bg-black sm:aspect-video">
                <video
                  ref={camVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className={cn('size-full object-cover', !camOn && 'opacity-0')}
                />
                {!camOn && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
                    {camError ? (
                      <>
                        <AlertTriangle className="size-8 text-rose-300" strokeWidth={1.6} aria-hidden />
                        <p className="max-w-xs text-sm text-zinc-300">{camError}</p>
                        <Button
                          variant="outline"
                          onClick={() => void startCamera(facingRef.current)}
                          className="h-11 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white"
                        >
                          <Camera className="size-4" aria-hidden /> Try again
                        </Button>
                      </>
                    ) : (
                      <>
                        <Loader2 className="size-7 animate-spin text-amber-400" aria-hidden />
                        <p className="text-sm text-zinc-300">Starting camera…</p>
                      </>
                    )}
                  </div>
                )}
                {recording && (
                  <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 backdrop-blur-sm">
                    <span className="size-2 animate-pulse rounded-full bg-rose-500" aria-hidden />
                    <span className="text-xs font-bold tabular-nums text-white">{fmtTime(recSecs)}</span>
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={switchFacing}
                  disabled={!camOn || recording}
                  aria-label="Switch between front and back camera"
                  className="h-11 shrink-0 gap-1.5 rounded-xl border-white/15 bg-white/5 px-3 text-xs font-semibold text-zinc-200 hover:bg-white/10"
                >
                  <SwitchCamera className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{facing === 'user' ? 'Front' : 'Back'}</span>
                </Button>
                <Button
                  onClick={recording ? stopRecording : startRecording}
                  disabled={!camOn}
                  className={cn(
                    'h-11 flex-1 rounded-xl font-semibold text-white shadow-lg disabled:opacity-40',
                    recording
                      ? 'bg-rose-600 hover:bg-rose-500'
                      : 'bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-400 hover:to-red-500',
                  )}
                >
                  {recording ? (
                    <>
                      <Square className="size-4" aria-hidden /> Stop · {fmtTime(recSecs)}
                    </>
                  ) : (
                    <>
                      <span className="size-3 rounded-full bg-white" aria-hidden /> Record clip
                    </>
                  )}
                </Button>
              </div>

              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-zinc-500">
                <Info className="size-3.5 mt-0.5 shrink-0" aria-hidden />
                Record a short clip — it lands in Create ready for trimming. Nothing leaves the device.
              </p>
            </section>
          </TabsContent>

          {/* ==================== TAB 3 — HISTORY ==================== */}
          <TabsContent value="history" className="mt-4 space-y-4">
            <AnimatePresence mode="wait">
              {previewRec && (
                <motion.section
                  key={previewRec.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 26 }}
                  className="rounded-2xl border border-amber-400/30 bg-white/5 p-4"
                >
                  <div className="flex items-center gap-2">
                    <ImagePlay className="size-4 shrink-0 text-amber-400" aria-hidden />
                    <h3 className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight">
                      {previewRec.sourceName}
                    </h3>
                    <button
                      onClick={() => setPreviewId(null)}
                      aria-label="Close preview"
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>

                  {previewRec.gifBlob ? (
                    <div className="mt-3 rounded-xl border border-white/10 bg-black/40 p-2">
                      <GifImage
                        key={previewRec.id}
                        blob={previewRec.gifBlob}
                        alt={`Saved GIF from ${previewRec.sourceName}`}
                        className="mx-auto max-h-72 w-auto max-w-full rounded-lg"
                      />
                    </div>
                  ) : (
                    <p className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center text-xs text-zinc-400">
                      GIF data wasn&apos;t stored for this entry (over the {fmtBytes(MAX_SAVED_BLOB)} history
                      limit) — only its stats remain.
                    </p>
                  )}

                  <div className="mt-3 grid grid-cols-4 gap-2">
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-1.5 py-2 text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Width</p>
                      <p className="text-[13px] font-bold tabular-nums text-zinc-100">{previewRec.width}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-1.5 py-2 text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">FPS</p>
                      <p className="text-[13px] font-bold tabular-nums text-zinc-100">{previewRec.fps}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-1.5 py-2 text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Frames</p>
                      <p className="text-[13px] font-bold tabular-nums text-zinc-100">{previewRec.frames}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-1.5 py-2 text-center">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">File</p>
                      <p className="text-[13px] font-bold tabular-nums text-zinc-100">
                        {fmtBytes(previewRec.sizeBytes)}
                      </p>
                    </div>
                  </div>

                  {previewRec.gifBlob && (
                    <GifDownloadLink
                      blob={previewRec.gifBlob}
                      name={`gif-maker-${previewRec.createdAt}.gif`}
                      className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 font-semibold text-zinc-950 shadow-lg transition hover:from-emerald-300 hover:to-teal-400"
                    >
                      <Download className="size-4" aria-hidden /> Download again
                    </GifDownloadLink>
                  )}
                </motion.section>
              )}
            </AnimatePresence>

            <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex items-center gap-2">
                <History className="size-4 shrink-0 text-amber-400" aria-hidden />
                <h3 className="text-sm font-bold tracking-tight">Saved GIFs</h3>
                <Badge
                  variant="outline"
                  className="border-white/15 text-[11px] tabular-nums text-zinc-300"
                >
                  {history.length}
                </Badge>
                {history.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => (confirmClear ? clearHistory() : armClear())}
                    className={cn(
                      'ml-auto h-8 shrink-0 gap-1 rounded-full border-white/15 bg-white/5 px-3 text-xs font-semibold text-zinc-300 hover:bg-white/10',
                      confirmClear && 'border-rose-400/50 bg-rose-500/20 text-rose-200 hover:bg-rose-500/25',
                    )}
                  >
                    {confirmClear ? (
                      <Check className="size-3.5" aria-hidden />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden />
                    )}
                    {confirmClear ? 'Tap to confirm' : 'Clear all'}
                  </Button>
                )}
              </div>

              {!historyLoaded ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
                  <Loader2 className="size-4 animate-spin text-amber-400" aria-hidden /> Loading history…
                </div>
              ) : history.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center text-xs text-zinc-400">
                  No GIFs yet — render one in Create and it will be saved here (GIF data kept when ≤{' '}
                  {fmtBytes(MAX_SAVED_BLOB)}).
                </p>
              ) : (
                <div className={cn('max-h-96 space-y-2 overflow-y-auto pr-1', THIN_SCROLLBAR)}>
                  {history.map((rec) => {
                    const confirming = confirmDeleteId === rec.id
                    const active = previewId === rec.id
                    return (
                      <motion.div
                        key={rec.id}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={cn(
                          'flex items-center gap-2.5 rounded-xl border p-2',
                          active
                            ? 'border-amber-400/50 bg-amber-400/[0.06]'
                            : 'border-white/10 bg-white/[0.03]',
                        )}
                      >
                        <button
                          onClick={() => setPreviewId(active ? null : rec.id)}
                          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                          aria-label={`Preview GIF from ${rec.sourceName}`}
                        >
                          <span className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
                            {rec.gifBlob ? (
                              <GifImage
                                key={rec.id}
                                blob={rec.gifBlob}
                                alt=""
                                className="size-full object-cover"
                              />
                            ) : (
                              <ImagePlay className="size-5 text-zinc-600" aria-hidden />
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-zinc-100">
                              {rec.sourceName}
                            </span>
                            <span className="block truncate text-[11px] tabular-nums text-zinc-400">
                              {rec.width}p · {rec.fps} fps · {rec.frames} frames · {fmtBytes(rec.sizeBytes)}
                            </span>
                            <span className="block truncate text-[10px] text-zinc-500">
                              {new Date(rec.createdAt).toLocaleString()}
                            </span>
                          </span>
                        </button>
                        <button
                          onClick={() => (confirming ? removeHistory(rec.id) : armDelete(rec.id))}
                          aria-label={confirming ? `Confirm delete ${rec.sourceName}` : `Delete ${rec.sourceName}`}
                          className={cn(
                            'flex size-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors',
                            confirming
                              ? 'bg-rose-500/90 text-white'
                              : 'bg-white/5 hover:bg-rose-500/20 hover:text-rose-300',
                          )}
                        >
                          {confirming ? (
                            <Check className="size-4" aria-hidden />
                          ) : (
                            <Trash2 className="size-4" aria-hidden />
                          )}
                        </button>
                      </motion.div>
                    )
                  })}
                </div>
              )}

              <p className="mt-3 flex items-start gap-1.5 text-[11px] text-zinc-500">
                <Info className="size-3.5 mt-0.5 shrink-0" aria-hidden />
                History lives in this browser&apos;s storage (toolhub-gifmaker). GIFs larger than{' '}
                {fmtBytes(MAX_SAVED_BLOB)} keep their stats only.
              </p>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
