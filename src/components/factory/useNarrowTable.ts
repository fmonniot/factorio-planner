import { useSyncExternalStore } from 'react'

/** Tailwind's `md` breakpoint: from this width the production table has its Machine and Beacons columns. */
const WIDE_QUERY = '(min-width: 768px)'

// One media query list for every subscriber: a table of a hundred rows would otherwise register a listener per row.
const listeners = new Set<() => void>()
let list: MediaQueryList | null = null
const notify = () => listeners.forEach(l => l())

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  if (listeners.size === 0) {
    list = window.matchMedia(WIDE_QUERY)
    list.addEventListener('change', notify)
  }
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0 && list) {
      list.removeEventListener('change', notify)
      list = null
    }
  }
}

function getSnapshot(): boolean {
  return typeof window.matchMedia === 'function' && !(list ?? window.matchMedia(WIDE_QUERY)).matches
}

/**
 * True below 768px, where the production table has no Machine and Beacons columns: a recipe row stacks its machine and
 * beacon chips under the recipe name. A DOM without media queries (unit tests) is a wide one.
 */
export function useNarrowTable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
