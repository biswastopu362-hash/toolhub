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
import { toBn } from '@/lib/bn'

/* ================================================================== */
/* Transform helpers (work for Bengali + English)                      */
/* ================================================================== */

const wordsOf = (t: string): string[] => t.trim().split(/\s+/).filter(Boolean)

const linesOf = (t: string): string[] => t.split(/\r?\n/)

const TRANSFORMS: { label: string; icon: typeof Type; fn: (t: string) => string }[] = [
  {
    label: 'বড় হাতের',
    icon: CaseUpper,
    fn: (t) => t.toUpperCase(),
  },
  {
    label: 'ছোট হাতের',
    icon: CaseLower,
    fn: (t) => t.toLowerCase(),
  },
  {
    label: 'বাক্যের নিয়ম',
    icon: CaseSensitive,
    fn: (t) =>
      t
        .toLowerCase()
        .replace(/(^\s*|[.!?।]\s*|\n\s*)(\S)/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase()),
  },
  {
    label: 'প্রতি শব্দে বড়',
    icon: ALargeSmall,
    fn: (t) => t.replace(/(^|\s)(\S)/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase()),
  },
  {
    label: 'অতিরিক্ত স্পেস মুছুন',
    icon: Eraser,
    fn: (t) => t.replace(/\s+/g, ' ').trim(),
  },
  {
    label: 'লাইন ব্রেক মুছুন',
    icon: Combine,
    fn: (t) => t.replace(/\r?\n+/g, ' ').replace(/ {2,}/g, ' ').trim(),
  },
  {
    label: 'খালি লাইন মুছুন',
    icon: ListX,
    fn: (t) => linesOf(t).filter((l) => l.trim().length > 0).join('\n'),
  },
  {
    label: 'লাইন সাজান',
    icon: ArrowDownAZ,
    fn: (t) => linesOf(t).slice().sort((a, b) => a.localeCompare(b, 'bn')).join('\n'),
  },
  {
    label: 'ডুপ্লিকেট লাইন মুছুন',
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
    label: 'লাইন নম্বর যোগ',
    icon: ListOrdered,
    fn: (t) =>
      linesOf(t)
        .map((l, i) => `${toBn(i + 1)}. ${l}`)
        .join('\n'),
  },
  {
    label: 'উল্টো দিক',
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
      toast({ title: 'লেখা খালি', description: 'আগে কিছু লিখুন, তারপর রূপান্তর করুন', variant: 'destructive' })
      return
    }
    setText((prev) => fn(prev))
    toast({ title: 'রূপান্তর হয়েছে', description: label })
  }

  const copyResult = async () => {
    if (!text.trim()) {
      toast({ title: 'কপি করার মতো কিছু নেই', variant: 'destructive' })
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: 'কপি হয়েছে', description: 'ফলাফল ক্লিপবোর্ডে কপি করা হয়েছে' })
    } catch {
      toast({ title: 'কপি করা যায়নি', description: 'ব্রাউজার ক্লিপবোর্ড অনুমতি দিচ্ছে না', variant: 'destructive' })
    }
  }

  const clearAll = () => {
    if (!text) return
    setText('')
    toast({ title: 'সব মুছে ফেলা হয়েছে' })
  }

  const chips = [
    { label: 'অক্ষর', value: text.length, icon: Type },
    { label: 'শব্দ', value: stats.words, icon: WholeWord },
    { label: 'বাক্য', value: stats.sentences, icon: TextQuote },
    { label: 'প্যারাগ্রাফ', value: stats.paragraphs, icon: Pilcrow },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
          <CardTitle className="text-base">আপনার লেখা দিন</CardTitle>
          <CardDescription className="text-xs">
            নিচের স্ট্যাটাস ও টুলগুলো লেখা লিখলেই সাথে সাথে আপডেট হয়
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0 sm:p-5 sm:pt-0">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="এখানে লিখুন বা পেস্ট করুন — বাংলা বা English দুটোই চলবে…"
            aria-label="টেক্সট লেখার জায়গা"
            className="min-h-[140px] resize-y text-base leading-relaxed"
          />

          {/* Live stats chips */}
          <div className="flex flex-wrap gap-2" aria-live="polite">
            {chips.map((c) => (
              <Badge key={c.label} variant="secondary" className="h-8 gap-1.5 px-3 text-xs font-medium">
                <c.icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {c.label}: <span className="font-bold">{toBn(c.value.toLocaleString('en-IN'))}</span>
              </Badge>
            ))}
            <Badge variant="secondary" className="h-8 gap-1.5 px-3 text-xs font-medium">
              <Timer className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              পড়ার সময়: <span className="font-bold">{toBn(stats.readMins)} মিনিট</span>
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-4 pb-3 sm:p-5 sm:pb-3">
          <CardTitle className="text-base">রূপান্তর টুলস</CardTitle>
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
            <Button onClick={copyResult} className="h-11 flex-1 gap-2 sm:flex-none sm:px-6" aria-label="ফলাফল কপি করুন">
              <Copy className="h-4 w-4" aria-hidden="true" />
              ফলাফল কপি
            </Button>
            <Button
              variant="destructive"
              onClick={clearAll}
              className="h-11 flex-1 gap-2 sm:flex-none sm:px-6"
              aria-label="সব লেখা মুছে ফেলুন"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              সব মুছুন
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
