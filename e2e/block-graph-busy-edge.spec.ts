import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, slotById } from './support/summary'

/**
 * Fixture shared with summary-panes-many-items.spec.ts: "Sciences" requests 12 items
 * from "Metals" and "Circuits" requests 3, so the first edge is summarised and the second is not.
 */
const FIXTURE = path.resolve('e2e/fixtures/summary-many-items.json')
const METALS_ID = 'cccc0001-0000-0000-0000-000000000001'
const SCIENCES_ID = 'cccc0002-0000-0000-0000-000000000001'
const CIRCUITS_ID = 'cccc0003-0000-0000-0000-000000000001'
const FIRST_ITEM_ID = 'nullius-iron-sheet'

const summary = (page: Page) => page.locator(`[data-testid="graph-edge-summary"][data-to="${SCIENCES_ID}"]`)
const list = (page: Page) => page.getByTestId('graph-edge-list')
const heading = (page: Page) => page.getByRole('heading', { name: 'Block graph' })

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'Block graph' }).click()
  await expect(heading(page)).toBeVisible()
}

test.describe('block graph, busy edge', () => {
  test('summarises a busy edge', async ({ page }) => {
    await setup(page)
    await expect(page.getByTestId('graph-edge')).toHaveCount(2)
    await expect(summary(page)).toHaveAttribute('data-count', '12')
    await expect(summary(page)).toHaveAttribute('data-from', METALS_ID)
    await expect(summary(page)).not.toHaveAttribute('data-status', 'pending', { timeout: 20000 })

    // The three-item edge keeps one chip per connection.
    await expect(page.locator(`[data-testid="graph-edge-summary"][data-to="${CIRCUITS_ID}"]`)).toHaveCount(0)
    await expect(page.getByTestId('graph-edge-label')).toHaveCount(3)

    // One compact chip that sits clear of every node.
    const box = (await summary(page).boundingBox())!
    expect(box.height, 'summary chip height').toBeLessThanOrEqual(32)
    const nodes = page.getByTestId('graph-node')
    for (let i = 0; i < await nodes.count(); i++) {
      const n = (await nodes.nth(i).boundingBox())!
      const overlaps = box.x < n.x + n.width && n.x < box.x + box.width && box.y < n.y + n.height && n.y < box.y + box.height
      expect(overlaps, `summary chip over node ${i}`).toBe(false)
    }
  })

  test('lists and edits every connection', async ({ page }) => {
    await setup(page)
    await summary(page).click()
    await expect(list(page)).toBeVisible()
    await expect(list(page).getByTestId('graph-edge-label')).toHaveCount(12)

    // Limit the first row.
    const first = list(page).getByTestId('graph-edge-label').first()
    await first.getByTestId('graph-edge-limit').click()
    await page.getByRole('spinbutton', { name: 'Connection limit' }).fill('5')
    await page.getByRole('spinbutton', { name: 'Connection limit' }).press('Enter')
    await expect(first.getByTestId('graph-edge-limit')).toContainText('≤ 5')

    // Escape closes the list, not the graph.
    await page.keyboard.press('Escape')
    await expect(list(page)).toBeHidden()
    await expect(heading(page)).toBeVisible()

    // Remove the first connection.
    await summary(page).click()
    await list(page).getByTestId('graph-edge-remove').first().click()
    await expect(list(page).getByTestId('graph-edge-label')).toHaveCount(11)
    await expect(summary(page)).toHaveAttribute('data-count', '11')

    // The Ingredients pane of Sciences no longer takes that item from Metals.
    await page.keyboard.press('Escape')
    await expect(list(page)).toBeHidden()
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(heading(page)).toHaveCount(0)
    await page.locator('button[title="Sciences"]').click()
    await slotById(page, 'Ingredients', FIRST_ITEM_ID).click()
    await expect(detail(page, 'Ingredients').locator('[data-testid="summary-segment"][data-kind="source"]')).toHaveCount(0)
  })
})
