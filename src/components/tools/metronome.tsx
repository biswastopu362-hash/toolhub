'use client'

/**
 * Metronome & Tuner — keep time, find pitch.
 *
 * Two tabs in one dark-glass shell:
 *  • Metronome — 30–240 BPM with fine-tune buttons + slider, tap tempo
 *    (averages the last ≤6 taps, resets after a 2 s gap), time-signature
 *    chips (2/4, 3/4, 4/4, 6/8 — six clicks per bar gives 6/8 its
 *    eighth-note subdivision feel), pulsing beat dots and a start/stop
 *    button. Sound is a WebAudio scheduler using the classic Chris Wilson
 *    pattern: a 25 ms setInterval queues clicks 0.12 s ahead on the audio
 *    clock; the accent beat is an 880 Hz square-ish tick with a quick
 *    envelope, the others 660 Hz sine. The AudioContext is created/resumed
 *    inside the Start tap gesture (same as the clock alarm).
 *  • Tuner — microphone → AnalyserNode → time-domain autocorrelation pitch
 *    detection (fundamental 60–1300 Hz, buffer 2048, sample-rate aware),
 *    mapped to the nearest note (A4 = selectable 432/438/440/442/444 Hz)
 *    with a −50…+50 cents gauge. The last note stays on screen while the
 *    signal is weak; audio never leaves the device.
 *
 * Prefs persist to localStorage 'toolhub-metronome-prefs'
 * (bpm, signature, volume, refPitch) with validated JSON parsing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AudioLines,
  Mic,
  MicOff,
  Minus,
  MousePointerClick,
  Music4,
  Play,
  Plus,
  RotateCcw,
  Square,
  Volume2,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Shared helpers                                                      */
/* ================================================================== */

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

const SPRING = { type: 'spring', stiffness: 320, damping: 26 } as const

/* ================================================================== */
/* Model + persisted prefs                                             */
/* ================================================================== */

type SignatureId = '2/4' | '3/4' | '4/4' | '6/8'

interface Signature {
  id: SignatureId
  beats: number
  hint: string
}

const SIGNATURES: Signature[] = [
  { id: '2/4', beats: 2, hint: 'March' },
  { id: '3/4', beats: 3, hint: 'Waltz' },
  { id: '4/4', beats: 4, hint: 'Common time' },
  { id: '6/8', beats: 6, hint: 'Compound · eighths' },
]

const TEMPO_PRESETS = [
  { bpm: 60, name: 'Largo' },
  { bpm: 90, name: 'Andante' },
  { bpm: 120, name: 'Moderato' },
  { bpm: 160, name: 'Allegro' },
  { bpm: 200, name: 'Presto' },
]

const REF_PITCHES = [432, 438, 440, 442, 444]

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

interface MetronomePrefs {
  bpm: number
  signature: SignatureId
  /** click volume, 0–100 */
  volume: number
  /** A4 reference frequency in Hz */
  refPitch: number
}

const PREFS_KEY = 'toolhub-metronome-prefs'
const DEFAULT_PREFS: MetronomePrefs = {
  bpm: 100,
  signature: '4/4',
  volume: 70,
  refPitch: 440,
}

function loadPrefs(): MetronomePrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PREFS
    const o = parsed as Record<string, unknown>
    const bpm = Math.round(Number(o.bpm))
    const volume = Math.round(Number(o.volume))
    const refPitch = Math.round(Number(o.refPitch))
    const signature = SIGNATURES.find((s) => s.id === o.signature)?.id
    return {
      bpm: Number.isFinite(bpm) ? Math.min(240, Math.max(30, bpm)) : DEFAULT_PREFS.bpm,
      signature: signature ?? DEFAULT_PREFS.signature,
      volume: Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : DEFAULT_PREFS.volume,
      refPitch: REF_PITCHES.includes(refPitch) ? refPitch : DEFAULT_PREFS.refPitch,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

/* ================================================================== */
/* Metronome tab                                                       */
/* ================================================================== */

const LOOKAHEAD_MS = 25 /** scheduler tick interval (Chris Wilson pattern) */
const SCHEDULE_AHEAD = 0.12 /** seconds of clicks queued on the audio clock */

interface VisualBeat {
  /** beat index inside the bar (0 = accent) */
  index: number
  /** monotonic counter so each fired beat retriggers the pulse */
  count: number
}

interface MetronomeTabProps {
  active: boolean
  bpm: number
  onBpmChange: (bpm: number) => void
  signature: SignatureId
  onSignatureChange: (id: SignatureId) => void
  volume: number
  onVolumeChange: (v: number) => void
}

function MetronomeTab({
  active,
  bpm,
  onBpmChange,
  signature,
  onSignatureChange,
  volume,
  onVolumeChange,
}: MetronomeTabProps) {
  const { toast } = useToast()
  const [running, setRunning] = useState(false)
  const [visualBeat, setVisualBeat] = useState<VisualBeat | null>(null)
  const [tapCount, setTapCount] = useState(0)

  const sig = useMemo(
    () => SIGNATURES.find((s) => s.id === signature) ?? SIGNATURES[2],
    [signature]
  )

  /* ---- audio + scheduler refs ---- */
  const ctxRef = useRef<AudioContext | null>(null)
  const masterRef = useRef<GainNode | null>(null)
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const nextTimeRef = useRef(0)
  const beatRef = useRef(0)
  const beatCountRef = useRef(0)
  const queueRef = useRef<{ beat: number; time: number; count: number }[]>([])
  const bpmRef = useRef(bpm)
  const beatsRef = useRef(sig.beats)
  const volRef = useRef(volume / 100)

  useEffect(() => {
    bpmRef.current = bpm
  }, [bpm])

  useEffect(() => {
    beatsRef.current = sig.beats
    if (beatRef.current >= sig.beats) beatRef.current = beatRef.current % sig.beats
  }, [sig.beats])

  useEffect(() => {
    volRef.current = volume / 100
    const master = masterRef.current
    if (master) master.gain.value = volume / 100
  }, [volume])

  /* One click on the audio clock. Accent = 880 Hz square-ish tick with a
     quick envelope; normal beats = 660 Hz sine. Nodes self-disconnect. */
  const scheduleClick = useCallback((ctx: AudioContext, time: number, accent: boolean): void => {
    const master = masterRef.current
    if (!master) return
    try {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = accent ? 'square' : 'sine'
      osc.frequency.setValueAtTime(accent ? 880 : 660, time)
      gain.gain.setValueAtTime(0.0001, time)
      gain.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.35, time + 0.002)
      gain.gain.exponentialRampToValueAtTime(0.0001, time + (accent ? 0.1 : 0.07))
      osc.connect(gain)
      gain.connect(master)
      osc.start(time)
      osc.stop(time + 0.14)
      osc.onended = () => {
        try {
          gain.disconnect()
        } catch {
          /* noop */
        }
        try {
          osc.disconnect()
        } catch {
          /* noop */
        }
      }
    } catch {
      /* audio graph failure — keep the scheduler alive */
    }
  }, [])

  /* Runs every 25 ms while playing: queue every click that falls inside
     the next 0.12 s of audio time, then advance the beat bookkeeping. */
  const scheduler = useCallback((): void => {
    const ctx = ctxRef.current
    if (!ctx || !runningRef.current) return
    const ahead = ctx.currentTime + SCHEDULE_AHEAD
    while (nextTimeRef.current < ahead) {
      const beat = beatRef.current
      const time = nextTimeRef.current
      scheduleClick(ctx, time, beat === 0)
      beatCountRef.current += 1
      queueRef.current.push({ beat, time, count: beatCountRef.current })
      beatRef.current = (beat + 1) % beatsRef.current
      nextTimeRef.current += 60 / bpmRef.current
    }
  }, [scheduleClick])

  /* rAF drawer: pops queued beats whose audio time has arrived so the dots
     pulse exactly in sync with what you hear. Lives in a ref so the loop can
     re-arm itself each frame without re-creating callbacks. */
  const drawLoopRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const drawLoop = (): void => {
      if (!runningRef.current) return
      rafRef.current = requestAnimationFrame(drawLoop)
      const ctx = ctxRef.current
      if (!ctx) return
      const now = ctx.currentTime
      const queue = queueRef.current
      while (queue.length > 0 && queue[0].time <= now) {
        const item = queue.shift()
        if (item) setVisualBeat({ index: item.beat, count: item.count })
      }
    }
    drawLoopRef.current = drawLoop
    return () => {
      drawLoopRef.current = null
    }
  }, [])

  /* AudioContext is created/resumed inside the Start tap (user gesture),
     mirroring the clock alarm so playback is allowed afterwards. */
  const ensureAudio = useCallback((): AudioContext | null => {
    try {
      if (!ctxRef.current) {
        const w = window as unknown as {
          AudioContext?: typeof AudioContext
          webkitAudioContext?: typeof AudioContext
        }
        const Ctx = w.AudioContext ?? w.webkitAudioContext
        if (!Ctx) return null
        const ctx = new Ctx()
        const master = ctx.createGain()
        master.gain.value = volRef.current
        master.connect(ctx.destination)
        ctxRef.current = ctx
        masterRef.current = master
      }
      if (ctxRef.current.state === 'suspended') void ctxRef.current.resume()
      return ctxRef.current
    } catch {
      return null
    }
  }, [])

  const stop = useCallback((): void => {
    runningRef.current = false
    setRunning(false)
    setVisualBeat(null)
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    queueRef.current = []
  }, [])

  const start = useCallback((): void => {
    const ctx = ensureAudio()
    if (!ctx) {
      toast({
        title: 'Audio unavailable',
        description: 'This browser blocked the metronome sound engine.',
      })
      return
    }
    haptic()
    runningRef.current = true
    setRunning(true)
    beatRef.current = 0
    beatCountRef.current = 0
    queueRef.current = []
    nextTimeRef.current = ctx.currentTime + 0.08
    timerRef.current = window.setInterval(scheduler, LOOKAHEAD_MS)
    rafRef.current = requestAnimationFrame(() => drawLoopRef.current?.())
  }, [ensureAudio, scheduler, toast])

  /* Don't keep clicking while the user is on the Tuner tab. The stop runs on
     the next frame — outside the effect body — to avoid cascading renders. */
  useEffect(() => {
    if (active || !runningRef.current) return
    const raf = requestAnimationFrame(stop)
    return () => cancelAnimationFrame(raf)
  }, [active, stop])

  /* Full teardown on unmount: scheduler + rAF + audio context. */
  useEffect(
    () => () => {
      runningRef.current = false
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      try {
        void ctxRef.current?.close()
      } catch {
        /* noop */
      }
      ctxRef.current = null
      masterRef.current = null
    },
    []
  )

  /* ---- tap tempo: averages the intervals of the last ≤6 taps ---- */
  const tapsRef = useRef<number[]>([])
  const tapResetRef = useRef<number | null>(null)

  const handleTap = useCallback((): void => {
    haptic()
    const now = performance.now()
    const taps = tapsRef.current
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) taps.length = 0
    taps.push(now)
    if (taps.length > 6) taps.shift()
    setTapCount(taps.length)
    if (taps.length >= 2) {
      let total = 0
      for (let i = 1; i < taps.length; i++) total += taps[i] - taps[i - 1]
      const avg = total / (taps.length - 1)
      const next = Math.round(60000 / avg)
      if (next >= 30 && next <= 240) onBpmChange(next)
    }
    if (tapResetRef.current !== null) window.clearTimeout(tapResetRef.current)
    tapResetRef.current = window.setTimeout(() => {
      tapsRef.current = []
      setTapCount(0)
    }, 2000)
  }, [onBpmChange])

  useEffect(
    () => () => {
      if (tapResetRef.current !== null) window.clearTimeout(tapResetRef.current)
    },
    []
  )

  const vb = visualBeat

  return (
    <div className="space-y-4">
      {/* -------- Tempo -------- */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-center justify-center gap-3 sm:gap-5">
          <button
            type="button"
            onClick={() => {
              haptic()
              onBpmChange(Math.max(30, bpm - 1))
            }}
            disabled={bpm <= 30}
            aria-label="Decrease tempo by one BPM"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Minus className="size-5" aria-hidden />
          </button>

          <div className="min-w-0 flex-1 text-center">
            <p className="text-6xl font-black leading-none tracking-tighter text-zinc-50 tabular-nums sm:text-7xl">
              {bpm}
            </p>
            <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              beats per minute
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              haptic()
              onBpmChange(Math.min(240, bpm + 1))
            }}
            disabled={bpm >= 240}
            aria-label="Increase tempo by one BPM"
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="size-5" aria-hidden />
          </button>
        </div>

        <div className="mt-5">
          <Slider
            value={[bpm]}
            min={30}
            max={240}
            step={1}
            onValueChange={(v) => onBpmChange(v[0] ?? bpm)}
            aria-label="Tempo in beats per minute"
            className="w-full [&_[data-slot=slider-range]]:bg-gradient-to-r [&_[data-slot=slider-range]]:from-rose-400 [&_[data-slot=slider-range]]:to-fuchsia-500 [&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-rose-400 [&_[data-slot=slider-thumb]]:bg-zinc-950 [&_[data-slot=slider-thumb]]:shadow-[0_0_10px_rgb(244_63_94/0.45)]"
          />
          <div className="mt-2 flex justify-between text-[10px] font-semibold text-zinc-600 tabular-nums">
            <span>30</span>
            <span>60</span>
            <span>120</span>
            <span>180</span>
            <span>240</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap justify-center gap-2" role="group" aria-label="Tempo presets">
          {TEMPO_PRESETS.map((p) => (
            <button
              key={p.bpm}
              type="button"
              onClick={() => {
                haptic()
                onBpmChange(p.bpm)
              }}
              aria-pressed={bpm === p.bpm}
              className={cn(
                'h-9 rounded-xl border px-3 text-xs font-bold tabular-nums transition-colors',
                bpm === p.bpm
                  ? 'border-rose-400/40 bg-rose-500/15 text-rose-200'
                  : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'
              )}
            >
              {p.bpm} <span className="font-medium opacity-70">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* -------- Measure: signature + beat dots -------- */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Time signature
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
            {sig.hint} · {sig.beats} clicks/bar
          </p>
        </div>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Time signature">
          {SIGNATURES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                haptic()
                onSignatureChange(s.id)
              }}
              aria-pressed={signature === s.id}
              className={cn(
                'h-11 min-w-[4rem] flex-1 rounded-xl border text-sm font-bold tabular-nums transition-colors',
                signature === s.id
                  ? 'border-rose-400/40 bg-rose-500/15 text-rose-200'
                  : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'
              )}
            >
              {s.id}
            </button>
          ))}
        </div>

        {/* Beat dots — accent filled emerald, others hollow; the active dot
            pulses with a transform/opacity-only ring fired per beat. */}
        <div className="mt-5 flex items-center justify-center gap-2.5" aria-hidden>
          {Array.from({ length: sig.beats }, (_, i) => {
            const isActive = vb !== null && vb.index === i
            const isAccent = i === 0
            return (
              <span key={i} className="relative flex size-8 items-center justify-center">
                <motion.span
                  animate={{
                    scale: isActive ? 1.28 : 1,
                    opacity: isActive ? 1 : isAccent ? 0.9 : 0.5,
                  }}
                  transition={SPRING}
                  className={cn(
                    'block size-5 rounded-full',
                    isAccent
                      ? 'bg-gradient-to-br from-emerald-300 to-emerald-500 shadow-[0_0_14px_rgb(16_185_129/0.55)]'
                      : 'border-2 border-zinc-600'
                  )}
                />
                {isActive && vb && (
                  <motion.span
                    key={vb.count}
                    initial={{ scale: 0.85, opacity: 0.5 }}
                    animate={{ scale: 2.1, opacity: 0 }}
                    transition={{ duration: 0.36, ease: 'easeOut' }}
                    className={cn(
                      'absolute size-5 rounded-full',
                      isAccent ? 'bg-emerald-400/40' : 'bg-zinc-300/25'
                    )}
                  />
                )}
              </span>
            )
          })}
        </div>
      </div>

      {/* -------- Controls -------- */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleTap}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-white/[0.04] text-sm font-bold text-zinc-200 transition-colors hover:border-rose-400/40 hover:bg-white/10"
          >
            <MousePointerClick className="size-4.5" aria-hidden />
            Tap tempo
            {tapCount > 0 && (
              <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold tabular-nums text-rose-200">
                {tapCount}
              </span>
            )}
          </button>
          <Button
            type="button"
            onClick={running ? stop : start}
            className={cn(
              'h-12 min-w-[7.5rem] flex-[1.3] gap-2 rounded-2xl text-base font-bold',
              running
                ? 'bg-white/10 text-zinc-100 hover:bg-white/15'
                : 'bg-gradient-to-r from-rose-400 via-pink-500 to-fuchsia-500 text-white shadow-lg shadow-rose-500/25 hover:from-rose-300 hover:via-pink-400 hover:to-fuchsia-400'
            )}
            aria-label={running ? 'Stop metronome' : 'Start metronome'}
          >
            {running ? (
              <Square className="size-4.5" aria-hidden />
            ) : (
              <Play className="size-5" aria-hidden />
            )}
            {running ? 'Stop' : 'Start'}
          </Button>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <Volume2 className="size-4.5 shrink-0 text-zinc-500" aria-hidden />
          <Slider
            value={[volume]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => onVolumeChange(v[0] ?? volume)}
            aria-label="Click volume"
            className="w-full [&_[data-slot=slider-range]]:bg-zinc-300 [&_[data-slot=slider-thumb]]:size-4 [&_[data-slot=slider-thumb]]:border-zinc-300 [&_[data-slot=slider-thumb]]:bg-zinc-950"
          />
          <span className="w-10 shrink-0 text-right text-xs font-bold tabular-nums text-zinc-400">
            {volume}%
          </span>
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Tuner tab                                                           */
/* ================================================================== */

const BUF_SIZE = 2048
const MIN_FREQ = 60
const MAX_FREQ = 1300
const ANALYSIS_INTERVAL_MS = 45
const RMS_GATE = 0.006

type TunerPhase = 'idle' | 'requesting' | 'denied' | 'notfound' | 'error' | 'listening'

/**
 * Time-domain autocorrelation (ACF2+ style):
 *   RMS gate → autocorrelation over the lag window implied by 60–1300 Hz
 *   (fixed summation window so all lags stay comparable) → strongest peak
 *   after the initial descent → parabolic refinement → Hz.
 * Returns -1 when no confident fundamental is present.
 */
function detectPitch(buf: Float32Array, sampleRate: number, corr: Float32Array): number {
  const n = buf.length
  let rms = 0
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i]
  rms = Math.sqrt(rms / n)
  if (rms < RMS_GATE) return -1

  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / MIN_FREQ))
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ))
  if (maxLag < minLag + 4) return -1

  const m = n - maxLag
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i < m; i++) sum += buf[i] * buf[i + lag]
    corr[lag] = sum
  }

  /* skip past the initial descent, then take the strongest peak */
  let d = 0
  while (d < maxLag - 1 && corr[d] > corr[d + 1]) d++
  let maxval = -1
  let maxpos = -1
  for (let i = d; i <= maxLag; i++) {
    if (corr[i] > maxval) {
      maxval = corr[i]
      maxpos = i
    }
  }
  /* must be a real periodicity: inside the lag window and strongly
     correlated with lag 0 (rejects noise and sub-range ghosts) */
  if (maxpos < minLag || maxval <= 0 || maxval < corr[0] * 0.2) return -1

  let period = maxpos
  if (maxpos > 0 && maxpos < maxLag) {
    const x1 = corr[maxpos - 1]
    const x2 = corr[maxpos]
    const x3 = corr[maxpos + 1]
    const a = (x1 + x3 - 2 * x2) / 2
    const b = (x3 - x1) / 2
    if (a !== 0) period = maxpos - b / (2 * a)
  }
  const freq = sampleRate / period
  if (!Number.isFinite(freq) || freq < MIN_FREQ || freq > MAX_FREQ) return -1
  return freq
}

interface TunerTabProps {
  refPitch: number
  onRefPitchChange: (hz: number) => void
}

function TunerTab({ refPitch, onRefPitchChange }: TunerTabProps) {
  const { toast } = useToast()
  const [phase, setPhase] = useState<TunerPhase>('idle')
  const [reading, setReading] = useState<number | null>(null) // last confident Hz
  const [strong, setStrong] = useState(false)

  const aliveRef = useRef(true)
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sampleRateRef = useRef(48000)
  const bufRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const corrRef = useRef<Float32Array | null>(null)
  const inTuneRef = useRef(false)
  const refPitchRef = useRef(refPitch)

  useEffect(() => {
    refPitchRef.current = refPitch
  }, [refPitch])

  /* lazy one-time scratch buffers (2048 time-domain samples + correlations) */
  if (bufRef.current === null) bufRef.current = new Float32Array(BUF_SIZE)
  if (corrRef.current === null) corrRef.current = new Float32Array(BUF_SIZE)

  const releaseAudio = useCallback((): void => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((t) => t.stop())
      } catch {
        /* noop */
      }
      streamRef.current = null
    }
    try {
      sourceRef.current?.disconnect()
    } catch {
      /* noop */
    }
    try {
      analyserRef.current?.disconnect()
    } catch {
      /* noop */
    }
    sourceRef.current = null
    analyserRef.current = null
    try {
      void ctxRef.current?.close()
    } catch {
      /* noop */
    }
    ctxRef.current = null
  }, [])

  const stopListening = useCallback((): void => {
    releaseAudio()
    inTuneRef.current = false
    setStrong(false)
    setReading(null)
    setPhase('idle')
    haptic()
  }, [releaseAudio])

  const enableMic = useCallback(async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPhase('error')
      return
    }
    /* create/resume the AudioContext synchronously inside the tap gesture */
    try {
      if (!ctxRef.current) {
        const w = window as unknown as {
          AudioContext?: typeof AudioContext
          webkitAudioContext?: typeof AudioContext
        }
        const Ctx = w.AudioContext ?? w.webkitAudioContext
        if (!Ctx) {
          setPhase('error')
          return
        }
        ctxRef.current = new Ctx()
      }
      if (ctxRef.current.state === 'suspended') void ctxRef.current.resume()
    } catch {
      setPhase('error')
      return
    }

    setPhase('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      if (!aliveRef.current) {
        try {
          stream.getTracks().forEach((t) => t.stop())
        } catch {
          /* noop */
        }
        return
      }
      const ctx = ctxRef.current
      if (!ctx) {
        try {
          stream.getTracks().forEach((t) => t.stop())
        } catch {
          /* noop */
        }
        return
      }
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = BUF_SIZE
      analyser.smoothingTimeConstant = 0
      source.connect(analyser)
      streamRef.current = stream
      sourceRef.current = source
      analyserRef.current = analyser
      sampleRateRef.current = ctx.sampleRate
      setPhase('listening')
    } catch (err) {
      if (!aliveRef.current) return
      const name = err instanceof DOMException ? err.name : ''
      if (
        name === 'NotAllowedError' ||
        name === 'SecurityError' ||
        name === 'PermissionDeniedError'
      ) {
        setPhase('denied')
      } else if (
        name === 'NotFoundError' ||
        name === 'DevicesNotFoundError' ||
        name === 'OverconstrainedError'
      ) {
        setPhase('notfound')
      } else {
        setPhase('error')
        toast({
          title: 'Microphone error',
          description: 'Could not open the microphone. Close other apps using it and retry.',
        })
      }
    }
  }, [toast])

  /* Analysis loop — rAF throttled to ~20 Hz, only while listening. */
  useEffect(() => {
    if (phase !== 'listening') return
    let alive = true
    let raf = 0
    let last = 0
    const step = (t: number): void => {
      if (!alive) return
      raf = requestAnimationFrame(step)
      if (t - last < ANALYSIS_INTERVAL_MS) return
      last = t
      const analyser = analyserRef.current
      const buf = bufRef.current
      const corr = corrRef.current
      if (!analyser || !buf || !corr) return
      analyser.getFloatTimeDomainData(buf)
      const freq = detectPitch(buf, sampleRateRef.current, corr)
      if (freq <= 0) {
        /* weak signal — keep the last note on screen */
        inTuneRef.current = false
        setStrong(false)
        return
      }
      const midi = 69 + 12 * Math.log2(freq / refPitchRef.current)
      const nearest = Math.round(midi)
      const cents = (midi - nearest) * 100
      if (Math.abs(cents) <= 5 && !inTuneRef.current) haptic()
      inTuneRef.current = Math.abs(cents) <= 5
      setReading(Math.round(freq * 10) / 10)
      setStrong(true)
    }
    raf = requestAnimationFrame(step)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [phase])

  /* unmount cleanup: rAF handled by the phase effect; mic + ctx here */
  useEffect(
    () => () => {
      aliveRef.current = false
      releaseAudio()
    },
    [releaseAudio]
  )

  /* derived note info recomputed when the reading or reference pitch changes */
  const note = useMemo(() => {
    if (reading === null) return null
    const midi = 69 + 12 * Math.log2(reading / refPitch)
    const nearest = Math.round(midi)
    const cents = (midi - nearest) * 100
    return {
      name: NOTE_NAMES[((nearest % 12) + 12) % 12] ?? 'A',
      octave: Math.floor(nearest / 12) - 1,
      cents,
      target: refPitch * Math.pow(2, (nearest - 69) / 12),
    }
  }, [reading, refPitch])

  const inTune = note !== null && strong && Math.abs(note.cents) <= 5
  const needlePct = note === null ? 0 : Math.max(-50, Math.min(50, note.cents))

  return (
    <div className="space-y-4">
      {/* -------- Note display / mic gate -------- */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        {phase === 'idle' || phase === 'requesting' ? (
          <div className="flex flex-col items-center px-2 py-6 text-center">
            <span className="relative flex size-14 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-rose-300 via-pink-500 to-fuchsia-600 text-white ring-1 ring-white/25">
              <Mic className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <p className="mt-4 text-sm font-bold text-zinc-200">
              {phase === 'requesting' ? 'Waiting for microphone…' : 'Tune your instrument'}
            </p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-500">
              Play any note — the tuner hears it and shows how far off you are.
              Audio is analyzed on this device; nothing is recorded or uploaded.
            </p>
            <Button
              type="button"
              onClick={() => {
                haptic()
                void enableMic()
              }}
              disabled={phase === 'requesting'}
              className="mt-4 h-11 gap-2 rounded-xl bg-gradient-to-r from-rose-400 via-pink-500 to-fuchsia-500 font-semibold text-white shadow-lg shadow-rose-500/25 hover:from-rose-300 hover:via-pink-400 hover:to-fuchsia-400"
            >
              {phase === 'requesting' ? (
                <span
                  className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                  aria-hidden
                />
              ) : (
                <Mic className="size-4" aria-hidden />
              )}
              Enable microphone
            </Button>
          </div>
        ) : phase !== 'listening' ? (
          /* -------- permission-denied / no-mic / error card -------- */
          <div className="flex flex-col items-center rounded-2xl border border-amber-400/20 bg-amber-500/[0.06] px-4 py-6 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-500/15 text-amber-300">
              <MicOff className="size-6" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-bold text-amber-200">
              {phase === 'denied'
                ? 'Microphone access blocked'
                : phase === 'notfound'
                  ? 'No microphone found'
                  : 'Microphone unavailable'}
            </p>
            <p className="mt-1 max-w-xs text-xs leading-relaxed text-zinc-400">
              {phase === 'denied'
                ? 'The tuner needs the microphone to hear your instrument. Allow access in your browser settings (the icon next to the address bar), then retry.'
                : phase === 'notfound'
                  ? 'Plug in a microphone (or enable it in system settings) and retry — the metronome keeps working meanwhile.'
                  : 'Something went wrong opening the microphone. Close other apps using it and retry.'}
            </p>
            <Button
              type="button"
              onClick={() => {
                haptic()
                void enableMic()
              }}
              variant="ghost"
              className="mt-4 h-11 gap-2 rounded-xl border border-white/15 bg-white/10 font-semibold text-zinc-100 hover:bg-white/15 hover:text-white"
            >
              <RotateCcw className="size-4" aria-hidden /> Retry
            </Button>
          </div>
        ) : (
          /* -------- listening display -------- */
          <div className="text-center">
            <div className="flex items-center justify-between gap-2">
              <span
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider',
                  strong
                    ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300'
                    : 'border-amber-400/30 bg-amber-500/10 text-amber-300'
                )}
              >
                <motion.span
                  animate={{ opacity: [1, 0.35, 1], scale: [1, 0.8, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  className={cn('size-1.5 rounded-full', strong ? 'bg-emerald-400' : 'bg-amber-400')}
                />
                {strong ? 'Listening…' : 'Weak signal'}
              </span>
              <button
                type="button"
                onClick={stopListening}
                aria-label="Stop listening"
                className="flex size-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Square className="size-4" aria-hidden />
              </button>
            </div>

            <motion.div animate={{ opacity: strong ? 1 : 0.38 }} transition={SPRING} className="mt-3">
              <p className="text-7xl font-black leading-none tracking-tighter text-zinc-50 sm:text-8xl">
                {note?.name ?? '—'}
                {note && (
                  <span className="align-top text-2xl font-bold text-zinc-500 sm:text-3xl">
                    {note.octave}
                  </span>
                )}
              </p>
              <p className="mt-3 font-mono text-lg font-bold tabular-nums text-rose-200">
                {reading !== null ? `${reading.toFixed(1)} Hz` : '— Hz'}
              </p>
              {note && (
                <p className="mt-0.5 text-[11px] font-medium tabular-nums text-zinc-500">
                  target {note.target.toFixed(1)} Hz · A{refPitch}
                </p>
              )}
            </motion.div>
          </div>
        )}
      </div>

      {/* -------- Cents meter (−50…+50, green zone ±5) -------- */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Deviation
          </p>
          <p className={cn('text-xs font-bold tabular-nums', inTune ? 'text-emerald-300' : 'text-zinc-400')}>
            {note && strong
              ? inTune
                ? 'In tune ✓'
                : note.cents < 0
                  ? `${Math.round(note.cents)}¢ flat`
                  : `+${Math.round(note.cents)}¢ sharp`
              : '— ¢'}
          </p>
        </div>

        <div className={cn('relative mt-4 h-12', phase !== 'listening' && 'opacity-40')}>
          {/* track */}
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/[0.07]" />
          {/* green zone: |cents| ≤ 5 → centered 10% of the ±50 range */}
          <div className="absolute left-1/2 top-1/2 h-6 w-[10%] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-emerald-400/40 bg-emerald-500/15" />
          {/* center line */}
          <div className="absolute left-1/2 top-1/2 h-3 w-px -translate-x-1/2 -translate-y-1/2 bg-white/25" />
          {/* ticks */}
          {[
            { pct: 0, label: '−50' },
            { pct: 25, label: '−25' },
            { pct: 50, label: '0' },
            { pct: 75, label: '+25' },
            { pct: 100, label: '+50' },
          ].map((t) => (
            <span
              key={t.pct}
              className="absolute top-full -translate-x-1/2 text-[9px] font-bold tabular-nums text-zinc-600"
              style={{ left: `${t.pct}%` }}
            >
              {t.label}
            </span>
          ))}
          {/* needle — transform-only motion (x % of the full-width wrapper) */}
          <motion.div
            animate={{ x: `${needlePct}%` }}
            transition={{ type: 'spring', stiffness: 170, damping: 22 }}
            className="pointer-events-none absolute inset-y-0 left-0 w-full"
          >
            <span
              className={cn(
                'absolute left-1/2 top-1/2 h-9 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
                inTune
                  ? 'bg-emerald-400 shadow-[0_0_10px_rgb(52_211_153/0.7)]'
                  : 'bg-rose-400 shadow-[0_0_10px_rgb(251_113_133/0.6)]'
              )}
            />
          </motion.div>
        </div>
        <p className="mt-4 text-center text-[10px] font-medium text-zinc-600">
          Needle in the green zone (±5¢) means in tune
        </p>
      </div>

      {/* -------- Reference pitch -------- */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Reference pitch (A4)
          </p>
          <p className="text-[10px] font-semibold tabular-nums text-zinc-600">{refPitch} Hz</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Reference pitch">
          {REF_PITCHES.map((hz) => (
            <button
              key={hz}
              type="button"
              onClick={() => {
                haptic()
                onRefPitchChange(hz)
              }}
              aria-pressed={refPitch === hz}
              className={cn(
                'h-11 min-w-[3.6rem] flex-1 rounded-xl border text-sm font-bold tabular-nums transition-colors',
                refPitch === hz
                  ? 'border-rose-400/40 bg-rose-500/15 text-rose-200'
                  : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'
              )}
            >
              {hz}
              {hz === 440 && <span className="ml-1 text-[9px] font-semibold opacity-60">std</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ================================================================== */
/* MetronomeApp — default export                                       */
/* ================================================================== */

type TabId = 'metronome' | 'tuner'

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'metronome', label: 'Metronome', icon: Music4 },
  { id: 'tuner', label: 'Tuner', icon: Mic },
]

export default function MetronomeApp() {
  const [tab, setTab] = useState<TabId>('metronome')
  /* Registry components render client-only (ssr:false), so lazy initializers
     can safely read localStorage — no hydration effect needed. */
  const [prefs, setPrefs] = useState<MetronomePrefs>(() =>
    typeof window === 'undefined' ? DEFAULT_PREFS : loadPrefs()
  )

  /* persist prefs (bpm, signature, volume, refPitch) */
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
    } catch {
      /* private mode — run without persistence */
    }
  }, [prefs])

  const patch = useCallback((p: Partial<MetronomePrefs>): void => {
    setPrefs((prev) => ({ ...prev, ...p }))
  }, [])

  const switchTab = (t: TabId): void => {
    if (t === tab) return
    haptic()
    setTab(t)
  }

  return (
    <div className="mx-auto max-w-2xl [color-scheme:dark]">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header + pill switcher ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-rose-500/[0.12] via-transparent to-fuchsia-600/[0.08] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-rose-300 via-pink-500 to-fuchsia-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(244_63_94/0.75),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <AudioLines className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Metronome &amp; Tuner</h2>
              <p className="text-xs text-zinc-400">Keep time, find pitch.</p>
            </div>
          </div>

          <div
            className="mt-5 flex rounded-2xl border border-white/10 bg-white/[0.04] p-1.5"
            role="tablist"
            aria-label="Metronome and tuner"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`metronome-tab-${t.id}`}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`metronome-panel-${t.id}`}
                onClick={() => switchTab(t.id)}
                className={cn(
                  'relative flex h-11 flex-1 items-center justify-center rounded-xl text-sm font-bold transition-colors',
                  tab === t.id ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                )}
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="metronome-tab-pill"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    className="absolute inset-0 rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.13] to-white/[0.06] shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <t.icon className="size-4" aria-hidden />
                  {t.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* -------- Panels (kept mounted so running state survives switches) -------- */}
        <div className="p-4 sm:p-5">
          <motion.div
            id="metronome-panel-metronome"
            role="tabpanel"
            aria-labelledby="metronome-tab-metronome"
            initial={false}
            animate={{ opacity: tab === 'metronome' ? 1 : 0, y: tab === 'metronome' ? 0 : 10 }}
            transition={SPRING}
            className={cn(tab !== 'metronome' && 'hidden')}
          >
            <MetronomeTab
              active={tab === 'metronome'}
              bpm={prefs.bpm}
              onBpmChange={(bpm) => patch({ bpm })}
              signature={prefs.signature}
              onSignatureChange={(signature) => patch({ signature })}
              volume={prefs.volume}
              onVolumeChange={(volume) => patch({ volume })}
            />
          </motion.div>
          <motion.div
            id="metronome-panel-tuner"
            role="tabpanel"
            aria-labelledby="metronome-tab-tuner"
            initial={false}
            animate={{ opacity: tab === 'tuner' ? 1 : 0, y: tab === 'tuner' ? 0 : 10 }}
            transition={SPRING}
            className={cn(tab !== 'tuner' && 'hidden')}
          >
            <TunerTab
              refPitch={prefs.refPitch}
              onRefPitchChange={(refPitch) => patch({ refPitch })}
            />
          </motion.div>
        </div>
      </motion.div>
    </div>
  )
}
