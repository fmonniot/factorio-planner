import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('data/samples/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

test.describe('Item picker (goal)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await loadGameData(page)
  })

  test('renders group tabs and a slot grid', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByTitle('Add goal').click()
    await expect(page.getByRole('heading', { name: 'Add product' })).toBeVisible()

    const tabs = overlay.locator('[data-testid="item-group-tab"]')
    expect(await tabs.count()).toBeGreaterThan(0)

    const slots = overlay.locator('[data-testid="item-slot"]')
    await expect(slots.first()).toBeVisible()
  })

  test('switching tabs swaps the visible items', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByTitle('Add goal').click()

    const tabs = overlay.locator('[data-testid="item-group-tab"]')
    if (await tabs.count() < 2) test.skip(true, 'Need at least 2 groups to test switching')

    const firstSlots = await overlay.locator('[data-testid="item-slot"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-item-id')),
    )

    await tabs.nth(1).click()

    const secondSlots = await overlay.locator('[data-testid="item-slot"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-item-id')),
    )

    expect(secondSlots).not.toEqual(firstSlots)
  })

  test('clicking a slot adds a goal with the entered amount', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByTitle('Add goal').click()

    // Enter a non-default amount.
    const amount = overlay.getByLabel('Amount')
    await amount.fill('250')

    // Pick the first available item.
    const slot = overlay.locator('[data-testid="item-slot"]').first()
    const itemId = await slot.getAttribute('data-item-id')
    expect(itemId).toBeTruthy()
    await slot.click()

    // Picker closes and a goal tile with the amount appears.
    await expect(overlay).not.toBeVisible()
    await expect(page.locator('main')).toContainText('250')
  })

  test('Cancel button closes the picker without adding a goal', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByTitle('Add goal').click()
    await overlay.getByText('Cancel').click()
    await expect(overlay).not.toBeVisible()
  })
})
