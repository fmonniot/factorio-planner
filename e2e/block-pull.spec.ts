import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'
import { exportPlan } from './support/appMenu'

/**
 * Fixture: block "Plates" (goal iron plate 60/min) and the active block "Gears"
 * (goal iron gear 30/min), which needs 30 plate/min from outside. Same fixture as
 * block-connection.spec.ts.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')
const PLATES_ID = 'bbbb0001-0000-0000-0000-000000000001'

const plateSlot = (page: Page) => slot(page, 'Ingredients', 'Iron plate')
const sourceSegment = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-segment"][data-kind="source"]')
const sourceEntry = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="source"]')
const importEntry = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="import"]')

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })
}

test.describe('pull connections', () => {
  test('a pulled connection makes the source produce what the consumer needs', async ({ page }) => {
    await setup(page)

    // Pull iron plate from Plates.
    await plateSlot(page).click({ button: 'right' })
    await expect(page.getByText('Pull Iron plate from')).toBeVisible()
    await page.locator('[role="menuitem"][data-pull="true"]', { hasText: 'Plates' }).click()
    if ((await plateSlot(page).getAttribute('aria-pressed')) !== 'true') await plateSlot(page).click()

    await expect(sourceSegment(page)).toContainText('Plates')
    await expect(sourceSegment(page)).toHaveAttribute('title', /— pulled/)
    await expect(sourceEntry(page)).toContainText('30.0')
    await expect(importEntry(page)).toHaveCount(0)

    // Plates makes its own 60 plus the 30 Gears pulled, and sends 30 to Gears.
    await page.locator('button[title="Plates"]').click()
    await selectSlot(page, 'Products', 'Iron plate')
    await expect(detail(page, 'Products').locator('[data-testid="summary-key-entry"][data-kind="export"]')).toContainText('30.0')
    await expect(page.getByTitle(/^Actual: 90\.0/)).toBeVisible()

    // Lower the Plates goal to 20: Gears still gets all 30, because the pull adds to the goal.
    await page.getByTitle(/Target:/).click()
    await page.getByLabel('Goal target rate').fill('20')
    await page.getByLabel('Goal target rate').press('Enter')
    await page.locator('button[title="Gears"]').click()
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(sourceEntry(page)).toContainText('30.0')
    await expect(importEntry(page)).toHaveCount(0)
    await expect(plateSlot(page)).not.toHaveAttribute('data-status', 'limited')

    // The flag is part of the exported plan.
    const download = await exportPlan(page)
    const exported = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'))
    const gears = exported.blocks.find((b: { name: string }) => b.name === 'Gears')
    expect(gears.inputConnections).toHaveLength(1)
    expect(gears.inputConnections[0]).toMatchObject({ fromBlockId: PLATES_ID, itemId: 'nullius-iron-plate', pull: true })

    // Stop pulling: Gears takes what Plates has left over (20) and imports the other 10.
    await sourceSegment(page).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Stop pulling' }).click()
    await expect(sourceEntry(page)).toContainText('20.0')
    await expect(plateSlot(page)).toHaveAttribute('data-status', 'limited')
    await expect(importEntry(page)).toContainText('10.0')
  })
})
