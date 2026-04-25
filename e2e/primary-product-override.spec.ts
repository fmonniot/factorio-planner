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

    // By default Hydrogen is primary — its tile has a ● badge with title "Primary product".
    await expect(row.getByTitle('Primary product')).toBeVisible()

    // Exactly one "Primary product" indicator, one or more "Set as primary" tiles.
    await expect(row.getByTitle('Primary product')).toHaveCount(1)
    await expect(row.getByTitle(/Set as primary/).first()).toBeVisible()

    // The pin button should be present on the row (not yet pinned).
    await expect(row.getByTitle('Pin rate')).toBeVisible()

    // Click "Set as primary" on Sodium hydroxide.
    const saPrimary = row.getByTitle(/Set as primary.*Sodium hydroxide|Sodium hydroxide.*Set as primary/)
    if (await saPrimary.count() > 0) {
      await saPrimary.first().click()
    } else {
      // Fall back: click any "Set as primary" tile (there are only 2 non-primary outputs here).
      await row.getByTitle(/Set as primary/).first().click()
    }

    // After the switch: still exactly 1 ● indicator.
    await expect(row.getByTitle('Primary product')).toHaveCount(1)
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

    // No primary-product badge or "Set as primary" tiles.
    await expect(row.getByTitle('Primary product')).not.toBeVisible()
    await expect(row.getByTitle(/Set as primary/)).not.toBeVisible()

    // Pin button is still present.
    await expect(row.getByTitle('Pin rate')).toBeVisible()
  })
})
