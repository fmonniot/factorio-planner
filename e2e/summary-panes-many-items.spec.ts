import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, pane, slotById } from './support/summary'

/**
 * Fixture: the active block "Metals" has 16 goals (one producing recipe each).
 * "Sciences" requests 12 of those items from Metals and "Circuits" requests 3,
 * so Metals shows exports on many product slots and its panes overflow.
 */
const FIXTURE = path.resolve('e2e/fixtures/summary-many-items.json')
const METALS_ID = 'cccc0001-0000-0000-0000-000000000001'
const SCIENCES_ID = 'cccc0002-0000-0000-0000-000000000001'
const CIRCUITS_ID = 'cccc0003-0000-0000-0000-000000000001'

const slots = (page: Page, label: string) => pane(page, label).getByTestId('summary-slot')
const grid = (page: Page, label: string) => pane(page, label).getByTestId('summary-slot-grid')
const overviewRow = (page: Page, label: string, key: string) =>
  detail(page, label).locator(`[data-testid="summary-overview-row"][data-key="${key}"]`)

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  // The exports appear once every block has been solved.
  await expect(overviewRow(page, 'Products', `to:${SCIENCES_ID}`)).toBeVisible({ timeout: 20000 })
}

test.describe('summary panes with many items', () => {
  // A small viewport wraps 16 slots onto more than the grid's two visible rows.
  test.use({ viewport: { width: 1000, height: 560 } })

  test('counts the goals and keeps Add goal in view while the grid scrolls', async ({ page }) => {
    await setup(page)
    await expect(pane(page, 'Products')).toContainText('· 16')

    const add = page.getByTitle('Add goal')
    await expect(add).toBeInViewport()
    await grid(page, 'Products').evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect(add).toBeInViewport()
  })

  test('the fade shows while slots are hidden below and the last slot can be scrolled into view', async ({ page }) => {
    await setup(page)
    const products = pane(page, 'Products')
    await expect(products).toHaveAttribute('data-overflow', 'true')

    await grid(page, 'Products').evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect(products).not.toHaveAttribute('data-overflow', 'true')
    await expect(slots(page, 'Products').last()).toBeInViewport()
  })

  test('the detail strip keeps its size and the slots stay put when the selection changes', async ({ page }) => {
    await setup(page)
    const strip = detail(page, 'Products')
    const first = slots(page, 'Products').first()
    const [stripBefore, firstBefore] = [await strip.boundingBox(), await first.boundingBox()]

    await first.click()
    await expect(strip).toHaveAttribute('data-state', 'selected')
    expect(await strip.boundingBox()).toEqual(stripBefore)
    expect(await first.boundingBox()).toEqual(firstBefore)
  })

  test('each export segment sits on the slot of its own item', async ({ page }) => {
    await setup(page)
    const productSlots = slots(page, 'Products')
    await expect(productSlots).toHaveCount(16)
    let exportCount = 0
    for (const s of await productSlots.all()) {
      const itemName = (await s.getAttribute('title'))!
      await s.click()
      await expect(detail(page, 'Products')).toHaveAttribute('data-state', 'selected')
      const entries = detail(page, 'Products').locator('[data-testid="summary-key-entry"][data-kind="export"]')
      for (const entry of await entries.all()) {
        await expect(entry).toHaveAttribute('title', new RegExp(`^Sends ${itemName} to `))
        exportCount++
      }
    }
    expect(exportCount, 'Metals exports 12 + 3 deliveries').toBe(15)
  })

  test('tracing an overview row marks the slots that carry it', async ({ page }) => {
    await setup(page)
    const traced = (state: string) => pane(page, 'Products').locator(`[data-testid="summary-slot"][data-traced="${state}"]`)

    await overviewRow(page, 'Products', `to:${SCIENCES_ID}`).click()
    await expect(traced('in')).toHaveCount(12)
    await expect(traced('out')).toHaveCount(4)

    await overviewRow(page, 'Products', `to:${CIRCUITS_ID}`).click()
    await expect(traced('in')).toHaveCount(3)

    await overviewRow(page, 'Products', `to:${CIRCUITS_ID}`).click()
    await expect(pane(page, 'Products').locator('[data-traced]')).toHaveCount(0)
  })

  test('hovering a slot previews it and leaving returns to the overview', async ({ page }) => {
    await setup(page)
    const first = slots(page, 'Products').first()
    const name = (await first.getAttribute('title'))!
    await first.hover()
    await expect(detail(page, 'Products')).toHaveAttribute('data-state', 'preview')
    await expect(detail(page, 'Products')).toContainText(name)

    await page.getByTitle('Add goal').hover()
    await expect(detail(page, 'Products')).toHaveAttribute('data-state', 'overview')
  })

  test('selection toggles with a second click, ×, and Escape', async ({ page }) => {
    await setup(page)
    const first = slots(page, 'Products').first()
    const strip = detail(page, 'Products')

    await first.click()
    await expect(first).toHaveAttribute('aria-pressed', 'true')
    await first.click()
    await expect(first).toHaveAttribute('aria-pressed', 'false')

    await first.click()
    await strip.getByRole('button', { name: 'Back to overview' }).click()
    await expect(strip).toHaveAttribute('data-state', 'overview')

    await first.click()
    await page.keyboard.press('Escape')
    // The pointer still rests on the slot, which would preview it.
    await page.getByTitle('Add goal').hover()
    await expect(strip).toHaveAttribute('data-state', 'overview')
  })

  test('double-clicking a product slot edits its target; Escape cancels', async ({ page }) => {
    await setup(page)
    const first = slots(page, 'Products').first()
    const input = page.getByLabel('Goal target rate')

    await first.dblclick()
    await expect(input).toBeFocused()
    await input.fill('5')
    await input.press('Enter')
    await expect(page.getByTitle(/^Target:/)).toHaveAttribute('title', /5\.00/)

    await first.dblclick()
    await input.fill('7')
    await input.press('Escape')
    await expect(page.getByTitle(/^Target:/)).toHaveAttribute('title', /5\.00/)
  })

  test('an export segment opens the consumer, whose ingredient slots hold their own connections', async ({ page }) => {
    await setup(page)
    // Item names by id, read from the Metals product slots before leaving the block.
    const names = new Map<string, string>()
    for (const s of await slots(page, 'Products').all()) {
      names.set((await s.getAttribute('data-item-id'))!, (await s.getAttribute('title'))!)
    }
    await slotById(page, 'Products', 'nullius-iron-sheet').click()
    await detail(page, 'Products')
      .locator('[data-testid="summary-segment"][data-kind="export"]')
      .filter({ hasText: 'Sciences' })
      .click()
    await expect(page.locator('button[title="Sciences"][aria-current="true"]')).toBeVisible()

    // Back in Metals, the Ingredients overview counts the 12 connected items.
    await page.locator('button[title="Metals"]').click()
    await expect(overviewRow(page, 'Ingredients', `from:${METALS_ID}`)).toHaveCount(0)
    await page.locator('button[title="Sciences"]').click()
    // The last column of an overview row is the number of slots carrying it.
    await expect(overviewRow(page, 'Ingredients', `from:${METALS_ID}`).locator('span').last()).toHaveText('12')

    let withConnection = 0
    for (const s of await slots(page, 'Ingredients').all()) {
      const itemId = (await s.getAttribute('data-item-id'))!
      await s.click()
      await expect(detail(page, 'Ingredients')).toHaveAttribute('data-state', 'selected')
      const entries = detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"]')
      for (const entry of await entries.all()) {
        const kind = await entry.getAttribute('data-kind')
        if (kind !== 'source' && kind !== 'unused') continue
        withConnection++
        const name = names.get(itemId)
        expect(name, `${itemId} is one of the Metals goals`).toBeDefined()
        // Limited and unused connections name no item, so their title cannot be compared with the slot.
        expect((await entry.getAttribute('title'))!).toMatch(
          new RegExp(`^(${name!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} from Metals|Limited: |Not used: )`),
        )
      }
    }
    expect(withConnection).toBe(12)
  })

  test('right-clicking an ingredient slot inside a scrolled grid opens the menu under the slot', async ({ page }) => {
    await setup(page)
    const ingredients = grid(page, 'Ingredients')
    await ingredients.evaluate(el => { el.scrollTop = el.scrollHeight })
    const target = slots(page, 'Ingredients').last()
    await target.scrollIntoViewIfNeeded()
    await target.click({ button: 'right' })

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const [slotBox, menuBox] = [await target.boundingBox(), await menu.boundingBox()]
    expect(menuBox!.y).toBeGreaterThanOrEqual(slotBox!.y + slotBox!.height - 1)
    expect(Math.abs(menuBox!.x - slotBox!.x)).toBeLessThan(2)

    // Scrolling the grid closes the menu (it is fixed and would drift away).
    await ingredients.hover()
    await page.mouse.wheel(0, -50)
    await expect(menu).not.toBeVisible()
  })
})
