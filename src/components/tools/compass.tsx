'use client'

/**
 * Compass & Level — find north, level up.
 *
 * Two tabs in one dark-glass shell:
 *  • Compass — a premium SVG compass rose (60 minor / 12 major ticks, cardinal
 *    + intercardinal labels, glowing red north needle) driven by
 *    DeviceOrientationEvent ('deviceorientationabsolute' preferred,
 *    'deviceorientation' fallback; webkitCompassHeading on iOS for true
 *    north). Rotation is smoothed with a framer-motion spring on a continuous
 *    motion value, so 359°→0° never spins backwards. Without a magnetometer
 *    the dial becomes draggable (manual demo mode) — never blank.
 *  • Level — a bubble bullseye driven by DeviceMotion
 *    accelerationIncludingGravity: pitch/roll → bubble position clamped
 *    inside the circle, tilt X/Y readouts, green "Flat" state below 1.5° with
 *    an optional haptic tick. Desktop falls back to "--" values plus a
 *    draggable demo bubble.
 *
 * iOS 13+ motion permission is requested inside the tap gesture (44px+
 * buttons). All listeners are removed on unmount and every setState is
 * guarded by an alive flag.
 */

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useSpring,
  useTransform,
  type MotionValue,
} from 'framer-motion'
import { Compass, Hand, Ruler, Vibrate } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Shared helpers                                                      */
/* ================================================================== */

type SensorStatus = 'idle' | 'needs-permission' | 'live' | 'demo' | 'denied'
type LevelSource = 'none' | 'motion' | 'orientation'

const SPRING = { type: 'spring', stiffness: 320, damping: 26 } as const

/** Dial rotation spring — a little lazy, like a real damped card. */
const DIAL_SPRING = { stiffness: 120, damping: 21, mass: 1 } as const
/** Bubble spring — snappy but soft. */
const BUBBLE_SPRING = { stiffness: 180, damping: 20, mass: 1 } as const

/** Tilt (deg) that maps to a full-radius bubble deflection. */
const MAX_TILT = 20
/** Considered "flat" when both tilts are inside this window (deg). */
const FLAT_DEG = 1.5

const WINDS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const

const PREFS_KEY = 'toolhub-compass-prefs'

/** Read one boolean pref (client-only component — safe during lazy init). */
function readPref(key: 'trueNorth' | 'hapticsOn', fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return fallback
    const p = JSON.parse(raw) as { trueNorth?: boolean; hapticsOn?: boolean }
    return typeof p[key] === 'boolean' ? (p[key] as boolean) : fallback
  } catch {
    return fallback
  }
}

/** Subtle tick haptic — silently no-ops on unsupported devices. */
function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

const mod360 = (v: number): number => ((v % 360) + 360) % 360
const wrap180 = (v: number): number => (((v % 360) + 540) % 360) - 180
const clampNum = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v))
const toDeg = (rad: number): number => (rad * 180) / Math.PI

interface OrientationCtor {
  new (): DeviceOrientationEvent
  requestPermission?: () => Promise<'granted' | 'denied' | 'prompt'>
}
interface MotionCtor {
  new (): DeviceMotionEvent
  requestPermission?: () => Promise<'granted' | 'denied' | 'prompt'>
}

function orientationCtor(): OrientationCtor | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { DeviceOrientationEvent?: OrientationCtor })
    .DeviceOrientationEvent
}
function motionCtor(): MotionCtor | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { DeviceMotionEvent?: MotionCtor }).DeviceMotionEvent
}

/** 44px-pill-friendly toggle visual used by the settings rows. */
function ToggleVisual({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-200',
        on
          ? 'border-emerald-300/40 bg-gradient-to-b from-emerald-400 to-teal-600 shadow-[0_0_14px_-2px_rgb(16_185_129/0.7)]'
          : 'border-white/10 bg-white/10',
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] size-4.5 rounded-full bg-white shadow-sm transition-all duration-200',
          on ? 'left-[23px]' : 'left-[3px]',
        )}
      />
    </span>
  )
}

/** Small status chip under the dial / disc. */
function StatusChip({
  tone,
  children,
}: {
  tone: 'live' | 'muted' | 'demo' | 'warn'
  children: ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
        tone === 'live' && 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300',
        tone === 'muted' && 'border-white/10 bg-white/[0.04] text-zinc-400',
        tone === 'demo' && 'border-white/10 bg-white/[0.04] text-zinc-300',
        tone === 'warn' && 'border-amber-400/25 bg-amber-400/10 text-amber-300',
      )}
    >
      {children}
    </span>
  )
}

function EnableButton({
  label,
  onClick,
  icon,
}: {
  label: string
  onClick: () => void
  icon: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-sm font-bold text-white',
        'bg-gradient-to-b from-emerald-400 via-emerald-500 to-teal-600',
        'shadow-[0_12px_28px_-10px_rgb(13_148_136/0.8),inset_0_1px_0_rgb(255_255_255/0.25)]',
        'transition-transform active:scale-[0.98]',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function DeniedNote() {
  return (
    <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-xs leading-relaxed text-amber-200/90">
      Motion access was denied. Allow it for this site in your browser settings
      and reload — the manual demo stays available meanwhile.
    </div>
  )
}

/* ================================================================== */
/* Compass rose (static SVG — memoized; rotation happens on a wrapper) */
/* ================================================================== */

const RAD = Math.PI / 180

const MINOR_TICKS = Array.from({ length: 60 }, (_, i) => i * 6)
const MAJOR_TICKS = Array.from({ length: 12 }, (_, i) => i * 30)
const NUMERALS = MAJOR_TICKS.filter((d) => d % 90 !== 0)
const INTERCARDINALS: ReadonlyArray<[number, string]> = [
  [45, 'NE'],
  [135, 'SE'],
  [225, 'SW'],
  [315, 'NW'],
]

function polar(cx: number, cy: number, r: number, deg: number) {
  const a = deg * RAD
  return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }
}

const CompassRose = memo(function CompassRose() {
  const C = 150
  return (
    <svg
      viewBox="0 0 300 300"
      className="size-full select-none"
      aria-hidden
    >
      <defs>
        <radialGradient id="rose-face" r="50%">
          <stop offset="0%" stopColor="rgb(255 255 255 / 0.06)" />
          <stop offset="70%" stopColor="rgb(255 255 255 / 0.02)" />
          <stop offset="100%" stopColor="rgb(255 255 255 / 0.05)" />
        </radialGradient>
        <linearGradient id="needle-north" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fda4af" />
          <stop offset="100%" stopColor="#e11d48" />
        </linearGradient>
        <radialGradient id="needle-glow" r="50%">
          <stop offset="0%" stopColor="rgb(244 63 94 / 0.55)" />
          <stop offset="100%" stopColor="rgb(244 63 94 / 0)" />
        </radialGradient>
      </defs>

      {/* glass face + rings */}
      <circle cx={C} cy={C} r={146} fill="url(#rose-face)" stroke="rgb(255 255 255 / 0.12)" strokeWidth={1.5} />
      <circle cx={C} cy={C} r={138} fill="none" stroke="rgb(255 255 255 / 0.06)" strokeWidth={1} />
      <circle cx={C} cy={C} r={72} fill="rgb(0 0 0 / 0.25)" stroke="rgb(255 255 255 / 0.08)" strokeWidth={1} />

      {/* 60 minor ticks */}
      {MINOR_TICKS.map((d) => {
        const a = polar(C, C, 132, d)
        const b = polar(C, C, 125, d)
        return (
          <line
            key={`m${d}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="rgb(255 255 255 / 0.22)" strokeWidth={1} strokeLinecap="round"
          />
        )
      })}
      {/* 12 major ticks */}
      {MAJOR_TICKS.map((d) => {
        const a = polar(C, C, 132, d)
        const b = polar(C, C, 118, d)
        return (
          <line
            key={`M${d}`}
            x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke="rgb(255 255 255 / 0.65)" strokeWidth={2.5} strokeLinecap="round"
          />
        )
      })}

      {/* degree numerals every 30° (cardinals are letters instead) */}
      {NUMERALS.map((d) => {
        const p = polar(C, C, 104, d)
        return (
          <text
            key={`n${d}`}
            x={p.x} y={p.y}
            textAnchor="middle" dominantBaseline="central"
            className="fill-zinc-500 text-[9px] font-semibold tabular-nums"
          >
            {d}
          </text>
        )
      })}

      {/* intercardinal labels */}
      {INTERCARDINALS.map(([d, label]) => {
        const p = polar(C, C, 85, d)
        return (
          <text
            key={`i${d}`}
            x={p.x} y={p.y}
            textAnchor="middle" dominantBaseline="central"
            className="fill-zinc-500 text-[10px] font-bold tracking-wider"
          >
            {label}
          </text>
        )
      })}

      {/* cardinal labels — N anchors the red needle tip */}
      <text
        x={C} y={C - 85} textAnchor="middle" dominantBaseline="central"
        className="fill-rose-400 text-[17px] font-black"
      >
        N
      </text>
      <text
        x={C + 85} y={C} textAnchor="middle" dominantBaseline="central"
        className="fill-zinc-200 text-[15px] font-extrabold"
      >
        E
      </text>
      <text
        x={C} y={C + 85} textAnchor="middle" dominantBaseline="central"
        className="fill-zinc-200 text-[15px] font-extrabold"
      >
        S
      </text>
      <text
        x={C - 85} y={C} textAnchor="middle" dominantBaseline="central"
        className="fill-zinc-200 text-[15px] font-extrabold"
      >
        W
      </text>

      {/* glowing red north needle — points at the dial's N (rotates with rose) */}
      <circle cx={C} cy={C - 88} r={20} fill="url(#needle-glow)" />
      <polygon
        points={`${C},52 ${C - 9},${C} ${C + 9},${C}`}
        fill="url(#needle-north)"
      />
      <polygon
        points={`${C},248 ${C - 9},${C} ${C + 9},${C}`}
        fill="rgb(63 63 70)"
      />
      <circle cx={C} cy={C} r={7.5} fill="rgb(24 24 27)" stroke="rgb(255 255 255 / 0.35)" strokeWidth={1.5} />
      <circle cx={C} cy={C} r={2.5} fill="#fb7185" />
    </svg>
  )
})

/* ================================================================== */
/* Compass readout — subscribes to the spring, re-renders per degree   */
/* ================================================================== */

function HeadingReadout({ value }: { value: MotionValue<number> }) {
  const [deg, setDeg] = useState(0)
  useMotionValueEvent(value, 'change', (v) => {
    const d = Math.round(mod360(v)) % 360
    setDeg((prev) => (prev === d ? prev : d))
  })
  const wind = WINDS[Math.round(deg / 22.5) % 16]
  return (
    <div className="flex flex-col items-center">
      <span className="text-3xl font-extrabold tracking-tight tabular-nums text-zinc-100 sm:text-4xl">
        {deg}
        <span className="text-xl text-zinc-500">°</span>
      </span>
      <span className="mt-0.5 text-[11px] font-bold tracking-[0.22em] text-emerald-300">
        {wind}
      </span>
    </div>
  )
}

/* ================================================================== */
/* Compass tab                                                         */
/* ================================================================== */

function CompassTab({
  status,
  headingSpring,
  dialRotate,
  onManualRotate,
  trueNorth,
  onTrueNorth,
  onEnable,
}: {
  status: SensorStatus
  headingSpring: MotionValue<number>
  dialRotate: MotionValue<number>
  onManualRotate: (deltaDeg: number) => void
  trueNorth: boolean
  onTrueNorth: (v: boolean) => void
  onEnable: () => void
}) {
  const manual = status !== 'live'
  const drag = useRef<{ id: number; lastA: number } | null>(null)

  const angleAt = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - (rect.left + rect.width / 2)
    const dy = e.clientY - (rect.top + rect.height / 2)
    return (Math.atan2(dx, -dy) * 180) / Math.PI // 0 at top, clockwise +
  }

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!manual) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, lastA: angleAt(e) }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const a = angleAt(e)
    const delta = wrap180(a - d.lastA)
    d.lastA = a
    if (delta !== 0) onManualRotate(delta)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null
  }

  return (
    <div>
      {/* dial */}
      <div className="relative mx-auto">
        <div
          className="pointer-events-none absolute -inset-5 rounded-full bg-emerald-500/10 blur-2xl"
          aria-hidden
        />
        <div
          role={manual ? 'slider' : undefined}
          aria-label={manual ? 'Compass dial — drag to rotate' : undefined}
          aria-valuemin={manual ? 0 : undefined}
          aria-valuemax={manual ? 359 : undefined}
          aria-valuenow={
            manual ? Math.round(mod360(-dialRotate.get())) % 360 : undefined
          }
          tabIndex={manual ? 0 : undefined}
          onKeyDown={
            manual
              ? (e) => {
                  if (e.key === 'ArrowLeft') onManualRotate(-5)
                  if (e.key === 'ArrowRight') onManualRotate(5)
                }
              : undefined
          }
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onLostPointerCapture={onUp}
          className={cn(
            'relative mx-auto aspect-square w-[min(72vw,280px)] touch-none rounded-full',
            'shadow-[0_30px_60px_-25px_rgb(0_0_0/0.85)]',
            manual && 'cursor-grab active:cursor-grabbing',
          )}
        >
          {/* rotating rose (rotate = −heading ⇒ N sits toward real north) */}
          <motion.div
            className="absolute inset-0 will-change-transform"
            style={{ rotate: dialRotate }}
          >
            <CompassRose />
          </motion.div>

          {/* fixed lubber line */}
          <div className="absolute left-1/2 top-[3px] -translate-x-1/2" aria-hidden>
            <div className="h-0 w-0 border-x-8 border-t-[13px] border-x-transparent border-t-zinc-100 drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]" />
          </div>

          {/* center readout */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex size-[44%] flex-col items-center justify-center rounded-full border border-white/10 bg-zinc-950/70 shadow-[inset_0_2px_12px_rgb(0_0_0/0.5)] backdrop-blur-md">
              <HeadingReadout value={headingSpring} />
              <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                {trueNorth ? 'True' : 'Magnetic'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* status chips */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {status === 'live' && (
          <StatusChip tone="live">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
            </span>
            Live sensor
          </StatusChip>
        )}
        {status === 'idle' && <StatusChip tone="muted">Starting sensor…</StatusChip>}
        {status === 'demo' && (
          <StatusChip tone="demo">
            <Hand className="size-3.5" aria-hidden /> Demo — no magnetometer
          </StatusChip>
        )}
        {status === 'needs-permission' && (
          <StatusChip tone="muted">Permission needed</StatusChip>
        )}
        {status === 'denied' && (
          <StatusChip tone="warn">
            <Hand className="size-3.5" aria-hidden /> Access denied — manual demo
          </StatusChip>
        )}
        <StatusChip tone="muted">
          {trueNorth ? 'True north · declination ignored' : 'Magnetic north'}
        </StatusChip>
      </div>

      {status === 'needs-permission' && (
        <div className="mt-4">
          <EnableButton
            label="Enable compass"
            onClick={onEnable}
            icon={<Compass className="size-4" aria-hidden />}
          />
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            Your browser will ask for motion &amp; orientation access.
          </p>
        </div>
      )}
      {status === 'denied' && (
        <div className="mt-4">
          <DeniedNote />
        </div>
      )}

      {/* true-north row */}
      <button
        type="button"
        role="switch"
        aria-checked={trueNorth}
        onClick={() => {
          onTrueNorth(!trueNorth)
          haptic()
        }}
        className="mt-4 flex h-12 w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-left transition-colors hover:bg-white/[0.07]"
      >
        <span>
          <span className="block text-sm font-semibold text-zinc-100">Use true north</span>
          <span className="block text-[11px] text-zinc-500">(declination ignored)</span>
        </span>
        <ToggleVisual on={trueNorth} />
      </button>

      <p className="mt-3 text-center text-[11px] leading-relaxed text-zinc-600">
        Browsers don&apos;t expose magnetic-field strength. On Android the
        absolute-orientation event is preferred; otherwise heading = 360° − alpha.
      </p>
    </div>
  )
}

/* ================================================================== */
/* Level readout                                                       */
/* ================================================================== */

function TiltReadout({
  value,
  showNumbers,
  axis,
}: {
  value: MotionValue<number>
  showNumbers: boolean
  axis: 'X' | 'Y'
}) {
  const [last, setLast] = useState<number | null>(null)
  useMotionValueEvent(value, 'change', (v) => {
    setLast((p) => (p === v ? p : v))
  })
  const txt =
    !showNumbers || last === null
      ? '--'
      : `${last > 0 ? '+' : last < 0 ? '−' : ''}${Math.abs(last).toFixed(1)}°`
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-center">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
        Tilt {axis}
      </div>
      <div className="mt-0.5 text-lg font-bold tabular-nums text-zinc-100">{txt}</div>
    </div>
  )
}

/* ================================================================== */
/* Level tab                                                           */
/* ================================================================== */

function LevelTab({
  status,
  tiltX,
  tiltY,
  bubbleX,
  bubbleY,
  flat,
  showNumbers,
  hapticsOn,
  onHaptics,
  onEnable,
  onTilt,
  maxPxRef,
  onMetrics,
}: {
  status: SensorStatus
  tiltX: MotionValue<number>
  tiltY: MotionValue<number>
  bubbleX: MotionValue<number>
  bubbleY: MotionValue<number>
  flat: boolean
  showNumbers: boolean
  hapticsOn: boolean
  onHaptics: (v: boolean) => void
  onEnable: () => void
  /** maps tilt (deg) → bubble position + flat state (sensor + drag share it) */
  onTilt: (tx: number, ty: number, fromDrag: boolean) => void
  maxPxRef: MutableRefObject<number>
  onMetrics: () => void
}) {
  const discRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; rect: DOMRect } | null>(null)
  const manual = status !== 'live'

  /* keep the bubble travel radius in sync with the disc size */
  useEffect(() => {
    const el = discRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width
      maxPxRef.current = Math.max(12, w / 2 - 22)
      onMetrics()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxPxRef, onMetrics])

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!manual) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, rect: e.currentTarget.getBoundingClientRect() }
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const cx = d.rect.left + d.rect.width / 2
    const cy = d.rect.top + d.rect.height / 2
    let nx = (e.clientX - cx) / maxPxRef.current
    let ny = (e.clientY - cy) / maxPxRef.current
    const len = Math.hypot(nx, ny)
    if (len > 1) {
      nx /= len
      ny /= len
    }
    // inverse of the sensor mapping: bubble position → tilt
    onTilt(-nx * MAX_TILT, ny * MAX_TILT, true)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null
  }

  return (
    <div>
      {/* bullseye */}
      <div className="relative mx-auto">
        <div
          className={cn(
            'pointer-events-none absolute -inset-5 rounded-full blur-2xl transition-colors duration-500',
            flat ? 'bg-emerald-500/20' : 'bg-teal-500/10',
          )}
          aria-hidden
        />
        <div
          ref={discRef}
          role={manual ? 'slider' : undefined}
          aria-label={manual ? 'Bubble level — drag the bubble' : undefined}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onLostPointerCapture={onUp}
          className={cn(
            'relative mx-auto aspect-square w-[min(68vw,250px)] touch-none rounded-full',
            'border border-white/10 bg-white/[0.03]',
            'shadow-[0_30px_60px_-25px_rgb(0_0_0/0.85),inset_0_2px_18px_rgb(0_0_0/0.45)]',
            manual && 'cursor-grab active:cursor-grabbing',
          )}
        >
          {/* static crosshair + target rings */}
          <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
            <line x1={50} y1={2} x2={50} y2={98} stroke="rgb(255 255 255 / 0.07)" strokeWidth={0.6} />
            <line x1={2} y1={50} x2={98} y2={50} stroke="rgb(255 255 255 / 0.07)" strokeWidth={0.6} />
            <circle cx={50} cy={50} r={31} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth={0.6} strokeDasharray="2 3" />
            <circle
              cx={50} cy={50} r={13}
              fill="none"
              stroke={flat ? 'rgb(52 211 153 / 0.55)' : 'rgb(255 255 255 / 0.14)'}
              strokeWidth={flat ? 1.2 : 0.8}
            />
          </svg>

          {/* bubble */}
          <motion.div
            className="absolute left-1/2 top-1/2 z-10"
            style={{ x: bubbleX, y: bubbleY }}
          >
            <motion.div
              animate={{ scale: flat ? 1.14 : 1 }}
              transition={SPRING}
              className={cn(
                'relative size-8 -translate-x-1/2 -translate-y-1/2 rounded-full',
                'bg-gradient-to-br from-teal-200 via-emerald-400 to-teal-600',
                'ring-1 ring-white/50',
                flat
                  ? 'shadow-[0_0_22px_-2px_rgb(52_211_153/0.9)]'
                  : 'shadow-[0_6px_16px_-4px_rgb(0_0_0/0.6),0_0_10px_-2px_rgb(20_184_166/0.5)]',
              )}
            >
              <span
                className="absolute left-[22%] top-[16%] size-2 rounded-full bg-white/70 blur-[1px]"
                aria-hidden
              />
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* flat pill */}
      <div className="mt-4 flex justify-center">
        {flat ? (
          <StatusChip tone="live">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
            </span>
            Flat — within {FLAT_DEG}°
          </StatusChip>
        ) : showNumbers ? (
          <StatusChip tone="muted">Tilted</StatusChip>
        ) : (
          <StatusChip tone="muted">Waiting for sensor…</StatusChip>
        )}
      </div>

      {/* readouts */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <TiltReadout value={tiltX} showNumbers={showNumbers} axis="X" />
        <TiltReadout value={tiltY} showNumbers={showNumbers} axis="Y" />
      </div>

      {status === 'needs-permission' && (
        <div className="mt-4">
          <EnableButton
            label="Enable level"
            onClick={onEnable}
            icon={<Ruler className="size-4" aria-hidden />}
          />
          <p className="mt-2 text-center text-[11px] text-zinc-500">
            Your browser will ask for motion access.
          </p>
        </div>
      )}
      {status === 'denied' && (
        <div className="mt-4">
          <DeniedNote />
        </div>
      )}
      {status === 'demo' && !showNumbers && (
        <p className="mt-4 text-center text-[11px] text-zinc-500">
          Demo — no accelerometer. Drag the bubble to feel the mechanic.
        </p>
      )}

      {/* haptic-on-flat row */}
      <button
        type="button"
        role="switch"
        aria-checked={hapticsOn}
        onClick={() => {
          onHaptics(!hapticsOn)
          haptic()
        }}
        className="mt-4 flex h-12 w-full items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-left transition-colors hover:bg-white/[0.07]"
      >
        <span className="flex items-center gap-2.5">
          <Vibrate className="size-4 text-emerald-300" aria-hidden />
          <span>
            <span className="block text-sm font-semibold text-zinc-100">
              Haptic tick when flat
            </span>
            <span className="block text-[11px] text-zinc-500">
              Buzz once as the bubble settles
            </span>
          </span>
        </span>
        <ToggleVisual on={hapticsOn} />
      </button>
    </div>
  )
}

/* ================================================================== */
/* App shell                                                           */
/* ================================================================== */

const TABS = [
  { id: 'compass', label: 'Compass', icon: Compass },
  { id: 'level', label: 'Level', icon: Ruler },
] as const

type TabId = (typeof TABS)[number]['id']

export default function CompassApp() {
  const { toast } = useToast()

  const [tab, setTab] = useState<TabId>('compass')
  const [compassStatus, setCompassStatus] = useState<SensorStatus>(() => {
    const DOR = orientationCtor()
    if (!DOR) return 'demo'
    return typeof DOR.requestPermission === 'function' ? 'needs-permission' : 'idle'
  })
  const [levelStatus, setLevelStatus] = useState<SensorStatus>(() => {
    const DMR = motionCtor()
    if (!DMR) return 'demo'
    return typeof DMR.requestPermission === 'function' ? 'needs-permission' : 'idle'
  })
  const [trueNorth, setTrueNorth] = useState(() => readPref('trueNorth', true))
  const [hapticsOn, setHapticsOn] = useState(() => readPref('hapticsOn', true))
  const [flat, setFlat] = useState(false)
  const [demoTouched, setDemoTouched] = useState(false)

  /* alive flag — guards every async setState */
  const aliveRef = useRef(false)
  const toastedRef = useRef<Record<string, boolean>>({})

  /* heading — continuous (unbounded) so the spring never unwinds 359→0 */
  const headingMV = useMotionValue(0)
  const headingSpring = useSpring(headingMV, DIAL_SPRING)
  const dialRotate = useTransform(headingSpring, (v) => -v)
  const contHeadingRef = useRef(0)
  const last15Ref = useRef(0)

  /* tilt + bubble motion values (bubble rendered through a spring) */
  const tiltX = useMotionValue(0)
  const tiltY = useMotionValue(0)
  const bubbleRawX = useMotionValue(0)
  const bubbleRawY = useMotionValue(0)
  const bubbleX = useSpring(bubbleRawX, BUBBLE_SPRING)
  const bubbleY = useSpring(bubbleRawY, BUBBLE_SPRING)
  const maxPxRef = useRef(100)
  const lastTiltRef = useRef({ tx: 0, ty: 0 })
  const flatRef = useRef(false)

  /* sensor bookkeeping */
  const gotOrientationRef = useRef(false)
  const gotMotionRef = useRef(false)
  const levelSourceRef = useRef<LevelSource>('none')
  const oriDemoTimer = useRef<number | null>(null)
  const motDemoTimer = useRef<number | null>(null)

  /* mirrors so stable listener closures always read fresh values */
  const compassStatusRef = useRef<SensorStatus>(compassStatus)
  const levelStatusRef = useRef<SensorStatus>(levelStatus)
  const trueNorthRef = useRef(trueNorth)
  const hapticsOnRef = useRef(hapticsOn)
  useEffect(() => {
    compassStatusRef.current = compassStatus
    levelStatusRef.current = levelStatus
    trueNorthRef.current = trueNorth
    hapticsOnRef.current = hapticsOn
  })

  const clearTimer = (ref: MutableRefObject<number | null>) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current)
      ref.current = null
    }
  }

  const toastOnce = useCallback(
    (key: string, title: string, description: string) => {
      if (toastedRef.current[key]) return
      toastedRef.current[key] = true
      toast({ title, description })
    },
    [toast],
  )

  /* ------------- tilt → bubble + flat state (sensor & drag share it) --- */
  const applyTilt = useCallback(
    (txRaw: number, tyRaw: number, fromDrag: boolean) => {
      const tx = clampNum(txRaw, -85, 85)
      const ty = clampNum(tyRaw, -85, 85)
      lastTiltRef.current = { tx, ty }
      tiltX.set(tx)
      tiltY.set(ty)

      // bubble heads for the HIGH side (X sign flips), Euclidean-clamped
      let nx = -tx / MAX_TILT
      let ny = ty / MAX_TILT
      const len = Math.hypot(nx, ny)
      if (len > 1) {
        nx /= len
        ny /= len
      }
      const m = maxPxRef.current
      bubbleRawX.set(nx * m)
      bubbleRawY.set(ny * m)

      const isFlat = Math.abs(tx) < FLAT_DEG && Math.abs(ty) < FLAT_DEG
      if (isFlat !== flatRef.current) {
        flatRef.current = isFlat
        if (aliveRef.current) {
          setFlat(isFlat)
          if (isFlat && hapticsOnRef.current) haptic(18)
        }
      }
      if (fromDrag && aliveRef.current) setDemoTouched(true)
    },
    [tiltX, tiltY, bubbleRawX, bubbleRawY],
  )

  const reapplyTilt = useCallback(() => {
    const { tx, ty } = lastTiltRef.current
    applyTilt(tx, ty, false)
  }, [applyTilt])

  /** manual demo steering — drag/keys rotate the rose, heading runs opposite */
  const onManualRotate = useCallback(
    (deltaDeg: number) => {
      contHeadingRef.current -= deltaDeg
      headingMV.set(contHeadingRef.current)
      const f15 = Math.floor(mod360(contHeadingRef.current) / 15)
      if (f15 !== last15Ref.current) {
        last15Ref.current = f15
        if (hapticsOnRef.current) haptic(4)
      }
    },
    [headingMV],
  )

  /* ---------------- orientation handler ----------------------------- */
  const onOrientation = useCallback(
    (evt: Event) => {
      if (!aliveRef.current) return
      const e = evt as DeviceOrientationEvent & { webkitCompassHeading?: number }
      const wk = e.webkitCompassHeading
      const hasWk = typeof wk === 'number' && Number.isFinite(wk)
      const hasAlpha = typeof e.alpha === 'number' && Number.isFinite(e.alpha)
      if (!hasWk && !hasAlpha) return // desktop null event — not a compass

      if (!gotOrientationRef.current) {
        gotOrientationRef.current = true
        clearTimer(oriDemoTimer)
      }
      if (compassStatusRef.current !== 'live') setCompassStatus('live')

      // iOS exposes true-north heading directly; elsewhere invert alpha
      // (alpha is counter-clockwise). Toggle-off prefers raw alpha.
      let h: number
      if (trueNorthRef.current && hasWk) h = wk
      else if (hasAlpha) h = 360 - (e.alpha as number)
      else h = wk as number

      const prev = contHeadingRef.current
      contHeadingRef.current = prev + wrap180(h - mod360(prev))
      headingMV.set(contHeadingRef.current)

      // bonus: if the motion API never delivers, derive level tilt from
      // beta/gamma (valid near-flat usage) — better than a dead level tab
      if (
        levelSourceRef.current !== 'motion' &&
        typeof e.beta === 'number' && Number.isFinite(e.beta) &&
        typeof e.gamma === 'number' && Number.isFinite(e.gamma)
      ) {
        levelSourceRef.current = 'orientation'
        clearTimer(motDemoTimer)
        if (levelStatusRef.current !== 'live') setLevelStatus('live')
        applyTilt(clampNum(e.gamma, -60, 60), clampNum(-e.beta, -60, 60), false)
      }
    },
    [headingMV, applyTilt],
  )

  /* ---------------- motion handler ----------------------------------- */
  const onMotion = useCallback(
    (e: DeviceMotionEvent) => {
      if (!aliveRef.current) return
      const a = e.accelerationIncludingGravity
      if (
        !a ||
        typeof a.x !== 'number' || Number.isNaN(a.x) ||
        typeof a.y !== 'number' || Number.isNaN(a.y) ||
        typeof a.z !== 'number' || Number.isNaN(a.z)
      )
        return

      if (!gotMotionRef.current) {
        gotMotionRef.current = true
        clearTimer(motDemoTimer)
      }
      levelSourceRef.current = 'motion' // motion data outranks beta/gamma
      if (levelStatusRef.current !== 'live') setLevelStatus('live')

      // tilt from gravity projection; some stacks report an inverted z
      // (face-up should give z > 0) — normalize by its sign
      const flip = a.z < 0 ? -1 : 1
      const ax = flip * a.x
      const ay = flip * a.y
      const az = flip * a.z
      applyTilt(toDeg(Math.atan2(ax, az)), toDeg(Math.atan2(ay, az)), false)
    },
    [applyTilt],
  )

  /* ---------------- attach / detach ---------------------------------- */
  const detachSensors = useCallback(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener(
      'deviceorientationabsolute',
      onOrientation as EventListener,
    )
    window.removeEventListener('deviceorientation', onOrientation)
    window.removeEventListener('devicemotion', onMotion)
  }, [onOrientation, onMotion])

  const attachOrientation = useCallback(() => {
    if (typeof window === 'undefined' || !orientationCtor()) return
    const supportsAbsolute = 'ondeviceorientationabsolute' in window
    if (supportsAbsolute) {
      window.addEventListener(
        'deviceorientationabsolute',
        onOrientation as EventListener,
      )
    } else {
      window.addEventListener('deviceorientation', onOrientation)
    }
    clearTimer(oriDemoTimer)
    oriDemoTimer.current = window.setTimeout(() => {
      if (!aliveRef.current || gotOrientationRef.current) return
      setCompassStatus('demo')
      toastOnce(
        'compass-demo',
        'No magnetometer found',
        'Drag the dial to steer it yourself.',
      )
    }, 1600)
  }, [onOrientation, toastOnce])

  const attachMotion = useCallback(() => {
    if (typeof window === 'undefined' || !motionCtor()) return
    window.addEventListener('devicemotion', onMotion)
    clearTimer(motDemoTimer)
    motDemoTimer.current = window.setTimeout(() => {
      if (!aliveRef.current || gotMotionRef.current) return
      if (levelStatusRef.current === 'live') return // orientation fallback won
      setLevelStatus('demo')
      toastOnce(
        'level-demo',
        'No accelerometer found',
        'Drag the bubble to try it.',
      )
    }, 1600)
  }, [onMotion, toastOnce])

  /* iOS 13+ — requestPermission MUST run inside the tap gesture */
  const enableCompass = useCallback(() => {
    const DOR = orientationCtor()
    if (!DOR) {
      setCompassStatus('demo')
      return
    }
    void (async () => {
      if (typeof DOR.requestPermission === 'function') {
        try {
          const res = await DOR.requestPermission()
          if (res !== 'granted') {
            if (aliveRef.current) setCompassStatus('denied')
            toastOnce(
              'compass-denied',
              'Compass access denied',
              'Allow motion & orientation access, then reload.',
            )
            return
          }
        } catch {
          if (aliveRef.current) setCompassStatus('denied')
          return
        }
      }
      if (aliveRef.current) setCompassStatus('idle')
      attachOrientation()
      haptic()
    })()
  }, [attachOrientation, toastOnce])

  const enableLevel = useCallback(() => {
    const DMR = motionCtor()
    if (!DMR) {
      setLevelStatus('demo')
      return
    }
    void (async () => {
      if (typeof DMR.requestPermission === 'function') {
        try {
          const res = await DMR.requestPermission()
          if (res !== 'granted') {
            if (aliveRef.current) setLevelStatus('denied')
            toastOnce(
              'level-denied',
              'Motion access denied',
              'Allow motion access, then reload.',
            )
            return
          }
        } catch {
          if (aliveRef.current) setLevelStatus('denied')
          return
        }
      }
      if (aliveRef.current) setLevelStatus('idle')
      attachMotion()
      haptic()
    })()
  }, [attachMotion, toastOnce])

  /* ---------------- mount: attach sensors (status decided at init) ---- */
  useEffect(() => {
    aliveRef.current = true

    if (compassStatusRef.current === 'idle') attachOrientation()
    if (levelStatusRef.current === 'idle') attachMotion()

    return () => {
      aliveRef.current = false
      detachSensors()
      clearTimer(oriDemoTimer)
      clearTimer(motDemoTimer)
    }
  }, [attachOrientation, attachMotion, detachSensors])

  /* persist prefs */
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ trueNorth, hapticsOn }))
    } catch {
      /* ignore */
    }
  }, [trueNorth, hapticsOn])

  const switchTab = (t: TabId) => {
    if (t === tab) return
    setTab(t)
    haptic()
  }

  const showLevelNumbers = levelStatus === 'live' || demoTouched

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={SPRING}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header + pill switcher ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-emerald-300/[0.10] via-transparent to-teal-500/[0.08] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-300 via-teal-500 to-teal-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(13_148_136/0.8),inset_0_1px_1px_rgb(255_255_255/0.35)]">
              <Compass className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Compass &amp; Level</h2>
              <p className="text-xs text-zinc-400">Find north, level up.</p>
            </div>
          </div>

          <div
            className="mt-5 flex rounded-2xl border border-white/10 bg-white/[0.04] p-1.5"
            role="tablist"
            aria-label="Compass & Level tools"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`compass-tab-${t.id}`}
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`compass-panel-${t.id}`}
                onClick={() => switchTab(t.id)}
                className={cn(
                  'relative flex h-11 flex-1 items-center justify-center rounded-xl text-sm font-bold transition-colors',
                  tab === t.id ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                {tab === t.id && (
                  <motion.span
                    layoutId="compass-tab-pill"
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

        {/* ------- Panels (kept mounted so sensor state survives tab switches) ------- */}
        <div className="p-4 sm:p-5">
          {TABS.map((t) => (
            <motion.div
              key={t.id}
              id={`compass-panel-${t.id}`}
              role="tabpanel"
              aria-labelledby={`compass-tab-${t.id}`}
              initial={false}
              animate={{ opacity: tab === t.id ? 1 : 0, y: tab === t.id ? 0 : 10 }}
              transition={SPRING}
              className={cn(tab !== t.id && 'hidden')}
            >
              {t.id === 'compass' && (
                <CompassTab
                  status={compassStatus}
                  headingSpring={headingSpring}
                  dialRotate={dialRotate}
                  onManualRotate={onManualRotate}
                  trueNorth={trueNorth}
                  onTrueNorth={setTrueNorth}
                  onEnable={enableCompass}
                />
              )}
              {t.id === 'level' && (
                <LevelTab
                  status={levelStatus}
                  tiltX={tiltX}
                  tiltY={tiltY}
                  bubbleX={bubbleX}
                  bubbleY={bubbleY}
                  flat={flat}
                  showNumbers={showLevelNumbers}
                  hapticsOn={hapticsOn}
                  onHaptics={setHapticsOn}
                  onEnable={enableLevel}
                  onTilt={applyTilt}
                  maxPxRef={maxPxRef}
                  onMetrics={reapplyTilt}
                />
              )}
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
