/* ================================================================== */
/* Spotlight v3 plugins (v2.1) — offline currency conversion, color    */
/* hex preview, and unit math chaining. Pure functions, no deps,       */
/* evaluated locally on every keystroke result.                        */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/* Offline currency table (base USD). Static snapshot — good enough    */
/* for a glanceable answer, always labeled as such in the UI.          */
/* ------------------------------------------------------------------ */

const CURRENCY_RATES: Record<string, number> = {
  usd: 1, eur: 0.92, gbp: 0.79, jpy: 149.5, inr: 83.3, bdt: 109.8, pkr: 278,
  cny: 7.24, aud: 1.52, cad: 1.36, chf: 0.88, sgd: 1.34, myr: 4.72, aed: 3.67,
  sar: 3.75, qar: 3.64, try_: 32.5, rub: 92, brl: 4.97, zar: 18.7, ngn: 790,
  krw: 1320, idr: 15600, thb: 35.1, vnd: 24500, php: 55.8, hkd: 7.82, nzd: 1.64,
  sek: 10.4, nok: 10.6, dkk: 6.9, pln: 3.97, czk: 23.2, huf: 355, ils: 3.7,
  egp: 48.6, lkr: 305, npr: 133.3, mmk: 2100, kes: 129, ghs: 15.2, mad: 9.9,
  dzd: 134, tnd: 3.1, jod: 0.71, uah: 41, mxn: 17.1, ars: 350, clp: 950,
  cop: 3900, pen: 3.8, bgn: 1.8, ron: 4.58,
}

const CURRENCY_ALIASES: Record<string, string> = {
  dollar: 'usd', dollars: 'usd', '$': 'usd',
  euro: 'eur', euros: 'eur', '€': 'eur',
  sterling: 'gbp', '£': 'gbp',
  yen: 'jpy', '¥': 'jpy',
  yuan: 'cny', renminbi: 'cny',
  rupee: 'inr', rupees: 'inr',
  taka: 'bdt', takas: 'bdt',
  dirham: 'aed', dirhams: 'aed',
  riyal: 'sar', riyals: 'sar',
  won: 'krw', baht: 'thb',
  ringgit: 'myr', rupiah: 'idr',
  franc: 'chf', francs: 'chf',
  lira: 'try_',
  krona: 'sek', kroner: 'nok', krone: 'dkk',
  zloty: 'pln', koruna: 'czk', forint: 'huf',
  shekel: 'ils', shekels: 'ils',
  rand: 'zar', naira: 'ngn', cedi: 'ghs', shilling: 'kes',
  peso: 'mxn', sol: 'pen', real: 'brl', reais: 'brl',
  dinar: 'jod', dram: 'uah', lev: 'bgn', leu: 'ron',
}

/* 'try' is a reserved word as an object key — normalize it back */
function normCurrency(u: string): string | null {
  const k = u.toLowerCase().replace(/[.,]$/, '')
  const key = k === 'try' ? 'try_' : k
  const code = CURRENCY_ALIASES[key] ?? (CURRENCY_RATES[key] ? key : null)
  return code
}

export interface CurrencyResult {
  amount: number
  from: string
  to: string
  out: number
}

/** `100 usd to eur`, `50 eur in inr`, `1200 taka to usd` … */
export function evalCurrency(raw: string): CurrencyResult | null {
  const m = raw.match(/^\s*(-?[\d,.]+)\s*([a-zA-Z$€£¥]+)\s*(?:to|in|=|into)\s*([a-zA-Z$€£¥]+)\s*$/i)
  if (!m) return null
  const amount = Number(m[1].replace(/,/g, ''))
  if (Number.isNaN(amount) || !Number.isFinite(amount)) return null
  const from = normCurrency(m[2])
  const to = normCurrency(m[3])
  if (!from || !to || from === to) return null
  const usd = amount * (1 / CURRENCY_RATES[from])
  const out = usd * CURRENCY_RATES[to]
  return { amount, from: from === 'try_' ? 'try' : from, to, out }
}

/** Nice display for a currency amount. */
export function fmtCurrency(v: number, code: string): string {
  const digits = v >= 1000 ? 0 : v >= 1 ? 2 : 4
  return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

/* ------------------------------------------------------------------ */
/* Color hex preview: `#ff5500`, `ff5500`, `#f50`                      */
/* ------------------------------------------------------------------ */

export interface ColorResult {
  hex: string
  r: number
  g: number
  b: number
  h: number
  s: number
  l: number
}

export function evalColor(raw: string): ColorResult | null {
  const m = raw.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const hexRaw = m[1]
  const full =
    hexRaw.length === 3
      ? hexRaw
          .split('')
          .map((c) => c + c)
          .join('')
      : hexRaw
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  const rf = r / 255
  const gf = g / 255
  const bf = b / 255
  const max = Math.max(rf, gf, bf)
  const min = Math.min(rf, gf, bf)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) * 60
    else if (max === gf) h = ((bf - rf) / d + 2) * 60
    else h = ((rf - gf) / d + 4) * 60
  }
  return { hex: `#${full.toLowerCase()}`, r, g, b, h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }
}

/* ------------------------------------------------------------------ */
/* Unit math chaining: `2m + 30cm`, `1kg - 200g + 50g`, `3km + 2mi`    */
/* Terms share one dimension; the answer is expressed in the FIRST     */
/* term's unit.                                                        */
/* ------------------------------------------------------------------ */

export interface ChainResult {
  text: string
  value: number
  unit: string
}

export function evalUnitChain(
  raw: string,
  unitTable: Record<string, { dim: string; f: number }>,
  aliases: Record<string, string>
): ChainResult | null {
  const q = raw.trim()
  /* fast reject: needs at least one unit term and one operator */
  if (!/\d\s*[a-zA-Z°]/.test(q) || !/[+\-]/.test(q)) return null
  const norm = (u: string) => aliases[u.toLowerCase()] ?? u.toLowerCase()

  /* strict token walk: TERM (OP TERM)* — TERM = number+unit, OP = + or -;
   * anything except whitespace between tokens rejects the whole input */
  const tokenRe = /([+\-])|(-?[\d.,]+)\s*([a-zA-Z°]+)/g
  const terms: { v: number; unit: string }[] = []
  const ops: string[] = []
  let expectTerm = true
  let lastEnd = 0
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(q)) !== null) {
    if (q.slice(lastEnd, m.index).trim() !== '') return null
    if (expectTerm) {
      if (m[1] !== undefined) {
        /* leading sign — absorbed into the next term's own sign */
        lastEnd = m.index + m[0].length
        continue
      }
      const v = Number(m[2].replace(/,/g, ''))
      if (Number.isNaN(v)) return null
      const unit = norm(m[3])
      if (!unitTable[unit]) return null
      terms.push({ v, unit })
    } else {
      if (m[1] === undefined) return null
      ops.push(m[1])
    }
    expectTerm = !expectTerm
    lastEnd = m.index + m[0].length
  }
  if (q.slice(lastEnd).trim() !== '') return null
  if (terms.length < 2 || ops.length !== terms.length - 1) return null

  const dims = new Set(terms.map((t) => unitTable[t.unit].dim))
  if (dims.size !== 1) return null
  /* everything into the first term's unit */
  const first = unitTable[terms[0].unit]
  let acc = terms[0].v
  for (let i = 1; i < terms.length; i += 1) {
    const f = unitTable[terms[i].unit]
    const converted = (terms[i].v * f.f) / first.f
    acc = ops[i - 1] === '+' ? acc + converted : acc - converted
  }
  if (!Number.isFinite(acc)) return null
  return { text: q, value: acc, unit: terms[0].unit }
}
