import { test, expect, type Locator, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

// Visual refinement 6/9. Each test mirrors a check of initiatives/archive/visual-refinement/check-artifact.mjs:
// "5 grpFixed", "5 grpIcon", "5 grpBand" and "2 ingLeft".

const OVERFLOW = path.resolve('e2e/fixtures/area-chips-overflow.json')
// Hydrogen: a recipe row at the top level and two separate areas (Compression, Chlorides).
const AREAS = path.resolve('e2e/fixtures/area-matrix.json')

/**
 * A mixed table: the Hydrogen block of the plan above with "Chlorides" turned into a plain sub-factory (renamed
 * "Chlorides plain"). Written beside the test's output, so no fixture file joins the solver's golden snapshot.
 */
function mixedPlan(outPath: string): string {
  const plan = JSON.parse(fs.readFileSync(AREAS, 'utf-8'))
  const block = plan.blocks[0]
  const chlorides = block.rootPlan.subPlans.find((sp: { name: string }) => sp.name === 'Chlorides')
  delete chlorides.area
  chlorides.name = 'Chlorides plain'
  fs.writeFileSync(outPath, JSON.stringify({ blocks: [block], activeBlockId: block.id }))
  return outPath
}

/**
 * Every kind of group row in one table: "Chlorides" a plain sub-factory (no chips, no area), "Compression" an area with
 * chips, and "Empty area" a separate area with nothing in it, so nothing sent or received.
 */
function everyKindPlan(outPath: string): string {
  const plan = JSON.parse(fs.readFileSync(AREAS, 'utf-8'))
  const block = plan.blocks[0]
  const chlorides = block.rootPlan.subPlans.find((sp: { name: string }) => sp.name === 'Chlorides')
  delete chlorides.area
  const emptyId = 'ffff0030-0000-0000-0000-000000000001'
  block.rootPlan.subPlans.push({ id: emptyId, name: 'Empty area', nodes: [], subPlans: [], area: true, createdAt: chlorides.createdAt, updatedAt: chlorides.updatedAt })
  block.rootPlan.nodes.push({ kind: 'subplan', id: 'ffff0005-0000-0000-0000-000000000003', subPlanId: emptyId })
  fs.writeFileSync(outPath, JSON.stringify({ blocks: [block], activeBlockId: block.id }))
  return outPath
}

async function open(page: Page, fixture: string, viewport = { width: 1440, height: 900 }) {
  await page.setViewportSize(viewport)
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr [data-variant], main table tbody tr [data-direction]').first()).toBeVisible({ timeout: 10000 })
}

const rows = (page: Page) => page.locator('main table tbody tr')
const groupRows = (page: Page) => rows(page).filter({ has: page.getByTestId('group-summary') })
const groupRow = (page: Page, name: string) => groupRows(page).filter({ has: page.getByRole('button', { name, exact: true }) })
const toggle = (row: Locator, name: string) => row.getByRole('button', { name: new RegExp(`^(Expand|Collapse) ${name}$`) })

/** The computed colours of Tailwind classes, read through a probe so the test follows the palette instead of repeating hex values. */
async function palette(page: Page, classes: Record<string, string>) {
  return page.evaluate(classes => {
    const out: Record<string, string> = {}
    for (const [key, cls] of Object.entries(classes)) {
      const probe = document.createElement('span')
      probe.className = cls
      document.body.appendChild(probe)
      const cs = getComputedStyle(probe)
      out[key] = cls.startsWith('bg-') ? cs.backgroundColor : cs.color
      probe.remove()
    }
    return out
  }, classes)
}

test('5 grpFixed: a collapsed area row is one line high; what does not fit sits behind the +N and its popup', async ({ page }) => {
  await open(page, OVERFLOW)
  const assembly = groupRow(page, 'Assembly')
  const receives = assembly.getByTestId('area-chips-in')
  const more = receives.getByTestId('area-chips-more')
  await expect(more).toBeVisible()

  // One line: 37 px (a 32 px chip and the cell padding), every chip at the same height.
  expect((await assembly.boundingBox())!.height).toBe(37)
  const tops = await assembly.locator('[data-direction], [data-testid="area-chips-more"]').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)))
  expect(new Set(tops).size, `chips and +N share one line: ${tops}`).toBe(1)

  // The chips that fit are shown, one fewer than fit and the +N in the last slot; the rest is in the popup.
  const shown = await receives.locator('[data-direction="receives"]').count()
  const perLine = Math.floor(((await receives.boundingBox())!.width + 6) / 38)
  expect(shown).toBe(Math.min(16, perLine - 1))
  await expect(more).toHaveText(`+${20 - shown}`)
  await more.click()
  const popup = page.getByRole('tooltip')
  await expect(popup).toContainText('Also receives')
  await expect(popup.locator('[data-direction="receives"]')).toHaveCount(20 - shown)
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()

  // A wider window fits more chips on the same single line.
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect.poll(() => receives.locator('[data-direction="receives"]').count()).toBeGreaterThan(shown)
  expect((await assembly.boundingBox())!.height).toBe(37)
})

test('5 grpFixed: an area that sends and receives few items shows them all, without a +N', async ({ page }) => {
  await open(page, AREAS)
  const compression = groupRow(page, 'Compression')
  await expect(compression.locator('[data-direction]').first()).toBeVisible()
  await expect(compression.getByTestId('area-chips-more')).toHaveCount(0)
  expect((await compression.boundingBox())!.height).toBe(37)
})

test('5 grpFixed: every group row is 37 px: a plain sub-factory, an area with chips and an area with nothing to show, content centred', async ({ page }, testInfo) => {
  await open(page, everyKindPlan(testInfo.outputPath('every-kind-plan.json')))
  await expect(groupRows(page)).toHaveCount(3)
  const plain = groupRow(page, 'Chlorides')
  const area = groupRow(page, 'Compression')
  const empty = groupRow(page, 'Empty area')
  await expect(plain.getByRole('img', { name: 'Sub-factory' })).toHaveCount(1)
  await expect(plain.locator('[data-direction]')).toHaveCount(0)
  await expect(area.locator('[data-direction]').first()).toBeVisible()
  await expect(empty.getByRole('img', { name: 'Separate area' })).toHaveCount(1)
  await expect(empty.locator('[data-direction]')).toHaveCount(0)

  for (const row of [plain, area, empty]) expect((await row.boundingBox())!.height).toBe(37)

  // The name stays on the row's middle line.
  for (const [row, name] of [[plain, 'Chlorides'], [area, 'Compression'], [empty, 'Empty area']] as const) {
    const r = (await row.boundingBox())!
    const b = (await row.getByRole('button', { name, exact: true }).boundingBox())!
    expect(Math.abs(b.y + b.height / 2 - (r.y + r.height / 2)), `${name} is vertically centred`).toBeLessThanOrEqual(1)
  }
})

test('5 grpIcon: every group row has a 12 px icon named for its kind instead of the Area tag, on all-area and mixed tables', async ({ page }, testInfo) => {
  const { gray } = await (async () => { await open(page, AREAS); return { gray: (await palette(page, { gray: 'text-gray-400' })).gray } })()

  // All areas.
  for (const name of ['Compression', 'Chlorides']) {
    const row = groupRow(page, name)
    const icon = row.getByRole('img', { name: 'Separate area' })
    await expect(icon).toHaveCount(1)
    const box = (await icon.boundingBox())!
    expect([box.width, box.height]).toEqual([12, 12])
    expect(await icon.evaluate(e => getComputedStyle(e).color)).toBe(gray)
    await expect(icon.locator('title')).toHaveText('Separate area')
    // Before the name, and no "Area" tag any more.
    expect(box.x).toBeLessThan((await row.getByRole('button', { name, exact: true }).boundingBox())!.x)
    await expect(row.getByText('Area', { exact: true })).toHaveCount(0)
  }

  // Mixed: the folder of a plain sub-factory next to the areas icon of an area.
  await open(page, mixedPlan(testInfo.outputPath('mixed-plan.json')))
  await expect(groupRows(page)).toHaveCount(2)
  const area = groupRow(page, 'Compression')
  const plain = groupRow(page, 'Chlorides plain')
  await expect(area.getByRole('img', { name: 'Separate area' })).toHaveCount(1)
  await expect(area.getByRole('img', { name: 'Sub-factory' })).toHaveCount(0)
  await expect(plain.getByRole('img', { name: 'Sub-factory' })).toHaveCount(1)
  await expect(plain.getByRole('img', { name: 'Separate area' })).toHaveCount(0)
  const folder = (await plain.getByRole('img', { name: 'Sub-factory' }).boundingBox())!
  expect([folder.width, folder.height]).toEqual([12, 12])
  await expect(rows(page).getByText('Area', { exact: true })).toHaveCount(0)

  // "N machines" when it equals the recipe count, else "N recipes · M machines".
  for (const summary of await groupRows(page).getByTestId('group-summary').allTextContents()) {
    const m = summary.match(/^(?:(\d+) recipes? · )?(\d+) machines?$/)
    expect(m, summary).not.toBeNull()
    if (m![1] !== undefined) expect(m![1], `"${summary}" would read "N machines"`).not.toBe(m![2])
  }
})

test('5 grpBand: only an open group is banded, with a hairline under its header and a teal icon; collapsed rows keep the usual look', async ({ page }) => {
  await open(page, AREAS)
  const colors = await palette(page, { band: 'bg-teal-400/5', tint: 'bg-gray-800/30', teal: 'text-teal-400', gray: 'text-gray-400' })
  const row = groupRow(page, 'Compression')
  // The pointer rests away from the rows: hovering one adds its own tint.
  const look = async () => { await page.mouse.move(0, 0); return lookOf() }
  const lookOf = () => row.evaluate(r => {
    const cells = [...r.querySelectorAll(':scope > td')]
    const icon = r.querySelector('svg[role="img"]')!
    return {
      bg: getComputedStyle(r).backgroundColor,
      shadows: cells.map(c => getComputedStyle(c).boxShadow),
      icon: getComputedStyle(icon).color,
    }
  })

  const collapsed = await look()
  expect(collapsed.bg).toBe(colors.tint)
  expect(collapsed.icon).toBe(colors.gray)
  for (const s of collapsed.shadows) expect(s).not.toContain('rgba(45, 212, 191, 0.28)')

  await toggle(row, 'Compression').click()
  const opened = await look()
  expect(opened.bg).toBe(colors.band)
  expect(opened.icon).toBe(colors.teal)
  for (const s of opened.shadows) {
    expect(s, 'a hairline under the header, in every cell').toContain('rgba(45, 212, 191, 0.28)')
    expect(s).toMatch(/0px -1px 0px 0px inset/)
  }
  // The name weight is untouched.
  expect(await row.getByRole('button', { name: 'Compression', exact: true }).evaluate(e => getComputedStyle(e).fontWeight)).toBe('600')

  // A selected open row keeps the selection look and gets no hairline.
  await row.getByRole('button', { name: 'Compression', exact: true }).click()
  await expect(row).toHaveAttribute('data-selected', 'true')
  const selected = await look()
  expect(selected.bg).not.toBe(colors.band)
  for (const s of selected.shadows) expect(s).not.toContain('rgba(45, 212, 191, 0.28)')
  expect(selected.icon).toBe(colors.teal)

  // Collapsing restores the collapsed look (on another row, as the selected one keeps its selection tint).
  const other = groupRow(page, 'Chlorides')
  await page.mouse.move(0, 0)
  const before = await other.evaluate(r => getComputedStyle(r).backgroundColor)
  expect(before).toBe(colors.tint)
  await toggle(other, 'Chlorides').click()
  await page.mouse.move(0, 0)
  expect(await other.evaluate(r => getComputedStyle(r).backgroundColor)).toBe(colors.band)
  await toggle(other, 'Chlorides').click()
  await page.mouse.move(0, 0)
  expect(await other.evaluate(r => getComputedStyle(r).backgroundColor)).toBe(before)
})

test('2 ingLeft: ingredients start at the left of their column, at the same x on area and recipe rows, under a left-aligned header; Power stays right', async ({ page }) => {
  await open(page, AREAS, { width: 1920, height: 1080 })
  const area = groupRow(page, 'Compression')
  const recipe = rows(page).filter({ has: page.getByTestId('row-power') }).filter({ hasNot: page.getByTestId('group-summary') }).first()

  // The first ingredient chip of the recipe row is 8 px of padding + 28 px in from its column's left edge.
  const ingredientCell = recipe.locator('td').nth(6)
  const first = ingredientCell.locator(':scope > div > *').first()
  await expect(first).toBeVisible()
  const cellBox = (await ingredientCell.boundingBox())!
  const firstBox = (await first.boundingBox())!
  expect(firstBox.x - cellBox.x).toBe(36)

  // A collapsed area starts its first received chip at the same x.
  const received = area.getByTestId('area-chips-in').locator('[data-direction="receives"]').first()
  await expect(received).toBeVisible()
  expect((await received.boundingBox())!.x).toBe(firstBox.x)

  // So does an area's recipe row, once opened.
  await toggle(area, 'Compression').click()
  const inside = rows(page).filter({ has: page.getByTestId('row-power') }).nth(1).locator('td').nth(6).locator(':scope > div > *').first()
  await expect(inside).toBeVisible()
  expect((await inside.boundingBox())!.x).toBe(firstBox.x)

  // The header is left-aligned over the chips, at the same offset.
  const header = page.locator('main table thead th').filter({ hasText: 'Ingredients' })
  const hs = await header.evaluate(th => {
    const cs = getComputedStyle(th)
    return { align: cs.textAlign, x: th.getBoundingClientRect().left + parseFloat(cs.paddingLeft) }
  })
  expect(hs.align).toBe('left')
  expect(hs.x).toBe(firstBox.x)

  // Power keeps its right-aligned column (header and cells).
  const power = page.locator('main table thead th').filter({ hasText: 'Power' })
  expect(await power.evaluate(th => getComputedStyle(th).textAlign)).toBe('right')
  expect(await recipe.getByTestId('row-power').evaluate(e => getComputedStyle(e.closest('td')!).textAlign)).toBe('right')

  // The ingredient chips are no longer pushed to the right edge of their column.
  const lastBox = (await ingredientCell.locator(':scope > div > *').last().boundingBox())!
  expect(cellBox.x + cellBox.width - (lastBox.x + lastBox.width), 'room left of the right edge').toBeGreaterThan(24)
})
