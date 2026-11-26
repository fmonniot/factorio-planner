import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { ITEM_SELECTOR } from '../MenuButton'
import { gridNavTarget, type GridKey } from '../gridNav'
import { entryItem, giveFocusBack, stepListFocus } from '../listNav'

export interface MenuKeyboardOptions {
  /** CSS selector of the menu items that form a 2-D grid (the block colour swatches); all other items are a one-column list. */
  grid?: string
}

const ARROWS: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

/**
 * Keyboard navigation of a portalled context menu (`role="menu"` with `menuitem*` buttons) that does not take focus when it opens.
 * The first ArrowDown enters it at the first item, the first ArrowUp at the last; Up, Down, Home and End then walk the enabled
 * items and wrap. With `grid`, the items matching it form a 2-D grid after the list: Down from the last list item enters it
 * (at the checked cell, else the first), Left / Right / Up / Down move inside it, and Up from its first row returns to the list.
 * Tab closes the menu and lets the browser carry on from where focus goes back to; closing gives focus back to where it was.
 * Esc stays with the menu's own handler.
 */
export function useMenuKeyboard(ref: RefObject<HTMLElement | null>, onClose: () => void, opts: MenuKeyboardOptions = {}): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  const grid = opts.grid
  const origin = useRef<Element | null>(null)

  useLayoutEffect(() => {
    const panel = ref.current
    origin.current = document.activeElement
    return () => giveFocusBack(panel, origin.current instanceof HTMLElement ? origin.current : null)
  }, [ref])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const panel = ref.current
      if (!panel || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      if (e.key === 'Tab') {
        giveFocusBack(panel, origin.current instanceof HTMLElement ? origin.current : null)
        onCloseRef.current()
        return
      }
      const items = Array.from(panel.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
      const active = document.activeElement
      const handled = grid ? stepGrid(items, grid, active, e.key) : stepListFocus(items, active, e.key, { wrap: true })
      if (handled) e.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [ref, grid])
}

/** The walk of a menu whose items end in a grid. Returns true when the key was handled. */
function stepGrid(items: readonly HTMLElement[], gridSelector: string, active: Element | null, key: string): boolean {
  if (![...ARROWS, 'Home', 'End'].includes(key)) return false
  const list = items.filter(el => !el.matches(gridSelector))
  const cells = items.filter(el => el.matches(gridSelector))
  const inCell = cells.findIndex(el => el === active)
  const inList = list.findIndex(el => el === active)
  const lastCell = cells[cells.length - 1]
  if (key === 'Home') { (list[0] ?? cells[0])?.focus(); return true }
  if (key === 'End') { (lastCell ?? list[list.length - 1])?.focus(); return true }
  if (inCell >= 0) {
    const target = gridNavTarget(cells.map(c => c.getBoundingClientRect()), inCell, key as GridKey)
    if (target !== null) cells[target].focus()
    else if (key === 'ArrowUp') (list[list.length - 1] ?? cells[inCell]).focus()
    else if (key === 'ArrowDown') (list[0] ?? cells[inCell]).focus()
    return true
  }
  if (key === 'ArrowLeft' || key === 'ArrowRight') return false
  if (key === 'ArrowDown') {
    if (inList >= 0 && inList < list.length - 1) list[inList + 1].focus()
    else if (inList < 0) (list[0] ?? entryItem(cells))?.focus()
    else (entryItem(cells) ?? list[0]).focus()
  } else if (inList > 0) list[inList - 1].focus()
  else (lastCell ?? list[list.length - 1])?.focus()
  return true
}
