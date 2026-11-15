import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { detail, selectSlot } from './support/summary'

/**
 * Groups and shares in the served list. "Plates" makes 45 iron plate/min (a pinned row, 3 plates per run) plus a 10/min
 * extra output on the product. "Gears" (30), "Belts" (20) and "Cogs" (10) each request plate: with no stored list they
 * are served in tab order, the extra last: Gears 30, Belts 15, Cogs 0, extra 0.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')
const PLATES_ID = 'bbbb0001-0000-0000-0000-000000000001'
const G = 'bbbb0002-0000-0000-0000-000000000001'
const BELTS = 'bbbb0003-0000-0000-0000-000000000001'
const COGS = 'bbbb0004-0000-0000-0000-000000000001'
const ITEM = 'nullius-iron-plate'

function buildPlan() {
  const plan = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const [plates, gears] = plan.blocks
  plates.products = [{ id: 'bbbb0001-0000-0000-0000-0000000000p1', itemId: ITEM, extraRate: 10 }]
  delete plates.goals
  plates.rootPlan.nodes[0].pinnedRate = 15 // 3 plates per run: 45 plate/min
  gears.name = 'Gears'
  gears.goals[0].rate = 30
  gears.inputConnections = [{ id: 'bbbb0002-c000-0000-0000-000000000001', itemId: ITEM, fromBlockId: PLATES_ID }]
  const clone = (n: number, name: string, rate: number) => {
    const b = structuredClone(gears)
    b.id = `bbbb000${n}-0000-0000-0000-000000000001`
    b.name = name
    b.goals[0].id = `bbbb000${n}-0000-0000-0000-0000000000g1`
    b.goals[0].rate = rate
    b.rootPlan.id = `bbbb000${n}-0000-0000-0000-0000000000a1`
    b.rootPlan.nodes[0].id = `bbbb000${n}-0000-0000-0000-0000000000n1`
    b.inputConnections = [{ id: `bbbb000${n}-c000-0000-0000-000000000001`, itemId: ITEM, fromBlockId: PLATES_ID }]
    return b
  }
  plan.blocks = [plates, gears, clone(3, 'Belts', 20), clone(4, 'Cogs', 10)]
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
const rankedLines = (page: Page) => popover(page).getByTestId('served-ranked').getByTestId('served-line')
const names = async (page: Page) => (await popover(page).getByTestId('served-ranked').getByTestId('served-line-name').allInnerTexts())
const attrs = async (page: Page, attr: string) => rankedLines(page).evaluateAll((els, a) => els.map(e => e.getAttribute(a)), attr)
const tie = (page: Page, name: string) => lineOf(page, name).getByTestId('served-tie')
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

test('Served order groups: join by drop, edit a percentage, figures follow', async ({ page }, testInfo) => {
  await setup(page, testInfo)
  await openPopover(page)

  // Today's order: no groups, no fields.
  await expect.poll(() => names(page)).toEqual(['Gears', 'Belts', 'Cogs', 'Extra output'])
  await expect(lineOf(page, 'Belts')).toContainText('got 15.0')
  await expect(lineOf(page, 'Belts').getByTestId('served-short')).toContainText('short 5.0')
  await expect(lineOf(page, 'Cogs')).toContainText(/got 0(\.0+)?(?!\d)/)
  await expect(popover(page).getByTestId('served-share')).toHaveCount(0)
  await expect(popover(page).getByTestId('served-tie')).toHaveCount(4)

  // Cogs dropped on the middle of Belts: they share place 2 and split what is left.
  await dragTo(page, 'Cogs', 'Belts', 'middle')
  await expect.poll(() => names(page)).toEqual(['Gears', 'Belts', 'Cogs', 'Extra output'])
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '2', '2', '3'])
  await expect.poll(() => attrs(page, 'data-group-size')).toEqual([null, '2', '2', null])
  await expect(field(page, 'Belts')).toHaveValue('50')
  await expect(field(page, 'Cogs')).toHaveValue('50')
  await expect(lineOf(page, 'Belts')).toContainText('got 7.5')
  await expect(lineOf(page, 'Belts').getByTestId('served-short')).toContainText('short 12.5')
  await expect(lineOf(page, 'Cogs')).toContainText('got 7.5')
  await expect(lineOf(page, 'Cogs').getByTestId('served-short')).toContainText('short 2.5')
  await expect(status(page)).toHaveText('Cogs now shares place 2 with Belts.')
  await storedList(page).toEqual([
    { kind: 'block', blockId: G },
    { kind: 'block', blockId: BELTS },
    { kind: 'block', blockId: COGS, tied: true },
    { kind: 'extra' },
  ])

  // 80 percent to Belts.
  await field(page, 'Belts').fill('80')
  await field(page, 'Belts').press('Enter')
  await expect(field(page, 'Cogs')).toHaveValue('20')
  await expect(lineOf(page, 'Belts')).toContainText('got 12.0')
  await expect(lineOf(page, 'Belts').getByTestId('served-short')).toContainText('short 8.0')
  await expect(lineOf(page, 'Cogs')).toContainText('got 3.0')
  await expect(lineOf(page, 'Cogs').getByTestId('served-short')).toContainText('short 7.0')
  await storedList(page).toEqual([
    { kind: 'block', blockId: G },
    { kind: 'block', blockId: BELTS, share: 80 },
    { kind: 'block', blockId: COGS, tied: true, share: 20 },
    { kind: 'extra' },
  ])

  // An invalid value reverts and is announced; Escape reverts first, the next one closes the popover.
  await field(page, 'Belts').fill('0')
  await field(page, 'Belts').press('Enter')
  await expect(field(page, 'Belts')).toHaveValue('80')
  await expect(status(page)).toHaveText('Share must be above 0 and below 100.')
  await field(page, 'Belts').fill('30')
  await field(page, 'Belts').press('Escape')
  await expect(field(page, 'Belts')).toHaveValue('80')
  await expect(popover(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)

  // The extra joins the group: weights 80, 20 and their mean 50.
  await servedButton(page).click() // the slot is still selected
  await expect(popover(page)).toBeVisible()
  await tie(page, 'Extra output').click()
  await expect(field(page, 'Belts')).toHaveValue('53.3')
  await expect(field(page, 'Cogs')).toHaveValue('13.3')
  await expect(field(page, 'Extra output')).toHaveValue('33.3')
  await expect(lineOf(page, 'Belts')).toContainText('got 8.0')
  await expect(lineOf(page, 'Cogs')).toContainText('got 2.0')
  await expect(lineOf(page, 'Extra output')).toContainText('got 5.0')
  await expect(lineOf(page, 'Extra output').getByTestId('served-short')).toContainText('short 5.0')
})

test('Served order groups: join by toggle and leave by toggle', async ({ page }, testInfo) => {
  await setup(page, testInfo)
  await openPopover(page)

  await tie(page, 'Cogs').click()
  await storedList(page).toEqual([
    { kind: 'block', blockId: G },
    { kind: 'block', blockId: BELTS },
    { kind: 'block', blockId: COGS, tied: true },
    { kind: 'extra' },
  ])
  await expect(tie(page, 'Cogs')).toHaveAttribute('aria-pressed', 'true')
  await expect(status(page)).toHaveText('Cogs now shares place 2 with Belts.')
  await expect(lineOf(page, 'Belts')).toContainText('got 7.5')
  await expect(lineOf(page, 'Cogs')).toContainText('got 7.5')

  // Belts heads {Belts, Cogs}: the pair joins Gears. 45 split three ways is 15 each; Cogs takes 10 and passes 5.
  await tie(page, 'Belts').click()
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '1', '1', '2'])
  for (const n of ['Gears', 'Belts', 'Cogs']) await expect(field(page, n)).toHaveValue('33.3')
  await expect(lineOf(page, 'Gears')).toContainText('got 17.5')
  await expect(lineOf(page, 'Gears').getByTestId('served-short')).toContainText('short 12.5')
  await expect(lineOf(page, 'Belts')).toContainText('got 17.5')
  await expect(lineOf(page, 'Belts').getByTestId('served-short')).toContainText('short 2.5')
  await expect(lineOf(page, 'Cogs')).toContainText('got 10.0')
  await expect(lineOf(page, 'Cogs').getByTestId('served-short')).toHaveCount(0)
  await expect(status(page)).toHaveText('Belts now shares place 1 with Gears. The 1 line under it went with it.')

  // Belts off (a middle member): it and Cogs leave Gears together.
  await tie(page, 'Belts').click()
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '2', '2', '3'])
  await expect(tie(page, 'Belts')).toHaveAttribute('aria-pressed', 'false')
  await expect(tie(page, 'Cogs')).toHaveAttribute('aria-pressed', 'true')
  await expect(lineOf(page, 'Belts')).toContainText('got 7.5')
  await expect(lineOf(page, 'Cogs')).toContainText('got 7.5')
  await expect(status(page)).toHaveText('Belts and the 1 line under it left the group; they share place 2.')

  // Cogs off: all alone again.
  await tie(page, 'Cogs').click()
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '2', '3', '4'])
  await expect(popover(page).getByTestId('served-share')).toHaveCount(0)
  await expect(lineOf(page, 'Belts')).toContainText('got 15.0')
  await expect(lineOf(page, 'Cogs').getByTestId('served-short')).toContainText('short 10.0')
  await expect(status(page)).toHaveText('Cogs left its group and has its own place 3.')
})

test('Served order groups: an edge drop leaves a group', async ({ page }, testInfo) => {
  await setup(page, testInfo)
  await openPopover(page)
  await tie(page, 'Cogs').click()
  await tie(page, 'Belts').click()
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '1', '1', '2'])

  // Cogs on the top edge of Belts, inside the group: it takes a place of its own and splits the group.
  await dragTo(page, 'Cogs', 'Belts', 'top')
  await expect.poll(() => names(page)).toEqual(['Gears', 'Cogs', 'Belts', 'Extra output'])
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '2', '3', '4'])
  await expect(popover(page).getByTestId('served-share')).toHaveCount(0)
  await expect(lineOf(page, 'Cogs')).toContainText('got 10.0')
  await expect(lineOf(page, 'Belts')).toContainText('got 5.0')
  await expect(lineOf(page, 'Belts').getByTestId('served-short')).toContainText('short 15.0')
  await expect(status(page)).toHaveText('Cogs moved to its own place 2.')
  await storedList(page).toEqual([
    { kind: 'block', blockId: G },
    { kind: 'block', blockId: COGS },
    { kind: 'block', blockId: BELTS },
    { kind: 'extra' },
  ])

  // Belts under Cogs, then the bottom edge of the line below (the extra, last): it leaves the group and goes last.
  await tie(page, 'Belts').click()
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '2', '2', '3'])
  await dragTo(page, 'Belts', 'Extra output', 'bottom')
  await expect.poll(() => names(page)).toEqual(['Gears', 'Cogs', 'Extra output', 'Belts'])
  await expect.poll(() => attrs(page, 'data-rank')).toEqual(['1', '2', '3', '4'])
  await expect(popover(page).getByTestId('served-share')).toHaveCount(0)
  // 45 plate/min: Gears 30, Cogs 10 (5 left), the extra asks 10 and gets 5, Belts is left with nothing.
  await expect(lineOf(page, 'Cogs')).toContainText('got 10.0')
  await expect(lineOf(page, 'Extra output')).toContainText('got 5.0')
  await expect(lineOf(page, 'Belts').getByTestId('served-short')).toContainText('short 20.0')
  await storedList(page).toEqual([
    { kind: 'block', blockId: G },
    { kind: 'block', blockId: COGS },
    { kind: 'extra' },
    { kind: 'block', blockId: BELTS },
  ])
})

test('Served order groups: the graph chips carry the rank of a group', async ({ page }, testInfo) => {
  await setup(page, testInfo)
  // A short consumer's chip is titled "Limited: ..." (no name in it), so the chips are found by their connection.
  const chipOf = (id: string) => page.locator(`[data-testid="graph-edge-label"][data-connection-id="${id}"]`)
  const chips = { Gears: chipOf('bbbb0002-c000-0000-0000-000000000001'), Belts: chipOf('bbbb0003-c000-0000-0000-000000000001'), Cogs: chipOf('bbbb0004-c000-0000-0000-000000000001') }
  const chipTo = (name: keyof typeof chips) => chips[name]

  await openPopover(page)
  await tie(page, 'Cogs').click()
  await storedList(page).toHaveLength(4)
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Block graph' }).click()
  await expect(chipTo('Gears').getByTestId('graph-edge-rank')).toHaveText('#1')
  await expect(chipTo('Belts').getByTestId('graph-edge-rank')).toHaveText('#2')
  await expect(chipTo('Cogs').getByTestId('graph-edge-rank')).toHaveText('#2')
  await expect(chipTo('Belts')).toHaveAttribute('title', /served 2nd \(shared\) in Plates's list/)
  await expect(chipTo('Cogs')).toHaveAttribute('title', /served 2nd \(shared\) in Plates's list/)
  await expect(chipTo('Gears')).toHaveAttribute('title', /served 1st in Plates's list/)
})
