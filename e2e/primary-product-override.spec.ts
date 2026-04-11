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

    // Add Hydrogen as a goal so the solver runs and produces a recipe card.
    await page.getByRole('button', { name: '+ Add' }).first().click()
    await page.getByPlaceholder('Search items…').fill('Hydrogen')
    await overlay.getByRole('button', { name: /^Hydrogen/ }).first().click()

    // Add the brine-electrolysis recipe node.
    await page.getByRole('button', { name: '+ Add' }).nth(1).click()
    await page.getByPlaceholder('Search recipes…').fill('nullius-brine-electrolysis')
    await overlay.getByRole('button', { name: /nullius-brine-electrolysis/ }).first().click()

    // Wait for the recipe card to appear.
    const card = page.locator('main').locator('.bg-gray-800').filter({ hasText: 'nullius-brine-electrolysis' }).first()
    await expect(card).toBeVisible()

    // By default the first product (Hydrogen) is primary.
    // There is exactly 1 ● (Primary product) and the rest show ○ (Set as primary).
    await expect(card.getByTitle('Primary product')).toHaveCount(1)
    await expect(card.getByTitle('Set as primary')).toHaveCount(2)

    // The pin button is always shown on the primary row — exactly 1 visible.
    await expect(card.getByTitle('Pin rate')).toBeVisible()

    // The ● indicator is on the hydrogen output row.
    // We locate it as a div that contains both the ● button and "Hydrogen" text.
    const primaryRowBefore = card.locator('div:has(button[title="Primary product"])').first()
    await expect(primaryRowBefore).toContainText('Hydrogen')

    // Click ○ next to Sodium hydroxide to make it the primary product.
    // Locate the output row for sodium hydroxide by CSS :has().
    const hydroxideRow = card.locator('div:has(button[title="Set as primary"])').filter({ hasText: 'Sodium hydroxide' }).first()
    await hydroxideRow.getByTitle('Set as primary').click()

    // After the switch: still 1 ● and 2 ○.
    await expect(card.getByTitle('Primary product')).toHaveCount(1)
    await expect(card.getByTitle('Set as primary')).toHaveCount(2)

    // The ● indicator is now on the sodium hydroxide row.
    const primaryRowAfter = card.locator('div:has(button[title="Primary product"])').first()
    await expect(primaryRowAfter).toContainText('Sodium hydroxide')

    // The pin button is still visible (now targeting sodium hydroxide).
    await expect(card.getByTitle('Pin rate')).toBeVisible()
  })

  test('single-output recipe shows no ●/○ buttons', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')

    // Add Chemistry research as a goal.
    await page.getByRole('button', { name: '+ Add' }).first().click()
    await page.getByPlaceholder('Search items…').fill('nullius-chemical-pack')
    await overlay.getByRole('button', { name: /Chemistry research/ }).first().click()

    // Add Chemistry research 1 recipe node (single-output).
    await page.getByRole('button', { name: '+ Add' }).nth(1).click()
    await page.getByPlaceholder('Search recipes…').fill('Chemistry research 1')
    await overlay.getByRole('button', { name: 'Chemistry research 1' }).first().click()

    const card = page.locator('main').locator('.bg-gray-800').filter({ hasText: 'Chemistry research 1' }).first()
    await expect(card).toBeVisible()

    // No ● or ○ primary-indicator buttons on single-output recipes.
    await expect(card.getByTitle('Primary product')).not.toBeVisible()
    await expect(card.getByTitle('Set as primary')).not.toBeVisible()

    // Pin button is still present on the sole output row.
    await expect(card.getByTitle('Pin rate')).toBeVisible()
  })
})
