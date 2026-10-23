'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Globe, Loader2, RotateCw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useExternalApps } from '@/lib/tools/external'

/**
 * Window body for a Linked Platform. Renders the external site in an
 * iframe, edge to edge, with a slim context bar (host, reload, open).
 *
 * Some sites refuse embedding (X-Frame-Options / CSP frame-ancestors).
 * We can't reliably detect that cross-origin, so after a grace period a
 * gentle hint appears and the "Open" button in the bar always offers a
 * real new-tab escape hatch.
 */

interface FrameRef {
  url: string
  key: number
}

export default function ExternalAppView() {
  const [hash] = useHashRoute()
  const apps = useExternalApps((s) => s.apps)

  const appId = useMemo(() => {
    if (hash.startsWith('#/app/')) return decodeURIComponent(hash.replace('#/app/', ''))
    if (hash.startsWith('#/tool/')) return decodeURIComponent(hash.replace('#/tool/', ''))
    return null
  }, [hash])

  const app = useMemo(() => apps.find((a) => a.id === appId) ?? null, [apps, appId])
  const url = app?.url ?? ''

  /* which frame has fired load / gone slow — derived per (url, key) */
  const [loadedFrame, setLoadedFrame] = useState<FrameRef | null>(null)
  const [slowFrame, setSlowFrame] = useState<FrameRef | null>(null)
  const [frameKey, setFrameKey] = useState(0)

  useEffect(() => {
    if (!url) return
    const t = setTimeout(() => setSlowFrame({ url, key: frameKey }), 6000)
    return () => clearTimeout(t)
  }, [url, frameKey])

  const loaded = Boolean(loadedFrame && loadedFrame.url === url && loadedFrame.key === frameKey)
  const slow = Boolean(slowFrame && slowFrame.url === url && slowFrame.key === frameKey) && !loaded

  const host = useMemo(() => {
    try {
      return new URL(url).hostname
    } catch {
      return url
    }
  }, [url])

  if (!app || !url) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <Globe className="size-7" aria-hidden />
        </span>
        <p className="text-sm font-semibold">This linked platform is no longer available</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          The owner may have removed it from the hub. Check the App Store for updates.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* context bar */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-muted/40 px-3">
        <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={url}>
          {host}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-full"
          onClick={() => setFrameKey((k) => k + 1)}
          aria-label="Reload platform"
        >
          <RotateCw className="size-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs"
          onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
        >
          <ArrowUpRight className="size-3.5" aria-hidden />
          Open
        </Button>
      </div>

      {/* embedded platform */}
      <div className="relative flex-1 bg-white">
        <iframe
          key={frameKey}
          src={url}
          title={app.name}
          onLoad={() => setLoadedFrame({ url, key: frameKey })}
          referrerPolicy="strict-origin-when-cross-origin"
          allow="camera; microphone; geolocation; fullscreen; clipboard-read; clipboard-write; encrypted-media; autoplay"
          className="absolute inset-0 h-full w-full border-0"
        />

        {!loaded && !slow && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/60">
            <div className="flex items-center gap-2.5 rounded-full bg-card px-4 py-2 shadow-lg ring-1 ring-black/5">
              <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
              <span className="text-xs font-medium text-muted-foreground">
                Opening {app.name}…
              </span>
            </div>
          </div>
        )}

        {slow && (
          <div className="absolute inset-x-3 bottom-3 flex items-start gap-3 rounded-2xl border border-border/70 bg-card/95 p-3.5 shadow-xl backdrop-blur">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600">
              <TriangleAlert className="size-4.5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">Page hasn&apos;t loaded yet</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                Some sites block embedding for security. If this stays blank, open {app.name} in
                a new tab — it works exactly the same.
              </p>
            </div>
            <Button
              size="sm"
              className="h-8 shrink-0 gap-1 rounded-full px-3 text-xs"
              onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
            >
              <ArrowUpRight className="size-3.5" aria-hidden />
              Open
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
