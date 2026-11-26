import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { closeGraph, openGraph, powerRow, setView } from './support/blockGraph'
import { selectRow } from './support/sidePanel'

/**
 * The Power view of the Block graph modal on a small Seablock plan. Gears: group "Beaconed" (gear wheels in 4 machines with
 * beacons, 5892 kW) and a loose iron rod row (5 machines, 675 kW). Fabrication: an iron rod row (9 machines, 1215 kW). Power
 * plant: 6 steam engines making 324 units/min, 5400 kW. Demand 7782 kW, so the plant is 2382 kW short; with the engines
 * pinned at 9 MW it has 1218 kW to spare.
 */
const FIXTURE = path.resolve('e2e/fixtures/not-in-golden/power-overview-seablock.json')
const SOURCE = 'kompetenz-seablock'
const GEAR = 'Iron gear wheel'
const ROD = 'Iron rod'

test.use({ viewport: { width: 1280, height: 720 } })

async function openPower(page: Page) {
  await loadPlanFixture(page, FIXTURE, SOURCE)
  await expect(page.getByTestId('block-tab')).toHaveCount(3, { timeout: 15000 })
  await openGraph(page)
  await setView(page, 'Power')
}

test('the Power view reads demand against generation, by block and by recipe', async ({ page }) => {
  await openPower(page)

  // 1. Header figures.
  await expect(page.getByTestId('power-demand')).toHaveText('7.8MW')
  await expect(page.getByTestId('power-generation')).toHaveText('5.4MW')
  await expect(page.getByTestId('power-balance')).toHaveAttribute('data-status', 'short')
  await expect(page.getByTestId('power-balance')).toHaveText('2.4MW short')

  // 2. By block: biggest first, the first block open.
  const blocks = page.locator('[data-testid="power-row"][data-kind="block"]')
  await expect(blocks).toHaveCount(3)
  await expect(blocks.nth(0)).toContainText('Gears')
  await expect(blocks.nth(1)).toContainText('Fabrication')
  await expect(blocks.nth(2)).toContainText('Power plant')
  await expect(blocks.nth(2)).toContainText('–')
  await expect(blocks.nth(0)).toContainText('6.6MW')
  await expect(blocks.nth(0)).toContainText('84.4%')
  await expect(blocks.nth(1)).toContainText('1.2MW')
  await expect(blocks.nth(1)).toContainText('15.6%')
  const rows = page.getByTestId('power-row')
  await expect(rows).toHaveCount(5)
  await expect(rows.nth(1)).toHaveAttribute('data-kind', 'group')
  await expect(rows.nth(1)).toContainText('Beaconed')
  await expect(rows.nth(1)).toContainText('5.9MW')
  await expect(rows.nth(1)).toContainText('75.7%')
  await expect(rows.nth(2)).toHaveAttribute('data-kind', 'recipe')
  await expect(rows.nth(2)).toContainText(ROD)
  await expect(rows.nth(2)).toContainText('675.0kW')
  await expect(rows.nth(2)).toContainText('8.7%')

  await page.getByTestId('power-view').getByRole('button', { name: 'Expand Beaconed' }).click()
  const gear = powerRow(page, 'recipe', GEAR)
  await expect(gear).toHaveCount(1)
  await expect(gear).toContainText('5.9MW')
  await expect(gear).toContainText('4')
  await page.getByTestId('power-view').getByRole('button', { name: 'Collapse Gears' }).click()
  await expect(page.getByTestId('power-row')).toHaveCount(3)

  // 3. By recipe.
  await page.getByRole('button', { name: 'By recipe' }).click()
  const lines = page.getByTestId('power-row')
  await expect(lines).toHaveCount(3)
  await expect(lines.nth(0)).toContainText(GEAR)
  await expect(lines.nth(0)).toContainText('5.9MW')
  await expect(lines.nth(1)).toContainText(ROD)
  await expect(lines.nth(1)).toContainText('Fabrication')
  await expect(lines.nth(1)).toContainText('1.2MW')
  await expect(lines.nth(2)).toContainText('Gears')
  await expect(lines.nth(2)).toContainText('675.0kW')
  await expect(page.getByTestId('power-view')).not.toContainText('Steam engine')

  const filter = page.getByTestId('power-filter')
  await filter.fill('fabrication')
  await expect(lines).toHaveCount(1)
  await filter.fill('rod')
  await expect(lines).toHaveCount(2)
  await filter.fill('zzz')
  await expect(lines).toHaveCount(0)
  await expect(page.getByText('No recipe or block matches what you typed.')).toBeVisible()
  await filter.press('Escape')
  await expect(filter).toHaveValue('')
  await expect(page.getByRole('heading', { name: 'Block graph' })).toBeVisible()
  await expect(lines).toHaveCount(3)
})

test('the gauge draws the demand column against the generation column', async ({ page }) => {
  await openPower(page)
  await expect(page.getByTestId('power-gauge-short')).toBeVisible()
  await expect(page.getByTestId('power-gauge-spare')).toHaveCount(0)

  const generation = (await page.getByTestId('power-gauge-generation').boundingBox())!
  const segments = await page.getByTestId('power-gauge-segment').evaluateAll(els => els.map(e => e.getBoundingClientRect().height))
  expect(segments).toHaveLength(2)
  const demand = segments.reduce((a, b) => a + b, 0)
  expect(demand / generation.height).toBeCloseTo(7782 / 5400, 1)
  expect(Math.abs(demand / generation.height / (7782 / 5400) - 1)).toBeLessThan(0.02)

  const line = (await page.getByTestId('power-gauge-line').boundingBox())!
  const bottom = generation.y + generation.height
  expect(Math.abs(bottom - line.y - demand)).toBeLessThan(3)
})

test('the view is remembered, and a plant making more than the factory draws reads as spare', async ({ page }) => {
  await openPower(page)
  await closeGraph(page)
  await openGraph(page)
  await expect(page.getByRole('button', { name: 'Power', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await closeGraph(page)
  await page.reload()
  await expect(page.getByTestId('block-tab')).toHaveCount(3, { timeout: 15000 })
  await openGraph(page)
  await expect(page.getByRole('button', { name: 'Power', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await closeGraph(page)

  // 9 MW is 540 units/min of electricity, which is 600 executions/min of the 0.9-unit recipe.
  await page.locator('[data-testid="block-tab"] button[aria-label="Power plant"]').click()
  const panel = await selectRow(page, page.locator('main table tbody tr').first())
  const pinned = panel.getByLabel('Pinned rate')
  await pinned.fill('9')
  await pinned.press('Tab')
  await expect(pinned).toHaveValue('9')

  await openGraph(page)
  await expect(page.getByTestId('power-generation')).toHaveText('9.0MW')
  await expect(page.getByTestId('power-balance')).toHaveAttribute('data-status', 'spare')
  await expect(page.getByTestId('power-balance')).toHaveText('+1.2MW spare')
  await expect(page.getByTestId('power-gauge-spare')).toBeVisible()
  await expect(page.getByTestId('power-gauge-short')).toHaveCount(0)
})
