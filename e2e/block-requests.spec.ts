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
const productEntry = (page: Page, kind: string) => detail(page, 'Products').locator(`[data-testid="summary-key-entry"][data-kind="${kind}"]`)
const confirm = (page: Page, name: string) => page.getByTestId('product-change-confirm').getByRole('button', { name })

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

/** Select the Iron plate ingredient slot unless it already is. */
async function ensureSelected(page: Page) {
  if ((await plateSlot(page).getAttribute('aria-pressed')) !== 'true') await plateSlot(page).click()
  await expect(detail(page, 'Ingredients')).toHaveAttribute('data-state', 'selected')
}

/** Add a product through the item picker; `amount` '' clears the field (no extra output). */
async function addProduct(page: Page, itemName: string, itemId: string, amount?: string) {
  await page.getByTitle('Add product').click()
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
    await expect(productEntry(page, 'export')).toContainText('30.0')
    await expect(page.getByTitle(/^Actual: 90\.0/)).toBeVisible()
    await expect(detail(page, 'Products')).toContainText('extra 60.0')
    await expect(detail(page, 'Products')).toContainText('+ requested 30.0')
    await expect(productEntry(page, 'export')).toHaveText('Gears requests 30.0')
    await expect(productEntry(page, 'kept')).toHaveText('Extra: 60.0 of 60.0')

    // Lower the Plates target to 20: Gears still gets all 30, because the request adds to it.
    await page.getByTitle(/^Extra output:/).click()
    await page.getByLabel('Extra output rate').fill('20')
    await page.getByLabel('Extra output rate').press('Enter')
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
    await detail(page, 'Products').getByRole('button', { name: 'Remove product' }).click()
    await expect(page.getByRole('heading', { name: "Remove Iron plate from Plates' products?" })).toBeVisible()
    await expect(page.getByTestId('product-change-effect')).toContainText(
      'Gears requests Iron plate from this block (30.0/m). It will only take what is left over and no longer drive this block.',
    )
    await confirm(page, 'Cancel').click()
    await expect(slotById(page, 'Products', 'nullius-iron-plate')).toHaveCount(1)

    await detail(page, 'Products').getByRole('button', { name: 'Remove product' }).click()
    await confirm(page, 'Remove product').click()
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
    await confirm(page, 'Make it a product').click()

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
    await expect(rodProduct).toHaveAttribute('data-dimmed', 'true')
    await expect(rodProduct).toHaveAttribute('title', 'Iron rod — nothing requested yet')
    await rodProduct.click()
    await expect(detail(page, 'Products')).toContainText('nothing requested yet')
    await expect(detail(page, 'Products').getByRole('button', { name: '+ Extra output' })).toBeVisible()

    // Gears requests its 15 rods from Plates, which has no recipe for them.
    await page.locator('button[title="Gears"]').click()
    await slot(page, 'Ingredients', 'Iron rod').click({ button: 'right' })
    await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' }).click()

    await page.locator('button[title="Plates"]').click()
    await expect(slot(page, 'Products', 'Iron rod')).toHaveAttribute('data-status', 'short')
  })

  test('adding a product that closes a cycle of requests turns it into a solved request cycle', async ({ page }) => {
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
    await expect(page.getByTestId('product-change-effect')).toContainText('It will request it instead')
    await confirm(page, 'Make it a product').click()

    // Both connections now request and the cycle is solved, not ignored.
    await page.getByRole('button', { name: 'Block graph' }).click()
    await expect(page.locator('[data-request-ignored]')).toHaveCount(0)
    await expect(page.locator('[data-testid="graph-edge-label"][data-kind="request"]')).toHaveCount(2)
    await expect(page.getByTestId('graph-loop-status')).toHaveText('↻ 1 loop')
    await expect(page.getByTestId('graph-loop-status')).toHaveAttribute('data-converged', 'true')
  })

  test('+ Extra output and Remove extra change what a product makes', async ({ page }) => {
    await setup(page)
    await requestPlates(page)
    await page.locator('button[title="Plates"]').click()
    await selectSlot(page, 'Products', 'Iron plate')

    await detail(page, 'Products').getByRole('button', { name: 'Remove extra' }).click()
    await expect(page.getByTitle(/^Extra output:/)).toHaveCount(0)
    await expect(detail(page, 'Products')).toContainText('requested 30.0')
    await expect(page.getByTitle(/^Actual: 30\.0/)).toBeVisible()
    await expect(productEntry(page, 'kept')).toHaveCount(0)
    await expect(productEntry(page, 'export')).toHaveText('Gears requests 30.0')

    await detail(page, 'Products').getByRole('button', { name: '+ Extra output' }).click()
    await page.getByLabel('Extra output rate').fill('10')
    await page.getByLabel('Extra output rate').press('Enter')
    await expect(detail(page, 'Products').getByRole('button', { name: 'extra 10.0' })).toBeVisible()
    await expect(page.getByTitle(/^Actual: 40\.0/)).toBeVisible()
  })

  test('a shortfall comes out of the extra first, then out of the requests', async ({ page }) => {
    await setup(page)
    await requestPlates(page)

    // Plates has no recipe for rods: its extra of 10 is all short.
    await page.locator('button[title="Plates"]').click()
    await addProduct(page, 'Iron rod', 'nullius-iron-rod', '10')
    await expect(page.getByTestId('product-change-confirm')).toHaveCount(0)
    await selectSlot(page, 'Products', 'Iron rod')
    await expect(slot(page, 'Products', 'Iron rod')).toHaveAttribute('data-status', 'short')
    await expect(productEntry(page, 'short')).toHaveText('Short 10.0 — comes out of the extra')

    // Gears asks for its 15 rods too.
    await page.locator('button[title="Gears"]').click()
    await slot(page, 'Ingredients', 'Iron rod').click({ button: 'right' })
    await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' }).click()
    await page.locator('button[title="Plates"]').click()
    await selectSlot(page, 'Products', 'Iron rod')
    await expect(productEntry(page, 'short')).toHaveText("Short 25.0 — comes out of the extra and Gears' request")

    await detail(page, 'Products').getByRole('button', { name: 'Remove extra' }).click()
    await expect(productEntry(page, 'short')).toHaveText("Short 15.0 — comes out of Gears' request")
  })

  test('Make it a product turns a byproduct into a product', async ({ page }) => {
    await setup(page, LOOP_FIXTURE)

    // On Gears: iron ingot is a byproduct; making it a product needs no dialog when nobody takes it.
    await selectSlot(page, 'Byproducts', 'Iron ingot')
    await detail(page, 'Byproducts').getByRole('button', { name: 'Make it a product' }).click()
    await expect(page.getByTestId('product-change-confirm')).toHaveCount(0)
    await expect(slotById(page, 'Byproducts', 'nullius-iron-ingot')).toHaveCount(0)
    const ingot = slotById(page, 'Products', 'nullius-iron-ingot')
    await expect(ingot).toHaveCount(1)
    await expect(ingot).not.toHaveAttribute('data-dimmed', 'true')
    await expect(ingot).not.toHaveAccessibleName(/nothing requested yet/)

    // Another block takes the ingots: making them a product would close a cycle of requests, which is solved.
    await setup(page, LOOP_FIXTURE)
    await requestPlates(page)
    await page.locator('button[title="Plates"]').click()
    await slot(page, 'Ingredients', 'Iron ingot').click({ button: 'right' })
    await page.locator('[role="menuitem"][data-kind="take"]', { hasText: 'Gears' }).click()
    await page.locator('button[title="Gears"]').click()
    await slot(page, 'Byproducts', 'Iron ingot').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Make it a product' }).click()
    await expect(page.getByTestId('product-change-effect')).toContainText('It will request it instead')
    await expect(page.getByTestId('product-change-effect')).not.toContainText('cycle')
    await confirm(page, 'Cancel').click()
    await expect(slotById(page, 'Byproducts', 'nullius-iron-ingot')).toHaveCount(1)
  })

  test('Make in a new block creates a block that makes the item and requests it', async ({ page }) => {
    await setup(page)

    await slot(page, 'Ingredients', 'Iron rod').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Make in a new block…' }).click()

    // The new block is last, active, and named after the item; the picker is filtered to its recipes.
    await expect(page.getByTestId('block-tab-strip').getByRole('button', { name: 'Iron rod' })).toHaveAttribute('aria-current', 'true')
    await expect(page.getByText("Choose a recipe to produce 'Iron rod'")).toBeVisible()
    await page.locator('[data-testid="recipe-slot"][data-recipe-id="nullius-iron-rod"]').click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()

    // Gears' 15 rods are requested from it.
    await selectSlot(page, 'Products', 'Iron rod')
    await expect(detail(page, 'Products')).toContainText('requested 15.0')
    await expect(productEntry(page, 'export')).toHaveText('Gears requests 15.0')

    await page.locator('button[title="Gears"]').click()
    await selectSlot(page, 'Ingredients', 'Iron rod')
    await expect(sourceEntry(page)).toContainText('Iron rod')
    await expect(sourceEntry(page)).toContainText('15.0')
    await expect(importEntry(page)).toHaveCount(0)

    const download = await exportPlan(page)
    const exported = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'))
    const rods = exported.blocks.find((b: { name: string }) => b.name === 'Iron rod')
    expect(rods.products).toEqual([{ id: expect.any(String), itemId: 'nullius-iron-rod' }])
    const gears = exported.blocks.find((b: { name: string }) => b.name === 'Gears')
    expect(gears.inputConnections).toContainEqual(
      expect.objectContaining({ itemId: 'nullius-iron-rod', fromBlockId: rods.id }),
    )
  })

  test('Use connections first makes the source supply what the own recipe would make', async ({ page }) => {
    await setup(page)
    await requestPlates(page)

    // Gears gets its own iron plate recipe: it comes first, so the request delivers nothing.
    await detail(page, 'Ingredients').getByRole('button', { name: 'Find recipe' }).click()
    await page.locator('[data-testid="recipe-slot"][data-recipe-id="nullius-iron-plate"]').click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
    await ensureSelected(page)
    await expect(sourceSegment(page)).toHaveCount(0)
    await expect(slot(page, 'Ingredients', 'Iron ingot')).toContainText('40.0')

    await plateSlot(page).click({ button: 'right' })
    const first = page.getByRole('menuitemcheckbox', { name: /Use connections first/ })
    await expect(first).toHaveAttribute('aria-checked', 'false')
    await first.click()

    await ensureSelected(page)
    await expect(sourceEntry(page)).toContainText('30.0')
    await expect(slot(page, 'Ingredients', 'Iron ingot')).toHaveCount(0)
    await page.locator('button[title="Plates"]').click()
    await selectSlot(page, 'Products', 'Iron plate')
    await expect(page.getByTitle(/^Actual: 90\.0/)).toBeVisible()
    await page.locator('button[title="Gears"]').click()

    await plateSlot(page).click({ button: 'right' })
    await expect(page.getByRole('menuitemcheckbox', { name: /Use connections first/ })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    const download = await exportPlan(page)
    const exported = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'))
    const gears = exported.blocks.find((b: { name: string }) => b.name === 'Gears')
    expect(gears.connectionsFirstItems).toEqual(['nullius-iron-plate'])

    await plateSlot(page).click({ button: 'right' })
    await page.getByRole('menuitemcheckbox', { name: /Use connections first/ }).click()
    await expect(slot(page, 'Ingredients', 'Iron ingot')).toContainText('40.0')
  })
})
