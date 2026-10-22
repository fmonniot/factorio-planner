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

  await expect(page.locator('main [data-testid="item-tile-temperature"]')).toHaveCount(3)
})
