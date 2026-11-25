'use client'

import { useEffect } from 'react'
import { sanitizePastedText } from '@/lib/input-hardening'

/**
 * PasteSanitizer — P9-W6. Invisible shell-level component that guards
 * EVERY text entry point on the platform from a single document-level
 * capture listener: whenever text is pasted into an <input>, <textarea>
 * or contentEditable, it is stripped of control/bidi/zero-width
 * characters, newline-normalized (single-line fields get spaces), and
 * clamped to the field's maxLength — before any app code sees it.
 *
 * Pasting clean text (the common case) is a no-op: the native paste
 * proceeds untouched, preserving undo stacks and IME behavior. Only
 * dirty pastes are rewritten via insertText / native value setter so
 * React controlled inputs stay perfectly in sync.
 *
 * Mount exactly once, at the root of the OS shell (next to
 * GlobalErrorTelemetry). All 90 apps + Admin Console + Spotlight are
 * covered automatically.
 */

/** Input types whose value is not plain user text — pasting into them is native behavior. */
const SKIP_INPUT_TYPES = new Set([
  'password',
  'number',
  'range',
  'color',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'file',
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'hidden',
])

type TextField = HTMLInputElement | HTMLTextAreaElement

function isGuardedTarget(el: HTMLElement): el is TextField {
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase()
    return !SKIP_INPUT_TYPES.has(type)
  }
  return false
}

/** Room left under the field's maxLength guard (undefined = unlimited). */
function pasteRoom(el: TextField, replacing: number): number | undefined {
  const max = el.maxLength
  if (max < 0) return undefined /* -1 = no maxLength attribute */
  return Math.max(0, max - (el.value.length - replacing))
}

/** Replace the field's current selection with `clean`, keeping React in sync. */
function insertIntoField(el: TextField, clean: string): void {
  let ok = false
  try {
    ok = document.execCommand('insertText', false, clean)
  } catch {
    ok = false
  }
  if (ok) return

  /* fallback: native value setter + input event (React reads it) */
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const next = el.value.slice(0, start) + clean + el.value.slice(end)
  const proto =
    el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, next)
  else el.value = next
  try {
    el.selectionStart = el.selectionEnd = start + clean.length
  } catch {
    /* some input types disallow selection — ignore */
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Replace the contentEditable selection with plain sanitized text. */
function insertIntoEditable(clean: string): boolean {
  try {
    if (document.execCommand('insertText', false, clean)) return true
  } catch {
    /* fall through */
  }
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return false
  const range = sel.getRangeAt(0)
  range.deleteContents()
  range.insertNode(document.createTextNode(clean))
  range.collapse(false)
  return true
}

export function PasteSanitizer() {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target
      if (!(target instanceof HTMLElement)) return

      const raw = e.clipboardData?.getData('text/plain')
      if (!raw) return

      if (isGuardedTarget(target)) {
        const el = target
        const multiline = el.tagName === 'TEXTAREA'
        const replacing = (el.selectionEnd ?? 0) - (el.selectionStart ?? 0)
        const clean = sanitizePastedText(raw, {
          multiline,
          maxChars: pasteRoom(el, replacing),
        })
        if (clean === raw) return /* already clean — native paste */
        e.preventDefault()
        insertIntoField(el, clean)
        return
      }

      if (target.isContentEditable) {
        const clean = sanitizePastedText(raw, { multiline: true })
        if (clean === raw) return
        e.preventDefault()
        insertIntoEditable(clean)
      }
    }

    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
  }, [])

  return null
}
