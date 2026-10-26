'use client'

/**
 * Resume Builder — your story, one clean page.
 *
 * A sectioned resume editor (personal, summary, experience, education,
 * skills, projects) with three live A4 templates (Classic / Modern /
 * Compact), a vector-drawn jsPDF export with automatic pagination,
 * a system print dialog view, JSON import/export for device transfer,
 * and full IndexedDB write-through persistence for multiple resumes.
 * Everything stays on-device.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlignLeft,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Briefcase,
  Check,
  Copy,
  FileDown,
  FileText,
  FolderGit2,
  GraduationCap,
  Link2,
  LoaderCircle,
  Lock,
  Mail,
  MapPin,
  PanelsTopLeft,
  Phone,
  Plus,
  Printer,
  Sparkles,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type TemplateId = 'classic' | 'modern' | 'compact'

interface ExperienceRow {
  id: string
  role: string
  company: string
  start: string
  end: string
  /** one bullet per line */
  bullets: string
}

interface EducationRow {
  id: string
  degree: string
  school: string
  start: string
  end: string
  note: string
}

interface ProjectRow {
  id: string
  name: string
  link: string
  description: string
}

interface ResumeData {
  name: string
  title: string
  email: string
  phone: string
  location: string
  /** single free-form line: site · linkedin.com/in/you */
  links: string
  summary: string
  /** comma or newline separated */
  skills: string
  experience: ExperienceRow[]
  education: EducationRow[]
  projects: ProjectRow[]
}

interface Resume {
  id: string
  /** list label */
  name: string
  updatedAt: number
  template: TemplateId
  data: ResumeData
}

type ListKey = 'experience' | 'education' | 'projects'
type SectionKey = 'personal' | 'summary' | 'experience' | 'education' | 'skills' | 'projects'
type SheetProps = { d: ResumeData }

/* ================================================================== */
/* Constants                                                           */
/* ================================================================== */

const DB_NAME = 'toolhub-resumes'
const DB_VERSION = 1
const RESUME_STORE = 'resumes'

/** A4 at CSS 96 dpi — the coordinate space every sheet is drawn in. */
const PAGE_W = 794
const PAGE_H = 1123

const TEMPLATES: { id: TemplateId; label: string; icon: LucideIcon }[] = [
  { id: 'classic', label: 'Classic', icon: FileText },
  { id: 'modern', label: 'Modern', icon: PanelsTopLeft },
  { id: 'compact', label: 'Compact', icon: AlignLeft },
]

const THIN_SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

const SPRING = { type: 'spring', stiffness: 300, damping: 30 } as const

const PRINT_CSS = `
@media print {
  body > *:not(.resume-print-host) { display: none !important; }
  .resume-print-host { position: static !important; overflow: visible !important; background: #ffffff !important; padding: 0 !important; backdrop-filter: none !important; }
  .resume-print-scale { transform: none !important; }
  @page { size: A4; margin: 0; }
}
`

/* ================================================================== */
/* IndexedDB — multiple resumes, fully on-device                       */
/* ================================================================== */

let dbPromise: Promise<IDBDatabase> | null = null

function openResumeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(RESUME_STORE)) d.createObjectStore(RESUME_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openResumeDb()
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
/* Utilities                                                           */
/* ================================================================== */

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

function haptic(pattern: number | number[] = 12): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* haptics unsupported */
  }
}

function sstr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function parseSkills(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseBullets(raw: string): string[] {
  return raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function contactParts(d: ResumeData): string[] {
  return [d.email, d.phone, d.location, d.links].map((s) => s.trim()).filter(Boolean)
}

function dateRange(start: string, end: string): string {
  return [start.trim(), end.trim()].filter(Boolean).join(' – ')
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function fmtWhen(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function rowLive(role: string, company: string, extra: string, bullets: string): boolean {
  return Boolean(role.trim() || company.trim() || extra.trim() || parseBullets(bullets).length)
}

function resumeHasContent(r: Resume): boolean {
  const d = r.data
  return Boolean(
    d.name.trim() ||
      d.title.trim() ||
      d.email.trim() ||
      d.phone.trim() ||
      d.location.trim() ||
      d.links.trim() ||
      d.summary.trim() ||
      d.skills.trim() ||
      d.experience.length ||
      d.education.length ||
      d.projects.length
  )
}

/* ================================================================== */
/* Factories + tolerant loading                                        */
/* ================================================================== */

function blankExperience(): ExperienceRow {
  return { id: uid('exp'), role: '', company: '', start: '', end: '', bullets: '' }
}

function blankEducation(): EducationRow {
  return { id: uid('edu'), degree: '', school: '', start: '', end: '', note: '' }
}

function blankProject(): ProjectRow {
  return { id: uid('prj'), name: '', link: '', description: '' }
}

function emptyData(): ResumeData {
  return {
    name: '',
    title: '',
    email: '',
    phone: '',
    location: '',
    links: '',
    summary: '',
    skills: '',
    experience: [],
    education: [],
    projects: [],
  }
}

function emptyResume(): Resume {
  return { id: uid('r'), name: 'Untitled resume', updatedAt: Date.now(), template: 'classic', data: emptyData() }
}

function normExperience(v: unknown): ExperienceRow {
  const o = (v ?? {}) as Record<string, unknown>
  return {
    id: sstr(o.id) || uid('exp'),
    role: sstr(o.role),
    company: sstr(o.company),
    start: sstr(o.start),
    end: sstr(o.end),
    bullets: sstr(o.bullets),
  }
}

function normEducation(v: unknown): EducationRow {
  const o = (v ?? {}) as Record<string, unknown>
  return {
    id: sstr(o.id) || uid('edu'),
    degree: sstr(o.degree),
    school: sstr(o.school),
    start: sstr(o.start),
    end: sstr(o.end),
    note: sstr(o.note),
  }
}

function normProject(v: unknown): ProjectRow {
  const o = (v ?? {}) as Record<string, unknown>
  return { id: sstr(o.id) || uid('prj'), name: sstr(o.name), link: sstr(o.link), description: sstr(o.description) }
}

function normalizeResume(raw: unknown): Resume | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const dd = (o.data ?? {}) as Record<string, unknown>
  const template: TemplateId = o.template === 'modern' || o.template === 'compact' ? o.template : 'classic'
  return {
    id: sstr(o.id) || uid('r'),
    name: sstr(o.name) || 'Untitled resume',
    updatedAt: numOr(o.updatedAt, Date.now()),
    template,
    data: {
      name: sstr(dd.name),
      title: sstr(dd.title),
      email: sstr(dd.email),
      phone: sstr(dd.phone),
      location: sstr(dd.location),
      links: sstr(dd.links),
      summary: sstr(dd.summary),
      skills: sstr(dd.skills),
      experience: Array.isArray(dd.experience) ? dd.experience.map(normExperience) : [],
      education: Array.isArray(dd.education) ? dd.education.map(normEducation) : [],
      projects: Array.isArray(dd.projects) ? dd.projects.map(normProject) : [],
    },
  }
}

function sampleResume(): Resume {
  return {
    id: uid('r'),
    name: 'Ava Thornton — Product Designer',
    updatedAt: Date.now(),
    template: 'classic',
    data: {
      name: 'Ava Thornton',
      title: 'Senior Product Designer',
      email: 'ava@thornton.design',
      phone: '+1 (415) 555-0192',
      location: 'San Francisco, CA',
      links: 'thornton.design · linkedin.com/in/avathornton',
      summary:
        'Product designer with nine years shaping data-heavy B2B products. I turn messy workflows into interfaces people call “obvious” — and I measure it: every release ships with a metric it moved.',
      experience: [
        {
          id: uid('exp'),
          role: 'Senior Product Designer',
          company: 'Northwind Labs',
          start: '2021',
          end: 'Present',
          bullets:
            'Led the redesign of the analytics suite — weekly active usage up 38% within two quarters\nBuilt and documented the Northwind design system, now used by 40+ engineers\nRun weekly customer research sessions; insights feed a public, voted-on roadmap',
        },
        {
          id: uid('exp'),
          role: 'Product Designer',
          company: 'Brightline',
          start: '2018',
          end: '2021',
          bullets:
            'Owned onboarding end-to-end; activation rose from 41% to 63%\nIntroduced WCAG 2.1 AA accessibility audits across all new surfaces\nShipped the company’s first mobile app with a 4.8★ store rating',
        },
        {
          id: uid('exp'),
          role: 'UI Designer',
          company: 'Pixel & Co.',
          start: '2016',
          end: '2018',
          bullets: 'Designed marketing sites and product UI for 20+ startup clients\nSet up the studio’s first reusable component library',
        },
      ],
      education: [
        {
          id: uid('edu'),
          degree: 'B.S. Human-Computer Interaction',
          school: 'University of Washington',
          start: '2012',
          end: '2016',
          note: 'Graduated with honors · Design Society president',
        },
      ],
      skills:
        'Design systems, Figma, Prototyping, User research, Interaction design, Accessibility (WCAG), HTML/CSS, Data visualization',
      projects: [
        {
          id: uid('prj'),
          name: 'Atlas Design System',
          link: 'atlas.thornton.design',
          description: 'Open-source component library with tokens, docs and a Figma kit — 2.1k GitHub stars.',
        },
        {
          id: uid('prj'),
          name: 'Pulse',
          link: 'pulse.thornton.design',
          description: 'A calm, keyboard-first standup tool for remote teams. Side project, 4k users.',
        },
      ],
    },
  }
}

/* ================================================================== */
/* PDF export — vector-drawn per template, paginated by line budget    */
/* ================================================================== */

const PT = 0.352778 // mm per pt
const INK: [number, number, number] = [24, 24, 27] // zinc-900
const INK2: [number, number, number] = [63, 63, 70] // zinc-700
const INK3: [number, number, number] = [122, 122, 130] // zinc-500
const SLATE: [number, number, number] = [100, 116, 139] // slate-500
const RULE: [number, number, number] = [161, 161, 170] // zinc-400
const BAND_BG: [number, number, number] = [24, 24, 27] // zinc-900

type Style = 'normal' | 'bold' | 'italic' | 'bolditalic'

async function exportResumePdf(resume: Resume): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const d = resume.data
  const tpl = resume.template
  const parts = contactParts(d)
  const skills = parseSkills(d.skills)
  const exp = d.experience.filter((r) => rowLive(r.role, r.company, '', r.bullets))
  const edu = d.education.filter((r) => rowLive(r.degree, r.school, r.note, ''))
  const projects = d.projects.filter((r) => r.name.trim() || r.link.trim() || r.description.trim())
  const PW = 210
  const PH = 297

  if (tpl === 'modern') {
    /* ---- Modern: slate band (contact + skills) + main column ---- */
    const BAND = 60
    const TOP = 17
    const BOT = 16
    const mx = BAND + 9
    const mw = PW - mx - 13
    let y = TOP

    const drawBand = () => {
      doc.setFillColor(BAND_BG[0], BAND_BG[1], BAND_BG[2])
      doc.rect(0, 0, BAND, PH, 'F')
      let by = 18
      const head = (label: string) => {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(152, 152, 162)
        doc.text(label.toUpperCase(), 8, by, { charSpace: 0.7 })
        by += 5.6
      }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(255, 255, 255)
      doc.text(initialsOf(d.name) || 'CV', 8, by)
      by += 11
      if (parts.length) {
        head('Contact')
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(226, 226, 232)
        for (const part of parts) {
          const lines: string[] = doc.splitTextToSize(part, BAND - 17)
          for (const ln of lines) {
            if (by > 283) return
            doc.text(ln, 8, by)
            by += 4.4
          }
          by += 1.8
        }
        by += 2.2
      }
      if (skills.length) {
        head('Skills')
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(226, 226, 232)
        for (const s of skills.slice(0, 26)) {
          const lines: string[] = doc.splitTextToSize(`•  ${s}`, BAND - 17)
          for (const ln of lines) {
            if (by > 283) return
            doc.text(ln, 8, by)
            by += 4.2
          }
        }
      }
    }
    drawBand()

    const strip = () => {
      doc.setFillColor(BAND_BG[0], BAND_BG[1], BAND_BG[2])
      doc.rect(0, 0, 4.5, PH, 'F')
    }
    const newPage = () => {
      doc.addPage()
      strip()
      y = TOP
    }
    const room = (h: number) => {
      if (y + h > PH - BOT) newPage()
    }
    const setF = (size: number, style: Style = 'normal', c: [number, number, number] = INK2) => {
      doc.setFont('helvetica', style)
      doc.setFontSize(size)
      doc.setTextColor(c[0], c[1], c[2])
    }
    const flow = (text: string, x: number, w: number, size: number, style: Style, c: [number, number, number], k = 1.42) => {
      setF(size, style, c)
      const step = size * PT * k
      const lines: string[] = doc.splitTextToSize(text, w)
      for (const ln of lines) {
        room(step)
        doc.text(ln, x, y)
        y += step
      }
    }
    const bullet = (text: string, size: number) => {
      setF(size, 'normal', INK2)
      const step = size * PT * 1.38
      const lines: string[] = doc.splitTextToSize(text, mw - 4.4)
      lines.forEach((ln, i) => {
        room(step)
        if (i === 0) doc.text('•', mx + 1, y)
        doc.text(ln, mx + 4.4, y)
        y += step
      })
    }
    const heading = (label: string) => {
      room(14)
      y += 3
      setF(9.5, 'bold', INK)
      const up = label.toUpperCase()
      doc.text(up, mx, y, { charSpace: 0.8 })
      const tw = doc.getTextWidth(up) + 0.8 * up.length
      doc.setDrawColor(203, 203, 208)
      doc.setLineWidth(0.3)
      doc.line(mx + tw + 3, y - 1.1, PW - 13, y - 1.1)
      y += 5.2
    }

    setF(21, 'bold', INK)
    doc.text(d.name || 'Your Name', mx, y)
    y += 7.6
    if (d.title.trim()) {
      setF(11, 'normal', SLATE)
      doc.text(d.title.trim(), mx, y)
      y += 6.6
    }
    doc.setDrawColor(39, 39, 42)
    doc.setLineWidth(0.8)
    doc.line(mx, y - 1.4, mx + 26, y - 1.4)
    y += 3
    if (d.summary.trim()) {
      flow(d.summary.trim(), mx, mw, 9.5, 'normal', INK2)
      y += 2.5
    }
    if (exp.length) {
      heading('Experience')
      for (const e of exp) {
        room(14)
        setF(11, 'bold', INK)
        doc.text(e.role.trim() || 'Role', mx, y)
        const dr = dateRange(e.start, e.end)
        if (dr) {
          setF(8.5, 'normal', INK3)
          doc.text(dr, PW - 13, y, { align: 'right' })
        }
        y += 4.8
        if (e.company.trim()) {
          setF(9.5, 'normal', SLATE)
          doc.text(e.company.trim(), mx, y)
          y += 4.8
        }
        for (const b of parseBullets(e.bullets)) bullet(b, 9.5)
        y += 2
      }
    }
    if (edu.length) {
      heading('Education')
      for (const e of edu) {
        room(13)
        setF(10.5, 'bold', INK)
        doc.text(e.degree.trim() || 'Degree', mx, y)
        const dr = dateRange(e.start, e.end)
        if (dr) {
          setF(8.5, 'normal', INK3)
          doc.text(dr, PW - 13, y, { align: 'right' })
        }
        y += 4.6
        if (e.school.trim()) {
          setF(9.5, 'normal', SLATE)
          doc.text(e.school.trim(), mx, y)
          y += 4.6
        }
        if (e.note.trim()) flow(e.note.trim(), mx, mw, 9, 'italic', INK3)
        y += 1.8
      }
    }
    if (skills.length) {
      heading('Skills')
      flow(skills.join('   ·   '), mx, mw, 9.5, 'normal', INK2)
    }
    if (projects.length) {
      heading('Projects')
      for (const p of projects) {
        room(12)
        setF(10.5, 'bold', INK)
        doc.text(p.name.trim() || 'Project', mx, y)
        if (p.link.trim()) {
          setF(8.5, 'italic', INK3)
          doc.text(p.link.trim(), PW - 13, y, { align: 'right' })
        }
        y += 4.8
        if (p.description.trim()) flow(p.description.trim(), mx, mw, 9.5, 'normal', INK2)
        y += 1.8
      }
    }
  } else if (tpl === 'compact') {
    /* ---- Compact: single column, tight, small-caps headings ---- */
    const ML = 15
    const MR = 15
    const TOP = 13
    const BOT = 13
    const w = PW - ML - MR
    let y = TOP

    const newPage = () => {
      doc.addPage()
      y = TOP
    }
    const room = (h: number) => {
      if (y + h > PH - BOT) newPage()
    }
    const setF = (size: number, style: Style = 'normal', c: [number, number, number] = INK2) => {
      doc.setFont('helvetica', style)
      doc.setFontSize(size)
      doc.setTextColor(c[0], c[1], c[2])
    }
    const flow = (text: string, x: number, ww: number, size: number, style: Style, c: [number, number, number], k = 1.36) => {
      setF(size, style, c)
      const step = size * PT * k
      const lines: string[] = doc.splitTextToSize(text, ww)
      for (const ln of lines) {
        room(step)
        doc.text(ln, x, y)
        y += step
      }
    }
    const bullet = (text: string) => {
      setF(9, 'normal', INK2)
      const step = 9 * PT * 1.32
      const lines: string[] = doc.splitTextToSize(text, w - 4)
      lines.forEach((ln, i) => {
        room(step)
        if (i === 0) doc.text('•', ML + 0.8, y)
        doc.text(ln, ML + 3.8, y)
        y += step
      })
    }
    const heading = (label: string) => {
      room(10)
      y += 2.8
      setF(8.5, 'bold', INK)
      doc.text(label.toUpperCase(), ML, y, { charSpace: 0.6 })
      y += 1.6
      doc.setDrawColor(196, 196, 202)
      doc.setLineWidth(0.25)
      doc.line(ML, y - 0.8, PW - MR, y - 0.8)
      y += 3.6
    }

    setF(16, 'bold', INK)
    doc.text(d.name || 'Your Name', ML, y)
    y += 5.4
    const meta = [d.title.trim(), ...parts].filter(Boolean).join('   ·   ')
    if (meta) {
      setF(8.5, 'normal', INK3)
      const lines: string[] = doc.splitTextToSize(meta, w)
      for (const ln of lines) {
        doc.text(ln, ML, y)
        y += 3.9
      }
    }
    y += 0.6
    doc.setDrawColor(39, 39, 42)
    doc.setLineWidth(0.7)
    doc.line(ML, y, PW - MR, y)
    y += 2.4
    if (d.summary.trim()) {
      flow(d.summary.trim(), ML, w, 9, 'normal', INK2)
      y += 1.6
    }
    if (exp.length) {
      heading('Experience')
      for (const e of exp) {
        room(11)
        setF(10, 'bold', INK)
        doc.text(e.role.trim() || 'Role', ML, y)
        const dr = dateRange(e.start, e.end)
        if (dr) {
          setF(8, 'normal', INK3)
          doc.text(dr, PW - MR, y, { align: 'right' })
        }
        y += 4.2
        if (e.company.trim()) {
          setF(9, 'italic', SLATE)
          doc.text(e.company.trim(), ML, y)
          y += 4
        }
        for (const b of parseBullets(e.bullets)) bullet(b)
        y += 1.4
      }
    }
    if (edu.length) {
      heading('Education')
      for (const e of edu) {
        room(10)
        setF(10, 'bold', INK)
        doc.text(e.degree.trim() || 'Degree', ML, y)
        const dr = dateRange(e.start, e.end)
        if (dr) {
          setF(8, 'normal', INK3)
          doc.text(dr, PW - MR, y, { align: 'right' })
        }
        y += 4.2
        if (e.school.trim()) {
          setF(9, 'italic', SLATE)
          doc.text(e.school.trim(), ML, y)
          y += 4
        }
        if (e.note.trim()) flow(e.note.trim(), ML, w, 8.5, 'normal', INK3)
        y += 1.4
      }
    }
    if (skills.length) {
      heading('Skills')
      flow(skills.join('  ·  '), ML, w, 9, 'normal', INK2)
    }
    if (projects.length) {
      heading('Projects')
      for (const p of projects) {
        room(10)
        setF(10, 'bold', INK)
        doc.text(p.name.trim() || 'Project', ML, y)
        if (p.link.trim()) {
          setF(8, 'italic', INK3)
          doc.text(p.link.trim(), PW - MR, y, { align: 'right' })
        }
        y += 4.2
        if (p.description.trim()) flow(p.description.trim(), ML, w, 9, 'normal', INK2)
        y += 1.4
      }
    }
  } else {
    /* ---- Classic: serif, centered header, rule lines ---- */
    const ML = 19
    const MR = 19
    const TOP = 20
    const BOT = 18
    const w = PW - ML - MR
    let y = TOP

    const newPage = () => {
      doc.addPage()
      y = TOP
    }
    const room = (h: number) => {
      if (y + h > PH - BOT) newPage()
    }
    const setF = (size: number, style: Style = 'normal', c: [number, number, number] = INK2) => {
      doc.setFont('times', style)
      doc.setFontSize(size)
      doc.setTextColor(c[0], c[1], c[2])
    }
    const flow = (text: string, x: number, ww: number, size: number, style: Style, c: [number, number, number], k = 1.4) => {
      setF(size, style, c)
      const step = size * PT * k
      const lines: string[] = doc.splitTextToSize(text, ww)
      for (const ln of lines) {
        room(step)
        doc.text(ln, x, y)
        y += step
      }
    }
    const bullet = (text: string) => {
      setF(10.5, 'normal', INK2)
      const step = 10.5 * PT * 1.36
      const lines: string[] = doc.splitTextToSize(text, w - 4.4)
      lines.forEach((ln, i) => {
        room(step)
        if (i === 0) doc.text('•', ML + 1, y)
        doc.text(ln, ML + 4.4, y)
        y += step
      })
    }
    const heading = (label: string) => {
      room(13)
      y += 3.2
      setF(10.5, 'bold', INK2)
      doc.text(label.toUpperCase(), PW / 2, y, { align: 'center', charSpace: 1 })
      y += 2.4
      doc.setDrawColor(RULE[0], RULE[1], RULE[2])
      doc.setLineWidth(0.25)
      doc.line(PW / 2 - 18, y, PW / 2 + 18, y)
      y += 3.8
    }

    setF(22, 'bold', INK)
    doc.text(d.name || 'Your Name', PW / 2, y, { align: 'center' })
    y += 7
    if (d.title.trim()) {
      setF(10.5, 'normal', INK3)
      doc.text(d.title.trim().toUpperCase(), PW / 2, y, { align: 'center', charSpace: 1 })
      y += 6
    }
    if (parts.length) {
      setF(9.5, 'normal', INK3)
      const lines: string[] = doc.splitTextToSize(parts.join('   ·   '), w)
      for (const ln of lines) {
        doc.text(ln, PW / 2, y, { align: 'center' })
        y += 4.6
      }
    }
    y += 0.8
    doc.setDrawColor(39, 39, 42)
    doc.setLineWidth(0.5)
    doc.line(ML, y, PW - MR, y)
    y += 3.6
    if (d.summary.trim()) {
      heading('Summary')
      flow(d.summary.trim(), ML, w, 10.5, 'normal', INK2)
    }
    if (exp.length) {
      heading('Experience')
      for (const e of exp) {
        room(15)
        y += 1.2
        setF(12, 'bold', INK)
        doc.text(e.role.trim() || 'Role', ML, y)
        const dr = dateRange(e.start, e.end)
        if (dr) {
          setF(9.5, 'normal', INK3)
          doc.text(dr, PW - MR, y, { align: 'right' })
        }
        y += 5
        if (e.company.trim()) {
          setF(10.5, 'italic', INK2)
          doc.text(e.company.trim(), ML, y)
          y += 5
        }
        for (const b of parseBullets(e.bullets)) bullet(b)
        y += 1.6
      }
    }
    if (edu.length) {
      heading('Education')
      for (const e of edu) {
        room(13)
        y += 1
        setF(11.5, 'bold', INK)
        doc.text(e.degree.trim() || 'Degree', ML, y)
        const dr = dateRange(e.start, e.end)
        if (dr) {
          setF(9.5, 'normal', INK3)
          doc.text(dr, PW - MR, y, { align: 'right' })
        }
        y += 4.8
        if (e.school.trim()) {
          setF(10.5, 'italic', INK2)
          doc.text(e.school.trim(), ML, y)
          y += 4.8
        }
        if (e.note.trim()) flow(e.note.trim(), ML, w, 9.5, 'normal', INK3)
        y += 1.4
      }
    }
    if (skills.length) {
      heading('Skills')
      flow(skills.join('  ·  '), ML, w, 10, 'normal', INK2)
    }
    if (projects.length) {
      heading('Projects')
      for (const p of projects) {
        room(12)
        y += 1
        setF(11, 'bold', INK)
        doc.text(p.name.trim() || 'Project', ML, y)
        if (p.link.trim()) {
          setF(9, 'italic', INK3)
          doc.text(p.link.trim(), PW - MR, y, { align: 'right' })
        }
        y += 4.8
        if (p.description.trim()) flow(p.description.trim(), ML, w, 10, 'normal', INK2)
        y += 1.4
      }
    }
  }

  doc.save(`${slugify(resume.name) || 'resume'}.pdf`)
}

/* ================================================================== */
/* Small form atoms                                                    */
/* ================================================================== */

const INPUT_CLS =
  'w-full rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-white/30 focus:bg-white/[0.09]'

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={INPUT_CLS} />
    </label>
  )
}

function Area({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(INPUT_CLS, 'resize-y leading-relaxed')}
      />
    </label>
  )
}

function IconBtn({
  label,
  onClick,
  children,
  danger,
  disabled,
}: {
  label: string
  onClick: () => void
  children: ReactNode
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-xl border border-transparent text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30',
        danger && 'border-rose-400/25 bg-rose-500/15 text-rose-300 hover:bg-rose-500/25 hover:text-rose-200'
      )}
    >
      {children}
    </button>
  )
}

function ToolBtn({
  children,
  onClick,
  danger,
}: {
  children: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-10 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition-colors',
        danger
          ? 'border-rose-400/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20'
          : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10 hover:text-white'
      )}
    >
      {children}
    </button>
  )
}

function AddBtn({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 text-xs font-semibold text-zinc-400 transition-colors hover:border-emerald-400/40 hover:text-emerald-300"
    >
      <Plus className="size-4" aria-hidden />
      {children}
    </button>
  )
}

function Section({
  icon: Icon,
  title,
  badge,
  open,
  onToggle,
  children,
}: {
  icon: LucideIcon
  title: string
  badge?: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.03]"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-zinc-300">
          <Icon className="size-4.5" aria-hidden />
        </span>
        <span className="flex-1 text-sm font-bold tracking-tight">{title}</span>
        {badge !== undefined && badge > 0 && (
          <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-bold tabular-nums text-zinc-400">
            {badge}
          </span>
        )}
        <Chevronish open={open} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 32 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 border-t border-white/[0.06] p-3.5 sm:p-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function Chevronish({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn('size-4 shrink-0 text-zinc-500 transition-transform duration-200', open && 'rotate-180')}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function RowShell({
  index,
  total,
  title,
  onUp,
  onDown,
  onRemove,
  children,
}: {
  index: number
  total: number
  title: string
  onUp: () => void
  onDown: () => void
  onRemove: () => void
  children: ReactNode
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={SPRING}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5"
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-[11px] font-bold tabular-nums text-zinc-400">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-300">{title}</span>
        <div className="flex items-center gap-0.5">
          <IconBtn label="Move up" onClick={onUp} disabled={index === 0}>
            <ArrowUp className="size-3.5" aria-hidden />
          </IconBtn>
          <IconBtn label="Move down" onClick={onDown} disabled={index === total - 1}>
            <ArrowDown className="size-3.5" aria-hidden />
          </IconBtn>
          <IconBtn label="Remove row" onClick={onRemove} danger>
            <Trash2 className="size-3.5" aria-hidden />
          </IconBtn>
        </div>
      </div>
      {children}
    </motion.div>
  )
}

/* ================================================================== */
/* Paper sheets — drawn in a 794 × 1123 (A4 @ 96dpi) coordinate space  */
/* ================================================================== */

function Bullets({ items, className }: { items: string[]; className?: string }) {
  if (!items.length) return null
  return (
    <ul className={className}>
      {items.map((b, i) => (
        <li key={i} className="flex gap-1.5">
          <span aria-hidden className="select-none">
            •
          </span>
          <span className="min-w-0 flex-1">{b}</span>
        </li>
      ))}
    </ul>
  )
}

function ClassicHeading({ children }: { children: string }) {
  return (
    <div className="mb-2.5 text-center">
      <h2 className="text-[10.5px] font-bold uppercase tracking-[0.3em] text-zinc-800">{children}</h2>
      <div className="mx-auto mt-1 h-px w-14 bg-zinc-400" />
    </div>
  )
}

function ModernHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-2 flex items-center gap-2.5 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-800">
      {children}
      <span className="h-px flex-1 bg-zinc-300" aria-hidden />
    </h2>
  )
}

function CompactHeading({ children }: { children: string }) {
  return (
    <h2 className="mb-1.5 border-b border-zinc-300 pb-1 text-[9.5px] font-bold uppercase tracking-[0.22em] text-zinc-700">
      {children}
    </h2>
  )
}

function BandHeading({ children }: { children: string }) {
  return <h3 className="mb-2.5 text-[9px] font-bold uppercase tracking-[0.24em] text-zinc-500">{children}</h3>
}

function EmptyHint() {
  return (
    <div className="flex min-h-full items-center justify-center px-12 text-center">
      <p className="text-[13px] italic leading-relaxed text-zinc-300">
        Start typing on the left —<br />
        your page fills in live.
      </p>
    </div>
  )
}

function ClassicSheet({ d }: SheetProps) {
  const skills = parseSkills(d.skills)
  const parts = contactParts(d)
  const exp = d.experience.filter((r) => rowLive(r.role, r.company, '', r.bullets))
  const edu = d.education.filter((r) => rowLive(r.degree, r.school, r.note, ''))
  const projects = d.projects.filter((r) => r.name.trim() || r.link.trim() || r.description.trim())
  const empty =
    !d.name.trim() &&
    !d.title.trim() &&
    !d.summary.trim() &&
    !parts.length &&
    !skills.length &&
    !exp.length &&
    !edu.length &&
    !projects.length

  if (empty) {
    return (
      <div className="min-h-full px-[66px] py-[56px] font-serif text-zinc-900">
        <EmptyHint />
      </div>
    )
  }

  return (
    <div className="min-h-full px-[66px] py-[56px] font-serif text-zinc-900">
      <header className="text-center">
        <h1 className={cn('text-[34px] font-bold leading-tight tracking-tight', !d.name.trim() && 'text-zinc-300')}>
          {d.name || 'Your Name'}
        </h1>
        {d.title.trim() && (
          <p className="mt-1.5 text-[11.5px] font-medium uppercase tracking-[0.26em] text-zinc-500">{d.title}</p>
        )}
        {parts.length > 0 && <p className="mt-2 text-[11px] text-zinc-600">{parts.join('  ·  ')}</p>}
        <div className="mx-auto mt-4 h-[1.5px] w-full bg-zinc-800/80" aria-hidden />
      </header>

      {d.summary.trim() && (
        <section className="mt-5">
          <ClassicHeading>Summary</ClassicHeading>
          <p className="text-[11.5px] leading-[1.55] text-zinc-700">{d.summary}</p>
        </section>
      )}

      {exp.length > 0 && (
        <section className="mt-5">
          <ClassicHeading>Experience</ClassicHeading>
          {exp.map((r) => (
            <article key={r.id} className="mb-3 break-inside-avoid">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className={cn('text-[13px] font-bold', !r.role.trim() && 'text-zinc-400')}>{r.role || 'Role'}</h3>
                {dateRange(r.start, r.end) && (
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{dateRange(r.start, r.end)}</span>
                )}
              </div>
              {r.company.trim() && <p className="mt-0.5 text-[11.5px] italic text-zinc-600">{r.company}</p>}
              <Bullets items={parseBullets(r.bullets)} className="mt-1.5 text-[11px] leading-[1.5] text-zinc-700" />
            </article>
          ))}
        </section>
      )}

      {edu.length > 0 && (
        <section className="mt-5">
          <ClassicHeading>Education</ClassicHeading>
          {edu.map((r) => (
            <article key={r.id} className="mb-3 break-inside-avoid">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className={cn('text-[12.5px] font-bold', !r.degree.trim() && 'text-zinc-400')}>{r.degree || 'Degree'}</h3>
                {dateRange(r.start, r.end) && (
                  <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{dateRange(r.start, r.end)}</span>
                )}
              </div>
              {r.school.trim() && <p className="mt-0.5 text-[11.5px] italic text-zinc-600">{r.school}</p>}
              {r.note.trim() && <p className="mt-1 text-[10.5px] text-zinc-500">{r.note}</p>}
            </article>
          ))}
        </section>
      )}

      {skills.length > 0 && (
        <section className="mt-5">
          <ClassicHeading>Skills</ClassicHeading>
          <p className="text-[11px] leading-[1.55] text-zinc-700">{skills.join('  ·  ')}</p>
        </section>
      )}

      {projects.length > 0 && (
        <section className="mt-5">
          <ClassicHeading>Projects</ClassicHeading>
          {projects.map((r) => (
            <article key={r.id} className="mb-3 break-inside-avoid">
              <div className="flex items-baseline justify-between gap-4">
                <h3 className={cn('text-[12.5px] font-bold', !r.name.trim() && 'text-zinc-400')}>{r.name || 'Project'}</h3>
                {r.link.trim() && <span className="shrink-0 text-[10px] italic text-zinc-500">{r.link}</span>}
              </div>
              {r.description.trim() && <p className="mt-0.5 text-[11px] leading-[1.5] text-zinc-700">{r.description}</p>}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}

function contactItems(d: ResumeData): { icon: LucideIcon; value: string }[] {
  const out: { icon: LucideIcon; value: string }[] = []
  if (d.email.trim()) out.push({ icon: Mail, value: d.email.trim() })
  if (d.phone.trim()) out.push({ icon: Phone, value: d.phone.trim() })
  if (d.location.trim()) out.push({ icon: MapPin, value: d.location.trim() })
  if (d.links.trim()) out.push({ icon: Link2, value: d.links.trim() })
  return out
}

function ModernSheet({ d }: SheetProps) {
  const skills = parseSkills(d.skills)
  const contact = contactItems(d)
  const exp = d.experience.filter((r) => rowLive(r.role, r.company, '', r.bullets))
  const edu = d.education.filter((r) => rowLive(r.degree, r.school, r.note, ''))
  const projects = d.projects.filter((r) => r.name.trim() || r.link.trim() || r.description.trim())
  const empty =
    !d.name.trim() && !d.title.trim() && !d.summary.trim() && !contact.length && !skills.length && !exp.length && !edu.length && !projects.length

  if (empty) {
    return (
      <div className="min-h-full bg-white font-sans text-zinc-900">
        <EmptyHint />
      </div>
    )
  }

  return (
    <div className="flex min-h-full bg-white font-sans text-zinc-900">
      {/* accent column */}
      <aside className="w-[246px] shrink-0 bg-zinc-900 px-6 py-10 text-zinc-300">
        <div className="mb-7 flex size-14 items-center justify-center rounded-full bg-white/[0.08] text-[17px] font-bold tracking-wide text-white ring-1 ring-white/10">
          {d.name.trim() ? initialsOf(d.name) : <User className="size-6 text-zinc-500" aria-hidden />}
        </div>

        {contact.length > 0 && (
          <div className="mb-7">
            <BandHeading>Contact</BandHeading>
            <ul className="space-y-2">
              {contact.map((c, i) => (
                <li key={i} className="flex items-start gap-2">
                  <c.icon className="mt-[2px] size-3.5 shrink-0 text-zinc-500" aria-hidden />
                  <span className="min-w-0 flex-1 break-words text-[10.5px] leading-[1.5] text-zinc-200">{c.value}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {skills.length > 0 && (
          <div>
            <BandHeading>Skills</BandHeading>
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s, i) => (
                <span
                  key={i}
                  className="rounded-full border border-white/10 bg-white/[0.07] px-2 py-[3px] text-[9.5px] font-medium leading-none text-zinc-200"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* main column */}
      <main className="min-w-0 flex-1 px-8 py-10">
        <h1 className={cn('text-[30px] font-black leading-tight tracking-tight', !d.name.trim() && 'text-zinc-300')}>
          {d.name || 'Your Name'}
        </h1>
        {d.title.trim() && <p className="mt-1 text-[13px] font-medium tracking-wide text-slate-500">{d.title}</p>}
        {d.summary.trim() && <p className="mt-3.5 text-[11px] leading-[1.6] text-zinc-600">{d.summary}</p>}

        {exp.length > 0 && (
          <section className="mt-6">
            <ModernHeading>Experience</ModernHeading>
            {exp.map((r) => (
              <article key={r.id} className="mb-3 break-inside-avoid">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className={cn('text-[12.5px] font-bold', !r.role.trim() && 'text-zinc-400')}>{r.role || 'Role'}</h3>
                  {dateRange(r.start, r.end) && (
                    <span className="shrink-0 text-[9.5px] tabular-nums text-slate-400">{dateRange(r.start, r.end)}</span>
                  )}
                </div>
                {r.company.trim() && <p className="mt-px text-[11px] font-medium text-slate-600">{r.company}</p>}
                <Bullets items={parseBullets(r.bullets)} className="mt-1.5 text-[10.5px] leading-[1.55] text-zinc-600" />
              </article>
            ))}
          </section>
        )}

        {edu.length > 0 && (
          <section className="mt-6">
            <ModernHeading>Education</ModernHeading>
            {edu.map((r) => (
              <article key={r.id} className="mb-3 break-inside-avoid">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className={cn('text-[12px] font-bold', !r.degree.trim() && 'text-zinc-400')}>{r.degree || 'Degree'}</h3>
                  {dateRange(r.start, r.end) && (
                    <span className="shrink-0 text-[9.5px] tabular-nums text-slate-400">{dateRange(r.start, r.end)}</span>
                  )}
                </div>
                {r.school.trim() && <p className="mt-px text-[11px] font-medium text-slate-600">{r.school}</p>}
                {r.note.trim() && <p className="mt-0.5 text-[10px] text-slate-500">{r.note}</p>}
              </article>
            ))}
          </section>
        )}

        {projects.length > 0 && (
          <section className="mt-6">
            <ModernHeading>Projects</ModernHeading>
            {projects.map((r) => (
              <article key={r.id} className="mb-3 break-inside-avoid">
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className={cn('text-[12px] font-bold', !r.name.trim() && 'text-zinc-400')}>{r.name || 'Project'}</h3>
                  {r.link.trim() && <span className="shrink-0 text-[9.5px] text-slate-400">{r.link}</span>}
                </div>
                {r.description.trim() && (
                  <p className="mt-0.5 text-[10.5px] leading-[1.55] text-zinc-600">{r.description}</p>
                )}
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}

function CompactSheet({ d }: SheetProps) {
  const skills = parseSkills(d.skills)
  const parts = contactParts(d)
  const exp = d.experience.filter((r) => rowLive(r.role, r.company, '', r.bullets))
  const edu = d.education.filter((r) => rowLive(r.degree, r.school, r.note, ''))
  const projects = d.projects.filter((r) => r.name.trim() || r.link.trim() || r.description.trim())
  const empty =
    !d.name.trim() && !d.title.trim() && !d.summary.trim() && !parts.length && !skills.length && !exp.length && !edu.length && !projects.length

  if (empty) {
    return (
      <div className="min-h-full px-[52px] py-[42px] font-sans text-zinc-900">
        <EmptyHint />
      </div>
    )
  }

  return (
    <div className="min-h-full px-[52px] py-[42px] font-sans text-zinc-900">
      <header className="flex items-end justify-between gap-4 border-b-2 border-zinc-800 pb-3">
        <div className="min-w-0">
          <h1 className={cn('text-[24px] font-bold leading-tight tracking-tight', !d.name.trim() && 'text-zinc-300')}>
            {d.name || 'Your Name'}
          </h1>
          {d.title.trim() && (
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{d.title}</p>
          )}
        </div>
        {parts.length > 0 && (
          <p className="max-w-[46%] shrink-0 text-right text-[9.5px] leading-[1.5] text-zinc-600">{parts.join('  ·  ')}</p>
        )}
      </header>

      {d.summary.trim() && (
        <section className="mt-3.5">
          <CompactHeading>Summary</CompactHeading>
          <p className="text-[10px] leading-[1.5] text-zinc-700">{d.summary}</p>
        </section>
      )}

      {exp.length > 0 && (
        <section className="mt-3.5">
          <CompactHeading>Experience</CompactHeading>
          {exp.map((r) => (
            <article key={r.id} className="mb-2 break-inside-avoid">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className={cn('text-[11px] font-bold tracking-tight', !r.role.trim() && 'text-zinc-400')}>
                  {r.role || 'Role'}
                  {r.company.trim() && <span className="ml-1.5 font-normal italic text-zinc-500">· {r.company}</span>}
                </h3>
                {dateRange(r.start, r.end) && (
                  <span className="shrink-0 text-[9px] tabular-nums text-zinc-500">{dateRange(r.start, r.end)}</span>
                )}
              </div>
              <Bullets items={parseBullets(r.bullets)} className="mt-1 text-[9.5px] leading-[1.45] text-zinc-700" />
            </article>
          ))}
        </section>
      )}

      {edu.length > 0 && (
        <section className="mt-3.5">
          <CompactHeading>Education</CompactHeading>
          {edu.map((r) => (
            <article key={r.id} className="mb-2 break-inside-avoid">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className={cn('text-[11px] font-bold tracking-tight', !r.degree.trim() && 'text-zinc-400')}>
                  {r.degree || 'Degree'}
                  {r.school.trim() && <span className="ml-1.5 font-normal italic text-zinc-500">· {r.school}</span>}
                </h3>
                {dateRange(r.start, r.end) && (
                  <span className="shrink-0 text-[9px] tabular-nums text-zinc-500">{dateRange(r.start, r.end)}</span>
                )}
              </div>
              {r.note.trim() && <p className="mt-0.5 text-[9.5px] text-zinc-600">{r.note}</p>}
            </article>
          ))}
        </section>
      )}

      {skills.length > 0 && (
        <section className="mt-3.5">
          <CompactHeading>Skills</CompactHeading>
          <p className="text-[10px] leading-[1.55] text-zinc-700">{skills.join('  ·  ')}</p>
        </section>
      )}

      {projects.length > 0 && (
        <section className="mt-3.5">
          <CompactHeading>Projects</CompactHeading>
          {projects.map((r) => (
            <article key={r.id} className="mb-2 break-inside-avoid">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className={cn('text-[11px] font-bold tracking-tight', !r.name.trim() && 'text-zinc-400')}>{r.name || 'Project'}</h3>
                {r.link.trim() && <span className="shrink-0 text-[9px] text-zinc-500">{r.link}</span>}
              </div>
              {r.description.trim() && <p className="mt-0.5 text-[9.5px] leading-[1.45] text-zinc-700">{r.description}</p>}
            </article>
          ))}
        </section>
      )}
    </div>
  )
}

function Sheet({ template, d }: { template: TemplateId; d: ResumeData }) {
  if (template === 'modern') return <ModernSheet d={d} />
  if (template === 'compact') return <CompactSheet d={d} />
  return <ClassicSheet d={d} />
}

/* ================================================================== */
/* A4 live preview with overflow hint                                  */
/* ================================================================== */

function A4Preview({ resume }: { resume: Resume }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.42)
  const [overflow, setOverflow] = useState(false)

  /* keep the sheet scaled to the wrapper's real width */
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const update = () => setScale(wrap.clientWidth / PAGE_W)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [])

  /* overflow = content taller than one A4 page */
  useEffect(() => {
    const c = contentRef.current
    if (!c) return
    const check = () => setOverflow(c.scrollHeight > PAGE_H + 1)
    check()
    const ro = new ResizeObserver(check)
    ro.observe(c)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = contentRef.current
    if (!c) return
    setOverflow(c.scrollHeight > PAGE_H + 1)
  }, [resume])

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative mx-auto aspect-[210/297] w-full max-w-[340px] sm:max-w-[420px] lg:max-w-[560px]"
      >
        <div
          className="absolute left-0 top-0 origin-top-left overflow-hidden bg-white text-zinc-900 shadow-[0_24px_60px_-18px_rgb(0_0_0/0.6)] ring-1 ring-black/20"
          style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})` }}
          aria-label="Resume paper preview"
          role="img"
        >
          <div ref={contentRef}>
            <Sheet template={resume.template} d={resume.data} />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {overflow && (
          <motion.p
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={SPRING}
            className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-center text-[11px] font-medium text-amber-300"
            role="status"
          >
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            Content exceeds one page — the PDF export paginates automatically.
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function ResumeBuilderApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [resumes, setResumes] = useState<Resume[]>([])
  const [loaded, setLoaded] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [sectionsOpen, setSectionsOpen] = useState<Record<SectionKey, boolean>>({
    personal: true,
    summary: true,
    experience: true,
    education: true,
    skills: true,
    projects: true,
  })
  const [delArm, setDelArm] = useState<string | null>(null)
  const [sampleArmed, setSampleArmed] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const [printScale, setPrintScale] = useState(0.5)
  const fileRef = useRef<HTMLInputElement>(null)

  /* ---------------- persistence plumbing (debounced write-through) ---------------- */
  const pendingSave = useRef<Set<string>>(new Set())
  const saveTimer = useRef<number | null>(null)
  const resumesRef = useRef<Resume[]>([])
  const aliveRef = useRef(true)
  useEffect(() => {
    resumesRef.current = resumes
  })

  const flushSaves = useCallback(() => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (pendingSave.current.size === 0) return
    const ids = [...pendingSave.current]
    pendingSave.current.clear()
    for (const id of ids) {
      const r = resumesRef.current.find((x) => x.id === id)
      if (r) void idbPut(RESUME_STORE, r).catch(() => {
        /* memory-only fallback */
      })
    }
  }, [])

  const scheduleSaves = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      flushSaves()
    }, 350)
  }, [flushSaves])

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const all = await idbGetAll<Resume>(RESUME_STORE)
        if (!alive) return
        setResumes(
          all
            .map(normalizeResume)
            .filter((r): r is Resume => r !== null)
            .sort((a, b) => b.updatedAt - a.updatedAt)
        )
      } catch {
        /* private mode / quota — keep in-memory data */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* unmount: guard async work + flush pending writes */
  useEffect(
    () => () => {
      aliveRef.current = false
      flushSaves()
    },
    [flushSaves]
  )

  /* ---------------- mutations ---------------- */
  const patchResume = useCallback(
    (id: string, fn: (r: Resume) => Resume) => {
      setResumes((prev) => prev.map((r) => (r.id === id ? { ...fn(r), updatedAt: Date.now() } : r)))
      pendingSave.current.add(id)
      scheduleSaves()
    },
    [scheduleSaves]
  )

  const active = resumes.find((r) => r.id === openId) ?? null

  const patchData = useCallback(
    (patch: Partial<ResumeData> | ((d: ResumeData) => Partial<ResumeData>)) => {
      if (!openId) return
      patchResume(openId, (r) => ({
        ...r,
        data: { ...r.data, ...(typeof patch === 'function' ? patch(r.data) : patch) },
      }))
    },
    [openId, patchResume]
  )

  const updateRow = useCallback(
    <K extends ListKey>(key: K, rowId: string, patch: Partial<ResumeData[K][number]>) => {
      patchData((d) => {
        const rows = d[key]
        return { [key]: rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)) } as Partial<ResumeData>
      })
    },
    [patchData]
  )

  const addRow = useCallback(
    (key: ListKey) => {
      patchData((d) => {
        const blank = key === 'experience' ? blankExperience() : key === 'education' ? blankEducation() : blankProject()
        return { [key]: [...d[key], blank] } as Partial<ResumeData>
      })
      haptic()
    },
    [patchData]
  )

  const removeRow = useCallback(
    (key: ListKey, rowId: string) => {
      patchData((d) => ({ [key]: d[key].filter((row) => row.id !== rowId) }) as Partial<ResumeData>)
      haptic(8)
    },
    [patchData]
  )

  const moveRow = useCallback(
    (key: ListKey, rowId: string, dir: -1 | 1) => {
      patchData((d) => {
        const rows = [...d[key]]
        const i = rows.findIndex((row) => row.id === rowId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= rows.length) return {} as Partial<ResumeData>
        const tmp = rows[i]
        rows[i] = rows[j]
        rows[j] = tmp
        return { [key]: rows } as Partial<ResumeData>
      })
      haptic(8)
    },
    [patchData]
  )

  /* ---------------- library actions ---------------- */
  const armTimer = useRef<number | null>(null)
  const armOnce = useCallback((key: string, setter: (v: string | null) => void, current: string | null) => {
    if (current === key) return true
    setter(key)
    if (armTimer.current !== null) window.clearTimeout(armTimer.current)
    armTimer.current = window.setTimeout(() => setter(null), 2600)
    return false
  }, [])
  useEffect(
    () => () => {
      if (armTimer.current !== null) window.clearTimeout(armTimer.current)
    },
    []
  )

  const createResume = useCallback(
    (withSample: boolean) => {
      const r = withSample ? sampleResume() : emptyResume()
      setResumes((prev) => [r, ...prev])
      pendingSave.current.add(r.id)
      scheduleSaves()
      setOpenId(r.id)
      setDelArm(null)
      setSampleArmed(false)
      haptic()
      toast({ title: withSample ? 'Sample resume ready' : 'Resume created', description: r.name })
    },
    [scheduleSaves, toast]
  )

  const duplicateResume = useCallback(
    (r: Resume) => {
      const copy: Resume = {
        ...r,
        id: uid('r'),
        name: `${r.name || 'Untitled resume'} copy`,
        updatedAt: Date.now(),
        data: {
          ...r.data,
          experience: r.data.experience.map((e) => ({ ...e, id: uid('exp') })),
          education: r.data.education.map((e) => ({ ...e, id: uid('edu') })),
          projects: r.data.projects.map((e) => ({ ...e, id: uid('prj') })),
        },
      }
      setResumes((prev) => [copy, ...prev])
      pendingSave.current.add(copy.id)
      scheduleSaves()
      haptic()
      toast({ title: 'Duplicated', description: copy.name })
    },
    [scheduleSaves, toast]
  )

  const deleteResume = useCallback(
    (id: string) => {
      setResumes((prev) => prev.filter((r) => r.id !== id))
      pendingSave.current.delete(id)
      void idbDelete(RESUME_STORE, id).catch(() => {
        /* memory-only fallback */
      })
      setDelArm(null)
      haptic([12, 40, 12])
      toast({ title: 'Resume deleted' })
    },
    [toast]
  )

  const openResume = useCallback((id: string) => {
    setOpenId(id)
    setDelArm(null)
    setSampleArmed(false)
    haptic()
  }, [])

  const goBack = useCallback(() => {
    flushSaves()
    setOpenId(null)
    haptic()
  }, [flushSaves])

  /* ---------------- editor actions ---------------- */
  const setTemplate = useCallback(
    (t: TemplateId) => {
      if (!active || active.template === t) return
      patchResume(active.id, (r) => ({ ...r, template: t }))
      haptic()
    },
    [active, patchResume]
  )

  const loadSample = useCallback(() => {
    if (!active) return
    if (resumeHasContent(active) && !sampleArmed) {
      /* first tap on a non-empty resume: arm the overwrite confirmation */
      setSampleArmed(true)
      if (armTimer.current !== null) window.clearTimeout(armTimer.current)
      armTimer.current = window.setTimeout(() => setSampleArmed(false), 2600)
      return
    }
    setSampleArmed(false)
    const s = sampleResume()
    patchResume(active.id, (r) => ({
      ...s,
      id: r.id,
      name: r.name === 'Untitled resume' ? s.name : r.name,
      updatedAt: Date.now(),
    }))
    haptic()
    toast({ title: 'Sample resume loaded', description: 'Tweak anything — the preview follows live.' })
  }, [active, patchResume, sampleArmed, toast])

  const exportJson = useCallback(
    (r: Resume) => {
      try {
        const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${slugify(r.name) || 'resume'}.json`
        a.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 3000)
        haptic()
        toast({ title: 'JSON exported', description: 'Move it to another device and import it there.' })
      } catch {
        toast({ title: 'Export failed', description: 'The file could not be created.' })
      }
    },
    [toast]
  )

  const importJson = useCallback(
    async (file: File) => {
      try {
        const text = await file.text()
        const parsed: Resume | null = normalizeResume(JSON.parse(text) as unknown)
        if (!parsed) {
          toast({ title: 'Not a resume file', description: 'Expected a Resume Builder JSON export.' })
          return
        }
        const imported: Resume = { ...parsed, id: uid('r'), updatedAt: Date.now() }
        setResumes((prev) => [imported, ...prev])
        pendingSave.current.add(imported.id)
        scheduleSaves()
        setOpenId(imported.id)
        setDelArm(null)
        setSampleArmed(false)
        haptic()
        toast({ title: 'Resume imported', description: imported.name })
      } catch {
        toast({ title: 'Import failed', description: 'That file could not be read as JSON.' })
      }
    },
    [scheduleSaves, toast]
  )

  const exportPdf = useCallback(async () => {
    if (!active || exporting) return
    setExporting(true)
    try {
      await exportResumePdf(active)
      if (!aliveRef.current) return
      haptic()
      toast({ title: 'PDF exported', description: 'Vector-drawn A4 — clean at any zoom.' })
    } catch {
      if (aliveRef.current) toast({ title: 'Export failed', description: 'The PDF engine could not run here.' })
    } finally {
      if (aliveRef.current) setExporting(false)
    }
  }, [active, exporting, toast])

  /* ---------------- print view ---------------- */
  useEffect(() => {
    if (!printOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPrintOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [printOpen])

  useEffect(() => {
    if (!printOpen) return
    const update = () =>
      setPrintScale(Math.min(1, (window.innerWidth - 40) / PAGE_W, (window.innerHeight - 190) / PAGE_H))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [printOpen])

  const autoPrintedRef = useRef(false)
  useEffect(() => {
    if (!printOpen) {
      autoPrintedRef.current = false
      return
    }
    const t = window.setTimeout(() => {
      if (!autoPrintedRef.current) {
        autoPrintedRef.current = true
        window.print()
      }
    }, 450)
    return () => window.clearTimeout(t)
  }, [printOpen])

  /* ---------------- form helpers ---------------- */
  const toggleSection = useCallback((k: SectionKey) => {
    setSectionsOpen((s) => ({ ...s, [k]: !s[k] }))
    haptic(8)
  }, [])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto w-full max-w-6xl [color-scheme:dark]">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-slate-300 via-slate-400 to-zinc-600 px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-100 via-slate-300 to-zinc-500 text-zinc-900 ring-1 ring-white/40 shadow-[0_14px_32px_-10px_rgb(71_85_105/0.8),inset_0_1px_1px_rgb(255_255_255/0.5)]">
              <FileText className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/40 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight text-zinc-950">Resume Builder</h2>
              <p className="text-xs font-medium text-zinc-800/90">Your story, one clean page.</p>
            </div>
          </div>
        </div>

        {/* ---------------- Screens ---------------- */}
        <AnimatePresence mode="wait" initial={false}>
          {!loaded ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-3 p-5"
            >
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
              ))}
            </motion.div>
          ) : openId === null ? (
            /* ============ Library ============ */
            <motion.div
              key="library"
              initial={{ opacity: 0, x: -18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -18 }}
              transition={SPRING}
              className="mx-auto max-w-2xl p-4 sm:p-5"
            >
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => createResume(false)}
                  className="h-11 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
                >
                  <Plus className="size-4" aria-hidden /> New resume
                </Button>
                <ToolBtn onClick={() => createResume(true)}>
                  <Sparkles className="size-4" aria-hidden /> Load sample
                </ToolBtn>
                <ToolBtn onClick={() => fileRef.current?.click()}>
                  <Upload className="size-4" aria-hidden /> Import JSON
                </ToolBtn>
              </div>

              {resumes.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-14 text-center">
                  <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-white/[0.05]">
                    <FileText className="size-7 text-zinc-600" aria-hidden />
                  </div>
                  <p className="text-sm font-bold">No resumes yet</p>
                  <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed text-zinc-500">
                    Build a polished one-pager with a live A4 preview, then export a clean vector PDF — all on this
                    device.
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    <Button
                      onClick={() => createResume(false)}
                      className="h-11 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 font-semibold text-zinc-950 shadow-lg hover:from-teal-200 hover:to-emerald-400"
                    >
                      <Plus className="size-4" aria-hidden /> Create resume
                    </Button>
                    <ToolBtn onClick={() => createResume(true)}>
                      <Sparkles className="size-4" aria-hidden /> Load sample
                    </ToolBtn>
                  </div>
                </div>
              ) : (
                <ul className="space-y-2.5">
                  <AnimatePresence initial={false}>
                    {resumes.map((r) => (
                      <motion.li
                        key={r.id}
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={SPRING}
                        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3"
                      >
                        <button
                          type="button"
                          onClick={() => openResume(r.id)}
                          className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-xl px-1 text-left transition-colors hover:bg-white/[0.04]"
                        >
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-zinc-300">
                            <FileText className="size-4.5" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold">{r.name || 'Untitled resume'}</span>
                            <span className="block truncate text-[11px] text-zinc-500">
                              {TEMPLATES.find((t) => t.id === r.template)?.label ?? 'Classic'} · {fmtWhen(r.updatedAt)} ·{' '}
                              {r.data.experience.length} role{r.data.experience.length === 1 ? '' : 's'} ·{' '}
                              {r.data.education.length} degree{r.data.education.length === 1 ? '' : 's'}
                            </span>
                          </span>
                        </button>
                        <IconBtn label="Duplicate" onClick={() => duplicateResume(r)}>
                          <Copy className="size-4" aria-hidden />
                        </IconBtn>
                        <IconBtn
                          label={delArm === r.id ? 'Tap again to delete' : 'Delete'}
                          danger={delArm === r.id}
                          onClick={() => {
                            if (!armOnce(r.id, setDelArm, delArm)) return
                            deleteResume(r.id)
                          }}
                        >
                          {delArm === r.id ? (
                            <span className="text-[10px] font-bold leading-none">Sure?</span>
                          ) : (
                            <Trash2 className="size-4" aria-hidden />
                          )}
                        </IconBtn>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}

              <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-zinc-600">
                <Lock className="size-3" aria-hidden />
                Stored privately on this device — nothing leaves it.
              </p>
            </motion.div>
          ) : active ? (
            /* ============ Editor ============ */
            <motion.div
              key={`editor-${active.id}`}
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 18 }}
              transition={SPRING}
            >
              {/* toolbar */}
              <div className="space-y-3 border-b border-white/[0.06] bg-white/[0.02] px-4 py-3.5 sm:px-5">
                <div className="flex items-center gap-2.5">
                  <IconBtn label="Back to all resumes" onClick={goBack}>
                    <ArrowLeft className="size-4.5" aria-hidden />
                  </IconBtn>
                  <input
                    type="text"
                    value={active.name}
                    onChange={(e) => patchResume(active.id, (r) => ({ ...r, name: e.target.value }))}
                    placeholder="Resume name"
                    aria-label="Resume name"
                    className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.06] px-3 text-sm font-bold text-zinc-100 outline-none transition-colors placeholder:text-zinc-600 focus:border-white/30"
                  />
                  <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300 sm:flex">
                    <Check className="size-3" aria-hidden />
                    Auto-saved
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <motion.button
                    type="button"
                    whileTap={{ scale: 0.96 }}
                    onClick={() => void exportPdf()}
                    disabled={exporting}
                    className="flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 px-4 text-xs font-bold text-zinc-950 shadow-lg transition hover:from-teal-200 hover:to-emerald-400 disabled:opacity-60"
                  >
                    {exporting ? (
                      <LoaderCircle className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <FileDown className="size-4" aria-hidden />
                    )}
                    Export PDF
                  </motion.button>
                  <ToolBtn onClick={() => setPrintOpen(true)}>
                    <Printer className="size-4" aria-hidden /> Print view
                  </ToolBtn>
                  <ToolBtn onClick={() => exportJson(active)}>
                    <FileDown className="size-4 rotate-180" aria-hidden /> JSON
                  </ToolBtn>
                  <ToolBtn onClick={() => fileRef.current?.click()}>
                    <Upload className="size-4" aria-hidden /> Import
                  </ToolBtn>
                  <ToolBtn danger={sampleArmed} onClick={loadSample}>
                    <Sparkles className="size-4" aria-hidden /> {sampleArmed ? 'Overwrite?' : 'Load sample'}
                  </ToolBtn>
                </div>
              </div>

              {/* body: form | sticky preview */}
              <div className="flex flex-col gap-5 p-4 sm:p-5 lg:flex-row lg:items-start lg:gap-6">
                {/* form column */}
                <div className="min-w-0 flex-1 space-y-3">
                  {/* Personal */}
                  <Section
                    icon={User}
                    title="Personal"
                    open={sectionsOpen.personal}
                    onToggle={() => toggleSection('personal')}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Field
                          label="Full name"
                          value={active.data.name}
                          onChange={(v) => patchData({ name: v })}
                          placeholder="Ava Thornton"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Field
                          label="Title"
                          value={active.data.title}
                          onChange={(v) => patchData({ title: v })}
                          placeholder="Senior Product Designer"
                        />
                      </div>
                      <Field
                        label="Email"
                        value={active.data.email}
                        onChange={(v) => patchData({ email: v })}
                        placeholder="you@example.com"
                      />
                      <Field
                        label="Phone"
                        value={active.data.phone}
                        onChange={(v) => patchData({ phone: v })}
                        placeholder="+1 (555) 000-0000"
                      />
                      <Field
                        label="Location"
                        value={active.data.location}
                        onChange={(v) => patchData({ location: v })}
                        placeholder="Berlin, DE"
                      />
                      <Field
                        label="Links"
                        value={active.data.links}
                        onChange={(v) => patchData({ links: v })}
                        placeholder="site.dev · linkedin.com/in/you"
                      />
                    </div>
                  </Section>

                  {/* Summary */}
                  <Section
                    icon={AlignLeft}
                    title="Summary"
                    open={sectionsOpen.summary}
                    onToggle={() => toggleSection('summary')}
                  >
                    <Area
                      label="Professional summary"
                      value={active.data.summary}
                      onChange={(v) => patchData({ summary: v })}
                      rows={4}
                      placeholder="Two or three sentences: who you are, what you've shipped, and the numbers that prove it."
                    />
                  </Section>

                  {/* Experience */}
                  <Section
                    icon={Briefcase}
                    title="Experience"
                    badge={active.data.experience.length}
                    open={sectionsOpen.experience}
                    onToggle={() => toggleSection('experience')}
                  >
                    <div className="space-y-2.5">
                      <AnimatePresence initial={false}>
                        {active.data.experience.map((row, i) => (
                          <RowShell
                            key={row.id}
                            index={i}
                            total={active.data.experience.length}
                            title={row.role || row.company || 'New role'}
                            onUp={() => moveRow('experience', row.id, -1)}
                            onDown={() => moveRow('experience', row.id, 1)}
                            onRemove={() => removeRow('experience', row.id)}
                          >
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field
                                label="Role"
                                value={row.role}
                                onChange={(v) => updateRow('experience', row.id, { role: v })}
                                placeholder="Senior Product Designer"
                              />
                              <Field
                                label="Company"
                                value={row.company}
                                onChange={(v) => updateRow('experience', row.id, { company: v })}
                                placeholder="Northwind Labs"
                              />
                              <Field
                                label="Start"
                                value={row.start}
                                onChange={(v) => updateRow('experience', row.id, { start: v })}
                                placeholder="2021"
                              />
                              <Field
                                label="End"
                                value={row.end}
                                onChange={(v) => updateRow('experience', row.id, { end: v })}
                                placeholder="Present"
                              />
                            </div>
                            <div className="mt-3">
                              <Area
                                label="Bullets — one achievement per line"
                                value={row.bullets}
                                onChange={(v) => updateRow('experience', row.id, { bullets: v })}
                                rows={3}
                                placeholder={'Shipped the design system used by 40+ engineers\nCut onboarding time in half by rebuilding first-run'}
                              />
                            </div>
                          </RowShell>
                        ))}
                      </AnimatePresence>
                    </div>
                    <AddBtn onClick={() => addRow('experience')}>Add role</AddBtn>
                  </Section>

                  {/* Education */}
                  <Section
                    icon={GraduationCap}
                    title="Education"
                    badge={active.data.education.length}
                    open={sectionsOpen.education}
                    onToggle={() => toggleSection('education')}
                  >
                    <div className="space-y-2.5">
                      <AnimatePresence initial={false}>
                        {active.data.education.map((row, i) => (
                          <RowShell
                            key={row.id}
                            index={i}
                            total={active.data.education.length}
                            title={row.degree || row.school || 'New education'}
                            onUp={() => moveRow('education', row.id, -1)}
                            onDown={() => moveRow('education', row.id, 1)}
                            onRemove={() => removeRow('education', row.id)}
                          >
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field
                                label="Degree"
                                value={row.degree}
                                onChange={(v) => updateRow('education', row.id, { degree: v })}
                                placeholder="B.S. Computer Science"
                              />
                              <Field
                                label="School"
                                value={row.school}
                                onChange={(v) => updateRow('education', row.id, { school: v })}
                                placeholder="University of somewhere"
                              />
                              <Field
                                label="Start"
                                value={row.start}
                                onChange={(v) => updateRow('education', row.id, { start: v })}
                                placeholder="2015"
                              />
                              <Field
                                label="End"
                                value={row.end}
                                onChange={(v) => updateRow('education', row.id, { end: v })}
                                placeholder="2019"
                              />
                            </div>
                            <div className="mt-3">
                              <Area
                                label="Note"
                                value={row.note}
                                onChange={(v) => updateRow('education', row.id, { note: v })}
                                rows={2}
                                placeholder="Honors, thesis, societies…"
                              />
                            </div>
                          </RowShell>
                        ))}
                      </AnimatePresence>
                    </div>
                    <AddBtn onClick={() => addRow('education')}>Add education</AddBtn>
                  </Section>

                  {/* Skills */}
                  <Section
                    icon={Wrench}
                    title="Skills"
                    open={sectionsOpen.skills}
                    onToggle={() => toggleSection('skills')}
                  >
                    <Area
                      label="Skills — comma or line separated"
                      value={active.data.skills}
                      onChange={(v) => patchData({ skills: v })}
                      rows={4}
                      placeholder="Figma, Design systems, User research, Prototyping, HTML/CSS"
                    />
                    {parseSkills(active.data.skills).length > 0 && (
                      <div
                        className={cn(
                          'flex max-h-28 flex-wrap gap-1.5 overflow-y-auto pt-0.5',
                          THIN_SCROLLBAR
                        )}
                      >
                        {parseSkills(active.data.skills).map((s, i) => (
                          <span
                            key={i}
                            className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-zinc-300"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </Section>

                  {/* Projects */}
                  <Section
                    icon={FolderGit2}
                    title="Projects"
                    badge={active.data.projects.length}
                    open={sectionsOpen.projects}
                    onToggle={() => toggleSection('projects')}
                  >
                    <div className="space-y-2.5">
                      <AnimatePresence initial={false}>
                        {active.data.projects.map((row, i) => (
                          <RowShell
                            key={row.id}
                            index={i}
                            total={active.data.projects.length}
                            title={row.name || 'New project'}
                            onUp={() => moveRow('projects', row.id, -1)}
                            onDown={() => moveRow('projects', row.id, 1)}
                            onRemove={() => removeRow('projects', row.id)}
                          >
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field
                                label="Name"
                                value={row.name}
                                onChange={(v) => updateRow('projects', row.id, { name: v })}
                                placeholder="Atlas Design System"
                              />
                              <Field
                                label="Link"
                                value={row.link}
                                onChange={(v) => updateRow('projects', row.id, { link: v })}
                                placeholder="github.com/you/atlas"
                              />
                            </div>
                            <div className="mt-3">
                              <Area
                                label="Description"
                                value={row.description}
                                onChange={(v) => updateRow('projects', row.id, { description: v })}
                                rows={2}
                                placeholder="One or two lines: what it is and why it matters."
                              />
                            </div>
                          </RowShell>
                        ))}
                      </AnimatePresence>
                    </div>
                    <AddBtn onClick={() => addRow('projects')}>Add project</AddBtn>
                  </Section>
                </div>

                {/* preview column */}
                <div className="lg:sticky lg:top-5 lg:w-[600px] lg:shrink-0 lg:self-start">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3.5 sm:p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Live A4 preview
                      </p>
                      <div className="flex rounded-xl border border-white/10 bg-white/[0.05] p-1" role="radiogroup" aria-label="Template">
                        {TEMPLATES.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            role="radio"
                            aria-checked={active.template === t.id}
                            onClick={() => setTemplate(t.id)}
                            className={cn(
                              'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-all',
                              active.template === t.id
                                ? 'bg-white text-zinc-900 shadow'
                                : 'text-zinc-400 hover:text-zinc-200'
                            )}
                          >
                            <t.icon className="size-3.5" aria-hidden />
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <A4Preview resume={active} />

                    <p className="mt-3 text-center text-[11px] text-zinc-600">
                      A4 · 210 × 297 mm — exactly what the PDF export draws, vector-sharp.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            /* ============ Missing (defensive) ============ */
            <motion.div
              key="missing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="p-10 text-center"
            >
              <p className="text-sm text-zinc-400">That resume no longer exists.</p>
              <Button
                onClick={() => setOpenId(null)}
                className="mt-4 h-11 rounded-xl bg-white/10 font-semibold text-zinc-100 hover:bg-white/15"
              >
                <ArrowLeft className="size-4" aria-hidden /> Back
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* hidden file input for JSON import */}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importJson(f)
          e.target.value = ''
        }}
      />

      {/* ---------------- Print view (portal to <body>) ---------------- */}
      {printOpen &&
        active &&
        createPortal(
          <div
            className="resume-print-host fixed inset-0 z-[300] overflow-auto bg-zinc-950/95 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Print view"
          >
            <style>{PRINT_CSS}</style>
            <div className="mx-auto flex w-fit flex-col items-center gap-4">
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 text-xs font-medium text-zinc-400">
                  <Printer className="size-4" aria-hidden />
                  Tip: choose “Save as PDF” in the dialog
                </span>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.96 }}
                  onClick={() => window.print()}
                  className="flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-teal-300 to-emerald-500 px-4 text-xs font-bold text-zinc-950 shadow-lg transition hover:from-teal-200 hover:to-emerald-400"
                >
                  <Printer className="size-4" aria-hidden /> Print
                </motion.button>
                <button
                  type="button"
                  onClick={() => setPrintOpen(false)}
                  className="flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden /> Close
                </button>
              </div>

              <div className="resume-print-scale" style={{ transform: `scale(${printScale})`, transformOrigin: 'top center' }}>
                <div
                  className="w-[794px] bg-white"
                  style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as React.CSSProperties}
                >
                  <Sheet template={active.template} d={active.data} />
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
