import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'

/**
 * Same fixture as block-connection.spec.ts: block "Plates" (goal iron plate
 * 60/min) and the active block "Gears" (goal iron gear 30/min) which imports
 * 30 plate/min from outside.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')
const PLATES_ID = 'bbbb0001-0000-0000-0000-000000000001'

const plateSlot = (page: Page) => slot(page, 'Ingredients', 'Iron plate')
const sourceSegment = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-segment"][data-kind="source"]')
const node = (page: Page, name: string) => page.getByTestId('graph-node').filter({ has: page.getByRole('button', { name, exact: true }) })

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })
}

async function openGraph(page: Page) {
  await page.getByRole('button', { name: 'Block graph' }).click()
  await expect(page.getByRole('heading', { name: 'Block graph' })).toBeVisible()
}

async function closeGraph(page: Page) {
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('heading', { name: 'Block graph' })).toHaveCount(0)
}

async function connectPlatesToGears(page: Page) {
  // Gears becomes a target only once the Plates solve has landed.
  await node(page, 'Plates').getByTestId('graph-connect-handle').click()
  await expect(page.getByTestId('graph-connect-hint')).toBeVisible()
  await expect(node(page, 'Gears')).toHaveAttribute('data-connect', 'target')
  await node(page, 'Gears').getByRole('button', { name: 'Gears', exact: true }).click()
  await page.getByRole('menuitem', { name: /Iron plate/ }).click()
  await expect(page.getByTestId('graph-edge')).toHaveCount(1)
}

test.describe('block graph', () => {
  test('opens and shows the blocks', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await expect(page.getByTestId('graph-node')).toHaveCount(2)
    await expect(page.getByTestId('graph-edge')).toHaveCount(0)
    await expect(node(page, 'Gears')).toHaveAttribute('data-active', 'true')
  })

  test('creates a connection from the source side', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await connectPlatesToGears(page)

    const edge = page.getByTestId('graph-edge')
    await expect(edge).toHaveAttribute('data-from', PLATES_ID)
    await expect(page.getByTestId('graph-edge-label')).toContainText('30.0')
    await expect(page.getByTestId('graph-edge-label')).toHaveAttribute('data-status', 'ok')

    // Gears (still the active block) now receives the plates.
    await closeGraph(page)
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(sourceSegment(page)).toContainText('Plates')
    await expect(detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="source"]')).toContainText('30.0')
    await expect(detail(page, 'Ingredients').locator('[data-kind="import"]')).toHaveCount(0)
  })

  test('rejects a cycle and a connection with nothing left to send', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await connectPlatesToGears(page)

    await node(page, 'Gears').getByTestId('graph-connect-handle').click()
    await expect(node(page, 'Plates')).toHaveAttribute('data-connect', 'blocked')
    await expect(node(page, 'Plates')).toHaveAttribute('title', /cycle/)
    await page.getByRole('button', { name: 'Cancel' }).click()

    await node(page, 'Plates').getByTestId('graph-connect-handle').click()
    await expect(node(page, 'Gears')).toHaveAttribute('data-connect', 'blocked')
  })

  test('a click on the background leaves connect mode', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await node(page, 'Plates').getByTestId('graph-connect-handle').click()
    await expect(page.getByTestId('graph-connect-hint')).toBeVisible()
    // The empty strip between the two stacked nodes lies on the layout layer, not the padding.
    const layer = await page.getByTestId('block-graph-layer').boundingBox()
    await page.mouse.click(layer!.x + layer!.width - 20, layer!.y + layer!.height / 2)
    await expect(page.getByTestId('graph-connect-hint')).toHaveCount(0)
  })

  test('draws the source block colour on its node and ok edge', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await connectPlatesToGears(page)

    // Palette colours are deterministic for this fixture (see block-color.spec.ts).
    await expect(node(page, 'Plates').getByTestId('graph-node-stripe')).toHaveAttribute('data-color', '#60a5fa')
    await expect(page.getByTestId('graph-edge')).toHaveAttribute('stroke', '#60a5fa')

    // A limit that holds plates back turns the edge amber.
    await page.getByTestId('graph-edge-limit').click()
    await page.getByRole('spinbutton', { name: 'Connection limit' }).fill('10')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('graph-edge')).toHaveAttribute('stroke', '#f59e0b')
  })

  test('removes a connection from its edge', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await connectPlatesToGears(page)

    await page.getByTestId('graph-edge-remove').click()
    await expect(page.getByTestId('graph-edge')).toHaveCount(0)
    await closeGraph(page)
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(sourceSegment(page)).toHaveCount(0)
    await expect(plateSlot(page)).toHaveAccessibleName(/, 30\.0 per/)
  })

  test('limits a connection from its edge', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await connectPlatesToGears(page)

    await page.getByTestId('graph-edge-limit').click()
    await page.getByRole('spinbutton', { name: 'Connection limit' }).fill('10')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('graph-edge-label')).toContainText('10')
    await expect(page.getByTestId('graph-edge-limit')).toContainText('≤')

    // Gears (still the active block) takes 10 from Plates and imports the rest.
    await closeGraph(page)
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="source"]')).toContainText('10.0')
    await expect(plateSlot(page)).toHaveAccessibleName(/, 30\.0 per/)

    // Clearing the limit from the edge gives the plates back.
    await openGraph(page)
    await page.getByTestId('graph-edge-limit').click()
    await page.getByRole('spinbutton', { name: 'Connection limit' }).fill('')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('graph-edge-limit')).not.toContainText('10')
    await closeGraph(page)
    await expect(detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="source"]')).toContainText('30.0')
  })

  test('clicking a block opens it', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await node(page, 'Plates').getByRole('button', { name: 'Plates', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Block graph' })).toHaveCount(0)
    await expect(page.locator('button[title="Plates"]')).toBeVisible()
  })
})
