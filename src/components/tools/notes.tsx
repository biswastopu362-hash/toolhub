'use client'

/**
 * Notes v2 — folders, pins, colors, markdown-lite and export.
 *
 * Organize notes into folders, pin the important ones, tint them with
 * six colors, write in markdown-lite and preview it live, and export any
 * note as a .md file. Everything stays in localStorage — private, offline.
 * v1 notes (id/title/body/updatedAt) are migrated in place automatically.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import {
  ArrowLeft,
  Check,
  Download,
  Folder as FolderIcon,
  FolderPlus,
  Inbox,
  Loader2,
  NotebookPen,
  PenLine,
  Pin,
  Plus,
  Search,
  SearchX,
  StickyNote,
  Trash2,
  X,
  Eye,
} from 'lucide-react'
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
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type ColorId = 'default' | 'amber' | 'emerald' | 'sky' | 'rose' | 'violet'

interface Note {
  id: string
  title: string
  body: string
  createdAt: number
  updatedAt: number
  /** null = Unfiled */
  folderId: string | null
  pinned: boolean
  colorId: ColorId
}

interface Folder {
  id: string
  name: string
  emoji: string
}

const NOTES_KEY = 'toolhub-notes'
const FOLDERS_KEY = 'toolhub-notes-folders'
const AUTOSAVE_DELAY = 400

const NOTE_COLORS: { id: ColorId; name: string; hex: string; card: string }[] = [
  { id: 'default', name: 'Default', hex: '#a1a1aa', card: 'border-white/10 bg-white/[0.03]' },
  { id: 'amber', name: 'Amber', hex: '#fbbf24', card: 'border-amber-400/25 bg-amber-500/[0.08]' },
  { id: 'emerald', name: 'Emerald', hex: '#34d399', card: 'border-emerald-400/25 bg-emerald-500/[0.08]' },
  { id: 'sky', name: 'Sky', hex: '#38bdf8', card: 'border-sky-400/25 bg-sky-500/[0.08]' },
  { id: 'rose', name: 'Rose', hex: '#fb7185', card: 'border-rose-400/25 bg-rose-500/[0.08]' },
  { id: 'violet', name: 'Violet', hex: '#a78bfa', card: 'border-violet-400/25 bg-violet-500/[0.08]' },
]

function colorOf(id: ColorId): (typeof NOTE_COLORS)[number] {
  return NOTE_COLORS.find((c) => c.id === id) ?? NOTE_COLORS[0]
}

const FOLDER_EMOJIS = ['📁', '💼', '🏠', '💡', '🎯', '📚', '🛒', '✈️']

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `note-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/* ================================================================== */
/* Persistence — v1 → v2 migration happens in place                    */
/* ================================================================== */

function loadNotes(): Note[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(NOTES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (n): n is Partial<Note> & { id: string; title: string; body: string; updatedAt: number } =>
          !!n && typeof n.id === 'string' && typeof n.title === 'string' && typeof n.body === 'string' && typeof n.updatedAt === 'number'
      )
      .map((n) => ({
        id: n.id,
        title: n.title,
        body: n.body,
        createdAt: typeof n.createdAt === 'number' ? n.createdAt : n.updatedAt,
        updatedAt: n.updatedAt,
        folderId: typeof n.folderId === 'string' ? n.folderId : null,
        pinned: n.pinned === true,
        colorId: NOTE_COLORS.some((c) => c.id === n.colorId) ? (n.colorId as ColorId) : 'default',
      }))
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

function loadFolders(): Folder[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(FOLDERS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (f): f is Folder => !!f && typeof f.id === 'string' && typeof f.name === 'string'
    )
  } catch {
    return []
  }
}

function persistFolders(folders: Folder[]) {
  try {
    localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders))
  } catch {
    /* storage unavailable — keep in-memory only */
  }
}

/* ---------------- time + export helpers ---------------- */

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

function exportNote(note: Note) {
  const title = note.title.trim() || 'Untitled'
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'note'
  const front = `# ${title}\n\n`
  const blob = new Blob([front + note.body], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${slug}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

type SaveState = 'saved' | 'saving'

/* ================================================================== */
/* Markdown-lite preview                                               */
/* ================================================================== */

function MarkdownLite({ text }: { text: string }) {
  return (
    <div
      className={cn(
        'break-words text-[15px] leading-relaxed text-zinc-200',
        '[&_a]:font-medium [&_a]:text-amber-300 [&_a]:underline [&_a]:underline-offset-2',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-white/15 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-400',
        '[&_code]:rounded-md [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px]',
        '[&_em]:italic',
        '[&_h1]:mb-1 [&_h1]:mt-3 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:text-white',
        '[&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-white',
        '[&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-white',
        '[&_h1:first-child]:mt-0 [&_h2:first-child]:mt-0 [&_h3:first-child]:mt-0',
        '[&_hr]:my-3 [&_hr]:border-white/10',
        '[&_li]:my-0.5 [&_li>p]:my-0',
        '[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_ol]:pl-5',
        '[&_p]:my-1.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
        '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-white/10 [&_pre]:bg-black/40 [&_pre]:p-3 [&_pre]:text-xs',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12px]',
        '[&_strong]:font-semibold [&_strong]:text-white',
        '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:space-y-0.5 [&_ul]:pl-5'
      )}
    >
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  )
}

/* ================================================================== */
/* Main component                                                      */
/* ================================================================== */

export default function NotesTool() {
  const { toast } = useToast()
  const [notes, setNotes] = useState<Note[]>(loadNotes) // lazy init — safe (ssr:false)
  const [folders, setFolders] = useState<Folder[]>(loadFolders)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [activeFolder, setActiveFolder] = useState<'all' | 'unfiled' | string>('all')
  const [manageOpen, setManageOpen] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // Debounced auto-save for notes: every change (edit / create / delete / pin /
  // color / move) is written 400ms after the last mutation.
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

  /* search is global — it ignores the folder filter on purpose */
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt)
    if (!q) return sorted
    return sorted.filter(
      (n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)
    )
  }, [notes, query])

  const searching = query.trim().length > 0

  const visibleNotes = useMemo(() => {
    if (searching) return searchResults
    if (activeFolder === 'all') return searchResults
    if (activeFolder === 'unfiled') return searchResults.filter((n) => !n.folderId)
    return searchResults.filter((n) => n.folderId === activeFolder)
  }, [searching, searchResults, activeFolder])

  const pinnedNotes = useMemo(() => visibleNotes.filter((n) => n.pinned), [visibleNotes])
  const otherNotes = useMemo(() => visibleNotes.filter((n) => !n.pinned), [visibleNotes])

  /* ------------------------------ actions ------------------------------ */

  const handleCreate = () => {
    const now = Date.now()
    const note: Note = {
      id: makeId(),
      title: '',
      body: '',
      createdAt: now,
      updatedAt: now,
      folderId: activeFolder === 'all' || activeFolder === 'unfiled' ? null : activeFolder,
      pinned: false,
      colorId: 'default',
    }
    setNotes((prev) => [note, ...prev])
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
    setNotes((prev) => prev.filter((n) => n.id !== id))
    setSelectedId(null)
    toast({
      title: 'Note deleted',
      description: target?.title.trim()
        ? `“${target.title.trim()}” was removed.`
        : 'Your note was removed.',
    })
  }

  const handleExport = (note: Note) => {
    try {
      exportNote(note)
      toast({ title: 'Note exported', description: 'Saved as a .md file on this device.' })
    } catch {
      toast({ title: 'Export failed', description: 'The browser blocked the download.' })
    }
  }

  /* ------------------------------ render ------------------------------ */

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {selected ? (
          <NoteEditor
            note={selected}
            folders={folders}
            saveState={saveState}
            titleInputRef={titleInputRef}
            onChange={handleEdit}
            onBack={() => setSelectedId(null)}
            onDelete={handleDelete}
            onExport={handleExport}
          />
        ) : (
          <NotesList
            notes={notes}
            pinned={pinnedNotes}
            others={otherNotes}
            folders={folders}
            activeFolder={activeFolder}
            onFolderChange={setActiveFolder}
            manageOpen={manageOpen}
            onManageOpenChange={setManageOpen}
            onFoldersChange={(next) => {
              setFolders(next)
              persistFolders(next)
            }}
            onDeleteFolder={(id) => {
              setFolders((prev) => {
                const next = prev.filter((f) => f.id !== id)
                persistFolders(next)
                return next
              })
              // notes fall back to Unfiled (no updatedAt bump — content unchanged)
              setNotes((prev) => prev.map((n) => (n.folderId === id ? { ...n, folderId: null } : n)))
              if (activeFolder === id) setActiveFolder('all')
            }}
            searchQuery={query}
            onQueryChange={setQuery}
            searching={searching}
            onOpen={setSelectedId}
            onCreate={handleCreate}
          />
        )}
      </motion.div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* List view                                                           */
/* ------------------------------------------------------------------ */

function NotesList({
  notes: allNotes,
  pinned,
  others,
  folders,
  activeFolder,
  onFolderChange,
  manageOpen,
  onManageOpenChange,
  onFoldersChange,
  onDeleteFolder,
  searchQuery,
  onQueryChange,
  searching,
  onOpen,
  onCreate,
}: {
  /** full notes array (counts + folder cleanup) */
  notes: Note[]
  pinned: Note[]
  others: Note[]
  folders: Folder[]
  activeFolder: 'all' | 'unfiled' | string
  onFolderChange: (f: 'all' | 'unfiled' | string) => void
  manageOpen: boolean
  onManageOpenChange: (open: boolean) => void
  onFoldersChange: (folders: Folder[]) => void
  /** remove folder; parent moves its notes to Unfiled */
  onDeleteFolder: (id: string) => void
  searchQuery: string
  onQueryChange: (q: string) => void
  searching: boolean
  onOpen: (id: string) => void
  onCreate: () => void
}) {
  const { toast } = useToast()
  const hasNotes = allNotes.length > 0
  const shownCount = pinned.length + others.length
  const activeLabel =
    activeFolder === 'all'
      ? 'All notes'
      : activeFolder === 'unfiled'
        ? 'Unfiled'
        : (folders.find((f) => f.id === activeFolder)?.name ?? 'All notes')

  return (
    <>
      {/* ---------------- Header ---------------- */}
      <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-amber-500/[0.09] via-transparent to-yellow-500/[0.06] px-5 py-5">
        <div className="flex items-center gap-4">
          <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-300 via-amber-400 to-yellow-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(251_191_36/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
            <StickyNote className="size-7" strokeWidth={1.9} aria-hidden />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold tracking-tight">Notes</h2>
            <p className="text-xs text-zinc-400">Folders, pins, markdown &amp; export — all on-device.</p>
          </div>
          <Button
            onClick={onCreate}
            className="h-10 shrink-0 rounded-xl bg-gradient-to-r from-amber-300 to-yellow-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-200 hover:to-yellow-400"
          >
            <Plus className="size-4" aria-hidden /> New
          </Button>
        </div>

        {/* Folder chips */}
        <div className="no-scrollbar mt-4 flex items-center gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="Folders">
          {(
            [
              { id: 'all', label: 'All', emoji: '', count: allNotes.length },
              { id: 'unfiled', label: 'Unfiled', emoji: '📥', count: allNotes.filter((n) => !n.folderId).length },
            ] as const
          ).map((chip) => (
            <button
              key={chip.id}
              onClick={() => onFolderChange(chip.id)}
              role="tab"
              aria-selected={activeFolder === chip.id}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all',
                activeFolder === chip.id
                  ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                  : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
              )}
            >
              {chip.label}
              <span className="text-[10px] tabular-nums opacity-70">{chip.count}</span>
            </button>
          ))}
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => onFolderChange(f.id)}
              role="tab"
              aria-selected={activeFolder === f.id}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all',
                activeFolder === f.id
                  ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                  : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
              )}
            >
              <span aria-hidden>{f.emoji}</span>
              {f.name}
              <span className="text-[10px] tabular-nums opacity-70">
                {allNotes.filter((n) => n.folderId === f.id).length}
              </span>
            </button>
          ))}
          <button
            onClick={() => onManageOpenChange(true)}
            aria-label="Manage folders"
            className="flex h-8 shrink-0 items-center gap-1 rounded-full border border-dashed border-white/15 px-3 text-xs font-semibold text-zinc-400 transition-colors hover:border-amber-400/40 hover:text-amber-300"
          >
            <FolderPlus className="size-3.5" aria-hidden /> Manage
          </button>
        </div>
      </div>

      {/* ---------------- Body ---------------- */}
      <div className="space-y-4 p-4 sm:p-5">
        {/* Search */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-zinc-500"
            aria-hidden
          />
          <Input
            value={searchQuery}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search all notes…"
            aria-label="Search notes"
            className="h-11 rounded-xl border-white/10 bg-white/5 pl-10 text-zinc-100 placeholder:text-zinc-500 focus-visible:border-amber-400/50 focus-visible:ring-0"
          />
        </div>

        {hasNotes && (
          <p className="text-xs text-zinc-500" aria-live="polite">
            {searching
              ? `${shownCount} of ${allNotes.length} note${allNotes.length === 1 ? '' : 's'} match${shownCount === 1 ? 'es' : ''} · searching everywhere`
              : `${activeLabel} · ${shownCount} note${shownCount === 1 ? '' : 's'} · saved on this device`}
          </p>
        )}

        {/* Empty state: no notes at all */}
        {!hasNotes && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-14 text-center">
            <StickyNote className="size-10 text-zinc-600" aria-hidden />
            <p className="text-sm font-semibold text-zinc-300">No notes yet</p>
            <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
              Capture ideas, to-dos and thoughts. Organize with folders and colors — everything stays
              private on this device.
            </p>
            <Button
              onClick={onCreate}
              className="mt-1 h-11 rounded-xl bg-gradient-to-r from-amber-300 to-yellow-500 font-semibold text-zinc-950 hover:from-amber-200 hover:to-yellow-400"
            >
              <Plus className="size-4" aria-hidden /> Create your first note
            </Button>
          </div>
        )}

        {/* Empty state: search found nothing */}
        {hasNotes && searching && shownCount === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
            <SearchX className="size-10 text-zinc-600" aria-hidden />
            <p className="text-sm font-semibold text-zinc-300">No notes match “{searchQuery.trim()}”</p>
            <p className="text-xs text-zinc-500">Try a different keyword or clear the search.</p>
            <Button
              variant="outline"
              onClick={() => onQueryChange('')}
              className="mt-1 h-11 rounded-xl border-white/15 bg-transparent text-zinc-200 hover:bg-white/10 hover:text-white"
            >
              Clear search
            </Button>
          </div>
        )}

        {/* Empty state: folder has nothing */}
        {hasNotes && !searching && shownCount === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
            {activeFolder === 'unfiled' ? (
              <Inbox className="size-10 text-zinc-600" aria-hidden />
            ) : (
              <FolderIcon className="size-10 text-zinc-600" aria-hidden />
            )}
            <p className="text-sm font-semibold text-zinc-300">
              {activeFolder === 'unfiled' ? 'Nothing unfiled' : `“${activeLabel}” is empty`}
            </p>
            <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
              New notes you create here land in this folder automatically.
            </p>
            <Button
              onClick={onCreate}
              className="mt-1 h-11 rounded-xl bg-gradient-to-r from-amber-300 to-yellow-500 font-semibold text-zinc-950 hover:from-amber-200 hover:to-yellow-400"
            >
              <Plus className="size-4" aria-hidden /> New note here
            </Button>
          </div>
        )}

        {/* Pinned section */}
        {pinned.length > 0 && (
          <section aria-label="Pinned notes">
            <p className="mb-2 flex items-center gap-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <Pin className="size-3 text-amber-400" aria-hidden /> Pinned
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {pinned.map((note) => (
                <NoteCard key={note.id} note={note} folders={folders} onOpen={onOpen} />
              ))}
            </div>
          </section>
        )}

        {/* Everything else */}
        {others.length > 0 && (
          <section aria-label="Notes">
            {pinned.length > 0 && (
              <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Notes
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {others.map((note) => (
                <NoteCard key={note.id} note={note} folders={folders} onOpen={onOpen} />
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ---------------- Manage folders modal ---------------- */}
      <ManageFolders
        open={manageOpen}
        onOpenChange={onManageOpenChange}
        folders={folders}
        notes={allNotes}
        onFoldersChange={onFoldersChange}
        onDeleteFolder={onDeleteFolder}
        toast={toast}
      />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Note card                                                           */
/* ------------------------------------------------------------------ */

function NoteCard({
  note,
  folders,
  onOpen,
}: {
  note: Note
  folders: Folder[]
  onOpen: (id: string) => void
}) {
  const snippet = note.body.trim().replace(/^#+\s+/gm, '').replace(/[*_`>]/g, '')
  const color = colorOf(note.colorId)
  const folder = note.folderId ? folders.find((f) => f.id === note.folderId) : null

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(note.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(note.id)
        }
      }}
      aria-label={`Open note: ${note.title.trim() || 'Untitled'}`}
      className={cn(
        'flex h-full min-h-28 cursor-pointer flex-col gap-1.5 rounded-2xl border p-4 outline-none transition-all duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-amber-400/60',
        color.card
      )}
    >
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-zinc-100">
          {note.title.trim() || 'Untitled'}
        </span>
        {note.pinned && <Pin className="mt-0.5 size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Pinned" />}
      </span>
      <span
        className={cn(
          'line-clamp-2 text-sm',
          snippet ? 'text-zinc-400' : 'text-zinc-500/70 italic'
        )}
      >
        {snippet || 'No additional text'}
      </span>
      <span className="mt-auto flex items-center gap-1.5 pt-1.5 text-[11px] text-zinc-500">
        {folder && (
          <>
            <span aria-hidden>{folder.emoji}</span>
            <span className="max-w-24 truncate">{folder.name}</span>
            <span aria-hidden>·</span>
          </>
        )}
        <span title={fullTimestamp(note.updatedAt)}>{relativeTime(note.updatedAt)}</span>
      </span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Editor view                                                         */
/* ------------------------------------------------------------------ */

function NoteEditor({
  note,
  folders,
  saveState,
  titleInputRef,
  onChange,
  onBack,
  onDelete,
  onExport,
}: {
  note: Note
  folders: Folder[]
  saveState: SaveState
  titleInputRef: RefObject<HTMLInputElement | null>
  onChange: (id: string, patch: Partial<Omit<Note, 'id' | 'updatedAt'>>) => void
  onBack: () => void
  onDelete: (id: string) => void
  onExport: (note: Note) => void
}) {
  const [preview, setPreview] = useState(false)
  const body = note.body
  const charCount = body.length
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0
  const displayTitle = note.title.trim() || 'Untitled'
  const color = colorOf(note.colorId)

  return (
    <>
      {/* ---------------- Toolbar ---------------- */}
      <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-amber-500/[0.07] via-transparent to-yellow-500/[0.05] px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onBack}
            aria-label="Back to notes"
            className="size-10 shrink-0 rounded-xl text-zinc-300 hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft className="size-5" aria-hidden />
          </Button>

          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors',
              saveState === 'saving' ? 'text-zinc-400' : 'text-emerald-400'
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

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => onChange(note.id, { pinned: !note.pinned })}
              aria-label={note.pinned ? 'Unpin note' : 'Pin note'}
              aria-pressed={note.pinned}
              className={cn(
                'flex size-10 items-center justify-center rounded-xl transition-colors',
                note.pinned
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'text-zinc-400 hover:bg-white/10 hover:text-white'
              )}
            >
              <Pin className={cn('size-4.5', note.pinned && 'fill-amber-300')} aria-hidden />
            </button>
            <button
              onClick={() => onExport(note)}
              aria-label="Export note as Markdown file"
              className="flex size-10 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <Download className="size-4.5" aria-hidden />
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  aria-label="Delete note"
                  className="flex size-10 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                >
                  <Trash2 className="size-4.5" aria-hidden />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-white/10 bg-zinc-950 text-zinc-100">
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this note?</AlertDialogTitle>
                  <AlertDialogDescription className="text-zinc-400">
                    “{displayTitle}” will be permanently removed from this device. This action
                    cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 hover:text-white">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-rose-500 text-white hover:bg-rose-400 focus-visible:ring-rose-400/40"
                    onClick={() => onDelete(note.id)}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>

        {/* Title */}
        <Input
          ref={titleInputRef}
          value={note.title}
          onChange={(e) => onChange(note.id, { title: e.target.value })}
          placeholder="Title"
          aria-label="Note title"
          className="mt-3 h-auto border-0 bg-transparent px-0 text-xl font-bold text-white shadow-none placeholder:text-zinc-600 focus-visible:border-0 focus-visible:ring-0 md:text-2xl"
        />

        {/* Meta */}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500">
          <span title={fullTimestamp(note.updatedAt)}>Edited {relativeTime(note.updatedAt)}</span>
          <span aria-hidden>·</span>
          <span>{charCount.toLocaleString('en-US')} chars</span>
          <span aria-hidden>·</span>
          <span>{wordCount.toLocaleString('en-US')} words</span>
        </p>

        {/* Color + folder row */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2 py-1.5" role="radiogroup" aria-label="Note color">
            {NOTE_COLORS.map((c) => (
              <button
                key={c.id}
                onClick={() => onChange(note.id, { colorId: c.id })}
                role="radio"
                aria-checked={note.colorId === c.id}
                aria-label={`${c.name} color`}
                className={cn(
                  'size-6 rounded-full transition-transform',
                  note.colorId === c.id
                    ? 'scale-110 ring-2 ring-white/70 ring-offset-2 ring-offset-zinc-950'
                    : 'hover:scale-105'
                )}
                style={{ backgroundColor: c.hex }}
              />
            ))}
          </div>

          <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 sm:max-w-56">
            <FolderIcon className="size-4 shrink-0 text-zinc-500" aria-hidden />
            <select
              value={note.folderId ?? ''}
              onChange={(e) => onChange(note.id, { folderId: e.target.value || null })}
              aria-label="Note folder"
              className="w-full min-w-0 cursor-pointer appearance-none bg-transparent text-xs font-semibold text-zinc-200 [color-scheme:dark] focus:outline-none [&>option]:bg-zinc-900"
            >
              <option value="">Unfiled</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.emoji} {f.name}
                </option>
              ))}
            </select>
          </label>

          {/* Write / Preview toggle */}
          <div className="flex rounded-xl border border-white/10 bg-white/5 p-1" role="radiogroup" aria-label="Editor mode">
            {(
              [
                { id: 'write', icon: PenLine, label: 'Write' },
                { id: 'preview', icon: Eye, label: 'Preview' },
              ] as const
            ).map((v) => (
              <button
                key={v.id}
                onClick={() => setPreview(v.id === 'preview')}
                role="radio"
                aria-checked={(v.id === 'preview') === preview}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-all',
                  (v.id === 'preview') === preview
                    ? 'bg-amber-400 text-zinc-950'
                    : 'text-zinc-300 hover:bg-white/5'
                )}
              >
                <v.icon className="size-3.5" aria-hidden />
                {v.label}
              </button>
            ))}
          </div>
        </div>

        {/* color accent strip */}
        <span
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 transition-colors"
          style={{ backgroundColor: note.colorId === 'default' ? 'transparent' : color.hex }}
          aria-hidden
        />
      </div>

      {/* ---------------- Body ---------------- */}
      <div className="p-4 sm:p-5">
        {preview ? (
          body.trim() ? (
            <MarkdownLite text={body} />
          ) : (
            <p className="py-10 text-center text-sm italic text-zinc-500">
              Nothing to preview yet — switch to Write and start typing.
            </p>
          )
        ) : (
          <Textarea
            value={body}
            onChange={(e) => onChange(note.id, { body: e.target.value })}
            placeholder={'Start writing…\n\nMarkdown-lite works: # Heading, **bold**, *italic*, `code`, - lists, > quotes'}
            aria-label="Note body"
            className="min-h-[320px] resize-y rounded-xl border-white/10 bg-white/5 text-[15px] leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus-visible:border-amber-400/50 focus-visible:ring-0"
          />
        )}

        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
          <NotebookPen className="size-3.5" aria-hidden />
          Auto-saved on this device · markdown-lite preview · export as .md
        </p>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Manage folders modal                                                */
/* ------------------------------------------------------------------ */

function ManageFolders({
  open,
  onOpenChange,
  folders,
  notes,
  onFoldersChange,
  onDeleteFolder,
  toast,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folders: Folder[]
  notes: Note[]
  onFoldersChange: (folders: Folder[]) => void
  /** parent removes the folder + moves its notes to Unfiled */
  onDeleteFolder: (id: string) => void
  toast: ReturnType<typeof useToast>['toast']
}) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState(FOLDER_EMOJIS[0])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const createFolder = () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast({ title: 'Give the folder a name first' })
      return
    }
    if (folders.some((f) => f.name.toLowerCase() === trimmed.toLowerCase())) {
      toast({ title: 'A folder with that name already exists' })
      return
    }
    const folder: Folder = { id: `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, name: trimmed, emoji }
    onFoldersChange([...folders, folder])
    setName('')
    setEmoji(FOLDER_EMOJIS[0])
    toast({ title: 'Folder created', description: `${folder.emoji} ${folder.name} is ready.` })
  }

  const deleteFolder = (id: string) => {
    const target = folders.find((f) => f.id === id)
    // parent removes the folder and moves its notes to Unfiled
    setConfirmDeleteId(null)
    onDeleteFolder(id)
    toast({
      title: 'Folder deleted',
      description: target ? `“${target.name}” removed — its notes moved to Unfiled.` : undefined,
    })
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="manage-folders"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onOpenChange(false)
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Manage folders"
        >
          <motion.div
            initial={{ scale: 0.92, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
          >
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                <FolderPlus className="size-5" aria-hidden />
              </span>
              <h3 className="flex-1 text-sm font-bold">Manage folders</h3>
              <button
                onClick={() => onOpenChange(false)}
                aria-label="Close"
                className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="space-y-4">
              {/* create */}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Icon</p>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Folder icon">
                  {FOLDER_EMOJIS.map((e) => (
                    <button
                      key={e}
                      onClick={() => setEmoji(e)}
                      role="radio"
                      aria-checked={emoji === e}
                      className={cn(
                        'flex size-10 items-center justify-center rounded-xl border text-lg transition-all',
                        emoji === e
                          ? 'border-amber-400/60 bg-amber-500/15 shadow-md'
                          : 'border-white/10 bg-white/5 hover:bg-white/10'
                      )}
                    >
                      {e}
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 flex gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createFolder()
                    }}
                    placeholder="Folder name, e.g. Work"
                    maxLength={24}
                    aria-label="Folder name"
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-400/50 focus:outline-none"
                  />
                  <Button
                    onClick={createFolder}
                    className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-amber-300 to-yellow-500 font-semibold text-zinc-950 hover:from-amber-200 hover:to-yellow-400"
                  >
                    <Plus className="size-4" aria-hidden /> Add
                  </Button>
                </div>
              </div>

              {/* list */}
              {folders.length > 0 && (
                <div className="border-t border-white/5 pt-3">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Your folders
                  </p>
                  <ul className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                    {folders.map((f) => {
                      const count = notes.filter((n) => n.folderId === f.id).length
                      const confirming = confirmDeleteId === f.id
                      return (
                        <li
                          key={f.id}
                          className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-2.5"
                        >
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-base" aria-hidden>
                            {f.emoji}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{f.name}</span>
                          <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                            {count} note{count === 1 ? '' : 's'}
                          </span>
                          <button
                            onClick={() => (confirming ? void deleteFolder(f.id) : setConfirmDeleteId(f.id))}
                            aria-label={confirming ? `Confirm delete ${f.name}` : `Delete ${f.name}`}
                            className={cn(
                              'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
                              confirming
                                ? 'bg-rose-500 text-white'
                                : 'text-zinc-600 hover:bg-rose-500/15 hover:text-rose-300'
                            )}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                  <p className="mt-2 text-[11px] text-zinc-500">
                    Deleting a folder keeps its notes — they move to Unfiled.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
