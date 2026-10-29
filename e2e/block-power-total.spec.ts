import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

const FIXTURE = path.resolve('e2e/fixtures/summary-many-items.json')

/** "1.5 kW" / "2.0 MW" (accessible name or text) as kW. */
function toKw(text: string): number {
  const m = /([\d.]+)\s*(W|kW|MW|GW)/.exec(text)
  if (!m) throw new Error(`No power in "${text}"`)
  const scale = { W: 0.001, kW: 1, MW: 1000, GW: 1_000_000 }[m[2] as 'W' | 'kW' | 'MW' | 'GW']
  return parseFloat(m[1]) * scale
}

test('the Ingredients header totals the power tiles of the rows', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  const total = page.getByTestId('block-power-total')
  await expect(total).toBeVisible({ timeout: 20000 })

  const tiles = page.locator('main table tbody [data-variant="electricity"]')
  await expect(tiles.first()).toBeVisible()
  const texts = await tiles.evaluateAll(els => els.map(e => e.textContent ?? ''))
  const sum = texts.reduce((s, t) => s + toKw(t), 0)
  const shown = toKw((await total.textContent()) ?? '')
  // Each figure is rounded to one decimal in its own unit.
  expect(Math.abs(shown - sum)).toBeLessThanOrEqual(Math.max(0.06 * texts.length * 1000, sum * 0.01, 0.1 * texts.length))
})
