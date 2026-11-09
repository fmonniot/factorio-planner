import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { pane } from './support/summary'

/**
 * The summary collapses to one line per pane (the default), and expands to the three full panes. Fixture: the
 * active block "Metals" has 16 products, so its Products line cannot hold every chip; "Sciences" and "Circuits"
 * are the other blocks.
 *
 * Every other spec starts with the summary expanded (playwright.config.ts stores the choice); these start from a
 * profile that has not made one.
 */
const FIXTURE = path.resolve('e2e/fixtures/summary-many-items.json')
const NO_CHOICE = { cookies: [], origins: [] }

const lines = (page: Page) => page.getByTestId('summary-line-pane')
const expandButton = (page: Page) => page.getByRole('button', { name: 'Expand summary' })
const collapseHandle = (page: Page) => page.getByRole('button', { name: 'Collapse summary' })
const tableTop = async (page: Page) => (await page.locator('main table').first().boundingBox())!.y

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 20000 })
}

test.describe('collapsed summary', () => {
  test.use({ viewport: { width: 1440, height: 900 }, storageState: NO_CHOICE })

  // 1 sumLine
  test('starts collapsed: one 58 px line of three panes with counts, chips and a 68 px Expand button', async ({ page }) => {
    await setup(page)
    await expect(lines(page)).toHaveCount(3)
    await expect(page.getByTestId('summary-slot')).toHaveCount(0)
    await expect(pane(page, 'Products').getByTestId('summary-line-count')).toHaveText('16')

    expect((await page.getByTestId('summary-line').boundingBox())!.height).toBe(58)
    const boxes = await Promise.all([0, 1, 2].map(async i => (await lines(page).nth(i).boundingBox())!))
    expect(boxes.every(b => b.height === 40), 'each line is 40 px high').toBe(true)
    expect(new Set(boxes.map(b => b.y)).size, 'side by side').toBe(1)
    expect(boxes[0].x).toBeLessThan(boxes[1].x)
    expect(boxes[1].x).toBeLessThan(boxes[2].x)

    const button = expandButton(page)
    await expect(button).toBeVisible()
    expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(66)
    expect((await button.boundingBox())!.width).toBeLessThanOrEqual(70)
    const firstChips = await Promise.all([0, 1, 2].map(async i => (await lines(page).nth(i).getByTestId('summary-line-chip').first().boundingBox())!))
    firstChips.forEach((c, i) => {
      expect(c.y, 'chip inside its line').toBeGreaterThanOrEqual(boxes[i].y)
      expect(c.y + c.height, 'chip inside its line').toBeLessThanOrEqual(boxes[i].y + boxes[i].height)
    })
    expect(boxes[2].x + boxes[2].width, 'the lines end before the button').toBeLessThanOrEqual((await button.boundingBox())!.x)

    // No handle row at this width: the button is the only way to expand.
    await expect(expandButton(page)).toHaveCount(1)
    await expect(page.getByTestId('summary-line').getByRole('button', { name: 'Expand summary' })).toHaveCount(1)
  })

  // 1 sumLine
  test('draws chips of 32 px in 38 px slots, then a +N beside them that lists all 16 products with their rates', async ({ page }) => {
    await setup(page)
    const products = pane(page, 'Products')
    const chips = products.getByTestId('summary-line-chip')
    const more = products.getByRole('button', { name: 'Show all 16 products' })
    await expect(more).toBeVisible()
    const n = await chips.count()
    expect(n).toBeGreaterThan(0)
    await expect(more).toHaveText(`+${16 - n}`)

    const boxes = await chips.evaluateAll(l => l.map(e => e.getBoundingClientRect().toJSON()))
    expect(boxes.every(b => b.width === 32 && b.height === 32)).toBe(true)
    expect(boxes[1].x - boxes[0].x, '38 px slots').toBe(38)
    expect(n).toBeLessThan(16)
    for (const chip of await chips.all()) {
      await expect(chip.getByTestId('summary-line-quantity')).toHaveText(/\S/)
      await expect(chip).toHaveAttribute('title', / — /)
    }
    const moreBox = (await more.boundingBox())!
    const paneBox = (await products.boundingBox())!
    expect(boxes.at(-1)!.right, 'chips end before the +N').toBeLessThanOrEqual(moreBox.x + 0.5)
    expect(moreBox.x + moreBox.width, 'the +N is inside its pane').toBeLessThanOrEqual(paneBox.x + paneBox.width + 0.5)

    // The two other lines get one too when they have more than they can hold, and a line that fits has none.
    // (The ingredients come from the solver, which may still be running: wait for them.)
    await expect(pane(page, 'Ingredients').getByTestId('summary-line-count')).not.toHaveText('0')
    await expect(pane(page, 'Ingredients').getByTestId('summary-line-chip').first()).toBeVisible()
    for (const [label, count] of [['Byproducts', await pane(page, 'Byproducts').getByTestId('summary-line-count').innerText()], ['Ingredients', await pane(page, 'Ingredients').getByTestId('summary-line-count').innerText()]]) {
      const shown = await pane(page, label).getByTestId('summary-line-chip').count()
      expect(await pane(page, label).getByTestId('summary-line-more').count(), `${label}: ${shown} of ${count}`).toBe(shown < Number(count) ? 1 : 0)
    }

    await more.click()
    const list = page.getByTestId('summary-line-popup')
    await expect(list).toBeVisible()
    await expect(list).toContainText('All 16 products')
    await expect(list.locator('li')).toHaveCount(16)
    await expect(list.locator('li').first()).toContainText(/\d\/m|\d\/s|\d$/)
    await expect(list.getByRole('button')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
  })

  // 1 sumLine
  test('shows the goal on Products chips, the same as the popup says', async ({ page }) => {
    await setup(page)
    const products = pane(page, 'Products')
    const chips = products.getByTestId('summary-line-chip')
    // The ingredients come from the solver: once they are there, the products have their final numbers.
    await expect(pane(page, 'Ingredients').getByTestId('summary-line-chip').first()).toBeVisible()
    await products.getByRole('button', { name: 'Show all 16 products' }).click()
    const titles = await chips.evaluateAll(l => l.map(e => e.getAttribute('title')!))
    const rows = page.getByTestId('summary-line-popup').locator('li')
    for (let i = 0; i < titles.length; i++) {
      const row = (await rows.nth(i).innerText()).replace(/\s+/g, ' ')
      const rate = titles[i].split(' — ')[1]
      const goal = /goal (\S+?)(,|$)/.exec(rate)?.[1] ?? rate
      expect(row, `row ${i} carries the chip's rate`).toContain(goal)
    }
    await page.keyboard.press('Escape')
    for (const label of ['Byproducts', 'Ingredients']) {
      for (const chip of await pane(page, label).getByTestId('summary-line-chip').all()) {
        await expect(chip).not.toHaveAttribute('data-status', /.+/)
      }
    }
  })

  // 1 sumLine
  test('Expand pushes the table down; the choice stays across blocks and reloads, and Collapse returns', async ({ page }) => {
    await setup(page)
    const collapsedTop = await tableTop(page)

    await expandButton(page).click()
    await expect(page.getByTestId('summary-line')).toHaveCount(0)
    await expect(page.getByTestId('summary-slot').first()).toBeVisible()
    const handle = collapseHandle(page)
    await expect(handle).toHaveText('Collapse summary')
    expect((await handle.boundingBox())!.height).toBe(18)
    const expandedTop = await tableTop(page)
    expect(expandedTop, 'the table moves down to make room').toBeGreaterThan(collapsedTop + 150)

    // Another block, then back.
    await page.getByRole('button', { name: 'Sciences', exact: true }).first().click()
    await expect(collapseHandle(page)).toBeVisible()
    await expect(page.getByTestId('summary-slot').first()).toBeVisible()

    // A reload.
    await page.reload()
    await expect(collapseHandle(page)).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('summary-line')).toHaveCount(0)

    await collapseHandle(page).click()
    await expect(lines(page)).toHaveCount(3)
    expect(await tableTop(page)).toBe(collapsedTop)
    await page.getByRole('button', { name: 'Circuits', exact: true }).first().click()
    await expect(lines(page)).toHaveCount(3)
    await page.reload()
    await expect(expandButton(page)).toBeVisible({ timeout: 20000 })
    await expect(lines(page)).toHaveCount(3)
  })

  // Keyboard users keep their place: the control they used is gone (or hidden) after the toggle.
  test('the keyboard focus follows the toggle to the other control', async ({ page }) => {
    await setup(page)
    await expandButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('summary-line')).toHaveCount(0)
    await expect(collapseHandle(page)).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(lines(page)).toHaveCount(3)
    await expect(expandButton(page)).toBeFocused()
  })

  // 1 sumLine: the choice is stored like the rest of the UI state
  test('the choice is stored with the other UI settings', async ({ page }) => {
    await setup(page)
    await expandButton(page).click()
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('factorio-planner:ui')!))
    expect(stored.summaryCollapsed).toBe(false)
  })
})

test.describe('collapsed summary at narrow widths', () => {
  test.use({ storageState: NO_CHOICE })

  // 1 sumStack
  test('under 768 px the three lines stack at 38 px and the 18 px handle row expands', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await setup(page)
    await expect(lines(page)).toHaveCount(3)
    const boxes = await Promise.all([0, 1, 2].map(async i => (await lines(page).nth(i).boundingBox())!))
    expect(boxes.every(b => b.height === 38), 'each line is 38 px high').toBe(true)
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y)
    expect(boxes[2].y).toBeGreaterThan(boxes[1].y)
    expect(new Set(boxes.map(b => b.x)).size, 'same left edge').toBe(1)
    for (const b of boxes) expect(b.x + b.width).toBeLessThanOrEqual(390)

    // The Expand button of the wide layout is gone: the handle row below the lines takes over.
    await expect(expandButton(page)).toHaveCount(1)
    await expect(page.getByTestId('summary-line').getByRole('button', { name: 'Expand summary' })).toHaveCount(0)
    const handle = expandButton(page)
    await expect(handle).toBeVisible()
    await expect(handle).toHaveText('Expand summary')
    expect((await handle.boundingBox())!.height).toBe(18)
    expect((await handle.boundingBox())!.y).toBeGreaterThanOrEqual(boxes[2].y + boxes[2].height - 1)

    // Chips fit in the line as at any width, and the +N still lists everything.
    const products = pane(page, 'Products')
    const chipBoxes = await products.getByTestId('summary-line-chip').evaluateAll(l => l.map(e => e.getBoundingClientRect().toJSON()))
    expect(chipBoxes.length).toBeGreaterThan(0)
    expect(chipBoxes.every(b => b.width === 32 && b.height === 32)).toBe(true)
    expect(chipBoxes[1].x - chipBoxes[0].x, '38 px slots').toBe(38)
    const moreBox = (await products.getByTestId('summary-line-more').boundingBox())!
    expect(chipBoxes.at(-1)!.right, 'chips end before the +N').toBeLessThanOrEqual(moreBox.x + 0.5)
    expect(chipBoxes[0].y).toBeGreaterThanOrEqual(boxes[0].y)
    expect(chipBoxes[0].bottom).toBeLessThanOrEqual(boxes[0].y + boxes[0].height)
    await products.getByRole('button', { name: 'Show all 16 products' }).click()
    await expect(page.getByTestId('summary-line-popup').locator('li')).toHaveCount(16)
    await page.keyboard.press('Escape')

    // Expanded: the panes scroll sideways as before, and the handle row collapses.
    await handle.click()
    await expect(collapseHandle(page)).toBeVisible()
    // The handle is the same element in both states below md, so it keeps the focus it was given.
    await expect(collapseHandle(page)).toBeFocused()
    const panes = page.getByTestId('summary-pane')
    await expect(panes).toHaveCount(3)
    await expect(panes.nth(2)).not.toBeInViewport()
    expect((await collapseHandle(page).boundingBox())!.height).toBe(18)
    await collapseHandle(page).click()
    await expect(lines(page)).toHaveCount(3)
  })

  for (const width of [768, 1024]) {
    // 1 sumStack: from 768 px up (the Fold inner screen) the three columns stay
    test(`from 768 px up the lines keep their three columns (${width} px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await setup(page)
      const boxes = await Promise.all([0, 1, 2].map(async i => (await lines(page).nth(i).boundingBox())!))
      expect(new Set(boxes.map(b => b.y)).size, 'side by side').toBe(1)
      expect(boxes.every(b => b.height === 40)).toBe(true)
      const chip = (await lines(page).nth(0).getByTestId('summary-line-chip').first().boundingBox())!
      expect(chip.width).toBe(32)
      expect(chip.y).toBeGreaterThanOrEqual(boxes[0].y)
      expect(chip.y + chip.height).toBeLessThanOrEqual(boxes[0].y + boxes[0].height)
      expect(boxes[2].x + boxes[2].width).toBeLessThanOrEqual(width)
      await expect(expandButton(page)).toHaveCount(1)
      await expect(page.getByTestId('summary-line').getByRole('button', { name: 'Expand summary' })).toBeVisible()
    })
  }
})
