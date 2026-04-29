import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Three fixtures cover different aspects of the byproduct consumer feature:
 *
 * BASE  (byproduct-consumer-base.json)
 *   Goal: hydrogen. Recipes: steam-electrolysis + acid-sulfuric + acid-nitric.
 *   oxygen is an intermediate consumed by BOTH acid-sulfuric and acid-nitric,
 *   giving 2 rows (hydrogen goal + oxygen intermediate) vs 3 recipe columns
 *   → underdetermined system.
 *
 * ACTIVE  (byproduct-consumer-active.json)
 *   Same plan with acid-nitric already marked byproductConsumer: true.
 *   Main becomes steam-electrolysis + acid-sulfuric (2×2 square, no warning).
 *   Tests schema round-trip through Zod parsing.
 *
 * SURPLUS  (byproduct-consumer-surplus.json)
 *   Goal: hydrogen. Recipes: steam-electrolysis (main) + acid-nitric (bc=true).
 *   Main is 1×1 square; oxygen is a byproduct of the main solve with non-zero
 *   surplus (50/min), so acid-nitric runs at 2.5 exec/min to consume it.
 *   Tests that the bc recipe actually derives a positive throughput.
 */

const BASE_FIXTURE = path.resolve('e2e/fixtures/byproduct-consumer-base.json')
const ACTIVE_FIXTURE = path.resolve('e2e/fixtures/byproduct-consumer-active.json')
const SURPLUS_FIXTURE = path.resolve('e2e/fixtures/byproduct-consumer-surplus.json')

async function waitForRows(page: import('@playwright/test').Page) {
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
}

// Find the recipe row whose icon has title="Nitric acid".
// Recipe names live in title attributes, not text content, so we use filter({ has }).
function nitricAcidRow(page: import('@playwright/test').Page) {
  return page
    .locator('main table tbody tr')
    .filter({ has: page.locator('[title="Nitric acid"]') })
    .first()
}

test.describe('Byproduct consumer mode', () => {
  test('underdetermined warning is visible on base fixture', async ({ page }) => {
    await loadPlanFixture(page, BASE_FIXTURE)
    await waitForRows(page)

    const badge = page.getByRole('button', { name: /warning/ })
    await expect(badge).toBeVisible()

    await badge.click()
    await expect(page.getByText(/Recipe network can.t fully balance/)).toBeVisible()
  })

  test('toggling byproduct consumer on a recipe removes the underdetermined warning', async ({ page }) => {
    await loadPlanFixture(page, BASE_FIXTURE)
    await waitForRows(page)

    // Verify warning is present before the toggle.
    await expect(page.getByRole('button', { name: /warning/ })).toBeVisible()

    // The ♻ button is opacity-0 until hover; hover the row first to reveal it.
    const row = nitricAcidRow(page)
    await row.hover()
    await row.getByTitle('Only run to absorb byproduct from other recipes').click()

    // The underdetermined warning should disappear (system becomes square 2×2).
    await expect(page.getByRole('button', { name: /warning/ })).not.toBeVisible({ timeout: 5000 })
  })

  test('byproduct consumer recipe derives non-zero throughput from surplus', async ({ page }) => {
    // SURPLUS fixture: steam-electrolysis (main, 1×1 square) + acid-nitric (bc=true).
    // The main solve produces 50 oxygen/min as a byproduct; acid-nitric absorbs it
    // at 2.5 executions/min, yielding ~12.5 nitric-acid/min.
    await loadPlanFixture(page, SURPLUS_FIXTURE)
    await waitForRows(page)

    // The bc recipe row must be present and show at least one output item icon,
    // confirming the solver computed a positive throughput from the oxygen surplus.
    const row = nitricAcidRow(page)
    await expect(row).toBeVisible()
    // Output item icons appear in the Products td; any img with a title suffices.
    await expect(row.locator('img[title]').first()).toBeVisible({ timeout: 5000 })
  })

  test('toggling byproduct consumer off restores the underdetermined warning', async ({ page }) => {
    await loadPlanFixture(page, BASE_FIXTURE)
    await waitForRows(page)

    const row = nitricAcidRow(page)

    // Toggle on (button is opacity-0 until hover).
    await row.hover()
    await row.getByTitle('Only run to absorb byproduct from other recipes').click()

    // Confirm warning gone.
    await expect(page.getByRole('button', { name: /warning/ })).not.toBeVisible({ timeout: 5000 })

    // Toggle off (button is now emerald/visible, no hover needed).
    await row.getByTitle('Stop absorbing byproduct (re-enter main solve)').click()

    // Warning should reappear.
    const badge = page.getByRole('button', { name: /warning/ })
    await expect(badge).toBeVisible()
    await badge.click()
    await expect(page.getByText(/Recipe network can.t fully balance/)).toBeVisible()
  })

  test('byproductConsumer field survives a plan reload', async ({ page }) => {
    await loadPlanFixture(page, ACTIVE_FIXTURE)
    await waitForRows(page)

    // The "Nitric acid" row should show the active (emerald) toggle
    // and no pin button (throughput is derived, not user-set).
    const row = nitricAcidRow(page)
    await expect(row.getByTitle('Stop absorbing byproduct (re-enter main solve)')).toBeVisible()
    await expect(row.getByTitle('Pin rate')).not.toBeVisible()
    // No underdetermined warning: active fixture has a square 2×2 main system.
    await expect(page.getByRole('button', { name: /warning/ })).not.toBeVisible()
  })

  test('pin button is hidden when byproduct consumer is active', async ({ page }) => {
    await loadPlanFixture(page, BASE_FIXTURE)
    await waitForRows(page)

    const row = nitricAcidRow(page)

    // Pin button should appear on hover before toggling.
    await row.hover()
    await expect(row.getByTitle('Pin rate')).toBeVisible()

    // Toggle byproduct consumer on.
    await row.getByTitle('Only run to absorb byproduct from other recipes').click()

    // Pin button must no longer be present in the row.
    await expect(row.getByTitle('Pin rate')).not.toBeVisible()
    await expect(row.getByTitle('Unpin rate')).not.toBeVisible()
  })
})
