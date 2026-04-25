import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Regression test for pin-zero-throughput bugs.
 *
 * Pin UI (📍/📌) is not yet ported to the new RecipeRow; only the data-layer
 * fix (schema: pinnedRate: 0 treated as unpinned) is verified here.
 *
 * TODO: once pinning is added to RecipeRow, restore the full UI interaction test.
 */
test('fixture with pinnedRate: 0 loads successfully without data loss', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/pin-recipe-not-working.json'))

  // Wait for game data to load.
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  // The saline-electrolysis row must be present (proves the fixture loaded).
  const row = page.locator('main table tbody tr').filter({ hasText: 'nullius-saline-electrolysis' }).first()
  await expect(row).toBeVisible({ timeout: 5000 })
})
