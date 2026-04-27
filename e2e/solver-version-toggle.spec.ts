import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * The factorio-plan-2026-04-26 fixture is the captured Nullius plan saved
 * without a solverVersion (defaults to v1 via Zod migration). We toggle
 * to v2 and verify the change persists in localStorage and the solver
 * re-runs with the new version.
 */

const FIXTURE = path.resolve('e2e/fixtures/factorio-plan-2026-04-26.json')
const APP_STATE_KEY = 'factorio-planner:app-state'

async function waitForSolver(page: import('@playwright/test').Page) {
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
}

test.describe('Solver version toggle', () => {
  test('loads plan as v1 (no solverVersion field)', async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await waitForSolver(page)

    // v1 button should be active (teal)
    const v1Btn = page.getByRole('button', { name: 'Solver v1' })
    await expect(v1Btn).toBeVisible()
    await expect(v1Btn).toHaveClass(/teal/)
  })

  test('toggling to v2 updates localStorage and shows overconstrained warning', async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await waitForSolver(page)

    // Toggle to v2
    await page.getByRole('button', { name: 'Solver v2' }).click()

    // Wait for solver to re-run
    await expect(page.getByRole('button', { name: /warning/ })).toBeVisible({ timeout: 10000 })

    // localStorage should reflect solverVersion: 2
    const storedJson = await page.evaluate((key) => localStorage.getItem(key), APP_STATE_KEY)
    expect(storedJson).toContain('"solverVersion":2')

    // Overconstrained warning should appear (v2 detects the incompatible ratios)
    await page.getByRole('button', { name: /warning/ }).click()
    await expect(page.getByText(/can't fully balance/i)).toBeVisible()
  })

  test('toggling back to v1 removes the overconstrained warning', async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await waitForSolver(page)

    // Switch to v2 first
    await page.getByRole('button', { name: 'Solver v2' }).click()
    await expect(page.getByRole('button', { name: /warning/ })).toBeVisible({ timeout: 10000 })

    // Switch back to v1
    await page.getByRole('button', { name: 'Solver v1' }).click()

    // Wait a tick for re-solve
    await page.waitForTimeout(500)

    // The overconstrained warning should be gone (v1 doesn't emit it)
    const badge = page.getByRole('button', { name: /warning/ })
    if (await badge.isVisible()) {
      await badge.click()
      await expect(page.getByText(/can't fully balance/i)).not.toBeVisible()
    }
  })
})
