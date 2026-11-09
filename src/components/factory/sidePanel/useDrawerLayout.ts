import { useSyncExternalStore } from 'react'

/** Below Tailwind's `xl` (1280px) the side panel is a drawer over the table instead of a column beside it. */
const DRAWER_QUERY = '(max-width: 1279.98px)'

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const list = window.matchMedia(DRAWER_QUERY)
  list.addEventListener('change', onChange)
  return () => list.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DRAWER_QUERY).matches
}

/** True while the side panel is a drawer (below `xl`). A DOM without media queries (unit tests) is a docked layout. */
export function useDrawerLayout(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [contenteditable], [tabindex]'

/** The tabbable elements of `root` in DOM order: enabled, visible, and not taken out of the tab order. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el =>
    el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
}
