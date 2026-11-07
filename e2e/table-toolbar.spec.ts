import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

const FIXTURE = path.resolve('e2e/fixtures/summary-many-items.json')

test.describe('Table toolbar', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  })

  test('sits above the table and carries the block totals', async ({ page }) => {
    const toolbar = page.getByTestId('table-toolbar')
    await expect(toolbar).toBeVisible({ timeout: 20000 })
    await expect(toolbar.getByTestId('block-recipe-count')).toContainText(/\d+ recipes?/)
    await expect(toolbar.getByTestId('block-machine-count')).toContainText(/\d+ machines?/)
  })

  test('the table header no longer has its own Add recipe button or power total', async ({ page }) => {
    await expect(page.getByTestId('table-toolbar')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('main table thead button[aria-label="Add recipe"]')).toHaveCount(0)
    await expect(page.locator('main table thead [data-testid="block-power-total"]')).toHaveCount(0)
  })

  test('the + Recipe button opens the recipe picker', async ({ page }) => {
    const toolbar = page.getByTestId('table-toolbar')
    await expect(toolbar).toBeVisible({ timeout: 20000 })
    await toolbar.getByRole('button', { name: 'Add recipe' }).click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
  })

  test('the /min /sec segment switches the rate unit', async ({ page }) => {
    const group = page.getByTestId('table-toolbar').getByRole('group', { name: 'Rate unit' })
    await expect(group.getByRole('button', { name: '/min' })).toHaveAttribute('aria-pressed', 'true')
    await group.getByRole('button', { name: '/sec' }).click()
    await expect(group.getByRole('button', { name: '/sec' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Rates per second, switch to per minute' })).toBeVisible()
  })
})
