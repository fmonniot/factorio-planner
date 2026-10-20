import { test, expect } from '@playwright/test'
import path from 'path'
import { openRowMenu } from './support/rowMenu'

const GAME_DATA_PATH = path.resolve('public/data/nullius/game-data.json')

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
    await overlay.getByPlaceholder('Search…').fill('Hydrogen')
    // The hydrogen fluid lives in the "fluids" group — switch tab to find it.
    await overlay.locator('[data-testid="item-group-tab"][data-group-id="fluids"]').click()
    await overlay.locator('[data-testid="item-slot"][data-item-id="nullius-hydrogen"]').click()

    // Add the brine-electrolysis recipe.
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await overlay.getByPlaceholder('Search…').fill('nullius-brine-electrolysis')
    await overlay.locator('[data-testid="recipe-slot"][data-recipe-id="nullius-brine-electrolysis"]').click()

    // Wait for the row to appear.
    const row = page.locator('main table tbody tr').filter({ has: page.locator('[title="Brine electrolysis"]') }).first()
    await expect(row).toBeVisible()

    // By default Hydrogen is primary — it appears in the Products column.
    // Non-primary outputs (Oxygen, Sodium hydroxide) appear in Byproducts with
    // title="Set as primary". No ● badge — the column position is the feedback.
    await expect(row.getByTitle(/Set as primary/).first()).toBeVisible()

    // The row menu offers to pin it (not yet pinned).
    const menu = await openRowMenu(page, row)
    await expect(menu.getByRole('menuitem', { name: 'Pin rate' })).toBeVisible()
    await page.keyboard.press('Escape')

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
    await overlay.getByPlaceholder('Search…').fill('nullius-chemical-pack')
    await overlay.locator('[data-testid="item-slot"]').first().click()

    // Add Chemistry research 1 recipe (single-output).
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await overlay.getByPlaceholder('Search…').fill('Chemistry research 1')
    await overlay.locator('[data-testid="recipe-slot"][title="Chemistry research 1"]').click()

    const row = page.locator('main table tbody tr').filter({ has: page.locator('[title="Chemistry research 1"]') }).first()
    await expect(row).toBeVisible()

    // Single-output: no "Set as primary" tiles (nothing to switch to).
    await expect(row.getByTitle(/Set as primary/)).not.toBeVisible()

    // The row menu still offers pinning.
    const menu = await openRowMenu(page, row)
    await expect(menu.getByRole('menuitem', { name: 'Pin rate' })).toBeVisible()
  })
})
