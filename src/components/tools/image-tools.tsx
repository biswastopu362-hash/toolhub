'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Loader2,
  Lock,
  LockOpen,
  Scissors,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

type TargetFormat = 'image/png' | 'image/jpeg' | 'image/webp'

const MAX_BYTES = 20 * 1024 * 1024 // 20 MB

const EXTENSIONS: Record<TargetFormat, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

const FORMAT_LABELS: Record<TargetFormat, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString('en-US')} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('en-US', { maximumFractionDigits: 2 })} MB`
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'image'
}

interface LoadedImage {
  el: HTMLImageElement
  width: number
  height: number
}

interface ResultInfo {
  url: string
  blob: Blob
  width: number
  height: number
  mime: TargetFormat
  suffix: string
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function ImageToolsTool() {
  const { toast } = useToast()

  /* Source image */
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [img, setImg] = useState<LoadedImage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [loadingImg, setLoadingImg] = useState(false)

  /* Processing */
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ResultInfo | null>(null)

  /* Compress tab */
  const [quality, setQuality] = useState(80)
  const [compressFormat, setCompressFormat] = useState<TargetFormat>('image/jpeg')

  /* Resize tab */
  const [resizeWidth, setResizeWidth] = useState('')
  const [resizeHeight, setResizeHeight] = useState('')
  const [lockAspect, setLockAspect] = useState(true)
  const [resizeFormat, setResizeFormat] = useState<'keep' | TargetFormat>('keep')

  /* Convert tab */
  const [convertFormat, setConvertFormat] = useState<TargetFormat>('image/png')
  const [convertQuality, setConvertQuality] = useState(90)

  const inputRef = useRef<HTMLInputElement>(null)
  const previewUrlRef = useRef<string | null>(null)
  const resultUrlRef = useRef<string | null>(null)

  /* Revoke object URLs on unmount (cleanup only — no setState) */
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    }
  }, [])

  const clearResult = useCallback(() => {
    if (resultUrlRef.current) {
      URL.revokeObjectURL(resultUrlRef.current)
      resultUrlRef.current = null
    }
    setResult(null)
  }, [])

  /* Load a picked/dropped file: object URL + Image decode */
  const loadFile = useCallback(
    (f: File) => {
      if (!f.type.startsWith('image/')) {
        setError(`"${f.name}" is not an image file. Please choose a PNG, JPEG, WebP or GIF image.`)
        return
      }
      if (f.size > MAX_BYTES) {
        setError(
          `"${f.name}" is ${formatBytes(f.size)}, which is larger than the 20 MB limit. Please choose a smaller image.`
        )
        return
      }

      setError(null)
      clearResult()

      /* revoke previous preview */
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
      const url = URL.createObjectURL(f)
      previewUrlRef.current = url

      setLoadingImg(true)
      const image = new Image()
      image.onload = () => {
        setFile(f)
        setImg({ el: image, width: image.naturalWidth, height: image.naturalHeight })
        setPreviewUrl(url)
        setResizeWidth(String(image.naturalWidth))
        setResizeHeight(String(image.naturalHeight))
        setLoadingImg(false)
      }
      image.onerror = () => {
        URL.revokeObjectURL(url)
        previewUrlRef.current = null
        setFile(null)
        setImg(null)
        setPreviewUrl(null)
        setLoadingImg(false)
        setError('This file could not be decoded as an image. It may be corrupted or an unsupported format.')
      }
      image.src = url
    },
    [clearResult]
  )

  /* ---------------- Rendering via canvas ---------------- */

  const renderBlob = (targetW: number, targetH: number, mime: TargetFormat, q?: number): Promise<Blob> =>
    new Promise<Blob>((resolve, reject) => {
      if (!img) {
        reject(new Error('No image loaded.'))
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas is not supported in this browser.'))
        return
      }
      /* JPEG has no alpha channel — flatten onto white */
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, targetW, targetH)
      }
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img.el, 0, 0, targetW, targetH)
      canvas.toBlob(
        (blob) => {
          if (blob && blob.size > 0) resolve(blob)
          else reject(new Error('The browser could not export this image in the selected format.'))
        },
        mime,
        q
      )
    })

  const applyResult = (blob: Blob, w: number, h: number, mime: TargetFormat, suffix: string) => {
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current)
    const url = URL.createObjectURL(blob)
    resultUrlRef.current = url
    setResult({ url, blob, width: w, height: h, mime, suffix })
  }

  const resolveMime = (mode: 'keep' | TargetFormat): TargetFormat => {
    if (mode !== 'keep') return mode
    if (file && (file.type === 'image/png' || file.type === 'image/jpeg' || file.type === 'image/webp')) {
      return file.type
    }
    return 'image/png'
  }

  /* ---------------- Actions ---------------- */

  const doCompress = async () => {
    if (!img || !file || busy) return
    setBusy(true)
    try {
      const blob = await renderBlob(img.width, img.height, compressFormat, quality / 100)
      applyResult(blob, img.width, img.height, compressFormat, '-compressed')
      const saved = Math.round((1 - blob.size / file.size) * 100)
      toast({
        title: 'Image compressed ✓',
        description: `${formatBytes(file.size)} → ${formatBytes(blob.size)} (${saved}% ${saved >= 0 ? 'smaller' : 'larger'})`,
      })
    } catch (e) {
      toast({
        title: 'Compression failed',
        description: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const doResize = async () => {
    if (!img || !file || busy) return
    const w = Math.round(Number(resizeWidth))
    const h = Math.round(Number(resizeHeight))
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > 20000 || h > 20000) {
      toast({
        title: 'Invalid dimensions',
        description: 'Width and height must be between 1 and 20,000 pixels.',
        variant: 'destructive',
      })
      return
    }
    setBusy(true)
    try {
      const mime = resolveMime(resizeFormat)
      const blob = await renderBlob(w, h, mime)
      applyResult(blob, w, h, mime, '-resized')
      toast({ title: 'Image resized ✓', description: `New size: ${w.toLocaleString('en-US')} × ${h.toLocaleString('en-US')} px` })
    } catch (e) {
      toast({
        title: 'Resize failed',
        description: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const doConvert = async () => {
    if (!img || !file || busy) return
    setBusy(true)
    try {
      const lossy = convertFormat !== 'image/png'
      const blob = await renderBlob(img.width, img.height, convertFormat, lossy ? convertQuality / 100 : undefined)
      applyResult(blob, img.width, img.height, convertFormat, '-converted')
      toast({ title: 'Image converted ✓', description: `Format: ${FORMAT_LABELS[convertFormat]} · ${formatBytes(blob.size)}` })
    } catch (e) {
      toast({
        title: 'Conversion failed',
        description: e instanceof Error ? e.message : 'Something went wrong.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  /* ---------------- Resize input handlers (aspect lock) ---------------- */

  const sourceRatio = img ? img.height / img.width : 1

  const onWidthChange = (v: string) => {
    const clean = v.replace(/[^0-9]/g, '')
    setResizeWidth(clean)
    if (lockAspect && clean) {
      const w = Number(clean)
      if (w > 0) setResizeHeight(String(Math.max(1, Math.round(w * sourceRatio))))
    }
  }

  const onHeightChange = (v: string) => {
    const clean = v.replace(/[^0-9]/g, '')
    setResizeHeight(clean)
    if (lockAspect && clean) {
      const h = Number(clean)
      if (h > 0) setResizeWidth(String(Math.max(1, Math.round(h / sourceRatio))))
    }
  }

  const applyPreset = (pct: number) => {
    if (!img) return
    const w = Math.max(1, Math.round(img.width * pct))
    const h = Math.max(1, Math.round(img.height * pct))
    setResizeWidth(String(w))
    setResizeHeight(String(h))
  }

  const resultFilename = result && file ? `${baseName(file.name)}${result.suffix}.${EXTENSIONS[result.mime]}` : ''

  const savedPct = result && file ? Math.round((1 - result.blob.size / file.size) * 100) : 0

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-label="Choose an image file"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) loadFile(f)
          e.target.value = ''
        }}
      />

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>File problem</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Drop zone */}
      {!file && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Choose or drop an image"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              inputRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files?.[0]
            if (f) loadFile(f)
          }}
          className={cn(
            'flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
            dragging ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50 hover:bg-muted/50'
          )}
        >
          <div className="grid size-14 place-items-center rounded-full bg-muted">
            <Upload className="size-6 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="font-medium">Drop an image here, or tap to browse</p>
            <p className="text-sm text-muted-foreground">PNG · JPEG · WebP · GIF — up to 20 MB. Everything stays on your device.</p>
          </div>
        </div>
      )}

      {/* Preview + info */}
      {file && (
        <Card className="gap-4 p-4">
          <div>
            <div className="grid place-items-center rounded-lg bg-muted/60 p-3">
              {previewUrl && (
                <img src={previewUrl} alt={file.name} className="max-h-64 w-auto object-contain" />
              )}
              {loadingImg && (
                <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading image…
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="max-w-full truncate font-medium" title={file.name}>
                {file.name}
              </span>
              {img && (
                <Badge variant="secondary">
                  {img.width.toLocaleString('en-US')} × {img.height.toLocaleString('en-US')} px
                </Badge>
              )}
              <Badge variant="outline">{formatBytes(file.size)}</Badge>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-9 gap-1.5 text-muted-foreground"
                onClick={() => inputRef.current?.click()}
                aria-label="Replace image"
              >
                <Upload className="size-4" /> Replace
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 text-destructive hover:text-destructive"
                onClick={() => {
                  if (previewUrlRef.current) {
                    URL.revokeObjectURL(previewUrlRef.current)
                    previewUrlRef.current = null
                  }
                  setFile(null)
                  setImg(null)
                  setPreviewUrl(null)
                  clearResult()
                }}
                aria-label="Remove image"
              >
                <Trash2 className="size-4" /> Remove
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Tabs */}
      {file && img && (
        <Tabs defaultValue="compress">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="compress">Compress</TabsTrigger>
            <TabsTrigger value="resize">Resize</TabsTrigger>
            <TabsTrigger value="convert">Convert</TabsTrigger>
          </TabsList>

          {/* ---------------- Compress ---------------- */}
          <TabsContent value="compress" className="mt-4 space-y-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="quality-slider">Quality</Label>
                <Badge variant="secondary">{quality}%</Badge>
              </div>
              <Slider
                id="quality-slider"
                min={10}
                max={100}
                step={1}
                value={[quality]}
                onValueChange={(v) => setQuality(v[0] ?? 80)}
                aria-label="Compression quality"
              />
            </div>
            <div className="space-y-2">
              <Label>Output format</Label>
              <Select value={compressFormat} onValueChange={(v) => setCompressFormat(v as TargetFormat)}>
                <SelectTrigger className="h-11 w-full" aria-label="Output format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="image/jpeg">JPEG — smallest files</SelectItem>
                  <SelectItem value="image/webp">WebP — modern &amp; efficient</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="h-11 w-full gap-2" onClick={doCompress} disabled={busy} aria-label="Compress image">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Scissors className="size-4" />}
              {busy ? 'Compressing…' : 'Compress image'}
            </Button>
          </TabsContent>

          {/* ---------------- Resize ---------------- */}
          <TabsContent value="resize" className="mt-4 space-y-4">
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="resize-w">Width (px)</Label>
                <Input
                  id="resize-w"
                  inputMode="numeric"
                  value={resizeWidth}
                  onChange={(e) => onWidthChange(e.target.value)}
                  placeholder="Width"
                  className="h-11"
                />
              </div>
              <div className="grid h-11 place-items-center pb-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  onClick={() => setLockAspect((v) => !v)}
                  aria-label={lockAspect ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                  aria-pressed={lockAspect}
                  title={lockAspect ? 'Aspect ratio locked' : 'Aspect ratio unlocked'}
                >
                  {lockAspect ? <Lock className="size-4 text-primary" /> : <LockOpen className="size-4 text-muted-foreground" />}
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="resize-h">Height (px)</Label>
                <Input
                  id="resize-h"
                  inputMode="numeric"
                  value={resizeHeight}
                  onChange={(e) => onHeightChange(e.target.value)}
                  placeholder="Height"
                  className="h-11"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Quick scale:</span>
              {[0.25, 0.5, 0.75].map((p) => (
                <Button key={p} variant="outline" size="sm" className="h-9 flex-1" onClick={() => applyPreset(p)} aria-label={`Scale to ${p * 100}%`}>
                  {p * 100}%
                </Button>
              ))}
            </div>

            <div className="space-y-2">
              <Label>Output format</Label>
              <Select value={resizeFormat} onValueChange={(v) => setResizeFormat(v as 'keep' | TargetFormat)}>
                <SelectTrigger className="h-11 w-full" aria-label="Resized output format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Keep original format</SelectItem>
                  <SelectItem value="image/png">PNG</SelectItem>
                  <SelectItem value="image/jpeg">JPEG</SelectItem>
                  <SelectItem value="image/webp">WebP</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button className="h-11 w-full gap-2" onClick={doResize} disabled={busy} aria-label="Resize image">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {busy ? 'Resizing…' : 'Apply resize'}
            </Button>
          </TabsContent>

          {/* ---------------- Convert ---------------- */}
          <TabsContent value="convert" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label>Convert to</Label>
              <Select value={convertFormat} onValueChange={(v) => setConvertFormat(v as TargetFormat)}>
                <SelectTrigger className="h-11 w-full" aria-label="Target format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="image/png">PNG — lossless, supports transparency</SelectItem>
                  <SelectItem value="image/jpeg">JPEG — lossy, small files</SelectItem>
                  <SelectItem value="image/webp">WebP — modern, efficient</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {convertFormat !== 'image/png' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="convert-quality">Quality</Label>
                  <Badge variant="secondary">{convertQuality}%</Badge>
                </div>
                <Slider
                  id="convert-quality"
                  min={10}
                  max={100}
                  step={1}
                  value={[convertQuality]}
                  onValueChange={(v) => setConvertQuality(v[0] ?? 90)}
                  aria-label="Conversion quality"
                />
              </div>
            )}
            <Button className="h-11 w-full gap-2" onClick={doConvert} disabled={busy} aria-label="Convert image">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
              {busy ? 'Converting…' : `Convert to ${FORMAT_LABELS[convertFormat]}`}
            </Button>
          </TabsContent>
        </Tabs>
      )}

      {/* Result card */}
      {result && (
        <Card className="gap-4 border-primary/40 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">Result</h3>
              <Badge>{FORMAT_LABELS[result.mime]}</Badge>
              <Badge variant="secondary">
                {result.width.toLocaleString('en-US')} × {result.height.toLocaleString('en-US')} px
              </Badge>
              {file && result.suffix === '-compressed' && (
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                  {savedPct > 0 ? `${savedPct}% saved` : 'No size saved'}
                </Badge>
              )}
            </div>
            <Separator className="my-3" />
            <div className="grid place-items-center rounded-lg bg-muted/60 p-3">
              <img src={result.url} alt="Processed result" className="max-h-64 w-auto object-contain" />
            </div>
            {file && result.suffix === '-compressed' && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-center text-sm">
                <div className="rounded-lg bg-muted p-2">
                  <p className="text-xs text-muted-foreground">Original</p>
                  <p className="font-semibold">{formatBytes(file.size)}</p>
                </div>
                <div className="rounded-lg bg-emerald-500/10 p-2">
                  <p className="text-xs text-muted-foreground">Compressed</p>
                  <p className="font-semibold text-emerald-600 dark:text-emerald-400">{formatBytes(result.blob.size)}</p>
                </div>
              </div>
            )}
            <Button asChild className="mt-4 h-11 w-full gap-2" aria-label="Download result">
              <a href={result.url} download={resultFilename}>
                <Download className="size-4" />
                Download {resultFilename}
              </a>
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
