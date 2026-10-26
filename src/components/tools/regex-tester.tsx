'use client'

/**
 * Regex Tester — build a pattern, see it live.
 *
 * Type a regex body (delimiter slashes are added for you), toggle flags,
 * and watch every match light up in a read-only highlighted view with
 * alternating amber/rose tints. Inspect capture groups in the match table,
 * replace with $1 / $& / $<name> semantics, and pull up a grouped cheat
 * sheet whenever syntax slips the mind. Pattern, flags, test string and
 * replacement all persist in localStorage — private, offline, instant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookMarked,
  Copy,
  Regex,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Flags                                                               */
/* ================================================================== */

const FLAG_ORDER = ['g', 'i', 'm', 's', 'u', 'y'] as const

type RegexFlag = (typeof FLAG_ORDER)[number]

const FLAG_LABELS: Record<RegexFlag, string> = {
  g: 'Global — highlight every match',
  i: 'Ignore case',
  m: 'Multiline — ^ and $ match line edges',
  s: 'Dotall — dot matches newlines',
  u: 'Unicode-aware matching',
  y: 'Sticky — match only at lastIndex',
}

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

/** Thin glass scrollbar for long lists. */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

const STORAGE_KEYS = {
  pattern: 'toolhub-regex-pattern',
  flags: 'toolhub-regex-flags',
  test: 'toolhub-regex-test',
  replacement: 'toolhub-regex-replacement',
} as const

/** Upper bound of collected matches — keeps pathological patterns safe. */
const MAX_MATCHES = 1000

/** Above this size live highlighting is skipped (still matches/replace). */
const MAX_HIGHLIGHT_CHARS = 200 * 1024

/** Replacement syntax hint rendered as a string (keep < > out of JSX). */
const REPLACE_HINT = '$1 · $& · $<name>'

const SAMPLE = {
  pattern: '\\b[\\w.]+@[\\w-]+\\.[\\w.]{2,}\\b',
  replacement: '[redacted]',
  test: [
    'Hi team,',
    '',
    'Access requests go to ada.lovelace@example.com, and billing questions to finance@toolhub-app.io.',
    'For anything press related, write to press@dev-tools.co — we usually reply within a day.',
    '',
    'Thanks,',
    'Ada',
  ].join('\n'),
}

/* ================================================================== */
/* Cheat sheet reference                                               */
/* ================================================================== */

interface CheatItem {
  token: string
  desc: string
}

interface CheatGroup {
  title: string
  items: CheatItem[]
}

const CHEAT_SHEET: CheatGroup[] = [
  {
    title: 'Anchors',
    items: [
      { token: '^', desc: 'Start of string (or of a line with the m flag)' },
      { token: '$', desc: 'End of string (or of a line with the m flag)' },
      { token: '\\b', desc: 'Word boundary' },
      { token: '\\B', desc: 'Not a word boundary' },
    ],
  },
  {
    title: 'Character classes',
    items: [
      { token: '\\d', desc: 'A digit 0-9' },
      { token: '\\w', desc: 'Word character — A-Z, a-z, 0-9, underscore' },
      { token: '\\s', desc: 'Whitespace — space, tab, newline' },
      { token: '.', desc: 'Any character except newline' },
      { token: '[abc]', desc: 'Any one of a, b or c' },
      { token: '[^abc]', desc: 'Any character except a, b or c' },
      { token: '[a-z]', desc: 'Any character in the range a through z' },
    ],
  },
  {
    title: 'Quantifiers',
    items: [
      { token: '*', desc: 'Zero or more times (greedy)' },
      { token: '+', desc: 'One or more times (greedy)' },
      { token: '?', desc: 'Zero or one time (greedy)' },
      { token: '{n}', desc: 'Exactly n times' },
      { token: '{n,}', desc: 'n or more times' },
      { token: '{n,m}', desc: 'Between n and m times' },
      { token: '*? +? ??', desc: 'Lazy — match as few characters as possible' },
    ],
  },
  {
    title: 'Groups & references',
    items: [
      { token: '(…)', desc: 'Capturing group' },
      { token: '(?:…)', desc: 'Non-capturing group' },
      { token: '(?<name>…)', desc: 'Named capturing group' },
      { token: '\\1', desc: 'Backreference to group 1 inside the pattern' },
      { token: '$1', desc: 'Group 1 in the replacement string' },
    ],
  },
  {
    title: 'Lookaround',
    items: [
      { token: '(?=…)', desc: 'Positive lookahead' },
      { token: '(?!…)', desc: 'Negative lookahead' },
      { token: '(?<=…)', desc: 'Positive lookbehind' },
      { token: '(?<!…)', desc: 'Negative lookbehind' },
    ],
  },
  {
    title: 'Flags',
    items: [
      { token: 'g', desc: 'Global — find all matches, not just the first' },
      { token: 'i', desc: 'Case-insensitive matching' },
      { token: 'm', desc: 'Multiline — ^ and $ match line edges' },
      { token: 's', desc: 'Dotall — dot matches newline too' },
      { token: 'u', desc: 'Unicode-aware matching' },
      { token: 'y', desc: 'Sticky — match only at the last index' },
    ],
  },
]

/* ================================================================== */
/* Model + helpers                                                     */
/* ================================================================== */

interface RegexMatch {
  /** character offset of the match inside the test string */
  index: number
  /** full matched text */
  match: string
  /** participating numbered capture groups (undefined ones skipped) */
  groups: string[]
  /** participating named groups, in definition order */
  named: [string, string][]
}

interface HighlightSegment {
  text: string
  /** index into matches[] when this segment is a match, else null */
  matchIndex: number | null
}

interface Compiled {
  regex: RegExp | null
  error: string | null
}

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

/** Groups column text — numbered captures plus name:value named groups. */
function groupsLabel(m: RegexMatch): string {
  const parts = [...m.groups]
  for (const [name, value] of m.named) parts.push(`${name}:${value}`)
  return parts.length > 0 ? parts.join(', ') : '—'
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function RegexTesterApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [test, setTest] = useState('')
  const [replacement, setReplacement] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [cheatOpen, setCheatOpen] = useState(false)
  const [pulsedIndex, setPulsedIndex] = useState<number | null>(null)

  const paneRef = useRef<HTMLDivElement | null>(null)
  const pulseTimer = useRef<number | null>(null)

  /* ---------------- hydration from localStorage ---------------- */
  useEffect(() => {
    const restore = () => {
      try {
        const savedPattern = localStorage.getItem(STORAGE_KEYS.pattern)
        if (savedPattern !== null) setPattern(savedPattern)

        const savedFlags = localStorage.getItem(STORAGE_KEYS.flags)
        if (savedFlags !== null) {
          const chars = savedFlags.split('')
          setFlags(FLAG_ORDER.filter((f) => chars.includes(f)).join(''))
        }

        const savedTest = localStorage.getItem(STORAGE_KEYS.test)
        if (savedTest !== null) setTest(savedTest)

        const savedReplacement = localStorage.getItem(STORAGE_KEYS.replacement)
        if (savedReplacement !== null) setReplacement(savedReplacement)
      } catch {
        /* storage unavailable — start fresh */
      }
      setHydrated(true)
    }
    const t = setTimeout(restore, 0)
    return () => clearTimeout(t)
  }, [])

  /* ---------------- write-through persistence ---------------- */
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEYS.pattern, pattern)
      localStorage.setItem(STORAGE_KEYS.flags, flags)
      localStorage.setItem(STORAGE_KEYS.test, test)
      localStorage.setItem(STORAGE_KEYS.replacement, replacement)
    } catch {
      /* private mode / quota — memory only */
    }
  }, [hydrated, pattern, flags, test, replacement])

  /* ---------------- timers ---------------- */
  useEffect(() => {
    return () => {
      if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current)
    }
  }, [])

  /* stale pulse when the input changes — adjust during render (react.dev pattern) */
  const [pulseKey, setPulseKey] = useState('')
  const inputKey = `${pattern}\u241F${flags}\u241F${test}`
  if (pulseKey !== inputKey) {
    setPulseKey(inputKey)
    if (pulsedIndex !== null) setPulsedIndex(null)
  }

  /* ---------------- compiled regex ---------------- */
  const compiled = useMemo<Compiled>(() => {
    if (!pattern) return { regex: null, error: null }
    try {
      return { regex: new RegExp(pattern, flags), error: null }
    } catch (e) {
      return { regex: null, error: e instanceof Error ? e.message : 'Invalid regular expression' }
    }
  }, [pattern, flags])

  /* ---------------- matches ---------------- */
  const matches = useMemo<RegexMatch[]>(() => {
    if (!compiled.regex || !test) return []
    // fresh copy so mutating lastIndex is safe (the memoized one stays frozen)
    const re = new RegExp(compiled.regex.source, compiled.regex.flags)
    const out: RegexMatch[] = []
    re.lastIndex = 0
    while (out.length < MAX_MATCHES) {
      const m = re.exec(test)
      if (!m) break
      const groups: string[] = []
      for (let i = 1; i < m.length; i++) {
        const g = m[i]
        if (g !== undefined) groups.push(g)
      }
      const named: [string, string][] = []
      if (m.groups) {
        for (const name of Object.keys(m.groups)) {
          const value = m.groups[name]
          if (value !== undefined) named.push([name, value])
        }
      }
      out.push({ index: m.index, match: m[0], groups, named })
      if (!re.global) break
      if (m[0] === '') {
        // zero-width match — advance manually to avoid an infinite loop
        re.lastIndex += 1
        if (re.lastIndex > test.length) break
      }
    }
    return out
  }, [compiled, test])

  /* ---------------- highlighting ---------------- */
  const oversized = test.length > MAX_HIGHLIGHT_CHARS

  const segments = useMemo<HighlightSegment[]>(() => {
    if (oversized || matches.length === 0) return []
    const out: HighlightSegment[] = []
    let cursor = 0
    matches.forEach((m, i) => {
      if (m.index < cursor) return // overlap safety
      if (m.index > cursor) out.push({ text: test.slice(cursor, m.index), matchIndex: null })
      out.push({ text: test.slice(m.index, m.index + m.match.length), matchIndex: i })
      cursor = m.index + m.match.length
    })
    if (cursor < test.length) out.push({ text: test.slice(cursor), matchIndex: null })
    return out
  }, [matches, oversized, test])

  /* ---------------- replace preview ---------------- */
  const replaceResult = useMemo<string | null>(() => {
    const re = compiled.regex
    if (!re) return null
    try {
      return test.replace(re, replacement)
    } catch {
      return null
    }
  }, [compiled, replacement, test])

  const matchCountLabel = matches.length >= MAX_MATCHES ? `${MAX_MATCHES}+` : String(matches.length)

  /* ---------------- actions ---------------- */
  const toggleFlag = useCallback((f: RegexFlag) => {
    setFlags((prev) => {
      const raw = prev.includes(f) ? prev.replace(f, '') : prev + f
      return FLAG_ORDER.filter((x) => raw.includes(x)).join('')
    })
    haptic()
  }, [])

  const loadSample = useCallback(() => {
    setPattern(SAMPLE.pattern)
    setFlags('g')
    setTest(SAMPLE.test)
    setReplacement(SAMPLE.replacement)
    haptic()
    toast({ title: 'Sample loaded', description: 'Email finder — 3 addresses waiting to be matched.' })
  }, [toast])

  const focusMatch = useCallback((i: number) => {
    const pane = paneRef.current
    if (!pane) return
    const el = pane.querySelector<HTMLElement>(`[data-match-index="${i}"]`)
    if (!el) return
    const target = el.offsetTop - pane.clientHeight / 2 + el.offsetHeight / 2
    pane.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
    if (pulseTimer.current !== null) window.clearTimeout(pulseTimer.current)
    setPulsedIndex(i)
    pulseTimer.current = window.setTimeout(() => {
      setPulsedIndex(null)
      pulseTimer.current = null
    }, 1300)
    haptic()
  }, [])

  const copyResult = useCallback(async () => {
    if (replaceResult === null) return
    try {
      await navigator.clipboard.writeText(replaceResult)
      haptic()
      toast({ title: 'Result copied', description: `${replaceResult.length} characters on the clipboard.` })
    } catch {
      toast({ title: 'Copy failed', description: 'The clipboard is not available right now.', variant: 'destructive' })
    }
  }, [replaceResult, toast])

  /* ---------------- render ---------------- */
  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-sky-500/[0.12] via-transparent to-indigo-500/[0.08] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-sky-400 via-blue-500 to-indigo-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(56_189_248/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Regex className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Regex Tester</h2>
              <p className="text-xs text-zinc-400">Live matches, groups and replace — all on this device.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={loadSample}
              className="h-11 flex-1 rounded-xl bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-600 font-semibold text-white shadow-lg hover:from-sky-300 hover:via-blue-400 hover:to-indigo-500 sm:flex-none"
            >
              <Sparkles className="size-4" aria-hidden /> Load sample
            </Button>
            <Button
              onClick={() => setCheatOpen(true)}
              variant="outline"
              className="h-11 flex-1 rounded-xl border-white/10 bg-white/5 font-semibold text-zinc-200 hover:bg-white/10 hover:text-white sm:flex-none"
            >
              <BookMarked className="size-4" aria-hidden /> Cheat sheet
            </Button>
          </div>
        </div>

        <div className="space-y-6 px-4 py-5 sm:px-5">
          {/* ---------------- Pattern ---------------- */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Pattern</span>
              <span className="font-mono text-[10px] text-zinc-600">/{flags}</span>
            </div>

            <div className="flex items-center rounded-xl border border-white/10 bg-white/5 transition-colors focus-within:border-sky-400/60">
              <span aria-hidden className="select-none pl-3.5 font-mono text-sm text-zinc-500">/</span>
              <Input
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                placeholder="\b[\w.]+@[\w-]+\.[\w.]{2,}\b"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                inputMode="text"
                aria-label="Regular expression pattern"
                className="h-11 min-w-0 flex-1 border-0 bg-transparent px-1.5 font-mono text-sm shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-sm"
              />
              <span aria-hidden className="select-none pr-3.5 font-mono text-sm text-zinc-500">/</span>
            </div>

            <div className="flex flex-wrap gap-2" role="group" aria-label="Regular expression flags">
              {FLAG_ORDER.map((f) => {
                const active = flags.includes(f)
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleFlag(f)}
                    aria-pressed={active}
                    title={FLAG_LABELS[f]}
                    className={cn(
                      'h-11 min-w-11 rounded-xl border px-3 font-mono text-sm font-bold transition-colors',
                      active
                        ? 'border-sky-400/60 bg-sky-400/15 text-sky-300 shadow-[0_0_16px_-6px_rgb(56_189_248/0.6)]'
                        : 'border-white/10 bg-white/5 text-zinc-500 hover:bg-white/10 hover:text-zinc-300'
                    )}
                  >
                    {f}
                  </button>
                )
              })}
            </div>

            <AnimatePresence initial={false}>
              {compiled.error && (
                <motion.div
                  key="pattern-error"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-rose-300">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words font-mono text-xs leading-relaxed">{compiled.error}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <p className="text-[11px] text-zinc-600">Delimiters are added for you — type only the expression body.</p>
          </section>

          {/* ---------------- Test string ---------------- */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Test string</span>
              <span className="font-mono text-[10px] text-zinc-600">{test.length.toLocaleString()} chars</span>
            </div>

            <Textarea
              value={test}
              onChange={(e) => setTest(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder="Paste the text you want to run the pattern against…"
              aria-label="Test string"
              className="min-h-44 w-full resize-y rounded-xl border-white/10 bg-white/5 p-3.5 font-mono text-[13px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus:border-sky-400/50 focus-visible:border-sky-400/50 focus-visible:ring-0"
            />

            {oversized ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-amber-200">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="text-xs leading-relaxed">
                  Test string exceeds 200 KB — live highlighting is skipped to keep things fast. Matching and replace
                  still run on the full text.
                </span>
              </div>
            ) : (
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                    Highlighted view
                  </span>
                  {!flags.includes('g') && compiled.regex && (
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
                      first match only
                    </span>
                  )}
                </div>
                <div
                  ref={paneRef}
                  aria-readonly
                  className={cn(
                    'relative max-h-72 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[13px] leading-relaxed text-zinc-300',
                    THIN_SCROLLBAR
                  )}
                >
                  <div className="whitespace-pre-wrap break-words">
                    {segments.length > 0 ? (
                      segments.map((seg, i) =>
                        seg.matchIndex === null ? (
                          <span key={i}>{seg.text}</span>
                        ) : (
                          <span
                            key={i}
                            data-match-index={seg.matchIndex}
                            className={cn(
                              'rounded transition-shadow duration-200',
                              seg.matchIndex % 2 === 0
                                ? 'bg-amber-400/25 text-amber-100 ring-1 ring-inset ring-amber-300/40'
                                : 'bg-rose-400/25 text-rose-100 ring-1 ring-inset ring-rose-300/40',
                              pulsedIndex === seg.matchIndex &&
                                'bg-white/25 text-white ring-2 ring-white/90 animate-pulse'
                            )}
                          >
                            {seg.text}
                          </span>
                        )
                      )
                    ) : test ? (
                      <span>{test}</span>
                    ) : (
                      <span className="text-zinc-600">Highlighted view appears here…</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* ---------------- Matches ---------------- */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Matches</span>
              <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs font-semibold text-sky-300">
                {matchCountLabel}
              </span>
            </div>

            {matches.length > 0 ? (
              <div
                className={cn(
                  'max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02] pr-1',
                  THIN_SCROLLBAR
                )}
              >
                <div className="sticky top-0 z-10 grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1.5fr)] items-center gap-2 border-b border-white/10 bg-zinc-900/95 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 backdrop-blur">
                  <span>Index</span>
                  <span>Match</span>
                  <span>Groups</span>
                </div>
                {matches.map((m, i) => (
                  <button
                    key={`${m.index}-${i}`}
                    type="button"
                    onClick={() => focusMatch(i)}
                    title={`Jump to match at character ${m.index}`}
                    className="grid min-h-11 w-full grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1.5fr)] items-center gap-2 border-b border-white/5 px-3 py-2 text-left text-xs transition-colors last:border-0 hover:bg-white/5"
                  >
                    <span className="font-mono text-sky-300">{m.index}</span>
                    <span className="truncate font-mono text-zinc-100" title={m.match}>
                      {m.match === '' ? <span className="italic text-zinc-500">(empty)</span> : m.match}
                    </span>
                    <span className="truncate font-mono text-zinc-400" title={groupsLabel(m)}>
                      {groupsLabel(m)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-500">
                {compiled.error
                  ? 'Fix the pattern above to see matches.'
                  : test
                    ? 'No matches in the test string.'
                    : 'Add a pattern and a test string to see matches.'}
              </div>
            )}
          </section>

          {/* ---------------- Replace ---------------- */}
          <section className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Replace</span>
              <span className="font-mono text-[10px] text-zinc-600">{REPLACE_HINT}</span>
            </div>

            <Input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="[redacted]"
              spellCheck={false}
              aria-label="Replacement string"
              className="h-11 rounded-xl border-white/10 bg-white/5 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 [color-scheme:dark] focus-visible:border-sky-400/50"
            />

            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-600">Result</span>
              <Button
                onClick={() => void copyResult()}
                disabled={replaceResult === null}
                variant="outline"
                className="h-11 rounded-xl border-white/10 bg-white/5 px-4 text-xs font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
              >
                <Copy className="size-3.5" aria-hidden /> Copy result
              </Button>
            </div>

            <div
              className={cn(
                'max-h-60 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-3',
                THIN_SCROLLBAR
              )}
            >
              {replaceResult !== null ? (
                <span className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-emerald-200/90">
                  {replaceResult === '' ? '(empty result)' : replaceResult}
                </span>
              ) : (
                <span className="font-mono text-xs text-zinc-600">Live replace preview appears here.</span>
              )}
            </div>
          </section>
        </div>
      </motion.div>

      {/* ---------------- Cheat sheet drawer ---------------- */}
      <Sheet open={cheatOpen} onOpenChange={setCheatOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[70vh] rounded-t-3xl border-white/10 bg-zinc-950 text-zinc-100"
        >
          <SheetHeader className="border-b border-white/5 pb-3 pr-10">
            <SheetTitle className="flex items-center gap-2 text-base font-bold">
              <BookMarked className="size-4 text-sky-400" aria-hidden /> Regex cheat sheet
            </SheetTitle>
            <SheetDescription className="text-xs text-zinc-500">
              Quick reference for the most common regex syntax.
            </SheetDescription>
          </SheetHeader>
          <div className={cn('min-h-0 flex-1 overflow-y-auto px-4 pb-6', THIN_SCROLLBAR)}>
            <div className="space-y-5">
              {CHEAT_SHEET.map((group) => (
                <div key={group.title}>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-sky-400/90">
                    {group.title}
                  </h3>
                  <div className="grid gap-1.5 md:grid-cols-2">
                    {group.items.map((item) => (
                      <div
                        key={item.token}
                        className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-2.5 py-2"
                      >
                        <code className="shrink-0 rounded-lg bg-sky-500/10 px-2 py-1 font-mono text-xs font-semibold text-sky-300 ring-1 ring-inset ring-sky-400/20">
                          {item.token}
                        </code>
                        <span className="min-w-0 text-xs leading-snug text-zinc-400">{item.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
