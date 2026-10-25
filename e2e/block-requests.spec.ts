import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot, slotById } from './support/summary'
import { exportPlan } from './support/appMenu'

/**
 * Fixture: block "Plates" (product iron plate 60/min) and the active block "Gears"
 * (product iron gear 30/min), which needs 30 plate/min and 15 rod/min from outside. Same
 * fixture as block-connection.spec.ts. A connection to an item its source has as a product
 * is a request: the source makes what the consumer needs on top of its own extra output.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')
const LOOP_FIXTURE = path.resolve('e2e/fixtures/block-loop.json')
const PLATES_ID = 'bbbb0001-0000-0000-0000-000000000001'

const plateSlot = (page: Page) => slot(page, 'Ingredients', 'Iron plate')
const sourceSegment = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-segment"][data-kind="source"]')
const sourceEntry = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="source"]')
const importEntry = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="import"]')

async function setup(page: Page, fixture = FIXTURE) {
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })
}

/** On Gears: request iron plate from Plates through the Ingredients menu. */
async function requestPlates(page: Page) {
  await plateSlot(page).click({ button: 'right' })
  await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' }).click()
  if ((await plateSlot(page).getAttribute('aria-pressed')) !== 'true') await plateSlot(page).click()
  await expect(sourceSegment(page)).toBeVisible()
}

/** Add a product through the item picker; `amount` '' clears the field (no extra output). */
async function addProduct(page: Page, itemName: string, itemId: string, amount?: string) {
  await page.getByTitle('Add goal').click()
  const overlay = page.locator('.fixed.inset-0')
  await overlay.getByPlaceholder('Search…').fill(itemName)
  if (amount !== undefined) await overlay.getByLabel('Amount').fill(amount)
  await overlay.locator(`[data-testid="item-slot"][data-item-id="${itemId}"]`).click()
}

test.describe('requests between blocks', () => {
  test('a request makes the source produce what the consumer needs', async ({ page }) => {
    await setup(page)

    // The only entries for Plates are requests: it has iron plate as a product.
    await plateSlot(page).click({ button: 'right' })
    await expect(page.getByText('Request Iron plate from')).toBeVisible()
    await expect(page.locator('[role="menuitem"][data-kind="take"]')).toHaveCount(0)
    await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' }).click()
    if ((await plateSlot(page).getAttribute('aria-pressed')) !== 'true') await plateSlot(page).click()

    await expect(sourceSegment(page)).toContainText('Plates')
    await expect(sourceSegment(page)).toHaveAttribute('title', /— requested/)
    await expect(sourceEntry(page)).toContainText('30.0')
    await expect(importEntry(page)).toHaveCount(0)

    // Plates makes its own 60 plus the 30 Gears requested, and sends 30 to Gears.
    await page.locator('button[title="Plates"]').click()
    await selectSlot(page, 'Products', 'Iron plate')
    await expect(detail(page, 'Products').locator('[data-testid="summary-key-entry"][data-kind="export"]')).toContainText('30.0')
    await expect(page.getByTitle(/^Actual: 90\.0/)).toBeVisible()

    // Lower the Plates target to 20: Gears still gets all 30, because the request adds to it.
    await page.getByTitle(/Target:/).click()
    await page.getByLabel('Goal target rate').fill('20')
    await page.getByLabel('Goal target rate').press('Enter')
    await page.locator('button[title="Gears"]').click()
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(sourceEntry(page)).toContainText('30.0')
    await expect(importEntry(page)).toHaveCount(0)
    await expect(plateSlot(page)).not.toHaveAttribute('data-status', 'limited')

    // The exported plan has a plain connection (no pull flag) and the product's extra output.
    const download = await exportPlan(page)
    const exported = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'))
    const gears = exported.blocks.find((b: { name: string }) => b.name === 'Gears')
    expect(gears.inputConnections).toHaveLength(1)
    expect(gears.inputConnections[0]).toMatchObject({ fromBlockId: PLATES_ID, itemId: 'nullius-iron-plate' })
    expect('pull' in gears.inputConnections[0]).toBe(false)
    const plates = exported.blocks.find((b: { name: string }) => b.name === 'Plates')
    expect(plates.products[0]).toMatchObject({ itemId: 'nullius-iron-plate', extraRate: 20 })
    expect('goals' in plates).toBe(false)
  })

  test('removing a requested product asks first, and adding it back asks too', async ({ page }) => {
    await setup(page)
    await requestPlates(page)

    // On Plates, removing the product Gears requests asks for confirmation.
    await page.locator('button[title="Plates"]').click()
    await selectSlot(page, 'Products', 'Iron plate')
    await detail(page, 'Products').getByRole('button', { name: 'Remove goal' }).click()
    await expect(page.getByRole('heading', { name: "Remove Iron plate from Plates' products?" })).toBeVisible()
    await expect(page.getByTestId('product-change-effect')).toContainText(
      'Gears requests Iron plate from this block (30.0/m). It will only take what is left over and no longer drive this block.',
    )
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(slotById(page, 'Products', 'nullius-iron-plate')).toHaveCount(1)

    await detail(page, 'Products').getByRole('button', { name: 'Remove goal' }).click()
    await page.getByRole('button', { name: 'Remove product' }).click()
    await expect(slotById(page, 'Products', 'nullius-iron-plate')).toHaveCount(0)

    // Gears now only takes what is left over: nothing, so it imports all 30.
    await page.locator('button[title="Gears"]').click()
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(sourceSegment(page)).toHaveCount(0)
    await expect(importEntry(page)).toContainText('30.0')
    await expect(plateSlot(page)).toHaveAccessibleName(/, 30\.0 per/)

    // Adding the product back turns that take into a request again, after confirmation.
    await page.locator('button[title="Plates"]').click()
    await addProduct(page, 'Iron plate', 'nullius-iron-plate', '60')
    await expect(page.getByRole('heading', { name: 'Make Iron plate a product of Plates?' })).toBeVisible()
    const effect = page.getByTestId('product-change-effect')
    await expect(effect).toContainText('Gears takes existing Iron plate from this block')
    await expect(effect).toContainText('It will request it instead')
    await page.getByRole('button', { name: 'Make it a product' }).click()

    await page.locator('button[title="Gears"]').click()
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(sourceEntry(page)).toContainText('30.0')
    await expect(sourceSegment(page)).toHaveAttribute('title', /— requested/)
  })

  test('a product without extra output makes only what is requested', async ({ page }) => {
    await setup(page)

    // On Plates: an empty amount adds Iron rod without extra output, with no dialog.
    await page.locator('button[title="Plates"]').click()
    await addProduct(page, 'Iron rod', 'nullius-iron-rod', '')
    await expect(page.getByTestId('product-change-confirm')).toHaveCount(0)
    const rodProduct = slot(page, 'Products', 'Iron rod')
    await expect(rodProduct).toHaveAccessibleName('Iron rod, nothing requested yet')
    await expect(rodProduct).toContainText('—')

    // Gears requests its 15 rods from Plates, which has no recipe for them.
    await page.locator('button[title="Gears"]').click()
    await slot(page, 'Ingredients', 'Iron rod').click({ button: 'right' })
    await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' }).click()

    await page.locator('button[title="Plates"]').click()
    await expect(slot(page, 'Products', 'Iron rod')).toHaveAttribute('data-status', 'short')
  })

  test('adding a product that closes a cycle of requests explains it', async ({ page }) => {
    await setup(page, LOOP_FIXTURE)
    await requestPlates(page)

    // Plates takes the ingots Gears makes as a byproduct; that closes a loop.
    await page.locator('button[title="Plates"]').click()
    await slot(page, 'Ingredients', 'Iron ingot').click({ button: 'right' })
    const closing = page.locator('[role="menuitem"][data-kind="take"]', { hasText: 'Gears' })
    await expect(closing).toHaveAttribute('data-closes-loop', 'true')
    await closing.click()

    // On Gears, making iron ingot a product would turn that take into a request that closes a cycle.
    await page.locator('button[title="Gears"]').click()
    await addProduct(page, 'Iron ingot', 'nullius-iron-ingot')
    await expect(page.getByTestId('product-change-effect')).toContainText('closes a cycle of requests')
    await page.getByRole('button', { name: 'Make it a product' }).click()

    // Every connection of the cycle now takes existing output.
    await page.getByRole('button', { name: 'Block graph' }).click()
    await expect(page.locator('[data-testid="graph-edge-label"][data-request-ignored="request-loop"]')).toHaveCount(2)
  })
})
