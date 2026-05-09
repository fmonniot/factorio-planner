import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('public/data/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  // Wait until the "load game data" hint disappears from the main area.
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

test.describe('Nodes panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await loadGameData(page)
  })

  test('add a goal and recipe node, then verify the row appears', async ({ page }) => {
    const pickerOverlay = page.locator('.fixed.inset-0')

    // 1. Add a goal via the Products [+] button in FactorySummary
    await page.getByTitle('Add goal').click()
    await pickerOverlay.getByPlaceholder('Search…').fill('nullius-chemical-pack')
    await pickerOverlay.locator('[data-testid="item-slot"]').first().click()

    // 2. Main panel should show the "no recipes yet" state
    await expect(page.getByText('No recipes yet')).toBeVisible()

    // 3. Open recipe picker via "+ Add recipe" in ProductionTable
    await page.getByText('+ Add recipe').click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()

    // 4. Search and select nullius-chemical-pack recipe
    await pickerOverlay.getByPlaceholder('Search…').fill('nullius-chemical-pack')
    await pickerOverlay.locator('[data-testid="recipe-slot"][title="Chemistry research 1"]').click()

    // 5. Recipe row appears in the production table
    const row = page.locator('main table tbody tr').filter({ has: page.locator('[title="Chemistry research 1"]') }).first()
    await expect(row).toBeVisible()

    // 6. "No recipes yet" is gone
    await expect(page.getByText('No recipes yet')).not.toBeVisible()
  })

  test('module popover opens and modules can be added', async ({ page }) => {
    const pickerOverlay = page.locator('.fixed.inset-0')

    // Set up: goal + recipe node for nullius-chemical-pack.
    await page.getByTitle('Add goal').click()
    await pickerOverlay.getByPlaceholder('Search…').fill('nullius-chemical-pack')
    await pickerOverlay.locator('[data-testid="item-slot"]').first().click()

    await page.getByText('+ Add recipe').click()
    await pickerOverlay.getByPlaceholder('Search…').fill('nullius-chemical-pack')
    await pickerOverlay.locator('[data-testid="recipe-slot"][title="Chemistry research 1"]').click()

    // Wait for the row to appear.
    const row = page.locator('main table tbody tr').filter({ has: page.locator('[title="Chemistry research 1"]') }).first()
    await expect(row).toBeVisible()

    // The module cell shows slot count — click it to open the module popover.
    const moduleBtn = row.getByTitle('Edit modules')
    await expect(moduleBtn).toBeVisible()
    await moduleBtn.click()

    // Module popover appears with a slot count indicator.
    await expect(page.getByText(/\/\d+/)).toBeVisible()
  })
})
