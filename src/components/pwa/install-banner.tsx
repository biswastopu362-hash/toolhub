'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Download,
  Menu,
  PlusSquare,
  Share,
  Smartphone,
  X,
} from 'lucide-react'

/**
 * One-tap PWA install banner for the home screen.
 *
 * - Chromium (Android/desktop): captures `beforeinstallprompt` and triggers
 *   the NATIVE install dialog on tap — app icon appears on the home screen
 *   / desktop after confirming.
 * - iOS Safari: Apple never fires the event, so it shows a tiny two-step
 *   "Share → Add to Home Screen" guide instead.
 * - Other browsers: points at the browser menu's install entry.
 * - Hidden when already installed (standalone display), dismissed, or while
 *   the home screen is in edit mode.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Mode = 'hidden' | 'native' | 'ios' | 'manual'

const DISMISS_KEY = 'toolhub-install-banner-dismissed'

function isIosDevice(): boolean {
  const ua = navigator.userAgent
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  )
}

function alreadyStandalone(): boolean {
  const iosStandalone =
    (navigator as unknown as { standalone?: boolean }).standalone === true
  return (
    window.matchMedia('(display-mode: standalone)').matches || iosStandalone
  )
}

export function InstallBanner({
  suppressed = false,
  onVisibleChange,
}: {
  suppressed?: boolean
  onVisibleChange?: (visible: boolean) => void
}) {
  const [mode, setMode] = useState<Mode>('hidden')
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (alreadyStandalone()) return

    let dismissed = false
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === '1'
    } catch {
      /* private mode — banner simply shows */
    }
    if (dismissed) return

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
      setMode('native')
    }
    const onInstalled = () => {
      setDeferred(null)
      setMode('hidden')
    }

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    if (isIosDevice()) {
      setMode('ios')
    } else {
      // Chromium fires beforeinstallprompt within moments of load; any browser
      // that hasn't after this grace period gets the manual-menu hint instead.
      const t = setTimeout(() => {
        setMode((m) => (m === 'hidden' ? 'manual' : m))
      }, 2500)
      return () => {
        window.removeEventListener('beforeinstallprompt', onPrompt)
        window.removeEventListener('appinstalled', onInstalled)
        clearTimeout(t)
      }
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = useCallback(() => {
    setMode('hidden')
    try {
      localStorage.setItem(DISMISS_KEY, '1')
    } catch {
      /* ignore */
    }
  }, [])

  const install = useCallback(async () => {
    if (!deferred || busy) return
    setBusy(true)
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (choice.outcome === 'accepted') {
        try {
          navigator.vibrate?.(20)
        } catch {}
        setMode('hidden')
      }
    } catch {
      /* user or browser cancelled — keep the banner */
    } finally {
      setDeferred(null)
      setBusy(false)
    }
  }, [deferred, busy])

  const visible = !suppressed && mode !== 'hidden'

  /* Let the home screen push the icon grid down while the hint is up */
  useEffect(() => {
    onVisibleChange?.(visible)
  }, [visible, onVisibleChange, mode])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -28, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -28, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="pointer-events-none absolute inset-x-0 top-[max(3.6rem,calc(env(safe-area-inset-top)+3.1rem))] z-30 flex justify-center px-4"
        >
          {mode === 'native' && (
            <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-white/25 bg-black/50 py-1.5 pl-3.5 pr-1.5 text-white shadow-2xl backdrop-blur-xl">
              <Smartphone className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
              <span className="truncate text-xs font-medium">
                Add ToolHub to your home screen
              </span>
              <button
                onClick={install}
                disabled={busy}
                className="ml-1 flex h-7 shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 px-3 text-xs font-semibold text-emerald-950 shadow transition-transform active:scale-95 disabled:opacity-60"
                aria-label="Install ToolHub on this device"
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                Install
              </button>
              <button
                onClick={dismiss}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Dismiss install suggestion"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )}

          {mode === 'ios' && (
            <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-white/25 bg-black/55 text-white shadow-2xl backdrop-blur-xl">
              <div className="flex items-start gap-3 p-3.5">
                <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">Install ToolHub on your iPhone</p>
                  {expanded ? (
                    <ol className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-white/85">
                      <li className="flex items-center gap-1.5">
                        <Share className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
                        Tap the <span className="font-semibold">Share</span> button in Safari
                      </li>
                      <li className="flex items-center gap-1.5">
                        <PlusSquare className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
                        Choose <span className="font-semibold">Add to Home Screen</span>
                      </li>
                    </ol>
                  ) : (
                    <p className="mt-0.5 text-[11px] text-white/75">
                      Two taps, just like a real app.
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => setExpanded((v) => !v)}
                    className="flex h-7 items-center rounded-full bg-white/12 px-3 text-xs font-semibold transition-colors hover:bg-white/20"
                    aria-expanded={expanded}
                  >
                    {expanded ? 'Hide' : 'How'}
                  </button>
                  <button
                    onClick={dismiss}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label="Dismiss install guide"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          )}

          {mode === 'manual' && (
            <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-white/25 bg-black/50 py-1.5 pl-3.5 pr-1.5 text-white shadow-2xl backdrop-blur-xl">
              <Menu className="h-3.5 w-3.5 shrink-0 text-emerald-300" aria-hidden />
              <span className="truncate text-xs font-medium text-white/90">
                Browser menu → <span className="font-semibold text-white">Install App</span>
              </span>
              <button
                onClick={dismiss}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Dismiss install suggestion"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
