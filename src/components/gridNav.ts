import type React from 'react'

export type GridKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

export interface Box { left: number; top: number; width: number; height: number }

const GRID_KEYS: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

/**
 * The index of the slot an arrow key moves to, or null when there is none.
 * Left and Right follow the reading order (so Right continues on the next row); Up and Down go to the slot
 * nearest in x within the adjacent row, whatever the gap between rows.
 */
export function gridNavTarget(boxes: readonly Box[], from: number, key: GridKey): number | null {
  if (key === 'ArrowLeft') return from > 0 ? from - 1 : null
  if (key === 'ArrowRight') return from < boxes.length - 1 ? from + 1 : null
  const origin = boxes[from]
  if (!origin || origin.width <= 0 || origin.height <= 0) return null
  const down = key === 'ArrowDown'
  const cx = origin.left + origin.width / 2
  const cy = origin.top + origin.height / 2
  const tol = origin.height / 2
  const centreY = (b: Box) => b.top + b.height / 2
  const candidates: number[] = []
  boxes.forEach((b, i) => {
    if (i === from || b.width <= 0 || b.height <= 0) return
    const y = centreY(b)
    if (down ? y > cy + tol : y < cy - tol) candidates.push(i)
  })
  if (candidates.length === 0) return null
  const ys = candidates.map(i => centreY(boxes[i]))
  const nearestY = down ? Math.min(...ys) : Math.max(...ys)
  let best: number | null = null
  let bestDist = Infinity
  for (const i of candidates) {
    if (Math.abs(centreY(boxes[i]) - nearestY) > tol) continue
    const dist = Math.abs(boxes[i].left + boxes[i].width / 2 - cx)
    if (dist < bestDist) { best = i; bestDist = dist }
  }
  return best
}

/** The slots under `root` matching `selector`, in DOM order; aria-disabled slots count, really disabled ones do not. */
export function slotsOf(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(el => !el.matches(':disabled'))
}

/** The first slot that is neither disabled nor aria-disabled. */
export function firstEnabledSlot(root: HTMLElement | null, selector: string): HTMLElement | null {
  if (!root) return null
  return slotsOf(root, selector).find(el => el.getAttribute('aria-disabled') !== 'true') ?? null
}

/** Focuses the first slot (aria-disabled ones included); false when there is none. */
export function focusFirstSlot(root: HTMLElement | null, selector: string): boolean {
  if (!root) return false
  const first = slotsOf(root, selector)[0]
  if (!first) return false
  first.focus()
  return true
}

/**
 * Keydown handler for the element holding a grid of slots: arrow keys move focus between slots.
 * `onTopEdge` runs on ArrowUp from the first row (the pickers return to the search field).
 */
export function moveGridFocus(e: React.KeyboardEvent<HTMLElement>, selector: string, onTopEdge?: () => void): void {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
  if (!GRID_KEYS.includes(e.key)) return
  const origin = (e.target as HTMLElement).closest<HTMLElement>(selector)
  if (!origin || !e.currentTarget.contains(origin)) return
  const slots = slotsOf(e.currentTarget, selector)
  const from = slots.indexOf(origin)
  if (from < 0) return
  e.preventDefault()
  const boxes = slots.map(s => s.getBoundingClientRect())
  const target = gridNavTarget(boxes, from, e.key as GridKey)
  if (target !== null) slots[target].focus()
  else if (e.key === 'ArrowUp') onTopEdge?.()
}
