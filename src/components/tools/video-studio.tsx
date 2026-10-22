'use client'

/**
 * Video Studio — the device's video tool.
 *
 * Edit:   import a clip, watch it with live CSS filters, rotate/flip, scrub,
 *         change speed/volume/loop, trim with a looping preview, and capture
 *         the current frame (PNG download + saved into the shared media library).
 * Library: imported clips persist in IndexedDB — every clip gets a one-tap
 *         QR code that ships it to any other device running ToolHub.
 * Receive: paste a transfer link, scan the QR in-app, or just open a
 *         /?transfer=<id> link — the clip lands here automatically.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import QRCode from 'qrcode'
import {
  Camera,
  Check,
  Clapperboard,
  Copy,
  Download,
  Film,
  FlipHorizontal2,
  Loader2,
  Pause,
  Play,
  QrCode,
  Repeat,
  RotateCw,
  ScanLine,
  Scissors,
  Save,
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
/* Component                                                           */
/* ================================================================== */

export default function VideoStudioApp() {
  const { toast } = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const urlRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<File | null>(null)

  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoName, setVideoName] = useState('')
  const [currentClipId, setCurrentClipId] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const [metaReady, setMetaReady] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [loop, setLoop] = useState(false)
  const [filterId, setFilterId] = useState('normal')
  const [rotation, setRotation] = useState(0)
  const [flip, setFlip] = useState(false)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [trimPreview, setTrimPreview] = useState(false)

  /* -------- clip library -------- */
  const [clips, setClips] = useState<ClipRecord[]>([])
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

  const activeFilter = FILTERS.find((f) => f.id === filterId) ?? FILTERS[0]
  const rotated = rotation % 180 === 90

  /* Revoke the current object URL when the app unmounts */
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
      shareAbortRef.current?.abort()
      receiveAbortRef.current?.abort()
      if (scanStreamRef.current) scanStreamRef.current.getTracks().forEach((t) => t.stop())
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current)
    }
  }, [])


  /* countdown ticker while a share modal is open */
  useEffect(() => {
    if (!shareClip) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [shareClip])

  const loadClips = useCallback(async () => {
    setClips(await listClips())
  }, [])

  useEffect(() => {
    void loadClips()
  }, [loadClips])

  /* -------- Import & reset -------- */

  const resetForNewFile = useCallback(() => {
    setPlaying(false)
    setTime(0)
    setDuration(0)
    setDims(null)
    setMetaReady(false)
    setTrimStart(0)
    setTrimEnd(0)
    setTrimPreview(false)
    setFilterId('normal')
    setRotation(0)
    setFlip(false)
    setRate(1)
    setLoop(false)
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
      const url = URL.createObjectURL(file)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = url
      fileRef.current = file
      resetForNewFile()
      setVideoUrl(url)
      setVideoName(file.name)
      setCurrentClipId(null)
    },
    [resetForNewFile, toast]
  )

  const openClipIntoEditor = useCallback(
    async (rec: ClipRecord) => {
      const blob = await getClipBlob(rec.id)
      if (!blob) {
        toast({ title: 'Clip data missing', description: 'Try re-importing the video.', variant: 'destructive' })
        return
      }
      const url = URL.createObjectURL(blob)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = url
      fileRef.current = null // already in the library
      resetForNewFile()
      setVideoUrl(url)
      setVideoName(rec.name)
      setCurrentClipId(rec.id)
    },
    [resetForNewFile, toast]
  )

  const changeVideo = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    fileRef.current = null
    resetForNewFile()
    setVideoUrl(null)
    setVideoName('')
    setCurrentClipId(null)
  }, [resetForNewFile])

  /* -------- Library: save / delete -------- */

  const saveCurrentToLibrary = useCallback(async () => {
    const file = fileRef.current
    if (!file) return
    setSaving(true)
    try {
      const poster = (videoRef.current ? posterFromElement(videoRef.current) : undefined) ?? (await makePoster(file))
      const rec: ClipRecord = {
        id: newClipId(),
        name: file.name,
        mime: file.type || 'video/mp4',
        size: file.size,
        duration: duration > 0 ? duration : undefined,
        poster,
        createdAt: Date.now(),
        origin: 'import',
      }
      await putClip(rec, file)
      setCurrentClipId(rec.id)
      await loadClips()
      toast({ title: 'Saved to your library', description: 'Now shareable with a QR code.' })
    } catch {
      toast({
        title: 'Could not save',
        description: 'Storage may be full — try a smaller clip.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [duration, loadClips, toast])

  const armDelete = useCallback((id: string) => {
    setConfirmDeleteId((prev) => (prev === id ? null : id))
    if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current)
    confirmTimerRef.current = window.setTimeout(() => setConfirmDeleteId(null), 2600)
  }, [])

  const removeClip = useCallback(
    async (rec: ClipRecord) => {
      try {
        await deleteClip(rec.id)
        shareCacheRef.current.delete(rec.id)
        if (currentClipId === rec.id) {
          changeVideo()
        }
        await loadClips()
        setConfirmDeleteId(null)
        toast({ title: 'Clip deleted', description: rec.name })
      } catch {
        toast({ title: 'Could not delete', variant: 'destructive' })
      }
    },
    [changeVideo, currentClipId, loadClips, toast]
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
        await loadClips()
        if (abort.signal.aborted) return
        setReceiveOpen(false)
        setReceive({ phase: 'input' })
        setReceiveInput('')
        toast({ title: 'Video received', description: `“${name}” is now in your library.` })
        void openClipIntoEditor(rec)
      } catch (err) {
        if (abort.signal.aborted) return
        setReceive({ phase: 'error', message: (err as Error).message })
      }
    },
    [loadClips, openClipIntoEditor, toast]
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
    setTrimStart(0)
    setTrimEnd(dur)
    setMetaReady(true)
    v.playbackRate = rate
    setTime(v.currentTime)
  }, [rate])

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (trimPreview && trimEnd > trimStart && v.currentTime >= trimEnd - 0.05) {
      v.currentTime = trimStart
      setTime(trimStart)
      return
    }
    setTime(v.currentTime)
  }, [trimPreview, trimStart, trimEnd])

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
      if (pressed && v && duration > 0 && trimEnd > trimStart) {
        v.currentTime = trimStart
        setTime(trimStart)
        void v.play().catch(() => {})
      }
    },
    [duration, trimStart, trimEnd]
  )

  /* -------- Frame capture: download + save to media library -------- */

  const captureFrame = useCallback(async () => {
    const v = videoRef.current
    if (!v || !v.videoWidth || !metaReady) {
      toast({ title: 'Nothing to capture yet', description: 'Wait for the video to load.' })
      return
    }
    const vw = v.videoWidth
    const vh = v.videoHeight
    const swap = rotation % 180 === 90
    const canvas = document.createElement('canvas')
    canvas.width = swap ? vh : vw
    canvas.height = swap ? vw : vh
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    try {
      ctx.filter = activeFilter.css
    } catch {
      /* ignore unsupported filters */
    }
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(flip ? -1 : 1, 1)
    ctx.drawImage(v, -vw / 2, -vh / 2, vw, vh)
    const dataUrl = canvas.toDataURL('image/png')
    const base = videoName.replace(/\.[^.]+$/, '') || 'video'
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
  }, [metaReady, rotation, flip, activeFilter.css, videoName, toast])

  const trimmedDuration = Math.max(0, trimEnd - trimStart)
  const shareExpIn = share.phase === 'ready' ? Math.max(0, share.exp - now) : 0
  const shareCountdown =
    share.phase === 'ready'
      ? `${Math.floor(shareExpIn / 60000)}:${String(Math.floor((shareExpIn % 60000) / 1000)).padStart(2, '0')}`
      : ''

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl">
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

      {/* ---------------- Clip library rail ---------------- */}
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-2">
          <Film className="size-4 text-amber-400" aria-hidden />
          <h2 className="text-sm font-bold tracking-tight text-zinc-100">My clips</h2>
          <Badge variant="outline" className="border-white/15 text-[11px] tabular-nums text-zinc-400">
            {clips.length}
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

        {clips.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-zinc-400">
            Save an imported clip here — then every clip gets its own QR code to jump to another device.
          </p>
        ) : (
          <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1" role="list" aria-label="Saved clips">
            {clips.map((c) => {
              const active = currentClipId === c.id
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
                    onClick={() => void openClipIntoEditor(c)}
                    className="block w-full text-left"
                    aria-label={`Open clip ${c.name}`}
                  >
                    <span className="relative block aspect-video w-full overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-900">
                      {c.poster ? (
                        <img src={c.poster} alt="" className="size-full object-cover" loading="lazy" />
                      ) : (
                        <Clapperboard className="absolute left-1/2 top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-zinc-600" aria-hidden />
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
                      onClick={() => (confirming ? void removeClip(c) : armDelete(c.id))}
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
          {!videoUrl && (
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
              <h2 className="mt-5 text-lg font-bold tracking-tight">Edit your video</h2>
              <p className="mt-1 max-w-sm text-sm text-zinc-400">
                Import a clip to trim, apply live filters, rotate, and grab perfect frames. Nothing is
                uploaded — editing happens on this device.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                {['Trim', '7 live filters', 'Rotate & flip', 'QR transfer'].map((chip) => (
                  <Badge key={chip} variant="outline" className="border-white/15 text-zinc-300">
                    {chip}
                  </Badge>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  className="h-11 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-300 hover:to-orange-400"
                >
                  <Upload className="size-4" aria-hidden /> Import a video
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
          {videoUrl && (
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
                  src={videoUrl}
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
                    transform: `rotate(${rotation}deg) scaleX(${flip ? -1 : 1})`,
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
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{videoName}</span>
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

              {/* Filters */}
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Live filters">
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

              {/* Transform */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  aria-label={`Rotate 90 degrees. Current rotation ${rotation} degrees.`}
                  className={cn(
                    'flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors',
                    rotation !== 0
                      ? 'border-amber-400/40 bg-amber-400/15 text-amber-300'
                      : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
                  )}
                >
                  <RotateCw className="size-4" aria-hidden /> Rotate 90°
                  {rotation !== 0 && (
                    <Badge variant="outline" className="border-amber-400/40 text-[10px] text-amber-300">
                      {rotation}°
                    </Badge>
                  )}
                </button>
                <button
                  onClick={() => setFlip((f) => !f)}
                  aria-pressed={flip}
                  className={cn(
                    'flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors',
                    flip
                      ? 'border-amber-400/40 bg-amber-400/15 text-amber-300'
                      : 'border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10'
                  )}
                >
                  <FlipHorizontal2 className="size-4" aria-hidden /> Flip horizontal
                </button>
              </div>

              {/* Trim */}
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2">
                  <Scissors className="size-4 text-rose-400" aria-hidden />
                  <h3 className="text-sm font-bold tracking-tight">Trim</h3>
                  {metaReady && (
                    <Badge variant="outline" className="ml-auto border-rose-400/40 text-[11px] tabular-nums text-rose-300">
                      {trimmedDuration.toFixed(1)}s kept
                    </Badge>
                  )}
                </div>
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-300">Start</span>
                      <span className="font-mono tabular-nums text-zinc-400">{fmtTime(trimStart)}</span>
                    </div>
                    <Slider
                      value={[trimStart]}
                      min={0}
                      max={Math.max(0.2, duration - 0.2)}
                      step={0.1}
                      disabled={!metaReady}
                      onValueChange={(val) => setTrimStart(Math.min(val[0] ?? 0, Math.max(0, trimEnd - 0.2)))}
                      aria-label="Trim start"
                      className="[&_[data-slot=slider-range]]:bg-rose-500 [&_[data-slot=slider-thumb]]:border-rose-500 [&_[data-slot=slider-track]]:bg-white/15"
                    />
                  </div>
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs">
                      <span className="font-semibold text-zinc-300">End</span>
                      <span className="font-mono tabular-nums text-zinc-400">{fmtTime(trimEnd)}</span>
                    </div>
                    <Slider
                      value={[trimEnd]}
                      min={0.2}
                      max={duration || 0.2}
                      step={0.1}
                      disabled={!metaReady}
                      onValueChange={(val) => setTrimEnd(Math.max(val[0] ?? 0, trimStart + 0.2))}
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

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button
                  onClick={() => void captureFrame()}
                  disabled={!metaReady}
                  className="h-11 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-300 hover:to-orange-400"
                >
                  <Camera className="size-4" aria-hidden /> Frame
                </Button>
                {!currentClipId && (
                  <Button
                    onClick={() => void saveCurrentToLibrary()}
                    disabled={saving}
                    className="h-11 rounded-xl bg-white/10 font-semibold text-zinc-100 hover:bg-white/15"
                  >
                    {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
                    Save
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={changeVideo}
                  className="h-11 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Upload className="size-4" aria-hidden /> Import
                </Button>
                {currentClipId && (
                  <Button
                    onClick={() => {
                      const rec = clips.find((c) => c.id === currentClipId)
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
