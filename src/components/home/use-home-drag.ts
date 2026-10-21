'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Native-feeling home-screen drag engine (pointer events based).
 *
 * Flow:
 *  1. Long-press (≈420 ms) on an icon enters edit mode (jiggle) + haptic tick.
 *  2. While editing, moving a pressed icon >6 px starts a drag — a floating
 *     ghost follows the finger (direct DOM transforms, zero re-renders).
 *  3. Hovering another slot live-shifts the grid (store reorder + FLIP).
 *  4. Hovering directly over another icon marks it as a folder-drop target.
 *  5. Drop → folder create / add / merge is resolved by the caller.
 *  6. Holding the ghost near a screen edge flips pages automatically.
 *
 * The hook never touches React state per-move; it only stores
 * `{ draggingId, overId }` — everything else is imperative.
 */

export interface HomeDragParams {
  /** horizontal page scroller element */
  scrollerRef: React.RefObject<HTMLDivElement | null>
  /** page index → grid element */
  gridEls: React.RefObject<Map<number, HTMLDivElement>>
  /** latest metrics, read through a ref internally */
  getMetrics: () => { cols: number; capacity: number; itemCount: number; pageCount: number }
  /** is edit (jiggle) mode currently active */
  isEditing: () => boolean
  /** long-press detected → caller enters edit mode */
  onEnterEdit: () => void
  /** live reorder: move dragged item from one slot to another */
  onMove: (from: number, to: number) => void
  /** dropped on another item (or null for a plain slot drop) */
  onDrop: (draggedId: string, overId: string | null) => void
  /** smooth-scroll to a page (edge page-flips) */
  scrollToPage: (index: number) => void
}

export interface HomeDragView {
  /** id of the item currently being dragged (ghost content) */
  draggingId: string | null
  /** id of the item currently hovered as a folder-drop target */
  overId: string | null
}

const LONG_PRESS_MS = 420
const MOVE_START_PX = 6
const PRESS_CANCEL_PX = 12
const EDGE_PX = 30
const EDGE_INTERVAL_MS = 620

export function useHomeDrag(params: HomeDragParams) {
  const paramsRef = useRef(params)
  useEffect(() => {
    paramsRef.current = params
  })

  const [view, setView] = useState<HomeDragView>({ draggingId: null, overId: null })

  const ghostRef = useRef<HTMLDivElement | null>(null)
  const suppressClickRef = useRef(false)
  const acRef = useRef<AbortController | null>(null)
  /** true while a gesture is armed for dragging (edit mode) — used by items
   *  to cancel browser scrolling via non-passive touchmove listeners */
  const armedRef = useRef(false)

  const st = useRef({
    pressing: false,
    armed: false, // edit mode already active → immediate drag on move
    dragging: false,
    pointerId: -1,
    dragId: '',
    dragIndex: -1,
    startX: 0,
    startY: 0,
    offX: 0,
    offY: 0,
    lastX: 0,
    lastY: 0,
    w: 0,
    h: 0,
    pressTimer: 0 as ReturnType<typeof setTimeout> | 0,
    raf: 0,
    edge: 0,
    edgeTimer: 0 as ReturnType<typeof setInterval> | 0,
    overId: null as string | null,
  })

  /* ---------------- haptics ---------------- */
  const haptic = useCallback((ms: number) => {
    try {
      navigator.vibrate?.(ms)
    } catch {
      /* unsupported */
    }
  }, [])

  /* ---------------- listener plumbing (AbortController) ------------- */
  const removeListeners = useCallback(() => {
    acRef.current?.abort()
    acRef.current = null
  }, [])

  const addListeners = useCallback(
    (move: (e: PointerEvent) => void, up: (e: PointerEvent) => void) => {
      removeListeners()
      const ac = new AbortController()
      acRef.current = ac
      window.addEventListener('pointermove', move, { signal: ac.signal })
      window.addEventListener('pointerup', up, { signal: ac.signal })
      window.addEventListener('pointercancel', up, { signal: ac.signal })
    },
    [removeListeners]
  )

  /* ---------------- ghost painting ---------------- */
  const paintGhost = useCallback((x: number, y: number, scale = 1.12) => {
    const g = ghostRef.current
    if (!g) return
    const s = st.current
    g.style.width = `${s.w}px`
    g.style.height = `${s.h}px`
    g.style.transform = `translate3d(${x - s.offX}px, ${y - s.offY}px, 0) scale(${scale})`
  }, [])

  /* ---------------- slot + over-item detection ---------------- */
  const computeTargets = useCallback(() => {
    const s = st.current
    if (!s.dragging) return
    const p = paramsRef.current
    const scroller = p.scrollerRef.current
    if (!scroller) return

    const { capacity, itemCount, pageCount } = p.getMetrics()
    if (itemCount === 0) return

    const rect = scroller.getBoundingClientRect()
    const x = s.lastX
    const y = s.lastY

    // --- page flip while hovering the edges -----------------------
    const edge = x < rect.left + EDGE_PX ? -1 : x > rect.right - EDGE_PX ? 1 : 0
    if (edge !== s.edge) {
      s.edge = edge
      if (s.edgeTimer) {
        clearInterval(s.edgeTimer)
        s.edgeTimer = 0
      }
      if (edge !== 0) {
        s.edgeTimer = setInterval(() => {
          const sc = paramsRef.current.scrollerRef.current
          if (!sc) return
          const { pageCount: pc } = paramsRef.current.getMetrics()
          const cur = Math.round(sc.scrollLeft / Math.max(1, sc.clientWidth))
          const next = Math.min(pc - 1, Math.max(0, cur + edge))
          if (next !== cur) paramsRef.current.scrollToPage(next)
        }, EDGE_INTERVAL_MS)
      }
    }

    // --- which page & slot is under the pointer -------------------
    const absX = x - rect.left + scroller.scrollLeft
    const page = Math.min(
      pageCount - 1,
      Math.max(0, Math.floor(absX / Math.max(1, scroller.clientWidth)))
    )
    const grid = p.gridEls.current?.get(page)
    if (!grid) return

    const kids = Array.from(grid.children) as HTMLElement[]
    if (kids.length === 0) return

    // --- folder-drop hit test (directly over another icon) -----------
    // iOS-style hysteresis: while the pointer rides a tile, the grid is
    // frozen (no live reorder) and the tile becomes the folder target.
    // This avoids the dragged node sliding under the pointer forever.
    let over: string | null = null
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]
      if (k.dataset.itemId === s.dragId) continue
      const tile = k.querySelector('[data-tile-id]') as HTMLElement | null
      if (!tile) continue
      const r = tile.getBoundingClientRect()
      const pad = Math.max(3, r.width * 0.06)
      if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) {
        over = tile.getAttribute('data-tile-id')
        break
      }
    }
    if (over !== s.overId) {
      s.overId = over
      setView((v) => ({ ...v, overId: over }))
    }

    // --- live reorder (only when NOT hovering another icon) --------
    if (over) return

    // nearest child center = target slot (robust across gaps/padding)
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < kids.length; i++) {
      const r = kids[i].getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const d = (x - cx) * (x - cx) + (y - cy) * (y - cy)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    let slot = page * capacity + best
    if (slot > itemCount - 1) slot = itemCount - 1
    if (slot !== s.dragIndex && s.dragIndex >= 0) {
      const from = s.dragIndex
      s.dragIndex = slot
      p.onMove(from, slot)
    }
  }, [])

  const onRafMove = useCallback(() => {
    const s = st.current
    s.raf = 0
    paintGhost(s.lastX, s.lastY)
    computeTargets()
  }, [computeTargets, paintGhost])

  /* ---------------- gesture teardown ---------------- */
  const endPress = useCallback(() => {
    const s = st.current
    if (s.pressTimer) {
      clearTimeout(s.pressTimer)
      s.pressTimer = 0
    }
    if (s.edgeTimer) {
      clearInterval(s.edgeTimer)
      s.edgeTimer = 0
    }
    s.edge = 0
  }, [])

  const finishDrag = useCallback(
    (fire: boolean) => {
      const s = st.current
      if (!s.dragging) return
      s.dragging = false
      endPress()
      const g = ghostRef.current
      if (g) g.style.transform = 'translate3d(-9999px, -9999px, 0)'
      const dragId = s.dragId
      const overId = s.overId
      s.overId = null
      s.dragId = ''
      s.dragIndex = -1
      setView({ draggingId: null, overId: null })
      if (fire) {
        paramsRef.current.onDrop(dragId, overId)
      }
      // swallow the click that follows pointerup after a drag
      suppressClickRef.current = true
      setTimeout(() => {
        suppressClickRef.current = false
      }, 140)
    },
    [endPress]
  )

  const onWindowMove = useCallback(
    (e: PointerEvent) => {
      const s = st.current
      if (!s.pressing || e.pointerId !== s.pointerId) return
      const dx = e.clientX - s.startX
      const dy = e.clientY - s.startY
      const dist = Math.hypot(dx, dy)

      if (!s.dragging) {
        // waiting on the long-press timer → this is a scroll gesture
        if (!s.armed && dist > PRESS_CANCEL_PX) {
          endPress()
          removeListeners()
          return
        }
        if (s.armed && dist > MOVE_START_PX) {
          // start the drag
          const node = document.querySelector(
            `[data-item-id="${CSS.escape(s.dragId)}"]`
          ) as HTMLElement | null
          if (!node) return
          const r = node.getBoundingClientRect()
          s.dragging = true
          s.w = r.width
          s.h = r.height
          s.offX = r.width / 2
          s.offY = r.height * 0.42
          s.dragIndex = Number(node.dataset.itemIndex ?? -1)
          paintGhost(e.clientX, e.clientY, 1)
          haptic(10)
          setView((v) => ({ ...v, draggingId: s.dragId }))
          // fall through — this same event must also schedule slot detection
        } else {
          return
        }
      }

      s.lastX = e.clientX
      s.lastY = e.clientY
      if (!s.raf) s.raf = requestAnimationFrame(onRafMove)
    },
    [endPress, haptic, onRafMove, paintGhost, removeListeners]
  )

  const onWindowUp = useCallback(
    (e: PointerEvent) => {
      const s = st.current
      if (e.pointerId !== s.pointerId) return
      const wasDragging = s.dragging
      endPress()
      removeListeners()
      if (wasDragging) finishDrag(true)
      s.pressing = false
      s.armed = false
      armedRef.current = false
    },
    [endPress, finishDrag, removeListeners]
  )

  /* ---------------- item handlers ---------------- */
  const onItemPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, itemId: string) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const s = st.current
      if (s.pressing) return

      s.pressing = true
      s.armed = paramsRef.current.isEditing()
      armedRef.current = s.armed
      s.pointerId = e.pointerId
      s.dragId = itemId
      s.dragIndex = Number((e.currentTarget as HTMLElement).dataset.itemIndex ?? -1)
      s.startX = e.clientX
      s.startY = e.clientY
      s.lastX = e.clientX
      s.lastY = e.clientY
      s.overId = null

      addListeners(onWindowMove, onWindowUp)

      if (!s.armed) {
        s.pressTimer = setTimeout(() => {
          s.pressTimer = 0
          s.armed = true
          armedRef.current = true
          haptic(18)
          paramsRef.current.onEnterEdit()
        }, LONG_PRESS_MS)
      }
    },
    [addListeners, haptic, onWindowMove, onWindowUp]
  )

  /** True when the trailing click after a drag should be swallowed. */
  const shouldSuppressClick = useCallback(() => suppressClickRef.current, [])

  useEffect(() => {
    return () => {
      const s = st.current
      if (s.pressTimer) clearTimeout(s.pressTimer)
      if (s.edgeTimer) clearInterval(s.edgeTimer)
      if (s.raf) cancelAnimationFrame(s.raf)
      removeListeners()
    }
  }, [removeListeners])

  return { view, ghostRef, onItemPointerDown, shouldSuppressClick, armedRef }
}
