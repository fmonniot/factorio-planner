import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot } from './support/summary'

/**
 * Fixture: hydrogen goal (100/min) + steam electrolysis only. Clicking the goal
 * slot's Find recipe action opens a recipe picker filtered to producers of
 * hydrogen; clicking its target rate edits the rate instead.
 */
const FIXTURE = path.resolve('e2e/fixtures/byproduct-add-consumer.json')

async function waitForRows(page: Page) {
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
}

test.describe('Goal slot: add producer recipe', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await waitForRows(page)
  })

  test('Find recipe opens the producer picker and adds a row', async ({ page }) => {
    const rows = page.locator('main table tbody tr')
    const before = await rows.count()

    await selectSlot(page, 'Products', 'Hydrogen')
    await detail(page, 'Products').getByRole('button', { name: 'Find recipe' }).click()

    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expect(page.getByText("Choose a recipe to produce 'Hydrogen'")).toBeVisible()

    const overlay = page.locator('.fixed.inset-0')
    await overlay.getByPlaceholder('Search…').fill('nullius-water-electrolysis')
    await overlay.locator('[data-testid="recipe-slot"][data-recipe-id="nullius-water-electrolysis"]').click()

    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
    await expect(rows).toHaveCount(before + 1)
    await expect(page.locator('main table tbody tr [title="Water electrolysis"]').first()).toBeVisible()
  })

  test('clicking the target rate does not open the picker', async ({ page }) => {
    await selectSlot(page, 'Products', 'Hydrogen')
    await page.getByTitle(/^Extra output:/).click()
    await expect(page.getByLabel('Extra output rate')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
  })
})
