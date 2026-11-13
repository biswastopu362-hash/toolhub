'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Delete, History, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { useLang } from '@/hooks/use-lang'

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
  kind?: 'keypad' | 'solve'
}

const HISTORY_KEY = 'toolhub-calc-history'

/* ================================================================== */
/* Equation solver (v2.2 W3) — quadratic + 2×2/3×3 linear systems      */
/* ================================================================== */

type SolverMode = 'quad' | 'lin2' | 'lin3'

const EPS = 1e-9

function num(value: string): number {
  return parseFloat(value.replace(',', '.'))
}

function fmtNum(x: number): string {
  if (!isFinite(x)) return '—'
  if (Math.abs(x - Math.round(x)) < 1e-10) return String(Math.round(x))
  return String(parseFloat(x.toPrecision(10)))
}

function NumField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border border-border/70 bg-muted/30 px-2 text-center font-mono text-sm font-semibold outline-none transition-colors focus:border-primary/60"
      />
    </div>
  )
}

function ResultRow({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={cn(
          'break-all text-right font-mono text-sm font-bold',
          tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
        )}
      >
        {value}
      </span>
    </div>
  )
}

function SolverPanel({ pushHistory }: { pushHistory: (item: HistoryItem) => void }) {
  const { t } = useLang()
  const [sub, setSub] = useState<SolverMode>('quad')
  const [q, setQ] = useState({ a: '1', b: '-3', c: '2' })
  const [m2, setM2] = useState({ a1: '1', b1: '1', c1: '5', a2: '2', b2: '-1', c2: '1' })
  const [m3, setM3] = useState({
    a1: '1', b1: '1', c1: '1', d1: '6',
    a2: '1', b2: '-1', c2: '2', d2: '9',
    a3: '2', b3: '1', c3: '-1', d3: '0',
  })

  /* ---- quadratic ---- */
  const quad = useMemo(() => {
    const a = num(q.a)
    const b = num(q.b)
    const c = num(q.c)
    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) return null
    if (a === 0) return { needA: true as const }
    const D = b * b - 4 * a * c
    const vx = -b / (2 * a)
    const vy = -D / (4 * a)
    if (D > EPS) {
      const s = Math.sqrt(D)
      return { D, vertex: [vx, vy] as const, roots: [(-b + s) / (2 * a), (-b - s) / (2 * a)] as const }
    }
    if (Math.abs(D) <= EPS) return { D: 0, vertex: [vx, vy] as const, roots: [vx] as const }
    return { D, vertex: [vx, vy] as const, complex: { re: vx, im: Math.sqrt(-D) / (2 * a) } as const }
  }, [q])

  /* ---- 2×2 ---- */
  const lin2 = useMemo(() => {
    const v = {
      a1: num(m2.a1), b1: num(m2.b1), c1: num(m2.c1),
      a2: num(m2.a2), b2: num(m2.b2), c2: num(m2.c2),
    }
    if (Object.values(v).some((x) => !isFinite(x))) return null
    const D = v.a1 * v.b2 - v.a2 * v.b1
    const Dx = v.c1 * v.b2 - v.c2 * v.b1
    const Dy = v.a1 * v.c2 - v.a2 * v.c1
    if (Math.abs(D) <= EPS) {
      const many = Math.abs(Dx) <= EPS && Math.abs(Dy) <= EPS
      return { kind: many ? ('infinite' as const) : ('none' as const) }
    }
    return { kind: 'unique' as const, x: Dx / D, y: Dy / D }
  }, [m2])

  /* ---- 3×3 (Cramer) ---- */
  const lin3 = useMemo(() => {
    const v = m3 as Record<string, string>
    const n: Record<string, number> = {}
    for (const k of Object.keys(m3)) {
      const x = num(v[k])
      if (!isFinite(x)) return null
      n[k] = x
    }
    const det = (
      a1: number, b1: number, c1: number,
      a2: number, b2: number, c2: number,
      a3: number, b3: number, c3: number
    ) =>
      a1 * (b2 * c3 - b3 * c2) - b1 * (a2 * c3 - a3 * c2) + c1 * (a2 * b3 - a3 * b2)
    const D = det(n.a1, n.b1, n.c1, n.a2, n.b2, n.c2, n.a3, n.b3, n.c3)
    const Dx = det(n.d1, n.b1, n.c1, n.d2, n.b2, n.c2, n.d3, n.b3, n.c3)
    const Dy = det(n.a1, n.d1, n.c1, n.a2, n.d2, n.c2, n.a3, n.d3, n.c3)
    const Dz = det(n.a1, n.b1, n.d1, n.a2, n.b2, n.d2, n.a3, n.b3, n.d3)
    if (Math.abs(D) <= EPS) {
      const many =
        Math.abs(Dx) <= EPS && Math.abs(Dy) <= EPS && Math.abs(Dz) <= EPS
      return { kind: many ? ('infinite' as const) : ('none' as const) }
    }
    return { kind: 'unique' as const, x: Dx / D, y: Dy / D, z: Dz / D }
  }, [m3])

  const solveLabel = (k: 'infinite' | 'none' | 'unique'): string =>
    k === 'infinite' ? t('solverInfinite') : k === 'none' ? t('solverNone') : t('solverUnique')

  const record = (expr: string, res: string) => pushHistory({ expr, res, kind: 'solve' })

  return (
    <div className="space-y-3">
      {/* Solver sub-modes */}
      <div className="flex rounded-xl border bg-muted/30 p-1" role="tablist" aria-label="Solver type">
        {(
          [
            { id: 'quad' as const, label: t('solverQuadratic') },
            { id: 'lin2' as const, label: t('solverLin2') },
            { id: 'lin3' as const, label: t('solverLin3') },
          ]
        ).map((m) => (
          <button
            key={m.id}
            role="tab"
            aria-selected={sub === m.id}
            onClick={() => setSub(m.id)}
            className={cn(
              'flex h-9 flex-1 items-center justify-center rounded-lg text-xs font-bold transition-colors',
              sub === m.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {m.label}
          </button>
        ))}
      </div>

      {sub === 'quad' && (
        <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
          <p className="text-center font-mono text-xs text-muted-foreground">a·x² + b·x + c = 0</p>
          <div className="grid grid-cols-3 gap-2">
            <NumField id="q-a" label="a" value={q.a} onChange={(v) => setQ({ ...q, a: v })} />
            <NumField id="q-b" label="b" value={q.b} onChange={(v) => setQ({ ...q, b: v })} />
            <NumField id="q-c" label="c" value={q.c} onChange={(v) => setQ({ ...q, c: v })} />
          </div>
          {quad && (
            <div className="space-y-1.5">
              {'needA' in quad ? (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-center text-xs font-semibold text-amber-600 dark:text-amber-400">
                  {t('solverNeedA')}
                </p>
              ) : (
                <>
                  <ResultRow label={t('solverDisc')} value={fmtNum(quad.D)} />
                  {'roots' in quad && quad.roots && (
                    <ResultRow
                      label={quad.roots.length === 2 ? `${t('solverRoot')} 1 · 2` : t('solverRoot')}
                      value={quad.roots.map((r) => `x = ${fmtNum(r)}`).join('   ')}
                    />
                  )}
                  {'complex' in quad && quad.complex && (
                    <ResultRow
                      label={t('solverNoReal')}
                      tone="warn"
                      value={`x = ${fmtNum(quad.complex.re)} ± ${fmtNum(Math.abs(quad.complex.im))}i`}
                    />
                  )}
                  <ResultRow
                    label={t('solverVertex')}
                    value={`(${fmtNum(quad.vertex[0])}, ${fmtNum(quad.vertex[1])})`}
                  />
                  {quad.D >= 0 && !('needA' in quad) && (
                    <button
                      onClick={() => {
                        const sgn = (n: number) => (n < 0 ? `− ${Math.abs(n)}` : `+ ${n}`)
                        record(
                          `${fmtNum(num(q.a))}x² ${sgn(num(q.b))}x ${sgn(num(q.c))} = 0`,
                          'roots' in quad && quad.roots
                            ? quad.roots.map((r) => fmtNum(r)).join(', ')
                            : ''
                        )
                      }}
                      className="w-full rounded-lg border border-primary/40 px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/10"
                    >
                      {t('calcModeSolve')} →
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {sub === 'lin2' && (
        <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
          <p className="text-center font-mono text-xs text-muted-foreground">a₁x + b₁y = c₁ · a₂x + b₂y = c₂</p>
          <div className="grid grid-cols-3 gap-2">
            <NumField id="2-a1" label="a₁" value={m2.a1} onChange={(v) => setM2({ ...m2, a1: v })} />
            <NumField id="2-b1" label="b₁" value={m2.b1} onChange={(v) => setM2({ ...m2, b1: v })} />
            <NumField id="2-c1" label="c₁" value={m2.c1} onChange={(v) => setM2({ ...m2, c1: v })} />
            <NumField id="2-a2" label="a₂" value={m2.a2} onChange={(v) => setM2({ ...m2, a2: v })} />
            <NumField id="2-b2" label="b₂" value={m2.b2} onChange={(v) => setM2({ ...m2, b2: v })} />
            <NumField id="2-c2" label="c₂" value={m2.c2} onChange={(v) => setM2({ ...m2, c2: v })} />
          </div>
          {lin2 && (
            <div className="space-y-1.5">
              {lin2.kind === 'unique' ? (
                <>
                  <ResultRow label="x" value={fmtNum(lin2.x)} />
                  <ResultRow label="y" value={fmtNum(lin2.y)} />
                  <button
                    onClick={() => record(t('solverLin2'), `x = ${fmtNum(lin2.x)}, y = ${fmtNum(lin2.y)}`)}
                    className="w-full rounded-lg border border-primary/40 px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/10"
                  >
                    {t('calcModeSolve')} →
                  </button>
                </>
              ) : (
                <ResultRow label={t('solverLin2')} value={solveLabel(lin2.kind)} tone="warn" />
              )}
            </div>
          )}
        </div>
      )}

      {sub === 'lin3' && (
        <div className="space-y-3 rounded-xl border bg-muted/20 p-3">
          <p className="text-center font-mono text-xs text-muted-foreground">aᵢx + bᵢy + cᵢz = dᵢ</p>
          <div className="space-y-2">
            {(
              [
                ['1', m3.a1, m3.b1, m3.c1, m3.d1],
                ['2', m3.a2, m3.b2, m3.c2, m3.d2],
                ['3', m3.a3, m3.b3, m3.c3, m3.d3],
              ] as const
            ).map(([r, a, b, c, d]) => (
              <div key={r} className="grid grid-cols-4 gap-2">
                <NumField id={`3-a${r}`} label={`a${r}`} value={a} onChange={(v) => setM3((s) => ({ ...s, [`a${r}`]: v }))} />
                <NumField id={`3-b${r}`} label={`b${r}`} value={b} onChange={(v) => setM3((s) => ({ ...s, [`b${r}`]: v }))} />
                <NumField id={`3-c${r}`} label={`c${r}`} value={c} onChange={(v) => setM3((s) => ({ ...s, [`c${r}`]: v }))} />
                <NumField id={`3-d${r}`} label={`d${r}`} value={d} onChange={(v) => setM3((s) => ({ ...s, [`d${r}`]: v }))} />
              </div>
            ))}
          </div>
          {lin3 && (
            <div className="space-y-1.5">
              {lin3.kind === 'unique' ? (
                <>
                  <ResultRow label="x" value={fmtNum(lin3.x)} />
                  <ResultRow label="y" value={fmtNum(lin3.y)} />
                  <ResultRow label="z" value={fmtNum(lin3.z)} />
                  <button
                    onClick={() => record(t('solverLin3'), `x = ${fmtNum(lin3.x)}, y = ${fmtNum(lin3.y)}, z = ${fmtNum(lin3.z)}`)}
                    className="w-full rounded-lg border border-primary/40 px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/10"
                  >
                    {t('calcModeSolve')} →
                  </button>
                </>
              ) : (
                <ResultRow label={t('solverLin3')} value={solveLabel(lin3.kind)} tone="warn" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function CalculatorTool() {
  const { toast } = useToast()
  const { t } = useLang()
  const [mode, setMode] = useState<'keypad' | 'solve'>('keypad')
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
            title: t('calcErrorTitle'),
            description: err instanceof Error ? err.message : t('calcErrorDesc'),
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
    [display, deg, toast, t]
  )

  /* Keyboard support */
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'keypad') return
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
  }, [press, mode])

  const keys: { label: string; key: string; cls?: string; aria?: string }[][] = [
    [
      { label: deg ? 'DEG' : 'RAD', key: 'deg', cls: 'text-xs font-bold text-primary' },
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
          {/* Mode switch: keypad ↔ solver */}
          <div className="mb-3 flex rounded-xl border bg-muted/30 p-1" role="tablist" aria-label="Calculator mode">
            {(
              [
                { id: 'keypad' as const, label: t('calcModeCalc') },
                { id: 'solve' as const, label: t('calcModeSolve') },
              ]
            ).map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => setMode(m.id)}
                className={cn(
                  'flex h-10 flex-1 items-center justify-center rounded-lg text-sm font-bold transition-colors',
                  mode === m.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'keypad' ? (
            <>
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
              {deg ? t('calcDeg') : t('calcRad')}
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
                {t('calcHistory')}
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
                <p className="py-4 text-center text-xs text-muted-foreground">{t('calcNoHistory')}</p>
              ) : (
                <ul className="space-y-1">
                  {history.map((h, i) => (
                    <li key={i}>
                      <button
                        onClick={() => {
                          if (h.kind === 'solve') setMode('keypad')
                          setDisplay(h.kind === 'solve' ? '' : h.expr)
                        }}
                        className="w-full rounded-lg px-2 py-1.5 text-right transition-colors hover:bg-accent"
                      >
                        {h.kind === 'solve' && (
                          <span className="mb-0.5 inline-block rounded-full bg-primary/10 px-1.5 text-[9px] font-bold uppercase tracking-wide text-primary">
                            {t('calcModeSolve')}
                          </span>
                        )}
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
            {t('calcKbdHint')}
          </p>
            </>
          ) : (
            <SolverPanel pushHistory={pushHistory} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
