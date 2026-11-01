'use client'

/**
 * Music Player v2 — local audio library persisted in its own IndexedDB
 * ('toolhub-audio': 'tracks' + 'playlists'), Web Audio 5-band equalizer with
 * presets, real shuffle queue (Fisher–Yates) + repeat modes, sleep timer with
 * fade-out, canvas visualizer and a phone-OS style playlist UI.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  ChevronDown,
  ChevronLeft,
  Check,
  ListMusic,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Timer,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { ensureFreshIndex, entryUrl, listEntries } from '@/lib/device-media'

/* ================================================================== */
/* IndexedDB — tiny private store for imported audio + playlists       */
/* ================================================================== */

interface TrackRecord {
  id: string
  name: string
  dataUrl: string
  addedAt: number
}

interface PlaylistRecord {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
}

const AUDIO_DB = 'toolhub-audio'
const AUDIO_DB_VERSION = 2 // v2 adds the 'playlists' store; v1 data upgrades in place
const AUDIO_STORE = 'tracks'
const PLAYLIST_STORE = 'playlists'
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
      if (!db.objectStoreNames.contains(PLAYLIST_STORE)) {
        db.createObjectStore(PLAYLIST_STORE, { keyPath: 'id' })
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

async function playlistTx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openAudioDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(PLAYLIST_STORE, mode)
    const req = run(t.objectStore(PLAYLIST_STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
    t.oncomplete = () => db.close()
  })
}

function putPlaylist(rec: PlaylistRecord): Promise<IDBValidKey> {
  return playlistTx('readwrite', (s) => s.put(rec) as IDBRequest<IDBValidKey>)
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
/* Equalizer + sleep timer constants                                   */
/* ================================================================== */

type RepeatMode = 'off' | 'all' | 'one'
type EqPresetId = 'flat' | 'bass' | 'vocal' | 'treble' | 'electronic' | 'acoustic' | 'custom'
type SleepMode = 'off' | 'end' | 'timer'

const EQ_FREQS = [60, 230, 910, 3600, 14000] as const
const EQ_BAND_LABELS = ['60 Hz', '230 Hz', '910 Hz', '3.6 kHz', '14 kHz'] as const
const EQ_PRESET_IDS: EqPresetId[] = ['flat', 'bass', 'vocal', 'treble', 'electronic', 'acoustic', 'custom']
const EQ_LABELS: Record<EqPresetId, string> = {
  flat: 'Flat',
  bass: 'Bass Boost',
  vocal: 'Vocal',
  treble: 'Treble',
  electronic: 'Electronic',
  acoustic: 'Acoustic',
  custom: 'Custom',
}
const EQ_PRESETS: { id: Exclude<EqPresetId, 'custom'>; label: string; gains: number[] }[] = [
  { id: 'flat', label: 'Flat', gains: [0, 0, 0, 0, 0] },
  { id: 'bass', label: 'Bass Boost', gains: [8, 5, 2, 0, -1] },
  { id: 'vocal', label: 'Vocal', gains: [-2, 1, 4, 3, 0] },
  { id: 'treble', label: 'Treble', gains: [-3, -1, 1, 5, 7] },
  { id: 'electronic', label: 'Electronic', gains: [7, 3, 0, 2, 5] },
  { id: 'acoustic', label: 'Acoustic', gains: [4, 2, 0, 3, 4] },
]
const SLEEP_CHOICES = [5, 10, 15, 30, 45, 60] as const

function isEqPreset(v: unknown): v is EqPresetId {
  return typeof v === 'string' && (EQ_PRESET_IDS as string[]).includes(v)
}

function sanitizeGains(v: unknown): number[] {
  const arr = Array.isArray(v) ? v : []
  return EQ_FREQS.map((_, i) => {
    const g = arr[i]
    return typeof g === 'number' && isFinite(g) ? Math.min(12, Math.max(-12, g)) : 0
  })
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

interface SavedState {
  lastTrackId: string | null
  position: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  eqGains: number[]
  eqPreset: EqPresetId
}

function loadSavedState(): SavedState {
  const fallback: SavedState = {
    lastTrackId: null,
    position: 0,
    volume: 0.8,
    muted: false,
    shuffle: false,
    repeat: 'off',
    eqGains: [0, 0, 0, 0, 0],
    eqPreset: 'flat',
  }
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
      eqGains: sanitizeGains(parsed.eqGains),
      eqPreset: isEqPreset(parsed.eqPreset) ? parsed.eqPreset : 'flat',
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

function formatDb(db: number): string {
  const rounded = Math.round(db)
  if (rounded > 0) return `+${rounded} dB`
  if (rounded === 0) return '0 dB'
  return `${rounded} dB`
}

function stripExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, '')
}

/** Fisher–Yates shuffle; keeps the current track first so playback continues. */
function buildShuffledOrder(ids: string[], firstId: string | null): string[] {
  const arr = [...ids]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  if (firstId) {
    const at = arr.indexOf(firstId)
    if (at > 0) {
      arr.splice(at, 1)
      arr.unshift(firstId)
    }
  }
  return arr
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

/** Small read-only indicator chip (queue source, shuffle, repeat, EQ, sleep). */
function IndicatorChip({
  children,
  tone = 'default',
  onClick,
  label,
}: {
  children: ReactNode
  tone?: 'default' | 'accent'
  onClick?: () => void
  label?: string
}) {
  const cls = cn(
    'inline-flex max-w-[210px] items-center truncate rounded-full border px-2.5 py-1 text-[11px] font-semibold',
    tone === 'accent'
      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
      : 'border-border/70 bg-muted/50 text-muted-foreground'
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={label} className={cn(cls, 'transition-colors hover:bg-muted/80')}>
        {children}
      </button>
    )
  }
  return <span className={cls}>{children}</span>
}

/** Toggleable option chip for preset / sleep-timer rows. */
function ChipButton({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  label?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        'h-10 shrink-0 rounded-full border px-3.5 text-xs font-semibold transition-colors',
        active
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
          : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted/70 hover:text-foreground'
      )}
    >
      {children}
    </button>
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
  const [shuffleOrder, setShuffleOrder] = useState<string[] | null>(null)
  const [repeat, setRepeat] = useState<RepeatMode>(saved.repeat)
  const [audioOk, setAudioOk] = useState(true)
  const [durations, setDurations] = useState<Record<string, number>>({})
  const [eqGains, setEqGains] = useState<number[]>(saved.eqGains)
  const [eqPreset, setEqPreset] = useState<EqPresetId>(saved.eqPreset)
  const [eqOpen, setEqOpen] = useState(false)
  const [sleepMode, setSleepMode] = useState<SleepMode>('off')
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null)
  const [sleepEndsAt, setSleepEndsAt] = useState<number | null>(null)
  const [sleepRemaining, setSleepRemaining] = useState(0)
  const [fadeFactor, setFadeFactor] = useState(1)

  /* ---- playlists (D40: named playlists, persisted in IndexedDB v2) ---- */
  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([])
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null)
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null)
  const [newPlaylistName, setNewPlaylistName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const srcRef = useRef<MediaElementAudioSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const eqNodesRef = useRef<BiquadFilterNode[]>([])
  const autoAdvanceRef = useRef(false)
  const pendingSeekRef = useRef<number | null>(null)
  const currentIdRef = useRef<string | null>(null)
  const playingRef = useRef(false)
  const positionRef = useRef(0)
  const lastSaveRef = useRef(0)
  const attemptedRef = useRef<Set<string>>(new Set())

  /* ---- device audio (real files, streamed in place — never copied) ---- */
  const [devTracks, setDevTracks] = useState<TrackRecord[]>([])
  const devEntriesRef = useRef<Map<string, import('@/lib/device-media').DeviceEntry>>(new Map())
  const devUrlRef = useRef<Map<string, string>>(new Map())
  const [devSrc, setDevSrc] = useState<string | null>(null)

  const allTracks = useMemo(() => [...tracks, ...devTracks], [tracks, devTracks])
  const currentTrack = allTracks.find((t) => t.id === currentId) ?? null

  const loadDeviceTracks = useCallback(async (reindex: boolean) => {
    try {
      if (reindex) await ensureFreshIndex(10 * 60_000).catch(() => undefined)
      const audios = (await listEntries({ dir: false, kinds: ['audio'] })).sort((a, b) => a.name.localeCompare(b.name))
      devEntriesRef.current = new Map(audios.map((e) => [`dev:${e.id}`, e]))
      // re-index may reflect renamed/replaced/deleted files — drop cached
      // object URLs for everything except the track currently playing
      const keepId = currentIdRef.current
      for (const [k, u] of devUrlRef.current) {
        if (k !== keepId) {
          URL.revokeObjectURL(u)
          devUrlRef.current.delete(k)
        }
      }
      setDevTracks(audios.map((e) => ({ id: `dev:${e.id}`, name: e.name, dataUrl: '', addedAt: e.lastModified || 0 })))
    } catch {
      /* device layer unavailable (unsupported browser / nothing connected) */
    }
  }, [])

  useEffect(() => {
    void loadDeviceTracks(true)
  }, [loadDeviceTracks])

  useEffect(() => {
    const onIndexed = () => void loadDeviceTracks(false)
    window.addEventListener('toolhub:device-indexed', onIndexed)
    return () => window.removeEventListener('toolhub:device-indexed', onIndexed)
  }, [loadDeviceTracks])

  /* resolve a streaming URL for the current device track */
  useEffect(() => {
    if (!currentTrack || !currentTrack.id.startsWith('dev:')) {
      setDevSrc(null)
      return
    }
    let dead = false
    const entry = devEntriesRef.current.get(currentTrack.id)
    const cached = entry ? devUrlRef.current.get(currentTrack.id) : undefined
    if (cached) {
      setDevSrc(cached)
      return
    }
    if (!entry) {
      setDevSrc(null)
      return
    }
    // clear the previous track's URL synchronously — the <audio> element must
    // never keep loading the old blob while the new one resolves
    setDevSrc(null)
    void entryUrl(entry)
      .then((u) => {
        if (dead) {
          URL.revokeObjectURL(u)
          return
        }
        // keep the cache bounded: only the current track stays alive
        for (const [k, old] of devUrlRef.current) {
          if (k !== currentTrack.id) {
            URL.revokeObjectURL(old)
            devUrlRef.current.delete(k)
          }
        }
        devUrlRef.current.set(currentTrack.id, u)
        setDevSrc(u)
      })
      .catch(() => !dead && setDevSrc(null))
    return () => {
      dead = true
    }
  }, [currentTrack])

  /* cleanup device object URLs on unmount */
  useEffect(
    () => () => {
      for (const u of devUrlRef.current.values()) URL.revokeObjectURL(u)
      devUrlRef.current.clear()
    },
    []
  )

  /* latest settings snapshot for persistence from event handlers */
  const settingsRef = useRef({ volume, muted, shuffle, repeat, eqGains, eqPreset })

  /* ---- keep refs in sync with latest state (no setState here) ---- */
  useEffect(() => {
    currentIdRef.current = currentId
    playingRef.current = playing
  }, [currentId, playing])

  useEffect(() => {
    settingsRef.current = { volume, muted, shuffle, repeat, eqGains, eqPreset }
  }, [volume, muted, shuffle, repeat, eqGains, eqPreset])

  const sleepModeRef = useRef<SleepMode>('off')
  useEffect(() => {
    sleepModeRef.current = sleepMode
  }, [sleepMode])

  useEffect(() => {
    /* mirror volume / mute / loop (and sleep fade) onto the single audio element */
    const audio = audioRef.current
    if (audio) {
      audio.volume = muted ? 0 : Math.max(0, Math.min(1, volume * fadeFactor))
      audio.muted = muted
      audio.loop = repeat === 'one'
    }
  }, [volume, muted, repeat, fadeFactor])

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
        if (saved.shuffle) {
          setShuffleOrder(buildShuffledOrder(sorted.map((t) => t.id), restoreId))
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

  /* ---- load saved playlists (IndexedDB v2 store; missing → empty) ---- */
  useEffect(() => {
    let cancelled = false
    playlistTx<PlaylistRecord[]>('readonly', (s) => s.getAll() as IDBRequest<PlaylistRecord[]>)
      .then((rows) => {
        if (cancelled) return
        setPlaylists(rows.sort((a, b) => a.createdAt - b.createdAt))
      })
      .catch(() => {
        /* playlists simply start empty */
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* ---- preload durations for the playlist (metadata only) ---- */
  useEffect(() => {
    if (!ready) return
    const created: HTMLAudioElement[] = []
    for (const t of tracks) {
      if (t.id.startsWith('dev:')) continue
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
          eqGains,
          eqPreset,
        })
      )
    } catch {
      /* storage unavailable */
    }
  }, [currentId, volume, muted, shuffle, repeat, eqGains, eqPreset])

  /* ================================================================== */
  /* Play queue (library or playlist, shuffled with Fisher–Yates)        */
  /* ================================================================== */

  const activePlaylist = activePlaylistId ? playlists.find((p) => p.id === activePlaylistId) ?? null : null
  const activePlaylistName = activePlaylist?.name ?? null

  const allTrackIdSet = useMemo(() => new Set(allTracks.map((t) => t.id)), [allTracks])

  const naturalQueueIds = useMemo(() => {
    if (activePlaylist) {
      return activePlaylist.trackIds.filter((id) => allTrackIdSet.has(id))
    }
    return allTracks.map((t) => t.id)
  }, [activePlaylist, allTrackIdSet, allTracks])

  /* reconciled shuffled order: dropped tracks removed, new ones appended */
  const queueIds = useMemo(() => {
    if (!shuffle || !shuffleOrder) return naturalQueueIds
    const known = new Set(naturalQueueIds)
    const kept = shuffleOrder.filter((id) => known.has(id))
    const keptSet = new Set(kept)
    for (const id of naturalQueueIds) {
      if (!keptSet.has(id)) kept.push(id)
    }
    return kept
  }, [shuffle, shuffleOrder, naturalQueueIds])

  const toggleShuffle = () => {
    const next = !shuffle
    navigator.vibrate?.(12)
    setShuffle(next)
    setShuffleOrder(next ? buildShuffledOrder(naturalQueueIds, currentIdRef.current) : null)
  }

  const toggleRepeat = () => {
    navigator.vibrate?.(12)
    setRepeat((m) => (m === 'off' ? 'all' : m === 'all' ? 'one' : 'off'))
  }

  /* ================================================================== */
  /* Web Audio: 5-band peaking EQ → analyser (visualizer hears the EQ)   */
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
      // created lazily on first play (autoplay policies) — one context per session
      const ctx = new Ctor()
      // MediaElementSource must be created ONCE per element — creating twice throws
      const source = ctx.createMediaElementSource(audio)
      const gains = settingsRef.current.eqGains
      const filters = EQ_FREQS.map((freq, i) => {
        const f = ctx.createBiquadFilter()
        f.type = 'peaking'
        f.frequency.value = freq
        f.Q.value = 1.1
        f.gain.value = gains[i] ?? 0
        return f
      })
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.82
      // chain: source → 60 → 230 → 910 → 3.6k → 14k Hz → analyser → destination
      source.connect(filters[0])
      for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1])
      filters[filters.length - 1].connect(analyser)
      analyser.connect(ctx.destination)
      eqNodesRef.current = filters
      ctxRef.current = ctx
      srcRef.current = source
      analyserRef.current = analyser
    } catch {
      setAudioOk(false)
    }
  }, [])

  /* live-apply slider changes to the filter nodes (smooth, click-free) */
  useEffect(() => {
    const ctx = ctxRef.current
    const nodes = eqNodesRef.current
    if (!ctx || nodes.length === 0) return
    for (let i = 0; i < nodes.length; i++) {
      const target = eqGains[i] ?? 0
      try {
        nodes[i].gain.setTargetAtTime(target, ctx.currentTime, 0.04)
      } catch {
        nodes[i].gain.value = target
      }
    }
  }, [eqGains])

  const setEqBand = (band: number, db: number) => {
    setEqGains((prev) => prev.map((g, i) => (i === band ? db : g)))
    setEqPreset('custom')
  }

  const applyEqPreset = (preset: (typeof EQ_PRESETS)[number]) => {
    navigator.vibrate?.(12)
    setEqGains([...preset.gains])
    setEqPreset(preset.id)
  }

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
  /* Sleep timer (wall-clock countdown + fade over the last 10 s)        */
  /* ================================================================== */

  const clearSleep = useCallback(() => {
    setSleepMode('off')
    setSleepMinutes(null)
    setSleepEndsAt(null)
    setSleepRemaining(0)
    setFadeFactor(1)
  }, [])

  const startSleep = (minutes: number) => {
    navigator.vibrate?.(12)
    setSleepMode('timer')
    setSleepMinutes(minutes)
    setSleepEndsAt(Date.now() + minutes * 60_000)
    setSleepRemaining(minutes * 60)
    setFadeFactor(1)
  }

  const setSleepEndOfTrack = () => {
    navigator.vibrate?.(12)
    setSleepMode('end')
    setSleepMinutes(null)
    setSleepEndsAt(null)
    setSleepRemaining(0)
    setFadeFactor(1)
  }

  useEffect(() => {
    if (sleepMode !== 'timer' || sleepEndsAt === null) return
    let stopped = false
    const apply = () => {
      if (stopped) return
      const remainS = Math.max(0, (sleepEndsAt - Date.now()) / 1000)
      setSleepRemaining(remainS)
      if (remainS <= 10) setFadeFactor(remainS / 10) // linear fade-out over the last 10 s
      if (remainS <= 0) {
        stopped = true
        audioRef.current?.pause()
        setFadeFactor(1)
        setSleepMode('off')
        setSleepMinutes(null)
        setSleepEndsAt(null)
        toast({ title: 'Sleep timer done', description: 'Playback paused. Sleep well.' })
      }
    }
    // defer the first tick out of the effect body; interval keeps it ticking
    const kick = window.setTimeout(apply, 0)
    const iv = window.setInterval(apply, 250)
    return () => {
      stopped = true
      window.clearTimeout(kick)
      window.clearInterval(iv)
    }
  }, [sleepMode, sleepEndsAt, toast])

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
      const q = queueIds
      if (q.length === 0) return
      const idx = q.indexOf(currentIdRef.current ?? '')
      const from = idx >= 0 ? idx : 0
      let nextIdx = from + dir
      if (nextIdx < 0) {
        // manual previous wraps; auto never walks backwards
        nextIdx = autoPlay ? -1 : q.length - 1
      } else if (nextIdx >= q.length) {
        // manual next wraps; auto stops unless repeat-all
        nextIdx = autoPlay && settingsRef.current.repeat !== 'all' ? -1 : 0
      }
      if (nextIdx < 0) {
        // auto-advance ran past the end with repeat off — stop cleanly
        positionRef.current = 0
        setPosition(0)
        persistSnapshot()
        return
      }
      skipTo(q[nextIdx], autoPlay)
    },
    [queueIds, skipTo, persistSnapshot]
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
    if (sleepModeRef.current === 'end') {
      // sleep timer in end-of-track mode: stop here instead of advancing
      audioRef.current?.pause()
      clearSleep()
      toast({ title: 'Sleep timer done', description: 'Stopped at the end of this track.' })
      return
    }
    advance(1, true)
  }, [advance, clearSleep, toast])

  /* device file unreadable / moved / permission expired — never leave the
   * player silently stuck or surprise-autoplay the next track */
  const audioErrorToastRef = useRef(0)
  const handleAudioError = () => {
    autoAdvanceRef.current = false
    const audio = audioRef.current
    // ignore the benign "empty src" error fired when src becomes undefined
    if (!audio?.error || !audio.currentSrc) return
    setPlaying(false)
    if (devSrc) {
      setDevSrc(null)
      const now = Date.now()
      if (now - audioErrorToastRef.current > 4000) {
        audioErrorToastRef.current = now
        toast({
          title: 'Cannot play this file',
          description: 'It may have been moved, renamed or deleted — refresh the device library.',
          variant: 'destructive',
        })
      }
    }
  }

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
    const track = allTracks.find((t) => t.id === id)
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
    // keep playlists tidy: drop the track from every playlist that holds it
    const affected = playlists.filter((p) => p.trackIds.includes(id))
    if (affected.length > 0) {
      setPlaylists((prev) => prev.map((p) => (p.trackIds.includes(id) ? { ...p, trackIds: p.trackIds.filter((t) => t !== id) } : p)))
      for (const p of affected) {
        const updated: PlaylistRecord = { ...p, trackIds: p.trackIds.filter((t) => t !== id) }
        void putPlaylist(updated).catch(() => undefined)
      }
    }
    try {
      await audioTx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>)
    } catch {
      /* ignore */
    }
    toast({ title: 'Track removed', description: track ? `"${stripExtension(track.name)}" left your library.` : undefined })
  }

  /* ---- playlist CRUD (D40) ---- */

  const createPlaylist = () => {
    const name = newPlaylistName.trim()
    if (!name) return
    navigator.vibrate?.(12)
    const rec: PlaylistRecord = {
      id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: name.slice(0, 60),
      trackIds: [],
      createdAt: Date.now(),
    }
    setPlaylists((prev) => [...prev, rec])
    setNewPlaylistName('')
    setOpenPlaylistId(rec.id)
    void putPlaylist(rec).catch(() => {
      toast({ title: 'Could not save playlist', description: 'Storage is unavailable on this device.', variant: 'destructive' })
    })
  }

  const beginRename = (pl: PlaylistRecord) => {
    setRenamingId(pl.id)
    setRenameDraft(pl.name)
  }

  const commitRename = () => {
    const id = renamingId
    if (!id) return
    const name = renameDraft.trim().slice(0, 60)
    const pl = playlists.find((p) => p.id === id)
    setRenamingId(null)
    if (!pl || !name || name === pl.name) return
    const updated: PlaylistRecord = { ...pl, name }
    setPlaylists((prev) => prev.map((p) => (p.id === id ? updated : p)))
    void putPlaylist(updated).catch(() => undefined)
  }

  const deletePlaylist = (id: string) => {
    const pl = playlists.find((p) => p.id === id)
    navigator.vibrate?.(12)
    setPlaylists((prev) => prev.filter((p) => p.id !== id))
    if (openPlaylistId === id) setOpenPlaylistId(null)
    if (activePlaylistId === id) setActivePlaylistId(null)
    void playlistTx('readwrite', (s) => s.delete(id) as unknown as IDBRequest<undefined>).catch(() => undefined)
    toast({ title: 'Playlist deleted', description: pl ? `"${pl.name}" was removed.` : undefined })
  }

  const addTrackToPlaylist = (playlistId: string, trackId: string) => {
    const pl = playlists.find((p) => p.id === playlistId)
    if (!pl || pl.trackIds.includes(trackId)) return
    const updated: PlaylistRecord = { ...pl, trackIds: [...pl.trackIds, trackId] }
    setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)))
    void putPlaylist(updated).catch(() => undefined)
  }

  const removeTrackFromPlaylist = (playlistId: string, trackId: string) => {
    const pl = playlists.find((p) => p.id === playlistId)
    if (!pl) return
    const updated: PlaylistRecord = { ...pl, trackIds: pl.trackIds.filter((t) => t !== trackId) }
    setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)))
    void putPlaylist(updated).catch(() => undefined)
  }

  const playPlaylist = (playlistId: string) => {
    const pl = playlists.find((p) => p.id === playlistId)
    if (!pl) return
    const ids = pl.trackIds.filter((id) => allTrackIdSet.has(id))
    if (ids.length === 0) {
      toast({ title: 'Playlist is empty', description: 'Add some tracks from your library first.' })
      return
    }
    navigator.vibrate?.(12)
    setActivePlaylistId(playlistId)
    skipTo(ids[0], true)
  }

  const onLibraryRowClick = (id: string) => {
    if (id === currentId) {
      togglePlay()
      return
    }
    setActivePlaylistId(null) // tapping the library plays the full library queue
    skipTo(id, true)
  }

  const onPlaylistRowClick = (playlistId: string, id: string) => {
    if (id === currentId) {
      togglePlay()
      return
    }
    setActivePlaylistId(playlistId)
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

  const openPlaylist = openPlaylistId ? playlists.find((p) => p.id === openPlaylistId) ?? null : null
  const openPlaylistValidIds = openPlaylist ? openPlaylist.trackIds.filter((id) => allTrackIdSet.has(id)) : []
  const addableTracks = openPlaylist ? allTracks.filter((t) => !openPlaylist.trackIds.includes(t.id)) : []
  const canPlay = queueIds.length > 0 || currentTrack != null
  const showChips =
    shuffle || repeat !== 'off' || activePlaylistName != null || eqPreset !== 'flat' || sleepMode !== 'off'

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
              {ready
                ? `${allTracks.length} track${allTracks.length === 1 ? '' : 's'}${devTracks.length > 0 ? ` · ${devTracks.length} live from your device` : ' · stored on this device'}`
                : 'Loading library…'}
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
      ) : allTracks.length === 0 && playlists.length === 0 ? (
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
                      : 'Pick a track from your library below'}
                  </p>
                </div>

                {/* Session indicator chips */}
                {showChips && (
                  <div className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Playback settings">
                    {activePlaylistName && (
                      <IndicatorChip
                        tone="accent"
                        onClick={() => setActivePlaylistId(null)}
                        label={`Playing from playlist ${activePlaylistName} — tap to play the full library`}
                      >
                        Queue: {activePlaylistName} ✕
                      </IndicatorChip>
                    )}
                    {shuffle && <IndicatorChip>Shuffle</IndicatorChip>}
                    {repeat !== 'off' && <IndicatorChip>{repeat === 'one' ? 'Repeat one' : 'Repeat all'}</IndicatorChip>}
                    {eqPreset !== 'flat' && <IndicatorChip>EQ · {EQ_LABELS[eqPreset]}</IndicatorChip>}
                    {sleepMode === 'timer' && (
                      <IndicatorChip tone="accent">Sleep {formatTime(sleepRemaining)}</IndicatorChip>
                    )}
                    {sleepMode === 'end' && <IndicatorChip tone="accent">Sleep · end of track</IndicatorChip>}
                  </div>
                )}

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
                    onClick={toggleShuffle}
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
                    onClick={toggleRepeat}
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

          {/* Equalizer (D40) */}
          <Card className="border-border/70 shadow-lg shadow-black/5">
            <CardContent className="p-3 sm:p-4">
              <button
                type="button"
                onClick={() => setEqOpen((v) => !v)}
                aria-expanded={eqOpen}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-1 text-left"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-cyan-600 text-white shadow-md shadow-sky-500/20">
                    <SlidersHorizontal className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold tracking-tight">Equalizer</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {EQ_LABELS[eqPreset]}
                      {audioOk ? ' · 5-band' : ' · Web Audio unavailable'}
                    </span>
                  </span>
                </span>
                <ChevronDown
                  className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', eqOpen && 'rotate-180')}
                  aria-hidden
                />
              </button>

              {eqOpen && (
                <div className="mt-3 space-y-4 px-1">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Equalizer presets">
                    {EQ_PRESETS.map((preset) => (
                      <ChipButton
                        key={preset.id}
                        active={eqPreset === preset.id}
                        onClick={() => applyEqPreset(preset)}
                        label={`${preset.label} equalizer preset`}
                      >
                        {preset.label}
                      </ChipButton>
                    ))}
                    {eqPreset === 'custom' && (
                      <span className="inline-flex h-10 items-center rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        Custom
                      </span>
                    )}
                  </div>

                  <div className="space-y-3" role="group" aria-label="Equalizer bands">
                    {EQ_FREQS.map((freq, i) => (
                      <div key={freq} className="flex items-center gap-3">
                        <span className="w-14 shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
                          {EQ_BAND_LABELS[i]}
                        </span>
                        <Slider
                          value={[eqGains[i] ?? 0]}
                          min={-12}
                          max={12}
                          step={1}
                          onValueChange={(vals) => setEqBand(i, vals[0] ?? 0)}
                          aria-label={`${EQ_BAND_LABELS[i]} gain in decibels`}
                        />
                        <span className="w-14 shrink-0 text-right text-[11px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                          {formatDb(eqGains[i] ?? 0)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sleep timer (D40) */}
          <Card className="border-border/70 shadow-lg shadow-black/5">
            <CardContent className="space-y-2.5 p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2 px-1">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-md shadow-amber-500/20">
                    <Timer className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-bold tracking-tight">Sleep timer</span>
                    <span className="block truncate text-[11px] text-muted-foreground">Pause playback automatically</span>
                  </span>
                </span>
                {sleepMode === 'timer' && (
                  <motion.span
                    key="sleep-countdown"
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="inline-flex shrink-0 items-center rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold tabular-nums text-emerald-700 dark:text-emerald-400"
                  >
                    {formatTime(sleepRemaining)}
                  </motion.span>
                )}
                {sleepMode === 'end' && (
                  <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                    End of track
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 px-1" role="group" aria-label="Sleep timer options">
                <ChipButton active={sleepMode === 'off'} onClick={clearSleep} label="Turn sleep timer off">
                  Off
                </ChipButton>
                {SLEEP_CHOICES.map((m) => (
                  <ChipButton
                    key={m}
                    active={sleepMode === 'timer' && sleepMinutes === m}
                    onClick={() => startSleep(m)}
                    label={`Sleep in ${m} minutes`}
                  >
                    {m} min
                  </ChipButton>
                ))}
                <ChipButton active={sleepMode === 'end'} onClick={setSleepEndOfTrack} label="Sleep at end of track">
                  End of track
                </ChipButton>
              </div>
            </CardContent>
          </Card>

          {/* Playlists (D40) */}
          <Card className="border-border/70 shadow-lg shadow-black/5">
            <CardContent className="space-y-3 p-3 sm:p-4">
              <div className="flex items-center justify-between gap-2 px-1">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md shadow-violet-500/20">
                    <ListMusic className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold tracking-tight">Playlists</h3>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {playlists.length === 0
                        ? 'Group your tracks into named playlists'
                        : `${playlists.length} playlist${playlists.length === 1 ? '' : 's'} · saved on this device`}
                    </p>
                  </div>
                </div>
                {openPlaylist && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpenPlaylistId(null)}
                    className="h-10 shrink-0 rounded-xl text-muted-foreground"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    All playlists
                  </Button>
                )}
              </div>

              {!openPlaylist ? (
                <>
                  <div className="flex gap-2 px-1">
                    <input
                      value={newPlaylistName}
                      onChange={(e) => setNewPlaylistName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') createPlaylist()
                      }}
                      maxLength={60}
                      placeholder="New playlist name"
                      aria-label="New playlist name"
                      className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-muted/40 px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-emerald-500/50"
                    />
                    <Button
                      onClick={createPlaylist}
                      disabled={!newPlaylistName.trim()}
                      className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-600 text-white shadow-lg shadow-violet-500/25 hover:from-violet-600 hover:to-fuchsia-700"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      Create
                    </Button>
                  </div>

                  {playlists.length > 0 && (
                    <div className="space-y-1 px-1">
                      {playlists.map((pl) => {
                        const validCount = pl.trackIds.filter((id) => allTrackIdSet.has(id)).length
                        return renamingId === pl.id ? (
                          <div key={pl.id} className="flex items-center gap-2 rounded-xl bg-muted/50 px-2 py-1.5">
                            <input
                              autoFocus
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitRename()
                                if (e.key === 'Escape') setRenamingId(null)
                              }}
                              maxLength={60}
                              aria-label="Playlist name"
                              className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-emerald-500/50"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Save playlist name"
                              onClick={commitRename}
                              className="h-10 w-10 shrink-0 rounded-lg text-emerald-600 dark:text-emerald-400"
                            >
                              <Check className="h-4 w-4" aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Cancel renaming"
                              onClick={() => setRenamingId(null)}
                              className="h-10 w-10 shrink-0 rounded-lg text-muted-foreground"
                            >
                              <X className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        ) : (
                          <div
                            key={pl.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setOpenPlaylistId(pl.id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                setOpenPlaylistId(pl.id)
                              }
                            }}
                            aria-label={`Open playlist ${pl.name}`}
                            className="group flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/60"
                          >
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-600/20 text-violet-600 dark:text-violet-400">
                              <ListMusic className="h-4.5 w-4.5" aria-hidden />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{pl.name}</p>
                              <p className="text-[11px] tabular-nums text-muted-foreground">
                                {validCount} track{validCount === 1 ? '' : 's'}
                              </p>
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Play all in ${pl.name}`}
                              disabled={validCount === 0}
                              onClick={(e) => {
                                e.stopPropagation()
                                playPlaylist(pl.id)
                              }}
                              className="h-10 w-10 shrink-0 rounded-lg text-emerald-600 dark:text-emerald-400"
                            >
                              <Play className="h-4 w-4 fill-current" aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Rename ${pl.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                beginRename(pl)
                              }}
                              className="h-10 w-10 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Delete ${pl.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                deletePlaylist(pl.id)
                              }}
                              className="h-10 w-10 shrink-0 rounded-lg text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3 px-1">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold tracking-tight">{openPlaylist.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {openPlaylistValidIds.length} track{openPlaylistValidIds.length === 1 ? '' : 's'}
                        {activePlaylistId === openPlaylist.id ? ' · playing now' : ''}
                      </p>
                    </div>
                    <Button
                      onClick={() => playPlaylist(openPlaylist.id)}
                      disabled={openPlaylistValidIds.length === 0}
                      className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:from-emerald-600 hover:to-teal-700"
                    >
                      <Play className="h-4 w-4 fill-current" aria-hidden />
                      Play all
                    </Button>
                  </div>

                  <div className={cn('max-h-72 space-y-1 overflow-y-auto pr-1', SCROLLBAR_Y)}>
                    {openPlaylist.trackIds.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                        This playlist is empty — add tracks from your library below.
                      </p>
                    ) : (
                      openPlaylist.trackIds.map((id, i) => {
                        const t = allTracks.find((x) => x.id === id) ?? null
                        const dur = t ? durations[t.id] : undefined
                        return (
                          <div
                            key={id}
                            role="button"
                            tabIndex={0}
                            onClick={() => t && onPlaylistRowClick(openPlaylist.id, id)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                if (t) onPlaylistRowClick(openPlaylist.id, id)
                              }
                            }}
                            aria-label={t ? `Play ${stripExtension(t.name)} from ${openPlaylist.name}` : 'Track no longer in library'}
                            className="group flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-muted/60"
                          >
                            <span
                              className={cn(
                                'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                                id === currentId
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                  : 'bg-muted text-muted-foreground'
                              )}
                            >
                              {id === currentId && playing ? (
                                <EqualizerBars />
                              ) : (
                                <span className="text-xs font-semibold tabular-nums">{i + 1}</span>
                              )}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p
                                className={cn(
                                  'truncate text-sm font-medium',
                                  id === currentId && 'text-emerald-700 dark:text-emerald-400',
                                  !t && 'italic text-muted-foreground'
                                )}
                              >
                                {t ? stripExtension(t.name) : 'Removed from library'}
                              </p>
                              {t && (
                                <p className="text-[11px] tabular-nums text-muted-foreground">
                                  {typeof dur === 'number' ? formatTime(dur) : '—:—'}
                                </p>
                              )}
                            </div>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove ${t ? stripExtension(t.name) : 'track'} from ${openPlaylist.name}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                removeTrackFromPlaylist(openPlaylist.id, id)
                              }}
                              className="h-10 w-10 shrink-0 rounded-lg text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        )
                      })
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Add from library
                    </p>
                    <div className={cn('mt-1.5 max-h-48 space-y-1 overflow-y-auto pr-1', SCROLLBAR_Y)}>
                      {addableTracks.length === 0 ? (
                        <p className="px-2.5 py-3 text-xs text-muted-foreground">
                          {allTracks.length === 0
                            ? 'Add music to your library first, then add tracks here.'
                            : 'Every track in your library is already in this playlist.'}
                        </p>
                      ) : (
                        addableTracks.map((t) => (
                          <div key={t.id} className="flex items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-muted/40">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                              <Music className="h-4 w-4" aria-hidden />
                            </span>
                            <p className="min-w-0 flex-1 truncate text-sm">{stripExtension(t.name)}</p>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`Add ${stripExtension(t.name)} to ${openPlaylist.name}`}
                              onClick={() => addTrackToPlaylist(openPlaylist.id, t.id)}
                              className="h-10 w-10 shrink-0 rounded-lg text-emerald-600 dark:text-emerald-400"
                            >
                              <Plus className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* All tracks */}
          <Card className="border-border/70 shadow-lg shadow-black/5">
            <CardContent className="p-2 sm:p-3">
              <p className="px-2 pb-1.5 pt-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                All tracks · {allTracks.length}
              </p>
              <div className={cn('max-h-72 overflow-y-auto pr-1', SCROLLBAR_Y)}>
                {allTracks.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    Your library is empty — add music to fill it.
                  </p>
                ) : (
                  allTracks.map((t, i) => {
                    const isActive = t.id === currentId
                    const isDev = t.id.startsWith('dev:')
                    const dur = durations[t.id]
                    return (
                      <div
                        key={t.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => onLibraryRowClick(t.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onLibraryRowClick(t.id)
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
                            {isDev
                              ? 'Live from your device'
                              : typeof dur === 'number'
                                ? formatTime(dur)
                                : '—:—'}
                          </p>
                        </div>
                        {!isDev && (
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
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* Single persistent audio element */}
      <audio
        ref={audioRef}
        preload="metadata"
        src={currentTrack ? (currentTrack.id.startsWith('dev:') ? (devSrc ?? undefined) : currentTrack.dataUrl) : undefined}
        onPlay={handlePlay}
        onPause={handlePause}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onError={handleAudioError}
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
