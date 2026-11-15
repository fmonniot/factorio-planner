import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'

/**
 * Editing the served list. "Plates" makes exactly 60 iron plate/min (a pinned row, no extra output); "Gears" and "Belts"
 * each request 30 of it, so both are served in full. "Late" needs 30 too but is not connected until the test connects it
 * (a take, as plate is a product of Plates it is a request), after the order was first stored: it is not ranked and is
 * served last, short.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')
const PLATES_ID = 'bbbb0001-0000-0000-0000-000000000001'
const ITEM = 'nullius-iron-plate'

function buildPlan() {
  const plan = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const [plates, gears] = plan.blocks
  plates.products = [{ id: 'bbbb0001-0000-0000-0000-0000000000p1', itemId: ITEM }]
  delete plates.goals
  plates.rootPlan.nodes[0].pinnedRate = 20 // 3 plates per run: 60 plate/min
  gears.inputConnections = [{ id: 'bbbb0002-c000-0000-0000-000000000001', itemId: ITEM, fromBlockId: PLATES_ID }]
  const clone = (n: number, name: string, connected: boolean) => {
    const b = structuredClone(gears)
    b.id = `bbbb000${n}-0000-0000-0000-000000000001`
    b.name = name
    b.goals[0].id = `bbbb000${n}-0000-0000-0000-0000000000g1`
    b.rootPlan.id = `bbbb000${n}-0000-0000-0000-0000000000a1`
    b.rootPlan.nodes[0].id = `bbbb000${n}-0000-0000-0000-0000000000n1`
    b.inputConnections = connected ? [{ id: `bbbb000${n}-c000-0000-0000-000000000001`, itemId: ITEM, fromBlockId: PLATES_ID }] : []
    return b
  }
  plan.blocks = [plates, gears, clone(3, 'Belts', true), clone(4, 'Late', false)]
  plan.activeBlockId = PLATES_ID
  return plan
}

async function setup(page: Page, testInfo: TestInfo) {
  const file = testInfo.outputPath('plan.json')
  fs.writeFileSync(file, JSON.stringify(buildPlan()))
  await loadPlanFixture(page, file)
  await expect(page.getByRole('region', { name: 'Products', exact: true })).toBeVisible({ timeout: 10000 })
}

const servedButton = (page: Page) => detail(page, 'Products').getByRole('button', { name: /^Served order…/ })
const popover = (page: Page) => page.getByTestId('served-order-popover')
const lineOf = (page: Page, name: string): Locator => popover(page).getByTestId('served-line').filter({ hasText: name })
const rankedNames = async (page: Page) => (await popover(page).getByTestId('served-ranked').getByTestId('served-line').allInnerTexts()).map(t => t.split(/\s/)[1])

async function openPopover(page: Page) {
  await selectSlot(page, 'Products', 'Iron plate')
  await servedButton(page).click()
  await expect(popover(page)).toBeVisible()
}

/** Connect Late to Plates as a request, as block-requests.spec.ts does for Gears. */
async function connectLate(page: Page) {
  await page.locator('[data-testid="block-tab"] button[aria-label="Late"]').click()
  await slot(page, 'Ingredients', 'Iron plate').click({ button: 'right' })
  await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' }).click()
  await expect(slot(page, 'Ingredients', 'Iron plate')).toBeVisible()
  await page.locator('[data-testid="block-tab"] button[aria-label="Plates"]').click()
}

/** Steps 1 to 4 of the buttons test: Belts moved first, then Late connected and left unranked. */
async function rankBeltsFirstAndConnectLate(page: Page) {
  await openPopover(page)
  await expect(popover(page).getByTestId('served-line')).toHaveCount(2)
  await lineOf(page, 'Belts').getByTestId('served-move-up').click()
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await connectLate(page)
  await selectSlot(page, 'Products', 'Iron plate')
  await expect(servedButton(page)).toHaveAccessibleName('Served order… · 1 not ranked')
  await servedButton(page).click()
  await expect(popover(page).getByTestId('served-divider')).toContainText('Not ranked: served after the list')
}

test('Served order: move, add and reset with the buttons', async ({ page }, testInfo) => {
  await setup(page, testInfo)
  await openPopover(page)

  // Today's order: Gears then Belts, both served in full; no divider, no reset.
  const lines = popover(page).getByTestId('served-line')
  await expect(lines).toHaveCount(2)
  await expect(lines.nth(0)).toContainText('Gears')
  await expect(lines.nth(1)).toContainText('Belts')
  for (let i = 0; i < 2; i++) {
    await expect(lines.nth(i)).toContainText('asked 30.0')
    await expect(lines.nth(i)).toContainText('got 30.0')
  }
  await expect(popover(page).getByTestId('served-divider')).toHaveCount(0)
  await expect(popover(page).getByTestId('served-reset')).toHaveCount(0)

  // Belts up: Belts is first, so Move up is spent and the focus lands on Move down.
  await lineOf(page, 'Belts').getByTestId('served-move-up').click()
  await expect(popover(page).getByTestId('served-reset')).toBeVisible()
  await expect.poll(() => rankedNames(page)).toEqual(['Belts', 'Gears'])
  await expect(lineOf(page, 'Belts').getByTestId('served-move-down')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)

  // Late joins afterwards: not ranked, served last, short.
  await connectLate(page)
  await selectSlot(page, 'Products', 'Iron plate')
  await expect(servedButton(page)).toHaveAccessibleName('Served order… · 1 not ranked')
  await servedButton(page).click()
  await expect(popover(page).getByTestId('served-divider')).toContainText('Not ranked: served after the list')
  await expect.poll(() => rankedNames(page)).toEqual(['Belts', 'Gears'])
  const late = popover(page).getByTestId('served-unranked').getByTestId('served-line')
  await expect(late).toContainText('Late')
  await expect(late).toContainText(/got 0(\.0+)?(?!\d)/)
  await expect(late.getByTestId('served-short')).toContainText('short 30.0')

  // Add to list: last, still short; the count and divider go.
  await late.getByTestId('served-add').click()
  await expect(popover(page).getByTestId('served-divider')).toHaveCount(0)
  await expect.poll(() => rankedNames(page)).toEqual(['Belts', 'Gears', 'Late'])
  await expect(lineOf(page, 'Late').getByTestId('served-short')).toContainText('short 30.0')
  await expect(servedButton(page)).toHaveText('Served order…')

  // Late up twice: first in line, so Gears goes short.
  await lineOf(page, 'Late').getByTestId('served-move-up').click()
  await lineOf(page, 'Late').getByTestId('served-move-up').click()
  await expect.poll(() => rankedNames(page)).toEqual(['Late', 'Belts', 'Gears'])
  await expect(lineOf(page, 'Late')).toContainText('got 30.0')
  await expect(lineOf(page, 'Gears').getByTestId('served-short')).toContainText('short 30.0')

  // Reset order: the solver's order again.
  await popover(page).getByTestId('served-reset').click()
  await expect(popover(page).getByTestId('served-reset')).toHaveCount(0)
  await expect.poll(() => rankedNames(page)).toEqual(['Gears', 'Belts', 'Late'])
  await expect(lineOf(page, 'Late').getByTestId('served-short')).toContainText('short 30.0')
})

test('Served order: a line joins the list when dragged into it', async ({ page }, testInfo) => {
  await setup(page, testInfo)
  await rankBeltsFirstAndConnectLate(page)

  await lineOf(page, 'Late').dragTo(lineOf(page, 'Belts'), { targetPosition: { x: 20, y: 2 } })
  await expect(popover(page).getByTestId('served-divider')).toHaveCount(0)
  await expect.poll(() => rankedNames(page)).toEqual(['Late', 'Belts', 'Gears'])
  await expect(servedButton(page)).toHaveText('Served order…')
  await expect(lineOf(page, 'Late')).toContainText('got 30.0')
  await expect(lineOf(page, 'Gears').getByTestId('served-short')).toContainText('short 30.0')
})
