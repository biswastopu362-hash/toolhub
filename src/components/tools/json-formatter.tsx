'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CheckCircle2, Copy, FileJson, Minimize2, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toBn } from '@/lib/bn'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* JSON parse + position extraction                                    */
/* ================================================================== */

type IndentKey = '2' | '4' | 'tab'

interface ParseOk {
  kind: 'ok'
  parsed: unknown
}
interface ParseFail {
  kind: 'fail'
  message: string
  line?: number
  col?: number
}
type ParseResult = ParseOk | ParseFail

/** "position 123" → line/column within the source text */
function positionOf(raw: string, index: number): { line: number; col: number } {
  const before = raw.slice(0, index)
  const lines = before.split('\n')
  return { line: lines.length, col: (lines[lines.length - 1]?.length ?? 0) + 1 }
}

function parseJson(raw: string): ParseResult {
  if (!raw.trim()) {
    return { kind: 'fail', message: 'ইনপুট খালি — প্রথমে কিছু JSON লিখুন বা স্যাম্পল লোড করুন।' }
  }
  try {
    return { kind: 'ok', parsed: JSON.parse(raw) }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const m = message.match(/position\s+(\d+)/i)
    if (m) {
      const pos = Number(m[1])
      if (Number.isFinite(pos) && pos >= 0 && pos <= raw.length) {
        const { line, col } = positionOf(raw, pos)
        return { kind: 'fail', message, line, col }
      }
    }
    return { kind: 'fail', message }
  }
}

const SAMPLE_JSON = `{
  "নাম": "রফিকুল ইসলাম",
  "বয়স": 34,
  "শহর": "চট্টগ্রাম",
  "ভাষা": ["বাংলা", "ইংরেজি"],
  "ঠিকানা": {
    "বিভাগ": "চট্টগ্রাম",
    "পোস্ট কোড": 4000
  },
  "সক্রিয়": true
}`

type OutputState =
  | { kind: 'ok'; text: string }
  | { kind: 'fail'; message: string; line?: number; col?: number }

export default function JsonFormatterTool() {
  const { toast } = useToast()
  const [input, setInput] = useState('')
  const [indent, setIndent] = useState<IndentKey>('2')
  const [output, setOutput] = useState<OutputState | null>(null)

  const indentArg = indent === 'tab' ? '\t' : Number(indent)

  const apply = (mode: 'pretty' | 'minify') => {
    const res = parseJson(input)
    if (res.kind === 'fail') {
      setOutput({ kind: 'fail', message: res.message, line: res.line, col: res.col })
      return
    }
    const text =
      mode === 'minify' ? JSON.stringify(res.parsed) : JSON.stringify(res.parsed, null, indentArg)
    setOutput({ kind: 'ok', text: text ?? '' })
  }

  const loadSample = () => {
    setInput(SAMPLE_JSON)
    setOutput(null)
  }

  const clearAll = () => {
    setInput('')
    setOutput(null)
  }

  const copyOutput = async () => {
    if (!output || output.kind !== 'ok') return
    try {
      await navigator.clipboard.writeText(output.text)
      toast({ title: 'কপি হয়েছে ✓', description: 'ফরম্যাট করা JSON ক্লিপবোর্ডে সংরক্ষিত হয়েছে' })
    } catch {
      toast({ title: 'কপি করা যায়নি', variant: 'destructive' })
    }
  }

  /* Stats for a successful output */
  const stats = useMemo(() => {
    if (!output || output.kind !== 'ok') return null
    const bytes = new TextEncoder().encode(output.text).length
    const lines = output.text.split('\n').length
    let keys: number | null = null
    let isArray = false
    try {
      const p: unknown = JSON.parse(output.text)
      if (p !== null && typeof p === 'object') {
        isArray = Array.isArray(p)
        keys = Object.keys(p as Record<string, unknown>).length
      }
    } catch {
      keys = null
    }
    return { bytes, lines, keys, isArray }
  }, [output])

  return (
    <div className="mx-auto max-w-2xl">
      <Card className="overflow-hidden shadow-md">
        <CardContent className="space-y-4 p-4 sm:p-5">
          {/* Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="json-input" className="text-sm font-medium">
                JSON ইনপুট
              </Label>
              <span className="text-xs text-muted-foreground">
                {input ? `${toBn(new TextEncoder().encode(input).length)} বাইট` : 'খালি'}
              </span>
            </div>
            <Textarea
              id="json-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={'{ "নাম": "মান" }'}
              className="min-h-[140px] font-mono text-sm"
              spellCheck={false}
              aria-label="JSON ইনপুট লিখুন"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => apply('pretty')} className="h-11" aria-label="JSON ফরম্যাট করুন">
              <FileJson className="h-4 w-4" />
              ফরম্যাট
            </Button>
            <Button
              variant="secondary"
              onClick={() => apply('minify')}
              className="h-11"
              aria-label="JSON মিনিফাই করুন"
            >
              <Minimize2 className="h-4 w-4" />
              মিনিফাই
            </Button>
            <Button variant="outline" onClick={loadSample} className="h-11" aria-label="নমুনা JSON লোড করুন">
              <Sparkles className="h-4 w-4" />
              স্যাম্পল লোড
            </Button>
            <Button
              variant="ghost"
              onClick={clearAll}
              className="h-11 gap-1 text-destructive hover:text-destructive"
              aria-label="সব মুছে ফেলুন"
            >
              <Trash2 className="h-4 w-4" />
              মুছুন
            </Button>

            <div className="ms-auto flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">ইনডেন্ট</Label>
              <Select value={indent} onValueChange={(v) => (v === '2' || v === '4' || v === 'tab') && setIndent(v)}>
                <SelectTrigger size="sm" className="w-[110px]" aria-label="ইনডেন্ট সাইজ নির্বাচন করুন">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">{toBn(2)} স্পেস</SelectItem>
                  <SelectItem value="4">{toBn(4)} স্পেস</SelectItem>
                  <SelectItem value="tab">ট্যাব</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Output */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">ফলাফল</Label>
              {output?.kind === 'ok' && (
                <Badge
                  variant="outline"
                  className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  বৈধ JSON ✓
                </Badge>
              )}
              {output?.kind === 'ok' && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1"
                  onClick={copyOutput}
                  aria-label="ফলাফল কপি করুন"
                >
                  <Copy className="h-3.5 w-3.5" />
                  কপি
                </Button>
              )}
            </div>

            {output?.kind === 'fail' && (
              <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertTitle>অবৈধ JSON</AlertTitle>
                <AlertDescription>
                  <p className="break-words">{output.message}</p>
                  {output.line !== undefined && output.col !== undefined && (
                    <p className="font-medium">
                      অবস্থান: লাইন {toBn(output.line)}, কলাম {toBn(output.col)}
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {output?.kind === 'ok' ? (
              <pre
                className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border bg-muted/30 p-3 font-mono text-sm leading-relaxed select-all"
                aria-label="ফরম্যাট করা JSON আউটপুট"
              >
                {output.text}
              </pre>
            ) : (
              !output && (
                <div className="flex min-h-[80px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                  ফরম্যাট, মিনিফাই বা স্যাম্পল লোড করলে ফলাফল এখানে দেখা যাবে
                </div>
              )
            )}

            {/* Stats row */}
            {stats && (
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border bg-muted/30 p-2 text-center">
                  <p className="font-mono text-sm font-bold">{toBn(stats.bytes)}</p>
                  <p className="text-[11px] text-muted-foreground">বাইট</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-2 text-center">
                  <p className="font-mono text-sm font-bold">{toBn(stats.lines)}</p>
                  <p className="text-[11px] text-muted-foreground">লাইন</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-2 text-center">
                  <p className={cn('font-mono text-sm font-bold', stats.keys === null && 'opacity-40')}>
                    {stats.keys === null ? '—' : toBn(stats.keys)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {stats.keys === null ? 'কী নেই' : stats.isArray ? 'আইটেম' : 'টপ-লেভেল কী'}
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
