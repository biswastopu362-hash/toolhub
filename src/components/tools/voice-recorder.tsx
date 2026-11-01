'use client'

/**
 * Voice Recorder v2 — record, rename, trim, speed playback & notes.
 *
 * v2 upgrades on top of the v1 record flow (mic, timer, pause/resume,
 * download, delete, clear-all):
 *  - Rename: tap a recording's name for inline editing, persisted.
 *  - Trim: per-recording waveform (min/max peaks decoded from the stored
 *    blob and cached in memory) with drag-to-select start/end handles and
 *    "Save trimmed copy" — the slice is rendered to 16-bit PCM WAV and
 *    added as a new item; the original always stays untouched.
 *  - Speed playback: 0.5×–2× per player with pitch preservation.
 *  - Notes: expandable free-text note per recording, saved automatically.
 *  - Persistence: recordings (blob + name + note) live in IndexedDB
 *    (toolhub-voice-recorder / 'recordings') — restored on open.
 *
 * Everything happens on-device: no uploads, ever.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Circle,
  Download,
  Info,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Pencil,
  Play,
  Scissors,
  Share2,
  Square,
  StickyNote,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Types                                                               */
/* ================================================================== */

interface Recording {
  id: string
  url: string
  blob: Blob
  mimeType: string
  /** duration in seconds */
  duration: number
  size: number
  createdAt: number
  ext: string
  name: string
  note: string
}

type RecordingPatch = Partial<Pick<Recording, 'name' | 'note' | 'duration'>>

/** IndexedDB row — name/note are optional so old rows migrate gracefully. */
interface StoredRecording {
  id: string
  blob: Blob
  mimeType: string
  ext: string
  duration: number
  size: number
  createdAt: number
  name?: string
  note?: string
}

interface Span {
  start: number
  end: number
}

interface Peaks {
  mins: Float32Array
  maxs: Float32Array
}

/* ================================================================== */
/* Constants & small helpers                                           */
/* ================================================================== */

const DB_NAME = 'toolhub-voice-recorder'
const DB_VERSION = 1
const RECORD_STORE = 'recordings'

const ARM_TIMEOUT_MS = 2600
const NOTE_DEBOUNCE_MS = 700
const MIN_SELECTION = 0.05 // seconds — below this a drag counts as a click
const PEAK_BUCKETS = 720 // waveform resolution (cached per recording)
const WAVE_H = 64 // canvas height in CSS px
const BUFFER_CACHE_LIMIT = 4 // decoded AudioBuffers kept in memory

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const

/** Thin glass scrollbar for long lists (house convention). */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

function haptic(): void {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = Math.floor(totalSeconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function fmtSpan(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const tenth = Math.floor((s % 1) * 10)
  return `${m}:${String(sec).padStart(2, '0')}.${tenth}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString('en-US')} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('en-US', { maximumFractionDigits: 2 })} MB`
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'recording'
  )
}

function defaultName(createdAt: number): string {
  if (!createdAt) return 'Recording'
  const time = new Date(createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  return `Recording ${time}`
}

function dateLabel(ts: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Apply a playback rate and keep pitch natural where the browser supports it. */
function applySpeed(el: HTMLMediaElement, rate: number): void {
  el.playbackRate = rate
  if ('preservesPitch' in el) {
    const pitch = el as HTMLMediaElement & { preservesPitch?: boolean }
    pitch.preservesPitch = true
  }
}

function toStored(rec: Recording): StoredRecording {
  return {
    id: rec.id,
    blob: rec.blob,
    mimeType: rec.mimeType,
    ext: rec.ext,
    duration: rec.duration,
    size: rec.size,
    createdAt: rec.createdAt,
    name: rec.name,
    note: rec.note,
  }
}

/* ================================================================== */
/* Audio helpers — decode, peaks, slice, WAV encode                    */
/* ================================================================== */

let sharedCtx: AudioContext | null = null

function ensureCtx(): AudioContext {
  if (!sharedCtx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    sharedCtx = new Ctor()
  }
  return sharedCtx
}

/** Decoded AudioBuffers per recording id — small LRU so memory stays bounded. */
const bufferCache = new Map<string, AudioBuffer>()
const peaksCache = new Map<string, Peaks>()

async function decodeRecording(id: string, blob: Blob): Promise<AudioBuffer> {
  const cached = bufferCache.get(id)
  if (cached) return cached
  const raw = await blob.arrayBuffer()
  const buffer = await ensureCtx().decodeAudioData(raw)
  bufferCache.set(id, buffer)
  while (bufferCache.size > BUFFER_CACHE_LIMIT) {
    const oldest = bufferCache.keys().next()
    if (oldest.done) break
    bufferCache.delete(oldest.value)
  }
  return buffer
}

function cachePeaks(id: string, peaks: Peaks): Peaks {
  peaksCache.set(id, peaks)
  return peaks
}

function forgetDecoded(id: string): void {
  bufferCache.delete(id)
  peaksCache.delete(id)
}

/** Min/max peak pairs at a fixed resolution — cached per recording. */
function computePeaks(buffer: AudioBuffer, buckets = PEAK_BUCKETS): Peaks {
  const mins = new Float32Array(buckets)
  const maxs = new Float32Array(buckets)
  const n = buffer.length
  const d0 = buffer.getChannelData(0)
  const d1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : d0
  const strideCap = 384
  for (let b = 0; b < buckets; b++) {
    const s0 = Math.floor((b * n) / buckets)
    const s1 = Math.max(s0 + 1, Math.floor(((b + 1) * n) / buckets))
    const stride = Math.max(1, Math.ceil((s1 - s0) / strideCap))
    let mn = 1
    let mx = -1
    for (let i = s0; i < s1; i += stride) {
      const a = d0[i]
      const c = d1[i]
      const lo = a < c ? a : c
      const hi = a > c ? a : c
      if (lo < mn) mn = lo
      if (hi > mx) mx = hi
    }
    mins[b] = mn
    maxs[b] = mx
  }
  return { mins, maxs }
}

/** Copy a subregion [startSample, endSample) of every channel into a new buffer. */
function sliceBuffer(buffer: AudioBuffer, startSample: number, endSample: number): AudioBuffer {
  const ctx = ensureCtx()
  const out = ctx.createBuffer(
    buffer.numberOfChannels,
    Math.max(1, endSample - startSample),
    buffer.sampleRate,
  )
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.copyToChannel(buffer.getChannelData(c).subarray(startSample, endSample), c)
  }
  return out
}

/** Hand-rolled RIFF/WAVE encoder — 16-bit signed PCM, interleaved. */
function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels
  const len = buffer.length
  const dataBytes = len * numCh * 2
  const ab = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(ab)

  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numCh, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * numCh * 2, true) // byte rate
  view.setUint16(32, numCh * 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)

  const chans: Float32Array[] = []
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c))
  let off = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = clamp(chans[c][i], -1, 1)
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([ab], { type: 'audio/wav' })
}

/* ================================================================== */
/* IndexedDB — toolhub-voice-recorder v1, store 'recordings'           */
/* ================================================================== */

let dbPromise: Promise<IDBDatabase> | null = null

function openRecorderDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(RECORD_STORE)) {
        d.createObjectStore(RECORD_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openRecorderDb()
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

function idbPut(store: string, value: StoredRecording): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).put(value)
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
/* Component                                                           */
/* ================================================================== */

export default function VoiceRecorderTool() {
  const { toast } = useToast()

  const supported =
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'

  const [denied, setDenied] = useState(false)
  const [starting, setStarting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [armedId, setArmedId] = useState<string | null>(null)
  const [armedClear, setArmedClear] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const secondsRef = useRef(0)

  const meterRafRef = useRef(0)
  const meterSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const meterAnalyserRef = useRef<AnalyserNode | null>(null)
  const lastLevelTsRef = useRef(0)

  /** Latest recordings for read-modify-write persistence outside render. */
  const recordingsRef = useRef<Recording[]>([])
  useEffect(() => {
    recordingsRef.current = recordings
  }, [recordings])

  /** Pending per-recording note writes (debounced), flushed on unmount. */
  const noteTimersRef = useRef<Map<string, number>>(new Map())

  /* ---------------- timers & meter ---------------- */

  const stopTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const startTimer = () => {
    stopTimer()
    timerRef.current = window.setInterval(() => {
      secondsRef.current += 1
      setSeconds(secondsRef.current)
    }, 1000)
  }

  /** Cancel the meter loop and detach analyser nodes (no setState — safe in cleanup). */
  const teardownMeter = () => {
    if (meterRafRef.current) {
      window.cancelAnimationFrame(meterRafRef.current)
      meterRafRef.current = 0
    }
    try {
      meterSourceRef.current?.disconnect()
    } catch {
      /* already disconnected */
    }
    try {
      meterAnalyserRef.current?.disconnect()
    } catch {
      /* already disconnected */
    }
    meterSourceRef.current = null
    meterAnalyserRef.current = null
  }

  /** Live input level via AnalyserNode RMS, throttled to ~12 fps. */
  const startMeter = (stream: MediaStream) => {
    try {
      const ctx = ensureCtx()
      void ctx.resume().catch(() => undefined)
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      meterSourceRef.current = source
      meterAnalyserRef.current = analyser
      const data = new Uint8Array(analyser.fftSize)
      const tick = () => {
        const an = meterAnalyserRef.current
        if (!an) return
        an.getByteTimeDomainData(data)
        let sum = 0
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          sum += v * v
        }
        const now = performance.now()
        if (now - lastLevelTsRef.current >= 80) {
          lastLevelTsRef.current = now
          setLevel(Math.min(100, Math.round(Math.sqrt(sum / data.length) * 280)))
        }
        meterRafRef.current = window.requestAnimationFrame(tick)
      }
      meterRafRef.current = window.requestAnimationFrame(tick)
    } catch {
      /* level meter is optional — recording continues without it */
    }
  }

  /* ---------------- persistence ---------------- */

  const persistPut = useCallback(
    (rec: Recording) => {
      void idbPut(RECORD_STORE, toStored(rec)).catch(() => {
        toast({
          title: 'Could not save to device storage',
          description: 'This change will only last for the current session.',
          variant: 'destructive',
        })
      })
    },
    [toast],
  )

  const patchRecording = useCallback(
    (id: string, patch: RecordingPatch) => {
      const cur = recordingsRef.current.find((r) => r.id === id)
      if (!cur) return
      const updated: Recording = { ...cur, ...patch }
      setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)))
      persistPut(updated)
    },
    [persistPut],
  )

  /** Notes update state instantly and persist debounced per recording. */
  const setNote = useCallback(
    (id: string, note: string) => {
      setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, note } : r)))
      const timers = noteTimersRef.current
      const prevTimer = timers.get(id)
      if (prevTimer !== undefined) window.clearTimeout(prevTimer)
      timers.set(
        id,
        window.setTimeout(() => {
          timers.delete(id)
          const cur = recordingsRef.current.find((r) => r.id === id)
          if (cur) persistPut(cur)
        }, NOTE_DEBOUNCE_MS),
      )
    },
    [persistPut],
  )

  /* ---------------- hydrate ---------------- */

  useEffect(() => {
    let alive = true
    idbGetAll<StoredRecording>(RECORD_STORE)
      .then((rows) => {
        if (!alive) return
        const items: Recording[] = []
        let skipped = 0
        for (const row of rows) {
          if (!row || typeof row.id !== 'string' || !(row.blob instanceof Blob)) {
            skipped++
            continue
          }
          const createdAt = typeof row.createdAt === 'number' && row.createdAt > 0 ? row.createdAt : Date.now()
          const mimeType = typeof row.mimeType === 'string' && row.mimeType ? row.mimeType : 'audio/webm'
          items.push({
            id: row.id,
            url: URL.createObjectURL(row.blob),
            blob: row.blob,
            mimeType,
            duration: typeof row.duration === 'number' && row.duration > 0 ? row.duration : 0,
            size: typeof row.size === 'number' && row.size > 0 ? row.size : row.blob.size,
            createdAt,
            ext: typeof row.ext === 'string' && row.ext ? row.ext : extensionFor(mimeType),
            name: typeof row.name === 'string' && row.name.trim() ? row.name : defaultName(createdAt),
            note: typeof row.note === 'string' ? row.note : '',
          })
        }
        items.sort((a, b) => b.createdAt - a.createdAt)
        setRecordings(items)
        setHydrated(true)
        if (skipped > 0) {
          toast({
            title: `${skipped} damaged recording${skipped === 1 ? '' : 's'} skipped`,
            description: 'Some stored data could not be restored.',
            variant: 'destructive',
          })
        }
      })
      .catch(() => {
        if (!alive) return
        setHydrated(true)
        toast({
          title: 'Could not open local storage',
          description: 'Recordings will last for this session only.',
          variant: 'destructive',
        })
      })
    return () => {
      alive = false
    }
  }, [toast])

  /* flush pending note writes when the tool closes */
  useEffect(() => {
    const timers = noteTimersRef.current
    return () => {
      if (timers.size === 0) return
      const ids = Array.from(timers.keys())
      for (const id of ids) {
        const t = timers.get(id)
        if (t !== undefined) window.clearTimeout(t)
        const cur = recordingsRef.current.find((r) => r.id === id)
        if (cur) void idbPut(RECORD_STORE, toStored(cur)).catch(() => undefined)
      }
      timers.clear()
    }
  }, [])

  /* armed two-tap confirms auto-expire */
  useEffect(() => {
    if (!armedClear) return
    const t = window.setTimeout(() => setArmedClear(false), ARM_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [armedClear])

  useEffect(() => {
    if (!armedId) return
    const t = window.setTimeout(() => setArmedId(null), ARM_TIMEOUT_MS)
    return () => window.clearTimeout(t)
  }, [armedId])

  /* full teardown of mic, meter and timer on unmount (cleanup only) */
  useEffect(() => {
    return () => {
      stopTimer()
      teardownMeter()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop()
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  /* ---------------- record actions ---------------- */

  const start = async () => {
    if (!supported || starting) return
    haptic()
    setStarting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickMimeType()
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = rec
      chunksRef.current = []
      secondsRef.current = 0

      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      rec.onstop = () => {
        teardownMeter()
        setLevel(0)
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size > 0) {
          const createdAt = Date.now()
          const entry: Recording = {
            id: `${createdAt}-${Math.random().toString(36).slice(2, 8)}`,
            url: URL.createObjectURL(blob),
            blob,
            mimeType: rec.mimeType || 'audio/webm',
            duration: secondsRef.current,
            size: blob.size,
            createdAt,
            ext: extensionFor(rec.mimeType || 'audio/webm'),
            name: defaultName(createdAt),
            note: '',
          }
          setRecordings((prev) => [entry, ...prev])
          persistPut(entry)
          toast({
            title: 'Recording saved ✓',
            description: `${formatDuration(entry.duration)} · ${formatBytes(entry.size)}`,
          })
        } else {
          toast({
            title: 'Nothing recorded',
            description: 'The recording was empty. Check that your microphone is not muted.',
            variant: 'destructive',
          })
        }
        /* release the microphone */
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        recorderRef.current = null
      }

      rec.onerror = () => {
        stopTimer()
        teardownMeter()
        setLevel(0)
        setRecording(false)
        setPaused(false)
        toast({
          title: 'Recording error',
          description: 'Something went wrong with the recorder.',
          variant: 'destructive',
        })
      }

      rec.start(250)
      setSeconds(0)
      setRecording(true)
      setPaused(false)
      startTimer()
      startMeter(stream)
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      setDenied(true)
      if (name !== 'NotAllowedError') {
        toast({
          title: 'Could not start recording',
          description: 'No microphone was found or it is busy in another app.',
          variant: 'destructive',
        })
      }
    } finally {
      setStarting(false)
    }
  }

  const pause = () => {
    const rec = recorderRef.current
    if (!rec || rec.state !== 'recording') return
    rec.pause()
    stopTimer()
    setPaused(true)
  }

  const resume = () => {
    const rec = recorderRef.current
    if (!rec || rec.state !== 'paused') return
    rec.resume()
    startTimer()
    setPaused(false)
  }

  const stop = () => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return
    haptic()
    stopTimer()
    setRecording(false)
    setPaused(false)
    rec.stop()
  }

  /* ---------------- list actions ---------------- */

  const removeRecording = useCallback(
    (id: string) => {
      if (armedId !== id) {
        setArmedId(id)
        haptic()
        return
      }
      const target = recordingsRef.current.find((r) => r.id === id)
      if (target) URL.revokeObjectURL(target.url)
      forgetDecoded(id)
      setRecordings((prev) => prev.filter((r) => r.id !== id))
      setArmedId(null)
      void idbDelete(RECORD_STORE, id).catch(() => {
        toast({ title: 'Could not update device storage', variant: 'destructive' })
      })
      toast({ title: 'Recording deleted' })
    },
    [armedId, toast],
  )

  const downloadRecording = useCallback(
    (rec: Recording) => {
      const filename = `${slug(rec.name)}.${rec.ext}`
      const a = document.createElement('a')
      a.href = rec.url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      toast({ title: 'Download started ✓', description: filename })
    },
    [toast],
  )

  const shareRecording = useCallback(
    async (rec: Recording) => {
      haptic()
      const filename = `${slug(rec.name)}.${rec.ext}`
      const file = new File([rec.blob], filename, { type: rec.mimeType || 'audio/webm' })
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: rec.name })
          return
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return
          /* fall through to the download fallback */
        }
      }
      downloadRecording(rec)
      toast({
        title: 'Downloaded instead',
        description: 'Direct sharing is not available in this browser.',
      })
    },
    [downloadRecording, toast],
  )

  const clearAll = () => {
    if (!armedClear) {
      setArmedClear(true)
      haptic()
      return
    }
    recordings.forEach((r) => URL.revokeObjectURL(r.url))
    bufferCache.clear()
    peaksCache.clear()
    setRecordings([])
    setArmedClear(false)
    setArmedId(null)
    void idbClear(RECORD_STORE).catch(() => {
      toast({ title: 'Could not update device storage', variant: 'destructive' })
    })
    toast({ title: 'All recordings removed' })
  }

  const addTrimmed = useCallback(
    (source: Recording, wav: Blob, duration: number) => {
      const entry: Recording = {
        id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        url: URL.createObjectURL(wav),
        blob: wav,
        mimeType: 'audio/wav',
        duration,
        size: wav.size,
        createdAt: Date.now(),
        ext: 'wav',
        name: `${source.name} (trimmed)`,
        note: source.note,
      }
      setRecordings((prev) => [entry, ...prev])
      persistPut(entry)
      toast({
        title: 'Trimmed copy saved ✓',
        description: `${entry.name} · ${formatDuration(duration)} · ${formatBytes(wav.size)}`,
      })
    },
    [persistPut, toast],
  )

  /* ---------------- render ---------------- */

  if (!supported) {
    return (
      <div className="min-h-full bg-gradient-to-b from-zinc-900 to-black p-3 sm:p-4">
        <div className="mx-auto max-w-2xl">
          <Alert variant="destructive">
            <MicOff />
            <AlertTitle>Voice recording is not supported</AlertTitle>
            <AlertDescription>
              Your browser does not support the MediaRecorder API. Try the latest Chrome, Edge, Firefox or
              Safari.
            </AlertDescription>
          </Alert>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-900 to-black p-3 sm:p-4">
      <div className="mx-auto max-w-2xl space-y-4">
        {/* ---------------- Identity header ---------------- */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
        >
          <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-red-500/[0.10] via-transparent to-rose-600/[0.07] px-5 py-5">
            <div className="flex items-center gap-4">
              <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-red-400 via-red-500 to-rose-700 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(239_68_68/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
                <Mic className="size-7" strokeWidth={1.9} aria-hidden />
                <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold tracking-tight text-zinc-100">Voice Recorder</h2>
                <p className="text-xs text-zinc-400">Record, rename, trim &amp; annotate memos — offline.</p>
              </div>
              <Badge
                variant="outline"
                className="shrink-0 border-red-400/30 bg-red-500/10 text-[10px] font-semibold text-red-200"
              >
                v2
              </Badge>
            </div>
            <div className="mt-4 flex items-center gap-2 text-[11px] text-zinc-500">
              <Info className="size-3.5 shrink-0 text-red-400/80" aria-hidden />
              <span>Recordings, names and notes are stored only on this device — nothing is uploaded.</span>
            </div>
          </div>

          {/* ---------------- Body ---------------- */}
          <div className="space-y-4 p-4 sm:p-5">
            {denied && (
              <Alert variant="destructive">
                <TriangleAlert />
                <AlertTitle>Microphone access denied</AlertTitle>
                <AlertDescription>
                  To record audio, allow microphone access for this site in your browser settings (padlock icon
                  in the address bar → Site settings → Microphone → Allow), then try again.
                </AlertDescription>
              </Alert>
            )}

            {/* Recorder controls */}
            <Card className="items-center gap-4 p-6">
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  {recording && !paused && (
                    <span className="absolute inset-0 animate-ping rounded-full bg-red-500/30" aria-hidden="true" />
                  )}
                  <Button
                    size="icon"
                    onClick={recording ? stop : start}
                    disabled={starting}
                    aria-label={recording ? 'Stop recording' : 'Start recording'}
                    className={cn(
                      'relative size-20 rounded-full text-white',
                      recording ? 'bg-red-600 hover:bg-red-600/90' : 'bg-primary hover:bg-primary/90',
                    )}
                  >
                    {starting ? (
                      <Circle className="size-8 animate-pulse fill-current" />
                    ) : recording ? (
                      <Square className="size-7 fill-current" />
                    ) : (
                      <Mic className="size-8" />
                    )}
                  </Button>
                </div>

                {recording ? (
                  <div className="flex items-center gap-2" role="status" aria-live="polite">
                    <span className="size-3 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
                    <span className="font-mono text-2xl font-semibold tabular-nums">
                      {formatDuration(seconds)}
                    </span>
                    {paused && <Badge variant="outline">Paused</Badge>}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {starting ? 'Waiting for microphone…' : 'Tap the microphone to start recording'}
                  </p>
                )}

                {recording && (
                  <div
                    className={cn('flex w-full max-w-56 items-center gap-2', paused && 'opacity-40')}
                    aria-hidden="true"
                  >
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500 transition-[width] duration-100"
                        style={{ width: `${Math.max(4, level)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {recording && (
                <div className="flex w-full items-center justify-center gap-3">
                  <Button
                    variant="outline"
                    className="h-11 gap-2"
                    onClick={paused ? resume : pause}
                    aria-label={paused ? 'Resume recording' : 'Pause recording'}
                  >
                    {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                    {paused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button
                    variant="destructive"
                    className="h-11 gap-2"
                    onClick={stop}
                    aria-label="Stop recording"
                  >
                    <Square className="size-4 fill-current" />
                    Stop
                  </Button>
                </div>
              )}
            </Card>

            <Alert>
              <Info />
              <AlertTitle>Saved on this device</AlertTitle>
              <AlertDescription>
                Recordings with their names and notes are kept in this browser&apos;s local storage — nothing is
                ever uploaded. Use Download or Share to move a memo elsewhere; trimming always keeps the
                original.
              </AlertDescription>
            </Alert>

            {/* Recordings list */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-zinc-100">
                  Recordings{' '}
                  <Badge variant="secondary" className="ml-1">
                    {recordings.length.toLocaleString('en-US')}
                  </Badge>
                </h3>
                {recordings.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn(
                      'h-11 gap-1.5',
                      armedClear
                        ? 'bg-destructive/15 font-semibold text-destructive hover:text-destructive'
                        : 'text-destructive hover:text-destructive',
                    )}
                    onClick={clearAll}
                    aria-label="Remove all recordings"
                  >
                    <Trash2 className="size-4" /> {armedClear ? 'Confirm clear' : 'Clear all'}
                  </Button>
                )}
              </div>

              {!hydrated ? (
                <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Loading saved recordings…
                </div>
              ) : recordings.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No recordings yet — tap the microphone to create your first memo.
                </p>
              ) : (
                <div className={cn('max-h-96 space-y-3 overflow-y-auto pr-1', THIN_SCROLLBAR)}>
                  <AnimatePresence initial={false}>
                    {recordings.map((rec) => (
                      <motion.div
                        key={rec.id}
                        layout
                        initial={{ opacity: 0, y: 10, scale: 0.985 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                      >
                        <RecordingRow
                          rec={rec}
                          armed={armedId === rec.id}
                          onDelete={removeRecording}
                          onDownload={downloadRecording}
                          onShare={shareRecording}
                          onPatch={patchRecording}
                          onNote={setNote}
                          onAddTrimmed={addTrimmed}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Single recording row — rename, speed, trim, note, share, delete     */
/* ================================================================== */

const RecordingRow = memo(function RecordingRow({
  rec,
  armed,
  onDelete,
  onDownload,
  onShare,
  onPatch,
  onNote,
  onAddTrimmed,
}: {
  rec: Recording
  armed: boolean
  onDelete: (id: string) => void
  onDownload: (rec: Recording) => void
  onShare: (rec: Recording) => void
  onPatch: (id: string, patch: RecordingPatch) => void
  onNote: (id: string, note: string) => void
  onAddTrimmed: (source: Recording, wav: Blob, duration: number) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [expanded, setExpanded] = useState<'none' | 'trim' | 'notes'>('none')
  const [speed, setSpeed] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [playPos, setPlayPos] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  /** When set, playback auto-pauses at `end` (selection preview). */
  const previewRangeRef = useRef<Span | null>(null)

  /* revoke this row's object URL when it unmounts */
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(rec.url)
    }
  }, [rec.url])

  /* playback speed + pitch preservation */
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    applySpeed(el, speed)
  }, [speed])

  /* smooth playhead while playing */
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const el = audioRef.current
      if (el) setPlayPos(el.currentTime)
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [playing])

  const fixDuration = useCallback(
    (id: string, duration: number) => {
      onPatch(id, { duration })
    },
    [onPatch],
  )

  const previewSpan = useCallback((start: number, end: number) => {
    const el = audioRef.current
    if (!el) return
    haptic()
    previewRangeRef.current = { start, end }
    try {
      el.currentTime = start
    } catch {
      /* metadata not ready yet — playback will start from the top */
    }
    void el.play().catch(() => {
      previewRangeRef.current = null
    })
  }, [])

  const togglePanel = (panel: 'trim' | 'notes') => {
    haptic()
    setExpanded((cur) => (cur === panel ? 'none' : panel))
  }

  const commitRename = (value: string) => {
    setRenaming(false)
    const name = value.trim().slice(0, 80)
    if (name && name !== rec.name) onPatch(rec.id, { name })
  }

  return (
    <Card className="gap-2 p-3">
      {/* Name row — tap to rename inline */}
      <div className="flex min-w-0 items-center gap-1">
        {renaming ? (
          <input
            type="text"
            autoFocus
            defaultValue={rec.name}
            maxLength={80}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(e.currentTarget.value)
              else if (e.key === 'Escape') setRenaming(false)
            }}
            className="h-9 min-w-0 flex-1 rounded-lg border border-red-400/40 bg-black/40 px-2.5 text-sm text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-red-400/40"
            aria-label="Recording name"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              haptic()
              setRenaming(true)
            }}
            className="flex h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 text-left transition-colors hover:bg-white/5"
            title="Tap to rename"
            aria-label={`Rename ${rec.name}`}
          >
            <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-medium text-zinc-100">{rec.name}</span>
          </button>
        )}
        <span className="shrink-0 pl-1 text-xs text-muted-foreground">{dateLabel(rec.createdAt)}</span>
      </div>

      <audio
        ref={audioRef}
        controls
        src={rec.url}
        preload="metadata"
        className="h-10 w-full"
        aria-label={`Recording ${rec.name}`}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          previewRangeRef.current = null
          setPlaying(false)
        }}
        onEnded={() => {
          previewRangeRef.current = null
          setPlaying(false)
        }}
        onTimeUpdate={() => {
          const el = audioRef.current
          if (!el) return
          setPlayPos(el.currentTime)
          const span = previewRangeRef.current
          if (span && el.currentTime >= span.end - 0.015) {
            previewRangeRef.current = null
            el.pause()
          }
        }}
      />

      {/* Speed control */}
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Speed
        </span>
        <div className="flex min-w-0 flex-1 gap-1" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => {
            const active = Math.abs(speed - s) < 0.001
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSpeed(s)
                  haptic()
                }}
                aria-pressed={active}
                aria-label={`Playback speed ${s}×`}
                className={cn(
                  'h-9 min-w-0 flex-1 rounded-lg border text-[11px] font-semibold tabular-nums transition-colors',
                  active
                    ? 'border-red-400/40 bg-red-500/15 text-red-200'
                    : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white',
                )}
              >
                {s}×
              </button>
            )
          })}
        </div>
      </div>

      {/* Meta + actions */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary" className="tabular-nums">
          {formatDuration(rec.duration)}
        </Badge>
        <Badge variant="outline" className="tabular-nums">
          {formatBytes(rec.size)}
        </Badge>
        {rec.note && (
          <Badge variant="outline" className="gap-1 border-amber-400/30 bg-amber-500/10 text-amber-200">
            <StickyNote className="size-3" aria-hidden /> Note
          </Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button
            variant={expanded === 'trim' ? 'secondary' : 'outline'}
            size="sm"
            className="h-11 gap-1.5"
            onClick={() => togglePanel('trim')}
            aria-pressed={expanded === 'trim'}
            aria-label="Trim recording"
          >
            <Scissors className="size-4" /> Trim
          </Button>
          <Button
            variant={expanded === 'notes' ? 'secondary' : 'outline'}
            size="sm"
            className="h-11 gap-1.5"
            onClick={() => togglePanel('notes')}
            aria-pressed={expanded === 'notes'}
            aria-label="Edit note"
          >
            <StickyNote className="size-4" /> Note
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-zinc-300 hover:text-white"
            onClick={() => onShare(rec)}
            aria-label={`Share ${rec.name}`}
          >
            <Share2 className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 gap-1.5"
            onClick={() => onDownload(rec)}
            aria-label={`Download ${rec.name}`}
          >
            <Download className="size-4" /> Download
          </Button>
          <Button
            variant={armed ? 'destructive' : 'ghost'}
            size="sm"
            className={cn('h-11 gap-1.5 px-3', !armed && 'text-destructive hover:text-destructive')}
            onClick={() => onDelete(rec.id)}
            aria-label={armed ? 'Confirm delete recording' : 'Delete recording'}
          >
            <Trash2 className="size-4" />
            {armed && 'Sure?'}
          </Button>
        </div>
      </div>

      {/* Trim panel — waveform with selection handles */}
      {expanded === 'trim' && (
        <TrimPanel
          rec={rec}
          playPos={playPos}
          onPreview={previewSpan}
          onAddTrimmed={onAddTrimmed}
          onFixDuration={fixDuration}
        />
      )}

      {/* Notes panel */}
      {expanded === 'notes' && (
        <div className="mt-1 space-y-1.5 rounded-xl border border-white/10 bg-black/30 p-2.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <StickyNote className="size-3" aria-hidden /> Note
          </div>
          <Textarea
            value={rec.note}
            onChange={(e) => onNote(rec.id, e.target.value)}
            placeholder="Add a note for this recording — saved automatically…"
            className="min-h-20 resize-y border-white/10 bg-black/30 text-sm"
            maxLength={4000}
            aria-label={`Note for ${rec.name}`}
          />
          <p className="text-right text-[10px] text-muted-foreground">
            {rec.note.length.toLocaleString('en-US')} / 4,000 · saved automatically
          </p>
        </div>
      )}
    </Card>
  )
})

/* ================================================================== */
/* Trim panel — decoded waveform, selection handles, WAV export        */
/* ================================================================== */

function TrimPanel({
  rec,
  playPos,
  onPreview,
  onAddTrimmed,
  onFixDuration,
}: {
  rec: Recording
  playPos: number
  onPreview: (start: number, end: number) => void
  onAddTrimmed: (source: Recording, wav: Blob, duration: number) => void
  onFixDuration: (id: string, duration: number) => void
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const dragModeRef = useRef<'new' | 'start' | 'end' | null>(null)
  const anchorRef = useRef(0)
  const fixRef = useRef(onFixDuration)

  const [canvasW, setCanvasW] = useState(0)
  const [status, setStatus] = useState<'decoding' | 'ready' | 'error'>('decoding')
  const [duration, setDuration] = useState(0)
  const [peaks, setPeaks] = useState<Peaks | null>(null)
  const [selection, setSelection] = useState<Span | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    fixRef.current = onFixDuration
  }, [onFixDuration])

  /* decode the stored blob + build cached peaks (async, alive-guarded) */
  useEffect(() => {
    let alive = true
    const run = async () => {
      try {
        const buf = await decodeRecording(rec.id, rec.blob)
        if (!alive) return
        bufferRef.current = buf
        setDuration(buf.duration)
        setPeaks(peaksCache.get(rec.id) ?? cachePeaks(rec.id, computePeaks(buf)))
        setStatus('ready')
        /* recorded duration is wall-clock; prefer the decoded real duration */
        if (Math.abs(buf.duration - rec.duration) > 0.25) fixRef.current(rec.id, buf.duration)
      } catch {
        if (alive) setStatus('error')
      }
    }
    void run()
    return () => {
      alive = false
    }
  }, [rec.id, rec.blob, rec.duration])

  /* track panel width for DPR-sharp canvas painting */
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setCanvasW(Math.max(0, Math.floor(entry.contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const dur = duration

  /* waveform + selection + playhead painting */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks || canvasW < 2 || dur <= 0) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.floor(canvasW * dpr)
    canvas.height = Math.floor(WAVE_H * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvasW, WAVE_H)

    // backdrop + centrelines
    ctx.fillStyle = 'rgba(255,255,255,0.03)'
    ctx.fillRect(0, 0, canvasW, WAVE_H)
    ctx.fillStyle = 'rgba(255,255,255,0.06)'
    for (let gy = 1; gy < 4; gy++) ctx.fillRect(0, (WAVE_H / 4) * gy - 0.5, canvasW, 1)
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(0, WAVE_H / 2 - 0.5, canvasW, 1)

    // peaks — red gradient, mirrored around the centre line
    const grad = ctx.createLinearGradient(0, 0, 0, WAVE_H)
    grad.addColorStop(0, '#fca5a5')
    grad.addColorStop(0.5, '#ef4444')
    grad.addColorStop(1, '#9f1239')
    ctx.fillStyle = grad
    const mid = WAVE_H / 2
    for (let x = 0; x < canvasW; x++) {
      const b = Math.min(PEAK_BUCKETS - 1, Math.floor((x * PEAK_BUCKETS) / canvasW))
      const mn = peaks.mins[b]
      const mx = peaks.maxs[b]
      const y0 = clamp(mid - mx * (mid - 3), 1, WAVE_H - 1)
      const y1 = clamp(mid - mn * (mid - 3), 1, WAVE_H - 1)
      ctx.fillRect(x, y0, 1, Math.max(1.5, y1 - y0))
    }

    // veil outside the selection so the keep region pops
    if (selection && selection.end - selection.start >= MIN_SELECTION) {
      const xs = (selection.start / dur) * canvasW
      const xe = (selection.end / dur) * canvasW
      ctx.fillStyle = 'rgba(9,9,11,0.55)'
      ctx.fillRect(0, 0, Math.max(0, xs), WAVE_H)
      ctx.fillRect(Math.min(canvasW, xe), 0, canvasW - Math.min(canvasW, xe), WAVE_H)
      ctx.fillStyle = 'rgba(239,68,68,0.12)'
      ctx.fillRect(xs, 0, Math.max(1, xe - xs), WAVE_H)

      // edge handles
      for (const hx of [xs, xe]) {
        ctx.fillStyle = '#ef4444'
        ctx.fillRect(hx - 1.5, 0, 3, WAVE_H)
        ctx.fillStyle = '#fecaca'
        ctx.fillRect(hx - 1.5, mid - 9, 3, 18)
      }
    }

    // playhead (synced with the row's native audio element)
    if (playPos > 0) {
      const px = clamp((playPos / dur) * canvasW, 0, canvasW)
      ctx.fillStyle = 'rgba(255,255,255,0.92)'
      ctx.fillRect(px - 0.75, 0, 1.5, WAVE_H)
    }
  }, [peaks, selection, playPos, canvasW, dur])

  /* ---------------- selection pointer logic ---------------- */

  const timeAt = useCallback(
    (clientX: number): number => {
      const canvas = canvasRef.current
      if (!canvas || dur <= 0) return 0
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, rect.width)
      return clamp(((clientX - rect.left) / w) * dur, 0, dur)
    },
    [dur],
  )

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (dur <= 0) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.setPointerCapture(e.pointerId)
      haptic()
      let mode: 'new' | 'start' | 'end' | null = null
      if (selection && selection.end - selection.start >= MIN_SELECTION) {
        const rect = canvas.getBoundingClientRect()
        const w = Math.max(1, rect.width)
        const xs = (selection.start / dur) * w
        const xe = (selection.end / dur) * w
        const px = e.clientX - rect.left
        if (Math.abs(px - xs) <= 22) mode = 'start'
        else if (Math.abs(px - xe) <= 22) mode = 'end'
      }
      if (!mode) {
        mode = 'new'
        const t = timeAt(e.clientX)
        anchorRef.current = t
        setSelection({ start: t, end: t })
      }
      dragModeRef.current = mode
      setDragging(true)
    },
    [dur, selection, timeAt],
  )

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const mode = dragModeRef.current
      if (!mode || dur <= 0) return
      const t = timeAt(e.clientX)
      if (mode === 'new') {
        const a = anchorRef.current
        setSelection({ start: Math.min(a, t), end: Math.max(a, t) })
      } else if (mode === 'start') {
        setSelection((s) => (s ? { start: clamp(t, 0, s.end - MIN_SELECTION / 2), end: s.end } : s))
      } else {
        setSelection((s) => (s ? { start: s.start, end: clamp(t, s.start + MIN_SELECTION / 2, dur) } : s))
      }
    },
    [dur, timeAt],
  )

  const onPointerUp = useCallback(() => {
    const mode = dragModeRef.current
    dragModeRef.current = null
    setDragging(false)
    if (mode === 'new' && selection && selection.end - selection.start < MIN_SELECTION) {
      setSelection(null)
    }
  }, [selection])

  const selectAll = () => {
    haptic()
    setSelection({ start: 0, end: dur })
  }

  const clearSelection = () => {
    haptic()
    setSelection(null)
  }

  const saveTrim = () => {
    const buf = bufferRef.current
    if (!buf || !selection) return
    if (selection.end - selection.start < MIN_SELECTION) return
    const startSample = clamp(Math.floor(selection.start * buf.sampleRate), 0, Math.max(0, buf.length - 1))
    const endSample = clamp(Math.ceil(selection.end * buf.sampleRate), startSample + 1, buf.length)
    const slice = sliceBuffer(buf, startSample, endSample)
    const wav = encodeWav(slice)
    haptic()
    onAddTrimmed(rec, wav, slice.duration)
    setSelection(null)
  }

  return (
    <div ref={wrapRef} className="mt-1 space-y-2 rounded-xl border border-white/10 bg-black/30 p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        <Scissors className="size-3" aria-hidden /> Trim
      </div>

      {status === 'decoding' && (
        <div className="flex h-16 items-center justify-center gap-2 rounded-lg border border-white/5 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Decoding audio…
        </div>
      )}
      {status === 'error' && (
        <div className="flex h-16 items-center justify-center gap-2 rounded-lg border border-white/5 text-sm text-destructive">
          <TriangleAlert className="size-4" aria-hidden /> Could not decode this recording for trimming.
        </div>
      )}

      {status === 'ready' && (
        <>
          <canvas
            ref={canvasRef}
            style={{ height: WAVE_H, touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={cn(
              'block w-full cursor-crosshair rounded-lg border border-white/10 bg-zinc-900/70',
              dragging && 'cursor-ew-resize',
            )}
            role="img"
            aria-label="Waveform — drag to choose the keep region"
          />

          <div className="flex flex-wrap items-center gap-2">
            {selection ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold tabular-nums text-red-200">
                <Scissors className="size-3" aria-hidden />
                {fmtSpan(selection.start)} → {fmtSpan(selection.end)} ·{' '}
                {fmtSpan(selection.end - selection.start)}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-zinc-500">
                Drag on the waveform to pick the keep region
              </span>
            )}
            <div className="ml-auto flex gap-1.5">
              <button
                type="button"
                onClick={selectAll}
                className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={!selection}
                className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={saveTrim}
              disabled={!selection}
              className="h-11 gap-1.5 rounded-xl bg-gradient-to-r from-red-400 via-red-500 to-rose-600 font-semibold text-white shadow-lg hover:from-red-300 hover:via-red-400 hover:to-rose-500 disabled:opacity-50"
            >
              <Scissors className="size-4" /> Save trimmed copy
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => selection && onPreview(selection.start, selection.end)}
              disabled={!selection}
              className="h-11 gap-1.5 rounded-xl"
            >
              <Play className="size-4" /> Preview
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Original is kept — the copy is added as WAV.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
