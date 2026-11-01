'use client'

import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronDown,
  HelpCircle,
  History,
  Lightbulb,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'
import { tools } from '@/lib/tools/registry'
import { APP_VERSION } from '@/lib/constants'

/**
 * D86 Help & About — the hub's support desk.
 *
 * Tabs: FAQ (searchable) · Tips · Privacy · What's new (changelog).
 * Everything is local, static content — zero network, works offline.
 */

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

const FAQ: { q: string; a: string; tags: string }[] = [
  {
    q: 'Is ToolHub really private? Where does my data go?',
    a: 'Yes. Notes, reminders, files, photos and app settings live only in your browser storage on this device. Nothing is uploaded unless you explicitly sign in and press "Back up now" — and even then the backup is an opaque snapshot only you can restore.',
    tags: 'privacy data upload sync account',
  },
  {
    q: 'Does everything work offline?',
    a: 'The entire shell and all built-in apps work offline. After your first visit the service worker caches the app shell, so you can open ToolHub on a plane and keep using notes, calculators, games and converters.',
    tags: 'offline airplane pwa service worker',
  },
  {
    q: 'How do I install ToolHub on my phone?',
    a: 'Android: tap the install banner on the home screen or use the browser menu → "Install app". iPhone: in Safari tap Share → "Add to Home Screen". Desktop: click the install icon in the address bar.',
    tags: 'install pwa home screen ios android',
  },
  {
    q: 'How do I rearrange icons or make a folder?',
    a: 'Long-press an icon until the home screen enters edit mode, then drag it anywhere. Drop it on top of another app to create a folder. Long-press also opens quick actions: open, favorite, app info or uninstall.',
    tags: 'home screen folder drag organize edit',
  },
  {
    q: 'What can the search bar do besides finding apps?',
    a: 'Spotlight computes math (type 12*8+4), converts units (5km to mi), and creates notes from anywhere (start with "note: buy milk"). Results appear as tappable cards before you finish typing.',
    tags: 'search spotlight math unit note calculator',
  },
  {
    q: 'What are Linked Platforms in the App Store?',
    a: 'They are PWAs and websites the hub owner curates. Installing one adds a home-screen shortcut that opens the platform in an embedded window. If a platform blocks embedding, the window offers a one-tap "Open in new tab" escape hatch.',
    tags: 'platforms linked pwa store owner admin embed',
  },
  {
    q: 'Can I back up my data or move it to another device?',
    a: 'Yes — Settings → Account & cloud sync. Sign in, then "Back up now" snapshots your notes, reminders and launcher layout to your account. On a new device, sign in and restore. Backups are manual, so nothing moves without your say-so.',
    tags: 'backup sync restore cloud account device transfer',
  },
  {
    q: 'How do I change the theme, wallpaper or icon shape?',
    a: 'Settings → Home screen look picks icon shape (squircle/rounded/sharp), grid density and a custom accent color. The palette menu switches light/dark and wallpapers. Everything applies instantly.',
    tags: 'theme wallpaper dark mode accent icon shape density',
  },
  {
    q: 'Does ToolHub support Bengali?',
    a: 'Yes — Settings → Language switches the whole interface (launcher, status bar, settings, widgets) to পূর্ণ বাংলা, including Bengali numerals and dates.',
    tags: 'bengali bangla language i18n bn',
  },
  {
    q: 'I hid a platform / app. How do I get it back?',
    a: 'Open the App Store, find the app (or My Platforms rail), and tap Get — it reinstalls instantly. Uninstalled apps keep their data where it makes sense (notes stay in Notes, for example).',
    tags: 'uninstall reinstall hidden missing app',
  },
  {
    q: 'Why does an embedded platform show "Page hasn\'t loaded yet"?',
    a: 'Some sites refuse to be embedded for security (X-Frame-Options / CSP). When that happens the window shows a hint and an Open button — the site opens in a new tab instead. The hub owner can verify each platform with the Admin Console embed check.',
    tags: 'embed iframe blocked x-frame-options platform',
  },
  {
    q: 'Who runs this hub?',
    a: 'The hub owner. They sign in to the Admin Console with a passcode to add platforms, reorder the store and keep the catalog fresh. Apps in the "Built-in" catalog ship with ToolHub itself.',
    tags: 'owner admin console hub passcode',
  },
]

const TIPS: { icon: typeof Sparkles; title: string; body: string; action?: { label: string; app: string } }[] = [
  {
    icon: Search,
    title: 'Instant math & units',
    body: 'Type "45*12+7" or "10kg to lb" straight in search — no app needed. Tap the result to copy it.',
  },
  {
    icon: Sparkles,
    title: 'Note from anywhere',
    body: 'Start any search with "note:" and the text becomes a note the moment you tap the card.',
  },
  {
    icon: Lightbulb,
    title: 'Long-press everything',
    body: 'Icons have quick actions (favorites, app info, uninstall). The status-bar bell opens Notification Center.',
  },
  {
    icon: Lock,
    title: 'App Lock',
    body: 'Give sensitive apps a PIN in Settings — they ask for it every time they open, even after a restart.',
  },
  {
    icon: History,
    title: 'Widgets do the work',
    body: 'Clock, weather and notes widgets update live on page 1 — glance, don\'t tap.',
    action: { label: 'Open Clock', app: 'clock' },
  },
  {
    icon: ShieldCheck,
    title: 'Offline-first by design',
    body: 'Install ToolHub once and it keeps working with no network. Your data never leaves the device.',
  },
]

const CHANGELOG: { version: string; date: string; title: string; items: string[]; current?: boolean }[] = [
  {
    version: '2.0.0',
    date: 'Launch',
    title: 'Platform, Scale & Launch',
    current: true,
    items: [
      'Optional accounts with manual cloud backup (notes, reminders, launcher)',
      'Full Bengali interface toggle with Bengali numerals and dates',
      'Theme Engine v3 — icon shapes, grid density, custom accent colors',
      'Performance, accessibility and offline hardening passes',
      'Admin Console v2 — open stats, store reordering, bulk import/export',
      'Linked Platforms v2 — deep links, embed diagnostics, category filters',
      'First-run welcome tour, sample data and Help Center',
    ],
  },
  {
    version: '1.5.0',
    date: 'Games & OS Delight',
    title: 'Games & OS Delight',
    items: [
      'Nine games — Sudoku, Minesweeper, Snake, Memory Match, Wordle (Bangla), 2-player arcade, Solitaire, Trivia and more',
      'Game Center hub with 37 achievements across all games',
      'Share Target — share links from other apps straight into Notes',
      'Home widgets, Notification Center, Spotlight v2, quick actions',
    ],
  },
  {
    version: '1.0.0',
    date: 'First release',
    title: 'The 90-day build',
    items: [
      'Phone-OS launcher with drag-and-drop, folders and favorites',
      '84 built-in apps across 9 categories — all offline, zero uploads',
      'App Store with install/uninstall, search and categories',
      'iPad-style minimize animation, themes, wallpapers and dark mode',
    ],
  },
]

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type Tab = 'faq' | 'tips' | 'privacy' | 'whatsnew'

const TABS: { id: Tab; label: string; icon: typeof HelpCircle }[] = [
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
  { id: 'tips', label: 'Tips', icon: Lightbulb },
  { id: 'privacy', label: 'Privacy', icon: ShieldCheck },
  { id: 'whatsnew', label: "What's new", icon: History },
]

/** Ask the OS shell to open an app window. */
function requestOpenApp(id: string) {
  window.dispatchEvent(new CustomEvent<string>('toolhub:open-app', { detail: id }))
}

export default function HelpCenter() {
  const { toast } = useToast()
  const [tab, setTab] = useState<Tab>('faq')
  const [query, setQuery] = useState('')
  const [openIdx, setOpenIdx] = useState<number | null>(0)

  const filteredFaq = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return FAQ
    return FAQ.filter((f) => `${f.q} ${f.a} ${f.tags}`.toLowerCase().includes(q))
  }, [query])

  const copySupport = useCallback(() => {
    toast({
      title: 'ToolHub — one hub, every tool',
      description: `Version ${APP_VERSION} · ${tools.length} built-in apps · works offline on every device.`,
    })
  }, [toast])

  return (
    <div className="space-y-4 pb-6">
      {/* hero */}
      <div className="flex items-center gap-4 overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 p-5 text-white shadow-xl">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/30">
          <Wrench className="size-7" aria-hidden />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight">Help Center</h1>
          <p className="mt-0.5 text-sm text-white/85">
            ToolHub {APP_VERSION} · {tools.length} apps · answers in one tap
          </p>
        </div>
      </div>

      {/* tabs */}
      <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Help sections">
        {TABS.map((tb) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
            className={cn(
              'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold transition',
              tab === tb.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            )}
          >
            <tb.icon className="size-4" aria-hidden /> {tb.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
        >
          {/* ---------------- FAQ ---------------- */}
          {tab === 'faq' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search answers…"
                  className="h-10 rounded-xl pl-9"
                  aria-label="Search frequently asked questions"
                />
              </div>
              {filteredFaq.length === 0 ? (
                <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No answers match “{query}”. Try a shorter word.
                </p>
              ) : (
                <div className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm">
                  {filteredFaq.map((f, i) => {
                    const open = openIdx === i
                    return (
                      <div key={f.q}>
                        <button
                          type="button"
                          onClick={() => setOpenIdx(open ? null : i)}
                          aria-expanded={open}
                          className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                        >
                          <span className="min-w-0 flex-1 text-sm font-semibold leading-snug">{f.q}</span>
                          <ChevronDown
                            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
                            aria-hidden
                          />
                        </button>
                        <AnimatePresence initial={false}>
                          {open && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.18, ease: 'easeOut' }}
                              className="overflow-hidden"
                            >
                              <p className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ---------------- TIPS ---------------- */}
          {tab === 'tips' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {TIPS.map((tip) => (
                <div
                  key={tip.title}
                  className="flex flex-col gap-2 rounded-3xl border border-border/70 bg-card p-4 shadow-sm"
                >
                  <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
                    <tip.icon className="size-5" aria-hidden />
                  </span>
                  <p className="text-sm font-bold">{tip.title}</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{tip.body}</p>
                  {tip.action && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-auto h-8 w-fit gap-1.5 rounded-full text-xs"
                      onClick={() => requestOpenApp(tip.action!.app)}
                    >
                      {tip.action.label}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ---------------- PRIVACY ---------------- */}
          {tab === 'privacy' && (
            <div className="space-y-3">
              <div className="rounded-3xl border border-emerald-500/30 bg-emerald-500/10 p-4">
                <p className="flex items-center gap-2 text-sm font-extrabold text-emerald-700 dark:text-emerald-400">
                  <ShieldCheck className="size-4.5" aria-hidden /> The zero-upload promise
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                  Every built-in app runs entirely on this device. Notes, reminders, photos, files,
                  game scores and settings stay in your browser&apos;s local storage. There is no
                  analytics, no tracking and no account requirement.
                </p>
              </div>
              {[
                {
                  t: 'What is stored on this device',
                  d: 'Your content (notes, reminders, files, gallery items) and preferences (theme, wallpaper, layout, installed apps) live in the browser storage of this browser only. Clearing site data erases them — export important notes as files from time to time.',
                },
                {
                  t: 'The only optional network features',
                  d: 'Cloud backup (Settings → Account) uploads an encrypted-at-rest snapshot of notes, reminders and launcher layout only after you sign in and press "Back up now". Linked Platforms open third-party websites in an embedded window — those sites have their own policies.',
                },
                {
                  t: 'What the hub owner can see',
                  d: 'Only the platform catalog they curate and anonymous open counters per platform. They cannot read your notes, files or activity.',
                },
                {
                  t: 'Removing your data',
                  d: 'Uninstall apps freely; your notes and reminders persist in the OS stores until you delete them in-app. Cloud copies can be deleted permanently from Settings → Account → Delete all.',
                },
              ].map((row) => (
                <div key={row.t} className="rounded-3xl border border-border/70 bg-card p-4 shadow-sm">
                  <p className="text-sm font-bold">{row.t}</p>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{row.d}</p>
                </div>
              ))}
              <p className="px-1 text-[11px] leading-snug text-muted-foreground">
                Questions about this policy? Use the FAQ tab or ask the hub owner — the support
                contact lives with the platform catalog, never with your data.
              </p>
            </div>
          )}

          {/* ---------------- WHAT'S NEW ---------------- */}
          {tab === 'whatsnew' && (
            <div className="space-y-3">
              {CHANGELOG.map((rel) => (
                <div
                  key={rel.version}
                  className={cn(
                    'rounded-3xl border p-4 shadow-sm',
                    rel.current ? 'border-primary/40 bg-primary/5' : 'border-border/70 bg-card'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="font-mono text-[11px]">
                      v{rel.version}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{rel.date}</span>
                    {rel.current && (
                      <Badge className="ml-auto bg-primary text-[10px] text-primary-foreground">Current</Badge>
                    )}
                  </div>
                  <p className="mt-1.5 text-sm font-bold">{rel.title}</p>
                  <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                    {rel.items.map((it) => (
                      <li key={it}>{it}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* about card */}
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-sm">
        <div className="min-w-0 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">ToolHub {APP_VERSION}</p>
          <p className="truncate">Made with care — {tools.length} apps and counting.</p>
        </div>
        <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 rounded-full text-xs" onClick={copySupport}>
          About this hub
        </Button>
      </div>
    </div>
  )
}
