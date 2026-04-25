import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * The barrel-rate-regression fixture contains two nodes with the same recipeId
 * ("nullius-ammonia-barrel"), which produces a duplicate-recipe warning after
 * the solver fix. We use it here to test the warnings popover UI.
 */
test.describe('Warnings popover', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, path.resolve('e2e/fixtures/barrel-rate-regression.json'))
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    // Wait for rows to appear (solver has run)
    await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  })

  test('warning badge is visible and shows the count', async ({ page }) => {
    // The duplicate-recipe warning is emitted for the two ammonia-barrel nodes.
    const badge = page.getByRole('button', { name: /warning/ })
    await expect(badge).toBeVisible()
    await expect(badge).toContainText('warning')
  })

  test('clicking the badge opens the popover with title, body and hint', async ({ page }) => {
    const badge = page.getByRole('button', { name: /warning/ })
    await badge.click()

    // Popover header
    await expect(page.getByText('Solver warnings')).toBeVisible()

    // The duplicate-recipe warning entry
    await expect(page.getByText('Duplicate recipe')).toBeVisible()

    // Body: recipe name resolved from game data
    await expect(page.getByText(/Fill Ammonia barrel.*appears on 2 nodes/)).toBeVisible()

    // Hint line
    await expect(page.getByText(/Remove one of the duplicate nodes/)).toBeVisible()
  })

  test('popover closes when clicking outside', async ({ page }) => {
    await page.getByRole('button', { name: /warning/ }).click()
    await expect(page.getByText('Solver warnings')).toBeVisible()

    // Click somewhere outside the popover (top-left of main area)
    await page.mouse.click(100, 100)
    await expect(page.getByText('Solver warnings')).not.toBeVisible()
  })

  test('popover closes on Escape', async ({ page }) => {
    await page.getByRole('button', { name: /warning/ }).click()
    await expect(page.getByText('Solver warnings')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByText('Solver warnings')).not.toBeVisible()
  })

  test('duplicate-recipe warning badge is red (critical)', async ({ page }) => {
    // Critical warnings (duplicate-recipe) make the badge red, not yellow.
    const badge = page.getByRole('button', { name: /warning/ })
    await expect(badge).toHaveClass(/text-red-400/)
  })
})
