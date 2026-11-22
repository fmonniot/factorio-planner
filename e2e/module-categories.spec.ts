import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { selectRow } from './support/sidePanel'

/**
 * One Seablock block: Tinned wire (it allows productivity) in an Assembling machine 2, holding two Agriculture modules.
 * Their effects fit the machine, so only the machine's module categories reject them.
 */
const FIXTURE = path.resolve('e2e/fixtures/module-categories-seablock.json')
const AGRICULTURE = 'angels-bio-yield-module'

test('a module the machine does not accept by category is flagged, listed nowhere and still stored', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE, 'kompetenz-seablock')
  const row = page.locator('main table tbody tr').first()
  await expect(row).toBeVisible({ timeout: 10000 })

  // Nothing is stripped on load.
  expect(JSON.stringify(await readActivePlan(page, 'kompetenz-seablock'))).toContain(AGRICULTURE)

  // The row's module chip is flagged and still counts both modules.
  const chip = row.getByTestId('module-chip')
  await expect(chip).toHaveAttribute('data-incompatible', 'true')
  await expect(chip).toContainText('2/2')

  // The warnings pill names the module, the machine and the category.
  const pill = page.getByTitle('Show solver warnings')
  await expect(pill).toContainText('1 warning')
  await pill.click()
  const popover = page.getByTestId('warnings-popover')
  await expect(popover).toContainText('Module not accepted')
  await expect(popover).toContainText('Agriculture module')
  await expect(popover).toContainText('Assembling machine 2')
  await expect(popover).toContainText('angels-bio-yield')
  await page.keyboard.press('Escape')

  // The Machine section says so, and its slot pickers no longer offer the module.
  const panel = await selectRow(page, row)
  await expect(panel.getByTestId('machine-module-not-allowed')).toContainText('Agriculture module cannot be inserted in Assembling machine 2')
  const machine = panel.getByTestId('panel-machine')
  const option = (id: string) => page.locator(`[data-testid="module-option"][data-module-id="${id}"]`)

  await machine.getByTestId('module-slot').first().click()
  await expect(option(AGRICULTURE)).toHaveCount(0)
  await expect(option('productivity-module')).toHaveCount(1)
  await option('productivity-module').click()
  // One Agriculture module is left (listed first: slots follow module ids).
  await expect(pill).toContainText('1 warning')

  await machine.getByTestId('module-slot').first().click()
  await option('productivity-module').click()
  await expect(pill).toHaveCount(0)
  await expect(panel.getByTestId('machine-module-not-allowed')).toHaveCount(0)

  // The fill-all shortcut of an empty chip leaves the module out too.
  for (let i = 0; i < 2; i++) {
    await machine.getByTestId('module-slot').first().click()
    await page.getByTestId('module-option-empty').click()
  }
  await row.getByTestId('module-chip').click()
  expect(await page.getByTestId('module-fill-option').count()).toBeGreaterThan(0)
  await expect(page.locator(`[data-testid="module-fill-option"][data-module-id="${AGRICULTURE}"]`)).toHaveCount(0)
  await expect(page.locator('[data-testid="module-fill-option"][data-module-id="productivity-module"]')).toHaveCount(1)
})
