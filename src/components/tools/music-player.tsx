'use client'

/**
 * Music Player — local audio library persisted in its own IndexedDB
 * ('toolhub-audio' / 'tracks'), Web Audio visualizer, full transport
 * controls and a phone-OS style playlist.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ListMusic,
  Music,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* IndexedDB — tiny private store for imported audio tracks            */
/* ================================================================== */

interface TrackRecord {
  id: string
  name: string
  dataUrl: string
  addedAt: number
}

const AUDIO_DB = 'toolhub-audio'
const AUDIO_DB_VERSION = 1
const AUDIO_STORE = 'tracks'
const MP_KEY = 'toolhub.music-player.state'
const MAX_FILE_BYTES = 25 * 1024 * 1024
const BAR_COUNT = 32

function openAudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(AUDIO_DB, AUDIO_DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open toolhub-audio'))
  })
}

async function audioTx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openAudioDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(AUDIO_STORE, mode)
    const req = run(t.objectStore(AUDIO_STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
    t.oncomplete = () => db.close()
  })
}

function fileToAudioDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

type RepeatMode = 'off' | 'all' | 'one'

interface SavedState {
  lastTrackId: string | null
  position: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
}

function loadSavedState(): SavedState {
  const fallback: SavedState = { lastTrackId: null, position: 0, volume: 0.8, muted: false, shuffle: false, repeat: 'off' }
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(MP_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<SavedState>
    return {
      lastTrackId: typeof parsed.lastTrackId === 'string' ? parsed.lastTrackId : null,
      position:
        typeof parsed.position === 'number' && isFinite(parsed.position) && parsed.position >= 0
          ? parsed.position
          : 0,
      volume: typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : fallback.volume,
      muted: parsed.muted === true,
      shuffle: parsed.shuffle === true,
      repeat: parsed.repeat === 'all' || parsed.repeat === 'one' ? parsed.repeat : 'off',
    }
  } catch {
    return fallback
  }
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, '')
}

const ART_GRADIENTS = [
  'from-emerald-500 to-teal-700',
  'from-rose-500 to-orange-500',
  'from-violet-500 to-fuchsia-600',
  'from-amber-400 to-orange-600',
  'from-teal-400 to-cyan-600',
  'from-fuchsia-500 to-rose-500',
]

/** Deterministic gradient from the track name hash. */
function artGradient(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0
  return ART_GRADIENTS[h % ART_GRADIENTS.length]
}

const SCROLLBAR_Y =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border'

/** Animated 3-bar equalizer used on the currently playing row. */
function EqualizerBars({ className }: { className?: string }) {
  return (
    <span className={cn('flex h-4 items-end gap-[2px]', className)} aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="w-[3px] origin-bottom rounded-full bg-emerald-500"
          style={{ height: 14 }}
          animate={{ scaleY: [0.35, 1, 0.55, 0.9, 0.35] }}
          transition={{ duration: 0.9 + i * 0.18, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 }}
        />
      ))}
    </span>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function MusicPlayer() {
  const { toast } = useToast()

  const [saved] = useState<SavedState>(loadSavedState)
  const [tracks, setTracks] = useState<TrackRecord[]>([])
  const [ready, setReady] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(saved.volume)
  const [muted, setMuted] = useState(saved.muted)
  const [shuffle, setShuffle] = useState(saved.shuffle)
  const [repeat, setRepeat] = useState<RepeatMode>(saved.repeat)
  const [audioOk, setAudioOk] = useState(true)
  const [durations, setDurations] = useState<Record<string, number>>({})

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const srcRef = useRef<MediaElementAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const autoAdvanceRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const currentIdRef = useRef<string | null>(null)
  const playingRef = useRef(false)
  const positionRef = useRef(0)
  const lastSaveRef = useRef(0)
  const attemptedRef = useRef<Set<string>>(new Set())

  const currentTrack = tracks.find((t) => t.id === currentId) ?? null

  /* latest settings snapshot for persistence from event handlers */
  const settingsRef = useRef({ volume, muted, shuffle, repeat })

  /* ---- keep refs in sync with latest state (no setState here) ---- */
  useEffect(() => {
    currentIdRef.current = currentId
    playingRef.current = playing
  }, [currentId, playing])

  useEffect(() => {
    settingsRef.current = { volume, muted, shuffle, repeat }
  }, [volume, muted, shuffle, repeat])

  useEffect(() => {
    /* mirror volume / mute / loop onto the single audio element */
    const audio = audioRef.current
    if (audio) {
      audio.volume = muted ? 0 : volume
      audio.muted = muted
      audio.loop = repeat === 'one'
    }
  }, [volume, muted, repeat])

  /* ---- load library + restore last session (paused, never autoplay) ---- */
  useEffect(() => {
    let cancelled = false
    audioTx<TrackRecord[]>('readonly', (s) => s.getAll() as IDBRequest<TrackRecord[]>)
      .then((rows) => {
        if (cancelled) return
        const sorted = [...rows].sort((a, b) => a.addedAt - b.addedAt)
        setTracks(sorted)
        const restoreId =
          saved.lastTrackId && sorted.some((t) => t.id === saved.lastTrackId)
            ? saved.lastTrackId
            : sorted.length > 0
              ? sorted[0].id
              : null
        if (restoreId) {
          pendingSeekRef.current = restoreId === saved.lastTrackId ? saved.position : 0
          setCurrentId(restoreId)
        }
      })
      .catch(() => {
        /* library simply starts empty */
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [saved])

  /* ---- preload durations for the playlist (metadata only) ---- */
  useEffect(() => {
    if (!ready) return
    const created: HTMLAudioElement[] = []
    for (const t of tracks) {
      if (attemptedRef.current.has(t.id)) continue
      attemptedRef.current.add(t.id)
      const probe = new Audio()
      probe.preload = 'metadata'
      probe.src = t.dataUrl
      probe.onloadedmetadata = () => {
        if (isFinite(probe.duration)) {
          setDurations((prev) => (prev[t.id] === probe.duration ? prev : { ...prev, [t.id]: probe.duration }))
        }
      }
      created.push(probe)
    }
    return () => {
      for (const probe of created) {
        probe.onloadedmetadata = null
        probe.removeAttribute('src')
      }
    }
  }, [ready, tracks])

  /* ---- persist settings (position is saved via timeupdate throttle) ---- */
  useEffect(() => {
    try {
      window.localStorage.setItem(
        MP_KEY,
        JSON.stringify({
          lastTrackId: currentId,
          position: positionRef.current,
          volume,
          muted,
          shuffle,
          repeat,
        })
      )
    } catch {
      /* storage unavailable */
    }
  }, [currentId, volume, muted, shuffle, repeat])

  /* ================================================================== */
  /* Web Audio visualizer                                                */
  /* ================================================================== */

  const ensureAnalyser = useCallback(() => {
    if (srcRef.current) return
    const audio = audioRef.current
    if (!audio) return
    try {
      const Ctor =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) {
        setAudioOk(false)
        return
      }
      const ctx = new Ctor()
      const source = ctx.createMediaElementSource(audio)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.82
      source.connect(analyser)
      analyser.connect(ctx.destination)
      ctxRef.current = ctx
      srcRef.current = source
      analyserRef.current = analyser
    } catch {
      setAudioOk(false)
    }
  }, [])

  const drawVisualizer = useCallback(() => {
    const canvas = canvasRef.current
    const c2d = canvas?.getContext('2d')
    if (!canvas || !c2d) return
    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (w === 0 || h === 0) return
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    c2d.setTransform(dpr, 0, 0, dpr, 0, 0)
    c2d.clearRect(0, 0, w, h)

    const data = new Uint8Array(BAR_COUNT)
    if (analyserRef.current) analyserRef.current.getByteFrequencyData(data)

    const grad = c2d.createLinearGradient(0, h, 0, 0)
    grad.addColorStop(0, 'rgba(16, 185, 129, 0.95)')
    grad.addColorStop(1, 'rgba(45, 212, 191, 0.95)')
    c2d.fillStyle = grad
    const bw = w / BAR_COUNT
    for (let i = 0; i < BAR_COUNT; i++) {
      const v = data[i] / 255
      const bh = Math.max(2, v * (h - 6))
      c2d.fillRect(i * bw + bw * 0.2, h - bh, bw * 0.6, bh)
    }
  }, [])

  useEffect(() => {
    if (!playing || !audioOk || !currentId) {
      drawVisualizer() // resting baseline
      return
    }
    let raf = 0
    const tick = () => {
      drawVisualizer()
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [playing, audioOk, currentId, drawVisualizer])

  /* ================================================================== */
  /* Playback                                                            */
  /* ================================================================== */

  const persistSnapshot = useCallback(() => {
    try {
      const audio = audioRef.current
      window.localStorage.setItem(
        MP_KEY,
        JSON.stringify({
          lastTrackId: currentIdRef.current,
          position: audio ? audio.currentTime : positionRef.current,
          ...settingsRef.current,
        })
      )
    } catch {
      /* storage unavailable */
    }
  }, [])

  const skipTo = useCallback((id: string, autoPlay: boolean) => {
    autoAdvanceRef.current = autoPlay
    pendingSeekRef.current = null
    positionRef.current = 0
    setPosition(0)
    setDuration(0)
    setCurrentId(id)
  }, [])

  const advance = useCallback(
    (dir: 1 | -1, autoPlay: boolean) => {
      if (tracks.length === 0) return
      const idx = tracks.findIndex((t) => t.id === currentIdRef.current)
      const cur = idx >= 0 ? idx : 0
      let nextIdx: number
      if (settingsRef.current.shuffle && tracks.length > 1 && dir === 1) {
        do {
          nextIdx = Math.floor(Math.random() * tracks.length)
        } while (nextIdx === cur)
      } else {
        nextIdx = (cur + dir + tracks.length) % tracks.length
      }
      skipTo(tracks[nextIdx].id, autoPlay)
    },
    [tracks, skipTo]
  )

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !currentIdRef.current) return
    ensureAnalyser()
    void ctxRef.current?.resume().catch(() => {})
    if (audio.paused) void audio.play().catch(() => {})
    else audio.pause()
  }, [ensureAnalyser])

  const handleSeek = (values: number[]) => {
    const v = values[0] ?? 0
    const audio = audioRef.current
    positionRef.current = v
    setPosition(v)
    if (audio) {
      try {
        audio.currentTime = v
      } catch {
        /* seek before metadata */
      }
    }
  }

  const handleLoadedMetadata = () => {
    const audio = audioRef.current
    if (!audio) return
    const dur = isFinite(audio.duration) ? audio.duration : 0
    setDuration(dur)
    const id = currentIdRef.current
    if (id && dur > 0) setDurations((prev) => (prev[id] === dur ? prev : { ...prev, [id]: dur }))
    const seek = pendingSeekRef.current
    if (seek != null) {
      pendingSeekRef.current = null
      try {
        audio.currentTime = seek
        positionRef.current = seek
        setPosition(seek)
      } catch {
        /* ignore */
      }
    }
    if (autoAdvanceRef.current) {
      autoAdvanceRef.current = false
      ensureAnalyser()
      void ctxRef.current?.resume().catch(() => {})
      void audio.play().catch(() => {})
    }
  }

  const handleEnded = useCallback(() => {
    const rep = settingsRef.current.repeat
    if (rep === 'all' || settingsRef.current.shuffle) {
      advance(1, true)
      return
    }
    const idx = tracks.findIndex((t) => t.id === currentIdRef.current)
    if (idx >= 0 && idx < tracks.length - 1) {
      advance(1, true)
    } else {
      positionRef.current = 0
      setPosition(0)
    }
  }, [advance, tracks])

  const handleTimeUpdate = () => {
    const audio = audioRef.current
    if (!audio) return
    positionRef.current = audio.currentTime
    setPosition(audio.currentTime)
    const now = Date.now()
    if (now - lastSaveRef.current > 3000) {
      lastSaveRef.current = now
      persistSnapshot()
    }
  }

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    let imported = 0
    let firstNewId: string | null = null
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        toast({
          title: 'Large file imported',
          description: `"${file.name}" is over 25 MB — it was added, but it will use a lot of storage.`,
        })
      }
      try {
        const dataUrl = await fileToAudioDataUrl(file)
        const rec: TrackRecord = {
          id: `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          dataUrl,
          addedAt: Date.now(),
        }
        await audioTx('readwrite', (s) => s.put(rec) as IDBRequest<IDBValidKey>)
        attemptedRef.current.add(rec.id)
        setTracks((prev) => [...prev, rec])
        if (!firstNewId) firstNewId = rec.id
        imported++
      } catch {
        toast({ title: 'Import failed', description: `"${file.name}" could not be read as audio.` })
      }
    }
    if (imported > 0) {
      toast({
        title: imported === 1 ? 'Track added' : `${imported} tracks added`,
        description: 'Your library is saved on this device.',
      })
      if (!currentIdRef.current && firstNewId) skipTo(firstNewId, false)
    }
  }

  const removeTrack = async (id: string) => {
    const track = tracks.find((t) => t.id === id)
    if (id === currentIdRef.current) {
      const audio = audioRef.current
      if (audio) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      autoAdvanceRef.current = false
      pendingSeekRef.current = null
      positionRef.current = 0
      setCurrentId(null)
      setDuration(0)
      setPosition(0)
    }
    setTracks((prev) => prev.filter((t) => t.id !== id))
    try {
      await audioTx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>)
    } catch {
      /* ignore */
    }
    toast({ title: 'Track removed', description: track ? `"${track.name}" left your library.` : undefined })
  }

  const onRowClick = (id: string) => {
    if (id === currentId) {
      togglePlay()
      return
    }
    skipTo(id, true)
  }

  /* ---- cleanup on unmount ---- */
  useEffect(() => {
    return () => {
      persistSnapshot()
      const audio = audioRef.current
      if (audio) {
        audio.pause()
        audio.removeAttribute('src')
      }
      void ctxRef.current?.close().catch(() => {})
    }
  }, [persistSnapshot])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  const canPlay = tracks.length > 0

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      {/* Library header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-emerald-500/25">
            <ListMusic className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold leading-tight tracking-tight">Your Library</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {ready ? `${tracks.length} track${tracks.length === 1 ? '' : 's'} · stored on this device` : 'Loading library…'}
            </p>
          </div>
        </div>
        <Button
          onClick={() => fileRef.current?.click()}
          className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add music
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {!ready ? (
        <div className="space-y-4" aria-hidden>
          <div className="h-80 animate-pulse rounded-3xl bg-muted" />
          <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        </div>
      ) : tracks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-border bg-muted/20 px-6 py-14 text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-xl shadow-emerald-500/30">
            <Music className="h-9 w-9" aria-hidden />
          </span>
          <div>
            <h3 className="text-lg font-bold tracking-tight">Your library is empty</h3>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              Add audio files from your device. Everything stays on this device, even after a refresh.
            </p>
          </div>
          <Button
            onClick={() => fileRef.current?.click()}
            className="h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add music
          </Button>
        </div>
      ) : (
        <>
          {/* Now Playing */}
          <Card className="overflow-hidden border-border/70 shadow-xl shadow-black/5">
            <CardContent className="p-5 sm:p-6">
              <div className="mx-auto flex max-w-sm flex-col items-center gap-5">
                <motion.div
                  key={currentTrack?.id ?? 'none'}
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className={cn(
                    'relative aspect-square w-full max-w-[280px] overflow-hidden rounded-3xl bg-gradient-to-br shadow-lg ring-1 ring-black/10',
                    currentTrack ? artGradient(currentTrack.name) : 'from-muted to-muted-foreground/40'
                  )}
                >
                  <Music
                    className="absolute -right-8 -top-8 h-36 w-36 text-white/15"
                    aria-hidden
                  />
                  <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/30 to-transparent" aria-hidden />
                  {audioOk && (
                    <canvas
                      ref={canvasRef}
                      className="absolute inset-x-0 bottom-0 h-20 w-full"
                      aria-hidden
                    />
                  )}
                </motion.div>

                <div className="w-full text-center">
                  <p className="truncate text-lg font-bold tracking-tight">
                    {currentTrack ? stripExtension(currentTrack.name) : 'Nothing playing'}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {currentTrack
                      ? playing
                        ? 'Now playing'
                        : 'Paused'
                      : 'Pick a track from your playlist below'}
                  </p>
                </div>

                {/* Seek */}
                <div className="w-full space-y-1.5">
                  <Slider
                    value={[position]}
                    max={duration > 0 ? duration : 1}
                    step={0.1}
                    disabled={!currentTrack || duration <= 0}
                    onValueChange={handleSeek}
                    aria-label="Seek"
                  />
                  <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
                    <span>{formatTime(position)}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>

                {/* Transport */}
                <div className="flex items-center gap-1.5 sm:gap-2.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-pressed={shuffle}
                    aria-label="Shuffle"
                    onClick={() => setShuffle((v) => !v)}
                    className={cn(
                      'h-11 w-11 rounded-full',
                      shuffle && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    )}
                  >
                    <Shuffle className="h-4.5 w-4.5" aria-hidden />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Previous track"
                    disabled={!canPlay}
                    onClick={() => {
                      const audio = audioRef.current
                      if (audio && audio.currentTime > 3) {
                        audio.currentTime = 0
                        positionRef.current = 0
                        setPosition(0)
                        return
                      }
                      advance(-1, playingRef.current)
                    }}
                    className="h-12 w-12 rounded-full"
                  >
                    <SkipBack className="h-5 w-5 fill-current" aria-hidden />
                  </Button>

                  <Button
                    aria-label={playing ? 'Pause' : 'Play'}
                    disabled={!canPlay}
                    onClick={togglePlay}
                    className="h-14 w-14 rounded-full bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-emerald-500/30 hover:from-emerald-500 hover:to-teal-700"
                  >
                    {playing ? <Pause className="h-6 w-6 fill-current" aria-hidden /> : <Play className="h-6 w-6 translate-x-[1px] fill-current" aria-hidden />}
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Next track"
                    disabled={!canPlay}
                    onClick={() => advance(1, playingRef.current)}
                    className="h-12 w-12 rounded-full"
                  >
                    <SkipForward className="h-5 w-5 fill-current" aria-hidden />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    aria-pressed={repeat !== 'off'}
                    aria-label={`Repeat: ${repeat}`}
                    onClick={() => setRepeat((m) => (m === 'off' ? 'all' : m === 'all' ? 'one' : 'off'))}
                    className={cn(
                      'h-11 w-11 rounded-full',
                      repeat !== 'off' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    )}
                  >
                    {repeat === 'one' ? <Repeat1 className="h-4.5 w-4.5" aria-hidden /> : <Repeat className="h-4.5 w-4.5" aria-hidden />}
                  </Button>
                </div>

                {/* Volume */}
                <div className="flex w-full items-center gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={muted || volume === 0 ? 'Unmute' : 'Mute'}
                    aria-pressed={muted}
                    onClick={() => setMuted((m) => !m)}
                    className="h-11 w-11 shrink-0 rounded-full"
                  >
                    {muted || volume === 0 ? (
                      <VolumeX className="h-4.5 w-4.5" aria-hidden />
                    ) : (
                      <Volume2 className="h-4.5 w-4.5" aria-hidden />
                    )}
                  </Button>
                  <Slider
                    value={[Math.round(volume * 100)]}
                    max={100}
                    step={1}
                    onValueChange={(vals) => {
                      const v = vals[0] ?? 0
                      setVolume(v / 100)
                      if (v > 0 && muted) setMuted(false)
                    }}
                    aria-label="Volume"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Playlist */}
          <Card className="border-border/70 shadow-lg shadow-black/5">
            <CardContent className="p-2 sm:p-3">
              <p className="px-2 pb-1.5 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Playlist · {tracks.length}
              </p>
              <div className={cn('max-h-72 overflow-y-auto pr-1', SCROLLBAR_Y)}>
                {tracks.map((t, i) => {
                  const isActive = t.id === currentId
                  const dur = durations[t.id]
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => onRowClick(t.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onRowClick(t.id)
                        }
                      }}
                      aria-label={`Play ${stripExtension(t.name)}`}
                      className={cn(
                        'group flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors',
                        isActive ? 'bg-emerald-500/10' : 'hover:bg-muted/60'
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                          isActive ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {isActive && playing ? (
                          <EqualizerBars />
                        ) : (
                          <span className="text-xs font-semibold tabular-nums">{i + 1}</span>
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cn('truncate text-sm font-medium', isActive && 'text-emerald-700 dark:text-emerald-400')}>
                          {stripExtension(t.name)}
                        </p>
                        <p className="text-[11px] tabular-nums text-muted-foreground">
                          {typeof dur === 'number' ? formatTime(dur) : '—:—'}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${stripExtension(t.name)}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          void removeTrack(t.id)
                        }}
                        className="h-10 w-10 shrink-0 rounded-lg text-muted-foreground hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Single persistent audio element */}
      <audio
        ref={audioRef}
        preload="metadata"
        src={currentTrack?.dataUrl}
        onPlay={handlePlay}
        onPause={handlePause}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        className="hidden"
      />
    </div>
  )

  function handlePlay() {
    setPlaying(true)
    void ctxRef.current?.resume().catch(() => {})
  }

  function handlePause() {
    setPlaying(false)
    persistSnapshot()
  }
}
