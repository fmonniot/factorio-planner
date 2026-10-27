import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * A plan saved when dragging a sub-factory's handle into another plan left the sub-factory stored
 * where it was. The fixture shows "Electrolysers" under the "Compression" area (its handle is
 * there) but stores it under Main, so the loader has to move it. Electrolysis is built in the
 * top level and in Electrolysers.
 */
const FIXTURE = path.resolve('e2e/fixtures/stranded-subplan.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'
const GROUP_ELEC = 'ffff0011-0000-0000-0000-000000000001'

const row = (page: Page, id: string) => page.locator(`main tr[data-node-id="${id}"]`)

test('a sub-factory shown under an area belongs to that area', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page, ROOT_ELEC)).toBeVisible({ timeout: 10000 })

  await page.getByRole('button', { name: 'By recipe' }).click()
  const line = page.locator('[data-testid="recipe-group"][data-recipe-id="nullius-steam-electrolysis"]')
  await line.getByRole('button', { name: /rows per area/ }).click()
  await expect(row(page, ROOT_ELEC).getByTestId('row-area')).toHaveText('Top level')
  await expect(row(page, GROUP_ELEC).getByTestId('row-area')).toHaveText('Compression')

  // Two rows of one recipe in one area would be a duplicate; in two areas they are not.
  await expect(page.getByText(/duplicate/i)).toHaveCount(0)
})
