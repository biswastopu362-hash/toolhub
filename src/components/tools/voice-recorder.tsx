'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Circle,
  Download,
  Info,
  Mic,
  MicOff,
  Pause,
  Play,
  Square,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Types & helpers                                                     */
/* ================================================================== */

interface Recording {
  id: string
  url: string
  blob: Blob
  /** duration in seconds */
  duration: number
  size: number
  createdAt: number
  ext: string
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = Math.floor(totalSeconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString('en-US')} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toLocaleString('en-US', { maximumFractionDigits: 1 })} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('en-US', { maximumFractionDigits: 2 })} MB`
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function VoiceRecorderTool() {
  const { toast } = useToast()

  const supported =
    typeof window !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'

  const [denied, setDenied] = useState(false)
  const [starting, setStarting] = useState(false)
  const [recording, setRecording] = useState(false)
  const [paused, setPaused] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [recordings, setRecordings] = useState<Recording[]>([])

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const secondsRef = useRef(0)

  const stopTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const startTimer = () => {
    stopTimer()
    timerRef.current = window.setInterval(() => {
      secondsRef.current += 1
      setSeconds(secondsRef.current)
    }, 1000)
  }

  /* Full teardown of mic + timer on unmount (cleanup only, no setState) */
  useEffect(() => {
    return () => {
      stopTimer()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop()
        } catch {
          /* ignore */
        }
      }
    }
  }, [])

  /* ---------------- Recorder controls ---------------- */

  const start = async () => {
    if (!supported || starting) return
    setStarting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mimeType = pickMimeType()
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = rec
      chunksRef.current = []
      secondsRef.current = 0

      rec.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }

      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size > 0) {
          const entry: Recording = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            url: URL.createObjectURL(blob),
            blob,
            duration: secondsRef.current,
            size: blob.size,
            createdAt: Date.now(),
            ext: extensionFor(rec.mimeType || 'audio/webm'),
          }
          setRecordings((prev) => [entry, ...prev])
          toast({ title: 'Recording saved ✓', description: `${formatDuration(entry.duration)} · ${formatBytes(entry.size)}` })
        } else {
          toast({
            title: 'Nothing recorded',
            description: 'The recording was empty. Check that your microphone is not muted.',
            variant: 'destructive',
          })
        }
        /* release the microphone */
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        recorderRef.current = null
      }

      rec.onerror = () => {
        stopTimer()
        setRecording(false)
        setPaused(false)
        toast({ title: 'Recording error', description: 'Something went wrong with the recorder.', variant: 'destructive' })
      }

      rec.start(250)
      setSeconds(0)
      setRecording(true)
      setPaused(false)
      startTimer()
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      setDenied(true)
      if (name !== 'NotAllowedError') {
        toast({
          title: 'Could not start recording',
          description: 'No microphone was found or it is busy in another app.',
          variant: 'destructive',
        })
      }
    } finally {
      setStarting(false)
    }
  }

  const pause = () => {
    const rec = recorderRef.current
    if (!rec || rec.state !== 'recording') return
    rec.pause()
    stopTimer()
    setPaused(true)
  }

  const resume = () => {
    const rec = recorderRef.current
    if (!rec || rec.state !== 'paused') return
    rec.resume()
    startTimer()
    setPaused(false)
  }

  const stop = () => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return
    stopTimer()
    setRecording(false)
    setPaused(false)
    rec.stop()
  }

  const removeRecording = (id: string) => {
    setRecordings((prev) => {
      const target = prev.find((r) => r.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((r) => r.id !== id)
    })
  }

  const downloadRecording = (rec: Recording) => {
    const a = document.createElement('a')
    a.href = rec.url
    a.download = `recording-${rec.createdAt}.${rec.ext}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast({ title: 'Download started ✓', description: `recording-${rec.createdAt}.${rec.ext}` })
  }

  const clearAll = () => {
    recordings.forEach((r) => URL.revokeObjectURL(r.url))
    setRecordings([])
    toast({ title: 'All recordings removed' })
  }

  /* ---------------- Render ---------------- */

  if (!supported) {
    return (
      <Alert variant="destructive">
        <MicOff />
        <AlertTitle>Voice recording is not supported</AlertTitle>
        <AlertDescription>
          Your browser does not support the MediaRecorder API. Try the latest Chrome, Edge, Firefox or Safari.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <div className="space-y-4">
      {denied && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Microphone access denied</AlertTitle>
          <AlertDescription>
            To record audio, allow microphone access for this site in your browser settings (padlock icon in the
            address bar → Site settings → Microphone → Allow), then try again.
          </AlertDescription>
        </Alert>
      )}

      {/* Recorder controls */}
      <Card className="items-center gap-4 p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            {recording && !paused && (
              <span className="absolute inset-0 animate-ping rounded-full bg-red-500/30" aria-hidden="true" />
            )}
            <Button
              size="icon"
              onClick={recording ? stop : start}
              disabled={starting}
              aria-label={recording ? 'Stop recording' : 'Start recording'}
              className={cn(
                'relative size-20 rounded-full text-white',
                recording ? 'bg-red-600 hover:bg-red-600/90' : 'bg-primary hover:bg-primary/90'
              )}
            >
              {starting ? (
                <Circle className="size-8 animate-pulse fill-current" />
              ) : recording ? (
                <Square className="size-7 fill-current" />
              ) : (
                <Mic className="size-8" />
              )}
            </Button>
          </div>

          {recording ? (
            <div className="flex items-center gap-2" role="status" aria-live="polite">
              <span className="size-3 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
              <span className="font-mono text-2xl font-semibold tabular-nums">{formatDuration(seconds)}</span>
              {paused && <Badge variant="outline">Paused</Badge>}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {starting ? 'Waiting for microphone…' : 'Tap the microphone to start recording'}
            </p>
          )}
        </div>

        {recording && (
          <div className="flex w-full items-center justify-center gap-3">
            <Button
              variant="outline"
              className="h-11 gap-2"
              onClick={paused ? resume : pause}
              aria-label={paused ? 'Resume recording' : 'Pause recording'}
            >
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {paused ? 'Resume' : 'Pause'}
            </Button>
            <Button
              variant="destructive"
              className="h-11 gap-2"
              onClick={stop}
              aria-label="Stop recording"
            >
              <Square className="size-4 fill-current" />
              Stop
            </Button>
          </div>
        )}
      </Card>

      {/* Session note */}
      <Alert>
        <Info />
        <AlertTitle>Recordings are temporary</AlertTitle>
        <AlertDescription>
          Recordings live only in this session — download to keep them. Nothing is uploaded to a server.
        </AlertDescription>
      </Alert>

      {/* Recordings list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">
            Recordings{' '}
            <Badge variant="secondary" className="ml-1">
              {recordings.length.toLocaleString('en-US')}
            </Badge>
          </h3>
          {recordings.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 text-destructive hover:text-destructive"
              onClick={clearAll}
              aria-label="Remove all recordings"
            >
              <Trash2 className="size-4" /> Clear all
            </Button>
          )}
        </div>

        {recordings.length === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No recordings yet — your recordings will appear here.
          </p>
        ) : (
          <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
            {recordings.map((rec) => (
              <RecordingRow key={rec.id} rec={rec} onDownload={downloadRecording} onDelete={removeRecording} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Single recording row — revokes its object URL when unmounted        */
/* ================================================================== */

function RecordingRow({
  rec,
  onDownload,
  onDelete,
}: {
  rec: Recording
  onDownload: (rec: Recording) => void
  onDelete: (id: string) => void
}) {
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(rec.url)
    }
  }, [rec.url])

  const timeLabel = new Date(rec.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })

  return (
    <Card className="gap-2 p-3">
      <audio controls src={rec.url} className="h-10 w-full" preload="metadata" aria-label={`Recording from ${timeLabel}`} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{formatDuration(rec.duration)}</Badge>
        <Badge variant="outline">{formatBytes(rec.size)}</Badge>
        <span className="text-muted-foreground">{timeLabel}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-11 gap-1.5"
            onClick={() => onDownload(rec)}
            aria-label={`Download recording from ${timeLabel}`}
          >
            <Download className="size-4" /> Download
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 text-destructive hover:text-destructive"
            onClick={() => onDelete(rec.id)}
            aria-label="Delete recording"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
    </Card>
  )
}
