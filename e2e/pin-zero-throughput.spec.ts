import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Regression test for two related pin bugs:
 *
 * 1. Schema bug: the fixture stores `pinnedRate: 0` (produced when the user
 *    clicks pin while the solver gives that recipe 0 throughput). The schema
 *    uses z.number().positive() which rejects 0, so parseAppState() throws and
 *    the entire plan fails to load — state is silently lost on reload.
 *
 * 2. Pin-action bug: when node.throughput === 0, clicking the pin button calls
 *    updateNodePinnedRate(id, 0). Even if the store accepts 0, effectivePerExec
 *    (= rate / throughput) is 0, so the onChange guard `effectivePerExec > 0`
 *    prevents the user from ever entering a new rate. The UI is stuck at 0.00/min.
 *
 * The expected behavior after the fix:
 *   - The fixture loads successfully (pinnedRate: 0 is treated as unpinned).
 *   - Clicking 📍 on a 0-throughput recipe pins at a non-zero initial rate
 *     (so the solver can compute a real throughput on the next cycle).
 *   - The user can type a target rate into the pinned input and it sticks.
 */
test('can pin sodium hydroxide on saline-electrolysis even when initial throughput is 0', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/pin-recipe-not-working.json'))

  // Wait for game data to load and solver to finish.
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main').getByText('Solving…')).not.toBeVisible({ timeout: 10000 })

  // The saline-electrolysis card must be present (proves the fixture loaded).
  const card = page.locator('main .bg-gray-800').filter({ hasText: 'nullius-saline-electrolysis' }).first()
  await expect(card).toBeVisible({ timeout: 5000 })

  // Sodium hydroxide should be the primary product (● indicator visible).
  await expect(card.getByTitle('Primary product')).toBeVisible()
  const primaryRow = card.locator('div:has(button[title="Primary product"])').first()
  await expect(primaryRow).toContainText('Sodium hydroxide')

  // The pin button (📍) should be visible on the primary row — not already pinned.
  const pinBtn = primaryRow.getByTitle('Pin rate')
  await expect(pinBtn).toBeVisible()

  // Click the pin button.
  await pinBtn.click()

  // After clicking, the pinned input must appear (replaces the static rate text).
  const pinnedInput = card.getByLabel('Pinned item rate')
  await expect(pinnedInput).toBeVisible()

  // The solver re-runs after the pin is set (150ms debounce). Until the new
  // result arrives, effectivePerExec = 0 so the input briefly shows "0.00".
  // Wait for the value to update to a positive number.
  await expect(pinnedInput).not.toHaveValue('0.00', { timeout: 5000 })

  // The input must show a positive value — not "0.00" which would mean the bug
  // is still present (effectivePerExec = 0 → unable to display or edit item/min).
  const rawValue = await pinnedInput.inputValue()
  expect(parseFloat(rawValue)).toBeGreaterThan(0)

  // The user should be able to type a new target rate.
  await pinnedInput.fill('120')
  await pinnedInput.press('Tab')

  // After typing 120, the input should reflect the value (possibly reformatted).
  const updatedValue = await pinnedInput.inputValue()
  expect(parseFloat(updatedValue)).toBeCloseTo(120, 0)

  // The pin button should now show 📌 (pinned state).
  await expect(primaryRow.getByTitle('Unpin rate')).toBeVisible()
})
