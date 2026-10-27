import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

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
