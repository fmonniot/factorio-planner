import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { clickRowAction } from './support/rowMenu'

/** A sub-factory is renamed from its right-click menu. */
const FIXTURE = path.resolve('e2e/fixtures/byproduct-add-consumer.json')

test.describe('Rename subfactory through the right-click menu', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  })

  test('renames a sub-factory, and a cancelled dialog leaves it unchanged', async ({ page }) => {
    const rows = page.locator('main table tbody tr')
    const nameBox = page.getByRole('textbox', { name: 'Subfactory name' })

    await clickRowAction(page, rows.first(), 'Wrap in subfactory…')
    await nameBox.fill('Smelting')
    await page.getByRole('button', { name: 'Wrap', exact: true }).click()
    const subRow = rows.filter({ hasText: 'Smelting' })
    await expect(subRow).toBeVisible()

    await clickRowAction(page, subRow, 'Rename subfactory…')
    await expect(nameBox).toHaveValue('Smelting')
    await nameBox.fill('Furnaces')
    await nameBox.press('Enter')
    await expect(rows.filter({ hasText: 'Furnaces' })).toBeVisible()
    await expect(rows.filter({ hasText: 'Smelting' })).toHaveCount(0)

    await clickRowAction(page, rows.filter({ hasText: 'Furnaces' }), 'Rename subfactory…')
    await nameBox.fill('Nope')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(rows.filter({ hasText: 'Furnaces' })).toBeVisible()
  })
})
