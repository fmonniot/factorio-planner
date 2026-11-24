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

/** The tooltip text an element shows: that of its closest `data-tip` anchor, '' without one. */
export function tipOf(el: Element): string {
  const anchor = el.closest('[data-tip]')
  return anchor ? tipText(anchor) : ''
}

/**
 * Asserts the instant tooltip of `el`: its text, no native `title` (the accessible-description computation falls back to it, so
 * a description assertion proves nothing without that), and, unless `describe` is false, the same text as accessible description.
 */
export function expectTip(el: HTMLElement, text: string, { describe = true }: { describe?: boolean } = {}): void {
  expect(tipOf(el)).toBe(text)
  expect(el).not.toHaveAttribute('title')
  if (describe) expect(el).toHaveAccessibleDescription(text)
}
