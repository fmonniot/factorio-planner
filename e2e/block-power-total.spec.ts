import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

const FIXTURE = path.resolve('e2e/fixtures/summary-many-items.json')

const SCALE = { W: 0.001, kW: 1, MW: 1000, GW: 1_000_000 } as const
type Unit = keyof typeof SCALE

/** "1.5 kW" / "2.0 MW" (accessible name or text) as kW, with the rounding error of that figure in kW. */
function parsePower(text: string): { kw: number; err: number } {
  const m = /([\d.]+)\s*(W|kW|MW|GW)/.exec(text)
  if (!m) throw new Error(`No power in "${text}"`)
  const unit = m[2] as Unit
  // fmtPower shows W without decimals (+-0.5 W), the other units with one (+-0.05 unit).
  const err = (unit === 'W' ? 0.5 : 0.05) * SCALE[unit]
  return { kw: parseFloat(m[1]) * SCALE[unit], err }
}

test('the Ingredients header totals the power of the rows', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  const total = page.getByTestId('block-power-total')
  await expect(total).toBeVisible({ timeout: 20000 })

  const tiles = page.locator('main table tbody [data-variant="electricity"]')
  await expect(tiles.first()).toBeVisible()
  const texts = await tiles.evaluateAll(els => els.map(e => e.textContent ?? ''))
  const parts = texts.map(parsePower)
  const sum = parts.reduce((acc, p) => acc + p.kw, 0)
  const tolerance = parts.reduce((acc, p) => acc + p.err, 0)
  const header = parsePower((await total.textContent()) ?? '')
  // Each figure is rounded in its own unit, so allow exactly the sum of those roundings plus the header's.
  expect(Math.abs(header.kw - sum)).toBeLessThanOrEqual(tolerance + header.err + 1e-9)
})
