'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Home,
  Search,
  Smartphone,
  Sparkles,
  StickyNote,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLang } from '@/hooks/use-lang'
import { localizeDigits } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { tools } from '@/lib/tools/registry'

/**
 * D85 Onboarding — first-run welcome tour.
 *
 * Shows once per device (localStorage flag) after the launcher settles:
 *   1. Welcome          — what ToolHub is, privacy promise
 *   2. Home screen      — drag, folders, quick actions
 *   3. Search & widgets — Spotlight math/units/notes, widgets, notifications
 *   4. Finish           — Add-to-Home-Screen coach + optional sample data
 *
 * Sample data seeds two notes + one reminder (opt-in, once) so the widgets
 * and notification feed feel alive from minute one.
 */

const ONBOARDED_KEY = 'toolhub-onboarded'
const SAMPLE_KEY = 'toolhub-sample-seeded'

type A2hs = 'ios' | 'android' | 'desktop'

interface StepDef {
  icon: LucideIcon
  gradient: string
  glow: string
}

const STEPS: StepDef[] = [
  { icon: Wrench, gradient: 'from-emerald-400 via-teal-500 to-cyan-600', glow: '14,165,233' },
  { icon: Home, gradient: 'from-violet-400 via-purple-500 to-fuchsia-600', glow: '168,85,247' },
  { icon: Search, gradient: 'from-amber-300 via-orange-400 to-orange-600', glow: '249,115,22' },
  { icon: Smartphone, gradient: 'from-sky-300 via-sky-400 to-blue-500', glow: '56,189,248' },
]

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export default function Onboarding() {
  const { t, lang } = useLang()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [seeded, setSeeded] = useState(false)
  const [a2hs, setA2hs] = useState<A2hs>('desktop')

  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDED_KEY)) return
    } catch {
      return
    }
    /* Detect platform + open inside the timer — never setState directly in
     * the effect body (and the launcher gets a beat to settle first). */
    const timer = setTimeout(() => {
      const ua = navigator.userAgent
      setA2hs(/iphone|ipad|ipod/i.test(ua) ? 'ios' : /android/i.test(ua) ? 'android' : 'desktop')
      setOpen(true)
    }, 700)
    return () => clearTimeout(timer)
  }, [])

  const finish = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDED_KEY, new Date().toISOString())
    } catch {
      /* private mode — tour simply reappears next launch */
    }
    setOpen(false)
  }, [])

  const seedSampleData = useCallback(() => {
    try {
      const now = Date.now()
      if (!localStorage.getItem(SAMPLE_KEY)) {
        const rawNotes = localStorage.getItem('toolhub-notes')
        const notes = rawNotes ? (JSON.parse(rawNotes) as unknown[]) : []
        if (Array.isArray(notes)) {
          notes.push(
            {
              id: makeId('note'),
              title: 'Welcome to Notes 🎉',
              body: 'This sample note lives only on your device. Tap + to write your own — everything stays private, works offline.',
              createdAt: now,
              updatedAt: now,
              folderId: null,
              pinned: true,
              colorId: 'emerald',
            },
            {
              id: makeId('note'),
              title: 'Try Spotlight',
              body: 'Open search and type "12*8+4" for instant math, "5km to mi" for units, or "note: buy milk" to jot a note from anywhere.',
              createdAt: now - 60_000,
              updatedAt: now - 60_000,
              folderId: null,
              pinned: false,
              colorId: 'sky',
            }
          )
          localStorage.setItem('toolhub-notes', JSON.stringify(notes))
        }
        const rawRems = localStorage.getItem('toolhub-reminders')
        const rems = rawRems ? (JSON.parse(rawRems) as unknown[]) : []
        if (Array.isArray(rems)) {
          rems.push({
            id: makeId('rem'),
            text: 'Explore one new ToolHub app today ✨',
            done: false,
            createdAt: now,
          })
          localStorage.setItem('toolhub-reminders', JSON.stringify(rems))
        }
        localStorage.setItem(SAMPLE_KEY, '1')
      }
      setSeeded(true)
    } catch {
      setSeeded(true)
    }
  }, [])

  const last = step === STEPS.length - 1
  const StepIcon = STEPS[step].icon

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="onboarding"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-black/55 p-4 backdrop-blur-md sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={t('obWelcomeTitle')}
        >
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="w-full max-w-md overflow-hidden rounded-[2rem] border border-white/15 bg-background/95 shadow-2xl"
          >
            {/* step canvas */}
            <div
              className={cn(
                'relative flex flex-col items-center gap-4 bg-gradient-to-br px-6 pb-8 pt-9 text-center text-white',
                STEPS[step].gradient
              )}
            >
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" aria-hidden />
              <motion.span
                key={step}
                initial={{ scale: 0.6, opacity: 0, rotate: -8 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                className="relative grid size-20 place-items-center rounded-[1.6rem] bg-white/20 ring-1 ring-white/40 backdrop-blur"
              >
                <StepIcon className="size-10" strokeWidth={1.7} aria-hidden />
              </motion.span>
              <div className="relative min-h-28 space-y-2">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={step}
                    initial={{ opacity: 0, x: 26 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -26 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className="space-y-2"
                  >
                    <h2 className="text-xl font-extrabold tracking-tight drop-shadow-sm">
                      {step === 0 && t('obWelcomeTitle')}
                      {step === 1 && t('obHomeTitle')}
                      {step === 2 && t('obSmartTitle')}
                      {step === 3 && t('obFinishTitle')}
                    </h2>
                    <p className="mx-auto max-w-xs text-sm leading-relaxed text-white/90">
                      {step === 0 && t('obWelcomeBody')}
                      {step === 1 && t('obHomeBody')}
                      {step === 2 && t('obSmartBody')}
                      {step === 3 && t('obFinishBody')}
                    </p>
                  </motion.div>
                </AnimatePresence>
              </div>

              {step === 0 && (
                <div className="relative flex flex-wrap items-center justify-center gap-1.5">
                  {[t('obChipApps').replace('{n}', localizeDigits(String(tools.length), lang)), t('obChipOffline'), t('obChipPrivate')].map((chip) => (
                    <span
                      key={chip}
                      className="rounded-full bg-white/20 px-3 py-1 text-[11px] font-bold ring-1 ring-white/30"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* step 4 extras: A2HS coach + sample data */}
            {step === 3 && (
              <div className="space-y-2.5 border-b border-border/70 bg-muted/40 px-5 py-4">
                <p className="flex items-start gap-2.5 text-xs leading-snug text-muted-foreground">
                  <Smartphone className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {a2hs === 'ios'
                    ? t('obA2hsIos')
                    : a2hs === 'android'
                      ? t('obA2hsAndroid')
                      : t('obA2hsDesktop')}
                </p>
                <button
                  type="button"
                  onClick={seedSampleData}
                  disabled={seeded}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition',
                    seeded
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-border bg-card hover:bg-muted/60'
                  )}
                >
                  <span
                    className={cn(
                      'grid size-9 shrink-0 place-items-center rounded-xl',
                      seeded ? 'bg-emerald-500 text-white' : 'bg-primary/10 text-primary'
                    )}
                  >
                    {seeded ? <Check className="size-4.5" aria-hidden /> : <StickyNote className="size-4.5" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      {seeded ? t('obSeeded') : t('obSeed')}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">{t('obSeedDesc')}</span>
                  </span>
                </button>
              </div>
            )}

            {/* controls */}
            <div className="flex items-center justify-between gap-2 px-5 py-4">
              <Button variant="ghost" className="h-10 rounded-full px-4 text-sm" onClick={finish}>
                {t('obSkip')}
              </Button>
              <div className="flex items-center gap-1.5" aria-hidden>
                {STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1.5 rounded-full transition-all',
                      i === step ? 'w-5 bg-primary' : 'w-1.5 bg-muted-foreground/30'
                    )}
                  />
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                {step > 0 && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-10 rounded-full"
                    onClick={() => setStep((s) => Math.max(0, s - 1))}
                    aria-label={t('obBack')}
                  >
                    <ChevronLeft className="size-5" />
                  </Button>
                )}
                <Button
                  className="h-10 gap-1 rounded-full px-5 text-sm font-semibold"
                  onClick={() => (last ? finish() : setStep((s) => s + 1))}
                >
                  {last ? (
                    <>
                      <Sparkles className="size-4" aria-hidden /> {t('obStart')}
                    </>
                  ) : (
                    <>
                      {t('obNext')} <ChevronRight className="size-4" aria-hidden />
                    </>
                  )}
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
