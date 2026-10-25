'use client'

/**
 * Translator — AI-backed translation card.
 *
 * Type (or paste) up to 5,000 characters, pick a source language ("Auto
 * detect" first) and a target from 26 languages, swap with one tap, and
 * translate through the shared POST /api/ai route with a strict
 * translation-engine prompt. Copy / share / speak the result, and revisit
 * the last 20 translations from on-device history.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  Check,
  Copy,
  History,
  Languages,
  Loader2,
  RotateCcw,
  Share2,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

const MAX_CHARS = 5000
const MAX_HISTORY = 20
const PREFS_KEY = 'toolhub-translator-prefs'
const HISTORY_KEY = 'toolhub-translator-history'

interface Language {
  /** ISO 639-1 code */
  code: string
  /** native name */
  native: string
  /** English name */
  english: string
}

const LANGUAGES: Language[] = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
  { code: 'ar', native: 'العربية', english: 'Arabic' },
  { code: 'es', native: 'Español', english: 'Spanish' },
  { code: 'fr', native: 'Français', english: 'French' },
  { code: 'de', native: 'Deutsch', english: 'German' },
  { code: 'pt', native: 'Português', english: 'Portuguese' },
  { code: 'ru', native: 'Русский', english: 'Russian' },
  { code: 'zh', native: '中文', english: 'Chinese' },
  { code: 'ja', native: '日本語', english: 'Japanese' },
  { code: 'ko', native: '한국어', english: 'Korean' },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'tr', native: 'Türkçe', english: 'Turkish' },
  { code: 'it', native: 'Italiano', english: 'Italian' },
  { code: 'ur', native: 'اردو', english: 'Urdu' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
  { code: 'mr', native: 'मराठी', english: 'Marathi' },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese' },
  { code: 'th', native: 'ไทย', english: 'Thai' },
  { code: 'fa', native: 'فارسی', english: 'Persian' },
  { code: 'nl', native: 'Nederlands', english: 'Dutch' },
  { code: 'pl', native: 'Polski', english: 'Polish' },
  { code: 'uk', native: 'Українська', english: 'Ukrainian' },
  { code: 'ms', native: 'Bahasa Melayu', english: 'Malay' },
]

const LANG_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]))
const AUTO = 'auto'

function langName(code: string): string {
  if (code === AUTO) return 'Auto'
  return LANG_BY_CODE.get(code)?.english ?? code
}

/** BCP-47 locales for SpeechSynthesis, falling back to the bare code. */
const SPEECH_LOCALES: Record<string, string> = {
  en: 'en-US', bn: 'bn-BD', hi: 'hi-IN', ar: 'ar-SA', es: 'es-ES',
  fr: 'fr-FR', de: 'de-DE', pt: 'pt-BR', ru: 'ru-RU', zh: 'zh-CN',
  ja: 'ja-JP', ko: 'ko-KR', id: 'id-ID', tr: 'tr-TR', it: 'it-IT',
  ur: 'ur-PK', ta: 'ta-IN', te: 'te-IN', mr: 'mr-IN', vi: 'vi-VN',
  th: 'th-TH', fa: 'fa-IR', nl: 'nl-NL', pl: 'pl-PL', uk: 'uk-UA',
  ms: 'ms-MY',
}

interface Prefs {
  from: string
  to: string
}

interface HistoryItem {
  from: string
  to: string
  source: string
  translated: string
  at: number
}

const DEFAULT_PREFS: Prefs = { from: AUTO, to: 'bn' }

function isValidLang(code: unknown): code is string {
  return typeof code === 'string' && (code === AUTO || LANG_BY_CODE.has(code))
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<Prefs> | null
    const from = isValidLang(parsed?.from) ? parsed.from : AUTO
    const to = isValidLang(parsed?.to) && parsed.to !== AUTO ? parsed.to : DEFAULT_PREFS.to
    return { from, to }
  } catch {
    return DEFAULT_PREFS
  }
}

function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (it): it is HistoryItem =>
          !!it &&
          typeof it === 'object' &&
          typeof (it as HistoryItem).source === 'string' &&
          typeof (it as HistoryItem).translated === 'string' &&
          isValidLang((it as HistoryItem).from) &&
          isValidLang((it as HistoryItem).to),
      )
      .slice(0, MAX_HISTORY)
  } catch {
    return []
  }
}

function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)))
  } catch {
    /* storage full or unavailable — history is best-effort */
  }
}

function buzz() {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

function timeLabel(at: number): string {
  return new Date(at).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** The strict engine prompt sent as an assistant message ahead of the text. */
function buildPrompt(from: string, to: string): string {
  const target = langName(to)
  const sourceRule =
    from === AUTO
      ? `The source language is 'Auto': first silently detect the language of the user's text, then translate it to ${target}.`
      : `Translate the user's text from ${langName(from)} to ${target}.`
  return [
    'You are a translation engine.',
    sourceRule,
    'Output ONLY the translation — no quotes, no explanations, no transliteration notes, no language names.',
    'Preserve formatting and emojis.',
    'If any part of the text is already in the target language, keep it natural and unchanged in meaning.',
  ].join(' ')
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function Translator() {
  const { toast } = useToast()

  const [loaded, setLoaded] = useState(false)
  const [from, setFrom] = useState<string>(DEFAULT_PREFS.from)
  const [to, setTo] = useState<string>(DEFAULT_PREFS.to)
  const [text, setText] = useState('')
  const [output, setOutput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [swapCount, setSwapCount] = useState(0)

  const taRef = useRef<HTMLTextAreaElement | null>(null)
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ---------------- hydrate prefs + history ---------------- */

  useEffect(() => {
    const prefs = loadPrefs()
    setFrom(prefs.from)
    setTo(prefs.to)
    setHistory(loadHistory())
    setLoaded(true)
  }, [])

  /* persist the last language pair */
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ from, to }))
    } catch {
      /* best-effort */
    }
  }, [from, to, loaded])

  /* auto-growing textarea */
  const fitTextarea = useCallback(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 264)}px`
  }, [])

  useEffect(() => {
    fitTextarea()
  }, [text, fitTextarea])

  /* cleanup speech + pending clear-confirm on unmount */
  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel()
      } catch {
        /* noop */
      }
      if (clearTimer.current) clearTimeout(clearTimer.current)
    }
  }, [])

  const trimmed = text.trim()
  const canTranslate = trimmed.length > 0 && !loading
  const nearLimit = text.length >= MAX_CHARS - 200

  /* ---------------- translate ---------------- */

  const translate = useCallback(async () => {
    const source = text.trim()
    if (!source || loading) return
    setLoading(true)
    setError(null)
    buzz()
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'assistant', content: buildPrompt(from, to) },
            { role: 'user', content: source },
          ],
        }),
      })
      const data = (await res.json().catch(() => null)) as
        | { reply?: unknown; error?: unknown }
        | null
      const reply = typeof data?.reply === 'string' ? data.reply.trim() : ''
      if (!res.ok || !reply) {
        const msg =
          typeof data?.error === 'string' && data.error
            ? data.error
            : `Translation failed (${res.status}). Please try again.`
        throw new Error(msg)
      }

      setOutput(reply)
      buzz()
      setHistory((prev) => {
        const head = prev[0]
        if (
          head &&
          head.source === source &&
          head.translated === reply &&
          head.from === from &&
          head.to === to
        ) {
          return prev // dedupe consecutive identical
        }
        const next = [{ from, to, source, translated: reply, at: Date.now() }, ...prev]
        const capped = next.slice(0, MAX_HISTORY)
        saveHistory(capped)
        return capped
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [from, loading, text, to])

  /* ---------------- swap ---------------- */

  const swap = useCallback(() => {
    if (from === AUTO) return // both must be concrete to swap
    buzz()
    setSwapCount((c) => c + 1)
    setFrom(to)
    setTo(from)
    if (output.trim()) {
      setText(output)
      setOutput(text)
    }
    setError(null)
  }, [from, output, text, to])

  /* ---------------- copy / share / speak ---------------- */

  const copyOutput = useCallback(async () => {
    if (!output) return
    const ok = await copyText(output)
    buzz()
    if (ok) {
      setCopiedKey('main')
      setTimeout(() => setCopiedKey((k) => (k === 'main' ? null : k)), 1600)
      toast({ title: 'Translation copied', description: 'Ready to paste anywhere.' })
    } else {
      toast({ title: 'Copy failed', description: 'Your browser blocked clipboard access.' })
    }
  }, [output, toast])

  const shareOutput = useCallback(async () => {
    if (!output) return
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Translation', text: output })
        return
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        /* fall through to clipboard fallback */
      }
    }
    const ok = await copyText(output)
    buzz()
    toast(
      ok
        ? { title: 'Copied instead', description: 'Sharing is unavailable — translation copied.' }
        : { title: 'Could not share', description: 'Sharing and clipboard are unavailable.' },
    )
  }, [output, toast])

  const stopSpeaking = useCallback(() => {
    try {
      window.speechSynthesis?.cancel()
    } catch {
      /* noop */
    }
    setSpeaking(false)
  }, [])

  const speak = useCallback(() => {
    if (!output) return
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast({
        title: 'Speech not supported',
        description: 'This browser cannot read text aloud.',
      })
      return
    }
    try {
      const synth = window.speechSynthesis
      if (speaking) {
        stopSpeaking()
        return
      }
      const utter = new SpeechSynthesisUtterance(output)
      utter.lang = SPEECH_LOCALES[to] ?? to
      utter.rate = 1
      utter.onend = () => setSpeaking(false)
      utter.onerror = () => setSpeaking(false)
      synth.cancel()
      synth.speak(utter)
      setSpeaking(true)
      buzz()
    } catch {
      setSpeaking(false)
      toast({ title: 'Speech not supported', description: 'This browser cannot read text aloud.' })
    }
  }, [output, speaking, stopSpeaking, to, toast])

  /* ---------------- history ---------------- */

  const restore = useCallback(
    (item: HistoryItem) => {
      buzz()
      setText(item.source)
      setFrom(item.from)
      setTo(item.to)
      setOutput(item.translated)
      setError(null)
      toast({ title: 'Restored from history' })
    },
    [toast],
  )

  const copyHistoryItem = useCallback(
    async (item: HistoryItem, key: string) => {
      const ok = await copyText(item.translated)
      buzz()
      if (ok) {
        setCopiedKey(key)
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600)
        toast({ title: 'Copied from history' })
      } else {
        toast({ title: 'Copy failed', description: 'Your browser blocked clipboard access.' })
      }
    },
    [toast],
  )

  const clearAll = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true)
      clearTimer.current = setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    if (clearTimer.current) clearTimeout(clearTimer.current)
    setConfirmClear(false)
    setHistory([])
    try {
      localStorage.removeItem(HISTORY_KEY)
    } catch {
      /* best-effort */
    }
    buzz()
    toast({ title: 'History cleared' })
  }, [confirmClear, toast])

  /* ---------------- derived ---------------- */

  const historyKey = useMemo(() => (item: HistoryItem) => `${item.at}-${item.source.slice(0, 12)}`, [])

  const sourceSelectLabel = from === AUTO ? 'Auto detect' : LANG_BY_CODE.get(from)?.native ?? from

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
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-violet-500/[0.09] via-transparent to-fuchsia-500/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-violet-400 via-purple-500 to-fuchsia-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(168_85_247/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Languages className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Translator</h2>
              <p className="text-xs text-zinc-400">AI translation across 26 languages.</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 p-4 sm:p-5">
          {/* ---------------- Language pickers + swap ---------------- */}
          <div className="flex items-center gap-2">
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger
                aria-label="Source language"
                className="h-11 min-w-0 flex-1 rounded-xl border-white/10 bg-white/[0.04] text-sm text-zinc-100 shadow-none hover:bg-white/[0.07] focus:ring-violet-400/40 data-[placeholder]:text-zinc-400 [&>span]:truncate"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-white/10 bg-zinc-900 text-zinc-100">
                <SelectItem
                  value={AUTO}
                  className="rounded-xl pr-8 focus:bg-violet-500/20 focus:text-white"
                >
                  <span className="flex flex-col items-start leading-tight">
                    <span className="text-sm font-medium">Auto detect</span>
                    <span className="text-xs text-zinc-500">Detect language automatically</span>
                  </span>
                </SelectItem>
                {LANGUAGES.map((l) => (
                  <SelectItem
                    key={l.code}
                    value={l.code}
                    className="rounded-xl pr-8 focus:bg-violet-500/20 focus:text-white"
                  >
                    <span className="flex flex-col items-start leading-tight">
                      <span className="text-sm font-medium">{l.native}</span>
                      <span className="text-xs text-zinc-500">{l.english}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <button
              type="button"
              onClick={swap}
              disabled={from === AUTO}
              title={from === AUTO ? 'Pick a source language to swap' : 'Swap languages'}
              aria-label="Swap languages"
              className={cn(
                'flex size-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white',
                from === AUTO && 'cursor-not-allowed opacity-40',
              )}
            >
              <motion.span
                animate={{ rotate: swapCount * 180 }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                className="flex"
              >
                <Languages className="size-4.5" aria-hidden />
              </motion.span>
            </button>

            <Select value={to} onValueChange={setTo}>
              <SelectTrigger
                aria-label="Target language"
                className="h-11 min-w-0 flex-1 rounded-xl border-white/10 bg-white/[0.04] text-sm text-zinc-100 shadow-none hover:bg-white/[0.07] focus:ring-violet-400/40 data-[placeholder]:text-zinc-400 [&>span]:truncate"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-2xl border-white/10 bg-zinc-900 text-zinc-100">
                {LANGUAGES.map((l) => (
                  <SelectItem
                    key={l.code}
                    value={l.code}
                    disabled={l.code === from}
                    className="rounded-xl pr-8 focus:bg-violet-500/20 focus:text-white"
                  >
                    <span className="flex flex-col items-start leading-tight">
                      <span className="text-sm font-medium">{l.native}</span>
                      <span className="text-xs text-zinc-500">{l.english}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* ---------------- Source ---------------- */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition-colors focus-within:border-violet-400/40">
            <textarea
              ref={taRef}
              value={text}
              maxLength={MAX_CHARS}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type or paste text to translate…"
              rows={3}
              spellCheck={false}
              className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-zinc-100 outline-none placeholder:text-zinc-500"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[11px] text-zinc-500">
                {from === AUTO ? 'Source language detected automatically' : sourceSelectLabel}
              </span>
              <span className="flex items-center gap-2">
                {text.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setText('')
                      setError(null)
                      buzz()
                      taRef.current?.focus()
                    }}
                    aria-label="Clear text"
                    className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
                <span
                  className={cn(
                    'font-mono text-[11px] tabular-nums',
                    text.length >= MAX_CHARS
                      ? 'text-rose-400'
                      : nearLimit
                        ? 'text-amber-400'
                        : 'text-zinc-500',
                  )}
                >
                  {text.length} / {MAX_CHARS}
                </span>
              </span>
            </div>
          </div>

          {/* ---------------- Translate button ---------------- */}
          <Button
            onClick={translate}
            disabled={!canTranslate}
            className="h-12 w-full rounded-2xl bg-gradient-to-r from-violet-400 via-purple-500 to-fuchsia-600 text-[15px] font-semibold text-white shadow-[0_12px_30px_-10px_rgb(168_85_247/0.7)] transition-opacity hover:opacity-90 hover:shadow-[0_12px_30px_-10px_rgb(168_85_247/0.7)] disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="size-4.5 animate-spin" aria-hidden /> Translating…
              </>
            ) : (
              <>
                <Languages className="size-4.5" aria-hidden /> Translate
              </>
            )}
          </Button>

          {/* ---------------- Output ---------------- */}
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-violet-500/[0.07] to-fuchsia-500/[0.04]">
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-2.5">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Sparkles className="size-3.5 text-violet-400" aria-hidden />
                Translation
              </span>
              <span className="rounded-full border border-violet-400/20 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-300">
                {langName(to)}
              </span>
            </div>

            {loading ? (
              <div className="space-y-2.5 px-4 py-4">
                {[92, 78, 60].map((w, i) => (
                  <div
                    key={i}
                    style={{ width: `${w}%` }}
                    className="h-4 animate-pulse rounded-full bg-violet-400/15"
                  />
                ))}
              </div>
            ) : error ? (
              <div className="px-4 py-4">
                <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 size-4.5 shrink-0 text-rose-400" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-rose-200">Translation failed</p>
                      <p className="mt-0.5 break-words text-xs leading-relaxed text-rose-300/80">
                        {error}
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={translate}
                    className="mt-3 h-10 w-full rounded-xl border border-white/10 bg-white/10 text-sm font-semibold text-zinc-100 shadow-none hover:bg-white/15"
                  >
                    <RotateCcw className="size-4" aria-hidden /> Retry
                  </Button>
                </div>
                <p className="mt-2 text-center text-[11px] text-zinc-500">
                  Your text is safe — nothing was lost.
                </p>
              </div>
            ) : output ? (
              <div className="px-4 py-4">
                <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-zinc-100">
                  {output}
                </p>
                <div className="mt-3 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={speak}
                    aria-label={speaking ? 'Stop reading aloud' : 'Read translation aloud'}
                    className={cn(
                      'flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white',
                      speaking && 'border-violet-400/40 bg-violet-500/15 text-violet-300',
                    )}
                  >
                    {speaking ? (
                      <Square className="size-4" aria-hidden />
                    ) : (
                      <Volume2 className="size-4" aria-hidden />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={shareOutput}
                    aria-label="Share translation"
                    className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <Share2 className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={copyOutput}
                    aria-label="Copy translation"
                    className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    {copiedKey === 'main' ? (
                      <Check className="size-4 text-emerald-400" aria-hidden />
                    ) : (
                      <Copy className="size-4" aria-hidden />
                    )}
                  </button>
                  <span className="ml-auto text-[11px] text-zinc-500">
                    {from === AUTO ? 'auto' : langName(from)} → {langName(to)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <span className="flex size-11 items-center justify-center rounded-full border border-violet-400/20 bg-violet-500/10">
                  <Languages className="size-5 text-violet-400" aria-hidden />
                </span>
                <p className="text-sm font-medium text-zinc-300">Your translation will appear here</p>
                <p className="max-w-[16rem] text-xs leading-relaxed text-zinc-500">
                  Type something above, pick a language, and tap Translate.
                </p>
              </div>
            )}
          </div>

          {/* ---------------- History ---------------- */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
            <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
              <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <History className="size-3.5 text-violet-400" aria-hidden />
                History
                {history.length > 0 && (
                  <span className="rounded-full bg-white/10 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-400">
                    {history.length}
                  </span>
                )}
              </span>
              {history.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors',
                    confirmClear
                      ? 'bg-rose-500/15 text-rose-300'
                      : 'text-zinc-500 hover:bg-white/10 hover:text-zinc-200',
                  )}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  {confirmClear ? 'Tap again to clear' : 'Clear all'}
                </button>
              )}
            </div>

            {!loaded ? (
              <div className="space-y-2 p-4">
                {[0, 1].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.05]" />
                ))}
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                <span className="flex size-11 items-center justify-center rounded-full border border-violet-400/20 bg-violet-500/10">
                  <Sparkles className="size-5 text-violet-400" aria-hidden />
                </span>
                <p className="text-sm font-medium text-zinc-300">No translations yet</p>
                <p className="max-w-[17rem] text-xs leading-relaxed text-zinc-500">
                  Your last 20 translations stay here on this device — tap one to bring it back.
                </p>
              </div>
            ) : (
              <ul className="max-h-[24rem] space-y-2 overflow-y-auto p-3">
                <AnimatePresence initial={false}>
                  {history.map((item) => {
                    const key = historyKey(item)
                    return (
                      <motion.li
                        key={key}
                        layout
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => restore(item)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              restore(item)
                            }
                          }}
                          className="group w-full cursor-pointer rounded-xl border border-white/5 bg-white/[0.03] p-3 text-left transition-colors hover:border-violet-400/30 hover:bg-violet-500/[0.06]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
                              {langName(item.from)} → {langName(item.to)}
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="text-[10px] text-zinc-500">{timeLabel(item.at)}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  void copyHistoryItem(item, key)
                                }}
                                aria-label="Copy this translation"
                                className="flex size-7 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                {copiedKey === key ? (
                                  <Check className="size-3.5 text-emerald-400" aria-hidden />
                                ) : (
                                  <Copy className="size-3.5" aria-hidden />
                                )}
                              </button>
                            </span>
                          </div>
                          <p className="mt-1.5 truncate text-xs text-zinc-400">{item.source}</p>
                          <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-zinc-100">
                            {item.translated}
                          </p>
                        </div>
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  )
}
