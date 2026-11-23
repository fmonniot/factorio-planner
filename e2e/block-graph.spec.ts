import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'
import { closeGraph, pinEdge, openGraph, pointOnEdge } from './support/blockGraph'

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

/** Gears takes its plates from Plates, through the right-click menu of its Ingredients slot, then the graph opens. */
async function connectPlatesToGears(page: Page) {
  await plateSlot(page).click({ button: 'right' })
  await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' }).click()
  await openGraph(page)
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

  test('draws a connection made from the consumer\'s ingredient', async ({ page }) => {
    await setup(page)
    await connectPlatesToGears(page)

    const edge = page.getByTestId('graph-edge')
    await expect(edge).toHaveAttribute('data-from', PLATES_ID)
    await expect(page.getByTestId('graph-edge-summary')).toHaveAttribute('data-status', 'ok')
    const list = await pinEdge(page, { to: 'Gears' })
    await expect(list.getByTestId('graph-edge-label')).toContainText('30.0')
    await expect(list.getByTestId('graph-edge-label')).toHaveAttribute('data-status', 'ok')
    await expect(page.getByTestId('graph-edge-existing')).toHaveCount(0)

    // Gears (still the active block) now receives the plates.
    await closeGraph(page)
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(sourceSegment(page)).toContainText('Plates')
    await expect(sourceSegment(page).getByTestId('summary-segment-tip')).toContainText('30.0')
    await expect(detail(page, 'Ingredients').locator('[data-kind="import"]')).toHaveCount(0)
  })

  test('shows a connection chip\'s detail as an instant tooltip, with no native title', async ({ page }) => {
    await setup(page)
    await connectPlatesToGears(page)

    const list = await pinEdge(page, { to: 'Gears' })
    const chip = list.getByTestId('graph-edge-label')
    const tip = await chip.getAttribute('data-tip')
    expect(tip).toContain('→ Gears')
    await chip.hover()
    await expect(page.getByTestId('tooltip')).toHaveText(tip!)
    await expect(page.locator('[data-testid="graph-node"] [title], [data-testid="graph-edge-label"][title]')).toHaveCount(0)
  })

  test('a click pins a block, another moves the pin and the background clears it', async ({ page }) => {
    await setup(page)
    await connectPlatesToGears(page)
    await node(page, 'Plates').getByRole('button', { name: 'Plates', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Block graph' })).toBeVisible()
    await expect(node(page, 'Plates')).toHaveAttribute('data-pinned', 'true')
    await page.mouse.move(2, 2)
    await expect(page.getByTestId('graph-detail')).toContainText('Supplies')
    await node(page, 'Gears').getByRole('button', { name: 'Gears', exact: true }).click()
    await expect(node(page, 'Gears')).toHaveAttribute('data-pinned', 'true')
    await expect(node(page, 'Plates')).not.toHaveAttribute('data-pinned', 'true')
    // The padding just below the layout layer is the canvas background.
    const layer = await page.getByTestId('block-graph-layer').boundingBox()
    await page.mouse.click(layer!.x + layer!.width / 2, layer!.y + layer!.height + 6)
    await expect(page.locator('[data-pinned="true"]')).toHaveCount(0)
  })

  test('draws the source block colour on its node and ok edge', async ({ page }) => {
    await setup(page)
    await connectPlatesToGears(page)

    // Palette colours are deterministic for this fixture (see block-color.spec.ts).
    await expect(node(page, 'Plates').getByTestId('graph-node-stripe')).toHaveAttribute('data-color', '#60a5fa')
    await expect(page.getByTestId('graph-edge')).toHaveAttribute('stroke', '#60a5fa')

    // A limit that holds plates back turns the edge amber.
    await pinEdge(page, { to: 'Gears' })
    await page.getByTestId('graph-edge-limit').click()
    await page.getByRole('spinbutton', { name: 'Connection limit' }).fill('10')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('graph-edge')).toHaveAttribute('stroke', '#f59e0b')
  })

  test('removes a connection from its edge', async ({ page }) => {
    await setup(page)
    await connectPlatesToGears(page)

    await pinEdge(page, { to: 'Gears' })
    await page.getByTestId('graph-edge-remove').click()
    await expect(page.getByTestId('graph-edge')).toHaveCount(0)
    await closeGraph(page)
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(sourceSegment(page)).toHaveCount(0)
    await expect(plateSlot(page)).toHaveAccessibleName(/, 30\.0 per/)
  })

  test('limits a connection from its edge', async ({ page }) => {
    await setup(page)
    await connectPlatesToGears(page)

    const list = await pinEdge(page, { to: 'Gears' })
    await page.getByTestId('graph-edge-limit').click()
    await page.getByRole('spinbutton', { name: 'Connection limit' }).fill('10')
    await page.keyboard.press('Enter')
    await expect(list.getByTestId('graph-edge-label')).toContainText('10')
    await expect(page.getByTestId('graph-edge-limit')).toContainText('≤')

    // Gears (still the active block) takes 10 from Plates and imports the rest.
    await closeGraph(page)
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await expect(sourceSegment(page).getByTestId('summary-segment-tip')).toContainText('10.0')
    await expect(plateSlot(page)).toHaveAccessibleName(/, 30\.0 per/)

    // Clearing the limit from the edge gives the plates back.
    await openGraph(page)
    await pinEdge(page, { to: 'Gears' })
    await page.getByTestId('graph-edge-limit').click()
    await page.getByRole('spinbutton', { name: 'Connection limit' }).fill('')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('graph-edge-limit')).not.toContainText('10')
    await closeGraph(page)
    await expect(sourceSegment(page).getByTestId('summary-segment-tip')).toContainText('30.0')
  })

  test('pointing at a block dims what it is not connected to', async ({ page }) => {
    await setup(page)
    await connectPlatesToGears(page)
    // A third block with no connection to either.
    await closeGraph(page)
    await page.getByRole('button', { name: 'Add block' }).click()
    await openGraph(page)
    await expect(page.getByTestId('graph-node')).toHaveCount(3)

    await node(page, 'Plates').hover()
    await expect(node(page, 'Gears')).toHaveAttribute('data-lit', 'true')
    await expect(page.getByTestId('graph-edge')).toHaveAttribute('data-lit', 'true')
    const others = page.locator('[data-testid="graph-node"][data-dim="true"]')
    await expect(others).toHaveCount(1)
    await expect(page.getByTestId('graph-detail')).toContainText('Supplies')
    await expect(page.getByTestId('graph-detail')).toContainText('Gears')

    await page.mouse.move(2, 2)
    await expect(page.locator('[data-dim="true"]')).toHaveCount(0)
  })

  test('pointing at an edge lights it, shows its chip and a click pins it', async ({ page }) => {
    await setup(page)
    await connectPlatesToGears(page)
    await page.mouse.move(2, 2)
    const summary = page.getByTestId('graph-edge-summary')
    await expect(summary).not.toHaveAttribute('data-shown', 'true')

    const at = await pointOnEdge(page, page.getByTestId('graph-edge'))
    await page.mouse.move(at.x, at.y)
    await expect(page.getByTestId('graph-edge')).toHaveAttribute('data-lit', 'true')
    await expect(summary).toHaveAttribute('data-shown', 'true')
    await expect(page.getByTestId('graph-detail')).toContainText('Items on this edge')
    await expect(page.getByTestId('graph-detail').getByTestId('graph-edge-label')).toContainText('30.0')

    await page.mouse.click(at.x, at.y)
    await expect(summary).toHaveAttribute('data-pinned', 'true')
    // The pin holds when the pointer leaves, and the strip then edits the connection.
    await page.mouse.move(2, 2)
    await expect(page.getByTestId('graph-edge')).toHaveAttribute('data-lit', 'true')
    await page.getByTestId('graph-detail').getByTestId('graph-edge-limit').click()
    await page.getByRole('spinbutton', { name: 'Connection limit' }).fill('7')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('graph-detail').getByTestId('graph-edge-label')).toContainText('≤ 7')
  })

  test('pins an edge from the keyboard', async ({ page }) => {
    await setup(page)
    await connectPlatesToGears(page)
    await page.mouse.move(2, 2)
    const summary = page.getByTestId('graph-edge-summary')
    await summary.focus()
    await expect(page.getByTestId('graph-edge')).toHaveAttribute('data-lit', 'true')
    await expect(summary).toHaveAttribute('data-shown', 'true')
    await page.keyboard.press('Enter')
    await expect(summary).toHaveAttribute('data-pinned', 'true')
    await expect(page.getByTestId('graph-detail').getByTestId('graph-edge-label')).toHaveCount(1)
    // Escape unpins first; the graph stays open.
    await page.keyboard.press('Escape')
    await expect(summary).not.toHaveAttribute('data-pinned', 'true')
    await expect(page.getByRole('heading', { name: 'Block graph' })).toBeVisible()
  })

  test('the Go to button opens the block and closes the graph', async ({ page }) => {
    await setup(page)
    await openGraph(page)
    await node(page, 'Plates').getByTestId('graph-node-open').click()
    await expect(page.getByRole('heading', { name: 'Block graph' })).toHaveCount(0)
    await expect(page.locator('[data-testid="block-tab"] button[aria-label="Plates"]')).toBeVisible()
  })
})
