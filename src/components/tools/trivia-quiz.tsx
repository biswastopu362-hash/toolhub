'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Flame, RotateCcw, Timer as TimerIcon, Trophy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { getGameStat, recordGameResult, unlockAchievement } from '@/lib/games/scores'

/* ================================================================== */
/* Trivia Quiz — offline category packs (zero uploads), 10 questions   */
/* per run, 15-second timer, streak multiplier scoring, answer review. */
/* ================================================================== */

type CategoryId = 'general' | 'science' | 'geo' | 'history' | 'sports' | 'tech'

interface Question {
  q: string
  options: string[]
  answer: number
  cat: CategoryId
}

const CATEGORIES: Record<CategoryId, { label: string; emoji: string }> = {
  general: { label: 'General', emoji: '🧠' },
  science: { label: 'Science', emoji: '🔬' },
  geo: { label: 'Geography', emoji: '🌍' },
  history: { label: 'History', emoji: '🏛️' },
  sports: { label: 'Sports', emoji: '⚽' },
  tech: { label: 'Tech', emoji: '💻' },
}

const BANK: Question[] = [
  /* General */
  { cat: 'general', q: 'How many continents are there on Earth?', options: ['5', '6', '7', '8'], answer: 2 },
  { cat: 'general', q: 'What is the largest mammal in the world?', options: ['Elephant', 'Blue whale', 'Giraffe', 'Orca'], answer: 1 },
  { cat: 'general', q: 'Which language has the most native speakers?', options: ['English', 'Spanish', 'Hindi', 'Mandarin Chinese'], answer: 3 },
  { cat: 'general', q: 'How many colors are in a rainbow?', options: ['5', '6', '7', '9'], answer: 2 },
  { cat: 'general', q: 'What currency is used in Japan?', options: ['Won', 'Yuan', 'Yen', 'Ringgit'], answer: 2 },
  { cat: 'general', q: 'Which bird is a universal symbol of peace?', options: ['Eagle', 'Dove', 'Owl', 'Swan'], answer: 1 },
  { cat: 'general', q: 'How many minutes are in a full day?', options: ['1200', '1440', '1600', '2400'], answer: 1 },
  { cat: 'general', q: 'What is the hardest natural substance?', options: ['Quartz', 'Steel', 'Diamond', 'Granite'], answer: 2 },
  { cat: 'general', q: 'Which ocean is the largest?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], answer: 3 },
  { cat: 'general', q: 'How many strings does a standard guitar have?', options: ['4', '5', '6', '7'], answer: 2 },
  /* Science */
  { cat: 'science', q: 'What planet is known as the Red Planet?', options: ['Venus', 'Mars', 'Jupiter', 'Mercury'], answer: 1 },
  { cat: 'science', q: 'What gas do plants absorb from the air?', options: ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Hydrogen'], answer: 2 },
  { cat: 'science', q: 'What is the chemical symbol for gold?', options: ['Go', 'Gd', 'Au', 'Ag'], answer: 2 },
  { cat: 'science', q: 'How many bones are in the adult human body?', options: ['186', '206', '226', '246'], answer: 1 },
  { cat: 'science', q: 'What force keeps planets in orbit?', options: ['Magnetism', 'Gravity', 'Friction', 'Inertia'], answer: 1 },
  { cat: 'science', q: 'What is the fastest land animal?', options: ['Lion', 'Cheetah', 'Horse', 'Antelope'], answer: 1 },
  { cat: 'science', q: 'Water freezes at what temperature in Celsius?', options: ['−10', '0', '10', '32'], answer: 1 },
  { cat: 'science', q: 'What organ pumps blood through the body?', options: ['Lungs', 'Liver', 'Heart', 'Kidneys'], answer: 2 },
  { cat: 'science', q: 'What is the study of earthquakes called?', options: ['Seismology', 'Geology', 'Meteorology', 'Ecology'], answer: 0 },
  { cat: 'science', q: 'Which blood type is known as the universal donor?', options: ['A', 'B', 'AB', 'O negative'], answer: 3 },
  /* Geography */
  { cat: 'geo', q: 'What is the capital of Australia?', options: ['Sydney', 'Melbourne', 'Canberra', 'Perth'], answer: 2 },
  { cat: 'geo', q: 'Which is the longest river in the world?', options: ['Amazon', 'Nile', 'Yangtze', 'Mississippi'], answer: 1 },
  { cat: 'geo', q: 'Mount Everest sits on the border of Nepal and…', options: ['India', 'China', 'Bhutan', 'Pakistan'], answer: 1 },
  { cat: 'geo', q: 'Which country has the most population?', options: ['China', 'India', 'USA', 'Indonesia'], answer: 1 },
  { cat: 'geo', q: 'What is the largest desert in the world?', options: ['Sahara', 'Gobi', 'Antarctic', 'Arabian'], answer: 2 },
  { cat: 'geo', q: 'Which country is shaped like a boot?', options: ['Spain', 'Greece', 'Italy', 'Portugal'], answer: 2 },
  { cat: 'geo', q: 'The Amazon rainforest is mostly in which country?', options: ['Peru', 'Colombia', 'Brazil', 'Venezuela'], answer: 2 },
  { cat: 'geo', q: 'What is the smallest country in the world?', options: ['Monaco', 'Nauru', 'Vatican City', 'San Marino'], answer: 2 },
  { cat: 'geo', q: 'Which sea is the saltiest?', options: ['Red Sea', 'Dead Sea', 'Black Sea', 'Baltic Sea'], answer: 1 },
  { cat: 'geo', q: 'Dhaka is the capital of which country?', options: ['Pakistan', 'Bangladesh', 'Sri Lanka', 'Nepal'], answer: 1 },
  /* History */
  { cat: 'history', q: 'Who was the first person to walk on the Moon?', options: ['Buzz Aldrin', 'Yuri Gagarin', 'Neil Armstrong', 'Michael Collins'], answer: 2 },
  { cat: 'history', q: 'In which year did World War II end?', options: ['1943', '1944', '1945', '1946'], answer: 2 },
  { cat: 'history', q: 'The Great Wall is located in which country?', options: ['Japan', 'China', 'Korea', 'Mongolia'], answer: 1 },
  { cat: 'history', q: 'Who was the first President of the United States?', options: ['Jefferson', 'Adams', 'Lincoln', 'Washington'], answer: 3 },
  { cat: 'history', q: 'The ancient pyramids of Giza are in which country?', options: ['Iraq', 'Mexico', 'Egypt', 'Sudan'], answer: 2 },
  { cat: 'history', q: 'Who wrote the Declaration of Independence primary draft?', options: ['Franklin', 'Jefferson', 'Adams', 'Hamilton'], answer: 1 },
  { cat: 'history', q: 'The Berlin Wall fell in which year?', options: ['1987', '1989', '1991', '1993'], answer: 1 },
  { cat: 'history', q: 'Which empire built Machu Picchu?', options: ['Aztec', 'Maya', 'Inca', 'Olmec'], answer: 2 },
  { cat: 'history', q: 'Who is known as the father of modern Bangladesh?', options: ['Sheikh Mujibur Rahman', 'Ziaur Rahman', 'Rabindranath Tagore', 'Tajuddin Ahmad'], answer: 0 },
  { cat: 'history', q: 'The Renaissance began in which country?', options: ['France', 'England', 'Italy', 'Spain'], answer: 2 },
  /* Sports */
  { cat: 'sports', q: 'How many players are on a football (soccer) team on the pitch?', options: ['9', '10', '11', '12'], answer: 2 },
  { cat: 'sports', q: 'How often are the Summer Olympics held?', options: ['Every 2 years', 'Every 3 years', 'Every 4 years', 'Every 5 years'], answer: 2 },
  { cat: 'sports', q: 'In which sport is a "shuttlecock" used?', options: ['Tennis', 'Badminton', 'Squash', 'Table tennis'], answer: 1 },
  { cat: 'sports', q: 'How many rings are on the Olympic flag?', options: ['4', '5', '6', '7'], answer: 1 },
  { cat: 'sports', q: 'Which country has won the most FIFA World Cups?', options: ['Germany', 'Italy', 'Argentina', 'Brazil'], answer: 3 },
  { cat: 'sports', q: 'In cricket, how many balls are in a standard over?', options: ['4', '5', '6', '8'], answer: 2 },
  { cat: 'sports', q: 'What is the maximum break in snooker?', options: ['140', '145', '147', '155'], answer: 2 },
  { cat: 'sports', q: 'Serena Williams is famous for which sport?', options: ['Golf', 'Tennis', 'Boxing', 'Basketball'], answer: 1 },
  { cat: 'sports', q: 'How long is a marathon in kilometers?', options: ['38.2', '40.2', '42.2', '44.2'], answer: 2 },
  { cat: 'sports', q: 'Which sport uses a pommel horse?', options: ['Gymnastics', 'Wrestling', 'Judo', 'Fencing'], answer: 0 },
  /* Tech */
  { cat: 'tech', q: 'What does "WWW" stand for?', options: ['World Wide Web', 'Web World Wide', 'Wide World Web', 'World Web Wide'], answer: 0 },
  { cat: 'tech', q: 'Who co-founded Apple with Steve Jobs?', options: ['Bill Gates', 'Steve Wozniak', 'Elon Musk', 'Jeff Bezos'], answer: 1 },
  { cat: 'tech', q: 'What does CPU stand for?', options: ['Central Process Unit', 'Central Processing Unit', 'Computer Personal Unit', 'Central Program Unit'], answer: 1 },
  { cat: 'tech', q: 'How many bits are in a byte?', options: ['4', '8', '16', '32'], answer: 1 },
  { cat: 'tech', q: 'Which company develops the Android OS?', options: ['Apple', 'Microsoft', 'Google', 'Samsung'], answer: 2 },
  { cat: 'tech', q: 'What does "HTTP" stand for?', options: ['HyperText Transfer Protocol', 'High Transfer Text Protocol', 'HyperTransfer Text Protocol', 'HyperText Transit Protocol'], answer: 0 },
  { cat: 'tech', q: 'What is the binary equivalent of decimal 5?', options: ['100', '101', '110', '011'], answer: 1 },
  { cat: 'tech', q: 'Which language is primarily used for styling web pages?', options: ['HTML', 'CSS', 'Python', 'SQL'], answer: 1 },
  { cat: 'tech', q: 'What does "AI" stand for?', options: ['Automated Intelligence', 'Artificial Intelligence', 'Advanced Intelligence', 'Applied Intelligence'], answer: 1 },
  { cat: 'tech', q: 'Which company created the React library?', options: ['Google', 'Meta (Facebook)', 'Microsoft', 'Twitter'], answer: 1 },
]

const QUESTIONS_PER_RUN = 10
const TIME_PER_Q = 15

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

interface RunQuestion extends Question {
  shuffledOptions: string[]
  shuffledAnswer: number
}

function buildRun(cat: CategoryId | 'mixed'): RunQuestion[] {
  const pool = cat === 'mixed' ? BANK : BANK.filter((q) => q.cat === cat)
  return shuffle(pool)
    .slice(0, QUESTIONS_PER_RUN)
    .map((q) => {
      const order = shuffle(q.options.map((_, i) => i))
      return {
        ...q,
        shuffledOptions: order.map((i) => q.options[i]),
        shuffledAnswer: order.indexOf(q.answer),
      }
    })
}

type Phase = 'pick' | 'play' | 'done'

export default function TriviaQuizApp() {
  const [phase, setPhase] = useState<Phase>('pick')
  const [category, setCategory] = useState<CategoryId | 'mixed'>('mixed')
  const [run, setRun] = useState<RunQuestion[]>([])
  const [qIdx, setQIdx] = useState(0)
  const [picked, setPicked] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [bestStreak, setBestStreak] = useState(0)
  const [correctCount, setCorrectCount] = useState(0)
  const [timeLeft, setTimeLeft] = useState(TIME_PER_Q)
  const [best, setBest] = useState(() =>
    typeof window === 'undefined' ? 0 : getGameStat('trivia').best
  )
  const [newBest, setNewBest] = useState(false)
  const nextTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (nextTimer.current) clearTimeout(nextTimer.current)
  }, [])

  const startRun = useCallback((cat: CategoryId | 'mixed') => {
    setCategory(cat)
    setRun(buildRun(cat))
    setQIdx(0)
    setPicked(null)
    setScore(0)
    setStreak(0)
    setBestStreak(0)
    setCorrectCount(0)
    setTimeLeft(TIME_PER_Q)
    setNewBest(false)
    setPhase('play')
  }, [])

  const finishRun = useCallback(
    (finalScore: number, finalCorrect: number, finalBestStreak: number) => {
      setPhase('done')
      const res = recordGameResult('trivia', { value: finalScore, won: finalCorrect >= 7 })
      setBest(res.stat.best)
      setNewBest(res.isNewBest)
      unlockAchievement('trivia-first-quiz')
      if (finalCorrect === QUESTIONS_PER_RUN) unlockAchievement('trivia-perfect')
      if (finalBestStreak >= 5) unlockAchievement('trivia-streak5')
      if (finalScore >= 1500) unlockAchievement('trivia-1500')
    },
    []
  )

  /* per-question countdown — a timeout is handled by scheduling the
     advance (no synchronous setState in the effect body); the UI
     derives "revealed" from timeLeft === 0 to lock the options. */
  useEffect(() => {
    if (phase !== 'play' || picked !== null) return
    if (timeLeft <= 0) {
      const isLast = qIdx === run.length - 1
      const t = setTimeout(() => {
        setStreak(0)
        if (isLast) {
          finishRun(score, correctCount, bestStreak)
        } else {
          setQIdx((n) => n + 1)
          setTimeLeft(TIME_PER_Q)
        }
      }, 1100)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000)
    return () => clearTimeout(t)
  }, [phase, picked, timeLeft, qIdx, run.length, score, correctCount, bestStreak, finishRun])

  const pick = (i: number) => {
    if (picked !== null || timeLeft <= 0) return
    setPicked(i)
    const q = run[qIdx]
    const correct = i === q.shuffledAnswer
    let gained = 0
    const newStreak = correct ? streak + 1 : 0
    if (correct) {
      const bonus = newStreak >= 3 ? (newStreak - 2) * 25 : 0
      gained = 100 + bonus + Math.max(0, timeLeft) * 2
      setScore((s) => s + gained)
      setStreak(newStreak)
      setBestStreak((b) => Math.max(b, newStreak))
      setCorrectCount((c) => c + 1)
      if (navigator.vibrate) navigator.vibrate(10)
    } else {
      setStreak(0)
    }
    const isLast = qIdx === run.length - 1
    const nextScore = score + gained
    const nextCorrect = correctCount + (correct ? 1 : 0)
    nextTimer.current = setTimeout(
      () => {
        if (isLast) {
          finishRun(nextScore, nextCorrect, Math.max(bestStreak, newStreak))
        } else {
          setQIdx((n) => n + 1)
          setPicked(null)
          setTimeLeft(TIME_PER_Q)
        }
      },
      1100
    )
  }

  const q = run[qIdx]

  const reviewList = useMemo(
    () =>
      phase === 'done'
        ? run.map((rq) => ({ q: rq.q, cat: rq.cat }))
        : [],
    [phase, run]
  )

  return (
    <Card className="overflow-hidden shadow-md">
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
              Trivia Quiz
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {phase === 'pick'
                ? 'Offline packs · streaks multiply your score'
                : `${CATEGORIES[category === 'mixed' ? 'general' : category].emoji} ${category === 'mixed' ? 'Mixed pack' : CATEGORIES[category].label} · ${qIdx + (phase === 'play' ? 1 : 0)}/${run.length}`}
            </p>
          </div>
          {phase === 'play' && (
            <div className="flex items-center gap-2">
              <div className="min-w-[58px] rounded-xl bg-muted px-2.5 py-1.5 text-center ring-1 ring-border/60">
                <div className="flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <TimerIcon className="size-3" aria-hidden /> Time
                </div>
                <div className={cn('text-base font-bold tabular-nums', timeLeft <= 3 ? 'text-rose-500' : 'text-foreground')}>
                  {Math.max(0, timeLeft)}
                </div>
              </div>
              <div className="min-w-[58px] rounded-xl bg-muted px-2.5 py-1.5 text-center ring-1 ring-border/60">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Score</div>
                <div className="text-base font-bold tabular-nums text-foreground" aria-live="polite">
                  {score}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pack picker */}
        {phase === 'pick' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <button
                onClick={() => startRun('mixed')}
                className="col-span-2 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-600 p-4 text-left text-white shadow-md shadow-orange-500/25 transition-transform active:scale-[0.98] sm:col-span-3"
              >
                <div className="text-lg font-black">🎲 Mixed pack</div>
                <div className="text-xs opacity-90">{QUESTIONS_PER_RUN} questions from every category</div>
              </button>
              {(Object.keys(CATEGORIES) as CategoryId[]).map((c) => (
                <button
                  key={c}
                  onClick={() => startRun(c)}
                  className="rounded-2xl bg-muted/60 p-3 text-left ring-1 ring-border/60 transition-transform hover:bg-muted active:scale-[0.98]"
                >
                  <div className="text-2xl" aria-hidden>
                    {CATEGORIES[c].emoji}
                  </div>
                  <div className="mt-1 text-sm font-bold text-foreground">{CATEGORIES[c].label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {BANK.filter((q) => q.cat === c).length} questions
                  </div>
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between rounded-xl bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground ring-1 ring-border/50">
              <span>✅ +100 · ⏱ up to +30 speed bonus · 🔥 streak ≥3 adds +25 each</span>
              <span className="flex items-center gap-1">
                <Trophy className="size-3 text-amber-500" aria-hidden />
                Best <b className="tabular-nums">{best}</b>
              </span>
            </div>
          </div>
        )}

        {/* Question */}
        {phase === 'play' && q && (
          <div className="space-y-3">
            {/* progress dots */}
            <div className="flex gap-1" aria-hidden>
              {run.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-1.5 flex-1 rounded-full',
                    i < qIdx ? 'bg-emerald-500' : i === qIdx ? 'bg-amber-500' : 'bg-muted'
                  )}
                />
              ))}
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={qIdx}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.18 }}
                className="space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-1 text-[11px] font-bold ring-1',
                      streak >= 3
                        ? 'bg-orange-500/10 text-orange-600 ring-orange-500/30'
                        : 'bg-muted/60 text-muted-foreground ring-border/50'
                    )}
                  >
                    {streak >= 3 ? <Flame className="mr-1 inline size-3" aria-hidden /> : null}streak {streak}
                  </span>
                </div>
                <p className="text-lg font-bold leading-snug text-foreground sm:text-xl" aria-live="polite">
                  {q.q}
                </p>
                <div className="space-y-2">
                  {q.shuffledOptions.map((opt, i) => {
                    const isAnswer = i === q.shuffledAnswer
                    const isPicked = picked === i
                    const revealed = picked !== null || timeLeft <= 0
                    return (
                      <button
                        key={i}
                        onClick={() => pick(i)}
                        disabled={revealed}
                        aria-label={`Option: ${opt}`}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl p-3 text-left text-sm font-semibold ring-1 transition-all',
                          !revealed && 'bg-muted/50 ring-border/60 hover:bg-muted active:scale-[0.99]',
                          revealed && isAnswer && 'bg-emerald-500/15 ring-emerald-500 text-emerald-700 dark:text-emerald-400',
                          revealed && isPicked && !isAnswer && 'bg-rose-500/15 ring-rose-500 text-rose-700 dark:text-rose-400',
                          revealed && !isPicked && !isAnswer && 'bg-muted/30 ring-border/40 text-muted-foreground'
                        )}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background/70 text-xs font-black text-foreground/70 ring-1 ring-border/50">
                          {String.fromCharCode(65 + i)}
                        </span>
                        <span className="flex-1">{opt}</span>
                        {revealed && isAnswer && <Check className="size-5 text-emerald-500" aria-hidden />}
                        {revealed && isPicked && !isAnswer && <X className="size-5 text-rose-500" aria-hidden />}
                      </button>
                    )
                  })}
                </div>
                {picked === null && timeLeft <= 0 && (
                  <p className="text-center text-sm font-bold text-rose-500" aria-live="polite">
                    Time&apos;s up!
                  </p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        )}

        {/* Results */}
        {phase === 'done' && (
          <div className="space-y-3">
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              className="rounded-2xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 p-4 text-center ring-1 ring-orange-500/25"
            >
              <p className="text-3xl font-black tabular-nums text-foreground">{score}</p>
              <p className="mt-0.5 text-sm text-muted-foreground" aria-live="polite">
                {correctCount}/{run.length} correct · best streak {bestStreak}
                {newBest ? ' — new best! 🏆' : ''}
              </p>
              <div className="mt-1 flex items-center justify-center gap-1">
                {Array.from({ length: run.length }, (_, i) => (
                  <span key={i} className={i < correctCount ? 'text-emerald-500' : 'text-rose-400'} aria-hidden>
                    {i < correctCount ? '●' : '○'}
                  </span>
                ))}
              </div>
            </motion.div>
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl bg-muted/30 p-2 ring-1 ring-border/50">
              {reviewList.map((r, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-background/70 px-2.5 py-1.5 text-xs">
                  <span aria-hidden>{CATEGORIES[r.cat].emoji}</span>
                  <span className="flex-1 truncate text-foreground/80">{r.q}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => startRun(category)}
                className="h-11 flex-1 gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-md shadow-orange-500/25"
              >
                <RotateCcw className="size-4" aria-hidden /> Play again
              </Button>
              <Button variant="outline" onClick={() => setPhase('pick')} className="h-11 flex-1 rounded-xl">
                Change pack
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
