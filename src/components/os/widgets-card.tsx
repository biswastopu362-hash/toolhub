'use client'

import { useMemo } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { useLang } from '@/hooks/use-lang'
import { cn } from '@/lib/utils'
import { ALL_WIDGET_IDS, useAppStore, type WidgetId } from '@/lib/store/app-store'

/* ================================================================== */
/* Settings → "Home widgets" (v2.1). Toggle the six widget cards and   */
/* reorder the enabled ones; the launcher strip follows instantly.     */
/* ================================================================== */

/** Stable per-widget icon (emoji keeps the card compact in settings). */
const WIDGET_EMOJI: Record<WidgetId, string> = {
  clock: '🕒',
  weather: '⛅',
  notes: '📝',
  calendar: '📅',
  habits: '🔥',
  goals: '🎯',
}

const WIDGET_LABEL_KEY: Record<WidgetId, 'widgetClock' | 'widgetWeather' | 'widgetNotes' | 'widgetCalendar' | 'widgetHabits' | 'widgetGoals'> = {
  clock: 'widgetClock',
  weather: 'widgetWeather',
  notes: 'widgetNotes',
  calendar: 'widgetCalendar',
  habits: 'widgetHabits',
  goals: 'widgetGoals',
}

export function WidgetsCard() {
  const { t } = useLang()
  const widgets = useAppStore((s) => s.widgets)
  const setWidgets = useAppStore((s) => s.setWidgets)

  /** disabled ids keep their settings row, appended after the enabled ones */
  const rows = useMemo(() => {
    const enabledSet = new Set(widgets)
    return [...widgets, ...ALL_WIDGET_IDS.filter((id) => !enabledSet.has(id))]
  }, [widgets])

  const toggle = (id: WidgetId, on: boolean) => {
    if (on) setWidgets([...widgets, id])
    else setWidgets(widgets.filter((w) => w !== id))
  }

  const move = (id: WidgetId, dir: -1 | 1) => {
    const idx = widgets.indexOf(id)
    const next = idx + dir
    if (idx < 0 || next < 0 || next >= widgets.length) return
    const copy = [...widgets]
    ;[copy[idx], copy[next]] = [copy[next], copy[idx]]
    setWidgets(copy)
  }

  return (
    <Card className="gap-3 p-4" aria-label={t('widgetSettingsTitle')}>
      <div>
        <h3 className="font-semibold">{t('widgetSettingsTitle')}</h3>
        <p className="text-sm text-muted-foreground">{t('widgetSettingsDesc')}</p>
      </div>

      <ul className="space-y-1.5">
        {rows.map((id) => {
          const enabledIdx = widgets.indexOf(id)
          const enabled = enabledIdx >= 0
          return (
            <li
              key={id}
              className={cn(
                'flex items-center gap-2.5 rounded-xl border p-2.5',
                !enabled && 'opacity-60'
              )}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-base" aria-hidden>
                {WIDGET_EMOJI[id]}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {t(WIDGET_LABEL_KEY[id])}
                {enabled && (
                  <span className="ml-1.5 text-xs text-muted-foreground">#{enabledIdx + 1}</span>
                )}
              </span>
              {enabled && (
                <span className="flex shrink-0 items-center">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full"
                    disabled={enabledIdx === 0}
                    onClick={() => move(id, -1)}
                    aria-label={t('widgetMoveUp', { name: t(WIDGET_LABEL_KEY[id]) })}
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-full"
                    disabled={enabledIdx === widgets.length - 1}
                    onClick={() => move(id, 1)}
                    aria-label={t('widgetMoveDown', { name: t(WIDGET_LABEL_KEY[id]) })}
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </Button>
                </span>
              )}
              <Switch checked={enabled} onCheckedChange={(on) => toggle(id, on)} aria-label={t(WIDGET_LABEL_KEY[id])} />
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
