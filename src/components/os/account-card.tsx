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
  Lock,
  LockOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
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
import { useLang } from '@/hooks/use-lang'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store/app-store'
import {
  SYNC_DOMAINS,
  deleteCloudBlobs,
  listCloudBlobs,
  pushDomain,
  restoreDomain,
  type SyncBlobMeta,
} from '@/lib/sync'
import {
  AutoSyncStatus,
  getAutoSyncStatus,
  getSessionPassphrase,
  setSessionPassphrase,
} from '@/components/os/auto-sync'

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
  const { t } = useLang()
  const autoSync = useAppStore((s) => s.autoSync)
  const e2eEnabled = useAppStore((s) => s.e2eEnabled)
  const setAutoSync = useAppStore((s) => s.setAutoSync)
  const setE2eEnabled = useAppStore((s) => s.setE2eEnabled)

  const [providers, setProviders] = useState<ProvidersShape | null>(null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [emailError, setEmailError] = useState('')

  const [busy, setBusy] = useState<'backup' | 'restore' | 'delete' | null>(null)
  const [cloud, setCloud] = useState<SyncBlobMeta[] | null>(null)

  const signedIn = status === 'authenticated' && Boolean(session?.user?.email)

  /* v2.1: E2E passphrase entry + auto-sync live status */
  const [passInput, setPassInput] = useState('')
  const [e2eBusy, setE2eBusy] = useState(false)
  const [syncTick, setSyncTick] = useState(0)
  const syncStatus: AutoSyncStatus | null = signedIn && autoSync ? getAutoSyncStatus() : null

  useEffect(() => {
    if (!signedIn) return
    const onTick = () => setSyncTick((n) => n + 1)
    window.addEventListener('toolhub:autosync', onTick)
    return () => window.removeEventListener('toolhub:autosync', onTick)
  }, [signedIn])

  /** passphrase to seal pushes with — only when E2E is on AND unlocked for this session */
  const activePass = (): string | undefined => {
    if (!e2eEnabled) return undefined
    const pass = getSessionPassphrase()
    if (!pass) {
      toast({ title: t('e2eNeedPassTitle'), description: t('e2eNeedPassDesc') })
      return undefined
    }
    return pass
  }

  /** Turn E2E on: verify the passphrase with an encrypt/decrypt roundtrip,
   *  keep it in sessionStorage (never persisted), flip the store flag. */
  const enableE2e = async () => {
    const pass = passInput
    if (pass.length < 8) {
      toast({ title: t('e2eTooShort') })
      return
    }
    setE2eBusy(true)
    try {
      const { encryptString, decryptString } = await import('@/lib/crypto-e2e')
      const probe = `toolhub-e2e-probe:${Date.now()}`
      const round = await decryptString(await encryptString(probe, pass), pass)
      if (round !== probe) throw new Error('roundtrip')
      setSessionPassphrase(pass)
      setE2eEnabled(true)
      setPassInput('')
      toast({ title: t('e2eEnabledToast'), description: t('e2eEnabledToastDesc') })
    } catch {
      toast({ title: t('e2eWrongPass') })
    } finally {
      setE2eBusy(false)
    }
  }

  const disableE2e = () => {
    setE2eEnabled(false)
    setSessionPassphrase(null)
  }

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
      setEmailError(t('invalidEmail'))
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
      toast({ title: t('signedInToast'), description: t('cloudUnlocked', { email: value }) })
    } catch (err) {
      toast({
        title: t('signInFailed'),
        description: err instanceof Error ? err.message : t('tryAgain'),
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
      const pass = activePass()
      if (e2eEnabled && !pass) {
        setBusy(null)
        return
      }
      const results: string[] = []
      let pushed = 0
      for (const d of SYNC_DOMAINS) {
        const meta = await pushDomain(d, pass ? { passphrase: pass } : undefined)
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
          title: t('nothingToBackup'),
          description: t('nothingToBackupDesc'),
        })
      } else {
        toast({ title: t('backupComplete', { n: pushed, m: SYNC_DOMAINS.length }), description: results.join(' — ') })
      }
    } catch (err) {
      toast({
        title: t('backupFailed'),
        description: err instanceof Error ? err.message : t('tryAgain'),
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
      const pass = activePass()
      if (e2eEnabled && !pass) {
        setBusy(null)
        return
      }
      await restoreDomain(domain, pass ? { passphrase: pass } : undefined)
      toast({
        title: t('restoredToast', { name: domain.label }),
        description: t('restoredToastDesc'),
      })
      setTimeout(() => window.location.reload(), 700)
    } catch (err) {
      toast({
        title: err instanceof Error && err.message === 'wrong-passphrase' ? t('e2eWrongPass') : t('restoreFailed'),
        description: err instanceof Error && err.message !== 'wrong-passphrase' ? err.message : t('tryAgain'),
      })
      setBusy(null)
    }
  }

  const wipeCloud = async () => {
    setBusy('delete')
    try {
      const n = await deleteCloudBlobs('*')
      await refreshCloud()
      toast({ title: t('cloudDeleted'), description: t('cloudDeletedDesc', { n, s: n === 1 ? '' : 's' }) })
    } catch (err) {
      toast({
        title: t('deleteFailed'),
        description: err instanceof Error ? err.message : t('tryAgain'),
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
    <Card className="gap-4 p-4" aria-label={t('accountTitle')}>
      <div>
        <h3 className="font-semibold">{t('accountTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('accountDesc')}</p>
      </div>

      {status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t('checkingSession')}
        </div>
      )}

      {status !== 'loading' && !signedIn && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl bg-muted p-3 text-sm">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <span>
              <span className="font-medium">{t('guestMode')}</span> — {t('guestDesc')}
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
              {t('continueGoogle')}
            </Button>
          )}

          <div className="space-y-2 rounded-xl border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Mail className="size-4" aria-hidden /> {t('localAccount')}
            </div>
            <Input
              type="email"
              inputMode="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label={t('emailAddress')}
              aria-invalid={Boolean(emailError)}
              className="h-11"
            />
            <Input
              type="text"
              placeholder={t('displayName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label={t('displayName')}
              className="h-11"
            />
            {emailError && <p className="text-xs text-destructive">{emailError}</p>}
            <Button className="h-11 w-full gap-2" onClick={() => void signInLocal()} disabled={signingIn}>
              {signingIn ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
              {t('signIn')}
            </Button>
            <p className="text-xs text-muted-foreground">{t('signInLocalNote')}</p>
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
            <Badge variant="secondary">{t('syncReady')}</Badge>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button className="h-11 gap-2" onClick={() => void backupAll()} disabled={busy !== null}>
              {busy === 'backup' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CloudUpload className="size-4" aria-hidden />
              )}
              {t('backUpNow')}
            </Button>
            <Button
              variant="outline"
              className="h-11 gap-2"
              onClick={() => void signOut({ callbackUrl: '/' })}
              disabled={busy !== null}
            >
              <LogOut className="size-4" aria-hidden /> {t('signOut')}
            </Button>
          </div>

          {/* v2.1: automatic, debounced backup */}
          <div className="flex items-center justify-between gap-3 rounded-xl border p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t('autoBackup')}</p>
              <p className="text-xs text-muted-foreground">{t('autoBackupDesc')}</p>
            </div>
            <Switch
              checked={autoSync}
              onCheckedChange={setAutoSync}
              aria-label={t('autoBackup')}
            />
          </div>
          {autoSync && syncStatus && (
            <p
              className="-mt-1.5 px-1 text-xs text-muted-foreground"
              data-tick={syncTick}
              role="status"
            >
              {syncStatus.pushing
                ? t('autoBackupPushing')
                : syncStatus.lastError === 'passphrase'
                  ? t('autoBackupWaiting')
                  : syncStatus.lastError
                    ? t('autoBackupError', { msg: syncStatus.lastError })
                    : syncStatus.lastPushAt
                      ? t('autoBackupLast', {
                          time: fmtTime(new Date(syncStatus.lastPushAt).toISOString()),
                        })
                      : t('autoBackupIdle')}
            </p>
          )}

          {/* v2.1: end-to-end encryption for cloud blobs */}
          <div className="space-y-2 rounded-xl border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Lock className="size-3.5 shrink-0" aria-hidden /> {t('e2eTitle')}
                  {e2eEnabled && (
                    <Badge variant="secondary" className="ml-1 gap-1 px-1.5">
                      <Lock className="size-2.5" aria-hidden /> {t('e2eEnabledBadge')}
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{t('e2eDesc')}</p>
              </div>
              <Switch
                checked={e2eEnabled}
                disabled={!e2eEnabled || e2eBusy}
                onCheckedChange={(on) => {
                  if (!on) disableE2e()
                }}
                aria-label={t('e2eTitle')}
              />
            </div>
            {e2eEnabled && <p className="text-xs text-emerald-600 dark:text-emerald-400">{t('e2eOnNote')}</p>}
            {(!e2eEnabled || !getSessionPassphrase()) && (
              <div className="space-y-2">
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={e2eEnabled ? t('e2eSessionPass') : t('e2eNewPass')}
                  value={passInput}
                  onChange={(e) => setPassInput(e.target.value)}
                  aria-label={e2eEnabled ? t('e2eSessionPass') : t('e2eNewPass')}
                  className="h-11"
                />
                <Button size="sm" className="h-10 gap-2" onClick={() => void enableE2e()} disabled={e2eBusy || passInput.length === 0}>
                  {e2eBusy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : e2eEnabled ? (
                    <LockOpen className="size-4" aria-hidden />
                  ) : (
                    <Lock className="size-4" aria-hidden />
                  )}
                  {e2eEnabled ? t('e2eUnlockBtn') : t('e2eEnableBtn')}
                </Button>
              </div>
            )}
          </div>

          <Separator />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-semibold">{t('cloudBackups')}</h4>
              {hasCloud && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-destructive hover:text-destructive">
                      <Trash2 className="size-3.5" aria-hidden /> {t('deleteAll')}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t('deleteAllTitle')}</AlertDialogTitle>
                      <AlertDialogDescription>{t('deleteAllDesc')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-white hover:bg-destructive/90"
                        onClick={() => void wipeCloud()}
                      >
                        {t('delete')}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            {cloud === null && (
              <p className="text-sm text-muted-foreground" role="status">
                <Loader2 className="mr-1 inline size-3.5 animate-spin" aria-hidden /> {t('readingCloud')}
              </p>
            )}

            {cloud !== null && !hasCloud && (
              <p className="text-sm text-muted-foreground">{t('noBackupsYet')}</p>
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
                        <span className="block truncate text-sm font-medium">
                          {d.label}
                          {blob?.enc && (
                            <Badge variant="secondary" className="ml-1.5 px-1.5 align-middle text-[10px]">
                              {t('e2eEnabledBadge')}
                            </Badge>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {blob
                            ? `rev ${blob.rev} · ${fmtSize(blob.size)} · ${fmtTime(blob.updatedAt)}`
                            : t('notBackedUp')}
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
                              aria-label={t('restoreFromCloud', { name: d.label })}
                            >
                              {busy === 'restore' ? (
                                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                              ) : (
                                <CloudDownload className="size-3.5" aria-hidden />
                              )}
                              {t('restore')}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t('restoreTitle', { name: d.label })}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t('restoreDesc', { rev: blob.rev, time: fmtTime(blob.updatedAt) })}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                              <AlertDialogAction onClick={() => void restore(d.id)}>{t('restore')}</AlertDialogAction>
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

          <p className="text-xs text-muted-foreground">{t('syncPrivacyNote')}</p>
        </div>
      )}
    </Card>
  )
}
