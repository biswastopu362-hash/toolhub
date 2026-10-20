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
import { toBn } from '@/lib/bn'
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
  const [text, setText] = useState('https://toolhub.app — টুলহাব')

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
          setQrError(err instanceof Error ? err.message : 'কিউআর কোড তৈরি করা যায়নি।')
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
      toast({ title: 'কপি হয়েছে ✓', description: 'কনটেন্ট ক্লিপবোর্ডে সংরক্ষিত হয়েছে' })
    } catch {
      toast({ title: 'কপি করা যায়নি', variant: 'destructive' })
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
    toast({ title: 'ডাউনলোড শুরু হয়েছে', description: 'qr-code.png সংরক্ষিত হচ্ছে' })
  }

  const hasPayload = payload.trim().length > 0

  return (
    <div className="mx-auto max-w-lg">
      <Card className="overflow-hidden shadow-md">
        <div className="p-4 sm:p-5">
          <Tabs value={mode} onValueChange={(v) => (v === 'text' || v === 'wifi') && setMode(v)}>
            <TabsList className="w-full">
              <TabsTrigger value="text">টেক্সট / লিংক</TabsTrigger>
              <TabsTrigger value="wifi" className="gap-1.5">
                <Wifi className="h-4 w-4" />
                ওয়াইফাই
              </TabsTrigger>
            </TabsList>

            {/* ---------------- Text / URL tab ---------------- */}
            <TabsContent value="text" className="space-y-1.5 pt-2">
              <Label htmlFor="qr-text" className="text-sm font-medium">
                টেক্সট বা লিংক
              </Label>
              <Textarea
                id="qr-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="যেকোনো লেখা বা https:// লিংক লিখুন…"
                className="min-h-[100px]"
                aria-label="কিউআর কোডের কনটেন্ট"
              />
            </TabsContent>

            {/* ---------------- WiFi tab ---------------- */}
            <TabsContent value="wifi" className="space-y-3 pt-2">
              <div className="space-y-1.5">
                <Label htmlFor="qr-ssid" className="text-sm font-medium">
                  নেটওয়ার্কের নাম (SSID)
                </Label>
                <Input
                  id="qr-ssid"
                  value={ssid}
                  onChange={(e) => setSsid(e.target.value)}
                  placeholder="যেমন: Home_WiFi"
                  className="h-11"
                  aria-label="ওয়াইফাই নেটওয়ার্কের নাম"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="qr-wifipass" className="text-sm font-medium">
                  পাসওয়ার্ড
                </Label>
                <div className="relative">
                  <Input
                    id="qr-wifipass"
                    type={showPass ? 'text' : 'password'}
                    value={wifiPass}
                    onChange={(e) => setWifiPass(e.target.value)}
                    placeholder={wifiType === 'nopass' ? 'ছাড়া নির্বাচিত — প্রয়োজন নেই' : 'ওয়াইফাই পাসওয়ার্ড'}
                    disabled={wifiType === 'nopass'}
                    className="h-11 pr-11"
                    aria-label="ওয়াইফাই পাসওয়ার্ড"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 size-9 -translate-y-1/2"
                    onClick={() => setShowPass((s) => !s)}
                    aria-label={showPass ? 'পাসওয়ার্ড লুকান' : 'পাসওয়ার্ড দেখান'}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-sm font-medium">এনক্রিপশন</Label>
                  <Select
                    value={wifiType}
                    onValueChange={(v) => (v === 'WPA' || v === 'WEP' || v === 'nopass') && setWifiType(v)}
                  >
                    <SelectTrigger className="h-11 w-full" aria-label="এনক্রিপশন ধরন নির্বাচন করুন">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WPA">WPA / WPA2 / WPA3</SelectItem>
                      <SelectItem value="WEP">WEP (পুরোনো)</SelectItem>
                      <SelectItem value="nopass">ছাড়া (খোলা নেটওয়ার্ক)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3 py-2">
                  <Label htmlFor="qr-hidden" className="text-sm font-normal">
                    লুকানো নেটওয়ার্ক
                  </Label>
                  <Switch
                    id="qr-hidden"
                    checked={hidden}
                    onCheckedChange={(v) => setHidden(v)}
                    aria-label="লুকানো নেটওয়ার্ক কি না"
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* ---------------- Shared options ---------------- */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">সাইজ</Label>
              <Select value={size} onValueChange={(v) => (v === '256' || v === '512' || v === '1024') && setSize(v)}>
                <SelectTrigger className="h-11 w-full" aria-label="কিউআর কোডের সাইজ নির্বাচন করুন">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="256">{toBn(256)} px</SelectItem>
                  <SelectItem value="512">{toBn(512)} px</SelectItem>
                  <SelectItem value="1024">{toBn(1024)} px</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm font-medium">এরর কারেকশন</Label>
              <Select value={ec} onValueChange={(v) => (v === 'L' || v === 'M' || v === 'Q' || v === 'H') && setEc(v)}>
                <SelectTrigger className="h-11 w-full" aria-label="এরর কারেকশন লেভেল নির্বাচন করুন">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="L">L — {toBn(7)}% পুনরুদ্ধার</SelectItem>
                  <SelectItem value="M">M — {toBn(15)}% (ডিফল্ট)</SelectItem>
                  <SelectItem value="Q">Q — {toBn(25)}%</SelectItem>
                  <SelectItem value="H">H — {toBn(30)}%</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="qr-dark" className="text-xs text-muted-foreground">
                গাঢ় রং (মডিউল)
              </Label>
              <Input
                id="qr-dark"
                type="color"
                value={darkColor}
                onChange={(e) => setDarkColor(e.target.value)}
                className="h-11 cursor-pointer p-1"
                aria-label="কিউআর কোডের গাঢ় রং নির্বাচন করুন"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qr-light" className="text-xs text-muted-foreground">
                হালকা রং (ব্যাকগ্রাউন্ড)
              </Label>
              <Input
                id="qr-light"
                type="color"
                value={lightColor}
                onChange={(e) => setLightColor(e.target.value)}
                className="h-11 cursor-pointer p-1"
                aria-label="কিউআর কোডের হালকা রং নির্বাচন করুন"
              />
            </div>
          </div>

          {/* ---------------- QR display ---------------- */}
          <div className="mt-4">
            {!hasPayload ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">
                <QrCode className="h-8 w-8 opacity-50" />
                {mode === 'wifi'
                  ? 'ওয়াইফাইয়ের নাম (SSID) লিখুন — কিউআর কোড এখানে দেখা যাবে'
                  : 'উপরে টেক্সট বা লিংক লিখুন — কিউআর কোড এখানে দেখা যাবে'}
              </div>
            ) : qrError ? (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>কিউআর কোড তৈরি করা যায়নি</AlertTitle>
                <AlertDescription>{qrError}</AlertDescription>
              </Alert>
            ) : dataUrl ? (
              <div className="flex justify-center">
                <Card className="bg-white p-4 shadow-md" style={{ backgroundColor: lightColor }}>
                  <img
                    src={dataUrl}
                    alt="কিউআর কোড"
                    width={Number(size)}
                    height={Number(size)}
                    className="h-auto max-w-full rounded-lg"
                  />
                </Card>
              </div>
            ) : (
              <div className="flex justify-center py-10" role="status" aria-label="কিউআর কোড তৈরি হচ্ছে">
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
              aria-label="কিউআর কোড PNG হিসেবে ডাউনলোড করুন"
            >
              <Download className="h-4 w-4" />
              ডাউনলোড
            </Button>
            <Button
              variant="secondary"
              className="h-11"
              onClick={copyPayload}
              disabled={!hasPayload}
              aria-label="কিউআর কোডের কনটেন্ট কপি করুন"
            >
              <Copy className="h-4 w-4" />
              কপি
            </Button>
          </div>

          {hasPayload && !qrError && (
            <p className="mt-3 break-all text-center text-[11px] text-muted-foreground">
              এনকোড হচ্ছে: {payload}
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
