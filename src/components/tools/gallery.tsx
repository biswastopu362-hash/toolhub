'use client'

/**
 * Gallery — photo library backed by the shared IndexedDB media store.
 * Tabs: Photos | Albums (by month) | Favorites. Fullscreen in-app viewer,
 * drag-and-drop import, and an offline procedural sample gallery.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  HardDrive,
  Heart,
  ImagePlus,
  Images,
  Link2,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useDeviceThumb } from '@/hooks/use-device-thumb'
import {
  accessState,
  connectRoot,
  deleteEntry,
  DeviceRootMissingError,
  ensureFreshIndex,
  entryUrl,
  fsSupported,
  getRoot,
  listEntries,
  requestAccess,
  type DeviceEntry,
  type FsDirHandle,
} from '@/lib/device-media'
import {
  deletePhoto,
  fileToDataUrl,
  listPhotos,
  newPhotoId,
  putPhoto,
  toggleFav,
  type PhotoRecord,
} from '@/lib/media-db'

/* ================================================================== */
/* Procedural sample artwork (offline demo gallery)                    */
/* ================================================================== */

const SAMPLE_PALETTES: { bg: number; hues: number[] }[] = [
  { bg: 20, hues: [8, 32, 350, 320] }, // sunset ember
  { bg: 205, hues: [190, 210, 168, 230] }, // ocean drift
  { bg: 150, hues: [145, 95, 175, 200] }, // forest mist
  { bg: 270, hues: [265, 295, 240, 315] }, // violet dream
  { bg: 335, hues: [340, 15, 300, 355] }, // rose dawn
  { bg: 38, hues: [42, 25, 55, 10] }, // golden hour
  { bg: 185, hues: [175, 195, 215, 160] }, // lagoon
  { bg: 250, hues: [255, 285, 225, 305] }, // midnight grape
  { bg: 100, hues: [95, 70, 130, 160] }, // meadow
  { bg: 220, hues: [15, 200, 320, 60] }, // candy pop
]

/** Deterministic small PRNG so samples look curated, not random noise. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Mesh gradient + layered waves + soft orbs + grain, painted on canvas. */
function generateSampleDataUrl(index: number): string {
  const rng = mulberry32(index * 7919 + 104729)
  const size = 960
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  const pal = SAMPLE_PALETTES[index % SAMPLE_PALETTES.length]
  const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h}, ${s}%, ${l}%, ${a})`
  const pickHue = () => pal.hues[Math.floor(rng() * pal.hues.length)]

  // 1. Base fill
  ctx.fillStyle = hsl(pal.bg, 45, 16)
  ctx.fillRect(0, 0, size, size)

  // 2. Mesh gradient blobs
  for (let i = 0; i < 6; i++) {
    const h = pickHue()
    const x = rng() * size
    const y = rng() * size
    const r = size * (0.35 + rng() * 0.45)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, hsl(h, 78, 56 + rng() * 16, 0.85))
    g.addColorStop(1, hsl(h, 78, 50, 0))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
  }

  // 3. Layered waves
  const waveCount = 3 + Math.floor(rng() * 2)
  for (let w = 0; w < waveCount; w++) {
    const baseY = size * (0.52 + w * 0.11 + rng() * 0.06)
    const amp = size * (0.04 + rng() * 0.07)
    const freq = ((1.5 + rng() * 2.5) * Math.PI * 2) / size
    const phase = rng() * Math.PI * 2
    ctx.beginPath()
    ctx.moveTo(0, size)
    ctx.lineTo(0, baseY)
    for (let x = 0; x <= size; x += 12) {
      ctx.lineTo(x, baseY + Math.sin(x * freq + phase) * amp)
    }
    ctx.lineTo(size, size)
    ctx.closePath()
    ctx.fillStyle = hsl(pickHue(), 60, w % 2 === 0 ? 30 : 21, 0.5)
    ctx.fill()
  }

  // 4. Soft glow orbs
  for (let c = 0; c < 3; c++) {
    const h = pickHue()
    const x = rng() * size
    const y = rng() * size * 0.7
    const r = size * (0.05 + rng() * 0.12)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, 'hsla(0, 0%, 100%, 0.35)')
    g.addColorStop(0.6, hsl(h, 80, 75, 0.18))
    g.addColorStop(1, 'hsla(0, 0%, 100%, 0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  // 5. Vignette
  const vg = ctx.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.78)
  vg.addColorStop(0, 'rgba(0, 0, 0, 0)')
  vg.addColorStop(1, 'rgba(0, 0, 0, 0.28)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, size, size)

  // 6. Film grain
  const grain = document.createElement('canvas')
  grain.width = 160
  grain.height = 160
  const gctx = grain.getContext('2d')
  if (gctx) {
    const img = gctx.createImageData(160, 160)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + rng() * 145
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = 26
    }
    gctx.putImageData(img, 0, 0)
    const pattern = ctx.createPattern(grain, 'repeat')
    if (pattern) {
      ctx.globalAlpha = 0.55
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, size, size)
      ctx.globalAlpha = 1
    }
  }

  return canvas.toDataURL('image/jpeg', 0.85)
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

const monthKey = (ts: number) =>
  new Date(ts).toLocaleString('en-US', { month: 'long', year: 'numeric' })

const shortDate = (ts: number) =>
  new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const downloadName = (p: PhotoRecord) =>
  `${(p.name ?? 'photo').replace(/\.[^.]+$/, '')}-${p.id}.jpg`

type GalleryTab = 'photos' | 'albums' | 'favorites' | 'device'

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function GalleryApp() {
  const { toast } = useToast()
  const [photos, setPhotos] = useState<PhotoRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<GalleryTab>('photos')
  const [openAlbum, setOpenAlbum] = useState<string | null>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PhotoRecord | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const [sampleBusy, setSampleBusy] = useState(false)
  const [sampleProgress, setSampleProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /* -------- Device access (File System Access API — real files, no upload) -------- */
  const [devRoot, setDevRoot] = useState<FsDirHandle | undefined>(undefined)
  const [devAccess, setDevAccess] = useState<'none' | PermissionState>('none')
  const [devEntries, setDevEntries] = useState<DeviceEntry[]>([])
  const [devBusy, setDevBusy] = useState(false)
  const [devViewer, setDevViewer] = useState<number | null>(null)
  const [devDeleteTarget, setDevDeleteTarget] = useState<DeviceEntry | null>(null)
  const devSupported = useMemo(() => fsSupported(), [])

  useEffect(() => {
    let cancelled = false
    void getRoot().then(async (handle) => {
      if (cancelled) return
      setDevRoot(handle)
      if (!handle) {
        setDevAccess('none')
        return
      }
      const st = await accessState(handle)
      if (!cancelled) setDevAccess(st)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const loadDevice = useCallback(
    async (reindex: boolean) => {
      setDevBusy(true)
      try {
        if (reindex) await ensureFreshIndex(10 * 60_000)
        const media = (await listEntries({ dir: false, kinds: ['image', 'video'] })).sort(
          (a, b) => b.lastModified - a.lastModified
        )
        setDevEntries(media)
      } catch (err) {
        // ensureFreshIndex never resolved before — surface why (moved/renamed folder etc.)
        if (err instanceof DeviceRootMissingError) {
          toast({
            title: 'Device folder is gone',
            description: `“${devRoot?.name ?? 'The folder'}” was moved or deleted — reconnect it to refresh.`,
            variant: 'destructive',
          })
        }
      } finally {
        setDevBusy(false)
      }
    },
    [devRoot?.name, toast]
  )

  /* Auto-load when the Device tab opens — the native "it's just there" feel. */
  useEffect(() => {
    if (tab !== 'device' || !devRoot || devAccess !== 'granted') return
    void loadDevice(true)
  }, [tab, devRoot, devAccess, loadDevice])

  /* Stay in sync when the Files app re-indexes. */
  useEffect(() => {
    const onIndexed = () => {
      if (tab === 'device' && devRoot && devAccess === 'granted') void loadDevice(false)
    }
    window.addEventListener('toolhub:device-indexed', onIndexed)
    return () => window.removeEventListener('toolhub:device-indexed', onIndexed)
  }, [tab, devRoot, devAccess, loadDevice])

  const devConnect = useCallback(async () => {
    try {
      const handle = await connectRoot()
      setDevRoot(handle)
      setDevAccess(await accessState(handle))
      toast({
        title: `“${handle.name}” connected`,
        description: 'Photos and videos from this folder now appear automatically.',
      })
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        toast({ title: 'Could not connect', description: 'Folder access was cancelled or unavailable.', variant: 'destructive' })
      }
    }
  }, [toast])

  const devReconnect = useCallback(async () => {
    if (!devRoot) return
    if (await requestAccess(devRoot)) setDevAccess('granted')
  }, [devRoot])

  const devGo = useCallback(
    (d: number) =>
      setDevViewer((i) => (i === null || devEntries.length === 0 ? i : (i + d + devEntries.length) % devEntries.length)),
    [devEntries.length]
  )

  const devClose = useCallback(() => setDevViewer(null), [])

  const devItem = devViewer !== null ? devEntries[devViewer] : undefined

  /* Capture-phase keys for the device viewer (isolated from shell handlers) */
  const devViewerOpen = devViewer !== null
  useEffect(() => {
    if (!devViewerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        devClose()
      } else if (e.key === 'ArrowRight') {
        e.stopPropagation()
        devGo(1)
      } else if (e.key === 'ArrowLeft') {
        e.stopPropagation()
        devGo(-1)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [devViewerOpen, devGo, devClose])

  const devDownload = useCallback(
    async (e: DeviceEntry) => {
      try {
        const url = await entryUrl(e)
        const a = document.createElement('a')
        a.href = url
        a.download = e.name
        a.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 4000)
      } catch {
        toast({ title: 'Download failed', description: 'Access may need renewal.', variant: 'destructive' })
      }
    },
    [toast]
  )

  const devDelete = useCallback(
    async (e: DeviceEntry) => {
      try {
        await deleteEntry(e)
        setDevEntries((prev) => prev.filter((x) => x.id !== e.id))
        setDevViewer(null)
        toast({ title: `${e.name} deleted`, description: 'Removed from your device.' })
      } catch {
        toast({ title: 'Could not delete', description: 'The device folder may be read-only or access expired.', variant: 'destructive' })
      }
    },
    [toast]
  )

  /* -------- Initial load (async, cancelled-flag guarded) -------- */
  useEffect(() => {
    let cancelled = false
    void listPhotos().then((all) => {
      if (!cancelled) {
        setPhotos(all)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  /* -------- Derived: albums grouped by month -------- */
  const albums = useMemo(() => {
    const map = new Map<string, PhotoRecord[]>()
    for (const p of photos) {
      const key = monthKey(p.createdAt)
      const arr = map.get(key)
      if (arr) arr.push(p)
      else map.set(key, [p])
    }
    return Array.from(map.entries())
  }, [photos])

  /* -------- Derived: list currently displayed (drives the viewer) -------- */
  const viewList = useMemo(() => {
    if (tab === 'favorites') return photos.filter((p) => p.fav)
    if (tab === 'albums' && openAlbum) return albums.find(([k]) => k === openAlbum)?.[1] ?? []
    return photos
  }, [tab, photos, albums, openAlbum])

  const viewerPhoto = viewerIndex !== null ? viewList[viewerIndex] : undefined

  /* -------- Viewer navigation (wrap-around) -------- */
  const goNext = useCallback(() => {
    setViewerIndex((i) => (i === null || viewList.length === 0 ? i : (i + 1) % viewList.length))
  }, [viewList.length])

  const goPrev = useCallback(() => {
    setViewerIndex((i) =>
      i === null || viewList.length === 0 ? i : (i - 1 + viewList.length) % viewList.length
    )
  }, [viewList.length])

  const closeViewer = useCallback(() => setViewerIndex(null), [])

  /* Capture-phase keyboard: intercept before the app shell's Escape handler */
  const viewerOpen = viewerIndex !== null
  useEffect(() => {
    if (!viewerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeViewer()
      } else if (e.key === 'ArrowRight') {
        e.stopPropagation()
        goNext()
      } else if (e.key === 'ArrowLeft') {
        e.stopPropagation()
        goPrev()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [viewerOpen, goNext, goPrev, closeViewer])

  /* -------- Import (file picker + drag & drop) -------- */
  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const images = Array.from(files).filter((f) => f.type.startsWith('image/'))
      if (images.length === 0) {
        toast({
          title: 'No images found',
          description: 'Drop or choose image files (JPG, PNG, WebP…).',
          variant: 'destructive',
        })
        return
      }
      setImporting(true)
      let ok = 0
      for (const file of images) {
        try {
          const dataUrl = await fileToDataUrl(file)
          await putPhoto({
            id: newPhotoId(),
            dataUrl,
            createdAt: Date.now(),
            fav: false,
            source: 'upload',
            name: file.name,
          })
          ok++
        } catch {
          /* unreadable file — counted below */
        }
      }
      const all = await listPhotos()
      setPhotos(all)
      setImporting(false)
      toast({
        title: `Imported ${ok} photo${ok === 1 ? '' : 's'}`,
        description:
          ok < images.length ? `${images.length - ok} file${images.length - ok === 1 ? '' : 's'} could not be read.` : undefined,
      })
    },
    [toast]
  )

  /* -------- Sample gallery generation -------- */
  const addSamples = useCallback(async () => {
    setSampleBusy(true)
    try {
      const now = Date.now()
      for (let i = 0; i < 10; i++) {
        const dataUrl = generateSampleDataUrl(i)
        if (!dataUrl) continue
        await putPhoto({
          id: newPhotoId(),
          dataUrl,
          // spread across ~6 recent months so Albums looks alive
          createdAt: now - (i * 16 + (i % 4) * 3 + 2) * 86400000,
          fav: i % 4 === 0,
          source: 'upload',
          name: `Sample ${String(i + 1).padStart(2, '0')}`,
        })
        setSampleProgress(i + 1)
        await new Promise((r) => setTimeout(r, 0)) // keep the UI responsive
      }
      const all = await listPhotos()
      setPhotos(all)
      toast({
        title: 'Sample gallery added',
        description: '10 generated artworks saved to your library.',
      })
    } catch {
      toast({ title: 'Could not generate samples', variant: 'destructive' })
    } finally {
      setSampleBusy(false)
      setSampleProgress(0)
    }
  }, [toast])

  /* -------- Favorite toggle (persists to IndexedDB) -------- */
  const togglePhotoFav = useCallback(
    async (photo: PhotoRecord) => {
      const next = !photo.fav
      setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, fav: next } : p)))
      try {
        await toggleFav(photo.id, next)
      } catch {
        setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, fav: !next } : p)))
        toast({ title: 'Could not update favorite', variant: 'destructive' })
        return
      }
      if (tab === 'favorites' && !next) {
        // photo is about to leave the Favorites grid — keep the viewer valid
        const remaining = viewList.filter((p) => p.id !== photo.id)
        setViewerIndex((i) => {
          if (i === null) return null
          if (remaining.length === 0) return null
          return Math.min(i, remaining.length - 1)
        })
      }
    },
    [tab, viewList, toast]
  )

  /* -------- Delete (with confirm) -------- */
  const confirmDelete = useCallback(async () => {
    const target = deleteTarget
    if (!target) return
    setDeleteTarget(null)
    try {
      await deletePhoto(target.id)
      const remaining = viewList.filter((p) => p.id !== target.id)
      setPhotos((prev) => prev.filter((p) => p.id !== target.id))
      setViewerIndex((i) => {
        if (i === null) return null
        if (remaining.length === 0) return null
        return Math.min(i, remaining.length - 1)
      })
      toast({ title: 'Photo deleted' })
    } catch {
      toast({ title: 'Could not delete photo', variant: 'destructive' })
    }
  }, [deleteTarget, viewList, toast])

  /* -------- Tab switch resets album drill-down -------- */
  const handleTabChange = (value: string) => {
    setTab(value as GalleryTab)
    setOpenAlbum(null)
  }

  const showEmptyState = !loading && photos.length === 0 && tab !== 'device'

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div
      className="relative"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        void importFiles(e.dataTransfer.files)
      }}
    >
      {/* Drag & drop overlay */}
      <AnimatePresence>
        {dragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-3xl border-2 border-dashed border-primary bg-background/75 backdrop-blur-sm"
          >
            <div className="flex flex-col items-center gap-2 text-primary">
              <ImagePlus className="size-10" aria-hidden />
              <p className="text-sm font-semibold">Drop images to add them to your library</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {/* Header row */}
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold tracking-tight">Photos</h2>
        <Badge variant="secondary" className="tabular-nums">
          {loading ? '…' : photos.length}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          {importing && (
            <Badge variant="outline" className="gap-1.5">
              <Loader2 className="size-3 animate-spin" aria-hidden /> Importing…
            </Badge>
          )}
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="h-11 rounded-xl shadow-sm"
            aria-label="Add photos from device"
          >
            <Upload className="size-4" aria-hidden />
            <span className="hidden sm:inline">Add photos</span>
          </Button>
        </div>
      </div>

      {/* Segmented tabs */}
      <Tabs value={tab} onValueChange={handleTabChange} className="mt-4">
        <TabsList className="grid h-11 w-full max-w-md grid-cols-4 rounded-xl p-1">
          <TabsTrigger value="photos" className="rounded-lg text-xs sm:text-sm">
            Photos
          </TabsTrigger>
          <TabsTrigger value="device" className="rounded-lg text-xs sm:text-sm">
            Device
          </TabsTrigger>
          <TabsTrigger value="albums" className="rounded-lg text-xs sm:text-sm">
            Albums
          </TabsTrigger>
          <TabsTrigger value="favorites" className="rounded-lg text-xs sm:text-sm">
            Favorites
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* ---------------- Loading skeleton ---------------- */}
      {loading && (
        <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-xl" />
          ))}
        </div>
      )}

      {/* ---------------- First-run empty state ---------------- */}
      {showEmptyState && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="mt-4 flex flex-col items-center rounded-3xl border border-border/70 bg-gradient-to-b from-muted/60 to-background px-6 py-12 text-center shadow-sm"
        >
          <span className="relative flex size-20 items-center justify-center overflow-hidden rounded-[1.4rem] bg-gradient-to-br from-pink-400 via-fuchsia-500 to-purple-600 text-white ring-1 ring-white/25 shadow-[0_18px_40px_-14px_rgb(168_85_247/0.55),inset_0_1px_1px_rgb(255_255_255/0.4)]">
            <Images className="size-9" strokeWidth={1.8} aria-hidden />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
          </span>
          <h3 className="mt-5 text-lg font-bold tracking-tight">Your photo library is empty</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Add photos from your device, drag &amp; drop images here, or generate a sample gallery —
            everything stays on this device.
          </p>
          <div className="mt-6 flex w-full max-w-xs flex-col gap-2.5 sm:max-w-none sm:flex-row">
            <Button
              onClick={() => fileInputRef.current?.click()}
              className="h-11 flex-1 rounded-xl shadow-sm"
            >
              <ImagePlus className="size-4" aria-hidden /> Add photos
            </Button>
            <Button
              variant="outline"
              onClick={() => void addSamples()}
              disabled={sampleBusy}
              className="h-11 flex-1 rounded-xl border-border/80"
            >
              {sampleBusy ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Generating {sampleProgress}/10
                </>
              ) : (
                <>
                  <Sparkles className="size-4" aria-hidden /> Add sample gallery
                </>
              )}
            </Button>
          </div>
        </motion.div>
      )}

      {/* ---------------- On this device (real files, zero upload) ---------------- */}
      {tab === 'device' && (
        !devSupported ? (
          <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <p className="font-semibold">Direct folder access isn’t available in this browser</p>
            <p className="mt-1 text-muted-foreground">
              Use Chrome or Edge (desktop or Android) to see your device’s real photos &amp; videos here. The Photos tab’s
              import button works everywhere.
            </p>
          </div>
        ) : !devRoot ? (
          <div className="mt-4 flex flex-col items-center rounded-3xl border border-border/70 bg-gradient-to-b from-muted/60 to-background px-6 py-10 text-center">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-teal-500 to-emerald-500 text-white shadow-lg shadow-teal-500/25">
              <HardDrive className="size-8" aria-hidden />
            </span>
            <h3 className="mt-4 text-lg font-bold tracking-tight">Show your device’s photos &amp; videos</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Connect your Pictures folder (or any folder) once — everything in it appears here automatically from then
              on. Nothing is uploaded; files stay on your device.
            </p>
            <Button
              onClick={() => void devConnect()}
              className="mt-5 h-11 gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 px-6 text-white shadow-lg shadow-teal-500/25 hover:from-cyan-400 hover:to-teal-400"
              size="lg"
            >
              <Link2 className="size-4" aria-hidden /> Connect a folder
            </Button>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5" aria-hidden /> Read-only · revoke anytime · never leaves this device
            </p>
          </div>
        ) : devAccess !== 'granted' ? (
          <div className="mt-4 flex flex-col items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">“{devRoot.name}” needs permission again</p>
              <p className="text-xs text-muted-foreground">One tap to re-allow, then your library reloads instantly.</p>
            </div>
            <Button onClick={() => void devReconnect()} className="h-10 rounded-xl bg-amber-500 text-black hover:bg-amber-400">
              <ShieldCheck className="size-4" aria-hidden /> Re-allow
            </Button>
          </div>
        ) : devBusy && devEntries.length === 0 ? (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-xl" />
            ))}
          </div>
        ) : devEntries.length === 0 ? (
          <div className="mt-4 flex flex-col items-center rounded-3xl border border-border/70 bg-muted/30 px-6 py-12 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-teal-500/10 text-teal-500">
              <Images className="size-7" aria-hidden />
            </span>
            <h3 className="mt-4 text-base font-semibold">No media found in “{devRoot.name}”</h3>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Connect a folder that contains photos or videos — or add files to it, then press refresh.
            </p>
            <Button variant="outline" onClick={() => void loadDevice(true)} disabled={devBusy} className="mt-4 h-10 gap-2 rounded-xl">
              <RefreshCw className="size-4" aria-hidden /> Refresh
            </Button>
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-center justify-between px-0.5">
              <p className="text-xs text-muted-foreground">
                {devEntries.length.toLocaleString('en-US')} item{devEntries.length === 1 ? '' : 's'} from “{devRoot.name}” — live from your device
              </p>
              <Button variant="ghost" size="sm" onClick={() => void loadDevice(true)} disabled={devBusy} className="h-8 gap-1.5 rounded-lg text-xs text-muted-foreground" aria-label="Refresh device media">
                <RefreshCw className={cn('size-3.5', devBusy && 'animate-spin')} aria-hidden /> Refresh
              </Button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6" role="list" aria-label="Device media">
              {devEntries.map((e, i) => (
                <DeviceCard key={e.id} entry={e} index={i} onOpen={setDevViewer} />
              ))}
            </div>
          </>
        )
      )}

      {/* ---------------- Photos grid (or album drill-down) ---------------- */}
      {!loading && photos.length > 0 && (
        <>
          {tab === 'albums' && openAlbum ? (
            <div className="mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpenAlbum(null)}
                className="-ml-2 h-11 gap-1.5 rounded-xl text-muted-foreground"
                aria-label="Back to albums"
              >
                <ChevronLeft className="size-4" aria-hidden /> Albums
              </Button>
              <div className="mt-1 flex items-center gap-2">
                <h3 className="text-lg font-bold tracking-tight">{openAlbum}</h3>
                <Badge variant="secondary" className="tabular-nums">
                  {viewList.length}
                </Badge>
              </div>
              <PhotoGrid photos={viewList} onOpen={setViewerIndex} />
            </div>
          ) : (
            <>
              {tab === 'photos' && <PhotoGrid photos={photos} onOpen={setViewerIndex} />}
              {tab === 'favorites' && (
                <div className="mt-4">
                  {viewList.length === 0 ? (
                    <div className="flex flex-col items-center rounded-3xl border border-border/70 bg-muted/30 px-6 py-12 text-center">
                      <span className="flex size-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-500">
                        <Heart className="size-7" aria-hidden />
                      </span>
                      <h3 className="mt-4 text-base font-semibold">No favorites yet</h3>
                      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                        Open a photo and tap the heart to keep it here.
                      </p>
                    </div>
                  ) : (
                    <PhotoGrid photos={viewList} onOpen={setViewerIndex} />
                  )}
                </div>
              )}
              {tab === 'albums' && (
                <div className="mt-4 space-y-3">
                  {albums.length === 0 && (
                    <p className="py-10 text-center text-sm text-muted-foreground">No albums yet</p>
                  )}
                  {albums.map(([key, items], idx) => (
                    <motion.button
                      key={key}
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(idx, 8) * 0.05, type: 'spring', stiffness: 300, damping: 26 }}
                      onClick={() => setOpenAlbum(key)}
                      aria-label={`Open album ${key}, ${items.length} photos`}
                      className="group flex w-full items-center gap-4 rounded-2xl border border-border/70 bg-card p-3 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="grid size-[76px] shrink-0 grid-cols-2 gap-0.5 overflow-hidden rounded-xl bg-muted">
                        {items.slice(0, 4).map((p) => (
                          <img
                            key={p.id}
                            src={p.dataUrl}
                            alt=""
                            className="h-full w-full object-cover"
                            loading="lazy"
                          />
                        ))}
                        {items.length < 4 &&
                          Array.from({ length: 4 - items.length }).map((_, i) => (
                            <div key={`pad-${i}`} className="bg-muted/60" />
                          ))}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold">{key}</p>
                        <p className="text-xs text-muted-foreground">
                          {items.length} photo{items.length === 1 ? '' : 's'} ·{' '}
                          {shortDate(items[items.length - 1].createdAt)} – {shortDate(items[0].createdAt)}
                        </p>
                      </div>
                      <ChevronRight
                        className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </motion.button>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ---------------- Fullscreen viewer ---------------- */}
      <AnimatePresence>
        {viewerPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-md"
            role="dialog"
            aria-label="Photo viewer"
          >
            {/* Top bar */}
            <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.9rem,env(safe-area-inset-top))] text-white">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {viewerPhoto.name ?? 'Photo'}
                </p>
                <p className="truncate text-xs text-white/60">
                  {(viewerIndex ?? 0) + 1} of {viewList.length} · {shortDate(viewerPhoto.createdAt)}
                  {viewerPhoto.source === 'camera' ? ' · Camera' : viewerPhoto.source === 'video' ? ' · Video frame' : viewerPhoto.source === 'design' ? ' · Design' : ''}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={closeViewer}
                aria-label="Close viewer"
                className="size-11 rounded-full text-white hover:bg-white/15 hover:text-white"
              >
                <X className="size-5" aria-hidden />
              </Button>
            </div>

            {/* Image stage */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
              <AnimatePresence mode="wait">
                <motion.img
                  key={viewerPhoto.id}
                  src={viewerPhoto.dataUrl}
                  alt={viewerPhoto.name ?? `Photo from ${monthKey(viewerPhoto.createdAt)}`}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
                  draggable={false}
                />
              </AnimatePresence>
            </div>

            {/* Action bar */}
            <div className="flex items-center justify-center gap-1.5 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:gap-2">
              <ViewerAction label="Previous photo" onClick={goPrev} disabled={viewList.length < 2}>
                <ChevronLeft className="size-5" aria-hidden />
              </ViewerAction>
              <ViewerAction
                label={viewerPhoto.fav ? 'Remove from favorites' : 'Add to favorites'}
                onClick={() => void togglePhotoFav(viewerPhoto)}
                active={viewerPhoto.fav}
                activeClass="bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 hover:text-rose-300"
              >
                <Heart className={cn('size-5', viewerPhoto.fav && 'fill-current')} aria-hidden />
              </ViewerAction>
              <ViewerAction label="Download photo" asChild>
                <a href={viewerPhoto.dataUrl} download={downloadName(viewerPhoto)}>
                  <Download className="size-5" aria-hidden />
                </a>
              </ViewerAction>
              <ViewerAction
                label="Delete photo"
                onClick={() => setDeleteTarget(viewerPhoto)}
                activeClass="bg-red-500/15 text-red-400 hover:bg-red-500/25 hover:text-red-300"
              >
                <Trash2 className="size-5" aria-hidden />
              </ViewerAction>
              <ViewerAction label="Next photo" onClick={goNext} disabled={viewList.length < 2}>
                <ChevronRight className="size-5" aria-hidden />
              </ViewerAction>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Device file viewer (real files) ---------------- */}
      <AnimatePresence>
        {devItem && (
          <DeviceViewer
            item={devItem}
            index={devViewer ?? 0}
            total={devEntries.length}
            onClose={devClose}
            onNav={devGo}
            onDownload={devDownload}
            onDelete={(e) => setDevDeleteTarget(e)}
          />
        )}
      </AnimatePresence>

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.name ?? 'This photo'} will be permanently removed from your library. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Device file delete confirmation */}
      <AlertDialog open={devDeleteTarget !== null} onOpenChange={(open) => !open && setDevDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {devDeleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This file will be permanently removed from your device. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const t = devDeleteTarget
                setDevDeleteTarget(null)
                if (t) void devDelete(t)
              }}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/* ================================================================== */
/* Photo grid                                                          */
/* ================================================================== */

function PhotoGrid({
  photos,
  onOpen,
}: {
  photos: PhotoRecord[]
  onOpen: (index: number) => void
}) {
  return (
    <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6" role="list" aria-label="Photo grid">
      {photos.map((p, i) => (
        <motion.div
          key={p.id}
          role="listitem"
          initial={{ opacity: 0, y: 14, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ delay: Math.min(i, 16) * 0.035, type: 'spring', stiffness: 320, damping: 28 }}
        >
          <button
            onClick={() => onOpen(i)}
            aria-label={`Open photo ${p.name ?? shortDate(p.createdAt)}`}
            className="group relative block aspect-square w-full overflow-hidden rounded-xl bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <img
              src={p.dataUrl}
              alt={p.name ?? `Photo from ${monthKey(p.createdAt)}`}
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.06]"
            />
            <span className="pointer-events-none absolute inset-0 rounded-xl ring-0 ring-primary/70 transition-all duration-200 group-hover:ring-2" />
            {p.fav && (
              <span className="absolute right-1.5 top-1.5 rounded-full bg-black/45 p-1 backdrop-blur-sm">
                <Heart className="size-3 fill-rose-400 text-rose-400" aria-hidden />
              </span>
            )}
          </button>
        </motion.div>
      ))}
    </div>
  )
}

/* ================================================================== */
/* Viewer action button (glassy, 44px target)                          */
/* ================================================================== */

function ViewerAction({
  label,
  onClick,
  children,
  disabled,
  active,
  activeClass,
  asChild,
}: {
  label: string
  onClick?: () => void
  children: ReactNode
  disabled?: boolean
  active?: boolean
  activeClass?: string
  asChild?: boolean
}) {
  const cls = cn(
    'size-11 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white sm:size-12',
    active && activeClass
  )
  if (asChild) {
    return (
      <Button variant="ghost" size="icon" aria-label={label} className={cls} asChild>
        {children}
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cls}
    >
      {children}
    </Button>
  )
}

/* ================================================================== */
/* Device media card + viewer (real files via File System Access API)  */
/* ================================================================== */

function DeviceCard({
  entry,
  index,
  onOpen,
}: {
  entry: DeviceEntry
  index: number
  onOpen: (index: number) => void
}) {
  const thumb = useDeviceThumb(entry)
  return (
    <motion.button
      type="button"
      role="listitem"
      initial={{ opacity: 0, y: 12, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: Math.min(index, 16) * 0.025, type: 'spring', stiffness: 320, damping: 28 }}
      onClick={() => onOpen(index)}
      aria-label={`Open ${entry.name}`}
      className="group relative block aspect-square overflow-hidden rounded-xl bg-muted ring-1 ring-border transition-shadow hover:ring-2 hover:ring-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.05]"
        />
      ) : (
        <span
          className={cn(
            'grid size-full place-items-center text-white',
            entry.kind === 'video'
              ? 'bg-gradient-to-br from-rose-400 via-red-500 to-orange-500'
              : 'bg-gradient-to-br from-fuchsia-400 via-purple-500 to-indigo-400'
          )}
        >
          {entry.kind === 'video' ? <Film className="size-7" aria-hidden /> : <Images className="size-7" aria-hidden />}
        </span>
      )}
      {entry.kind === 'video' && (
        <span className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
          <Play className="size-3 fill-current" aria-hidden />
        </span>
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-5 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
        {entry.name}
      </span>
    </motion.button>
  )
}

function DeviceViewer({
  item,
  index,
  total,
  onClose,
  onNav,
  onDownload,
  onDelete,
}: {
  item: DeviceEntry
  index: number
  total: number
  onClose: () => void
  onNav: (delta: number) => void
  onDownload: (e: DeviceEntry) => void
  onDelete: (e: DeviceEntry) => void
}) {
  const [loaded, setLoaded] = useState<{ id: string; url: string | null; failed: boolean }>({
    id: item.id,
    url: null,
    failed: false,
  })

  // Derived-state reset when the item changes (no synchronous effect churn).
  if (loaded.id !== item.id) {
    setLoaded({ id: item.id, url: null, failed: false })
  }

  useEffect(() => {
    if (loaded.id !== item.id || loaded.url || loaded.failed) return
    let dead = false
    let made: string | undefined
    entryUrl(item)
      .then((u) => {
        if (dead) {
          URL.revokeObjectURL(u)
          return
        }
        made = u
        setLoaded({ id: item.id, url: u, failed: false })
      })
      .catch(() => !dead && setLoaded({ id: item.id, url: null, failed: true }))
    return () => {
      dead = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [item, loaded])

  const url = loaded.url
  const failed = loaded.failed

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-md"
      role="dialog"
      aria-label="Device file viewer"
    >
      <div className="flex items-center gap-3 px-4 pb-2 pt-[max(0.9rem,env(safe-area-inset-top))] text-white">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.name}</p>
          <p className="truncate text-xs text-white/60">
            {index + 1} of {total} · live from your device
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close viewer"
          className="size-11 rounded-full text-white hover:bg-white/15 hover:text-white"
        >
          <X className="size-5" aria-hidden />
        </Button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
        {failed ? (
          <div className="max-w-xs text-center text-sm text-white/70">
            <p className="font-semibold text-white">Could not open this file</p>
            <p className="mt-1">Device access may have expired — go back and press Refresh to re-index.</p>
          </div>
        ) : !url ? (
          <Loader2 className="size-8 animate-spin text-white/60" aria-hidden />
        ) : item.kind === 'video' ? (
          <motion.video
            key={item.id}
            src={url}
            controls
            autoPlay
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="max-h-full max-w-full rounded-lg bg-black shadow-2xl"
          />
        ) : (
          <motion.img
            key={item.id}
            src={url}
            alt={item.name}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            draggable={false}
          />
        )}
      </div>

      <div className="flex items-center justify-center gap-1.5 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 sm:gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onNav(-1)}
          disabled={total < 2}
          aria-label="Previous item"
          className="size-11 rounded-full text-white hover:bg-white/15 hover:text-white"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDownload(item)}
          aria-label="Download file"
          className="size-11 rounded-full text-white hover:bg-white/15 hover:text-white"
        >
          <Download className="size-5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onDelete(item)}
          aria-label="Delete file from device"
          className="size-11 rounded-full text-red-400 hover:bg-red-500/20 hover:text-red-300"
        >
          <Trash2 className="size-5" aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onNav(1)}
          disabled={total < 2}
          aria-label="Next item"
          className="size-11 rounded-full text-white hover:bg-white/15 hover:text-white"
        >
          <ChevronRight className="size-5" aria-hidden />
        </Button>
      </div>
    </motion.div>
  )
}
