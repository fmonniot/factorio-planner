import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('data/samples/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  // Wait until the "no game data" hint disappears from the main area.
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

test.describe('Nodes panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await loadGameData(page)
  })

  test('add a recipe node and see the recipe card, then remove it', async ({ page }) => {
    // The ItemPicker renders as a fixed overlay — scope interactions to it.
    const pickerOverlay = page.locator('.fixed.inset-0')

    // 1. Add a goal: nullius-chemical-pack (displayed as "Chemistry research")
    await page.getByRole('button', { name: '+ Add' }).first().click()
    await page.getByPlaceholder('Search items…').fill('nullius-chemical-pack')
    await pickerOverlay.getByRole('button', { name: /Chemistry research/ }).first().click()

    // 2. Main panel should show the "no nodes" hint
    await expect(page.getByText('Add recipe nodes to the plan')).toBeVisible()

    // 3. Open recipe picker in Nodes panel (second "+ Add" button)
    await page.getByRole('button', { name: '+ Add' }).nth(1).click()
    await expect(page.getByPlaceholder('Search recipes…')).toBeVisible()

    // 4. Search and select nullius-chemical-pack recipe (displayed as "Chemistry research 1")
    await page.getByPlaceholder('Search recipes…').fill('nullius-chemical-pack')
    await pickerOverlay.getByRole('button', { name: /Chemistry research 1/ }).first().click()

    // 5. Node appears in the Nodes panel list with its recipe name
    const sidebar = page.locator('aside')
    await expect(sidebar.getByText('Chemistry research 1')).toBeVisible()

    // 6. Main panel now shows a recipe card (not the hint)
    await expect(page.getByText('Add recipe nodes to the plan')).not.toBeVisible()

    // 7. Remove the node with the × button
    await sidebar.getByRole('button', { name: /Remove Chemistry research 1/ }).click()

    // 8. Hint message returns
    await expect(page.getByText('Add recipe nodes to the plan')).toBeVisible()
  })

  test('module section stays open after adding a module', async ({ page }) => {
    const pickerOverlay = page.locator('.fixed.inset-0')

    // Set up: goal + recipe node for nullius-chemical-pack.
    // nullius-chemical-plant-3 (the default machine) has 3 module slots.
    await page.getByRole('button', { name: '+ Add' }).first().click()
    await page.getByPlaceholder('Search items…').fill('nullius-chemical-pack')
    await pickerOverlay.getByRole('button', { name: /Chemistry research/ }).first().click()

    await page.getByRole('button', { name: '+ Add' }).nth(1).click()
    await page.getByPlaceholder('Search recipes…').fill('nullius-chemical-pack')
    await pickerOverlay.getByRole('button', { name: /Chemistry research 1/ }).first().click()

    // Wait for the recipe card to appear in the main area.
    const card = page.locator('main').locator('.bg-gray-800').filter({ hasText: 'Chemistry research 1' }).first()
    await expect(card).toBeVisible()

    // Expand the Modules section.
    const moduleSection = card.locator('section').filter({ hasText: 'Modules' })
    await moduleSection.getByRole('button', { name: /Modules/ }).click()
    // The add-module combobox is visible when the section is open.
    await expect(moduleSection.getByRole('combobox')).toBeVisible()

    // Add a module — option value is the module id, label is the display name.
    await moduleSection.getByRole('combobox').selectOption({ value: 'nullius-haste-module-1' })
    await moduleSection.getByRole('button', { name: 'Add' }).click()

    // The section must still be open: the added module is listed and the
    // combobox for the next module is still visible — proving the card was NOT
    // unmounted and remounted during the re-solve triggered by the mutation.
    await expect(moduleSection.getByText('Haste module 1')).toBeVisible()
    await expect(moduleSection.getByRole('combobox')).toBeVisible()
  })
})
