import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Regression test for the infinite-recursion bug that occurred when recipes
 * form a cycle in the item-producer graph. The fix adds back-edge detection
 * so any node already on the current recursion stack is skipped.
 */
test('production table renders without stack overflow when recipes form a cycle', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/infinite-recursion-methane.json'))

  // Wait for game data to load.
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  // No solver error should be shown.
  await expect(page.locator('main').getByText(/Solver error:/)).not.toBeVisible()

  // At least one rate value must render in the production table.
  const rateLocator = page.locator('main table').getByText(/\/m/)
  await expect(rateLocator.first()).toBeVisible({ timeout: 5000 })
})
