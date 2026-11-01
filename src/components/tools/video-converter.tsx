'use client'

/**
 * Video Converter & Compressor — shrink & convert, zero upload.
 *
 * Real client-side transcode with zero dependencies: a hidden <video> decodes
 * the source, every frame is repainted onto a hidden <canvas> at the target
 * resolution (never upscaling), and canvas.captureStream(30) — with audio
 * piped through an AudioContext MediaElementSource → MediaStreamDestination
 * (never ctx.destination, so local playback stays silent) — feeds a
 * MediaRecorder at the chosen videoBitsPerSecond. Playback runs at rate 1 and
 * recording stops on 'ended', so the encode is real-time.
 *
 * Output is a .webm (VP9/VP8 + Opus where the browser allows) — MP4 is NOT
 * guaranteed in-browser. Video blobs are never persisted: only conversion
 * metadata goes to IndexedDB ('toolhub-videoconv' v1, store 'history').
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BadgeCheck,
  CircleAlert,
  Clapperboard,
  Download,
  FileVideo,
  Film,
  Gauge,
  History,
  Info,
  Loader2,
  MonitorPlay,
  Play,
  RotateCcw,
  Shrink,
  Square,
  Timer,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type ResKey = 'original' | '1080' | '720' | '480' | '360'
type BitrateKey = 'auto' | 'high' | 'standard' | 'compact' | 'tiny'

interface SourceFile {
  name: string
  size: number
  type: string
}

interface SrcMeta {
  duration: number
  width: number
  height: number
}

interface CodecChoice {
  mime: string
  label: string
}

interface ProgressInfo {
  pct: number
  elapsedMs: number
  outBytes: number
}

interface ResultInfo {
  url: string
  blob: Blob
  fileName: string
  srcSize: number
  outSize: number
  savedPct: number
  codec: string
  partial: boolean
  dims: string
  presetLabel: string
  bitrateLabel: string
  elapsedMs: number
}

/** Metadata only — a video blob is NEVER written here. */
interface HistoryRow {
  id: string
  sourceName: string
  preset: string
  bitrate: string
  srcSize: number
  outSize: number
  savedPct: number
  codec: string
  createdAt: number
}

const RES_PRESETS: { key: ResKey; label: string }[] = [
  { key: 'original', label: 'Original' },
  { key: '1080', label: '1080p' },
  { key: '720', label: '720p' },
  { key: '480', label: '480p' },
  { key: '360', label: '360p' },
]

const RES_HEIGHTS: Record<ResKey, number> = {
  original: 0,
  '1080': 1080,
  '720': 720,
  '480': 480,
  '360': 360,
}

const BITRATE_PRESETS: { key: BitrateKey; name: string; bps: number }[] = [
  { key: 'auto', name: 'Auto', bps: 0 },
  { key: 'high', name: 'High', bps: 8_000_000 },
  { key: 'standard', name: 'Standard', bps: 4_000_000 },
  { key: 'compact', name: 'Compact', bps: 2_500_000 },
  { key: 'tiny', name: 'Tiny', bps: 1_200_000 },
]

const AUDIO_BPS = 128_000
/** Above this duration (5 min) we warn: the encode runs in real time. */
const LONG_VIDEO_SECS = 300

const MIME_CANDIDATES: CodecChoice[] = [
  { mime: 'video/webm;codecs=vp9,opus', label: 'VP9 + Opus' },
  { mime: 'video/webm;codecs=vp8,opus', label: 'VP8 + Opus' },
  { mime: 'video/webm;codecs=vp9', label: 'VP9' },
  { mime: 'video/webm;codecs=vp8', label: 'VP8' },
  { mime: 'video/webm', label: 'WebM' },
]

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function haptic() {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function newId(): string {
  return `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'video'
  )
}

function evenize(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2)
}

/** Target canvas size — keeps aspect ratio and never upscales the source. */
function targetDims(key: ResKey, meta: SrcMeta): { w: number; h: number } {
  const srcH = meta.height > 0 ? meta.height : 720
  const srcW = meta.width > 0 ? meta.width : Math.round((srcH * 16) / 9)
  const want = RES_HEIGHTS[key] ?? 0
  const targetH = want === 0 ? srcH : Math.min(want, srcH)
  const scale = targetH / srcH
  return { w: evenize(srcW * scale), h: evenize(targetH) }
}

function resLabelFor(key: ResKey, meta: SrcMeta): string {
  if (key === 'original') return 'Original'
  return `${targetDims(key, meta).h}p`
}

/** Auto bitrate heuristic from the effective output height. */
function autoBitrateFor(h: number): number {
  if (h >= 1000) return 6_000_000
  if (h >= 700) return 3_500_000
  if (h >= 450) return 1_800_000
  if (h >= 300) return 1_000_000
  return 600_000
}

function fmtMbps(bps: number): string {
  const mbps = bps / 1_000_000
  return `${Number.isInteger(mbps) ? mbps : mbps.toFixed(1)} Mbps`
}

function bitrateLabel(key: BitrateKey, effBps: number): string {
  if (key === 'auto') return `Auto · ${fmtMbps(effBps)}`
  const p = BITRATE_PRESETS.find((b) => b.key === key)
  return p ? `${p.name} · ${fmtMbps(p.bps)}` : fmtMbps(effBps)
}

function negotiateRecorderMime(): CodecChoice | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const c of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return c
    } catch {
      /* keep looking */
    }
  }
  return null
}

function fmtTime(s: number): string {
  const safe = Math.max(0, Math.floor(s))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const sec = safe % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return `${m}:${String(sec).padStart(2, '0')}`
}

function fmtBytes(n: number): string {
  if (!isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4_000)
}

/* ================================================================== */
/* IndexedDB — 'toolhub-videoconv' v1 · metadata only                  */
/* ================================================================== */

const DB_NAME = 'toolhub-videoconv'
const DB_VERSION = 1
const HISTORY_STORE = 'history'

let dbPromise: Promise<IDBDatabase> | null = null

function openVideoConvDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(HISTORY_STORE)) {
        d.createObjectStore(HISTORY_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openVideoConvDb()
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
/* Small presentational helpers                                        */
/* ================================================================== */

function SectionLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
      <span className="text-emerald-400/80 [&>svg]:size-3.5">{icon}</span>
      {children}
    </p>
  )
}

function PresetChip({
  selected,
  disabled,
  onClick,
  children,
}: {
  selected: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'flex h-11 min-w-0 items-center justify-center rounded-xl border px-2 text-xs font-semibold transition-all',
        selected
          ? 'border-teal-400/60 bg-teal-500/15 text-teal-200 shadow-[0_0_0_1px_rgb(45_212_191/0.2)]'
          : 'border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-zinc-200',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <span className="truncate">{children}</span>
    </button>
  )
}

function HistoryRowItem({ row, onRemove }: { row: HistoryRow; onRemove: () => void }) {
  const smaller = row.savedPct > 0
  const larger = row.savedPct < 0
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      className="flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] p-3"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-200">{row.sourceName}</p>
        <p className="mt-0.5 truncate text-[11px] tabular-nums text-zinc-500">
          {fmtDate(row.createdAt)} · {row.codec}
        </p>
        <p className="mt-1 flex flex-wrap gap-1">
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
            {row.preset}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
            {row.bitrate}
          </span>
        </p>
        <p className="mt-1 text-[11px] tabular-nums text-zinc-400">
          {fmtBytes(row.srcSize)} → {fmtBytes(row.outSize)}{' '}
          <span
            className={cn(
              'font-semibold',
              smaller ? 'text-emerald-400' : larger ? 'text-rose-400' : 'text-zinc-500',
            )}
          >
            {smaller
              ? `${row.savedPct}% smaller`
              : larger
                ? `${-row.savedPct}% larger`
                : 'same size'}
          </span>
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${row.sourceName} from history`}
        className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-500 transition-colors hover:border-rose-400/40 hover:text-rose-300"
      >
        <X className="size-4" aria-hidden />
      </button>
    </motion.div>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function VideoConverterApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [tab, setTab] = useState<'convert' | 'history'>('convert')
  const [file, setFile] = useState<SourceFile | null>(null)
  const [srcMeta, setSrcMeta] = useState<SrcMeta | null>(null)
  const [resKey, setResKey] = useState<ResKey>('720')
  const [brKey, setBrKey] = useState<BitrateKey>('auto')
  const [muteAudio, setMuteAudio] = useState(false)
  const [codec, setCodec] = useState<CodecChoice | null>(null)
  const [converting, setConverting] = useState(false)
  const [progress, setProgress] = useState<ProgressInfo>({ pct: 0, elapsedMs: 0, outBytes: 0 })
  const [result, setResult] = useState<ResultInfo | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [armedClear, setArmedClear] = useState(false)

  /* ---------------- refs (media + timers + urls) ---------------- */
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  const resultUrlRef = useRef<string | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const bytesRef = useRef(0)
  const rafRef = useRef(0)
  const endTimerRef = useRef(0)
  const startedAtRef = useRef(0)
  const lastUiRef = useRef(0)
  const convertingRef = useRef(false)
  const cancelledRef = useRef(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const srcNodeRef = useRef<MediaElementAudioSourceNode | null>(null)

  /* ---------------- derived settings ---------------- */
  const effDims = useMemo(
    () => (srcMeta ? targetDims(resKey, srcMeta) : null),
    [resKey, srcMeta],
  )

  const chosenBps = useMemo(() => {
    if (brKey === 'auto') return autoBitrateFor(effDims?.h ?? 720)
    return BITRATE_PRESETS.find((b) => b.key === brKey)?.bps ?? 4_000_000
  }, [brKey, effDims])

  const estOutBytes = useMemo(() => {
    if (!srcMeta || srcMeta.duration <= 0) return 0
    return Math.round(((chosenBps + (muteAudio ? 0 : AUDIO_BPS)) * srcMeta.duration) / 8)
  }, [srcMeta, chosenBps, muteAudio])

  const clampNote = useMemo(() => {
    if (!srcMeta || !effDims) return null
    const preset = RES_PRESETS.find((r) => r.key === resKey)
    const want = RES_HEIGHTS[resKey] ?? 0
    if (!preset || want === 0 || want <= srcMeta.height) return null
    return `${preset.label} would upscale — clamped to your source height (${effDims.h}p).`
  }, [srcMeta, effDims, resKey])

  const canStart = Boolean(file && srcMeta && codec && effDims && srcMeta.duration > 0) && !converting

  /* ---------------- effects: hydrate + codec + unmount ---------------- */

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rows = await idbGetAll<HistoryRow>(HISTORY_STORE)
        if (!alive) return
        rows.sort((a, b) => b.createdAt - a.createdAt)
        setHistory(rows)
      } catch {
        /* first run or blocked DB — history just stays empty */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    queueMicrotask(() => {
      if (!alive) return
      setCodec(negotiateRecorderMime())
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    return () => {
      convertingRef.current = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (endTimerRef.current) window.clearTimeout(endTimerRef.current)
      try {
        if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop()
      } catch {
        /* recorder already idle */
      }
      try {
        srcNodeRef.current?.disconnect()
      } catch {
        /* never created */
      }
      void audioCtxRef.current?.close().catch(() => {
        /* already closed */
      })
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    }
  }, [])

  /* ---------------- audio context (created lazily, reused across runs) ---------------- */

  const ensureAudioCtx = useCallback((): AudioContext => {
    if (!audioCtxRef.current) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) throw new Error('Web Audio not supported')
      audioCtxRef.current = new Ctor()
    }
    return audioCtxRef.current
  }, [])

  /* ---------------- session reset ---------------- */

  const resetSession = useCallback(() => {
    convertingRef.current = false
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    if (endTimerRef.current) {
      window.clearTimeout(endTimerRef.current)
      endTimerRef.current = 0
    }
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop()
    } catch {
      /* recorder already idle */
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    setFile(null)
    setSrcMeta(null)
    setResult(null)
    setArmedClear(false)
    setProgress({ pct: 0, elapsedMs: 0, outBytes: 0 })
    const v = videoRef.current
    if (v) {
      v.pause()
      v.removeAttribute('src')
      v.load()
    }
  }, [])

  /* ---------------- file pick + hidden-video events ---------------- */

  const onFilePicked = useCallback(
    (files: FileList | null) => {
      const f = files?.[0]
      if (!f) return
      if (convertingRef.current) return
      if (!f.type.startsWith('video/') && !/\.(mp4|webm|mov|mkv|m4v|avi|ogv|3gp)$/i.test(f.name)) {
        toast({ title: 'Not a video file', description: 'Pick a video from your gallery or files.', variant: 'destructive' })
        return
      }
      resetSession()
      const url = URL.createObjectURL(f)
      objectUrlRef.current = url
      setFile({ name: f.name, size: f.size, type: f.type })
      setSrcMeta(null)
      const v = videoRef.current
      if (v) {
        v.src = url
        v.load()
      }
      if (!codec) {
        toast({
          title: 'Recording not supported',
          description: 'This browser cannot record WebM video — conversion is disabled here.',
          variant: 'destructive',
        })
      }
      haptic()
    },
    [codec, resetSession, toast],
  )

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const dur = isFinite(v.duration) ? v.duration : 0
    setSrcMeta({ duration: dur, width: v.videoWidth, height: v.videoHeight })
    if (dur <= 0 || v.videoWidth === 0) {
      toast({
        title: 'Metadata looks odd',
        description: 'Duration or dimensions could not be read — conversion may fail.',
        variant: 'destructive',
      })
    }
  }, [toast])

  const handleVideoError = useCallback(() => {
    if (convertingRef.current) {
      cancelledRef.current = true
      try {
        recRef.current?.stop()
      } catch {
        /* already stopped */
      }
      toast({
        title: 'Decode error',
        description: 'The video could not be fully read — kept what was recorded so far.',
        variant: 'destructive',
      })
      return
    }
    if (file) {
      toast({
        title: 'Could not read this video',
        description: 'The format or codec may not be supported by your browser.',
        variant: 'destructive',
      })
    }
  }, [file, toast])

  const handleEnded = useCallback(() => {
    if (!convertingRef.current) return
    const dur = srcMeta?.duration ?? 0
    if (dur > 0) setProgress((p) => ({ ...p, pct: 100 }))
    if (endTimerRef.current) window.clearTimeout(endTimerRef.current)
    endTimerRef.current = window.setTimeout(() => {
      endTimerRef.current = 0
      try {
        recRef.current?.stop()
      } catch {
        /* already stopped */
      }
    }, 280) // small tail so the last frame + audio land in the blob
  }, [srcMeta])

  /* ---------------- the real-time transcode ---------------- */

  const startConversion = useCallback(async () => {
    const v = videoRef.current
    const c = canvasRef.current
    const srcFile = file
    const meta = srcMeta
    const choice = codec
    const dims = effDims
    if (!v || !c || !srcFile || !meta || !choice || !dims) return
    if (convertingRef.current) return
    if (meta.duration <= 0 || !isFinite(meta.duration)) {
      toast({ title: 'Duration unreadable', description: 'This file cannot be timed — conversion aborted.', variant: 'destructive' })
      return
    }

    const c2d = c.getContext('2d', { alpha: false })
    if (!c2d) {
      toast({ title: 'Canvas unavailable', description: 'Frame capture is not possible in this browser.', variant: 'destructive' })
      return
    }
    c.width = dims.w
    c.height = dims.h
    try {
      c2d.drawImage(v, 0, 0, dims.w, dims.h) // first frame, so the blob never starts blank
    } catch {
      /* frame not decoded yet — the tick loop will paint it */
    }

    cancelledRef.current = false
    convertingRef.current = true
    chunksRef.current = []
    bytesRef.current = 0
    startedAtRef.current = performance.now()
    lastUiRef.current = 0
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    setResult(null)

    /* --- audio graph: MediaElementSource → MediaStreamDestination (NOT ctx.destination) --- */
    let audioNode: MediaElementAudioSourceNode | null = null
    let audioTracks: MediaStreamTrack[] = []
    v.muted = muteAudio
    if (!muteAudio) {
      try {
        const ctx = ensureAudioCtx()
        try {
          await ctx.resume()
        } catch {
          /* resume refused — recording may still work */
        }
        let node = srcNodeRef.current
        if (!node) {
          node = ctx.createMediaElementSource(v) // throws on some audio-less files
          srcNodeRef.current = node
        }
        try {
          node.disconnect()
        } catch {
          /* not connected yet */
        }
        const dest = ctx.createMediaStreamDestination()
        node.connect(dest)
        audioNode = node
        audioTracks = dest.stream.getAudioTracks()
      } catch {
        v.muted = true
        audioTracks = []
        toast({
          title: 'Audio track unavailable',
          description: 'The audio could not be tapped — recording video only.',
        })
      }
    }

    /* --- recorder --- */
    const canvasStream = c.captureStream(30)
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(stream, {
        mimeType: choice.mime,
        videoBitsPerSecond: chosenBps,
        audioBitsPerSecond: AUDIO_BPS,
      })
    } catch {
      canvasStream.getTracks().forEach((t) => t.stop())
      audioTracks.forEach((t) => t.stop())
      convertingRef.current = false
      toast({
        title: 'Recorder failed to start',
        description: 'This browser rejected the WebM recording setup.',
        variant: 'destructive',
      })
      return
    }
    recRef.current = rec

    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data)
        bytesRef.current += e.data.size
      }
    }

    rec.onstop = () => {
      convertingRef.current = false
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      if (endTimerRef.current) {
        window.clearTimeout(endTimerRef.current)
        endTimerRef.current = 0
      }
      canvasStream.getTracks().forEach((t) => t.stop())
      audioTracks.forEach((t) => t.stop())
      if (audioNode) {
        try {
          audioNode.disconnect()
        } catch {
          /* already disconnected */
        }
      }
      try {
        v.pause()
      } catch {
        /* already paused */
      }

      const partial = cancelledRef.current
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      if (blob.size <= 0) {
        setConverting(false)
        toast({
          title: 'Nothing was recorded',
          description: 'The conversion produced no data — try a lower resolution or another file.',
          variant: 'destructive',
        })
        return
      }

      const url = URL.createObjectURL(blob)
      resultUrlRef.current = url
      const srcSize = srcFile.size
      const outSize = blob.size
      const savedPct = srcSize > 0 ? Math.round((1 - outSize / srcSize) * 100) : 0
      const presetLabel = resLabelFor(resKey, meta)
      const bLabel = bitrateLabel(brKey, chosenBps)
      const fileName = partial
        ? `partial-${Date.now()}.webm`
        : `${slug(srcFile.name)}-${presetLabel.toLowerCase()}.webm`

      setResult({
        url,
        blob,
        fileName,
        srcSize,
        outSize,
        savedPct,
        codec: choice.label,
        partial,
        dims: `${dims.w}×${dims.h}`,
        presetLabel,
        bitrateLabel: bLabel,
        elapsedMs: performance.now() - startedAtRef.current,
      })
      setConverting(false)

      if (!partial) {
        const row: HistoryRow = {
          id: newId(),
          sourceName: srcFile.name,
          preset: presetLabel,
          bitrate: bLabel,
          srcSize,
          outSize,
          savedPct,
          codec: choice.label,
          createdAt: Date.now(),
        }
        setHistory((rows) => [row, ...rows])
        void idbPut(HISTORY_STORE, row).catch(() => {
          toast({ title: 'Could not save to history', variant: 'destructive' })
        })
        haptic()
        toast({
          title: 'Conversion complete',
          description: `${fmtBytes(outSize)} · ${
            savedPct > 0 ? `${savedPct}% smaller` : savedPct < 0 ? `${-savedPct}% larger` : 'same size'
          } · ${choice.label}`,
        })
      } else {
        haptic()
        toast({ title: 'Cancelled — partial kept', description: 'You can still download what was recorded.' })
      }
    }

    setProgress({ pct: 0, elapsedMs: 0, outBytes: 0 })
    setConverting(true)
    v.currentTime = 0
    v.playbackRate = 1 // real-time encode
    rec.start(500)
    try {
      await v.play()
    } catch {
      cancelledRef.current = true
      try {
        rec.stop()
      } catch {
        /* never started */
      }
      toast({
        title: 'Playback failed',
        description: 'The video could not be played back for re-encoding.',
        variant: 'destructive',
      })
      return
    }

    /* --- paint loop: frames to canvas + throttled progress updates --- */
    const tick = () => {
      if (!convertingRef.current) return
      try {
        c2d.drawImage(v, 0, 0, dims.w, dims.h)
      } catch {
        /* frame not ready — skip */
      }
      const now = performance.now()
      if (now - lastUiRef.current >= 220) {
        lastUiRef.current = now
        const pct = meta.duration > 0 ? clamp((v.currentTime / meta.duration) * 100, 0, 100) : 0
        setProgress({ pct, elapsedMs: now - startedAtRef.current, outBytes: bytesRef.current })
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [brKey, chosenBps, codec, effDims, ensureAudioCtx, file, muteAudio, resKey, srcMeta, toast])

  const cancelConversion = useCallback(() => {
    if (!convertingRef.current) return
    cancelledRef.current = true
    try {
      videoRef.current?.pause()
    } catch {
      /* already paused */
    }
    try {
      recRef.current?.stop()
    } catch {
      /* already stopped */
    }
    haptic()
  }, [])

  /* ---------------- result + history actions ---------------- */

  const downloadResult = useCallback(() => {
    if (!result) return
    downloadBlob(result.blob, result.fileName)
    haptic()
    toast({
      title: result.partial ? 'Partial file saved' : 'Download started',
      description: result.fileName,
    })
  }, [result, toast])

  const removeRow = useCallback(
    (id: string) => {
      setHistory((rows) => rows.filter((r) => r.id !== id))
      void idbDelete(HISTORY_STORE, id).catch(() => {
        toast({ title: 'Could not delete entry', variant: 'destructive' })
      })
      haptic()
    },
    [toast],
  )

  const clearHistory = useCallback(() => {
    if (!armedClear) {
      setArmedClear(true)
      window.setTimeout(() => setArmedClear(false), 3_000)
      return
    }
    setArmedClear(false)
    setHistory([])
    void idbClear(HISTORY_STORE)
      .then(() => {
        toast({ title: 'History cleared', description: 'Only metadata was stored — now removed.' })
      })
      .catch(() => {
        toast({ title: 'Could not clear history', variant: 'destructive' })
      })
    haptic()
  }, [armedClear, toast])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-zinc-100">
      <div className="mx-auto w-full max-w-2xl px-4 pb-10 pt-5">
        {/* ---------------- Identity header ---------------- */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="overflow-hidden rounded-2xl bg-gradient-to-br from-teal-400 via-emerald-500 to-green-600 p-5 shadow-[0_18px_44px_-18px_rgb(16_185_129/0.55)]"
        >
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 text-white ring-1 ring-white/40">
              <FileVideo className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-bold tracking-tight text-white">Video Converter</h2>
              <p className="truncate text-xs text-emerald-50/90">Shrink &amp; convert, zero upload</p>
            </div>
          </div>
        </motion.div>

        <div className="mt-3 flex items-center gap-2 px-1 text-[11px] text-zinc-500">
          <Info className="size-3.5 shrink-0 text-emerald-400/80" aria-hidden />
          <span>Decoded, repainted and re-encoded on-device — nothing is uploaded, ever.</span>
        </div>

        {/* ---------------- Tabs ---------------- */}
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-white/5 p-1">
          {(['convert', 'history'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t)
                haptic()
              }}
              aria-pressed={tab === t}
              className={cn(
                'flex h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all',
                tab === t
                  ? 'bg-gradient-to-r from-teal-400 via-emerald-500 to-green-600 text-white shadow-lg'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              {t === 'convert' ? (
                <Clapperboard className="size-4" aria-hidden />
              ) : (
                <History className="size-4" aria-hidden />
              )}
              {t === 'convert' ? 'Convert' : 'History'}
            </button>
          ))}
        </div>

        {/* always-mounted picker + hidden media elements */}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={(e) => {
            onFilePicked(e.target.files)
            e.target.value = ''
          }}
        />
        <video
          ref={videoRef}
          playsInline
          preload="metadata"
          className="pointer-events-none fixed left-0 top-0 -z-50 size-px opacity-0"
          onLoadedMetadata={handleLoadedMetadata}
          onError={handleVideoError}
          onEnded={handleEnded}
        />
        <canvas ref={canvasRef} className="pointer-events-none fixed left-0 top-0 -z-50 size-px opacity-0" />

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="mt-4"
          >
            {tab === 'convert' ? (
              /* ================= CONVERT TAB ================= */
              <div className="space-y-4">
                {!file ? (
                  /* ---------------- Empty state ---------------- */
                  <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-12 text-center">
                    <span className="flex size-16 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04]">
                      <MonitorPlay className="size-8 text-emerald-300" strokeWidth={1.6} aria-hidden />
                    </span>
                    <p className="text-base font-bold tracking-tight">No video selected</p>
                    <p className="max-w-xs text-sm text-zinc-500">
                      Pick a video to shrink it to a preset resolution and bitrate — right on this device.
                    </p>
                    <Button
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-1 h-11 rounded-xl bg-gradient-to-r from-teal-400 via-emerald-500 to-green-600 font-semibold text-white shadow-lg hover:from-teal-300 hover:via-emerald-400 hover:to-green-500"
                    >
                      <FileVideo className="size-4" aria-hidden /> Choose a video
                    </Button>
                    <p className="text-[11px] text-zinc-600">MP4, WebM, MOV and more — output is WebM.</p>
                  </div>
                ) : converting ? (
                  /* ---------------- Progress card ---------------- */
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                    className="rounded-2xl border border-white/10 bg-white/5 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                        <Loader2 className="size-4 shrink-0 animate-spin text-emerald-300" aria-hidden />
                        <span className="truncate">Recording in real time…</span>
                      </p>
                      <p className="text-lg font-bold tabular-nums text-emerald-300" aria-live="polite">
                        {Math.round(progress.pct)}%
                      </p>
                    </div>

                    <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/10">
                      <motion.div
                        className="h-full rounded-full bg-gradient-to-r from-teal-400 via-emerald-500 to-green-500"
                        initial={{ width: '0%' }}
                        animate={{ width: `${progress.pct}%` }}
                        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                      />
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-center">
                        <p className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
                          <Timer className="size-3" aria-hidden /> Elapsed
                        </p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums">{fmtTime(progress.elapsedMs / 1000)}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500">Output</p>
                        <p className="mt-0.5 text-sm font-bold tabular-nums">{fmtBytes(progress.outBytes)}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-center">
                        <p className="text-[10px] uppercase tracking-wider text-zinc-500">Target</p>
                        <p className="mt-0.5 truncate text-sm font-bold tabular-nums">
                          {effDims ? `${effDims.w}×${effDims.h}` : '—'}
                        </p>
                      </div>
                    </div>

                    <p className="mt-3 flex items-start gap-1.5 text-[11px] text-zinc-500">
                      <Info className="mt-px size-3.5 shrink-0 text-emerald-400/70" aria-hidden />
                      <span>Keep this screen open — frames are captured live, so the encode takes as long as the video.</span>
                    </p>

                    <Button
                      onClick={cancelConversion}
                      className="mt-3 h-11 w-full rounded-xl border border-rose-400/40 bg-rose-500/10 font-semibold text-rose-200 shadow-none hover:bg-rose-500/20"
                    >
                      <Square className="size-4" aria-hidden /> Cancel &amp; keep partial
                    </Button>
                  </motion.div>
                ) : result ? (
                  /* ---------------- Result card ---------------- */
                  <AnimatePresence>
                    <motion.div
                      key="result"
                      initial={{ opacity: 0, y: 14, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                      className={cn(
                        'rounded-2xl border p-4',
                        result.partial
                          ? 'border-amber-400/25 bg-amber-500/[0.06]'
                          : 'border-emerald-400/25 bg-emerald-500/[0.06]',
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {result.partial ? (
                          <CircleAlert className="size-5 shrink-0 text-amber-300" aria-hidden />
                        ) : (
                          <BadgeCheck className="size-5 shrink-0 text-emerald-300" aria-hidden />
                        )}
                        <p className="text-sm font-bold">
                          {result.partial ? 'Partial recording' : 'Conversion complete'}
                        </p>
                        <span className="ml-auto truncate text-[11px] tabular-nums text-zinc-500">
                          {result.presetLabel} · {result.bitrateLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] tabular-nums text-zinc-500">
                        {result.dims} · {result.codec} · took {fmtTime(result.elapsedMs / 1000)}
                      </p>

                      <video
                        key={result.url}
                        src={result.url}
                        controls
                        playsInline
                        className="mt-3 max-h-72 w-full rounded-xl border border-white/10 bg-black"
                      />

                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-center">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500">Before</p>
                          <p className="mt-0.5 truncate text-sm font-bold tabular-nums">{fmtBytes(result.srcSize)}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-center">
                          <p className="text-[10px] uppercase tracking-wider text-zinc-500">After</p>
                          <p className="mt-0.5 truncate text-sm font-bold tabular-nums">{fmtBytes(result.outSize)}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-center">
                          <p className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500">
                            <Shrink className="size-3" aria-hidden /> Saved
                          </p>
                          <p
                            className={cn(
                              'mt-0.5 truncate text-sm font-bold tabular-nums',
                              result.savedPct > 0
                                ? 'text-emerald-400'
                                : result.savedPct < 0
                                  ? 'text-rose-400'
                                  : 'text-zinc-300',
                            )}
                          >
                            {result.savedPct > 0
                              ? `−${result.savedPct}%`
                              : result.savedPct < 0
                                ? `+${-result.savedPct}%`
                                : '0%'}
                          </p>
                        </div>
                      </div>

                      {result.partial && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-amber-400/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                          <span>
                            Stopped early — the partial file <span className="font-semibold">{result.fileName}</span> is
                            still downloadable.
                          </span>
                        </p>
                      )}

                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <Button
                          onClick={downloadResult}
                          className="h-11 flex-1 rounded-xl bg-gradient-to-r from-teal-400 via-emerald-500 to-green-600 font-semibold text-white shadow-lg hover:from-teal-300 hover:via-emerald-400 hover:to-green-500"
                        >
                          <Download className="size-4" aria-hidden /> Download {result.partial ? 'partial' : 'WebM'}
                        </Button>
                        <Button
                          onClick={resetSession}
                          className="h-11 flex-1 rounded-xl border border-white/15 bg-white/5 font-semibold text-zinc-200 shadow-none hover:bg-white/10"
                        >
                          <RotateCcw className="size-4" aria-hidden /> Convert another
                        </Button>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                ) : (
                  <>
                    {/* ---------------- Source card ---------------- */}
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="flex items-center gap-3">
                        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                          <Film className="size-5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{file.name}</p>
                          <p className="mt-0.5 truncate text-[11px] tabular-nums text-zinc-500">
                            {fmtBytes(file.size)}
                            {srcMeta
                              ? ` · ${srcMeta.width}×${srcMeta.height} · ${fmtTime(srcMeta.duration)}`
                              : ' · reading metadata…'}
                            {file.type ? ` · ${file.type.replace('video/', '').toUpperCase()}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={resetSession}
                          aria-label={`Remove ${file.name}`}
                          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-500 transition-colors hover:border-rose-400/40 hover:text-rose-300"
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      </div>

                      {!srcMeta && (
                        <p className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Reading duration &amp; dimensions…
                        </p>
                      )}

                      {srcMeta && srcMeta.duration > LONG_VIDEO_SECS && (
                        <p className="mt-2 flex items-start gap-1.5 rounded-xl border border-amber-400/30 bg-amber-500/10 p-2 text-[11px] text-amber-200">
                          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                          <span>
                            This video runs {fmtTime(srcMeta.duration)} — conversion records in real time, so expect at
                            least that long. Keep the screen open.
                          </span>
                        </p>
                      )}
                    </div>

                    {/* ---------------- Settings card ---------------- */}
                    <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="space-y-2">
                        <SectionLabel icon={<Clapperboard aria-hidden />}>Resolution</SectionLabel>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                          {RES_PRESETS.map((p) => (
                            <PresetChip
                              key={p.key}
                              selected={resKey === p.key}
                              disabled={false}
                              onClick={() => {
                                setResKey(p.key)
                                haptic()
                              }}
                            >
                              {p.label}
                            </PresetChip>
                          ))}
                        </div>
                        {clampNote && (
                          <p className="flex items-start gap-1.5 text-[11px] text-amber-200/90">
                            <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                            <span>{clampNote}</span>
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <SectionLabel icon={<Gauge aria-hidden />}>Quality (bitrate)</SectionLabel>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {BITRATE_PRESETS.map((p) => (
                            <PresetChip
                              key={p.key}
                              selected={brKey === p.key}
                              disabled={false}
                              onClick={() => {
                                setBrKey(p.key)
                                haptic()
                              }}
                            >
                              {p.key === 'auto' ? `Auto · ${fmtMbps(chosenBps)}` : `${p.name} · ${fmtMbps(p.bps)}`}
                            </PresetChip>
                          ))}
                        </div>
                        <p className="text-[11px] tabular-nums text-zinc-500">
                          Estimated output ≈ {srcMeta ? fmtBytes(estOutBytes) : '—'} · 30 fps
                          {muteAudio ? '' : ` · ${fmtMbps(AUDIO_BPS)} audio`}
                        </p>
                      </div>

                      {/* audio toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          setMuteAudio((m) => !m)
                          haptic()
                        }}
                        disabled={converting}
                        aria-pressed={!muteAudio}
                        className="flex h-11 w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 text-sm transition-colors hover:border-white/20 disabled:opacity-50"
                      >
                        <span className="flex items-center gap-2 font-medium text-zinc-200">
                          {muteAudio ? (
                            <VolumeX className="size-4 text-rose-300" aria-hidden />
                          ) : (
                            <Volume2 className="size-4 text-emerald-300" aria-hidden />
                          )}
                          {muteAudio ? 'Mute audio (video only)' : 'Keep audio track'}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                            muteAudio ? 'bg-white/10 text-zinc-400' : 'bg-emerald-500/20 text-emerald-300',
                          )}
                        >
                          {muteAudio ? 'Off' : 'On'}
                        </span>
                      </button>

                      {/* codec chip + container note */}
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 font-semibold',
                            codec
                              ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                              : 'border-rose-400/30 bg-rose-500/10 text-rose-300',
                          )}
                        >
                          {codec ? codec.label : 'Recorder unsupported'}
                        </span>
                        <span>WebM output — MP4 is not guaranteed in-browser.</span>
                      </div>

                      {!codec && (
                        <p className="flex items-start gap-1.5 rounded-xl border border-rose-400/30 bg-rose-500/10 p-2 text-[11px] text-rose-200">
                          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
                          <span>
                            This browser cannot record WebM video, so conversion is unavailable here. Try Chrome,
                            Edge or Firefox.
                          </span>
                        </p>
                      )}

                      <Button
                        onClick={() => void startConversion()}
                        disabled={!canStart}
                        className="h-12 w-full rounded-xl bg-gradient-to-r from-teal-400 via-emerald-500 to-green-600 text-base font-bold text-white shadow-lg hover:from-teal-300 hover:via-emerald-400 hover:to-green-500"
                      >
                        <Play className="size-5" aria-hidden /> Convert &amp; compress
                      </Button>
                      <p className="text-center text-[10px] text-zinc-600">
                        Real-time encode at playback speed — a 2-minute video takes about 2 minutes.
                      </p>
                    </div>
                  </>
                )}
              </div>
            ) : (
              /* ================= HISTORY TAB ================= */
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">History</p>
                    <p className="text-[11px] text-zinc-500">
                      {history.length} conversion{history.length === 1 ? '' : 's'} · metadata only
                    </p>
                  </div>
                  {history.length > 0 && (
                    <Button
                      onClick={clearHistory}
                      className={cn(
                        'h-11 shrink-0 rounded-xl border px-3 text-xs font-semibold shadow-none',
                        armedClear
                          ? 'border-rose-400/60 bg-rose-500/25 text-rose-100 hover:bg-rose-500/30'
                          : 'border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20',
                      )}
                    >
                      <Trash2 className="size-4" aria-hidden /> {armedClear ? 'Sure?' : 'Clear all'}
                    </Button>
                  )}
                </div>

                {history.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                    <span className="flex size-14 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                      <History className="size-7 text-zinc-500" strokeWidth={1.6} aria-hidden />
                    </span>
                    <p className="text-sm font-semibold">No conversions yet</p>
                    <p className="max-w-xs text-xs text-zinc-500">
                      Finished conversions show up here with their sizes and settings.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-96 space-y-2 overflow-y-auto pr-0.5">
                    {history.map((row) => (
                      <HistoryRowItem key={row.id} row={row} onRemove={() => removeRow(row.id)} />
                    ))}
                  </div>
                )}

                <p className="mt-3 flex items-start gap-1.5 text-[11px] text-zinc-500">
                  <Info className="mt-px size-3.5 shrink-0 text-emerald-400/70" aria-hidden />
                  <span>Only names, sizes and settings are stored — video files are never saved to this device.</span>
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
