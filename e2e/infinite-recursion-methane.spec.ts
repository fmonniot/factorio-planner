import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Regression test for the infinite-recursion bug in buildColumns (TreeView).
 *
 * The fixture contains a recipe set that produces a cycle in the item-producer
 * graph: recipe A consumes an item produced by recipe B, and recipe B consumes
 * an item produced by recipe A. The depth-based guard in `descend` increments
 * depth by 2 on each round trip, so it never terminates.
 *
 * The fix adds a per-DFS-path `visiting` set (back-edge detection) so that any
 * node already on the current recursion stack is skipped instead of re-entered.
 */
test('tree view renders without stack overflow when recipes form a cycle', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/infinite-recursion-methane.json'))

  // Wait for game data to load.
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  // Wait for the solver to finish — "Solving…" disappears once a result is ready.
  await expect(page.locator('main').getByText('Solving…')).not.toBeVisible({ timeout: 10000 })

  // No solver error should be shown (a stack overflow caught by solverStore
  // would surface as "Solver error: Maximum call stack size exceeded").
  await expect(page.locator('main').getByText(/Solver error:/)).not.toBeVisible()

  // At least one rate value must render — the tree view must not have crashed.
  const rateLocator = page.locator('main').getByText(/\/min/)
  await expect(rateLocator.first()).toBeVisible({ timeout: 5000 })
})
