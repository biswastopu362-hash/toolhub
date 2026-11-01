'use client'

/**
 * TTS Studio — type it, hear it.
 *
 * Turns text into natural speech via POST /api/tts (binary WAV back).
 * Seven voices, a 0.5–2.0× speed dial, a custom-styled player with seek,
 * one-tap WAV download, and a metadata-only history (max 10) so you can
 * instantly re-run a previous generation. Voice + speed persist on-device.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  AudioLines,
  Download,
  Eraser,
  Gauge,
  History,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Volume2,
  WifiOff,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type VoiceId = 'tongtong' | 'chuichui' | 'xiaochen' | 'jam' | 'kazi' | 'douji' | 'luodo'

interface VoiceDef {
  id: VoiceId
  name: string
  desc: string
  emoji: string
}

const VOICES: VoiceDef[] = [
  { id: 'tongtong', name: 'Tongtong', desc: 'Warm & friendly', emoji: '🐻' },
  { id: 'chuichui', name: 'Chuichui', desc: 'Playful & cute', emoji: '🐣' },
  { id: 'xiaochen', name: 'Xiaochen', desc: 'Calm & professional', emoji: '🦉' },
  { id: 'jam', name: 'Jam', desc: 'British gentleman', emoji: '🎩' },
  { id: 'kazi', name: 'Kazi', desc: 'Clear & standard', emoji: '🎙️' },
  { id: 'douji', name: 'Douji', desc: 'Natural & flowing', emoji: '🍃' },
  { id: 'luodo', name: 'Luodo', desc: 'Expressive', emoji: '🎭' },
]

const VOICE_IDS = new Set<string>(VOICES.map((v) => v.id))

function voiceOf(id: string): VoiceDef {
  return VOICES.find((v) => v.id === id) ?? VOICES[0]
}

interface Prefs {
  voice: VoiceId
  speed: number
}

/** History stores METADATA ONLY — the WAV blob itself is never persisted. */
interface HistoryItem {
  id: string
  snippet: string
  voice: VoiceId
  speed: number
  at: number
}

interface AudioMeta {
  voice: VoiceId
  speed: number
  chars: number
  bytes: number
  fileName: string
}

type ErrorKind = 'http' | 'network'

interface TtsError {
  kind: ErrorKind
  message: string
}

/* ================================================================== */
/* Constants + helpers                                                 */
/* ================================================================== */

const MAX_CHARS = 1000
const WARN_CHARS = 900
const HISTORY_MAX = 10
const PREFS_KEY = 'toolhub-tts-prefs'
const HISTORY_KEY = 'toolhub-tts-history'

function buzz(ms = 12) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* haptics unsupported */
  }
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

function fmtBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(b / 1024))} KB`
}

function timeAgo(at: number): string {
  const mins = Math.floor((Date.now() - at) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function speedLabel(s: number): string {
  return `${s.toFixed(2).replace(/0$/, '')}×`
}

function isHistoryItem(v: unknown): v is HistoryItem {
  if (typeof v !== 'object' || v === null) return false
  const h = v as Partial<HistoryItem>
  return (
    typeof h.id === 'string' &&
    typeof h.snippet === 'string' &&
    typeof h.voice === 'string' &&
    VOICE_IDS.has(h.voice) &&
    typeof h.speed === 'number' &&
    typeof h.at === 'number'
  )
}

const SPRING = { type: 'spring', stiffness: 260, damping: 26 } as const

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function TtsStudioApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [text, setText] = useState('')
  const [voice, setVoice] = useState<VoiceId>('tongtong')
  const [speed, setSpeed] = useState(1)
  const [pending, setPending] = useState(false)
  const [ttsError, setTtsError] = useState<TtsError | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [meta, setMeta] = useState<AudioMeta | null>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [confirmClear, setConfirmClear] = useState(false)
  const [online, setOnline] = useState(true)

  /* ---------------- refs ---------------- */
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const clearTimerRef = useRef<number | null>(null)

  /* ---------------- hydrate prefs + history ---------------- */
  useEffect(() => {
    try {
      const rawPrefs = localStorage.getItem(PREFS_KEY)
      if (rawPrefs) {
        const p = JSON.parse(rawPrefs) as Partial<Prefs>
        if (typeof p.voice === 'string' && VOICE_IDS.has(p.voice)) setVoice(p.voice as VoiceId)
        if (typeof p.speed === 'number' && p.speed >= 0.5 && p.speed <= 2) setSpeed(p.speed)
      }
      const rawHistory = localStorage.getItem(HISTORY_KEY)
      if (rawHistory) {
        const parsed: unknown = JSON.parse(rawHistory)
        if (Array.isArray(parsed)) setHistory(parsed.filter(isHistoryItem).slice(0, HISTORY_MAX))
      }
    } catch {
      /* corrupt/private storage — start fresh */
    }
    setOnline(typeof navigator === 'undefined' ? true : navigator.onLine)
  }, [])

  /* ---------------- persist voice + speed ---------------- */
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ voice, speed } satisfies Prefs))
    } catch {
      /* private mode — memory only */
    }
  }, [voice, speed])

  /* ---------------- online/offline listener ---------------- */
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  /* ---------------- two-tap confirm auto-reset ---------------- */
  useEffect(() => {
    if (!confirmClear) return
    clearTimerRef.current = window.setTimeout(() => setConfirmClear(false), 3000)
    return () => {
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current)
    }
  }, [confirmClear])

  /* ---------------- unmount cleanup: revoke URL + abort fetch ---------------- */
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      abortRef.current?.abort()
    },
    []
  )

  /* ---------------- generation ---------------- */
  const generate = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    buzz(12)
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setPending(true)
    setTtsError(null)
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, voice, speed }),
        signal: ctrl.signal,
      })
      if (!res.ok) {
        let message = 'Speech generation failed. Please try again.'
        try {
          const data = (await res.json()) as { error?: unknown }
          if (typeof data?.error === 'string' && data.error) message = data.error
        } catch {
          /* non-JSON body — keep the fallback message */
        }
        setTtsError({ kind: 'http', message })
        return
      }
      const blob = await res.blob()
      if (!blob || blob.size === 0) {
        setTtsError({ kind: 'http', message: 'The speech service returned empty audio. Please try again.' })
        return
      }
      const url = URL.createObjectURL(blob)
      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = url
      setPlaying(false)
      setCurrentTime(0)
      setDuration(0)
      setAudioUrl(url)
      const nextMeta: AudioMeta = {
        voice,
        speed,
        chars: trimmed.length,
        bytes: blob.size,
        fileName: `toolhub-tts-${Date.now()}.wav`,
      }
      setMeta(nextMeta)
      const item: HistoryItem = {
        id: `tts_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        snippet: trimmed.slice(0, 200),
        voice,
        speed,
        at: Date.now(),
      }
      setHistory((prev) => {
        const next = [item, ...prev].slice(0, HISTORY_MAX)
        try {
          localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
        } catch {
          /* private mode — memory only */
        }
        return next
      })
      buzz(12)
      toast({
        title: 'Audio ready',
        description: `${voiceOf(voice).name} · ${speedLabel(speed)} · ${fmtBytes(blob.size)}`,
      })
    } catch (err) {
      if ((err as Error | null)?.name === 'AbortError') return
      setTtsError({
        kind: 'network',
        message: online
          ? 'Could not reach the speech service. Check your connection and try again.'
          : "You're offline. Reconnect to the internet, then tap Retry.",
      })
    } finally {
      setPending(false)
    }
  }, [text, voice, speed, pending, online, toast])

  /* ---------------- playback controls ---------------- */
  const togglePlay = useCallback(() => {
    const a = audioRef.current
    if (!a || !audioUrl) return
    buzz(12)
    if (a.paused) void a.play().catch(() => setPlaying(false))
    else a.pause()
  }, [audioUrl])

  const stopPlayback = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    buzz(12)
    a.pause()
    a.currentTime = 0
    setCurrentTime(0)
    setPlaying(false)
  }, [])

  const seekToRatio = useCallback((ratio: number) => {
    const a = audioRef.current
    if (!a || !Number.isFinite(a.duration) || a.duration <= 0) return
    const clamped = Math.min(1, Math.max(0, ratio))
    a.currentTime = clamped * a.duration
    setCurrentTime(a.currentTime)
  }, [])

  const ratioFromPointer = useCallback((clientX: number): number => {
    const el = barRef.current
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    return (clientX - rect.left) / rect.width
  }, [])

  const onBarPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!audioUrl) return
      draggingRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
      seekToRatio(ratioFromPointer(e.clientX))
    },
    [audioUrl, ratioFromPointer, seekToRatio]
  )

  const onBarPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return
      seekToRatio(ratioFromPointer(e.clientX))
    },
    [ratioFromPointer, seekToRatio]
  )

  const onBarPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* pointer already released */
    }
  }, [])

  const onBarKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const a = audioRef.current
      if (!a) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        a.currentTime = Math.min(a.duration || 0, a.currentTime + 5)
        setCurrentTime(a.currentTime)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        a.currentTime = Math.max(0, a.currentTime - 5)
        setCurrentTime(a.currentTime)
      }
    },
    []
  )

  /* ---------------- text + history actions ---------------- */
  const clearText = useCallback(() => {
    if (!text) return
    buzz(12)
    setText('')
  }, [text])

  const refill = useCallback(
    (item: HistoryItem) => {
      buzz(12)
      setText(item.snippet)
      toast({
        title: 'Text refilled',
        description: 'Audio is not kept — generate again to hear it.',
      })
    },
    [toast]
  )

  const clearHistory = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current)
    setConfirmClear(false)
    setHistory([])
    try {
      localStorage.removeItem(HISTORY_KEY)
    } catch {
      /* private mode */
    }
    buzz(12)
    toast({ title: 'History cleared', description: 'Recent generations removed.' })
  }, [confirmClear, toast])

  const onDownload = useCallback(() => {
    buzz(12)
    toast({ title: 'Download started', description: meta?.fileName ?? 'toolhub-tts.wav' })
  }, [meta, toast])

  const chars = text.length
  const nearLimit = chars > WARN_CHARS
  const activeVoice = voiceOf(voice)
  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-yellow-300/[0.09] via-orange-500/[0.06] to-red-500/[0.05] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-yellow-300 via-orange-400 to-red-500 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(249_115_22/0.75),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Volume2 className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">TTS Studio</h2>
              <p className="text-xs text-zinc-400">Type it, hear it — natural speech in one tap.</p>
            </div>
            <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-orange-400/25 bg-orange-500/10 px-3 py-1.5 text-[11px] font-semibold text-orange-200 sm:flex">
              <span aria-hidden>{activeVoice.emoji}</span>
              {activeVoice.name} · {speedLabel(speed)}
            </span>
          </div>

          {!online && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200">
              <WifiOff className="size-3.5 shrink-0" aria-hidden />
              You&apos;re offline — speech generation needs a connection.
            </div>
          )}
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          {/* ---------------- Text input ---------------- */}
          <section aria-label="Text to speak">
            <div className="mb-2 flex items-center justify-between gap-2">
              <label htmlFor="tts-text" className="text-sm font-semibold text-zinc-200">
                Text to speak
              </label>
              <button
                type="button"
                onClick={clearText}
                disabled={!text}
                className="flex h-11 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-xs font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-40"
              >
                <Eraser className="size-3.5" aria-hidden />
                Clear
              </button>
            </div>
            <div
              className={cn(
                'rounded-2xl border bg-white/[0.03] transition-colors focus-within:border-orange-400/50',
                nearLimit ? 'border-amber-400/50 bg-amber-500/[0.04]' : 'border-white/10'
              )}
            >
              <textarea
                id="tts-text"
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
                maxLength={MAX_CHARS}
                placeholder="Type or paste anything — up to 1,000 characters…"
                rows={5}
                className="min-h-[150px] w-full resize-none bg-transparent px-4 py-3.5 text-[15px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 sm:min-h-[170px]"
              />
              <div className="flex items-center justify-between gap-2 border-t border-white/5 px-4 py-2">
                <span className="text-[11px] text-zinc-500">
                  {nearLimit ? 'Almost at the limit — keep it short for best results' : 'Spaces included · max 1,000 characters'}
                </span>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums',
                    nearLimit ? 'bg-amber-500/15 text-amber-300' : 'bg-white/[0.06] text-zinc-400'
                  )}
                >
                  {chars.toLocaleString()} / 1,000
                </span>
              </div>
            </div>
          </section>

          {/* ---------------- Voice picker ---------------- */}
          <section aria-label="Voice">
            <div className="mb-2 flex items-center gap-2">
              <AudioLines className="size-4 text-orange-400" aria-hidden />
              <h3 className="text-sm font-semibold text-zinc-200">Voice</h3>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {VOICES.map((v) => {
                const selected = v.id === voice
                return (
                  <motion.button
                    key={v.id}
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => {
                      setVoice(v.id)
                      buzz(12)
                    }}
                    aria-pressed={selected}
                    className={cn(
                      'flex min-h-[64px] flex-col justify-center gap-0.5 rounded-2xl border p-3 text-left transition-colors',
                      selected
                        ? 'border-orange-400/60 bg-gradient-to-br from-orange-500/15 to-red-500/[0.07] ring-1 ring-orange-400/40'
                        : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-sm font-bold text-zinc-100">
                      <span aria-hidden>{v.emoji}</span>
                      {v.name}
                    </span>
                    <span className={cn('text-[11px] leading-tight', selected ? 'text-orange-200/90' : 'text-zinc-500')}>
                      {v.desc}
                    </span>
                  </motion.button>
                )
              })}
            </div>
          </section>

          {/* ---------------- Speed ---------------- */}
          <section aria-label="Speaking speed" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge className="size-4 text-orange-400" aria-hidden />
                <h3 className="text-sm font-semibold text-zinc-200">Speed</h3>
              </div>
              <motion.span
                key={speedLabel(speed)}
                initial={{ scale: 0.85, opacity: 0.4 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                className="rounded-full bg-gradient-to-r from-yellow-300/20 to-orange-500/20 px-2.5 py-1 text-xs font-black tabular-nums text-orange-200 ring-1 ring-orange-400/30"
              >
                {speedLabel(speed)}
              </motion.span>
            </div>
            <Slider
              value={[speed]}
              min={0.5}
              max={2}
              step={0.05}
              onValueChange={(v) => setSpeed(v[0] ?? 1)}
              onValueCommit={() => buzz(12)}
              aria-label="Speaking speed"
              className="py-1 [&_[data-slot=slider-range]]:bg-gradient-to-r [&_[data-slot=slider-range]]:from-yellow-300 [&_[data-slot=slider-range]]:to-orange-500 [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-orange-400 [&_[data-slot=slider-thumb]]:bg-zinc-950 [&_[data-slot=slider-track]]:bg-white/10"
            />
            <div className="mt-2 flex justify-between text-[10px] font-semibold text-zinc-500" aria-hidden>
              <span>0.5×</span>
              <span>1×</span>
              <span>1.5×</span>
              <span>2×</span>
            </div>
          </section>

          {/* ---------------- Generate ---------------- */}
          <Button
            onClick={() => void generate()}
            disabled={pending || !text.trim()}
            className="h-12 w-full rounded-2xl bg-gradient-to-r from-yellow-300 via-orange-400 to-orange-500 text-base font-bold text-zinc-950 shadow-[0_14px_34px_-12px_rgb(249_115_22/0.8)] transition-shadow hover:from-yellow-200 hover:via-orange-300 hover:to-orange-400 hover:shadow-[0_16px_38px_-12px_rgb(249_115_22/0.9)]"
          >
            {pending ? (
              <>
                <Loader2 className="size-5 animate-spin" aria-hidden />
                Generating…
              </>
            ) : (
              <>
                <AudioLines className="size-5" aria-hidden />
                Generate speech
              </>
            )}
          </Button>

          {/* ---------------- Error card ---------------- */}
          <AnimatePresence>
            {ttsError && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={SPRING}
                className="rounded-2xl border border-amber-400/30 bg-amber-500/[0.08] p-4"
                role="alert"
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
                    {ttsError.kind === 'network' ? <WifiOff className="size-4.5" aria-hidden /> : <AlertTriangle className="size-4.5" aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-amber-200">
                      {ttsError.kind === 'network' ? 'Connection problem' : 'Generation failed'}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-amber-200/80">{ttsError.message}</p>
                    <button
                      type="button"
                      onClick={() => void generate()}
                      disabled={pending || !text.trim()}
                      className="mt-3 flex h-11 items-center gap-1.5 rounded-xl border border-amber-400/40 bg-amber-500/15 px-4 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-500/25 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <RotateCcw className="size-4" aria-hidden />
                      Retry
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTtsError(null)}
                    aria-label="Dismiss error"
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl text-amber-200/60 transition-colors hover:bg-amber-500/10 hover:text-amber-100"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---------------- Result + custom player ---------------- */}
          <AnimatePresence>
            {audioUrl && meta && (
              <motion.section
                key={audioUrl}
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={SPRING}
                aria-label="Generated audio"
                className="overflow-hidden rounded-2xl border border-orange-400/25 bg-gradient-to-br from-orange-500/[0.09] to-red-500/[0.04] p-4"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 text-orange-300">
                      <AudioLines className="size-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-zinc-100">Generated audio</p>
                      <p className="truncate text-[11px] text-zinc-400">
                        {voiceOf(meta.voice).name} · {speedLabel(meta.speed)} · {meta.chars.toLocaleString()} chars · {fmtBytes(meta.bytes)}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-orange-400/25 bg-orange-500/10 px-2 py-0.5 text-[10px] font-black tracking-wider text-orange-200">
                    WAV
                  </span>
                </div>

                {/* Player */}
                <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-950/60 p-3">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.92 }}
                    onClick={togglePlay}
                    aria-label={playing ? 'Pause' : 'Play'}
                    className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-yellow-300 via-orange-400 to-red-500 text-zinc-950 shadow-[0_10px_24px_-8px_rgb(249_115_22/0.8)]"
                  >
                    {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5 translate-x-[1px]" aria-hidden />}
                  </motion.button>

                  <div className="min-w-0 flex-1">
                    <div
                      ref={barRef}
                      role="slider"
                      tabIndex={0}
                      aria-label="Seek"
                      aria-valuemin={0}
                      aria-valuemax={Math.round(duration) || 0}
                      aria-valuenow={Math.round(currentTime)}
                      onPointerDown={onBarPointerDown}
                      onPointerMove={onBarPointerMove}
                      onPointerUp={onBarPointerUp}
                      onKeyDown={onBarKeyDown}
                      className="group relative flex h-8 cursor-pointer touch-none items-center outline-none"
                    >
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-yellow-300 to-orange-500"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span
                        className="pointer-events-none absolute size-3.5 -translate-x-1/2 rounded-full bg-orange-300 shadow-[0_0_10px_rgb(249_115_22/0.9)] transition-transform group-active:scale-125"
                        style={{ left: `${progressPct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-semibold tabular-nums text-zinc-500">
                      <span>{fmtTime(currentTime)}</span>
                      <span>{duration > 0 ? fmtTime(duration) : '–:––'}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={stopPlayback}
                    aria-label="Stop"
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <Square className="size-4" aria-hidden />
                  </button>
                </div>

                {/* Download */}
                <a
                  href={audioUrl}
                  download={meta.fileName}
                  onClick={onDownload}
                  className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-yellow-300 via-orange-400 to-orange-500 text-sm font-bold text-zinc-950 shadow-[0_10px_26px_-10px_rgb(249_115_22/0.8)] transition-opacity hover:opacity-90"
                >
                  <Download className="size-4" aria-hidden />
                  Download WAV
                </a>
              </motion.section>
            )}
          </AnimatePresence>

          {/* ---------------- History ---------------- */}
          <section aria-label="Recent generations">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <History className="size-4 text-orange-400" aria-hidden />
                <h3 className="text-sm font-semibold text-zinc-200">Recent generations</h3>
                {history.length > 0 && (
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold tabular-nums text-zinc-400">
                    {history.length}
                  </span>
                )}
              </div>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={clearHistory}
                  className={cn(
                    'flex h-11 items-center rounded-xl border px-3.5 text-xs font-semibold transition-colors',
                    confirmClear
                      ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
                      : 'border-white/10 bg-white/[0.04] text-zinc-400 hover:bg-white/10 hover:text-white'
                  )}
                >
                  {confirmClear ? 'Tap again to clear' : 'Clear all'}
                </button>
              )}
            </div>

            {history.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-8 text-center">
                <span className="mx-auto mb-2 flex size-11 items-center justify-center rounded-2xl bg-white/[0.05] text-zinc-500">
                  <History className="size-5" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-zinc-400">No generations yet</p>
                <p className="mt-0.5 text-xs text-zinc-600">
                  Your last 10 generations will appear here — text, voice and speed only.
                </p>
              </div>
            ) : (
              <ul className="max-h-[22rem] space-y-2 overflow-y-auto pr-0.5">
                {history.map((item) => (
                  <li key={item.id}>
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.98 }}
                      onClick={() => refill(item)}
                      className="w-full rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left transition-colors hover:bg-white/[0.08]"
                    >
                      <p className="line-clamp-2 text-sm leading-snug text-zinc-200">{item.snippet}</p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
                        <span className="font-semibold text-zinc-400">
                          {voiceOf(item.voice).emoji} {voiceOf(item.voice).name}
                        </span>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">{speedLabel(item.speed)}</span>
                        <span aria-hidden>·</span>
                        <span>{timeAgo(item.at)}</span>
                      </p>
                      <p className="mt-1 text-[10px] text-zinc-600">
                        Audio isn&apos;t saved — tap to reuse the text
                      </p>
                    </motion.button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Hidden audio element driving the custom player */}
        <audio
          ref={audioRef}
          src={audioUrl ?? undefined}
          preload="metadata"
          className="hidden"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false)
            setCurrentTime(0)
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration
            setDuration(Number.isFinite(d) ? d : 0)
          }}
        />
      </motion.div>
    </div>
  )
}
