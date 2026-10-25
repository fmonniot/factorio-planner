import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Fixture (Seablock): Metals make invar and brass plates, Sciences (active) make 10 sub-plating/min
 * from them and have the iron/copper waste as a product, and Ores recycle that waste into ore that
 * Metals request. Metals request ore, Sciences request alloys, Ores request waste: a cycle of
 * requests whose demand grows every round, so it does not settle until the waste request has a limit.
 */
const FIXTURE = path.resolve('e2e/fixtures/request-loop-seablock.json')
const WASTE_CONNECTION_ID = 'cccc0003-c000-0000-0000-000000000001'

test.describe('cycles of requests', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE, 'kompetenz-seablock')
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('top-bar').getByRole('button', { name: /warning/ })).toBeVisible({ timeout: 15000 })
  })

  test('says when the requests around a loop do not settle, and a limit settles them', async ({ page }) => {
    // Sciences is active: its warning says what happened.
    await page.getByTestId('top-bar').getByRole('button', { name: /warning/ }).click()
    await expect(page.getByText('Requests around a loop do not settle')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Block graph' }).click()
    const status = page.getByTestId('graph-loop-status')
    await expect(status).toHaveAttribute('data-converged', 'false')
    await expect(status).toContainText('Requests around')
    await expect(page.locator('[data-testid="graph-edge-label"][data-request-ignored="request-loop"]')).toHaveCount(2)

    // Limit the waste request to 10/min: the demand settles and nothing is ignored.
    const waste = page.locator(`[data-testid="graph-edge-label"][data-connection-id="${WASTE_CONNECTION_ID}"]`)
    await waste.getByTestId('graph-edge-limit').click()
    await page.getByRole('spinbutton', { name: 'Connection limit' }).fill('10')
    await page.getByRole('spinbutton', { name: 'Connection limit' }).press('Enter')

    await expect(status).toHaveText('↻ 1 loop')
    await expect(status).toHaveAttribute('data-converged', 'true')
    await expect(page.locator('[data-request-ignored]')).toHaveCount(0)
  })
})
