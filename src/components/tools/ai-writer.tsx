'use client'

/**
 * AI Writer — a pocket copywriter.
 *
 * Pick one of eight templates, set a tone and a target length, and watch the
 * draft stream in live from the shared POST /api/ai/stream NDJSON endpoint
 * ({ t:'delta', v } | { t:'done' } | { t:'error', v }). Copy / share /
 * regenerate / save the result, and browse everything you've saved from an
 * on-device history (IndexedDB 'toolhub-aiwriter' → store 'docs').
 *
 * Nothing leaves the device except the writing request itself.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  BookmarkPlus,
  Check,
  Copy,
  Feather,
  History,
  Loader2,
  PenLine,
  RotateCcw,
  Search,
  SearchX,
  Share2,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type TemplateId = 'email' | 'social' | 'caption' | 'summary' | 'blog' | 'product' | 'reply' | 'ideas'

interface FieldDef {
  key: string
  label: string
  placeholder: string
  optional?: boolean
  rows?: number
}

interface TemplateDef {
  id: TemplateId
  /** short label for the chip grid */
  label: string
  /** full name for headers / history */
  title: string
  emoji: string
  fields: FieldDef[]
  build: (fields: Record<string, string>) => string
}

interface ToneDef {
  id: string
  label: string
}

interface LengthDef {
  id: string
  label: string
  words: number
}

/** One saved generation in IndexedDB. */
interface Doc {
  id: string
  templateId: TemplateId
  tone: string
  length: string
  topic: string
  content: string
  createdAt: number
  /** full field values, so the draft can be regenerated faithfully */
  fields?: Record<string, string>
}

type StreamEvent = { t: 'delta'; v?: unknown } | { t: 'done' } | { t: 'error'; v?: unknown }

type Status = 'idle' | 'streaming' | 'done' | 'error'

const TONES: readonly ToneDef[] = [
  { id: 'professional', label: 'Professional' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'funny', label: 'Funny' },
  { id: 'persuasive', label: 'Persuasive' },
  { id: 'formal', label: 'Formal' },
  { id: 'casual', label: 'Casual' },
] as const

const LENGTHS: readonly LengthDef[] = [
  { id: 'short', label: 'Short', words: 50 },
  { id: 'medium', label: 'Medium', words: 120 },
  { id: 'long', label: 'Long', words: 250 },
] as const

const DEFAULT_TONE = 'professional'
const DEFAULT_LENGTH = 'medium'

/** Optional secondary details appended to any prompt. */
function withNotes(notes: string): string {
  return notes ? `\n\nAdditional details to incorporate:\n${notes}` : ''
}

const TEMPLATES: TemplateDef[] = [
  {
    id: 'email',
    label: 'Email',
    title: 'Email',
    emoji: '✉️',
    fields: [
      {
        key: 'topic',
        label: "What's it about",
        placeholder: 'e.g. Following up on our meeting about the Q3 launch',
        rows: 3,
      },
      {
        key: 'recipient',
        label: 'Recipient (optional)',
        placeholder: 'e.g. the design team, a client, my manager',
        optional: true,
      },
      {
        key: 'notes',
        label: 'Key points (optional)',
        placeholder: 'e.g. deadline moved to Friday; need feedback on the mockups',
        optional: true,
        rows: 2,
      },
    ],
    build: (f) => {
      const recipient = (f.recipient ?? '').trim()
      return (
        `Write an email${recipient ? ` to ${recipient}` : ''} about the following:\n\n` +
        `${(f.topic ?? '').trim()}\n\n` +
        `Format: the very first line is the subject formatted as "Subject: …", then the body ` +
        `with a greeting and a generic sign-off (no name).` +
        withNotes((f.notes ?? '').trim())
      )
    },
  },
  {
    id: 'social',
    label: 'Social',
    title: 'Social Post',
    emoji: '📣',
    fields: [
      {
        key: 'topic',
        label: 'Post topic',
        placeholder: 'e.g. we just crossed 10,000 customers — announce it',
        rows: 3,
      },
      {
        key: 'notes',
        label: 'Details / call to action (optional)',
        placeholder: 'e.g. link in bio, thank the community, launch discount code WELCOME10',
        optional: true,
        rows: 2,
      },
    ],
    build: (f) =>
      `Write a social media post about the following:\n\n${(f.topic ?? '').trim()}\n\n` +
      `Make it scroll-stopping, skimmable and authentic. End with 1–3 relevant hashtags on their own line.` +
      withNotes((f.notes ?? '').trim()),
  },
  {
    id: 'caption',
    label: 'Caption',
    title: 'Caption',
    emoji: '🏷️',
    fields: [
      {
        key: 'topic',
        label: "What's the caption for",
        placeholder: 'e.g. a photo of a foggy sunrise hike in the Himalayas',
        rows: 3,
      },
      {
        key: 'notes',
        label: 'Keywords or vibe (optional)',
        placeholder: 'e.g. dreamy, minimal, no clichés',
        optional: true,
        rows: 2,
      },
    ],
    build: (f) =>
      `Write a short, catchy caption for a post about the following:\n\n${(f.topic ?? '').trim()}\n\n` +
      `Punchy and memorable; use hashtags only if they genuinely add something.` +
      withNotes((f.notes ?? '').trim()),
  },
  {
    id: 'summary',
    label: 'Summary',
    title: 'Summary',
    emoji: '📝',
    fields: [
      {
        key: 'topic',
        label: 'Content to summarize',
        placeholder: 'Paste or describe the article, notes or meeting you want summarized…',
        rows: 5,
      },
      {
        key: 'notes',
        label: 'Focus (optional)',
        placeholder: 'e.g. focus on the financial risks and next steps',
        optional: true,
        rows: 2,
      },
    ],
    build: (f) =>
      `Summarize the following into clear, scannable key points:\n\n${(f.topic ?? '').trim()}` +
      withNotes((f.notes ?? '').trim()),
  },
  {
    id: 'blog',
    label: 'Blog',
    title: 'Blog Intro',
    emoji: '🖋️',
    fields: [
      {
        key: 'topic',
        label: 'Blog post topic',
        placeholder: 'e.g. why remote teams need async rituals, not more meetings',
        rows: 3,
      },
      {
        key: 'notes',
        label: 'Audience / angle (optional)',
        placeholder: 'e.g. for startup founders; contrarian angle',
        optional: true,
        rows: 2,
      },
    ],
    build: (f) =>
      `Write an engaging introduction for a blog post about the following:\n\n${(f.topic ?? '').trim()}\n\n` +
      `Hook the reader immediately, set up what the article covers, and end with a natural bridge into the body.` +
      withNotes((f.notes ?? '').trim()),
  },
  {
    id: 'product',
    label: 'Product',
    title: 'Product Description',
    emoji: '🛍️',
    fields: [
      {
        key: 'topic',
        label: 'Product',
        placeholder: 'e.g. a ceramic pour-over coffee dripper, handmade, 300 ml',
        rows: 3,
      },
      {
        key: 'notes',
        label: 'Key features (optional)',
        placeholder: 'e.g. dishwasher safe, flat-bottom, comes with 40 filters',
        optional: true,
        rows: 2,
      },
    ],
    build: (f) =>
      `Write a persuasive product description for the following:\n\n${(f.topic ?? '').trim()}\n\n` +
      `Sell the benefits, not just the features — keep it vivid and concrete.` +
      withNotes((f.notes ?? '').trim()),
  },
  {
    id: 'reply',
    label: 'Reply',
    title: 'Reply',
    emoji: '↩️',
    fields: [
      {
        key: 'topic',
        label: 'Message you are replying to',
        placeholder: 'Paste the email, DM or message you need to answer…',
        rows: 5,
      },
      {
        key: 'notes',
        label: 'What the reply should achieve (optional)',
        placeholder: 'e.g. politely decline, offer a call next week',
        optional: true,
        rows: 2,
      },
    ],
    build: (f) =>
      `Write a reply to the following message:\n\n${(f.topic ?? '').trim()}\n\n` +
      `Output only the reply text, ready to send — no subject line, no preamble.` +
      withNotes((f.notes ?? '').trim()),
  },
  {
    id: 'ideas',
    label: 'Ideas',
    title: 'Ideas',
    emoji: '💡',
    fields: [
      {
        key: 'topic',
        label: 'What do you need ideas for',
        placeholder: 'e.g. names for a slow-living newsletter about tea',
        rows: 3,
      },
      {
        key: 'notes',
        label: 'Constraints (optional)',
        placeholder: 'e.g. max two words, must work as an @handle',
        optional: true,
        rows: 2,
      },
    ],
    build: (f) =>
      `Generate creative, distinct ideas for the following:\n\n${(f.topic ?? '').trim()}\n\n` +
      `Present them as a numbered list — each idea is a bold one-line name followed by a short explanation.` +
      withNotes((f.notes ?? '').trim()),
  },
]

function templateOf(id: string): TemplateDef {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]
}

function toneLabelOf(id: string): string {
  return TONES.find((t) => t.id === id)?.label ?? id
}

function toneLabelOfCap(id: string): string {
  const label = toneLabelOf(id)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function lengthLabelOf(id: string): string {
  return LENGTHS.find((l) => l.id === id)?.label ?? id
}

function isTone(v: string): v is string {
  return TONES.some((t) => t.id === v)
}

function isLength(v: string): v is string {
  return LENGTHS.some((l) => l.id === v)
}

function systemPrompt(toneId: string, lengthId: string): string {
  const tone = TONES.find((t) => t.id === toneId) ?? TONES[0]
  const len = LENGTHS.find((l) => l.id === lengthId) ?? LENGTHS[1]
  return (
    'You are a professional copywriter. Respond with ONLY the requested writing, no preamble. ' +
    `Tone: ${tone.label.toLowerCase()}. Target length: about ${len.words} words. ` +
    'Never explain or annotate what you wrote.'
  )
}

function buildUserPrompt(tpl: TemplateDef, fields: Record<string, string>): string {
  return tpl.build(fields)
}

/* ---------------- small helpers ---------------- */

function newId(): string {
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function buzz(pattern = 12) {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function relDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `Today · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
  return d.toLocaleDateString('en-US', opts)
}

/* ================================================================== */
/* IndexedDB — saved drafts, fully on-device                           */
/* ================================================================== */

const DB_NAME = 'toolhub-aiwriter'
const DB_VERSION = 1
const DOC_STORE = 'docs'
const MAX_DOCS = 300

let dbPromise: Promise<IDBDatabase> | null = null

function openWriterDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(DOC_STORE)) d.createObjectStore(DOC_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openWriterDb()
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

/* ================================================================== */
/* Small presentational bits                                           */
/* ================================================================== */

const SPRING = { type: 'spring', stiffness: 320, damping: 28 } as const

const SCROLLBAR_CLS =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-fuchsia-500/30 [scrollbar-width:thin]'

function ResultAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-all hover:bg-white/[0.08] hover:text-white active:scale-[0.97]"
    >
      <Icon className="size-4" aria-hidden />
      <span className="max-w-full truncate px-1 text-[10px] font-medium leading-none">{label}</span>
    </button>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

const TABS = [
  { id: 'write', label: 'Write', icon: PenLine },
  { id: 'history', label: 'History', icon: History },
] as const

type Tab = (typeof TABS)[number]['id']

export default function AiWriterApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [tab, setTab] = useState<Tab>('write')
  const [templateId, setTemplateId] = useState<TemplateId>('email')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [tone, setTone] = useState<string>(DEFAULT_TONE)
  const [length, setLength] = useState<string>(DEFAULT_LENGTH)

  const [status, setStatus] = useState<Status>('idle')
  const [output, setOutput] = useState('')
  const [streamError, setStreamError] = useState<string | null>(null)
  const [resultMeta, setResultMeta] = useState<{ templateId: TemplateId; tone: string; length: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const [history, setHistory] = useState<Doc[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  /* ---------------- refs ---------------- */
  const abortRef = useRef<AbortController | null>(null)
  const lastPromptRef = useRef<{ system: string; user: string } | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const tpl = templateOf(templateId)

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const all = await idbGetAll<Doc>(DOC_STORE)
        if (!alive) return
        all.sort((a, b) => b.createdAt - a.createdAt)
        setHistory(all)
        // best-effort cap — trim anything beyond MAX_DOCS in storage too
        if (all.length > MAX_DOCS) {
          for (const d of all.slice(MAX_DOCS)) void idbDelete(DOC_STORE, d.id).catch(() => {})
        }
      } catch {
        /* private mode / quota — history is memory-only */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- cleanup on unmount ---------------- */
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    }
  }, [])

  /* ---------------- streaming generation ---------------- */

  const runStream = useCallback(
    async (system: string, user: string) => {
      const controller = new AbortController()
      abortRef.current = controller
      setStatus('streaming')
      setOutput('')
      setStreamError(null)

      let acc = ''
      try {
        const res = await fetch('/api/ai/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: unknown } | null
          const msg =
            typeof data?.error === 'string' && data.error
              ? data.error
              : `Generation failed (${res.status}).`
          throw new Error(msg)
        }
        if (!res.body) throw new Error('Streaming is not supported in this browser.')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''

        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })

          // NDJSON line-buffer parse
          let nl = buf.indexOf('\n')
          while (nl >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (line) {
              let evt: StreamEvent | null = null
              try {
                evt = JSON.parse(line) as StreamEvent
              } catch {
                /* malformed line — skip */
              }
              if (evt?.t === 'delta' && typeof evt.v === 'string' && evt.v) {
                acc += evt.v
                setOutput(acc)
              } else if (evt?.t === 'error') {
                throw new Error(
                  typeof evt.v === 'string' && evt.v ? evt.v : 'AI request failed mid-stream.',
                )
              }
            }
            nl = buf.indexOf('\n')
          }
        }
        buf += decoder.decode()

        if (controller.signal.aborted) {
          setStatus(acc.trim() ? 'done' : 'idle')
          if (!acc.trim()) setOutput('')
          return
        }
        if (!acc.trim()) throw new Error('The AI returned an empty response. Tap Retry.')

        setStatus('done')
        buzz()
      } catch (err) {
        if (controller.signal.aborted) {
          // stopped by the user — keep whatever streamed in
          setStatus(acc.trim() ? 'done' : 'idle')
          if (!acc.trim()) setOutput('')
          toast({ title: acc.trim() ? 'Stopped — partial text kept' : 'Generation stopped' })
          return
        }
        setStatus('error')
        setStreamError(err instanceof Error ? err.message : 'Something went wrong. Tap Retry.')
      }
    },
    [toast],
  )

  const generate = useCallback(() => {
    if (status === 'streaming') return
    const t = templateOf(templateId)
    if (t.fields.some((f) => !f.optional && !(fields[f.key] ?? '').trim())) return
    const system = systemPrompt(tone, length)
    const user = buildUserPrompt(t, fields)
    lastPromptRef.current = { system, user }
    setResultMeta({ templateId: t.id, tone, length })
    buzz()
    window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 160)
    void runStream(system, user)
  }, [status, templateId, fields, tone, length, runStream])

  /** Re-run the exact last prompt (same system + user messages). */
  const regenerate = useCallback(() => {
    const last = lastPromptRef.current
    if (last) {
      buzz()
      void runStream(last.system, last.user)
    } else {
      generate()
    }
  }, [runStream, generate])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /* ---------------- field editing ---------------- */

  const setField = useCallback((key: string, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value }))
  }, [])

  const missingRequired = useMemo(
    () => tpl.fields.some((f) => !f.optional && !(fields[f.key] ?? '').trim()),
    [tpl, fields],
  )

  /* ---------------- result actions ---------------- */

  const copyResult = useCallback(async () => {
    const text = output.trim()
    if (!text) return
    const ok = await copyText(text)
    if (ok) {
      setCopied(true)
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1600)
      buzz()
      toast({ title: 'Copied to clipboard' })
    } else {
      toast({ title: 'Copy failed', description: 'Clipboard is unavailable in this browser.' })
    }
  }, [output, toast])

  const shareResult = useCallback(async () => {
    const text = output.trim()
    if (!text) return
    const t = templateOf(resultMeta?.templateId ?? templateId)
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `AI Writer — ${t.title}`, text })
        return
      }
      throw new Error('unsupported')
    } catch (err) {
      // user closed the native share sheet — not an error
      if (err instanceof DOMException && err.name === 'AbortError') return
      const ok = await copyText(text)
      toast({
        title: ok ? 'Copied instead' : 'Sharing unavailable',
        description: ok
          ? 'Web Share is not supported here — the result was copied to your clipboard.'
          : 'Could not open the share sheet or access the clipboard.',
      })
    }
  }, [output, templateId, resultMeta, toast])

  const saveToHistory = useCallback(() => {
    const content = output.trim()
    if (!content || status === 'streaming') return
    const meta = resultMeta ?? { templateId, tone, length }
    const doc: Doc = {
      id: newId(),
      templateId: meta.templateId,
      tone: meta.tone,
      length: meta.length,
      topic: (fields.topic ?? '').trim() || templateOf(meta.templateId).title,
      content,
      createdAt: Date.now(),
      fields: { ...fields },
    }
    setHistory((prev) => [doc, ...prev].slice(0, MAX_DOCS))
    void idbPut(DOC_STORE, doc).catch(() => {
      /* memory-only fallback */
    })
    buzz()
    toast({ title: 'Saved to history', description: `${tpl.emoji} ${tpl.title}` })
  }, [output, status, templateId, tone, length, resultMeta, fields, tpl, toast])

  /* ---------------- history actions ---------------- */

  const reopen = useCallback(
    (d: Doc) => {
      abortRef.current?.abort()
      const t = templateOf(d.templateId)
      setTemplateId(t.id)
      setTone(isTone(d.tone) ? d.tone : DEFAULT_TONE)
      setLength(isLength(d.length) ? d.length : DEFAULT_LENGTH)
      setFields({ ...(d.fields ?? { topic: d.topic }) })
      setOutput(d.content)
      setStatus('done')
      setStreamError(null)
      setCopied(false)
      setResultMeta({ templateId: t.id, tone: d.tone, length: d.length })
      setTab('write')
      buzz()
      toast({ title: 'Loaded from history', description: `${t.emoji} ${t.title}` })
      window.setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 160)
    },
    [toast],
  )

  const handleDeleteTap = useCallback(
    (id: string) => {
      if (confirmDeleteId === id) {
        if (confirmTimer.current) clearTimeout(confirmTimer.current)
        setConfirmDeleteId(null)
        setHistory((prev) => prev.filter((d) => d.id !== id))
        void idbDelete(DOC_STORE, id).catch(() => {
          /* memory-only fallback */
        })
        buzz()
        toast({ title: 'Draft deleted' })
      } else {
        setConfirmDeleteId(id)
        if (confirmTimer.current) clearTimeout(confirmTimer.current)
        confirmTimer.current = setTimeout(() => setConfirmDeleteId(null), 2600)
      }
    },
    [confirmDeleteId, toast],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return history
    return history.filter((d) => d.topic.toLowerCase().includes(q))
  }, [history, query])

  /* ---------------- derived ---------------- */

  const words = useMemo(() => {
    const t = output.trim()
    return t ? t.split(/\s+/).length : 0
  }, [output])

  const meta = resultMeta ?? { templateId, tone, length }
  const metaTpl = templateOf(meta.templateId)
  const showResult = output.trim().length > 0 || status === 'streaming'
  const showEmpty = !showResult && !streamError

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
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-violet-500/[0.09] via-transparent to-pink-500/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-400 via-fuchsia-500 to-pink-500 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(217_70_239/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Feather className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">AI Writer</h2>
              <p className="text-xs text-zinc-400">Eight templates, your tone — drafted live.</p>
            </div>
            {status === 'streaming' && (
              <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1.5 text-[11px] font-medium text-fuchsia-200">
                <motion.span
                  className="size-1.5 rounded-full bg-fuchsia-400"
                  animate={{ opacity: [1, 0.25, 1] }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  aria-hidden
                />
                Writing…
              </span>
            )}
          </div>
        </div>

        {/* ---------------- Tabs ---------------- */}
        <div className="p-4 sm:p-5">
          <div
            className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-1.5"
            role="tablist"
            aria-label="AI Writer sections"
          >
            {TABS.map((t) => {
              const active = tab === t.id
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className="relative flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  {active && (
                    <motion.span
                      layoutId="aiwriter-tab-pill"
                      className="absolute inset-0 rounded-xl bg-gradient-to-r from-violet-500/25 via-fuchsia-500/20 to-pink-500/25 ring-1 ring-fuchsia-400/40"
                      transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                      aria-hidden
                    />
                  )}
                  <span className="relative z-10 flex min-w-0 items-center gap-1.5">
                    <t.icon className="size-4 shrink-0" aria-hidden />
                    <span className={cn('truncate', active && 'text-white')}>{t.label}</span>
                    {t.id === 'history' && history.length > 0 && (
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none',
                          active ? 'bg-fuchsia-500/25 text-fuchsia-200' : 'bg-white/[0.07] text-zinc-400',
                        )}
                      >
                        {history.length}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={SPRING}
              className="mt-4"
            >
              {tab === 'write' ? (
                /* ================================================== */
                /* Write panel                                        */
                /* ================================================== */
                <div className="space-y-5">
                  {/* Template picker */}
                  <section aria-label="Template">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      Template
                    </p>
                    <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                      {TEMPLATES.map((t) => {
                        const active = t.id === templateId
                        return (
                          <button
                            key={t.id}
                            type="button"
                            aria-pressed={active}
                            aria-label={`${t.title} template`}
                            onClick={() => setTemplateId(t.id)}
                            className={cn(
                              'flex h-16 flex-col items-center justify-center gap-1 rounded-2xl border text-center transition-all active:scale-[0.97]',
                              active
                                ? 'border-fuchsia-400/40 bg-gradient-to-br from-violet-500/25 via-fuchsia-500/15 to-pink-500/25 text-white shadow-[0_8px_24px_-8px_rgb(217_70_239/0.45)]'
                                : 'border-white/10 bg-white/[0.04] text-zinc-400 hover:border-white/20 hover:text-zinc-200',
                            )}
                          >
                            <span className="text-lg leading-none" aria-hidden>
                              {t.emoji}
                            </span>
                            <span className="text-[10.5px] font-medium leading-none">{t.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  {/* Dynamic fields */}
                  <section aria-label="Input" className="space-y-3">
                    {tpl.fields.map((f) => {
                      const inputCls =
                        'w-full rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors focus:border-fuchsia-400/40 focus:bg-white/[0.06]'
                      return (
                        <div key={f.key}>
                          <label
                            htmlFor={`field-${f.key}`}
                            className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-400"
                          >
                            {f.label}
                            {!f.optional && <span className="ml-0.5 text-fuchsia-400">*</span>}
                          </label>
                          {f.rows && f.rows > 1 ? (
                            <textarea
                              id={`field-${f.key}`}
                              value={fields[f.key] ?? ''}
                              onChange={(e) => setField(f.key, e.target.value)}
                              placeholder={f.placeholder}
                              rows={f.rows}
                              className={cn(inputCls, 'resize-none')}
                            />
                          ) : (
                            <input
                              id={`field-${f.key}`}
                              value={fields[f.key] ?? ''}
                              onChange={(e) => setField(f.key, e.target.value)}
                              placeholder={f.placeholder}
                              className={cn(inputCls, 'min-h-11 py-2.5')}
                            />
                          )}
                        </div>
                      )
                    })}
                  </section>

                  {/* Tone */}
                  <section aria-label="Tone">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      Tone
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {TONES.map((t) => {
                        const active = t.id === tone
                        return (
                          <button
                            key={t.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setTone(t.id)}
                            className={cn(
                              'h-11 rounded-full px-4 text-[13px] font-medium ring-1 transition-all active:scale-95',
                              active
                                ? 'bg-fuchsia-500/20 text-white ring-fuchsia-400/50 shadow-[0_6px_18px_-6px_rgb(217_70_239/0.5)]'
                                : 'bg-white/[0.04] text-zinc-400 ring-white/10 hover:bg-white/[0.08] hover:text-zinc-200',
                            )}
                          >
                            {t.label}
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  {/* Length */}
                  <section aria-label="Length">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      Length
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {LENGTHS.map((l) => {
                        const active = l.id === length
                        return (
                          <button
                            key={l.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setLength(l.id)}
                            className={cn(
                              'flex h-12 flex-col items-center justify-center rounded-full ring-1 transition-all active:scale-[0.97]',
                              active
                                ? 'bg-gradient-to-r from-violet-500/25 to-pink-500/25 text-white ring-fuchsia-400/50'
                                : 'bg-white/[0.04] text-zinc-400 ring-white/10 hover:bg-white/[0.08] hover:text-zinc-200',
                            )}
                          >
                            <span className="text-[13px] font-semibold leading-tight">{l.label}</span>
                            <span className="text-[10px] leading-tight text-zinc-500">~{l.words} words</span>
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  {/* Generate / Stop */}
                  <div className="space-y-2">
                    {status === 'streaming' ? (
                      <Button
                        onClick={stop}
                        className="h-12 w-full rounded-xl border border-rose-400/30 bg-rose-500/15 font-semibold text-rose-200 shadow-none hover:bg-rose-500/25 hover:text-rose-100"
                      >
                        <Square className="size-4 fill-current" aria-hidden /> Stop generating
                      </Button>
                    ) : (
                      <Button
                        onClick={generate}
                        disabled={missingRequired}
                        className="h-12 w-full rounded-xl bg-gradient-to-r from-violet-400 via-fuchsia-500 to-pink-500 font-semibold text-white shadow-lg shadow-fuchsia-500/30 hover:from-violet-300 hover:via-fuchsia-400 hover:to-pink-400 disabled:opacity-40 disabled:shadow-none"
                      >
                        <Sparkles className="size-4" aria-hidden /> Generate
                      </Button>
                    )}
                    {missingRequired && status !== 'streaming' && (
                      <p className="text-center text-[11px] text-zinc-500">
                        Fill in the required fields to generate.
                      </p>
                    )}
                  </div>

                  {/* Error chip */}
                  {streamError && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={SPRING}
                      className="flex items-center gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-200"
                      role="alert"
                    >
                      <AlertTriangle className="size-4 shrink-0" aria-hidden />
                      <span className="min-w-0 flex-1 leading-snug">{streamError}</span>
                      <button
                        type="button"
                        onClick={regenerate}
                        className="min-h-11 shrink-0 rounded-lg bg-rose-500/25 px-3 text-xs font-semibold text-rose-100 transition-colors hover:bg-rose-500/40"
                      >
                        Retry
                      </button>
                    </motion.div>
                  )}

                  {/* Empty state */}
                  {showEmpty && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={SPRING}
                      className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center"
                    >
                      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 via-fuchsia-500 to-pink-500 text-white shadow-[0_14px_32px_-10px_rgb(217_70_239/0.7)]">
                        <Feather className="size-7" aria-hidden />
                      </div>
                      <p className="mt-4 text-sm font-semibold text-zinc-200">Nothing drafted yet</p>
                      <p className="mx-auto mt-1 max-w-[270px] text-xs leading-relaxed text-zinc-500">
                        Pick a template, set the tone and length, then hit Generate — the words stream in
                        live, and nothing leaves your device except the request.
                      </p>
                    </motion.div>
                  )}

                  {/* Result card */}
                  {showResult && (
                    <motion.div
                      ref={resultRef}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={SPRING}
                      aria-busy={status === 'streaming'}
                      className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03]"
                    >
                      {/* meta row */}
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-white/5 px-4 py-2.5">
                        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400">
                          <span aria-hidden>{metaTpl.emoji}</span>
                          <span className="truncate font-medium text-zinc-300">{metaTpl.title}</span>
                          <span className="text-zinc-600" aria-hidden>
                            ·
                          </span>
                          <span>{toneLabelOf(meta.tone)}</span>
                          <span className="text-zinc-600" aria-hidden>
                            ·
                          </span>
                          <span>{lengthLabelOf(meta.length)}</span>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-500">
                          {words}w · {output.length}c
                        </span>
                      </div>

                      {/* streamed text */}
                      <div
                        className={cn(
                          'max-h-[420px] overflow-y-auto px-4 py-4',
                          SCROLLBAR_CLS,
                        )}
                        aria-live="polite"
                      >
                        {status === 'streaming' && !output ? (
                          <div className="flex items-center gap-2 py-1 text-sm text-zinc-500">
                            <Loader2 className="size-4 animate-spin" aria-hidden /> Putting pen to paper…
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap font-serif text-[15px] leading-[1.8] text-zinc-100">
                            {output}
                            {status === 'streaming' && (
                              <motion.span
                                aria-hidden
                                className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.16em] rounded-full bg-fuchsia-400"
                                animate={{ opacity: [1, 1, 0, 0] }}
                                transition={{
                                  duration: 1.1,
                                  times: [0, 0.45, 0.55, 1],
                                  repeat: Infinity,
                                  ease: 'linear',
                                }}
                              />
                            )}
                          </p>
                        )}
                      </div>

                      {/* actions */}
                      {status !== 'streaming' && output.trim() && (
                        <div className="grid grid-cols-4 gap-2 border-t border-white/5 p-3">
                          <ResultAction
                            icon={copied ? Check : Copy}
                            label={copied ? 'Copied' : 'Copy'}
                            onClick={() => void copyResult()}
                          />
                          <ResultAction icon={Share2} label="Share" onClick={() => void shareResult()} />
                          <ResultAction icon={RotateCcw} label="Again" onClick={regenerate} />
                          <ResultAction icon={BookmarkPlus} label="Save" onClick={saveToHistory} />
                        </div>
                      )}
                    </motion.div>
                  )}
                </div>
              ) : (
                /* ================================================== */
                /* History panel                                      */
                /* ================================================== */
                <div className="space-y-4">
                  {/* search */}
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-zinc-500"
                      aria-hidden
                    />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search by topic…"
                      aria-label="Search history by topic"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-10 pr-11 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none transition-colors focus:border-fuchsia-400/40 focus:bg-white/[0.06]"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery('')}
                        aria-label="Clear search"
                        className="absolute right-0.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 transition-colors hover:text-white"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    )}
                  </div>

                  {filtered.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.98 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={SPRING}
                      className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 py-12 text-center"
                    >
                      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-300">
                        {query ? (
                          <SearchX className="size-7" aria-hidden />
                        ) : (
                          <Feather className="size-7" aria-hidden />
                        )}
                      </div>
                      <p className="mt-4 text-sm font-semibold text-zinc-200">
                        {query ? 'No matches' : 'No saved drafts yet'}
                      </p>
                      <p className="mx-auto mt-1 max-w-[270px] text-xs leading-relaxed text-zinc-500">
                        {query
                          ? `Nothing in your history has a topic matching “${query.trim()}”.`
                          : loaded
                            ? 'Generate something on the Write tab and tap Save — drafts live here, private on your device.'
                            : 'Loading your drafts…'}
                      </p>
                    </motion.div>
                  ) : (
                    <ul className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-label="Saved drafts">
                      {filtered.map((d) => {
                        const dtpl = templateOf(d.templateId)
                        const confirming = confirmDeleteId === d.id
                        return (
                          <li key={d.id} className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => reopen(d)}
                              className="min-w-0 flex-1 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-left transition-all hover:border-fuchsia-400/30 hover:bg-fuchsia-500/[0.06] active:scale-[0.99]"
                            >
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                                <span className="normal-case" aria-hidden>
                                  {dtpl.emoji}
                                </span>
                                <span>{dtpl.title}</span>
                                <span aria-hidden>·</span>
                                <span>{toneLabelOfCap(d.tone)}</span>
                                <span aria-hidden>·</span>
                                <span>{lengthLabelOf(d.length)}</span>
                                <span className="ml-auto normal-case tracking-normal">{relDate(d.createdAt)}</span>
                              </div>
                              <p className="mt-1 truncate text-[13px] font-medium text-zinc-200">{d.topic}</p>
                              <p className="mt-0.5 line-clamp-2 font-serif text-xs leading-relaxed text-zinc-500">
                                {d.content}
                              </p>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTap(d.id)}
                              aria-label={
                                confirming
                                  ? 'Tap again to confirm delete'
                                  : `Delete draft: ${d.topic}`
                              }
                              className={cn(
                                'flex h-11 shrink-0 items-center justify-center rounded-xl border transition-all active:scale-95',
                                confirming
                                  ? 'w-16 border-rose-400/40 bg-rose-500/20 text-rose-200'
                                  : 'w-11 border-white/10 bg-white/[0.03] text-zinc-500 hover:border-rose-400/30 hover:text-rose-300',
                              )}
                            >
                              {confirming ? (
                                <span className="text-[11px] font-bold">Sure?</span>
                              ) : (
                                <Trash2 className="size-4" aria-hidden />
                              )}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}
