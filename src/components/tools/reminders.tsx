'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ClipboardList, Coffee, ListChecks, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Reminders — quick checklist with filters + progress                 */
/* Persisted locally in localStorage key 'toolhub-reminders'           */
/* ================================================================== */

interface Reminder {
  id: string
  text: string
  done: boolean
  createdAt: number
}

const REMINDERS_KEY = 'toolhub-reminders'

type Filter = 'all' | 'active' | 'completed'

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `rem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function loadReminders(): Reminder[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(REMINDERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (r): r is Reminder =>
          !!r && typeof r.id === 'string' && typeof r.text === 'string' && typeof r.done === 'boolean'
      )
      .map((r) => ({
        id: r.id,
        text: r.text,
        done: r.done,
        createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      }))
  } catch {
    return []
  }
}

function fullTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function RemindersTool() {
  const { toast } = useToast()
  const [items, setItems] = useState<Reminder[]>(loadReminders) // lazy init — safe (ssr:false)
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  // Persist on every change. No setState here — pure side effect.
  useEffect(() => {
    try {
      localStorage.setItem(REMINDERS_KEY, JSON.stringify(items))
    } catch {
      /* storage unavailable — keep in-memory only */
    }
  }, [items])

  const doneCount = useMemo(() => items.filter((i) => i.done).length, [items])
  const activeCount = items.length - doneCount
  const percent = items.length === 0 ? 0 : Math.round((doneCount / items.length) * 100)

  const visible = useMemo(
    () =>
      items.filter((i) =>
        filter === 'all' ? true : filter === 'active' ? !i.done : i.done
      ),
    [items, filter]
  )

  /* ------------------------------ actions ------------------------------ */

  const addItem = () => {
    const text = draft.trim()
    if (!text) {
      toast({
        title: 'Nothing to add',
        description: 'Type a reminder first, then press Add.',
        variant: 'destructive',
      })
      return
    }
    const item: Reminder = { id: makeId(), text, done: false, createdAt: Date.now() }
    setItems((prev) => [item, ...prev]) // newest at top, insertion order kept
    setDraft('')
    toast({ title: 'Reminder added', description: text })
  }

  const toggleItem = (id: string) => {
    const item = items.find((i) => i.id === id)
    if (!item) return
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, done: !i.done } : i)))
    toast({
      title: !item.done ? 'Marked as done' : 'Marked as active',
      description: !item.done ? 'Nice work — one less thing to do.' : item.text,
    })
  }

  const removeItem = (id: string) => {
    const item = items.find((i) => i.id === id)
    setItems((prev) => prev.filter((i) => i.id !== id))
    toast({
      title: 'Reminder deleted',
      description: item ? `“${item.text}” was removed.` : undefined,
    })
  }

  const clearCompleted = () => {
    const count = doneCount
    setItems((prev) => prev.filter((i) => !i.done))
    toast({
      title: `Cleared ${count} completed reminder${count === 1 ? '' : 's'}`,
    })
  }

  /* ------------------------------ render ------------------------------ */

  return (
    <div className="space-y-4">
      {/* Add row */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          addItem()
        }}
        className="flex gap-2"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a reminder…"
          aria-label="New reminder text"
          maxLength={200}
          className="h-11 flex-1"
        />
        <Button type="submit" className="h-11 shrink-0" aria-label="Add reminder">
          <Plus className="size-4" aria-hidden />
          Add
        </Button>
      </form>

      {/* Progress */}
      {items.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              <span className="font-semibold text-foreground">{doneCount}</span> of{' '}
              <span className="font-semibold text-foreground">{items.length}</span> completed
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">{percent}%</p>
          </div>
          <Progress
            value={percent}
            className="h-1.5"
            aria-label={`${percent}% of reminders completed`}
          />
        </div>
      )}

      {/* Filter tabs + clear completed */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList className="h-11 w-full sm:w-auto" aria-label="Filter reminders">
            <TabsTrigger value="all" className="flex-1 gap-1.5 px-3 sm:flex-none sm:px-4">
              All
              <Badge variant="secondary" className="px-1.5 tabular-nums">
                {items.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="active" className="flex-1 gap-1.5 px-3 sm:flex-none sm:px-4">
              Active
              <Badge variant="secondary" className="px-1.5 tabular-nums">
                {activeCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="completed" className="flex-1 gap-1.5 px-3 sm:flex-none sm:px-4">
              Completed
              <Badge variant="secondary" className="px-1.5 tabular-nums">
                {doneCount}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {doneCount > 0 && (
          <Button
            variant="outline"
            onClick={clearCompleted}
            className="h-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden />
            Clear completed
          </Button>
        )}
      </div>

      <Separator />

      {/* List */}
      {visible.length > 0 ? (
        <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1" aria-label="Reminders list">
          {visible.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors',
                item.done && 'bg-muted/40'
              )}
            >
              <Checkbox
                checked={item.done}
                onCheckedChange={() => toggleItem(item.id)}
                aria-label={
                  item.done
                    ? `Mark "${item.text}" as not done`
                    : `Mark "${item.text}" as done`
                }
                className="size-5 shrink-0"
              />
              <span
                className={cn(
                  'min-w-0 flex-1 break-words text-sm leading-snug',
                  item.done && 'text-muted-foreground line-through'
                )}
                title={fullTimestamp(item.createdAt)}
              >
                {item.text}
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeItem(item.id)}
                aria-label="Delete reminder"
                className="size-9 shrink-0 rounded-lg text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState filter={filter} hasItems={items.length > 0} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Empty states (per filter)                                           */
/* ------------------------------------------------------------------ */

function EmptyState({ filter, hasItems }: { filter: Filter; hasItems: boolean }) {
  if (filter === 'completed') {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center sm:p-12">
          <span className="flex size-16 items-center justify-center rounded-full bg-muted">
            <ListChecks className="size-8 text-muted-foreground" aria-hidden />
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">No completed reminders yet</h2>
            <p className="text-sm text-muted-foreground">
              {hasItems
                ? 'Check off a reminder and it will show up here.'
                : 'Complete your first reminder to see it here.'}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (filter === 'active') {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center sm:p-12">
          <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Coffee className="size-8 text-primary" aria-hidden />
          </span>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Nothing here — enjoy your day!</h2>
            <p className="text-sm text-muted-foreground">
              {hasItems
                ? 'Every reminder is done. Time for a break.'
                : 'Add a reminder above and it will appear here.'}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 p-8 text-center sm:p-12">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
          <ClipboardList className="size-8 text-primary" aria-hidden />
        </span>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Nothing here yet</h2>
          <p className="text-sm text-muted-foreground">
            Add your first reminder above — it stays on this device.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
