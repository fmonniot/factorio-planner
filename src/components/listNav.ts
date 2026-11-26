import type React from 'react'
import { slotsOf } from './gridNav'

export type ListKey = 'ArrowUp' | 'ArrowDown' | 'Home' | 'End'

export interface ListNavOptions {
  /** ArrowUp on the first item goes to the last, ArrowDown on the last to the first. Default false. */
  wrap?: boolean
  /** Runs on ArrowUp from the first item (takes precedence over `wrap`). */
  onTopEdge?: () => void
  /** Runs on ArrowDown from the last item (takes precedence over `wrap`). */
  onBottomEdge?: () => void
}

const LIST_KEYS: readonly string[] = ['ArrowUp', 'ArrowDown', 'Home', 'End']

/**
 * The index a list key moves to, or null when focus stays put.
 * `from` = -1 means focus is not on an item: Down and Home go to the first, Up and End to the last.
 */
export function listNavTarget(count: number, from: number, key: ListKey, wrap: boolean): number | null {
  if (count <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (from < 0) return key === 'ArrowDown' ? 0 : count - 1
  if (key === 'ArrowDown') return from + 1 < count ? from + 1 : wrap ? 0 : null
  return from > 0 ? from - 1 : wrap ? count - 1 : null
}

/** Moves focus among `items` (DOM order). Returns true when the key was handled, so the caller prevents its default. */
export function stepListFocus(items: readonly HTMLElement[], active: Element | null, key: string, opts: ListNavOptions = {}): boolean {
  if (!LIST_KEYS.includes(key) || items.length === 0) return false
  const from = active ? items.findIndex(el => el === active) : -1
  if (from === 0 && key === 'ArrowUp' && opts.onTopEdge) {
    opts.onTopEdge()
    return true
  }
  if (from === items.length - 1 && key === 'ArrowDown' && opts.onBottomEdge) {
    opts.onBottomEdge()
    return true
  }
  const target = listNavTarget(items.length, from, key as ListKey, opts.wrap ?? false)
  if (target !== null) items[target].focus()
  return true
}

/**
 * Keydown handler for the element holding a list of items matching `selector`: Up, Down, Home and End move focus.
 * Ignores keys with a modifier held (Alt+Arrow reorders in the Sources list), handled keys and targets outside an item.
 */
export function moveListFocus(e: React.KeyboardEvent<HTMLElement>, selector: string, opts?: ListNavOptions): void {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
  if (!LIST_KEYS.includes(e.key)) return
  const origin = (e.target as HTMLElement).closest<HTMLElement>(selector)
  if (!origin || !e.currentTarget.contains(origin)) return
  const items = slotsOf(e.currentTarget, selector)
  if (!items.includes(origin)) return
  if (stepListFocus(items, origin, e.key, opts)) e.preventDefault()
}

/** The item a list is entered at: the current one (aria-current or aria-checked), else the first. */
export function entryItem(items: readonly HTMLElement[]): HTMLElement | undefined {
  return items.find(el => el.getAttribute('aria-current') === 'true' || el.getAttribute('aria-checked') === 'true') ?? items[0]
}

/**
 * Focuses `target` when it is still in the document and focus is inside `panel` or nowhere (on the body).
 * Call before the overlay unmounts; a press that moved focus elsewhere keeps it.
 */
export function giveFocusBack(panel: HTMLElement | null, target: HTMLElement | null): void {
  if (!target || !target.isConnected) return
  const active = document.activeElement
  if (active === null || active === document.body || (panel !== null && panel.contains(active))) target.focus()
}

/**
 * Tab and Shift+Tab in a popover list: focus goes back to `trigger` and the overlay closes, and the key's default is kept,
 * so the browser carries on from the trigger instead of leaving the list open behind. Call from the panel's keydown handler.
 */
export function closeOnTab(e: React.KeyboardEvent, trigger: HTMLElement | null | undefined, onClose: () => void): void {
  if (e.key !== 'Tab' || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
  if (trigger?.isConnected) trigger.focus()
  onClose()
}
