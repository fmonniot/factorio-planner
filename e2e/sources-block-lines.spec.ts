import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'
import { comesFromPopover } from './support/sidePanel'

/**
 * The block lines of the Sources list. The active block "Gears" makes iron gear (30/min) and needs 30 iron plate/min. Two
 * other blocks, "Cheap" and "Dear", each make gears too and run an iron plate row pinned well above what they need, so each
 * has plate to spare: Gears can take from either. Neither has plate as a product, so both lines read "existing" until
 * "Make it a product" is used. The order of the connections decides who delivers.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')
const CHEAP_ID = 'bbbb0003-0000-0000-0000-000000000001'
const DEAR_ID = 'bbbb0004-0000-0000-0000-000000000001'

/** A fresh plan object each call: Gears, with Cheap then Dear connected for iron plate (take, take). */
function buildPlan(tweak?: (plan: ReturnType<typeof JSON.parse>) => void) {
  const plan = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const [plates, gears] = plan.blocks
  const spare = (n: number, id: string, name: string) => {
    const b = structuredClone(gears)
    b.id = id
    b.name = name
    b.goals[0].id = `bbbb000${n}-0000-0000-0000-0000000000g1`
    b.rootPlan.id = `bbbb000${n}-0000-0000-0000-0000000000a1`
    b.rootPlan.nodes[0].id = `bbbb000${n}-0000-0000-0000-0000000000n1`
    b.rootPlan.nodes.push({ ...structuredClone(plates.rootPlan.nodes[0]), id: `bbbb000${n}-0000-0000-0000-0000000000n2`, pinnedRate: 60 })
    return b
  }
  const cheap = spare(3, CHEAP_ID, 'Cheap')
  const dear = spare(4, DEAR_ID, 'Dear')
  gears.inputConnections = [
    { id: 'bbbb0002-c000-0000-0000-000000000001', itemId: 'nullius-iron-plate', fromBlockId: CHEAP_ID },
    { id: 'bbbb0002-c000-0000-0000-000000000002', itemId: 'nullius-iron-plate', fromBlockId: DEAR_ID },
  ]
  plan.blocks = [cheap, dear, gears]
  tweak?.(plan)
  return plan
}

async function setup(page: Page, testInfo: TestInfo, tweak?: Parameters<typeof buildPlan>[0]) {
  const file = testInfo.outputPath('plan.json')
  fs.writeFileSync(file, JSON.stringify(buildPlan(tweak)))
  await loadPlanFixture(page, file)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.getByRole('region', { name: 'Ingredients', exact: true })).toBeVisible({ timeout: 10000 })
}

/** The Sources list of iron plate, in the Comes from popover. */
async function openList(page: Page): Promise<Locator> {
  await selectSlot(page, 'Ingredients', 'Iron plate')
  await detail(page, 'Ingredients').getByTestId('comes-from').getByTestId('sources-button').click()
  const list = comesFromPopover(page).getByTestId('sources-list')
  await expect(list).toBeVisible()
  return list
}

const blockLines = (list: Locator) => list.locator('[data-line="block"]')
const sourceNames = (list: Locator) => blockLines(list).getByTestId('sources-block-name').allTextContents()
const lineOf = (list: Locator, name: string) => blockLines(list).filter({ has: list.page().getByText(name, { exact: true }) })
/** What a block line delivers, as shown: the rate text of the line. */
const delivered = (list: Locator, name: string) => lineOf(list, name).getByTestId('sources-block-rate')

test.describe('the block lines of the Sources list', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    // The tests of a source that receives the item itself set up their own plan.
    if (!testInfo.title.includes('receives')) await setup(page, testInfo)
  })

  test('lists the connections in connection order, and the first source delivers', async ({ page }) => {
    const list = await openList(page)
    expect(await sourceNames(list)).toEqual(['Cheap', 'Dear'])
    await expect(list.locator('[data-line="add-block"]')).toBeVisible()
    await expect(delivered(list, 'Cheap')).toHaveText('30.0/m')
    await expect(delivered(list, 'Dear')).toHaveText(/^0(\.0+)?\/m$/)
    await expect(lineOf(list, 'Dear')).toContainText('not used')
    for (const name of ['Cheap', 'Dear']) {
      await expect(lineOf(list, name).getByTestId('sources-block-tag')).toHaveText('existing')
    }
  })

  test('a reorder changes which source delivers', async ({ page }) => {
    const list = await openList(page)
    await lineOf(list, 'Dear').getByTestId('sources-block-move-up').click()
    expect(await sourceNames(list)).toEqual(['Dear', 'Cheap'])
    await expect(delivered(list, 'Dear')).toHaveText('30.0/m')
    await expect(delivered(list, 'Cheap')).toHaveText(/^0(\.0+)?\/m$/)
    // The focus followed the line: the button that cannot go further is not the one that has it.
    await expect(lineOf(list, 'Dear').getByTestId('sources-block-move-down')).toBeFocused()
  })

  test('a reorder by drag changes which source delivers', async ({ page }) => {
    const list = await openList(page)
    await lineOf(list, 'Dear').dragTo(lineOf(list, 'Cheap'), { targetPosition: { x: 20, y: 2 } })
    expect(await sourceNames(list)).toEqual(['Dear', 'Cheap'])
    await expect(delivered(list, 'Dear')).toHaveText('30.0/m')
  })

  test('a limit on the first makes the second deliver the rest', async ({ page }) => {
    const list = await openList(page)
    await lineOf(list, 'Cheap').getByTestId('sources-limit').click()
    await page.getByLabel('Limit of Cheap').fill('10')
    await page.keyboard.press('Enter')
    await expect(lineOf(list, 'Cheap').getByTestId('sources-limit')).toHaveText('Limit 10.0/m')
    await expect(delivered(list, 'Cheap')).toHaveText('10.0/m')
    await expect(delivered(list, 'Dear')).toHaveText('20.0/m')
    // Clearing the limit gives the whole need back to the first.
    await lineOf(list, 'Cheap').getByTestId('sources-limit').click()
    await page.getByLabel('Limit of Cheap').fill('')
    await page.keyboard.press('Enter')
    await expect(delivered(list, 'Cheap')).toHaveText('30.0/m')
  })

  test('the tag reads existing for a take and requested after Make it a product', async ({ page }) => {
    const list = await openList(page)
    const dear = lineOf(list, 'Dear')
    await expect(dear.getByTestId('sources-block-tag')).toHaveText('existing')
    await expect(dear.getByTestId('sources-block-tag')).toHaveAttribute('title', 'Dear only gives what it has left over.')
    await dear.getByTestId('sources-make-product').click()
    const confirm = page.getByTestId('product-change-confirm')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Make it a product' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(dear.getByTestId('sources-block-tag')).toHaveText('requested')
    await expect(dear.getByTestId('sources-make-product')).toHaveCount(0)
    // The product went on Dear, not on the block being edited.
    await expect(slot(page, 'Products', 'Iron plate')).toHaveCount(0)
    await page.locator('[data-testid="block-tab"] button[aria-label="Dear"]').click()
    await expect(slot(page, 'Products', 'Iron plate')).toBeVisible()
  })

  test('Remove drops the connection, and Receive from… opens the connection menu', async ({ page }) => {
    const list = await openList(page)
    await lineOf(list, 'Cheap').getByTestId('sources-block-remove').click()
    expect(await sourceNames(list)).toEqual(['Dear'])
    await expect(delivered(list, 'Dear')).toHaveText('30.0/m')
    await list.getByTestId('sources-receive-from').click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu).toContainText('Cheap')
    // Escape closes the menu first, the popover stays.
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(list).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(comesFromPopover(page)).toHaveCount(0)
  })

  test('Escape cancels the limit edit only, then closes the popover', async ({ page }) => {
    const list = await openList(page)
    await lineOf(list, 'Cheap').getByTestId('sources-limit').click()
    await page.getByLabel('Limit of Cheap').fill('10')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('spinbutton')).toHaveCount(0)
    await expect(list).toBeVisible()
    await expect(lineOf(list, 'Cheap').getByTestId('sources-limit')).toHaveText('No limit')
    await expect(lineOf(list, 'Cheap').getByTestId('sources-limit')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(comesFromPopover(page)).toHaveCount(0)
  })

  test('leaving the limit field by Tab does not pull the focus back', async ({ page }) => {
    const list = await openList(page)
    await lineOf(list, 'Cheap').getByTestId('sources-limit').click()
    await page.getByLabel('Limit of Cheap').fill('10')
    await page.keyboard.press('Tab')
    await expect(lineOf(list, 'Cheap').getByTestId('sources-limit')).toHaveText('Limit 10.0/m')
    await expect(lineOf(list, 'Cheap').getByTestId('sources-limit')).not.toBeFocused()
  })

  test('Escape in the Make it a product dialog closes the dialog only', async ({ page }) => {
    const list = await openList(page)
    await lineOf(list, 'Dear').getByTestId('sources-make-product').click()
    const confirm = page.getByTestId('product-change-confirm')
    await expect(confirm).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(list).toBeVisible()
    await expect(lineOf(list, 'Dear').getByTestId('sources-block-tag')).toHaveText('existing')
  })
})

test.describe('a source that receives the item itself', () => {
  const dearReceives = (withProduct: boolean) => (plan: ReturnType<typeof JSON.parse>) => {
    const dear = plan.blocks.find((b: { id: string }) => b.id === DEAR_ID)
    dear.inputConnections = [{ id: 'bbbb0004-c000-0000-0000-000000000001', itemId: 'nullius-iron-plate', fromBlockId: CHEAP_ID }]
    if (withProduct) dear.goals.push({ id: 'bbbb0004-0000-0000-0000-0000000000g2', itemId: 'nullius-iron-plate', rate: 10 })
  }

  test('cannot be made a product: the action is disabled with the reason', async ({ page }, testInfo) => {
    await setup(page, testInfo, dearReceives(false))
    const list = await openList(page)
    const action = lineOf(list, 'Dear').getByTestId('sources-make-product')
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await expect(action).toHaveAttribute('title', /receives/)
    await action.click({ force: true })
    await expect(page.getByTestId('product-change-confirm')).toHaveCount(0)
  })

  test('reads existing with the reason when the solver ignores its request', async ({ page }, testInfo) => {
    await setup(page, testInfo, dearReceives(true))
    const list = await openList(page)
    const tag = lineOf(list, 'Dear').getByTestId('sources-block-tag')
    await expect(tag).toHaveText('existing')
    await expect(tag).toHaveAttribute('title', /^Taken as existing: the source receives this item itself/)
    await expect(lineOf(list, 'Dear').getByTestId('sources-make-product')).toHaveCount(0)
  })
})
