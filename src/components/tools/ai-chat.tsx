'use client'

/**
 * AI Assistant v2 — streaming chat with personas & saved conversations.
 *
 * Backend: POST /api/ai/stream (NDJSON). Request body: { messages } where the
 * first element may be a `system` message (the active persona). Each response
 * line is JSON: { t: 'delta', v: string } | { t: 'done' } | { t: 'error', v }.
 * Deltas are appended live into the assistant bubble; { t: 'error' } and any
 * fetch/shape failure surface as an inline retry chip. Stop (AbortController)
 * keeps the partial reply.
 *
 * Persistence: IndexedDB 'toolhub-aichat' / store 'conversations' —
 * { id, title, personaId, messages: [{ role: 'user'|'assistant', content, createdAt }], updatedAt }.
 * Active persona + active conversation ids are mirrored in localStorage.
 * Legacy chats from 'toolhub.ai-chat.messages' (v1) are migrated on first run.
 *
 * Markdown-lite renderer (no packages): fenced code blocks, ## / ### headings,
 * **bold**, *italic*, `inline code`, - / 1. lists, > quotes, clickable URLs.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  MessagesSquare,
  PanelLeft,
  Plus,
  RotateCcw,
  Send,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
}

/** Shape persisted in IndexedDB (no runtime id). */
interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}

interface Conversation {
  id: string
  title: string
  personaId: string
  messages: StoredMessage[]
  updatedAt: number
}

interface Persona {
  id: string
  name: string
  emoji: string
  system: string
}

interface FailedRequest {
  message: string
  retryText: string
}

const PERSONA_KEY = 'toolhub.aichat.persona'
const ACTIVE_KEY = 'toolhub.aichat.active'
const LEGACY_KEY = 'toolhub.ai-chat.messages'

const MAX_MESSAGES = 100
const MAX_CHARS = 2000
/** Conversation tail sent to the API (backend clamps at 24 incl. system). */
const MAX_CONTEXT = 12
/** Title truncation length (~chars). */
const TITLE_LEN = 32

const PERSONAS: Persona[] = [
  {
    id: 'default',
    name: 'Assistant',
    emoji: '🤖',
    system:
      'You are the ToolHub assistant, a helpful general-purpose AI. Give clear, accurate, concise answers. Use markdown-lite formatting when it helps: ## or ### headings, **bold**, *italic*, - lists, and ``` code fences. Keep responses short and scannable unless depth is requested.',
  },
  {
    id: 'writer',
    name: 'Writing helper',
    emoji: '✍️',
    system:
      "You are a professional writing helper. Improve clarity, tone, grammar and flow. When the user gives text, return the improved version first, then at most 2-3 brief notes on what changed. Match the user's intended tone and keep their meaning intact. Use markdown-lite formatting.",
  },
  {
    id: 'translator',
    name: 'Translator',
    emoji: '🌐',
    system:
      "You are a translator. Detect the language of the user's text. If a target language is requested, translate into it; otherwise translate into English. Reply ONLY with the translation — no explanations, no surrounding quotes, no transliteration unless asked. Preserve tone, formatting and line breaks.",
  },
  {
    id: 'teacher',
    name: 'Teacher',
    emoji: '🧑‍🏫',
    system:
      'You are a patient teacher who explains any topic in simple words. Use everyday analogies, short steps and small examples. Define jargon the first time it appears. Structure answers with ## headings and - lists. End with one short question that checks understanding.',
  },
  {
    id: 'code',
    name: 'Code helper',
    emoji: '💻',
    system:
      'You are an expert programming assistant. Give correct, idiomatic, runnable code inside ``` fenced blocks with the language tag. Explain briefly before or after the code, list key edge cases, and mention safer alternatives when relevant. Never invent APIs.',
  },
  {
    id: 'brainstorm',
    name: 'Brainstormer',
    emoji: '💡',
    system:
      'You are a creative brainstorming partner. Produce diverse, original ideas fast: breadth first, then mark the 1-2 most promising with a quick note on why. Use - lists, keep each idea to one or two lines, and end by offering to go deeper on any of them.',
  },
]

const SUGGESTIONS = [
  "Translate 'Good morning' into 5 languages",
  'Write a friendly birthday wish',
  'Explain quantum computing simply',
  'Plan a 3-day Paris trip',
  'Debug: why is my fetch pending forever?',
]

const AVATAR_GRADIENT = 'from-amber-300 via-orange-500 to-rose-500'

const SCROLLBAR =
  '[scrollbar-width:thin] [scrollbar-color:rgb(255_255_255/0.15)_transparent] ' +
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent ' +
  '[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-thumb:hover]:bg-white/25'

const ASSISTANT_BUBBLE =
  'rounded-2xl rounded-tl-md border border-white/10 bg-white/[0.06] px-3.5 py-2.5 shadow-sm backdrop-blur-sm'

/* ================================================================== */
/* Small helpers                                                       */
/* ================================================================== */

function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through to manual id */
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function relTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return 'New chat'
  return t.length > TITLE_LEN ? `${t.slice(0, TITLE_LEN)}…` : t
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) return err.name === 'AbortError'
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

function isValidConversation(c: unknown): c is Conversation {
  if (typeof c !== 'object' || c === null) return false
  const r = c as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return false
  if (typeof r.updatedAt !== 'number' || !Array.isArray(r.messages)) return false
  return r.messages.every((m) => {
    if (typeof m !== 'object' || m === null) return false
    const mm = m as Record<string, unknown>
    return (
      (mm.role === 'user' || mm.role === 'assistant') &&
      typeof mm.content === 'string' &&
      typeof mm.createdAt === 'number'
    )
  })
}

function toStored(msgs: ChatMessage[]): StoredMessage[] {
  return msgs.slice(-MAX_MESSAGES).map((m) => ({ role: m.role, content: m.content, createdAt: m.ts }))
}

function fromStored(stored: StoredMessage[]): ChatMessage[] {
  return stored.slice(-MAX_MESSAGES).map((m) => ({ id: uid(), role: m.role, content: m.content, ts: m.createdAt }))
}

/** Legacy v1 chat (localStorage array of {id, role, content, ts}). */
function loadLegacyMessages(): StoredMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: StoredMessage[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const r = item as Record<string, unknown>
      if (
        (r.role !== 'user' && r.role !== 'assistant') ||
        typeof r.content !== 'string' ||
        typeof r.ts !== 'number'
      ) {
        continue
      }
      out.push({ role: r.role, content: r.content, createdAt: r.ts })
    }
    return out.slice(-MAX_MESSAGES)
  } catch {
    return []
  }
}

/* ================================================================== */
/* IndexedDB — conversations, fully on-device                          */
/* ================================================================== */

const DB_NAME = 'toolhub-aichat'
const DB_VERSION = 1
const CONV_STORE = 'conversations'

let dbPromise: Promise<IDBDatabase> | null = null

function openChatDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(CONV_STORE)) {
        d.createObjectStore(CONV_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function chatDb(): Promise<IDBDatabase> {
  dbPromise ??= openChatDb()
  return dbPromise
}

function idbGetAll<T>(store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    chatDb()
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
    chatDb()
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
    chatDb()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).delete(key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
      })
      .catch(reject)
  })
}

/* ================================================================== */
/* Markdown-lite renderer (deterministic tokenizer, no packages)       */
/* ================================================================== */

type FenceBlock = { kind: 'code'; lang: string; code: string }
type TextSeg = { kind: 'text'; content: string }

/** Split on ``` fences first; an unterminated trailing fence still renders as code. */
function splitFences(text: string): Array<FenceBlock | TextSeg> {
  const marks: number[] = []
  const re = /```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) marks.push(m.index)

  const blocks: Array<FenceBlock | TextSeg> = []
  let cursor = 0
  let i = 0
  while (i + 1 < marks.length) {
    const open = marks[i]
    const close = marks[i + 1]
    if (open > cursor) blocks.push({ kind: 'text', content: text.slice(cursor, open) })
    blocks.push(makeCode(text.slice(open + 3, close)))
    cursor = close + 3
    i += 2
  }
  if (i < marks.length) {
    const open = marks[i]
    if (open > cursor) blocks.push({ kind: 'text', content: text.slice(cursor, open) })
    blocks.push(makeCode(text.slice(open + 3)))
    cursor = text.length
  }
  if (cursor < text.length) blocks.push({ kind: 'text', content: text.slice(cursor) })
  return blocks
}

function makeCode(inner: string): FenceBlock {
  const nl = inner.indexOf('\n')
  if (nl !== -1) {
    const first = inner.slice(0, nl).trim()
    if (/^[\w+#.-]{0,20}$/.test(first)) {
      return { kind: 'code', lang: first, code: inner.slice(nl + 1).replace(/\n+$/, '') }
    }
  }
  return { kind: 'code', lang: '', code: inner.replace(/\n+$/, '') }
}

const INLINE_CODE_CLASS =
  'rounded-md bg-white/10 px-1 py-0.5 font-mono text-[12px] text-amber-200'

/** Inline pass: `code` → **bold** → *italic* → bare URLs. Earliest-match scan. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let plain = ''
  let i = 0
  let k = 0
  const flush = () => {
    if (plain) {
      out.push(plain)
      plain = ''
    }
  }
  while (i < text.length) {
    const rest = text.slice(i)
    let m = /^`([^`\n]+)`/.exec(rest)
    if (m) {
      flush()
      out.push(
        <code key={`${keyBase}c${k++}`} className={INLINE_CODE_CLASS}>
          {m[1]}
        </code>
      )
      i += m[0].length
      continue
    }
    m = /^\*\*([\s\S]+?)\*\*/.exec(rest)
    if (m) {
      flush()
      out.push(
        <strong key={`${keyBase}b${k++}`} className="font-semibold text-white">
          {renderInline(m[1], `${keyBase}b${k}`)}
        </strong>
      )
      i += m[0].length
      continue
    }
    m = /^\*([^*\n]+)\*/.exec(rest)
    if (m) {
      flush()
      out.push(
        <em key={`${keyBase}i${k++}`} className="italic">
          {renderInline(m[1], `${keyBase}i${k}`)}
        </em>
      )
      i += m[0].length
      continue
    }
    m = /^(https?:\/\/[^\s<>()\[\]{}"']+)/.exec(rest)
    if (m) {
      flush()
      out.push(
        <a
          key={`${keyBase}a${k++}`}
          href={m[1]}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all font-medium text-amber-300 underline underline-offset-2"
        >
          {m[1]}
        </a>
      )
      i += m[0].length
      continue
    }
    plain += text[i]
    i++
  }
  flush()
  return out
}

function CodeBlockView({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    []
  )
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-white/10 bg-black/40 first:mt-0 last:mb-0">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {lang || 'code'}
        </span>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={copied ? 'Code copied' : 'Copy code'}
          className="relative flex min-h-8 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-zinc-400 transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:text-amber-300"
        >
          {copied ? <Check className="size-3 text-emerald-400" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-zinc-200">
        <code className="whitespace-pre">{code}</code>
      </pre>
    </div>
  )
}

/** Per-line block pass over one non-code segment. */
function TextBlockView({ content, base }: { content: string; base: string }) {
  const lines = content.split('\n')
  const nodes: ReactNode[] = []
  let list: { type: 'ul' | 'ol'; items: ReactNode[]; start: number } | null = null
  let quote: ReactNode[] | null = null
  let k = 0
  const nk = () => `${base}-${k++}`

  const flushList = () => {
    if (!list) return
    const { type, items, start } = list
    nodes.push(
      type === 'ol' ? (
        <ol
          key={nk()}
          start={start}
          className="my-1.5 list-decimal space-y-1 pl-5 marker:font-semibold marker:text-amber-400/80"
        >
          {items}
        </ol>
      ) : (
        <ul key={nk()} className="my-1.5 list-disc space-y-1 pl-5 marker:text-amber-400/80">
          {items}
        </ul>
      )
    )
    list = null
  }
  const flushQuote = () => {
    if (!quote) return
    nodes.push(
      <blockquote
        key={nk()}
        className="my-1.5 space-y-1 border-l-2 border-amber-400/50 pl-3 text-zinc-300"
      >
        {quote}
      </blockquote>
    )
    quote = null
  }
  const flushAll = () => {
    flushList()
    flushQuote()
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flushAll()
      continue
    }
    let m = /^(#{1,6})\s+(.+)$/.exec(line)
    if (m) {
      flushAll()
      if (m[1].length <= 2) {
        nodes.push(
          <h3 key={nk()} className="mb-1.5 mt-3 text-[15px] font-bold text-white first:mt-0">
            {renderInline(m[2], nk())}
          </h3>
        )
      } else {
        nodes.push(
          <h4 key={nk()} className="mb-1 mt-2.5 text-sm font-semibold text-white first:mt-0">
            {renderInline(m[2], nk())}
          </h4>
        )
      }
      continue
    }
    m = /^[-*•]\s+(.+)$/.exec(line)
    if (m) {
      flushQuote()
      if (!list || list.type !== 'ul') {
        flushList()
        list = { type: 'ul', items: [], start: 1 }
      }
      list.items.push(
        <li key={nk()} className="pl-0.5">
          {renderInline(m[1], nk())}
        </li>
      )
      continue
    }
    m = /^(\d{1,3})[.)]\s+(.+)$/.exec(line)
    if (m) {
      flushQuote()
      const num = parseInt(m[1], 10)
      if (!list || list.type !== 'ol') {
        flushList()
        list = { type: 'ol', items: [], start: num }
      }
      list.items.push(
        <li key={nk()} className="pl-0.5">
          {renderInline(m[2], nk())}
        </li>
      )
      continue
    }
    m = /^>\s?(.*)$/.exec(line)
    if (m) {
      flushList()
      if (!quote) quote = []
      quote.push(
        <p key={nk()} className="my-0">
          {renderInline(m[1], nk())}
        </p>
      )
      continue
    }
    flushAll()
    nodes.push(
      <p key={nk()} className="my-1.5 break-words first:mt-0 last:mb-0">
        {renderInline(line, nk())}
      </p>
    )
  }
  flushAll()
  return <>{nodes}</>
}

function MarkdownLite({ text }: { text: string }) {
  const blocks = splitFences(text)
  return (
    <div className="text-sm leading-relaxed text-zinc-100">
      {blocks.map((b, bi) =>
        b.kind === 'code' ? (
          <CodeBlockView key={`cb-${bi}`} lang={b.lang} code={b.code} />
        ) : (
          <TextBlockView key={`tb-${bi}`} content={b.content} base={`tb-${bi}`} />
        )
      )}
    </div>
  )
}

/* ================================================================== */
/* Shared building blocks                                              */
/* ================================================================== */

function AssistantAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br text-white ring-1 ring-black/5',
        'shadow-[0_6px_16px_-6px_rgb(245_158_11/0.6),inset_0_1px_1px_rgb(255_255_255/0.4)]',
        AVATAR_GRADIENT,
        className ?? 'size-9'
      )}
    >
      <Bot className="size-[18px]" />
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
    </span>
  )
}

function NewChatButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      className="h-11 w-full gap-2 rounded-xl bg-gradient-to-r from-amber-400 via-orange-500 to-rose-500 text-sm font-bold text-white shadow-lg shadow-orange-500/25 transition hover:brightness-110"
    >
      <Plus className="size-4" aria-hidden />
      New chat
    </Button>
  )
}

function EmptyHistory() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-500">
        <MessagesSquare className="size-5" aria-hidden />
      </span>
      <p className="text-sm font-semibold text-zinc-300">No conversations yet</p>
      <p className="max-w-[210px] text-[11px] leading-relaxed text-zinc-500">
        Start chatting — every conversation is saved on this device automatically.
      </p>
    </div>
  )
}

function HistoryList({
  conversations,
  activeId,
  confirmId,
  onOpen,
  onRequestDelete,
}: {
  conversations: Conversation[]
  activeId: string | null
  confirmId: string | null
  onOpen: (c: Conversation) => void
  onRequestDelete: (id: string) => void
}) {
  return (
    <div className="space-y-2">
      {conversations.map((c) => {
        const active = c.id === activeId
        const confirming = c.id === confirmId
        const pEmoji = PERSONAS.find((p) => p.id === c.personaId)?.emoji ?? '🤖'
        return (
          <div
            key={c.id}
            className={cn(
              'flex items-center gap-1 rounded-2xl border p-1.5 pl-2.5 transition-colors',
              active
                ? 'border-amber-400/40 bg-gradient-to-r from-amber-500/15 via-orange-500/5 to-transparent'
                : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.08]'
            )}
          >
            <button
              type="button"
              onClick={() => onOpen(c)}
              aria-label={`Open conversation: ${c.title}`}
              aria-current={active ? 'true' : undefined}
              className="min-h-11 min-w-0 flex-1 text-left"
            >
              <p className="truncate text-[13px] font-semibold text-zinc-100">{c.title}</p>
              <p className="mt-0.5 truncate text-[10px] tabular-nums text-zinc-500">
                {pEmoji} {c.messages.length} {c.messages.length === 1 ? 'msg' : 'msgs'} ·{' '}
                {relTime(c.updatedAt)}
              </p>
            </button>
            <button
              type="button"
              onClick={() => onRequestDelete(c.id)}
              aria-label={confirming ? `Tap again to delete: ${c.title}` : `Delete conversation: ${c.title}`}
              title={confirming ? 'Tap again to delete' : 'Delete (tap twice)'}
              className={cn(
                'relative flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors after:absolute after:-inset-1.5 after:content-[""]',
                confirming ? 'bg-red-500/20 text-red-300' : 'text-zinc-500 hover:bg-white/10 hover:text-red-300'
              )}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/* ================================================================== */
/* Main component                                                      */
/* ================================================================== */

export default function AiChatApp() {
  const { toast } = useToast()

  /* ---------------- data state ---------------- */
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [personaId, setPersonaId] = useState<string>(PERSONAS[0].id)
  /** Persona that produced the active conversation's saved tail (drives the switch hint). */
  const [convPersonaId, setConvPersonaId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  /* ---------------- streaming state ---------------- */
  const [pending, setPending] = useState(false)
  const [streamWait, setStreamWait] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<FailedRequest | null>(null)

  /* ---------------- ui state ---------------- */
  const [input, setInput] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  /* ---------------- refs ---------------- */
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stickRef = useRef(true)
  const copiedTimerRef = useRef<number | null>(null)
  const delTimerRef = useRef<number | null>(null)
  const clearTimerRef = useRef<number | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const personaRef = useRef<string>(PERSONAS[0].id)

  const persona = useMemo(
    () => PERSONAS.find((p) => p.id === personaId) ?? PERSONAS[0],
    [personaId]
  )

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        let convs = (await idbGetAll<Conversation>(CONV_STORE)).filter(isValidConversation)
        convs.sort((a, b) => b.updatedAt - a.updatedAt)

        /* migrate v1 localStorage chat into a real conversation */
        const legacy = loadLegacyMessages()
        if (legacy.length > 0 && convs.length === 0) {
          const firstUser = legacy.find((m) => m.role === 'user')
          const migrated: Conversation = {
            id: uid(),
            title: titleFrom(firstUser?.content ?? ''),
            personaId: PERSONAS[0].id,
            messages: legacy,
            updatedAt: Date.now(),
          }
          await idbPut(CONV_STORE, migrated)
          convs = [migrated]
          try {
            localStorage.removeItem(LEGACY_KEY)
          } catch {
            /* ignore */
          }
        }
        if (!alive) return
        setConversations(convs)

        try {
          const savedPersona = localStorage.getItem(PERSONA_KEY)
          if (savedPersona && PERSONAS.some((p) => p.id === savedPersona)) {
            personaRef.current = savedPersona
            setPersonaId(savedPersona)
          }
          const savedActive = localStorage.getItem(ACTIVE_KEY)
          const active = savedActive ? convs.find((c) => c.id === savedActive) : undefined
          if (active) {
            activeIdRef.current = active.id
            setActiveId(active.id)
            setMessages(fromStored(active.messages))
            const pid = PERSONAS.some((p) => p.id === active.personaId)
              ? active.personaId
              : PERSONAS[0].id
            setConvPersonaId(pid)
            personaRef.current = pid
            setPersonaId(pid)
            stickRef.current = false
          }
        } catch {
          /* storage unavailable — session-only persona */
        }
      } catch {
        /* IndexedDB unavailable — session-only mode */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* keep personaRef in sync (safety net) */
  useEffect(() => {
    personaRef.current = personaId
  }, [personaId])

  /* ---------------- cleanup on unmount ---------------- */
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
      if (delTimerRef.current !== null) window.clearTimeout(delTimerRef.current)
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current)
    }
  }, [])

  /* Escape closes the mobile history drawer */
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  /* ---------------- auto-scroll (never fights the user) ---------------- */
  const scrollToEnd = useCallback((behavior: ScrollBehavior) => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  const onScrollAreaScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140
  }, [])

  useEffect(() => {
    if (stickRef.current) scrollToEnd('smooth')
  }, [messages.length, pending, streamWait, error, activeId, scrollToEnd])

  /* during streaming: instant follow, only when already near bottom */
  useEffect(() => {
    if (pending && stickRef.current) scrollToEnd('auto')
  }, [streamText, pending, scrollToEnd])

  /* auto-growing textarea: clamp to ~5 rows */
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 120)}px`
  }, [input])

  /* ---------------- persistence ---------------- */
  const saveConversation = useCallback((convId: string, msgs: ChatMessage[]) => {
    const p = PERSONAS.find((x) => x.id === personaRef.current) ?? PERSONAS[0]
    const firstUser = msgs.find((m) => m.role === 'user')
    const rec: Conversation = {
      id: convId,
      title: titleFrom(firstUser?.content ?? ''),
      personaId: p.id,
      messages: toStored(msgs),
      updatedAt: Date.now(),
    }
    setConvPersonaId(p.id)
    setConversations((prev) => {
      const rest = prev.filter((c) => c.id !== convId)
      return [rec, ...rest].sort((a, b) => b.updatedAt - a.updatedAt)
    })
    void idbPut(CONV_STORE, rec).catch(() => {
      /* storage unavailable — memory only */
    })
  }, [])

  /* ---------------- streaming request ---------------- */
  const runStream = useCallback(
    async (history: ChatMessage[], convId: string) => {
      const p = PERSONAS.find((x) => x.id === personaRef.current) ?? PERSONAS[0]
      const lastUserText = [...history].reverse().find((m) => m.role === 'user')?.content ?? ''
      setPending(true)
      setStreamWait(true)
      setStreamText('')
      setError(null)

      const controller = new AbortController()
      abortRef.current = controller
      let acc = ''
      let streamErr: string | null = null
      let aborted = false
      let sawDone = false

      try {
        const res = await fetch('/api/ai/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: p.system },
              ...history.slice(-MAX_CONTEXT).map((m) => ({ role: m.role, content: m.content })),
            ],
          }),
          signal: controller.signal,
        })
        if (!res.ok || !res.body) {
          let msg = `Request failed with status ${res.status}`
          try {
            const body = (await res.json()) as { error?: unknown }
            if (body && typeof body.error === 'string' && body.error) msg = body.error
          } catch {
            /* keep the status-based message */
          }
          throw new Error(msg)
        }

        /* NDJSON line-buffered read */
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n')
          buf = parts.pop() ?? ''
          for (const line of parts) {
            const s = line.trim()
            if (!s) continue
            let obj: { t?: unknown; v?: unknown }
            try {
              obj = JSON.parse(s) as { t?: unknown; v?: unknown }
            } catch {
              continue
            }
            if (obj.t === 'delta' && typeof obj.v === 'string' && obj.v) {
              acc += obj.v
              setStreamText(acc)
              setStreamWait(false)
            } else if (obj.t === 'done') {
              sawDone = true
            } else if (obj.t === 'error' && typeof obj.v === 'string' && obj.v) {
              streamErr = obj.v
            }
          }
          if (streamErr) break
        }
      } catch (err) {
        if (isAbortError(err)) {
          aborted = true
        } else {
          streamErr =
            err instanceof Error ? err.message : 'Something went wrong. Please try again.'
        }
      }

      /* finalize — batched state writes */
      const stillActive = activeIdRef.current === convId
      if (abortRef.current === controller) abortRef.current = null

      if (stillActive && acc.trim()) {
        const reply: ChatMessage = { id: uid(), role: 'assistant', content: acc, ts: Date.now() }
        const next = [...history, reply]
        setMessages(next)
        saveConversation(convId, next)
      }
      if (stillActive) {
        if (streamErr) {
          setError({ message: streamErr, retryText: lastUserText })
        } else if (!acc.trim()) {
          if (aborted) {
            setError({ message: 'Stopped before the assistant replied.', retryText: lastUserText })
          } else if (!sawDone) {
            setError({
              message: 'The connection ended before a complete response arrived.',
              retryText: lastUserText,
            })
          } else {
            setError({ message: 'The assistant returned an empty response.', retryText: lastUserText })
          }
        }
      }
      setStreamText('')
      setStreamWait(false)
      setPending(false)
    },
    [saveConversation]
  )

  /* ---------------- actions ---------------- */
  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || pending) return
      const userMsg: ChatMessage = { id: uid(), role: 'user', content: trimmed, ts: Date.now() }
      const next = [...messages, userMsg].slice(-MAX_MESSAGES)
      let convId = activeIdRef.current
      if (!convId) {
        convId = uid()
        activeIdRef.current = convId
        setActiveId(convId)
        try {
          localStorage.setItem(ACTIVE_KEY, convId)
        } catch {
          /* private mode */
        }
      }
      setMessages(next)
      setInput('')
      saveConversation(convId, next) /* persist the user turn right away */
      void runStream(next, convId)
    },
    [messages, pending, runStream, saveConversation]
  )

  const retry = useCallback(() => {
    if (!error || pending) return
    let hist = messages
    while (hist.length > 0 && hist[hist.length - 1].role === 'assistant') hist = hist.slice(0, -1)
    const convId = activeIdRef.current
    if (hist.length === 0 || !convId) return
    setError(null)
    setMessages(hist)
    void runStream(hist, convId)
  }, [error, messages, pending, runStream])

  const regenerate = useCallback(() => {
    if (pending) return
    let hist = messages
    while (hist.length > 0 && hist[hist.length - 1].role === 'assistant') hist = hist.slice(0, -1)
    const convId = activeIdRef.current
    if (hist.length === 0 || !convId) return
    setError(null)
    setMessages(hist)
    void runStream(hist, convId)
  }, [messages, pending, runStream])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const newChat = useCallback(() => {
    abortRef.current?.abort()
    setDrawerOpen(false)
    setError(null)
    setStreamText('')
    setStreamWait(false)
    setPending(false)
    activeIdRef.current = null
    setActiveId(null)
    setMessages([])
    setConvPersonaId(null)
    stickRef.current = true
    try {
      localStorage.removeItem(ACTIVE_KEY)
    } catch {
      /* private mode */
    }
    textareaRef.current?.focus()
  }, [])

  const openConversation = useCallback((conv: Conversation) => {
    abortRef.current?.abort()
    setDrawerOpen(false)
    setConfirmDeleteId(null)
    setError(null)
    setStreamText('')
    setStreamWait(false)
    setPending(false)
    activeIdRef.current = conv.id
    setActiveId(conv.id)
    setMessages(fromStored(conv.messages))
    const pid = PERSONAS.some((p) => p.id === conv.personaId) ? conv.personaId : PERSONAS[0].id
    setConvPersonaId(pid)
    personaRef.current = pid
    setPersonaId(pid)
    try {
      localStorage.setItem(PERSONA_KEY, pid)
      localStorage.setItem(ACTIVE_KEY, conv.id)
    } catch {
      /* private mode */
    }
    stickRef.current = true
  }, [])

  const deleteConversation = useCallback(
    (id: string) => {
      setConfirmDeleteId(null)
      setConversations((prev) => prev.filter((c) => c.id !== id))
      void idbDelete(CONV_STORE, id).catch(() => {
        /* storage unavailable */
      })
      if (activeIdRef.current === id) newChat()
    },
    [newChat]
  )

  const requestDelete = useCallback(
    (id: string) => {
      if (confirmDeleteId === id) {
        deleteConversation(id)
        toast({ title: 'Conversation deleted' })
        return
      }
      setConfirmDeleteId(id)
      if (delTimerRef.current !== null) window.clearTimeout(delTimerRef.current)
      delTimerRef.current = window.setTimeout(() => setConfirmDeleteId(null), 2600)
    },
    [confirmDeleteId, deleteConversation, toast]
  )

  const requestClear = useCallback(() => {
    if (messages.length === 0 || pending) return
    if (confirmClear) {
      setConfirmClear(false)
      const id = activeIdRef.current
      if (id) deleteConversation(id)
      else newChat()
      toast({ title: 'Conversation cleared' })
      return
    }
    setConfirmClear(true)
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current)
    clearTimerRef.current = window.setTimeout(() => setConfirmClear(false), 2600)
  }, [confirmClear, deleteConversation, messages.length, newChat, pending, toast])

  const switchPersona = useCallback((id: string) => {
    if (id === personaRef.current) return
    personaRef.current = id
    setPersonaId(id)
    try {
      localStorage.setItem(PERSONA_KEY, id)
    } catch {
      /* private mode */
    }
  }, [])

  const copyMessage = useCallback(async (msg: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(msg.content)
      setCopiedId(msg.id)
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = window.setTimeout(() => setCopiedId(null), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }, [])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(input)
    }
  }

  /* ---------------- derived ---------------- */
  const canSend = input.trim().length > 0 && !pending
  const canRegenerate = !pending && messages.length > 0 && messages[messages.length - 1].role === 'assistant'
  const showPersonaHint =
    !pending && activeId !== null && messages.length > 0 && convPersonaId !== null && convPersonaId !== personaId

  const tokenLabel = useMemo(() => {
    const chars = messages.reduce((n, m) => n + m.content.length, 0) + streamText.length
    const approx = Math.max(1, Math.round(chars / 4))
    return approx >= 1000 ? `${(approx / 1000).toFixed(1)}k` : String(approx)
  }, [messages, streamText])

  const iconBtn =
    'relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-colors after:absolute after:-inset-1 after:content-[""] hover:bg-white/10 hover:text-white'

  const historyList = (
    <HistoryList
      conversations={conversations}
      activeId={activeId}
      confirmId={confirmDeleteId}
      onOpen={openConversation}
      onRequestDelete={requestDelete}
    />
  )

  return (
    <div className="flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)] lg:h-[640px] lg:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-black/30 lg:flex">
        <div className="border-b border-white/10 p-3">
          <NewChatButton onClick={newChat} />
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto p-3', SCROLLBAR)}>
          {conversations.length === 0 ? <EmptyHistory /> : historyList}
        </div>
        <div className="border-t border-white/10 p-3 text-[10px] leading-relaxed text-zinc-500">
          Chats stay on this device. Nothing is uploaded anywhere.
        </div>
      </aside>

      {/* Chat column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] p-3 sm:px-4">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open conversation history"
            className={cn(iconBtn, 'lg:hidden')}
          >
            <PanelLeft className="size-[18px]" aria-hidden />
          </button>
          <AssistantAvatar />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-bold leading-tight sm:text-base">AI Assistant</h2>
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  pending ? 'animate-pulse bg-amber-400' : 'bg-emerald-500'
                )}
                aria-hidden
              />
              {pending ? 'Generating…' : `Online — ${persona.name}`}
            </p>
          </div>
          <button type="button" onClick={newChat} aria-label="Start a new chat" title="New chat" className={iconBtn}>
            <Plus className="size-[18px]" aria-hidden />
          </button>
          {messages.length > 0 && !pending && (
            <button
              type="button"
              onClick={requestClear}
              aria-label={
                confirmClear ? 'Tap again to clear this conversation' : 'Clear this conversation'
              }
              title={confirmClear ? 'Tap again to clear' : 'Clear conversation (tap twice)'}
              className={cn(
                iconBtn,
                confirmClear && 'border-red-500/50 bg-red-500/15 text-red-300 hover:bg-red-500/25'
              )}
            >
              <Trash2 className="size-[18px]" aria-hidden />
            </button>
          )}
        </div>

        {/* Persona picker */}
        <div
          role="radiogroup"
          aria-label="Assistant persona"
          className="flex items-center gap-1.5 overflow-x-auto border-b border-white/10 px-3 py-2 sm:px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {PERSONAS.map((p) => {
            const active = p.id === personaId
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => switchPersona(p.id)}
                className={cn(
                  'relative flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-all after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[""]',
                  active
                    ? 'border-amber-400/60 bg-amber-500/15 text-amber-200 shadow-[0_0_16px_-6px_rgb(245_158_11/0.7)]'
                    : 'border-white/10 bg-white/[0.04] text-zinc-400 hover:bg-white/[0.09] hover:text-zinc-200'
                )}
              >
                <span aria-hidden>{p.emoji}</span>
                {p.name}
              </button>
            )
          })}
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          onScroll={onScrollAreaScroll}
          role="log"
          aria-live="polite"
          aria-label="Conversation messages"
          className={cn(
            'h-[56vh] min-h-[320px] flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4 lg:h-auto lg:min-h-0',
            SCROLLBAR
          )}
        >
          {!loaded ? (
            <div className="flex h-full items-center justify-center">
              <AssistantAvatar className="size-14 animate-pulse rounded-[1.35rem] [&>svg]:size-7" />
            </div>
          ) : messages.length === 0 && !pending ? (
            /* Empty state */
            <div className="flex h-full flex-col items-center justify-center gap-4 py-6 text-center">
              <motion.div
                initial={{ opacity: 0, scale: 0.8, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              >
                <AssistantAvatar className="size-16 rounded-[1.35rem] [&>svg]:size-8" />
              </motion.div>
              <div className="space-y-1">
                <p className="text-lg font-bold tracking-tight">How can I help you today?</p>
                <p className="mx-auto max-w-xs text-sm text-zinc-400">
                  {persona.emoji} {persona.name} is ready — ideas, explanations, translations, plans.
                </p>
              </div>
              <div className="flex w-full max-w-md flex-wrap justify-center gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    disabled={pending}
                    className="min-h-11 rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-xs font-medium text-zinc-200 shadow-sm transition-all hover:-translate-y-0.5 hover:border-amber-400/40 hover:bg-white/[0.09] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50 disabled:opacity-50 sm:text-[13px]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, idx) =>
                m.role === 'user' ? (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                    className="flex justify-end"
                  >
                    <div className="flex max-w-[85%] flex-col items-end sm:max-w-[72%]">
                      <div className="rounded-2xl rounded-br-md bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 px-3.5 py-2.5 text-sm leading-relaxed text-white shadow-[0_6px_18px_-6px_rgb(249_115_22/0.55)]">
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      </div>
                      <div className="flex items-center gap-0.5 px-1 pt-1">
                        <span className="text-[10px] tabular-nums text-zinc-500">{formatTime(m.ts)}</span>
                        <button
                          type="button"
                          onClick={() => void copyMessage(m)}
                          aria-label={copiedId === m.id ? 'Copied' : 'Copy message'}
                          className="relative flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:text-zinc-200"
                        >
                          {copiedId === m.id ? (
                            <Check className="size-3.5 text-emerald-400" aria-hidden />
                          ) : (
                            <Copy className="size-3.5" aria-hidden />
                          )}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 12, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                    className="flex items-start gap-2"
                  >
                    <AssistantAvatar className="mt-0.5 size-8 [&>svg]:size-4" />
                    <div className="flex min-w-0 max-w-[85%] flex-col items-start sm:max-w-[76%]">
                      <div className={cn('w-full', ASSISTANT_BUBBLE)}>
                        <MarkdownLite text={m.content} />
                      </div>
                      <div className="flex items-center gap-0.5 px-1 pt-1">
                        <span className="text-[10px] tabular-nums text-zinc-500">{formatTime(m.ts)}</span>
                        <button
                          type="button"
                          onClick={() => void copyMessage(m)}
                          aria-label={copiedId === m.id ? 'Copied' : 'Copy reply'}
                          className="relative flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:text-zinc-200"
                        >
                          {copiedId === m.id ? (
                            <Check className="size-3.5 text-emerald-400" aria-hidden />
                          ) : (
                            <Copy className="size-3.5" aria-hidden />
                          )}
                        </button>
                        {canRegenerate && idx === messages.length - 1 && (
                          <button
                            type="button"
                            onClick={regenerate}
                            aria-label="Regenerate this response"
                            title="Regenerate"
                            className="relative flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors after:absolute after:-inset-1.5 after:content-[''] hover:text-amber-300"
                          >
                            <RotateCcw className="size-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )
              )}

              {/* Inline error with retry */}
              <AnimatePresence>
                {error && (
                  <motion.div
                    key="error-chip"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className="flex items-start gap-2"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-red-500/30 bg-red-500/10 text-red-300">
                      <AlertTriangle className="size-4" aria-hidden />
                    </span>
                    <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[76%]">
                      <p className="text-red-300">{error.message}</p>
                      <Button
                        size="sm"
                        onClick={retry}
                        className="relative mt-2 h-9 gap-1.5 rounded-lg bg-red-500/90 text-white after:absolute after:-inset-1 after:content-[''] hover:bg-red-500"
                      >
                        <RotateCcw className="size-3.5" aria-hidden />
                        Retry
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Typing indicator (before first delta) */}
              <AnimatePresence>
                {pending && streamWait && (
                  <motion.div
                    key="typing"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="flex items-start gap-2"
                  >
                    <AssistantAvatar className="size-8 [&>svg]:size-4" />
                    <div
                      className={cn(ASSISTANT_BUBBLE, 'px-4 py-3.5')}
                      role="status"
                      aria-label="Assistant is typing"
                    >
                      <div className="flex items-center gap-1.5">
                        {[0, 1, 2].map((i) => (
                          <motion.span
                            key={i}
                            className="size-2 rounded-full bg-zinc-500"
                            animate={{ y: [0, -4, 0] }}
                            transition={{
                              duration: 0.9,
                              repeat: Infinity,
                              delay: i * 0.15,
                              ease: 'easeInOut',
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Streaming bubble with blinking cursor */}
              {pending && !streamWait && streamText !== '' && (
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                  className="flex items-start gap-2"
                >
                  <AssistantAvatar className="mt-0.5 size-8 [&>svg]:size-4" />
                  <div className={cn('w-full max-w-[85%] sm:max-w-[76%]', ASSISTANT_BUBBLE)}>
                    <MarkdownLite text={streamText} />
                    <span
                      className="mt-0.5 inline-block h-4 w-[7px] animate-pulse rounded-[3px] bg-amber-400"
                      aria-hidden
                    />
                  </div>
                </motion.div>
              )}
            </>
          )}
        </div>

        {/* Composer */}
        <div className="border-t border-white/10 bg-white/[0.02] p-3">
          {showPersonaHint && (
            <div className="mb-2 flex items-center gap-1.5 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
              <span aria-hidden>{persona.emoji}</span>
              <span>
                <strong className="font-semibold">{persona.name}</strong> takes over with your next
                message.
              </span>
            </div>
          )}
          <div className="flex items-end gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${persona.name}…`}
              rows={1}
              maxLength={MAX_CHARS}
              enterKeyHint="send"
              aria-label="Message"
              className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-2xl border-white/10 bg-white/5 text-sm text-zinc-100 placeholder:text-zinc-500 focus-visible:border-amber-400/50 focus-visible:ring-amber-400/20"
            />
            {pending ? (
              <Button
                type="button"
                size="icon"
                onClick={stop}
                aria-label="Stop generating"
                className="size-11 shrink-0 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:text-red-200"
              >
                <Square className="size-4 fill-current" aria-hidden />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                onClick={() => send(input)}
                disabled={!canSend}
                aria-label="Send message"
                className={cn(
                  'size-11 shrink-0 rounded-xl bg-gradient-to-br from-amber-400 via-orange-500 to-rose-500 text-white shadow-lg shadow-orange-500/25',
                  'transition-transform hover:scale-[1.04] active:scale-95 disabled:transform-none disabled:opacity-50'
                )}
              >
                <Send className="size-4" aria-hidden />
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between gap-2 px-1 pt-1.5">
            <span className="hidden text-[10px] text-zinc-500 sm:inline">
              Enter to send · Shift + Enter for a new line
            </span>
            {messages.length > 0 && (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] tabular-nums text-zinc-400">
                {messages.length} {messages.length === 1 ? 'msg' : 'msgs'} · ~{tokenLabel} tok
              </span>
            )}
            <span
              className={cn(
                'ml-auto text-[10px] tabular-nums text-zinc-500',
                input.length >= MAX_CHARS && 'font-semibold text-red-400'
              )}
            >
              {input.length}/{MAX_CHARS}
            </span>
          </div>
        </div>
      </div>

      {/* Mobile history drawer */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden"
              aria-hidden
            />
            <motion.div
              key="panel"
              role="dialog"
              aria-modal="true"
              aria-label="Conversation history"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 340, damping: 34 }}
              className="fixed inset-y-0 left-0 z-50 flex w-[300px] max-w-[85vw] flex-col border-r border-white/10 bg-zinc-950 shadow-2xl lg:hidden"
            >
              <div className="flex items-center justify-between border-b border-white/10 p-3">
                <h3 className="text-sm font-bold">History</h3>
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close history"
                  className={iconBtn}
                >
                  <X className="size-[18px]" aria-hidden />
                </button>
              </div>
              <div className="border-b border-white/10 p-3">
                <NewChatButton onClick={newChat} />
              </div>
              <div className={cn('min-h-0 flex-1 overflow-y-auto p-3', SCROLLBAR)}>
                {conversations.length === 0 ? <EmptyHistory /> : historyList}
              </div>
              <div className="border-t border-white/10 p-3 text-[10px] leading-relaxed text-zinc-500">
                Chats stay on this device. Nothing is uploaded anywhere.
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
