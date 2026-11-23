import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { pane } from './support/summary'

/** Fixture: the active block "Acid" was saved with two products of hydrogen (800 and 200 extra) and one of nitric acid. */
const FIXTURE = path.resolve('e2e/fixtures/not-in-golden/duplicate-products.json')
const HYDROGEN = 'nullius-hydrogen'

test.describe('duplicate products on load', () => {
  test('a plan saved with two products of one item shows one slot, with the summed extra output saved back', async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    const slots = pane(page, 'Products').getByTestId('summary-slot')
    await expect(slots).toHaveCount(2)
    await expect(pane(page, 'Products').locator(`[data-testid="summary-slot"][data-item-id="${HYDROGEN}"]`)).toHaveCount(1)

    // Any change saves the plan; the merged product is what gets stored.
    await page.getByTitle('Add product').click()
    await page.locator('.fixed.inset-0').getByText('Cancel').click()
    await expect.poll(async () => {
      const plan = (await readActivePlan(page, 'nullius')) as { blocks: { products?: { itemId: string; extraRate?: number }[] }[] }
      return plan.blocks[0].products?.filter(p => p.itemId === HYDROGEN).map(p => p.extraRate)
    }).toEqual([1000])
  })
})
