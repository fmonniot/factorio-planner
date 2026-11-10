import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { detail, pane, slotById } from './support/summary'

/** Fixture: the active block "Metals" has 16 products, starting sheet, rod, gear. See summary-panes-many-items.spec.ts. */
const FIXTURE = path.resolve('e2e/fixtures/summary-many-items.json')
const METALS_ID = 'cccc0001-0000-0000-0000-000000000001'
const SCIENCES_ID = 'cccc0002-0000-0000-0000-000000000001'
const SHEET = 'nullius-iron-sheet'
const ROD = 'nullius-iron-rod'
const GEAR = 'nullius-iron-gear'

const slots = (page: Page) => pane(page, 'Products').getByTestId('summary-slot')
const dropLine = (page: Page) => pane(page, 'Products').getByTestId('summary-slot-drop-line')
const order = (page: Page) => slots(page).evaluateAll(els => els.map(el => (el as HTMLElement).dataset.itemId))

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(
    detail(page, 'Products').locator(`[data-testid="summary-overview-segment"][data-key="to:${SCIENCES_ID}"]`),
  ).toBeVisible({ timeout: 20000 })
}

async function savedOrder(page: Page): Promise<string[]> {
  const plan = (await readActivePlan(page, 'nullius')) as {
    blocks: { id: string; products?: { itemId: string }[]; goals?: { itemId: string }[] }[]
  }
  const block = plan.blocks.find(b => b.id === METALS_ID)!
  return (block.products ?? block.goals ?? []).map(p => p.itemId)
}

/** Press on a slot, then move in steps so the browser starts a native drag, and stop over the point (fx, fy) of the target. */
async function dragOnto(page: Page, source: ReturnType<typeof slotById>, target: ReturnType<typeof slotById>, fx: number) {
  const from = (await source.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + to.width * fx - 4, to.y + to.height / 2, { steps: 8 })
  await page.mouse.move(to.x + to.width * fx - 2, to.y + to.height / 2, { steps: 3 })
  await page.mouse.move(to.x + to.width * fx, to.y + to.height / 2, { steps: 3 })
}

test.describe('product reorder', () => {
  test.use({ viewport: { width: 1000, height: 560 } })

  test('dragging a slot onto the right half of another reorders the products and saves the order', async ({ page }) => {
    await setup(page)
    await dragOnto(page, slotById(page, 'Products', SHEET), slotById(page, 'Products', GEAR), 0.8)
    await expect(dropLine(page)).toHaveAttribute('data-side', 'after')
    await page.mouse.up()

    await expect.poll(() => order(page).then(o => o.slice(0, 3))).toEqual([ROD, GEAR, SHEET])
    expect(await slots(page).count()).toBe(16)
    await expect(dropLine(page)).toHaveCount(0)
    await expect.poll(() => savedOrder(page).then(o => o.slice(0, 3))).toEqual([ROD, GEAR, SHEET])
  })

  test('the selection and the strip survive a reorder, and a plain click still toggles', async ({ page }) => {
    await setup(page)
    const sheet = slotById(page, 'Products', SHEET)
    await sheet.click()
    await expect(detail(page, 'Products')).toHaveAttribute('data-state', 'selected')

    await dragOnto(page, sheet, slotById(page, 'Products', GEAR), 0.8)
    await page.mouse.up()
    await expect.poll(() => order(page).then(o => o.slice(0, 3))).toEqual([ROD, GEAR, SHEET])
    await expect(sheet).toHaveAttribute('aria-pressed', 'true')
    await expect(detail(page, 'Products')).toHaveAttribute('data-state', 'selected')

    await sheet.click()
    await expect(sheet).toHaveAttribute('aria-pressed', 'false')
    await sheet.click()
    await expect(sheet).toHaveAttribute('aria-pressed', 'true')
  })

  test('Escape during a drag leaves the order unchanged', async ({ page }) => {
    await setup(page)
    await dragOnto(page, slotById(page, 'Products', SHEET), slotById(page, 'Products', GEAR), 0.8)
    await expect(dropLine(page)).toHaveCount(1)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(dropLine(page)).toHaveCount(0)
    expect((await order(page)).slice(0, 3)).toEqual([SHEET, ROD, GEAR])
  })

  test('Move later in the right-click menu and in the strip', async ({ page }) => {
    await setup(page)
    await slotById(page, 'Products', SHEET).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move later' }).click()
    await expect.poll(() => order(page).then(o => o.slice(0, 3))).toEqual([ROD, SHEET, GEAR])

    await slotById(page, 'Products', SHEET).click()
    await detail(page, 'Products').getByRole('button', { name: 'Move later' }).click()
    await expect.poll(() => order(page).then(o => o.slice(0, 3))).toEqual([ROD, GEAR, SHEET])
    await expect(slotById(page, 'Products', SHEET)).toHaveAttribute('aria-pressed', 'true')
  })

  test('Byproducts and Ingredients slots are not draggable', async ({ page }) => {
    await setup(page)
    for (const name of ['Byproducts', 'Ingredients']) {
      const all = pane(page, name).getByTestId('summary-slot')
      for (const el of await all.all()) await expect(el).not.toHaveAttribute('draggable', /.*/)
    }
    await expect(slots(page).first()).toHaveAttribute('draggable', 'true')
  })
})
