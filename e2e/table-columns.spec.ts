import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

const FIXTURE = path.resolve('e2e/fixtures/separate-area.json')

test('the table has the redesigned column order, a power cell per row and chevron buttons on groups', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })

  const headers = await page.locator('main table thead th').allInnerTexts()
  expect(headers.map(h => h.split('\n')[0].trim()).filter(Boolean)).toEqual([
    'Recipe', 'Machine', 'Beacons', 'Products', 'Byproducts', 'Ingredients', 'Power',
  ])

  const chevron = page.getByRole('button', { name: /^(Expand|Collapse) Compression$/ })
  await expect(chevron).toHaveAttribute('aria-expanded', 'false')
  await chevron.click()
  await expect(chevron).toHaveAttribute('aria-expanded', 'true')
  // A row inside the group draws one guide.
  await expect(page.locator('main table tbody td[data-guide-levels="1"]').first()).toBeVisible()
  await expect(page.locator('main table tbody').getByTestId('row-power').first()).toBeVisible()
})
