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
    await page.getByRole('menuitem', { name: 'Remove goal' }).click()
    await expect(goal).toHaveCount(0)
  })

  test('removing a sub-factory with contents asks for confirmation first', async ({ page }) => {
    const rows = page.locator('main table tbody tr')
    const firstRow = rows.first()

    page.once('dialog', d => d.accept('Smelting'))
    await clickRowAction(page, firstRow, 'Wrap in subfactory…')
    const subRow = rows.filter({ hasText: 'Smelting' })
    await expect(subRow).toBeVisible()

    let dialogType = ''
    let dialogMessage = ''
    page.once('dialog', d => {
      dialogType = d.type()
      dialogMessage = d.message()
      void d.dismiss()
    })
    await clickRowAction(page, subRow, 'Remove subfactory')
    expect(dialogType).toBe('confirm')
    expect(dialogMessage).toContain('"Smelting"')
    expect(dialogMessage).toContain('1 recipe')
    await expect(subRow).toBeVisible()

    page.once('dialog', d => void d.accept())
    await clickRowAction(page, subRow, 'Remove subfactory')
    await expect(subRow).toHaveCount(0)
  })
})
