'use client'

/**
 * Shopping List — tick things off, never forget the milk.
 *
 * Multiple lists (groceries, hardware, …), quantity steppers with editable
 * numbers, smart category auto-guessing, check-off with a satisfying spring
 * sink into the "Done" section, progress ring, optional per-item prices with
 * an estimated total, and one-tap sharing via the Web Share API.
 *
 * Everything persists locally in IndexedDB ('toolhub-shopping') — private,
 * offline-first, zero uploads.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Check,
  ChevronDown,
  Layers,
  Minus,
  Pencil,
  Plus,
  Share2,
  ShoppingBasket,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type CatId = 'produce' | 'dairy' | 'meat' | 'bakery' | 'pantry' | 'other'

interface ShList {
  id: string
  name: string
  createdAt: number
}

interface Item {
  id: string
  listId: string
  name: string
  qty: number
  note?: string
  category: CatId
  price?: number
  checked: boolean
  createdAt: number
}

interface CatMeta {
  id: CatId
  name: string
  dot: string
}

const CATS: CatMeta[] = [
  { id: 'produce', name: 'Produce', dot: '#4ade80' },
  { id: 'dairy', name: 'Dairy', dot: '#67e8f9' },
  { id: 'meat', name: 'Meat', dot: '#fb7185' },
  { id: 'bakery', name: 'Bakery', dot: '#fbbf24' },
  { id: 'pantry', name: 'Pantry', dot: '#d8b4fe' },
  { id: 'other', name: 'Other', dot: '#a1a1aa' },
]

function catOf(id: CatId): CatMeta {
  return CATS.find((c) => c.id === id) ?? CATS[CATS.length - 1]
}

/* ---------------- category auto-guess ---------------- */

/** Multi-word phrases checked first (beat greedy single-word matches). */
const GUESS_PHRASES: Array<[CatId, string[]]> = [
  ['pantry', ['peanut butter', 'olive oil', 'cooking spray', 'baking soda', 'baking powder']],
  ['dairy', ['almond milk', 'oat milk', 'soy milk', 'cream cheese', 'sour cream']],
]

const GUESS_WORDS: Array<[CatId, string[]]> = [
  [
    'produce',
    [
      'apple', 'banana', 'orange', 'grape', 'strawberry', 'berry', 'mango', 'peach', 'pear',
      'plum', 'cherry', 'pineapple', 'watermelon', 'melon', 'lemon', 'lime', 'avocado',
      'lettuce', 'tomato', 'potato', 'onion', 'carrot', 'broccoli', 'spinach', 'kale',
      'cucumber', 'pepper', 'garlic', 'mushroom', 'celery', 'corn', 'cabbage', 'pumpkin',
      'zucchini', 'eggplant', 'herb', 'basil', 'cilantro', 'parsley', 'mint', 'ginger',
      'salad', 'fruit', 'vegetable', 'veggie',
    ],
  ],
  [
    'dairy',
    ['milk', 'cheese', 'yogurt', 'butter', 'cream', 'egg', 'kefir', 'mozzarella', 'cheddar', 'parmesan', 'feta', 'gouda', 'brie', 'dairy'],
  ],
  [
    'meat',
    ['chicken', 'beef', 'pork', 'fish', 'meat', 'bacon', 'ham', 'turkey', 'sausage', 'shrimp', 'salmon', 'tuna', 'steak', 'lamb', 'meatball', 'rib', 'wing', 'mince'],
  ],
  [
    'bakery',
    ['bread', 'bagel', 'bun', 'croissant', 'cake', 'pastry', 'muffin', 'donut', 'doughnut', 'baguette', 'tortilla', 'pita', 'roll', 'waffle', 'pancake', 'cookie', 'brownie', 'loaf'],
  ],
  [
    'pantry',
    ['rice', 'pasta', 'noodle', 'flour', 'sugar', 'salt', 'oil', 'cereal', 'bean', 'coffee', 'tea', 'sauce', 'spice', 'honey', 'soup', 'vinegar', 'ketchup', 'mustard', 'mayo', 'jam', 'peanut', 'cracker', 'chip', 'chocolate', 'candy', 'snack', 'nut', 'seed', 'oat', 'granola', 'water', 'juice', 'soda'],
  ],
]

function guessCategory(raw: string): CatId {
  const n = raw.toLowerCase().trim()
  if (!n) return 'other'
  for (const [cat, phrases] of GUESS_PHRASES) {
    if (phrases.some((p) => n.includes(p))) return cat
  }
  const words = n.split(/[^a-z]+/).map((w) => (w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w))
  for (const [cat, dict] of GUESS_WORDS) {
    if (words.some((w) => dict.includes(w))) return cat
  }
  return 'other'
}

/* ---------------- misc helpers ---------------- */

function newId(): string {
  return `i_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function buzz(): void {
  try {
    navigator.vibrate?.(12)
  } catch {
    /* haptics unsupported */
  }
}

function clampQty(n: number): number {
  return Math.min(99, Math.max(1, Math.round(Number.isNaN(n) ? 1 : n)))
}

function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Thin glass scrollbar for long lists (house convention). */
const SCROLLBAR =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/10'

/* ================================================================== */
/* IndexedDB — lists + items, fully on-device                          */
/* ================================================================== */

const DB_NAME = 'toolhub-shopping'
const DB_VERSION = 1
const LISTS_STORE = 'lists'
const ITEMS_STORE = 'items'

let dbPromise: Promise<IDBDatabase> | null = null

function openShoppingDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(LISTS_STORE)) d.createObjectStore(LISTS_STORE, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(ITEMS_STORE)) d.createObjectStore(ITEMS_STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openShoppingDb()
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

/* ---------------- first-run seed ---------------- */

const SEED_KEY = 'toolhub-shopping:seeded'
const ACTIVE_KEY = 'toolhub-shopping:active'

function seedData(): { lists: ShList[]; items: Item[] } {
  const base = Date.now()
  const list: ShList = { id: `l_${base.toString(36)}_seed`, name: 'Groceries', createdAt: base }
  const mk = (
    n: number,
    name: string,
    qty: number,
    category: CatId,
    price: number | undefined,
    note?: string
  ): Item => ({
    id: `i_${base.toString(36)}_s${n}`,
    listId: list.id,
    name,
    qty,
    note,
    category,
    price,
    checked: false,
    createdAt: base + n,
  })
  return {
    lists: [list],
    items: [
      mk(0, 'Bananas', 1, 'produce', 2.49, 'the green-ish ones'),
      mk(1, 'Milk', 1, 'dairy', 3.79, '2% carton'),
      mk(2, 'Eggs', 2, 'dairy', 4.25),
      mk(3, 'Sourdough bread', 1, 'bakery', 4.5),
      mk(4, 'Coffee beans', 1, 'pantry', 11.99, 'medium roast'),
    ],
  }
}

/* ================================================================== */
/* Progress ring                                                       */
/* ================================================================== */

function ProgressRing({ checked, total }: { checked: number; total: number }) {
  const R = 26
  const C = 2 * Math.PI * R
  const frac = total > 0 ? checked / total : 0
  const allDone = total > 0 && checked === total
  return (
    <div className="relative size-16 shrink-0" role="img" aria-label={`${checked} of ${total} items checked off`}>
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <defs>
          <linearGradient id="slRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#bef264" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        <motion.circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="url(#slRingGrad)"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={C}
          initial={false}
          animate={{ strokeDashoffset: C * (1 - frac) }}
          transition={{ type: 'spring', stiffness: 110, damping: 22 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p
          className={cn(
            'text-sm font-black leading-none tabular-nums',
            allDone ? 'text-lime-300' : 'text-zinc-100'
          )}
        >
          {checked}/{total}
        </p>
        <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">done</p>
      </div>
    </div>
  )
}

/* ================================================================== */
/* Quantity stepper (shared by composer + rows)                        */
/* ================================================================== */

function QtyStepper({
  value,
  onBump,
  onCommit,
  label,
  compact,
}: {
  value: number
  onBump: (delta: 1 | -1) => void
  onCommit: (raw: string) => void
  label: string
  compact?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))

  const begin = () => {
    setDraft(String(value))
    setEditing(true)
  }
  const commit = () => {
    onCommit(draft)
    setEditing(false)
  }

  return (
    <div className={cn('flex shrink-0 items-center rounded-xl border border-white/10 bg-white/[0.04]')}>
      <button
        type="button"
        onClick={() => onBump(-1)}
        disabled={value <= 1}
        aria-label={`Decrease ${label}`}
        className={cn(
          'flex items-center justify-center rounded-l-xl text-zinc-400 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30',
          compact ? 'size-9' : 'size-10'
        )}
      >
        <Minus className="size-3.5" aria-hidden />
      </button>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
          inputMode="numeric"
          aria-label={`${label} quantity`}
          className={cn(
            'bg-transparent text-center text-xs font-bold tabular-nums text-lime-300 focus:outline-none',
            compact ? 'h-9 w-8' : 'h-10 w-9'
          )}
        />
      ) : (
        <button
          type="button"
          onClick={begin}
          aria-label={`Edit ${label} quantity`}
          className={cn(
            'items-center justify-center font-bold tabular-nums text-zinc-200 transition-colors hover:text-lime-300',
            compact ? 'flex h-9 w-8 text-xs' : 'flex h-10 w-9 text-sm'
          )}
        >
          {value}
        </button>
      )}
      <button
        type="button"
        onClick={() => onBump(1)}
        aria-label={`Increase ${label}`}
        className={cn(
          'flex items-center justify-center rounded-r-xl text-zinc-400 transition-colors hover:bg-white/10 hover:text-white',
          compact ? 'size-9' : 'size-10'
        )}
      >
        <Plus className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function ShoppingListApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [lists, setLists] = useState<ShList[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [activeListId, setActiveListId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  /* ---------------- add-item composer ---------------- */
  const [name, setName] = useState('')
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const [price, setPrice] = useState('')
  /** null = trust the auto-guess; a CatId = manual override */
  const [catOverride, setCatOverride] = useState<CatId | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  /* ---------------- lists sheet ---------------- */
  const [sheetOpen, setSheetOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [confirmListId, setConfirmListId] = useState<string | null>(null)

  /* ---------------- row interactions ---------------- */
  const [confirmItemId, setConfirmItemId] = useState<string | null>(null)

  /* ---------------- hydration ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [allLists, allItems] = await Promise.all([
          idbGetAll<ShList>(LISTS_STORE),
          idbGetAll<Item>(ITEMS_STORE),
        ])
        if (!alive) return
        let ls = allLists
        let its = allItems

        /* first run — seed one sample list so the tool never opens empty */
        let seeded = false
        try {
          seeded = window.localStorage.getItem(SEED_KEY) === '1'
        } catch {
          /* storage blocked — fall through */
        }
        if (ls.length === 0 && !seeded) {
          const seed = seedData()
          ls = seed.lists
          its = seed.items
          void (async () => {
            try {
              await Promise.all([
                idbPut(LISTS_STORE, seed.lists[0]),
                ...seed.items.map((it) => idbPut(ITEMS_STORE, it)),
              ])
            } catch {
              /* memory-only fallback */
            }
          })()
          try {
            window.localStorage.setItem(SEED_KEY, '1')
          } catch {
            /* best effort */
          }
        }

        ls.sort((a, b) => a.createdAt - b.createdAt)
        setLists(ls)
        setItems(its)

        /* restore last active list */
        let remembered: string | null = null
        try {
          remembered = window.localStorage.getItem(ACTIVE_KEY)
        } catch {
          /* storage blocked */
        }
        const target = ls.find((l) => l.id === remembered)?.id ?? ls[0]?.id ?? null
        setActiveListId(target)
      } catch {
        /* private mode / quota — keep in-memory data */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* remember the active list across sessions */
  useEffect(() => {
    if (!loaded) return
    try {
      if (activeListId) window.localStorage.setItem(ACTIVE_KEY, activeListId)
    } catch {
      /* best effort */
    }
  }, [activeListId, loaded])

  /* ---------------- derived ---------------- */
  /* category auto-guess: derived, never synced via effect */
  const cat: CatId = catOverride ?? guessCategory(name)
  const activeList = useMemo(() => lists.find((l) => l.id === activeListId) ?? null, [lists, activeListId])

  const listItems = useMemo(
    () => (activeListId ? items.filter((i) => i.listId === activeListId) : []),
    [items, activeListId]
  )
  const openItems = useMemo(
    () => listItems.filter((i) => !i.checked).sort((a, b) => a.createdAt - b.createdAt),
    [listItems]
  )
  const doneItems = useMemo(
    () => listItems.filter((i) => i.checked).sort((a, b) => b.createdAt - a.createdAt),
    [listItems]
  )
  const checkedCount = doneItems.length
  const totalCount = listItems.length
  const estTotal = useMemo(
    () => listItems.reduce((s, i) => s + (i.price ? i.price * i.qty : 0), 0),
    [listItems]
  )
  const hasPrices = estTotal > 0

  /* ================================================================== */
  /* Mutations — setState FIRST, then write-through to IndexedDB         */
  /* ================================================================== */

  const submitItem = useCallback(() => {
    const n = name.trim()
    if (!activeListId) {
      toast({ title: 'Create a list first' })
      return
    }
    if (!n) {
      toast({ title: 'Type an item name first' })
      return
    }
    const parsedPrice = price.trim() ? Math.round(parseFloat(price) * 100) / 100 : NaN
    const item: Item = {
      id: newId(),
      listId: activeListId,
      name: n,
      qty: clampQty(qty),
      note: note.trim() || undefined,
      category: cat,
      price: Number.isNaN(parsedPrice) || parsedPrice <= 0 ? undefined : parsedPrice,
      checked: false,
      createdAt: Date.now(),
    }
    setItems((prev) => [...prev, item])
    void idbPut(ITEMS_STORE, item).catch(() => {
      /* memory-only fallback */
    })
    setName('')
    setQty(1)
    setNote('')
    setPrice('')
    setCatOverride(null)
    nameRef.current?.focus()
  }, [activeListId, cat, name, note, price, qty, toast])

  const toggleItem = useCallback((item: Item) => {
    const next: Item = { ...item, checked: !item.checked }
    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)))
    void idbPut(ITEMS_STORE, next).catch(() => {
      /* memory-only fallback */
    })
    if (next.checked) buzz()
  }, [])

  const bumpQty = useCallback((item: Item, delta: 1 | -1) => {
    const next: Item = { ...item, qty: clampQty(item.qty + delta) }
    if (next.qty === item.qty) return
    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)))
    void idbPut(ITEMS_STORE, next).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const commitQty = useCallback((item: Item, raw: string) => {
    const parsed = parseInt(raw, 10)
    const next: Item = { ...item, qty: clampQty(Number.isNaN(parsed) ? item.qty : parsed) }
    setItems((prev) => prev.map((i) => (i.id === item.id ? next : i)))
    void idbPut(ITEMS_STORE, next).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const removeItem = useCallback((item: Item) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id))
    setConfirmItemId(null)
    void idbDelete(ITEMS_STORE, item.id).catch(() => {
      /* memory-only fallback */
    })
  }, [])

  const clearChecked = useCallback(() => {
    if (!activeListId || doneItems.length === 0) return
    const victims = doneItems
    const victimIds = new Set(victims.map((v) => v.id))
    setItems((prev) => prev.filter((i) => !victimIds.has(i.id)))
    void (async () => {
      try {
        await Promise.all(victims.map((v) => idbDelete(ITEMS_STORE, v.id)))
      } catch {
        /* memory-only fallback */
      }
    })()
    toast({
      title: `Cleared ${victims.length} checked item${victims.length === 1 ? '' : 's'}`,
    })
  }, [activeListId, doneItems, toast])

  /* ---------------- list management ---------------- */

  const createList = useCallback(() => {
    const n = newListName.trim() || `List ${lists.length + 1}`
    const list: ShList = { id: newId(), name: n, createdAt: Date.now() }
    setLists((prev) => [...prev, list])
    setActiveListId(list.id)
    void idbPut(LISTS_STORE, list).catch(() => {
      /* memory-only fallback */
    })
    setNewListName('')
    toast({ title: 'List created', description: n })
  }, [lists.length, newListName, toast])

  const startRename = useCallback((list: ShList) => {
    setRenamingId(list.id)
    setRenameDraft(list.name)
    setConfirmListId(null)
  }, [])

  const commitRename = useCallback(() => {
    if (!renamingId) return
    const n = renameDraft.trim()
    if (!n) {
      setRenamingId(null)
      return
    }
    const target = lists.find((l) => l.id === renamingId)
    if (!target) {
      setRenamingId(null)
      return
    }
    const next: ShList = { ...target, name: n }
    setLists((prev) => prev.map((l) => (l.id === renamingId ? next : l)))
    void idbPut(LISTS_STORE, next).catch(() => {
      /* memory-only fallback */
    })
    setRenamingId(null)
    toast({ title: 'List renamed', description: n })
  }, [lists, renameDraft, renamingId, toast])

  const deleteList = useCallback(
    (id: string) => {
      const victim = lists.find((l) => l.id === id)
      const victimItems = items.filter((i) => i.listId === id)
      setLists((prev) => prev.filter((l) => l.id !== id))
      setItems((prev) => prev.filter((i) => i.listId !== id))
      setConfirmListId(null)
      void (async () => {
        try {
          await idbDelete(LISTS_STORE, id)
          await Promise.all(victimItems.map((v) => idbDelete(ITEMS_STORE, v.id)))
        } catch {
          /* memory-only fallback */
        }
      })()
      if (activeListId === id) {
        setActiveListId(lists.find((l) => l.id !== id)?.id ?? null)
      }
      toast({
        title: 'List deleted',
        description: victim ? `“${victim.name}” and ${victimItems.length} item${victimItems.length === 1 ? '' : 's'} removed` : undefined,
      })
    },
    [activeListId, items, lists, toast]
  )

  const closeSheet = useCallback(() => {
    setSheetOpen(false)
    setRenamingId(null)
    setConfirmListId(null)
  }, [])

  /* ---------------- share ---------------- */

  const shareList = useCallback(async () => {
    if (!activeList) return
    if (totalCount === 0) {
      toast({ title: 'Nothing to share yet', description: 'Add some items to this list first.' })
      return
    }
    const lines: string[] = [`🛒 ${activeList.name}`]
    lines.push(`${checkedCount}/${totalCount} checked${hasPrices ? ` · est. ${money(estTotal)}` : ''}`)
    if (openItems.length > 0) {
      lines.push('', 'To buy:')
      for (const i of openItems) {
        lines.push(`• ${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}${i.price ? ` — ${money(i.price * i.qty)}` : ''}`)
      }
    }
    if (doneItems.length > 0) {
      lines.push('', 'Done:')
      for (const i of doneItems) {
        lines.push(`☑ ${i.name}${i.qty > 1 ? ` ×${i.qty}` : ''}`)
      }
    }
    const text = lines.join('\n')

    const copyFallback = async () => {
      try {
        await navigator.clipboard.writeText(text)
        toast({ title: 'Copied to clipboard', description: 'Paste it into any chat or note.' })
      } catch {
        toast({ title: "Couldn't share or copy", description: 'Your browser blocked both — sorry!' })
      }
    }

    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: activeList.name, text })
        return
      }
      await copyFallback()
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return // user cancelled
      await copyFallback()
    }
  }, [activeList, checkedCount, doneItems, estTotal, hasPrices, openItems, toast, totalCount])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.65)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-lime-500/[0.09] via-transparent to-green-600/[0.07] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-lime-300 via-lime-500 to-green-600 text-green-950 ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(132_204_22/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <ShoppingBasket className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Shopping List</h2>
              <p className="text-xs text-zinc-400">Tick things off. Share in one tap.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={() => void shareList()}
                aria-label="Share list"
                className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Share2 className="size-4.5" aria-hidden />
              </button>
              <button
                onClick={() => setSheetOpen(true)}
                aria-label="Manage lists"
                className="flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                <Layers className="size-4.5" aria-hidden />
              </button>
            </div>
          </div>

          {/* Progress strip */}
          <div className="mt-5 flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
            <ProgressRing checked={checkedCount} total={totalCount} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold tracking-tight">
                {activeList ? activeList.name : 'No list selected'}
              </p>
              <p className="mt-0.5 text-xs text-zinc-400">
                {totalCount === 0
                  ? 'Nothing on this list yet'
                  : checkedCount === totalCount
                    ? 'All checked off — nice!'
                    : `${totalCount - checkedCount} to buy · ${checkedCount} done`}
              </p>
              {hasPrices && (
                <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-lime-400/25 bg-lime-500/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-lime-200">
                  Est. total {money(estTotal)}
                </p>
              )}
            </div>
          </div>

          {/* List switcher chips */}
          {lists.length > 0 && (
            <div
              className="no-scrollbar -mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1"
              role="tablist"
              aria-label="Shopping lists"
            >
              {lists.map((l) => {
                const active = l.id === activeListId
                const cnt = items.filter((i) => i.listId === l.id).length
                return (
                  <button
                    key={l.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveListId(l.id)}
                    className={cn(
                      'flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition-all',
                      active
                        ? 'border-lime-400/60 bg-lime-500/15 text-lime-200 shadow-[0_0_16px_rgb(132_204_22/0.25)]'
                        : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                    )}
                  >
                    {l.name}
                    <span
                      className={cn(
                        'rounded-full px-1.5 text-[10px] font-bold tabular-nums',
                        active ? 'bg-lime-500/25 text-lime-200' : 'bg-white/10 text-zinc-400'
                      )}
                    >
                      {cnt}
                    </span>
                  </button>
                )
              })}
              <button
                onClick={() => setSheetOpen(true)}
                className="flex h-9 shrink-0 items-center gap-1 rounded-full border border-dashed border-white/15 px-3 text-xs font-semibold text-zinc-400 transition-colors hover:border-lime-400/40 hover:text-lime-300"
                aria-label="New list"
              >
                <Plus className="size-3.5" aria-hidden /> New
              </button>
            </div>
          )}
        </div>

        {!loaded ? (
          /* ---------------- Hydrating ---------------- */
          <div className="space-y-3 p-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-14 animate-pulse rounded-2xl bg-white/[0.05]" />
            ))}
          </div>
        ) : lists.length === 0 ? (
          /* ---------------- No lists at all ---------------- */
          <div className="p-4 sm:p-5">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
              <ShoppingBasket className="size-10 text-zinc-600" aria-hidden />
              <p className="text-sm font-semibold text-zinc-300">No lists yet</p>
              <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                Create a list for groceries, hardware, travel — anything you need to remember at the store.
                Everything stays on this device.
              </p>
              <Button
                onClick={() => setSheetOpen(true)}
                className="mt-1 h-11 rounded-xl bg-gradient-to-r from-lime-300 to-green-500 font-semibold text-green-950 shadow-lg hover:from-lime-200 hover:to-green-400"
              >
                <Plus className="size-4" aria-hidden /> Create your first list
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-4 sm:p-5">
            {/* ---------------- Add-item composer ---------------- */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-white/10 bg-white/5 px-3.5 transition-colors focus-within:border-lime-400/50">
                  <input
                    ref={nameRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitItem()
                    }}
                    placeholder="Add an item…"
                    aria-label="Item name"
                    maxLength={60}
                    className="h-full w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                  />
                </div>
                <Button
                  onClick={submitItem}
                  aria-label="Add item"
                  className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-lime-300 to-green-500 px-4 font-semibold text-green-950 shadow-lg hover:from-lime-200 hover:to-green-400"
                >
                  <Plus className="size-4" aria-hidden /> Add
                </Button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <QtyStepper
                  value={qty}
                  label="new item"
                  onBump={(d) => setQty((q) => clampQty(q + d))}
                  onCommit={(raw) => {
                    const parsed = parseInt(raw, 10)
                    setQty(clampQty(Number.isNaN(parsed) ? 1 : parsed))
                  }}
                />
                <button
                  type="button"
                  onClick={() => setDetailsOpen((v) => !v)}
                  aria-expanded={detailsOpen}
                  className="flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  Options
                  <motion.span animate={{ rotate: detailsOpen ? 180 : 0 }} transition={{ duration: 0.18 }}>
                    <ChevronDown className="size-3.5" aria-hidden />
                  </motion.span>
                </button>
                {name.trim() && catOverride === null && (
                  <span className="flex h-9 items-center gap-1.5 rounded-xl border border-lime-400/25 bg-lime-500/10 px-2.5 text-[11px] font-medium text-lime-200">
                    <span className="size-2 rounded-full" style={{ backgroundColor: catOf(cat).dot }} aria-hidden />
                    {catOf(cat).name}
                    <span className="text-lime-300/60">auto</span>
                  </span>
                )}
              </div>

              <AnimatePresence initial={false}>
                {detailsOpen && (
                  <motion.div
                    key="details"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2.5 pt-3">
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') submitItem()
                        }}
                        placeholder="Note (optional) — e.g. brand, aisle"
                        aria-label="Item note"
                        maxLength={60}
                        className="h-10 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-lime-400/50 focus:outline-none"
                      />
                      <div className="flex items-center gap-2">
                        <div className="flex h-10 flex-1 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3.5 transition-colors focus-within:border-lime-400/50">
                          <span className="text-sm text-zinc-500">$</span>
                          <input
                            value={price}
                            onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') submitItem()
                            }}
                            placeholder="Price per unit (optional)"
                            aria-label="Item price"
                            inputMode="decimal"
                            className="h-full w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
                        {catOverride !== null && (
                          <button
                            type="button"
                            onClick={() => setCatOverride(null)}
                            className="flex h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 text-xs font-semibold text-zinc-400 transition-all hover:bg-white/10 hover:text-white"
                          >
                            Auto
                          </button>
                        )}
                        {CATS.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            role="radio"
                            aria-checked={cat === c.id}
                            onClick={() => setCatOverride(c.id)}
                            className={cn(
                              'flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all',
                              cat === c.id
                                ? 'border-lime-400/60 bg-lime-500/15 text-lime-200'
                                : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                            )}
                          >
                            <span className="size-2 rounded-full" style={{ backgroundColor: c.dot }} aria-hidden />
                            {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ---------------- Items ---------------- */}
            {totalCount === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-10 text-center">
                <ShoppingBasket className="size-10 text-zinc-600" aria-hidden />
                <p className="text-sm font-semibold text-zinc-300">The aisle is empty</p>
                <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                  Add your first item above — type a name, tap Add. Categories like produce and dairy are guessed
                  for you.
                </p>
              </div>
            ) : (
              <>
                {/* To buy */}
                <div>
                  <div className="mb-2 flex items-baseline justify-between px-1">
                    <p className="text-sm font-bold">To buy</p>
                    <p className="text-[11px] text-zinc-500">
                      {openItems.length === 0 ? 'all done' : `${openItems.length} left`}
                    </p>
                  </div>

                  {openItems.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-lime-400/25 bg-lime-500/[0.06] px-4 py-8 text-center">
                      <p className="text-2xl" aria-hidden>
                        🎉
                      </p>
                      <p className="mt-1.5 text-sm font-semibold text-lime-200">
                        Everything checked off — nice work!
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">Clear the done section when you are home.</p>
                    </div>
                  ) : (
                    <ul
                      className={cn('max-h-96 space-y-1.5 overflow-y-auto pr-1', SCROLLBAR)}
                      aria-label="Items to buy"
                    >
                      <AnimatePresence initial={false}>
                        {openItems.map((item) => {
                          const c = catOf(item.category)
                          const confirming = confirmItemId === item.id
                          return (
                            <motion.li
                              key={item.id}
                              layout
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.97 }}
                              transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                              className="flex min-h-14 items-center gap-1 rounded-2xl border border-white/10 bg-white/[0.03] p-2"
                            >
                              {/* check-off — big 44px tap target */}
                              <button
                                type="button"
                                onClick={() => toggleItem(item)}
                                aria-pressed={item.checked}
                                aria-label={`Mark ${item.name} as bought`}
                                className="flex size-11 shrink-0 items-center justify-center"
                              >
                                <motion.span
                                  whileTap={{ scale: 0.8 }}
                                  className={cn(
                                    'flex size-6 items-center justify-center rounded-lg border-2 transition-colors',
                                    item.checked
                                      ? 'border-lime-400 bg-lime-400 text-green-950 shadow-[0_0_14px_rgb(132_204_22/0.5)]'
                                      : 'border-zinc-600 hover:border-lime-400/70'
                                  )}
                                >
                                  <AnimatePresence>
                                    {item.checked && (
                                      <motion.span
                                        initial={{ scale: 0, rotate: -30 }}
                                        animate={{ scale: 1, rotate: 0 }}
                                        exit={{ scale: 0 }}
                                        transition={{ type: 'spring', stiffness: 500, damping: 22 }}
                                      >
                                        <Check className="size-4" strokeWidth={3} aria-hidden />
                                      </motion.span>
                                    )}
                                  </AnimatePresence>
                                </motion.span>
                              </button>

                              {/* content */}
                              <div className="min-w-0 flex-1 pl-1">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="size-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: c.dot }}
                                    aria-hidden
                                  />
                                  <span className="sr-only">{c.name}</span>
                                  <p className="truncate text-sm font-semibold text-zinc-100">{item.name}</p>
                                  {item.qty > 1 && (
                                    <span className="shrink-0 rounded-md bg-white/10 px-1.5 text-[10px] font-bold tabular-nums text-zinc-300">
                                      ×{item.qty}
                                    </span>
                                  )}
                                </div>
                                {(item.note || item.price != null) && (
                                  <p className="mt-0.5 truncate pl-3.5 text-[11px] text-zinc-500">
                                    {item.note}
                                    {item.note && item.price != null ? ' · ' : ''}
                                    {item.price != null && (
                                      <span className="font-semibold tabular-nums text-zinc-400">
                                        {money(item.price)} ea
                                      </span>
                                    )}
                                  </p>
                                )}
                              </div>

                              {/* quantity stepper */}
                              <QtyStepper
                                compact
                                value={item.qty}
                                label={item.name}
                                onBump={(d) => bumpQty(item, d)}
                                onCommit={(raw) => commitQty(item, raw)}
                              />

                              {/* delete — two-tap confirm */}
                              <button
                                type="button"
                                onClick={() => (confirming ? void removeItem(item) : setConfirmItemId(item.id))}
                                aria-label={
                                  confirming ? `Confirm delete ${item.name}` : `Delete ${item.name}`
                                }
                                className={cn(
                                  'flex size-10 shrink-0 items-center justify-center rounded-full transition-colors',
                                  confirming
                                    ? 'bg-rose-500 text-white'
                                    : 'text-zinc-600 hover:bg-rose-500/15 hover:text-rose-300'
                                )}
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </button>
                            </motion.li>
                          )
                        })}
                      </AnimatePresence>
                    </ul>
                  )}
                </div>

                {/* Done */}
                {doneItems.length > 0 && (
                  <div>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                        Done · {doneItems.length}
                      </p>
                      <button
                        type="button"
                        onClick={clearChecked}
                        className="flex h-9 items-center rounded-lg px-2 text-[11px] font-semibold text-zinc-400 transition-colors hover:bg-rose-500/10 hover:text-rose-300"
                      >
                        <Trash2 className="mr-1 size-3" aria-hidden />
                        Clear checked ({doneItems.length})
                      </button>
                    </div>
                    <ul
                      className={cn('max-h-64 space-y-1.5 overflow-y-auto pr-1', SCROLLBAR)}
                      aria-label="Checked-off items"
                    >
                      <AnimatePresence initial={false}>
                        {doneItems.map((item) => {
                          const c = catOf(item.category)
                          const confirming = confirmItemId === item.id
                          return (
                            <motion.li
                              key={item.id}
                              layout
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, scale: 0.97 }}
                              transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                              className="flex min-h-14 items-center gap-1 rounded-2xl border border-white/5 bg-white/[0.02] p-2 opacity-75"
                            >
                              {/* un-check to restore */}
                              <button
                                type="button"
                                onClick={() => toggleItem(item)}
                                aria-pressed={item.checked}
                                aria-label={`Restore ${item.name} to the shopping list`}
                                className="flex size-11 shrink-0 items-center justify-center"
                              >
                                <motion.span
                                  whileTap={{ scale: 0.8 }}
                                  className="flex size-6 items-center justify-center rounded-lg border-2 border-lime-400 bg-lime-400 text-green-950 shadow-[0_0_14px_rgb(132_204_22/0.5)]"
                                >
                                  <Check className="size-4" strokeWidth={3} aria-hidden />
                                </motion.span>
                              </button>

                              <div className="min-w-0 flex-1 pl-1">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="size-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: c.dot }}
                                    aria-hidden
                                  />
                                  <span className="sr-only">{c.name}</span>
                                  <p className="truncate text-sm font-semibold text-zinc-500 line-through decoration-lime-400/60 decoration-2">
                                    {item.name}
                                  </p>
                                  {item.qty > 1 && (
                                    <span className="shrink-0 rounded-md bg-white/5 px-1.5 text-[10px] font-bold tabular-nums text-zinc-500">
                                      ×{item.qty}
                                    </span>
                                  )}
                                </div>
                                {(item.note || item.price != null) && (
                                  <p className="mt-0.5 truncate pl-3.5 text-[11px] text-zinc-600">
                                    {item.note}
                                    {item.note && item.price != null ? ' · ' : ''}
                                    {item.price != null && (
                                      <span className="font-semibold tabular-nums">{money(item.price)} ea</span>
                                    )}
                                  </p>
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={() => (confirming ? void removeItem(item) : setConfirmItemId(item.id))}
                                aria-label={
                                  confirming ? `Confirm delete ${item.name}` : `Delete ${item.name}`
                                }
                                className={cn(
                                  'flex size-10 shrink-0 items-center justify-center rounded-full transition-colors',
                                  confirming
                                    ? 'bg-rose-500 text-white'
                                    : 'text-zinc-600 hover:bg-rose-500/15 hover:text-rose-300'
                                )}
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </button>
                            </motion.li>
                          )
                        })}
                      </AnimatePresence>
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </motion.div>

      <p className="mt-3 px-1 text-center text-[11px] text-zinc-600">
        Lists live only on this device — no account, no uploads.
      </p>

      {/* ---------------- Manage-lists sheet ---------------- */}
      <AnimatePresence>
        {sheetOpen && (
          <motion.div
            key="lists-sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) closeSheet()
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Manage lists"
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="w-full max-w-sm rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-lime-500/20 text-lime-300">
                  <Layers className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">Your lists</h3>
                <button
                  onClick={closeSheet}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              {/* create */}
              <div className="flex gap-2">
                <input
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createList()
                  }}
                  placeholder="New list name"
                  aria-label="New list name"
                  maxLength={40}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-lime-400/50 focus:outline-none"
                />
                <Button
                  onClick={createList}
                  className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-lime-300 to-green-500 px-4 font-semibold text-green-950 shadow-lg hover:from-lime-200 hover:to-green-400"
                >
                  <Plus className="size-4" aria-hidden /> New
                </Button>
              </div>

              {/* rows */}
              <div className={cn('mt-4 max-h-72 space-y-2 overflow-y-auto pr-1', SCROLLBAR)}>
                {lists.length === 0 && (
                  <p className="py-6 text-center text-xs text-zinc-500">
                    No lists yet — create one above to get started.
                  </p>
                )}
                {lists.map((l) => {
                  const own = items.filter((i) => i.listId === l.id)
                  const dn = own.filter((i) => i.checked).length
                  const isActive = l.id === activeListId
                  const renaming = renamingId === l.id
                  const confirming = confirmListId === l.id
                  return (
                    <div
                      key={l.id}
                      className={cn(
                        'rounded-2xl border p-3 transition-colors',
                        confirming
                          ? 'border-rose-400/40 bg-rose-500/[0.07]'
                          : isActive
                            ? 'border-lime-400/40 bg-lime-500/[0.07]'
                            : 'border-white/10 bg-white/[0.03]'
                      )}
                    >
                      {renaming ? (
                        <div className="flex items-center gap-2">
                          <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename()
                              if (e.key === 'Escape') setRenamingId(null)
                            }}
                            aria-label="Rename list"
                            maxLength={40}
                            className="h-10 min-w-0 flex-1 rounded-xl border border-lime-400/40 bg-white/5 px-3 text-sm text-zinc-100 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={commitRename}
                            aria-label="Save name"
                            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-lime-500 text-green-950 transition-colors hover:bg-lime-400"
                          >
                            <Check className="size-4" strokeWidth={3} aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingId(null)}
                            aria-label="Cancel rename"
                            className="flex size-10 shrink-0 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            <X className="size-4" aria-hidden />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveListId(l.id)
                              closeSheet()
                            }}
                            className="min-w-0 flex-1 rounded-xl py-1.5 text-left"
                            aria-label={`Switch to ${l.name}`}
                          >
                            <p
                              className={cn(
                                'truncate text-sm font-semibold',
                                isActive ? 'text-lime-200' : 'text-zinc-100'
                              )}
                            >
                              {l.name}
                              {isActive && <span className="ml-1.5 text-[10px] font-bold">ACTIVE</span>}
                            </p>
                            <p className="text-[11px] text-zinc-500">
                              {own.length} item{own.length === 1 ? '' : 's'} · {dn} checked
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => startRename(l)}
                            aria-label={`Rename ${l.name}`}
                            className="flex size-10 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-white/10 hover:text-white"
                          >
                            <Pencil className="size-4" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => (confirming ? void deleteList(l.id) : setConfirmListId(l.id))}
                            aria-label={
                              confirming ? `Confirm delete ${l.name}` : `Delete ${l.name}`
                            }
                            className={cn(
                              'flex size-10 shrink-0 items-center justify-center rounded-full transition-colors',
                              confirming
                                ? 'bg-rose-500 text-white'
                                : 'text-zinc-500 hover:bg-rose-500/15 hover:text-rose-300'
                            )}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </button>
                        </div>
                      )}
                      {confirming && !renaming && (
                        <p className="mt-1.5 px-1 text-[11px] leading-relaxed text-rose-300">
                          Tap the trash again to delete “{l.name}” and its {own.length} item
                          {own.length === 1 ? '' : 's'}.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
