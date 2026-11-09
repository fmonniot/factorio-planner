import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { clickRowAction } from './support/rowMenu'
import { slot } from './support/summary'

/** Goals and sub-factories are removed from a right-click menu (no × buttons). */
const FIXTURE = path.resolve('e2e/fixtures/byproduct-add-consumer.json')

test.describe('Removal through right-click menus', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  })

  test('right-click on a goal slot removes the goal', async ({ page }) => {
    const goal = slot(page, 'Products', 'Hydrogen')
    await goal.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove product' }).click()
    await expect(goal).toHaveCount(0)
  })

  test('removing a sub-factory with contents asks for confirmation first', async ({ page }) => {
    const rows = page.locator('main table tbody tr')
    const firstRow = rows.first()

    await clickRowAction(page, firstRow, 'Wrap in subfactory…')
    await page.getByRole('textbox', { name: 'Subfactory name' }).fill('Smelting')
    await page.getByRole('button', { name: 'Wrap', exact: true }).click()
    const subRow = rows.filter({ hasText: 'Smelting' })
    await expect(subRow).toBeVisible()

    await clickRowAction(page, subRow, 'Remove subfactory')
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText('"Smelting"')
    await expect(confirm).toContainText('1 recipe')
    await confirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(subRow).toBeVisible()

    await clickRowAction(page, subRow, 'Remove subfactory')
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove' }).click()
    await expect(subRow).toHaveCount(0)
  })
})
