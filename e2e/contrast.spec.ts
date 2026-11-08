import { test, expect, type Locator, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { sidePanel, selectRow } from './support/sidePanel'
import { detail } from './support/summary'

/**
 * Contrast of the dim greys (visual refinement, check `4 contrast`): hints, counts, header and panel labels, the
 * `–` cells go to gray-400, the reorder arrows to gray-400 and the top-bar tools to gray-300. Each is measured as
 * the WCAG ratio between its computed colour and the surface behind it: 4.5:1 for text, 3:1 for controls. The
 * arrows must also still reorder.
 */
const FIXTURE = path.resolve('e2e/fixtures/area-row-conveniences.json')
const SEABLOCK_FIXTURE = path.resolve('e2e/fixtures/block-tabs-seablock.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'

const GRAY_400 = [153, 161, 175] // #99a1af
const GRAY_300 = [209, 213, 220] // #d1d5dc

const row = (page: Page, id: string) => page.locator(`main tr[data-node-id="${id}"]`)

interface Measured { fg: number[]; bg: number[]; ratio: number }

/** The WCAG ratio of the element's text colour on the first opaque background behind it. Colours are resolved through a canvas, so oklch() and friends come out as sRGB. */
async function measure(target: Locator): Promise<Measured> {
  return target.evaluate((el: Element) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const rgba = (css: string): number[] => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      return [...ctx.getImageData(0, 0, 1, 1).data]
    }
    let bg = rgba('#101828')
    for (let n: Element | null = el; n; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor)
      if (c[3] === 255) { bg = c; break }
    }
    const fg = rgba(getComputedStyle(el).color)
    const lin = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    const a = lum(fg), b = lum(bg)
    return { fg: fg.slice(0, 3), bg: bg.slice(0, 3), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
  })
}

async function expectRatio(target: Locator, min: number, what: string) {
  const m = await measure(target)
  expect(m.ratio, `${what}: rgb(${m.fg}) on rgb(${m.bg}) is ${m.ratio.toFixed(2)}:1, wanted ${min}:1`).toBeGreaterThanOrEqual(min)
  return m
}

test.describe('table, overview and side panel (Nullius plan)', () => {
test.beforeEach(async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page, ROOT_ELEC)).toBeVisible({ timeout: 10000 })
})

test('the table header labels read at 4.5:1', async ({ page }) => {
  const th = page.locator('main table thead th', { hasText: 'Machine' })
  const m = await expectRatio(th, 4.5, 'table header')
  expect(m.fg).toEqual(GRAY_400)
})

test('the reorder arrows are gray-400, read at 3:1, and still reorder', async ({ page }) => {
  const arrow = row(page, ROOT_ELEC).getByRole('button', { name: 'Move down' })
  const m = await expectRatio(arrow, 3, 'reorder arrow')
  expect(m.fg).toEqual(GRAY_400)

  const ids = async () => ((await readActivePlan(page, 'nullius')) as { blocks: { rootPlan: { nodes: { id: string }[] } }[] })
    .blocks[0].rootPlan.nodes.map(n => n.id)
  const before = await ids()
  expect(before[0]).toBe(ROOT_ELEC)
  await arrow.click()
  await expect.poll(ids).toEqual([before[1], before[0], ...before.slice(2)])
})

test('the overview hint and item counts read at 4.5:1', async ({ page }) => {
  const strip = detail(page, 'Products')
  const hint = strip.getByText('click a row to trace it')
  await expect(hint).toBeVisible()
  const m = await expectRatio(hint, 4.5, 'overview hint')
  expect(m.fg).toEqual(GRAY_400)

  const count = strip.getByTestId('summary-overview-row').first().locator('span').last()
  await expectRatio(count, 4.5, 'overview item count')
})

test('the side-panel section labels read at 4.5:1', async ({ page }) => {
  const panel = await selectRow(page, row(page, ROOT_ELEC))
  for (const name of ['Rate', 'Machine', 'Beacons']) {
    const label = sidePanel(page).getByRole('heading', { name, exact: true })
    await expect(label).toBeVisible()
    const m = await expectRatio(label, 4.5, `${name} label`)
    expect(m.fg).toEqual(GRAY_400)
  }
  await expect(panel).toBeVisible()
})

test('the Areas tool is gray-300 and reads at 3:1', async ({ page }) => {
  const tool = page.getByTestId('top-bar').getByRole('button', { name: 'Areas in every block' })
  const m = await expectRatio(tool, 3, 'Areas tool')
  expect(m.fg).toEqual(GRAY_300)
})
})

// Horizon and Tech tree need a data set with technologies, which Nullius does not have.
test('the Horizon, Graph and Tech tree tools are gray-300 and read at 3:1', async ({ page }) => {
  await loadPlanFixture(page, SEABLOCK_FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  for (const name of [/^Horizon/, 'Block graph', 'Tech tree']) {
    const tool = page.getByTestId('top-bar').getByRole('button', { name })
    const m = await expectRatio(tool, 3, `tool ${name}`)
    expect(m.fg).toEqual(GRAY_300)
  }
})
