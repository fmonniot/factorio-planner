import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'
import { exportPlan } from './support/appMenu'

/**
 * Fixture: block "Plates" (goal iron plate 60/min) and the active block "Gears"
 * (goal iron gear 30/min, recipe iron gear only). Gears needs 30 plate/min and
 * 15 rod/min from outside. The fixture has no `inputConnections` field, which
 * also covers loading plans saved before block connections existed.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')
const PLATES_ID = 'bbbb0001-0000-0000-0000-000000000001'

const plateSlot = (page: Page) => slot(page, 'Ingredients', 'Iron plate')
const rodSlot = (page: Page) => slot(page, 'Ingredients', 'Iron rod')
const sourceSegment = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-segment"][data-kind="source"]')
const sourceEntry = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="source"]')
const importEntry = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="import"]')

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })
}

async function connectPlatesFromPlatesBlock(page: Page) {
  // The menu lists Plates only once its own solve has landed.
  await plateSlot(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Plates/ }).click()
  // The slot may still be selected from before; a second click would clear it.
  if ((await plateSlot(page).getAttribute('aria-pressed')) !== 'true') await plateSlot(page).click()
  await expect(sourceSegment(page)).toBeVisible()
}

test.describe('block connections', () => {
  test('a block receives an item from another block and the flow follows the source', async ({ page }) => {
    await setup(page)
    await connectPlatesFromPlatesBlock(page)

    // Gears now gets all 30 plate/min from Plates; rods are still imported.
    await expect(sourceSegment(page)).toContainText('Plates')
    await expect(sourceEntry(page)).toContainText('30.0')
    await expect(importEntry(page)).toHaveCount(0)
    await expect(rodSlot(page)).toHaveAccessibleName(/, 15\.0 per/)

    // Plates shows what it sends to Gears.
    await page.locator('button[title="Plates"]').click()
    await selectSlot(page, 'Products', 'Iron plate')
    const exportSegment = detail(page, 'Products').locator('[data-testid="summary-segment"][data-kind="export"]')
    await expect(exportSegment).toHaveAttribute('title', /^Sends Iron plate to Gears/)
    await expect(detail(page, 'Products').locator('[data-testid="summary-key-entry"][data-kind="export"]')).toContainText('30.0')

    // Lower the Plates goal to 20: Gears is limited and imports the other 10.
    await page.getByTitle(/Target:/).click()
    await page.getByLabel('Goal target rate').fill('20')
    await page.getByLabel('Goal target rate').press('Enter')
    await page.locator('button[title="Gears"]').click()
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(plateSlot(page)).toHaveAttribute('data-status', 'limited')
    await expect(sourceSegment(page)).toHaveAttribute('title', /Limited/)
    await expect(importEntry(page)).toContainText('10.0')

    // Removing the connection brings the whole import back.
    await sourceSegment(page).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove connection' }).click()
    await expect(sourceSegment(page)).toHaveCount(0)
    await expect(plateSlot(page)).toHaveAccessibleName(/, 30\.0 per/)

    // The connection is part of the exported plan.
    await connectPlatesFromPlatesBlock(page)
    const download = await exportPlan(page)
    const exported = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'))
    const gears = exported.blocks.find((b: { name: string }) => b.name === 'Gears')
    expect(gears.inputConnections).toHaveLength(1)
    expect(gears.inputConnections[0]).toMatchObject({ fromBlockId: PLATES_ID, itemId: 'nullius-iron-plate' })
  })

  test('own production comes first: a block that makes the item itself does not use the connection', async ({ page }) => {
    await setup(page)
    await connectPlatesFromPlatesBlock(page)

    await page.getByRole('button', { name: 'Add recipe' }).click()
    const overlay = page.locator('.fixed.inset-0')
    await overlay.getByPlaceholder('Search…').fill('Iron plate')
    await overlay.locator('[data-testid="recipe-slot"][title="Iron plate"]').click()

    await expect(detail(page, 'Ingredients').getByTestId('summary-key-entry').filter({ hasText: 'unused' })).toHaveAttribute('title', /Not used/)
    await expect(slot(page, 'Ingredients', 'Iron ingot')).toBeVisible()
  })
})
