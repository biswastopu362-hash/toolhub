'use client'

import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Copy, Download, Eye, EyeOff, QrCode, TriangleAlert, Wifi } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* WiFi payload (proper escaping of \ ; , : ")                         */
/* ================================================================== */

type Mode = 'text' | 'wifi'
type WifiType = 'WPA' | 'WEP' | 'nopass'
type EcLevel = 'L' | 'M' | 'Q' | 'H'
type SizeKey = '256' | '512' | '1024'

const escapeWifi = (s: string): string => s.replace(/([\\;,:"])/g, '\\$1')

function buildWifiPayload(type: WifiType, ssid: string, pass: string, hidden: boolean): string {
  const parts: string[] = [`WIFI:T:${type}`, `S:${escapeWifi(ssid)}`]
  if (type !== 'nopass' && pass) parts.push(`P:${escapeWifi(pass)}`)
  if (hidden) parts.push('H:true')
  return parts.join(';') + ';;'
}

export default function QrGeneratorTool() {
  const { toast } = useToast()
  const [mode, setMode] = useState<Mode>('text')

  /* Text / link tab */
  const [text, setText] = useState('https://toolhub.app — ToolHub')

  /* WiFi tab */
  const [ssid, setSsid] = useState('')
  const [wifiPass, setWifiPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [wifiType, setWifiType] = useState<WifiType>('WPA')
  const [hidden, setHidden] = useState(false)

  /* Shared options */
  const [size, setSize] = useState<SizeKey>('512')
  const [ec, setEc] = useState<EcLevel>('M')
  const [darkColor, setDarkColor] = useState('#134e4a')
  const [lightColor, setLightColor] = useState('#ffffff')

  /* QR result */
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [qrError, setQrError] = useState<string | null>(null)

  const payload = useMemo(() => {
    if (mode === 'wifi') {
      return ssid.trim() ? buildWifiPayload(wifiType, ssid, wifiPass, hidden) : ''
    }
    return text
  }, [mode, text, ssid, wifiPass, wifiType, hidden])

  /* Debounced (300ms) async QR generation with stale-result guard.
     All setState calls happen inside async callbacks, never synchronously. */
  useEffect(() => {
    if (!payload.trim()) return
    let cancelled = false
    const t = setTimeout(() => {
      QRCode.toDataURL(payload, {
        width: Number(size),
        margin: 2,
        errorCorrectionLevel: ec,
        color: { dark: darkColor, light: lightColor },
      })
        .then((url: string) => {
          if (cancelled) return
          setDataUrl(url)
          setQrError(null)
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setDataUrl(null)
          setQrError(err instanceof Error ? err.message : 'Could not generate the QR code.')
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [payload, size, ec, darkColor, lightColor])

  const copyPayload = async () => {
    if (!payload.trim()) return
    try {
      await navigator.clipboard.writeText(payload)
      toast({ title: 'Copied ✓', description: 'Content saved to your clipboard' })
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' })
    }
  }

  const download = () => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.download = 'qr-code.png'
    a.href = dataUrl
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast({ title: 'Download started', description: 'Saving qr-code.png' })
  }

  const hasPayload = payload.trim().length > 0

  return (
    <div className="mx-auto max-w-lg">
      <Card className="overflow-hidden shadow-md">
        <div className="p-4 sm:p-5">
          <Tabs value={mode} onValueChange={(v) => (v === 'text' || v === 'wifi') && setMode(v)}>
            <TabsList className="w-full">
              <TabsTrigger value="text">Text / URL</TabsTrigger>
              <TabsTrigger value="wifi" className="gap-1.5">
                <Wifi className="h-4 w-4" />
                Wi-Fi
              </TabsTrigger>
            </TabsList>

            {/* ---------------- Text / URL tab ---------------- */}
            <TabsContent value="text" className="space-y-1.5 pt-2">
              <Label htmlFor="qr-text" className="text-sm font-medium">
                Text or URL
              </Label>
              <Textarea
                id="qr-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Enter any text or an https:// link…"
                className="min-h-[100px]"
                aria-label="QR code content"
              />
            </TabsContent>

            {/* ---------------- WiFi tab ---------------- */}
            <TabsContent value="wifi" className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="qr-ssid" className="text-sm font-medium">
                  Network name (SSID)
                </Label>
                <Input
                  id="qr-ssid"
                  value={ssid}
                  onChange={(e) => setSsid(e.target.value)}
                  placeholder="e.g. Home_WiFi"
                  className="h-11"
                  aria-label="Wi-Fi network name"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="qr-wifipass" className="text-sm font-medium">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="qr-wifipass"
                    type={showPass ? 'text' : 'password'}
                    value={wifiPass}
                    onChange={(e) => setWifiPass(e.target.value)}
                    placeholder={wifiType === 'nopass' ? 'None selected — not required' : 'Wi-Fi password'}
                    disabled={wifiType === 'nopass'}
                    className="h-11 pr-11"
                    aria-label="Wi-Fi password"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 size-9 -translate-y-1/2"
                    onClick={() => setShowPass((s) => !s)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">Security</Label>
                  <Select
                    value={wifiType}
                    onValueChange={(v) => (v === 'WPA' || v === 'WEP' || v === 'nopass') && setWifiType(v)}
                  >
                    <SelectTrigger className="h-11 w-full" aria-label="Select security type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WPA">WPA / WPA2 / WPA3</SelectItem>
                      <SelectItem value="WEP">WEP (legacy)</SelectItem>
                      <SelectItem value="nopass">None (open network)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3 py-2">
                  <Label htmlFor="qr-hidden" className="text-sm font-normal">
                    Hidden network
                  </Label>
                  <Switch
                    id="qr-hidden"
                    checked={hidden}
                    onCheckedChange={(v) => setHidden(v)}
                    aria-label="Hidden network toggle"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* ---------------- Shared options ---------------- */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Size</Label>
              <Select value={size} onValueChange={(v) => (v === '256' || v === '512' || v === '1024') && setSize(v)}>
                <SelectTrigger className="h-11 w-full" aria-label="Select QR code size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="256">256 px</SelectItem>
                  <SelectItem value="512">512 px</SelectItem>
                  <SelectItem value="1024">1024 px</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Error correction</Label>
              <Select value={ec} onValueChange={(v) => (v === 'L' || v === 'M' || v === 'Q' || v === 'H') && setEc(v)}>
                <SelectTrigger className="h-11 w-full" aria-label="Select error correction level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="L">L — 7% recovery</SelectItem>
                  <SelectItem value="M">M — 15% (default)</SelectItem>
                  <SelectItem value="Q">Q — 25%</SelectItem>
                  <SelectItem value="H">H — 30%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qr-dark" className="text-xs text-muted-foreground">
                Dark color (modules)
              </Label>
              <Input
                id="qr-dark"
                type="color"
                value={darkColor}
                onChange={(e) => setDarkColor(e.target.value)}
                className="h-11 cursor-pointer p-1"
                aria-label="Select QR code dark color"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qr-light" className="text-xs text-muted-foreground">
                Light color (background)
              </Label>
              <Input
                id="qr-light"
                type="color"
                value={lightColor}
                onChange={(e) => setLightColor(e.target.value)}
                className="h-11 cursor-pointer p-1"
                aria-label="Select QR code light color"
              />
            </div>
          </div>

          {/* ---------------- QR display ---------------- */}
          <div className="mt-4">
            {!hasPayload ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                <QrCode className="h-8 w-8 opacity-50" />
                {mode === 'wifi'
                  ? 'Enter the Wi-Fi name (SSID) — the QR code will appear here'
                  : 'Enter text or a link above — the QR code will appear here'}
              </div>
            ) : qrError ? (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>Could not generate QR code</AlertTitle>
                <AlertDescription>{qrError}</AlertDescription>
              </Alert>
            ) : dataUrl ? (
              <div className="flex justify-center">
                <Card className="bg-white p-4 shadow-md" style={{ backgroundColor: lightColor }}>
                  <img
                    src={dataUrl}
                    alt="QR code"
                    width={Number(size)}
                    height={Number(size)}
                    className="h-auto max-w-full rounded-lg"
                  />
                </Card>
              </div>
            ) : (
              <div className="flex justify-center py-10" role="status" aria-label="Generating QR code">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
              </div>
            )}
          </div>

          {/* ---------------- Actions ---------------- */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={download}
              disabled={!dataUrl}
              aria-label="Download QR code as PNG"
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
            <Button
              variant="secondary"
              className="h-11"
              onClick={copyPayload}
              disabled={!hasPayload}
              aria-label="Copy QR code content"
            >
              <Copy className="h-4 w-4" />
              Copy
            </Button>
          </div>

          {hasPayload && !qrError && (
            <p className="mt-3 break-all text-center text-[11px] text-muted-foreground">
              Encoding: {payload}
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
