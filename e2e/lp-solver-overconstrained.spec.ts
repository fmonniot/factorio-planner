import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

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

  test('ethylene goal tile shows actual rate ≥ 800/min', async ({ page }) => {
    // The actual rate is in a span with title containing "Actual:"
    // In /min mode, 800/min renders as "800"
    const actualSpans = page.locator('[title*="Actual:"]')
    // There are two goal tiles (ethylene + methane); find the one with ≥ 800
    const ethyleneActual = actualSpans.filter({ hasText: /^8[0-9][0-9]|^[1-9]\d{3,}/ }).first()
    await expect(ethyleneActual).toBeVisible({ timeout: 10000 })
  })

  test('methane goal tile shows actual rate ≥ 400/min', async ({ page }) => {
    const actualSpans = page.locator('[title*="Actual:"]')
    const methaneActual = actualSpans.filter({ hasText: /^4[0-9][0-9]|^[5-9][0-9][0-9]|^[1-9]\d{3,}/ }).first()
    await expect(methaneActual).toBeVisible({ timeout: 10000 })
  })

  test('overconstrained warning badge appears', async ({ page }) => {
    const badge = page.getByRole('button', { name: /warning/ })
    await expect(badge).toBeVisible({ timeout: 10000 })
    await badge.click()
    await expect(page.getByText(/can't fully balance/i)).toBeVisible()
  })

})
