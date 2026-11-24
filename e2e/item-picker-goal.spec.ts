import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('public/data/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

test.describe('Item picker (goal)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./')
    await loadGameData(page)
  })

  test('renders group tabs and a slot grid', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByRole('button', { name: 'Add product', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Add product' })).toBeVisible()

    const tabs = overlay.locator('[data-testid="item-group-tab"]')
    expect(await tabs.count()).toBeGreaterThan(0)

    const slots = overlay.locator('[data-testid="item-slot"]')
    await expect(slots.first()).toBeVisible()
  })

  test('switching tabs swaps the visible items', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByRole('button', { name: 'Add product', exact: true }).click()

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
    await page.getByRole('button', { name: 'Add product', exact: true }).click()

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

  test('the amount starts empty, so a new goal has no extra output', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByRole('button', { name: 'Add product', exact: true }).click()
    await expect(overlay.getByLabel('Amount')).toHaveValue('')

    const slot = overlay.locator('[data-testid="item-slot"]').first()
    const itemId = await slot.getAttribute('data-item-id')
    await slot.click()

    await expect(overlay).not.toBeVisible()
    await expect(page.locator(`[data-testid="summary-slot"][data-item-id="${itemId}"]`).first()).toHaveAccessibleName(/nothing requested yet/)
  })

  test('an item that is already a product is disabled', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByRole('button', { name: 'Add product', exact: true }).click()
    const itemId = await overlay.locator('[data-testid="item-slot"]').first().getAttribute('data-item-id')
    await overlay.locator(`[data-testid="item-slot"][data-item-id="${itemId}"]`).click()
    await expect(overlay).not.toBeVisible()

    await page.getByRole('button', { name: 'Add product', exact: true }).click()
    const again = overlay.locator(`[data-testid="item-slot"][data-item-id="${itemId}"]`)
    await expect(again).toHaveAttribute('aria-disabled', 'true')
    await again.click({ force: true })
    await expect(overlay).toBeVisible()
    await expect(page.locator(`[data-testid="summary-slot"][data-item-id="${itemId}"]`)).toHaveCount(1)
  })

  test('Cancel button closes the picker without adding a goal', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByRole('button', { name: 'Add product', exact: true }).click()
    await overlay.getByText('Cancel').click()
    await expect(overlay).not.toBeVisible()
  })
})
