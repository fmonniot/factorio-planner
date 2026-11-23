import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, pane, selectSlot, slot } from './support/summary'

/** One Seablock block: 12.5% semiheavy water (needs ≤30°C and ≥95°C fluids) plus the enriched H2S recipe (needs 125–165°C steam). */
const FIXTURE = path.resolve('e2e/fixtures/fluid-temperature-seablock.json')

test('ingredient tiles show the temperature a recipe requires', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })

  const semiheavy = page.locator('main button[aria-label^="7.5% Semiheavy water (≤30°C) — Find producer recipe"]')
  await expect(semiheavy).toBeVisible()
  await expect(semiheavy).toContainText('≤30°C')

  const h2s = page.locator('main button[aria-label^="Enriched hydrogen sulfide gas (≥95°C)"]')
  await expect(h2s).toContainText('≥95°C')

  const steam = page.locator('main button[aria-label^="Steam (125–165°C)"]')
  await expect(steam).toContainText('125–165°C')

  // Three ingredient badges (the tiles that offer "Find producer recipe") and two product badges (the recipes' explicit temperatures): five in all.
  await expect(page.locator('main td [data-testid="item-tile-temperature"]')).toHaveCount(5)
  await expect(page.locator('main button[aria-label*="°C) — Find producer recipe"] [data-testid="item-tile-temperature"]')).toHaveCount(3)
})

/** Two Seablock blocks making electricity from a carbon boiler (steam at 165°C): one with a steam turbine (needs ≥465°C), one with a steam engine (needs ≥165°C). */
const POWER_FIXTURE = path.resolve('e2e/fixtures/power-temperature-seablock.json')

test('a steam turbine on boiler steam imports steam at ≥465°C without a warning, and shows the boiler temperature', async ({ page }) => {
  await loadPlanFixture(page, POWER_FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })

  await expect(page.locator('[data-testid="block-tab"] button[aria-label="Mismatch"]').first()).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('main [aria-label^="Steam (165°C)"]').first()).toContainText('165°C')

  // The block imports the steam at the range the turbine accepts, and nothing is wrong with that.
  await expect(page.getByTitle('Show solver warnings')).toHaveCount(0)
  await expect(pane(page, 'Ingredients').locator('[data-testid="summary-slot"][data-item-id="steam"] [data-testid="summary-slot-temperature"]')).toHaveText('≥465°C')
})

test('a steam engine on boiler steam raises no warning', async ({ page }) => {
  await loadPlanFixture(page, POWER_FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  await page.locator('[data-testid="block-tab"] button[aria-label="Match"]').click()
  await expect(page.locator('main [aria-label^="Steam (165°C)"]').first()).toBeVisible()
  await expect(page.getByTitle('Show solver warnings')).toHaveCount(0)
})

/** Two Seablock blocks making electricity from reactor heat on a heat exchanger 4 (needs heat of at least 765°C): a burner reactor (750°C) and a burner reactor 2 (1000°C). */
const HEAT_FIXTURE = path.resolve('e2e/fixtures/heat-temperature-seablock.json')

test('a burner reactor under a heat exchanger 4 warns, and shows the heat bound', async ({ page }) => {
  await loadPlanFixture(page, HEAT_FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })

  await expect(page.locator('[data-testid="block-tab"] button[aria-label="Too cold"]').first()).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('main [aria-label^="Heat (≥765°C)"]').first()).toContainText('≥765°C')

  const pill = page.getByRole('button', { name: /1 warning/ })
  await expect(pill).toBeVisible()
  await pill.click()
  const body = page.getByText(/needs Heat at/)
  await expect(body).toContainText('≥765°C')
  await expect(body).toContainText('750°C')
})

test('a burner reactor 2 under a heat exchanger 4 raises no warning', async ({ page }) => {
  await loadPlanFixture(page, HEAT_FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  await page.locator('[data-testid="block-tab"] button[aria-label="Hot enough"]').click()
  await expect(page.locator('main [aria-label^="Heat (≥765°C)"]').first()).toBeVisible()
  await expect(page.getByTitle('Show solver warnings')).toHaveCount(0)
})

/**
 * Three Seablock blocks. "Pinned" runs a carbon boiler at 1 execution/min (60 steam/min at 165°C, nobody takes it) beside a steam
 * turbine (needs ≥465°C), so it imports steam at ≥465°C and keeps the 165°C steam as a byproduct. "Hot steam" makes 465°C steam
 * (bob boiler 3) for "Turbines", which requests it over a connection.
 */
// Kept in a subfolder: `legacyParity.test.ts` solves every plan directly in e2e/fixtures and records it in its golden file.
const FLOWS_FIXTURE = path.resolve('e2e/fixtures/not-in-golden/fluid-temperature-flows-seablock.json')
const HOT_STEAM_TO_TURBINES = 'eeee0003-c000-0000-0000-000000000001'

test('a boiler pinned at 165°C feeding a turbine shows a steam 165°C byproduct and a steam ≥465°C import', async ({ page }) => {
  await loadPlanFixture(page, FLOWS_FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })

  const byproduct = slot(page, 'Byproducts', 'Steam 165°C')
  const ingredient = slot(page, 'Ingredients', 'Steam ≥465°C')
  await expect(byproduct.getByTestId('summary-slot-temperature')).toHaveText('165°C')
  await expect(ingredient.getByTestId('summary-slot-temperature')).toHaveText('≥465°C')
  await expect(page.getByTitle('Show solver warnings')).toHaveCount(0)

  await page.getByRole('button', { name: 'Collapse summary' }).click()
  await expect(pane(page, 'Byproducts').getByTestId('summary-line-temperature')).toHaveText('165°C')
  await expect(pane(page, 'Ingredients').getByTestId('summary-line-temperature')).toHaveText('≥465°C')
})

test('a connection delivering 465°C steam shows no import and its tooltip lists the part', async ({ page }) => {
  await loadPlanFixture(page, FLOWS_FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  await page.locator('[data-testid="block-tab"] button[aria-label="Turbines"]').click()

  await expect(pane(page, 'Ingredients').getByTestId('summary-slot')).toHaveCount(1)
  await selectSlot(page, 'Ingredients', 'Steam ≥465°C')
  await expect(detail(page, 'Ingredients').locator('[data-kind="source"]')).toHaveCount(1)
  await expect(detail(page, 'Ingredients').locator('[data-kind="import"]')).toHaveCount(0)
  await expect(page.getByTitle('Show solver warnings')).toHaveCount(0)

  await page.getByRole('button', { name: 'Block graph' }).click()
  const chip = page.locator(`[data-testid="graph-edge-label"][data-connection-id="${HOT_STEAM_TO_TURBINES}"]`)
  await expect(chip).toHaveAttribute('data-tip', /carries .* at ≥465°C/)
})
