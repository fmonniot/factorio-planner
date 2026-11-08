import { test, expect, type Locator, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, pane, slotById } from './support/summary'

/**
 * Fixture: the active block "Metals" has 16 goals; "Sciences" requests 12 of those items and
 * "Circuits" 3. The Plastic goal has three segments in its bar: a wide one to Sciences, a
 * narrow one to Circuits and what is left. The Ingredients pane imports all its items.
 */
const FIXTURE = path.resolve('e2e/fixtures/summary-many-items.json')

const segments = (page: Page, label: string) => detail(page, label).locator('[data-testid="summary-segment"]')
const overviewSegments = (page: Page, label: string) => detail(page, label).locator('[data-testid="summary-overview-segment"]')
const tip = (segment: Locator) => segment.getByTestId('summary-segment-tip')

/** What a segment writes in the bar, without its tooltip. */
const written = (segment: Locator) =>
  segment.evaluate(el => [...el.children].filter(c => c.getAttribute('aria-hidden') !== 'true').map(c => c.textContent).join(' ').trim())

/** Select a product by item id and wait for the strip to show it. */
async function selectProduct(page: Page, itemId: string) {
  await slotById(page, 'Products', itemId).click()
  await expect(detail(page, 'Products')).toHaveAttribute('data-state', 'selected')
}

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  // The exports appear once every block has been solved.
  await expect(overviewSegments(page, 'Products').filter({ hasText: 'Sciences' })).toBeVisible({ timeout: 20000 })
}

test.describe('summary strip and bars', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  // 1 sumShort
  test('the strip is 72 px high in every state and holds the header, the bar and the actions', async ({ page }) => {
    await setup(page)
    const strip = detail(page, 'Products')
    expect((await strip.boundingBox())!.height).toBe(72)

    await slotById(page, 'Products', 'nullius-plastic').hover()
    await expect(strip).toHaveAttribute('data-state', 'preview')
    expect((await strip.boundingBox())!.height).toBe(72)

    await selectProduct(page, 'nullius-plastic')
    await page.mouse.move(5, 5)
    const box = (await strip.boundingBox())!
    expect(box.height).toBe(72)
    for (const name of ['Find recipe', 'Remove extra', 'Remove product']) {
      const b = (await strip.getByRole('button', { name }).boundingBox())!
      expect(b.y + b.height, `${name} is inside the strip`).toBeLessThanOrEqual(box.y + box.height + 0.5)
    }
    expect(await strip.evaluate(e => e.scrollHeight <= e.clientHeight + 1), 'nothing is clipped').toBe(true)
    await expect(detail(page, 'Ingredients')).toHaveCSS('height', '72px')
  })

  // 1 legTip
  test('there is no key line; hovering a segment shows a black tooltip with name, amount and note', async ({ page }) => {
    await setup(page)
    await selectProduct(page, 'nullius-plastic')
    const strip = detail(page, 'Products')
    await page.mouse.move(5, 5)
    await expect(strip.getByTestId('summary-key-entry')).toHaveCount(0)
    await expect(strip.getByRole('button', { name: 'Remove extra' })).toBeVisible()
    await expect(segments(page, 'Products')).toHaveCount(3)

    const seg = segments(page, 'Products').first()
    await expect(tip(seg)).toBeHidden()
    await seg.hover()
    const shown = tip(seg)
    await expect(shown).toBeVisible()
    await expect(shown).toContainText('Sciences')
    await expect(shown).toContainText('20.0')
    const [box, region] = [(await shown.boundingBox())!, (await pane(page, 'Products').boundingBox())!]
    expect(box.x).toBeGreaterThanOrEqual(region.x - 1)
    expect(box.x + box.width).toBeLessThanOrEqual(region.x + region.width + 1)
    // The tool buttons' tooltip colours: black with a gray border.
    await expect(seg.locator('[aria-hidden="true"]').last()).toHaveCSS('background-color', 'rgb(0, 0, 0)')

    await page.mouse.move(5, 5)
    await expect(shown).toBeHidden()
  })

  test('the tooltip opens from the keyboard too, and the second line says what a click does', async ({ page }) => {
    await setup(page)
    await selectProduct(page, 'nullius-plastic')
    await page.mouse.move(5, 5)
    const seg = segments(page, 'Products').first()
    await seg.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(tip(seg)).toBeVisible()
    await expect(seg.getByTestId('summary-segment-detail')).toHaveText(/^Sends .+ to Sciences — click to open/)
  })

  // 1 legInBar
  test('the bar is 16 px and writes the name and amount, the amount alone, or nothing, by width', async ({ page }) => {
    await setup(page)
    await selectProduct(page, 'nullius-plastic')
    await page.mouse.move(5, 5)
    const segs = segments(page, 'Products')
    const info = await segs.evaluateAll(l => l.map(e => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, label: e.getAttribute('aria-label') })))
    expect(info.every(s => Math.abs(s.h - 16) < 1.5), 'the bar is 16 px high: ' + info.map(s => s.h)).toBe(true)
    expect(info.every(s => !!s.label), 'every segment has an accessible name').toBe(true)
    const texts = await Promise.all((await segs.all()).map(written))
    // Widest, narrower, then the rest: name and amount; amount alone; name and amount.
    expect(texts[0]).toMatch(/Sciences\s+20\.0/)
    expect(texts[1]).toBe('5.00')
    expect(texts[2]).toMatch(/Extra\s+30\.0/)
    expect(await segs.nth(1).getAttribute('aria-label')).toMatch(/5\.00/)
  })

  test('a segment too thin for any text still has its name and tooltip', async ({ page }) => {
    await setup(page)
    await selectProduct(page, 'nullius-graphite')
    await page.mouse.move(5, 5)
    const thin = segments(page, 'Products').nth(1)
    expect(await written(thin)).toBe('')
    expect(((await thin.boundingBox())!).width).toBeLessThan(24)
    await expect(thin).toHaveAccessibleName(/Circuits requests/)
    await thin.hover()
    await expect(tip(thin)).toBeVisible()
    await expect(tip(thin)).toContainText('Circuits')
  })

  test('clicking an export segment still opens the consumer', async ({ page }) => {
    await setup(page)
    await selectProduct(page, 'nullius-plastic')
    await segments(page, 'Products').first().click()
    await expect(page.locator('button[title="Sciences"][aria-current="true"]')).toBeVisible()
  })

  // 1 ovBar
  test('the overview is one stacked bar spanning the pane, one segment per row, with the amount and the count', async ({ page }) => {
    await setup(page)
    const strip = detail(page, 'Products')
    await expect(strip).toHaveAttribute('data-state', 'overview')
    const segs = overviewSegments(page, 'Products')
    await expect(segs).toHaveCount(3)
    const [stripBox, boxes] = [(await strip.boundingBox())!, await segs.evaluateAll(l => l.map(e => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height } }))]
    const total = boxes.reduce((sum, b) => sum + b.w, 0) + (boxes.length - 1)
    expect(Math.abs(total - (stripBox.width - 20)), 'together they span the pane: ' + total).toBeLessThan(3)
    expect(boxes.every(b => Math.abs(b.h - 16) < 1.5)).toBe(true)
    expect(boxes[boxes.length - 1].x + boxes[boxes.length - 1].w).toBeLessThanOrEqual(stripBox.x + stripBox.width - 9)
    const texts = await Promise.all((await segs.all()).map(written))
    expect(texts[0]).toMatch(/Sciences\s+176 · 12/)
    expect(texts[2]).toMatch(/Left\s+480 · 16/)
    // The key line is gone: nothing but the heading and the bar.
    await expect(strip.getByText('click a segment to trace it')).toBeVisible()
  })

  test('hovering an overview segment shows its tooltip; clicking traces it and dims the slots without that key', async ({ page }) => {
    await setup(page)
    const segs = overviewSegments(page, 'Products')
    const sciences = segs.filter({ hasText: 'Sciences' })
    await sciences.hover()
    await expect(tip(sciences)).toBeVisible()
    await expect(tip(sciences)).toContainText('12 items')
    await expect(sciences).toHaveAccessibleName(/→ Sciences · 176 · 12 items/)

    await sciences.click()
    await expect(sciences).toHaveAttribute('aria-pressed', 'true')
    await expect(detail(page, 'Products').getByText('click again to clear')).toBeVisible()
    const slots = pane(page, 'Products').getByTestId('summary-slot')
    await expect(slots.filter({ has: page.locator('[data-traced="out"]') })).toHaveCount(0)
    await expect(pane(page, 'Products').locator('[data-testid="summary-slot"][data-traced="in"]')).toHaveCount(12)
    await expect(pane(page, 'Products').locator('[data-testid="summary-slot"][data-traced="out"]')).toHaveCount(4)
    expect(await pane(page, 'Products').locator('[data-traced="out"]').first().evaluate(e => +getComputedStyle(e).opacity)).toBeLessThan(1)

    await sciences.click()
    await expect(pane(page, 'Products').locator('[data-traced]')).toHaveCount(0)
  })

  test('a thin overview segment keeps its colour, name and tooltip', async ({ page }) => {
    await setup(page)
    const thin = overviewSegments(page, 'Products').nth(1)
    expect(await written(thin)).toBe('')
    await expect(thin).toHaveAccessibleName(/→ Circuits · .* · 3 items/)
    await thin.hover()
    await expect(tip(thin)).toBeVisible()
    const bg = await thin.evaluate(e => getComputedStyle(e).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  })

  test('the Ingredients overview is one segment that writes Imported with its amount and count', async ({ page }) => {
    await setup(page)
    const imported = overviewSegments(page, 'Ingredients').first()
    await expect(imported).toHaveAttribute('data-key', 'import')
    expect(await written(imported)).toMatch(/Imported\s+\d+ · 14/)
    await expect(detail(page, 'Ingredients')).toHaveCSS('height', '72px')
  })

  test('the overview keeps its fixed 72 px and the table does not move when a slot is selected', async ({ page }) => {
    await setup(page)
    const table = page.locator('main table').first()
    const before = (await table.boundingBox())!.y
    await selectProduct(page, 'nullius-plastic')
    expect((await table.boundingBox())!.y).toBe(before)
  })
})

test.describe('on a narrow screen', () => {
  test.use({ viewport: { width: 420, height: 800 } })

  test('the bar fits the pane and the tooltip stays inside it', async ({ page }) => {
    await setup(page)
    const strip = detail(page, 'Products')
    const segs = overviewSegments(page, 'Products')
    const stripBox = (await strip.boundingBox())!
    const last = (await segs.last().boundingBox())!
    expect(last.x + last.width).toBeLessThanOrEqual(stripBox.x + stripBox.width - 9)
    await segs.first().hover()
    const t = (await tip(segs.first()).boundingBox())!
    expect(t.x).toBeGreaterThanOrEqual(stripBox.x - 1)
    expect(t.x + t.width).toBeLessThanOrEqual(stripBox.x + stripBox.width + 1)
  })
})
