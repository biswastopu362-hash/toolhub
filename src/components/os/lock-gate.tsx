'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Delete, ShieldCheck, X } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { getToolById } from '@/lib/tools/registry'
import { useAppStore } from '@/lib/store/app-store'
import { hashPin } from '@/lib/pin-hash'
import { cn } from '@/lib/utils'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const

/**
 * Full-screen PIN gate (D9 App Lock). Shown instead of the app whenever the
 * user opens a locked app. Unlocks with the 4-digit PIN or a "forgot" wipe.
 */
export function LockGate({
  appId,
  onUnlock,
  onCancel,
}: {
  appId: string
  onUnlock: () => void
  onCancel: () => void
}) {
  const { toast } = useToast()
  const tool = getToolById(appId)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(false)
  const busy = useRef(false)

  const appLock = useAppStore((s) => s.appLock)

  /* verify the 4th digit — async, event-driven (no setState-in-effect) */
  const verify = (code: string) => {
    busy.current = true
    setChecking(true)
    void (async () => {
      const hash = await hashPin(code)
      if (hash === appLock?.pinHash) {
        try {
          navigator.vibrate?.(16)
        } catch {}
        onUnlock()
        return
      }
      try {
        navigator.vibrate?.([40, 60, 40])
      } catch {}
      setError(true)
      setChecking(false)
      busy.current = false
      setTimeout(() => {
        setPin('')
        setError(false)
      }, 550)
    })()
  }

  const push = (k: string) => {
    if (busy.current) return
    setError(false)
    const next = pin.length >= 4 ? pin : pin + k
    setPin(next)
    if (next.length === 4) verify(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (/^[0-9]$/.test(e.key)) push(e.key)
      if (e.key === 'Backspace') setPin((p) => p.slice(0, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const forgot = () => {
    if (confirm('Remove App Lock? Your apps and their data stay untouched.')) {
      useAppStore.getState().setAppLock(null)
      toast({ title: 'App Lock removed', description: 'You can set it up again anytime in Settings.' })
      onCancel()
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-zinc-950/80 px-6 backdrop-blur-2xl"
      role="dialog"
      aria-label={`${tool?.name ?? 'App'} is locked`}
    >
      <button
        onClick={onCancel}
        aria-label="Cancel"
        className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] grid size-11 place-items-center rounded-full bg-white/10 text-white/80 transition hover:bg-white/20 active:scale-90"
      >
        <X className="h-5 w-5" />
      </button>

      <motion.span
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 26 }}
        style={{ '--glow': tool?.glow } as React.CSSProperties}
        className={cn(
          'flex size-16 items-center justify-center rounded-[1.2rem] bg-gradient-to-br text-white ring-1 ring-white/20',
          'shadow-[0_12px_30px_-10px_var(--glow),inset_0_1px_1px_rgb(255_255_255/0.4)]',
          tool?.gradient
        )}
      >
        {tool ? <tool.icon className="h-7 w-7" aria-hidden /> : <ShieldCheck className="h-7 w-7" aria-hidden />}
      </motion.span>

      <h1 className="mt-4 text-lg font-bold text-white">{tool?.name ?? 'App'} is locked</h1>
      <p className="mt-1 text-sm text-white/60">Enter your 4-digit PIN to continue</p>

      {/* PIN dots */}
      <motion.div
        animate={error ? { x: [0, -10, 10, -6, 6, 0] } : { x: 0 }}
        transition={{ duration: 0.4 }}
        className="mt-6 flex items-center gap-4"
        aria-label={checking ? 'Checking PIN' : `${pin.length} of 4 digits entered`}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'size-3.5 rounded-full ring-1 transition-all duration-150',
              error
                ? 'bg-rose-400 ring-rose-300/60'
                : i < pin.length
                  ? 'scale-110 bg-emerald-300 ring-emerald-200/60'
                  : 'bg-white/10 ring-white/25'
            )}
          />
        ))}
      </motion.div>

      {/* keypad */}
      <div className="mt-8 grid w-full max-w-[264px] grid-cols-3 gap-3">
        {KEYS.map((k, i) =>
          k === '' ? (
            <span key={i} aria-hidden />
          ) : k === 'del' ? (
            <button
              key={i}
              onClick={() => setPin((p) => p.slice(0, -1))}
              aria-label="Delete last digit"
              className="grid h-16 place-items-center rounded-2xl text-white/70 transition hover:bg-white/10 active:scale-90"
            >
              <Delete className="h-5.5 w-5.5" />
            </button>
          ) : (
            <button
              key={i}
              onClick={() => push(k)}
              aria-label={`Digit ${k}`}
              className="grid h-16 select-none place-items-center rounded-2xl bg-white/[0.08] text-xl font-semibold text-white ring-1 ring-white/10 transition hover:bg-white/[0.16] active:scale-90"
            >
              {k}
            </button>
          )
        )}
      </div>

      <button
        onClick={forgot}
        className="mt-6 rounded-full px-4 py-2 text-xs font-medium text-white/50 transition hover:bg-white/10 hover:text-white/80"
      >
        Forgot PIN?
      </button>
    </motion.div>
  )
}
