'use client'

/**
 * Camera — live getUserMedia viewfinder with filters, timer, grid and
 * mirror controls. Captures are saved to the shared IndexedDB media store
 * (source: 'camera') and surfaced in a film strip.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CameraOff,
  Download,
  Grid3x3,
  Loader2,
  SwitchCamera,
  Timer,
  TimerOff,
  Trash2,
  FlipHorizontal2,
} from 'lucide-react'
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
/* Filters                                                             */
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

type CameraStatus = 'starting' | 'ready' | 'denied' | 'nodevice' | 'error' | 'unsupported'

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function CameraApp() {
  const { toast } = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

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

  const activeFilter = FILTERS.find((f) => f.id === filterId) ?? FILTERS[0]

  /* -------- Stream lifecycle -------- */

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  const startCamera = useCallback(
    async (mode: 'user' | 'environment') => {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStatus('unsupported')
        setErrorMsg('This browser does not support camera access.')
        return
      }
      setStatus('starting')
      setErrorMsg('')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode, width: { ideal: 1920 }, height: { ideal: 1080 } },
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
    }
  }, [startCamera, stopStream])

  /* -------- Capture -------- */

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
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
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const record: PhotoRecord = {
      id: newPhotoId(),
      dataUrl,
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
    // Shutter feedback: flash + haptic
    setFlash(true)
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(15)
    window.setTimeout(() => setFlash(false), 230)
  }, [activeFilter.css, mirror, facing, toast])

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

  /* -------- Camera switch -------- */

  const flipCamera = useCallback(() => {
    cancelCountdown()
    const next = facing === 'user' ? 'environment' : 'user'
    setFacing(next)
    setMirror(next === 'user')
    void startCamera(next)
  }, [facing, cancelCountdown, startCamera])

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

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-lg">
      {/* ---------------- Viewfinder stage ---------------- */}
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

        {/* Countdown overlay */}
        <AnimatePresence>
          {countdown !== null && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 flex items-center justify-center bg-black/25"
            >
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={countdown}
                  initial={{ scale: 1.7, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                  className="text-8xl font-bold text-white drop-shadow-[0_4px_18px_rgb(0_0_0/0.6)]"
                >
                  {countdown}
                </motion.span>
              </AnimatePresence>
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

      {/* ---------------- Filter strip ---------------- */}
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

      {/* ---------------- Film strip ---------------- */}
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

      {/* ---------------- Control bar ---------------- */}
      <div className="mt-4 flex items-center justify-between gap-2 rounded-3xl border border-white/10 bg-zinc-950 px-4 py-3.5 shadow-lg">
        <div className="flex gap-2">
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
          aria-label="Take photo"
          className="relative size-16 shrink-0 rounded-full border-[3px] border-white/90 bg-white/10 p-[5px] shadow-[0_10px_28px_-8px_rgb(244_63_94/0.65)] transition-opacity disabled:opacity-40 disabled:hover:scale-100 sm:size-20"
        >
          <span className="block size-full rounded-full bg-gradient-to-br from-rose-400 to-red-600 ring-1 ring-white/40" />
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
        Captures are saved on this device and appear in the Gallery app.
      </p>

      {/* ---------------- Film strip preview dialog ---------------- */}
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
