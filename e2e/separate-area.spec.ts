import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { openRowMenu } from './support/rowMenu'

/**
 * A sub-factory becomes a separate area from its right-click menu. The fixture builds steam
 * electrolysis in the root and in "Compression" (a duplicate while the sub-factory only organises
 * rows); as an area, each of the two serves its own side.
 */
const FIXTURE = path.resolve('e2e/fixtures/separate-area.json')

test('a sub-factory solved as a separate area gets its own row, and the toggle persists', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  const rows = page.locator('main table tbody tr')
  await expect(rows.first()).toBeVisible({ timeout: 10000 })

  // Organising only: the second electrolysis row is a duplicate.
  const warnings = page.getByRole('button', { name: /warning/ })
  await expect(warnings).toBeVisible()
  await warnings.click()
  await expect(page.getByText('Duplicate recipe')).toBeVisible()
  await warnings.click()

  const compression = rows.filter({ hasText: 'Compression' })
  await compression.getByText('Compression').click()
  const counts = page.getByTestId('machine-count')
  await expect(counts).toHaveCount(3)
  await expect(counts.nth(1)).toHaveText('0')

  const menu = await openRowMenu(page, compression)
  const toggle = menu.getByRole('menuitemcheckbox', { name: 'Separate area' })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()

  const areas = page.getByRole('region', { name: 'Areas' })
  await expect(page.getByTestId('area-marker')).toBeVisible()
  await expect(warnings).toHaveCount(0)
  await expect(counts.nth(0)).not.toHaveText('0')
  await expect(counts.nth(1)).not.toHaveText('0')
  await expect(areas.getByRole('listitem', { name: 'Top level' })).toBeVisible()
  const compressionArea = areas.getByRole('listitem', { name: 'Compression' })
  await expect(compressionArea).toBeVisible()
  await expect(compressionArea.locator('[data-item-id="nullius-hydrogen"]')).toHaveCount(0)
  await expect(
    compressionArea.locator('[data-item-id="nullius-compressed-hydrogen"][data-direction="sends"]'),
  ).toHaveCount(1)

  // The flag is saved with the plan. (A reload cannot show it: the fixture seeds storage on every navigation.)
  const savedArea = async () => {
    const plan = (await readActivePlan(page, 'nullius')) as { blocks: { rootPlan: { subPlans: { area?: boolean }[] } }[] }
    return plan.blocks[0].rootPlan.subPlans[0].area
  }
  await expect.poll(savedArea).toBe(true)

  // Off again: the Areas pane goes and the duplicate is back.
  const again = await openRowMenu(page, compression)
  await again.getByRole('menuitemcheckbox', { name: 'Separate area' }).click()
  await expect(areas).toHaveCount(0)
  await expect(page.getByTestId('area-marker')).toHaveCount(0)
  await expect.poll(savedArea).toBeUndefined()
  await warnings.click()
  await expect(page.getByText('Duplicate recipe')).toBeVisible()
})
