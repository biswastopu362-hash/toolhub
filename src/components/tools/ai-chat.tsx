'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import ReactMarkdown from 'react-markdown'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  RotateCcw,
  Send,
  Square,
  Trash2,
} from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* AI Assistant — chat backed by POST /api/ai                          */
/* Contract: { messages: [{ role, content }] } → { reply } | { error } */
/* ================================================================== */

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
}

interface FailedRequest {
  message: string
  retryText: string
}

const STORAGE_KEY = 'toolhub.ai-chat.messages'
const MAX_MESSAGES = 100
const MAX_CHARS = 2000
const MAX_CONTEXT = 12

const SUGGESTIONS = [
  "Translate 'Good morning' into 5 languages",
  'Write a friendly birthday wish',
  'Explain quantum computing simply',
  'Plan a 3-day Paris trip',
  'Summarize my text in one paragraph',
]

const AVATAR_GRADIENT = 'from-amber-300 via-orange-500 to-rose-500'

function uid(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through to manual id */
  }
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) return err.name === 'AbortError'
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
}

function loadMessages(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const out: ChatMessage[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const rec = item as Record<string, unknown>
      const role = rec.role
      if (typeof rec.content !== 'string' || typeof rec.ts !== 'number') continue
      if (role !== 'user' && role !== 'assistant') continue
      out.push({
        id: typeof rec.id === 'string' ? rec.id : uid(),
        role,
        content: rec.content,
        ts: rec.ts,
      })
    }
    return out.slice(-MAX_MESSAGES)
  } catch {
    return []
  }
}

function persistMessages(msgs: ChatMessage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-MAX_MESSAGES)))
  } catch {
    /* storage unavailable — session-only chat */
  }
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function AssistantAvatar() {
  return (
    <span
      className={cn(
        'relative mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br text-white ring-1 ring-black/5',
        'shadow-[0_4px_10px_-3px_rgb(249_115_22/0.5),inset_0_1px_1px_rgb(255_255_255/0.4)]',
        AVATAR_GRADIENT
      )}
      aria-hidden
    >
      <Bot className="size-4" />
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
    </span>
  )
}

function MarkdownContent({ text }: { text: string }) {
  return (
    <div
      className={cn(
        'break-words text-sm leading-relaxed',
        '[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
        '[&_code]:rounded-md [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]',
        '[&_em]:italic',
        '[&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-bold',
        '[&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-sm [&_h2]:font-bold',
        '[&_h3]:mb-1 [&_h3]:mt-1.5 [&_h3]:text-sm [&_h3]:font-semibold',
        '[&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0',
        '[&_hr]:my-2 [&_hr]:border-border',
        '[&_li]:my-0.5 [&_li>p]:my-0',
        '[&_ol]:my-1 [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_ol]:pl-5',
        '[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-muted [&_pre]:p-2.5 [&_pre]:text-xs',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[11px]',
        '[&_strong]:font-semibold',
        '[&_table]:my-1.5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs',
        '[&_td]:border [&_td]:border-border [&_td]:px-1.5 [&_td]:py-1',
        '[&_th]:border [&_th]:border-border [&_th]:px-1.5 [&_th]:py-1 [&_th]:text-left',
        '[&_ul]:my-1 [&_ul]:list-disc [&_ul]:space-y-0.5 [&_ul]:pl-5'
      )}
    >
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function AiChatApp() {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<FailedRequest | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const copiedTimerRef = useRef<number | null>(null)

  /* Auto-scroll to the latest message (DOM only, no state writes) */
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages.length, pending, error])

  /* Auto-growing textarea: clamp to ~5 rows */
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 120)}px`
  }, [input])

  /* Cleanup: abort in-flight request + pending copy timer */
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const requestReply = useCallback(async (history: ChatMessage[], userText: string) => {
    setPending(true)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.slice(-MAX_CONTEXT).map((m) => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        let msg = `Request failed with status ${res.status}`
        try {
          const body = (await res.json()) as { error?: unknown }
          if (body && typeof body.error === 'string' && body.error) msg = body.error
        } catch {
          /* keep the status-based message */
        }
        throw new Error(msg)
      }
      const data = (await res.json()) as { reply?: unknown }
      if (typeof data.reply !== 'string' || !data.reply.trim()) {
        throw new Error('The assistant returned an empty response')
      }
      const reply: ChatMessage = { id: uid(), role: 'assistant', content: data.reply, ts: Date.now() }
      setMessages((prev) => {
        const next = [...prev, reply].slice(-MAX_MESSAGES)
        persistMessages(next)
        return next
      })
    } catch (err) {
      if (!isAbortError(err)) {
        setError({
          message: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
          retryText: userText,
        })
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setPending(false)
    }
  }, [])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || pending) return
      const userMsg: ChatMessage = { id: uid(), role: 'user', content: trimmed, ts: Date.now() }
      const next = [...messages, userMsg].slice(-MAX_MESSAGES)
      setMessages(next)
      persistMessages(next)
      setInput('')
      void requestReply(next, trimmed)
    },
    [messages, pending, requestReply]
  )

  const retry = useCallback(() => {
    if (!error || pending) return
    const text = error.retryText
    setError(null)
    void requestReply(messages, text)
  }, [error, messages, pending, requestReply])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const clearChat = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setError(null)
    persistMessages([])
    toast({ title: 'New chat started', description: 'Your conversation history was cleared.' })
  }, [toast])

  const copyMessage = useCallback(
    async (msg: ChatMessage) => {
      try {
        await navigator.clipboard.writeText(msg.content)
        setCopiedId(msg.id)
        if (copiedTimerRef.current !== null) window.clearTimeout(copiedTimerRef.current)
        copiedTimerRef.current = window.setTimeout(() => setCopiedId(null), 1600)
      } catch {
        toast({ title: 'Copy failed', description: 'The clipboard is not available.', variant: 'destructive' })
      }
    },
    [toast]
  )

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send(input)
    }
  }

  const canSend = input.trim().length > 0 && !pending

  return (
    <Card className="overflow-hidden shadow-md">
      {/* Header */}
      <div className="flex items-center gap-3 border-b bg-muted/30 p-3 sm:px-4">
        <span
          className={cn(
            'relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-br text-white ring-1 ring-black/5',
            'shadow-[0_6px_16px_-6px_rgb(249_115_22/0.6),inset_0_1px_1px_rgb(255_255_255/0.4)]',
            AVATAR_GRADIENT
          )}
          aria-hidden
        >
          <Bot className="size-[18px]" />
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold leading-tight sm:text-base">AI Assistant</h2>
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            Online — ask me anything
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={messages.length === 0}
              aria-label="Start a new chat"
              className="h-10 gap-1.5 rounded-xl px-3 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
              <span className="hidden sm:inline">New chat</span>
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Start a new chat?</AlertDialogTitle>
              <AlertDialogDescription>
                This clears the current conversation from this device. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={clearChat}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Clear chat
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="max-h-[55vh] min-h-[320px] space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          /* Empty state */
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-4 py-4 text-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              className={cn(
                'relative flex size-16 items-center justify-center overflow-hidden rounded-[1.35rem] bg-gradient-to-br text-white ring-1 ring-black/5',
                'shadow-[0_14px_34px_-10px_rgb(249_115_22/0.55),inset_0_1px_1px_rgb(255_255_255/0.4)]',
                AVATAR_GRADIENT
              )}
              aria-hidden
            >
              <Bot className="size-8" />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </motion.div>
            <div className="space-y-1">
              <p className="text-lg font-bold tracking-tight">How can I help you today?</p>
              <p className="mx-auto max-w-xs text-sm text-muted-foreground">
                Ideas, explanations, translations, plans — just ask.
              </p>
            </div>
            <div className="flex w-full max-w-md flex-wrap justify-center gap-2 pt-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="min-h-11 rounded-2xl border bg-card px-4 text-xs font-medium text-foreground shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-[13px]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) =>
              m.role === 'user' ? (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="flex justify-end"
                >
                  <div className="flex max-w-[85%] flex-col items-end sm:max-w-[72%]">
                    <div className="rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground shadow-sm">
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    </div>
                    <span className="px-1 pt-1 text-[10px] text-muted-foreground">{formatTime(m.ts)}</span>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="flex items-start gap-2"
                >
                  <AssistantAvatar />
                  <div className="flex min-w-0 max-w-[85%] flex-col items-start sm:max-w-[76%]">
                    <div className="w-full rounded-2xl rounded-tl-md border bg-card px-3.5 py-2.5 shadow-sm">
                      <MarkdownContent text={m.content} />
                    </div>
                    <div className="flex items-center gap-0.5 px-1 pt-1">
                      <span className="text-[10px] text-muted-foreground">{formatTime(m.ts)}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void copyMessage(m)}
                        aria-label={copiedId === m.id ? 'Copied' : 'Copy reply'}
                        className="relative size-8 rounded-lg text-muted-foreground after:absolute after:-inset-1.5 after:content-[''] hover:text-foreground"
                      >
                        {copiedId === m.id ? (
                          <Check className="size-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )
            )}

            {/* Inline error with retry */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="flex items-start gap-2"
                >
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl border border-destructive/30 bg-destructive/10 text-destructive">
                    <AlertTriangle className="size-4" aria-hidden />
                  </span>
                  <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-destructive/30 bg-destructive/5 px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[76%]">
                    <p className="text-destructive">{error.message}</p>
                    <Button
                      size="sm"
                      onClick={retry}
                      className="relative mt-2 h-9 gap-1.5 rounded-lg after:absolute after:-inset-1 after:content-['']"
                    >
                      <RotateCcw className="size-3.5" aria-hidden />
                      Retry
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Typing indicator */}
            <AnimatePresence>
              {pending && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="flex items-start gap-2"
                >
                  <AssistantAvatar />
                  <div
                    className="rounded-2xl rounded-tl-md border bg-card px-4 py-3.5 shadow-sm"
                    role="status"
                    aria-label="Assistant is typing"
                  >
                    <div className="flex items-center gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <motion.span
                          key={i}
                          className="size-2 rounded-full bg-muted-foreground/60"
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
          </>
        )}
      </div>

      {/* Composer */}
      <div className="border-t bg-muted/20 p-3">
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, MAX_CHARS))}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything..."
            rows={1}
            maxLength={MAX_CHARS}
            enterKeyHint="send"
            aria-label="Message"
            className="max-h-[120px] min-h-[44px] flex-1 resize-none rounded-2xl bg-background px-3.5 py-2.5 text-sm"
          />
          {pending ? (
            <Button
              type="button"
              size="icon"
              onClick={stop}
              aria-label="Stop generating"
              className="size-11 shrink-0 rounded-xl border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
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
          <span className="hidden text-[10px] text-muted-foreground sm:inline">
            Enter to send · Shift + Enter for a new line
          </span>
          <span
            className={cn(
              'ml-auto text-[10px] tabular-nums text-muted-foreground',
              input.length >= MAX_CHARS && 'font-semibold text-destructive'
            )}
          >
            {input.length}/{MAX_CHARS}
          </span>
        </div>
      </div>
    </Card>
  )
}
