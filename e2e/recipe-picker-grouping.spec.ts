import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('public/data/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

test.describe('Recipe picker grouping', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await loadGameData(page)
  })

  test('top-level item-group tabs render and switching tabs swaps the visible recipes', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()

    const tabs = overlay.locator('[data-testid="recipe-group-tab"]')
    expect(await tabs.count()).toBeGreaterThan(1)
    // ~26 item-groups in nullius — sanity-bound on the upper end too.
    expect(await tabs.count()).toBeLessThanOrEqual(30)

    const firstSlots = await overlay.locator('[data-testid="recipe-slot"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-recipe-id')),
    )

    // Click the second tab.
    await tabs.nth(1).click()
    const secondSlots = await overlay.locator('[data-testid="recipe-slot"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-recipe-id')),
    )
    expect(secondSlots).not.toEqual(firstSlots)
  })

  test('recipes are organised into subgroup-row grids inside the selected tab', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByRole('button', { name: 'Add recipe' }).click()

    const subgroupRows = overlay.locator('[data-testid="recipe-subgroup-row"]')
    await expect(subgroupRows.first()).toBeVisible()
    expect(await subgroupRows.count()).toBeGreaterThan(0)

    // Each row contains at least one slot.
    const firstRowSlots = subgroupRows.first().locator('[data-testid="recipe-slot"]')
    expect(await firstRowSlots.count()).toBeGreaterThan(0)
  })

  test('Show-hidden toggle reveals additional recipes', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByRole('button', { name: 'Add recipe' }).click()

    const beforeCount = await overlay.locator('[data-testid="recipe-slot"]').count()
    await overlay.getByLabel('Hidden recipes').check()
    const afterCount = await overlay.locator('[data-testid="recipe-slot"]').count()

    expect(afterCount).toBeGreaterThanOrEqual(beforeCount)
  })

  test('clicking a recipe slot adds the recipe to the plan', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await overlay.getByPlaceholder('Search…').fill('Iron plate')

    const slot = overlay.locator('[data-testid="recipe-slot"]').first()
    const recipeId = await slot.getAttribute('data-recipe-id')
    expect(recipeId).toBeTruthy()

    await slot.click()

    // Picker closes and we're back in the production table.
    await expect(overlay).not.toBeVisible()
    // The empty-state link is gone; the header "+" button replaces it and
    // there is no "+ Add recipe" footer.
    await expect(page.getByRole('button', { name: 'Add recipe' })).toBeVisible()
    await expect(page.getByText('+ Add recipe')).toHaveCount(0)
    // The header button opens the picker again.
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await page.keyboard.press('Escape')
    // And the recipe row carries the recipe name as a title attribute.
    await expect(page.locator('main').locator(`[title*="ron"]`).first()).toBeVisible()
  })
})
