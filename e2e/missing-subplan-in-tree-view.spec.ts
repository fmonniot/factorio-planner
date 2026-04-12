import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Regression test for the "Lubricant subplan missing from tree view" bug.
 *
 * The fixture has two child subplans in its root plan:
 *   1. "Sulfuric Acid" — has a `subplan` node in rootPlan.nodes (wired)
 *   2. "Lubricant"     — also has a `subplan` node (fixture was updated as part of the
 *                        "always wire on creation" fix)
 *
 * Before the fix: addSubPlan only added the child to rootPlan.subPlans; it did not
 * create a SubPlanNode in rootPlan.nodes. renderNode required both childSubPlan AND
 * childSubPlanPlanNode, so subplans without a node fell through to RecipeCard —
 * rendering lubricant recipe cards instead of a subplan card, and making the lubricant
 * item appear as an output row inside those recipe cards.
 *
 * After the fix: addSubPlan always creates both the SubPlan and a SubPlanNode. The
 * SubPlanCard / unsolvedSubPlans concept is removed entirely.
 */
test.describe('missing-subplan-in-tree-view', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, path.resolve('e2e/fixtures/missing-subplan-in-tree-view.json'))
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(page.locator('main').getByText('Solving…')).not.toBeVisible({ timeout: 10000 })
  })

  test('Sulfuric Acid subplan card is visible (sanity check)', async ({ page }) => {
    // Subplan cards have border-blue-800; recipe cards have border-gray-700.
    const card = page.locator('main .bg-gray-800.border-blue-800').filter({ hasText: 'Sulfuric Acid' }).first()
    await expect(card).toBeVisible({ timeout: 5000 })
  })

  test('Lubricant subplan card is visible with a pin button', async ({ page }) => {
    // Subplan cards have border-blue-800; recipe cards have border-gray-700.
    const card = page.locator('main .bg-gray-800.border-blue-800').filter({ hasText: 'Lubricant' }).first()
    await expect(card).toBeVisible({ timeout: 5000 })
    // Rendered as SubPlanSolvedCard — pin button must be present
    await expect(card.getByTitle('Pin scale')).toBeVisible()
  })

  test('lubricant appears in the subplan card outputs, not in recipe card outputs', async ({ page }) => {
    // The Lubricant subplan card shows lubricant as an output.
    const lubCard = page.locator('main .bg-gray-800.border-blue-800').filter({ hasText: 'Lubricant' }).first()
    await expect(lubCard.locator('section').filter({ hasText: 'Outputs' }).getByText('Lubricant')).toBeVisible()

    // Lubricant must NOT appear as an output row inside a non-subplan recipe card.
    // Recipe cards have border-gray-700; subplan cards have border-blue-800.
    // Before the fix it appeared there because the subplan was rendered as RecipeCards.
    const nonSubplanOutputLubricant = page.locator('main .bg-gray-800.border-gray-700')
      .locator('section')
      .filter({ hasText: 'Outputs' })
      .getByText('Lubricant')
    await expect(nonSubplanOutputLubricant).toHaveCount(0)
  })
})
