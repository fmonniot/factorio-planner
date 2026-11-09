import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { renameActivePlan } from './support/planMenu'

/** Five Seablock blocks whose first goals have busy icons: two science packs, processing unit, advanced circuit, iron sheet coil. */
const FIXTURE = path.resolve('e2e/fixtures/block-tabs-seablock.json')
const TAB_ORDER = ['Red science', 'Green science', 'Processing units', 'Advanced circuits', 'Iron coils']

/** A tab's button, named by its block (the accessible name; an inactive tab shows no text). */
const tabButton = (page: Page, name: string) => page.getByTestId('block-tab').getByRole('button', { name, exact: true })
const allBlocksButton = (page: Page) => page.getByRole('button', { name: 'All blocks', exact: true })
const addBlockButton = (page: Page) => page.getByRole('button', { name: 'Add block', exact: true })
const tooltip = (page: Page) => page.getByTestId('block-tab-tooltip')
/** Tailwind v4 gray-700 and gray-800 as the browser reports them. */
const GRAY_700 = 'oklch(0.373 0.034 259.733)'
const GRAY_800 = 'oklch(0.278 0.033 256.848)'

async function openFixture(page: Page) {
  await loadPlanFixture(page, FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.getByTestId('block-tab')).toHaveCount(5)
}

async function tabOrder(page: Page): Promise<string[]> {
  return page.getByTestId('block-tab').evaluateAll(els => els.map(e => e.querySelector('button')!.getAttribute('aria-label')!))
}

async function savedOrder(page: Page): Promise<string[]> {
  const plan = (await readActivePlan(page, 'kompetenz-seablock')) as { blocks: { name: string }[] }
  return plan.blocks.map(b => b.name)
}

test('every tab shows its first goal icon; only the active tab keeps its name', async ({ page }) => {
  await openFixture(page)

  for (const name of TAB_ORDER) {
    const tab = tabButton(page, name)
    const icon = tab.locator('img')
    await expect(icon).toBeVisible()
    await expect.poll(() => icon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { message: `${name} icon loaded` }).toBe(true)
    if (name === 'Processing units') {
      await expect(tab).toHaveAttribute('aria-current', 'true')
      await expect(tab).toHaveText(name)
    } else {
      await expect(tab, `${name} is icon only`).toHaveText('')
      await expect(tab).not.toHaveAttribute('title')
      expect((await tab.boundingBox())!.width, `${name} is 44px wide`).toBe(44)
    }
  }
  expect((await tabButton(page, 'Processing units').boundingBox())!.width, 'the active tab keeps its width').toBeGreaterThan(90)
})

test('an inactive tab\'s stripe is 3px at 85% opacity, the active one 3px at full strength', async ({ page }) => {
  await openFixture(page)
  const stripe = (name: string) => tabButton(page, name).getByTestId('block-tab-stripe')
  const look = (name: string) => stripe(name).evaluate(el => {
    const color = getComputedStyle(el).backgroundColor
    return { height: el.getBoundingClientRect().height, alpha: color.startsWith('rgba') ? Number(color.replace(/.*,\s*([\d.]+)\)$/, '$1')) : 1 }
  })
  expect(await look('Red science')).toEqual({ height: 3, alpha: 0.85 })
  expect(await look('Processing units')).toEqual({ height: 3, alpha: 1 })
})

test.describe('tab tooltip', () => {
  test('an inactive tab shows its name in the black tooltip on hover, and no native title', async ({ page }) => {
    await openFixture(page)
    await expect(tooltip(page)).toHaveCount(0)
    await tabButton(page, 'Iron coils').hover()
    await expect(tooltip(page)).toHaveText('Iron coils')
    const tipStyle = await tooltip(page).evaluate(el => {
      const s = getComputedStyle(el)
      return { bg: s.backgroundColor, border: s.borderTopColor, position: s.position }
    })
    // The same box the tool buttons use: black, with a gray-700 border.
    expect(tipStyle).toEqual({ bg: 'rgb(0, 0, 0)', border: GRAY_700, position: 'fixed' })
    const tab = (await tabButton(page, 'Iron coils').boundingBox())!
    const tip = (await tooltip(page).boundingBox())!
    expect(tip.y, 'below the tab').toBeGreaterThan(tab.y + tab.height - 1)
    expect(Math.abs(tip.x + tip.width / 2 - (tab.x + tab.width / 2)), 'centred on the tab').toBeLessThan(1.5)
    await page.mouse.move(5, 300)
    await expect(tooltip(page)).toHaveCount(0)
  })

  test('keyboard focus shows it too, and focus left by a click does not', async ({ page }) => {
    await openFixture(page)
    // Tab from the block list button: the first tab stop after it is the first tab.
    await allBlocksButton(page).focus()
    await page.keyboard.press('Tab')
    await expect(tabButton(page, 'Red science')).toBeFocused()
    await expect(tooltip(page)).toHaveText('Red science')
    await page.keyboard.press('Tab')
    await expect(tabButton(page, 'Green science')).toBeFocused()
    await expect(tooltip(page)).toHaveText('Green science')
    await tabButton(page, 'Green science').evaluate(el => (el as HTMLElement).blur())
    await expect(tooltip(page)).toHaveCount(0)

    // Enter on the focused tab opens its block; the tooltip goes away with it (the active tab names itself).
    await page.keyboard.press('Shift+Tab')
    await tabButton(page, 'Red science').focus()
    await expect(tooltip(page)).toHaveText('Red science')
    await page.keyboard.press('Enter')
    await expect(tabButton(page, 'Red science')).toHaveAttribute('aria-current', 'true')
    await expect(tooltip(page)).toHaveCount(0)

    // A mouse click focuses the tab without :focus-visible: once the pointer leaves, nothing is left showing.
    await tabButton(page, 'Iron coils').click()
    await page.mouse.move(5, 300)
    await expect(tooltip(page)).toHaveCount(0)
  })

  /** Rename a block from its right-click menu, through the rename dialog. */
  async function renameBlock(page: Page, from: string, to: string) {
    await tabButton(page, from).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Rename' }).click()
    await page.getByRole('textbox', { name: 'Block name' }).fill(to)
    await page.getByRole('dialog', { name: 'Rename block' }).getByRole('button', { name: 'Rename' }).click()
    await expect(tabButton(page, to)).toBeVisible()
  }

  test('double-clicking a tab opens the rename dialog', async ({ page }) => {
    await openFixture(page)
    // Activate it first: an inactive tab widens on the first click, which would move the second one off it.
    await tabButton(page, 'Iron coils').click()
    await tabButton(page, 'Iron coils').dblclick()
    const input = page.getByRole('textbox', { name: 'Block name' })
    await expect(input).toHaveValue('Iron coils')
    await input.fill('Renamed')
    await input.press('Enter')
    await expect(tabButton(page, 'Renamed')).toBeVisible()
  })
  const LONG_NAME = 'An extraordinarily long block name that would spill past the edge of the window'

  for (const width of [1440, 390]) {
    test(`a long block name's tooltip stays inside a ${width}px window, even on the first tab`, async ({ page }) => {
      await openFixture(page)
      await renameBlock(page, 'Red science', LONG_NAME)
      await page.setViewportSize({ width, height: 900 })
      // A narrow window centres the active tab: bring the first one back into view before pointing at it.
      await page.getByTestId('block-tab-strip').evaluate(el => { el.scrollLeft = 0 })
      await expect(tabButton(page, LONG_NAME)).toBeInViewport()
      await tabButton(page, LONG_NAME).hover()
      await expect(tooltip(page)).toBeVisible()
      const tip = (await tooltip(page).boundingBox())!
      expect(tip.x, 'inside on the left').toBeGreaterThanOrEqual(8)
      expect(tip.x + tip.width, 'inside on the right').toBeLessThanOrEqual(width - 8)
    })
  }

  test('the active tab has no tooltip', async ({ page }) => {
    await openFixture(page)
    await tabButton(page, 'Processing units').hover()
    await expect(tooltip(page)).toHaveCount(0)
  })
})

test.describe('block list', () => {
  test('is always there, before the first tab, lists every block and switches to the one picked', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openFixture(page)
    const button = allBlocksButton(page)
    await expect(button).toBeVisible()
    const box = (await button.boundingBox())!
    expect([box.width, box.height]).toEqual([28, 28])
    expect(box.x + box.width, 'before the first tab').toBeLessThanOrEqual((await tabButton(page, 'Red science').boundingBox())!.x)
    // The tabs all fit, and the list is still there.
    await expect(page.getByTitle('All blocks')).toHaveCount(0)

    await button.hover()
    await expect(page.getByText('All blocks', { exact: true })).toBeVisible()
    await button.click()
    // The tooltip steps aside while the list is open.
    await expect(page.getByText('All blocks', { exact: true })).toBeHidden()
    const items = page.getByRole('menuitemradio')
    await expect(items).toHaveCount(5)
    await expect(items.first().locator('img')).toBeVisible()
    await expect(page.getByRole('menuitemradio', { name: 'Processing units' })).toHaveAttribute('aria-checked', 'true')

    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(button).toBeFocused()

    await button.click()
    await items.filter({ hasText: 'Iron coils' }).click()
    await expect(tabButton(page, 'Iron coils')).toHaveAttribute('aria-current', 'true')
    await expect(page.getByRole('menu')).toHaveCount(0)
  })

  test('narrow window: the strip scrolls, the list reaches every tab and the active tab is centred', async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 800 })
    await openFixture(page)
    // Seven more blocks push the strip past the window.
    for (let i = 0; i < 7; i++) await addBlockButton(page).click()
    await expect(page.getByTestId('block-tab')).toHaveCount(12)
    const strip = page.getByTestId('block-tab-strip')
    expect(await strip.evaluate(el => el.scrollWidth > el.clientWidth), 'the strip overflows').toBe(true)
    await expect(allBlocksButton(page)).toBeInViewport()
    await expect(addBlockButton(page)).toBeInViewport()

    await allBlocksButton(page).click()
    await page.getByRole('menuitemradio', { name: 'Processing units' }).click()
    const active = tabButton(page, 'Processing units')
    await expect(active).toHaveAttribute('aria-current', 'true')
    await expect(active).toBeInViewport({ ratio: 1 })
    await expect.poll(async () => {
      const s = (await strip.boundingBox())!
      const t = (await active.boundingBox())!
      return Math.abs(s.x + s.width / 2 - (t.x + t.width / 2))
    }, { message: 'the active tab is centred in the strip' }).toBeLessThan(3)
  })
})

test('the add-block button is a tool button: 32px, in the tool row, with the tool spacing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFixture(page)
  const geometry = () => page.evaluate(() => {
    const bar = document.querySelector('[data-testid=top-bar]')!
    const rect = (label: string) => bar.querySelector(`button[aria-label="${label}"]`)!.getBoundingClientRect()
    const add = rect('Add block'), horizon = rect('Horizon: none'), graph = rect('Block graph')
    return {
      size: [add.width, add.height],
      gapToHorizon: horizon.left - add.right,
      gapBetweenTools: graph.left - horizon.right,
      centreY: [add.top + add.height / 2, horizon.top + horizon.height / 2],
    }
  })
  const g = await geometry()
  expect(g.size).toEqual([32, 32])
  expect(g.gapToHorizon, 'as far from Horizon as the tools are from each other').toBe(g.gapBetweenTools)
  expect(g.centreY[0]).toBe(g.centreY[1])
  // It is a tool button: after the tabs, with no "+" glyph left among them.
  expect((await addBlockButton(page).boundingBox())!.x).toBeGreaterThan((await tabButton(page, 'Iron coils').boundingBox())!.x + 400)

  await addBlockButton(page).hover()
  const tip = page.getByTestId('top-bar').getByText('Add block', { exact: true })
  await expect(tip).toBeVisible()
  expect(await tip.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(0, 0, 0)')
  await addBlockButton(page).click()
  await expect(page.getByTestId('block-tab')).toHaveCount(6)
})

test('the workspace button has no fill or border and is 32px high from 768px, the compact button below', async ({ page }) => {
  const trigger = (p: Page) => p.getByTestId('top-bar').getByRole('button', { name: /^Plan: / })
  const look = (p: Page) => trigger(p).evaluate(el => {
    const s = getComputedStyle(el), r = el.getBoundingClientRect()
    return { width: r.width, height: r.height, border: s.borderTopWidth, bg: s.backgroundColor }
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFixture(page)
  expect(await look(page)).toEqual({ width: 132, height: 32, border: '0px', bg: 'rgba(0, 0, 0, 0)' })
  // Row density: the bar is the same 44px plus its 1px border as before, so the table keeps its height.
  expect((await page.getByTestId('top-bar').boundingBox())!.height).toBe(45)
  // Hovering gives it the tool buttons' fill.
  await trigger(page).hover()
  expect((await look(page)).bg).toBe(GRAY_800)

  await page.setViewportSize({ width: 767, height: 900 })
  const compact = await look(page)
  // The replica draws 62px; the app's compact button was and stays 64px (icon tile, chevron, 1px border).
  expect(compact.width, 'the compact button is unchanged').toBe(64)
  expect(compact.height).toBe(36)
  expect(compact.border).toBe('1px')
  expect(compact.bg).toBe(GRAY_800)
})

test('a long plan name is truncated inside the workspace button, which keeps its 132px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openFixture(page)
  const trigger = page.getByTestId('top-bar').getByRole('button', { name: /^Plan: / })
  await renameActivePlan(page, 'A plan name that is far too long to fit in a button of 132 p')
  expect((await trigger.boundingBox())!.width, 'the button keeps its width').toBe(132)
  await expect(trigger, 'the native tooltip names the plan').toHaveAttribute('title', /^A plan name that is far too long.*Plans, game data/)
  const name = trigger.locator('span.truncate').first()
  expect(await name.evaluate(el => el.scrollWidth > el.clientWidth), 'the name is cut with an ellipsis').toBe(true)
  const box = (await trigger.boundingBox())!
  const nameBox = (await name.boundingBox())!
  expect(nameBox.x + nameBox.width, 'the name stays inside the button').toBeLessThanOrEqual(box.x + box.width)
})

test.describe('Block tab reorder', () => {
  test('dragging a tab onto another reorders the blocks and keeps the active one', async ({ page }) => {
    await openFixture(page)
    const source = (await tabButton(page, 'Iron coils').boundingBox())!
    const target = (await tabButton(page, 'Green science').boundingBox())!

    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 6 })
    await page.mouse.move(target.x + 9, target.y + target.height / 2, { steps: 3 })
    await page.mouse.move(target.x + 10, target.y + target.height / 2, { steps: 3 })
    await expect(page.getByTestId('block-tab-drop-line')).toHaveAttribute('data-side', 'before')
    await page.mouse.up()

    const expected = ['Red science', 'Iron coils', 'Green science', 'Processing units', 'Advanced circuits']
    await expect.poll(() => tabOrder(page), { message: 'tab order' }).toEqual(expected)
    await expect(tabButton(page, 'Processing units')).toHaveAttribute('aria-current', 'true')
    await expect.poll(() => savedOrder(page), { message: 'saved order' }).toEqual(expected)
  })

  test('Move right in the context menu swaps a tab with its right neighbour', async ({ page }) => {
    await openFixture(page)
    await tabButton(page, 'Red science').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move right' }).click()
    await expect.poll(() => tabOrder(page)).toEqual(['Green science', 'Red science', ...TAB_ORDER.slice(2)])
  })

  test('narrow window: the tab context menu stays fully on screen', async ({ page }) => {
    await page.setViewportSize({ width: 560, height: 800 })
    await openFixture(page)
    for (let i = 0; i < 7; i++) await addBlockButton(page).click()
    // Icons load lazily and widen their tabs; let the strip settle so Playwright's own scroll-into-view does not close the menu.
    await expect.poll(() => page.locator('[data-testid="block-tab"] img').evaluateAll(
      imgs => imgs.every(i => (i as HTMLImageElement).complete),
    ), { message: 'tab icons loaded' }).toBe(true)
    await tabButton(page, 'Processing units').scrollIntoViewIfNeeded()
    await tabButton(page, 'Processing units').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeInViewport()
    await expect(page.locator('[aria-label="Block colour"]')).toBeInViewport()
  })
})
