import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Fixture: hydrogen goal (100/min) + steam electrolysis only, so oxygen is a
 * surplus byproduct. Right-clicking an oxygen tile (row or summary) offers
 * "Add consumer recipe…", which opens a recipe picker filtered to recipes that
 * take oxygen as an ingredient.
 */
const FIXTURE = path.resolve('e2e/fixtures/byproduct-add-consumer.json')

async function waitForRows(page: Page) {
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
}

const SUBTITLE = "Choose a recipe that consumes 'Oxygen'"

test.describe('Byproduct: add consumer recipe', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await waitForRows(page)
  })

  test('row tile: right-click, pick a consumer, row appears', async ({ page }) => {
    const row = page.locator('main table tbody tr').filter({ has: page.locator('[title="Steam electrolysis"]') }).first()
    await row.getByTitle(/^Oxygen — Set as primary/).click({ button: 'right' })
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Add consumer recipe…' })).toBeVisible()
    await page.getByRole('menuitem', { name: 'Add consumer recipe…' }).click()

    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expect(page.getByText(SUBTITLE)).toBeVisible()
    await expect(page.locator('[data-recipe-id="nullius-steam-electrolysis"]')).toHaveCount(0)

    const overlay = page.locator('.fixed.inset-0')
    await overlay.getByPlaceholder('Search…').fill('nullius-acid-nitric')
    const slot = overlay.locator('[data-testid="recipe-slot"][data-recipe-id="nullius-acid-nitric"]')
    await slot.hover()
    await expect(page.getByTestId('recipe-detail-panel')).toContainText('Oxygen')
    await slot.click()

    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
    await expect(page.locator('main table tbody tr [title="Nitric acid"]').first()).toBeVisible()
  })

  test('summary tile: right-click, pick a consumer, row appears', async ({ page }) => {
    await page.getByTitle('Oxygen — right-click to add a consumer recipe', { exact: true }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Add consumer recipe…' }).click()

    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expect(page.getByText(SUBTITLE)).toBeVisible()

    const overlay = page.locator('.fixed.inset-0')
    await overlay.getByPlaceholder('Search…').fill('nullius-acid-sulfuric')
    await overlay.locator('[data-testid="recipe-slot"][data-recipe-id="nullius-acid-sulfuric"]').click()

    await expect(page.locator('main table tbody tr [title="Sulfuric acid"]').first()).toBeVisible()
  })

  test('Escape closes the menu without opening the picker', async ({ page }) => {
    await page.getByTitle('Oxygen — right-click to add a consumer recipe', { exact: true }).click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).not.toBeVisible()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
  })
})
