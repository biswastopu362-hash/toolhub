'use client'

/**
 * Video Player — watch everything in one cinema-grade surface.
 *
 * Library tab: clips saved by Video Studio (editor) and videos received
 *              through QR transfer — all stored locally in IndexedDB.
 * Device tab:  every video on the connected device folder, streamed straight
 *              from disk via the File System Access API (no uploading).
 *
 * Premium playback: resume position, ±10s hops, speed, loop, PiP,
 * fullscreen, keyboard shortcuts and auto-advance through the list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  FolderInput,
  FolderOpen,
  Loader2,
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  TriangleAlert,
  Usb,
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
import { getClipBlob, importVideoFile, listClips, type ClipRecord } from '@/lib/video-db'
import { useDeviceThumb } from '@/hooks/use-device-thumb'
import {
  accessState,
  connectRoot,
  entryUrl,
  ensureFreshIndex,
  fsSupported,
  getRoot,
  listEntries,
  requestAccess,
  type DeviceEntry,
} from '@/lib/device-media'

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

type PlaySource = { kind: 'clip'; rec: ClipRecord } | { kind: 'device'; entry: DeviceEntry }

const fmtTime = (t: number) => {
  const safe = isFinite(t) && t > 0 ? t : 0
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = Math.floor(safe % 60)
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return (h > 0 ? `${h}:${mm}` : mm) + ':' + String(s).padStart(2, '0')
}

const fmtBytes = (n: number) => {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

const SPEEDS = [0.5, 1, 1.25, 1.5, 2]

function posKeyOf(s: PlaySource): string {
  return `toolhub-vp:${s.kind}:${s.kind === 'clip' ? s.rec.id : s.entry.id}`
}

function nameOf(s: PlaySource): string {
  return s.kind === 'clip' ? s.rec.name : s.entry.name
}

function sourceId(s: PlaySource): string {
  return s.kind === 'clip' ? s.rec.id : s.entry.id
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function VideoPlayerApp() {
  const { toast } = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const urlRef = useRef<string | null>(null)
  const lastSaveRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [tab, setTab] = useState<'library' | 'device'>('library')
  const [clips, setClips] = useState<ClipRecord[]>([])
  const [loadingClips, setLoadingClips] = useState(true)

  const [source, setSource] = useState<PlaySource | null>(null)
  const [srcUrl, setSrcUrl] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [importing, setImporting] = useState(0)

  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [loop, setLoop] = useState(false)

  /* device tab */
  const [devState, setDevState] = useState<'idle' | 'loading' | 'connect' | 'allow' | 'ready' | 'unsupported'>('idle')
  const [devEntries, setDevEntries] = useState<DeviceEntry[]>([])
  const [devBusy, setDevBusy] = useState(false)

  const loadClips = useCallback(async () => {
    setLoadingClips(true)
    setClips(await listClips())
    setLoadingClips(false)
  }, [])

  useEffect(() => {
    void loadClips()
  }, [loadClips])

  const bootDevice = useCallback(async () => {
    if (!fsSupported()) {
      setDevState('unsupported')
      return
    }
    setDevState('loading')
    const root = await getRoot()
    if (!root) {
      setDevState('connect')
      return
    }
    if ((await accessState(root)) !== 'granted') {
      setDevState('allow')
      return
    }
    setDevState('ready')
    setDevBusy(true)
    try {
      await ensureFreshIndex()
      const entries = (await listEntries({ dir: false, kinds: ['video'] })).sort(
        (a, b) => b.lastModified - a.lastModified
      )
      setDevEntries(entries)
    } catch {
      toast({ title: 'Could not read the device index', description: 'Try refreshing.', variant: 'destructive' })
    } finally {
      setDevBusy(false)
    }
  }, [toast])

  useEffect(() => {
    if (tab === 'device' && devState === 'idle') void bootDevice()
  }, [tab, devState, bootDevice])

  /* ---------------- open / close sources ---------------- */

  const closeSource = useCallback(() => {
    const v = videoRef.current
    if (v && isFinite(v.currentTime) && source) {
      try {
        localStorage.setItem(posKeyOf(source), String(v.currentTime))
      } catch {
        /* storage full — ignore */
      }
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setSource(null)
    setSrcUrl(null)
    setPlaying(false)
    setTime(0)
    setDuration(0)
  }, [source])

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

  const openSource = useCallback(
    async (s: PlaySource) => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
      setSource(s)
      setSrcUrl(null)
      setMediaError(null)
      setPlaying(false)
      setTime(0)
      setDuration(0)
      try {
        const blob = s.kind === 'clip' ? await getClipBlob(s.rec.id) : undefined
        const url = s.kind === 'clip' ? (blob ? URL.createObjectURL(blob) : null) : await entryUrl(s.entry)
        if (!url) throw new Error('missing')
        urlRef.current = url
        setSrcUrl(url)
      } catch {
        toast({
          title: s.kind === 'clip' ? 'Clip data missing' : 'Could not open the video',
          description: s.kind === 'clip' ? 'It may have been deleted.' : 'Check the device connection and retry.',
          variant: 'destructive',
        })
        setSource(null)
      }
    },
    [toast]
  )

  /* ---------------- universal import (works on every device) ---------------- */

  const handleFiles = useCallback(
    async (list: FileList | null) => {
      const files = list
        ? Array.from(list).filter(
            (f) =>
              f.type.startsWith('video/') ||
              /\.(mp4|webm|mov|mkv|avi|m4v|mpg|mpeg|3gp|wmv|flv|ts|m2ts)$/i.test(f.name)
          )
        : []
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (files.length === 0) return
      setImporting(files.length)
      const saved: ClipRecord[] = []
      let failed = 0
      for (const f of files) {
        try {
          saved.push(await importVideoFile(f))
        } catch {
          failed++
        }
      }
      setImporting(0)
      await loadClips()
      if (saved.length > 0) {
        toast({
          title: saved.length === 1 ? 'Video added to your library' : `${saved.length} videos added`,
          description: failed > 0 ? `${failed} file${failed === 1 ? '' : 's'} couldn't be imported.` : 'Tap a poster to start watching.',
        })
        void openSource({ kind: 'clip', rec: saved[0] })
      } else {
        toast({
          title: 'Could not import',
          description: 'Storage may be full — try a smaller video.',
          variant: 'destructive',
        })
      }
    },
    [loadClips, openSource, toast]
  )

  const pickFiles = useCallback(() => fileInputRef.current?.click(), [])

  /* ---------------- navigation within the active list ---------------- */

  const activeList = useMemo<PlaySource[]>(() => {
    if (source?.kind === 'clip') return clips.map((c) => ({ kind: 'clip', rec: c }) as PlaySource)
    if (source?.kind === 'device') return devEntries.map((e) => ({ kind: 'device', entry: e }) as PlaySource)
    return []
  }, [source, clips, devEntries])

  const currentIndex = source ? activeList.findIndex((s) => sourceId(s) === sourceId(source)) : -1

  const step = useCallback(
    (dir: 1 | -1) => {
      if (currentIndex < 0) return
      const next = activeList[currentIndex + dir]
      if (next) void openSource(next)
    },
    [activeList, currentIndex, openSource]
  )

  /* ---------------- transport ---------------- */

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    setDuration(isFinite(v.duration) ? v.duration : 0)
    v.playbackRate = speed
    v.volume = volume
    v.muted = muted
    // resume position (native feel)
    if (source) {
      let saved = 0
      try {
        saved = Number(localStorage.getItem(posKeyOf(source)) ?? 0)
      } catch {
        /* ignore */
      }
      if (saved > 5 && saved < (isFinite(v.duration) ? v.duration : Infinity) - 3) {
        v.currentTime = saved
        setTime(saved)
        toast({ title: 'Resumed where you left off', description: nameOf(source) })
      }
    }
  }, [muted, source, speed, toast, volume])

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    setTime(v.currentTime)
    if (v.currentTime - lastSaveRef.current > 3 && source) {
      lastSaveRef.current = v.currentTime
      try {
        localStorage.setItem(posKeyOf(source), String(v.currentTime))
      } catch {
        /* ignore */
      }
    }
  }, [source])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }, [])

  const hop = useCallback((delta: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.min(Math.max(0, v.currentTime + delta), v.duration || 0)
    setTime(v.currentTime)
  }, [])

  const applySpeed = useCallback((r: number) => {
    setSpeed(r)
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

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen?.().catch(() => {})
  }, [])

  const togglePip = useCallback(async () => {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await v.requestPictureInPicture()
    } catch {
      toast({ title: 'Picture-in-picture unavailable here' })
    }
  }, [toast])

  /* keyboard shortcuts while the player is open */
  useEffect(() => {
    if (!source) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (e.key === ' ') {
        e.preventDefault()
        togglePlay()
      } else if (e.key === 'ArrowLeft') hop(-5)
      else if (e.key === 'ArrowRight') hop(5)
      else if (e.key.toLowerCase() === 'f') toggleFullscreen()
      else if (e.key === 'Escape' && !document.fullscreenElement) closeSource()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [source, togglePlay, hop, toggleFullscreen, closeSource])

  const pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl">
      {/* universal import picker — works on every phone and computer */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,.mp4,.webm,.mov,.mkv,.avi,.m4v,.mpg,.mpeg,.3gp,.wmv,.flv,.ts"
        multiple
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void handleFiles(e.target.files)}
      />
      <AnimatePresence mode="wait" initial={false}>
        {source ? (
          /* ---------------- Player view ---------------- */
          <motion.div
            key="player"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
          >
            {/* Stage */}
            <div
              ref={stageRef}
              className="group relative flex h-[50vh] items-center justify-center bg-black sm:h-[58vh]"
            >
              {srcUrl ? (
                <video
                  ref={videoRef}
                  src={srcUrl}
                  preload="metadata"
                  loop={loop}
                  onClick={togglePlay}
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onError={() => {
                    // browsers can't decode every container/codec (mkv, avi, hevc…)
                    if (!srcUrl) return
                    setMediaError(nameOf(source))
                    setPlaying(false)
                  }}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => {
                    setPlaying(false)
                    if (currentIndex >= 0 && currentIndex < activeList.length - 1) void step(1)
                  }}
                  className="max-h-full w-full cursor-pointer object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <Loader2 className="size-8 animate-spin text-fuchsia-400" aria-hidden />
                  <p className="text-sm text-zinc-400">Opening video…</p>
                </div>
              )}
              {srcUrl && mediaError && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center backdrop-blur-sm">
                  <span className="flex size-12 items-center justify-center rounded-full bg-amber-400/15 ring-1 ring-amber-300/30">
                    <TriangleAlert className="size-6 text-amber-300" aria-hidden />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-zinc-100">This format can’t play in-browser</p>
                    <p className="mx-auto mt-1 max-w-[270px] text-xs leading-relaxed text-zinc-400">
                      {mediaError} uses a codec this browser can’t decode — MP4 (H.264) and WebM play best.
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={closeSource}
                    className="rounded-full bg-white/10 text-zinc-100 hover:bg-white/20"
                  >
                    <ChevronLeft className="size-4" aria-hidden /> Back to videos
                  </Button>
                </div>
              )}
              {srcUrl && !playing && !mediaError && (
                <button
                  onClick={togglePlay}
                  aria-label="Play"
                  className="absolute inset-0 flex items-center justify-center bg-black/25 transition-opacity"
                >
                  <span className="flex size-16 items-center justify-center rounded-full bg-white/15 backdrop-blur-md ring-1 ring-white/30 shadow-2xl transition-transform hover:scale-105">
                    <Play className="ml-1 size-7 text-white" aria-hidden />
                  </span>
                </button>
              )}
              <button
                onClick={closeSource}
                aria-label="Back to videos"
                className="absolute left-3 top-3 flex size-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
              >
                <ChevronLeft className="size-5" aria-hidden />
              </button>
            </div>

            {/* Title + list nav */}
            <div className="flex items-center gap-2 px-4 pt-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{nameOf(source)}</p>
                <p className="text-[11px] text-zinc-500">
                  {source.kind === 'device' ? 'From your device' : 'From your library'}
                  {currentIndex >= 0 && ` · ${currentIndex + 1} of ${activeList.length}`}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => step(-1)}
                disabled={currentIndex <= 0}
                aria-label="Previous video"
                className="size-9 rounded-full text-zinc-300 hover:bg-white/10"
              >
                <SkipBack className="size-4" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => step(1)}
                disabled={currentIndex < 0 || currentIndex >= activeList.length - 1}
                aria-label="Next video"
                className="size-9 rounded-full text-zinc-300 hover:bg-white/10"
              >
                <SkipForward className="size-4" aria-hidden />
              </Button>
            </div>

            {/* Seek */}
            <div className="px-4 pt-2">
              <Slider
                value={[Math.min(time, duration || 0)]}
                max={duration || 0}
                min={0}
                step={0.1}
                disabled={!duration}
                onValueChange={(val) => {
                  const v = videoRef.current
                  if (v && val[0] !== undefined) {
                    v.currentTime = val[0]
                    setTime(val[0])
                  }
                }}
                aria-label="Seek"
                className="[&_[data-slot=slider-range]]:bg-fuchsia-500 [&_[data-slot=slider-thumb]]:border-fuchsia-500 [&_[data-slot=slider-track]]:bg-white/15"
              />
              <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-zinc-500">
                <span>{fmtTime(time)}</span>
                <span>{fmtTime(duration)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-3 px-4 pb-4 pt-2">
              <Button
                size="icon"
                onClick={togglePlay}
                aria-label={playing ? 'Pause' : 'Play'}
                className="size-11 shrink-0 rounded-full bg-fuchsia-600 text-white shadow-lg hover:bg-fuchsia-500"
              >
                {playing ? <Pause className="size-5" aria-hidden /> : <Play className="ml-0.5 size-5" aria-hidden />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => hop(-10)}
                aria-label="Back 10 seconds"
                className="size-9 rounded-full text-zinc-300 hover:bg-white/10"
              >
                <RotateCcw className="size-4" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => hop(10)}
                aria-label="Forward 10 seconds"
                className="size-9 rounded-full text-zinc-300 hover:bg-white/10"
              >
                <RotateCw className="size-4" aria-hidden />
              </Button>

              <Toggle
                pressed={muted}
                onPressedChange={toggleMute}
                aria-label={muted ? 'Unmute' : 'Mute'}
                className="size-9 rounded-full border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 data-[state=on]:bg-fuchsia-500/20 data-[state=on]:text-fuchsia-300"
              >
                {muted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
              </Toggle>
              <Slider
                value={[muted ? 0 : volume]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={(val) => applyVolume(val[0] ?? 0)}
                aria-label="Volume"
                className="w-20 [&_[data-slot=slider-range]]:bg-fuchsia-500 [&_[data-slot=slider-thumb]]:border-fuchsia-500 [&_[data-slot=slider-track]]:bg-white/15"
              />

              <Toggle
                pressed={loop}
                onPressedChange={setLoop}
                aria-label="Loop"
                className="size-9 rounded-full border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 data-[state=on]:bg-fuchsia-500/20 data-[state=on]:text-fuchsia-300"
              >
                <Repeat className="size-4" aria-hidden />
              </Toggle>
              {pipSupported && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void togglePip()}
                  aria-label="Picture in picture"
                  className="size-9 rounded-full text-zinc-300 hover:bg-white/10"
                >
                  <PictureInPicture2 className="size-4" aria-hidden />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                onClick={toggleFullscreen}
                aria-label="Fullscreen"
                className="ml-auto size-9 rounded-full text-zinc-300 hover:bg-white/10"
              >
                <Maximize className="size-4" aria-hidden />
              </Button>
            </div>

            {/* Speeds */}
            <div className="flex items-center gap-1.5 px-4 pb-4" role="group" aria-label="Playback speed">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Speed</span>
              {SPEEDS.map((r) => (
                <button
                  key={r}
                  onClick={() => applySpeed(r)}
                  aria-pressed={speed === r}
                  className={cn(
                    'h-8 rounded-full border px-2.5 text-xs font-semibold transition-all',
                    speed === r
                      ? 'border-transparent bg-fuchsia-600 text-white shadow'
                      : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                  )}
                >
                  {r}x
                </button>
              ))}
            </div>
          </motion.div>
        ) : (
          /* ---------------- Browse view ---------------- */
          <motion.div
            key="browse"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
          >
            {/* Header + tabs */}
            <div className="px-4 pt-4 sm:px-5">
              <div className="flex items-center gap-2.5">
                <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br from-fuchsia-500 via-violet-600 to-purple-800 text-white ring-1 ring-white/25 shadow-[0_10px_24px_-8px_rgb(192_38_211/0.7)]">
                  <CirclePlay className="size-5" strokeWidth={1.9} aria-hidden />
                  <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
                </span>
                <div>
                  <h2 className="text-base font-bold tracking-tight">Video Player</h2>
                  <p className="text-[11px] text-zinc-400">Your clips and every video on this device</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <div className="flex flex-1 gap-1.5" role="tablist" aria-label="Video sources">
                  {(
                    [
                      { id: 'library', label: 'My Library' },
                      { id: 'device', label: 'My Device' },
                    ] as const
                  ).map((t) => (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={tab === t.id}
                      onClick={() => setTab(t.id)}
                      className={cn(
                        'h-10 rounded-full px-4 text-sm font-semibold transition-all',
                        tab === t.id
                          ? 'bg-fuchsia-600 text-white shadow-md shadow-fuchsia-600/30'
                          : 'bg-white/5 text-zinc-300 hover:bg-white/10'
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={pickFiles}
                  disabled={importing > 0}
                  aria-label="Import videos from this device"
                  title="Import videos"
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-500 to-violet-600 text-white shadow-md shadow-fuchsia-600/25 transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
                >
                  {importing > 0 ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="size-5" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            <div className="p-4 sm:p-5">
              {tab === 'library' && (
                <div>
                  {loadingClips ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-400">
                      <Loader2 className="size-4 animate-spin" aria-hidden /> Loading library…
                    </div>
                  ) : clips.length === 0 ? (
                    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-fuchsia-500/[0.09] via-white/[0.02] to-transparent px-6 py-10 text-center">
                      <span className="pointer-events-none absolute -top-20 left-1/2 size-48 -translate-x-1/2 rounded-full bg-fuchsia-500/25 blur-3xl" aria-hidden />
                      <span className="relative mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 to-violet-700 shadow-[0_16px_40px_-12px_rgb(192_38_211/0.6)] ring-1 ring-white/25">
                        <FolderInput className="size-7 text-white" strokeWidth={1.8} aria-hidden />
                      </span>
                      <p className="relative mt-4 text-base font-bold text-zinc-100">Add your first video</p>
                      <p className="relative mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-zinc-400">
                        Import from this phone or computer — or stream straight from a folder on desktop.
                        Nothing ever leaves your device.
                      </p>
                      <div className="relative mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
                        <Button
                          onClick={pickFiles}
                          disabled={importing > 0}
                          className="h-11 rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-600 font-semibold text-white shadow-lg hover:from-fuchsia-400 hover:to-violet-500"
                        >
                          {importing > 0 ? (
                            <>
                              <Loader2 className="size-4 animate-spin" aria-hidden /> Importing {importing}…
                            </>
                          ) : (
                            <>
                              <FolderInput className="size-4" aria-hidden /> Import videos
                            </>
                          )}
                        </Button>
                        {fsSupported() && (
                          <Button
                            variant="ghost"
                            onClick={() => setTab('device')}
                            className="h-11 rounded-xl bg-white/5 font-semibold text-zinc-200 hover:bg-white/10"
                          >
                            <FolderOpen className="size-4" aria-hidden /> Browse device folder
                          </Button>
                        )}
                      </div>
                      <p className="relative mt-4 text-[11px] leading-relaxed text-zinc-500">
                        Clips saved in Video Studio or received via QR land here automatically.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {clips.map((c, i) => (
                        <motion.button
                          key={c.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min(i * 0.03, 0.25) }}
                          onClick={() => void openSource({ kind: 'clip', rec: c })}
                          className="group overflow-hidden rounded-xl border border-white/10 bg-zinc-900/70 text-left transition-colors hover:border-fuchsia-500/40"
                          aria-label={`Play ${c.name}`}
                        >
                          <span className="relative block aspect-video w-full overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-900">
                            {c.poster ? (
                              <img src={c.poster} alt="" className="size-full object-cover" loading="lazy" />
                            ) : (
                              <CirclePlay className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 text-zinc-600" aria-hidden />
                            )}
                            <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                              <span className="flex size-9 scale-75 items-center justify-center rounded-full bg-white/20 opacity-0 backdrop-blur-sm ring-1 ring-white/40 transition-all group-hover:scale-100 group-hover:opacity-100">
                                <Play className="ml-0.5 size-4 text-white" aria-hidden />
                              </span>
                            </span>
                            {c.duration ? (
                              <span className="absolute bottom-1 right-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-zinc-100 backdrop-blur-sm">
                                {fmtTime(c.duration)}
                              </span>
                            ) : (
                              <span className="absolute bottom-1 right-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-zinc-100 backdrop-blur-sm">
                                {fmtBytes(c.size)}
                              </span>
                            )}
                            {c.origin === 'received' && (
                              <span className="absolute left-1 top-1 rounded-md bg-fuchsia-500/85 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                                QR
                              </span>
                            )}
                          </span>
                          <span className="block px-2 py-1.5">
                            <span className="block truncate text-xs font-semibold text-zinc-100">{c.name}</span>
                          </span>
                        </motion.button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'device' && (
                <div>
                  {devState === 'idle' || devState === 'loading' ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-400">
                      <Loader2 className="size-4 animate-spin" aria-hidden /> Reading your device…
                    </div>
                  ) : devState === 'unsupported' ? (
                    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                      <X className="size-10 text-zinc-600" aria-hidden />
                      <p className="text-sm font-semibold text-zinc-300">This browser can’t open device folders</p>
                      <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                        Phone browsers don’t allow folder access — but importing works everywhere and saves
                        videos right into your library.
                      </p>
                      <Button
                        onClick={pickFiles}
                        disabled={importing > 0}
                        className="mt-1 h-11 rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-600 font-semibold text-white shadow-lg hover:from-fuchsia-400 hover:to-violet-500"
                      >
                        {importing > 0 ? (
                          <>
                            <Loader2 className="size-4 animate-spin" aria-hidden /> Importing {importing}…
                          </>
                        ) : (
                          <>
                            <FolderInput className="size-4" aria-hidden /> Import videos instead
                          </>
                        )}
                      </Button>
                    </div>
                  ) : devState === 'connect' ? (
                    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                      <FolderOpen className="size-10 text-zinc-600" aria-hidden />
                      <p className="text-sm font-semibold text-zinc-300">Watch videos straight from your device</p>
                      <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                        Connect a folder once — Videos, Movies or your whole library. Nothing is uploaded;
                        playback streams locally, just like desktop software.
                      </p>
                      <Button
                        onClick={() => {
                          void connectRoot()
                            .then(() => bootDevice())
                            .catch(() => toast({ title: 'Folder access cancelled' }))
                        }}
                        className="mt-1 h-11 rounded-xl bg-gradient-to-r from-fuchsia-500 to-violet-600 font-semibold text-white shadow-lg hover:from-fuchsia-400 hover:to-violet-500"
                      >
                        <Usb className="size-4" aria-hidden /> Connect a folder
                      </Button>
                    </div>
                  ) : devState === 'allow' ? (
                    <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-6 py-12 text-center">
                      <FolderOpen className="size-10 text-amber-300/70" aria-hidden />
                      <p className="text-sm font-semibold text-amber-100">One tap to re-allow access</p>
                      <p className="max-w-xs text-xs leading-relaxed text-zinc-400">
                        Browsers pause folder permission between sessions — allow it again to stream your videos.
                      </p>
                      <Button
                        onClick={() => {
                          void getRoot()
                            .then((root) => (root ? requestAccess(root) : false))
                            .then((ok) => (ok ? bootDevice() : undefined))
                            .catch(() => undefined)
                        }}
                        className="mt-1 h-11 rounded-xl bg-amber-400 font-semibold text-zinc-950 hover:bg-amber-300"
                      >
                        Allow access
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <div className="mb-3 flex items-center gap-2">
                        <Badge variant="outline" className="border-white/15 text-[11px] tabular-nums text-zinc-300">
                          {devEntries.length} {devEntries.length === 1 ? 'video' : 'videos'} found
                        </Badge>
                        {devBusy && <Loader2 className="size-3.5 animate-spin text-zinc-500" aria-hidden />}
                      </div>
                      {devEntries.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-10 text-center text-sm text-zinc-400">
                          No videos in the connected folder.
                        </div>
                      ) : (
                        <div className="grid max-h-[52vh] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
                          {devEntries.map((e) => (
                            <DeviceCard key={e.id} entry={e} onPlay={() => void openSource({ kind: 'device', entry: e })} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ================================================================== */
/* Device video card                                                   */
/* ================================================================== */

function DeviceCard({ entry, onPlay }: { entry: DeviceEntry; onPlay: () => void }) {
  const poster = useDeviceThumb(entry)
  return (
    <button
      onClick={onPlay}
      className="group overflow-hidden rounded-xl border border-white/10 bg-zinc-900/70 text-left transition-colors hover:border-fuchsia-500/40"
      aria-label={`Play ${entry.name}`}
    >
      <span className="relative block aspect-video w-full overflow-hidden bg-gradient-to-br from-zinc-800 to-zinc-900">
        {poster ? (
          <img src={poster} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <CirclePlay className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 text-zinc-600" aria-hidden />
        )}
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
          <span className="flex size-9 scale-75 items-center justify-center rounded-full bg-white/20 opacity-0 backdrop-blur-sm ring-1 ring-white/40 transition-all group-hover:scale-100 group-hover:opacity-100">
            <Play className="ml-0.5 size-4 text-white" aria-hidden />
          </span>
        </span>
        {entry.size > 0 && (
          <span className="absolute bottom-1 right-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-zinc-100 backdrop-blur-sm">
            {fmtBytes(entry.size)}
          </span>
        )}
      </span>
      <span className="block px-2 py-1.5">
        <span className="block truncate text-xs font-semibold text-zinc-100">{entry.name}</span>
        <span className="block truncate text-[10px] text-zinc-500">{entry.segs.slice(0, -1).join('/') || 'This folder'}</span>
      </span>
    </button>
  )
}
