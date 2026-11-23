import { expect } from 'vitest'
import { tipText } from '../components/TooltipLayer'

/** Test queries for instant tooltips: elements are found by the text `TooltipLayer` would show (`data-tip`, else `aria-label`). */
export function getAllByTip(match: string | RegExp): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-tip]')].filter(el => {
    const t = tipText(el)
    return typeof match === 'string' ? t === match : match.test(t)
  })
}

export function queryByTip(match: string | RegExp): HTMLElement | null {
  const found = getAllByTip(match)
  expect(found.length, `at most one element with the tip ${String(match)}`).toBeLessThanOrEqual(1)
  return found[0] ?? null
}

export function getByTip(match: string | RegExp): HTMLElement {
  const found = getAllByTip(match)
  expect(found, `one element with the tip ${String(match)}`).toHaveLength(1)
  return found[0]
}
