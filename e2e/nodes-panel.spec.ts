import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('data/samples/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  await expect(page.getByText('Game data loaded')).toBeVisible()
}

test.describe('Nodes panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await loadGameData(page)
  })

  test('add a recipe node and see the recipe card, then remove it', async ({ page }) => {
    // The ItemPicker renders as a fixed overlay — scope interactions to it.
    const pickerOverlay = page.locator('.fixed.inset-0')

    // 1. Add a goal: nullius-chemical-pack at 60/min
    await page.getByRole('button', { name: '+ Add' }).first().click()
    await page.getByPlaceholder('Search items…').fill('nullius-chemical-pack')
    await pickerOverlay.getByRole('button', { name: /nullius-chemical-pack/ }).first().click()

    // 2. Main panel should show the "no nodes" hint
    await expect(page.getByText('Add recipe nodes to the plan')).toBeVisible()

    // 3. Open recipe picker in Nodes panel (second "+ Add" button)
    await page.getByRole('button', { name: '+ Add' }).nth(1).click()
    await expect(page.getByPlaceholder('Search recipes…')).toBeVisible()

    // 4. Search and select nullius-chemical-pack recipe
    await page.getByPlaceholder('Search recipes…').fill('nullius-chemical-pack')
    await pickerOverlay.getByRole('button', { name: /nullius-chemical-pack/ }).first().click()

    // 5. Node appears in the Nodes panel list
    const sidebar = page.locator('aside')
    await expect(sidebar.getByText('nullius-chemical-pack').nth(1)).toBeVisible()

    // 6. Main panel now shows a recipe card (not the hint)
    await expect(page.getByText('Add recipe nodes to the plan')).not.toBeVisible()

    // 7. Remove the node with the × button (scoped to the Nodes section — second ul in sidebar)
    await sidebar.locator('ul').nth(1).getByRole('button', { name: /Remove nullius-chemical-pack/ }).click()

    // 8. Hint message returns
    await expect(page.getByText('Add recipe nodes to the plan')).toBeVisible()
  })
})
