'use client'

/**
 * PDF Tools — an Acrobat-class page toolkit that runs 100% on-device.
 *
 * Files are held in memory as File handles — nothing is ever uploaded.
 * Page thumbnails render through pdf.js (same setup as Design Studio:
 * getDocument → loadingTask.promise, destroy() on the loadingTask),
 * while every page-level operation (extract / delete / rotate /
 * save-range / merge) is lossless through pdf-lib copyPages. Per-page
 * rotation lives in state, is baked into previews and every download.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowDown,
  ArrowUp,
  BookOpenCheck,
  Check,
  CheckCheck,
  ChevronDown,
  FileDown,
  FilePlus2,
  FileStack,
  FileText,
  Layers,
  Loader2,
  Lock,
  Merge,
  RotateCw,
  Scissors,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

interface PdfFile {
  id: string
  file: File
  name: string
  size: number
  pageCount: number
  /** user-applied clockwise delta per page (0/90/180/270), on top of the source rotation */
  rotations: number[]
}

interface Thumb {
  page: number
  url: string
}

const THUMB_SCALE = 0.35
const THUMB_CAP = 60

const uid = () => `pdf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
const baseName = (name: string) => name.replace(/\.pdf$/i, '') || 'document'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/* ---------------- error classification ---------------- */

function isPasswordError(err: unknown): boolean {
  const e = err as { name?: string; message?: string }
  return e?.name === 'PasswordException' || /password|encrypted/i.test(e?.message ?? '')
}

function pdfErrorTitle(err: unknown): string {
  return isPasswordError(err) ? 'This PDF is password-protected' : 'Couldn’t read this PDF'
}

function pdfErrorDesc(name: string, err: unknown): string {
  return isPasswordError(err)
    ? `${name} is locked — remove the password first, then try again.`
    : `${name} looks corrupt or isn’t a readable PDF.`
}

/* ---------------- range parsing: "1-3,5" ---------------- */

function parseRange(input: string, max: number): { pages: number[]; error: string | null } {
  const text = input.trim()
  if (max <= 0) return { pages: [], error: 'Open a PDF first' }
  if (!text) return { pages: [], error: 'Enter pages like 1-3,5' }
  const pages: number[] = []
  const seen = new Set<number>()
  for (const raw of text.split(',')) {
    const token = raw.trim()
    if (!token) continue
    const m = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/)
    if (!m) return { pages: [], error: `“${token}” isn’t a page or a range` }
    const a = Number(m[1])
    const b = m[2] ? Number(m[2]) : a
    if (b < a) return { pages: [], error: `Range “${token}” goes backwards` }
    if (a < 1 || b > max) return { pages: [], error: `This PDF has pages 1 to ${max}` }
    for (let p = a; p <= b; p++) {
      if (!seen.has(p)) {
        seen.add(p)
        pages.push(p)
      }
    }
  }
  if (pages.length === 0) return { pages: [], error: 'Enter pages like 1-3,5' }
  return { pages, error: null }
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function PdfTools() {
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)

  const [docs, setDocs] = useState<PdfFile[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const activeDoc = useMemo(() => docs.find((d) => d.id === activeId) ?? null, [docs, activeId])

  const [thumbs, setThumbs] = useState<Thumb[]>([])
  const [thumbBusy, setThumbBusy] = useState(false)
  const [thumbProgress, setThumbProgress] = useState<{ done: number; total: number } | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [pendingRot, setPendingRot] = useState<0 | 90 | 180 | 270>(0)
  const [busy, setBusy] = useState<string | null>(null)

  const [rangeOpen, setRangeOpen] = useState(false)
  const [rangeText, setRangeText] = useState('')

  /* token invalidates in-flight thumbnail jobs on file swaps / unmount */
  const thumbToken = useRef(0)
  useEffect(() => () => { thumbToken.current++ }, [])

  const totalPages = useMemo(() => docs.reduce((sum, d) => sum + d.pageCount, 0), [docs])
  const parsedRange = useMemo(() => parseRange(rangeText, activeDoc?.pageCount ?? 0), [rangeText, activeDoc])

  /* ---------------- thumbnails (pdf.js) ---------------- */

  const renderThumbs = useCallback(
    async (doc: PdfFile, opts?: { keepSelection?: boolean; keepThumbs?: boolean }) => {
      const token = ++thumbToken.current
      if (!opts?.keepThumbs) setThumbs([])
      if (!opts?.keepSelection) setSelected(new Set())
      setThumbBusy(true)
      setThumbProgress(null)
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        const data = new Uint8Array(await doc.file.arrayBuffer())
        const loadingTask = pdfjs.getDocument({ data })
        try {
          const pdf = await loadingTask.promise
          const total = Math.min(pdf.numPages, THUMB_CAP)
          setThumbProgress({ done: 0, total })
          const out: Thumb[] = []
          for (let i = 1; i <= total; i++) {
            if (thumbToken.current !== token) return
            const page = await pdf.getPage(i)
            const rotation = (((page.rotate + (doc.rotations[i - 1] ?? 0)) % 360) + 360) % 360
            const vp = page.getViewport({ scale: THUMB_SCALE, rotation })
            const canvas = document.createElement('canvas')
            canvas.width = Math.max(1, Math.floor(vp.width))
            canvas.height = Math.max(1, Math.floor(vp.height))
            const ctx = canvas.getContext('2d')
            if (!ctx) throw new Error('canvas unavailable')
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise
            out.push({ page: i, url: canvas.toDataURL('image/jpeg', 0.82) })
            if (thumbToken.current === token) {
              /* same doc re-render (rotation sweep): keep not-yet-updated thumbs visible */
              setThumbs((prev) => (prev.length === total ? [...out, ...prev.slice(out.length)] : [...out]))
              setThumbProgress({ done: i, total })
            }
          }
        } finally {
          await loadingTask.destroy()
        }
      } catch (err) {
        if (thumbToken.current !== token) return
        setThumbs([])
        toast({
          title: pdfErrorTitle(err),
          description: pdfErrorDesc(doc.name, err),
          variant: 'destructive',
        })
      } finally {
        if (thumbToken.current === token) {
          setThumbBusy(false)
          setThumbProgress(null)
        }
      }
    },
    [toast]
  )

  /* ---------------- import ---------------- */

  const onFiles = useCallback(
    async (list: FileList | null) => {
      const picked = Array.from(list ?? []).filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      if (inputRef.current) inputRef.current.value = ''
      if (picked.length === 0) {
        toast({ title: 'No PDF files found', description: 'Choose one or more .pdf files.', variant: 'destructive' })
        return
      }
      setBusy('Reading PDFs…')
      const added: PdfFile[] = []
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
        for (const file of picked) {
          try {
            const data = new Uint8Array(await file.arrayBuffer())
            const loadingTask = pdfjs.getDocument({ data })
            let pageCount = 0
            try {
              const pdf = await loadingTask.promise
              pageCount = pdf.numPages
            } finally {
              await loadingTask.destroy()
            }
            added.push({ id: uid(), file, name: file.name, size: file.size, pageCount, rotations: new Array<number>(pageCount).fill(0) })
          } catch (err) {
            toast({ title: pdfErrorTitle(err), description: pdfErrorDesc(file.name, err), variant: 'destructive' })
          }
        }
      } finally {
        setBusy(null)
      }
      if (added.length === 0) return
      setDocs((prev) => [...prev, ...added])
      setActiveId(added[0].id)
      setPendingRot(0)
      void renderThumbs(added[0])
      toast({
        title: `${added.length} PDF${added.length > 1 ? 's' : ''} added`,
        description: `${added.reduce((s, d) => s + d.pageCount, 0)} pages ready — everything stays on this device.`,
      })
    },
    [renderThumbs, toast]
  )

  const pick = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.value = ''
    el.click()
  }, [])

  /* ---------------- file chips: activate / reorder / remove ---------------- */

  const activateDoc = useCallback(
    (doc: PdfFile) => {
      if (doc.id === activeId) return
      setActiveId(doc.id)
      setPendingRot(0)
      void renderThumbs(doc)
    },
    [activeId, renderThumbs]
  )

  const moveDoc = useCallback((idx: number, dir: -1 | 1) => {
    setDocs((prev) => {
      const j = idx + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      const [item] = next.splice(idx, 1)
      next.splice(j, 0, item)
      return next
    })
  }, [])

  const removeDoc = useCallback(
    (id: string) => {
      const idx = docs.findIndex((d) => d.id === id)
      if (idx < 0) return
      const next = docs.filter((d) => d.id !== id)
      setDocs(next)
      if (id !== activeId) return
      setPendingRot(0)
      const neighbor = next[Math.min(idx, next.length - 1)] ?? null
      if (neighbor) {
        setActiveId(neighbor.id)
        void renderThumbs(neighbor)
      } else {
        thumbToken.current++ // kill any in-flight render for the removed file
        setActiveId(null)
        setThumbs([])
        setSelected(new Set())
        setThumbBusy(false)
        setThumbProgress(null)
      }
    },
    [docs, activeId, renderThumbs]
  )

  /* ---------------- selection ---------------- */

  const togglePage = useCallback((page: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(page)) next.delete(page)
      else next.add(page)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    if (!activeDoc) return
    setSelected(new Set(Array.from({ length: activeDoc.pageCount }, (_, i) => i + 1)))
  }, [activeDoc])

  const clearSelection = useCallback(() => setSelected(new Set()), [])

  /* ---------------- rotation ---------------- */

  const applyRotation = useCallback(() => {
    const doc = activeDoc
    if (!doc || pendingRot === 0) return
    const pages =
      selected.size > 0
        ? [...selected].filter((p) => p >= 1 && p <= doc.pageCount).sort((a, b) => a - b)
        : Array.from({ length: doc.pageCount }, (_, i) => i + 1)
    if (pages.length === 0) return
    const rotations = [...doc.rotations]
    for (const p of pages) rotations[p - 1] = (rotations[p - 1] + pendingRot) % 360
    const nextDoc: PdfFile = { ...doc, rotations }
    setDocs((prev) => prev.map((d) => (d.id === doc.id ? nextDoc : d)))
    setPendingRot(0)
    toast({
      title: 'Rotation applied',
      description: `${pages.length} page${pages.length > 1 ? 's' : ''} rotated — previews and downloads now use it.`,
    })
    void renderThumbs(nextDoc, { keepSelection: true, keepThumbs: true })
  }, [activeDoc, pendingRot, selected, renderThumbs, toast])

  /* ---------------- download helper ---------------- */

  const downloadPdf = useCallback((bytes: Uint8Array, name: string) => {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  }, [])

  /* ---------------- pdf-lib operations ---------------- */

  /** Lossless page builder: copies the given 1-based pages, applies stored rotation, downloads. */
  const buildPdf = useCallback(
    async (doc: PdfFile, pages: number[], outName: string, doneTitle: string, doneDesc: string) => {
      setBusy('Building PDF…')
      try {
        const { PDFDocument, degrees } = await import('pdf-lib')
        const src = await PDFDocument.load(await doc.file.arrayBuffer())
        const out = await PDFDocument.create()
        const copied = await out.copyPages(src, pages.map((p) => p - 1))
        copied.forEach((page, i) => {
          const extra = doc.rotations[pages[i] - 1] ?? 0
          const angle = (((page.getRotation().angle + extra) % 360) + 360) % 360
          if (angle !== page.getRotation().angle) page.setRotation(degrees(angle))
        })
        for (const page of copied) out.addPage(page)
        const bytes = await out.save()
        downloadPdf(bytes, outName)
        toast({ title: doneTitle, description: doneDesc })
      } catch (err) {
        toast({ title: pdfErrorTitle(err), description: pdfErrorDesc(doc.name, err), variant: 'destructive' })
      } finally {
        setBusy(null)
      }
    },
    [downloadPdf, toast]
  )

  const extractPages = useCallback(async () => {
    const doc = activeDoc
    if (!doc || busy) return
    const pages =
      selected.size > 0
        ? [...selected].filter((p) => p >= 1 && p <= doc.pageCount).sort((a, b) => a - b)
        : Array.from({ length: doc.pageCount }, (_, i) => i + 1)
    await buildPdf(
      doc,
      pages,
      `${baseName(doc.name)}-extract.pdf`,
      'Pages extracted',
      `${pages.length} page${pages.length > 1 ? 's' : ''} saved as a new PDF — check your downloads.`
    )
  }, [activeDoc, busy, selected, buildPdf])

  const deletePages = useCallback(async () => {
    const doc = activeDoc
    if (!doc || busy) return
    if (selected.size === 0) {
      toast({ title: 'Select pages to delete', description: 'Tap page thumbnails first — or use Save page range to keep a list.' })
      return
    }
    if (selected.size >= doc.pageCount) {
      toast({ title: 'Can’t delete every page', description: 'A PDF needs at least one page — deselect a few and try again.', variant: 'destructive' })
      return
    }
    const keep = Array.from({ length: doc.pageCount }, (_, i) => i + 1).filter((p) => !selected.has(p))
    await buildPdf(
      doc,
      keep,
      `${baseName(doc.name)}-trimmed.pdf`,
      'Pages deleted',
      `${selected.size} page${selected.size > 1 ? 's' : ''} removed — ${keep.length} left in the trimmed PDF.`
    )
  }, [activeDoc, busy, selected, buildPdf, toast])

  const saveRange = useCallback(async () => {
    const doc = activeDoc
    if (!doc || busy) return
    if (parsedRange.error || parsedRange.pages.length === 0) {
      toast({ title: 'Check the page range', description: parsedRange.error ?? 'Enter at least one page.', variant: 'destructive' })
      return
    }
    const pages = parsedRange.pages
    setRangeOpen(false)
    await buildPdf(
      doc,
      pages,
      `${baseName(doc.name)}-pages.pdf`,
      'Page range saved',
      `${pages.length} page${pages.length > 1 ? 's' : ''} (${pages[0]}–${pages[pages.length - 1]}) exported as a new PDF.`
    )
  }, [activeDoc, busy, parsedRange, buildPdf, toast])

  const mergeAll = useCallback(async () => {
    if (busy) return
    if (docs.length < 2) {
      toast({ title: 'Add at least 2 PDFs', description: 'Merging combines every file in the chip order above.' })
      return
    }
    setBusy('Merging PDFs…')
    try {
      const { PDFDocument, degrees } = await import('pdf-lib')
      const out = await PDFDocument.create()
      let failed: { name: string; err: unknown } | null = null
      for (const doc of docs) {
        try {
          const src = await PDFDocument.load(await doc.file.arrayBuffer())
          const copied = await out.copyPages(src, src.getPageIndices())
          copied.forEach((page, i) => {
            const extra = doc.rotations[i] ?? 0
            const angle = (((page.getRotation().angle + extra) % 360) + 360) % 360
            if (angle !== page.getRotation().angle) page.setRotation(degrees(angle))
          })
          for (const page of copied) out.addPage(page)
        } catch (err) {
          failed = { name: doc.name, err }
          break
        }
      }
      if (failed) {
        toast({ title: pdfErrorTitle(failed.err), description: pdfErrorDesc(failed.name, failed.err), variant: 'destructive' })
        return
      }
      const bytes = await out.save()
      downloadPdf(bytes, `${baseName(docs[0].name)}-merged.pdf`)
      toast({
        title: 'PDFs merged',
        description: `${docs.length} files → ${totalPages} pages, in the order shown.`,
      })
    } catch (err) {
      toast({ title: 'Merge failed', description: err instanceof Error ? err.message : 'Something went wrong.', variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }, [busy, docs, totalPages, downloadPdf, toast])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  const lock = busy !== null
  const rotTarget = selected.size > 0 ? `${selected.size} selected page${selected.size > 1 ? 's' : ''}` : `all ${activeDoc?.pageCount ?? 0} pages`

  return (
    <div className="mx-auto w-full max-w-4xl select-none pb-2">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void onFiles(e.target.files)}
      />

      {/* ---------------- empty state hero ---------------- */}
      {docs.length === 0 ? (
        <div className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-rose-950/60 via-zinc-950 to-zinc-950 shadow-[0_24px_60px_-24px_rgb(244_63_94/0.4)]">
          <div className="flex flex-col items-center px-6 py-14 text-center sm:py-16">
            <span className="grid size-20 place-items-center rounded-3xl bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 shadow-[0_18px_44px_-12px_rgb(244_63_94/0.7)] ring-1 ring-white/25">
              <FileStack className="size-10 text-white" aria-hidden />
            </span>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white sm:text-3xl">PDF Tools</h1>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-400">
              Merge, split, rotate and organize PDF pages — right on your device
            </p>
            <Button
              onClick={pick}
              className="mt-7 h-12 rounded-2xl bg-gradient-to-r from-rose-500 to-red-500 px-7 text-base text-white shadow-[0_14px_32px_-10px_rgb(244_63_94/0.7)] hover:from-rose-400 hover:to-red-400"
            >
              <FilePlus2 className="size-5" aria-hidden />
              Add PDF files
            </Button>
            <p className="mt-6 inline-flex items-center gap-1.5 text-xs text-zinc-500">
              <ShieldCheck className="size-3.5 text-emerald-400" aria-hidden />
              Your files never leave this device
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* ---------------- header ---------------- */}
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-rose-950/60 via-zinc-950 to-zinc-950 shadow-[0_24px_60px_-24px_rgb(244_63_94/0.35)]">
            <div className="flex items-center gap-3 px-3.5 py-3.5 sm:px-5">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-rose-500 via-red-500 to-orange-500 shadow-[0_10px_24px_-8px_rgb(244_63_94/0.7)] ring-1 ring-white/25">
                <FileText className="size-5.5 text-white" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-base font-semibold tracking-tight text-white sm:text-lg">PDF Tools</h1>
                  <Badge variant="outline" className="hidden border-emerald-400/30 bg-emerald-500/10 text-[10px] text-emerald-300 sm:inline-flex">
                    100% on-device
                  </Badge>
                </div>
                <p className="truncate text-xs text-zinc-400">
                  {docs.length} file{docs.length > 1 ? 's' : ''} · {totalPages} page{totalPages !== 1 ? 's' : ''} · lossless page edits
                </p>
              </div>
              <Button
                onClick={pick}
                disabled={lock}
                className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-rose-500 to-red-500 px-3.5 text-white shadow-[0_10px_26px_-10px_rgb(244_63_94/0.8)] hover:from-rose-400 hover:to-red-400 sm:px-4"
              >
                <FilePlus2 className="size-4.5" aria-hidden />
                <span className="hidden sm:inline">Add PDF</span>
              </Button>
            </div>
            <AnimatePresence>
              {busy && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden border-t border-white/10 bg-black/30"
                >
                  <p className="flex items-center gap-2 px-4 py-2 text-xs text-rose-200">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    {busy}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ---------------- file chips ---------------- */}
          <section aria-label="PDF files" className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3 backdrop-blur sm:p-4">
            <div className="flex items-center gap-2">
              <Layers className="size-4 text-rose-300" aria-hidden />
              <h2 className="text-sm font-medium text-zinc-100">
                Files <span className="text-zinc-500">({docs.length})</span>
              </h2>
              <span className="ml-auto text-[11px] text-zinc-500">tap a file to open · order matters for merge</span>
            </div>
            <div className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
              {docs.map((doc, idx) => {
                const isActive = doc.id === activeId
                return (
                  <div
                    key={doc.id}
                    className={cn(
                      'flex items-center gap-1.5 rounded-xl border p-1.5 transition-colors',
                      isActive ? 'border-rose-400/50 bg-rose-500/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => activateDoc(doc)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg p-1 text-left"
                      aria-label={`Open ${doc.name} — ${doc.pageCount} pages`}
                      aria-pressed={isActive}
                    >
                      <span
                        className={cn(
                          'grid size-9 shrink-0 place-items-center rounded-lg ring-1',
                          isActive ? 'bg-rose-500/20 ring-rose-400/40' : 'bg-white/5 ring-white/10'
                        )}
                      >
                        <FileText className={cn('size-4.5', isActive ? 'text-rose-300' : 'text-zinc-400')} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-zinc-100">{doc.name}</span>
                        <span className="block text-[11px] text-zinc-500">
                          {doc.pageCount} page{doc.pageCount !== 1 ? 's' : ''} · {formatBytes(doc.size)}
                        </span>
                      </span>
                      {isActive && (
                        <Badge variant="outline" className="shrink-0 border-rose-400/40 bg-rose-500/15 text-[10px] text-rose-300">
                          Active
                        </Badge>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 text-zinc-400 hover:bg-white/10 hover:text-white"
                            disabled={idx === 0 || lock}
                            onClick={() => moveDoc(idx, -1)}
                            aria-label={`Move ${doc.name} up`}
                          >
                            <ArrowUp className="size-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Move up</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 text-zinc-400 hover:bg-white/10 hover:text-white"
                            disabled={idx === docs.length - 1 || lock}
                            onClick={() => moveDoc(idx, 1)}
                            aria-label={`Move ${doc.name} down`}
                          >
                            <ArrowDown className="size-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Move down</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 text-zinc-500 hover:bg-rose-500/15 hover:text-rose-300"
                            disabled={lock}
                            onClick={() => removeDoc(doc.id)}
                            aria-label={`Remove ${doc.name}`}
                          >
                            <X className="size-4" aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remove</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <p className="inline-flex min-w-0 items-center gap-1.5 text-xs text-zinc-400">
                <Merge className="size-3.5 shrink-0 text-rose-300" aria-hidden />
                <span className="truncate">Merge everything into one PDF, in the order above</span>
              </p>
              <Button
                onClick={() => void mergeAll()}
                disabled={docs.length < 2 || lock}
                className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-rose-500 to-red-500 px-4 text-white hover:from-rose-400 hover:to-red-400"
              >
                {busy === 'Merging PDFs…' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Merge className="size-4" aria-hidden />}
                Merge {docs.length > 1 ? `all ${docs.length}` : ''}
              </Button>
            </div>
          </section>

          {/* ---------------- sticky action bar ---------------- */}
          <div className="sticky bottom-3 z-20">
            <div
              role="toolbar"
              aria-label="Page actions"
              className="no-scrollbar flex items-center gap-1.5 overflow-x-auto rounded-2xl border border-white/10 bg-zinc-950/85 p-2 shadow-[0_18px_50px_-12px_rgb(0_0_0/0.85)] backdrop-blur-xl"
            >
              <Button
                onClick={() => void extractPages()}
                disabled={!activeDoc || lock}
                className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-rose-500 to-red-500 px-3 text-xs text-white hover:from-rose-400 hover:to-red-400 sm:text-sm"
              >
                {busy === 'Building PDF…' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileDown className="size-4" aria-hidden />}
                Extract
                <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-medium">
                  {selected.size > 0 ? selected.size : 'all'}
                </span>
              </Button>
              <Button
                onClick={() => void deletePages()}
                disabled={!activeDoc || lock}
                variant="outline"
                className="h-11 shrink-0 rounded-xl border-white/15 bg-white/5 px-3 text-xs text-zinc-100 hover:bg-white/10 hover:text-white sm:text-sm"
              >
                <Scissors className="size-4 text-rose-300" aria-hidden />
                Delete
                <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-medium">{selected.size > 0 ? selected.size : '—'}</span>
              </Button>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    disabled={!activeDoc || lock}
                    variant="outline"
                    className="h-11 shrink-0 rounded-xl border-white/15 bg-white/5 px-3 text-xs text-zinc-100 hover:bg-white/10 hover:text-white sm:text-sm"
                  >
                    <RotateCw className="size-4 text-amber-300" aria-hidden />
                    Rotate
                    {pendingRot > 0 && <span className="rounded-md bg-amber-400/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">{pendingRot}°</span>}
                    <ChevronDown className="size-3.5 text-zinc-500" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="border-white/10 bg-zinc-900/95 text-zinc-100 backdrop-blur">
                  <DropdownMenuLabel className="text-zinc-400">Rotate clockwise</DropdownMenuLabel>
                  {([90, 180, 270] as const).map((r) => (
                    <DropdownMenuItem
                      key={r}
                      className="text-zinc-100 focus:bg-white/10 focus:text-white"
                      onClick={() => setPendingRot(r)}
                    >
                      <RotateCw className="size-4 text-amber-300" aria-hidden />
                      {r}° — {selected.size > 0 ? `${selected.size} selected` : 'all pages'}
                      {pendingRot === r && <Check className="ml-auto size-4 text-emerald-400" aria-hidden />}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuItem
                    className="text-zinc-100 focus:bg-white/10 focus:text-white"
                    disabled={pendingRot === 0}
                    onClick={applyRotation}
                  >
                    <Check className="size-4 text-emerald-400" aria-hidden />
                    Apply rotation now
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                onClick={() => {
                  setRangeText('')
                  setRangeOpen(true)
                }}
                disabled={!activeDoc || lock}
                variant="outline"
                className="h-11 shrink-0 rounded-xl border-white/15 bg-white/5 px-3 text-xs text-zinc-100 hover:bg-white/10 hover:text-white sm:text-sm"
              >
                <BookOpenCheck className="size-4 text-rose-300" aria-hidden />
                Save range…
              </Button>

              <div className="mx-0.5 h-8 w-px shrink-0 bg-white/10" aria-hidden />

              <Button
                onClick={() => void mergeAll()}
                disabled={docs.length < 2 || lock}
                variant="outline"
                className="h-11 shrink-0 rounded-xl border-white/15 bg-white/5 px-3 text-xs text-zinc-100 hover:bg-white/10 hover:text-white sm:text-sm"
              >
                <Merge className="size-4 text-rose-300" aria-hidden />
                Merge
                <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-medium">{docs.length}</span>
              </Button>
            </div>
          </div>

          {/* ---------------- pages / thumbnails ---------------- */}
          {activeDoc && (
            <section aria-label="Pages" className="rounded-2xl border border-white/10 bg-zinc-950/70 p-3 backdrop-blur sm:p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-medium text-zinc-100">
                  Pages <span className="text-zinc-500">· {activeDoc.name}</span>
                </h2>
                <Badge
                  variant="outline"
                  className={cn(
                    'text-[10px]',
                    selected.size > 0
                      ? 'border-rose-400/40 bg-rose-500/15 text-rose-300'
                      : 'border-white/15 bg-white/5 text-zinc-400'
                  )}
                >
                  {selected.size > 0 ? `${selected.size} selected` : 'tap pages to select'}
                </Badge>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    onClick={selectAll}
                    variant="outline"
                    className="h-11 rounded-xl border-white/15 bg-white/5 px-3 text-xs text-zinc-100 hover:bg-white/10 hover:text-white"
                  >
                    <CheckCheck className="size-4 text-emerald-300" aria-hidden />
                    All
                  </Button>
                  <Button
                    onClick={clearSelection}
                    disabled={selected.size === 0}
                    variant="outline"
                    className="h-11 rounded-xl border-white/15 bg-white/5 px-3 text-xs text-zinc-100 hover:bg-white/10 hover:text-white"
                  >
                    <X className="size-4 text-zinc-400" aria-hidden />
                    None
                  </Button>
                </div>
              </div>

              <AnimatePresence>
                {pendingRot > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2"
                  >
                    <RotateCw className="size-4 shrink-0 text-amber-300" aria-hidden />
                    <p className="min-w-0 flex-1 text-xs text-amber-100">
                      Rotate <span className="font-semibold">{pendingRot}°</span> — {rotTarget}
                    </p>
                    <Button
                      onClick={applyRotation}
                      className="h-11 rounded-xl bg-gradient-to-r from-rose-500 to-red-500 px-3.5 text-xs text-white hover:from-rose-400 hover:to-red-400"
                    >
                      <Check className="size-4" aria-hidden />
                      Apply rotation
                    </Button>
                    <Button
                      onClick={() => setPendingRot(0)}
                      variant="ghost"
                      className="h-11 rounded-xl px-3 text-xs text-amber-200/80 hover:bg-white/10 hover:text-white"
                    >
                      Cancel
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>

              {(thumbBusy || thumbProgress) && (
                <p className="mt-3 flex items-center gap-2 text-xs text-zinc-500" role="status">
                  <Loader2 className="size-3.5 animate-spin text-rose-300" aria-hidden />
                  {thumbProgress ? `Rendering previews… ${thumbProgress.done} / ${thumbProgress.total}` : 'Rendering previews…'}
                </p>
              )}

              {thumbs.length > 0 ? (
                <div className="mt-3 grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6">
                  {thumbs.map((t) => {
                    const isSelected = selected.has(t.page)
                    const rot = activeDoc.rotations[t.page - 1] ?? 0
                    return (
                      <button
                        key={t.page}
                        type="button"
                        onClick={() => togglePage(t.page)}
                        aria-pressed={isSelected}
                        aria-label={`Page ${t.page}${isSelected ? ', selected' : ''}`}
                        className={cn(
                          'relative block w-full overflow-hidden rounded-xl border transition-all active:scale-[0.97]',
                          isSelected
                            ? 'border-rose-400 shadow-[0_10px_26px_-10px_rgb(244_63_94/0.8)] ring-2 ring-rose-400'
                            : 'border-white/10 hover:border-white/30'
                        )}
                      >
                        <span className="block aspect-[3/4] w-full bg-zinc-800 p-1">
                          <img src={t.url} alt={`Page ${t.page} preview`} loading="lazy" draggable={false} className="h-full w-full object-contain" />
                        </span>
                        <span className="absolute bottom-1 left-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
                          {t.page}
                        </span>
                        {rot > 0 && (
                          <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded-md bg-black/70 px-1 py-0.5 text-[10px] font-medium text-amber-300">
                            <RotateCw className="size-2.5" aria-hidden />
                            {rot}°
                          </span>
                        )}
                        {isSelected && (
                          <span className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-rose-500 text-white shadow">
                            <Check className="size-3" aria-hidden />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                !thumbBusy && (
                  <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 px-4 py-8 text-center">
                    <Lock className="size-5 text-zinc-500" aria-hidden />
                    <p className="text-xs text-zinc-500">Preview isn’t available for this file — extract, rotate and merge still work.</p>
                  </div>
                )
              )}

              {activeDoc.pageCount > THUMB_CAP && (
                <p className="mt-3 text-[11px] leading-relaxed text-zinc-500">
                  Showing the first {THUMB_CAP} of {activeDoc.pageCount} pages. Extract, Save range and Delete still reach every page — use
                  “Save range…” for pages beyond the previews.
                </p>
              )}
            </section>
          )}

          <p className="flex items-center justify-center gap-1.5 pb-1 pt-1 text-[11px] text-zinc-600">
            <ShieldCheck className="size-3.5 text-emerald-500/70" aria-hidden />
            Your files never leave this device
          </p>
        </div>
      )}

      {/* ---------------- save page range dialog ---------------- */}
      <Dialog open={rangeOpen} onOpenChange={setRangeOpen}>
        <DialogContent className="max-w-sm rounded-2xl border-white/10 bg-zinc-950 text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-white">Save page range</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Build a new PDF from the pages you list — for example <span className="font-mono text-rose-300">1-3,5</span>.
              {activeDoc ? ` This PDF has ${activeDoc.pageCount} pages.` : ''}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Input
              value={rangeText}
              onChange={(e) => setRangeText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && parsedRange.pages.length > 0) void saveRange()
              }}
              inputMode="numeric"
              autoComplete="off"
              placeholder="e.g. 1-3,5"
              aria-label="Page range"
              className="h-11 border-white/15 bg-white/5 font-mono text-white placeholder:text-zinc-600 focus-visible:ring-rose-400"
            />
            {activeDoc && (
              <p
                className={cn('mt-2 text-xs', parsedRange.error ? 'text-rose-300' : 'text-emerald-300')}
                role="status"
              >
                {parsedRange.error ?? `${parsedRange.pages.length} page${parsedRange.pages.length !== 1 ? 's' : ''}: ${parsedRange.pages.slice(0, 14).join(', ')}${parsedRange.pages.length > 14 ? '…' : ''}`}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setRangeOpen(false)} className="h-11 rounded-xl text-zinc-300 hover:bg-white/10 hover:text-white">
              Cancel
            </Button>
            <Button
              onClick={() => void saveRange()}
              disabled={parsedRange.pages.length === 0 || lock}
              className="h-11 rounded-xl bg-gradient-to-r from-rose-500 to-red-500 px-4 text-white hover:from-rose-400 hover:to-red-400"
            >
              <FileDown className="size-4" aria-hidden />
              Save PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
