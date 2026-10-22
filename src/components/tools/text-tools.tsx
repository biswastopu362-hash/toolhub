'use client'

import { useMemo, useState } from 'react'
import {
  ALargeSmall,
  ArrowDownAZ,
  ArrowLeftRight,
  CaseLower,
  CaseSensitive,
  CaseUpper,
  Combine,
  Copy,
  CopyX,
  Eraser,
  ListOrdered,
  ListX,
  Pilcrow,
  TextQuote,
  Timer,
  Trash2,
  Type,
  WholeWord,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Transform helpers (script-agnostic; sentence enders include ।)      */
/* ================================================================== */

const wordsOf = (t: string): string[] => t.trim().split(/\s+/).filter(Boolean)

const linesOf = (t: string): string[] => t.split(/\r?\n/)

const TRANSFORMS: { label: string; icon: typeof Type; fn: (t: string) => string }[] = [
  {
    label: 'UPPERCASE',
    icon: CaseUpper,
    fn: (t) => t.toUpperCase(),
  },
  {
    label: 'lowercase',
    icon: CaseLower,
    fn: (t) => t.toLowerCase(),
  },
  {
    label: 'Sentence case',
    icon: CaseSensitive,
    fn: (t) =>
      t
        .toLowerCase()
        .replace(/(^\s*|[.!?।]\s*|\n\s*)(\S)/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase()),
  },
  {
    label: 'Title Case',
    icon: ALargeSmall,
    fn: (t) => t.replace(/(^|\s)(\S)/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase()),
  },
  {
    label: 'Remove extra spaces',
    icon: Eraser,
    fn: (t) => t.replace(/\s+/g, ' ').trim(),
  },
  {
    label: 'Remove line breaks',
    icon: Combine,
    fn: (t) => t.replace(/\r?\n+/g, ' ').replace(/ {2,}/g, ' ').trim(),
  },
  {
    label: 'Remove empty lines',
    icon: ListX,
    fn: (t) => linesOf(t).filter((l) => l.trim().length > 0).join('\n'),
  },
  {
    label: 'Sort lines',
    icon: ArrowDownAZ,
    fn: (t) => linesOf(t).slice().sort((a, b) => a.localeCompare(b, 'bn')).join('\n'),
  },
  {
    label: 'Remove duplicate lines',
    icon: CopyX,
    fn: (t) => {
      const seen = new Set<string>()
      return linesOf(t)
        .filter((l) => {
          if (seen.has(l)) return false
          seen.add(l)
          return true
        })
        .join('\n')
    },
  },
  {
    label: 'Add line numbers',
    icon: ListOrdered,
    fn: (t) =>
      linesOf(t)
        .map((l, i) => `${i + 1}. ${l}`)
        .join('\n'),
  },
  {
    label: 'Reverse text',
    icon: ArrowLeftRight,
    fn: (t) => Array.from(t).reverse().join(''),
  },
]

/* ================================================================== */
/* UI                                                                  */
/* ================================================================== */

export default function TextToolsTool() {
  const { toast } = useToast()
  const [text, setText] = useState('')

  const stats = useMemo(() => {
    const words = wordsOf(text).length
    const trimmed = text.trim()
    const sentences = trimmed
      ? trimmed.split(/[.!?।]+/).filter((s) => s.trim().length > 0).length
      : 0
    const paragraphs = trimmed
      ? trimmed.split(/\n+/).filter((p) => p.trim().length > 0).length
      : 0
    const readMins = words === 0 ? 0 : Math.max(1, Math.ceil(words / 200))
    return { words, sentences, paragraphs, readMins }
  }, [text])

  const applyTransform = (fn: (t: string) => string, label: string) => {
    if (!text.trim()) {
      toast({ title: 'Text is empty', description: 'Type or paste some text first', variant: 'destructive' })
      return
    }
    setText((prev) => fn(prev))
    toast({ title: 'Transform applied', description: label })
  }

  const copyResult = async () => {
    if (!text.trim()) {
      toast({ title: 'Nothing to copy', variant: 'destructive' })
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: 'Copied', description: 'Result copied to clipboard' })
    } catch {
      toast({ title: 'Copy failed', description: 'Browser clipboard access was denied', variant: 'destructive' })
    }
  }

  const clearAll = () => {
    if (!text) return
    setText('')
    toast({ title: 'Cleared' })
  }

  const chips = [
    { label: 'Characters', value: text.length, icon: Type },
    { label: 'Words', value: stats.words, icon: WholeWord },
    { label: 'Sentences', value: stats.sentences, icon: TextQuote },
    { label: 'Paragraphs', value: stats.paragraphs, icon: Pilcrow },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
          <CardTitle className="text-base">Enter your text</CardTitle>
          <CardDescription className="text-xs">
            Stats and tools below update live as you type
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0 sm:p-5 sm:pt-0">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type or paste your text here — any language works…"
            aria-label="Text input"
            className="min-h-[140px] resize-y text-base leading-relaxed"
          />

          {/* Live stats chips */}
          <div className="flex flex-wrap gap-2" aria-live="polite">
            {chips.map((c) => (
              <Badge key={c.label} variant="secondary" className="h-8 gap-1.5 px-3 text-xs font-medium">
                <c.icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {c.label}: <span className="font-bold">{c.value.toLocaleString('en-US')}</span>
              </Badge>
            ))}
            <Badge variant="secondary" className="h-8 gap-1.5 px-3 text-xs font-medium">
              <Timer className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              Read time: <span className="font-bold">{stats.readMins} min</span>
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
          <CardTitle className="text-base">Transform tools</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0 sm:p-5 sm:pt-0">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {TRANSFORMS.map((t) => (
              <Button
                key={t.label}
                variant="outline"
                onClick={() => applyTransform(t.fn, t.label)}
                aria-label={t.label}
                className="h-11 justify-start gap-2 px-3 text-xs sm:text-sm"
              >
                <t.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate">{t.label}</span>
              </Button>
            ))}
          </div>

          <Separator />

          <div className="flex flex-wrap gap-2">
            <Button onClick={copyResult} className="h-11 flex-1 gap-2 sm:flex-none sm:px-6" aria-label="Copy result">
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy Result
            </Button>
            <Button
              variant="destructive"
              onClick={clearAll}
              className="h-11 flex-1 gap-2 sm:flex-none sm:px-6"
              aria-label="Clear all text"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Clear All
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
