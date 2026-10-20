'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Delete, History, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Expression engine: tokenizer → shunting-yard → RPN evaluation       */
/* Supports: + - × ÷ ^ % ( ) ! √ π e  sin cos tan log ln abs, deg/rad  */
/* ================================================================== */

type Tok =
  | { t: 'num'; n: number }
  | { t: 'op'; v: string }
  | { t: 'u-' }
  | { t: 'lp' }
  | { t: 'rp' }
  | { t: 'fn'; v: string }
  | { t: 'const'; n: number }

const FUNCS = new Set(['sin', 'cos', 'tan', 'log', 'ln', 'sqrt', 'abs'])
const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4, 'u-': 3, '!': 5, '%': 5 }
const RIGHT_ASSOC = new Set(['^', 'u-'])

function normalize(src: string): string {
  return src
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/−/g, '-')
    .replace(/√/g, 'sqrt')
    .replace(/π/g, 'π')
}

function tokenize(src: string): Tok[] {
  const s = normalize(src)
  const toks: Tok[] = []
  let i = 0

  const prevNeedsImplicitMul = () => {
    const p = toks[toks.length - 1]
    return !!p && (p.t === 'num' || p.t === 'rp' || (p.t === 'op' && (p.v === '!' || p.v === '%')))
  }

  while (i < s.length) {
    const c = s[i]
    if (c === ' ') {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < s.length && /[0-9.]/.test(s[j])) j++
      const n = parseFloat(s.slice(i, j))
      if (!isFinite(n)) throw new Error('Invalid number')
      if (prevNeedsImplicitMul()) toks.push({ t: 'op', v: '*' })
      toks.push({ t: 'num', n })
      i = j
      continue
    }
    if (c === 'π') {
      if (prevNeedsImplicitMul()) toks.push({ t: 'op', v: '*' })
      toks.push({ t: 'const', n: Math.PI })
      i++
      continue
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i
      while (j < s.length && /[a-zA-Z]/.test(s[j])) j++
      const w = s.slice(i, j).toLowerCase()
      i = j
      if (w === 'e') {
        if (prevNeedsImplicitMul()) toks.push({ t: 'op', v: '*' })
        toks.push({ t: 'const', n: Math.E })
      } else if (FUNCS.has(w)) {
        if (prevNeedsImplicitMul()) toks.push({ t: 'op', v: '*' })
        toks.push({ t: 'fn', v: w })
      } else {
        throw new Error(`Unknown: ${w}`)
      }
      continue
    }
    switch (c) {
      case '(':
        if (prevNeedsImplicitMul()) toks.push({ t: 'op', v: '*' })
        toks.push({ t: 'lp' })
        break
      case ')':
        toks.push({ t: 'rp' })
        break
      case '+':
        toks.push({ t: 'op', v: '+' })
        break
      case '-': {
        const p = toks[toks.length - 1]
        const unary =
          !p || p.t === 'lp' || p.t === 'op' || p.t === 'fn' || p.t === 'u-'
        toks.push(unary ? { t: 'u-' } : { t: 'op', v: '-' })
        break
      }
      case '*':
        toks.push({ t: 'op', v: '*' })
        break
      case '/':
        toks.push({ t: 'op', v: '/' })
        break
      case '^':
        toks.push({ t: 'op', v: '^' })
        break
      case '!':
        toks.push({ t: 'op', v: '!' })
        break
      case '%':
        toks.push({ t: 'op', v: '%' })
        break
      default:
        throw new Error(`Unknown symbol: ${c}`)
    }
    i++
  }
  return toks
}

function toRpn(toks: Tok[]): Tok[] {
  const out: Tok[] = []
  const stack: Tok[] = []
  for (const tok of toks) {
    switch (tok.t) {
      case 'num':
      case 'const':
        out.push(tok)
        break
      case 'fn':
        stack.push(tok)
        break
      case 'u-':
      case 'op': {
        const v = tok.t === 'u-' ? 'u-' : tok.v
        while (stack.length > 0) {
          const top = stack[stack.length - 1]
          if (top.t === 'fn' || top.t === 'u-' || (top.t === 'op' && PREC[top.v] >= PREC[v] && !RIGHT_ASSOC.has(v))) {
            out.push(stack.pop()!)
          } else break
        }
        stack.push(tok)
        break
      }
      case 'lp':
        stack.push(tok)
        break
      case 'rp': {
        let foundLp = false
        while (stack.length > 0) {
          const top = stack.pop()!
          if (top.t === 'lp') {
            foundLp = true
            break
          }
          out.push(top)
        }
        if (!foundLp) throw new Error('Mismatched parentheses')
        if (stack.length > 0 && stack[stack.length - 1].t === 'fn') out.push(stack.pop()!)
        break
      }
    }
  }
  while (stack.length > 0) {
    const top = stack.pop()!
    if (top.t === 'lp') throw new Error('Mismatched parentheses')
    out.push(top)
  }
  return out
}

function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) throw new Error('Factorial: requires an integer')
  if (n > 170) return Infinity
  let r = 1
  for (let k = 2; k <= n; k++) r *= k
  return r
}

function evalRpn(rpn: Tok[], deg: boolean): number {
  const st: number[] = []
  const apply = (op: string) => {
    if (op === 'u-') {
      const a = st.pop()
      if (a === undefined) throw new Error('Error')
      st.push(-a)
      return
    }
    if (op === '!' || op === '%') {
      const a = st.pop()
      if (a === undefined) throw new Error('Error')
      st.push(op === '!' ? factorial(a) : a / 100)
      return
    }
    const b = st.pop()
    const a = st.pop()
    if (a === undefined || b === undefined) throw new Error('Error')
    switch (op) {
      case '+': st.push(a + b); break
      case '-': st.push(a - b); break
      case '*': st.push(a * b); break
      case '/':
        if (b === 0) throw new Error('Division by zero')
        st.push(a / b)
        break
      case '^': st.push(Math.pow(a, b)); break
    }
  }
  for (const tok of rpn) {
    switch (tok.t) {
      case 'num':
      case 'const':
        st.push(tok.n)
        break
      case 'op':
        apply(tok.v)
        break
      case 'u-':
        apply('u-')
        break
      case 'fn': {
        const a = st.pop()
        if (a === undefined) throw new Error('Error')
        const toRad = (x: number) => (deg ? (x * Math.PI) / 180 : x)
        switch (tok.v) {
          case 'sin': st.push(Math.sin(toRad(a))); break
          case 'cos': st.push(Math.cos(toRad(a))); break
          case 'tan': st.push(Math.tan(toRad(a))); break
          case 'log':
            if (a <= 0) throw new Error('log: requires a positive number')
            st.push(Math.log10(a))
            break
          case 'ln':
            if (a <= 0) throw new Error('ln: requires a positive number')
            st.push(Math.log(a))
            break
          case 'sqrt':
            if (a < 0) throw new Error('sqrt: negative number')
            st.push(Math.sqrt(a))
            break
          case 'abs': st.push(Math.abs(a)); break
        }
        break
      }
    }
  }
  if (st.length !== 1) throw new Error('Incomplete expression')
  const r = st[0]
  if (!isFinite(r)) throw new Error('Number too large')
  return r
}

export function evaluateExpression(src: string, deg = true): number {
  return evalRpn(toRpn(tokenize(src)), deg)
}

function fmtResult(x: number): string {
  if (!isFinite(x)) return 'Error'
  if (Math.abs(x) >= 1e13 || (x !== 0 && Math.abs(x) < 1e-9)) {
    return x.toExponential(6).replace(/e([+-])(\d+)/, 'e$1$2')
  }
  if (Math.abs(x - Math.round(x)) < 1e-10) return String(Math.round(x))
  return String(parseFloat(x.toPrecision(12)))
}

/* ================================================================== */
/* UI                                                                  */
/* ================================================================== */

interface HistoryItem {
  expr: string
  res: string
}

const HISTORY_KEY = 'toolhub-calc-history'

export default function CalculatorTool() {
  const { toast } = useToast()
  const [display, setDisplay] = useState('')
  const [deg, setDeg] = useState(true)
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      return raw ? (JSON.parse(raw) as HistoryItem[]) : []
    } catch {
      return []
    }
  })
  const [showHistory, setShowHistory] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const pushHistory = (item: HistoryItem) => {
    setHistory((h) => {
      const next = [item, ...h].slice(0, 20)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const preview = (() => {
    if (!display.trim()) return null
    try {
      const v = evaluateExpression(display, deg)
      return fmtResult(v)
    } catch {
      return null
    }
  })()

  const press = useCallback(
    (key: string) => {
      if (key === 'AC') {
        setDisplay('')
        return
      }
      if (key === '⌫') {
        setDisplay((d) => {
          const fnEndings = ['sin(', 'cos(', 'tan(', 'log(', 'ln(', 'sqrt(', 'abs(']
          for (const f of fnEndings) {
            if (d.endsWith(f)) return d.slice(0, -f.length)
          }
          return d.slice(0, -1)
        })
        return
      }
      if (key === '=') {
        if (!display.trim()) return
        try {
          const v = evaluateExpression(display, deg)
          const res = fmtResult(v)
          pushHistory({ expr: display, res })
          setDisplay(res)
        } catch (err) {
          toast({
            title: 'Could not calculate',
            description: err instanceof Error ? err.message : 'Check the expression',
            variant: 'destructive',
          })
        }
        return
      }
      if (key === '±') {
        setDisplay((d) => {
          const m = d.match(/(\d+\.?\d*)$/)
          if (!m) return d + '(-'
          const start = d.length - m[1].length
          const before = d.slice(0, start)
          if (before.endsWith('-') && (before.length === 1 || /[+\-×÷^(]$/.test(before.slice(0, -1)))) {
            return before.slice(0, -1) + m[1]
          }
          return before + '-' + m[1]
        })
        return
      }
      if (FUNCS.has(key) || key === '√') {
        setDisplay((d) => d + (key === '√' ? '√(' : `${key}(`))
        return
      }
      setDisplay((d) => d + key)
    },
    [display, deg, toast]
  )

  /* Keyboard support */
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (!el.contains(document.activeElement) && document.activeElement !== el && !el.matches(':focus-within')) return
      const k = e.key
      if (/^[0-9.]$/.test(k)) press(k)
      else if (k === '+') press('+')
      else if (k === '-') press('-')
      else if (k === '*') press('×')
      else if (k === '/') { e.preventDefault(); press('÷') }
      else if (k === '^') press('^')
      else if (k === '(') press('(')
      else if (k === ')') press(')')
      else if (k === '%') press('%')
      else if (k === '!') press('!')
      else if (k === 'Enter' || k === '=') { e.preventDefault(); press('=') }
      else if (k === 'Backspace') { e.preventDefault(); press('⌫') }
      else if (k === 'Escape') press('AC')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press])

  const keys: { label: string; key: string; cls?: string; aria?: string }[][] = [
    [
      { label: deg ? 'DEG' : 'RAD', key: 'deg', cls: 'text-xs font-bold text-emerald-700 dark:text-emerald-400' },
      { label: 'sin', key: 'sin' },
      { label: 'cos', key: 'cos' },
      { label: 'tan', key: 'tan' },
      { label: 'log', key: 'log' },
    ],
    [
      { label: 'x!', key: '!' },
      { label: 'xʸ', key: '^' },
      { label: '√', key: '√' },
      { label: 'ln', key: 'ln' },
      { label: '|x|', key: 'abs' },
    ],
    [
      { label: 'AC', key: 'AC', cls: 'text-red-600 dark:text-red-400 font-semibold' },
      { label: '⌫', key: '⌫' },
      { label: '(', key: '(' },
      { label: ')', key: ')' },
      { label: '÷', key: '÷' },
    ],
    [
      { label: '7', key: '7' },
      { label: '8', key: '8' },
      { label: '9', key: '9' },
      { label: '×', key: '×' },
      { label: '%', key: '%' },
    ],
    [
      { label: '4', key: '4' },
      { label: '5', key: '5' },
      { label: '6', key: '6' },
      { label: '−', key: '-' },
      { label: 'π', key: 'π' },
    ],
    [
      { label: '1', key: '1' },
      { label: '2', key: '2' },
      { label: '3', key: '3' },
      { label: '+', key: '+' },
      { label: 'e', key: 'e' },
    ],
    [
      { label: '0', key: '0' },
      { label: '.', key: '.' },
      { label: '±', key: '±' },
      { label: '=', key: '=', cls: 'bg-primary text-primary-foreground hover:bg-primary/90 col-span-2 font-bold' },
    ],
  ]

  const handleKey = (key: string) => {
    if (key === 'deg') setDeg((d) => !d)
    else press(key)
  }

  return (
    <div ref={rootRef} tabIndex={-1} className="mx-auto max-w-md outline-none">
      <Card className="overflow-hidden shadow-md">
        <CardContent className="p-4 sm:p-5">
          {/* Display */}
          <div className="rounded-2xl border bg-muted/40 p-4 text-right">
            <div
              className="min-h-[28px] break-all font-mono text-lg text-muted-foreground"
              aria-live="polite"
              aria-label="Expression"
            >
              {display || <span className="opacity-40">0</span>}
            </div>
            <div className="mt-1 min-h-[34px] break-all font-mono text-2xl font-bold text-foreground">
              {preview !== null && preview !== display ? (
                <span>= {preview}</span>
              ) : (
                <span className="opacity-20">=</span>
              )}
            </div>
          </div>

          {/* Mode + history toggle */}
          <div className="mt-3 flex items-center justify-between">
            <Badge variant="outline" className="gap-1">
              {deg ? 'Degrees (DEG)' : 'Radians (RAD)'}
            </Badge>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory((s) => !s)}
                aria-expanded={showHistory}
                className="gap-1.5 text-muted-foreground"
              >
                <History className="h-4 w-4" />
                History
              </Button>
              {history.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setHistory([])
                    localStorage.removeItem(HISTORY_KEY)
                  }}
                  aria-label="Clear history"
                  className="text-muted-foreground"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* History */}
          {showHistory && (
            <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border bg-muted/30 p-2">
              {history.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">No calculations yet</p>
              ) : (
                <ul className="space-y-1">
                  {history.map((h, i) => (
                    <li key={i}>
                      <button
                        onClick={() => setDisplay(h.expr)}
                        className="w-full rounded-lg px-2 py-1.5 text-right transition-colors hover:bg-accent"
                      >
                        <span className="block truncate font-mono text-xs text-muted-foreground">{h.expr}</span>
                        <span className="block truncate font-mono text-sm font-semibold">= {h.res}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Keypad */}
          <div className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-2" role="group" aria-label="Calculator keypad">
            {keys.flat().map((k, i) => (
              <Button
                key={`${k.key}-${i}`}
                variant="outline"
                onClick={() => handleKey(k.key)}
                aria-label={k.aria ?? k.label}
                className={cn(
                  'h-11 rounded-xl border-border/70 font-mono text-sm sm:h-12 sm:text-base',
                  /^[0-9.]$/.test(k.key) && 'bg-accent/60 text-base font-semibold',
                  k.cls,
                  k.key === '=' && 'col-span-2'
                )}
              >
                {k.key === '⌫' ? <Delete className="h-4 w-4" /> : k.label}
              </Button>
            ))}
          </div>

          <p className="mt-3 text-center text-[11px] text-muted-foreground">
            You can also type with a keyboard — digits, + − * / ^ ( ) %, Enter = calculate, Esc = clear
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
