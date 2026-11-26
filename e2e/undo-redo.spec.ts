import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, slot, slotById } from './support/summary'
import { openGraph, pinEdge, closeGraph } from './support/blockGraph'

/**
 * Fixture: block "Plates" (product iron plate 60/min) and the active block "Gears" (product iron gear 30/min), which needs
 * 30 plate/min and 15 rod/min from outside. One history spans both blocks: an undo goes to the block of the newest edit.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

const plateSlot = (page: Page) => slot(page, 'Ingredients', 'Iron plate')
const sourceSegment = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-segment"][data-kind="source"]')
const undoButton = (page: Page) => page.getByRole('button', { name: /^Undo/ })
const redoButton = (page: Page) => page.getByRole('button', { name: /^Redo/ })
const tab = (page: Page, name: string) => page.locator(`[data-testid="block-tab"] button[aria-label="${name}"]`)
const graphNode = (page: Page, name: string) => page.getByTestId('graph-node').filter({ has: page.getByRole('button', { name, exact: true }) })
const ironPlateGoal = (page: Page) => slotById(page, 'Products', 'nullius-iron-plate')

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })
}

/** Add a product through the item picker; `amount` '' clears the field (no extra output). */
async function addProduct(page: Page, itemName: string, itemId: string, amount?: string) {
  await page.getByRole('button', { name: 'Add product', exact: true }).click()
  const overlay = page.locator('.fixed.inset-0')
  await overlay.getByPlaceholder('Search…').fill(itemName)
  if (amount !== undefined) await overlay.getByLabel('Amount').fill(amount)
  await overlay.locator(`[data-testid="item-slot"][data-item-id="${itemId}"]`).click()
}

/** On Gears: request iron plate from Plates through the connection menu. */
async function requestPlates(page: Page) {
  await plateSlot(page).click({ button: 'right' })
  await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' }).click()
  if ((await plateSlot(page).getAttribute('aria-pressed')) !== 'true') await plateSlot(page).click()
  await expect(sourceSegment(page)).toBeVisible()
}

/** Gears requests plates; Plates is active, the graph is open and the connection has just been removed from its edge. */
async function removeConnectionInGraph(page: Page) {
  await requestPlates(page)
  await tab(page, 'Plates').click()
  await openGraph(page)
  await pinEdge(page, { to: 'Gears' })
  await page.getByTestId('graph-edge-remove').click()
  await expect(page.getByTestId('graph-edge')).toHaveCount(0)
}

test.describe('undo and redo', () => {
  test('the buttons start disabled and a disabled one still shows its tooltip', async ({ page }) => {
    await setup(page)
    await expect(undoButton(page)).toBeDisabled()
    await expect(redoButton(page)).toBeDisabled()
    await undoButton(page).locator('..').hover()
    await expect(page.getByText(/^Undo \((Ctrl|Cmd)\+Z\)$/)).toBeVisible()
  })

  test('adding a goal is undone and redone by the buttons', async ({ page }) => {
    await setup(page)
    await addProduct(page, 'Iron plate', 'nullius-iron-plate', '60')
    await expect(ironPlateGoal(page)).toHaveCount(1)

    await undoButton(page).click()
    await expect(ironPlateGoal(page)).toHaveCount(0)
    await expect(undoButton(page)).toBeDisabled()
    await expect(redoButton(page)).toBeEnabled()

    await redoButton(page).click()
    await expect(ironPlateGoal(page)).toHaveCount(1)
  })

  test('Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo', async ({ page }) => {
    await setup(page)
    await addProduct(page, 'Iron plate', 'nullius-iron-plate', '60')
    await expect(ironPlateGoal(page)).toHaveCount(1)

    await page.keyboard.press('Control+z')
    await expect(ironPlateGoal(page)).toHaveCount(0)
    await page.keyboard.press('Control+Shift+z')
    await expect(ironPlateGoal(page)).toHaveCount(1)

    await page.keyboard.press('Control+z')
    await expect(ironPlateGoal(page)).toHaveCount(0)
    await page.keyboard.press('Control+y')
    await expect(ironPlateGoal(page)).toHaveCount(1)
  })

  test('Ctrl+Z in a text field is left to the field', async ({ page }) => {
    await setup(page)
    await addProduct(page, 'Iron plate', 'nullius-iron-plate', '60')
    await expect(ironPlateGoal(page)).toHaveCount(1)

    await page.getByRole('button', { name: 'Add product', exact: true }).click()
    const amount = page.locator('.fixed.inset-0').getByLabel('Amount')
    await amount.focus()
    await amount.pressSequentially('123')
    await page.keyboard.press('Control+z')
    await expect(page.locator('.fixed.inset-0').getByLabel('Amount')).toBeVisible()
    await expect(ironPlateGoal(page)).toHaveCount(1)
  })

  test('an open picker blocks the shortcut', async ({ page }) => {
    await setup(page)
    await addProduct(page, 'Iron plate', 'nullius-iron-plate', '60')
    await expect(ironPlateGoal(page)).toHaveCount(1)

    await page.getByRole('button', { name: 'Add product', exact: true }).click()
    await expect(page.locator('.fixed.inset-0')).toBeVisible()
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Escape')
    await expect(ironPlateGoal(page)).toHaveCount(1)
  })

  test('Ctrl+Z inside the graph undoes an edit of another block and makes it active', async ({ page }) => {
    await setup(page)
    await removeConnectionInGraph(page)

    await page.keyboard.press('Control+z')
    await expect(page.getByTestId('graph-edge')).toHaveCount(1)
    await expect(graphNode(page, 'Gears')).toHaveAttribute('data-active', 'true')

    await closeGraph(page)
    await expect(tab(page, 'Gears')).toHaveAttribute('aria-current', 'true')
    await plateSlot(page).click()
    await expect(sourceSegment(page)).toContainText('Plates')
  })

  test('the buttons name the block of the edit, and redo goes back to it', async ({ page }) => {
    await setup(page)
    await removeConnectionInGraph(page)
    await closeGraph(page)
    await expect(tab(page, 'Plates')).toHaveAttribute('aria-current', 'true')

    await expect(undoButton(page)).toHaveAccessibleName(/^Undo in Gears/)
    await undoButton(page).click()
    await expect(tab(page, 'Gears')).toHaveAttribute('aria-current', 'true')
    await plateSlot(page).click()
    await expect(sourceSegment(page)).toBeVisible()

    await tab(page, 'Plates').click()
    await expect(redoButton(page)).toHaveAccessibleName(/^Redo in Gears/)
    await redoButton(page).click()
    await expect(tab(page, 'Gears')).toHaveAttribute('aria-current', 'true')
    await expect(sourceSegment(page)).toHaveCount(0)
  })

  test('undoing a request made in a new block goes back to the consumer and keeps the new block', async ({ page }) => {
    await setup(page)
    await slot(page, 'Ingredients', 'Iron rod').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Make in a new block…' }).click()
    const strip = page.getByTestId('block-tab-strip')
    await expect(strip.getByRole('button', { name: 'Iron rod' })).toHaveAttribute('aria-current', 'true')
    // Leave the recipe picker without a recipe: adding one would be an edit of the new block, undone first.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
    await expect(strip.getByRole('button', { name: 'Iron rod' })).toHaveAttribute('aria-current', 'true')

    await page.keyboard.press('Control+z')
    await expect(tab(page, 'Gears')).toHaveAttribute('aria-current', 'true')
    await expect(strip.getByRole('button', { name: 'Iron rod' })).toHaveCount(1)
    await expect(sourceSegment(page)).toHaveCount(0)
  })
})
