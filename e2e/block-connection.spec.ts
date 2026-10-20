import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Fixture: block "Plates" (goal iron plate 60/min) and the active block "Gears"
 * (goal iron gear 30/min, recipe iron gear only). Gears needs 30 plate/min and
 * 15 rod/min from outside. The fixture has no `inputConnections` field, which
 * also covers loading plans saved before block connections existed.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')
const PLATES_ID = 'bbbb0001-0000-0000-0000-000000000001'

const plateTile = (page: Page) => page.locator('button[title^="Iron plate — click to find a producer recipe"]')
const rodTile = (page: Page) => page.locator('button[title^="Iron rod — click to find a producer recipe"]')
const chip = (page: Page) => page.getByTestId('connection-chip')

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(plateTile(page)).toBeVisible({ timeout: 10000 })
}

async function connectPlatesFromPlatesBlock(page: Page) {
  // The menu lists Plates only once its own solve has landed.
  await plateTile(page).click({ button: 'right' })
  await page.getByRole('menuitem', { name: /Plates/ }).click()
  await expect(chip(page)).toBeVisible()
}

test.describe('block connections', () => {
  test('a block receives an item from another block and the flow follows the source', async ({ page }) => {
    await setup(page)
    await connectPlatesFromPlatesBlock(page)

    // Gears now gets all 30 plate/min from Plates; rods are still imported.
    await expect(chip(page)).toContainText('Plates')
    await expect(chip(page)).toContainText('30.0')
    await expect(plateTile(page)).toHaveCount(0)
    await expect(rodTile(page)).toContainText('15.0')

    // Plates shows what it sends to Gears.
    await page.locator('button[title="Plates"]').click()
    await expect(page.getByTestId('export-chip')).toContainText('Gears')
    await expect(page.getByTestId('export-chip')).toContainText('30.0')

    // Lower the Plates goal to 20: Gears is limited and imports the other 10.
    await page.getByTitle(/Target:/).click()
    await page.getByLabel('Goal target rate').fill('20')
    await page.getByLabel('Goal target rate').press('Enter')
    await page.locator('button[title="Gears"]').click()
    await expect(chip(page)).toHaveAttribute('title', /Limited/)
    await expect(plateTile(page)).toContainText('10.0')

    // Removing the connection brings the whole import back.
    await chip(page).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Remove connection' }).click()
    await expect(chip(page)).toHaveCount(0)
    await expect(plateTile(page)).toContainText('30.0')

    // The connection is part of the exported plan.
    await connectPlatesFromPlatesBlock(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export plan' }).click(),
    ])
    const exported = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'))
    const gears = exported.blocks.find((b: { name: string }) => b.name === 'Gears')
    expect(gears.inputConnections).toHaveLength(1)
    expect(gears.inputConnections[0]).toMatchObject({ fromBlockId: PLATES_ID, itemId: 'nullius-iron-plate' })
  })

  test('own production comes first: a block that makes the item itself does not use the connection', async ({ page }) => {
    await setup(page)
    await connectPlatesFromPlatesBlock(page)

    await page.getByText('+ Add recipe').click()
    const overlay = page.locator('.fixed.inset-0')
    await overlay.getByPlaceholder('Search…').fill('Iron plate')
    await overlay.locator('[data-testid="recipe-slot"][title="Iron plate"]').click()

    await expect(chip(page)).toHaveAttribute('title', /Not used/)
    await expect(page.locator('button[title^="Iron ingot — click to find a producer recipe"]')).toBeVisible()
  })
})
