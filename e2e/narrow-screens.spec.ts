import { test, expect, type Locator, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

// Visual refinement 7/9. The tests mirror the check "10 narrowStack" (both parts) of
// initiatives/visual-refinement/check-artifact.mjs, and the toolbar of "narrowToolbar", which the artifact does not assert.

// Chemical Science: recipe rows with more byproducts and ingredients than two lines hold, a warning, and plain sub-factories.
const PLAN = path.resolve('e2e/fixtures/pin-recipe-not-working.json')
// A separate area that receives 20 items: its "+N" lists the rest.
const OVERFLOW = path.resolve('e2e/fixtures/area-chips-overflow.json')

async function open(page: Page, fixture: string, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr [data-variant], main table tbody tr [data-direction]').first()).toBeVisible({ timeout: 10000 })
}

// A chain of organising groups G1 > G2 > G3 > G4, each holding a recipe row: rows at nesting levels 0 to 4.
const id = (kind: string, n: number) => `dddd${String(kind.charCodeAt(0)).padStart(4, '0')}-0000-0000-0000-${String(n).padStart(12, '0')}`
const STAMP = '2026-05-10T00:00:00.000Z'
interface PlanNode { kind: string; id: string; recipeId?: string; subPlanId?: string; modules?: unknown[]; byproductPolicy?: object; pinnedRate?: number }
interface PlanTree { id: string; name: string; nodes: PlanNode[]; subPlans: PlanTree[]; createdAt: string; updatedAt: string }
const RECIPES = ['nullius-chemical-pack', 'nullius-hydrogen-chloride', 'nullius-ammonia-barrel', 'nullius-acid-sulfuric', 'nullius-methanol']
const row = (n: number): PlanNode => ({ kind: 'game-recipe', id: id('r', n), recipeId: RECIPES[n - 1], modules: [], byproductPolicy: {}, pinnedRate: 60 })
const group = (n: number, nodes: PlanNode[], subPlans: PlanTree[] = []): PlanTree => ({ id: id('p', n), name: `G${n}`, nodes, subPlans, createdAt: STAMP, updatedAt: STAMP })
const handle = (g: PlanTree): PlanNode => ({ kind: 'subplan', id: id('h', +g.name.slice(1)), subPlanId: g.id })
function nestedPlan() {
  const g4 = group(4, [row(5)])
  const g3 = group(3, [row(4), handle(g4)], [g4])
  const g2 = group(2, [row(3), handle(g3)], [g3])
  const g1 = group(1, [row(2), handle(g2)], [g2])
  const root = { ...group(0, [row(1), handle(g1)], [g1]), name: 'Main' }
  return { blocks: [{ id: id('b', 1), name: 'Nested', color: '#60a5fa', products: [{ id: id('q', 1), itemId: 'nullius-methanol', extraRate: 100 }], noImportItems: [], inputConnections: [], rootPlan: root }], activeBlockId: id('b', 1) }
}

const rows = (page: Page) => page.locator('main table tbody tr')
const recipeRows = (page: Page) => rows(page).filter({ hasNot: page.getByTestId('group-summary') })
const headers = (page: Page) => page.locator('main table thead th').evaluateAll(els => els.map(e => (e as HTMLElement).innerText.trim()).filter(Boolean))
const tableWidth = (page: Page) => page.locator('main table').first().evaluate(el => el.getBoundingClientRect().width)

/** How many lines of chips a cell holds: the distinct tops of its chips. */
const chipLines = (cell: Locator) =>
  cell.locator('[data-variant]').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().top))).size)

test.describe('narrowStack: Machine and Beacons under the recipe name, below 768 px', () => {
  test('the Machine and Beacons columns are dropped, their chips sit under the recipe name, the table is 554 px wide at least', async ({ page }) => {
    await open(page, PLAN, 900)
    expect(await headers(page)).toEqual(['Recipe', 'Machine', 'Beacons', 'Products', 'Byproducts', 'Ingredients', 'Power'])
    const wide = await tableWidth(page)

    await open(page, PLAN, 416)
    expect(await headers(page)).toEqual(['Recipe', 'Products', 'Byproducts', 'Ingredients', 'Power'])
    const min = await page.locator('main table').first().evaluate(el => parseFloat(getComputedStyle(el).minWidth))
    expect(min).toBe(554)
    const narrow = await tableWidth(page)
    expect(narrow, `the table is narrower: ${wide} to ${narrow}`).toBeLessThan(wide)
    expect(narrow).toBeGreaterThanOrEqual(554)

    const row = recipeRows(page).first()
    const cell = row.locator('td').nth(1)
    const name = (await cell.getByTestId('recipe-name').boundingBox())!
    const machine = (await cell.getByTestId('machine-chip').boundingBox())!
    const cellBox = (await cell.boundingBox())!
    expect(machine.y, 'the machine chip is under the name').toBeGreaterThanOrEqual(name.y + name.height - 1)
    expect(machine.x).toBeGreaterThanOrEqual(cellBox.x)
    // The module and beacon chips are in the same stack, on the machine's line.
    const stack = cell.getByTestId('row-machine-stack')
    await expect(stack.getByTestId('module-chip')).toBeVisible()
    expect(await stack.getByRole('button').count(), 'machine, module and beacon chips').toBeGreaterThanOrEqual(3)
    const tops = await stack.getByRole('button').evaluateAll(els => new Set(els.map(e => Math.round(e.getBoundingClientRect().top))).size)
    expect(tops, 'one line').toBe(1)
  })

  test('the machine stack stays inside the Recipe cell at every nesting level, at the table minimum and above', async ({ page }, testInfo) => {
    const fixture = testInfo.outputPath('nested.json')
    fs.mkdirSync(path.dirname(fixture), { recursive: true })
    fs.writeFileSync(fixture, JSON.stringify(nestedPlan()))
    for (const width of [360, 416, 554, 572]) {
      await open(page, fixture, width)
      for (const name of ['G1', 'G2', 'G3', 'G4']) {
        const chevron = page.getByRole('button', { name: `Expand ${name}`, exact: true })
        if (await chevron.count()) await chevron.click()
      }
      for (let n = 1; n <= 5; n++) {
        const tr = page.locator(`main tr[data-node-id="${id('r', n)}"]`)
        await expect(tr).toBeVisible()
        const cell = tr.locator('td').nth(1)
        await expect(cell).toHaveAttribute('data-guide-levels', String(n - 1))
        const chips = cell.getByTestId('row-machine-stack').getByRole('button')
        expect(await chips.count(), 'machine, module, beacon and beacon module chips').toBe(4)
        const boxes = await chips.evaluateAll(els => els.map(e => { const b = e.getBoundingClientRect(); return { left: b.left, right: b.right } }))
        const cellBox = (await cell.boundingBox())!
        const products = (await tr.locator('td').nth(2).locator('[data-variant]').first().boundingBox())!
        const last = boxes[boxes.length - 1]
        expect(last.right, `${width}px, level ${n - 1}: the last chip ends inside the cell`).toBeLessThanOrEqual(cellBox.x + cellBox.width + 0.5)
        expect(last.right, `${width}px, level ${n - 1}: the last chip does not reach the Products chip`).toBeLessThanOrEqual(products.x)
        for (let i = 1; i < boxes.length; i++) expect(boxes[i].left, 'chips do not overlap').toBeGreaterThanOrEqual(boxes[i - 1].right)
        // A click on the last chip lands on it, not on the Products chip.
        const hit = await chips.last().evaluate(e => { const b = e.getBoundingClientRect(); return e.contains(document.elementFromPoint(b.right - 2, b.top + b.height / 2)) })
        expect(hit, `${width}px, level ${n - 1}: the last chip takes its clicks`).toBe(true)
      }
    }
  })

  test('a group row has no Machine and Beacons span: its name cell is the Recipe column, its summary under the name', async ({ page }) => {
    await open(page, PLAN, 416)
    const group = rows(page).filter({ has: page.getByTestId('group-summary') }).first()
    const recipe = recipeRows(page).first()
    const g = (await group.locator('td').nth(1).boundingBox())!
    const r = (await recipe.locator('td').nth(1).boundingBox())!
    expect(Math.abs(g.width - r.width), `group name cell ${g.width}, recipe cell ${r.width}`).toBeLessThanOrEqual(1)
    const name = (await group.getByRole('button', { name: /^Sulfuric Acid$/ }).boundingBox())!
    const summary = (await group.getByTestId('group-summary').boundingBox())!
    expect(summary.y, 'the summary is on a line under the name').toBeGreaterThanOrEqual(name.y + name.height - 1)
    expect((await group.boundingBox())!.height, 'a group row keeps its one-line minimum').toBeGreaterThanOrEqual(37)
    // The summary does not run out of its cell.
    expect(summary.x + summary.width).toBeLessThanOrEqual(g.x + g.width + 1)
  })

  test('recipe rows keep one height, at most two lines of chips per column, Products one chip, and the +N opens the rest', async ({ page }) => {
    await open(page, PLAN, 900)
    const heights = (await recipeRows(page).evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height))))
    expect(new Set(heights).size, `without the stack the rows keep their natural heights: ${heights}`).toBeGreaterThanOrEqual(1)
    await expect(page.getByTestId('recipe-chips-more')).toHaveCount(0)

    await open(page, PLAN, 416)
    const narrowHeights = await recipeRows(page).evaluateAll(els => els.map(e => e.getBoundingClientRect().height))
    expect(new Set(narrowHeights).size, `recipe rows have one height: ${narrowHeights}`).toBe(1)
    expect(narrowHeights[0], '37 + 36 px').toBeGreaterThanOrEqual(72)
    expect(narrowHeights[0]).toBeLessThanOrEqual(73)

    const count = await recipeRows(page).count()
    for (let i = 0; i < count; i++) {
      const row = recipeRows(page).nth(i)
      // Cells: reorder, recipe, products, byproducts, ingredients, power.
      expect(await row.locator('td').nth(2).locator('[data-variant]').count(), 'Products holds exactly one chip').toBe(1)
      for (const cell of [3, 4]) expect(await chipLines(row.locator('td').nth(cell))).toBeLessThanOrEqual(2)
    }

    const more = page.getByRole('button', { name: /more (byproducts|ingredients)$/ })
    expect(await more.count(), 'a +N button stands where chips were cut').toBeGreaterThan(0)
    // One fewer than two lines hold, and the +N in the last slot.
    for (let i = 0; i < await more.count(); i++) {
      const cell = more.nth(i).locator('xpath=ancestor::td[1]')
      const shown = await cell.locator('[data-variant]').count()
      const perLine = await cell.locator('xpath=./div').evaluate(el => Math.floor((el.clientWidth + 6) / 38))
      expect(shown).toBe(2 * perLine - 1)
      const n = +(await more.nth(i).getAttribute('aria-label'))!.match(/^(\d+)/)![1]
      await expect(more.nth(i)).toHaveText(`+${n}`)
    }

    const vp = page.viewportSize()!
    for (const which of ['first', 'last'] as const) {
      const btn = more[which]()
      await btn.scrollIntoViewIfNeeded()
      await btn.click()
      const dialog = page.getByRole('dialog', { name: /^More (byproducts|ingredients)$/ })
      await expect(dialog).toBeVisible()
      const [bb, db] = await Promise.all([btn.boundingBox(), dialog.boundingBox()])
      expect(db!.x >= -1 && db!.y >= -1 && db!.x + db!.width <= vp.width + 1 && db!.y + db!.height <= vp.height + 1, `the ${which} list stays inside the screen: ${JSON.stringify(db)}`).toBe(true)
      expect(db!.y >= bb!.y + bb!.height - 1 || db!.y + db!.height <= bb!.y + 1, `the ${which} list does not cover its +N`).toBe(true)
      expect(db!.x <= bb!.x + bb!.width && db!.x + db!.width >= bb!.x, `the ${which} list is next to its +N`).toBe(true)
      const n = +(await btn.getAttribute('aria-label'))!.match(/^(\d+)/)![1]
      await expect(dialog.getByRole('listitem')).toHaveCount(n)
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    }

    // The Close button, and a press elsewhere, close it too.
    await more.first().click()
    const dialog = page.getByRole('dialog', { name: /^More (byproducts|ingredients)$/ })
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(dialog).toBeHidden()
    await more.first().click()
    await expect(dialog).toBeVisible()
    await page.getByTestId('table-toolbar').click({ position: { x: 200, y: 20 } })
    await expect(dialog).toBeHidden()
    // Opening the list does not select the row.
    await expect(page.locator('main table tbody tr[data-selected="true"]')).toHaveCount(0)
  })

  test('a hidden ingredient in the list keeps its action: it opens the recipe picker, naming its exact rate', async ({ page }) => {
    await open(page, PLAN, 416)
    const more = page.getByRole('button', { name: /more ingredients$/ }).first()
    await more.scrollIntoViewIfNeeded()
    await more.click()
    const dialog = page.getByRole('dialog', { name: 'More ingredients' })
    await expect(dialog).toBeVisible()
    const chip = dialog.locator('button[data-variant="ingredient"]').first()
    await expect(chip).toHaveAttribute('title', /^.+ — Find producer recipe — \S+$/)
    await chip.click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expect(dialog).toBeHidden()
  })

  test('the dialog takes focus when it opens and gives it back to its +N, and Tab past it closes it', async ({ page }) => {
    await open(page, PLAN, 416)
    const more = page.getByRole('button', { name: /more (byproducts|ingredients)$/ }).first()
    await more.scrollIntoViewIfNeeded()
    await more.click()
    const dialog = page.getByRole('dialog', { name: /^More (byproducts|ingredients)$/ })
    await expect(dialog).toBeFocused()
    await expect(more).toHaveAttribute('aria-controls', (await dialog.getAttribute('id'))!)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(more).toBeFocused()

    await more.click()
    await expect(dialog).toBeFocused()
    await dialog.getByRole('button', { name: 'Close' }).click()
    await expect(more).toBeFocused()

    // Tab walks the dialog (Close, then the chips); past the last control focus leaves it and the dialog closes.
    await more.click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Tab')
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused()
    for (let i = 0; i < 12 && await dialog.isVisible(); i++) await page.keyboard.press('Tab')
    await expect(dialog).toBeHidden()
  })

  test('the +N of an area row is anchored the same way: under its button, over its column', async ({ page }) => {
    await open(page, OVERFLOW, 1440)
    const more = rows(page).getByTestId('area-chips-more').first()
    await more.click()
    const popup = page.getByRole('tooltip')
    await expect(popup).toBeVisible()
    const [bb, pb] = await Promise.all([more.boundingBox(), popup.boundingBox()])
    expect(pb!.y >= bb!.y + bb!.height - 1 || pb!.y + pb!.height <= bb!.y + 1, 'the list does not cover its +N').toBe(true)
    expect(pb!.x <= bb!.x + bb!.width && pb!.x + pb!.width >= bb!.x, 'the list is over the +N column').toBe(true)
  })
})

test.describe('narrowToolbar: the table toolbar does not wrap, below 768 px', () => {
  test('is one line high at 416 px: + Recipe, the counts, the unit switch and the compact warnings pill', async ({ page }) => {
    await open(page, PLAN, 416)
    const toolbar = page.getByTestId('table-toolbar')
    expect((await toolbar.boundingBox())!.height).toBe(44)
    const [sw, cw] = await toolbar.evaluate(el => [el.scrollWidth, el.clientWidth])
    expect(sw, 'nothing runs out of the toolbar').toBeLessThanOrEqual(cw)

    const add = toolbar.getByRole('button', { name: 'Add recipe' })
    expect((await add.boundingBox())!.height, '+ Recipe is one line').toBe(26)
    for (const id of ['block-recipe-count', 'block-power-total']) {
      const box = (await toolbar.getByTestId(id).boundingBox())!
      expect(box.height, `${id} is one line`).toBeLessThanOrEqual(16)
    }
    await expect(toolbar.getByTestId('block-machine-count')).toBeHidden()

    // Every control sits on the line of the toolbar.
    const centres = await toolbar.locator('button, [data-testid^="block-"]').evaluateAll(els =>
      els.filter(e => (e as HTMLElement).offsetParent !== null).map(e => { const b = e.getBoundingClientRect(); return Math.round(b.top + b.height / 2) }))
    expect(Math.max(...centres) - Math.min(...centres), `centres ${centres}`).toBeLessThanOrEqual(2)

    // The pill: "⚠ 1", 8 px of padding, and still named in words.
    const pill = toolbar.getByRole('button', { name: /^⚠ \d+ warnings?$/ })
    await expect(pill).toBeVisible()
    // The words are there for assistive technology only (visually hidden): the pill is as wide as "⚠ 1" and no arrow.
    expect((await pill.boundingBox())!.width, 'a compact pill').toBeLessThan(50)
    expect(await pill.evaluate(el => getComputedStyle(el).paddingLeft)).toBe('8px')
    expect((await pill.boundingBox())!.height).toBeLessThanOrEqual(28)
    expect(await pill.getByText('▼').isVisible()).toBe(false)
  })

  test('does not overflow at 768 px with a warning: the no-wrap and no-shrink rules are for below 768 px only', async ({ page }) => {
    for (const width of [768, 775, 800]) {
      await open(page, PLAN, width)
      const toolbar = page.getByTestId('table-toolbar')
      await expect(toolbar.getByRole('button', { name: /^⚠ \d+ warnings?/ })).toBeVisible()
      const [sw, cw] = await toolbar.evaluate(el => [el.scrollWidth, el.clientWidth])
      expect(sw, `${width}px: nothing runs out of the toolbar`).toBeLessThanOrEqual(cw)
      const [power, bar] = await Promise.all([toolbar.getByTestId('block-power-total').boundingBox(), toolbar.boundingBox()])
      expect(power!.x + power!.width, `${width}px: the power total is inside the toolbar`).toBeLessThanOrEqual(bar!.x + bar!.width)
    }
  })

  test('keeps the full pill and the machine count from 768 px', async ({ page }) => {
    await open(page, PLAN, 1440)
    const toolbar = page.getByTestId('table-toolbar')
    const pill = toolbar.getByRole('button', { name: /^⚠ \d+ warnings?/ })
    expect(await pill.evaluate(el => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim())).toMatch(/^⚠ \d+ warnings? ▼$/)
    expect(await pill.evaluate(el => getComputedStyle(el).paddingLeft)).toBe('10px')
    await expect(toolbar.getByTestId('block-machine-count')).toBeVisible()
  })
})
