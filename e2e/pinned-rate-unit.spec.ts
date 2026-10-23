import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { clickRowAction } from './support/rowMenu'
import { openAppMenu } from './support/appMenu'

/**
 * `pinnedRate` is stored in executions per minute and shown as the primary
 * product's rate. The fixture's primary product (sodium hydroxide) is made 1 per
 * run, so typing 120 in /min mode pins the recipe at 120 executions/min (not 2),
 * and switching to /sec must show the same pin as 2.00. The per-run conversion
 * for amounts != 1 is covered in `RecipeRow.test.tsx`.
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

  // The stored value is per minute: 120, not 2. Independent of the (debounced) solve and of data-set numbers.
  // (The fixture has other pinned recipes, so check membership, not the whole list.)
  await expect.poll(() => storedPinnedRates(page)).toContain(120)
  expect(await storedPinnedRates(page)).not.toContain(2)
  const stored = await storedPinnedRates(page)

  // Switch to /sec: the same pin reads 2.00 and the stored value is untouched.
  const menu = await openAppMenu(page)
  await menu.getByRole('menuitemradio', { name: '/sec' }).click()
  await expect(row.getByLabel('Pinned rate')).toHaveValue('2.00')
  expect(await storedPinnedRates(page)).toEqual(stored)
})

/** Every `pinnedRate` found anywhere in the saved active plan. */
async function storedPinnedRates(page: Page): Promise<number[]> {
  const found: number[] = []
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'pinnedRate' && typeof x === 'number') found.push(x)
        else walk(x)
      }
    }
  }
  walk(await readActivePlan(page, 'nullius'))
  return found
}
