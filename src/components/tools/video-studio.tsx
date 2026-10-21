'use client'

/**
 * Video Studio — import a clip, watch it with live CSS filters, rotate/flip,
 * scrub, change speed/volume/loop, trim with a looping preview, and capture
 * the current frame (PNG download + saved into the shared media library).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Camera,
  Clapperboard,
  Film,
  FlipHorizontal2,
  Loader2,
  Pause,
  Play,
  Repeat,
  RotateCw,
  Scissors,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { newPhotoId, putPhoto } from '@/lib/media-db'

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

const fmtTime = (t: number) => {
  const safe = isFinite(t) && t > 0 ? t : 0
  const m = Math.floor(safe / 60)
  const s = Math.floor(safe % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function VideoStudioApp() {
  const { toast } = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const urlRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoName, setVideoName] = useState('')
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

  const activeFilter = FILTERS.find((f) => f.id === filterId) ?? FILTERS[0]
  const rotated = rotation % 180 === 90

  /* Revoke the current object URL when the app unmounts */
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

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
      resetForNewFile()
      setVideoUrl(url)
      setVideoName(file.name)
    },
    [resetForNewFile, toast]
  )

  const changeVideo = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    resetForNewFile()
    setVideoUrl(null)
    setVideoName('')
  }, [resetForNewFile])

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
                {['Trim', '7 live filters', 'Rotate & flip', 'Frame capture'].map((chip) => (
                  <Badge key={chip} variant="outline" className="border-white/15 text-zinc-300">
                    {chip}
                  </Badge>
                ))}
              </div>
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="mt-6 h-11 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-300 hover:to-orange-400"
              >
                <Upload className="size-4" aria-hidden /> Import a video
              </Button>
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
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={() => void captureFrame()}
                  disabled={!metaReady}
                  className="h-11 flex-1 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-300 hover:to-orange-400"
                >
                  <Camera className="size-4" aria-hidden /> Capture frame
                </Button>
                <Button
                  variant="outline"
                  onClick={changeVideo}
                  className="h-11 flex-1 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Upload className="size-4" aria-hidden /> Change video
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
