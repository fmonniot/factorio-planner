import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { slotById } from './support/summary'

/**
 * The nullius-ethylene-methane-v2 fixture has:
 *   goals: ethylene ≥ 800/min, methane ≥ 400/min
 *   solverVersion: 2
 *   recipes: propene-pyrolysis (bc), carbon-monoxide-to-alkenes,
 *            benzene-combustion, steam-electrolysis, methane
 *
 * The recipe network is overconstrained: benzene-combustion and
 * steam-electrolysis share steam/oxygen with incompatible stoichiometry.
 * v2 LP relaxes the intermediates to ≥ 0 so goals are met, and one of
 * steam or oxygen ends up with a positive surplus (overconstrained warning).
 */

const FIXTURE = path.resolve('e2e/fixtures/nullius-ethylene-methane-v2.json')

async function waitForSolver(page: import('@playwright/test').Page) {
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
}

test.describe('LP solver — overconstrained Nullius plan', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await waitForSolver(page)
  })

  test('ethylene goal slot shows actual rate ≥ 800/min', async ({ page }) => {
    // The slot's accessible name carries the actual rate; in /min mode 800/min renders as "800".
    await expect(slotById(page, 'Products', 'nullius-ethylene')).toHaveAttribute(
      'aria-label',
      /, (8\d\d|[1-9]\d{3,}) per minute$/,
      { timeout: 10000 },
    )
  })

  test('methane goal slot shows actual rate ≥ 400/min', async ({ page }) => {
    await expect(slotById(page, 'Products', 'nullius-methane')).toHaveAttribute(
      'aria-label',
      /, (4\d\d|[5-9]\d\d|[1-9]\d{3,}) per minute$/,
      { timeout: 10000 },
    )
  })

  test('overconstrained warning badge appears', async ({ page }) => {
    const badge = page.getByRole('button', { name: /warning/ })
    await expect(badge).toBeVisible({ timeout: 10000 })
    await badge.click()
    await expect(page.getByText(/can't fully balance/i)).toBeVisible()
  })

})
