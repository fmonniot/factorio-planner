import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

// Visual refinement 5/9. Each test mirrors a check of initiatives/archive/visual-refinement/check-artifact.mjs:
// "3 chipFmt", "3 chipNum and chipPlate", "6 phPair" and "6 phQuiet"; chipBig has no artifact check (the replica's readout shows it).

const BASE = path.resolve('e2e/fixtures/byproduct-consumer-base.json')
const AREAS = path.resolve('e2e/fixtures/area-matrix.json')

async function open(page: Page, fixture: string, ...also: string[]) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  // The machine chip carries data-chip-quantity too, so wait for the item chips (and whatever else the test reads) the solver renders.
  for (const sel of ['[data-variant]', ...also]) await expect(page.locator(`main table tbody tr ${sel}`).first()).toBeVisible({ timeout: 10000 })
}

const itemChips = (page: Page) => page.locator('main table tbody tr [data-variant]')

/** The colours of Tailwind classes, read through a probe so the test follows the palette instead of repeating hex values. */
async function palette(page: Page, shades: string[]) {
  return page.evaluate(shades => {
    const out: Record<string, string> = {}
    for (const s of shades) {
      const probe = document.createElement('span')
      probe.className = `border border-${s} text-${s}`
      document.body.appendChild(probe)
      const cs = getComputedStyle(probe)
      out[`border-${s}`] = cs.borderTopColor
      out[`text-${s}`] = cs.color
      probe.remove()
    }
    return out
  }, shades)
}

const placeholderColors = (row: ReturnType<Page['locator']>, label: string) =>
  row.getByRole('button', { name: label, exact: true }).evaluate(btn => {
    const box = btn.querySelector('.border-dashed')!
    return { border: getComputedStyle(box).borderTopColor, glyph: getComputedStyle(btn).color, opacity: getComputedStyle(btn).opacity }
  })

test('3 chipFmt: every chip quantity is compact and the tooltip keeps the exact rate', async ({ page }) => {
  await open(page, BASE)
  await expect.poll(() => itemChips(page).count()).toBeGreaterThan(3)
  const quantities = await itemChips(page).evaluateAll(chips => chips.map(c => c.querySelector('[data-chip-quantity]')!.textContent!))
  expect(quantities.length).toBeGreaterThan(3)
  for (const q of quantities) expect(q, `quantity ${q}`).toMatch(/^(<\.01|\.\d\d|\d+(\.\d)?k?|\d+(\.\d)?[kMG]?W)$/)
  for (const q of quantities) expect(q.length, `quantity ${q}`).toBeLessThanOrEqual(5)
  // Every quantity stays inside its chip's 38 px slot: it may not spill over the icon's neighbour.
  const widths = await itemChips(page).evaluateAll(chips => chips.map(c => c.querySelector('[data-chip-quantity]')!.getBoundingClientRect().width))
  for (const w of widths) expect(w, 'quantity width').toBeLessThanOrEqual(38)
  // Exact rate in the title, with its unit.
  const titles = await itemChips(page).evaluateAll(chips => chips.map(c => c.getAttribute('title') ?? ''))
  for (const t of titles) expect(t, t).toMatch(/ — [\d.<e-]+(\/m|\/s|[kMG]?W)$/)
})

test('3 chipNum and chipPlate: an 11 px bold outlined quantity on a faint plate, on 32 px chips in a 38 px slot', async ({ page }) => {
  await open(page, BASE)
  const first = itemChips(page).first()
  const q = first.locator('[data-chip-quantity]')
  const qs = await q.evaluate(e => {
    const cs = getComputedStyle(e)
    return { size: cs.fontSize, weight: cs.fontWeight, family: cs.fontFamily, shadow: cs.textShadow }
  })
  expect(qs.size).toBe('11px')
  expect(Number(qs.weight)).toBeGreaterThanOrEqual(700)
  expect(qs.family).toMatch(/mono/)
  expect(qs.shadow.match(/rgb\(0, 0, 0\)/g)?.length, `four black shadows: ${qs.shadow}`).toBe(4)
  const box = await first.boundingBox()
  expect(box!.width).toBe(32)
  expect(box!.height).toBe(32)

  const plate = await first.evaluate(e => {
    const cs = getComputedStyle(e)
    return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, ring: cs.boxShadow }
  })
  const alpha = Number(plate.bg.match(/,\s*([\d.]+)\)$/)?.[1])
  expect(alpha, `a faint plate: ${plate.bg}`).toBeGreaterThan(0)
  expect(alpha).toBeLessThanOrEqual(0.1)
  expect(plate.radius).toBe('5px')
  expect(plate.ring).toMatch(/inset/)

  // The machine chip keeps its 9 px count and has no plate.
  const machine = page.getByTestId('machine-chip').first()
  expect(await machine.evaluate(e => getComputedStyle(e).backgroundColor)).toMatch(/0, 0, 0, 0\)|transparent/)
  expect(await machine.getByTestId('machine-count').evaluate(e => getComputedStyle(e).fontSize)).toBe('9px')

  // chipBig: two chips of a cell sit 38 px apart.
  const pitch = await page.locator('main table tbody tr').evaluateAll(rows => {
    for (const r of rows) {
      for (const td of r.querySelectorAll('td')) {
        const chips = [...td.querySelectorAll('[data-variant]')]
        if (chips.length >= 2) return chips[1].getBoundingClientRect().left - chips[0].getBoundingClientRect().left
      }
    }
    return null
  })
  expect(pitch, 'a cell with two chips').not.toBeNull()
  expect(pitch).toBe(38)
})

test('chipBig: a row with item chips is 37 px, a collapsed area row 37 px (was 33)', async ({ page }) => {
  await open(page, AREAS, '[data-direction]')
  const heights = await page.locator('main table tbody tr').evaluateAll(rows =>
    rows.filter(r => r.querySelector('[data-variant], [data-direction]')).map(r => ({ h: r.getBoundingClientRect().height, area: !!r.querySelector('[data-direction]') })))
  expect(heights.some(r => r.area), 'the fixture has a collapsed area row').toBe(true)
  for (const r of heights) expect(r.h).toBe(37)
})

test('6 phPair: an empty Beacons cell shows the beacon and module placeholders, both inside the cell', async ({ page }) => {
  await open(page, BASE)
  const row = page.locator('main table tbody tr').filter({ has: page.getByRole('button', { name: 'Add beacon', exact: true }) }).first()
  const cell = row.locator('td').filter({ has: page.getByRole('button', { name: 'Add beacon', exact: true }) })
  const buttons = cell.getByRole('button')
  await expect(buttons).toHaveCount(2)
  const mod = cell.getByRole('button', { name: 'Add beacon module', exact: true })
  await expect(mod).toContainText('0/')
  const c = (await cell.boundingBox())!
  for (const b of await buttons.all()) {
    const bb = (await b.boundingBox())!
    expect(bb.x).toBeGreaterThanOrEqual(c.x - 0.5)
    expect(bb.x + bb.width).toBeLessThanOrEqual(c.x + c.width + 0.5)
  }
  await mod.click()
  await expect(page.getByTestId('picker-heading')).toContainText('Add')
})

test('6 phQuiet: placeholders are fainter, come back on row hover, selection and focus, brighter on themselves, never hidden', async ({ page }) => {
  await open(page, BASE)
  const pal = await palette(page, ['gray-700', 'gray-600', 'gray-400', 'gray-200'])
  const rows = page.locator('main table tbody tr').filter({ has: page.getByRole('button', { name: 'Add beacon', exact: true }) })
  expect(await rows.count()).toBeGreaterThanOrEqual(2)
  const [a, b] = [rows.nth(0), rows.nth(1)]
  const label = 'Add beacon'

  await page.mouse.move(2, 2)
  const rest = await placeholderColors(a, label)
  expect(rest.border).toBe(pal['border-gray-700'])
  expect(rest.glyph).toBe(pal['text-gray-600'])
  expect(rest.opacity).toBe('1')

  // Hovering the row (not the placeholder): the usual tone.
  await a.locator('td').last().hover()
  const hov = await placeholderColors(a, label)
  expect(hov.border).toBe(pal['border-gray-600'])
  expect(hov.glyph).toBe(pal['text-gray-400'])

  // The placeholder itself: brighter still.
  await a.getByRole('button', { name: label, exact: true }).hover()
  const own = await placeholderColors(a, label)
  expect(own.border).toBe(pal['border-gray-400'])
  expect(own.glyph).toBe(pal['text-gray-200'])

  // A selected row keeps the usual tone with the pointer away.
  await b.locator('td').first().click({ position: { x: 4, y: 4 } })
  await page.mouse.move(2, 2)
  await expect(b).toHaveAttribute('data-selected', 'true')
  const sel = await placeholderColors(b, label)
  expect(sel.border).toBe(pal['border-gray-600'])
  expect(sel.glyph).toBe(pal['text-gray-400'])

  // Keyboard focus anywhere in a row: the usual tone, the placeholder itself still fainter than when focused directly.
  await page.keyboard.press('Escape')
  await a.getByTestId('machine-chip').focus()
  await page.mouse.move(2, 2)
  const foc = await placeholderColors(a, label)
  expect(foc.border).toBe(pal['border-gray-600'])
  expect(foc.glyph).toBe(pal['text-gray-400'])

  // The placeholder focused by keyboard: brighter.
  await a.getByRole('button', { name: label, exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  const own2 = await placeholderColors(a, label)
  expect(own2.border).toBe(pal['border-gray-400'])
  expect(own2.glyph).toBe(pal['text-gray-200'])
})
