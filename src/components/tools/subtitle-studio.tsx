'use client'

/**
 * Subtitle Studio — perfect sync, zero upload.
 *
 * Load a video (never persisted) and an .srt/.vtt file, then time your cues
 * against a live preview: the active cue is highlighted in the list and
 * rendered as a real subtitle overlay on the video while it plays. Cue
 * editing covers nudge/set/split/reorder with live validation, projects
 * autosave to IndexedDB (subtitle text only), and both SRT + VTT exports.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDown,
  ArrowUp,
  Captions,
  Check,
  Clapperboard,
  Copy,
  Download,
  FilePlus2,
  FileText,
  FileUp,
  FileVideo,
  FolderOpen,
  Info,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  SquareSplitHorizontal,
  Subtitles as SubtitlesIcon,
  Trash2,
  TriangleAlert,
  VideoOff,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

interface Cue {
  id: string
  startMs: number
  endMs: number
  text: string
}

/** Exactly what lives in IndexedDB — video files are never stored. */
interface SubProject {
  id: string
  name: string
  cues: Cue[]
  videoName: string
  updatedAt: number
}

interface ParseResult {
  cues: Cue[]
  skipped: number
  format: 'srt' | 'vtt'
}

type TabId = 'editor' | 'projects'
type ArmedToken = `cue:${string}` | `project:${string}` | 'clear' | null

/* ================================================================== */
/* IndexedDB — namespace 'toolhub-subtitles' v1, store 'projects'      */
/* ================================================================== */

const DB_NAME = 'toolhub-subtitles'
const DB_VERSION = 1
const PROJECTS_STORE = 'projects'

let dbPromise: Promise<IDBDatabase> | null = null

function openSubtitleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(PROJECTS_STORE)) {
        d.createObjectStore(PROJECTS_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openSubtitleDb()
  return dbPromise
}

function idbGetAll<T>(store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readonly').objectStore(store).getAll()
        req.onsuccess = () => resolve((req.result ?? []) as T[])
        req.onerror = () => reject(req.error ?? new Error('IndexedDB getAll failed'))
      })
      .catch(reject)
  })
}

function idbPut<T>(store: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).put(value as object)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'))
      })
      .catch(reject)
  })
}

function idbDelete(store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).delete(key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
      })
      .catch(reject)
  })
}

function idbClear(store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).clear()
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB clear failed'))
      })
      .catch(reject)
  })
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

/** Hard upper bound for editable timestamps (99 hours) — keeps inputs sane. */
const MAX_MS = 99 * 60 * 60 * 1000

/** Thin glass scrollbar for long lists (house convention). */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/** Tab trigger overrides — explicit zinc styling survives light/dark themes. */
const TRIGGER_CLS =
  'flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-1 pb-1.5 pt-2 text-[10px] font-medium text-zinc-400 data-[state=active]:bg-white/10 data-[state=active]:text-zinc-50 sm:text-[11px]'

const FIELD_CLS =
  'h-11 w-full min-w-0 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

/** Seek bar with a cyan progress fill driven by the --pct custom property. */
const RANGE_CLS =
  'h-11 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-progress]:h-1.5 [&::-moz-range-progress]:rounded-full [&::-moz-range-progress]:bg-cyan-400 [&::-moz-range-thumb]:size-[18px] [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-white [&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-white/15 [&::-webkit-slider-runnable-track]:h-1.5 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:[background:linear-gradient(90deg,#22d3ee_var(--pct,0%),rgba(255,255,255,0.15)_var(--pct,0%))] [&::-webkit-slider-thumb]:mt-[-7px] [&::-webkit-slider-thumb]:size-[18px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgb(34_211_238/0.25)]'

function haptic() {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** mm:ss.mmm readout (minutes zero-padded). */
function fmtClock(ms: number): string {
  const clamped = Math.min(Math.max(0, Math.round(ms)), MAX_MS)
  const m = Math.floor(clamped / 60000)
  const s = Math.floor(clamped / 1000) % 60
  const frac = clamped % 1000
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(3, '0')}`
}

function fmtStamp(t: number): string {
  const d = new Date(t)
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

function fileNameBase(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function baseName(name: string): string {
  return name.trim() === '' ? 'Untitled subtitles' : name.trim()
}

/** Removes inline markup (<i>, <c.jello>, <00:00:01.000>…) for display only. */
function stripCueMarkup(text: string): string {
  return text.replace(/<[^>]*>/g, '')
}

/**
 * Parses `HH:MM:SS,mmm` (SRT) and `HH:MM:SS.mmm` / `MM:SS.mmm` (VTT, hours
 * optional) into milliseconds. Extra fractional digits are truncated.
 */
function parseTimestamp(token: string): number | null {
  const t = token.trim().replace(',', '.')
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:\.(\d+))?$/.exec(t)
  if (!m) return null
  const h = m[1] ? parseInt(m[1], 10) : 0
  const min = parseInt(m[2] ?? '', 10)
  const s = parseInt(m[3] ?? '', 10)
  const frac = parseInt((m[4] ?? '0').slice(0, 3).padEnd(3, '0'), 10)
  if (!Number.isFinite(min) || !Number.isFinite(s) || !Number.isFinite(frac)) return null
  return ((h * 60 + min) * 60 + s) * 1000 + frac
}

/**
 * Tolerant SRT + VTT parser: handles the WEBVTT header, NOTE/STYLE/REGION
 * blocks, numeric or textual cue ids, cue settings after the timing line,
 * multi-line text and CRLF line endings. Blocks that contain no parseable
 * timing line are counted as skipped.
 */
function parseSubtitles(raw: string): ParseResult {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const format: 'srt' | 'vtt' = /^\s*WEBVTT/i.test(text) ? 'vtt' : 'srt'
  const cues: Cue[] = []
  let skipped = 0

  for (const block of text.split(/\n{2,}/)) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '')
    if (lines.length === 0) continue

    const head = lines[0] ?? ''
    if (/^(WEBVTT|NOTE|STYLE|REGION)\b/i.test(head)) continue

    const arrowIdx = lines.findIndex((l) => l.includes('-->'))
    if (arrowIdx === -1) {
      skipped += 1
      continue
    }

    const timing = (lines[arrowIdx] ?? '').split('-->')
    const startMs = parseTimestamp(timing[0] ?? '')
    // VTT cue settings (align:start line:0 …) trail the end timestamp — drop them.
    const endToken = (timing[1] ?? '').trim().split(/\s+/)[0] ?? ''
    const endMs = parseTimestamp(endToken)
    if (startMs === null || endMs === null) {
      skipped += 1
      continue
    }

    cues.push({
      id: uid(),
      startMs,
      endMs,
      text: lines.slice(arrowIdx + 1).join('\n'),
    })
  }

  cues.sort((a, b) => a.startMs - b.startMs)
  return { cues, skipped, format }
}

/** `HH:MM:SS,mmm` for SRT, `HH:MM:SS.mmm` for VTT. */
function timestamp(ms: number, vtt: boolean): string {
  const clamped = Math.min(Math.max(0, Math.round(ms)), MAX_MS)
  const h = Math.floor(clamped / 3600000)
  const m = Math.floor(clamped / 60000) % 60
  const s = Math.floor(clamped / 1000) % 60
  const frac = clamped % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${vtt ? '.' : ','}${String(frac).padStart(3, '0')}`
}

function serializeSrt(cues: Cue[]): string {
  const body = cues
    .map(
      (c, i) =>
        `${i + 1}\n${timestamp(c.startMs, false)} --> ${timestamp(c.endMs, false)}\n${
          c.text.replace(/\n+$/, '') || ' '
        }`,
    )
    .join('\n\n')
  return `${body}\n`
}

function serializeVtt(cues: Cue[]): string {
  const body = cues
    .map((c, i) => `${i + 1}\n${timestamp(c.startMs, true)} --> ${timestamp(c.endMs, true)}\n${c.text || ''}`)
    .join('\n\n')
  return `WEBVTT\n\n${body}\n`
}

function downloadText(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

/* ================================================================== */
/* Cue row (memoised — timeline sync re-renders at ~25 fps)            */
/* ================================================================== */

interface CueRowProps {
  cue: Cue
  index: number
  selected: boolean
  active: boolean
  invalid: boolean
  overlapMs: number
  onSelect: (cue: Cue) => void
  registerRef: (id: string, el: HTMLButtonElement | null) => void
}

const CueRow = memo(function CueRow({
  cue,
  index,
  selected,
  active,
  invalid,
  overlapMs,
  onSelect,
  registerRef,
}: CueRowProps) {
  const preview = stripCueMarkup(cue.text).trim()
  return (
    <button
      ref={(el) => registerRef(cue.id, el)}
      type="button"
      onClick={() => onSelect(cue)}
      aria-current={active || undefined}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-xl border p-2.5 text-left transition-colors',
        active
          ? 'border-cyan-400/60 bg-cyan-400/10'
          : selected
            ? 'border-white/25 bg-white/[0.07]'
            : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold tabular-nums',
          active ? 'bg-cyan-400/25 text-cyan-200' : 'bg-white/[0.06] text-zinc-400',
        )}
      >
        {index}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="font-mono text-[11px] tabular-nums text-cyan-300">{fmtClock(cue.startMs)}</span>
          <span className="text-[10px] text-zinc-600" aria-hidden>
            →
          </span>
          <span className="font-mono text-[11px] tabular-nums text-zinc-400">{fmtClock(cue.endMs)}</span>
          {invalid && (
            <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-rose-300">
              end ≤ start
            </span>
          )}
          {!invalid && overlapMs > 0 && (
            <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-300">
              overlap {overlapMs} ms
            </span>
          )}
        </span>
        <span
          className={cn(
            'mt-0.5 block truncate text-sm',
            preview === '' ? 'italic text-zinc-600' : 'text-zinc-200',
          )}
        >
          {preview === '' ? 'Empty cue — tap to edit' : preview}
        </span>
      </span>
    </button>
  )
})

/* ================================================================== */
/* Millisecond field — editable number input with deferred commit       */
/* ================================================================== */

function MsField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: number
  onCommit: (ms: number) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const shown = Math.max(0, Math.round(value))

  const commit = () => {
    if (editing === null) return
    const n = Math.round(Number(editing))
    if (Number.isFinite(n) && n >= 0) onCommit(Math.min(n, MAX_MS))
    setEditing(null)
  }

  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={100}
        value={editing ?? String(shown)}
        onFocus={() => setEditing(String(shown))}
        onChange={(e) => setEditing(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        aria-label={`${label} in milliseconds`}
        className={cn(FIELD_CLS, 'text-center font-mono tabular-nums')}
      />
    </label>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function SubtitleStudioApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [tab, setTab] = useState<TabId>('editor')
  const [projects, setProjects] = useState<SubProject[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [cues, setCues] = useState<Cue[]>([])
  const [videoName, setVideoName] = useState('')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoError, setVideoError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [currentMs, setCurrentMs] = useState(0)
  const [durationMs, setDurationMs] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [armed, setArmed] = useState<ArmedToken>(null)

  /* ---------------- refs ---------------- */
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const videoFileRef = useRef<HTMLInputElement | null>(null)
  const subsFileRef = useRef<HTMLInputElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const rafRef = useRef(0)
  const lastEmitRef = useRef(0)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())

  /* ---------------- derived ---------------- */
  const activeCue = useMemo(
    () => cues.find((c) => currentMs >= c.startMs && currentMs <= c.endMs) ?? null,
    [cues, currentMs],
  )
  const activeCueId = activeCue?.id ?? null
  const selectedCue = useMemo(() => cues.find((c) => c.id === selectedId) ?? null, [cues, selectedId])
  const selectedIndex = selectedCue ? cues.findIndex((c) => c.id === selectedCue.id) : -1

  /** Per-cue timing issues: end ≤ start is an error, overlap with the previous row a warning. */
  const issues = useMemo(() => {
    const map = new Map<string, { invalid: boolean; overlapMs: number }>()
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i]
      if (!c) continue
      const prev = cues[i - 1]
      map.set(c.id, {
        invalid: c.endMs <= c.startMs,
        overlapMs: prev ? Math.max(0, prev.endMs - c.startMs) : 0,
      })
    }
    return map
  }, [cues])

  const selectedIssue = selectedCue ? (issues.get(selectedCue.id) ?? null) : null
  const hasContent = projectId !== null || videoUrl !== null
  const sliderMax = durationMs > 0 ? Math.round(durationMs) : Math.max(1000, Math.round(currentMs))
  const sliderPct = sliderMax > 0 ? Math.min(100, (Math.min(currentMs, sliderMax) / sliderMax) * 100) : 0

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const rows = await idbGetAll<SubProject>(PROJECTS_STORE)
        if (!alive) return
        rows.sort((a, b) => b.updatedAt - a.updatedAt)
        setProjects(rows)
      } catch {
        /* private mode / quota — run memory-only */
      }
      if (alive) setHydrated(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- autosave (debounced 800 ms, write-through) ---------------- */
  useEffect(() => {
    if (!projectId) return
    const t = window.setTimeout(() => {
      const row: SubProject = {
        id: projectId,
        name: baseName(projectName),
        cues,
        videoName,
        updatedAt: Date.now(),
      }
      void idbPut(PROJECTS_STORE, row)
        .then(() => {
          setProjects((prev) => {
            const next = prev.filter((p) => p.id !== row.id)
            next.push(row)
            next.sort((a, b) => b.updatedAt - a.updatedAt)
            return next
          })
          setSavedAt(row.updatedAt)
        })
        .catch(() => {
          /* memory-only fallback */
        })
    }, 800)
    return () => window.clearTimeout(t)
  }, [projectId, projectName, cues, videoName])

  /* ---------------- armed-to-confirm tokens expire ---------------- */
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(null), 2600)
    return () => window.clearTimeout(t)
  }, [armed])

  /* ---------------- auto-scroll the active cue into view ---------------- */
  useEffect(() => {
    if (!activeCueId || !playing) return
    rowRefs.current.get(activeCueId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeCueId, playing])

  /* ---------------- unmount cleanup ---------------- */
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [])

  /* ---------------- playback plumbing ---------------- */
  const startRaf = useCallback(() => {
    if (rafRef.current) return
    const tick = () => {
      const v = videoRef.current
      if (v && Number.isFinite(v.currentTime)) {
        const ms = v.currentTime * 1000
        const now = performance.now()
        if (now - lastEmitRef.current >= 40) {
          lastEmitRef.current = now
          setCurrentMs(ms)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [])

  const syncFromVideo = useCallback(() => {
    const v = videoRef.current
    if (v && Number.isFinite(v.currentTime)) setCurrentMs(v.currentTime * 1000)
  }, [])

  const playheadMs = useCallback(() => {
    const v = videoRef.current
    return v && Number.isFinite(v.currentTime) ? Math.round(v.currentTime * 1000) : 0
  }, [])

  const seekTo = useCallback((ms: number) => {
    const clamped = Math.max(0, ms)
    const v = videoRef.current
    if (v) {
      const dur = Number.isFinite(v.duration) ? v.duration * 1000 : Number.POSITIVE_INFINITY
      const t = Math.min(clamped, dur)
      v.currentTime = t / 1000
      setCurrentMs(t)
    } else {
      setCurrentMs(Math.min(clamped, MAX_MS))
    }
  }, [])

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) {
      toast({ title: 'Load a video first', description: 'Cues can be written without one, but sync needs it.' })
      return
    }
    if (v.paused) {
      void v.play().catch(() => {
        toast({ title: 'Playback blocked', description: 'Tap play once more to retry.' })
      })
    } else {
      v.pause()
    }
  }, [toast])

  const hop = useCallback(
    (deltaMs: number) => {
      seekTo(playheadMs() + deltaMs)
      haptic()
    },
    [playheadMs, seekTo],
  )

  /* ---------------- project lifecycle ---------------- */
  const ensureProjectFor = useCallback((name: string) => {
    setProjectId((cur) => cur ?? uid())
    setProjectName((cur) => (cur.trim() === '' ? baseName(name) : cur))
  }, [])

  const detachVideo = useCallback(() => {
    stopRaf()
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    setVideoUrl(null)
    setVideoError(false)
    setPlaying(false)
    setCurrentMs(0)
    setDurationMs(0)
  }, [stopRaf])

  const pickVideo = useCallback(
    (file: File | undefined) => {
      if (!file) return
      const looksLikeVideo =
        file.type.startsWith('video/') || /\.(mp4|webm|mov|mkv|m4v|avi|3gp|ogv|ts)$/i.test(file.name)
      if (!looksLikeVideo) {
        toast({ title: 'Not a video file', description: file.name })
        return
      }
      detachVideo()
      const url = URL.createObjectURL(file)
      urlRef.current = url
      setVideoUrl(url)
      setVideoName(file.name)
      ensureProjectFor(fileNameBase(file.name))
      haptic()
      toast({ title: 'Video loaded', description: `${file.name} · stays on this device` })
    },
    [detachVideo, ensureProjectFor, toast],
  )

  const importSubtitles = useCallback(
    async (file: File | undefined) => {
      if (!file) return
      try {
        const raw = await file.text()
        const res = parseSubtitles(raw)
        if (res.cues.length === 0) {
          toast({ title: 'No cues found', description: 'Check that this is an .srt or .vtt file.' })
          return
        }
        ensureProjectFor(fileNameBase(file.name))
        setCues((prev) => (prev.length === 0 ? res.cues : [...prev, ...res.cues].sort((a, b) => a.startMs - b.startMs)))
        haptic()
        toast({
          title: `Parsed ${res.cues.length} cue${res.cues.length === 1 ? '' : 's'}`,
          description: `${res.format.toUpperCase()} · ${file.name}${
            res.skipped > 0 ? ` · ${res.skipped} malformed block${res.skipped === 1 ? '' : 's'} skipped` : ''
          }`,
        })
      } catch {
        toast({ title: 'Could not read file', description: file.name })
      } finally {
        if (subsFileRef.current) subsFileRef.current.value = ''
      }
    },
    [ensureProjectFor, toast],
  )

  const startBlank = useCallback(() => {
    detachVideo()
    setProjectId(uid())
    setProjectName('Untitled subtitles')
    setCues([])
    setVideoName('')
    setSelectedId(null)
    setSavedAt(null)
    haptic()
    toast({ title: 'Blank project started', description: 'Add cues at the playhead or import a file.' })
  }, [detachVideo, toast])

  const openProject = useCallback(
    (p: SubProject) => {
      detachVideo()
      setProjectId(p.id)
      setProjectName(p.name)
      setCues(p.cues)
      setVideoName(p.videoName)
      setSelectedId(null)
      setSavedAt(null)
      setArmed(null)
      setTab('editor')
      haptic()
      toast({
        title: `Opened “${p.name}”`,
        description: p.videoName
          ? `Re-pick “${p.videoName}” to sync — videos are never saved.`
          : 'Blank project — link a video anytime.',
      })
    },
    [detachVideo, toast],
  )

  const deleteProject = useCallback(
    (id: string) => {
      const token: ArmedToken = `project:${id}`
      if (armed !== token) {
        setArmed(token)
        return
      }
      setArmed(null)
      haptic()
      setProjects((prev) => prev.filter((p) => p.id !== id))
      void idbDelete(PROJECTS_STORE, id).catch(() => {
        /* memory-only fallback */
      })
      if (projectId === id) {
        detachVideo()
        setProjectId(null)
        setProjectName('')
        setCues([])
        setVideoName('')
        setSelectedId(null)
        setSavedAt(null)
      }
      toast({ title: 'Project deleted' })
    },
    [armed, detachVideo, projectId, toast],
  )

  const clearProjects = useCallback(() => {
    if (armed !== 'clear') {
      setArmed('clear')
      return
    }
    setArmed(null)
    haptic()
    setProjects([])
    void idbClear(PROJECTS_STORE).catch(() => {
      /* memory-only fallback */
    })
    if (projectId !== null) {
      detachVideo()
      setProjectId(null)
      setProjectName('')
      setCues([])
      setVideoName('')
      setSelectedId(null)
      setSavedAt(null)
    }
    toast({ title: 'All projects cleared' })
  }, [armed, detachVideo, projectId, toast])

  /* ---------------- cue mutations (setState first, autosave persists) ---------------- */
  const selectCue = useCallback(
    (cue: Cue) => {
      setSelectedId(cue.id)
      seekTo(cue.startMs)
      haptic()
    },
    [seekTo],
  )

  const registerRef = useCallback((id: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(id, el)
    else rowRefs.current.delete(id)
  }, [])

  const addCue = useCallback(() => {
    ensureProjectFor('Untitled subtitles')
    const start = playheadMs()
    const cue: Cue = { id: uid(), startMs: start, endMs: start + 2000, text: '' }
    setCues((prev) => {
      let idx = prev.findIndex((c) => c.startMs > start)
      if (idx === -1) idx = prev.length
      const next = [...prev]
      next.splice(idx, 0, cue)
      return next
    })
    setSelectedId(cue.id)
    haptic()
  }, [ensureProjectFor, playheadMs])

  const duplicateCue = useCallback((cue: Cue) => {
    const copy: Cue = { ...cue, id: uid() }
    setCues((prev) => {
      const idx = prev.findIndex((c) => c.id === cue.id)
      const next = [...prev]
      next.splice(idx + 1, 0, copy)
      return next
    })
    setSelectedId(copy.id)
    haptic()
  }, [])

  const deleteCue = useCallback(
    (cue: Cue) => {
      const token: ArmedToken = `cue:${cue.id}`
      if (armed !== token) {
        setArmed(token)
        return
      }
      setArmed(null)
      haptic()
      setCues((prev) => prev.filter((c) => c.id !== cue.id))
      setSelectedId((cur) => (cur === cue.id ? null : cur))
      toast({ title: 'Cue deleted' })
    },
    [armed, toast],
  )

  const moveCue = useCallback((cue: Cue, dir: -1 | 1) => {
    setCues((prev) => {
      const i = prev.findIndex((c) => c.id === cue.id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      const a = next[i]
      const b = next[j]
      if (!a || !b) return prev
      next[i] = b
      next[j] = a
      return next
    })
    haptic()
  }, [])

  const patchCue = useCallback((cueId: string, patch: Partial<Omit<Cue, 'id'>>) => {
    setCues((prev) => prev.map((c) => (c.id === cueId ? { ...c, ...patch } : c)))
  }, [])

  const nudgeCue = useCallback(
    (field: 'startMs' | 'endMs', delta: number) => {
      if (!selectedId) return
      setCues((prev) =>
        prev.map((c) => {
          if (c.id !== selectedId) return c
          return field === 'startMs'
            ? { ...c, startMs: Math.max(0, Math.min(MAX_MS, c.startMs + delta)) }
            : { ...c, endMs: Math.max(0, Math.min(MAX_MS, c.endMs + delta)) }
        }),
      )
      haptic()
    },
    [selectedId],
  )

  const stampCue = useCallback(
    (field: 'startMs' | 'endMs') => {
      if (!selectedId) {
        toast({ title: 'Select a cue first', description: 'Tap a row, then stamp the playhead time into it.' })
        return
      }
      const t = playheadMs()
      patchCue(selectedId, field === 'startMs' ? { startMs: t } : { endMs: t })
      haptic()
    },
    [patchCue, playheadMs, selectedId, toast],
  )

  const splitCue = useCallback(() => {
    if (!selectedCue) {
      toast({ title: 'Select a cue first' })
      return
    }
    const t = playheadMs()
    if (!(t > selectedCue.startMs + 50 && t < selectedCue.endMs - 50)) {
      toast({
        title: 'Put the playhead inside the cue',
        description: `Split needs ${fmtClock(selectedCue.startMs)} < playhead < ${fmtClock(selectedCue.endMs)}.`,
      })
      return
    }
    const lines = selectedCue.text.split('\n')
    const cut = Math.ceil(lines.length / 2)
    const topText = lines.slice(0, cut).join('\n')
    const bottomText = lines.length > 1 ? lines.slice(cut).join('\n') : ''
    const second: Cue = { id: uid(), startMs: t, endMs: selectedCue.endMs, text: bottomText }
    setCues((prev) => {
      const i = prev.findIndex((c) => c.id === selectedCue.id)
      if (i < 0) return prev
      const next = [...prev]
      next[i] = { ...selectedCue, endMs: t, text: topText }
      next.splice(i + 1, 0, second)
      return next
    })
    setSelectedId(second.id)
    haptic()
    toast({ title: 'Cue split at playhead', description: 'Write the text for the second half.' })
  }, [playheadMs, selectedCue, toast])

  /* ---------------- export ---------------- */
  const exportSrt = useCallback(() => {
    if (cues.length === 0) return
    const name = `subtitle-${Date.now()}.srt`
    downloadText(serializeSrt(cues), name, 'application/x-subrip')
    haptic()
    toast({ title: 'SRT exported', description: `${name} · ${cues.length} cue${cues.length === 1 ? '' : 's'}` })
  }, [cues, toast])

  const exportVtt = useCallback(() => {
    if (cues.length === 0) return
    const name = `subtitle-${Date.now()}.vtt`
    downloadText(serializeVtt(cues), name, 'text/vtt')
    haptic()
    toast({ title: 'VTT exported', description: `${name} · ${cues.length} cue${cues.length === 1 ? '' : 's'}` })
  }, [cues, toast])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="min-h-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 pb-12 pt-5 sm:px-6">
        {/* universal pickers — video + subtitle files */}
        <input
          ref={videoFileRef}
          type="file"
          accept="video/*,.mp4,.webm,.mov,.mkv,.m4v"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            void pickVideo(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <input
          ref={subsFileRef}
          type="file"
          accept=".srt,.vtt,text/vtt,application/x-subrip"
          className="hidden"
          aria-hidden
          tabIndex={-1}
          onChange={(e) => {
            void importSubtitles(e.target.files?.[0])
            e.target.value = ''
          }}
        />

        {/* ---------------- identity header ---------------- */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-cyan-400 via-teal-500 to-emerald-600 px-4 py-4 text-white shadow-[0_18px_44px_-18px_rgb(20_184_166/0.65)] sm:px-5"
        >
          <div className="flex items-center gap-3.5">
            <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/20 ring-1 ring-white/40 backdrop-blur-sm">
              <SubtitlesIcon className="size-6" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-lg font-extrabold tracking-tight">Subtitle Studio</h1>
              <p className="truncate text-xs text-white/85">Perfect sync, zero upload</p>
            </div>
            <Badge
              variant="outline"
              className="hidden shrink-0 border-white/40 bg-white/10 text-[10px] font-bold uppercase tracking-wider text-white sm:inline-flex"
            >
              SRT · VTT
            </Badge>
          </div>
        </motion.div>

        {/* ---------------- tabs ---------------- */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as TabId)} className="mt-4">
          <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
            <TabsTrigger value="editor" className={TRIGGER_CLS} aria-label="Subtitle editor">
              <Clapperboard className="size-4" aria-hidden />
              Editor
            </TabsTrigger>
            <TabsTrigger
              value="projects"
              className={TRIGGER_CLS}
              aria-label={`Projects, ${projects.length} saved`}
            >
              <FolderOpen className="size-4" aria-hidden />
              Projects
              {projects.length > 0 && (
                <span className="rounded-full bg-cyan-400/20 px-1.5 text-[9px] font-bold tabular-nums text-cyan-300">
                  {projects.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ==================== TAB 1 — EDITOR ==================== */}
          <TabsContent value="editor" className="mt-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              className="space-y-4"
            >
              {!hasContent ? (
                /* ---------- premium empty state ---------- */
                <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                  <span className="flex size-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                    <Captions className="size-8 text-cyan-300" strokeWidth={1.6} aria-hidden />
                  </span>
                  <p className="text-base font-bold tracking-tight">Subtitle your video in minutes</p>
                  <p className="max-w-xs text-sm text-zinc-400">
                    Load a video, import an .srt or .vtt file (or start blank), and time every line against a live
                    preview with a real subtitle overlay.
                  </p>
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    <Button
                      onClick={() => videoFileRef.current?.click()}
                      className="h-11 rounded-xl bg-gradient-to-r from-cyan-400 via-teal-500 to-emerald-600 font-semibold text-white shadow-lg hover:from-cyan-300 hover:via-teal-400 hover:to-emerald-500"
                    >
                      <FileVideo className="size-4" aria-hidden /> Load video
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => subsFileRef.current?.click()}
                      className="h-11 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white"
                    >
                      <FileUp className="size-4" aria-hidden /> Load subtitles
                    </Button>
                    <Button
                      variant="outline"
                      onClick={startBlank}
                      className="h-11 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white"
                    >
                      <FilePlus2 className="size-4" aria-hidden /> Start blank
                    </Button>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    {['SRT + VTT import', 'Frame-accurate sync', 'Both exports', 'Nothing uploaded'].map((chip) => (
                      <span
                        key={chip}
                        className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold text-zinc-400"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                    <Info className="size-3.5 shrink-0 text-cyan-400/70" aria-hidden />
                    Your video never leaves this device — only the subtitle text is saved.
                  </p>
                </section>
              ) : (
                <>
                  {/* ---------- player / relink ---------- */}
                  {videoUrl ? (
                    <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <h2 className="text-sm font-bold tracking-tight">Preview</h2>
                        <span className="min-w-0 flex-1 truncate text-xs text-zinc-500">{videoName}</span>
                        <button
                          type="button"
                          onClick={() => videoFileRef.current?.click()}
                          aria-label="Change video file"
                          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <FileVideo className="size-4" aria-hidden />
                        </button>
                      </div>

                      <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
                        <video
                          ref={videoRef}
                          src={videoUrl}
                          preload="metadata"
                          controls={false}
                          playsInline
                          className="block max-h-[46vh] w-full object-contain sm:max-h-[56vh]"
                          onPlay={() => {
                            setPlaying(true)
                            startRaf()
                          }}
                          onPause={() => {
                            setPlaying(false)
                            stopRaf()
                            syncFromVideo()
                          }}
                          onEnded={() => {
                            setPlaying(false)
                            stopRaf()
                            syncFromVideo()
                          }}
                          onTimeUpdate={() => {
                            if (!rafRef.current) syncFromVideo()
                          }}
                          onSeeked={syncFromVideo}
                          onLoadedMetadata={(e) => {
                            const d = e.currentTarget.duration
                            if (Number.isFinite(d)) setDurationMs(d * 1000)
                            syncFromVideo()
                          }}
                          onDurationChange={(e) => {
                            const d = e.currentTarget.duration
                            setDurationMs(Number.isFinite(d) ? d * 1000 : 0)
                          }}
                          onError={() => {
                            if (urlRef.current) setVideoError(true)
                          }}
                        />

                        {/* live-sync chip */}
                        {playing && !videoError && (
                          <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-cyan-300 ring-1 ring-cyan-400/40">
                            <span className="relative flex size-1.5">
                              <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                              <span className="relative inline-flex size-1.5 rounded-full bg-cyan-400" />
                            </span>
                            Live sync
                          </span>
                        )}

                        {/* subtitle overlay — the core feature */}
                        <AnimatePresence>
                          {activeCue && stripCueMarkup(activeCue.text).trim() !== '' && !videoError && (
                            <motion.div
                              key={activeCue.id}
                              initial={{ opacity: 0, y: 8 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 8 }}
                              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                              className="pointer-events-none absolute inset-x-2 bottom-3 z-10 flex justify-center"
                            >
                              <span className="max-w-full whitespace-pre-wrap rounded-lg bg-black/75 px-3 py-1.5 text-center text-sm font-medium leading-snug text-white [text-shadow:0_1px_2px_rgb(0_0_0/0.9),0_0_8px_rgb(0_0_0/0.6)] sm:text-base">
                                {stripCueMarkup(activeCue.text)}
                              </span>
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* decode error panel */}
                        {videoError && (
                          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/85 px-6 text-center backdrop-blur-sm">
                            <span className="flex size-12 items-center justify-center rounded-full bg-amber-400/15 ring-1 ring-amber-300/30">
                              <TriangleAlert className="size-6 text-amber-300" aria-hidden />
                            </span>
                            <div>
                              <p className="text-sm font-bold">This format can’t play in-browser</p>
                              <p className="mx-auto mt-1 max-w-[260px] text-xs leading-relaxed text-zinc-400">
                                {videoName} uses a codec this browser can’t decode — MP4 (H.264) and WebM play best.
                              </p>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => videoFileRef.current?.click()}
                              className="h-11 rounded-full bg-white/10 px-4 text-zinc-100 hover:bg-white/20"
                            >
                              <FileVideo className="size-4" aria-hidden /> Choose another file
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* transport */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button
                          onClick={togglePlay}
                          aria-label={playing ? 'Pause' : 'Play'}
                          className="size-14 shrink-0 rounded-full bg-gradient-to-br from-cyan-400 via-teal-500 to-emerald-600 text-white shadow-lg hover:from-cyan-300 hover:via-teal-400 hover:to-emerald-500"
                        >
                          {playing ? <Pause className="size-6" aria-hidden /> : <Play className="size-6" aria-hidden />}
                        </Button>
                        <button
                          type="button"
                          onClick={() => hop(-5000)}
                          aria-label="Back 5 seconds"
                          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <SkipBack className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => hop(5000)}
                          aria-label="Forward 5 seconds"
                          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                        >
                          <SkipForward className="size-4" aria-hidden />
                        </button>
                        <div className="min-w-[140px] flex-1">
                          <input
                            type="range"
                            min={0}
                            max={sliderMax}
                            step={50}
                            value={Math.min(Math.round(currentMs), sliderMax)}
                            onChange={(e) => seekTo(Number(e.target.value))}
                            aria-label="Seek"
                            className={RANGE_CLS}
                            style={{ '--pct': `${sliderPct}%` } as CSSProperties}
                          />
                        </div>
                      </div>
                      <p className="mt-1 text-right font-mono text-[11px] tabular-nums text-zinc-500">
                        <span className="text-cyan-300">{fmtClock(currentMs)}</span>
                        {' / '}
                        {durationMs > 0 ? fmtClock(durationMs) : '--:--.---'}
                      </p>
                    </section>
                  ) : (
                    /* ---------- video not linked (reopened project / blank) ---------- */
                    <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-amber-400/25 bg-amber-400/[0.04] p-4">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-400/15 text-amber-300 ring-1 ring-amber-300/25">
                        <VideoOff className="size-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold tracking-tight">
                          {videoName ? 'Video not linked' : 'No video linked yet'}
                        </p>
                        <p className="truncate text-xs text-zinc-400">
                          {videoName
                            ? `Cues are loaded — re-pick “${videoName}” to sync and preview.`
                            : 'Cues can be written without one, but sync needs a video.'}
                        </p>
                      </div>
                      <Button
                        onClick={() => videoFileRef.current?.click()}
                        className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-cyan-400 via-teal-500 to-emerald-600 font-semibold text-white shadow-lg hover:from-cyan-300 hover:via-teal-400 hover:to-emerald-500"
                      >
                        <FileVideo className="size-4" aria-hidden /> {videoName ? 'Re-pick video' : 'Load video'}
                      </Button>
                    </section>
                  )}

                  {/* ---------- project bar ---------- */}
                  <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 shrink-0 text-cyan-300" aria-hidden />
                      <input
                        type="text"
                        value={projectName}
                        onChange={(e) => setProjectName(e.target.value)}
                        placeholder="Project name"
                        aria-label="Project name"
                        maxLength={80}
                        className={cn(FIELD_CLS, 'min-w-0 flex-1')}
                      />
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-400/30">
                        <Check className="size-3" aria-hidden />
                        {savedAt !== null
                          ? new Date(savedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                          : 'Autosave'}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        onClick={exportSrt}
                        disabled={cues.length === 0}
                        className="h-11 min-w-[104px] flex-1 rounded-xl bg-gradient-to-r from-cyan-400 via-teal-500 to-emerald-600 font-semibold text-white shadow-lg hover:from-cyan-300 hover:via-teal-400 hover:to-emerald-500 disabled:from-zinc-700 disabled:via-zinc-700 disabled:to-zinc-700"
                      >
                        <Download className="size-4" aria-hidden /> SRT
                      </Button>
                      <Button
                        onClick={exportVtt}
                        disabled={cues.length === 0}
                        variant="outline"
                        className="h-11 min-w-[104px] flex-1 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white"
                      >
                        <Download className="size-4" aria-hidden /> VTT
                      </Button>
                      <Button
                        onClick={startBlank}
                        variant="ghost"
                        className="h-11 rounded-xl text-zinc-300 hover:bg-white/10 hover:text-white"
                      >
                        <Plus className="size-4" aria-hidden /> New
                      </Button>
                    </div>
                  </section>

                  {/* ---------- cue list + editor ---------- */}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                    <section className="rounded-2xl border border-white/10 bg-white/5 p-4 lg:col-span-5">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <h2 className="text-sm font-bold tracking-tight">Cues</h2>
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold tabular-nums text-zinc-400">
                          {cues.length}
                        </span>
                        <span className="min-w-0 flex-1" />
                        <Button
                          variant="outline"
                          onClick={() => subsFileRef.current?.click()}
                          className="h-11 shrink-0 rounded-xl border-white/15 bg-transparent px-3 text-xs text-zinc-200 hover:bg-white/10 hover:text-white"
                        >
                          <FileUp className="size-4" aria-hidden /> Import
                        </Button>
                        <Button
                          onClick={addCue}
                          className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-cyan-400 via-teal-500 to-emerald-600 px-3 text-xs font-semibold text-white shadow-lg hover:from-cyan-300 hover:via-teal-400 hover:to-emerald-500"
                        >
                          <Plus className="size-4" aria-hidden /> Add
                        </Button>
                      </div>

                      {cues.length === 0 ? (
                        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-8 text-center">
                          <span className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.04]">
                            <Captions className="size-6 text-cyan-300" strokeWidth={1.6} aria-hidden />
                          </span>
                          <p className="text-sm font-semibold">No cues yet</p>
                          <p className="max-w-[220px] text-xs text-zinc-500">
                            Add one at the playhead, or import an .srt / .vtt file to start from.
                          </p>
                        </div>
                      ) : (
                        <div className={cn('max-h-96 space-y-2 overflow-y-auto pr-1', THIN_SCROLLBAR)}>
                          {cues.map((cue, i) => {
                            const issue = issues.get(cue.id)
                            return (
                              <CueRow
                                key={cue.id}
                                cue={cue}
                                index={i + 1}
                                selected={cue.id === selectedId}
                                active={cue.id === activeCueId}
                                invalid={issue?.invalid ?? false}
                                overlapMs={issue?.overlapMs ?? 0}
                                onSelect={selectCue}
                                registerRef={registerRef}
                              />
                            )
                          })}
                        </div>
                      )}
                    </section>

                    <section className="rounded-2xl border border-white/10 bg-white/5 p-4 lg:col-span-7">
                      <div className="mb-3 flex min-h-11 flex-wrap items-center gap-2">
                        <h2 className="text-sm font-bold tracking-tight">
                          {selectedCue ? `Cue #${selectedIndex + 1}` : 'Cue editor'}
                        </h2>
                        {selectedCue && selectedIssue && (
                          <>
                            {selectedIssue.invalid ? (
                              <span className="rounded-full bg-rose-500/15 px-2 py-1 text-[10px] font-bold text-rose-300 ring-1 ring-rose-400/30">
                                End must be after start
                              </span>
                            ) : selectedIssue.overlapMs > 0 ? (
                              <span className="rounded-full bg-amber-400/15 px-2 py-1 text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/30">
                                Overlaps previous by {selectedIssue.overlapMs} ms
                              </span>
                            ) : (
                              <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-400/30">
                                Timing OK
                              </span>
                            )}
                          </>
                        )}
                        {selectedCue && (
                          <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-500">
                            {((selectedCue.endMs - selectedCue.startMs) / 1000).toFixed(2)} s
                          </span>
                        )}
                      </div>

                      {!selectedCue ? (
                        <div className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
                          <Captions className="size-6 text-zinc-600" aria-hidden />
                          <p className="text-sm font-semibold text-zinc-400">No cue selected</p>
                          <p className="max-w-[240px] text-xs text-zinc-600">
                            Tap a row on the left to edit its timing and text.
                          </p>
                        </div>
                      ) : (
                        <>
                          {/* timing rows */}
                          <div className="space-y-2.5">
                            <div className="flex items-end gap-1.5">
                              <MsField
                                label="Start (ms)"
                                value={selectedCue.startMs}
                                onCommit={(ms) => patchCue(selectedCue.id, { startMs: ms })}
                              />
                              <button
                                type="button"
                                onClick={() => nudgeCue('startMs', -100)}
                                aria-label="Nudge start 100 ms earlier"
                                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                <Minus className="size-4" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => nudgeCue('startMs', 100)}
                                aria-label="Nudge start 100 ms later"
                                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                <Plus className="size-4" aria-hidden />
                              </button>
                              <Button
                                onClick={() => stampCue('startMs')}
                                aria-label="Set start to the current playhead time"
                                className="h-11 shrink-0 rounded-xl bg-cyan-400/15 px-3 text-xs font-semibold text-cyan-200 ring-1 ring-cyan-400/30 hover:bg-cyan-400/25"
                              >
                                Set
                              </Button>
                            </div>

                            <div className="flex items-end gap-1.5">
                              <MsField
                                label="End (ms)"
                                value={selectedCue.endMs}
                                onCommit={(ms) => patchCue(selectedCue.id, { endMs: ms })}
                              />
                              <button
                                type="button"
                                onClick={() => nudgeCue('endMs', -100)}
                                aria-label="Nudge end 100 ms earlier"
                                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                <Minus className="size-4" aria-hidden />
                              </button>
                              <button
                                type="button"
                                onClick={() => nudgeCue('endMs', 100)}
                                aria-label="Nudge end 100 ms later"
                                className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                <Plus className="size-4" aria-hidden />
                              </button>
                              <Button
                                onClick={() => stampCue('endMs')}
                                aria-label="Set end to the current playhead time"
                                className="h-11 shrink-0 rounded-xl bg-cyan-400/15 px-3 text-xs font-semibold text-cyan-200 ring-1 ring-cyan-400/30 hover:bg-cyan-400/25"
                              >
                                Set
                              </Button>
                            </div>
                          </div>

                          {/* text */}
                          <label className="mt-3 flex flex-col gap-1">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                              Text (multi-line)
                            </span>
                            <textarea
                              value={selectedCue.text}
                              onChange={(e) => patchCue(selectedCue.id, { text: e.target.value })}
                              rows={3}
                              placeholder="What is spoken during this cue…"
                              aria-label="Cue text"
                              className="min-h-24 w-full resize-y rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-cyan-400/60"
                            />
                          </label>

                          {/* workflow + row actions */}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button
                              onClick={splitCue}
                              className="h-11 rounded-xl bg-white/[0.06] px-3 text-xs font-semibold text-zinc-100 ring-1 ring-white/10 hover:bg-white/10"
                            >
                              <SquareSplitHorizontal className="size-4" aria-hidden /> Split at playhead
                            </Button>
                            <Button
                              onClick={() => duplicateCue(selectedCue)}
                              className="h-11 rounded-xl bg-white/[0.06] px-3 text-xs font-semibold text-zinc-100 ring-1 ring-white/10 hover:bg-white/10"
                            >
                              <Copy className="size-4" aria-hidden /> Duplicate
                            </Button>
                            <Button
                              onClick={() => deleteCue(selectedCue)}
                              className={cn(
                                'h-11 rounded-xl px-3 text-xs font-semibold ring-1 transition-colors',
                                armed === `cue:${selectedCue.id}`
                                  ? 'bg-rose-500/20 text-rose-200 ring-rose-400/40 hover:bg-rose-500/30'
                                  : 'bg-white/[0.06] text-zinc-300 ring-white/10 hover:bg-rose-500/15 hover:text-rose-200',
                              )}
                            >
                              <Trash2 className="size-4" aria-hidden />
                              {armed === `cue:${selectedCue.id}` ? 'Confirm?' : 'Delete'}
                            </Button>
                            <Button
                              onClick={() => moveCue(selectedCue, -1)}
                              disabled={selectedIndex <= 0}
                              aria-label="Move cue up"
                              className="size-11 rounded-xl bg-white/[0.06] p-0 text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white"
                            >
                              <ArrowUp className="size-4" aria-hidden />
                            </Button>
                            <Button
                              onClick={() => moveCue(selectedCue, 1)}
                              disabled={selectedIndex === -1 || selectedIndex >= cues.length - 1}
                              aria-label="Move cue down"
                              className="size-11 rounded-xl bg-white/[0.06] p-0 text-zinc-300 ring-1 ring-white/10 hover:bg-white/10 hover:text-white"
                            >
                              <ArrowDown className="size-4" aria-hidden />
                            </Button>
                          </div>
                        </>
                      )}
                    </section>
                  </div>
                </>
              )}
            </motion.div>
          </TabsContent>

          {/* ==================== TAB 2 — PROJECTS ==================== */}
          <TabsContent value="projects" className="mt-4">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 28 }}
              className="space-y-3"
            >
              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-bold tracking-tight">Saved projects</h2>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-bold tabular-nums text-zinc-400">
                    {projects.length}
                  </span>
                  <span className="min-w-0 flex-1" />
                  {projects.length > 0 && (
                    <Button
                      onClick={clearProjects}
                      className={cn(
                        'h-11 rounded-xl px-3 text-xs font-semibold ring-1 transition-colors',
                        armed === 'clear'
                          ? 'bg-rose-500/20 text-rose-200 ring-rose-400/40 hover:bg-rose-500/30'
                          : 'bg-white/[0.06] text-zinc-300 ring-white/10 hover:bg-rose-500/15 hover:text-rose-200',
                      )}
                    >
                      <Trash2 className="size-4" aria-hidden />
                      {armed === 'clear' ? 'Tap again to clear' : 'Clear all'}
                    </Button>
                  )}
                </div>

                {!hydrated ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
                    <Loader2 className="size-4 animate-spin text-cyan-400" aria-hidden /> Loading projects…
                  </div>
                ) : projects.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
                    <span className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.04]">
                      <FolderOpen className="size-6 text-cyan-300" strokeWidth={1.6} aria-hidden />
                    </span>
                    <p className="text-sm font-semibold">No saved projects yet</p>
                    <p className="max-w-[250px] text-xs text-zinc-500">
                      Everything you edit autosaves here about a second after you stop typing.
                    </p>
                  </div>
                ) : (
                  <div className={cn('max-h-96 space-y-2 overflow-y-auto pr-1', THIN_SCROLLBAR)}>
                    {projects.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] text-cyan-300">
                          <FileText className="size-4" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{p.name}</p>
                          <p className="truncate text-[11px] text-zinc-500">
                            {p.cues.length} cue{p.cues.length === 1 ? '' : 's'} · {p.videoName || 'no video'} ·{' '}
                            {fmtStamp(p.updatedAt)}
                          </p>
                        </div>
                        <Button
                          onClick={() => openProject(p)}
                          className="h-11 shrink-0 rounded-xl bg-white/[0.06] px-3 text-xs font-semibold text-zinc-100 ring-1 ring-white/10 hover:bg-white/10"
                        >
                          Open
                        </Button>
                        <button
                          type="button"
                          onClick={() => deleteProject(p.id)}
                          aria-label={
                            armed === `project:${p.id}` ? 'Tap again to delete this project' : 'Delete project'
                          }
                          className={cn(
                            'flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors',
                            armed === `project:${p.id}`
                              ? 'border-rose-400/40 bg-rose-500/20 text-rose-200'
                              : 'border-white/10 bg-white/[0.04] text-zinc-400 hover:bg-rose-500/15 hover:text-rose-200',
                          )}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <p className="flex items-center gap-1.5 px-1 text-[11px] text-zinc-500">
                <Info className="size-3.5 shrink-0 text-cyan-400/70" aria-hidden />
                Video files are never saved — reopening a project keeps your cues and asks you to re-pick the video.
              </p>
            </motion.div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
