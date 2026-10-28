'use client'

import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BellOff, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getToolById, tools } from '@/lib/tools/registry'
import { cn } from '@/lib/utils'
import {
  buildLiveFeed,
  clearOsNotifications,
  markAllRead,
  type OsNotification,
} from '@/lib/os/notifications'

/* ================================================================== */
/* Notification Shade (D73) — iOS-style drop-down panel fed by local   */
/* app data (calendar events, open reminders) plus persistent OS       */
/* notifications. Tapping an item opens its source app.                */
/* ================================================================== */

function relTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function NotificationShade({
  onOpenApp,
  onClose,
}: {
  onOpenApp: (id: string, el?: HTMLElement | null) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<OsNotification[]>(() =>
    typeof window === 'undefined' ? [] : buildLiveFeed()
  )

  useEffect(() => {
    markAllRead()
  }, [])

  const refresh = () => setItems(buildLiveFeed())

  const grouped = useMemo(() => items.slice(0, 40), [items])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="absolute inset-0 z-40 bg-black/35 backdrop-blur-xl"
      onClick={onClose}
      role="dialog"
      aria-label="Notification Center"
    >
      <motion.div
        initial={{ y: '-100%' }}
        animate={{ y: 0 }}
        exit={{ y: '-100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="mx-auto mt-[max(0.75rem,env(safe-area-inset-top))] w-[min(100%-1.5rem,30rem)] overflow-hidden rounded-[1.75rem] bg-zinc-900/85 ring-1 ring-white/15 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
          <h2 className="text-sm font-bold text-white">Notification Center</h2>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                clearOsNotifications()
                refresh()
              }}
              aria-label="Clear notifications"
              className="size-8 rounded-full text-white/70 hover:bg-white/15 hover:text-white"
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              aria-label="Close notifications"
              className="size-8 rounded-full text-white/70 hover:bg-white/15 hover:text-white"
            >
              ✕
            </Button>
          </div>
        </div>

        <div className="no-scrollbar max-h-[62vh] space-y-2 overflow-y-auto px-3 pb-4 pt-1">
          {grouped.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-white/60">
              <BellOff className="size-8" aria-hidden />
              <p className="text-sm font-medium">No notifications</p>
              <p className="text-[11px] text-white/40">
                Calendar events and open reminders will appear here.
              </p>
            </div>
          ) : (
            grouped.map((n) => {
              const app = getToolById(n.appId) ?? tools.find((t) => t.id === 'store')
              return (
                <motion.button
                  key={n.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.16 }}
                  onClick={(e) => {
                    onClose()
                    onOpenApp(n.appId, e.currentTarget)
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-2xl bg-white/[0.08] p-3 text-left ring-1 ring-white/10 transition-colors hover:bg-white/[0.14] active:bg-white/20'
                  )}
                  aria-label={`${n.title} — open ${app?.name ?? 'app'}`}
                >
                  {app && (
                    <span
                      className={cn(
                        'flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white ring-1 ring-white/20',
                        app.gradient
                      )}
                    >
                      <app.icon className="size-[18px]" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-semibold text-white">{n.title}</span>
                      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-white/40">
                        {relTime(n.ts)}
                      </span>
                    </span>
                    {n.body && (
                      <span className="mt-0.5 line-clamp-2 block text-xs text-white/60">{n.body}</span>
                    )}
                  </span>
                </motion.button>
              )
            })
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
