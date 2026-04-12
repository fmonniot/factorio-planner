import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Regression / feature test for pinning the scale of a subplan from the parent
 * plan's SubPlanSolvedCard.
 *
 * The fixture (pin-recipe-not-working.json) contains a "Chemical Science" block
 * whose root plan includes a subplan node referencing a "Sulfuric Acid" child
 * plan. The subplan node has no pinnedRate, so the card starts unpinned.
 */
test('can pin and unpin the scale of a subplan', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/pin-recipe-not-working.json'))

  // Wait for game data + solver to finish.
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main').getByText('Solving…')).not.toBeVisible({ timeout: 10000 })

  // The Sulfuric Acid subplan card must be present.
  // Subplan cards have border-blue-800; recipe cards have border-gray-700.
  const card = page.locator('main .bg-gray-800.border-blue-800').filter({ hasText: 'Sulfuric Acid' }).first()
  await expect(card).toBeVisible({ timeout: 5000 })

  // Pin button (📍) should be visible — the card is not yet pinned.
  const pinBtn = card.getByTitle('Pin scale')
  await expect(pinBtn).toBeVisible()

  // Click pin — a numeric input should appear showing the current scale.
  await pinBtn.click()
  const scaleInput = card.getByLabel('Pinned scale')
  await expect(scaleInput).toBeVisible()

  // The initial value must be positive (not 0.00, which would mean the zero-
  // throughput guard is broken).
  await expect(scaleInput).not.toHaveValue('0.00', { timeout: 5000 })
  const initial = await scaleInput.inputValue()
  expect(parseFloat(initial)).toBeGreaterThan(0)

  // Type a new scale value — the solver should re-run.
  await scaleInput.fill('2')
  await scaleInput.press('Tab')
  await expect(page.locator('main').getByText('Solving…')).not.toBeVisible({ timeout: 5000 })

  // Unpin — the 📍 button should return and the input should disappear.
  await card.getByTitle('Unpin scale').click()
  await expect(card.getByTitle('Pin scale')).toBeVisible()
  await expect(scaleInput).not.toBeVisible()
})
