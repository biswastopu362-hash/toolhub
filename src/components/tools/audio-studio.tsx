'use client'

/**
 * Audio Studio — trim, merge and convert audio, offline.
 *
 * Clips are decoded with the Web Audio API and live for this session only.
 * A canvas waveform shows min/max peaks of the active clip with drag-to-
 * select regions (draggable handles), playback with loop, trim-to-new-clip /
 * replace, ordered merging with automatic resampling, and exports to
 * 16-bit PCM WAV (offline render @ 44.1 kHz) or WebM (real-time
 * MediaRecorder capture with a progress modal). No network, no uploads.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AudioWaveform,
  Check,
  Download,
  FileAudio,
  FolderOpen,
  Info,
  ListPlus,
  Loader2,
  Merge,
  Music4,
  Pause,
  Play,
  Plus,
  Repeat,
  Scissors,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model — session-only, nothing persists                              */
/* ================================================================== */

interface Clip {
  id: string
  name: string
  buffer: AudioBuffer
  createdAt: number
}

interface Span {
  start: number
  end: number
}

const TARGET_RATE = 44100
const MIN_SELECTION = 0.03 // seconds — below this a drag counts as a click

function haptic() {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

function fmtTime(s: number, tenths = false): string {
  const safe = Math.max(0, s)
  const m = Math.floor(safe / 60)
  const sec = Math.floor(safe % 60)
  const base = `${m}:${String(sec).padStart(2, '0')}`
  return tenths ? `${base}.${Math.floor((safe % 1) * 10)}` : base
}

function chanLabel(n: number): string {
  if (n <= 1) return 'Mono'
  if (n === 2) return 'Stereo'
  return `${n} ch`
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'clip'
  )
}

function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/* ================================================================== */
/* Audio helpers                                                       */
/* ================================================================== */

let sharedCtx: AudioContext | null = null

function ensureCtx(): AudioContext {
  if (!sharedCtx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    sharedCtx = new Ctor()
  }
  return sharedCtx
}

/** Resample a buffer to `targetRate` by rendering it through an OfflineAudioContext. */
async function resampleBuffer(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetRate) return buffer
  const length = Math.max(1, Math.ceil(buffer.duration * targetRate))
  const offline = new OfflineAudioContext(buffer.numberOfChannels, length, targetRate)
  const src = offline.createBufferSource()
  src.buffer = buffer
  src.connect(offline.destination)
  src.start()
  return offline.startRendering()
}

/** Copy a subregion [startSample, endSample) of every channel into a new buffer. */
function sliceBuffer(buffer: AudioBuffer, startSample: number, endSample: number): AudioBuffer {
  const ctx = ensureCtx()
  const out = ctx.createBuffer(buffer.numberOfChannels, Math.max(1, endSample - startSample), buffer.sampleRate)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.copyToChannel(buffer.getChannelData(c).subarray(startSample, endSample), c)
  }
  return out
}

/** Hand-rolled RIFF/WAVE encoder — 16-bit signed PCM, interleaved. */
function encodeWav(buffer: AudioBuffer): Blob {
  const numCh = buffer.numberOfChannels
  const len = buffer.length
  const dataBytes = len * numCh * 2
  const ab = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(ab)

  const writeStr = (off: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numCh, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * numCh * 2, true) // byte rate
  view.setUint16(32, numCh * 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  writeStr(36, 'data')
  view.setUint32(40, dataBytes, true)

  const chans: Float32Array[] = []
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c))
  let off = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = clamp(chans[c][i], -1, 1)
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      off += 2
    }
  }
  return new Blob([ab], { type: 'audio/wav' })
}

/** Concatenate buffers (in order) at the first clip's sample rate. */
async function mergeBuffers(parts: Clip[]): Promise<AudioBuffer> {
  const ctx = ensureCtx()
  const baseRate = parts[0].buffer.sampleRate
  const rendered: AudioBuffer[] = []
  for (const part of parts) {
    rendered.push(await resampleBuffer(part.buffer, baseRate))
  }
  const maxCh = rendered.reduce((n, b) => Math.max(n, b.numberOfChannels), 1)
  const total = rendered.reduce((n, b) => n + b.length, 0)
  const out = ctx.createBuffer(maxCh, Math.max(1, total), baseRate)
  let off = 0
  for (const b of rendered) {
    for (let c = 0; c < maxCh; c++) {
      // clips with fewer channels: duplicate their last channel across the rest
      out.copyToChannel(b.getChannelData(Math.min(c, b.numberOfChannels - 1)), c, off)
    }
    off += b.length
  }
  return out
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

type Busy = 'decode' | 'merge' | 'wav' | null

interface ExportState {
  name: string
  progress: number
}

export default function AudioStudio() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [clips, setClips] = useState<Clip[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selection, setSelection] = useState<Span | null>(null)
  const [mergeIds, setMergeIds] = useState<string[]>([])
  const [busy, setBusy] = useState<Busy>(null)
  const [loop, setLoop] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [playPos, setPlayPos] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [exportSource, setExportSource] = useState<'whole' | 'selection'>('whole')
  const [exportState, setExportState] = useState<ExportState | null>(null)
  const [armedDelete, setArmedDelete] = useState<string | null>(null)
  const [canvasW, setCanvasW] = useState(0)

  const active = useMemo(() => clips.find((c) => c.id === activeId) ?? null, [clips, activeId])
  const dur = active ? active.buffer.duration : 0
  const span: Span | null = selection && selection.end - selection.start >= MIN_SELECTION ? selection : null

  /* ---------------- refs ---------------- */
  const fileRef = useRef<HTMLInputElement | null>(null)
  const waveCardRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const dragModeRef = useRef<'new' | 'start' | 'end' | null>(null)
  const anchorRef = useRef(0)
  const rafRef = useRef(0)
  const posRef = useRef(0)
  const playRef = useRef<{
    src: AudioBufferSourceNode
    startedAt: number
    offset: number
    spanStart: number
    spanEnd: number
    loop: boolean
    clipDur: number
  } | null>(null)
  const webmCancelRef = useRef<(() => void) | null>(null)

  /* ---------------- cleanup on unmount ---------------- */
  useEffect(() => {
    return () => {
      const p = playRef.current
      if (p) {
        p.src.onended = null
        try {
          p.src.stop()
        } catch {
          /* already stopped */
        }
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      sharedCtx?.close().catch(() => undefined)
      sharedCtx = null
    }
  }, [])

  /* stop playback whenever the active clip or selection changes */
  useEffect(() => {
    const p = playRef.current
    if (p) {
      p.src.onended = null
      try {
        p.src.stop()
      } catch {
        /* already stopped */
      }
      playRef.current = null
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    setPlaying(false)
  }, [activeId, selection])

  /* arm-to-confirm deletes expire */
  useEffect(() => {
    if (!armedDelete) return
    const t = window.setTimeout(() => setArmedDelete(null), 2600)
    return () => window.clearTimeout(t)
  }, [armedDelete])

  /* ---------------- waveform sizing ---------------- */
  useEffect(() => {
    /* re-attach when the waveform card mounts (it only exists once a clip is loaded) */
    const el = waveCardRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setCanvasW(Math.max(0, Math.floor(e.contentRect.width)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [clips.length])

  /* min/max peaks per pixel column of the active clip (cached per clip+width) */
  const peaks = useMemo(() => {
    if (!active || canvasW < 2) return null
    const W = canvasW
    const N = active.buffer.length
    const mins = new Float32Array(W)
    const maxs = new Float32Array(W)
    const d0 = active.buffer.getChannelData(0)
    const d1 = active.buffer.numberOfChannels > 1 ? active.buffer.getChannelData(1) : d0
    const strideCap = 384
    for (let x = 0; x < W; x++) {
      const s0 = Math.floor((x * N) / W)
      const s1 = Math.max(s0 + 1, Math.floor(((x + 1) * N) / W))
      const stride = Math.max(1, Math.ceil((s1 - s0) / strideCap))
      let mn = 1
      let mx = -1
      for (let i = s0; i < s1; i += stride) {
        const a = d0[i]
        const b = d1[i]
        const lo = a < b ? a : b
        const hi = a > b ? a : b
        if (lo < mn) mn = lo
        if (hi > mx) mx = hi
      }
      mins[x] = mn
      maxs[x] = mx
    }
    return { mins, maxs }
  }, [active, canvasW])

  /* ---------------- canvas painting ---------------- */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !active || !peaks || canvasW < 2) return
    const H = 128
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.floor(canvasW * dpr)
    canvas.height = Math.floor(H * dpr)
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx2d.clearRect(0, 0, canvasW, H)

    // backdrop + centrelines
    ctx2d.fillStyle = 'rgba(255,255,255,0.03)'
    ctx2d.fillRect(0, 0, canvasW, H)
    ctx2d.fillStyle = 'rgba(255,255,255,0.06)'
    for (let gy = 1; gy < 4; gy++) ctx2d.fillRect(0, (H / 4) * gy - 0.5, canvasW, 1)
    ctx2d.fillStyle = 'rgba(255,255,255,0.12)'
    ctx2d.fillRect(0, H / 2 - 0.5, canvasW, 1)

    // peaks — rose gradient, mirrored around the centre line
    const grad = ctx2d.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0, '#fda4af')
    grad.addColorStop(0.5, '#fb7185')
    grad.addColorStop(1, '#be123c')
    ctx2d.fillStyle = grad
    const mid = H / 2
    for (let x = 0; x < canvasW; x++) {
      const mn = peaks.mins[x]
      const mx = peaks.maxs[x]
      const y0 = clamp(mid - mx * (mid - 4), 2, H - 2)
      const y1 = clamp(mid - mn * (mid - 4), 2, H - 2)
      const h = Math.max(1.5, y1 - y0)
      ctx2d.fillRect(x, y0, 1, h)
    }

    // veil outside the selection so the chosen region pops
    if (selection && selection.end - selection.start >= MIN_SELECTION) {
      const xs = (selection.start / dur) * canvasW
      const xe = (selection.end / dur) * canvasW
      ctx2d.fillStyle = 'rgba(9,9,11,0.55)'
      ctx2d.fillRect(0, 0, Math.max(0, xs), H)
      ctx2d.fillRect(Math.min(canvasW, xe), 0, canvasW - Math.min(canvasW, xe), H)
      ctx2d.fillStyle = 'rgba(244,63,94,0.10)'
      ctx2d.fillRect(xs, 0, Math.max(1, xe - xs), H)

      // edge handles
      for (const hx of [xs, xe]) {
        ctx2d.fillStyle = '#fb7185'
        ctx2d.fillRect(hx - 1.5, 0, 3, H)
        ctx2d.fillStyle = '#fecdd3'
        ctx2d.fillRect(hx - 1.5, mid - 11, 3, 22)
      }
    }

    // playhead
    if (playPos > 0 || playing) {
      const px = clamp((playPos / Math.max(0.001, dur)) * canvasW, 0, canvasW)
      ctx2d.fillStyle = 'rgba(255,255,255,0.92)'
      ctx2d.fillRect(px - 0.75, 0, 1.5, H)
      ctx2d.beginPath()
      ctx2d.arc(px, 4, 3.2, 0, Math.PI * 2)
      ctx2d.fillStyle = '#fb7185'
      ctx2d.fill()
    }
  }, [peaks, selection, playPos, playing, canvasW, dur, active])

  /* ---------------- playback engine ---------------- */
  const currentPos = useCallback((): number => {
    const p = playRef.current
    if (!p) return posRef.current
    let t = p.offset + (ensureCtx().currentTime - p.startedAt)
    if (p.loop && p.spanEnd > p.spanStart && t >= p.spanEnd) {
      const spanLen = p.spanEnd - p.spanStart
      t = p.spanStart + ((t - p.spanStart) % spanLen)
    }
    return clamp(t, 0, p.clipDur)
  }, [])

  const startPlayback = useCallback(
    (from: number, withSpan: Span | null, withLoop: boolean) => {
      if (!active) return
      const ctx = ensureCtx()
      void ctx.resume().catch(() => undefined)
      const clipDur = active.buffer.duration
      const src = ctx.createBufferSource()
      src.buffer = active.buffer
      const spanStart = withSpan ? withSpan.start : 0
      const spanEnd = withSpan ? withSpan.end : clipDur
      if (withLoop && withSpan) {
        src.loop = true
        src.loopStart = spanStart
        src.loopEnd = spanEnd
        src.start(0, from)
      } else {
        src.start(0, from, withSpan ? spanEnd - from : undefined)
      }
      src.onended = () => {
        if (playRef.current?.src !== src) return
        playRef.current = null
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
        const end = withSpan ? spanEnd : clipDur
        posRef.current = end
        setPlayPos(end)
        setPlaying(false)
      }
      playRef.current = { src, startedAt: ctx.currentTime, offset: from, spanStart, spanEnd, loop: withLoop, clipDur }
      setPlaying(true)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      const tick = () => {
        const t = currentPos()
        posRef.current = t
        setPlayPos(t)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [active, currentPos],
  )

  const togglePlay = useCallback(() => {
    if (!active) return
    haptic()
    if (playing) {
      const p = playRef.current
      posRef.current = currentPos()
      if (p) {
        p.src.onended = null
        try {
          p.src.stop()
        } catch {
          /* already stopped */
        }
        playRef.current = null
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      setPlaying(false)
      setPlayPos(posRef.current)
      return
    }
    const clipDur = active.buffer.duration
    const withSpan = span
    let from = posRef.current
    if (withSpan) {
      if (from < withSpan.start || from >= withSpan.end - MIN_SELECTION) from = withSpan.start
    } else if (from >= clipDur - MIN_SELECTION) {
      from = 0
    }
    startPlayback(from, withSpan, loop)
  }, [active, playing, span, loop, currentPos, startPlayback])

  const stopPlayback = useCallback(() => {
    haptic()
    const p = playRef.current
    if (p) {
      p.src.onended = null
      try {
        p.src.stop()
      } catch {
        /* already stopped */
      }
      playRef.current = null
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    const reset = span ? span.start : 0
    posRef.current = reset
    setPlayPos(reset)
    setPlaying(false)
  }, [span])

  const toggleLoop = useCallback(() => {
    haptic()
    const next = !loop
    setLoop(next)
    if (playRef.current) {
      // restart from the current position so the new loop mode applies immediately
      const at = currentPos()
      const p = playRef.current
      p.src.onended = null
      try {
        p.src.stop()
      } catch {
        /* already stopped */
      }
      playRef.current = null
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      startPlayback(at, span, next)
    }
  }, [loop, span, currentPos, startPlayback])

  /* ---------------- selection via pointer events ---------------- */
  const timeAt = useCallback(
    (clientX: number): number => {
      const canvas = canvasRef.current
      if (!canvas || dur <= 0) return 0
      const rect = canvas.getBoundingClientRect()
      return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1) * dur
    },
    [dur],
  )

  const onWavePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!active || dur <= 0) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.setPointerCapture(e.pointerId)
      haptic()
      let mode: 'new' | 'start' | 'end' | null = null
      if (selection && selection.end - selection.start >= MIN_SELECTION) {
        const rect = canvas.getBoundingClientRect()
        const w = Math.max(1, rect.width)
        const xs = (selection.start / dur) * w
        const xe = (selection.end / dur) * w
        const px = e.clientX - rect.left
        if (Math.abs(px - xs) <= 22) mode = 'start'
        else if (Math.abs(px - xe) <= 22) mode = 'end'
      }
      if (!mode) {
        mode = 'new'
        const t = timeAt(e.clientX)
        anchorRef.current = t
        setSelection({ start: t, end: t })
      }
      dragModeRef.current = mode
      setDragging(true)
    },
    [active, dur, selection, timeAt],
  )

  const onWavePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const mode = dragModeRef.current
      if (!mode || dur <= 0) return
      const t = timeAt(e.clientX)
      if (mode === 'new') {
        const a = anchorRef.current
        setSelection({ start: Math.min(a, t), end: Math.max(a, t) })
      } else if (mode === 'start') {
        setSelection((s) => (s ? { start: clamp(t, 0, s.end - MIN_SELECTION / 2), end: s.end } : s))
      } else {
        setSelection((s) => (s ? { start: s.start, end: clamp(t, s.start + MIN_SELECTION / 2, dur) } : s))
      }
    },
    [dur, timeAt],
  )

  const onWavePointerUp = useCallback(() => {
    const mode = dragModeRef.current
    dragModeRef.current = null
    setDragging(false)
    if (mode === 'new' && selection && selection.end - selection.start < MIN_SELECTION) {
      setSelection(null)
    }
  }, [selection])

  const selectAll = useCallback(() => {
    if (!active) return
    haptic()
    setSelection({ start: 0, end: active.buffer.duration })
  }, [active])

  const clearSelection = useCallback(() => {
    haptic()
    setSelection(null)
  }, [])

  /* ---------------- loading files ---------------- */
  const addClip = useCallback((name: string, buffer: AudioBuffer) => {
    const clip: Clip = { id: newId(), name, buffer, createdAt: Date.now() }
    setClips((cs) => [...cs, clip])
    setActiveId((cur) => cur ?? clip.id)
    posRef.current = 0
    setPlayPos(0)
  }, [])

  const onFilesPicked = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      setBusy('decode')
      const ctx = ensureCtx()
      let ok = 0
      let firstId: string | null = null
      const failed: string[] = []
      for (const file of Array.from(files)) {
        try {
          const ab = await file.arrayBuffer()
          const buf = await ctx.decodeAudioData(ab)
          const clip: Clip = {
            id: newId(),
            name: file.name.replace(/\.[^.]+$/, ''),
            buffer: buf,
            createdAt: Date.now(),
          }
          if (!firstId) firstId = clip.id
          ok++
          setClips((cs) => [...cs, clip])
        } catch {
          failed.push(file.name)
        }
      }
      setBusy(null)
      if (firstId) {
        setActiveId((cur) => cur ?? firstId)
        posRef.current = 0
        setPlayPos(0)
      }
      if (ok > 0) {
        haptic()
        toast({
          title: ok === 1 ? 'Audio loaded' : `${ok} clips loaded`,
          description: 'Tap a clip to select it · clips live for this session',
        })
      }
      if (failed.length > 0) {
        toast({
          title: 'Could not decode some files',
          description: failed.slice(0, 3).join(', ') + (failed.length > 3 ? ` +${failed.length - 3} more` : ''),
        })
      }
      if (fileRef.current) fileRef.current.value = ''
    },
    [toast],
  )

  /* ---------------- clip management ---------------- */
  const removeClip = useCallback(
    (id: string) => {
      if (armedDelete !== id) {
        setArmedDelete(id)
        return
      }
      setArmedDelete(null)
      haptic()
      setClips((cs) => {
        const idx = cs.findIndex((c) => c.id === id)
        const next = cs.filter((c) => c.id !== id)
        if (id === activeId) {
          const fallback = next[Math.min(idx, next.length - 1)] ?? null
          setActiveId(fallback ? fallback.id : null)
          if (!fallback) {
            setSelection(null)
            setMergeIds([])
            posRef.current = 0
            setPlayPos(0)
          }
        }
        return next
      })
      setMergeIds((ids) => ids.filter((x) => x !== id))
      toast({ title: 'Clip removed' })
    },
    [activeId, armedDelete, toast],
  )

  const pickClip = useCallback((id: string) => {
    haptic()
    setActiveId(id)
    posRef.current = 0
    setPlayPos(0)
  }, [])

  const toggleMergeClip = useCallback((id: string) => {
    haptic()
    setMergeIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }, [])

  /* ---------------- trim ---------------- */
  const trimToNewClip = useCallback(() => {
    if (!active || !span) return
    const rate = active.buffer.sampleRate
    const s0 = Math.max(0, Math.floor(span.start * rate))
    const s1 = Math.min(active.buffer.length, Math.ceil(span.end * rate))
    if (s1 - s0 < 1) return
    const trimmed = sliceBuffer(active.buffer, s0, s1)
    const clip: Clip = {
      id: newId(),
      name: `${active.name} (trim)`,
      buffer: trimmed,
      createdAt: Date.now(),
    }
    setClips((cs) => [...cs, clip])
    setActiveId(clip.id)
    posRef.current = 0
    setPlayPos(0)
    haptic()
    toast({ title: 'Trimmed to new clip', description: `${fmtTime(trimmed.duration)} · original kept` })
  }, [active, span, toast])

  const replaceWithTrim = useCallback(() => {
    if (!active || !span) return
    const rate = active.buffer.sampleRate
    const s0 = Math.max(0, Math.floor(span.start * rate))
    const s1 = Math.min(active.buffer.length, Math.ceil(span.end * rate))
    if (s1 - s0 < 1) return
    const trimmed = sliceBuffer(active.buffer, s0, s1)
    setClips((cs) =>
      cs.map((c) => (c.id === active.id ? { ...c, name: `${c.name} (trimmed)`, buffer: trimmed } : c)),
    )
    setSelection(null)
    posRef.current = 0
    setPlayPos(0)
    haptic()
    toast({ title: 'Clip replaced with selection', description: `${fmtTime(trimmed.duration)} kept` })
  }, [active, span, toast])

  /* ---------------- merge ---------------- */
  const runMerge = useCallback(async () => {
    if (mergeIds.length < 2) return
    const parts = mergeIds.map((id) => clips.find((c) => c.id === id)).filter((c): c is Clip => Boolean(c))
    if (parts.length < 2) return
    setBusy('merge')
    try {
      const merged = await mergeBuffers(parts)
      const clip: Clip = {
        id: newId(),
        name: `Merged ${parts.map((_, i) => i + 1).join('+')}`,
        buffer: merged,
        createdAt: Date.now(),
      }
      setClips((cs) => [...cs, clip])
      setActiveId(clip.id)
      setMergeIds([])
      posRef.current = 0
      setPlayPos(0)
      haptic()
      toast({
        title: 'Clips merged',
        description: `${parts.length} clips → ${fmtTime(merged.duration)} at ${(merged.sampleRate / 1000).toFixed(1)} kHz`,
      })
    } catch {
      toast({ title: 'Merge failed', description: 'The clips could not be joined — try different files.' })
    } finally {
      setBusy(null)
    }
  }, [clips, mergeIds, toast])

  /* ---------------- exports ---------------- */
  const exportSpan = useCallback((): { buffer: AudioBuffer; sub: Span | null } | null => {
    if (!active) return null
    if (exportSource === 'selection' && span) return { buffer: active.buffer, sub: span }
    return { buffer: active.buffer, sub: null }
  }, [active, exportSource, span])

  const exportWav = useCallback(async () => {
    const src = exportSpan()
    if (!src) return
    setBusy('wav')
    try {
      let target = src.buffer
      if (src.sub) {
        const rate = src.buffer.sampleRate
        target = sliceBuffer(
          src.buffer,
          Math.max(0, Math.floor(src.sub.start * rate)),
          Math.min(src.buffer.length, Math.ceil(src.sub.end * rate)),
        )
      }
      if (target.sampleRate !== TARGET_RATE) {
        target = await resampleBuffer(target, TARGET_RATE)
      }
      const blob = encodeWav(target)
      const suffix = src.sub ? '-selection' : ''
      downloadBlob(blob, `${slug(active?.name ?? 'clip')}${suffix}.wav`)
      haptic()
      toast({
        title: 'WAV exported',
        description: `16-bit PCM · ${(target.sampleRate / 1000).toFixed(1)} kHz · ${fmtTime(target.duration)}`,
      })
    } catch {
      toast({ title: 'Export failed', description: 'The WAV could not be rendered.' })
    } finally {
      setBusy(null)
    }
  }, [active, exportSpan, toast])

  const cancelWebmExport = useCallback(() => {
    webmCancelRef.current?.()
  }, [])

  const exportWebm = useCallback(async () => {
    const src = exportSpan()
    if (!src || !active) return
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('audio/webm')) {
      toast({ title: 'WebM not supported', description: 'This browser cannot record audio/webm — use Export WAV.' })
      return
    }
    stopPlayback()
    const ctx = ensureCtx()
    try {
      await ctx.resume()
    } catch {
      /* resume refused — recording may still work */
    }
    const clipDur = active.buffer.duration
    const from = src.sub ? src.sub.start : 0
    const recordDur = src.sub ? src.sub.end - src.sub.start : clipDur
    const dest = ctx.createMediaStreamDestination()
    const node = ctx.createBufferSource()
    node.buffer = active.buffer
    node.connect(dest)

    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    const rec = new MediaRecorder(dest.stream, { mimeType: mime })
    const chunks: Blob[] = []
    let cancelled = false
    webmCancelRef.current = () => {
      cancelled = true
      try {
        rec.stop()
      } catch {
        /* not recording */
      }
      try {
        node.stop()
      } catch {
        /* not started */
      }
    }
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunks.push(e.data)
    }
    rec.onstop = () => {
      webmCancelRef.current = null
      setExportState(null)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      if (cancelled) {
        toast({ title: 'Export cancelled' })
        return
      }
      const blob = new Blob(chunks, { type: 'audio/webm' })
      const suffix = src.sub ? '-selection' : ''
      downloadBlob(blob, `${slug(active.name)}${suffix}.webm`)
      haptic()
      toast({ title: 'WebM exported', description: `Opus · ${fmtTime(recordDur)} · recorded in real time` })
    }

    const started = performance.now()
    setExportState({ name: active.name, progress: 0 })
    const tick = () => {
      const p = clamp((performance.now() - started) / (recordDur * 1000 + 250), 0, 1)
      setExportState((s) => (s ? { ...s, progress: p } : s))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    node.onended = () => {
      window.setTimeout(() => {
        if (rec.state !== 'inactive') rec.stop()
      }, 180) // small tail so the last opus frame lands
    }
    node.start(0, from, src.sub ? recordDur : undefined)
    rec.start()
  }, [active, exportSpan, stopPlayback, toast])

  /* ---------------- derived UI data ---------------- */
  const mergeClips = useMemo(
    () => mergeIds.map((id, i) => ({ id, idx: i + 1, clip: clips.find((c) => c.id === id) })).filter((m) => m.clip),
    [mergeIds, clips],
  )

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-pink-500/[0.09] via-transparent to-rose-500/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-pink-400 via-rose-500 to-red-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(244_63_94/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <AudioWaveform className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Audio Studio</h2>
              <p className="text-xs text-zinc-400">Trim, merge &amp; convert — fully offline.</p>
            </div>
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={busy === 'decode'}
              className="h-10 shrink-0 rounded-xl bg-gradient-to-r from-pink-400 via-rose-500 to-red-500 font-semibold text-white shadow-lg hover:from-pink-300 hover:via-rose-400 hover:to-red-400 disabled:opacity-60"
            >
              {busy === 'decode' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
              Add audio
            </Button>
          </div>

          <div className="mt-4 flex items-center gap-2 text-[11px] text-zinc-500">
            <Info className="size-3.5 shrink-0 text-rose-400/80" aria-hidden />
            <span>Clips live for this session — nothing is uploaded or saved to the device.</span>
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(e) => void onFilesPicked(e.target.files)}
          />
        </div>

        {clips.length === 0 ? (
          /* ---------------- Empty state ---------------- */
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex size-16 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04]">
              <Music4 className="size-8 text-rose-300" strokeWidth={1.6} aria-hidden />
            </span>
            <p className="text-base font-bold tracking-tight">No clips yet</p>
            <p className="max-w-xs text-sm text-zinc-500">
              Add one or more audio files to trim, merge and convert them right on this device.
            </p>
            <Button
              onClick={() => fileRef.current?.click()}
              className="mt-1 h-11 rounded-xl bg-gradient-to-r from-pink-400 via-rose-500 to-red-500 font-semibold text-white shadow-lg hover:from-pink-300 hover:via-rose-400 hover:to-red-400"
            >
              <FolderOpen className="size-4" aria-hidden /> Pick audio files
            </Button>
          </div>
        ) : (
          <div className="space-y-5 p-4 sm:p-5">
            {/* ---------------- Clips ---------------- */}
            <section>
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Clips · {clips.length}
                </p>
                <p className="text-[10px] text-zinc-600">tap to select · tick to add to merge</p>
              </div>
              <div className="max-h-[17rem] space-y-2 overflow-y-auto pr-0.5">
                {clips.map((clip) => {
                  const isActive = clip.id === activeId
                  const inMerge = mergeIds.includes(clip.id)
                  const armed = armedDelete === clip.id
                  return (
                    <motion.div
                      key={clip.id}
                      layout
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                      className={cn(
                        'flex min-h-14 items-center gap-2.5 rounded-2xl border p-2 transition-colors',
                        isActive
                          ? 'border-rose-400/40 bg-rose-500/[0.09]'
                          : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]',
                      )}
                    >
                      <button
                        onClick={() => toggleMergeClip(clip.id)}
                        aria-label={inMerge ? `Remove ${clip.name} from merge` : `Add ${clip.name} to merge`}
                        aria-pressed={inMerge}
                        className={cn(
                          'flex size-11 shrink-0 items-center justify-center rounded-xl border transition-colors',
                          inMerge
                            ? 'border-rose-400/50 bg-rose-500/20 text-rose-300'
                            : 'border-white/10 bg-white/5 text-zinc-500 hover:text-zinc-300',
                        )}
                      >
                        {inMerge ? <Check className="size-4" aria-hidden /> : <ListPlus className="size-4" aria-hidden />}
                      </button>
                      <button onClick={() => pickClip(clip.id)} className="min-w-0 flex-1 text-left">
                        <p className={cn('truncate text-sm font-semibold', isActive ? 'text-rose-100' : 'text-zinc-200')}>
                          {clip.name}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] tabular-nums text-zinc-500">
                          {fmtTime(clip.buffer.duration)} · {(clip.buffer.sampleRate / 1000).toFixed(1)} kHz ·{' '}
                          {chanLabel(clip.buffer.numberOfChannels)}
                        </p>
                      </button>
                      <button
                        onClick={() => removeClip(clip.id)}
                        aria-label={armed ? `Confirm remove ${clip.name}` : `Remove ${clip.name}`}
                        className={cn(
                          'flex size-11 shrink-0 items-center justify-center rounded-xl border text-[11px] font-bold transition-colors',
                          armed
                            ? 'border-rose-400/60 bg-rose-500/25 text-rose-200'
                            : 'border-white/10 bg-white/5 text-zinc-500 hover:text-zinc-300',
                        )}
                      >
                        {armed ? (
                          'Sure?'
                        ) : (
                          <Trash2 className="size-4" aria-hidden />
                        )}
                      </button>
                    </motion.div>
                  )
                })}
              </div>
            </section>

            {/* ---------------- Waveform ---------------- */}
            <section
              ref={waveCardRef}
              className="rounded-2xl border border-white/10 bg-gradient-to-br from-pink-500/[0.06] to-rose-500/[0.04] p-3"
            >
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  {active ? active.name : 'Waveform'}
                </p>
                <p className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                  {fmtTime(playPos, true)} / {fmtTime(dur)}
                </p>
              </div>

              <canvas
                ref={canvasRef}
                onPointerDown={onWavePointerDown}
                onPointerMove={onWavePointerMove}
                onPointerUp={onWavePointerUp}
                onPointerCancel={onWavePointerUp}
                style={{ height: 128, touchAction: 'none' }}
                className={cn(
                  'block w-full cursor-crosshair rounded-xl border border-white/10 bg-zinc-900/60',
                  dragging && 'cursor-ew-resize',
                )}
              />

              {/* selection labels + quick actions */}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {span ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold tabular-nums text-rose-200">
                    <Scissors className="size-3" aria-hidden />
                    {fmtTime(span.start, true)} → {fmtTime(span.end, true)} · {fmtTime(span.end - span.start, true)}
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-zinc-500">
                    Drag on the waveform to select a region
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  <button
                    onClick={selectAll}
                    disabled={!active}
                    className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    Select all
                  </button>
                  <button
                    onClick={clearSelection}
                    disabled={!selection}
                    className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* transport */}
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={togglePlay}
                  disabled={!active}
                  aria-label={playing ? 'Pause' : 'Play'}
                  className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-400 via-rose-500 to-red-600 text-white shadow-[0_10px_24px_-8px_rgb(244_63_94/0.8)] transition-transform active:scale-95 disabled:opacity-50"
                >
                  {playing ? <Pause className="size-5" aria-hidden /> : <Play className="size-5" aria-hidden />}
                </button>
                <button
                  onClick={stopPlayback}
                  disabled={!active}
                  aria-label="Stop"
                  className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  <Square className="size-4" aria-hidden />
                </button>
                <button
                  onClick={toggleLoop}
                  disabled={!active}
                  aria-pressed={loop}
                  aria-label="Loop selection"
                  className={cn(
                    'flex h-11 items-center gap-1.5 rounded-2xl border px-3 text-xs font-semibold transition-colors disabled:opacity-50',
                    loop
                      ? 'border-rose-400/50 bg-rose-500/15 text-rose-200'
                      : 'border-white/10 bg-white/5 text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <Repeat className="size-4" aria-hidden /> Loop
                </button>
                <p className="ml-auto hidden min-[420px]:block text-[11px] tabular-nums text-zinc-500">
                  {span ? `Playing ${fmtTime(span.end - span.start, true)} region` : 'Playing whole clip'}
                </p>
              </div>
            </section>

            {/* ---------------- Trim + Merge ---------------- */}
            <section className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                <div className="mb-2.5 flex items-center gap-2">
                  <Scissors className="size-4 text-rose-400" aria-hidden />
                  <p className="text-sm font-bold tracking-tight">Trim</p>
                </div>
                <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
                  {span ? `Selected ${fmtTime(span.end - span.start, true)} of ${fmtTime(dur)}.` : 'Select a region on the waveform first.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={trimToNewClip}
                    disabled={!span}
                    className="h-10 rounded-xl bg-gradient-to-r from-pink-400 via-rose-500 to-red-500 px-3.5 text-xs font-semibold text-white shadow-lg transition-all hover:from-pink-300 hover:via-rose-400 hover:to-red-400 active:scale-[0.98] disabled:opacity-40"
                  >
                    Trim to new clip
                  </button>
                  <button
                    onClick={replaceWithTrim}
                    disabled={!span}
                    className="h-10 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 text-xs font-semibold text-rose-200 transition-colors hover:bg-rose-500/20 disabled:opacity-40"
                  >
                    Replace with trim
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
                <div className="mb-2.5 flex items-center gap-2">
                  <Merge className="size-4 text-rose-400" aria-hidden />
                  <p className="text-sm font-bold tracking-tight">Merge</p>
                </div>
                {mergeClips.length === 0 ? (
                  <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
                    Tick two or more clips above, in order, then join them here.
                  </p>
                ) : (
                  <div className="mb-3 max-h-20 space-y-1 overflow-y-auto">
                    {mergeClips.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2 py-1 text-[11px] text-zinc-300"
                      >
                        <span className="flex size-4.5 shrink-0 items-center justify-center rounded bg-rose-500/25 text-[9px] font-bold text-rose-200">
                          {m.idx}
                        </span>
                        <span className="truncate">{m.clip!.name}</span>
                        <button
                          onClick={() => toggleMergeClip(m.id)}
                          aria-label={`Remove ${m.clip!.name} from merge`}
                          className="ml-auto shrink-0 text-zinc-500 transition-colors hover:text-rose-300"
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => void runMerge()}
                  disabled={mergeIds.length < 2 || busy === 'merge'}
                  className="flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-pink-400 via-rose-500 to-red-500 px-3.5 text-xs font-semibold text-white shadow-lg transition-all hover:from-pink-300 hover:via-rose-400 hover:to-red-400 active:scale-[0.98] disabled:opacity-40"
                >
                  {busy === 'merge' ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Merge className="size-3.5" aria-hidden />
                  )}
                  Merge {mergeIds.length >= 2 ? `${mergeIds.length} clips` : ''}
                </button>
              </div>
            </section>

            {/* ---------------- Export ---------------- */}
            <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Download className="size-4 text-rose-400" aria-hidden />
                  <p className="text-sm font-bold tracking-tight">Export</p>
                </div>
                <div className="flex rounded-xl border border-white/10 bg-white/[0.04] p-1">
                  <button
                    onClick={() => setExportSource('whole')}
                    className={cn(
                      'h-8 rounded-lg px-3 text-xs font-semibold transition-colors',
                      exportSource === 'whole' ? 'bg-rose-500/25 text-rose-100' : 'text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    Whole clip
                  </button>
                  <button
                    onClick={() => setExportSource('selection')}
                    disabled={!span}
                    className={cn(
                      'h-8 rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-40',
                      exportSource === 'selection'
                        ? 'bg-rose-500/25 text-rose-100'
                        : 'text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    Selection
                  </button>
                </div>
              </div>
              <p className="mb-3 text-[11px] leading-relaxed text-zinc-500">
                {exportSource === 'selection' && span
                  ? `Exporting the ${fmtTime(span.end - span.start, true)} selection of “${active?.name ?? ''}”.`
                  : `Exporting the whole clip “${active?.name ?? ''}” (${fmtTime(dur)}).`}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void exportWav()}
                  disabled={!active || busy !== null || exportState !== null}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-400 via-rose-500 to-red-500 px-4 text-sm font-semibold text-white shadow-lg transition-all hover:from-pink-300 hover:via-rose-400 hover:to-red-400 active:scale-[0.98] disabled:opacity-40"
                >
                  {busy === 'wav' ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <FileAudio className="size-4" aria-hidden />
                  )}
                  Export WAV
                </button>
                <button
                  onClick={() => void exportWebm()}
                  disabled={!active || busy !== null || exportState !== null}
                  className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 text-sm font-semibold text-rose-200 transition-colors hover:bg-rose-500/20 disabled:opacity-40"
                >
                  <AudioWaveform className="size-4" aria-hidden />
                  Export WebM
                </button>
              </div>
              <p className="mt-2.5 text-[10px] leading-relaxed text-zinc-600">
                WAV renders instantly offline at 44.1 kHz 16-bit · WebM (Opus) is captured in real time, so it takes as
                long as the clip.
              </p>
            </section>
          </div>
        )}
      </motion.div>

      {/* ---------------- WebM export progress modal ---------------- */}
      <AnimatePresence>
        {exportState && (
          <motion.div
            key="export-veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.92, y: 14, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.95, y: 8, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="w-full max-w-xs rounded-3xl border border-white/10 bg-zinc-950 p-6 text-center shadow-[0_30px_80px_-20px_rgb(0_0_0/0.8)]"
            >
              <span className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-pink-400 via-rose-500 to-red-600 text-white shadow-lg">
                <Loader2 className="size-5 animate-spin" aria-hidden />
              </span>
              <p className="text-sm font-bold tracking-tight">Recording WebM…</p>
              <p className="mt-1 truncate text-[11px] text-zinc-500">
                {exportState.name} · real-time capture
              </p>
              <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-pink-400 via-rose-500 to-red-500 transition-[width] duration-150"
                  style={{ width: `${Math.round(exportState.progress * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-lg font-black tabular-nums text-rose-300">
                {Math.round(exportState.progress * 100)}%
              </p>
              <button
                onClick={cancelWebmExport}
                className="mt-4 h-10 w-full rounded-xl border border-white/10 bg-white/5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                Cancel export
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
