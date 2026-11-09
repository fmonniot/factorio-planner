import { useSyncExternalStore } from 'react'

/** Tailwind's `md` breakpoint: from this width the production table has its Machine and Beacons columns. */
const WIDE_QUERY = '(min-width: 768px)'

function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mql = window.matchMedia(WIDE_QUERY)
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
  return typeof window.matchMedia === 'function' && !window.matchMedia(WIDE_QUERY).matches
}

/**
 * True below 768px, where the production table has no Machine and Beacons columns: a recipe row stacks its machine and
 * beacon chips under the recipe name. A DOM without media queries (unit tests) is a wide one.
 */
export function useNarrowTable(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
