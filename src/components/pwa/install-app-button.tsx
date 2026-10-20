'use client'

import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Shows an "Install App" button when the browser supports PWA install */
export function InstallAppButton({ className }: { className?: string }) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (installed || !deferred) return null

  return (
    <Button
      size="sm"
      className={className}
      onClick={async () => {
        try {
          await deferred.prompt()
          const choice = await deferred.userChoice
          if (choice.outcome === 'accepted') setInstalled(true)
        } catch {
          /* ignore */
        }
        setDeferred(null)
      }}
      aria-label="Install app"
    >
      <Download className="h-4 w-4" />
      <span className="hidden sm:inline">Install</span>
    </Button>
  )
}
