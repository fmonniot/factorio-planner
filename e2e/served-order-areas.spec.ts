import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { detail, selectSlot } from './support/summary'

/**
 * Areas in the served list (synthetic case 19). "Plates" makes 45 iron plate/min (a pinned row, 3 plates per run). "Science"
 * asks 30 gear/min (30 plate), "Hub" asks 20 gear/min through two areas, Logistics (6 runs/min: 12 plate) and Building
 * (4 runs/min: 8 plate). With no stored list they are served in tab order: Science 30, Logistics 12, Building 3 of 8.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')
const PLATES_ID = 'bbbb0001-0000-0000-0000-000000000001'
const S = 'bbbb0002-0000-0000-0000-000000000001'
const H = 'bbbb0003-0000-0000-0000-000000000001'
const S_CONN = 'bbbb0002-c000-0000-0000-000000000001'
const H_CONN = 'bbbb0003-c000-0000-0000-000000000001'
const L = 'bbbb0003-0000-0000-0000-0000000000l1'
const B = 'bbbb0003-0000-0000-0000-0000000000b1'
const ITEM = 'nullius-iron-plate'
const STAMP = '2026-04-26T00:00:00.000Z'

const blockEntry = (blockId: string, flags: Record<string, unknown> = {}) => ({ kind: 'block', blockId, ...flags })

function buildPlan(servedOrder?: unknown[]) {
  const plan = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const [plates, gears] = plan.blocks
  plates.products = [{ id: 'bbbb0001-0000-0000-0000-0000000000p1', itemId: ITEM }]
  delete plates.goals
  plates.rootPlan.nodes[0].pinnedRate = 15 // 3 plates per run: 45 plate/min
  if (servedOrder) plates.servedOrder = { [ITEM]: servedOrder }
  gears.name = 'Science'
  gears.goals[0].rate = 30
  gears.inputConnections = [{ id: S_CONN, itemId: ITEM, fromBlockId: PLATES_ID }]
  const hub = structuredClone(gears)
  hub.id = H
  hub.name = 'Hub'
  hub.goals[0].id = 'bbbb0003-0000-0000-0000-0000000000g1'
  hub.goals[0].rate = 20
  hub.inputConnections = [{ id: H_CONN, itemId: ITEM, fromBlockId: PLATES_ID }]
  const area = (id: string, name: string, runs: number, n: number) => {
    const row = structuredClone(gears.rootPlan.nodes[0])
    row.id = `bbbb0003-0000-0000-0000-0000000000n${n}`
    row.pinnedRate = runs
    return { id, name, area: true, nodes: [row], subPlans: [], createdAt: STAMP, updatedAt: STAMP }
  }
  hub.rootPlan = {
    id: 'bbbb0003-0000-0000-0000-0000000000a1',
    name: 'Main',
    nodes: [
      { kind: 'subplan', id: 'bbbb0003-0000-0000-0000-0000000000h1', subPlanId: L },
      { kind: 'subplan', id: 'bbbb0003-0000-0000-0000-0000000000h2', subPlanId: B },
    ],
    subPlans: [area(L, 'Logistics', 6, 1), area(B, 'Building', 4, 2)],
    createdAt: STAMP,
    updatedAt: STAMP,
  }
  plan.blocks = [plates, gears, hub]
  plan.activeBlockId = PLATES_ID
  return plan
}

async function setup(page: Page, testInfo: TestInfo, servedOrder?: unknown[]) {
  const file = testInfo.outputPath('plan.json')
  fs.writeFileSync(file, JSON.stringify(buildPlan(servedOrder)))
  await loadPlanFixture(page, file)
  await expect(page.getByRole('region', { name: 'Products', exact: true })).toBeVisible({ timeout: 10000 })
}

const servedButton = (page: Page) => detail(page, 'Products').getByRole('button', { name: /^Served order…/ })
const popover = (page: Page) => page.getByTestId('served-order-popover')
const lineOf = (page: Page, name: string): Locator => popover(page).getByTestId('served-line').filter({ hasText: name })
const rankedLines = (page: Page) => popover(page).getByTestId('served-ranked').getByTestId('served-line')
const names = async (page: Page) => popover(page).getByTestId('served-ranked').getByTestId('served-line-name').allInnerTexts()
const attrs = async (page: Page, attr: string) => rankedLines(page).evaluateAll((els, a) => els.map(e => e.getAttribute(a)), attr)
const field = (page: Page, name: string) => lineOf(page, name).getByTestId('served-share')
const status = (page: Page) => popover(page).getByRole('status')
const storedList = (page: Page) => expect.poll(async () => {
  const plan = await readActivePlan(page, 'nullius') as { blocks: { servedOrder?: Record<string, unknown[]> }[] }
  return plan.blocks[0].servedOrder?.[ITEM]
})

async function openPopover(page: Page) {
  await selectSlot(page, 'Products', 'Iron plate')
  await servedButton(page).click()
  await expect(popover(page)).toBeVisible()
}

async function dragTo(page: Page, from: string, to: string, where: 'top' | 'middle' | 'bottom') {
  const box = await lineOf(page, to).boundingBox()
  if (!box) throw new Error(`no box for ${to}`)
  const y = where === 'top' ? 2 : where === 'middle' ? box.height / 2 : box.height - 2
  await lineOf(page, from).dragTo(lineOf(page, to), { targetPosition: { x: 20, y } })
}

test('Served areas: science first, the areas sharing, then one before the other', async ({ page }, testInfo) => {
  await setup(page, testInfo)
  await openPopover(page)

  // Today's order: one line per area, no groups.
  await expect.poll(() => names(page)).toEqual(['Science', 'Hub / Logistics', 'Hub / Building'])
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '2', '3'])
  await expect(popover(page).getByTestId('served-share')).toHaveCount(0)
  await expect(lineOf(page, 'Hub / Logistics')).toContainText('got 12.0')
  await expect(lineOf(page, 'Hub / Building')).toContainText('asked 8.0')
  await expect(lineOf(page, 'Hub / Building')).toContainText('got 3.0')
  await expect(lineOf(page, 'Hub / Building').getByTestId('served-short')).toContainText('short 5.0')

  // Building on the middle of Logistics: the areas share place 2 and split the 15 left (row d).
  await dragTo(page, 'Hub / Building', 'Hub / Logistics', 'middle')
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '2', '2'])
  await expect(field(page, 'Hub / Logistics')).toHaveValue('50')
  await expect(field(page, 'Hub / Building')).toHaveValue('50')
  await expect(lineOf(page, 'Hub / Logistics')).toContainText('got 7.5')
  await expect(lineOf(page, 'Hub / Logistics').getByTestId('served-short')).toContainText('short 4.5')
  await expect(lineOf(page, 'Hub / Building')).toContainText('got 7.5')
  await expect(lineOf(page, 'Hub / Building').getByTestId('served-short')).toContainText('short 0.5')
  await expect(status(page)).toHaveText('Hub / Building now shares place 2 with Hub / Logistics.')
  await storedList(page).toEqual([
    blockEntry(S),
    blockEntry(H, { areaId: L }),
    blockEntry(H, { areaId: B, tied: true }),
  ])

  // Building on the top edge of Logistics: its own place, ahead of it (row c).
  await dragTo(page, 'Hub / Building', 'Hub / Logistics', 'top')
  await expect.poll(() => names(page)).toEqual(['Science', 'Hub / Building', 'Hub / Logistics'])
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '2', '3'])
  await expect(popover(page).getByTestId('served-share')).toHaveCount(0)
  await expect(lineOf(page, 'Hub / Building')).toContainText('got 8.0')
  await expect(lineOf(page, 'Hub / Building').getByTestId('served-short')).toHaveCount(0)
  await expect(lineOf(page, 'Hub / Logistics')).toContainText('got 7.0')
  await expect(lineOf(page, 'Hub / Logistics').getByTestId('served-short')).toContainText('short 5.0')
  await expect(status(page)).toHaveText('Hub / Building moved to its own place 2.')
  await storedList(page).toEqual([
    blockEntry(S),
    blockEntry(H, { areaId: B }),
    blockEntry(H, { areaId: L }),
  ])
})

test('Served areas: a list written before the popover drew areas expands on the first gesture', async ({ page }, testInfo) => {
  await setup(page, testInfo, [blockEntry(S), blockEntry(H)])
  await openPopover(page)

  // One plain entry stands for both areas: one place, served in table order (row b).
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '2', '2'])
  await expect.poll(() => attrs(page, 'data-span-size')).toEqual([null, '2', '2'])
  await expect(popover(page).getByTestId('served-share')).toHaveCount(0)
  await expect(servedButton(page)).toHaveAccessibleName('Served order…')
  await expect(lineOf(page, 'Hub / Logistics')).toContainText('got 12.0')
  await expect(lineOf(page, 'Hub / Building')).toContainText('got 3.0')
  await expect(lineOf(page, 'Hub / Building').getByTestId('served-short')).toContainText('short 5.0')

  await lineOf(page, 'Hub / Building').getByTestId('served-move-up').click()
  await expect.poll(() => names(page)).toEqual(['Science', 'Hub / Building', 'Hub / Logistics'])
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '2', '3'])
  await expect(lineOf(page, 'Hub / Building')).toContainText('got 8.0')
  await expect(lineOf(page, 'Hub / Logistics')).toContainText('got 7.0')
  await expect(status(page)).toHaveText('Hub / Building moved to place 2.')
  await storedList(page).toEqual([
    blockEntry(S),
    blockEntry(H, { areaId: B }),
    blockEntry(H, { areaId: L }),
  ])

  // The graph chips: the Hub chip is "Limited: ..." so it is found by its connection.
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Block graph' }).click()
  const chipOf = (id: string) => page.locator(`[data-testid="graph-edge-label"][data-connection-id="${id}"]`)
  await expect(chipOf(S_CONN).getByTestId('graph-edge-rank')).toHaveText('#1')
  await expect(chipOf(H_CONN).getByTestId('graph-edge-rank')).toHaveText('#2')
  await expect(chipOf(H_CONN)).toHaveAttribute('data-tip', /served 2nd \(Hub \/ Building\), 3rd \(Hub \/ Logistics\) in Plates's list/)
})

test('Served areas: an area the list does not rank is added by hand', async ({ page }, testInfo) => {
  await setup(page, testInfo, [blockEntry(S)])
  await selectSlot(page, 'Products', 'Iron plate')
  await expect(servedButton(page)).toHaveAccessibleName('Served order… · 2 not ranked')
  await servedButton(page).click()
  await expect(popover(page)).toBeVisible()
  await expect.poll(() => names(page)).toEqual(['Science'])
  const unranked = popover(page).getByTestId('served-unranked').getByTestId('served-line')
  await expect(unranked).toHaveCount(2)
  await expect(unranked.getByTestId('served-add')).toHaveCount(2)
  await expect(popover(page).getByTestId('served-unranked').getByTestId('served-line-name')).toHaveText(['Hub / Logistics', 'Hub / Building'])

  await lineOf(page, 'Hub / Logistics').getByTestId('served-add').click()
  await storedList(page).toEqual([blockEntry(S), blockEntry(H, { areaId: L })])
  await expect(servedButton(page)).toHaveAccessibleName('Served order… · 1 not ranked')
  await expect(popover(page).getByTestId('served-unranked').getByTestId('served-line')).toHaveCount(1)
  await expect(lineOf(page, 'Hub / Building')).toHaveAttribute('data-ranked', 'false')
})
