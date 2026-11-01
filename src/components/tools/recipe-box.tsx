'use client'

/**
 * Recipe Box — your kitchen companion.
 *
 * A warm, dark-glass recipe manager with three superpowers:
 *  1. Recipes — create/edit with ingredients, ordered steps, tags & categories
 *  2. Cook mode — strike-off ingredients and walk through steps one at a time
 *  3. Meal planner — a Mon–Sun week grid (lunch/dinner) with one-tap shopping
 *     aggregation from everything you planned.
 *
 * Everything persists locally in IndexedDB ('toolhub-recipes') — private,
 * offline and instant. Seeded with 4 real recipes on first run so the box is
 * never blocking.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowLeft,
  CalendarDays,
  Check,
  ChefHat,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShoppingCart,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/hooks/use-toast'

/* ================================================================== */
/* Model                                                               */
/* ================================================================== */

type Category = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'dessert'
type MealId = 'lunch' | 'dinner'

interface Ingredient {
  name: string
  qty: string
}

interface Recipe {
  id: string
  name: string
  category: Category
  emoji: string
  servings: number
  prepMin: number
  ingredients: Ingredient[]
  steps: string[]
  tags: string[]
  createdAt: number
  updatedAt?: number
}

/** IndexedDB row in the 'planner' store — keyed by `${dayIdx}-${meal}` */
interface PlannerRow {
  slot: string
  recipeId: string
}

/** IndexedDB row in the 'settings' store */
interface SettingRow {
  key: 'seeded'
  value: boolean
}

interface CategoryMeta {
  name: string
  emoji: string
  hex: string
  light: string
}

const CAT_META: Record<Category, CategoryMeta> = {
  breakfast: { name: 'Breakfast', emoji: '🍳', hex: '#f59e0b', light: '#fcd34d' },
  lunch: { name: 'Lunch', emoji: '🍱', hex: '#f97316', light: '#fdba74' },
  dinner: { name: 'Dinner', emoji: '🌙', hex: '#ef4444', light: '#fca5a5' },
  snack: { name: 'Snack', emoji: '🍿', hex: '#eab308', light: '#fde047' },
  dessert: { name: 'Dessert', emoji: '🍰', hex: '#f472b6', light: '#f9a8d4' },
}

const CATS = Object.keys(CAT_META) as Category[]

const EMOJI_PALETTE = [
  '🍳', '🥞', '🍲', '🍛', '🍚', '🍜', '🥘', '🍣',
  '🥗', '🍔', '🌮', '🌯', '🍕', '🍟', '🍿', '🥤',
  '☕', '🍰', '🧁', '🥣',
]

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DAYS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const MEALS: { id: MealId; label: string; emoji: string }[] = [
  { id: 'lunch', label: 'Lunch', emoji: '☀️' },
  { id: 'dinner', label: 'Dinner', emoji: '🌙' },
]

function catOf(id: string): CategoryMeta {
  return CAT_META[(id as Category) in CAT_META ? (id as Category) : 'dinner']
}

/* ================================================================== */
/* Seed recipes — real ones so the box is never empty on first run     */
/* ================================================================== */

interface SeedDef {
  slug: string
  name: string
  category: Category
  emoji: string
  servings: number
  prepMin: number
  ingredients: Ingredient[]
  steps: string[]
  tags: string[]
}

const SEEDS: SeedDef[] = [
  {
    slug: 'chicken-khichuri',
    name: 'Chicken Khichuri',
    category: 'dinner',
    emoji: '🍲',
    servings: 4,
    prepMin: 15,
    ingredients: [
      { name: 'Rice', qty: '2 cups' },
      { name: 'Moong dal', qty: '1 cup' },
      { name: 'Chicken', qty: '500 g' },
      { name: 'Onion', qty: '2 pcs' },
      { name: 'Ginger paste', qty: '1 tbsp' },
      { name: 'Garlic paste', qty: '1 tbsp' },
      { name: 'Turmeric powder', qty: '0.5 tsp' },
      { name: 'Cumin powder', qty: '1 tsp' },
      { name: 'Ghee', qty: '3 tbsp' },
      { name: 'Bay leaf', qty: '2 pcs' },
      { name: 'Hot water', qty: '5 cups' },
      { name: 'Salt', qty: 'to taste' },
    ],
    steps: [
      'Wash the rice and moong dal together, drain and keep aside.',
      'Heat ghee in a large pot, add bay leaves and sliced onions, fry until golden.',
      'Add chicken, ginger paste, garlic paste and turmeric; fry 5 minutes until well coated.',
      'Stir in cumin powder, rice and dal; toss on medium heat for 2 minutes.',
      'Pour in hot water, add salt, and bring to a boil.',
      'Cover and simmer on low for 20 minutes, stirring once, until creamy.',
      'Rest 5 minutes, then serve hot with lemon wedges and egg fry.',
    ],
    tags: ['one-pot', 'comfort-food', 'bangladeshi'],
  },
  {
    slug: 'veg-fried-rice',
    name: 'Vegetable Fried Rice',
    category: 'lunch',
    emoji: '🍚',
    servings: 3,
    prepMin: 20,
    ingredients: [
      { name: 'Cooked rice', qty: '4 cups' },
      { name: 'Carrot', qty: '1 pc' },
      { name: 'Green beans', qty: '100 g' },
      { name: 'Eggs', qty: '2 pcs' },
      { name: 'Soy sauce', qty: '2 tbsp' },
      { name: 'Garlic', qty: '4 cloves' },
      { name: 'Spring onion', qty: '3 pcs' },
      { name: 'Vegetable oil', qty: '2 tbsp' },
      { name: 'Sesame oil', qty: '1 tsp' },
      { name: 'White pepper', qty: '0.5 tsp' },
      { name: 'Salt', qty: 'to taste' },
    ],
    steps: [
      'Dice the carrot and beans very small; chop garlic and spring onions.',
      'Scramble the eggs in a hot oiled wok, break into pieces and set aside.',
      'Stir-fry garlic for 30 seconds, then add carrot and beans for 3 minutes.',
      'Add cold cooked rice, breaking up clumps; toss on high heat for 3 minutes.',
      'Season with soy sauce, sesame oil, salt and white pepper.',
      'Fold in the eggs and spring onions, give one final toss and serve immediately.',
    ],
    tags: ['wok', 'quick', 'weeknight'],
  },
  {
    slug: 'masala-omelette',
    name: 'Masala Omelette',
    category: 'breakfast',
    emoji: '🍳',
    servings: 1,
    prepMin: 10,
    ingredients: [
      { name: 'Eggs', qty: '3 pcs' },
      { name: 'Onion', qty: '1 pc' },
      { name: 'Tomato', qty: '1 pc' },
      { name: 'Green chili', qty: '1 pc' },
      { name: 'Coriander leaves', qty: '2 tbsp' },
      { name: 'Milk', qty: '1 tbsp' },
      { name: 'Turmeric', qty: '1 pinch' },
      { name: 'Red chili powder', qty: '0.25 tsp' },
      { name: 'Butter', qty: '1 tbsp' },
      { name: 'Salt', qty: 'to taste' },
    ],
    steps: [
      'Whisk the eggs with milk, turmeric, chili powder and salt until frothy.',
      'Fold in the chopped onion, tomato, green chili and coriander.',
      'Melt butter in a non-stick pan over medium heat.',
      'Pour in the mixture, tilt to spread evenly, and cook 2 minutes until the edges set.',
      'Flip carefully and cook 1 more minute.',
      'Slide onto a plate and serve with toast or paratha.',
    ],
    tags: ['quick', 'protein', '5-minute'],
  },
  {
    slug: 'fruit-smoothie',
    name: 'Fruit Smoothie',
    category: 'snack',
    emoji: '🥤',
    servings: 2,
    prepMin: 5,
    ingredients: [
      { name: 'Banana', qty: '2 pcs' },
      { name: 'Mango', qty: '1 cup' },
      { name: 'Yogurt', qty: '1 cup' },
      { name: 'Milk', qty: '0.5 cup' },
      { name: 'Honey', qty: '1 tbsp' },
      { name: 'Ice cubes', qty: '4 pcs' },
    ],
    steps: [
      'Peel and chop the banana and mango.',
      'Add everything to a blender.',
      'Blend on high for 45 seconds until silky.',
      'Pour into tall glasses and top with chopped nuts.',
    ],
    tags: ['no-cook', 'healthy', '5-minute'],
  },
]

/* ================================================================== */
/* Helpers                                                             */
/* ================================================================== */

function genId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

function newRid(): string {
  return `ri_${Math.random().toString(36).slice(2, 9)}`
}

function buzz(ms = 12) {
  try {
    navigator.vibrate?.(ms)
  } catch {
    /* haptics unsupported */
  }
}

function fmtNum(n: number): string {
  return Number(n.toFixed(2)).toString()
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

/* ================================================================== */
/* IndexedDB — 'toolhub-recipes': recipes, planner, settings           */
/* ================================================================== */

const DB_NAME = 'toolhub-recipes'
const DB_VERSION = 1
const REC_STORE = 'recipes'
const PLAN_STORE = 'planner'
const SET_STORE = 'settings'

let dbPromise: Promise<IDBDatabase> | null = null

function openRecipeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(REC_STORE)) d.createObjectStore(REC_STORE, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(PLAN_STORE)) d.createObjectStore(PLAN_STORE, { keyPath: 'slot' })
      if (!d.objectStoreNames.contains(SET_STORE)) d.createObjectStore(SET_STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function db(): Promise<IDBDatabase> {
  dbPromise ??= openRecipeDb()
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

/* ================================================================== */
/* Shopping aggregation — merge planned recipes into one list          */
/* ================================================================== */

interface AggIngredient {
  name: string
  unit: string | null
  total: number
  extras: string[]
}

interface ShoppingResult {
  lines: string[]
  text: string
  recipeCount: number
}

function buildShoppingList(
  entries: { recipe: Recipe; count: number }[]
): ShoppingResult {
  const map = new Map<string, AggIngredient>()

  for (const { recipe } of entries) {
    for (const ing of recipe.ingredients) {
      const label = ing.name.trim()
      if (!label) continue
      const key = label.toLowerCase()
      const agg = map.get(key) ?? { name: label, unit: null, total: 0, extras: [] }
      const qty = ing.qty.trim()
      const m = qty.match(/^(\d+(?:\.\d+)?)\s*(.*)$/)
      if (m) {
        const unit = m[2].trim() || null
        const num = Number(m[1])
        if (agg.extras.length === 0 && (agg.unit === null || agg.unit === unit)) {
          agg.unit = unit
          agg.total += num
        } else {
          agg.extras.push(qty)
        }
      } else if (qty) {
        agg.extras.push(qty)
      }
      map.set(key, agg)
    }
  }

  const lines = [...map.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((agg) => {
      const parts: string[] = []
      if (agg.total > 0) parts.push(`${fmtNum(agg.total)}${agg.unit ? ` ${agg.unit}` : ''}`)
      parts.push(...agg.extras)
      return parts.length > 0 ? `• ${agg.name} — ${parts.join(' + ')}` : `• ${agg.name}`
    })

  return { lines, text: lines.join('\n'), recipeCount: entries.length }
}

/** Collect planned recipes (deduped, with slot counts) from the planner map. */
function collectPlannedEntries(
  planner: Record<string, string>,
  recipeMap: Map<string, Recipe>
): { recipe: Recipe; count: number }[] {
  const counts = new Map<string, number>()
  for (const rid of Object.values(planner)) counts.set(rid, (counts.get(rid) ?? 0) + 1)
  return [...counts.entries()]
    .map(([rid, count]) => {
      const r = recipeMap.get(rid)
      return r ? { recipe: r, count } : null
    })
    .filter((e): e is { recipe: Recipe; count: number } => e !== null)
    .sort((a, b) => a.recipe.name.localeCompare(b.recipe.name))
}

/* ================================================================== */
/* Draft-row type for the ingredient editor                            */
/* ================================================================== */

interface DraftIng {
  rid: string
  name: string
  qty: string
}

/* ================================================================== */
/* Component                                                           */
/* ================================================================== */

export default function RecipeBoxApp() {
  const { toast } = useToast()

  /* ---------------- state ---------------- */
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [planner, setPlanner] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)

  const [tab, setTab] = useState<'recipes' | 'planner'>('recipes')
  const [query, setQuery] = useState('')
  const [catFilter, setCatFilter] = useState<Category | 'all'>('all')

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  /* editor form */
  const [formName, setFormName] = useState('')
  const [formEmoji, setFormEmoji] = useState(CAT_META.breakfast.emoji)
  const [formCat, setFormCat] = useState<Category>('breakfast')
  const [formServings, setFormServings] = useState('2')
  const [formPrep, setFormPrep] = useState('15')
  const [formIngs, setFormIngs] = useState<DraftIng[]>([])
  const [formSteps, setFormSteps] = useState('')
  const [formTags, setFormTags] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  /* cook mode */
  const [cookId, setCookId] = useState<string | null>(null)
  const [cookStep, setCookStep] = useState(0)
  const [checked, setChecked] = useState<Set<number>>(new Set())

  /* planner sheets */
  const [slotTarget, setSlotTarget] = useState<{ dayIdx: number; meal: MealId } | null>(null)
  const [slotQuery, setSlotQuery] = useState('')
  const [shopOpen, setShopOpen] = useState(false)

  const todayIdx = useMemo(() => (new Date().getDay() + 6) % 7, [])

  /* ---------------- hydration + first-run seeding ---------------- */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [allRecipes, allPlanner, allSettings] = await Promise.all([
          idbGetAll<Recipe>(REC_STORE),
          idbGetAll<PlannerRow>(PLAN_STORE),
          idbGetAll<SettingRow>(SET_STORE),
        ])
        if (!alive) return

        let finalRecipes = allRecipes
        if (!allSettings.some((s) => s.key === 'seeded')) {
          if (allRecipes.length === 0) {
            const now = Date.now()
            const seeds: Recipe[] = SEEDS.map((s, i) => ({
              id: `seed-${s.slug}`,
              name: s.name,
              category: s.category,
              emoji: s.emoji,
              servings: s.servings,
              prepMin: s.prepMin,
              ingredients: s.ingredients,
              steps: s.steps,
              tags: s.tags,
              createdAt: now + (SEEDS.length - i),
            }))
            finalRecipes = seeds
            setRecipes(seeds)
            for (const r of seeds) void idbPut(REC_STORE, r).catch(() => {})
          }
          void idbPut(SET_STORE, { key: 'seeded', value: true }).catch(() => {})
        }
        setRecipes(finalRecipes)

        const map: Record<string, string> = {}
        for (const row of allPlanner) map[row.slot] = row.recipeId
        setPlanner(map)
      } catch {
        /* private mode / quota — keep in-memory data */
      }
      if (alive) setLoaded(true)
    })()
    return () => {
      alive = false
    }
  }, [])

  /* ---------------- mutations (write-through to IndexedDB) ---------------- */
  const upsertRecipe = (recipe: Recipe, isNew: boolean) => {
    setRecipes((prev) => (isNew ? [recipe, ...prev] : prev.map((r) => (r.id === recipe.id ? recipe : r))))
    void idbPut(REC_STORE, recipe).catch(() => {
      /* memory-only fallback */
    })
  }

  const removeRecipe = (id: string) => {
    setRecipes((prev) => prev.filter((r) => r.id !== id))
    setConfirmDeleteId(null)
    const affected = Object.entries(planner).filter(([, rid]) => rid === id)
    if (affected.length > 0) {
      setPlanner((prev) => {
        const next = { ...prev }
        for (const [slot] of affected) delete next[slot]
        return next
      })
      for (const [slot] of affected) void idbDelete(PLAN_STORE, slot).catch(() => {})
    }
    void idbDelete(REC_STORE, id).catch(() => {
      /* memory-only fallback */
    })
    toast({ title: 'Recipe deleted' })
  }

  const setPlanned = (slot: string, recipeId: string | null) => {
    setPlanner((prev) => {
      const next = { ...prev }
      if (recipeId) next[slot] = recipeId
      else delete next[slot]
      return next
    })
    if (recipeId) void idbPut(PLAN_STORE, { slot, recipeId }).catch(() => {})
    else void idbDelete(PLAN_STORE, slot).catch(() => {})
  }

  /* ---------------- editor actions ---------------- */
  const openNew = () => {
    setEditingId(null)
    setFormName('')
    setFormEmoji(CAT_META.breakfast.emoji)
    setFormCat('breakfast')
    setFormServings('2')
    setFormPrep('15')
    setFormIngs([{ rid: newRid(), name: '', qty: '' }])
    setFormSteps('')
    setFormTags('')
    setConfirmDeleteId(null)
    setEditorOpen(true)
    window.setTimeout(() => nameRef.current?.focus(), 140)
  }

  const openEdit = (recipe: Recipe) => {
    setEditingId(recipe.id)
    setFormName(recipe.name)
    setFormEmoji(recipe.emoji || catOf(recipe.category).emoji)
    setFormCat(recipe.category)
    setFormServings(String(recipe.servings))
    setFormPrep(String(recipe.prepMin))
    setFormIngs(
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((i) => ({ rid: newRid(), name: i.name, qty: i.qty }))
        : [{ rid: newRid(), name: '', qty: '' }]
    )
    setFormSteps(recipe.steps.join('\n'))
    setFormTags(recipe.tags.join(', '))
    setConfirmDeleteId(null)
    setEditorOpen(true)
    window.setTimeout(() => nameRef.current?.focus(), 140)
  }

  const submitRecipe = () => {
    const name = formName.trim()
    if (!name) {
      toast({ title: 'Give the recipe a name first' })
      return
    }
    const ingredients: Ingredient[] = formIngs
      .map((i) => ({ name: i.name.trim(), qty: i.qty.trim() }))
      .filter((i) => i.name)
    const steps = formSteps
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const tags = [
      ...new Set(
        formTags
          .split(',')
          .map((t) => t.trim().replace(/^#/, '').toLowerCase())
          .filter(Boolean)
      ),
    ]
    const servings = Math.min(50, Math.max(1, Math.round(Number(formServings)) || 1))
    const prepMin = Math.min(600, Math.max(0, Math.round(Number(formPrep)) || 0))

    if (editingId) {
      const existing = recipes.find((r) => r.id === editingId)
      if (!existing) return
      const next: Recipe = {
        ...existing,
        name,
        emoji: formEmoji,
        category: formCat,
        servings,
        prepMin,
        ingredients,
        steps,
        tags,
        updatedAt: Date.now(),
      }
      upsertRecipe(next, false)
      toast({ title: 'Recipe updated', description: `${formEmoji} ${name}` })
    } else {
      const recipe: Recipe = {
        id: genId(),
        name,
        emoji: formEmoji,
        category: formCat,
        servings,
        prepMin,
        ingredients,
        steps,
        tags,
        createdAt: Date.now(),
      }
      upsertRecipe(recipe, true)
      toast({ title: 'Recipe saved', description: `${formEmoji} ${name}` })
    }
    setEditorOpen(false)
    buzz(12)
  }

  /* ---------------- cook mode actions ---------------- */
  const openCook = (recipe: Recipe) => {
    setCookId(recipe.id)
    setCookStep(0)
    setChecked(new Set())
    setConfirmDeleteId(null)
  }

  const toggleChecked = (idx: number) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
    buzz(12)
  }

  const finishCooking = () => {
    setCookId(null)
    buzz(18)
    toast({ title: 'Enjoy your meal! 🍽️', description: 'Nicely done, chef.' })
  }

  /* ---------------- planner actions ---------------- */
  const openSlot = (dayIdx: number, meal: MealId) => {
    setSlotTarget({ dayIdx, meal })
    setSlotQuery('')
  }

  const pickRecipeForSlot = (recipe: Recipe) => {
    if (!slotTarget) return
    const slot = `${slotTarget.dayIdx}-${slotTarget.meal}`
    setPlanned(slot, recipe.id)
    setSlotTarget(null)
    buzz(12)
    toast({
      title: 'Meal planned',
      description: `${recipe.emoji} ${recipe.name} · ${DAYS[slotTarget.dayIdx]} ${slotTarget.meal === 'lunch' ? 'lunch' : 'dinner'}`,
    })
  }

  const clearSlot = (slot: string, label: string) => {
    setPlanned(slot, null)
    buzz(12)
    toast({ title: 'Slot cleared', description: label })
  }

  const copyShopping = async () => {
    const ok = await copyText(shopping.text)
    if (ok) {
      buzz(12)
      toast({ title: 'Shopping list copied', description: `${shopping.lines.length} ingredients on the list` })
    } else {
      toast({ title: 'Copy failed', description: 'Your browser blocked clipboard access.' })
    }
  }

  /* ---------------- derived ---------------- */
  const recipeMap = useMemo(() => new Map(recipes.map((r) => [r.id, r])), [recipes])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...recipes]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((r) => {
        if (catFilter !== 'all' && r.category !== catFilter) return false
        if (!q) return true
        if (r.name.toLowerCase().includes(q)) return true
        if (r.tags.some((t) => t.includes(q))) return true
        if (r.ingredients.some((i) => i.name.toLowerCase().includes(q))) return true
        return false
      })
  }, [recipes, query, catFilter])

  const shopping = buildShoppingList(collectPlannedEntries(planner, recipeMap))

  const plannedCount = Object.keys(planner).length

  /* cook mode target */
  const cookRecipe = cookId ? recipeMap.get(cookId) ?? null : null
  const cookMeta = cookRecipe ? catOf(cookRecipe.category) : null
  const cookSteps = cookRecipe?.steps ?? []

  /* slot sheet helpers */
  const slotKey = slotTarget ? `${slotTarget.dayIdx}-${slotTarget.meal}` : ''
  const slotPlannedRecipe = slotTarget && planner[slotKey] ? recipeMap.get(planner[slotKey]) ?? null : null
  const slotCandidates = useMemo(() => {
    const q = slotQuery.trim().toLowerCase()
    return [...recipes]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((r) => (q ? r.name.toLowerCase().includes(q) || r.tags.some((t) => t.includes(q)) : true))
  }, [recipes, slotQuery])

  /* ================================================================== */
  /* Render                                                              */
  /* ================================================================== */

  return (
    <div className="mx-auto max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 text-zinc-100 shadow-[0_24px_60px_-24px_rgb(249_115_22/0.35)]"
      >
        {/* ---------------- Header ---------------- */}
        <div className="relative overflow-hidden border-b border-white/5 bg-gradient-to-br from-amber-500/[0.09] via-orange-500/[0.07] to-red-500/[0.05] px-5 py-5">
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-200 via-orange-400 to-red-500 text-white ring-1 ring-white/25 shadow-[0_14px_32px_-10px_rgb(249_115_22/0.7),inset_0_1px_1px_rgb(255_255_255/0.4)]">
              <ChefHat className="size-7" strokeWidth={1.9} aria-hidden />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold tracking-tight">Recipe Box</h2>
              <p className="text-xs text-zinc-400">Cook, plan your week and shop smarter — all on-device.</p>
            </div>
            <div className="shrink-0">
              <Button
                onClick={openNew}
                className="h-10 rounded-xl bg-gradient-to-r from-amber-200 via-orange-400 to-red-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-100 hover:via-orange-300 hover:to-red-400"
              >
                <Plus className="size-4" aria-hidden /> New
              </Button>
            </div>
          </div>

          {/* Tab switcher */}
          <div className="mt-5 flex rounded-2xl border border-white/10 bg-white/[0.04] p-1.5" role="radiogroup" aria-label="Section">
            {(
              [
                { id: 'recipes', label: 'Recipes', icon: ChefHat },
                { id: 'planner', label: 'Meal planner', icon: CalendarDays },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTab(t.id)
                  setConfirmDeleteId(null)
                }}
                role="radio"
                aria-checked={tab === t.id}
                className={cn(
                  'flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-bold transition-all',
                  tab === t.id
                    ? 'bg-gradient-to-r from-amber-200 via-orange-400 to-red-500 text-zinc-950 shadow-md'
                    : 'text-zinc-300 hover:bg-white/5'
                )}
              >
                <t.icon className="size-3.5" aria-hidden />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {!loaded ? (
          /* ---------------- Hydrating ---------------- */
          <div className="space-y-3 p-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/[0.05]" />
            ))}
          </div>
        ) : tab === 'recipes' ? (
          /* ================= RECIPES TAB ================= */
          <div className="space-y-4 p-4 sm:p-5">
            {/* Search */}
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 transition-colors focus-within:border-orange-400/50">
              <Search className="size-4 shrink-0 text-zinc-500" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, ingredient or tag"
                aria-label="Search recipes"
                enterKeyHint="search"
                className="h-11 w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              )}
            </div>

            {/* Category filter chips */}
            <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="radiogroup" aria-label="Filter by category">
              <button
                onClick={() => setCatFilter('all')}
                role="radio"
                aria-checked={catFilter === 'all'}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors',
                  catFilter === 'all'
                    ? 'border-orange-400/60 bg-orange-500/15 text-orange-300'
                    : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                )}
              >
                All
              </button>
              {CATS.map((c) => {
                const meta = CAT_META[c]
                const active = catFilter === c
                return (
                  <button
                    key={c}
                    onClick={() => setCatFilter(c)}
                    role="radio"
                    aria-checked={active}
                    style={active ? { backgroundColor: `${meta.hex}26`, color: meta.light, borderColor: `${meta.hex}66` } : undefined}
                    className={cn(
                      'flex h-9 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors',
                      !active && 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                    )}
                  >
                    <span aria-hidden>{meta.emoji}</span> {meta.name}
                  </button>
                )
              })}
            </div>

            {/* List header */}
            <div className="flex items-baseline justify-between">
              <p className="text-sm font-bold">
                {catFilter === 'all' ? 'All recipes' : `${CAT_META[catFilter].name} recipes`}
              </p>
              <p className="text-[11px] text-zinc-500">
                {recipes.length === 0 ? 'Box is empty' : `${filtered.length} of ${recipes.length}`}
              </p>
            </div>

            {recipes.length === 0 ? (
              /* ---------------- Empty: no recipes at all ---------------- */
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                <span className="text-5xl" aria-hidden>
                  🍳
                </span>
                <p className="text-sm font-semibold text-zinc-300">Your recipe box is empty</p>
                <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                  Save your favorite dishes with ingredients and step-by-step instructions — then cook them in
                  guided mode and plan your week. Everything stays on this device.
                </p>
                <Button
                  onClick={openNew}
                  className="mt-1 h-11 rounded-xl bg-gradient-to-r from-amber-200 via-orange-400 to-red-500 font-semibold text-zinc-950 hover:from-amber-100 hover:via-orange-300 hover:to-red-400"
                >
                  <Plus className="size-4" aria-hidden /> Add your first recipe
                </Button>
              </div>
            ) : filtered.length === 0 ? (
              /* ---------------- Empty: no search match ---------------- */
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-6 py-10 text-center">
                <Search className="size-8 text-zinc-600" aria-hidden />
                <p className="text-sm font-semibold text-zinc-300">No recipes match &ldquo;{query.trim()}&rdquo;</p>
                <p className="text-xs text-zinc-500">Try another name, ingredient or tag.</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery('')
                    setCatFilter('all')
                  }}
                  className="mt-1 h-9 rounded-xl border-white/15 bg-transparent text-xs font-semibold text-zinc-300 hover:bg-white/10 hover:text-white"
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              /* ---------------- Recipe cards ---------------- */
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1">
                <AnimatePresence initial={false}>
                  {filtered.map((r) => {
                    const meta = catOf(r.category)
                    const confirming = confirmDeleteId === r.id
                    return (
                      <motion.div
                        key={r.id}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
                        className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2.5"
                      >
                        <button
                          onClick={() => openCook(r)}
                          aria-label={`Cook ${r.name}`}
                          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
                        >
                          <span
                            className="flex size-12 shrink-0 items-center justify-center rounded-xl text-2xl"
                            style={{ backgroundColor: `${meta.hex}1f` }}
                            aria-hidden
                          >
                            {r.emoji || meta.emoji}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-zinc-100">{r.name}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                              <span
                                className="rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wide"
                                style={{ backgroundColor: `${meta.hex}22`, color: meta.light }}
                              >
                                {meta.name}
                              </span>
                              <span className="flex items-center gap-1">
                                <Users className="size-3" aria-hidden /> {r.servings}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="size-3" aria-hidden /> {r.prepMin}m
                              </span>
                              {r.tags.slice(0, 2).map((t) => (
                                <span key={t} className="rounded-md bg-white/5 px-1.5 py-px text-[9px] text-zinc-400">
                                  #{t}
                                </span>
                              ))}
                            </span>
                          </span>
                        </button>
                        <button
                          onClick={() => openEdit(r)}
                          aria-label={`Edit ${r.name}`}
                          className="flex size-8 shrink-0 items-center justify-center rounded-full text-zinc-600 transition-colors hover:bg-white/10 hover:text-zinc-200"
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </button>
                        <button
                          onClick={() => (confirming ? void removeRecipe(r.id) : setConfirmDeleteId(r.id))}
                          aria-label={confirming ? `Confirm delete ${r.name}` : `Delete ${r.name}`}
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
                            confirming
                              ? 'bg-rose-500 text-white'
                              : 'text-zinc-600 hover:bg-rose-500/15 hover:text-rose-300'
                          )}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </motion.div>
                    )
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        ) : (
          /* ================= PLANNER TAB ================= */
          <div className="space-y-4 p-4 sm:p-5">
            {/* Planner header */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold">This week</p>
                <p className="text-[11px] text-zinc-500">
                  {plannedCount === 0 ? 'No meals planned yet' : `${plannedCount} meal${plannedCount === 1 ? '' : 's'} planned`}
                </p>
              </div>
              <Button
                onClick={() => setShopOpen(true)}
                className="h-10 shrink-0 rounded-xl bg-gradient-to-r from-amber-200 via-orange-400 to-red-500 px-3 text-xs font-semibold text-zinc-950 shadow-lg hover:from-amber-100 hover:via-orange-300 hover:to-red-400"
              >
                <ShoppingCart className="size-4" aria-hidden /> Shopping list
              </Button>
            </div>

            {/* Week grid — 7 narrow columns, tap a slot to fill it */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5">
              {/* Day header row */}
              <div className="grid grid-cols-7 gap-1">
                {DAYS_SHORT.map((d, i) => (
                  <div
                    key={`${d}-${i}`}
                    className={cn(
                      'relative flex h-6 items-center justify-center text-[10px] font-bold uppercase tracking-wide',
                      i === todayIdx ? 'text-orange-300' : 'text-zinc-500'
                    )}
                  >
                    {d}
                    {i === todayIdx && (
                      <span
                        className="absolute bottom-0 h-0.5 w-4 rounded-full bg-gradient-to-r from-amber-300 to-red-500"
                        aria-hidden
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* One row per meal */}
              {MEALS.map((meal) => (
                <div key={meal.id}>
                  <p className="mb-1 mt-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    <span aria-hidden>{meal.emoji}</span> {meal.label}
                  </p>
                  <div className="grid grid-cols-7 gap-1">
                    {DAYS.map((day, d) => {
                      const slot = `${d}-${meal.id}`
                      const rid = planner[slot]
                      const planned = rid ? recipeMap.get(rid) ?? null : null
                      const isToday = d === todayIdx
                      return (
                        <button
                          key={slot}
                          onClick={() => openSlot(d, meal.id)}
                          aria-label={`${day} ${meal.label}${planned ? `: ${planned.name}` : ', empty — tap to plan'}`}
                          className={cn(
                            'flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg border transition-all active:scale-95 sm:h-14',
                            planned
                              ? 'border-white/10 bg-white/[0.05] hover:bg-white/[0.09]'
                              : 'border-dashed border-white/10 hover:border-white/25 hover:bg-white/[0.04]',
                            isToday && 'border-orange-400/50 bg-orange-500/[0.07]'
                          )}
                        >
                          {planned ? (
                            <>
                              <span className="text-base leading-none" aria-hidden>
                                {planned.emoji || catOf(planned.category).emoji}
                              </span>
                              <span className="hidden w-full truncate px-0.5 text-center text-[9px] leading-tight text-zinc-400 sm:block">
                                {planned.name}
                              </span>
                            </>
                          ) : (
                            <Plus className="size-4 text-zinc-600" aria-hidden />
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            {plannedCount === 0 ? (
              <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center text-xs leading-relaxed text-zinc-500">
                Tap any slot to plan a meal from your recipes — then hit{' '}
                <span className="font-semibold text-orange-300">Shopping list</span> to gather every ingredient in
                one tap.
              </p>
            ) : (
              <p className="px-1 text-center text-[11px] leading-relaxed text-zinc-600">
                {shopping.lines.length > 0
                  ? `${shopping.lines.length} unique ingredients across your planned meals.`
                  : 'Planned meals are missing recipes — tap a slot to fix them.'}
              </p>
            )}
          </div>
        )}
      </motion.div>

      {/* ---------------- Recipe editor modal ---------------- */}
      <AnimatePresence>
        {editorOpen && (
          <motion.div
            key="editor"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setEditorOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label={editingId ? 'Edit recipe' : 'New recipe'}
          >
            <motion.div
              initial={{ scale: 0.92, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 28 }}
              className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-orange-500/20 text-orange-300">
                  <ChefHat className="size-5" aria-hidden />
                </span>
                <h3 className="flex-1 text-sm font-bold">{editingId ? 'Edit recipe' : 'New recipe'}</h3>
                <button
                  onClick={() => setEditorOpen(false)}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              <div className="space-y-4">
                {/* name */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Name</p>
                  <input
                    ref={nameRef}
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRecipe()
                    }}
                    placeholder="e.g. Chicken Khichuri"
                    maxLength={60}
                    aria-label="Recipe name"
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm font-semibold text-zinc-100 placeholder:text-zinc-600 focus:border-orange-400/50 focus:outline-none"
                  />
                </div>

                {/* emoji */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Emoji</p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Recipe emoji">
                    {EMOJI_PALETTE.map((e) => (
                      <button
                        key={e}
                        onClick={() => setFormEmoji(e)}
                        role="radio"
                        aria-checked={formEmoji === e}
                        className={cn(
                          'flex size-10 items-center justify-center rounded-xl border text-lg transition-all',
                          formEmoji === e
                            ? 'border-orange-400/60 bg-orange-500/15 shadow-md'
                            : 'border-white/10 bg-white/5 hover:bg-white/10'
                        )}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>

                {/* category */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Category</p>
                  <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Category">
                    {CATS.map((c) => {
                      const meta = CAT_META[c]
                      const active = formCat === c
                      return (
                        <button
                          key={c}
                          onClick={() => setFormCat(c)}
                          role="radio"
                          aria-checked={active}
                          style={active ? { backgroundColor: `${meta.hex}26`, borderColor: `${meta.hex}66` } : undefined}
                          className={cn(
                            'flex flex-col items-center gap-0.5 rounded-xl border px-1 py-2 transition-all',
                            !active && 'border-white/10 bg-white/5 hover:bg-white/10'
                          )}
                        >
                          <span className="text-lg" aria-hidden>
                            {meta.emoji}
                          </span>
                          <span
                            className="w-full truncate text-center text-[9px] font-medium"
                            style={{ color: active ? meta.light : undefined }}
                          >
                            {meta.name}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* servings + prep */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Servings</p>
                    <input
                      value={formServings}
                      onChange={(e) => setFormServings(e.target.value.replace(/[^0-9]/g, ''))}
                      inputMode="numeric"
                      placeholder="2"
                      aria-label="Servings"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:border-orange-400/50 focus:outline-none"
                    />
                  </div>
                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Prep (min)
                    </p>
                    <input
                      value={formPrep}
                      onChange={(e) => setFormPrep(e.target.value.replace(/[^0-9]/g, ''))}
                      inputMode="numeric"
                      placeholder="15"
                      aria-label="Preparation minutes"
                      className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm font-semibold tabular-nums text-zinc-100 placeholder:text-zinc-600 focus:border-orange-400/50 focus:outline-none"
                    />
                  </div>
                </div>

                {/* ingredients */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Ingredients
                  </p>
                  <div className="space-y-1.5">
                    {formIngs.map((row) => (
                      <div key={row.rid} className="flex items-center gap-1.5">
                        <input
                          value={row.name}
                          onChange={(e) =>
                            setFormIngs((prev) => prev.map((r) => (r.rid === row.rid ? { ...r, name: e.target.value } : r)))
                          }
                          placeholder="Ingredient"
                          aria-label="Ingredient name"
                          className="h-10 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-orange-400/50 focus:outline-none"
                        />
                        <input
                          value={row.qty}
                          onChange={(e) =>
                            setFormIngs((prev) => prev.map((r) => (r.rid === row.rid ? { ...r, qty: e.target.value } : r)))
                          }
                          placeholder="Qty"
                          aria-label="Ingredient quantity"
                          className="h-10 w-20 shrink-0 rounded-xl border border-white/10 bg-white/5 px-2.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-orange-400/50 focus:outline-none"
                        />
                        <button
                          onClick={() => setFormIngs((prev) => prev.filter((r) => r.rid !== row.rid))}
                          aria-label={`Remove ingredient ${row.name || 'row'}`}
                          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => setFormIngs((prev) => [...prev, { rid: newRid(), name: '', qty: '' }])}
                    className="mt-1.5 h-10 w-full rounded-xl border border-dashed border-white/15 text-xs font-semibold text-zinc-400 transition-colors hover:border-orange-400/40 hover:text-orange-300"
                  >
                    + Add ingredient
                  </button>
                </div>

                {/* steps */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Steps <span className="font-normal normal-case text-zinc-600">(one per line)</span>
                  </p>
                  <textarea
                    value={formSteps}
                    onChange={(e) => setFormSteps(e.target.value)}
                    rows={6}
                    placeholder={'Heat oil in a wok…\nAdd onions and fry until golden…'}
                    aria-label="Cooking steps, one per line"
                    className="w-full resize-y rounded-xl border border-white/10 bg-white/5 p-3 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-orange-400/50 focus:outline-none"
                  />
                </div>

                {/* tags */}
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Tags <span className="font-normal normal-case text-zinc-600">(comma separated, optional)</span>
                  </p>
                  <input
                    value={formTags}
                    onChange={(e) => setFormTags(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRecipe()
                    }}
                    placeholder="quick, one-pot, healthy"
                    aria-label="Tags"
                    className="h-11 w-full rounded-xl border border-white/10 bg-white/5 px-3.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-orange-400/50 focus:outline-none"
                  />
                </div>

                <Button
                  onClick={submitRecipe}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-amber-200 via-orange-400 to-red-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-100 hover:via-orange-300 hover:to-red-400"
                >
                  {editingId ? 'Save changes' : 'Save recipe'}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Cook mode (full screen) ---------------- */}
      <AnimatePresence>
        {cookRecipe && cookMeta && (
          <motion.div
            key="cook"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-zinc-100"
            role="dialog"
            aria-modal="true"
            aria-label={`Cook mode — ${cookRecipe.name}`}
          >
            {/* warm ambient glow */}
            <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-orange-500/[0.08] to-transparent" aria-hidden />

            {/* Cook header */}
            <div className="relative border-b border-white/5 px-4 py-3.5">
              <div className="mx-auto flex max-w-md items-center gap-3">
                <button
                  onClick={() => setCookId(null)}
                  aria-label="Exit cook mode"
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <ArrowLeft className="size-4.5" aria-hidden />
                </button>
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl text-2xl"
                  style={{ backgroundColor: `${cookMeta.hex}1f` }}
                  aria-hidden
                >
                  {cookRecipe.emoji || cookMeta.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{cookRecipe.name}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Users className="size-3" aria-hidden /> {cookRecipe.servings} servings
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" aria-hidden /> {cookRecipe.prepMin} min
                    </span>
                  </p>
                </div>
                {checked.size > 0 && (
                  <button
                    onClick={() => setChecked(new Set())}
                    aria-label="Reset ingredient check-offs"
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                  >
                    <RotateCcw className="size-4" aria-hidden />
                  </button>
                )}
                <button
                  onClick={() => {
                    const r = cookRecipe
                    setCookId(null)
                    openEdit(r)
                  }}
                  aria-label={`Edit ${cookRecipe.name}`}
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
              </div>
              {cookRecipe.tags.length > 0 && (
                <div className="mx-auto mt-2.5 flex max-w-md flex-wrap gap-1.5">
                  {cookRecipe.tags.map((t) => (
                    <span key={t} className="rounded-md bg-white/5 px-1.5 py-0.5 text-[9px] font-medium text-zinc-400">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Cook body */}
            <div className="relative flex-1 overflow-y-auto px-4 py-4">
              <div className="mx-auto max-w-md space-y-6">
                {/* Ingredients — tap to strike off */}
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-bold">Ingredients</p>
                    <p className="text-[11px] text-zinc-500">
                      {checked.size}/{cookRecipe.ingredients.length} ready
                    </p>
                  </div>
                  {cookRecipe.ingredients.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-center text-xs text-zinc-500">
                      No ingredients listed — edit this recipe to add them.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {cookRecipe.ingredients.map((ing, i) => {
                        const done = checked.has(i)
                        return (
                          <button
                            key={`${ing.name}-${i}`}
                            onClick={() => toggleChecked(i)}
                            aria-pressed={done}
                            aria-label={`${done ? 'Uncheck' : 'Check off'} ${ing.name}`}
                            className={cn(
                              'flex min-h-[44px] w-full items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors',
                              done ? 'border-white/5 bg-white/[0.02]' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.07]'
                            )}
                          >
                            <span
                              className={cn(
                                'flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-all',
                                done ? 'border-transparent bg-gradient-to-br from-amber-300 to-red-500' : 'border-white/20'
                              )}
                              aria-hidden
                            >
                              {done && <Check className="size-3.5 text-zinc-950" strokeWidth={3.5} />}
                            </span>
                            <span
                              className={cn(
                                'min-w-0 flex-1 truncate text-sm transition-colors',
                                done ? 'text-zinc-500 line-through' : 'font-medium text-zinc-100'
                              )}
                            >
                              {ing.name}
                            </span>
                            {ing.qty && (
                              <span
                                className={cn(
                                  'shrink-0 text-xs tabular-nums transition-colors',
                                  done ? 'text-zinc-600 line-through' : 'text-zinc-500'
                                )}
                              >
                                {ing.qty}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>

                {/* Steps — one at a time */}
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-bold">Instructions</p>
                    {cookSteps.length > 0 && (
                      <p className="text-[11px] font-semibold text-orange-300">
                        Step {cookStep + 1} of {cookSteps.length}
                      </p>
                    )}
                  </div>

                  {cookSteps.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center">
                      <ChefHat className="mx-auto size-8 text-zinc-600" aria-hidden />
                      <p className="mt-2 text-xs text-zinc-500">
                        No steps yet — tap the pencil above to add instructions.
                      </p>
                    </div>
                  ) : (
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.div
                        key={cookStep}
                        initial={{ opacity: 0, x: 28 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -28 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                        className="rounded-2xl border border-white/10 bg-gradient-to-br from-orange-500/[0.09] to-red-500/[0.05] p-5"
                      >
                        <span className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-amber-200 via-orange-400 to-red-500 text-sm font-black text-zinc-950 shadow-md">
                          {cookStep + 1}
                        </span>
                        <p className="mt-3.5 text-lg font-medium leading-relaxed text-zinc-100">
                          {cookSteps[cookStep]}
                        </p>
                      </motion.div>
                    </AnimatePresence>
                  )}
                </section>
              </div>
            </div>

            {/* Cook footer — progress + nav */}
            {cookSteps.length > 0 && (
              <div className="relative border-t border-white/10 bg-zinc-950/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
                <div className="mx-auto max-w-md">
                  <div
                    className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]"
                    role="progressbar"
                    aria-valuenow={Math.round(((cookStep + 1) / cookSteps.length) * 100)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Recipe progress"
                  >
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-amber-300 via-orange-400 to-red-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${((cookStep + 1) / cookSteps.length) * 100}%` }}
                      transition={{ type: 'spring', stiffness: 120, damping: 24 }}
                    />
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setCookStep((s) => Math.max(0, s - 1))}
                      disabled={cookStep === 0}
                      className="flex h-12 flex-1 items-center justify-center gap-1 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40"
                    >
                      <ChevronLeft className="size-4" aria-hidden /> Prev
                    </button>
                    <button
                      onClick={() =>
                        cookStep >= cookSteps.length - 1 ? finishCooking() : setCookStep((s) => s + 1)
                      }
                      className="flex h-12 flex-[1.7] items-center justify-center gap-1 rounded-xl bg-gradient-to-r from-amber-200 via-orange-400 to-red-500 text-sm font-bold text-zinc-950 shadow-lg transition-transform active:scale-[0.98] hover:brightness-110"
                    >
                      {cookStep >= cookSteps.length - 1 ? (
                        'Finish 🍽️'
                      ) : (
                        <>
                          Next step <ChevronRight className="size-4" aria-hidden />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Slot picker bottom sheet ---------------- */}
      <AnimatePresence>
        {slotTarget && (
          <motion.div
            key="slot-picker"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setSlotTarget(null)
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Choose a recipe for ${DAYS[slotTarget.dayIdx]} ${slotTarget.meal}`}
          >
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-t-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl sm:rounded-3xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-orange-500/20 text-orange-300">
                  <CalendarDays className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold">
                    {DAYS[slotTarget.dayIdx]} · {slotTarget.meal === 'lunch' ? 'Lunch' : 'Dinner'}
                  </h3>
                  <p className="text-[11px] text-zinc-500">Pick a recipe for this slot</p>
                </div>
                <button
                  onClick={() => setSlotTarget(null)}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              {/* current slot occupant + clear */}
              {slotPlannedRecipe && (
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-orange-400/30 bg-orange-500/[0.08] p-2.5">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl text-xl"
                    style={{ backgroundColor: `${catOf(slotPlannedRecipe.category).hex}1f` }}
                    aria-hidden
                  >
                    {slotPlannedRecipe.emoji || catOf(slotPlannedRecipe.category).emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{slotPlannedRecipe.name}</p>
                    <p className="text-[11px] text-zinc-500">Currently planned here</p>
                  </div>
                  <button
                    onClick={() => clearSlot(slotKey, `${DAYS[slotTarget.dayIdx]} ${slotTarget.meal === 'lunch' ? 'lunch' : 'dinner'}`)}
                    className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-rose-400/30 bg-rose-500/10 px-3 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/20"
                  >
                    <Trash2 className="size-3.5" aria-hidden /> Clear
                  </button>
                </div>
              )}

              {/* mini filter */}
              {recipes.length > 5 && (
                <div className="mb-2.5 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 transition-colors focus-within:border-orange-400/50">
                  <Search className="size-3.5 shrink-0 text-zinc-500" aria-hidden />
                  <input
                    value={slotQuery}
                    onChange={(e) => setSlotQuery(e.target.value)}
                    placeholder="Filter recipes"
                    aria-label="Filter recipes"
                    className="h-10 w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                  />
                </div>
              )}

              {/* recipe candidates */}
              {recipes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs leading-relaxed text-zinc-500">
                  No recipes yet — create one in the Recipes tab first.
                </p>
              ) : slotCandidates.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-zinc-500">
                  Nothing matches &ldquo;{slotQuery.trim()}&rdquo;.
                </p>
              ) : (
                <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {slotCandidates.map((r) => {
                    const meta = catOf(r.category)
                    const isCurrent = planner[slotKey] === r.id
                    return (
                      <button
                        key={r.id}
                        onClick={() => pickRecipeForSlot(r)}
                        className="flex min-h-[56px] w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5 text-left transition-colors hover:bg-white/[0.07]"
                      >
                        <span
                          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-xl"
                          style={{ backgroundColor: `${meta.hex}1f` }}
                          aria-hidden
                        >
                          {r.emoji || meta.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-zinc-100">{r.name}</span>
                          <span className="text-[11px] text-zinc-500">
                            {meta.name} · {r.servings} servings · {r.prepMin} min
                          </span>
                        </span>
                        {isCurrent && (
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-red-500" aria-label="Currently in this slot">
                            <Check className="size-3.5 text-zinc-950" strokeWidth={3.5} aria-hidden />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Shopping list bottom sheet ---------------- */}
      <AnimatePresence>
        {shopOpen && (
          <motion.div
            key="shopping"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShopOpen(false)
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Shopping list"
          >
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="w-full max-w-sm rounded-t-3xl border border-white/10 bg-zinc-950 p-5 text-zinc-100 shadow-2xl sm:rounded-3xl"
            >
              <div className="mb-4 flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-orange-500/20 text-orange-300">
                  <ShoppingCart className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold">Shopping list</h3>
                  <p className="text-[11px] text-zinc-500">
                    {shopping.recipeCount === 0
                      ? 'Nothing planned yet'
                      : `From ${shopping.recipeCount} planned recipe${shopping.recipeCount === 1 ? '' : 's'} · ${shopping.lines.length} ingredients`}
                  </p>
                </div>
                <button
                  onClick={() => setShopOpen(false)}
                  aria-label="Close"
                  className="flex size-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>

              {shopping.lines.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs leading-relaxed text-zinc-500">
                  Plan some meals in the week grid and every ingredient from those recipes gathers here
                  automatically.
                </p>
              ) : (
                <>
                  <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-white/[0.03] p-3.5 font-sans text-sm leading-relaxed text-zinc-200">
                    {shopping.text}
                  </pre>
                  <Button
                    onClick={() => void copyShopping()}
                    className="mt-3 h-11 w-full rounded-xl bg-gradient-to-r from-amber-200 via-orange-400 to-red-500 font-semibold text-zinc-950 shadow-lg hover:from-amber-100 hover:via-orange-300 hover:to-red-400"
                  >
                    <Copy className="size-4" aria-hidden /> Copy list
                  </Button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
