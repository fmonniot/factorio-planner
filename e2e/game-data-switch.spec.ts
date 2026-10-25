import { test, expect, type Page } from '@playwright/test'
import { selectDataset, expectDataset } from './support/appMenu'

/** Add a goal of `amount` for the first item in the picker. */
async function addGoal(page: Page, amount: string) {
  const overlay = page.locator('.fixed.inset-0')
  await page.getByTitle('Add product').click()
  await overlay.getByLabel('Amount').fill(amount)
  await overlay.locator('[data-testid="item-slot"]').first().click()
  await expect(overlay).not.toBeVisible()
}

test.describe('per-data-set plans', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
  })

  test('switching data sets swaps the plan and switching back restores it', async ({ page }) => {
    await selectDataset(page, 'Nullius')
    await addGoal(page, '250')
    await expect(page.locator('main')).toContainText('250')

    // Seablock starts with an empty plan, without the Nullius goal.
    await selectDataset(page, 'Seablock')
    await expect(page.locator('main')).not.toContainText('250')
    await expect(page.getByText('Error loading data')).not.toBeVisible()

    // Back to Nullius: the plan is restored.
    await selectDataset(page, 'Nullius')
    await expect(page.locator('main')).toContainText('250')
  })

  test('each data set keeps its own plan across reloads', async ({ page }) => {
    await selectDataset(page, 'Nullius')
    await addGoal(page, '250')
    await selectDataset(page, 'Seablock')
    await addGoal(page, '375')

    await page.reload()
    await expectDataset(page, 'Seablock', { timeout: 10000 })
    await expect(page.locator('main')).toContainText('375', { timeout: 10000 })
    await expect(page.locator('main')).not.toContainText('250')

    await selectDataset(page, 'Nullius')
    await expect(page.locator('main')).toContainText('250')
    await expect(page.locator('main')).not.toContainText('375')
  })

  test('plan editing is disabled until game data is loaded', async ({ page }) => {
    await expect(page.getByTitle('Add block')).toBeDisabled()
    await expect(page.getByTitle('Add product')).not.toBeVisible()
    await selectDataset(page, 'Nullius')
    await expect(page.getByTitle('Add block')).toBeEnabled()
    await expect(page.getByTitle('Add product')).toBeVisible()
  })
})
