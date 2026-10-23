'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  LockKeyhole,
  LogOut,
  Pencil,
  Plus,
  Share2,
  ShieldCheck,
  Star,
  Trash2,
  Unlock,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { useExternalApps } from '@/lib/tools/external'
import type { ExternalAppPayload } from '@/lib/tools/external'
import { EXTERNAL_GRADIENTS, EXTERNAL_ICONS, externalIcon } from '@/lib/tools/external-icons'

/* ------------------------------------------------------------------ */
/* Local metadata                                                      */
/* ------------------------------------------------------------------ */

const CATEGORIES: { id: string; name: string }[] = [
  { id: 'utilities', name: 'Utilities' },
  { id: 'daily', name: 'Everyday' },
  { id: 'media', name: 'Media' },
  { id: 'games', name: 'Games' },
  { id: 'calculator', name: 'Calculators' },
  { id: 'converter', name: 'Converters' },
  { id: 'generator', name: 'Generators' },
  { id: 'text', name: 'Text' },
  { id: 'developer', name: 'Developer' },
]

interface FormState {
  name: string
  url: string
  description: string
  tagline: string
  category: string
  icon: string
  gradient: string
  glow: string
  keywords: string
  featured: boolean
  active: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  url: 'https://',
  description: '',
  tagline: '',
  category: 'utilities',
  icon: 'Globe',
  gradient: EXTERNAL_GRADIENTS[0].gradient,
  glow: EXTERNAL_GRADIENTS[0].glow,
  keywords: '',
  featured: false,
  active: true,
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/* ================================================================== */
/* Admin Console                                                       */
/* ================================================================== */

export default function AdminConsole() {
  const { toast } = useToast()
  const reloadExternals = useExternalApps((s) => s.reload)

  const [phase, setPhase] = useState<'checking' | 'locked' | 'unlocked'>('checking')
  const [apps, setApps] = useState<ExternalAppPayload[]>([])
  const [loadingList, setLoadingList] = useState(false)

  /* dialog + delete state */
  const [editing, setEditing] = useState<ExternalAppPayload | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ExternalAppPayload | null>(null)

  /* ---------------- session ---------------- */
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/session', { cache: 'no-store' })
      const data = (await res.json()) as { authenticated?: boolean }
      setPhase(data.authenticated ? 'unlocked' : 'locked')
    } catch {
      setPhase('locked')
    }
  }, [])

  useEffect(() => {
    void checkSession()
  }, [checkSession])

  /* ---------------- list ---------------- */
  const loadList = useCallback(async () => {
    setLoadingList(true)
    try {
      const res = await fetch('/api/admin/external-apps', { cache: 'no-store' })
      if (res.status === 401) {
        setPhase('locked')
        return
      }
      const data = (await res.json()) as { apps?: ExternalAppPayload[] }
      setApps(Array.isArray(data?.apps) ? data.apps : [])
    } catch {
      toast({
        title: 'Could not load platforms',
        description: 'Check your connection and try again.',
        variant: 'destructive',
      })
    } finally {
      setLoadingList(false)
    }
  }, [toast])

  useEffect(() => {
    if (phase === 'unlocked') void loadList()
  }, [phase, loadList])

  const afterMutation = useCallback(async () => {
    await loadList()
    await reloadExternals()
  }, [loadList, reloadExternals])

  const logout = useCallback(async () => {
    try {
      await fetch('/api/admin/session', { method: 'DELETE' })
    } catch {
      /* ignore */
    }
    setPhase('locked')
    toast({ title: 'Signed out', description: 'Admin session ended on this device.' })
  }, [toast])

  /* ---------------- derived ---------------- */
  const liveCount = useMemo(() => apps.filter((a) => a.active).length, [apps])
  const [hubOrigin, setHubOrigin] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setHubOrigin(window.location.origin)
  }, [])

  const copyHub = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(hubOrigin)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
      toast({ title: 'Hub link copied', description: 'Share it — everyone gets your platforms.' })
    } catch {
      toast({ title: 'Copy failed', description: 'Long-press the link to copy manually.', variant: 'destructive' })
    }
  }, [hubOrigin, toast])

  /* ================= render ================= */
  if (phase === 'checking') {
    return (
      <div className="flex items-center justify-center gap-2.5 py-20 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        <span className="text-sm">Checking admin session…</span>
      </div>
    )
  }

  if (phase === 'locked') {
    return <LoginCard onUnlocked={() => setPhase('unlocked')} />
  }

  return (
    <div className="space-y-5 pb-6">
      {/* overview */}
      <div className="overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-slate-900 via-zinc-900 to-stone-950 p-5 text-white shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-white/60">
              <ShieldCheck className="size-3.5" aria-hidden /> Owner controls
            </p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight">Linked platforms</h2>
            <p className="mt-1 text-sm text-white/70">
              {apps.length === 0
                ? 'No platforms yet — add your first PWA below.'
                : `${apps.length} platform${apps.length === 1 ? '' : 's'} · ${liveCount} live in the store`}
            </p>
          </div>
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/10 ring-1 ring-white/20">
            <Globe className="size-6" aria-hidden />
          </span>
        </div>

        {/* share hub */}
        <div className="mt-4 flex items-center gap-2 rounded-2xl bg-white/[0.08] p-2 pl-3.5 ring-1 ring-white/15">
          <Share2 className="size-4 shrink-0 text-white/60" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-xs text-white/85" title={hubOrigin}>
            {hubOrigin || '…'}
          </span>
          <Button
            size="sm"
            className="h-8 shrink-0 gap-1.5 rounded-full bg-white text-slate-900 hover:bg-white/90"
            onClick={() => void copyHub()}
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        <p className="mt-2 text-[11px] leading-snug text-white/50">
          Anyone who opens this hub sees your platforms in the App Store — one share, all your apps.
        </p>
      </div>

      {/* list */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold tracking-tight">Your platforms</h2>
          <Button
            size="sm"
            className="h-9 gap-1.5 rounded-full px-4"
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus className="size-4" aria-hidden /> Add platform
          </Button>
        </div>

        {loadingList && apps.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            <span className="text-sm">Loading…</span>
          </div>
        ) : apps.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed py-12 text-center">
            <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
              <Globe className="size-7" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold">No linked platforms yet</p>
              <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                Add the PWAs you already own — users tap Get and the platform lands on their home
                screen as a shortcut. Nothing is bundled or uploaded.
              </p>
            </div>
            <Button
              size="sm"
              className="mt-1 h-9 gap-1.5 rounded-full px-4"
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              <Plus className="size-4" aria-hidden /> Add your first platform
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
            {apps.map((a) => {
              const Icon = externalIcon(a.icon)
              return (
                <div key={a.id} className="flex items-center gap-3 px-3.5 py-3">
                  <span
                    className={cn(
                      'flex size-11 shrink-0 items-center justify-center rounded-[0.9rem] bg-gradient-to-br text-white ring-1 ring-black/5',
                      a.gradient
                    )}
                  >
                    <Icon className="size-5.5" strokeWidth={1.9} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                      {a.name}
                      {a.featured && (
                        <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label="Featured" />
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{hostOf(a.url)}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <Badge
                        variant={a.active ? 'secondary' : 'outline'}
                        className={cn(
                          'h-5 px-1.5 text-[10px]',
                          a.active
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                            : 'text-muted-foreground'
                        )}
                      >
                        {a.active ? 'Live' : 'Hidden'}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground/70">
                        {CATEGORIES.find((c) => c.id === a.category)?.name ?? 'Utilities'}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 rounded-full"
                      onClick={() => window.open(a.url, '_blank', 'noopener,noreferrer')}
                      aria-label={`Open ${a.name} in a new tab`}
                    >
                      <ExternalLink className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 rounded-full"
                      onClick={() => {
                        setEditing(a)
                        setFormOpen(true)
                      }}
                      aria-label={`Edit ${a.name}`}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-9 rounded-full text-destructive hover:bg-destructive/10"
                      onClick={() => setPendingDelete(a)}
                      aria-label={`Delete ${a.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* footer actions */}
      <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-sm">
        <p className="text-xs text-muted-foreground">
          Changes apply to every user of this hub instantly.
        </p>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void logout()}>
          <LogOut className="size-4" aria-hidden /> Sign out
        </Button>
      </div>

      {/* add / edit dialog */}
      <PlatformFormDialog
        open={formOpen}
        editing={editing}
        onOpenChange={setFormOpen}
        onSaved={() => void afterMutation()}
      />

      {/* delete confirm */}
      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The platform disappears from the store for everyone and existing home-screen
              shortcuts stop working. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => void confirmDelete(pendingDelete, setPendingDelete, toast, afterMutation)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

async function confirmDelete(
  target: ExternalAppPayload | null,
  clear: (v: null) => void,
  toast: ReturnType<typeof useToast>['toast'],
  after: () => Promise<void>
): Promise<void> {
  if (!target) return
  clear(null)
  try {
    const res = await fetch(`/api/admin/external-apps/${encodeURIComponent(target.id)}`, {
      method: 'DELETE',
    })
    if (!res.ok) throw new Error('failed')
    toast({ title: `${target.name} removed`, description: 'It is gone from every user\u2019s store.' })
    await after()
  } catch {
    toast({ title: 'Could not remove the platform', variant: 'destructive' })
  }
}

/* ================================================================== */
/* Login card                                                          */
/* ================================================================== */

function LoginCard({ onUnlocked }: { onUnlocked: () => void }) {
  const { toast } = useToast()
  const [passcode, setPasscode] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = useCallback(async () => {
    if (!passcode.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: passcode.trim() }),
      })
      if (res.ok) {
        setPasscode('')
        toast({ title: 'Welcome back, owner 👑', description: 'Admin session started for 7 days.' })
        onUnlocked()
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error || 'Incorrect passcode')
      }
    } catch {
      setError('Network error — try again')
    } finally {
      setBusy(false)
    }
  }, [passcode, busy, onUnlocked, toast])

  return (
    <div className="flex flex-col items-center pb-6 pt-4">
      <div className="w-full max-w-sm rounded-3xl border border-border/70 bg-card p-6 shadow-lg">
        <div className="flex flex-col items-center text-center">
          <span className="grid size-16 place-items-center rounded-3xl bg-gradient-to-br from-slate-500 via-zinc-600 to-zinc-800 text-white shadow-lg">
            <LockKeyhole className="size-8" strokeWidth={1.8} aria-hidden />
          </span>
          <h1 className="mt-3.5 text-lg font-extrabold tracking-tight">Admin Console</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Only the hub owner can add or remove linked platforms. Enter the admin passcode to
            continue.
          </p>
        </div>

        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="relative">
            <Input
              type={show ? 'text' : 'password'}
              value={passcode}
              onChange={(e) => {
                setPasscode(e.target.value)
                setError(null)
              }}
              placeholder="Admin passcode"
              aria-label="Admin passcode"
              aria-invalid={Boolean(error)}
              className="h-11 rounded-xl pr-11"
              autoFocus
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Hide passcode' : 'Show passcode'}
              className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" className="h-11 w-full gap-2 rounded-xl text-sm font-semibold" disabled={busy || !passcode.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Unlock className="size-4" aria-hidden />}
            {busy ? 'Checking…' : 'Unlock console'}
          </Button>
        </form>

        <p className="mt-4 rounded-xl bg-muted/60 p-3 text-[11px] leading-snug text-muted-foreground">
          The passcode is configured by the hub owner with the <code className="font-mono">ADMIN_PASSCODE</code>{' '}
          environment variable and never expires until you sign out.
        </p>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Add / edit form dialog                                              */
/* ================================================================== */

function PlatformFormDialog({
  open,
  editing,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  editing: ExternalAppPayload | null
  onOpenChange: (v: boolean) => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)

  /* seed the form each time the dialog opens */
  useEffect(() => {
    if (!open) return
    if (editing) {
      setForm({
        name: editing.name,
        url: editing.url,
        description: editing.description,
        tagline: editing.tagline ?? '',
        category: editing.category || 'utilities',
        icon: editing.icon || 'Globe',
        gradient: editing.gradient,
        glow: editing.glow,
        keywords: editing.keywords ?? '',
        featured: editing.featured,
        active: editing.active,
      })
    } else {
      setForm(EMPTY_FORM)
    }
    setFieldError(null)
  }, [open, editing])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = useCallback(async () => {
    if (busy) return
    if (!form.name.trim() || !form.url.trim() || !form.description.trim()) {
      setFieldError('Name, URL and description are required.')
      return
    }
    setBusy(true)
    setFieldError(null)
    try {
      const url = editing
        ? `/api/admin/external-apps/${encodeURIComponent(editing.id)}`
        : '/api/admin/external-apps'
      const res = await fetch(url, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          url: form.url.trim(),
          description: form.description.trim(),
          tagline: form.tagline.trim(),
          category: form.category,
          icon: form.icon,
          gradient: form.gradient,
          glow: form.glow,
          keywords: form.keywords.trim(),
          featured: form.featured,
          active: form.active,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setFieldError(data.error || 'Could not save. Check the fields and try again.')
        return
      }
      toast({
        title: editing ? `${form.name.trim()} updated` : `${form.name.trim()} is live 🚀`,
        description: editing
          ? 'Changes are visible to everyone using the hub.'
          : 'Users can now install it from the App Store.',
      })
      onOpenChange(false)
      onSaved()
    } catch {
      setFieldError('Network error — try again.')
    } finally {
      setBusy(false)
    }
  }, [busy, form, editing, onOpenChange, onSaved, toast])

  const IconPreview = externalIcon(form.icon)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86dvh] overflow-y-auto rounded-3xl sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-left">
            {editing ? `Edit ${editing.name}` : 'Add a linked platform'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* live tile preview */}
          <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/40 p-3">
            <span
              className={cn(
                'flex size-12 shrink-0 items-center justify-center rounded-[0.95rem] bg-gradient-to-br text-white ring-1 ring-black/5',
                form.gradient
              )}
            >
              <IconPreview className="size-6" strokeWidth={1.9} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{form.name || 'Platform name'}</p>
              <p className="truncate text-xs text-muted-foreground">
                {form.tagline.trim() || form.description.trim() || 'How it appears in the store'}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pa-name">Name *</Label>
            <Input
              id="pa-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. My Recipe App"
              maxLength={60}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pa-url">Platform URL *</Label>
            <Input
              id="pa-url"
              value={form.url}
              onChange={(e) => set('url', e.target.value)}
              placeholder="https://your-app.vercel.app"
              inputMode="url"
              type="url"
            />
            <p className="text-[11px] text-muted-foreground">
              The PWA or website link — users open it right inside ToolHub.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pa-desc">Description *</Label>
            <Textarea
              id="pa-desc"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What does this platform do?"
              rows={2}
              maxLength={400}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pa-tagline">Tagline</Label>
              <Input
                id="pa-tagline"
                value={form.tagline}
                onChange={(e) => set('tagline', e.target.value)}
                placeholder="Short store subtitle"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pa-keywords">Search keywords</Label>
              <Input
                id="pa-keywords"
                value={form.keywords}
                onChange={(e) => set('keywords', e.target.value)}
                placeholder="recipes, cooking, food"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => set('category', v)}>
              <SelectTrigger className="w-full rounded-xl" aria-label="Category">
                <SelectValue placeholder="Pick a category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Icon</Label>
            <div className="grid max-h-36 grid-cols-8 gap-1.5 overflow-y-auto rounded-2xl border border-border/70 p-2 sm:grid-cols-10">
              {Object.entries(EXTERNAL_ICONS).map(([name, Icon]) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => set('icon', name)}
                  aria-label={`Icon ${name}`}
                  aria-pressed={form.icon === name}
                  className={cn(
                    'grid aspect-square place-items-center rounded-xl text-muted-foreground transition',
                    form.icon === name
                      ? 'bg-primary text-primary-foreground shadow'
                      : 'hover:bg-muted'
                  )}
                >
                  <Icon className="size-4.5" strokeWidth={1.9} aria-hidden />
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Tile color</Label>
            <div className="flex flex-wrap gap-2">
              {EXTERNAL_GRADIENTS.map((g) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => {
                    set('gradient', g.gradient)
                    set('glow', g.glow)
                  }}
                  aria-label={`Color ${g.label}`}
                  aria-pressed={form.gradient === g.gradient}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 text-[11px] font-medium transition',
                    form.gradient === g.gradient
                      ? 'border-primary ring-1 ring-primary'
                      : 'border-border hover:bg-muted'
                  )}
                >
                  <span className={cn('size-5 rounded-full bg-gradient-to-br', g.gradient)} />
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-border/70 p-3">
            <div className="flex items-center gap-2.5">
              <Star className={cn('size-4.5', form.featured ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')} aria-hidden />
              <div>
                <Label htmlFor="pa-featured" className="text-sm">Feature in the store</Label>
                <p className="text-[11px] text-muted-foreground">Highlighted at the top of the App Store.</p>
              </div>
            </div>
            <Switch id="pa-featured" checked={form.featured} onCheckedChange={(v) => set('featured', v)} />
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-border/70 p-3">
            <div className="flex items-center gap-2.5">
              <Globe className="size-4.5 text-muted-foreground" aria-hidden />
              <div>
                <Label htmlFor="pa-active" className="text-sm">Live for everyone</Label>
                <p className="text-[11px] text-muted-foreground">Turn off to hide it from the store without deleting.</p>
              </div>
            </div>
            <Switch id="pa-active" checked={form.active} onCheckedChange={(v) => set('active', v)} />
          </div>

          {fieldError && (
            <p role="alert" className="text-xs font-medium text-destructive">
              {fieldError}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy} className="gap-2">
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {editing ? 'Save changes' : 'Publish platform'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
