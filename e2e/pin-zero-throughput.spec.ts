import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { clickRowAction } from './support/rowMenu'

/**
 * Regression test for two related pin bugs:
 *
 * 1. Schema bug: the fixture stores `pinnedRate: 0`. The schema uses
 *    z.number().positive() which rejects 0, so parseAppState() threw and
 *    state was silently lost on reload. Fix: treat pinnedRate: 0 as unpinned.
 *
 * 2. Pin-action bug: when throughput === 0, pinning from the row menu must seed a non-zero
 *    initial rate so the solver can compute a real result on the next cycle.
 *
 * Expected behaviour after the fix:
 *   - The fixture loads successfully (pinnedRate: 0 treated as unpinned).
 *   - Pinning a 0-throughput recipe pins at a value > 0.
 *   - The user can type a new rate into the pinned input and it sticks.
 */
test('can pin a recipe even when initial throughput is 0', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/pin-recipe-not-working.json'))

  // Wait for game data to load.
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  // The saline-electrolysis row must be present (proves the fixture loaded).
  const row = page.locator('main table tbody tr')
    .filter({ has: page.locator('[title="Saline electrolysis"]') }).first()
  await expect(row).toBeVisible({ timeout: 5000 })

  // Not yet pinned: no pinned-rate input, and the menu offers "Pin rate".
  await expect(row.getByLabel('Pinned rate')).not.toBeVisible()

  // Pin through the row menu.
  await clickRowAction(page, row, 'Pin rate')

  // After clicking, the pinned input appears.
  const pinnedInput = row.getByLabel('Pinned rate')
  await expect(pinnedInput).toBeVisible()

  // The seeded value must be > 0 (the zero-throughput seed bug would show 0 here).
  const rawValue = await pinnedInput.inputValue()
  expect(parseFloat(rawValue)).toBeGreaterThan(0)

  // The user should be able to type a new rate.
  await pinnedInput.fill('120')
  await pinnedInput.press('Tab')

  // The input must reflect the typed value (possibly reformatted).
  const updatedValue = await pinnedInput.inputValue()
  expect(parseFloat(updatedValue)).toBeCloseTo(120, 0)

  // Unpin restores the static tile.
  await clickRowAction(page, row, 'Unpin rate')
  await expect(row.getByLabel('Pinned rate')).not.toBeVisible()
})
