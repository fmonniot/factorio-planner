import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/** One Seablock block: 12.5% semiheavy water (needs ≤30°C and ≥95°C fluids) plus the enriched H2S recipe (needs 125–165°C steam). */
const FIXTURE = path.resolve('e2e/fixtures/fluid-temperature-seablock.json')

test('ingredient tiles show the temperature a recipe requires', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })

  const semiheavy = page.locator('main button[title="7.5% Semiheavy water (≤30°C) — Find producer recipe"]')
  await expect(semiheavy).toBeVisible()
  await expect(semiheavy).toContainText('≤30°C')

  const h2s = page.locator('main button[title^="Enriched hydrogen sulfide gas (≥95°C)"]')
  await expect(h2s).toContainText('≥95°C')

  const steam = page.locator('main button[title^="Steam (125–165°C)"]')
  await expect(steam).toContainText('125–165°C')

  // Three ingredient badges, plus the explicit temperatures of the recipes' own products.
  await expect(page.locator('main td [data-testid="item-tile-temperature"]')).not.toHaveCount(0)
  await expect(page.locator('main button[title*="°C) — Find producer recipe"] [data-testid="item-tile-temperature"]')).toHaveCount(3)
})

/** Two Seablock blocks making electricity from a carbon boiler (steam at 165°C): one with a steam turbine (needs ≥465°C), one with a steam engine (needs ≥165°C). */
const POWER_FIXTURE = path.resolve('e2e/fixtures/power-temperature-seablock.json')

test('a steam turbine on boiler steam warns, and shows the boiler temperature', async ({ page }) => {
  await loadPlanFixture(page, POWER_FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })

  await expect(page.locator('main button[title="Mismatch"], [data-testid="block-tab"] button[title="Mismatch"]').first()).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('main [title="Steam (165°C)"]').first()).toContainText('165°C')

  const pill = page.getByRole('button', { name: /1 warning/ })
  await expect(pill).toBeVisible()
  await pill.click()
  await expect(page.getByText('Fluid temperature does not fit')).toBeVisible()
  const body = page.getByText(/needs Steam at/)
  await expect(body).toContainText('465°C')
  await expect(body).toContainText('165°C')
})

test('a steam engine on boiler steam raises no warning', async ({ page }) => {
  await loadPlanFixture(page, POWER_FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  await page.locator('[data-testid="block-tab"] button[title="Match"]').click()
  await expect(page.locator('main [title="Steam (165°C)"]').first()).toBeVisible()
  await expect(page.getByTitle('Show solver warnings')).toHaveCount(0)
})
