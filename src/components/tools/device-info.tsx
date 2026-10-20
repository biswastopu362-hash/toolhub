'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BatteryCharging,
  BatteryFull,
  Cpu,
  Gauge,
  MonitorSmartphone,
  RefreshCw,
  ShieldCheck,
  Wifi,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

/* ================================================================== */
/* Types & readers                                                     */
/* ================================================================== */

interface InfoRow {
  label: string
  /** null → render a "Not available" badge */
  value: string | null
  /** badge text for missing values (defaults to "Not available") */
  badge?: string
}

interface BatteryState {
  level: number
  charging: boolean
}

interface ConnState {
  effectiveType: string | null
  downlink: number | null
  rtt: number | null
  saveData: boolean | null
}

type ExtendedNavigator = Navigator & {
  userAgentData?: { platform?: string }
  deviceMemory?: number
  connection?: EventTarget & { effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean }
  getBattery?: () => Promise<EventTarget & { level: number; charging: boolean }>
}

function parseOS(ua: string): string {
  if (/Windows NT|Windows Phone/i.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS'
  if (/Android/i.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/CrOS/i.test(ua)) return 'ChromeOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Unknown'
}

function parseBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return 'Edge'
  if (/OPR\//i.test(ua)) return 'Opera'
  if (/SamsungBrowser\//i.test(ua)) return 'Samsung Internet'
  if (/Chrome\//i.test(ua)) return 'Chrome'
  if (/Firefox\//i.test(ua)) return 'Firefox'
  if (/Safari\//i.test(ua)) return 'Safari'
  return 'Unknown'
}

function readWebGL(): { renderer: string | null; vendor: string | null } {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')
    if (!gl || !(gl instanceof WebGLRenderingContext)) return { renderer: null, vendor: null }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    if (!dbg) {
      return { renderer: String(gl.getParameter(gl.RENDERER)), vendor: String(gl.getParameter(gl.VENDOR)) }
    }
    return {
      renderer: String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)),
      vendor: String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)),
    }
  } catch {
    return { renderer: null, vendor: null }
  }
}

function readStaticRows(): { system: InfoRow[]; display: InfoRow[]; hardware: InfoRow[]; graphics: InfoRow[] } {
  const nav = navigator as ExtendedNavigator
  const ua = navigator.userAgent

  const system: InfoRow[] = [
    { label: 'Platform', value: nav.userAgentData?.platform ?? nav.platform ?? null },
    { label: 'Operating system', value: parseOS(ua) },
    { label: 'Browser', value: parseBrowser(ua) },
    {
      label: 'Languages',
      value: navigator.languages?.length ? navigator.languages.join(', ') : (navigator.language ?? null),
    },
    { label: 'Time zone', value: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null },
    { label: 'Cookies', value: navigator.cookieEnabled ? 'Enabled' : 'Disabled' },
  ]

  const orientation = (screen as Screen & { orientation?: { type?: string } }).orientation?.type ?? null
  const display: InfoRow[] = [
    { label: 'Screen resolution', value: `${screen.width.toLocaleString('en-US')} × ${screen.height.toLocaleString('en-US')}` },
    {
      label: 'Available area',
      value: `${screen.availWidth.toLocaleString('en-US')} × ${screen.availHeight.toLocaleString('en-US')}`,
    },
    { label: 'Device pixel ratio', value: window.devicePixelRatio ? `${window.devicePixelRatio}×` : null },
    { label: 'Color depth', value: screen.colorDepth ? `${screen.colorDepth}-bit` : null },
    { label: 'Orientation', value: orientation },
  ]

  const hardware: InfoRow[] = [
    {
      label: 'Device memory',
      value: typeof nav.deviceMemory === 'number' ? `≈ ${nav.deviceMemory} GB` : null,
      badge: 'N/A',
    },
    {
      label: 'Logical cores',
      value: typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency.toLocaleString('en-US') : null,
      badge: 'N/A',
    },
    {
      label: 'Max touch points',
      value: typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints.toLocaleString('en-US') : null,
      badge: 'N/A',
    },
  ]

  const webgl = readWebGL()
  const graphics: InfoRow[] = [
    { label: 'WebGL renderer', value: webgl.renderer, badge: 'N/A' },
    { label: 'WebGL vendor', value: webgl.vendor, badge: 'N/A' },
  ]

  return { system, display, hardware, graphics }
}

function readConn(): ConnState | null {
  const conn = (navigator as ExtendedNavigator).connection
  if (!conn) return null
  return {
    effectiveType: conn.effectiveType ?? null,
    downlink: typeof conn.downlink === 'number' ? conn.downlink : null,
    rtt: typeof conn.rtt === 'number' ? conn.rtt : null,
    saveData: typeof conn.saveData === 'boolean' ? conn.saveData : null,
  }
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

function InfoCard({ icon: Icon, title, rows }: { icon: LucideIcon; title: string; rows: InfoRow[] }) {
  return (
    <Card className="gap-3 p-4">
      <div className="flex items-center gap-2">
        <div className="grid size-8 place-items-center rounded-lg bg-primary/10">
          <Icon className="size-4 text-primary" aria-hidden="true" />
        </div>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 text-sm">
            <span className="shrink-0 text-muted-foreground">{row.label}</span>
            {row.value === null ? (
              <Badge variant="outline" className="text-muted-foreground">
                {row.badge ?? 'Not available'}
              </Badge>
            ) : (
              <span className="break-all text-right font-semibold">{row.value}</span>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

export default function DeviceInfoTool() {
  const [rows, setRows] = useState(readStaticRows)
  const [conn, setConn] = useState<ConnState | null>(readConn)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [inner, setInner] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [battery, setBattery] = useState<BatteryState | null>(null)
  const batteryRef = useRef<EventTarget & { level: number; charging: boolean } | null>(null)

  /* Battery: async read + live listeners (setState inside promise/listeners only) */
  useEffect(() => {
    const nav = navigator as ExtendedNavigator
    if (!nav.getBattery) return
    let cancelled = false

    const push = () => {
      const b = batteryRef.current
      if (b) setBattery({ level: b.level, charging: b.charging })
    }
    const onChange = () => push()

    nav
      .getBattery()
      .then((b) => {
        if (cancelled) return
        batteryRef.current = b
        push()
        b.addEventListener('levelchange', onChange)
        b.addEventListener('chargingchange', onChange)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      const b = batteryRef.current
      if (b) {
        b.removeEventListener('levelchange', onChange)
        b.removeEventListener('chargingchange', onChange)
      }
    }
  }, [])

  /* Live window size (setState inside listener callbacks) */
  useEffect(() => {
    const onResize = () => setInner({ w: window.innerWidth, h: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /* Online / offline status */
  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  /* Network Information API changes */
  useEffect(() => {
    const conn = (navigator as ExtendedNavigator).connection
    if (!conn) return
    const onChange = () => setConn(readConn())
    conn.addEventListener('change', onChange)
    return () => conn.removeEventListener('change', onChange)
  }, [])

  const refresh = useCallback(() => {
    setRows(readStaticRows())
    setConn(readConn())
    setOnline(navigator.onLine)
    setInner({ w: window.innerWidth, h: window.innerHeight })
    const b = batteryRef.current
    if (b) setBattery({ level: b.level, charging: b.charging })
  }, [])

  const networkRows: InfoRow[] = [
    { label: 'Status', value: online ? 'Online' : 'Offline' },
    { label: 'Effective type', value: conn?.effectiveType ? conn.effectiveType.toUpperCase() : null, badge: 'N/A' },
    { label: 'Downlink', value: conn?.downlink != null ? `${conn.downlink} Mb/s` : null, badge: 'N/A' },
    { label: 'Round-trip time', value: conn?.rtt != null ? `${conn.rtt} ms` : null, badge: 'N/A' },
    {
      label: 'Data saver',
      value: conn?.saveData != null ? (conn.saveData ? 'On' : 'Off') : null,
      badge: 'N/A',
    },
  ]

  const batteryRows: InfoRow[] = [
    {
      label: 'Charge level',
      value: battery ? `${Math.round(battery.level * 100).toLocaleString('en-US')}%` : null,
      badge: 'Not available',
    },
    { label: 'Charging', value: battery ? (battery.charging ? 'Yes — plugged in' : 'No — on battery') : null, badge: 'Not available' },
  ]

  const displayRows: InfoRow[] = [
    ...rows.display,
    { label: 'Window size', value: `${inner.w.toLocaleString('en-US')} × ${inner.h.toLocaleString('en-US')}` },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Live snapshot of this device and browser — read locally, updated in real time.
        </p>
        <Button variant="outline" className="h-11 gap-2" onClick={refresh} aria-label="Refresh device information">
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <InfoCard icon={MonitorSmartphone} title="System" rows={rows.system} />
        <InfoCard icon={Gauge} title="Display" rows={displayRows} />
        <InfoCard icon={Cpu} title="Hardware" rows={rows.hardware} />
        <InfoCard icon={Wifi} title="Network" rows={networkRows} />
        <InfoCard
          icon={battery?.charging ? BatteryCharging : BatteryFull}
          title="Battery"
          rows={batteryRows}
        />
        <InfoCard icon={ShieldCheck} title="Graphics" rows={rows.graphics} />
      </div>

      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
        <ShieldCheck className="size-3.5" aria-hidden="true" />
        All information is read locally in your browser and never leaves your device.
      </p>
    </div>
  )
}
