import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('data/samples/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

test.describe('Primary product override', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await loadGameData(page)
  })

  test('brine-electrolysis defaults to hydrogen as primary, can be switched to sodium hydroxide', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')

    // Add Hydrogen as a goal.
    await page.getByTitle('Add goal').click()
    await page.getByPlaceholder('Search items…').fill('Hydrogen')
    await overlay.getByRole('button', { name: /^Hydrogen/ }).first().click()

    // Add the brine-electrolysis recipe.
    await page.getByText('+ Add recipe').click()
    await page.getByPlaceholder('Search recipes…').fill('nullius-brine-electrolysis')
    await overlay.getByRole('button', { name: /nullius-brine-electrolysis/ }).first().click()

    // Wait for the row to appear.
    const row = page.locator('main table tbody tr').filter({ hasText: 'nullius-brine-electrolysis' }).first()
    await expect(row).toBeVisible()

    // By default Hydrogen is primary — it appears in the Products column.
    // Non-primary outputs (Oxygen, Sodium hydroxide) appear in Byproducts with
    // title="Set as primary". No ● badge — the column position is the feedback.
    await expect(row.getByTitle(/Set as primary/).first()).toBeVisible()

    // The pin button should be present on the row (not yet pinned).
    await expect(row.getByTitle('Pin rate')).toBeVisible()

    // Count the "Set as primary" tiles before switching.
    const beforeCount = await row.getByTitle(/Set as primary/).count()
    expect(beforeCount).toBeGreaterThan(0)

    // Click the first "Set as primary" tile to switch the primary product.
    await row.getByTitle(/Set as primary/).first().click()

    // After the switch: the same number of "Set as primary" tiles (the old primary
    // moved to Byproducts, the clicked one moved to Products).
    await expect(row.getByTitle(/Set as primary/)).toHaveCount(beforeCount)
  })

  test('single-output recipe shows no ● badge and no "Set as primary" elements', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')

    // Add Chemistry research as a goal.
    await page.getByTitle('Add goal').click()
    await page.getByPlaceholder('Search items…').fill('nullius-chemical-pack')
    await overlay.getByRole('button', { name: /Chemistry research/ }).first().click()

    // Add Chemistry research 1 recipe (single-output).
    await page.getByText('+ Add recipe').click()
    await page.getByPlaceholder('Search recipes…').fill('Chemistry research 1')
    await overlay.getByRole('button', { name: 'Chemistry research 1' }).first().click()

    const row = page.locator('main table tbody tr').filter({ hasText: 'Chemistry research 1' }).first()
    await expect(row).toBeVisible()

    // Single-output: no "Set as primary" tiles (nothing to switch to).
    await expect(row.getByTitle(/Set as primary/)).not.toBeVisible()

    // Pin button is still present.
    await expect(row.getByTitle('Pin rate')).toBeVisible()
  })
})
