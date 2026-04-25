import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Regression test for the duplicate-recipe-node bug.
 *
 * The fixture ("Chemical Science" plan) contains two nodes with the same
 * recipeId ("nullius-ammonia-barrel"). This caused the solver to build a
 * stoichiometry matrix with two identical columns, producing a rank-deficient
 * system that yielded astronomically large throughput values (e.g. 7.8e16/min).
 */
test('solver does not produce astronomical rates when the same recipe appears twice', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/barrel-rate-regression.json'))

  // Wait for game data to load.
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  // Wait for at least one recipe row to appear in the production table.
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 5000 })

  // Collect all rate texts rendered in the table (/m = /min or /sec suffix).
  const rateLocator = page.locator('main table').getByText(/\/m/)
  const count = await rateLocator.count()
  expect(count).toBeGreaterThan(0)

  for (let i = 0; i < count; i++) {
    const text = (await rateLocator.nth(i).textContent()) ?? ''
    const match = text.match(/([\d.]+)\/m/)
    if (!match) continue
    const rate = parseFloat(match[1])
    expect(
      rate,
      `Table shows rate "${text}" which exceeds sane threshold — duplicate recipe node bug?`,
    ).toBeLessThan(1e9)
  }
})
