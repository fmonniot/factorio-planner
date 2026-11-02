import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'

/** One Seablock block: 60 iron plates/min smelted in stone furnaces (90 kW, 7 s per run of 2 plates). */
const FIXTURE = path.resolve('e2e/fixtures/burner-fuel-seablock.json')

// The bundled Seablock data has no fuel data until it is re-patched with `--patch-fuel` (see the backlog), so the
// test adds the fields the exporter writes: burner machines accept the chemical category, wood is 2 MJ, solid fuel 12 MJ.
test.beforeEach(async ({ page }) => {
  await page.route('**/data/kompetenz-seablock/game-data.json', async route => {
    const response = await route.fetch()
    const bundle = await response.json()
    bundle.machines['stone-furnace'].fuelCategories = ['chemical']
    bundle.items.wood = { ...bundle.items.wood, fuelValueKj: 2000, fuelCategory: 'chemical' }
    bundle.items['solid-fuel'] = { ...bundle.items['solid-fuel'], fuelValueKj: 12000, fuelCategory: 'chemical' }
    await route.fulfill({ response, json: bundle })
  })
})

test('a burner row burns a fuel that is one of its ingredients', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE, 'kompetenz-seablock')
  const row = page.locator('main table tbody tr').first()
  await expect(row).toBeVisible({ timeout: 10000 })

  // Default: the lowest-value accepted fuel, as an ingredient tile; no electricity draw.
  const fuel = row.locator('[data-fuel="true"]')
  await expect(fuel).toHaveCount(1)
  await expect(fuel).toHaveAttribute('data-variant', 'ingredient')
  await expect(fuel).toHaveAttribute('title', 'Fuel: Wood — Find producer recipe')
  await expect(row.locator('[data-variant="electricity"]')).toHaveCount(0)

  // Pick solid fuel in the Edit machine modal.
  await row.getByTitle('Stone furnace', { exact: true }).click()
  await expect(page.getByTestId('fuel-button')).toContainText('Wood')
  await page.getByTestId('fuel-button').click()
  await page.locator('[data-testid="fuel-option"][data-item-id="solid-fuel"]').click()
  await expect(page.getByTestId('fuel-button')).toContainText('Solid fuel')
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()

  // 30 runs/min x 7 s = 3.5 furnaces; 3.5 x 90 kW / 12 MJ = 0.02625 /s = 1.575 /min.
  await expect(fuel).toHaveAttribute('title', 'Fuel: Solid fuel — Find producer recipe')
  await expect(fuel).toContainText(/^1\.57\/m$/)
  await expect(row.locator('[data-variant="electricity"]')).toHaveCount(0)

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
