import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { openRowMenu } from './support/rowMenu'

/**
 * The by-recipe view. The fixture has two copies of the area-row-conveniences block ("Hydrogen",
 * "Hydrogen 2": Top level, Compression, Chlorides) and a "Plain" block without areas. The areas
 * viewer is covered by area-matrix.spec.ts.
 */
const FIXTURE = path.resolve('e2e/fixtures/plan-areas.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'
const COMP_ELEC = 'ffff0011-0000-0000-0000-000000000001'

const row = (page: Page, id: string) => page.locator(`main tr[data-node-id="${id}"]`)

async function open(page: Page): Promise<void> {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page, ROOT_ELEC)).toBeVisible({ timeout: 10000 })
}

test('By recipe shows one line per recipe, opens to its rows per area and is remembered', async ({ page }) => {
  await open(page)

  await page.getByRole('button', { name: 'By recipe' }).click()
  const line = page.locator('[data-testid="recipe-group"][data-recipe-id="nullius-steam-electrolysis"]')
  await expect(line.getByTestId('recipe-group-buildings')).toHaveText(/\d+ buildings?/)
  await expect(row(page, ROOT_ELEC)).toBeHidden()

  await line.getByRole('button', { name: /rows per area/ }).click()
  await expect(row(page, ROOT_ELEC).getByTestId('row-area')).toHaveText('Top level')
  await expect(row(page, COMP_ELEC).getByTestId('row-area')).toHaveText('Compression')

  const menu = await openRowMenu(page, row(page, ROOT_ELEC))
  await menu.getByRole('menuitem', { name: 'Go to row in…' }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: /^Compression · / }).click()
  await expect(row(page, COMP_ELEC)).toHaveAttribute('data-highlighted', 'true')

  // Not a reload: loadPlanFixture seeds the plan again on every navigation.
  const stored = await page.evaluate(() => localStorage.getItem('factorio-planner:ui'))
  expect(stored).toContain('"tableView":"recipe"')
})
