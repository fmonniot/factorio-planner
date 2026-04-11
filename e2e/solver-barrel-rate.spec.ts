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

  // Wait for the solver to finish — "Solving…" disappears once a result is ready.
  await expect(page.locator('main').getByText('Solving…')).not.toBeVisible({ timeout: 10000 })

  // Wait for at least one recipe card to be rendered ("Fill Ammonia barrel" is one of the duplicate nodes).
  await expect(page.locator('main').getByText('Fill Ammonia barrel').first()).toBeVisible({ timeout: 5000 })

  // Collect all "/min" rate texts rendered in recipe card output sections.
  const rateLocator = page.locator('main').getByText(/\/min/)
  const count = await rateLocator.count()
  expect(count).toBeGreaterThan(0)

  for (let i = 0; i < count; i++) {
    const text = (await rateLocator.nth(i).textContent()) ?? ''
    const match = text.match(/([\d.]+)\/min/)
    if (!match) continue
    const rate = parseFloat(match[1])
    expect(
      rate,
      `Recipe card shows rate "${text}" which exceeds sane threshold — duplicate recipe node bug?`,
    ).toBeLessThan(1e9)
  }
})
