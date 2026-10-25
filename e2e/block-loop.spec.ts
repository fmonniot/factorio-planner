import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'

/**
 * Fixture: block "Plates" (goal iron plate 60/min) and the active block "Gears"
 * (goals iron gear 30/min and iron ingot 80/min). Plates smelts plates from
 * ingots and Gears makes gears from plates, so connecting plates to Gears and
 * ingots to Plates closes a loop between the two blocks.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-loop.json')
const GEARS_ID = 'bbbb0002-0000-0000-0000-000000000001'

const plateSlot = (page: Page) => slot(page, 'Ingredients', 'Iron plate')
const ingotSlot = (page: Page) => slot(page, 'Ingredients', 'Iron ingot')
const sourceEntry = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="source"]')
const importEntry = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="import"]')

test.describe('block loops', () => {
  test('two blocks can supply each other', async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })

    // Gears receives its plates from Plates.
    await plateSlot(page).click({ button: 'right' })
    await page.locator('[role="menuitem"]:not([data-pull])', { hasText: 'Plates' }).click()

    // Plates receives the ingots Gears makes: that closes the loop.
    await page.locator('button[title="Plates"]').click()
    await expect(ingotSlot(page)).toBeVisible()
    await ingotSlot(page).click({ button: 'right' })
    const closing = page.locator('[role="menuitem"]:not([data-pull])', { hasText: 'Gears' })
    await expect(closing).toHaveAttribute('data-closes-loop', 'true')
    await closing.click()

    await selectSlot(page, 'Ingredients', 'Iron ingot')
    await expect(sourceEntry(page)).toContainText('Gears')
    await expect(sourceEntry(page)).toContainText('↻')
    await expect(sourceEntry(page)).toContainText('80.0')
    await expect(sourceEntry(page)).toHaveAttribute('title', /part of a loop/)
    await expect(importEntry(page)).toHaveCount(0)

    // Gears still gets its plates from Plates, also marked as part of the loop.
    await page.locator('button[title="Gears"]').click()
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(sourceEntry(page)).toContainText('30.0')
    await expect(sourceEntry(page)).toContainText('↻')

    // The graph draws the closing connection as a back edge and counts the loop.
    await page.getByRole('button', { name: 'Block graph' }).click()
    const edges = page.getByTestId('graph-edge')
    await expect(edges).toHaveCount(2)
    await expect(edges.nth(0)).toHaveAttribute('data-loop', 'true')
    await expect(edges.nth(1)).toHaveAttribute('data-loop', 'true')
    await expect(page.locator('[data-testid="graph-edge"][data-back="true"]')).toHaveAttribute('data-from', GEARS_ID)
    await expect(page.getByTestId('graph-loop-status')).toContainText('1 loop')
  })
})
