import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { selectRow } from './support/sidePanel'

/** One Seablock block: 60 iron plates/min smelted in stone furnaces (90 kW, 7 s per run of 2 plates). */
const FIXTURE = path.resolve('e2e/fixtures/burner-fuel-seablock.json')

test('a burner row burns a fuel that is one of its ingredients', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE, 'kompetenz-seablock')
  const row = page.locator('main table tbody tr').first()
  await expect(row).toBeVisible({ timeout: 10000 })

  // Default: the lowest-value accepted fuel (Seablock: cellulose fiber, 1 MJ), as an ingredient tile; no electricity draw.
  const fuel = row.locator('[data-fuel="true"]')
  await expect(fuel).toHaveCount(1)
  await expect(fuel).toHaveAttribute('data-variant', 'ingredient')
  await expect(fuel).toHaveAttribute('title', /^Fuel: Cellulose fiber — Find producer recipe — \S+$/)
  await expect(row.locator('[data-testid="row-power"]')).toHaveCount(0)

  // Pick solid fuel in the side panel's Machine section.
  await selectRow(page, row)
  await expect(page.getByTestId('fuel-button')).toContainText('Cellulose fiber')
  await page.getByTestId('fuel-button').click()
  await page.locator('[data-testid="fuel-option"][data-item-id="solid-fuel"]').click()
  await expect(page.getByTestId('fuel-button')).toContainText('Solid fuel')

  // 30 runs/min x 7 s = 3.5 furnaces; 3.5 x 90 kW / 12 MJ = 0.02625 /s = 1.575 /min.
  await expect(fuel).toHaveAttribute('title', /^Fuel: Solid fuel — Find producer recipe — \S+$/)
  // The chip reads the compact 1.6 (chipFmt); the title keeps the exact rate.
  await expect(fuel).toContainText(/^1\.6$/)
  await expect(fuel).toHaveAttribute('title', /1\.57\/m$/)
  await expect(row.locator('[data-testid="row-power"]')).toHaveCount(0)

  // The choice is saved with the plan.
  const saved = JSON.stringify(await readActivePlan(page, 'kompetenz-seablock'))
  expect(saved).toContain('"fuelItemId":"solid-fuel"')

  // The fuel tile finds the producers of the fuel.
  await fuel.click()
  const overlay = page.locator('.fixed.inset-0')
  await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
  await expect(overlay.locator('text=/Choose a recipe to produce /')).toBeVisible()
  expect(await overlay.locator('[data-testid="recipe-slot"]').count()).toBeGreaterThan(0)
})
