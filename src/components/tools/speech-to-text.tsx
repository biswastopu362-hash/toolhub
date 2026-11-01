'use client'

/**
 * Speech to Text — mic → live transcript, hands-free voice notes.
 *
 * Two engines with automatic selection:
 *  1. LIVE (preferred) — Web Speech API with continuous + interim results and
 *     an auto-restart guard (Chrome ends the session after silence). Interim
 *     text renders in a lighter tone appended to the committed transcript.
 *  2. FALLBACK — MediaRecorder records a clip; on stop the blob is base64
 *     encoded and POSTed to /api/asr, then the result is appended.
 *
 * The transcript is editable, copyable, downloadable — and can be saved
 * straight into the Notes app ('toolhub-notes' localStorage). Sessions are
 * kept in 'toolhub-stt-history' (max 20) and can be restored with one tap.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AudioLines,
  Check,
  ChevronDown,
  Copy,
  Download,
  Globe,
  History,
  Loader2,
  Mic,
  MicOff,
  NotebookPen,
  ShieldAlert,
  Square,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type Engine = 'live' | 'fallback' | 'none'

interface SttSession {
  text: string
  lang: string
  at: number
}

/** Minimal mirror of the Notes app model (see notes.tsx). */
type NoteColorId = 'default' | 'amber' | 'emerald' | 'sky' | 'rose' | 'violet'

interface NoteLike {
  id: string
  title: string
  body: string
  createdAt: number
  updatedAt: number
  folderId: string | null
  pinned: boolean
  colorId: NoteColorId
}

const LANG_KEY = 'toolhub-stt-lang'
const HISTORY_KEY = 'toolhub-stt-history'
const NOTES_KEY = 'toolhub-notes'
const HISTORY_MAX = 20
const QUIET_RESTART_CAP = 15

const LANGUAGES: { code: string; name: string; flag: string }[] = [
  { code: 'en-US', name: 'English (US)', flag: '🇺🇸' },
  { code: 'bn-BD', name: 'বাংলা — Bengali', flag: '🇧🇩' },
  { code: 'hi-IN', name: 'हिन्दी — Hindi', flag: '🇮🇳' },
  { code: 'ar-SA', name: 'العربية — Arabic', flag: '🇸🇦' },
  { code: 'es-ES', name: 'Español — Spanish', flag: '🇪🇸' },
  { code: 'fr-FR', name: 'Français — French', flag: '🇫🇷' },
  { code: 'zh-CN', name: '中文 — Chinese', flag: '🇨🇳' },
  { code: 'ja-JP', name: '日本語 — Japanese', flag: '🇯🇵' },
  { code: 'ur-PK', name: 'اردو — Urdu', flag: '🇵🇰' },
  { code: 'ta-IN', name: 'தமிழ் — Tamil', flag: '🇮🇳' },
]

function langFlag(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.flag ?? '🌐'
}

function fmtTime(total: number): string {
  const m = Math.floor(total / 60)
  const s = Math.floor(total % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function wordCount(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

/** Append a spoken chunk with smart spacing (also for CJK punctuation). */
function appendChunk(base: string, chunk: string): string {
  const next = chunk.trim()
  if (!next) return base
  if (!base) return next
  if (/\s$/.test(base) || /^[,.!?;:…、。，；：]/.test(next)) return base + next
  return `${base} ${next}`
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-stt`
}

function haptic(): void {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported — silent */
  }
}

/* ================================================================== */
/* Web Speech API — minimal hand-rolled typings (unknown-cast, safe)   */
/* ================================================================== */

interface RecognitionAlternativeLike {
  transcript: string
}

interface RecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  [index: number]: RecognitionAlternativeLike
}

interface RecognitionResultListLike {
  readonly length: number
  [index: number]: RecognitionResultLike
}

interface RecognitionEventLike extends Event {
  readonly resultIndex: number
  readonly results: RecognitionResultListLike
}

interface RecognitionErrorEventLike extends Event {
  readonly error: string
}

interface RecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: RecognitionEventLike) => void) | null
  onerror: ((event: RecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => RecognitionLike

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  if (typeof w.SpeechRecognition === 'function') return w.SpeechRecognition as RecognitionCtor
  if (typeof w.webkitSpeechRecognition === 'function') return w.webkitSpeechRecognition as RecognitionCtor
  return null
}

/* ================================================================== */
/* Recorder helpers (fallback engine)                                  */
/* ================================================================== */

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the recording'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function SpeechToTextApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [mounted, setMounted] = useState(false)
  const [engine, setEngine] = useState<Engine>('none')
  const [lang, setLang] = useState('en-US')
  const [listening, setListening] = useState(false) // live engine active (intent)
  const [recording, setRecording] = useState(false) // fallback engine active
  const [transcribing, setTranscribing] = useState(false) // /api/asr in flight
  const [seconds, setSeconds] = useState(0)
  const [interim, setInterim] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [history, setHistory] = useState<SttSession[]>([])

  /* ---------------- refs ---------------- */
  const recognitionRef = useRef<RecognitionLike | null>(null)
  const wantListenRef = useRef(false)
  const quietRestartsRef = useRef(0)
  const langRef = useRef('en-US')
  const transcriptRef = useRef('')
  const aliveRef = useRef(true)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const secondsRef = useRef(0)
  const restartTimerRef = useRef<number | null>(null)
  const hintTimerRef = useRef<number | null>(null)
  const clearTimerRef = useRef<number | null>(null)
  const wipeTimerRef = useRef<number | null>(null)
  const copiedTimerRef = useRef<number | null>(null)

  /* ---------------- derived ---------------- */
  const hasText = transcript.trim().length > 0
  const active = listening || recording || transcribing

  const statusText = transcribing
    ? 'Transcribing your clip…'
    : engine === 'live'
      ? listening
        ? 'Listening — speak naturally'
        : 'Tap the mic and start speaking'
      : recording
        ? `Recording · ${fmtTime(seconds)}`
        : 'Tap to record a clip for transcription'

  /* ================================================================== */
  /* Mount / teardown                                                    */
  /* ================================================================== */

  useEffect(() => {
    aliveRef.current = true

    const Ctor = recognitionCtor()
    const canRecord =
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    setEngine(Ctor ? 'live' : canRecord ? 'fallback' : 'none')

    try {
      const savedLang = localStorage.getItem(LANG_KEY)
      if (savedLang && LANGUAGES.some((l) => l.code === savedLang)) {
        setLang(savedLang)
        langRef.current = savedLang
      }
      const raw = localStorage.getItem(HISTORY_KEY)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          const sessions = parsed.filter(
            (s): s is SttSession =>
              !!s &&
              typeof s === 'object' &&
              typeof (s as SttSession).text === 'string' &&
              typeof (s as SttSession).lang === 'string' &&
              typeof (s as SttSession).at === 'number'
          )
          setHistory(sessions.slice(0, HISTORY_MAX))
        }
      }
    } catch {
      /* corrupted store — start fresh */
    }

    setMounted(true)

    return () => {
      aliveRef.current = false
      wantListenRef.current = false
      if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current)
      if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current)
      if (wipeTimerRef.current !== null) window.clearTimeout(wipeTimerRef.current)
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      try {
        recognitionRef.current?.abort()
      } catch {
        /* ignore */
      }
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

  /* Keep a ref mirror of the transcript for non-reactive callbacks. */
  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  /* ================================================================== */
  /* Shared helpers                                                      */
  /* ================================================================== */

  const flashHint = useCallback((message: string, sticky = false) => {
    setHint(message)
    if (hintTimerRef.current !== null) window.clearTimeout(hintTimerRef.current)
    hintTimerRef.current = sticky ? null : window.setTimeout(() => setHint(null), 4200)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const startTimer = useCallback(() => {
    stopTimer()
    secondsRef.current = 0
    setSeconds(0)
    timerRef.current = window.setInterval(() => {
      secondsRef.current += 1
      setSeconds(secondsRef.current)
    }, 1000)
  }, [stopTimer])

  const commitSession = useCallback((text: string, sessionLang: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    setHistory((prev) => {
      const next = [
        { text: trimmed, lang: sessionLang, at: Date.now() },
        ...prev.filter((s) => s.text !== trimmed),
      ].slice(0, HISTORY_MAX)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable — keep memory-only */
      }
      return next
    })
  }, [])

  /* ================================================================== */
  /* Engine 1 — LIVE (Web Speech API)                                    */
  /* ================================================================== */

  const startLive = useCallback(() => {
    const Ctor = recognitionCtor()
    if (!Ctor) return
    setDenied(false)

    let rec = recognitionRef.current
    if (!rec) {
      rec = new Ctor()
      rec.continuous = true
      rec.interimResults = true
      rec.maxAlternatives = 1

      rec.onresult = (event) => {
        quietRestartsRef.current = 0
        let interimText = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (!result) continue
          const chunk = result[0]?.transcript ?? ''
          if (!chunk) continue
          if (result.isFinal) setTranscript((prev) => appendChunk(prev, chunk))
          else interimText += chunk
        }
        setInterim(interimText)
      }

      rec.onerror = (event) => {
        const code = event.error
        if (code === 'no-speech' || code === 'aborted') return // onend decides
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          wantListenRef.current = false
          setListening(false)
          setDenied(true)
          haptic()
          return
        }
        if (code === 'audio-capture') {
          wantListenRef.current = false
          setListening(false)
          flashHint('No microphone was found on this device.', true)
          toast({ title: 'No microphone', description: 'Plug one in (or enable it) and try again.' })
          return
        }
        if (code === 'network') {
          flashHint('Network hiccup — reconnecting live transcription…')
          return
        }
        flashHint(`Speech engine error (${code}). Tap the mic to retry.`, true)
      }

      rec.onend = () => {
        setInterim('')
        if (!wantListenRef.current) {
          setListening(false)
          return
        }
        // Chrome ends the session after silence — restart to stay hands-free.
        if (quietRestartsRef.current >= QUIET_RESTART_CAP) {
          wantListenRef.current = false
          setListening(false)
          flashHint('Paused — nothing heard for a while. Tap the mic to continue.', true)
          return
        }
        quietRestartsRef.current += 1
        if (restartTimerRef.current !== null) window.clearTimeout(restartTimerRef.current)
        restartTimerRef.current = window.setTimeout(() => {
          restartTimerRef.current = null
          if (!wantListenRef.current) return
          const r = recognitionRef.current
          if (!r) return
          r.lang = langRef.current
          try {
            r.start()
          } catch {
            /* already started — ignore */
          }
        }, 250)
      }

      recognitionRef.current = rec
    }

    rec.lang = langRef.current
    setListening(true)
    try {
      rec.start()
    } catch {
      /* already running — ignore */
    }
  }, [flashHint, toast])

  const stopLive = useCallback(() => {
    wantListenRef.current = false
    setListening(false)
    setInterim('')
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.stop() // flushes any pending finals before onend
      } catch {
        /* ignore */
      }
    }
    commitSession(transcriptRef.current, langRef.current)
  }, [commitSession])

  /* ================================================================== */
  /* Engine 2 — FALLBACK (MediaRecorder → /api/asr)                      */
  /* ================================================================== */

  const handleClipReady = useCallback(async () => {
    const mimeType = recorderRef.current?.mimeType || 'audio/webm'
    recorderRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (!aliveRef.current) return

    setTranscribing(true)
    try {
      const blob = new Blob(chunksRef.current, { type: mimeType })
      chunksRef.current = []
      const audio = await blobToBase64(blob)
      const res = await fetch('/api/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio }),
      })
      const data = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null
      if (!aliveRef.current) return
      if (!res.ok) {
        throw new Error(
          typeof data?.error === 'string' ? data.error : `Transcription failed (${res.status})`
        )
      }
      const text = typeof data?.text === 'string' ? data.text.trim() : ''
      if (text) {
        setTranscript((prev) => appendChunk(prev, text))
        commitSession(text, langRef.current)
        toast({ title: 'Transcribed ✓', description: 'Text added to your transcript.' })
      } else {
        flashHint('The clip was silent — try again a little closer to the mic.', true)
      }
    } catch (error) {
      if (aliveRef.current) {
        toast({
          title: 'Transcription failed',
          description: error instanceof Error ? error.message : 'Please try again.',
        })
      }
    } finally {
      if (aliveRef.current) setTranscribing(false)
    }
  }, [commitSession, flashHint, toast])

  const startFallback = useCallback(async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      return
    }
    setDenied(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!aliveRef.current) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const mimeType = pickMimeType()
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        void handleClipReady()
      }
      rec.start(250)
      recorderRef.current = rec
      streamRef.current = stream
      startTimer()
      setRecording(true)
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
        setDenied(true)
        haptic()
      } else if (error instanceof DOMException && error.name === 'NotFoundError') {
        toast({ title: 'No microphone', description: 'Plug one in (or enable it) and try again.' })
      } else {
        toast({
          title: 'Could not start recording',
          description: error instanceof Error ? error.message : 'Please try again.',
        })
      }
    }
  }, [handleClipReady, startTimer, toast])

  const stopFallback = useCallback(() => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') {
      setRecording(false)
      return
    }
    stopTimer()
    setRecording(false)
    try {
      rec.stop() // onstop → handleClipReady → /api/asr
    } catch {
      /* ignore */
    }
  }, [stopTimer])

  /* ================================================================== */
  /* Controls                                                            */
  /* ================================================================== */

  const toggleMic = useCallback(() => {
    haptic()
    if (engine === 'live') {
      if (listening) stopLive()
      else startLive()
    } else if (engine === 'fallback') {
      if (recording) stopFallback()
      else void startFallback()
    }
  }, [engine, listening, recording, startFallback, startLive, stopFallback, stopLive])

  const retryMic = useCallback(() => {
    setDenied(false)
    if (engine === 'live') startLive()
    else if (engine === 'fallback') void startFallback()
  }, [engine, startFallback, startLive])

  const changeLang = useCallback((next: string) => {
    setLang(next)
    langRef.current = next
    try {
      localStorage.setItem(LANG_KEY, next)
    } catch {
      /* ignore */
    }
    quietRestartsRef.current = 0
    // Mid-session switch: stop; the onend guard restarts with the new language.
    if (wantListenRef.current && recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        /* ignore */
      }
    }
  }, [])

  const copyTranscript = useCallback(async () => {
    const text = transcript.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      haptic()
      setCopied(true)
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1600)
      toast({ title: 'Copied ✓', description: 'Transcript copied to clipboard.' })
    } catch {
      toast({ title: 'Copy failed', description: 'Your browser blocked clipboard access.' })
    }
  }, [toast, transcript])

  const downloadTxt = useCallback(() => {
    const text = transcript.trim()
    if (!text) return
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `voice-note-${new Date().toISOString().slice(0, 10)}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
    haptic()
    toast({ title: 'Downloaded ✓', description: 'Saved as a .txt file.' })
  }, [toast, transcript])

  const clearTranscript = useCallback(() => {
    if (!hasText && !interim) return
    if (!confirmClear) {
      setConfirmClear(true)
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = window.setTimeout(() => setConfirmClear(false), 2600)
      return
    }
    if (clearTimerRef.current !== null) {
      window.clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
    setConfirmClear(false)
    setTranscript('')
    setInterim('')
    haptic()
    toast({ title: 'Cleared', description: 'Transcript emptied — history keeps your sessions.' })
  }, [confirmClear, hasText, interim, toast])

  /* ================================================================== */
  /* Save into Notes ('toolhub-notes' read-modify-write)                 */
  /* ================================================================== */

  const saveToNotes = useCallback(() => {
    const body = transcript.trim()
    if (!body) return
    let notes: NoteLike[] = []
    try {
      const raw = localStorage.getItem(NOTES_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : null
      if (Array.isArray(parsed)) notes = parsed as NoteLike[]
    } catch {
      notes = [] // corrupt store — start a fresh array
    }
    const now = Date.now()
    notes.unshift({
      id: makeId(),
      title: `Voice note — ${new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}`,
      body,
      createdAt: now,
      updatedAt: now,
      folderId: null,
      pinned: false,
      colorId: 'emerald',
    })
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
    } catch {
      toast({ title: 'Could not save', description: 'Storage is full or unavailable.' })
      return
    }
    haptic()
    toast({ title: 'Saved to Notes ✓', description: 'Open the Notes app to see it.' })
  }, [toast, transcript])

  /* ================================================================== */
  /* History actions                                                     */
  /* ================================================================== */

  const restoreSession = useCallback(
    (session: SttSession) => {
      setTranscript(session.text)
      haptic()
      toast({ title: 'Restored', description: 'Session text is back in the transcript.' })
    },
    [toast]
  )

  const copySession = useCallback(
    async (session: SttSession) => {
      try {
        await navigator.clipboard.writeText(session.text)
        haptic()
        toast({ title: 'Copied ✓', description: 'Session copied to clipboard.' })
      } catch {
        toast({ title: 'Copy failed', description: 'Your browser blocked clipboard access.' })
      }
    },
    [toast]
  )

  const wipeHistory = useCallback(() => {
    if (history.length === 0) return
    if (!confirmWipe) {
      setConfirmWipe(true)
      if (wipeTimerRef.current !== null) window.clearTimeout(wipeTimerRef.current)
      wipeTimerRef.current = window.setTimeout(() => setConfirmWipe(false), 2600)
      return
    }
    if (wipeTimerRef.current !== null) {
      window.clearTimeout(wipeTimerRef.current)
      wipeTimerRef.current = null
    }
    setConfirmWipe(false)
    setHistory([])
    try {
      localStorage.removeItem(HISTORY_KEY)
    } catch {
      /* ignore */
    }
    haptic()
    toast({ title: 'History cleared', description: 'All recorded sessions removed.' })
  }, [confirmWipe, history.length, toast])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-teal-500/[0.1] via-transparent to-emerald-500/[0.08] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-teal-300 via-teal-500 to-emerald-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(20_184_166/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <AudioLines className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Speech to Text</h2>
              <p className="text-xs text-zinc-400">Hands-free dictation → editable voice notes.</p>
            </div>
            <span
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider',
                engine === 'live' && 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300',
                engine === 'fallback' && 'border-amber-400/30 bg-amber-500/10 text-amber-300',
                engine === 'none' && 'border-white/10 bg-white/5 text-zinc-500'
              )}
            >
              {engine === 'live' ? (
                <>
                  <AudioLines className="size-3" aria-hidden /> Live
                </>
              ) : engine === 'fallback' ? (
                <>
                  <Square className="size-2.5 fill-current" aria-hidden /> Recorder
                </>
              ) : (
                <>
                  <MicOff className="size-3" aria-hidden /> N/A
                </>
              )}
            </span>
          </div>
        </div>

        {!mounted ? (
          /* ---------------- Hydrating ---------------- */
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
            ))}
          </div>
        ) : (
          <div className="space-y-5 p-4 sm:p-5">
            {engine === 'none' ? (
              /* ---------------- Unsupported ---------------- */
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-center">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.05] ring-1 ring-white/10">
                  <MicOff className="size-5 text-zinc-400" aria-hidden />
                </span>
                <p className="text-sm font-bold text-zinc-200">Speech input isn&apos;t available here</p>
                <p className="max-w-[44ch] text-xs leading-relaxed text-zinc-500">
                  This browser exposes neither the Web Speech API nor an audio recorder we can use.
                  Try Chrome or Edge — meanwhile you can still paste text below and use Copy,
                  Download and Save into Notes.
                </p>
              </div>
            ) : (
              /* ---------------- Mic stage ---------------- */
              <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-teal-500/[0.08] via-transparent to-transparent p-4 sm:p-5">
                {/* Language picker */}
                <label className="block">
                  <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                    <Globe className="size-3" aria-hidden /> Recognition language
                  </span>
                  <span className="relative block">
                    <Globe
                      className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
                      aria-hidden
                    />
                    <select
                      value={lang}
                      onChange={(e) => changeLang(e.target.value)}
                      disabled={transcribing}
                      className="h-11 w-full appearance-none rounded-xl border border-white/10 bg-white/[0.04] pl-9 pr-9 text-sm text-zinc-100 outline-none transition-colors [color-scheme:dark] focus:border-teal-400/40 disabled:opacity-50"
                    >
                      {LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code} className="bg-zinc-900 text-zinc-100">
                          {l.flag} {l.name} · {l.code}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
                      aria-hidden
                    />
                  </span>
                </label>

                {/* Mic button */}
                <div className="mt-6 flex flex-col items-center">
                  <span className="relative flex">
                    {listening && (
                      <>
                        <motion.span
                          aria-hidden
                          className="absolute inset-0 rounded-full border-2 border-teal-400/70"
                          animate={{ scale: [1, 1.75], opacity: [0.65, 0] }}
                          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                        />
                        <motion.span
                          aria-hidden
                          className="absolute inset-0 rounded-full border-2 border-emerald-400/50"
                          animate={{ scale: [1, 1.75], opacity: [0.5, 0] }}
                          transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut', delay: 0.8 }}
                        />
                      </>
                    )}
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.92 }}
                      onClick={toggleMic}
                      disabled={transcribing}
                      aria-label={
                        active
                          ? 'Stop'
                          : engine === 'live'
                            ? 'Start live transcription'
                            : 'Start recording'
                      }
                      className={cn(
                        'relative flex size-24 items-center justify-center rounded-full ring-1 ring-white/25 transition-colors disabled:opacity-40',
                        listening || recording
                          ? 'bg-gradient-to-br from-rose-300 to-rose-500 text-white shadow-[0_18px_40px_-12px_rgb(244_63_94/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]'
                          : 'bg-gradient-to-br from-teal-300 via-teal-500 to-emerald-600 text-zinc-950 shadow-[0_18px_40px_-12px_rgb(20_184_166/0.8),inset_0_1px_1px_rgb(255_255_255/0.4)]'
                      )}
                    >
                      {transcribing ? (
                        <Loader2 className="size-9 animate-spin" aria-hidden />
                      ) : listening || recording ? (
                        <Square className="size-8 fill-current" aria-hidden />
                      ) : (
                        <Mic className="size-9" strokeWidth={1.9} aria-hidden />
                      )}
                    </motion.button>
                  </span>

                  <p className="mt-4 text-sm font-semibold text-zinc-200">{statusText}</p>
                  <p className="mt-0.5 text-center text-xs text-zinc-500">
                    {engine === 'live'
                      ? 'Live mode — words appear as you speak, hands-free.'
                      : 'Recorder mode — record, stop, then the clip is transcribed.'}
                  </p>

                  {/* Fallback level bars */}
                  {recording && (
                    <div className="mt-4 flex h-8 items-end gap-1.5" aria-hidden>
                      {[0.62, 0.85, 0.5, 0.95, 0.4, 0.75, 0.55].map((peak, i) => (
                        <motion.span
                          key={i}
                          className="h-full w-1.5 origin-bottom rounded-full bg-gradient-to-t from-teal-500 to-emerald-300"
                          animate={{ scaleY: [0.25, peak, 0.4, 0.85, 0.3] }}
                          transition={{
                            duration: 1.1 + (i % 4) * 0.17,
                            repeat: Infinity,
                            repeatType: 'mirror',
                            ease: 'easeInOut',
                            delay: i * 0.06,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>

                {/* Transient hint */}
                <AnimatePresence>
                  {hint && (
                    <motion.p
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/[0.08] px-3 py-2 text-center text-xs text-amber-200"
                    >
                      {hint}
                    </motion.p>
                  )}
                </AnimatePresence>
              </section>
            )}

            {/* ---------------- Permission denied ---------------- */}
            {denied && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-start gap-3 rounded-2xl border border-rose-400/25 bg-rose-500/[0.08] p-4"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-300">
                  <ShieldAlert className="size-4.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-rose-200">Microphone access blocked</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                    Allow mic permission for this site (padlock icon in the address bar →
                    Microphone → Allow), then tap retry.
                  </p>
                  <button
                    type="button"
                    onClick={retryMic}
                    className="mt-2.5 inline-flex h-9 items-center gap-1.5 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 text-xs font-bold text-rose-200 transition-colors hover:bg-rose-500/20"
                  >
                    <Mic className="size-3.5" aria-hidden /> Retry microphone
                  </button>
                </div>
              </motion.div>
            )}

            {/* ---------------- Transcript panel ---------------- */}
            <section className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]">
              <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  <AudioLines className="size-3 text-teal-400" aria-hidden /> Transcript
                </span>
                <span className="text-[10px] font-medium tabular-nums text-zinc-500">
                  {wordCount(transcript)} words · {transcript.length} chars
                </span>
              </div>

              <Textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                placeholder="Your spoken words will appear here — edit freely…"
                rows={6}
                className="min-h-36 resize-y border-0 bg-transparent px-4 py-3 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-0 focus-visible:ring-offset-0"
              />

              {/* Interim (uncommitted) speech — lighter tone, appended live */}
              {interim && (
                <p className="border-t border-white/5 px-4 py-2.5 text-sm italic leading-relaxed text-zinc-500">
                  {interim}
                  <span
                    className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse rounded-full bg-teal-400 align-middle"
                    aria-hidden
                  />
                </p>
              )}

              <div className="space-y-2 border-t border-white/5 p-3">
                <Button
                  onClick={saveToNotes}
                  disabled={!hasText}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
                >
                  <NotebookPen className="size-4" aria-hidden /> Save into Notes
                </Button>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => void copyTranscript()}
                    disabled={!hasText}
                    className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] text-xs font-bold text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
                  >
                    {copied ? (
                      <Check className="size-3.5 text-emerald-400" aria-hidden />
                    ) : (
                      <Copy className="size-3.5" aria-hidden />
                    )}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={downloadTxt}
                    disabled={!hasText}
                    className="flex h-11 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] text-xs font-bold text-zinc-300 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
                  >
                    <Download className="size-3.5" aria-hidden /> .txt
                  </button>
                  <button
                    type="button"
                    onClick={clearTranscript}
                    disabled={!hasText && !interim}
                    className={cn(
                      'flex h-11 items-center justify-center gap-1.5 rounded-xl border text-xs font-bold transition-colors disabled:opacity-40',
                      confirmClear
                        ? 'border-rose-400/40 bg-rose-500/15 text-rose-200'
                        : 'border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-white'
                    )}
                  >
                    {confirmClear ? 'Sure?' : 'Clear'}
                  </button>
                </div>
              </div>
            </section>

            {/* ---------------- History ---------------- */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  <History className="size-3" aria-hidden /> Recent sessions
                  {history.length > 0 && ` · ${history.length}`}
                </span>
                {history.length > 0 && (
                  <button
                    type="button"
                    onClick={wipeHistory}
                    className={cn(
                      'h-7 rounded-lg px-2 text-[10px] font-bold uppercase tracking-wider transition-colors',
                      confirmWipe
                        ? 'bg-rose-500/15 text-rose-300'
                        : 'text-zinc-500 hover:text-rose-300'
                    )}
                  >
                    {confirmWipe ? 'Tap again' : 'Clear all'}
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.05] ring-1 ring-white/10">
                    <History className="size-5 text-zinc-500" aria-hidden />
                  </span>
                  <p className="text-sm font-semibold text-zinc-300">No sessions yet</p>
                  <p className="max-w-[34ch] text-xs leading-relaxed text-zinc-500">
                    Every dictation lands here automatically — tap one to bring it back into the
                    transcript.
                  </p>
                </div>
              ) : (
                <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-0.5">
                  {history.map((session, i) => (
                    <li key={`${session.at}-${i}`}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => restoreSession(session)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            restoreSession(session)
                          }
                        }}
                        className="w-full cursor-pointer rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition-colors hover:border-teal-400/30 hover:bg-white/[0.06]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            <span aria-hidden>{langFlag(session.lang)}</span>
                            {session.lang} ·{' '}
                            {new Date(session.at).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void copySession(session)
                            }}
                            aria-label="Copy this session"
                            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            <Copy className="size-3.5" aria-hidden />
                          </button>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm leading-snug text-zinc-300">
                          {session.text}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* ---------------- Privacy note ---------------- */}
            <p className="px-1 text-center text-[11px] leading-relaxed text-zinc-600">
              Live mode never uploads audio — everything stays on your device. Recorder mode sends
              the clip to the built-in ASR endpoint for transcription only; nothing is stored.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  )
}
