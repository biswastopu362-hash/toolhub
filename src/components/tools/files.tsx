'use client'

/**
 * Files — native-style device file manager.
 *
 * Connect a real device folder once (File System Access API) and browse,
 * preview, download or delete EVERYTHING on it — photos, videos, music,
 * documents — with zero uploading. Everything stays on the device.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Download,
  File as FileIcon,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder as FolderIcon,
  FolderOpen,
  FolderUp,
  HardDrive,
  Link2,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Unlink,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
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
  disconnectRoot,
  DeviceRootMissingError,
  ensureFreshIndex,
  entryUrl,
  fsSupported,
  indexMeta,
  indexRoot,
  listEntries,
  requestAccess,
  type DeviceEntry,
  type DeviceKind,
  type DeviceMeta,
  type FsDirHandle,
} from '@/lib/device-media'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

type Filter = 'all' | DeviceKind

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
  { id: 'file', label: 'Docs' },
]

function fmtBytes(n: number): string {
  if (!n) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`
}

function fmtWhen(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay
    ? d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

function KindIcon({ entry, className }: { entry: DeviceEntry; className?: string }) {
  if (entry.dir) return <FolderIcon className={cn(className, 'text-amber-400')} aria-hidden />
  if (entry.kind === 'image') return <FileImage className={cn(className, 'text-fuchsia-400')} aria-hidden />
  if (entry.kind === 'video') return <FileVideo className={cn(className, 'text-rose-400')} aria-hidden />
  if (entry.kind === 'audio') return <FileAudio className={cn(className, 'text-teal-400')} aria-hidden />
  if (['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'].includes(entry.ext))
    return <FileText className={cn(className, 'text-emerald-400')} aria-hidden />
  return <FileIcon className={cn(className, 'text-zinc-400')} aria-hidden />
}

/* ------------------------------------------------------------------ */
/* File row                                                            */
/* ------------------------------------------------------------------ */

function Row({
  entry,
  onOpen,
  onDownload,
  onDelete,
}: {
  entry: DeviceEntry
  onOpen: (e: DeviceEntry) => void
  onDownload: (e: DeviceEntry) => void
  onDelete: (e: DeviceEntry) => void
}) {
  const thumb = useDeviceThumb(!entry.dir && (entry.kind === 'image' || entry.kind === 'video') ? entry : undefined)

  return (
    <div
      className={cn(
        'group flex min-h-[52px] items-center gap-3 rounded-xl px-2 py-1.5 transition-colors',
        'hover:bg-primary/5 focus-within:bg-primary/5'
      )}
    >
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={entry.dir ? `Open folder ${entry.name}` : `Open ${entry.name}`}
      >
        <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted ring-1 ring-border">
          {thumb ? (
            <img src={thumb} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <KindIcon entry={entry} className="size-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{entry.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {entry.dir ? 'Folder' : `${fmtBytes(entry.size)}${entry.lastModified ? ` · ${fmtWhen(entry.lastModified)}` : ''}`}
          </span>
        </span>
        {!entry.dir && (
          <span className="hidden shrink-0 items-center gap-1 sm:flex">
            <Badge variant="secondary" className="uppercase">
              {entry.ext || 'bin'}
            </Badge>
          </span>
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
        {!entry.dir && (
          <Button variant="ghost" size="icon" className="size-9" onClick={() => onDownload(entry)} aria-label={`Download ${entry.name}`}>
            <Download className="size-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="size-9 text-destructive hover:text-destructive"
          onClick={() => onDelete(entry)}
          aria-label={`Delete ${entry.name}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}

/* ================================================================== */
/* App                                                                 */
/* ================================================================== */

export default function FilesApp() {
  const { toast } = useToast()

  const [supported] = useState(() => fsSupported())
  const [root, setRoot] = useState<FsDirHandle | undefined>(undefined)
  const [access, setAccess] = useState<'none' | PermissionState>('none')
  const [meta, setMeta] = useState<DeviceMeta | undefined>(undefined)
  const [idxBusy, setIdxBusy] = useState(false)
  const [idxCount, setIdxCount] = useState(0)

  const [path, setPath] = useState<string[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [rows, setRows] = useState<DeviceEntry[]>([])

  const [imgView, setImgView] = useState<{ entry: DeviceEntry; url: string } | null>(null)
  const [vidView, setVidView] = useState<{ entry: DeviceEntry; url: string } | null>(null)
  const [audio, setAudio] = useState<{ entry: DeviceEntry; url: string } | null>(null)
  const [audioPlaying, setAudioPlaying] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<DeviceEntry | null>(null)
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  /** guards openEntry against out-of-order async resolutions */
  const openTokenRef = useRef(0)

  /* latest preview URLs for unmount cleanup (closing the app mid-preview
   * must not leak blob URLs / pin huge File objects) */
  const previewUrlsRef = useRef<{ img?: string; vid?: string; audio?: string }>({})
  useEffect(() => {
    previewUrlsRef.current = { img: imgView?.url, vid: vidView?.url, audio: audio?.url }
  }, [imgView, vidView, audio])
  useEffect(
    () => () => {
      const p = previewUrlsRef.current
      if (p.img) URL.revokeObjectURL(p.img)
      if (p.vid) URL.revokeObjectURL(p.vid)
      if (p.audio) URL.revokeObjectURL(p.audio)
    },
    []
  )

  /* -------- boot: restore root handle + access state -------- */
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const handle = await (await import('@/lib/device-media')).getRoot()
      if (cancelled) return
      setRoot(handle)
      if (!handle) {
        setAccess('none')
        return
      }
      const st = await accessState(handle)
      if (cancelled) return
      setAccess(st)
      if (st === 'granted') {
        setIdxBusy(true)
        void ensureFreshIndex(10 * 60_000, (n) => !cancelled && setIdxCount(Math.max(0, n)))
          .then((m) => !cancelled && setMeta(m))
          .catch((err) => {
            if (cancelled) return
            if (err instanceof DeviceRootMissingError) {
              toast({
                title: 'Connected folder is gone',
                description: `“${handle.name}” was moved, renamed or deleted — disconnect and connect it again.`,
                variant: 'destructive',
              })
            }
          })
          .finally(() => !cancelled && setIdxBusy(false))
      }
      void navigator.storage?.estimate?.().then((est) => {
        if (!cancelled && est) setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 })
      })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /* -------- keep meta fresh when other apps re-index -------- */
  useEffect(() => {
    const onIndexed = () => void indexMeta().then(setMeta)
    window.addEventListener('toolhub:device-indexed', onIndexed)
    return () => window.removeEventListener('toolhub:device-indexed', onIndexed)
  }, [])

  /* -------- listing for current path + filter -------- */
  const parentId = useMemo(() => path.join('/'), [path])
  useEffect(() => {
    let cancelled = false
    void listEntries({ parent: parentId }).then((children) => {
      if (cancelled) return
      const filtered = filter === 'all' ? children : children.filter((e) => e.dir || e.kind === filter)
      setRows(filtered)
    })
    return () => {
      cancelled = true
    }
  }, [parentId, filter, meta])

  /* -------- audio element sync -------- */
  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onEnd = () => setAudioPlaying(false)
    el.addEventListener('ended', onEnd)
    return () => el.removeEventListener('ended', onEnd)
  }, [audio])

  const revokeAudio = useCallback(() => {
    if (audio) URL.revokeObjectURL(audio.url)
  }, [audio])

  /* Escape closes the image lightbox / video modal (same as Gallery's viewer) */
  const previewOpen = imgView !== null || vidView !== null
  const closePreview = useCallback(() => {
    if (imgView) {
      URL.revokeObjectURL(imgView.url)
      setImgView(null)
    }
    if (vidView) {
      URL.revokeObjectURL(vidView.url)
      setVidView(null)
    }
  }, [imgView, vidView])
  useEffect(() => {
    if (!previewOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closePreview()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [previewOpen, closePreview])

  /* -------- actions -------- */

  const doIndex = useCallback(
    async (handle: FsDirHandle) => {
      setIdxBusy(true)
      setIdxCount(0)
      try {
        const m = await indexRoot(handle, (n) => setIdxCount(Math.max(0, n)))
        setMeta(m)
        if (m.partial) {
          toast({
            title: 'Large folder — index is partial',
            description: `${m.count.toLocaleString('en-US')} of ${m.count.toLocaleString('en-US')}+ items indexed from “${handle.name}” (25,000-item safety limit).`,
          })
        } else {
          toast({
            title: 'Device library updated',
            description: `${m.count.toLocaleString('en-US')} items indexed from “${handle.name}”.`,
          })
        }
      } catch (err) {
        if (err instanceof DeviceRootMissingError) {
          toast({
            title: 'Folder not found',
            description: '“' + handle.name + '” was moved or deleted — disconnect and connect it again.',
            variant: 'destructive',
          })
        } else {
          toast({ title: 'Indexing failed', description: 'Could not read the connected folder.', variant: 'destructive' })
        }
      } finally {
        setIdxBusy(false)
      }
    },
    [toast]
  )

  const onConnect = useCallback(async () => {
    try {
      const handle = await connectRoot()
      setRoot(handle)
      const st = await accessState(handle)
      setAccess(st)
      await doIndex(handle)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        toast({
          title: 'Could not connect',
          description: 'Folder access was cancelled or is unavailable in this browser.',
          variant: 'destructive',
        })
      }
    }
  }, [doIndex, toast])

  const onReconnect = useCallback(async () => {
    if (!root) return
    const ok = await requestAccess(root)
    if (ok) {
      setAccess('granted')
      await doIndex(root)
    } else {
      toast({ title: 'Access denied', description: 'Grant read access to browse this folder.', variant: 'destructive' })
    }
  }, [root, doIndex, toast])

  const onRefresh = useCallback(() => {
    if (root && access === 'granted') void doIndex(root)
  }, [root, access, doIndex])

  const onDisconnect = useCallback(async () => {
    revokeAudio()
    await disconnectRoot()
    setRoot(undefined)
    setAccess('none')
    setMeta(undefined)
    setPath([])
    toast({ title: 'Device disconnected', description: 'The connected folder was removed from the hub.' })
  }, [revokeAudio, toast])

  const openEntry = useCallback(
    async (e: DeviceEntry) => {
      if (e.dir) {
        revokeAudio()
        setAudio(null)
        setPath((p) => [...p, e.name])
        return
      }
      // token guards against slow getFile() resolving out of order — a stale
      // result must never overwrite a newer pick (and its URL is revoked)
      const token = ++openTokenRef.current
      if (e.kind === 'image' || e.kind === 'video') {
        try {
          const url = await entryUrl(e)
          if (openTokenRef.current !== token) {
            URL.revokeObjectURL(url)
            return
          }
          if (e.kind === 'image') {
            setImgView((prev) => {
              if (prev) URL.revokeObjectURL(prev.url)
              return { entry: e, url }
            })
          } else {
            setVidView((prev) => {
              if (prev) URL.revokeObjectURL(prev.url)
              return { entry: e, url }
            })
          }
        } catch {
          toast({ title: 'Cannot open file', description: 'Access may need renewal — press Refresh.', variant: 'destructive' })
        }
        return
      }
      if (e.kind === 'audio') {
        try {
          revokeAudio()
          setAudio(null)
          const url = await entryUrl(e)
          if (openTokenRef.current !== token) {
            URL.revokeObjectURL(url)
            return
          }
          setAudio({ entry: e, url })
          setAudioPlaying(true)
          window.setTimeout(() => {
            const el = audioRef.current
            if (el) void el.play().catch(() => setAudioPlaying(false))
          }, 50)
        } catch {
          toast({ title: 'Cannot play audio', description: 'Access may need renewal — press Refresh.', variant: 'destructive' })
        }
        return
      }
      toast({
        title: e.name,
        description: `No preview for .${e.ext || 'bin'} — use the download button.`,
      })
    },
    [revokeAudio, toast]
  )

  const download = useCallback(
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

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    try {
      const n = await deleteEntry(target)
      toast({ title: `Deleted ${target.name}`, description: n > 1 ? `${n - 1} nested items also removed.` : undefined })
      const children = await listEntries({ parent: parentId })
      setRows(filter === 'all' ? children : children.filter((c) => c.dir || c.kind === filter))
      void indexMeta().then(setMeta)
    } catch {
      toast({ title: 'Delete failed', description: 'The folder may be read-only or access expired.', variant: 'destructive' })
    }
  }, [deleteTarget, parentId, filter, toast])

  /* -------- render -------- */

  const connected = Boolean(root) && access === 'granted'
  const needsReconnect = Boolean(root) && access !== 'granted'
  const showSkeleton = connected && !meta && !idxBusy

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      {/* header */}
      <div className="border-b bg-card/60 px-3 py-2.5 backdrop-blur-xl sm:px-5">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-2">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-lime-400 via-green-500 to-emerald-600 text-white shadow-md">
            <HardDrive className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold tracking-tight">Files</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {root
                ? connected
                  ? `“${root.name}” connected — ${meta ? `${meta.count.toLocaleString('en-US')} items` : idxBusy ? 'indexing…' : 'ready'}`
                  : 'Access needs renewal'
                : 'No device folder connected'}
            </p>
          </div>
          {connected && (
            <>
              <Button variant="ghost" size="icon" className="size-9" onClick={onRefresh} disabled={idxBusy} aria-label="Refresh device index">
                <RefreshCw className={cn('size-4', idxBusy && 'animate-spin')} />
              </Button>
              <Button variant="ghost" size="icon" className="size-9 text-muted-foreground hover:text-destructive" onClick={onDisconnect} aria-label="Disconnect device folder">
                <Unlink className="size-4" />
              </Button>
            </>
          )}
        </div>
        {idxBusy && (
          <div className="mx-auto mt-2 flex w-full max-w-4xl items-center gap-2">
            <Progress value={Math.min(96, (idxCount / 400) * 100)} className="h-1.5 flex-1" />
            <span className="text-[11px] tabular-nums text-muted-foreground">{idxCount > 0 ? `${idxCount.toLocaleString('en-US')}` : ''}</span>
          </div>
        )}
      </div>

      {/* body */}
      <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-3 py-3 sm:px-5">
        {/* not supported (iOS / Firefox) */}
        {!supported && (
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
            <p className="font-semibold text-foreground">Direct folder access isn’t available here</p>
            <p className="mt-1 text-muted-foreground">
              This browser doesn’t support the File System Access API (typical on iPhone/iPad). Please use Chrome or Edge —
              on desktop or Android — to browse your device’s real files. Gallery’s import button still works everywhere.
            </p>
          </div>
        )}

        {/* connect hero */}
        {supported && !root && (
          <div className="mt-6 flex flex-col items-center px-2 text-center">
            <span className="grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-lime-400 via-green-500 to-emerald-600 text-white shadow-xl shadow-emerald-500/25">
              <FolderOpen className="size-10" aria-hidden />
            </span>
            <h3 className="mt-4 text-xl font-bold tracking-tight">Your whole device, one tap away</h3>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              Connect any folder — Pictures, Music, Downloads or your whole user directory. Photos, videos, songs and
              documents appear instantly. Nothing is uploaded: files stay on your device, exactly like native software.
            </p>
            <Button onClick={onConnect} className="mt-5 h-11 gap-2 rounded-xl bg-gradient-to-r from-lime-500 to-emerald-600 px-6 text-white shadow-lg shadow-emerald-500/25 hover:from-lime-400 hover:to-emerald-500" size="lg">
              <Link2 className="size-4" aria-hidden /> Connect a device folder
            </Button>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5" aria-hidden /> Private to this device · revoke anytime · nothing is uploaded
            </p>
          </div>
        )}

        {/* reconnect banner */}
        {needsReconnect && (
          <div className="flex flex-col items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">“{root?.name}” needs permission again</p>
              <p className="text-xs text-muted-foreground">Browsers require a quick re-allow between sessions — one tap, then everything reloads.</p>
            </div>
            <Button onClick={onReconnect} className="h-10 gap-2 rounded-xl bg-amber-500 text-black hover:bg-amber-400">
              <ShieldCheck className="size-4" aria-hidden /> Re-allow access
            </Button>
          </div>
        )}

        {/* browser */}
        {connected && (
          <>
            {/* breadcrumbs */}
            <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap rounded-xl bg-muted/60 px-2 py-1.5 text-xs">
              {path.length > 0 && (
                <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => setPath((p) => p.slice(0, -1))} aria-label="Up one folder">
                  <FolderUp className="size-3.5" />
                </Button>
              )}
              <button
                type="button"
                onClick={() => setPath([])}
                className="shrink-0 rounded-md px-1.5 py-0.5 font-semibold text-foreground hover:bg-background"
              >
                {root?.name ?? 'Root'}
              </button>
              {path.map((seg, i) => (
                <span key={seg + i} className="flex shrink-0 items-center">
                  <span className="text-muted-foreground">/</span>
                  <button
                    type="button"
                    onClick={() => setPath((p) => p.slice(0, i + 1))}
                    className={cn(
                      'rounded-md px-1.5 py-0.5 hover:bg-background',
                      i === path.length - 1 ? 'font-semibold text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {seg}
                  </button>
                </span>
              ))}
            </div>

            {/* filter chips */}
            <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  aria-pressed={filter === f.id}
                  className={cn(
                    'min-h-8 shrink-0 rounded-full px-3 text-xs font-semibold transition-colors',
                    filter === f.id
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* rows */}
            {showSkeleton ? (
              <div className="space-y-1 py-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-2 py-1.5">
                    <div className="size-10 animate-pulse rounded-lg bg-muted" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                      <div className="h-2.5 w-1/5 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
                <FolderOpen className="size-8" aria-hidden />
                <p className="text-sm">{filter === 'all' ? 'This folder is empty.' : `No ${FILTERS.find((f) => f.id === filter)?.label.toLowerCase()} in this folder.`}</p>
              </div>
            ) : (
              <motion.div layout className="divide-y divide-border/60">
                {rows.map((e) => (
                  <Row key={e.id} entry={e} onOpen={openEntry} onDownload={download} onDelete={setDeleteTarget} />
                ))}
              </motion.div>
            )}

            {/* footer stats */}
            {meta && (
              <div className="mt-4 rounded-2xl border bg-card/70 p-3 text-[11px] text-muted-foreground">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-semibold text-foreground">{meta.count.toLocaleString('en-US')} items indexed</span>
                  <span>· updated {fmtWhen(meta.at)}</span>
                  {storage && storage.quota > 0 && (
                    <span>
                      · app storage {fmtBytes(storage.usage)} of {fmtBytes(storage.quota)}
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* audio mini-player */}
      {audio && (
        <div className="border-t bg-card/90 px-3 py-2 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-4xl items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-teal-400 to-emerald-600 text-white">
              <FileAudio className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{audio.entry.name}</p>
              <p className="text-[10px] text-muted-foreground">{audio.entry.segs.slice(0, -1).join('/') || 'Device'}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-full"
              onClick={() => {
                const el = audioRef.current
                if (!el) return
                if (audioPlaying) {
                  el.pause()
                  setAudioPlaying(false)
                } else {
                  void el.play().catch(() => {})
                  setAudioPlaying(true)
                }
              }}
              aria-label={audioPlaying ? 'Pause' : 'Play'}
            >
              {audioPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-full"
              onClick={() => {
                revokeAudio()
                setAudio(null)
                setAudioPlaying(false)
              }}
              aria-label="Close player"
            >
              <X className="size-4" />
            </Button>
          </div>
          <audio
            ref={audioRef}
            src={audio.url}
            onPlay={() => setAudioPlaying(true)}
            onPause={() => setAudioPlaying(false)}
            className="hidden"
          />
        </div>
      )}

      {/* image lightbox */}
      {imgView && (
        <div
          className="absolute inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
          role="dialog"
          aria-label={`Preview ${imgView.entry.name}`}
          onClick={() => {
            URL.revokeObjectURL(imgView.url)
            setImgView(null)
          }}
        >
          <div className="flex items-center gap-2 p-3 text-white" onClick={(e) => e.stopPropagation()}>
            <p className="min-w-0 flex-1 truncate text-sm font-medium">{imgView.entry.name}</p>
            <Button variant="ghost" size="icon" className="size-9 text-white hover:bg-white/15" onClick={() => void download(imgView.entry)} aria-label="Download">
              <Download className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-white hover:bg-white/15"
              onClick={() => {
                URL.revokeObjectURL(imgView.url)
                setImgView(null)
              }}
              aria-label="Close preview"
            >
              <X className="size-5" />
            </Button>
          </div>
          <div className="flex flex-1 items-center justify-center p-4">
            <img src={imgView.url} alt={imgView.entry.name} className="max-h-full max-w-full rounded-lg object-contain shadow-2xl" />
          </div>
        </div>
      )}

      {/* video modal */}
      {vidView && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-sm"
          role="dialog"
          aria-label={`Play ${vidView.entry.name}`}
          onClick={() => {
            URL.revokeObjectURL(vidView.url)
            setVidView(null)
          }}
        >
          <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center gap-2 text-white">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{vidView.entry.name}</p>
              <Button variant="ghost" size="icon" className="size-9 text-white hover:bg-white/15" onClick={() => void download(vidView.entry)} aria-label="Download">
                <Download className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 text-white hover:bg-white/15"
                onClick={() => {
                  URL.revokeObjectURL(vidView.url)
                  setVidView(null)
                }}
                aria-label="Close player"
              >
                <X className="size-5" />
              </Button>
            </div>
            <video src={vidView.url} controls autoPlay className="max-h-[70vh] w-full rounded-xl bg-black shadow-2xl" />
          </div>
        </div>
      )}

      {/* delete confirm */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.dir
                ? 'The folder and everything inside it will be removed from your device permanently.'
                : 'This file will be removed from your device permanently.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
