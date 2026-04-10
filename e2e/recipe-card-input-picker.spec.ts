import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('data/samples/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

test.describe('Recipe card input picker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await loadGameData(page)
  })

  /**
   * Regression: clicking an ingredient name in a RecipeCard opened ItemPicker
   * pre-filtered to recipes producing that item, but also pre-filled the search
   * box with the item name. Because matchesRecipe filters by recipe name/id, only
   * recipes whose name contains the item name were shown (e.g. "Sodium hydroxide
   * unboxing"), while the real producers (saline electrolysis, brine electrolysis,
   * aluminum ingot 3) were silently filtered out.
   *
   * Fix: do not pass initialQuery when filterByItemId is set — the item filter is
   * already sufficient and the text filter should start empty.
   */
  test('clicking sodium hydroxide input shows all producing recipes, not just unboxing', async ({ page }) => {
    const pickerOverlay = page.locator('.fixed.inset-0')

    // 1. Add goal: Chemistry research (nullius-chemical-pack item)
    await page.getByRole('button', { name: '+ Add' }).first().click()
    await page.getByPlaceholder('Search items…').fill('nullius-chemical-pack')
    await pickerOverlay.getByRole('button', { name: /Chemistry research/ }).first().click()

    // 2. Add the "Chemistry research 1" recipe node
    await page.getByRole('button', { name: '+ Add' }).nth(1).click()
    await page.getByPlaceholder('Search recipes…').fill('Chemistry research 1')
    await pickerOverlay.getByRole('button', { name: 'Chemistry research 1' }).first().click()

    // 3. Wait for the recipe card to appear in main
    const card = page.locator('main').locator('.bg-gray-800').filter({ hasText: 'Chemistry research 1' }).first()
    await expect(card).toBeVisible()

    // 4. Click the "Sodium hydroxide" input row — should open a filtered picker
    await card.getByRole('button', { name: /Sodium hydroxide/i }).click()

    // 5. The picker should show all recipes that produce sodium hydroxide.
    //    At minimum: saline electrolysis, brine electrolysis, aluminum ingot 3, unboxing.
    //    The bug caused only "unboxing" to appear because the item name was used as
    //    the text query, filtering out recipes with unrelated names.
    // In Nullius, some recipe names are their raw IDs (e.g. "nullius-saline-electrolysis").
    // Match on the recipe id substring which appears in the button text regardless.
    await expect(pickerOverlay.getByRole('button', { name: /nullius-saline-electrolysis/ })).toBeVisible()
    await expect(pickerOverlay.getByRole('button', { name: /nullius-brine-electrolysis/ })).toBeVisible()
    await expect(pickerOverlay.getByRole('button', { name: /Sodium hydroxide unboxing/i })).toBeVisible()
  })
})
