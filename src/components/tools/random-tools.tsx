'use client'

/**
 * Random Tools — a playful arcade of chance.
 *
 * Four randomizers behind one segmented tab bar:
 *   • Dice      — 1–6 dice, d6/d12/d20, tap any die to re-roll it, total + history
 *   • Coin      — a big gold coin that flips in 3D, with a running H/T tally
 *   • Wheel     — 2–12 editable segments on a conic-gradient wheel with a SPIN hub
 *   • Picker    — draw winners from a list of names (no repeats) or a number range
 *
 * All randomness is generated on-device. Wheel labels and the sound preference
 * persist in localStorage ('toolhub-random'); everything else lives in memory.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Coins,
  Disc3,
  Dices,
  Hash,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Trophy,
  Type,
  Users,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model & helpers                                                     */
/* ================================================================== */

type TabId = 'dice' | 'coin' | 'wheel' | 'picker'
type CoinFace = 'H' | 'T'
type DieSides = 6 | 12 | 20

interface WheelSeg {
  id: string
  label: string
}

interface DiceRoll {
  id: string
  sides: DieSides
  values: number[]
  total: number
}

interface FlipLog {
  id: string
  face: CoinFace
}

const STORAGE_KEY = 'toolhub-random'

/** Distinct playful palette — index-assigned so segments never share a color. */
const WHEEL_COLORS = [
  '#e879f9',
  '#c084fc',
  '#fb7185',
  '#fbbf24',
  '#34d399',
  '#2dd4bf',
  '#f97316',
  '#a3e635',
  '#f472b6',
  '#eab308',
  '#a78bfa',
  '#fb923c',
]

const DEFAULT_WHEEL_LABELS = ['Pizza', 'Sushi', 'Burger', 'Tacos', 'Ramen', 'Salad']

const CONFETTI_COUNT = 22

interface ConfettiDot {
  x: number
  y: number
  color: string
  size: number
  rot: number
  dur: number
  delay: number
}

function uid(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function buzz(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

/* pip positions on a 3×3 grid (cell indices 0..8) for d6 faces */
const PIP_CELLS: Record<number, readonly number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 3, 6, 2, 5, 8],
}

const SCROLLBAR_HIDDEN =
  '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden'

const SCROLLBAR_THIN =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb:hover]:bg-white/25 [&::-webkit-scrollbar-track]:bg-transparent'

function truncateLabel(label: string, max = 11): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label
}

/* ================================================================== */
/* Small shared pieces                                                 */
/* ================================================================== */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </p>
  )
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
}: {
  value: number
  min: number
  max: number
  onChange: (next: number) => void
  label: string
}) {
  return (
    <div className="flex h-12 items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
      <button
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
        className="flex size-10 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Minus className="size-4" aria-hidden />
      </button>
      <span
        aria-live="polite"
        className="min-w-10 text-center text-sm font-bold tabular-nums text-zinc-100"
      >
        {value}
      </span>
      <button
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
        className="flex size-10 items-center justify-center rounded-lg text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Plus className="size-4" aria-hidden />
      </button>
    </div>
  )
}

/* ================================================================== */
/* Main component                                                      */
/* ================================================================== */

const TABS = [
  { id: 'dice', icon: Dices, label: 'Dice', tint: 'bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/30' },
  { id: 'coin', icon: Coins, label: 'Coin', tint: 'bg-yellow-400/15 text-yellow-300 ring-1 ring-yellow-400/30' },
  { id: 'wheel', icon: Disc3, label: 'Wheel', tint: 'bg-fuchsia-400/15 text-fuchsia-300 ring-1 ring-fuchsia-400/30' },
  { id: 'picker', icon: Users, label: 'Picker', tint: 'bg-teal-400/15 text-teal-300 ring-1 ring-teal-400/30' },
] as const

export default function RandomToolsApp() {
  const { toast } = useToast()

  /* ---------------- shared state ---------------- */
  const [tab, setTab] = useState<TabId>('dice')
  const [muted, setMuted] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [announce, setAnnounce] = useState('')

  /* ---------------- dice state ---------------- */
  const [diceCount, setDiceCount] = useState(2)
  const [diceSides, setDiceSides] = useState<DieSides>(6)
  const [diceValues, setDiceValues] = useState<number[]>([1, 1])
  const [diceNonce, setDiceNonce] = useState<number[]>([0, 0])
  const [diceHistory, setDiceHistory] = useState<DiceRoll[]>([])

  /* ---------------- coin state ---------------- */
  const [coinRotation, setCoinRotation] = useState(0)
  const [coinFlipping, setCoinFlipping] = useState(false)
  const [coinResult, setCoinResult] = useState<CoinFace | null>(null)
  const [tally, setTally] = useState({ H: 0, T: 0 })
  const [flipLog, setFlipLog] = useState<FlipLog[]>([])

  /* ---------------- wheel state ---------------- */
  const [segs, setSegs] = useState<WheelSeg[]>(
    DEFAULT_WHEEL_LABELS.map((label) => ({ id: uid(), label }))
  )
  const [rotation, setRotation] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [winner, setWinner] = useState<WheelSeg | null>(null)
  const [burst, setBurst] = useState<ConfettiDot[] | null>(null)
  const [burstKey, setBurstKey] = useState(0)

  /* ---------------- picker state ---------------- */
  const [pickMode, setPickMode] = useState<'names' | 'numbers'>('names')
  const [namesText, setNamesText] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [winnersCount, setWinnersCount] = useState(1)
  const [nameResults, setNameResults] = useState<string[] | null>(null)
  const [nameDrawNonce, setNameDrawNonce] = useState(0)

  const [rangeMin, setRangeMin] = useState('1')
  const [rangeMax, setRangeMax] = useState('100')
  const [numbersCount, setNumbersCount] = useState(5)
  const [numResults, setNumResults] = useState<number[] | null>(null)
  const [numDrawNonce, setNumDrawNonce] = useState(0)

  /* ---------------- audio (lazy Web Audio, guarded) ---------------- */
  const mutedRef = useRef(muted)
  mutedRef.current = muted
  const audioRef = useRef<AudioContext | null>(null)

  const play = useCallback(
    (freq: number, dur = 0.09, type: OscillatorType = 'triangle', gain = 0.05, when = 0) => {
      try {
        if (mutedRef.current || typeof window === 'undefined') return
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Ctor) return
        audioRef.current ??= new Ctor()
        const ctx = audioRef.current
        if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
        const t0 = ctx.currentTime + when
        const osc = ctx.createOscillator()
        const amp = ctx.createGain()
        osc.type = type
        osc.frequency.setValueAtTime(freq, t0)
        amp.gain.setValueAtTime(0.0001, t0)
        amp.gain.exponentialRampToValueAtTime(Math.max(gain, 0.001), t0 + 0.012)
        amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
        osc.connect(amp)
        amp.connect(ctx.destination)
        osc.start(t0)
        osc.stop(t0 + dur + 0.05)
      } catch {
        /* audio unavailable — stay silent */
      }
    },
    []
  )

  /* ---------------- hydration (localStorage) ---------------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw) as { muted?: unknown; wheel?: unknown }
        if (typeof data.muted === 'boolean') setMuted(data.muted)
        if (Array.isArray(data.wheel)) {
          const labels = data.wheel
            .filter((x): x is string => typeof x === 'string')
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 12)
          if (labels.length >= 2) setSegs(labels.map((label) => ({ id: uid(), label })))
        }
      }
    } catch {
      /* corrupted or blocked storage — keep defaults */
    }
    setHydrated(true)
  }, [])

  /* ---------------- persistence (wheel labels + mute) ---------------- */
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 1, muted, wheel: segs.map((s) => s.label) })
      )
    } catch {
      /* private mode / quota — memory-only */
    }
  }, [hydrated, muted, segs])

  /* ---------------- dice actions ---------------- */
  const rollOne = (index: number) => {
    const value = randInt(1, diceSides)
    setDiceValues((prev) => prev.map((v, i) => (i === index ? value : v)))
    setDiceNonce((prev) => prev.map((n, i) => (i === index ? n + 1 : n)))
    play(210, 0.05, 'square', 0.035)
    window.setTimeout(() => play(920, 0.09, 'triangle', 0.045), 320)
    buzz(12)
    setAnnounce(`Die ${index + 1} rolled ${value}`)
  }

  const rollAll = () => {
    const values = Array.from({ length: diceCount }, () => randInt(1, diceSides))
    const total = values.reduce((s, v) => s + v, 0)
    setDiceValues(values)
    setDiceNonce((prev) => prev.map((n) => n + 1))
    setDiceHistory((prev) => [{ id: uid(), sides: diceSides, values, total }, ...prev].slice(0, 10))
    play(210, 0.05, 'square', 0.035)
    window.setTimeout(() => play(980, 0.1, 'triangle', 0.05), 340)
    buzz(12)
    setAnnounce(`Rolled ${values.join(', ')} — total ${total}`)
  }

  const setCount = (n: number) => {
    setDiceCount(n)
    setDiceValues((prev) => {
      const next = Array.from({ length: n }, (_, i) => prev[i] ?? randInt(1, diceSides))
      return next
    })
    setDiceNonce((prev) => {
      const next = Array.from({ length: n }, (_, i) => prev[i] ?? 0)
      return next
    })
  }

  const total = diceValues.reduce((s, v) => s + v, 0)
  const maxTotal = diceCount * diceSides

  /* ---------------- coin actions ---------------- */
  const flipCoin = () => {
    if (coinFlipping) return
    const outcome: CoinFace = Math.random() < 0.5 ? 'H' : 'T'
    const shownFace: CoinFace = Math.round(coinRotation / 180) % 2 === 0 ? 'H' : 'T'
    const extraSpins = 360 * (1 + Math.floor(Math.random() * 2))
    const delta = (outcome === shownFace ? 360 : 180) + extraSpins
    setCoinFlipping(true)
    setCoinResult(null)
    play(300, 0.06, 'square', 0.03)
    buzz(12)
    setCoinRotation((rot) => rot + delta)
    window.setTimeout(() => {
      setCoinResult(outcome)
      setTally((t) => ({ ...t, [outcome]: t[outcome] + 1 }))
      setFlipLog((l) => [{ id: uid(), face: outcome }, ...l].slice(0, 14))
      setCoinFlipping(false)
      play(740, 0.09, 'triangle', 0.05)
      play(1108, 0.12, 'triangle', 0.045, 0.09)
      buzz(12)
      setAnnounce(outcome === 'H' ? 'Heads' : 'Tails')
    }, 900)
  }

  const resetTally = () => {
    setTally({ H: 0, T: 0 })
    setFlipLog([])
    setCoinResult(null)
    setAnnounce('Tally reset')
  }

  const flips = tally.H + tally.T
  const headsFrac = flips > 0 ? tally.H / flips : 0

  /* ---------------- wheel actions ---------------- */
  const segAngle = 360 / segs.length

  const conicGradient = useMemo(() => {
    const stops = segs
      .map(
        (s, i) =>
          `${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${i * segAngle}deg ${(i + 1) * segAngle}deg`
      )
      .join(', ')
    return `conic-gradient(${stops})`
  }, [segs, segAngle])

  const spinWheel = () => {
    if (spinning || segs.length < 2) return
    const target = Math.floor(Math.random() * segs.length)
    const jitter = 0.18 + Math.random() * 0.64
    const pointerTarget = target * segAngle + jitter * segAngle
    const currentPointer = (360 - (rotation % 360)) % 360
    const delta = ((pointerTarget - currentPointer) % 360 + 360) % 360
    const spins = 4 + Math.floor(Math.random() * 3)
    const DURATION = 4300

    setWinner(null)
    setSpinning(true)
    play(240, 0.05, 'square', 0.03)
    buzz(12)

    /* decaying tick track — dense early, sparse as the wheel slows */
    const TICKS = 12
    for (let k = 1; k <= TICKS; k++) {
      window.setTimeout(() => play(1500, 0.025, 'square', 0.022), DURATION * Math.pow(k / TICKS, 1.7))
    }

    setRotation((rot) => rot + spins * 360 + delta)

    window.setTimeout(() => {
      setSpinning(false)
      const w = segs[target]
      setWinner(w)
      setBurstKey((k) => k + 1)
      setBurst(
        Array.from({ length: CONFETTI_COUNT }, (_, i) => {
          const angle = (i / CONFETTI_COUNT) * Math.PI * 2 + Math.random() * 0.5
          const dist = 92 + Math.random() * 84
          return {
            x: Math.cos(angle) * dist,
            y: Math.sin(angle) * dist + 26,
            color: WHEEL_COLORS[i % WHEEL_COLORS.length],
            size: 5 + Math.random() * 5,
            rot: Math.random() * 360,
            dur: 0.65 + Math.random() * 0.45,
            delay: Math.random() * 0.08,
          }
        })
      )
      play(660, 0.1, 'triangle', 0.05)
      play(880, 0.12, 'triangle', 0.05, 0.1)
      play(1320, 0.16, 'triangle', 0.045, 0.2)
      buzz([12, 60, 24])
      setAnnounce(`The wheel chose ${w.label}`)
    }, DURATION + 60)
  }

  useEffect(() => {
    if (!burst) return
    const t = window.setTimeout(() => setBurst(null), 1300)
    return () => window.clearTimeout(t)
  }, [burst])

  const addSeg = () => {
    if (segs.length >= 12) return
    setWinner(null)
    setSegs((prev) => [...prev, { id: uid(), label: `Option ${prev.length + 1}` }])
  }

  const removeSeg = (id: string) => {
    if (segs.length <= 2) return
    setWinner(null)
    setSegs((prev) => prev.filter((s) => s.id !== id))
  }

  const renameSeg = (id: string, label: string) => {
    setWinner(null)
    setSegs((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)))
  }

  /* ---------------- picker actions ---------------- */
  const pool = useMemo(
    () => [...new Set(namesText.split('\n').map((s) => s.trim()).filter(Boolean))],
    [namesText]
  )
  const remaining = useMemo(() => pool.filter((n) => !picked.includes(n)), [pool, picked])
  const maxWinners = Math.max(1, Math.min(remaining.length, 10))

  const drawNames = () => {
    if (remaining.length === 0) {
      toast({ title: 'No names left', description: 'Reset the pool or add more names.' })
      return
    }
    const k = Math.min(winnersCount, remaining.length)
    const shuffled = [...remaining]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = randInt(0, i)
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }
    const winners = shuffled.slice(0, k)
    setPicked((p) => [...p, ...winners])
    setNameResults(winners)
    setNameDrawNonce((n) => n + 1)
    play(660, 0.1, 'triangle', 0.05)
    play(990, 0.14, 'triangle', 0.045, 0.1)
    buzz([12, 40, 12])
    if (k < winnersCount) {
      toast({ title: `Only ${remaining.length} in the pool`, description: 'Picked everyone available.' })
    }
    setAnnounce(`Winners: ${winners.join(', ')}`)
  }

  const resetPool = () => {
    setPicked([])
    setNameResults(null)
    setWinnersCount(1)
    setAnnounce('Pool reset')
  }

  const drawNumbers = () => {
    let lo = Math.floor(Number(rangeMin))
    let hi = Math.floor(Number(rangeMax))
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || rangeMin.trim() === '' || rangeMax.trim() === '') {
      toast({ title: 'Enter a valid range', description: 'Min and max must be whole numbers.' })
      return
    }
    if (lo > hi) [lo, hi] = [hi, lo]
    const size = hi - lo + 1
    const k = Math.min(numbersCount, size)
    if (k < numbersCount) {
      toast({ title: 'Range is too small', description: `Showing all ${size} unique values.` })
    }
    const pickedNums = new Set<number>()
    while (pickedNums.size < k) pickedNums.add(randInt(lo, hi))
    const results = [...pickedNums].sort((a, b) => a - b)
    setNumResults(results)
    setNumDrawNonce((n) => n + 1)
    play(660, 0.1, 'triangle', 0.05)
    play(990, 0.14, 'triangle', 0.045, 0.1)
    buzz([12, 40, 12])
    setAnnounce(`Numbers: ${results.join(', ')}`)
  }

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
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-fuchsia-500/[0.1] via-purple-500/[0.06] to-transparent px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-fuchsia-300 via-purple-500 to-violet-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(192_132_252/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Dices className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Random Tools</h2>
              <p className="text-xs text-zinc-400">Dice, flips, spins &amp; lucky draws.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? 'Unmute result sounds' : 'Mute result sounds'}
                aria-pressed={muted}
                className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                {muted ? (
                  <VolumeX className="size-4.5 text-zinc-500" aria-hidden />
                ) : (
                  <Volume2 className="size-4.5 text-fuchsia-300" aria-hidden />
                )}
              </button>
            </div>
          </div>

          {/* Tab bar */}
          <div
            role="tablist"
            aria-label="Randomizer"
            className="mt-5 grid grid-cols-4 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5"
          >
            {TABS.map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-semibold transition-all',
                    active ? t.tint : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                  )}
                >
                  <t.icon className="size-5" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                  {t.label}
                </button>
              )
            })}
          </div>
        </div>

        <p aria-live="polite" className="sr-only">
          {announce}
        </p>

        {/* ---------------- Panels ---------------- */}
        <div className="p-4 sm:p-5">
          <AnimatePresence mode="wait" initial={false}>
            {tab === 'dice' && (
              <motion.div
                key="dice"
                role="tabpanel"
                aria-label="Dice roller"
                initial={{ opacity: 0, y: 12, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className="space-y-4"
              >
                {/* dice table */}
                <div className="relative overflow-hidden rounded-2xl border border-amber-400/15 bg-gradient-to-b from-amber-400/[0.06] to-transparent p-4">
                  <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
                    {diceValues.map((value, i) => {
                      const big = diceCount <= 2
                      return (
                        <motion.button
                          key={i}
                          onClick={() => rollOne(i)}
                          whileTap={{ scale: 0.92 }}
                          aria-label={`Die ${i + 1} shows ${value}. Tap to re-roll.`}
                          className={cn(
                            'relative rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70',
                            big ? 'size-24' : 'size-16 sm:size-20'
                          )}
                        >
                          <AnimatePresence mode="popLayout" initial={false}>
                            <motion.span
                              key={diceNonce[i]}
                              initial={{ rotate: -360, scale: 0.55, opacity: 0.55 }}
                              animate={{ rotate: 0, scale: 1, opacity: 1 }}
                              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                              className={cn(
                                'absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl shadow-[0_10px_24px_-8px_rgb(0_0_0/0.6)]',
                                diceSides === 6 &&
                                  'border border-zinc-950/10 bg-gradient-to-br from-white via-zinc-100 to-zinc-300',
                                diceSides === 12 &&
                                  'bg-gradient-to-br from-amber-200 via-amber-400 to-orange-500 ring-2 ring-white/30 ring-inset',
                                diceSides === 20 &&
                                  'bg-gradient-to-br from-violet-300 via-purple-500 to-violet-700 ring-2 ring-white/30 ring-inset'
                              )}
                            >
                              {diceSides === 6 ? (
                                <span
                                  aria-hidden
                                  className={cn(
                                    'grid h-[70%] w-[70%] grid-cols-3 grid-rows-3',
                                    big ? 'gap-0.5' : 'gap-px'
                                  )}
                                >
                                  {Array.from({ length: 9 }, (_, cell) => (
                                    <span key={cell} className="flex items-center justify-center">
                                      {PIP_CELLS[value]?.includes(cell) && (
                                        <span
                                          className={cn(
                                            'rounded-full bg-zinc-900',
                                            big ? 'size-2.5' : 'size-1.5 sm:size-2'
                                          )}
                                        />
                                      )}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span
                                  className={cn(
                                    'font-black tabular-nums',
                                    diceSides === 12 ? 'text-zinc-950' : 'text-white',
                                    big ? 'text-4xl' : 'text-2xl sm:text-3xl'
                                  )}
                                >
                                  {value}
                                </span>
                              )}
                            </motion.span>
                          </AnimatePresence>
                        </motion.button>
                      )
                    })}
                  </div>

                  {/* total badge */}
                  <div className="mt-4 flex justify-center">
                    <motion.div
                      key={total}
                      initial={{ scale: 0.7, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                      className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5"
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Total
                      </span>
                      <span className="text-xl font-black tabular-nums text-amber-300">{total}</span>
                      <span className="text-xs font-semibold tabular-nums text-zinc-500">/ {maxTotal}</span>
                    </motion.div>
                  </div>
                </div>

                {/* pickers */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <SectionLabel>Dice ({diceCount})</SectionLabel>
                    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Number of dice">
                      {[1, 2, 3, 4, 5, 6].map((n) => (
                        <button
                          key={n}
                          onClick={() => setCount(n)}
                          role="radio"
                          aria-checked={diceCount === n}
                          className={cn(
                            'flex size-11 items-center justify-center rounded-xl border text-sm font-bold tabular-nums transition-all',
                            diceCount === n
                              ? 'border-amber-400/60 bg-amber-400/15 text-amber-300 shadow-md'
                              : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                          )}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <SectionLabel>Sides</SectionLabel>
                    <div className="flex gap-1.5" role="radiogroup" aria-label="Dice sides">
                      {([6, 12, 20] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => setDiceSides(s)}
                          role="radio"
                          aria-checked={diceSides === s}
                          className={cn(
                            'h-11 flex-1 rounded-xl border text-sm font-bold tabular-nums transition-all',
                            diceSides === s
                              ? s === 6
                                ? 'border-zinc-200/50 bg-zinc-100/15 text-zinc-100 shadow-md'
                                : s === 12
                                  ? 'border-amber-400/60 bg-amber-400/15 text-amber-300 shadow-md'
                                  : 'border-violet-400/60 bg-violet-400/15 text-violet-300 shadow-md'
                              : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                          )}
                        >
                          d{s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <Button
                  onClick={rollAll}
                  className="h-12 w-full rounded-xl bg-gradient-to-r from-amber-300 to-orange-500 font-bold text-zinc-950 shadow-lg shadow-amber-500/20 hover:from-amber-200 hover:to-orange-400"
                >
                  <Dices className="size-4.5" aria-hidden /> Roll {diceCount > 1 ? `all ${diceCount}` : 'the die'}
                </Button>

                {/* history strip */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <SectionLabel>Recent rolls</SectionLabel>
                    {diceHistory.length > 0 && (
                      <button
                        onClick={() => setDiceHistory([])}
                        className="mb-1.5 flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
                      >
                        <RotateCcw className="size-3" aria-hidden /> Clear
                      </button>
                    )}
                  </div>
                  {diceHistory.length > 0 ? (
                    <div
                      className={cn(
                        'flex gap-2 overflow-x-auto pb-1',
                        SCROLLBAR_HIDDEN
                      )}
                    >
                      {diceHistory.map((r) => (
                        <span
                          key={r.id}
                          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs"
                        >
                          <span className="rounded bg-white/10 px-1 py-0.5 text-[9px] font-bold text-zinc-400">
                            d{r.sides}
                          </span>
                          <span className="tabular-nums text-zinc-300">{r.values.join(' + ')}</span>
                          <span className="font-black tabular-nums text-amber-300">= {r.total}</span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/[0.02] py-4 text-xs text-zinc-500">
                      <Dices className="size-4 text-amber-300/60" aria-hidden />
                      No rolls yet — hit Roll and let fate decide.
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {tab === 'coin' && (
              <motion.div
                key="coin"
                role="tabpanel"
                aria-label="Coin flip"
                initial={{ opacity: 0, y: 12, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className="space-y-4"
              >
                {/* the coin */}
                <div className="relative flex flex-col items-center overflow-hidden rounded-2xl border border-yellow-400/15 bg-gradient-to-b from-yellow-400/[0.06] to-transparent px-4 pb-5 pt-8">
                  <span
                    aria-hidden
                    className="pointer-events-none absolute left-1/2 top-16 size-44 -translate-x-1/2 rounded-full bg-yellow-400/10 blur-3xl"
                  />
                  <button
                    onClick={flipCoin}
                    disabled={coinFlipping}
                    aria-label={`Flip the coin. Last result: ${coinResult === 'H' ? 'heads' : coinResult === 'T' ? 'tails' : 'none'}.`}
                    className="relative [perspective:900px] focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/70 rounded-full disabled:cursor-wait"
                  >
                    <motion.div
                      initial={false}
                      animate={{ rotateX: coinRotation }}
                      transition={
                        coinFlipping
                          ? { duration: 0.9, ease: [0.18, 0.9, 0.28, 1] }
                          : { duration: 0 }
                      }
                      className="relative size-40 [transform-style:preserve-3d]"
                    >
                      {/* heads */}
                      <span className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-[radial-gradient(circle_at_32%_28%,#fef9c3,#fcd34d_38%,#d97706_74%,#92400e)] shadow-[0_16px_40px_-12px_rgb(217_119_6/0.75),inset_0_2px_6px_rgb(255_255_255/0.55)] [backface-visibility:hidden]">
                        <span className="absolute inset-2.5 rounded-full border-2 border-amber-900/25" />
                        <span className="text-5xl font-black text-amber-950 drop-shadow-[0_1px_0_rgb(255_255_255/0.4)]">
                          H
                        </span>
                        <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.3em] text-amber-900/70">
                          Heads
                        </span>
                      </span>
                      {/* tails */}
                      <span className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-[radial-gradient(circle_at_32%_28%,#fef3c7,#fbbf24_38%,#b45309_74%,#78350f)] shadow-[0_16px_40px_-12px_rgb(180_83_9/0.75),inset_0_2px_6px_rgb(255_255_255/0.45)] [transform:rotateX(180deg)] [backface-visibility:hidden]">
                        <span className="absolute inset-2.5 rounded-full border-2 border-amber-950/30" />
                        <span className="text-5xl font-black text-amber-950 drop-shadow-[0_1px_0_rgb(255_255_255/0.35)]">
                          T
                        </span>
                        <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.3em] text-amber-950/70">
                          Tails
                        </span>
                      </span>
                    </motion.div>
                  </button>

                  <p className="mt-4 text-[11px] text-zinc-500">Tap the coin to flip</p>

                  {/* result badge */}
                  <div className="mt-2 flex h-9 items-center">
                    <AnimatePresence mode="wait" initial={false}>
                      {coinResult && !coinFlipping && (
                        <motion.span
                          key={flips}
                          initial={{ scale: 0.5, opacity: 0, y: 6 }}
                          animate={{ scale: 1, opacity: 1, y: 0 }}
                          exit={{ scale: 0.8, opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-4 py-1 text-sm font-black uppercase tracking-wider',
                            coinResult === 'H'
                              ? 'bg-gradient-to-r from-yellow-200 to-amber-400 text-amber-950 shadow-lg shadow-amber-500/25'
                              : 'bg-gradient-to-r from-amber-700 to-amber-950 text-amber-100 shadow-lg shadow-amber-900/40 ring-1 ring-amber-500/40'
                          )}
                        >
                          <Sparkles className="size-3.5" aria-hidden />
                          {coinResult === 'H' ? 'Heads' : 'Tails'}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* tally */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between">
                    <SectionLabel>Tally</SectionLabel>
                    <button
                      onClick={resetTally}
                      disabled={flips === 0}
                      className="mb-1.5 flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <RotateCcw className="size-3" aria-hidden /> Reset
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/10 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-yellow-300/80">
                        Heads
                      </p>
                      <p className="text-lg font-black tabular-nums text-yellow-200">
                        {tally.H}
                        {flips > 0 && (
                          <span className="ml-1 text-[11px] font-semibold text-yellow-200/60">
                            {Math.round(headsFrac * 100)}%
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                        Tails
                      </p>
                      <p className="text-lg font-black tabular-nums text-zinc-200">
                        {tally.T}
                        {flips > 0 && (
                          <span className="ml-1 text-[11px] font-semibold text-zinc-500">
                            {Math.round((1 - headsFrac) * 100)}%
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/[0.06]">
                    <motion.span
                      className="h-full bg-gradient-to-r from-yellow-300 to-amber-400"
                      initial={false}
                      animate={{ width: `${headsFrac * 100}%` }}
                      transition={{ type: 'spring', stiffness: 160, damping: 24 }}
                    />
                  </div>

                  {flipLog.length > 0 && (
                    <div className={cn('mt-3 flex gap-1.5 overflow-x-auto pb-0.5', SCROLLBAR_HIDDEN)}>
                      {flipLog.map((f, i) => (
                        <motion.span
                          key={f.id}
                          initial={{ scale: 0.5, opacity: 0 }}
                          animate={{ scale: 1, opacity: i === 0 ? 1 : 0.55 }}
                          transition={{ type: 'spring', stiffness: 420, damping: 22 }}
                          className={cn(
                            'flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-black',
                            f.face === 'H'
                              ? 'bg-yellow-400/20 text-yellow-300 ring-1 ring-yellow-400/40'
                              : 'bg-white/5 text-zinc-300 ring-1 ring-white/15'
                          )}
                        >
                          {f.face}
                        </motion.span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {tab === 'wheel' && (
              <motion.div
                key="wheel"
                role="tabpanel"
                aria-label="Spin wheel"
                initial={{ opacity: 0, y: 12, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className="space-y-4"
              >
                {/* the wheel */}
                <div className="relative overflow-hidden rounded-2xl border border-fuchsia-400/15 bg-gradient-to-b from-fuchsia-500/[0.06] to-transparent px-4 pb-5 pt-7">
                  <div className="relative mx-auto size-[280px] max-w-full">
                    {/* glow */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -inset-4 rounded-full bg-[#c084fc]/15 blur-2xl"
                    />
                    {/* pointer */}
                    <div
                      aria-hidden
                      className="absolute -top-2 left-1/2 z-20 -translate-x-1/2 drop-shadow-[0_2px_8px_rgba(192,132,252,0.9)]"
                    >
                      <div className="h-0 w-0 border-x-[11px] border-t-[18px] border-x-transparent border-t-zinc-100" />
                    </div>

                    {/* rotating wheel */}
                    <div
                      className="absolute inset-0 rounded-full border-4 border-white/10 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.08),inset_0_12px_36px_rgba(0,0,0,0.4),0_18px_44px_-16px_rgb(0_0_0/0.7)]"
                      style={{
                        background: conicGradient,
                        transform: `rotate(${rotation}deg)`,
                        transition: spinning
                          ? 'transform 4.3s cubic-bezier(0.15, 0.9, 0.25, 1)'
                          : 'none',
                      }}
                      role="img"
                      aria-label={`Prize wheel with ${segs.length} segments: ${segs.map((s) => s.label).join(', ')}`}
                    >
                      {segs.map((s, i) => (
                        <span
                          key={s.id}
                          aria-hidden
                          className="absolute left-1/2 top-1/2 whitespace-nowrap text-[10px] font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]"
                          style={{
                            transform: `translate(-50%, -50%) rotate(${i * segAngle + segAngle / 2}deg) translateY(-92px)`,
                          }}
                        >
                          {truncateLabel(s.label)}
                        </span>
                      ))}
                    </div>

                    {/* hub / spin button */}
                    <motion.button
                      onClick={spinWheel}
                      whileTap={{ scale: spinning ? 1 : 0.94 }}
                      disabled={spinning}
                      aria-label="Spin the wheel"
                      className="absolute left-1/2 top-1/2 z-10 flex size-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-to-br from-fuchsia-300 via-purple-500 to-violet-600 text-sm font-black uppercase tracking-[0.18em] text-white ring-4 ring-zinc-950/70 shadow-[0_10px_30px_-6px_rgba(192,132,252,0.85)] transition-opacity disabled:cursor-wait focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-300"
                    >
                      {spinning ? (
                        <Disc3 className="size-7 animate-spin" aria-hidden />
                      ) : (
                        'Spin'
                      )}
                    </motion.button>

                    {/* confetti burst */}
                    {burst && (
                      <div aria-hidden className="pointer-events-none absolute inset-0 z-30">
                        {burst.map((d, i) => (
                          <motion.span
                            key={`${burstKey}-${i}`}
                            initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
                            animate={{ x: d.x, y: d.y, opacity: 0, scale: 0.35, rotate: d.rot }}
                            transition={{ duration: d.dur, delay: d.delay, ease: 'easeOut' }}
                            className="absolute left-1/2 top-1/2 rounded-[2px]"
                            style={{
                              width: d.size,
                              height: d.size * 0.6,
                              marginLeft: -d.size / 2,
                              marginTop: -d.size * 0.3,
                              backgroundColor: d.color,
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* winner card */}
                  <div className="mt-5 flex min-h-16 items-center justify-center">
                    <AnimatePresence mode="wait" initial={false}>
                      {winner && !spinning ? (
                        <motion.div
                          key={winner.id + winner.label + rotation}
                          initial={{ scale: 0.7, opacity: 0, y: 12 }}
                          animate={{ scale: 1, opacity: 1, y: 0 }}
                          exit={{ scale: 0.9, opacity: 0 }}
                          transition={{ type: 'spring', stiffness: 380, damping: 22 }}
                          className="flex w-full max-w-xs items-center gap-3 rounded-2xl border border-fuchsia-400/30 bg-gradient-to-r from-fuchsia-500/15 to-purple-500/10 p-3.5 shadow-[0_10px_30px_-12px_rgba(192,132,252,0.6)]"
                        >
                          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-300 to-purple-500 text-white shadow-md">
                            <Trophy className="size-5.5" aria-hidden />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-fuchsia-300/80">
                              The wheel chose
                            </p>
                            <p className="truncate text-lg font-black tracking-tight text-zinc-100">
                              {winner.label}
                            </p>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.p
                          key={spinning ? 'spinning' : 'idle'}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="text-xs text-zinc-500"
                        >
                          {spinning ? 'Round and round it goes…' : 'Tap SPIN to pick a winner'}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* segment editor */}
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <SectionLabel>
                      Segments ({segs.length}/12)
                    </SectionLabel>
                    <Button
                      onClick={addSeg}
                      disabled={segs.length >= 12 || spinning}
                      variant="outline"
                      className="mb-1.5 h-8 gap-1 rounded-lg border-white/10 bg-white/5 px-2.5 text-[11px] font-semibold text-zinc-300 hover:bg-white/10 hover:text-white"
                    >
                      <Plus className="size-3.5" aria-hidden /> Add
                    </Button>
                  </div>
                  <div
                    className={cn(
                      'max-h-60 space-y-2 overflow-y-auto pr-1',
                      SCROLLBAR_THIN
                    )}
                  >
                    {segs.map((s, i) => (
                      <div key={s.id} className="flex items-center gap-2">
                        <span
                          className="size-6 shrink-0 rounded-lg ring-1 ring-white/20"
                          style={{ backgroundColor: WHEEL_COLORS[i % WHEEL_COLORS.length] }}
                          aria-hidden
                        />
                        <input
                          value={s.label}
                          onChange={(e) => renameSeg(s.id, e.target.value)}
                          disabled={spinning}
                          maxLength={24}
                          aria-label={`Segment ${i + 1} label`}
                          placeholder={`Option ${i + 1}`}
                          className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-fuchsia-400/50 focus:outline-none disabled:opacity-50"
                        />
                        <button
                          onClick={() => removeSeg(s.id)}
                          disabled={spinning}
                          aria-label={`Remove segment ${s.label || i + 1}`}
                          className={cn(
                            'flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:border-rose-400/40 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-30',
                            segs.length <= 2 && 'pointer-events-none opacity-30'
                          )}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-600">
                    Two to twelve segments. Labels and your sound preference are saved on this device.
                  </p>
                </div>
              </motion.div>
            )}

            {tab === 'picker' && (
              <motion.div
                key="picker"
                role="tabpanel"
                aria-label="Name and number picker"
                initial={{ opacity: 0, y: 12, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                className="space-y-4"
              >
                {/* mode pills */}
                <div
                  role="radiogroup"
                  aria-label="Picker mode"
                  className="flex rounded-2xl border border-white/10 bg-white/[0.04] p-1.5"
                >
                  {(
                    [
                      { id: 'names', icon: Type, label: 'Names' },
                      { id: 'numbers', icon: Hash, label: 'Numbers' },
                    ] as const
                  ).map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setPickMode(m.id)}
                      role="radio"
                      aria-checked={pickMode === m.id}
                      className={cn(
                        'flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition-all',
                        pickMode === m.id
                          ? 'bg-teal-400/15 text-teal-300 ring-1 ring-teal-400/30'
                          : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                      )}
                    >
                      <m.icon className="size-4" aria-hidden />
                      {m.label}
                    </button>
                  ))}
                </div>

                {pickMode === 'names' ? (
                  <motion.div
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                    className="space-y-4"
                  >
                    <div>
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <SectionLabel>Names (one per line)</SectionLabel>
                        <span className="mb-1.5 text-[11px] font-semibold tabular-nums text-zinc-500">
                          {pool.length} in pool · {picked.length} drawn
                        </span>
                      </div>
                      <textarea
                        value={namesText}
                        onChange={(e) => setNamesText(e.target.value)}
                        rows={6}
                        placeholder={'Ada\nGrace\nAlan\nKatherine'}
                        aria-label="Names, one per line"
                        className="h-36 w-full resize-none rounded-2xl border border-white/10 bg-white/5 p-3.5 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-teal-400/50 focus:outline-none"
                      />
                    </div>

                    <div className="flex items-end gap-3">
                      <div className="shrink-0">
                        <SectionLabel>Winners</SectionLabel>
                        <Stepper
                          value={Math.min(winnersCount, maxWinners)}
                          min={1}
                          max={maxWinners}
                          onChange={setWinnersCount}
                          label="number of winners"
                        />
                      </div>
                      <Button
                        onClick={drawNames}
                        disabled={remaining.length === 0}
                        className="h-12 flex-1 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-bold text-zinc-950 shadow-lg shadow-teal-500/20 hover:from-teal-200 hover:to-emerald-400"
                      >
                        <Wand2 className="size-4.5" aria-hidden /> Draw {Math.min(winnersCount, maxWinners) > 1 ? `${Math.min(winnersCount, maxWinners)} winners` : 'a winner'}
                      </Button>
                    </div>

                    {/* results */}
                    {nameResults && nameResults.length > 0 ? (
                      <motion.div
                        key={nameDrawNonce}
                        className="grid gap-2 sm:grid-cols-2"
                        role="list"
                        aria-label="Winners"
                      >
                        {nameResults.map((w, i) => (
                          <motion.div
                            key={w + i}
                            role="listitem"
                            initial={{ scale: 0.4, opacity: 0, y: 14 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            transition={{
                              type: 'spring',
                              stiffness: 380,
                              damping: 20,
                              delay: 0.08 + i * 0.12,
                            }}
                            className="flex items-center gap-3 rounded-2xl border border-teal-400/25 bg-gradient-to-r from-teal-400/10 to-emerald-500/5 p-3.5"
                          >
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-300 to-emerald-500 text-sm font-black text-zinc-950 shadow-md">
                              {i + 1}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm font-bold text-zinc-100">
                              {w}
                            </span>
                            <Sparkles className="size-4 shrink-0 text-teal-300/70" aria-hidden />
                          </motion.div>
                        ))}
                      </motion.div>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
                        <span className="flex size-11 items-center justify-center rounded-2xl bg-teal-400/10 text-teal-300">
                          <Users className="size-5.5" aria-hidden />
                        </span>
                        <p className="pt-1 text-sm font-semibold text-zinc-300">
                          {pool.length === 0
                            ? 'Add some names to get started'
                            : 'Ready when you are'}
                        </p>
                        <p className="max-w-52 text-xs text-zinc-500">
                          {pool.length === 0
                            ? 'Type one name per line above, then hit Draw.'
                            : 'Draw picks winners at random — no repeats until you reset.'}
                        </p>
                      </div>
                    )}

                    {/* drawn pool */}
                    {picked.length > 0 && (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <SectionLabel>Drawn ({picked.length})</SectionLabel>
                          <button
                            onClick={resetPool}
                            className="mb-1.5 flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
                          >
                            <RotateCcw className="size-3" aria-hidden /> Reset pool
                          </button>
                        </div>
                        <div className={cn('flex flex-wrap gap-1.5', 'max-h-32 overflow-y-auto pr-1', SCROLLBAR_THIN)}>
                          {picked.map((p, i) => (
                            <span
                              key={p + i}
                              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-zinc-400 line-through decoration-zinc-600"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <SectionLabel>Min</SectionLabel>
                        <input
                          type="number"
                          value={rangeMin}
                          onChange={(e) => setRangeMin(e.target.value)}
                          inputMode="numeric"
                          aria-label="Minimum number"
                          className="h-12 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm font-semibold tabular-nums text-zinc-100 [appearance:textfield] [color-scheme:dark] focus:border-teal-400/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                      <div>
                        <SectionLabel>Max</SectionLabel>
                        <input
                          type="number"
                          value={rangeMax}
                          onChange={(e) => setRangeMax(e.target.value)}
                          inputMode="numeric"
                          aria-label="Maximum number"
                          className="h-12 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm font-semibold tabular-nums text-zinc-100 [appearance:textfield] [color-scheme:dark] focus:border-teal-400/50 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    </div>

                    <div className="flex items-end gap-3">
                      <div className="shrink-0">
                        <SectionLabel>How many</SectionLabel>
                        <Stepper
                          value={numbersCount}
                          min={1}
                          max={20}
                          onChange={setNumbersCount}
                          label="how many numbers"
                        />
                      </div>
                      <Button
                        onClick={drawNumbers}
                        className="h-12 flex-1 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-bold text-zinc-950 shadow-lg shadow-teal-500/20 hover:from-teal-200 hover:to-emerald-400"
                      >
                        <Hash className="size-4.5" aria-hidden /> Draw numbers
                      </Button>
                    </div>

                    <p className="-mt-1 text-[11px] text-zinc-600">
                      Unique values, sorted ascending. If the range is smaller than the count, you
                      get every value.
                    </p>

                    {numResults && numResults.length > 0 ? (
                      <motion.div
                        key={numDrawNonce}
                        className="flex flex-wrap justify-center gap-2"
                        role="list"
                        aria-label="Drawn numbers"
                      >
                        {numResults.map((n, i) => (
                          <motion.span
                            key={`${n}-${i}`}
                            role="listitem"
                            initial={{ scale: 0.3, opacity: 0, rotate: -12 }}
                            animate={{ scale: 1, opacity: 1, rotate: 0 }}
                            transition={{
                              type: 'spring',
                              stiffness: 400,
                              damping: 18,
                              delay: 0.05 + i * 0.06,
                            }}
                            className="flex size-12 items-center justify-center rounded-xl border border-teal-400/25 bg-gradient-to-b from-teal-400/15 to-emerald-500/5 font-black tabular-nums text-teal-200 shadow-md"
                          >
                            {n}
                          </motion.span>
                        ))}
                      </motion.div>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
                        <span className="flex size-11 items-center justify-center rounded-2xl bg-teal-400/10 text-teal-300">
                          <Hash className="size-5.5" aria-hidden />
                        </span>
                        <p className="pt-1 text-sm font-semibold text-zinc-300">
                          Set a range and draw
                        </p>
                        <p className="max-w-52 text-xs text-zinc-500">
                          Great for picking secret-Santa numbers or raffle tickets.
                        </p>
                      </div>
                    )}
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ---------------- Footer ---------------- */}
        <div className="border-t border-white/5 px-5 py-3 text-center">
          <p className="text-[11px] text-zinc-600">
            Fair randomness, generated on-device · wheel &amp; sound prefs stay in this browser
          </p>
        </div>
      </motion.div>
    </div>
  )
}
