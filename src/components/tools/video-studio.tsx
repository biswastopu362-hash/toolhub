'use client'

/**
 * Video Studio — the device's video tool. (v3 — multi-clip timeline)
 *
 * Timeline: import MULTIPLE clips into one ordered project. Every clip gets a
 *           canvas-grabbed thumbnail (frame at 1s), a per-clip trim, its own
 *           live filter, rotation and flip — and can be moved left/right.
 * Editor:   watch the selected clip with live CSS filters, scrub, change
 *           speed/volume/loop, trim with a looping preview, and capture the
 *           current frame (PNG download + saved into the shared media library).
 * Export:   render the whole timeline into ONE WebM — clips play sequentially
 *           into a hidden canvas + MediaRecorder, every frame respecting its
 *           clip's trim and look; audio is tapped per clip through an
 *           AudioContext MediaElementSource → MediaStreamDestination (clips
 *           without audio simply contribute silence). Real-time encode with
 *           live progress; cancelling keeps the partial recording.
 * Library:  imported clips persist in IndexedDB — every clip gets a one-tap
 *           QR code that ships it to any other device running ToolHub.
 * Receive:  paste a transfer link, scan the QR in-app, or just open a
 *           /?transfer=<id> link — the clip lands here automatically.
 *
 * The timeline arrangement (order, trims, looks) persists to localStorage for
 * clips that live in the library; imported-but-unsaved clips cannot survive a
 * reload (their bytes are never uploaded anywhere).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import QRCode from 'qrcode'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Clapperboard,
  Copy,
  Download,
  Film,
  FlipHorizontal2,
  ListVideo,
  Loader2,
  Pause,
  Play,
  Plus,
  QrCode,
  Repeat,
  RotateCw,
  ScanLine,
  Scissors,
  Save,
  Square,
  Timer,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { newPhotoId, putPhoto } from '@/lib/media-db'
import {
  deleteClip,
  getClipBlob,
  listClips,
  makePoster,
  newClipId,
  posterFromElement,
  putClip,
  type ClipRecord,
} from '@/lib/video-db'
import { downloadTransfer, uploadTransfer } from '@/lib/video-transfer'
import { takePendingTransfer, transferIdFromUrl, transferShareUrl } from '@/lib/transfer'

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const FILTERS: { id: string; label: string; css: string }[] = [
  { id: 'normal', label: 'Normal', css: 'none' },
  { id: 'mono', label: 'Mono', css: 'grayscale(1)' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.6) contrast(1.1)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.35) saturate(1.4)' },
  { id: 'cool', label: 'Cool', css: 'hue-rotate(15deg) saturate(1.2)' },
  { id: 'sepia', label: 'Sepia', css: 'sepia(1)' },
  { id: 'invert', label: 'Invert', css: 'invert(1)' },
]

const SPEEDS: { value: number; label: string }[] = [
  { value: 0.25, label: '0.25x' },
  { value: 0.5, label: '0.5x' },
  { value: 1, label: '1x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
]

const SHARE_TTL_MS = 30 * 60_000

/** Where inside a clip the timeline thumbnail is grabbed. */
const THUMB_AT_SEC = 1
/** Long edge cap for the combined-export canvas (keeps encode cheap). */
const EXPORT_LONG_EDGE = 1280
const EXPORT_VIDEO_BPS = 5_000_000
const EXPORT_AUDIO_BPS = 128_000
const EXPORT_MIMES: { mime: string; label: string }[] = [
  { mime: 'video/webm;codecs=vp9,opus', label: 'VP9 + Opus' },
  { mime: 'video/webm;codecs=vp8,opus', label: 'VP8 + Opus' },
  { mime: 'video/webm;codecs=vp9', label: 'VP9' },
  { mime: 'video/webm;codecs=vp8', label: 'VP8' },
  { mime: 'video/webm', label: 'WebM' },
]

/** Versioned persistence for the timeline arrangement (library-backed clips only). */
const PROJECT_LS_KEY = 'toolhub-videostudio-project-v2'

const fmtTime = (t: number) => {
  const safe = isFinite(t) && t > 0 ? t : 0
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const fmtBytes = (n: number) => {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

type ShareState =
  | { phase: 'uploading'; progress: number }
  | { phase: 'ready'; id: string; link: string; qr: string; exp: number }
  | { phase: 'error'; message: string }

type ReceiveState =
  | { phase: 'input' }
  | { phase: 'downloading'; progress: number }
  | { phase: 'error'; message: string }

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

/** One clip on the multi-clip timeline — owns its bytes via a blob object URL. */
interface ProjectClip {
  id: string
  name: string
  mime: string
  size: number
  /** Raw bytes (File on import, Blob from the library) — used for library saves. */
  blob: Blob
  /** Object URL for playback + export. Revoked when the clip leaves the project. */
  url: string
  /** seconds — 0 when unreadable */
  duration: number
  width: number
  height: number
  /** JPEG data URL of the frame at ~1s — timeline thumbnail. */
  thumb: string | null
  trimStart: number
  trimEnd: number
  filterId: string
  rotation: number
  flip: boolean
  /** Set once the clip has been saved into the shared library. */
  libraryId: string | null
  origin: 'import' | 'received'
}

/** The persisted slice of a project clip (library-backed only). */
interface PersistedClip {
  id: string
  trimStart: number
  trimEnd: number
  filterId: string
  rotation: number
  flip: boolean
  libraryId: string | null
}

interface ExportRun {
  pct: number
  exported: number
  total: number
  clipIndex: number
  clipCount: number
}

interface ExportResult {
  url: string
  blob: Blob
  fileName: string
  size: number
  seconds: number
  partial: boolean
}

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

function evenize(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2)
}

function filterCssOf(clip: ProjectClip): string {
  return FILTERS.find((f) => f.id === clip.filterId)?.css ?? 'none'
}

function negotiateExportMime(): { mime: string; label: string } | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const c of EXPORT_MIMES) {
    try {
      if (MediaRecorder.isTypeSupported(c.mime)) return c
    } catch {
      /* keep looking */
    }
  }
  return null
}

/**
 * Paint one video frame onto a canvas with the clip's look applied —
 * contain-fitted and centered (letterboxed) inside cw×ch.
 */
function paintFrame(
  ctx: CanvasRenderingContext2D,
  v: HTMLVideoElement,
  look: { filter: string; rotation: number; flip: boolean },
  cw: number,
  ch: number
) {
  const vw = v.videoWidth
  const vh = v.videoHeight
  if (!vw || !vh) return
  const swap = look.rotation % 180 === 90
  const rw = swap ? vh : vw
  const rh = swap ? vw : vh
  const scale = Math.min(cw / rw, ch / rh)
  ctx.save()
  try {
    ctx.filter = look.filter
  } catch {
    /* filter unsupported in this browser — draw plain */
  }
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, cw, ch)
  ctx.translate(cw / 2, ch / 2)
  ctx.rotate((look.rotation * Math.PI) / 180)
  ctx.scale(look.flip ? -1 : 1, 1)
  ctx.drawImage(v, (-vw * scale) / 2, (-vh * scale) / 2, vw * scale, vh * scale)
  ctx.restore()
}

/** Await a video element event with a timeout; fails fast on decode errors. */
function waitVideoEvent(v: HTMLVideoElement, ev: 'loadedmetadata' | 'seeked', timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      v.removeEventListener(ev, onEvent)
      v.removeEventListener('error', onError)
      resolve(ok)
    }
    const onEvent = () => finish(true)
    const onError = () => finish(false)
    const timer = window.setTimeout(() => finish(false), timeoutMs)
    v.addEventListener(ev, onEvent, { once: true })
    v.addEventListener('error', onError, { once: true })
  })
}

/** Load a clip into the hidden export element and seek to its trim start. */
async function loadAndSeek(v: HTMLVideoElement, url: string, at: number): Promise<boolean> {
  v.src = url
  v.load()
  if (!(await waitVideoEvent(v, 'loadedmetadata', 10000))) return false
  if (Math.abs(v.currentTime - at) < 0.01) return true
  try {
    v.currentTime = at
  } catch {
    return false
  }
  return waitVideoEvent(v, 'seeked', 8000)
}

/**
 * Probe a clip: duration, dimensions and a thumbnail frame grabbed at ~1s.
 * Best-effort — everything resolves gracefully so a weird container never
 * blocks the timeline.
 */
function probeClip(url: string): Promise<{ duration: number; width: number; height: number; thumb: string | null }> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.muted = true
    v.preload = 'auto'
    let duration = 0
    let width = 0
    let height = 0
    let settled = false
    const finish = (thumb: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(guard)
      window.clearTimeout(seekGuard)
      v.onloadedmetadata = null
      v.onseeked = null
      v.onerror = null
      v.removeAttribute('src')
      v.load()
      resolve({ duration, width, height, thumb })
    }
    const guard = window.setTimeout(() => finish(null), 9000)
    let seekGuard = 0
    v.onerror = () => finish(null)
    v.onloadedmetadata = () => {
      duration = isFinite(v.duration) && v.duration > 0 ? v.duration : 0
      width = v.videoWidth
      height = v.videoHeight
      if (duration <= 0 || width === 0) {
        finish(null)
        return
      }
      try {
        v.currentTime = Math.min(THUMB_AT_SEC, Math.max(0.05, duration - 0.1))
      } catch {
        finish(null)
        return
      }
      seekGuard = window.setTimeout(() => finish(null), 3000)
    }
    v.onseeked = () => {
      try {
        const scale = Math.min(1, 320 / Math.max(width, height))
        const cv = document.createElement('canvas')
        cv.width = Math.max(2, Math.round(width * scale))
        cv.height = Math.max(2, Math.round(height * scale))
        const ctx = cv.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        ctx.drawImage(v, 0, 0, cv.width, cv.height)
        finish(cv.toDataURL('image/jpeg', 0.72))
      } catch {
        finish(null)
      }
    }
    v.src = url
  })
}

function isPersistedClip(x: unknown): x is PersistedClip {
  if (!x || typeof x !== 'object') return false
  const c = x as Record<string, unknown>
  return (
    typeof c.id === 'string' &&
    typeof c.trimStart === 'number' &&
    typeof c.trimEnd === 'number' &&
    typeof c.filterId === 'string' &&
    typeof c.rotation === 'number' &&
    typeof c.flip === 'boolean' &&
    (c.libraryId === null || typeof c.libraryId === 'string')
  )
}

/** Read the persisted arrangement — old/corrupt/foreign records are ignored. */
function readArrangement(): PersistedClip[] {
  try {
    const raw = window.localStorage.getItem(PROJECT_LS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    const obj = parsed as { v?: unknown; clips?: unknown }
    if (obj.v !== 2 || !Array.isArray(obj.clips)) return []
    return obj.clips.filter(isPersistedClip)
  } catch {
    return []
  }
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function VideoStudioApp() {
  const { toast } = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /* hidden media for the combined export */
  const expVideoRef = useRef<HTMLVideoElement>(null)
  const expCanvasRef = useRef<HTMLCanvasElement>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef(0)
  const cancelRef = useRef(false)
  const runningRef = useRef(false)
  const exportErrorRef = useRef('')
  const audioCtxRef = useRef<AudioContext | null>(null)
  const exportSrcNodeRef = useRef<MediaElementAudioSourceNode | null>(null)
  const resultUrlRef = useRef<string | null>(null)

  /* every object URL the timeline owns — revoked on removal/unmount */
  const timelineUrlsRef = useRef<string[]>([])

  /* -------- timeline (the multi-clip project) -------- */
  const [timeline, setTimeline] = useState<ProjectClip[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [armedClear, setArmedClear] = useState(false)
  const removeTimerRef = useRef<number | null>(null)
  const clearTimerRef = useRef<number | null>(null)

  /* -------- player (plays the selected clip) -------- */
  const [duration, setDuration] = useState(0)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [metaReady, setMetaReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(false)
  const [trimPreview, setTrimPreview] = useState(false)

  /* -------- combined export -------- */
  const [exportRun, setExportRun] = useState<ExportRun | null>(null)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [exportCodec, setExportCodec] = useState<{ mime: string; label: string } | null>(null)

  /* -------- clip library -------- */
  const [library, setLibrary] = useState<ClipRecord[]>([])
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const confirmTimerRef = useRef<number | null>(null)

  /* -------- QR share -------- */
  const [shareClip, setShareClip] = useState<ClipRecord | null>(null)
  const [share, setShare] = useState<ShareState>({ phase: 'uploading', progress: 0 })
  const shareAbortRef = useRef<AbortController | null>(null)
  const shareCacheRef = useRef<Map<string, { id: string; exp: number }>>(new Map())
  const [now, setNow] = useState(() => Date.now())

  /* -------- receive -------- */
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receive, setReceive] = useState<ReceiveState>({ phase: 'input' })
  const [receiveInput, setReceiveInput] = useState('')
  const receiveAbortRef = useRef<AbortController | null>(null)
  const [scanOn, setScanOn] = useState(false)
  const scanVideoRef = useRef<HTMLVideoElement>(null)
  const scanStreamRef = useRef<MediaStream | null>(null)
  const scanTimerRef = useRef<number | null>(null)

  const sel = selectedId ? (timeline.find((c) => c.id === selectedId) ?? null) : null
  const selIndex = timeline.findIndex((c) => c.id === selectedId)
  const activeFilter = FILTERS.find((f) => f.id === sel?.filterId) ?? FILTERS[0]
  const rotated = (sel?.rotation ?? 0) % 180 === 90
  const trimmedDuration = sel ? Math.max(0, sel.trimEnd - sel.trimStart) : 0
  const totalRuntime = timeline.reduce((s, c) => s + Math.max(0, c.trimEnd - c.trimStart), 0)
  const shareExpIn = share.phase === 'ready' ? Math.max(0, share.exp - now) : 0
  const shareCountdown =
    share.phase === 'ready'
      ? `${Math.floor(shareExpIn / 60000)}:${String(Math.floor((shareExpIn % 60000) / 1000)).padStart(2, '0')}`
      : ''

  /* Revoke every object URL + stop every stream when the app unmounts */
  useEffect(() => {
    return () => {
      for (const u of timelineUrlsRef.current) URL.revokeObjectURL(u)
      timelineUrlsRef.current = []
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      try {
        if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop()
      } catch {
        /* recorder already idle */
      }
      try {
        exportSrcNodeRef.current?.disconnect()
      } catch {
        /* never created */
      }
      const actx = audioCtxRef.current
      if (actx) void actx.close().catch(() => {})
      runningRef.current = false
      shareAbortRef.current?.abort()
      receiveAbortRef.current?.abort()
      if (scanStreamRef.current) scanStreamRef.current.getTracks().forEach((t) => t.stop())
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current)
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
      if (removeTimerRef.current) window.clearTimeout(removeTimerRef.current)
      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)
    }
  }, [])

  /* countdown ticker while a share modal is open */
  useEffect(() => {
    if (!shareClip) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [shareClip])

  /* negotiate the combined-export codec once, off the render path */
  useEffect(() => {
    let alive = true
    queueMicrotask(() => {
      if (alive) setExportCodec(negotiateExportMime())
    })
    return () => {
      alive = false
    }
  }, [])

  /* initial load: library + restore the persisted timeline arrangement */
  useEffect(() => {
    let alive = true
    void (async () => {
      let recs: ClipRecord[] = []
      try {
        recs = await listClips()
      } catch {
        return
      }
      if (!alive) return
      setLibrary(recs)
      const saved = readArrangement()
      if (saved.length === 0) return
      const byLibId = new Map(recs.map((r) => [r.id, r]))
      const built: ProjectClip[] = []
      for (const p of saved) {
        const rec = p.libraryId ? byLibId.get(p.libraryId) : undefined
        if (!rec) continue // unknown / deleted / unsaved clip — skipped gracefully
        const blob = await getClipBlob(rec.id)
        if (!alive) return
        if (!blob) continue
        const url = URL.createObjectURL(blob)
        timelineUrlsRef.current.push(url)
        const probed = await probeClip(url)
        if (!alive) {
          URL.revokeObjectURL(url)
          return
        }
        const duration = probed.duration > 0 ? probed.duration : (rec.duration ?? 0)
        const tStart = duration > 0 ? clamp(p.trimStart, 0, duration) : 0
        const tEnd =
          duration > 0 ? clamp(p.trimEnd, Math.min(duration, tStart + 0.2), duration) : 0
        built.push({
          id: p.id,
          name: rec.name,
          mime: rec.mime,
          size: rec.size,
          blob,
          url,
          duration,
          width: probed.width,
          height: probed.height,
          thumb: probed.thumb ?? rec.poster ?? null,
          trimStart: tStart,
          trimEnd: tEnd,
          filterId: FILTERS.some((f) => f.id === p.filterId) ? p.filterId : 'normal',
          rotation: ((Math.round(p.rotation) % 360) + 360) % 360,
          flip: p.flip,
          libraryId: rec.id,
          origin: rec.origin,
        })
      }
      if (!alive || built.length === 0) return
      setTimeline(built)
      setSelectedId(built[0]?.id ?? null)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* persist the timeline arrangement (debounced) — library-backed clips restore on reload */
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        if (timeline.length === 0) {
          window.localStorage.removeItem(PROJECT_LS_KEY)
          return
        }
        const payload = JSON.stringify({
          v: 2,
          clips: timeline.map((c) => ({
            id: c.id,
            trimStart: Math.round(c.trimStart * 100) / 100,
            trimEnd: Math.round(c.trimEnd * 100) / 100,
            filterId: c.filterId,
            rotation: c.rotation,
            flip: c.flip,
            libraryId: c.libraryId,
          })),
        })
        window.localStorage.setItem(PROJECT_LS_KEY, payload)
      } catch {
        /* storage unavailable — the arrangement just won't persist */
      }
    }, 500)
    return () => window.clearTimeout(t)
  }, [timeline])

  /* -------- timeline ops -------- */

  const patchClip = useCallback((id: string, patch: Partial<ProjectClip>) => {
    setTimeline((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  }, [])

  const patchSel = useCallback(
    (patch: Partial<ProjectClip>) => {
      if (selectedId) patchClip(selectedId, patch)
    },
    [selectedId, patchClip]
  )

  const resetPlayerState = useCallback(() => {
    setPlaying(false)
    setTime(0)
    setDuration(0)
    setDims(null)
    setMetaReady(false)
    setTrimPreview(false)
  }, [])

  const selectClip = useCallback(
    (id: string) => {
      if (id === selectedId) return
      try {
        videoRef.current?.pause()
      } catch {
        /* already idle */
      }
      setSelectedId(id)
      resetPlayerState()
      haptic()
    },
    [selectedId, resetPlayerState]
  )

  const moveSelected = useCallback(
    (dir: -1 | 1) => {
      setTimeline((prev) => {
        const i = prev.findIndex((c) => c.id === selectedId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= prev.length) return prev
        const next = [...prev]
        const tmp = next[i]
        const other = next[j]
        if (!tmp || !other) return prev
        next[i] = other
        next[j] = tmp
        return next
      })
      haptic()
    },
    [selectedId]
  )

  const armRemove = useCallback((id: string) => {
    setConfirmRemoveId((prev) => (prev === id ? null : id))
    if (removeTimerRef.current) window.clearTimeout(removeTimerRef.current)
    removeTimerRef.current = window.setTimeout(() => setConfirmRemoveId(null), 2600)
  }, [])

  const removeTimelineClip = useCallback(
    (id: string) => {
      const idx = timeline.findIndex((c) => c.id === id)
      const victim = idx >= 0 ? timeline[idx] : undefined
      if (!victim) return
      if (runningRef.current) {
        toast({
          title: 'Export in progress',
          description: 'Cancel the export before changing the timeline.',
          variant: 'destructive',
        })
        return
      }
      URL.revokeObjectURL(victim.url)
      timelineUrlsRef.current = timelineUrlsRef.current.filter((u) => u !== victim.url)
      const remaining = timeline.filter((c) => c.id !== id)
      setTimeline(remaining)
      setConfirmRemoveId(null)
      if (id === selectedId) {
        // fall over to a neighbour so the editor never dead-ends
        const next = remaining[idx] ?? remaining[idx - 1] ?? null
        setSelectedId(next ? next.id : null)
        resetPlayerState()
      }
      haptic()
    },
    [timeline, selectedId, resetPlayerState, toast]
  )

  const clearTimeline = useCallback(() => {
    if (runningRef.current) {
      toast({
        title: 'Export in progress',
        description: 'Cancel the export before clearing the timeline.',
        variant: 'destructive',
      })
      return
    }
    for (const c of timeline) URL.revokeObjectURL(c.url)
    timelineUrlsRef.current = []
    setTimeline([])
    setSelectedId(null)
    resetPlayerState()
    setArmedClear(false)
    haptic()
    toast({ title: 'Timeline cleared', description: 'Library clips are safe — only this arrangement was removed.' })
  }, [timeline, resetPlayerState, toast])

  const armClear = useCallback(() => {
    setArmedClear(true)
    if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current)
    clearTimerRef.current = window.setTimeout(() => setArmedClear(false), 2600)
  }, [])

  /* -------- Import (multi-file) -------- */

  const addClipFromFile = useCallback(
    async (file: File) => {
      const url = URL.createObjectURL(file)
      timelineUrlsRef.current.push(url)
      const probed = await probeClip(url)
      const clip: ProjectClip = {
        id: newClipId(),
        name: file.name,
        mime: file.type || 'video/mp4',
        size: file.size,
        blob: file,
        url,
        duration: probed.duration,
        width: probed.width,
        height: probed.height,
        thumb: probed.thumb,
        trimStart: 0,
        trimEnd: probed.duration,
        filterId: 'normal',
        rotation: 0,
        flip: false,
        libraryId: null,
        origin: 'import',
      }
      setTimeline((prev) => [...prev, clip])
      setSelectedId(clip.id)
      resetPlayerState()
      haptic()
      if (probed.duration <= 0) {
        toast({
          title: 'Duration unreadable',
          description: `${file.name} will still play — trim unlocks once its length is known.`,
        })
      }
    },
    [resetPlayerState, toast]
  )

  const addFiles = useCallback(
    (files: FileList | null) => {
      if (runningRef.current) {
        toast({
          title: 'Export in progress',
          description: 'Cancel the export before adding clips.',
          variant: 'destructive',
        })
        return
      }
      const list = Array.from(files ?? [])
      const vids = list.filter((f) => f.type.startsWith('video/'))
      if (list.length > 0 && vids.length === 0) {
        toast({
          title: 'Not a video file',
          description: 'Choose MP4, WebM or MOV clips.',
          variant: 'destructive',
        })
        return
      }
      for (const f of vids) void addClipFromFile(f)
    },
    [addClipFromFile, toast]
  )

  /* -------- Library: refresh / save / delete / open into timeline -------- */

  const loadLibrary = useCallback(async () => {
    setLibrary(await listClips())
  }, [])

  const saveSelectedToLibrary = useCallback(async () => {
    const clip = sel
    if (!clip) return
    setSaving(true)
    try {
      const poster =
        (videoRef.current && selectedId === clip.id ? posterFromElement(videoRef.current) : undefined) ??
        (await makePoster(clip.blob))
      const rec: ClipRecord = {
        id: clip.id, // reuse the project id so the persisted arrangement keeps matching
        name: clip.name,
        mime: clip.mime,
        size: clip.size,
        duration: clip.duration > 0 ? clip.duration : undefined,
        poster,
        createdAt: Date.now(),
        origin: clip.origin === 'received' ? 'received' : 'import',
      }
      await putClip(rec, clip.blob)
      patchClip(clip.id, { libraryId: rec.id })
      await loadLibrary()
      toast({ title: 'Saved to your library', description: 'Now shareable with a QR code.' })
      haptic()
    } catch {
      toast({
        title: 'Could not save',
        description: 'Storage may be full — try a smaller clip.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [sel, selectedId, patchClip, loadLibrary, toast])

  const armDelete = useCallback((id: string) => {
    setConfirmDeleteId((prev) => (prev === id ? null : id))
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = window.setTimeout(() => setConfirmDeleteId(null), 2600)
  }, [])

  const removeLibraryClip = useCallback(
    async (rec: ClipRecord) => {
      try {
        await deleteClip(rec.id)
        shareCacheRef.current.delete(rec.id)
        setTimeline((prev) => prev.map((c) => (c.libraryId === rec.id ? { ...c, libraryId: null } : c)))
        await loadLibrary()
        setConfirmDeleteId(null)
        toast({ title: 'Clip deleted', description: rec.name })
      } catch {
        toast({ title: 'Could not delete', variant: 'destructive' })
      }
    },
    [loadLibrary, toast]
  )

  const openLibraryClip = useCallback(
    async (rec: ClipRecord) => {
      const existing = timeline.find((c) => c.libraryId === rec.id)
      if (existing) {
        selectClip(existing.id)
        return
      }
      const blob = await getClipBlob(rec.id)
      if (!blob) {
        toast({ title: 'Clip data missing', description: 'Try re-importing the video.', variant: 'destructive' })
        return
      }
      const url = URL.createObjectURL(blob)
      timelineUrlsRef.current.push(url)
      const probed = await probeClip(url)
      const duration = probed.duration > 0 ? probed.duration : (rec.duration ?? 0)
      const clip: ProjectClip = {
        id: newClipId(),
        name: rec.name,
        mime: rec.mime,
        size: rec.size,
        blob,
        url,
        duration,
        width: probed.width,
        height: probed.height,
        thumb: probed.thumb ?? rec.poster ?? null,
        trimStart: 0,
        trimEnd: duration,
        filterId: 'normal',
        rotation: 0,
        flip: false,
        libraryId: rec.id,
        origin: rec.origin,
      }
      setTimeline((prev) => [...prev, clip])
      setSelectedId(clip.id)
      resetPlayerState()
      haptic()
    },
    [timeline, selectClip, resetPlayerState, toast]
  )

  /* -------- QR share -------- */

  const closeShare = useCallback(() => {
    shareAbortRef.current?.abort()
    shareAbortRef.current = null
    setShareClip(null)
  }, [])

  const startShare = useCallback(
    async (rec: ClipRecord) => {
      setShareClip(rec)
      setNow(Date.now())

      const cached = shareCacheRef.current.get(rec.id)
      if (cached && cached.exp - 60_000 > Date.now()) {
        const link = transferShareUrl(cached.id)
        try {
          const qr = await QRCode.toDataURL(link, {
            margin: 1,
            width: 256,
            color: { dark: '#18181b', light: '#fafafa' },
          })
          setShare({ phase: 'ready', id: cached.id, link, qr, exp: cached.exp })
          return
        } catch {
          shareCacheRef.current.delete(rec.id)
        }
      }

      setShare({ phase: 'uploading', progress: 0 })
      const abort = new AbortController()
      shareAbortRef.current = abort
      try {
        const blob = await getClipBlob(rec.id)
        if (!blob) throw new Error('Clip data missing — reopen the clip first.')
        const id = await uploadTransfer(
          blob,
          { name: rec.name, mime: rec.mime },
          {
            signal: abort.signal,
            onProgress: (sent, total) => {
              if (!abort.signal.aborted) {
                setShare({ phase: 'uploading', progress: total > 0 ? sent / total : 0 })
              }
            },
          }
        )
        const exp = Date.now() + SHARE_TTL_MS
        shareCacheRef.current.set(rec.id, { id, exp })
        const link = transferShareUrl(id)
        const qr = await QRCode.toDataURL(link, {
          margin: 1,
          width: 256,
          color: { dark: '#18181b', light: '#fafafa' },
        })
        if (abort.signal.aborted) return
        setShare({ phase: 'ready', id, link, qr, exp })
      } catch (err) {
        if (abort.signal.aborted) return
        setShare({ phase: 'error', message: (err as Error).message })
      }
    },
    []
  )

  const copyShareLink = useCallback(
    async (link: string) => {
      try {
        await navigator.clipboard.writeText(link)
        toast({ title: 'Link copied', description: 'Paste it into any chat — it opens here.' })
      } catch {
        toast({ title: 'Could not copy', description: 'Long-press the link text to copy manually.' })
      }
    },
    [toast]
  )

  /* -------- Receive -------- */

  const receiveById = useCallback(
    async (rawId: string) => {
      setReceive({ phase: 'downloading', progress: 0 })
      const abort = new AbortController()
      receiveAbortRef.current = abort
      try {
        const { blob, name, mime } = await downloadTransfer(rawId, {
          signal: abort.signal,
          onProgress: (r, total) => {
            if (!abort.signal.aborted) {
              setReceive({ phase: 'downloading', progress: total > 0 ? r / total : 0 })
            }
          },
        })
        if (blob.size === 0) throw new Error('The transfer arrived empty — try sharing again.')
        const poster = await makePoster(blob)
        const rec: ClipRecord = {
          id: newClipId(),
          name,
          mime: mime.startsWith('video/') ? mime : 'video/mp4',
          size: blob.size,
          poster,
          createdAt: Date.now(),
          origin: 'received',
        }
        await putClip(rec, blob)
        await loadLibrary()
        if (abort.signal.aborted) return
        setReceiveOpen(false)
        setReceive({ phase: 'input' })
        setReceiveInput('')
        toast({ title: 'Video received', description: `“${name}” is now in your library.` })
        void openLibraryClip(rec)
      } catch (err) {
        if (abort.signal.aborted) return
        setReceive({ phase: 'error', message: (err as Error).message })
      }
    },
    [loadLibrary, openLibraryClip, toast]
  )

  const closeReceive = useCallback(() => {
    receiveAbortRef.current?.abort()
    receiveAbortRef.current = null
    if (scanTimerRef.current) {
      window.clearTimeout(scanTimerRef.current)
      scanTimerRef.current = null
    }
    if (scanStreamRef.current) {
      scanStreamRef.current.getTracks().forEach((t) => t.stop())
      scanStreamRef.current = null
    }
    setScanOn(false)
    setReceiveOpen(false)
    setReceive({ phase: 'input' })
    setReceiveInput('')
  }, [])

  /* auto-receive: shell stashes the id when a /?transfer=<id> link opens */
  useEffect(() => {
    const start = (id: string) => {
      setReceiveInput(id)
      setReceiveOpen(true)
      void receiveById(id)
    }
    const pending = takePendingTransfer()
    if (pending) start(pending)
    const onTransfer = () => {
      const id = takePendingTransfer()
      if (id) start(id)
    }
    window.addEventListener('toolhub:transfer', onTransfer)
    return () => window.removeEventListener('toolhub:transfer', onTransfer)
  }, [receiveById])

  /* -------- In-app QR scanner (BarcodeDetector where available) -------- */

  const stopScan = useCallback(() => {
    if (scanTimerRef.current) {
      window.clearTimeout(scanTimerRef.current)
      scanTimerRef.current = null
    }
    if (scanStreamRef.current) {
      scanStreamRef.current.getTracks().forEach((t) => t.stop())
      scanStreamRef.current = null
    }
    setScanOn(false)
  }, [])

  const startScan = useCallback(async () => {
    interface DetectorLike {
      detect(src: CanvasImageSource): Promise<{ rawValue: string }[]>
    }
    const w = window as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => DetectorLike
    }
    if (!w.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      toast({
        title: 'Live scanner not available here',
        description: 'Scan the QR with your phone camera — it opens ToolHub and receives automatically.',
      })
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      scanStreamRef.current = stream
      setScanOn(true)
      const detector = new w.BarcodeDetector({ formats: ['qr_code'] })
      const tick = async () => {
        if (!scanStreamRef.current) return
        const el = scanVideoRef.current
        if (el && el.readyState >= 2) {
          try {
            const codes = await detector.detect(el)
            const raw = codes[0]?.rawValue
            if (raw) {
              stopScan()
              const id = transferIdFromUrl(raw)
              if (id) {
                void receiveById(id)
              } else {
                setReceive({ phase: 'error', message: 'That QR is not a ToolHub transfer code.' })
              }
              return
            }
          } catch {
            /* frame skipped */
          }
        }
        scanTimerRef.current = window.setTimeout(() => void tick(), 350)
      }
      const v = scanVideoRef.current
      if (v) {
        v.srcObject = stream
        await v.play().catch(() => {})
      }
      void tick()
    } catch {
      toast({
        title: 'Camera unavailable',
        description: 'Allow camera access, or scan the QR with your phone camera instead.',
        variant: 'destructive',
      })
    }
  }, [receiveById, stopScan, toast])

  /* -------- Element event handlers (state stays in sync with media) -------- */

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const dur = isFinite(v.duration) ? v.duration : 0
    setDuration(dur)
    setDims({ w: v.videoWidth, h: v.videoHeight })
    setMetaReady(true)
    v.playbackRate = rate
    setTime(v.currentTime)
    // graceful fallback: a clip whose probe failed gets its trim marks here
    if (dur > 0 && sel) {
      if (sel.trimEnd <= 0 || sel.trimEnd > dur) patchClip(sel.id, { trimEnd: dur })
      if (sel.trimStart >= dur) patchClip(sel.id, { trimStart: 0 })
    }
  }, [rate, sel, patchClip])

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current
    if (!v || !sel) return
    const s = sel.trimStart
    const e = sel.trimEnd
    if (trimPreview && e - s > 0.2 && v.currentTime >= e - 0.05) {
      v.currentTime = s
      setTime(s)
      return
    }
    setTime(v.currentTime)
  }, [sel, trimPreview])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v || !metaReady) return
    if (v.paused) {
      void v.play().catch(() => {})
    } else {
      v.pause()
    }
  }, [metaReady])

  const seek = useCallback((value: number) => {
    const v = videoRef.current
    if (v) v.currentTime = value
    setTime(value)
  }, [])

  const applyRate = useCallback((r: number) => {
    setRate(r)
    if (videoRef.current) videoRef.current.playbackRate = r
  }, [])

  const applyVolume = useCallback((val: number) => {
    setVolume(val)
    const v = videoRef.current
    if (v) {
      v.volume = val
      if (val > 0 && v.muted) {
        v.muted = false
        setMuted(false)
      }
    }
  }, [])

  const toggleMute = useCallback((next: boolean) => {
    setMuted(next)
    if (videoRef.current) videoRef.current.muted = next
  }, [])

  const toggleTrimPreview = useCallback(
    (pressed: boolean) => {
      setTrimPreview(pressed)
      const v = videoRef.current
      if (pressed && v && sel && sel.trimEnd - sel.trimStart > 0.2) {
        v.currentTime = sel.trimStart
        setTime(sel.trimStart)
        void v.play().catch(() => {})
      }
    },
    [sel]
  )

  /* -------- Frame capture: download + save to media library -------- */

  const captureFrame = useCallback(async () => {
    const v = videoRef.current
    if (!v || !v.videoWidth || !metaReady || !sel) {
      toast({ title: 'Nothing to capture yet', description: 'Wait for the video to load.' })
      return
    }
    const vw = v.videoWidth
    const vh = v.videoHeight
    const swap = sel.rotation % 180 === 90
    const canvas = document.createElement('canvas')
    canvas.width = swap ? vh : vw
    canvas.height = swap ? vw : vh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    paintFrame(
      ctx,
      v,
      { filter: activeFilter.css, rotation: sel.rotation, flip: sel.flip },
      canvas.width,
      canvas.height
    )
    const dataUrl = canvas.toDataURL('image/png')
    const base = sel.name.replace(/\.[^.]+$/, '') || 'video'
    const filename = `${base}-frame.png`

    const a = document.createElement('a')
    a.href = dataUrl
    a.download = filename
    a.click()

    try {
      await putPhoto({
        id: newPhotoId(),
        dataUrl,
        createdAt: Date.now(),
        fav: false,
        source: 'video',
        name: filename,
      })
      toast({
        title: 'Frame captured',
        description: 'Downloaded as PNG and saved to your Gallery.',
      })
    } catch {
      toast({
        title: 'Frame downloaded',
        description: 'But it could not be saved to the media library.',
        variant: 'destructive',
      })
    }
  }, [metaReady, sel, activeFilter.css, toast])

  /* -------- Combined export: sequential realtime render into one WebM -------- */

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

  const startCombinedExport = useCallback(async () => {
    const c = expCanvasRef.current
    const v = expVideoRef.current
    if (!c || !v || runningRef.current) return
    const choice = exportCodec
    if (!choice) {
      toast({
        title: 'Recording not supported',
        description: 'This browser cannot record WebM video — combined export is disabled here.',
        variant: 'destructive',
      })
      return
    }
    const plan = timeline
      .filter((cl) => cl.trimEnd - cl.trimStart > 0.05)
      .map((cl) => ({ clip: cl, start: cl.trimStart, end: cl.trimEnd }))
    if (plan.length === 0) {
      toast({
        title: 'Nothing to export',
        description: 'Give at least one clip a usable trim first.',
        variant: 'destructive',
      })
      return
    }
    const totalSecs = plan.reduce((s, p) => s + (p.end - p.start), 0)

    /* canvas = biggest source, capped on the long edge; each frame is
       contain-fitted so mixed orientations coexist via letterboxing */
    const maxW = Math.max(2, ...plan.map((p) => p.clip.width || 2))
    const maxH = Math.max(2, ...plan.map((p) => p.clip.height || 2))
    const fit = Math.min(1, EXPORT_LONG_EDGE / Math.max(maxW, maxH))
    const cw = evenize(maxW * fit)
    const ch = evenize(maxH * fit)
    const ctx = c.getContext('2d', { alpha: false })
    if (!ctx) {
      toast({
        title: 'Canvas unavailable',
        description: 'Frame rendering is not possible in this browser.',
        variant: 'destructive',
      })
      return
    }
    c.width = cw
    c.height = ch
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, cw, ch)

    /* the hidden element takes over — silence the editor player */
    try {
      videoRef.current?.pause()
    } catch {
      /* already idle */
    }

    /* --- audio graph: one MediaElementSource on the hidden element,
       reused across clips; audio-less clips contribute silence --- */
    let audioTracks: MediaStreamTrack[] = []
    try {
      const actx = ensureAudioCtx()
      await actx.resume().catch(() => {})
      let node = exportSrcNodeRef.current
      if (!node) {
        node = actx.createMediaElementSource(v)
        exportSrcNodeRef.current = node
      }
      try {
        node.disconnect()
      } catch {
        /* not connected yet */
      }
      const dest = actx.createMediaStreamDestination()
      node.connect(dest)
      audioTracks = dest.stream.getAudioTracks()
      v.muted = false
      v.volume = 1
    } catch {
      v.muted = true
      audioTracks = []
      toast({ title: 'Audio track unavailable', description: 'The combined video will be silent.' })
    }

    /* --- recorder --- */
    const canvasStream = c.captureStream(30)
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks])
    let rec: MediaRecorder
    try {
      rec = new MediaRecorder(stream, {
        mimeType: choice.mime,
        videoBitsPerSecond: EXPORT_VIDEO_BPS,
        audioBitsPerSecond: EXPORT_AUDIO_BPS,
      })
    } catch {
      canvasStream.getTracks().forEach((t) => t.stop())
      audioTracks.forEach((t) => t.stop())
      toast({
        title: 'Recorder failed to start',
        description: 'This browser rejected the WebM recording setup.',
        variant: 'destructive',
      })
      return
    }
    recRef.current = rec
    chunksRef.current = []
    cancelRef.current = false
    exportErrorRef.current = ''
    runningRef.current = true
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    setExportResult(null)
    setExportRun({ pct: 0, exported: 0, total: totalSecs, clipIndex: 0, clipCount: plan.length })

    const stats = { secs: 0 }
    let lastUi = 0

    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }

    rec.onstop = () => {
      runningRef.current = false
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      canvasStream.getTracks().forEach((t) => t.stop())
      audioTracks.forEach((t) => t.stop())
      try {
        exportSrcNodeRef.current?.disconnect()
      } catch {
        /* idle */
      }
      try {
        v.pause()
        v.removeAttribute('src')
        v.load()
      } catch {
        /* idle */
      }
      setExportRun(null)
      const partial = cancelRef.current || exportErrorRef.current !== ''
      const blob = new Blob(chunksRef.current, { type: 'video/webm' })
      chunksRef.current = []
      if (blob.size <= 0) {
        toast({
          title: 'Nothing was recorded',
          description: exportErrorRef.current || 'The clips could not be read — try re-importing them.',
          variant: 'destructive',
        })
        return
      }
      const url = URL.createObjectURL(blob)
      resultUrlRef.current = url
      const fileName = `combined-video-${Date.now()}.webm`
      setExportResult({ url, blob, fileName, size: blob.size, seconds: stats.secs, partial })
      haptic()
      if (!partial) {
        const a = document.createElement('a')
        a.href = url
        a.download = fileName
        a.click()
        toast({
          title: 'Combined video ready',
          description: `${fmtBytes(blob.size)} · ${fmtTime(stats.secs)} — download started.`,
        })
      } else {
        toast({
          title: cancelRef.current ? 'Cancelled — partial kept' : 'Stopped early — partial kept',
          description: exportErrorRef.current || 'Tap Download to save what was rendered.',
        })
      }
    }

    rec.start(500)

    /* --- sequential playback: seek each clip, paint frames until its trim end --- */
    let doneSecs = 0
    for (let i = 0; i < plan.length; i++) {
      if (!runningRef.current || cancelRef.current) break
      const step = plan[i]
      setExportRun((prev) => (prev ? { ...prev, clipIndex: i } : prev))
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, cw, ch)
      const ok = await loadAndSeek(v, step.clip.url, step.start)
      if (!runningRef.current || cancelRef.current) break
      if (!ok) {
        exportErrorRef.current = `Clip ${i + 1} (${step.clip.name}) could not be decoded.`
        break
      }
      v.playbackRate = 1 // real-time encode
      try {
        await v.play()
      } catch {
        exportErrorRef.current = `Clip ${i + 1} (${step.clip.name}) refused to play.`
        break
      }
      const look = { filter: filterCssOf(step.clip), rotation: step.clip.rotation, flip: step.clip.flip }
      await new Promise<void>((resolve) => {
        const tick = () => {
          if (!runningRef.current || cancelRef.current) {
            resolve()
            return
          }
          try {
            paintFrame(ctx, v, look, cw, ch)
          } catch {
            /* frame not ready — skip */
          }
          const t = v.currentTime
          const exported = doneSecs + clamp(t - step.start, 0, step.end - step.start)
          stats.secs = exported
          const nownow = performance.now()
          if (nownow - lastUi >= 220) {
            lastUi = nownow
            setExportRun((prev) =>
              prev
                ? {
                    ...prev,
                    exported,
                    pct: totalSecs > 0 ? clamp((exported / totalSecs) * 100, 0, 100) : 0,
                  }
                : prev
            )
          }
          if (t >= step.end - 0.03 || v.ended) {
            resolve()
            return
          }
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)
      })
      try {
        v.pause()
      } catch {
        /* already paused */
      }
      if (!runningRef.current || cancelRef.current) break
      doneSecs += step.end - step.start
      stats.secs = doneSecs
    }

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop()
    } catch {
      /* already stopped */
    }
  }, [timeline, exportCodec, ensureAudioCtx, toast])

  const cancelExport = useCallback(() => {
    if (!runningRef.current) return
    cancelRef.current = true
    try {
      expVideoRef.current?.pause()
    } catch {
      /* already paused */
    }
    haptic()
  }, [])

  const downloadExport = useCallback(() => {
    const r = exportResult
    if (!r) return
    const a = document.createElement('a')
    a.href = r.url
    a.download = r.fileName
    a.click()
    haptic()
    toast({ title: r.partial ? 'Partial file saved' : 'Download started', description: r.fileName })
  }, [exportResult, toast])

  const dismissExport = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    setExportResult(null)
  }, [])

  const canExport = totalRuntime > 0.2 && !!exportCodec && !exportRun

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl">
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {/* hidden media that powers the combined export */}
      <video
        ref={expVideoRef}
        playsInline
        preload="auto"
        className="pointer-events-none fixed left-0 top-0 -z-50 size-px opacity-0"
      />
      <canvas ref={expCanvasRef} className="pointer-events-none fixed left-0 top-0 -z-50 size-px opacity-0" />

      {/* ---------------- Multi-clip timeline ---------------- */}
      <div className="mb-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <ListVideo className="size-4 text-amber-400" aria-hidden />
          <h2 className="text-sm font-bold tracking-tight text-zinc-100">Timeline</h2>
          <Badge variant="outline" className="border-white/15 text-[11px] tabular-nums text-zinc-400">
            {timeline.length}
          </Badge>
          {totalRuntime > 0 && (
            <Badge variant="outline" className="gap-1 border-emerald-400/40 text-[11px] tabular-nums text-emerald-300">
              <Timer className="size-3" aria-hidden /> {fmtTime(totalRuntime)}
            </Badge>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="ml-auto h-8 gap-1.5 rounded-full border-white/15 bg-white/5 px-3 text-xs font-semibold text-zinc-200 hover:bg-white/10"
          >
            <Plus className="size-3.5" aria-hidden /> Add clips
          </Button>
          {timeline.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => (armedClear ? clearTimeline() : armClear())}
              aria-label={armedClear ? 'Confirm clear timeline' : 'Clear timeline'}
              className={cn(
                'h-8 gap-1.5 rounded-full border px-3 text-xs font-semibold',
                armedClear
                  ? 'border-rose-400/60 bg-rose-500/20 text-rose-200'
                  : 'border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10'
              )}
            >
              <Trash2 className="size-3.5" aria-hidden /> {armedClear ? 'Sure?' : 'Clear'}
            </Button>
          )}
        </div>

        {timeline.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-zinc-400">
            Import one or more clips to build a timeline — trim each one, reorder, then export a single
            combined video. Nothing is uploaded.
          </p>
        ) : (
          <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1" role="list" aria-label="Timeline clips">
            {timeline.map((c, i) => {
              const active = c.id === selectedId
              const confirmingRemove = confirmRemoveId === c.id
              const kept = Math.max(0, c.trimEnd - c.trimStart)
              const isTrimmed = c.duration > 0 && kept < c.duration - 0.05
              return (
                <motion.div
                  key={c.id}
                  layout
                  role="listitem"
                  className={cn(
                    'relative w-32 shrink-0 overflow-hidden rounded-xl border bg-zinc-900/80 text-left',
                    active ? 'border-amber-400/70 ring-2 ring-amber-400/40' : 'border-white/10'
                  )}
                >
                  <button
                    onClick={() => selectClip(c.id)}
                    className="block w-full text-left"
                    aria-label={`Select clip ${c.name}, position ${i + 1}`}
                  >
                    <span className="relative block aspect-video w-full overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-900">
                      {c.thumb ? (
                        <img src={c.thumb} alt="" className="size-full object-cover" loading="lazy" />
                      ) : (
                        <Clapperboard
                          className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-zinc-600"
                          aria-hidden
                        />
                      )}
                      <span className="absolute left-1 top-1 rounded-md bg-amber-400 px-1 py-0.5 text-[9px] font-bold tabular-nums text-zinc-950">
                        #{i + 1}
                      </span>
                      <span
                        className={cn(
                          'absolute right-1 top-1 rounded-md bg-black/60 px-1 py-0.5 text-[9px] font-bold tabular-nums backdrop-blur-sm',
                          isTrimmed ? 'text-rose-300' : 'text-zinc-200'
                        )}
                      >
                        {fmtTime(kept)}
                      </span>
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3">
                        <span className="block truncate text-[11px] font-semibold text-zinc-100">{c.name}</span>
                      </span>
                    </span>
                  </button>
                  <div className="px-1.5 py-1.5">
                    <button
                      onClick={() => (confirmingRemove ? removeTimelineClip(c.id) : armRemove(c.id))}
                      aria-label={confirmingRemove ? `Confirm remove ${c.name} from timeline` : `Remove ${c.name} from timeline`}
                      className={cn(
                        'flex h-7 w-full items-center justify-center gap-1 rounded-lg text-[11px] font-semibold transition-colors',
                        confirmingRemove
                          ? 'bg-rose-500/90 text-white'
                          : 'bg-white/5 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-300'
                      )}
                    >
                      {confirmingRemove ? (
                        <Check className="size-3.5" aria-hidden />
                      ) : (
                        <>
                          <Trash2 className="size-3.5" aria-hidden /> Remove
                        </>
                      )}
                    </button>
                  </div>
                </motion.div>
              )
            })}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[104px] w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 bg-white/[0.03] text-zinc-400 transition-colors hover:border-amber-400/50 hover:text-amber-300"
              aria-label="Add more clips to the timeline"
            >
              <Plus className="size-5" aria-hidden />
              <span className="text-[10px] font-semibold">Add</span>
            </button>
          </div>
        )}

        {/* reorder the selected clip */}
        {sel && timeline.length > 1 && (
          <div className="mt-2 flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => moveSelected(-1)}
              disabled={selIndex <= 0}
              aria-label="Move clip left"
              className="h-11 flex-1 gap-1.5 rounded-xl border-white/15 bg-white/5 text-xs font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-40"
            >
              <ArrowLeft className="size-4" aria-hidden /> Move left
            </Button>
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-zinc-500">
              {selIndex + 1} / {timeline.length}
            </span>
            <Button
              variant="outline"
              onClick={() => moveSelected(1)}
              disabled={selIndex < 0 || selIndex >= timeline.length - 1}
              aria-label="Move clip right"
              className="h-11 flex-1 gap-1.5 rounded-xl border-white/15 bg-white/5 text-xs font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-40"
            >
              Move right <ArrowRight className="size-4" aria-hidden />
            </Button>
          </div>
        )}
      </div>

      {/* ---------------- Clip library rail ---------------- */}
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-2">
          <Film className="size-4 text-amber-400" aria-hidden />
          <h2 className="text-sm font-bold tracking-tight text-zinc-100">My clips</h2>
          <Badge variant="outline" className="border-white/15 text-[11px] tabular-nums text-zinc-400">
            {library.length}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setReceive({ phase: 'input' })
              setReceiveOpen(true)
            }}
            className="ml-auto h-8 gap-1.5 rounded-full border-white/15 bg-white/5 px-3 text-xs font-semibold text-zinc-200 hover:bg-white/10"
          >
            <Download className="size-3.5" aria-hidden /> Receive
          </Button>
        </div>

        {library.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-zinc-400">
            Save a clip here — then every clip gets its own QR code to jump to another device, and your
            timeline restores after a reload.
          </p>
        ) : (
          <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1" role="list" aria-label="Saved clips">
            {library.map((c) => {
              const active = sel?.libraryId === c.id
              const confirming = confirmDeleteId === c.id
              return (
                <motion.div
                  key={c.id}
                  layout
                  role="listitem"
                  className={cn(
                    'group relative w-36 shrink-0 overflow-hidden rounded-xl border bg-zinc-900/80 text-left',
                    active ? 'border-amber-400/70 ring-2 ring-amber-400/40' : 'border-white/10'
                  )}
                >
                  <button
                    onClick={() => void openLibraryClip(c)}
                    className="block w-full text-left"
                    aria-label={`Open clip ${c.name} into the timeline`}
                  >
                    <span className="relative block aspect-video w-full overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-900">
                      {c.poster ? (
                        <img src={c.poster} alt="" className="size-full object-cover" loading="lazy" />
                      ) : (
                        <Clapperboard
                          className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-zinc-600"
                          aria-hidden
                        />
                      )}
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3">
                        <span className="block truncate text-[11px] font-semibold text-zinc-100">{c.name}</span>
                      </span>
                      <span className="absolute right-1 top-1 rounded-md bg-black/60 px-1 py-0.5 text-[9px] font-bold tabular-nums text-zinc-200 backdrop-blur-sm">
                        {c.duration ? fmtTime(c.duration) : fmtBytes(c.size)}
                      </span>
                      {c.origin === 'received' && (
                        <span className="absolute left-1 top-1 rounded-md bg-fuchsia-500/80 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                          QR
                        </span>
                      )}
                    </span>
                  </button>
                  <div className="flex items-center gap-1 px-1.5 py-1.5">
                    <button
                      onClick={() => void startShare(c)}
                      aria-label={`Share ${c.name} with a QR code`}
                      className="flex h-7 flex-1 items-center justify-center gap-1 rounded-lg bg-white/5 text-[11px] font-semibold text-zinc-200 transition-colors hover:bg-white/10"
                    >
                      <QrCode className="size-3.5" aria-hidden /> QR
                    </button>
                    <button
                      onClick={() => (confirming ? void removeLibraryClip(c) : armDelete(c.id))}
                      aria-label={confirming ? `Confirm delete ${c.name}` : `Delete ${c.name}`}
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-lg text-[11px] transition-colors',
                        confirming
                          ? 'bg-rose-500/90 text-white'
                          : 'bg-white/5 text-zinc-400 hover:bg-rose-500/20 hover:text-rose-300'
                      )}
                    >
                      {confirming ? <Check className="size-3.5" aria-hidden /> : <Trash2 className="size-3.5" aria-hidden />}
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        <AnimatePresence mode="wait" initial={false}>
          {/* ---------------- Empty state ---------------- */}
          {!sel && (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center px-6 py-14 text-center"
            >
              <span className="relative flex size-20 items-center justify-center overflow-hidden rounded-[1.4rem] bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-white ring-1 ring-white/25 shadow-[0_18px_40px_-14px_rgb(249_115_22/0.6),inset_0_1px_1px_rgb(255_255_255/0.4)]">
                <Clapperboard className="size-9" strokeWidth={1.8} aria-hidden />
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
              </span>
              <h2 className="mt-5 text-lg font-bold tracking-tight">Edit your videos</h2>
              <p className="mt-1 max-w-sm text-sm text-zinc-400">
                Import one or more clips to build a timeline: per-clip trims, live filters, reordering, and
                one combined export. Nothing is uploaded — editing happens on this device.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                {['Multi-clip timeline', 'Per-clip trim', '7 live filters', 'Combined WebM export', 'QR transfer'].map(
                  (chip) => (
                    <Badge key={chip} variant="outline" className="border-white/15 text-zinc-300">
                      {chip}
                    </Badge>
                  )
                )}
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  className="h-11 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-300 hover:to-orange-400"
                >
                  <Upload className="size-4" aria-hidden /> Import videos
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setReceive({ phase: 'input' })
                    setReceiveOpen(true)
                  }}
                  className="h-11 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Download className="size-4" aria-hidden /> Receive via QR
                </Button>
              </div>
            </motion.div>
          )}

          {/* ---------------- Editor ---------------- */}
          {sel && (
            <motion.div
              key="editor"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4 p-4 sm:p-5"
            >
              {/* Stage */}
              <div className="relative flex h-[52vh] items-center justify-center overflow-hidden rounded-2xl bg-black sm:h-[60vh]">
                <video
                  ref={videoRef}
                  src={sel.url}
                  preload="metadata"
                  loop={loop}
                  onClick={togglePlay}
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                  className={cn(
                    'cursor-pointer object-contain',
                    rotated ? 'h-full w-auto max-w-full' : 'max-h-full w-full'
                  )}
                  style={{
                    transform: `rotate(${sel.rotation}deg) scaleX(${sel.flip ? -1 : 1})`,
                    filter: activeFilter.css === 'none' ? undefined : activeFilter.css,
                  }}
                />
                {!metaReady && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
                    <Loader2 className="size-8 animate-spin text-amber-400" aria-hidden />
                    <p className="text-sm text-zinc-300">Loading video…</p>
                  </div>
                )}
              </div>

              {/* File info bar */}
              <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
                <Film className="size-4 shrink-0 text-amber-400" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{sel.name}</span>
                {sel.libraryId && (
                  <Badge variant="outline" className="shrink-0 border-amber-400/40 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                    In library
                  </Badge>
                )}
                {metaReady && dims && (
                  <Badge variant="outline" className="shrink-0 border-white/15 text-[11px] tabular-nums text-zinc-300">
                    {fmtTime(duration)} · {dims.w}×{dims.h}
                  </Badge>
                )}
              </div>

              {/* Transport */}
              <div className="flex items-center gap-3">
                <Button
                  size="icon"
                  onClick={togglePlay}
                  disabled={!metaReady}
                  aria-label={playing ? 'Pause' : 'Play'}
                  className="size-12 shrink-0 rounded-full bg-amber-400 text-zinc-950 shadow-md hover:bg-amber-300 disabled:opacity-40"
                >
                  {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
                </Button>
                <span className="font-mono text-sm tabular-nums text-zinc-300" aria-live="off">
                  {fmtTime(time)} <span className="text-zinc-500">/ {fmtTime(duration)}</span>
                </span>
                <Toggle
                  pressed={loop}
                  onPressedChange={setLoop}
                  aria-label="Loop playback"
                  className="ml-auto h-10 gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-200 hover:bg-white/10 data-[state=on]:bg-amber-400/20 data-[state=on]:text-amber-300"
                >
                  <Repeat className="size-4" aria-hidden /> Loop
                </Toggle>
              </div>

              {/* Seek bar */}
              <Slider
                value={[Math.min(time, duration || 0)]}
                max={duration || 0}
                min={0}
                step={0.05}
                disabled={!metaReady}
                onValueChange={(val) => seek(val[0] ?? 0)}
                aria-label="Seek"
                className="[&_[data-slot=slider-range]]:bg-amber-400 [&_[data-slot=slider-thumb]]:border-amber-400 [&_[data-slot=slider-track]]:bg-white/15"
              />

              {/* Volume + speed */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="flex items-center gap-2">
                  <Toggle
                    pressed={muted}
                    onPressedChange={toggleMute}
                    aria-label={muted ? 'Unmute' : 'Mute'}
                    className="size-10 rounded-full border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 data-[state=on]:bg-rose-500/20 data-[state=on]:text-rose-300"
                  >
                    {muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
                  </Toggle>
                  <Slider
                    value={[muted ? 0 : volume]}
                    min={0}
                    max={1}
                    step={0.05}
                    disabled={!metaReady}
                    onValueChange={(val) => applyVolume(val[0] ?? 0)}
                    aria-label="Volume"
                    className="w-24 [&_[data-slot=slider-range]]:bg-amber-400 [&_[data-slot=slider-thumb]]:border-amber-400 [&_[data-slot=slider-track]]:bg-white/15"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Playback speed">
                  {SPEEDS.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => applyRate(s.value)}
                      aria-pressed={rate === s.value}
                      className={cn(
                        'h-9 rounded-full border px-3 text-xs font-semibold transition-all',
                        rate === s.value
                          ? 'border-transparent bg-amber-400 text-zinc-950 shadow'
                          : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                      )}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filters (per clip) */}
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Live filters">
                {FILTERS.map((f) => {
                  const selected = f.id === sel.filterId
                  return (
                    <button
                      key={f.id}
                      onClick={() => patchSel({ filterId: f.id })}
                      aria-pressed={selected}
                      className={cn(
                        'flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-all',
                        selected
                          ? 'border-transparent bg-amber-400 text-zinc-950 shadow-md ring-2 ring-amber-300/50'
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

              {/* Transform (per clip) */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => patchSel({ rotation: ((sel.rotation + 90) % 360) })}
                  aria-label={`Rotate 90 degrees. Current rotation ${sel.rotation} degrees.`}
                  className={cn(
                    'flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors',
                    sel.rotation !== 0
                      ? 'border-amber-400/40 bg-amber-400/15 text-amber-300'
                      : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
                  )}
                >
                  <RotateCw className="size-4" aria-hidden /> Rotate 90°
                  {sel.rotation !== 0 && (
                    <Badge variant="outline" className="border-amber-400/40 text-[10px] text-amber-300">
                      {sel.rotation}°
                    </Badge>
                  )}
                </button>
                <button
                  onClick={() => patchSel({ flip: !sel.flip })}
                  aria-pressed={sel.flip}
                  className={cn(
                    'flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors',
                    sel.flip
                      ? 'border-amber-400/40 bg-amber-400/15 text-amber-300'
                      : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
                  )}
                >
                  <FlipHorizontal2 className="size-4" aria-hidden /> Flip horizontal
                </button>
              </div>

              {/* Trim (per clip) */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2">
                  <Scissors className="size-4 text-rose-400" aria-hidden />
                  <h3 className="text-sm font-bold tracking-tight">Trim</h3>
                  <Badge variant="outline" className="border-white/15 text-[11px] tabular-nums text-zinc-400">
                    clip {selIndex + 1}
                  </Badge>
                  {metaReady && (
                    <Badge
                      variant="outline"
                      className="ml-auto border-rose-400/40 text-[11px] tabular-nums text-rose-300"
                    >
                      {trimmedDuration.toFixed(1)}s kept
                    </Badge>
                  )}
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-300">Start</span>
                      <span className="font-mono tabular-nums text-zinc-400">{fmtTime(sel.trimStart)}</span>
                    </div>
                    <Slider
                      value={[sel.trimStart]}
                      min={0}
                      max={Math.max(0.2, duration - 0.2)}
                      step={0.1}
                      disabled={!metaReady}
                      onValueChange={(val) =>
                        patchSel({ trimStart: Math.min(val[0] ?? 0, Math.max(0, sel.trimEnd - 0.2)) })
                      }
                      aria-label="Trim start"
                      className="[&_[data-slot=slider-range]]:bg-rose-500 [&_[data-slot=slider-thumb]]:border-rose-500 [&_[data-slot=slider-track]]:bg-white/15"
                    />
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-300">End</span>
                      <span className="font-mono tabular-nums text-zinc-400">{fmtTime(sel.trimEnd)}</span>
                    </div>
                    <Slider
                      value={[sel.trimEnd]}
                      min={0.2}
                      max={duration || 0.2}
                      step={0.1}
                      disabled={!metaReady}
                      onValueChange={(val) =>
                        patchSel({ trimEnd: Math.max(val[0] ?? 0, sel.trimStart + 0.2) })
                      }
                      aria-label="Trim end"
                      className="[&_[data-slot=slider-range]]:bg-rose-500 [&_[data-slot=slider-thumb]]:border-rose-500 [&_[data-slot=slider-track]]:bg-white/15"
                    />
                  </div>
                </div>
                <Toggle
                  pressed={trimPreview}
                  onPressedChange={toggleTrimPreview}
                  disabled={!metaReady || trimmedDuration <= 0.2}
                  aria-label="Preview trim"
                  className="mt-4 h-10 w-full gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200 hover:bg-white/10 data-[state=on]:bg-rose-500/20 data-[state=on]:text-rose-300"
                >
                  <Play className="size-4" aria-hidden />
                  {trimPreview ? 'Previewing trim — loops between marks' : 'Preview trim'}
                </Toggle>
              </div>

              {/* Combined export */}
              <div className="rounded-2xl border border-emerald-400/20 bg-white/5 p-4">
                <div className="flex items-center gap-2">
                  <ListVideo className="size-4 text-emerald-400" aria-hidden />
                  <h3 className="text-sm font-bold tracking-tight">Combined export</h3>
                  {exportCodec && (
                    <Badge
                      variant="outline"
                      className="ml-auto border-emerald-400/40 text-[11px] text-emerald-300"
                    >
                      {exportCodec.label}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                  Plays all {timeline.length} clip{timeline.length === 1 ? '' : 's'} back to back into one
                  WebM — each with its own trim, filter, rotation and flip. Runtime{' '}
                  <span className="font-bold tabular-nums text-zinc-200">{fmtTime(totalRuntime)}</span>. The
                  encode runs in real time, so keep this tab open.
                </p>

                {!exportRun && (
                  <Button
                    onClick={() => void startCombinedExport()}
                    disabled={!canExport}
                    className="mt-3 h-11 w-full gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-500 font-semibold text-zinc-950 shadow-lg hover:from-emerald-300 hover:to-teal-400 disabled:opacity-40"
                  >
                    <Clapperboard className="size-4" aria-hidden />
                    Export combined video ({fmtTime(totalRuntime)})
                  </Button>
                )}

                {exportRun && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                    className="mt-3 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                        <Loader2 className="size-4 shrink-0 animate-spin text-emerald-300" aria-hidden />
                        <span className="truncate">
                          Rendering clip {exportRun.clipIndex + 1} of {exportRun.clipCount}…
                        </span>
                      </p>
                      <p className="text-lg font-bold tabular-nums text-emerald-300" aria-live="polite">
                        {Math.round(exportRun.pct)}%
                      </p>
                    </div>
                    <div className="h-3 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-[width] duration-200"
                        style={{ width: `${exportRun.pct}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 text-xs tabular-nums text-zinc-400">
                        {fmtTime(exportRun.exported)} / {fmtTime(exportRun.total)} rendered
                      </p>
                      <Button
                        variant="outline"
                        onClick={cancelExport}
                        className="h-10 gap-1.5 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10"
                      >
                        <Square className="size-3.5" aria-hidden /> Cancel
                      </Button>
                    </div>
                  </motion.div>
                )}

                {exportResult && !exportRun && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 26 }}
                    className="mt-3 space-y-2 rounded-xl border border-emerald-400/25 bg-emerald-400/5 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-emerald-300" aria-hidden />
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold">{exportResult.fileName}</p>
                      {exportResult.partial && (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-400/40 text-[10px] font-semibold uppercase tracking-wide text-amber-300"
                        >
                          Partial
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs tabular-nums text-zinc-400">
                      {fmtBytes(exportResult.size)} · {fmtTime(exportResult.seconds)} rendered
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={downloadExport}
                        className="h-10 flex-1 rounded-xl bg-emerald-500 font-semibold text-white hover:bg-emerald-400"
                      >
                        <Download className="size-4" aria-hidden />
                        {exportResult.partial ? 'Download partial' : 'Download again'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={dismissExport}
                        aria-label="Dismiss export result"
                        className="h-10 w-10 shrink-0 rounded-xl border-white/15 bg-transparent p-0 text-zinc-400 hover:bg-white/10"
                      >
                        <X className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </motion.div>
                )}
              </div>

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button
                  onClick={() => void captureFrame()}
                  disabled={!metaReady}
                  className="h-11 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-300 hover:to-orange-400"
                >
                  <Camera className="size-4" aria-hidden /> Frame
                </Button>
                {!sel.libraryId && (
                  <Button
                    onClick={() => void saveSelectedToLibrary()}
                    disabled={saving}
                    className="h-11 rounded-xl bg-white/10 font-semibold text-zinc-100 hover:bg-white/15"
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                    Save
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-11 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Upload className="size-4" aria-hidden /> Add clips
                </Button>
                {sel.libraryId && (
                  <Button
                    onClick={() => {
                      const rec = library.find((c) => c.id === sel.libraryId)
                      if (rec) void startShare(rec)
                    }}
                    className="h-11 rounded-xl bg-fuchsia-600 font-semibold text-white shadow-lg hover:bg-fuchsia-500"
                  >
                    <QrCode className="size-4" aria-hidden /> QR
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ---------------- QR share modal ---------------- */}
      <AnimatePresence>
        {shareClip && (
          <motion.div
            key="share"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeShare()
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Share clip with a QR code"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-fuchsia-500/20 text-fuchsia-300">
                  <QrCode className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-bold">Share “{shareClip.name}”</h3>
                  <p className="text-[11px] text-zinc-400">Scan on any device to receive instantly</p>
                </div>
                <button
                  onClick={closeShare}
                  aria-label="Close share dialog"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              {share.phase === 'uploading' && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="relative flex size-24 items-center justify-center">
                    <svg viewBox="0 0 100 100" className="size-24 -rotate-90">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="8" />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke="rgb(217 70 239)"
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 42}
                        strokeDashoffset={2 * Math.PI * 42 * (1 - share.progress)}
                      />
                    </svg>
                    <span className="absolute text-sm font-bold tabular-nums">{Math.round(share.progress * 100)}%</span>
                  </div>
                  <p className="text-xs text-zinc-400">Uploading to the transfer relay… keep this open</p>
                </div>
              )}

              {share.phase === 'ready' && (
                <div className="flex flex-col items-center gap-3">
                  <div className="rounded-2xl bg-zinc-100 p-2.5 shadow-[0_0_40px_-8px_rgb(217_70_239/0.45)]">
                    <img src={share.qr} alt="QR code with the transfer link" className="size-52" />
                  </div>
                  <div className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-400" title={share.link}>
                      {share.link}
                    </span>
                    <button
                      onClick={() => void copyShareLink(share.link)}
                      aria-label="Copy link"
                      className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-zinc-200 hover:bg-white/20"
                    >
                      <Copy className="size-3.5" aria-hidden />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <ScanLine className="size-3.5" aria-hidden />
                    Expires in <span className="font-bold tabular-nums text-zinc-200">{shareCountdown}</span>
                    <span aria-hidden>·</span>
                    <span>{fmtBytes(shareClip.size)}</span>
                  </div>
                </div>
              )}

              {share.phase === 'error' && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <p className="text-sm text-rose-300">{share.message}</p>
                  <Button
                    onClick={() => void startShare(shareClip)}
                    className="h-10 rounded-xl bg-fuchsia-600 font-semibold text-white hover:bg-fuchsia-500"
                  >
                    Try again
                  </Button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Receive modal ---------------- */}
      <AnimatePresence>
        {receiveOpen && (
          <motion.div
            key="receive"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget && receive.phase !== 'downloading') closeReceive()
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Receive a video"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-amber-400/20 text-amber-300">
                  <Download className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold">Receive a video</h3>
                  <p className="text-[11px] text-zinc-400">Scan the sender’s QR or paste its link</p>
                </div>
                <button
                  onClick={closeReceive}
                  disabled={receive.phase === 'downloading'}
                  aria-label="Close receive dialog"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-40"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              {receive.phase === 'input' && !scanOn && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      value={receiveInput}
                      onChange={(e) => setReceiveInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const id = transferIdFromUrl(receiveInput)
                          if (id) void receiveById(id)
                          else setReceive({ phase: 'error', message: 'That does not look like a transfer link or code.' })
                        }
                      }}
                      placeholder="Paste link or code — e.g. …/?transfer=t…"
                      aria-label="Transfer link or code"
                      className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400/50 focus:outline-none"
                    />
                    <Button
                      onClick={() => {
                        const id = transferIdFromUrl(receiveInput)
                        if (id) void receiveById(id)
                        else setReceive({ phase: 'error', message: 'That does not look like a transfer link or code.' })
                      }}
                      className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-zinc-950 hover:from-amber-300 hover:to-orange-400"
                    >
                      Get
                    </Button>
                  </div>
                  <Button
                    onClick={() => void startScan()}
                    variant="outline"
                    className="h-11 w-full gap-2 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10"
                  >
                    <ScanLine className="size-4" aria-hidden /> Scan QR with camera
                  </Button>
                  <p className="text-center text-[11px] leading-relaxed text-zinc-500">
                    Or simply scan the sender’s QR with your phone camera — ToolHub opens and receives automatically.
                  </p>
                </div>
              )}

              {scanOn && (
                <div className="space-y-3">
                  <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-black">
                    <video ref={scanVideoRef} muted playsInline className="size-full object-cover" />
                    <div className="pointer-events-none absolute inset-8 rounded-2xl border-2 border-amber-400/70 shadow-[0_0_0_9999px_rgb(0_0_0/0.45)]" />
                    <ScanLine className="pointer-events-none absolute left-1/2 top-1/2 size-8 -translate-x-1/2 -translate-y-1/2 animate-pulse text-amber-300" aria-hidden />
                  </div>
                  <Button
                    onClick={stopScan}
                    variant="outline"
                    className="h-10 w-full rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10"
                  >
                    Stop camera
                  </Button>
                </div>
              )}

              {receive.phase === 'downloading' && (
                <div className="flex flex-col items-center gap-4 py-6">
                  <div className="relative flex size-24 items-center justify-center">
                    <svg viewBox="0 0 100 100" className="size-24 -rotate-90">
                      <circle cx="50" cy="50" r="42" fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="8" />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke="rgb(251 191 36)"
                        strokeWidth="8"
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 42}
                        strokeDashoffset={2 * Math.PI * 42 * (1 - receive.progress)}
                      />
                    </svg>
                    <span className="absolute text-sm font-bold tabular-nums">{Math.round(receive.progress * 100)}%</span>
                  </div>
                  <p className="text-xs text-zinc-400">Receiving video… it lands in your library automatically</p>
                </div>
              )}

              {receive.phase === 'error' && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <p className="text-sm text-rose-300">{receive.message}</p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        setReceive({ phase: 'input' })
                        setScanOn(false)
                      }}
                      variant="outline"
                      className="h-10 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10"
                    >
                      Back
                    </Button>
                    {receiveInput && (
                      <Button
                        onClick={() => {
                          const id = transferIdFromUrl(receiveInput)
                          if (id) void receiveById(id)
                        }}
                        className="h-10 rounded-xl bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
                      >
                        Retry
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
