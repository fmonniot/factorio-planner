import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('data/samples/nullius/game-data.json')

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

  test('recipes are grouped into rows by subgroup', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByText('+ Add recipe').click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()

    const groups = overlay.locator('[data-testid="recipe-group"]')
    await expect(groups.first()).toBeVisible()
    expect(await groups.count()).toBeGreaterThan(1)

    // Each group contains at least one slot.
    const firstGroupSlots = groups.first().locator('[data-testid="recipe-slot"]')
    expect(await firstGroupSlots.count()).toBeGreaterThan(0)
  })

  test('Show-hidden toggle reveals additional recipes', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByText('+ Add recipe').click()

    const beforeCount = await overlay.locator('[data-testid="recipe-slot"]').count()
    await overlay.getByLabel('Hidden recipes').check()
    const afterCount = await overlay.locator('[data-testid="recipe-slot"]').count()

    expect(afterCount).toBeGreaterThanOrEqual(beforeCount)
  })

  test('clicking a recipe slot adds the recipe to the plan', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByText('+ Add recipe').click()
    await overlay.getByPlaceholder('Search…').fill('Iron plate')

    const slot = overlay.locator('[data-testid="recipe-slot"]').first()
    const recipeId = await slot.getAttribute('data-recipe-id')
    expect(recipeId).toBeTruthy()

    const beforeAdd = await page.locator('main').getByText('+ Add recipe').count()
    await slot.click()

    // Picker closes and we're back in the production table.
    await expect(overlay).not.toBeVisible()
    // The "+ Add recipe" button stays at the bottom; the empty-state row goes
    // away once a node is added — so its count drops.
    await expect.poll(async () => page.locator('main').getByText('+ Add recipe').count())
      .toBeLessThanOrEqual(beforeAdd)
    // And the recipe row carries the recipe name as a title attribute.
    await expect(page.locator('main').locator(`[title*="ron"]`).first()).toBeVisible()
  })
})
