'use client'

import { useCallback, useEffect, useState } from 'react'
import { signOut, useSession } from 'next-auth/react'
import {
  CloudUpload,
  CloudDownload,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  ShieldCheck,
  Trash2,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
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
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import {
  SYNC_DOMAINS,
  deleteCloudBlobs,
  listCloudBlobs,
  pushDomain,
  restoreDomain,
  type SyncBlobMeta,
} from '@/lib/sync'

/* ================================================================== */
/* D76 Accounts + D77 Cloud Sync settings card.                        */
/*                                                                     */
/* Guest mode is the default: everything stays on-device. Signing in   */
/* (Google when configured, else a local email account) unlocks the    */
/* optional "Back up now" / "Restore" flow — an explicit push of JSON  */
/* snapshots, never an automatic upload.                               */
/* ================================================================== */

interface ProvidersShape {
  google?: boolean
  local?: boolean
}

export function AccountCard() {
  const { data: session, status } = useSession()
  const { toast } = useToast()

  const [providers, setProviders] = useState<ProvidersShape | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [emailError, setEmailError] = useState('')

  const [busy, setBusy] = useState<'backup' | 'restore' | 'delete' | null>(null)
  const [cloud, setCloud] = useState<SyncBlobMeta[] | null>(null)

  const signedIn = status === 'authenticated' && Boolean(session?.user?.email)

  const refreshCloud = useCallback(async () => {
    if (!signedIn) {
      setCloud(null)
      return
    }
    try {
      setCloud(await listCloudBlobs())
    } catch {
      setCloud(null) /* serverless cold-start hiccups surface on retry */
    }
  }, [signedIn])

  useEffect(() => {
    void refreshCloud()
  }, [refreshCloud])

  useEffect(() => {
    let alive = true
    void fetch('/api/auth/providers', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<ProvidersShape>) : {}))
      .then((p) => {
        if (alive) setProviders(p)
      })
      .catch(() => {
        if (alive) setProviders({})
      })
    return () => {
      alive = false
    }
  }, [])

  const signInLocal = async () => {
    const value = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setEmailError('Enter a valid email address')
      return
    }
    setEmailError('')
    setSigningIn(true)
    try {
      const { signIn } = await import('next-auth/react')
      const res = await signIn('local', {
        email: value,
        name: name.trim(),
        redirect: false,
      })
      if (res?.error) throw new Error('Sign-in failed')
      toast({ title: 'Signed in ✓', description: `Cloud backup unlocked for ${value}.` })
    } catch (err) {
      toast({
        title: 'Sign-in failed',
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setSigningIn(false)
    }
  }

  const signInGoogle = async () => {
    setSigningIn(true)
    try {
      const { signIn } = await import('next-auth/react')
      await signIn('google', { redirect: true, callbackUrl: '/' })
    } finally {
      setSigningIn(false)
    }
  }

  const backupAll = async () => {
    setBusy('backup')
    try {
      const results: string[] = []
      let pushed = 0
      for (const d of SYNC_DOMAINS) {
        const meta = await pushDomain(d)
        if (meta) {
          pushed += 1
          results.push(`${d.label} · rev ${meta.rev}`)
        } else {
          results.push(`${d.label} · nothing yet`)
        }
      }
      await refreshCloud()
      if (pushed === 0) {
        toast({
          title: 'Nothing to back up yet',
          description: 'All three stores are empty on this device — use an app first, then back up.',
        })
      } else {
        toast({ title: `Backup complete ✓ (${pushed}/${SYNC_DOMAINS.length})`, description: results.join(' — ') })
      }
    } catch (err) {
      toast({
        title: 'Backup failed',
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setBusy(null)
    }
  }

  const restore = async (domainId: SyncBlobMeta['domain']) => {
    const domain = SYNC_DOMAINS.find((d) => d.id === domainId)
    if (!domain) return
    setBusy('restore')
    try {
      await restoreDomain(domain)
      toast({
        title: `${domain.label} restored ✓`,
        description: 'Reloading to apply the cloud copy…',
      })
      setTimeout(() => window.location.reload(), 700)
    } catch (err) {
      toast({
        title: 'Restore failed',
        description: err instanceof Error ? err.message : 'Please try again.',
      })
      setBusy(null)
    }
  }

  const wipeCloud = async () => {
    setBusy('delete')
    try {
      const n = await deleteCloudBlobs('*')
      await refreshCloud()
      toast({ title: 'Cloud data deleted ✓', description: `${n} backup blob${n === 1 ? '' : 's'} removed.` })
    } catch (err) {
      toast({
        title: 'Delete failed',
        description: err instanceof Error ? err.message : 'Please try again.',
      })
    } finally {
      setBusy(null)
    }
  }

  const fmtTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso
    }
  }

  const fmtSize = (bytes: number) =>
    bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`

  const hasCloud = Boolean(cloud && cloud.length > 0)

  return (
    <Card className="gap-4 p-4" aria-label="Account and cloud sync">
      <div>
        <h3 className="font-semibold">Account &amp; cloud sync</h3>
        <p className="text-sm text-muted-foreground">
          Optional. ToolHub works fully without an account — signing in only unlocks an explicit,
          on-demand backup of your notes, reminders and launcher settings.
        </p>
      </div>

      {status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Checking session…
        </div>
      )}

      {status !== 'loading' && !signedIn && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <span>
              <span className="font-medium">Guest mode</span> — your data never leaves this device.
              Sign in only if you want a cloud backup.
            </span>
          </div>

          {providers?.google && (
            <Button variant="outline" className="h-11 w-full gap-2" onClick={() => void signInGoogle()} disabled={signingIn}>
              <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52Z" />
              </svg>
              Continue with Google
            </Button>
          )}

          <div className="space-y-2 rounded-xl border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Mail className="size-4" aria-hidden /> Use a local account
            </div>
            <Input
              type="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
              aria-invalid={Boolean(emailError)}
              className="h-11"
            />
            <Input
              type="text"
              placeholder="Display name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Display name"
              className="h-11"
            />
            {emailError && <p className="text-xs text-destructive">{emailError}</p>}
            <Button className="h-11 w-full gap-2" onClick={() => void signInLocal()} disabled={signingIn}>
              {signingIn ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
              Sign in
            </Button>
            <p className="text-xs text-muted-foreground">
              Local accounts are verified by email only — intended for self-hosted hubs without OAuth setup.
            </p>
          </div>
        </div>
      )}

      {signedIn && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-muted p-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
              <UserRound className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{session?.user?.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{session?.user?.email}</span>
            </span>
            <Badge variant="secondary">Sync ready</Badge>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button className="h-11 gap-2" onClick={() => void backupAll()} disabled={busy !== null}>
              {busy === 'backup' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CloudUpload className="size-4" aria-hidden />
              )}
              Back up now
            </Button>
            <Button
              variant="outline"
              className="h-11 gap-2"
              onClick={() => void signOut({ callbackUrl: '/' })}
              disabled={busy !== null}
            >
              <LogOut className="size-4" aria-hidden /> Sign out
            </Button>
          </div>

          <Separator />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Cloud backups</h4>
              {hasCloud && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-destructive hover:text-destructive">
                      <Trash2 className="size-3.5" aria-hidden /> Delete all
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete all cloud backups?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The copies on the server are removed permanently. The data on this device is not
                        touched.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-white hover:bg-destructive/90"
                        onClick={() => void wipeCloud()}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            {cloud === null && (
              <p className="text-sm text-muted-foreground" role="status">
                <Loader2 className="mr-1 inline size-3.5 animate-spin" aria-hidden /> Reading cloud state…
              </p>
            )}

            {cloud !== null && !hasCloud && (
              <p className="text-sm text-muted-foreground">
                No backups yet — press “Back up now” to store a snapshot of the three domains below.
              </p>
            )}

            {hasCloud && (
              <ul className="space-y-2">
                {SYNC_DOMAINS.map((d) => {
                  const blob = cloud!.find((b) => b.domain === d.id)
                  return (
                    <li
                      key={d.id}
                      className="flex items-center gap-3 rounded-xl border p-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {blob
                            ? `rev ${blob.rev} · ${fmtSize(blob.size)} · ${fmtTime(blob.updatedAt)}`
                            : 'Not backed up yet'}
                        </span>
                      </span>
                      {blob && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn('h-9 shrink-0 gap-1.5')}
                              disabled={busy !== null}
                              aria-label={`Restore ${d.label} from cloud`}
                            >
                              {busy === 'restore' ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                              ) : (
                                <CloudDownload className="size-3.5" aria-hidden />
                              )}
                              Restore
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Restore {d.label}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                The cloud copy (rev {blob.rev}, {fmtTime(blob.updatedAt)}) replaces what is
                                currently on this device. Everything else stays untouched.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => void restore(d.id)}>Restore</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Backups are manual snapshots (last write wins). Nothing is uploaded automatically, and
            payload content is never parsed on the server.
          </p>
        </div>
      )}
    </Card>
  )
}
