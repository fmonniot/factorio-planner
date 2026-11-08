import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { sidePanel, selectRow } from './support/sidePanel'
import { menuTrigger, openAppMenu } from './support/appMenu'
import { expectShellFits, expectWithinViewport, tableScroller } from './support/layout'

/**
 * Responsive layout. The shell clips overflow, so the checks measure regions rather than the document width.
 * Breakpoints: md (768px) for the summary strip and chrome density, xl (1280px) for the inline side panel.
 */
const FIXTURE = path.resolve('e2e/fixtures/area-row-conveniences.json')
const WARNINGS_FIXTURE = path.resolve('e2e/fixtures/barrel-rate-regression.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'
const row = (page: Page) => page.locator(`main tr[data-node-id="${ROOT_ELEC}"]`)
const backdrop = (page: Page) => page.getByTestId('side-panel-backdrop')

async function load(page: Page, fixture = FIXTURE): Promise<void> {
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
}

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the chrome fits and the workspace menu drops its label', async ({ page }) => {
    await load(page)
    await expectShellFits(page)
    await expectWithinViewport(page, menuTrigger(page))
    await expect(menuTrigger(page).getByText(/^Plan 1$/)).toBeHidden()
    await expect(page.getByTitle('Add block')).toBeInViewport()
  })

  test('the summary panes form a swipe strip', async ({ page }) => {
    await load(page)
    const panes = page.getByTestId('summary-pane')
    await expect(panes).toHaveCount(3)
    const first = (await panes.nth(0).boundingBox())!
    expect(first.width).toBeLessThan(390 * 0.9)
    await expect(panes.nth(2)).not.toBeInViewport()
    await panes.nth(2).scrollIntoViewIfNeeded()
    await expect(panes.nth(2)).toBeInViewport()
  })

  test('the table scrolls inside its wrapper', async ({ page }) => {
    await load(page)
    const scroller = tableScroller(page)
    const [sw, cw] = await scroller.evaluate(el => [el.scrollWidth, el.clientWidth])
    expect(sw).toBeGreaterThan(cw)
    const power = page.locator('main table thead th').filter({ hasText: 'Power' })
    await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth })
    await expect(power).toBeInViewport()
    await expectShellFits(page)
    // The sticky header stays at the top of the wrapper after a vertical scroll.
    await scroller.evaluate(el => { el.scrollTop = 40 })
    const top = (await scroller.boundingBox())!.y
    const headTop = (await page.locator('main table thead tr').first().boundingBox())!.y
    expect(Math.abs(headTop - top)).toBeLessThanOrEqual(1)
  })

  test('the side panel takes the whole width', async ({ page }) => {
    await load(page)
    const panel = await selectRow(page, row(page))
    expect((await panel.boundingBox())!.width).toBe(390)
  })

  test('the toolbar hides the filter and keeps the warnings popover on screen', async ({ page }) => {
    await load(page, WARNINGS_FIXTURE)
    await expect(page.getByPlaceholder('Filter recipes or items')).toBeHidden()
    await expect(page.getByTestId('block-recipe-count')).toBeVisible()
    await page.getByTestId('table-toolbar').getByRole('button', { name: /warning/ }).click()
    const popover = page.getByTestId('warnings-popover')
    await expect(popover).toBeVisible()
    await expectWithinViewport(page, popover)
  })

  test('the recipe picker and a plan dialog fit the viewport', async ({ page }) => {
    await load(page)
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expectWithinViewport(page, page.getByRole('heading', { name: 'Add recipe' }).locator('xpath=ancestor::div[contains(@class,"max-h-")][1]'))
    await page.keyboard.press('Escape')

    const menu = await openAppMenu(page)
    await menu.getByRole('menuitem', { name: 'Rename plan' }).click()
    const dialog = page.locator('div.fixed.inset-0 > div').last()
    await expect(dialog).toBeVisible()
    await expectWithinViewport(page, dialog)
  })
})

test.describe('phone width: pickers, flyouts and errors', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the Add product picker fits the viewport', async ({ page }) => {
    await load(page)
    await page.getByTitle('Add product').click()
    const heading = page.getByRole('heading', { name: 'Add product' })
    await expect(heading).toBeVisible()
    await expectWithinViewport(page, heading.locator('xpath=ancestor::div[contains(@class,"max-h-")][1]'))
  })

  test('a menu flyout is pinned inside the viewport', async ({ page }) => {
    await load(page)
    const menu = await openAppMenu(page)
    await menu.getByRole('menuitem', { name: /Default machines/ }).click()
    const flyout = page.getByRole('menu', { name: 'Default machines' }).or(page.getByRole('dialog', { name: 'Default machines' }))
    await expect(flyout).toBeVisible()
    await expectWithinViewport(page, flyout)
  })

  test('a tall modal scrolls inside the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 300 })
    await load(page)
    const menu = await openAppMenu(page)
    await menu.getByRole('menuitem', { name: 'Rename plan' }).click()
    const dialog = page.locator('div.fixed.inset-0 > div').last()
    await expect(dialog).toBeVisible()
    const box = (await dialog.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(300)
    expect(box.y).toBeGreaterThanOrEqual(0)
  })

  test('a data load error stays visible without the label', async ({ page }) => {
    await page.route('**/data/nullius/game-data.json', route => route.fulfill({ status: 500, body: 'nope' }))
    await loadPlanFixture(page, FIXTURE)
    const error = page.getByText('Error loading data')
    await expect(error).toBeVisible({ timeout: 10000 })
    await expectWithinViewport(page, error)
    await expectWithinViewport(page, menuTrigger(page))
  })
})

test.describe('summary strip', () => {
  for (const width of [768, 1000]) {
    test(`is a three-column grid at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await load(page)
      const panes = page.getByTestId('summary-pane')
      const boxes = await Promise.all([0, 1, 2].map(async i => (await panes.nth(i).boundingBox())!))
      for (let i = 0; i < 3; i++) await expect(panes.nth(i)).toBeInViewport()
      expect(boxes[0].x).toBeLessThan(boxes[1].x)
      expect(boxes[1].x).toBeLessThan(boxes[2].x)
      expect(boxes[2].x + boxes[2].width).toBeLessThanOrEqual(width)
    })
  }

  test('is a three-column grid from md', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await load(page)
    const panes = page.getByTestId('summary-pane')
    const boxes = await Promise.all([0, 1, 2].map(async i => (await panes.nth(i).boundingBox())!))
    for (let i = 0; i < 3; i++) await expect(panes.nth(i)).toBeInViewport()
    expect(Math.abs(boxes[0].width - boxes[1].width)).toBeLessThanOrEqual(1)
    expect(Math.abs(boxes[1].width - boxes[2].width)).toBeLessThanOrEqual(1)
    expect(boxes[2].x + boxes[2].width).toBeLessThanOrEqual(1280)
  })
})

test.describe('side panel below xl', () => {
  test.use({ viewport: { width: 900, height: 800 } })

  test('is a drawer over the table, dismissed by the backdrop or the close button', async ({ page }) => {
    await load(page)
    const before = (await tableScroller(page).boundingBox())!.width
    const panel = await selectRow(page, row(page))
    await expect(panel).toHaveCSS('position', 'fixed')
    const box = (await panel.boundingBox())!
    expect(box.x + box.width).toBe(900)
    expect(box.width).toBeLessThanOrEqual(380)
    expect((await tableScroller(page).boundingBox())!.width).toBe(before)
    await expect(backdrop(page)).toBeVisible()

    await backdrop(page).click({ position: { x: 20, y: 400 } })
    await expect(sidePanel(page)).toHaveCount(0)
    await expect(row(page)).not.toHaveAttribute('data-selected', 'true')

    await selectRow(page, row(page))
    await sidePanel(page).getByRole('button', { name: 'Close panel' }).click()
    await expect(sidePanel(page)).toHaveCount(0)
  })

  test('a picker opened over the drawer closes alone when its dimmed area is pressed', async ({ page }) => {
    await load(page)
    await selectRow(page, row(page))
    const trigger = sidePanel(page).getByTestId('machine-picker-button')
    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await page.mouse.click(20, 400)
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(sidePanel(page)).toBeVisible()
    await expect(row(page)).toHaveAttribute('data-selected', 'true')
  })

  test('crossing xl keeps the selection and switches the mode', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await load(page)
    const wide = (await tableScroller(page).boundingBox())!.width
    const panel = await selectRow(page, row(page))
    await expect(panel).toHaveCSS('position', 'static')
    await expect(backdrop(page)).toBeHidden()
    const tableBox = (await tableScroller(page).boundingBox())!
    expect(tableBox.width).toBeLessThan(wide)
    expect(tableBox.x + tableBox.width).toBeLessThanOrEqual((await panel.boundingBox())!.x + 1)

    await page.setViewportSize({ width: 900, height: 800 })
    await expect(panel).toHaveCSS('position', 'fixed')
    await expect(backdrop(page)).toBeVisible()
    await expect(row(page)).toHaveAttribute('data-selected', 'true')
  })
})

test.describe('column widths', () => {
  const TABLE_MIN_WIDTH = 730
  const widths = (page: Page) =>
    page.locator('main table thead th').evaluateAll(els => els.map(e => e.getBoundingClientRect().width))
  // Column order: reorder, recipe, machine, beacons, products, byproducts, ingredients, power.

  test.describe('wide, panel closed', () => {
    test.use({ viewport: { width: 1470, height: 900 } })

    test('recipe, byproducts and ingredients share the free width; products stays one chip wide', async ({ page }) => {
      await load(page)
      const w = await widths(page)
      const table = w.reduce((a, b) => a + b, 0)
      expect(w[1], 'recipe grew').toBeGreaterThan(150 * 1.3)
      expect(w[4], 'products is fixed and narrow').toBeCloseTo(72, 0)
      expect(w[5], 'byproducts grew').toBeGreaterThanOrEqual(80 * 1.5)
      expect(w[6], 'ingredients is not the only column that grew').toBeLessThan(table * 0.5)
      expect(w[6], 'ingredients is still the widest').toBeGreaterThan(Math.max(w[1], w[5]))
      const fixed: [number, number][] = [[0, 32], [2, 88], [3, 88], [4, 72], [7, 72]]
      for (const [i, px] of fixed) expect(w[i], `column ${i} stays fixed`).toBeCloseTo(px, 0)
    })
  })

  test.describe('narrow', () => {
    for (const [width, withPanel] of [[1280, true], [390, false]] as const) {
      test(`keeps the minimum table width at ${width}px${withPanel ? ' with the panel open' : ''}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await load(page)
        if (withPanel) await selectRow(page, row(page))
        const w = await widths(page)
        expect(w.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(TABLE_MIN_WIDTH - 0.5)
        expect(w[1]).toBeGreaterThanOrEqual(149.5)
        expect(w[4]).toBeCloseTo(72, 0)
        expect(w[5]).toBeGreaterThanOrEqual(79.5)
        expect(w[6]).toBeGreaterThanOrEqual(147.5)
        const [sw, cw] = await tableScroller(page).evaluate(el => [el.scrollWidth, el.clientWidth])
        if (cw < TABLE_MIN_WIDTH) expect(sw).toBeGreaterThan(cw)
      })
    }
  })
})
