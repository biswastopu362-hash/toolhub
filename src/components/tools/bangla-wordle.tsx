'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Delete, RotateCcw, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { getGameStat, recordGameResult, unlockAchievement } from '@/lib/games/scores'

/* ================================================================== */
/* Bangla Wordle — guess the 5-character Bengali word in 6 tries.      */
/* Tiles are Unicode code points (letters + vowel signs), classic      */
/* green/yellow/gray feedback, daily-random word, shareable emoji      */
/* grid via Web Share (clipboard fallback).                            */
/* ================================================================== */

const WORD_LEN = 5
const MAX_TRIES = 6

/** Curated 5-code-point Bengali words (no conjuncts — every mark is one tile). */
const ANSWERS = [
  'মালিক', 'কবিতা', 'পতাকা', 'সরিষা', 'বিরাট', 'কুমার', 'কুলফি', 'ঝুমকা',
  'ঠাকুর', 'পুকুর', 'গোলাপ', 'মানুষ', 'পাহাড়', 'তুলসী', 'মিনার', 'পানীয়',
  'খাওয়া', 'যাওয়া', 'গাওয়া', 'পাওয়া', 'দেওয়া', 'নেওয়া', 'সেওয়া',
  'হাঁটা', 'গাঁথা', 'সাঁটা', 'বাঁধা', 'ঝাঁঝা', 'বাঁকা', 'কাঁদা', 'কাঁচা',
  'কাঁটা', 'পাঁজর', 'সাঁকো', 'খোঁজা', 'খোঁচা', 'খোঁড়া', 'পায়রা', 'বায়না',
  'পোশাক', 'খোরাক', 'নোংরা', 'ঢোলাই', 'ভাইয়া', 'রোশনি', 'পাগলা',
]

type Feedback = 'correct' | 'present' | 'absent'

interface GuessRow {
  chars: string[]
  feedback: Feedback[] | null
}

/* Bengali on-screen keyboard — vowels, consonants, signs (10 per row) */
const KB_ROWS = [
  ['অ', 'আ', 'ই', 'ঈ', 'উ', 'ঊ', 'এ', 'ঐ', 'ও', 'ঔ'],
  ['ক', 'খ', 'গ', 'ঘ', 'ঙ', 'চ', 'ছ', 'জ', 'ঝ', 'ঞ'],
  ['ট', 'ঠ', 'ড', 'ঢ', 'ণ', 'ত', 'থ', 'দ', 'ধ', 'ন'],
  ['প', 'ফ', 'ব', 'ভ', 'ম', 'য', 'র', 'ল', 'শ', 'ষ'],
  ['স', 'হ', 'ড়', 'ঢ়', 'য়', 'ৎ', 'ং', 'ঁ', 'ঃ', 'া'],
  ['ি', 'ী', 'ু', 'ূ', 'ৃ', 'ে', 'ৈ', 'ো', 'ৌ', '্'],
]

function splitWord(word: string): string[] {
  return Array.from(word)
}

function pickAnswer(): string[] {
  const word = ANSWERS[Math.floor(Math.random() * ANSWERS.length)]
  return splitWord(word)
}

function scoreGuess(guess: string[], answer: string[]): Feedback[] {
  const res: Feedback[] = new Array(WORD_LEN).fill('absent')
  const used = new Array(WORD_LEN).fill(false)
  for (let i = 0; i < WORD_LEN; i++) {
    if (guess[i] === answer[i]) {
      res[i] = 'correct'
      used[i] = true
    }
  }
  for (let i = 0; i < WORD_LEN; i++) {
    if (res[i] === 'correct') continue
    for (let j = 0; j < WORD_LEN; j++) {
      if (!used[j] && guess[i] === answer[j]) {
        res[i] = 'present'
        used[j] = true
        break
      }
    }
  }
  return res
}

const TILE_STYLE: Record<Feedback, string> = {
  correct: 'bg-emerald-500 text-white border-emerald-500',
  present: 'bg-amber-500 text-white border-amber-500',
  absent: 'bg-zinc-400/70 text-zinc-100 border-zinc-400/70 dark:bg-zinc-700 dark:text-zinc-300',
}

const EMOJI: Record<Feedback, string> = {
  correct: '🟩',
  present: '🟨',
  absent: '⬛',
}

const STREAK_KEY = 'toolhub.wordle.streak'

export default function BanglaWordleApp() {
  const [answer, setAnswer] = useState<string[]>(() => pickAnswer())
  const [rows, setRows] = useState<GuessRow[]>([])
  const [current, setCurrent] = useState<string[]>([])
  const [status, setStatus] = useState<'playing' | 'won' | 'lost'>('playing')
  const [shake, setShake] = useState(false)
  const [keyHints, setKeyHints] = useState<Record<string, Feedback>>({})
  const [best, setBest] = useState(() =>
    typeof window === 'undefined' ? 0 : getGameStat('bangla-wordle').best
  )
  const [streak, setStreak] = useState(() => {
    if (typeof window === 'undefined') return 0
    try {
      return Number(localStorage.getItem(STREAK_KEY)) || 0
    } catch {
      return 0
    }
  })
  const toast = useToast()
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const newGame = useCallback(() => {
    setAnswer(pickAnswer())
    setRows([])
    setCurrent([])
    setStatus('playing')
    setShake(false)
  }, [])

  /* merge keyboard hint colors (correct > present > absent) */
  const mergeHint = (prev: Feedback | undefined, next: Feedback): Feedback => {
    if (prev === 'correct') return 'correct'
    if (prev === 'present' && next === 'absent') return 'present'
    return next
  }

  const submit = useCallback(() => {
    if (status !== 'playing') return
    if (current.length < WORD_LEN) {
      setShake(true)
      setTimeout(() => setShake(false), 500)
      return
    }
    const feedback = scoreGuess(current, answer)
    const nextRows = [...rows, { chars: current, feedback }]
    setRows(nextRows)
    setKeyHints((prev) => {
      const next = { ...prev }
      current.forEach((ch, i) => {
        next[ch] = mergeHint(next[ch], feedback[i])
      })
      return next
    })
    setCurrent([])

    const win = feedback.every((f) => f === 'correct')
    if (win) {
      const triesUsed = nextRows.length
      setStatus('won')
      const score = (MAX_TRIES + 1 - triesUsed) * 10
      const res = recordGameResult('bangla-wordle', { value: score, won: true })
      setBest(res.stat.best)
      const nextStreak = streak + 1
      setStreak(nextStreak)
      try {
        localStorage.setItem(STREAK_KEY, String(nextStreak))
      } catch {
        /* ignore */
      }
      unlockAchievement('wordle-first-win')
      if (triesUsed <= 3) unlockAchievement('wordle-under4')
      if (triesUsed === 1) unlockAchievement('wordle-lucky')
      if (nextStreak >= 5) unlockAchievement('wordle-streak5')
      if (navigator.vibrate) navigator.vibrate([15, 30, 15])
    } else if (nextRows.length >= MAX_TRIES) {
      setStatus('lost')
      setStreak(0)
      try {
        localStorage.setItem(STREAK_KEY, '0')
      } catch {
        /* ignore */
      }
      recordGameResult('bangla-wordle', { won: false })
    }
  }, [status, current, answer, rows, streak])

  const typeChar = useCallback(
    (ch: string) => {
      if (status !== 'playing') return
      setCurrent((prev) => (prev.length < WORD_LEN ? [...prev, ch] : prev))
    },
    [status]
  )

  const backspace = useCallback(() => {
    if (status !== 'playing') return
    setCurrent((prev) => prev.slice(0, -1))
  }, [status])

  /* Physical keyboard: transliteration is not required — Enter submits, Backspace deletes */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        backspace()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submit, backspace])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rows.length])

  const shareResult = useCallback(async () => {
    const grid = rows
      .map((r) => (r.feedback ?? []).map((f) => EMOJI[f]).join(''))
      .join('\n')
    const tries = rows.length
    const text = `Bangla Wordle — ${status === 'won' ? `${tries}/${MAX_TRIES}` : `X/${MAX_TRIES}`}\n${grid}\nvia ToolHub`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Bangla Wordle', text })
      } else {
        await navigator.clipboard.writeText(text)
        toast.toast({ title: 'Result copied', description: 'Paste it anywhere to flex your win.' })
      }
    } catch {
      /* user cancelled share */
    }
  }, [rows, status, toast])

  const emptyRows = useMemo(() => {
    const done = rows.length
    const remaining = MAX_TRIES - done - (status === 'playing' ? 1 : 0)
    return remaining
  }, [rows.length, status])

  const renderTile = (ch: string | undefined, fb: Feedback | null, idx: number, rowKey: string) => (
    <motion.div
      key={`${rowKey}-${idx}`}
      initial={fb ? { scale: 0.85 } : false}
      animate={fb ? { scale: 1 } : shake && idx === current.length ? { x: [0, -6, 6, -4, 4, 0] } : {}}
      transition={{ duration: 0.25, delay: fb ? idx * 0.12 : 0 }}
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-lg border-2 text-xl font-bold sm:h-14 sm:w-14 sm:text-2xl',
        fb
          ? TILE_STYLE[fb]
          : ch
            ? 'border-foreground/50 bg-background'
            : 'border-border/70 bg-muted/30'
      )}
      style={fb ? { transitionDelay: `${idx * 60}ms` } : undefined}
    >
      {ch ?? ''}
    </motion.div>
  )

  return (
    <Card className="overflow-hidden shadow-md">
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
              Bangla Wordle
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              পাঁচ অক্ষরের শব্দটি অনুমান করুন — guess the Bengali word
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="min-w-[58px] rounded-xl bg-muted px-2.5 py-1.5 text-center ring-1 ring-border/60">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Try</div>
              <div className="text-base font-bold tabular-nums text-foreground">
                {rows.length + (status === 'playing' ? 1 : 0)}/{MAX_TRIES}
              </div>
            </div>
            <div className="min-w-[58px] rounded-xl bg-muted px-2.5 py-1.5 text-center ring-1 ring-border/60">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Streak</div>
              <div className="text-base font-bold tabular-nums text-foreground">{streak}🔥</div>
            </div>
          </div>
        </div>

        {/* Board */}
        <div
          ref={scrollRef}
          className="mx-auto flex max-h-[340px] w-full max-w-[min(94vw,400px)] flex-col items-center gap-1.5 overflow-y-auto rounded-2xl bg-muted/20 p-2 ring-1 ring-border/60"
          role="log"
          aria-label="Wordle board"
        >
          {rows.map((row, r) => (
            <div key={r} className="flex gap-1.5" role="row" aria-label={`Guess ${r + 1}`}>
              {row.chars.map((ch, i) => renderTile(ch, row.feedback?.[i] ?? null, i, `r${r}`))}
            </div>
          ))}
          {status === 'playing' && (
            <div className="flex gap-1.5" role="row" aria-label="Current guess">
              {Array.from({ length: WORD_LEN }, (_, i) =>
                renderTile(current[i], null, i, 'cur')
              )}
            </div>
          )}
          {Array.from({ length: Math.max(0, emptyRows) }, (_, r) => (
            <div key={`e${r}`} className="flex gap-1.5" aria-hidden>
              {Array.from({ length: WORD_LEN }, (_, i) => renderTile(undefined, null, i, `e${r}-${i}`))}
            </div>
          ))}
        </div>

        {/* Answer reveal / win banner */}
        <AnimatePresence>
          {status !== 'playing' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className={cn(
                'rounded-xl p-3 text-center ring-1',
                status === 'won'
                  ? 'bg-emerald-500/10 ring-emerald-500/30'
                  : 'bg-rose-500/10 ring-rose-500/30'
              )}
            >
              <p className="text-lg font-black text-foreground" aria-live="polite">
                {status === 'won'
                  ? `দারুণ! ${rows.length} try${rows.length === 1 ? '' : 'ies'}${best ? '' : ''}`
                  : 'শব্দটি ছিল —'}
              </p>
              <p className="mt-0.5 text-xl font-bold text-foreground">{answer.join('')}</p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <Button
                  onClick={shareResult}
                  variant="outline"
                  className="h-10 gap-1.5 rounded-xl text-sm"
                >
                  <Share2 className="size-4" aria-hidden /> Share result
                </Button>
                <Button
                  onClick={newGame}
                  className="h-10 gap-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/25"
                >
                  <RotateCcw className="size-4" aria-hidden /> New word
                </Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Keyboard */}
        <div className="mx-auto w-full max-w-[min(96vw,460px)] space-y-1.5">
          {KB_ROWS.map((rowChars, r) => (
            <div key={r} className="flex justify-center gap-1">
              {r === 2 && (
                <button
                  onClick={submit}
                  aria-label="Submit guess"
                  className="h-11 min-w-[44px] rounded-lg bg-emerald-600 px-1.5 text-[11px] font-bold text-white shadow-sm active:scale-95"
                >
                  ⏎
                </button>
              )}
              {rowChars.map((ch) => (
                <button
                  key={ch}
                  onClick={() => typeChar(ch)}
                  disabled={status !== 'playing'}
                  aria-label={`Type ${ch}`}
                  className={cn(
                    'h-11 min-w-[30px] flex-1 rounded-lg text-base font-semibold ring-1 transition-all active:scale-95 disabled:opacity-40',
                    keyHints[ch]
                      ? keyHints[ch] === 'correct'
                        ? 'bg-emerald-500 text-white ring-transparent'
                        : keyHints[ch] === 'present'
                          ? 'bg-amber-500 text-white ring-transparent'
                          : 'bg-zinc-300/70 text-zinc-500 ring-transparent dark:bg-zinc-700 dark:text-zinc-400'
                      : 'bg-muted/70 text-foreground ring-border/50 hover:bg-muted'
                  )}
                >
                  {ch}
                </button>
              ))}
              {r === 2 && (
                <button
                  onClick={backspace}
                  aria-label="Delete letter"
                  className="h-11 min-w-[44px] rounded-lg bg-foreground/80 px-1.5 text-white shadow-sm active:scale-95"
                >
                  <Delete className="mx-auto size-4" aria-hidden />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>🟩 right spot · 🟨 in word · ⬛ not in word</span>
          <span>
            Best <b className="tabular-nums text-emerald-600 dark:text-emerald-400">{best}</b>
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
