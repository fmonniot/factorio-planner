import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Fixture: the active block "Metals" has 16 goals (one producing recipe each).
 * "Sciences" receives 12 of those items from Metals and "Circuits" receives 3,
 * so Metals shows export chips on many goal rows and its panes overflow.
 */
const FIXTURE = path.resolve('e2e/fixtures/summary-many-items.json')

const pane = (page: Page, label: string) =>
  page.locator('div.max-h-\\[25vh\\]').filter({ hasText: new RegExp(`^${label}`) })
const rows = (page: Page, label: string) => pane(page, label).getByTestId('summary-row')
const list = (page: Page, label: string) => pane(page, label).locator('.overflow-y-auto')

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  // The exports appear once every block has been solved.
  await expect(page.getByTestId('export-chip').first()).toBeVisible({ timeout: 20000 })
}

test.describe('summary panes with many items', () => {
  test('counts the goals and keeps Add goal in view while the list scrolls', async ({ page }) => {
    await setup(page)
    await expect(pane(page, 'Products')).toContainText('· 16')

    const add = page.getByTitle('Add goal')
    await expect(add).toBeInViewport()
    await list(page, 'Products').evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect(add).toBeInViewport()
  })

  test('each export chip sits on the row of its own item', async ({ page }) => {
    await setup(page)
    const productRows = rows(page, 'Products')
    await expect(productRows).toHaveCount(16)
    let chipCount = 0
    for (const row of await productRows.all()) {
      const goalTitle = (await row.locator('button[title*="click to add a producer recipe"]').getAttribute('title'))!
      const itemName = goalTitle.split(' — ')[0]
      for (const chip of await row.getByTestId('export-chip').all()) {
        await expect(chip).toHaveAttribute('title', new RegExp(`^Sends ${itemName} to `))
        chipCount++
      }
    }
    expect(chipCount, 'Metals exports 12 + 3 deliveries').toBe(15)
  })

  test('the fade shows while rows are hidden below and the last row can be scrolled into view', async ({ page }) => {
    await setup(page)
    const products = pane(page, 'Products')
    await expect(products).toHaveAttribute('data-overflow', 'true')

    await list(page, 'Products').evaluate(el => { el.scrollTop = el.scrollHeight })
    await expect(products).not.toHaveAttribute('data-overflow', 'true')
    await expect(rows(page, 'Products').last()).toBeInViewport()
  })

  test('an export chip opens the consumer, whose ingredient rows hold their own connection chips', async ({ page }) => {
    await setup(page)
    await page.getByTestId('export-chip').filter({ hasText: 'Sciences' }).first().click()
    await expect(page.getByTitle('Click to rename')).toHaveText('Sciences')

    const ingredientRows = rows(page, 'Ingredients')
    await expect(ingredientRows.first()).toBeVisible()
    let withConnection = 0
    for (const row of await ingredientRows.all()) {
      const chips = row.getByTestId('connection-chip')
      const n = await chips.count()
      if (n === 0) continue
      withConnection++
      expect(n, 'one connection per item').toBe(1)
      const itemName = (await chips.first().getAttribute('title'))!
      expect(itemName).toMatch(/ from Metals| Limited| Not used/)
    }
    expect(withConnection).toBe(12)
  })

  test('right-clicking an ingredient tile inside a scrolled pane opens the menu under the tile', async ({ page }) => {
    await setup(page)
    const ingredients = list(page, 'Ingredients')
    await ingredients.evaluate(el => { el.scrollTop = el.scrollHeight })
    const tile = ingredients.locator('button[title*="click to find a producer recipe"]').last()
    await tile.scrollIntoViewIfNeeded()
    await tile.click({ button: 'right' })

    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    const [tileBox, menuBox] = [await tile.boundingBox(), await menu.boundingBox()]
    expect(menuBox!.y).toBeGreaterThanOrEqual(tileBox!.y + tileBox!.height - 1)
    expect(Math.abs(menuBox!.x - tileBox!.x)).toBeLessThan(2)

    // Scrolling the pane closes the menu (it is fixed and would drift away).
    await ingredients.hover()
    await page.mouse.wheel(0, -50)
    await expect(menu).not.toBeVisible()
  })
})
