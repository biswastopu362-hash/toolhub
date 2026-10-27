'use client'

/**
 * Screen Recorder — capture your display, mix in the mic, save to device.
 *
 * Uses the display-capture API (desktop browsers) plus an optional microphone
 * mix rendered through Web Audio. Everything is encoded locally by
 * MediaRecorder and handed back as a downloadable file — zero uploads.
 * History persists metadata only (IndexedDB `toolhub-screenrec`), never video.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Download,
  Film,
  History,
  Info,
  Loader2,
  Mic,
  MonitorUp,
  Pause,
  Play,
  Square,
  Timer,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

interface RecMeta {
  id: string
  name: string
  durationSec: number
  sizeBytes: number
  /** full MediaRecorder mimeType that produced the file */
  codec: string
  createdAt: number
}

type Phase = 'idle' | 'recording' | 'paused'

interface CaptureResult {
  url: string
  meta: RecMeta
}

/* ---------------- format helpers ---------------- */

/** mm:ss with minutes allowed past 59. */
function fmtDur(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  const kb = n / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function haptic(): void {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

/* ---------------- codec negotiation ---------------- */

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
] as const

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const mime of MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime
    } catch {
      /* keep probing */
    }
  }
  return null
}

function codecLabel(mime: string): string {
  if (mime.includes('vp9')) return 'VP9 · Opus'
  if (mime.includes('vp8')) return 'VP8 · Opus'
  if (mime.includes('mp4')) return 'MP4 (H.264)'
  return 'WebM default'
}

function extOf(mime: string): string {
  return mime.includes('mp4') ? 'mp4' : 'webm'
}

/* ================================================================== */
/* IndexedDB — recording metadata ONLY, never video blobs              */
/* ================================================================== */

const DB_NAME = 'toolhub-screenrec'
const DB_VERSION = 1
const REC_STORE = 'recordings'

let dbPromise: Promise<IDBDatabase> | null = null

function openScreenRecDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(REC_STORE)) {
        d.createObjectStore(REC_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openScreenRecDb()
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

/* ================================================================== */
/* House style constants                                               */
/* ================================================================== */

/** Thin glass scrollbar for long lists (house convention). */
const SCROLLBAR_CLS =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/** Tab trigger overrides — explicit zinc styling survives light/dark themes. */
const TAB_TRIGGER_CLS =
  'h-full rounded-lg text-xs font-semibold text-zinc-500! shadow-none data-[state=active]:bg-white/10! data-[state=active]:text-white! data-[state=active]:shadow-none!'

const SPRING = { type: 'spring', stiffness: 260, damping: 26 } as const

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function ScreenRecorderApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [support, setSupport] = useState<{ display: boolean; recorder: boolean } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [history, setHistory] = useState<RecMeta[]>([])
  const [phase, setPhase] = useState<Phase>('idle')
  const [starting, setStarting] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [sysAudio, setSysAudio] = useState(true)
  const [micOn, setMicOn] = useState(false)
  const [mimeUsed, setMimeUsed] = useState<string | null>(null)
  const [result, setResult] = useState<CaptureResult | null>(null)
  const [armedClear, setArmedClear] = useState(false)

  /* ---------------- capture refs (survive re-renders, event closures) --- */
  const previewRef = useRef<HTMLVideoElement | null>(null)
  const displayRef = useRef<MediaStream | null>(null)
  const micRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const timerRef = useRef<number | null>(null)
  const endCtlRef = useRef<AbortController | null>(null)
  const urlRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const pausedRef = useRef(false)
  const elapsedRef = useRef(0)

  /* ---------------- hydration (metadata only) ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rows = await idbGetAll<RecMeta>(REC_STORE)
        if (!alive) return
        setHistory(rows.slice().sort((a, b) => b.createdAt - a.createdAt))
      } catch {
        /* private mode / quota — history simply starts empty */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- feature detection (deferred, SSR-safe) ---------------- */
  useEffect(() => {
    let alive = true
    queueMicrotask(() => {
      if (!alive) return
      setSupport({
        display:
          typeof navigator !== 'undefined' &&
          typeof navigator.mediaDevices?.getDisplayMedia === 'function',
        recorder: typeof MediaRecorder === 'function',
      })
    })
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- attach live stream to the preview element ---------------- */
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    if (phase === 'idle') {
      el.srcObject = null
      return
    }
    const disp = displayRef.current
    if (disp && el.srcObject !== disp) {
      el.srcObject = disp
      void el.play().catch(() => {
        /* autoplay guard — user can tap the muted preview */
      })
    }
  }, [phase])

  /* ---------------- unmount: stop every timer, stream and URL ---------------- */
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      endCtlRef.current?.abort()
      displayRef.current?.getTracks().forEach((t) => t.stop())
      micRef.current?.getTracks().forEach((t) => t.stop())
      const ctx = audioCtxRef.current
      if (ctx) void ctx.close().catch(() => {})
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  /* ---------------- teardown (idempotent) ---------------- */
  const teardownCapture = useCallback(() => {
    endCtlRef.current?.abort()
    endCtlRef.current = null
    const disp = displayRef.current
    displayRef.current = null
    disp?.getTracks().forEach((t) => t.stop())
    const mic = micRef.current
    micRef.current = null
    mic?.getTracks().forEach((t) => t.stop())
    const ctx = audioCtxRef.current
    audioCtxRef.current = null
    if (ctx) void ctx.close().catch(() => {})
    recorderRef.current = null
    if (previewRef.current) previewRef.current.srcObject = null
  }, [])

  /* ---------------- start ---------------- */
  const startRecording = useCallback(async () => {
    if (busyRef.current || recorderRef.current) return

    const md = navigator.mediaDevices
    if (!md || typeof md.getDisplayMedia !== 'function' || typeof MediaRecorder === 'undefined') {
      toast({
        title: 'Screen capture unavailable',
        description: 'This browser does not expose the display-capture API.',
      })
      return
    }

    const mime = pickMime()
    if (!mime) {
      toast({
        title: 'No supported encoder',
        description: 'MediaRecorder offered no usable video codec in this browser.',
      })
      return
    }

    busyRef.current = true
    setStarting(true)

    try {
      /* --- display capture --- */
      const display = await md.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: sysAudio,
      })
      displayRef.current = display

      /* --- optional microphone mix via Web Audio --- */
      let micStream: MediaStream | null = null
      let actx: AudioContext | null = null
      let audioDest: MediaStreamAudioDestinationNode | null = null
      if (micOn) {
        try {
          micStream = await md.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          })
          micRef.current = micStream
          const AC =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          if (!AC) throw new Error('Web Audio unavailable')
          actx = new AC()
          audioCtxRef.current = actx
          audioDest = actx.createMediaStreamDestination()
          const sysTrack = display.getAudioTracks()[0]
          if (sysTrack) actx.createMediaStreamSource(new MediaStream([sysTrack])).connect(audioDest)
          actx.createMediaStreamSource(micStream).connect(audioDest)
        } catch {
          if (actx) void actx.close().catch(() => {})
          actx = null
          audioDest = null
          micStream?.getTracks().forEach((t) => t.stop())
          micStream = null
          micRef.current = null
          audioCtxRef.current = null
          toast({
            title: 'Microphone unavailable',
            description: 'Recording will continue without microphone audio.',
          })
        }
      }

      const videoTrack = display.getVideoTracks()[0]
      if (!videoTrack) {
        teardownCapture()
        busyRef.current = false
        setStarting(false)
        toast({
          title: 'Nothing to capture',
          description: 'The shared surface ended immediately — try picking it again.',
        })
        return
      }

      if (sysAudio && !audioDest && display.getAudioTracks().length === 0) {
        toast({
          title: 'No system audio',
          description: 'The browser shared video only — tick "Share audio" in the picker next time.',
        })
      }

      const audioTrack = audioDest
        ? audioDest.stream.getAudioTracks()[0]
        : display.getAudioTracks()[0]
      const stream = new MediaStream(audioTrack ? [videoTrack, audioTrack] : [videoTrack])

      /* --- recorder --- */
      const rec = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: 6_000_000,
        audioBitsPerSecond: 128_000,
      })
      const chunks: Blob[] = []
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data)
      }
      rec.onerror = () => {
        toast({
          title: 'Recorder error',
          description: 'Capture hit an encoder problem — the clip so far is kept if possible.',
        })
      }
      rec.onstop = () => {
        if (timerRef.current !== null) {
          window.clearInterval(timerRef.current)
          timerRef.current = null
        }
        teardownCapture()
        setPhase('idle')
        haptic()

        const container = mime.split(';')[0] ?? 'video/webm'
        const blob = new Blob(chunks, { type: container })
        if (blob.size === 0) {
          toast({
            title: 'Nothing was recorded',
            description: 'The capture ended before any frames landed — try again.',
          })
          return
        }
        const url = URL.createObjectURL(blob)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = url

        const now = Date.now()
        const meta: RecMeta = {
          id: `rec_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          name: `screenrec-${now}`,
          durationSec: elapsedRef.current,
          sizeBytes: blob.size,
          codec: mime,
          createdAt: now,
        }
        setResult({ url, meta })
        setHistory((prev) => [meta, ...prev])
        void idbPut(REC_STORE, meta).catch(() => {
          toast({
            title: 'History unavailable',
            description: 'Metadata could not be stored — kept in memory only.',
          })
        })
        toast({
          title: 'Recording ready',
          description: `${fmtDur(meta.durationSec)} · ${fmtBytes(blob.size)} · download below`,
        })
      }

      /* --- auto-stop when the user presses the browser "Stop sharing" bar --- */
      const endCtl = new AbortController()
      videoTrack.addEventListener(
        'ended',
        () => {
          if (rec.state !== 'inactive') rec.stop()
        },
        { signal: endCtl.signal },
      )
      endCtlRef.current = endCtl
      recorderRef.current = rec

      /* --- go --- */
      elapsedRef.current = 0
      pausedRef.current = false
      setElapsed(0)
      setMimeUsed(mime)
      setPhase('recording')
      rec.start(1000)
      timerRef.current = window.setInterval(() => {
        if (pausedRef.current) return
        elapsedRef.current += 1
        setElapsed(elapsedRef.current)
      }, 1000)
      haptic()
    } catch (err) {
      teardownCapture()
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError') {
        toast({
          title: 'Permission denied',
          description: 'Screen sharing was cancelled or blocked — nothing was recorded.',
        })
      } else if (name === 'NotFoundError') {
        toast({
          title: 'Nothing to capture',
          description: 'No screen, window or tab was available to share.',
        })
      } else {
        toast({
          title: 'Could not start recording',
          description: name || 'Unexpected error while starting the capture.',
        })
      }
    } finally {
      busyRef.current = false
      setStarting(false)
    }
  }, [micOn, sysAudio, teardownCapture, toast])

  /* ---------------- pause / resume ---------------- */
  const togglePause = useCallback(() => {
    const rec = recorderRef.current
    if (!rec) return
    if (rec.state === 'recording') {
      rec.pause()
      pausedRef.current = true
      setPhase('paused')
    } else if (rec.state === 'paused') {
      rec.resume()
      pausedRef.current = false
      setPhase('recording')
    }
    haptic()
  }, [])

  /* ---------------- stop (finalization happens in onstop) ---------------- */
  const stopRecording = useCallback(() => {
    const rec = recorderRef.current
    if (!rec) return
    haptic()
    if (rec.state !== 'inactive') rec.stop()
  }, [])

  /* ---------------- result card ---------------- */
  const discardResult = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setResult(null)
    haptic()
    toast({ title: 'Recording discarded', description: 'The video was released from memory.' })
  }, [toast])

  /* ---------------- history mutations ---------------- */
  const removeRow = useCallback(
    (id: string) => {
      setHistory((prev) => prev.filter((r) => r.id !== id))
      void idbDelete(REC_STORE, id).catch(() => {
        toast({
          title: 'History unavailable',
          description: 'The entry could not be removed from storage.',
        })
      })
      toast({ title: 'Removed from history' })
    },
    [toast],
  )

  const clearAllHistory = useCallback(() => {
    if (!armedClear) {
      setArmedClear(true)
      window.setTimeout(() => setArmedClear(false), 2600)
      return
    }
    setArmedClear(false)
    haptic()
    const ids = history.map((r) => r.id)
    setHistory([])
    if (ids.length === 0) return
    void Promise.all(ids.map((id) => idbDelete(REC_STORE, id))).catch(() => {
      toast({ title: 'History unavailable', description: 'Storage could not be cleared.' })
    })
    toast({
      title: 'History cleared',
      description: `${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} removed — video files were never stored.`,
    })
  }, [armedClear, history, toast])

  /* ---------------- derived ---------------- */
  const unsupported = support !== null && (!support.display || !support.recorder)
  const previewMime = useMemo(() => (support?.recorder ? pickMime() : null), [support])
  const live = phase !== 'idle'

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-zinc-100">
      <div className="mx-auto w-full max-w-2xl px-3 py-4 sm:px-4 sm:py-5">
        {/* ---------------- gradient identity header ---------------- */}
        <motion.header
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={SPRING}
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-red-500 via-rose-600 to-purple-700 p-5 text-white shadow-[0_18px_40px_-18px_rgb(244_63_94/0.55)]"
        >
          <div className="flex items-center gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30">
              <MonitorUp className="size-6" strokeWidth={1.9} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold tracking-tight">Screen Recorder</h1>
              <p className="truncate text-xs text-white/80">
                Capture your screen, mix the mic, save to device.
              </p>
            </div>
            {live && (
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold tracking-wider',
                  phase === 'paused' ? 'bg-black/35 text-amber-200' : 'bg-black/35 text-white',
                )}
              >
                {phase === 'paused' ? (
                  'PAUSED'
                ) : (
                  <>
                    <span className="relative flex size-2.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-300 opacity-80" />
                      <span className="relative inline-flex size-2.5 rounded-full bg-red-400" />
                    </span>
                    REC
                  </>
                )}
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-white/75">
            <Info className="size-3.5 shrink-0" aria-hidden />
            <span>Zero uploads — capture, encoding and saving happen entirely on this device.</span>
          </div>
        </motion.header>

        {/* ---------------- unsupported: premium explainer card ---------------- */}
        {unsupported ? (
          <motion.section
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING}
            className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] p-5"
            aria-live="polite"
          >
            <div className="flex items-start gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/30">
                <MonitorUp className="size-6" strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-bold tracking-tight text-amber-100">
                  Needs a desktop browser
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-amber-100/70">
                  Screen Recorder uses the browser display-capture API, which mobile browsers do not
                  expose. Open ToolHub in a desktop Chrome, Edge or Firefox and this tool unlocks —
                  no install, no extension.
                </p>
              </div>
            </div>
            <ul className="mt-4 space-y-2">
              <li className="flex min-h-[44px] items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3">
                <span className="text-xs font-medium text-zinc-300">Display capture</span>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[10px] font-bold',
                    support?.display ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
                  )}
                >
                  {support?.display ? 'Available' : 'Not exposed'}
                </span>
              </li>
              <li className="flex min-h-[44px] items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3">
                <span className="text-xs font-medium text-zinc-300">MediaRecorder encoder</span>
                <span
                  className={cn(
                    'rounded-full px-2.5 py-1 text-[10px] font-bold',
                    support?.recorder ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300',
                  )}
                >
                  {support?.recorder ? 'Available' : 'Not exposed'}
                </span>
              </li>
            </ul>
          </motion.section>
        ) : (
          /* ---------------- main tabs ---------------- */
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: 0.05 }}
            className="mt-4"
          >
            <Tabs defaultValue="record">
              <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl border border-white/10 bg-white/[0.04] p-1 text-zinc-400">
                <TabsTrigger value="record" className={TAB_TRIGGER_CLS}>
                  Record
                </TabsTrigger>
                <TabsTrigger value="history" className={TAB_TRIGGER_CLS}>
                  History{history.length > 0 ? ` (${history.length})` : ''}
                </TabsTrigger>
              </TabsList>

              {/* ================================ RECORD TAB ================================ */}
              <TabsContent value="record" className="mt-4 space-y-4">
                {/* live preview / idle placeholder */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-3 flex items-center justify-between px-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Preview
                    </p>
                    <p className="text-[10px] tabular-nums text-zinc-500">
                      {live ? fmtDur(elapsed) : 'not sharing'}
                    </p>
                  </div>

                  {live ? (
                    <video
                      ref={previewRef}
                      muted
                      autoPlay
                      playsInline
                      className="aspect-video w-full rounded-xl border border-white/10 bg-black"
                    />
                  ) : (
                    <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-black/40 text-zinc-500">
                      <MonitorUp className="size-8 opacity-60" aria-hidden />
                      <p className="text-xs">Your shared screen appears here</p>
                      <p className="text-[10px] text-zinc-600">Nothing is sent anywhere</p>
                    </div>
                  )}

                  {/* status + codec chips */}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold tabular-nums',
                        phase === 'recording' &&
                          'border-rose-400/40 bg-rose-500/10 text-rose-200',
                        phase === 'paused' && 'border-amber-400/40 bg-amber-500/10 text-amber-200',
                        phase === 'idle' && 'border-white/10 bg-white/5 text-zinc-400',
                      )}
                    >
                      <Timer className="size-3" aria-hidden />
                      {live ? (phase === 'paused' ? 'Paused at ' : 'Recording ') + fmtDur(elapsed) : 'Ready'}
                    </span>
                    {mimeUsed && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-purple-400/30 bg-purple-500/10 px-3 py-1 text-[11px] font-semibold text-purple-200">
                        <Film className="size-3" aria-hidden />
                        {codecLabel(mimeUsed)} · {extOf(mimeUsed).toUpperCase()}
                      </span>
                    )}
                    {!mimeUsed && previewMime && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-zinc-400">
                        <Film className="size-3" aria-hidden />
                        Encoder: {codecLabel(previewMime)}
                      </span>
                    )}
                  </div>
                </section>

                {/* audio source toggles */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="mb-3 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    Audio sources
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setSysAudio((v) => !v)}
                      aria-pressed={sysAudio}
                      className={cn(
                        'flex min-h-[44px] w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                        sysAudio
                          ? 'border-rose-400/40 bg-rose-500/10'
                          : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-lg',
                          sysAudio ? 'bg-rose-500/20 text-rose-300' : 'bg-white/5 text-zinc-400',
                        )}
                      >
                        <Volume2 className="size-4.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">System audio</span>
                        <span className="block text-[11px] text-zinc-400">
                          What plays on the device
                        </span>
                      </span>
                      <span
                        className={cn(
                          'relative h-6 w-10 shrink-0 rounded-full transition-colors',
                          sysAudio ? 'bg-rose-500' : 'bg-white/15',
                        )}
                        aria-hidden
                      >
                        <span
                          className={cn(
                            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
                            sysAudio ? 'left-[18px]' : 'left-0.5',
                          )}
                        />
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMicOn((v) => !v)}
                      aria-pressed={micOn}
                      className={cn(
                        'flex min-h-[44px] w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                        micOn
                          ? 'border-purple-400/40 bg-purple-500/10'
                          : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-9 shrink-0 items-center justify-center rounded-lg',
                          micOn ? 'bg-purple-500/20 text-purple-300' : 'bg-white/5 text-zinc-400',
                        )}
                      >
                        <Mic className="size-4.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">Microphone</span>
                        <span className="block text-[11px] text-zinc-400">
                          Mixed over the system audio
                        </span>
                      </span>
                      <span
                        className={cn(
                          'relative h-6 w-10 shrink-0 rounded-full transition-colors',
                          micOn ? 'bg-purple-500' : 'bg-white/15',
                        )}
                        aria-hidden
                      >
                        <span
                          className={cn(
                            'absolute top-0.5 size-5 rounded-full bg-white shadow transition-all',
                            micOn ? 'left-[18px]' : 'left-0.5',
                          )}
                        />
                      </span>
                    </button>
                  </div>
                </section>

                {/* controls */}
                <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  {live ? (
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={togglePause}
                        className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10"
                      >
                        {phase === 'paused' ? (
                          <>
                            <Play className="size-4" aria-hidden /> Resume
                          </>
                        ) : (
                          <>
                            <Pause className="size-4" aria-hidden /> Pause
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={stopRecording}
                        className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-500 to-rose-600 text-sm font-bold text-white shadow-lg transition-transform active:scale-[0.98]"
                      >
                        <Square className="size-4" aria-hidden /> Stop
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void startRecording()}
                      disabled={starting || (support !== null && !support.display)}
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-500 via-rose-600 to-purple-700 text-sm font-bold text-white shadow-[0_12px_28px_-10px_rgb(244_63_94/0.7)] transition-transform active:scale-[0.98] disabled:opacity-60"
                    >
                      {starting ? (
                        <>
                          <Loader2 className="size-4 animate-spin" aria-hidden /> Waiting for
                          permission…
                        </>
                      ) : (
                        <>
                          <MonitorUp className="size-4" aria-hidden /> Start recording
                        </>
                      )}
                    </button>
                  )}
                  <p className="mt-3 flex items-start gap-2 px-1 text-[11px] leading-relaxed text-zinc-500">
                    <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                    Press the browser&apos;s own &quot;Stop sharing&quot; bar and the recording
                    finishes automatically. The video lives in memory until you download or discard
                    it.
                  </p>
                </section>

                {/* result card */}
                <AnimatePresence>
                  {result && (
                    <motion.section
                      key={result.meta.id}
                      initial={{ opacity: 0, y: 16, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.98 }}
                      transition={SPRING}
                      className="rounded-2xl border border-white/10 bg-white/5 p-4"
                    >
                      <div className="mb-3 flex items-center justify-between px-1">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                          Latest recording
                        </p>
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[10px] font-bold text-emerald-300">
                          READY
                        </span>
                      </div>

                      <video
                        src={result.url}
                        controls
                        playsInline
                        preload="metadata"
                        className="aspect-video w-full rounded-xl border border-white/10 bg-black"
                      />

                      <dl className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            Duration
                          </dt>
                          <dd className="mt-0.5 text-sm font-bold tabular-nums text-zinc-100">
                            {fmtDur(result.meta.durationSec)}
                          </dd>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            Size
                          </dt>
                          <dd className="mt-0.5 text-sm font-bold tabular-nums text-zinc-100">
                            {fmtBytes(result.meta.sizeBytes)}
                          </dd>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            Codec
                          </dt>
                          <dd className="mt-0.5 truncate text-sm font-bold text-zinc-100">
                            {codecLabel(result.meta.codec)}
                          </dd>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                          <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            Format
                          </dt>
                          <dd className="mt-0.5 text-sm font-bold uppercase text-zinc-100">
                            {extOf(result.meta.codec)}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-3 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
                        <a
                          href={result.url}
                          download={`${result.meta.name}.${extOf(result.meta.codec)}`}
                          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-500 via-rose-600 to-purple-700 text-sm font-bold text-white shadow-lg transition-transform active:scale-[0.98]"
                        >
                          <Download className="size-4" aria-hidden /> Download video
                        </a>
                        <button
                          type="button"
                          onClick={discardResult}
                          className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <X className="size-4" aria-hidden /> Discard
                        </button>
                      </div>

                      <p className="mt-3 flex items-start gap-2 px-1 text-[11px] leading-relaxed text-zinc-500">
                        <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                        Only the metadata above is saved to history — the video itself stays in
                        memory until you download it.
                      </p>
                    </motion.section>
                  )}
                </AnimatePresence>
              </TabsContent>

              {/* ================================ HISTORY TAB ================================ */}
              <TabsContent value="history" className="mt-4 space-y-3">
                <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="mb-3 flex items-center justify-between px-1">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      {history.length} saved {history.length === 1 ? 'entry' : 'entries'}
                    </p>
                    <button
                      type="button"
                      onClick={clearAllHistory}
                      disabled={history.length === 0}
                      className={cn(
                        'inline-flex h-11 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-semibold transition-colors disabled:opacity-50',
                        armedClear
                          ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
                          : 'border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200',
                      )}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                      {armedClear ? 'Tap again to clear' : 'Clear all'}
                    </button>
                  </div>

                  {history.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 bg-black/30 px-4 py-10 text-center">
                      <History className="size-8 text-zinc-600" aria-hidden />
                      <p className="text-sm font-semibold text-zinc-300">No recordings yet</p>
                      <p className="text-[11px] text-zinc-500">
                        {loaded
                          ? 'Finished captures land here — metadata only, never the video.'
                          : 'Loading history…'}
                      </p>
                    </div>
                  ) : (
                    <ul
                      className={cn(
                        'max-h-96 space-y-2 overflow-y-auto pr-1',
                        SCROLLBAR_CLS,
                      )}
                      aria-label="Recorded screens"
                    >
                      {history.map((r) => (
                        <motion.li
                          key={r.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                          className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-red-500/25 to-purple-700/25 text-rose-300">
                            <Film className="size-4" aria-hidden />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-zinc-100">
                              {r.name}.{extOf(r.codec)}
                            </p>
                            <p className="truncate text-[11px] tabular-nums text-zinc-500">
                              {fmtDate(r.createdAt)} · {fmtDur(r.durationSec)} ·{' '}
                              {fmtBytes(r.sizeBytes)}
                            </p>
                          </div>
                          <span className="hidden shrink-0 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-zinc-400 sm:inline-flex">
                            {codecLabel(r.codec)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeRow(r.id)}
                            aria-label={`Delete ${r.name}`}
                            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-500 transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-300"
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                        </motion.li>
                      ))}
                    </ul>
                  )}

                  <p className="mt-3 flex items-start gap-2 px-1 text-[11px] leading-relaxed text-zinc-500">
                    <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                    History stores metadata only (name, duration, size, codec). Video data never
                    touches storage.
                  </p>
                </section>
              </TabsContent>
            </Tabs>
          </motion.div>
        )}
      </div>
    </div>
  )
}
