import { test, expect } from '@playwright/test'
import path from 'path'

const GAME_DATA_PATH = path.resolve('public/data/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

test.describe('Picker keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('./')
    await loadGameData(page)
    // Global keys only count outside a field.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  })

  test('A opens Add product without typing the letter, and not from a field', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.keyboard.press('a')
    await expect(page.getByRole('heading', { name: 'Add product' })).toBeVisible()
    const search = overlay.getByPlaceholder('Search…')
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('')

    await page.keyboard.type('a')
    await expect(search).toHaveValue('a')
    await expect(page.getByRole('heading', { name: 'Add product' })).toHaveCount(1)

    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    await page.getByRole('button', { name: 'Add product', exact: true }).click()
    await overlay.getByLabel('Amount').focus()
    await page.keyboard.press('a')
    await expect(page.getByRole('heading', { name: 'Add product' })).toHaveCount(1)
    await expect(overlay.getByLabel('Amount')).toHaveValue('')
  })

  test('arrow keys move through the item slots and Enter picks one', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.keyboard.press('a')
    const slots = overlay.locator('[data-testid="item-slot"]')
    await expect(slots.first()).toBeVisible()

    await page.keyboard.press('ArrowDown')
    await expect(slots.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(slots.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(slots.nth(0)).toBeFocused()

    const first = (await slots.nth(0).boundingBox())!
    await page.keyboard.press('ArrowDown')
    const below = await page.evaluate(() => {
      const r = document.activeElement!.getBoundingClientRect()
      return { top: r.top, cx: r.left + r.width / 2 }
    })
    expect(below.top).toBeGreaterThan(first.y)
    expect(Math.abs(below.cx - (first.x + first.width / 2))).toBeLessThan(first.width)
    await page.keyboard.press('ArrowUp')
    await expect(slots.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(overlay.getByPlaceholder('Search…')).toBeFocused()

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    const id = await slots.nth(1).getAttribute('data-item-id')
    await page.keyboard.press('Enter')
    await expect(overlay).not.toBeVisible()
    await expect(page.locator(`[data-testid="summary-slot"][data-item-id="${id}"]`).first()).toBeVisible()
  })

  test('Enter in the search or Amount picks the first enabled match', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.keyboard.press('a')
    const search = overlay.getByPlaceholder('Search…')

    await page.keyboard.press('Enter')
    await expect(overlay).toBeVisible()

    await search.fill('plate')
    const id = await overlay.locator('[data-testid="item-slot"]:not([aria-disabled="true"])').first().getAttribute('data-item-id')
    await overlay.getByLabel('Amount').fill('90')
    await overlay.getByLabel('Amount').press('Enter')
    await expect(overlay).not.toBeVisible()
    await expect(page.locator('main')).toContainText('90')
    await expect(page.locator(`[data-testid="summary-slot"][data-item-id="${id}"]`).first()).toBeVisible()
  })

  test('the recipe picker takes ArrowDown into the grid and Enter in the search', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await overlay.getByPlaceholder('Search…').fill('Chemistry research 1')
    await page.keyboard.press('ArrowDown')
    await expect(overlay.locator('[data-testid="recipe-slot"]').first()).toBeFocused()
    await expect(overlay.getByTestId('recipe-detail-panel')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(overlay).not.toBeVisible()

    const names = page.locator('main').locator('[data-testid="recipe-name"]')
    const before = await names.count()
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await overlay.getByPlaceholder('Search…').fill('Chemistry research 1')
    await overlay.getByPlaceholder('Search…').press('Enter')
    await expect(overlay).not.toBeVisible()
    await expect(names).toHaveCount(before + 1)
  })
})
