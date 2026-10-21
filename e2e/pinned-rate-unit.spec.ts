import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { clickRowAction } from './support/rowMenu'
import { openAppMenu } from './support/appMenu'

/**
 * `pinnedRate` is stored in executions per minute. Typing 120 in /min mode
 * must pin the recipe at 120 executions/min (not 2), and switching to /sec
 * must show the same pin as 2.00.
 */
test('pinned rate is stored per minute and shown in the current unit', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/pin-recipe-not-working.json'))
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  const row = page.locator('main table tbody tr')
    .filter({ has: page.locator('[title="Saline electrolysis"]') }).first()
  await expect(row).toBeVisible({ timeout: 5000 })

  await clickRowAction(page, row, 'Pin rate')
  const pinnedInput = row.getByLabel('Pinned rate')
  await pinnedInput.fill('120')
  await pinnedInput.press('Tab')

  // 120 executions/min: the first ingredient is 110/min (it would be ~1.8/min at 2 executions/min).
  await expect(row).toContainText('110/m')

  // Switch to /sec: the same pin reads 2.00.
  const menu = await openAppMenu(page)
  await menu.getByRole('menuitemradio', { name: '/sec' }).click()
  await expect(row.getByLabel('Pinned rate')).toHaveValue('2.00')
  await expect(row).toContainText('1.83/s')
})
