'use client'

/**
 * Code Editor mini — a syntax-highlighted scratchpad with a local snippet
 * library, entirely on-device.
 *
 * The editor uses the transparent-textarea-over-<pre> technique: a
 * react-syntax-highlighter <pre> renders the colored code underneath, while
 * an absolutely-positioned <textarea> with transparent text and an emerald
 * caret sits on top. Both layers (plus the line-number gutter) share one
 * style object — identical mono font stack, 12.5px size, 1.6 line-height,
 * 12px padding and the same white-space/overflow-wrap mode — so the text
 * stays perfectly aligned. The textarea is the scroller; its scrollTop/
 * scrollLeft are mirrored onto the <pre> and gutter on scroll. Tab inserts
 * two spaces; word-wrap toggles pre-wrap ↔ pre on every layer at once.
 *
 * Snippets persist to IndexedDB (`toolhub-snippets` v1, store `snippets`,
 * write-through) with a searchable, tap-to-open, two-tap-delete list. The
 * current buffer autosaves a draft to localStorage (`toolhub-code-draft`)
 * 400ms after typing stops and is restored on mount. File actions: download
 * with a per-language extension, Web Share with files (falls back to
 * download), copy-all, and clear.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  Eraser,
  FileCode2,
  Library,
  Loader2,
  Plus,
  Save,
  Search,
  Share2,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

/* ================================================================== */
/* Model + constants                                                   */
/* ================================================================== */

type LangId = 'javascript' | 'typescript' | 'json' | 'html' | 'css' | 'python' | 'sql' | 'bash'

interface LangMeta {
  id: LangId
  label: string
  /** Prism/refractor grammar id used by react-syntax-highlighter. */
  prism: string
  /** File extension for downloads/shares. */
  ext: string
  /** MIME type for the download blob and the Web Share File. */
  mime: string
}

const LANGS: readonly LangMeta[] = [
  { id: 'javascript', label: 'JavaScript', prism: 'javascript', ext: 'js', mime: 'text/javascript' },
  { id: 'typescript', label: 'TypeScript', prism: 'typescript', ext: 'ts', mime: 'text/typescript' },
  { id: 'json', label: 'JSON', prism: 'json', ext: 'json', mime: 'application/json' },
  { id: 'html', label: 'HTML', prism: 'markup', ext: 'html', mime: 'text/html' },
  { id: 'css', label: 'CSS', prism: 'css', ext: 'css', mime: 'text/css' },
  { id: 'python', label: 'Python', prism: 'python', ext: 'py', mime: 'text/x-python' },
  { id: 'sql', label: 'SQL', prism: 'sql', ext: 'sql', mime: 'application/sql' },
  { id: 'bash', label: 'Bash', prism: 'bash', ext: 'sh', mime: 'text/x-sh' },
]

const DEFAULT_LANG: LangMeta = LANGS[0] ?? {
  id: 'javascript',
  label: 'JavaScript',
  prism: 'javascript',
  ext: 'js',
  mime: 'text/javascript',
}

interface SnippetDoc {
  id: string
  name: string
  language: string
  code: string
  createdAt: number
  updatedAt: number
}

interface Baseline {
  code: string
  language: LangId
}

interface ShareFilesNavigator extends Navigator {
  canShare: (data?: ShareData) => boolean
}

const DRAFT_KEY = 'toolhub-code-draft'
const DRAFT_DEBOUNCE_MS = 400

const DB_NAME = 'toolhub-snippets'
const DB_VERSION = 1
const SNIPPETS_STORE = 'snippets'

/** Thin glass scrollbar for long lists (house convention). */
const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/* --- shared text metrics: the alignment contract -------------------- */

/** One mono stack for every code layer (highlighter, textarea, gutter). */
const MONO_STACK =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const CODE_FONT_SIZE = '12.5px'
const CODE_LINE_HEIGHT = 1.6
const CODE_PADDING = 12

/**
 * The single source of truth for text layout across the highlight layer,
 * the transparent textarea and the line-number gutter. Every element that
 * renders code glyphs MUST spread this object; white-space/overflow-wrap
 * are applied per layer from the same `wrap` state so all three stay in
 * lockstep in both wrapping modes.
 */
const SHARED_TEXT_STYLE: CSSProperties = {
  fontFamily: MONO_STACK,
  fontSize: CODE_FONT_SIZE,
  lineHeight: CODE_LINE_HEIGHT,
  tabSize: 2,
}

/* ================================================================== */
/* IndexedDB — toolhub-snippets v1 / store `snippets` (house pattern)  */
/* ================================================================== */

let dbPromise: Promise<IDBDatabase> | null = null

function openSnippetsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(SNIPPETS_STORE)) d.createObjectStore(SNIPPETS_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openSnippetsDb()
  return dbPromise
}

function idbGetAll<T>(store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readonly').objectStore(store).getAll()
        req.onsuccess = () => resolve((req.result ?? []) as T[])
        req.onerror = () => reject(req.error ?? new Error('IndexedDB getAll failed'))
      })
      .catch(reject)
  })
}

function idbPut<T>(store: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).put(value as object)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB put failed'))
      })
      .catch(reject)
  })
}

function idbDelete(store: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db()
      .then((d) => {
        const req = d.transaction(store, 'readwrite').objectStore(store).delete(key)
        req.onsuccess = () => resolve()
        req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'))
      })
      .catch(reject)
  })
}

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function uid(): string {
  return `snippet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

/** Clipboard write with a legacy textarea fallback for insecure contexts. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}

function langMetaOf(id: string): LangMeta {
  return LANGS.find((l) => l.id === id) ?? DEFAULT_LANG
}

function isLangId(id: unknown): id is LangId {
  return typeof id === 'string' && LANGS.some((l) => l.id === id)
}

function isSnippetDoc(v: unknown): v is SnippetDoc {
  if (typeof v !== 'object' || v === null) return false
  const d = v as Record<string, unknown>
  return (
    typeof d.id === 'string' &&
    typeof d.name === 'string' &&
    typeof d.code === 'string' &&
    typeof d.language === 'string' &&
    typeof d.createdAt === 'number' &&
    typeof d.updatedAt === 'number'
  )
}

function countLines(code: string): number {
  return code === '' ? 0 : code.split('\n').length
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ms).toLocaleDateString()
}

/** Filename-safe slug from a snippet name, with the language extension. */
function safeFileName(name: string, ext: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base.length > 0 ? base : 'snippet'}.${ext}`
}

/** Suggest a snippet name from the first non-empty line of code. */
function suggestName(code: string): string {
  const first = code
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  const short = first === undefined ? '' : first.length > 28 ? `${first.slice(0, 28).trimEnd()}…` : first
  return short.length > 0 ? short : 'Untitled snippet'
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function CodeEditorApp() {
  const { toast } = useToast()

  /* ---------------- editor state ---------------- */
  const [code, setCode] = useState('')
  const [language, setLanguage] = useState<LangId>(DEFAULT_LANG.id)
  const [wrap, setWrap] = useState(false)
  const [baseline, setBaseline] = useState<Baseline>({ code: '', language: DEFAULT_LANG.id })

  /* ---------------- library state ---------------- */
  const [snippets, setSnippets] = useState<SnippetDoc[]>([])
  const [libLoaded, setLibLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  /* ---------------- flows ---------------- */
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [pendingLoad, setPendingLoad] = useState<SnippetDoc | null>(null)

  /* ---------------- refs ---------------- */
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const gutterRef = useRef<HTMLDivElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const draftReadyRef = useRef(false)

  /* ---------------- derived ---------------- */
  const langMeta = langMetaOf(language)
  const lineCount = useMemo(() => countLines(code), [code])
  const gutterText = useMemo(
    () => Array.from({ length: Math.max(lineCount, 1) }, (_, i) => String(i + 1)).join('\n'),
    [lineCount]
  )
  const activeSnippet = useMemo(() => snippets.find((s) => s.id === activeId) ?? null, [snippets, activeId])
  const dirty = code !== baseline.code || language !== baseline.language
  const visibleSnippets = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...snippets].sort((a, b) => b.updatedAt - a.updatedAt)
    return q.length === 0 ? sorted : sorted.filter((s) => s.name.toLowerCase().includes(q))
  }, [snippets, query])

  /* ---------------- shared layer styles (wrap-aware) ---------------- */
  const whiteSpace = wrap ? 'pre-wrap' : 'pre'
  const overflowWrap = wrap ? 'break-word' : 'normal'

  const highlighterStyle: CSSProperties = useMemo(
    () => ({
      ...SHARED_TEXT_STYLE,
      position: 'absolute',
      inset: 0,
      height: '100%',
      width: '100%',
      margin: 0,
      padding: CODE_PADDING,
      background: 'transparent',
      overflow: 'hidden',
      whiteSpace,
      overflowWrap,
    }),
    [whiteSpace, overflowWrap]
  )

  const codeTagProps = useMemo(
    () => ({
      className: `language-${langMeta.prism}`,
      style: {
        ...SHARED_TEXT_STYLE,
        display: 'block',
        margin: 0,
        padding: 0,
        background: 'transparent',
        whiteSpace,
        overflowWrap,
      },
    }),
    [langMeta.prism, whiteSpace, overflowWrap]
  )

  const textareaStyle: CSSProperties = useMemo(
    () => ({
      ...SHARED_TEXT_STYLE,
      padding: CODE_PADDING,
      border: 0,
      whiteSpace,
      overflowWrap,
    }),
    [whiteSpace, overflowWrap]
  )

  /* ---------------- scroll sync ---------------- */

  /** Mirror the textarea's scroll offsets onto the highlight layer + gutter. */
  const syncScroll = useCallback((): void => {
    const ta = textareaRef.current
    if (ta === null) return
    const pre = stageRef.current?.querySelector('pre')
    if (pre instanceof HTMLElement) {
      pre.scrollTop = ta.scrollTop
      pre.scrollLeft = ta.scrollLeft
    }
    const gut = gutterRef.current
    if (gut !== null) gut.scrollTop = ta.scrollTop
  }, [])

  /* ---------------- effects ---------------- */

  /* Restore the draft once on mount (deferred via setTimeout so we never
     setState synchronously inside an effect body). */
  useEffect(() => {
    const t = setTimeout(() => {
      draftReadyRef.current = true
      try {
        const raw = localStorage.getItem(DRAFT_KEY)
        if (raw === null) return
        const parsed: unknown = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null) return
        const d = parsed as Record<string, unknown>
        const restoredCode = typeof d.code === 'string' ? d.code : ''
        const restoredLang = isLangId(d.language) ? d.language : DEFAULT_LANG.id
        setCode(restoredCode)
        setLanguage(restoredLang)
        setBaseline({ code: restoredCode, language: restoredLang })
      } catch {
        /* corrupt draft — start clean */
      }
    }, 0)
    return () => clearTimeout(t)
  }, [])

  /* Hydrate the snippet library from IndexedDB (alive-flag pattern). */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const all = await idbGetAll<SnippetDoc>(SNIPPETS_STORE)
        if (!alive) return
        const clean = all
          .filter(isSnippetDoc)
          .map<SnippetDoc>((s) => ({ ...s, language: isLangId(s.language) ? s.language : DEFAULT_LANG.id }))
          .sort((a, b) => b.updatedAt - a.updatedAt)
        setSnippets(clean)
      } catch {
        /* private mode / storage blocked — library stays empty in-memory */
      }
      if (alive) setLibLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* Debounced draft write-through (400ms after the last change). */
  useEffect(() => {
    if (!draftReadyRef.current) return
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ language, code }))
      } catch {
        /* private mode / quota — draft is best-effort */
      }
    }, DRAFT_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [code, language])

  /* Two-tap delete confirmation resets after 3s. */
  useEffect(() => {
    if (confirmDeleteId === null) return
    const t = setTimeout(() => setConfirmDeleteId(null), 3000)
    return () => clearTimeout(t)
  }, [confirmDeleteId])

  /* Keep highlight layer + gutter in scroll lockstep after edits/toggles. */
  useEffect(() => {
    const raf = requestAnimationFrame(() => syncScroll())
    return () => cancelAnimationFrame(raf)
  }, [code, language, wrap, syncScroll])

  /* ---------------- editor handlers ---------------- */

  const onCodeChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    setCode(e.target.value)
  }

  const onTextareaScroll = (): void => {
    syncScroll()
  }

  const onTextareaKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const ta = e.currentTarget
    ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end')
    setCode(ta.value)
  }

  /* ---------------- persistence ---------------- */

  const persistCreate = (rawName: string): void => {
    const name = rawName.trim().length > 0 ? rawName.trim() : 'Untitled snippet'
    if (code === '') {
      toast({ title: 'Nothing to save', description: 'Write some code first.' })
      return
    }
    const now = Date.now()
    const doc: SnippetDoc = { id: uid(), name, language, code, createdAt: now, updatedAt: now }
    void idbPut(SNIPPETS_STORE, doc)
      .then(() => {
        setSnippets((prev) => [doc, ...prev])
        setActiveId(doc.id)
        setBaseline({ code, language })
        setSaveAsOpen(false)
        haptic()
        const duplicate = snippets.some((s) => s.name.trim().toLowerCase() === name.toLowerCase())
        if (duplicate) {
          toast({
            title: 'Saved — name already exists',
            description: `“${name}” was added as a new snippet. Duplicate names are allowed.`,
          })
        } else {
          toast({ title: 'Snippet saved', description: `“${name}” is now in your library.` })
        }
      })
      .catch(() => {
        toast({
          title: 'Could not save',
          description: 'Snippet storage is unavailable on this device.',
          variant: 'destructive',
        })
      })
  }

  /** Persist edits to the currently open snippet. Resolves true on success. */
  const persistUpdate = (): Promise<boolean> => {
    const active = activeSnippet
    if (active === null) return Promise.resolve(false)
    const doc: SnippetDoc = { ...active, code, language, updatedAt: Date.now() }
    return idbPut(SNIPPETS_STORE, doc)
      .then(() => {
        setSnippets((prev) => prev.map((s) => (s.id === doc.id ? doc : s)))
        setBaseline({ code, language })
        haptic()
        toast({ title: 'Changes saved', description: `“${doc.name}” was updated.` })
        return true
      })
      .catch(() => {
        toast({
          title: 'Could not save',
          description: 'Snippet storage is unavailable on this device.',
          variant: 'destructive',
        })
        return false
      })
  }

  const onSaveClick = (): void => {
    if (!dirty || code === '') return
    if (activeSnippet !== null) {
      void persistUpdate()
    } else {
      setNameInput(suggestName(code))
      setSaveAsOpen(true)
    }
  }

  const onSaveAsNewClick = (): void => {
    if (code === '') return
    setNameInput(suggestName(code))
    setSaveAsOpen(true)
  }

  /* ---------------- library flows ---------------- */

  const commitLoad = useCallback(
    (s: SnippetDoc): void => {
      const nextLang = isLangId(s.language) ? s.language : DEFAULT_LANG.id
      setCode(s.code)
      setLanguage(nextLang)
      setActiveId(s.id)
      setBaseline({ code: s.code, language: nextLang })
      toast({ title: 'Snippet opened', description: `“${s.name}” loaded into the editor.` })
    },
    [toast]
  )

  const requestLoad = (s: SnippetDoc): void => {
    if (dirty) {
      setPendingLoad(s)
    } else {
      commitLoad(s)
    }
  }

  const discardAndOpen = (): void => {
    const target = pendingLoad
    setPendingLoad(null)
    if (target !== null) commitLoad(target)
  }

  const saveAndOpenPending = (): void => {
    void persistUpdate().then((ok) => {
      if (!ok) return
      const target = pendingLoad
      setPendingLoad(null)
      if (target !== null) commitLoad(target)
    })
  }

  const deleteSnippet = (id: string): void => {
    setConfirmDeleteId(null)
    void idbDelete(SNIPPETS_STORE, id)
      .then(() => {
        setSnippets((prev) => prev.filter((s) => s.id !== id))
        setActiveId((prev) => (prev === id ? null : prev))
        haptic()
        toast({ title: 'Snippet deleted' })
      })
      .catch(() => {
        toast({
          title: 'Could not delete',
          description: 'Snippet storage is unavailable on this device.',
          variant: 'destructive',
        })
      })
  }

  /* ---------------- file actions ---------------- */

  const copyAll = async (): Promise<void> => {
    if (code === '') return
    const ok = await copyToClipboard(code)
    if (ok) {
      haptic()
      toast({
        title: 'Copied',
        description: `${code.length} character${code.length === 1 ? '' : 's'} copied to the clipboard.`,
      })
    } else {
      toast({
        title: 'Copy failed',
        description: 'The clipboard is unavailable in this context.',
        variant: 'destructive',
      })
    }
  }

  const downloadCode = (): void => {
    if (code === '') return
    const fileName = safeFileName(activeSnippet?.name ?? 'snippet', langMeta.ext)
    try {
      const blob = new Blob([code], { type: `${langMeta.mime};charset=utf-8` })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast({ title: 'Download started', description: fileName })
    } catch {
      toast({
        title: 'Download failed',
        description: 'The file could not be created.',
        variant: 'destructive',
      })
    }
  }

  const shareCode = async (): Promise<void> => {
    if (code === '') return
    const fileName = safeFileName(activeSnippet?.name ?? 'snippet', langMeta.ext)
    const file = new File([code], fileName, { type: langMeta.mime })
    const nav = navigator as ShareFilesNavigator
    const canShareFiles =
      typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files: [file] })
    if (canShareFiles) {
      try {
        await nav.share({ files: [file], title: fileName })
        toast({ title: 'Shared', description: `${fileName} is on its way.` })
      } catch {
        /* user dismissed the share sheet — nothing to do */
      }
      return
    }
    downloadCode()
    toast({
      title: 'Sharing not supported here',
      description: 'This device can’t share files directly — the snippet was downloaded instead.',
    })
  }

  const clearEditor = (): void => {
    if (code === '') return
    setCode('')
    setActiveId(null)
    setBaseline({ code: '', language })
    toast({ title: 'Editor cleared', description: 'Draft reset — snippets stay in your library.' })
  }

  /* ---------------- render ---------------- */

  return (
    <div className="mx-auto max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-emerald-500/[0.12] via-transparent to-lime-500/[0.08] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-400 via-emerald-500 to-lime-600 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(132_204_22/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <Code2 className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Code Editor</h2>
              <p className="text-xs text-zinc-400">Syntax-highlighted scratchpad with a local snippet library.</p>
            </div>
            {dirty && (
              <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-200">
                <TriangleAlert className="size-3" aria-hidden /> Unsaved
              </span>
            )}
          </div>
        </div>

        {/* ---------------- Body ---------------- */}
        <div className="p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* ================= EDITOR COLUMN ================= */}
            <div className="order-2 space-y-4 lg:order-1">
              {/* ---------- language picker ---------- */}
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Language</span>
                  <span className="text-[11px] text-zinc-600">{langMeta.label}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {LANGS.map((l) => {
                    const active = l.id === language
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => setLanguage(l.id)}
                        aria-pressed={active}
                        className={cn(
                          'flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors',
                          active
                            ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                            : 'border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
                        )}
                      >
                        <Check
                          className={cn('size-4 shrink-0', active ? 'opacity-100' : 'opacity-0')}
                          aria-hidden
                        />
                        {l.label}
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* ---------- editor stage ---------- */}
              <div className="flex h-80 overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 transition-colors focus-within:border-emerald-400/50 sm:h-[420px]">
                {/* line-number gutter */}
                <div
                  ref={gutterRef}
                  aria-hidden
                  className="w-11 shrink-0 select-none overflow-hidden border-r border-white/5 bg-zinc-950/40 pr-2 text-right text-zinc-600"
                  style={{ paddingTop: CODE_PADDING, paddingBottom: CODE_PADDING, ...SHARED_TEXT_STYLE, whiteSpace: 'pre' }}
                >
                  {gutterText}
                </div>

                {/* highlight layer + transparent textarea */}
                <div ref={stageRef} className="relative min-w-0 flex-1">
                  <SyntaxHighlighter
                    language={langMeta.prism}
                    style={oneDark}
                    showLineNumbers={false}
                    wrapLongLines={wrap}
                    customStyle={highlighterStyle}
                    codeTagProps={codeTagProps}
                  >
                    {code}
                  </SyntaxHighlighter>
                  <textarea
                    ref={textareaRef}
                    value={code}
                    onChange={onCodeChange}
                    onScroll={onTextareaScroll}
                    onKeyDown={onTextareaKeyDown}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    wrap={wrap ? 'soft' : 'off'}
                    aria-label="Code editor"
                    placeholder="Start typing…"
                    className={cn(
                      'absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent text-transparent caret-emerald-300 outline-none selection:bg-emerald-400/30 focus:outline-none',
                      THIN_SCROLLBAR
                    )}
                    style={textareaStyle}
                  />
                  {/* empty state — behind the caret, never blocks input */}
                  {code === '' && (
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                      <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-lime-500/20 text-emerald-300">
                        <FileCode2 className="size-6" aria-hidden />
                      </span>
                      <p className="text-sm font-medium text-zinc-400">Open a snippet or start typing</p>
                    </div>
                  )}
                </div>
              </div>

              {/* ---------- stats bar ---------- */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs text-zinc-400">
                <span className="font-mono text-zinc-300">
                  {lineCount} {lineCount === 1 ? 'line' : 'lines'}
                </span>
                <span className="text-zinc-600">·</span>
                <span>{code.length} chars</span>
                <span className="text-zinc-600">·</span>
                <span>{langMeta.label}</span>
                <div className="ml-auto flex items-center gap-2.5">
                  <Switch
                    id="codeeditor-wrap"
                    checked={wrap}
                    onCheckedChange={(v) => setWrap(v)}
                    className="data-[state=checked]:bg-emerald-500! data-[state=unchecked]:bg-white/10!"
                  />
                  <label htmlFor="codeeditor-wrap" className="select-none text-xs text-zinc-300">
                    Wrap
                  </label>
                </div>
              </div>

              {/* ---------- actions ---------- */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={onSaveClick}
                  disabled={!dirty || code === ''}
                  className="h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-lime-500 px-4 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_rgb(16_185_129/0.7)] hover:from-emerald-400 hover:to-lime-400"
                >
                  <Save className="size-4" aria-hidden /> Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onSaveAsNewClick}
                  disabled={code === ''}
                  className="h-11 rounded-xl border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Plus className="size-4" aria-hidden /> Save as new
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void shareCode()}
                  disabled={code === ''}
                  className="h-11 rounded-xl border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Share2 className="size-4" aria-hidden /> Share
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={downloadCode}
                  disabled={code === ''}
                  className="h-11 rounded-xl border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Download className="size-4" aria-hidden /> Download
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void copyAll()}
                  disabled={code === ''}
                  className="h-11 rounded-xl border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 hover:text-white"
                >
                  <Copy className="size-4" aria-hidden /> Copy
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearEditor}
                  disabled={code === ''}
                  className="h-11 rounded-xl border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                >
                  <Eraser className="size-4" aria-hidden /> Clear
                </Button>
                {/* mobile library toggle — the aside itself is hidden below lg */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setLibraryOpen((v) => !v)}
                  aria-expanded={libraryOpen}
                  className="ml-auto h-11 rounded-xl border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 hover:text-white lg:hidden"
                >
                  <Library className="size-4" aria-hidden />
                  Library{snippets.length > 0 ? ` (${snippets.length})` : ''}
                  {libraryOpen ? (
                    <ChevronUp className="size-4" aria-hidden />
                  ) : (
                    <ChevronDown className="size-4" aria-hidden />
                  )}
                </Button>
              </div>

              <p className="text-[11px] leading-relaxed text-zinc-600">
                Draft autosaves on this device (400&nbsp;ms after typing stops) · Tab inserts two spaces · Snippets
                live in this browser’s IndexedDB only.
              </p>
            </div>

            {/* ================= SNIPPET LIBRARY ================= */}
            <aside
              className={cn(
                'order-1 lg:order-2',
                libraryOpen ? 'block' : 'hidden',
                'lg:block'
              )}
            >
              <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center gap-2">
                  <Library className="size-4 shrink-0 text-emerald-300" aria-hidden />
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Snippet library
                  </span>
                  <span className="ml-auto rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-300">
                    {snippets.length}
                  </span>
                </div>

                <div className="relative mt-3">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-600"
                    aria-hidden
                  />
                  <Input
                    value={query}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                    placeholder="Search snippets…"
                    aria-label="Search snippets"
                    autoComplete="off"
                    className="h-11 border-white/10 bg-white/5 pl-9 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:border-emerald-400/50 focus-visible:ring-1 focus-visible:ring-emerald-400/30"
                  />
                </div>

                {!libLoaded ? (
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-3 text-xs text-zinc-500">
                    <Loader2 className="size-3.5 animate-spin text-emerald-300" aria-hidden /> Loading library…
                  </div>
                ) : visibleSnippets.length === 0 ? (
                  <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-center">
                    <p className="text-sm font-medium text-zinc-400">
                      {query.trim().length > 0 ? 'No matches' : 'No snippets yet'}
                    </p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {query.trim().length > 0 ? 'Try a different search.' : 'Write something, then “Save as new”.'}
                    </p>
                  </div>
                ) : (
                  <div className={cn('mt-3 max-h-96 space-y-2 overflow-y-auto pr-1', THIN_SCROLLBAR)}>
                    {visibleSnippets.map((s) => {
                      const isActive = s.id === activeId
                      const confirming = confirmDeleteId === s.id
                      return (
                        <div
                          key={s.id}
                          className={cn(
                            'flex items-center gap-1 rounded-xl border p-1.5 transition-colors',
                            isActive
                              ? 'border-emerald-400/40 bg-emerald-400/10'
                              : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.06]'
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => requestLoad(s)}
                            aria-label={`Open snippet ${s.name}`}
                            className="min-w-0 flex-1 rounded-lg p-1.5 text-left"
                          >
                            <span className="block truncate text-sm font-medium text-zinc-100">
                              {s.name}
                              {isActive ? <span className="ml-1.5 text-[10px] text-emerald-300">open</span> : null}
                            </span>
                            <span className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                              <span className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-400">
                                {langMetaOf(s.language).label}
                              </span>
                              <span>{formatRelative(s.updatedAt)}</span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirming) {
                                deleteSnippet(s.id)
                              } else {
                                setConfirmDeleteId(s.id)
                              }
                            }}
                            aria-label={confirming ? `Tap again to delete ${s.name}` : `Delete snippet ${s.name}`}
                            className={cn(
                              'flex size-11 shrink-0 items-center justify-center rounded-lg transition-colors',
                              confirming
                                ? 'bg-rose-500/15 text-rose-300'
                                : 'text-zinc-600 hover:bg-white/10 hover:text-zinc-300'
                            )}
                          >
                            {confirming ? (
                              <span className="text-[10px] font-bold uppercase tracking-wide">Sure?</span>
                            ) : (
                              <Trash2 className="size-4" aria-hidden />
                            )}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </aside>
          </div>
        </div>
      </motion.div>

      {/* ---------------- unsaved-changes dialog ---------------- */}
      <Dialog
        open={pendingLoad !== null}
        onOpenChange={(o) => {
          if (!o) setPendingLoad(null)
        }}
      >
        <DialogContent className="max-w-sm rounded-2xl border-white/10 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-white">Unsaved changes</DialogTitle>
            <DialogDescription className="text-zinc-400">
              {`The editor has changes that aren’t saved to any snippet yet. Open “${pendingLoad?.name ?? ''}” anyway?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPendingLoad(null)}
              className="h-11 rounded-xl text-zinc-300 hover:bg-white/10 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={discardAndOpen}
              className="h-11 rounded-xl border-rose-400/30 bg-rose-500/10 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 hover:text-rose-100"
            >
              Discard &amp; open
            </Button>
            {activeSnippet !== null && (
              <Button
                type="button"
                onClick={saveAndOpenPending}
                disabled={code === ''}
                className="h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-lime-500 px-4 text-white hover:from-emerald-400 hover:to-lime-400"
              >
                <Save className="size-4" aria-hidden /> Save &amp; open
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------------- save-as-new dialog ---------------- */}
      <Dialog open={saveAsOpen} onOpenChange={(o) => setSaveAsOpen(o)}>
        <DialogContent className="max-w-sm rounded-2xl border-white/10 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-white">Save as new snippet</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Name the current code. It will be stored on this device only.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={nameInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && nameInput.trim().length > 0) persistCreate(nameInput)
            }}
            placeholder="Snippet name"
            aria-label="Snippet name"
            autoFocus
            autoComplete="off"
            maxLength={80}
            className="h-11 border-white/15 bg-white/5 text-white placeholder:text-zinc-600 focus-visible:border-emerald-400/50 focus-visible:ring-1 focus-visible:ring-emerald-400/30"
          />
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSaveAsOpen(false)}
              className="h-11 rounded-xl text-zinc-300 hover:bg-white/10 hover:text-white"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => persistCreate(nameInput)}
              disabled={nameInput.trim().length === 0}
              className="h-11 rounded-xl bg-gradient-to-r from-emerald-500 to-lime-500 px-4 text-white hover:from-emerald-400 hover:to-lime-400"
            >
              <Plus className="size-4" aria-hidden /> Create snippet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
