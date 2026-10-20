'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  ArrowLeft,
  Check,
  Loader2,
  NotebookPen,
  Plus,
  Search,
  SearchX,
  StickyNote,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Notes — personal notebook with list + editor views                  */
/* Persisted locally in localStorage key 'toolhub-notes'               */
/* ================================================================== */

interface Note {
  id: string
  title: string
  body: string
  updatedAt: number
}

const NOTES_KEY = 'toolhub-notes'
const AUTOSAVE_DELAY = 400

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function loadNotes(): Note[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (n): n is Note =>
          !!n &&
          typeof n.id === 'string' &&
          typeof n.title === 'string' &&
          typeof n.body === 'string' &&
          typeof n.updatedAt === 'number'
      )
      .map((n) => ({ id: n.id, title: n.title, body: n.body, updatedAt: n.updatedAt }))
  } catch {
    return []
  }
}

function persistNotes(notes: Note[]) {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(notes))
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

/** Relative time: just now / Xm ago / Xh ago / Xd ago / short date */
function relativeTime(ts: number): string {
  const diffMin = Math.floor((Date.now() - ts) / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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

type SaveState = 'saved' | 'saving'

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function NotesTool() {
  const { toast } = useToast()
  const [notes, setNotes] = useState<Note[]>(loadNotes) // lazy init — safe (ssr:false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Debounced auto-save: every change (edit / create / delete) is written
  // 400ms after the last mutation. setState only inside the timer callback.
  useEffect(() => {
    const timer = setTimeout(() => {
      persistNotes(notes)
      setSaveState('saved')
    }, AUTOSAVE_DELAY)
    return () => clearTimeout(timer)
  }, [notes])

  const selected = useMemo(
    () => (selectedId ? (notes.find((n) => n.id === selectedId) ?? null) : null),
    [notes, selectedId]
  )

  const filtered = useMemo(() => {
    const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
    )
  }, [notes, query])

  /* ------------------------------ actions ------------------------------ */

  const handleCreate = () => {
    const note: Note = { id: makeId(), title: '', body: '', updatedAt: Date.now() }
    const next = [note, ...notes]
    setNotes(next)
    persistNotes(next)
    setSaveState('saved')
    setSelectedId(note.id)
    requestAnimationFrame(() => titleInputRef.current?.focus())
  }

  const handleEdit = (id: string, patch: Partial<Omit<Note, 'id' | 'updatedAt'>>) => {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n))
    )
    setSaveState('saving')
  }

  const handleDelete = (id: string) => {
    const target = notes.find((n) => n.id === id)
    const next = notes.filter((n) => n.id !== id)
    setNotes(next)
    persistNotes(next)
    setSaveState('saved')
    setSelectedId(null)
    toast({
      title: 'Note deleted',
      description: target?.title.trim()
        ? `“${target.title.trim()}” was removed.`
        : 'Your note was removed.',
    })
  }

  /* ------------------------------ render ------------------------------ */

  return (
    <div className="space-y-4">
      {selected ? (
        <NoteEditor
          note={selected}
          saveState={saveState}
          titleInputRef={titleInputRef}
          onChange={handleEdit}
          onBack={() => setSelectedId(null)}
          onDelete={handleDelete}
        />
      ) : (
        <NotesList
          notes={filtered}
          totalCount={notes.length}
          query={query}
          onQueryChange={setQuery}
          onOpen={setSelectedId}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* List view                                                           */
/* ------------------------------------------------------------------ */

function NotesList({
  notes,
  totalCount,
  query,
  onQueryChange,
  onOpen,
  onCreate,
}: {
  notes: Note[]
  totalCount: number
  query: string
  onQueryChange: (q: string) => void
  onOpen: (id: string) => void
  onCreate: () => void
}) {
  const hasNotes = totalCount > 0
  const searching = query.trim().length > 0

  return (
    <div className="space-y-4">
      {/* Toolbar: search + new note */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search notes"
            aria-label="Search notes"
            className="h-11 pl-9"
          />
        </div>
        <Button
          onClick={onCreate}
          className="h-11 w-full sm:w-auto"
          aria-label="Create a new note"
        >
          <Plus className="size-4" aria-hidden />
          New note
        </Button>
      </div>

      {/* Count hint */}
      {hasNotes && (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {searching
            ? `${notes.length} of ${totalCount} note${totalCount === 1 ? '' : 's'} match${notes.length === 1 ? 'es' : ''}`
            : `${totalCount} note${totalCount === 1 ? '' : 's'} · saved on this device`}
        </p>
      )}

      {/* Empty state: no notes at all */}
      {!hasNotes && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center sm:p-12">
            <span className="flex size-16 items-center justify-center rounded-full bg-primary/10">
              <StickyNote className="size-8 text-primary" aria-hidden />
            </span>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">No notes yet</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                Capture ideas, to-dos and thoughts — everything stays private on this device.
              </p>
            </div>
            <Button onClick={onCreate} className="mt-1 h-11">
              <Plus className="size-4" aria-hidden />
              Create your first note
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty state: search found nothing */}
      {hasNotes && notes.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center sm:p-12">
            <span className="flex size-16 items-center justify-center rounded-full bg-muted">
              <SearchX className="size-8 text-muted-foreground" aria-hidden />
            </span>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">No notes match “{query.trim()}”</h2>
              <p className="text-sm text-muted-foreground">
                Try a different keyword or clear the search.
              </p>
            </div>
            <Button variant="outline" onClick={() => onQueryChange('')} className="mt-1 h-11">
              Clear search
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Notes grid */}
      {notes.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => {
            const snippet = note.body.trim()
            return (
              <button
                key={note.id}
                type="button"
                onClick={() => onOpen(note.id)}
                className="w-full rounded-xl text-left outline-none transition-transform duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label={`Open note: ${note.title.trim() || 'Untitled'}`}
              >
                <Card className="h-full transition-colors hover:border-primary/40">
                  <CardContent className="flex h-full min-h-28 flex-col gap-1.5 p-4">
                    <span className="truncate font-semibold">
                      {note.title.trim() || 'Untitled'}
                    </span>
                    <span
                      className={cn(
                        'line-clamp-2 text-sm',
                        snippet ? 'text-muted-foreground' : 'text-muted-foreground/60 italic'
                      )}
                    >
                      {snippet || 'No additional text'}
                    </span>
                    <span
                      className="mt-auto pt-1.5 text-xs text-muted-foreground/70"
                      title={fullTimestamp(note.updatedAt)}
                    >
                      {relativeTime(note.updatedAt)}
                    </span>
                  </CardContent>
                </Card>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Editor view                                                         */
/* ------------------------------------------------------------------ */

function NoteEditor({
  note,
  saveState,
  titleInputRef,
  onChange,
  onBack,
  onDelete,
}: {
  note: Note
  saveState: SaveState
  titleInputRef: RefObject<HTMLInputElement | null>
  onChange: (id: string, patch: Partial<Omit<Note, 'id' | 'updatedAt'>>) => void
  onBack: () => void
  onDelete: (id: string) => void
}) {
  const body = note.body
  const charCount = body.length
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0
  const displayTitle = note.title.trim() || 'Untitled'

  return (
    <div className="space-y-3">
      {/* Toolbar: back + save indicator + delete */}
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          aria-label="Back to notes"
          className="size-11 shrink-0 rounded-xl"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </Button>

        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors',
            saveState === 'saving' ? 'text-muted-foreground' : 'text-emerald-600 dark:text-emerald-400'
          )}
          role="status"
          aria-live="polite"
        >
          {saveState === 'saving' ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Saving…
            </>
          ) : (
            <>
              <Check className="size-3.5" aria-hidden />
              Saved
            </>
          )}
        </span>

        <div className="ml-auto">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete note"
                className="size-11 shrink-0 rounded-xl text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-5" aria-hidden />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this note?</AlertDialogTitle>
                <AlertDialogDescription>
                  “{displayTitle}” will be permanently removed from this device. This action
                  cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className={cn(
                    'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/40'
                  )}
                  onClick={() => onDelete(note.id)}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* Title — bold, borderless */}
      <Input
        ref={titleInputRef}
        value={note.title}
        onChange={(e) => onChange(note.id, { title: e.target.value })}
        placeholder="Title"
        aria-label="Note title"
        className="h-auto border-0 bg-transparent px-0 text-xl font-bold shadow-none focus-visible:border-0 focus-visible:ring-0 md:text-2xl"
      />

      {/* Meta row */}
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <span title={fullTimestamp(note.updatedAt)}>Edited {relativeTime(note.updatedAt)}</span>
        <span aria-hidden>·</span>
        <span>{charCount.toLocaleString('en-US')} characters</span>
        <span aria-hidden>·</span>
        <span>{wordCount.toLocaleString('en-US')} words</span>
      </p>

      {/* Body */}
      <Textarea
        value={note.body}
        onChange={(e) => onChange(note.id, { body: e.target.value })}
        placeholder="Start writing…"
        aria-label="Note body"
        className="min-h-[320px] resize-y text-[15px] leading-relaxed"
      />

      {/* Hint */}
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <NotebookPen className="size-3.5" aria-hidden />
        Changes are saved automatically to this device.
      </p>
    </div>
  )
}
