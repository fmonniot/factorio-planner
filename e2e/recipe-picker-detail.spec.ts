import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('data/samples/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

test.describe('Recipe picker detail panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await loadGameData(page)
  })

  test('hovering a recipe row shows machine, crafting time, ingredients and products', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')

    // Open the recipe picker via the ProductionTable "+ Add recipe" button.
    await page.getByText('+ Add recipe').click()
    await expect(page.getByPlaceholder('Search recipes…')).toBeVisible()

    // Search for "Chemistry research 1" so it's the only result.
    await page.getByPlaceholder('Search recipes…').fill('Chemistry research 1')
    const recipeRow = overlay.getByRole('button', { name: /Chemistry research 1/ }).first()
    await expect(recipeRow).toBeVisible()

    // No detail panel before hover.
    await expect(overlay.getByText('Chemical plant 3')).not.toBeVisible()

    // Hover the recipe row.
    await recipeRow.hover()

    // The detail panel is the w-64 div that appears to the right of the picker.
    const detail = overlay.locator('.w-64')
    await expect(detail).toBeVisible()

    // Machine and crafting time (these only appear in the detail panel).
    await expect(detail.getByText('Chemical plant 3')).toBeVisible()
    await expect(detail.getByText('15s')).toBeVisible()

    // A sample of ingredients.
    await expect(detail.getByText('Sodium hydroxide')).toBeVisible()
    await expect(detail.getByText('Sulfuric acid')).toBeVisible()

    // The product (exact match avoids ambiguity with "Chemistry research 1" in the result list).
    await expect(detail.getByText('Chemistry research', { exact: true })).toBeVisible()
  })

  test('detail panel disappears when cursor leaves the recipe row', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')

    await page.getByRole('button', { name: '+ Add' }).nth(1).click()
    await page.getByPlaceholder('Search recipes…').fill('Chemistry research 1')

    const recipeRow = overlay.getByRole('button', { name: /Chemistry research 1/ }).first()
    await recipeRow.hover()
    await expect(overlay.getByText('Chemical plant 3')).toBeVisible()

    // Move mouse away to the overlay backdrop.
    await page.mouse.move(10, 10)
    await expect(overlay.getByText('Chemical plant 3')).not.toBeVisible()
  })

  test('detail panel updates when hovering a different recipe', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')

    await page.getByText('+ Add recipe').click()

    // Search for something that yields multiple results.
    await page.getByPlaceholder('Search recipes…').fill('Chemistry research')

    const row1 = overlay.getByRole('button', { name: /Chemistry research 1/ }).first()
    const row2 = overlay.getByRole('button', { name: /Chemistry research 2/ }).first()
    await expect(row1).toBeVisible()
    await expect(row2).toBeVisible()

    // Hover first recipe — detail panel shows 15s crafting time.
    await row1.hover()
    await expect(overlay.getByText('15s')).toBeVisible()

    // Hover second recipe — detail panel updates.
    await row2.hover()
    // Verify the detail panel now shows the second recipe's id (scoped to the
    // w-64 detail panel to avoid the ambiguity with the result row label).
    const detail = overlay.locator('.w-64')
    await expect(detail.getByText('nullius-chemical-pack-2')).toBeVisible()
  })

  test('detail panel does not appear in item-mode picker', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')

    // Open the item/goal picker via FactorySummary [+].
    await page.getByTitle('Add goal').click()
    await expect(page.getByPlaceholder('Search items…')).toBeVisible()

    await page.getByPlaceholder('Search items…').fill('Chemistry research')
    const itemRow = overlay.getByRole('button', { name: /Chemistry research/ }).first()
    await expect(itemRow).toBeVisible()

    await itemRow.hover()

    // No detail panel (no machine/crafting time info).
    await expect(overlay.getByText('Chemical plant 3')).not.toBeVisible()
    await expect(overlay.getByText('15s')).not.toBeVisible()
  })
})
