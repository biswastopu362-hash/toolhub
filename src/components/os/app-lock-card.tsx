'use client'

import { useState } from 'react'
import { KeyRound, Lock, ShieldOff, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/hooks/use-toast'
import { useAppStore } from '@/lib/store/app-store'
import { tools } from '@/lib/tools/registry'
import { hashPin } from '@/lib/pin-hash'
import { cn } from '@/lib/utils'

const PAD_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'c', '0', 'del'] as const

/** Dark keypad used inside the PIN dialogs. */
function Keypad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="mx-auto mt-4 grid w-full max-w-[240px] grid-cols-3 gap-2">
      {PAD_KEYS.map((k) =>
        k === 'c' ? (
          <button
            key={k}
            type="button"
            onClick={() => onKey('c')}
            className="grid h-13 place-items-center rounded-xl text-xs font-semibold text-muted-foreground transition hover:bg-muted active:scale-90"
          >
            Clear
          </button>
        ) : k === 'del' ? (
          <button
            key={k}
            type="button"
            aria-label="Delete last digit"
            onClick={() => onKey('del')}
            className="grid h-13 place-items-center rounded-xl text-muted-foreground transition hover:bg-muted active:scale-90"
          >
            ⌫
          </button>
        ) : (
          <button
            key={k}
            type="button"
            aria-label={`Digit ${k}`}
            onClick={() => onKey(k)}
            className="grid h-13 select-none place-items-center rounded-xl border bg-muted/40 text-lg font-semibold transition hover:bg-muted active:scale-90"
          >
            {k}
          </button>
        )
      )}
    </div>
  )
}

function PinDots({ pin, error }: { pin: string; error?: boolean }) {
  return (
    <div className="mt-3 flex items-center justify-center gap-3" aria-label={`${pin.length} of 4 digits`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            'size-3 rounded-full transition-all',
            error ? 'bg-destructive' : i < pin.length ? 'scale-110 bg-primary' : 'bg-muted-foreground/25'
          )}
        />
      ))}
    </div>
  )
}

/** Set / change PIN flow. Calls onDone with the hashed PIN. */
function PinSetupDialog({
  open,
  onOpenChange,
  title,
  onDone,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  onDone: (pinHash: string) => void
}) {
  const [step, setStep] = useState<'first' | 'confirm'>('first')
  const [first, setFirst] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  const reset = () => {
    setStep('first')
    setFirst('')
    setPin('')
    setError(false)
  }

  const onKey = (k: string) => {
    setError(false)
    if (k === 'c') return setPin('')
    if (k === 'del') return setPin((p) => p.slice(0, -1))
    setPin((p) => (p.length >= 4 ? p : p + k))
  }

  const commit = async () => {
    if (step === 'first') {
      setFirst(pin)
      setPin('')
      setStep('confirm')
      return
    }
    if (pin !== first) {
      setError(true)
      setPin('')
      setStep('first')
      setFirst('')
      return
    }
    onDone(await hashPin(pin))
    reset()
    onOpenChange(false)
  }

  const complete = pin.length === 4

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent className="max-w-xs rounded-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {step === 'first' ? 'Choose a 4-digit PIN.' : 'Re-enter the same PIN to confirm.'}
          </DialogDescription>
        </DialogHeader>
        <PinDots pin={pin} error={error} />
        {error && <p className="text-center text-xs font-medium text-destructive">PINs didn’t match — start over.</p>}
        <Keypad onKey={onKey} />
        <Button className="h-11" disabled={!complete} onClick={() => void commit()}>
          {step === 'first' ? 'Next' : 'Save PIN'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

/** Settings card for the D9 App Lock feature. */
export function AppLockCard() {
  const { toast } = useToast()
  const appLock = useAppStore((s) => s.appLock)
  const setAppLock = useAppStore((s) => s.setAppLock)
  const installed = useAppStore((s) => s.installed)

  const [setupOpen, setSetupOpen] = useState(false)
  const [changeOpen, setChangeOpen] = useState(false)

  const installedTools = tools.filter((t) => installed.includes(t.id))
  const lockedCount = appLock?.lockedApps.length ?? 0

  const toggleApp = (id: string) => {
    if (!appLock) return
    const locked = appLock.lockedApps.includes(id)
    setAppLock({
      ...appLock,
      lockedApps: locked ? appLock.lockedApps.filter((a) => a !== id) : [...appLock.lockedApps, id],
    })
    try {
      navigator.vibrate?.(8)
    } catch {}
  }

  return (
    <Card className="gap-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">App Lock</h3>
          <p className="text-sm text-muted-foreground">
            Ask for a PIN before opening the apps you choose. The PIN is hashed and never leaves
            this device.
          </p>
        </div>
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Lock className="size-5" aria-hidden="true" />
        </div>
      </div>

      {!appLock ? (
        <Button className="h-11 gap-2" onClick={() => setSetupOpen(true)}>
          <ShieldOff className="size-4" /> Turn on App Lock
        </Button>
      ) : (
        <>
          <div className="flex items-center justify-between rounded-xl border bg-muted/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Require PIN</p>
              <p className="text-xs text-muted-foreground">
                {lockedCount === 0
                  ? 'No apps are locked yet — pick some below.'
                  : `${lockedCount} ${lockedCount === 1 ? 'app' : 'apps'} protected.`}
              </p>
            </div>
            <Switch
              checked={appLock.enabled}
              onCheckedChange={(v) => setAppLock({ ...appLock, enabled: v })}
              aria-label="Require PIN for locked apps"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11 gap-2" onClick={() => setChangeOpen(true)}>
              <KeyRound className="size-4" /> Change PIN
            </Button>
            <Button
              variant="outline"
              className="h-11 gap-2 text-destructive hover:text-destructive"
              onClick={() => {
                if (confirm('Remove App Lock? Your apps and their data stay untouched.')) {
                  setAppLock(null)
                  toast({ title: 'App Lock removed', description: 'You can set it up again anytime.' })
                }
              }}
            >
              <Trash2 className="size-4" /> Remove
            </Button>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Locked apps
            </p>
            <div className="max-h-96 space-y-1 overflow-y-auto rounded-xl border p-2">
              {installedTools.map((t) => {
                const locked = appLock.lockedApps.includes(t.id)
                return (
                  <label
                    key={t.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-muted"
                  >
                    <span
                      className={cn(
                        'flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white',
                        t.gradient
                      )}
                    >
                      <t.icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.name}</span>
                    <Switch checked={locked} onCheckedChange={() => toggleApp(t.id)} aria-label={`Lock ${t.name}`} />
                  </label>
                )
              })}
            </div>
          </div>
        </>
      )}

      <PinSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        title="Set your PIN"
        onDone={(pinHash) => {
          setAppLock({ enabled: true, pinHash, lockedApps: [] })
          toast({
            title: 'App Lock is on ✓',
            description: 'Now choose which apps should ask for the PIN.',
          })
        }}
      />
      <PinSetupDialog
        open={changeOpen}
        onOpenChange={setChangeOpen}
        title="Change your PIN"
        onDone={(pinHash) => {
          if (appLock) setAppLock({ ...appLock, pinHash })
          toast({ title: 'PIN updated ✓' })
        }}
      />
    </Card>
  )
}
