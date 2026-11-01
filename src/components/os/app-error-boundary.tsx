'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, Home, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
  appName: string
  onHome: () => void
}

interface State {
  error: Error | null
}

/**
 * D87 Hardening — per-app crash isolation. A broken app window (bad lazy
 * chunk, storage quota, API gap) used to take the whole OS down with a
 * white screen; now only that window shows a recovery card while the
 * launcher stays alive behind it.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[toolhub] app crashed:', this.props.appName, error, info.componentStack)
  }

  private retry = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
          role="alert"
        >
          <span className="grid size-14 place-items-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="size-7" aria-hidden />
          </span>
          <div>
            <h2 className="text-lg font-bold">{this.props.appName} crashed</h2>
            <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
              The app hit an unexpected error. Your data is safe on this device — try reopening it.
            </p>
          </div>
          <div className="flex gap-2">
            <Button className="h-11 gap-2" onClick={this.retry}>
              <RotateCcw className="size-4" aria-hidden /> Try again
            </Button>
            <Button variant="outline" className="h-11 gap-2" onClick={this.props.onHome}>
              <Home className="size-4" aria-hidden /> Go home
            </Button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
