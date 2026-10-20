'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'
import {
  ArrowLeft,
  Compass,
  Heart,
  Laptop,
  Moon,
  Search,
  SearchX,
  Share2,
  Smartphone,
  Sparkles,
  Star,
  Sun,
  WifiOff,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { useHashRoute } from '@/hooks/use-hash-route'
import { useHydrated } from '@/hooks/use-hydrated'
import { useAppStore } from '@/lib/store/app-store'
import {
  getToolById,
  searchTools,
  toolCategories,
  tools,
  type Tool,
  type ToolCategoryId,
} from '@/lib/tools/registry'
import { toBn } from '@/lib/bn'
import { InstallAppButton } from '@/components/pwa/install-app-button'
import { cn } from '@/lib/utils'

/* ================================================================== */
/* Page — the whole app lives on this single route (#/tool/<id> views) */
/* ================================================================== */

export default function Home() {
  const [hash, navigate] = useHashRoute()

  const toolId = hash.startsWith('#/tool/') ? decodeURIComponent(hash.replace('#/tool/', '')) : null
  const tool = getToolById(toolId)

  const { addRecent } = useAppStore()

  const openTool = (id: string) => {
    addRecent(id)
    navigate(`#/tool/${id}`)
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header onHome={() => navigate('#/')} />

      <main className="flex-1 w-full">
        {tool ? (
          <ToolView tool={tool} onBack={() => navigate('#/')} onOpen={openTool} />
        ) : (
          <HomeView onOpen={openTool} />
        )}
      </main>

      <AppFooter />
    </div>
  )
}

/* ================================================================== */
/* Header                                                              */
/* ================================================================== */

function Header({ onHome }: { onHome: () => void }) {
  const { theme, setTheme } = useTheme()
  const hydrated = useHydrated()
  const [online, setOnline] = useState(() =>
    typeof window !== 'undefined' ? navigator.onLine : true
  )

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
        <button
          onClick={onHome}
          className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="টুলহাব হোম"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
            <Wrench className="h-5 w-5" />
          </span>
          <span className="flex flex-col items-start leading-none">
            <span className="text-lg font-bold tracking-tight">টুলহাব</span>
            <span className="text-[10px] font-medium text-muted-foreground">ALL-IN-ONE TOOLBOX</span>
          </span>
        </button>

        <div className="flex items-center gap-2">
          {!online && (
            <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-600 dark:text-amber-400">
              <WifiOff className="h-3 w-3" />
              অফলাইন
            </Badge>
          )}
          {hydrated && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="থিম পরিবর্তন করুন"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          )}
          <InstallAppButton />
        </div>
      </div>
    </header>
  )
}

/* ================================================================== */
/* Home view                                                           */
/* ================================================================== */

function HomeView({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ToolCategoryId | 'all'>('all')
  const hydrated = useHydrated()

  const favorites = useAppStore((s) => s.favorites)
  const recents = useAppStore((s) => s.recents)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)

  const results = useMemo(() => searchTools(query, category), [query, category])
  const favTools = useMemo(
    () => (hydrated ? toolsInOrder(favorites) : []),
    [favorites, hydrated]
  )
  const recentTools = useMemo(
    () => (hydrated ? toolsInOrder(recents) : []),
    [recents, hydrated]
  )

  const searching = query.trim().length > 0

  return (
    <div className="mx-auto max-w-6xl px-4 pb-10">
      {/* ---------------- Hero ---------------- */}
      <section className="relative mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-teal-600 to-emerald-800 text-white shadow-lg sm:mt-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 left-1/4 h-56 w-56 rounded-full bg-amber-300/20 blur-3xl"
        />
        <div className="relative z-10 flex flex-col gap-6 p-6 sm:p-10 md:flex-row md:items-center md:justify-between">
          <div className="max-w-xl space-y-3">
            <Badge className="bg-white/15 text-white backdrop-blur hover:bg-white/15">
              <Sparkles className="h-3 w-3" />
              প্রগ্রেসিভ ওয়েব অ্যাপ
            </Badge>
            <h1 className="text-2xl font-bold leading-snug sm:text-3xl md:text-4xl">
              সব কাজের এক সুপার অ্যাপ
            </h1>
            <p className="text-sm text-emerald-50/90 sm:text-base">
              ল্যাপটপ, মোবাইল বা কম্পিউটার — প্রতিদিনের প্রয়োজনীয় সব টুল এক জায়গায়।
              ইনস্টল করুন আর ইন্টারনেট ছাড়াও চালান।
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <HeroChip icon={Zap} label={`${toBn(tools.length)}+ টুল`} />
              <HeroChip icon={Laptop} label="সব ডিভাইসে" />
              <HeroChip icon={Smartphone} label="অফলাইনেও চলে" />
            </div>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <InstallAppButton className="h-11 rounded-xl bg-white px-5 text-sm font-semibold text-emerald-800 shadow hover:bg-emerald-50" />
            <p className="text-xs text-emerald-100/80">হোম স্ক্রিনে অ্যাপের মতো ইনস্টল হবে</p>
          </div>
        </div>
      </section>

      {/* ---------------- Search ---------------- */}
      <section className="mt-6" aria-label="টুল খুঁজুন">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="টুল খুঁজুন… যেমন: ক্যালকুলেটর, QR, পাসওয়ার্ড"
            className="h-12 rounded-2xl border-border bg-card pl-12 pr-11 text-base shadow-sm"
            aria-label="টুল সার্চ"
          />
          {searching && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full"
              onClick={() => setQuery('')}
              aria-label="সার্চ মুছুন"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Category chips */}
        <div className="no-scrollbar mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="ক্যাটাগরি">
          <CategoryChip
            active={category === 'all'}
            label={`সব (${toBn(tools.length)})`}
            onClick={() => setCategory('all')}
          />
          {toolCategories.map((c) => (
            <CategoryChip
              key={c.id}
              active={category === c.id}
              label={`${c.nameBn} (${toBn(tools.filter((t) => t.category === c.id).length)})`}
              onClick={() => setCategory(c.id)}
            />
          ))}
        </div>
      </section>

      {/* ---------------- Favorites ---------------- */}
      {favTools.length > 0 && !searching && category === 'all' && (
        <HomeSection
          icon={<Heart className="h-4 w-4 fill-rose-500 text-rose-500" />}
          title="প্রিয় টুল"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {favTools.map((t) => (
              <ToolCard
                key={`fav-${t.id}`}
                tool={t}
                isFav
                onToggleFav={() => toggleFavorite(t.id)}
                onOpen={() => onOpen(t.id)}
              />
            ))}
          </div>
        </HomeSection>
      )}

      {/* ---------------- Recents ---------------- */}
      {recentTools.length > 0 && !searching && category === 'all' && (
        <HomeSection
          icon={<Compass className="h-4 w-4 text-teal-600" />}
          title="সাম্প্রতিক ব্যবহার"
        >
          <div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
            {recentTools.map((t) => (
              <button
                key={`recent-${t.id}`}
                onClick={() => onOpen(t.id)}
                className="flex min-w-[150px] max-w-[150px] shrink-0 flex-col items-start gap-2 rounded-2xl border bg-card p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br text-white',
                    t.gradient
                  )}
                >
                  <t.icon className="h-4.5 w-4.5" />
                </span>
                <span className="w-full truncate text-sm font-semibold">{t.nameBn}</span>
                <span className="w-full truncate text-[11px] text-muted-foreground">{t.nameEn}</span>
              </button>
            ))}
          </div>
        </HomeSection>
      )}

      {/* ---------------- Results ---------------- */}
      {results.length === 0 ? (
        <EmptyState query={query} />
      ) : searching || category !== 'all' ? (
        <HomeSection icon={<Search className="h-4 w-4 text-muted-foreground" />} title={searching ? `"${query}" — ${toBn(results.length)} টি ফলাফল` : undefined}>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {results.map((t) => (
              <ToolCard
                key={t.id}
                tool={t}
                isFav={hydrated && favorites.includes(t.id)}
                onToggleFav={() => toggleFavorite(t.id)}
                onOpen={() => onOpen(t.id)}
              />
            ))}
          </div>
        </HomeSection>
      ) : (
        toolCategories
          .map((c) => ({ cat: c, items: results.filter((t) => t.category === c.id) }))
          .filter(({ items }) => items.length > 0)
          .map(({ cat, items }) => (
            <HomeSection
              key={cat.id}
              icon={<cat.icon className="h-4 w-4 text-primary" />}
              title={cat.nameBn}
              subtitle={cat.nameEn}
            >
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((t) => (
                  <ToolCard
                    key={t.id}
                    tool={t}
                    isFav={hydrated && favorites.includes(t.id)}
                    onToggleFav={() => toggleFavorite(t.id)}
                    onOpen={() => onOpen(t.id)}
                  />
                ))}
              </div>
            </HomeSection>
          ))
      )}
    </div>
  )
}

function HomeSection({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode
  title?: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-8">
      {title && (
        <div className="mb-3 flex items-center gap-2">
          {icon}
          <h2 className="text-base font-semibold sm:text-lg">{title}</h2>
          {subtitle && <span className="text-xs text-muted-foreground">· {subtitle}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

function HeroChip({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium backdrop-blur">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  )
}

function CategoryChip({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors sm:text-sm',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      {label}
    </button>
  )
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="mt-16 flex flex-col items-center gap-3 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <SearchX className="h-8 w-8 text-muted-foreground" />
      </span>
      <p className="font-semibold">&ldquo;{query}&rdquo; নামে কোনো টুল পাওয়া যায়নি</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        বানান পরীক্ষা করুন বা অন্য কিছু লিখে খুঁজুন। প্রতি সপ্তাহে নতুন টুল যোগ হচ্ছে!
      </p>
    </div>
  )
}

/* ================================================================== */
/* Tool card                                                           */
/* ================================================================== */

function ToolCard({
  tool,
  isFav,
  onToggleFav,
  onOpen,
}: {
  tool: Tool
  isFav: boolean
  onToggleFav: () => void
  onOpen: () => void
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="group relative cursor-pointer overflow-hidden border-border/80 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardContent className="p-4">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleFav()
          }}
          aria-label={isFav ? 'প্রিয় থেকে বাদ দিন' : 'প্রিয়তে যোগ করুন'}
          aria-pressed={isFav}
          className="absolute right-2 top-2 z-10 rounded-full p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Star className={cn('h-4 w-4', isFav && 'fill-amber-400 text-amber-500')} />
        </button>

        <div className="flex items-start gap-3 pr-6">
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm transition-transform duration-200 group-hover:scale-105',
              tool.gradient
            )}
          >
            <tool.icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold sm:text-base">{tool.nameBn}</h3>
            <p className="truncate text-xs text-muted-foreground">{tool.nameEn}</p>
          </div>
        </div>
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:text-[13px]">
          {tool.descBn}
        </p>
      </CardContent>
    </Card>
  )
}

/* ================================================================== */
/* Tool view                                                           */
/* ================================================================== */

function ToolView({
  tool,
  onBack,
  onOpen,
}: {
  tool: Tool
  onBack: () => void
  onOpen: (id: string) => void
}) {
  const { toast } = useToast()
  const favorites = useAppStore((s) => s.favorites)
  const toggleFavorite = useAppStore((s) => s.toggleFavorite)
  const isFav = favorites.includes(tool.id)
  const cat = toolCategories.find((c) => c.id === tool.category)

  const related = tools
    .filter((t) => t.category === tool.category && t.id !== tool.id)
    .slice(0, 3)

  const share = async () => {
    const url = typeof window !== 'undefined' ? window.location.href : ''
    const shareData = {
      title: `${tool.nameBn} — টুলহাব`,
      text: `${tool.nameBn} (${tool.nameEn}) — টুলহাব অ্যাপে ব্যবহার করুন`,
      url,
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share(shareData)
      } else {
        await navigator.clipboard.writeText(url)
        toast({ title: 'লিংক কপি হয়েছে', description: 'শেয়ার করতে পারেন এখন' })
      }
    } catch {
      /* user cancelled share — ignore */
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10">
      {/* Tool header */}
      <div className="flex items-center gap-3 py-4">
        <Button
          variant="outline"
          size="icon"
          onClick={onBack}
          aria-label="ফিরে যান"
          className="h-10 w-10 shrink-0 rounded-xl"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <span
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm',
            tool.gradient
          )}
        >
          <tool.icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold leading-tight sm:text-xl">{tool.nameBn}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {tool.nameEn}
            {cat && <span> · {cat.nameBn}</span>}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={share}
          aria-label="শেয়ার করুন"
          className="h-10 w-10 shrink-0 rounded-xl"
        >
          <Share2 className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => toggleFavorite(tool.id)}
          aria-label={isFav ? 'প্রিয় থেকে বাদ দিন' : 'প্রিয়তে যোগ করুন'}
          aria-pressed={isFav}
          className="h-10 w-10 shrink-0 rounded-xl"
        >
          <Star className={cn('h-5 w-5', isFav && 'fill-amber-400 text-amber-500')} />
        </Button>
      </div>

      {/* Tool body — lazy loaded, code-split */}
      <tool.Component />

      {/* Related tools */}
      {related.length > 0 && (
        <section className="mt-8">
          <Separator className="mb-4" />
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
            আরও {cat?.nameBn} টুল
          </h2>
          <div className="flex flex-wrap gap-2">
            {related.map((t) => (
              <Button
                key={t.id}
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => onOpen(t.id)}
              >
                <t.icon className="h-4 w-4" />
                {t.nameBn}
              </Button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* ================================================================== */
/* Footer — sticks to the bottom (mt-auto)                             */
/* ================================================================== */

function AppFooter() {
  return (
    <footer className="mt-auto border-t bg-card/50 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-1 px-4 py-4 text-center">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Wrench className="h-3.5 w-3.5" />
          টুলহাব — সব কাজের এক অ্যাপ
        </p>
        <p className="text-[11px] text-muted-foreground/70">
          অফলাইনেও চলে · বিনামূল্যে · প্রতি সপ্তাহে নতুন টুল যোগ হয় · © ২০২৫ টুলহাব
        </p>
      </div>
    </footer>
  )
}

/* ================================================================== */

function toolsInOrder(ids: string[]): Tool[] {
  return ids
    .map((id) => getToolById(id))
    .filter((t): t is Tool => Boolean(t))
}
