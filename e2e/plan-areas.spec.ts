import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { openRowMenu } from './support/rowMenu'

/**
 * The plan-level list of areas and the by-recipe view. The fixture has two copies of the
 * area-row-conveniences block ("Hydrogen", "Hydrogen 2": Top level, Compression, Chlorides) and a
 * "Plain" block without areas.
 */
const FIXTURE = path.resolve('e2e/fixtures/plan-areas.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'
const COMP_ELEC = 'ffff0011-0000-0000-0000-000000000001'
const COMP_HANDLE_2 = 'eeee0005-0000-0000-0000-000000000001'

const row = (page: Page, id: string) => page.locator(`main tr[data-node-id="${id}"]`)

async function open(page: Page): Promise<void> {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page, ROOT_ELEC)).toBeVisible({ timeout: 10000 })
}

test('the plan-level list shows the areas of every block and jumps to one', async ({ page }) => {
  await open(page)

  await page.getByRole('button', { name: 'Areas in every block' }).click()
  const first = page.getByRole('region', { name: 'Hydrogen', exact: true })
  const second = page.getByRole('region', { name: 'Hydrogen 2' })
  for (const s of [first, second]) {
    await expect(s.getByRole('listitem')).toHaveText([/^Top level/, /^Compression/, /^Chlorides/])
  }
  await expect(page.getByText(/1 block without areas not listed/)).toBeVisible()

  await page.getByLabel('Filter areas').fill('Chlorides')
  await expect(page.locator('div.fixed.inset-0').getByRole('listitem')).toHaveCount(2)
  await page.getByLabel('Filter areas').fill('')

  await first.locator('button[data-item-id="nullius-compressed-hydrogen"]').first().click()
  await expect(first.locator('button[data-item-id="nullius-compressed-hydrogen"]').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(second.locator('button[data-item-id="nullius-compressed-hydrogen"]').first()).toHaveAttribute('aria-pressed', 'true')

  await second.getByRole('button', { name: 'Compression' }).click()
  await expect(page.getByLabel('Filter areas')).toHaveCount(0)
  await expect(page.locator('button[title="Hydrogen 2"]')).toHaveAttribute('aria-current', 'true')
  await expect(row(page, COMP_HANDLE_2)).toHaveAttribute('data-highlighted', 'true')
})

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
