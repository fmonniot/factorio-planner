import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('public/data/nullius/game-data.json')

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

  test('hovering a recipe slot shows the redesigned detail panel', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')

    await page.getByText('+ Add recipe').click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()

    // Narrow to a single result.
    await overlay.getByPlaceholder('Search…').fill('Chemistry research 1')
    const slot = overlay.locator('[data-testid="recipe-slot"]').first()
    await expect(slot).toBeVisible()

    // No detail panel before hover.
    await expect(overlay.getByTestId('recipe-detail-panel')).not.toBeVisible()

    await slot.hover()
    const detail = overlay.getByTestId('recipe-detail-panel')
    await expect(detail).toBeVisible()

    // Header carries the (Recipe) suffix.
    await expect(detail).toContainText('(Recipe)')

    // Sectioned body.
    await expect(detail.getByText('Ingredients:')).toBeVisible()
    await expect(detail.getByText('Crafting time')).toBeVisible()
    await expect(detail.getByText('Products:')).toBeVisible()
    await expect(detail.getByText('Made in:')).toBeVisible()

    // Made-in lists at least one machine.
    await expect(detail.getByText(/Chemical plant 3/).first()).toBeVisible()
  })

  test('detail panel disappears when cursor leaves the slot', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByText('+ Add recipe').click()
    await overlay.getByPlaceholder('Search…').fill('Chemistry research 1')

    const slot = overlay.locator('[data-testid="recipe-slot"]').first()
    await slot.hover()
    await expect(overlay.getByTestId('recipe-detail-panel')).toBeVisible()

    // Move the mouse out of the slot.
    await page.mouse.move(10, 10)
    await expect(overlay.getByTestId('recipe-detail-panel')).not.toBeVisible()
  })

  test('detail panel updates when hovering a different recipe', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByText('+ Add recipe').click()
    await overlay.getByPlaceholder('Search…').fill('Chemistry research')

    const slots = overlay.locator('[data-testid="recipe-slot"]')
    await expect(slots.first()).toBeVisible()

    // Hover first slot.
    await slots.nth(0).hover()
    const detail = overlay.getByTestId('recipe-detail-panel')
    const firstHeader = await detail.locator('.font-semibold').first().textContent()

    // Hover a different slot.
    await slots.nth(1).hover()
    const secondHeader = await detail.locator('.font-semibold').first().textContent()
    expect(secondHeader).not.toEqual(firstHeader)
  })

  test('item-mode picker has no recipe detail panel', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByTitle('Add goal').click()
    await expect(page.getByRole('heading', { name: 'Add product' })).toBeVisible()

    const slot = overlay.locator('[data-testid="item-slot"]').first()
    await expect(slot).toBeVisible()
    await slot.hover()

    // No recipe detail panel exists in items mode.
    await expect(overlay.getByTestId('recipe-detail-panel')).not.toBeVisible()
  })
})
