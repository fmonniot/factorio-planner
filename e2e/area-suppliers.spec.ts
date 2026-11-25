import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { exportPlan } from './support/appMenu'
import { pane, selectSlot, slot } from './support/summary'
import { openLine, setPreset } from './support/sourcesList'
import { inputLines, selectRow } from './support/sidePanel'

/**
 * Case 21 B of spec/test-synthetic.md on real Nullius recipes: plate is the Stone box (20 stone for 4 boxes), gear the Gravel
 * box. The block "Crushing B" asks for 12 Gravel boxes a minute; its area "Line L" runs Gravel (boxed) pinned at 12 and has no
 * Stone boxing row; "Line M1" and "Line M2", in that order, each have one; "Boxer" offers 100 Stone boxes a minute.
 *
 * Rows of case 21 B, in Stone boxes a minute (derived by hand, never fitted to the solver):
 *   a  no connection, no rule:                M1 12, M2 0, from outside 0
 *   b  L takes nothing from M1:               M1 0,  M2 12
 *   c  L takes nothing from M1 and M2:        M1 0,  M2 0, 12 imported
 *   d  as c, with the connection (offer 100): M1 0,  M2 0, 12 received over the connection, nothing imported
 */
const FIXTURE = path.resolve('e2e/fixtures/area-suppliers.json')
const M1 = 'bbbb0005-0000-0000-0000-000000000002'
const M2 = 'bbbb0005-0000-0000-0000-000000000003'
const BOX = 'nullius-box-stone'

async function load(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  for (const name of ['Line L', 'Line M1', 'Line M2']) {
    await page.getByRole('button', { name: new RegExp(`^(Expand|Collapse) ${name}$`) }).click()
  }
}

const rows = (page: Page) => page.locator('main table tbody tr')
const using = (page: Page) => rows(page).filter({ hasText: 'Gravel (boxed)' })
const boxing = (page: Page, n: 1 | 2) => rows(page).filter({ hasText: 'Stone boxing' }).nth(n - 1)
/** Stone boxes a minute a Stone boxing row makes: its product chip reads "Stone box — 12.0/m", and a row at 0 may draw none. */
const made = (page: Page, n: 1 | 2) => async (): Promise<number> => {
  const chip = boxing(page, n).locator('[data-variant="product"]').first()
  if ((await chip.count()) === 0) return 0
  const match = /([\d.]+)\/m$/.exec((await chip.getAttribute('aria-label')) ?? '')
  return match ? parseFloat(match[1]) : Number.NaN
}
const popover = (page: Page) => page.getByTestId('comes-from-popover')
const rulesButton = (page: Page) => pane(page, 'Ingredients').getByTestId('source-rules')
const areaLine = (page: Page, id: string) => popover(page).locator(`[data-line="other-area"][data-area-id="${id}"]`)
const reading = (page: Page, line: ReturnType<typeof areaLine>) => line.getByTestId('sources-rate')

async function openList(page: Page) {
  await using(page).getByLabel(/^Stone box/).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Comes from…' }).click()
  await expect(popover(page)).toBeVisible()
  await popover(page).getByTestId('comes-from-scope').getByRole('button', { name: 'Line L', exact: true }).click()
  await expect(popover(page).getByTestId('sources-list')).toBeVisible()
}

async function expectRows(page: Page, f: { m1: number; m2: number }) {
  await expect.poll(made(page, 1), { message: "Line M1's Stone boxing row" }).toBeCloseTo(f.m1, 1)
  await expect.poll(made(page, 2), { message: "Line M2's Stone boxing row" }).toBeCloseTo(f.m2, 1)
}

/** The Stone boxes the areas matrix says Line L trades, per partner ("Trades with" of the focused Line L). */
async function expectTrades(page: Page, f: { m1: number; m2: number; outside: number }) {
  await page.getByRole('button', { name: 'Areas in every block' }).click()
  await page.getByRole('table', { name: 'Areas of Crushing B' }).getByRole('button', { name: 'Line L' }).click()
  const panel = page.getByRole('complementary', { name: 'Line L' })
  const check = async (testId: string, rate: number) => {
    const li = panel.getByTestId(testId).locator(`li[data-item-id="${BOX}"][data-direction="in"]`)
    if (rate === 0) await expect(li).toHaveCount(0)
    else await expect(li).toHaveText(new RegExp(`${rate}(\\.0+)?/m in$`))
  }
  await check(`trade-lines-${M1}`, f.m1)
  await check(`trade-lines-${M2}`, f.m2)
  await check('trade-lines-outside', f.outside)
  await page.locator('div.fixed.inset-0').getByRole('button', { name: 'Close' }).click()
}

const stone = (page: Page) => slot(page, 'Ingredients', 'Stone')
const stoneBox = (page: Page) => slot(page, 'Ingredients', 'Stone box')

test.describe('choosing the supplying area (case 21 B)', () => {
  test('rows a to c: one switch per supplying area; the list, the rows, the pane, the sentence, the rule list and the matrix agree', async ({ page }, testInfo) => {
    await load(page)
    // No offer: the block's connection goes, through the Sources list of the block.
    await using(page).getByLabel(/^Stone box/).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Comes from…' }).click()
    await openLine(popover(page).locator('[data-line="block"]'))
    await popover(page).getByTestId('sources-block-remove').click()
    await expect(popover(page).getByTestId('sources-block-name')).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Row a.
    await openList(page)
    await expect(popover(page).locator('[data-line="other-area"]')).toHaveCount(2)
    await expect(popover(page).locator('[data-line="other-area"]').evaluateAll(els => els.map(e => e.getAttribute('data-area-id')))).resolves.toEqual([M1, M2])
    await expectRows(page, { m1: 12, m2: 0 })
    await expect(reading(page, areaLine(page, M1))).toHaveText(/^12(\.0+)?\/m$/)
    await expect(reading(page, areaLine(page, M2))).toHaveText('—')
    await expect(reading(page, popover(page).locator('[data-line="import"]'))).toHaveText('—')
    await page.keyboard.press('Escape')
    await expect(slot(page, 'Ingredients', 'Stone')).toHaveAccessibleName(/^Stone, 60(\.0+)? per minute/)
    await expect(stoneBox(page)).toHaveCount(0)
    await expectTrades(page, { m1: 12, m2: 0, outside: 0 })

    // Row b: Line L takes nothing from M1.
    await openList(page)
    await areaLine(page, M1).getByTestId('sources-area-switch').click()
    await expectRows(page, { m1: 0, m2: 12 })
    await expect(reading(page, areaLine(page, M1))).toHaveText('—')
    await expect(reading(page, areaLine(page, M2))).toHaveText(/^12(\.0+)?\/m$/)
    await page.keyboard.press('Escape')
    await expect(stone(page)).toHaveAccessibleName(/^Stone, 60(\.0+)? per minute/)
    await expect(rulesButton(page)).toHaveText('Source rules (1)')
    await rulesButton(page).click()
    await expect(page.getByTestId('source-rules-popover').getByTestId('source-rule-name')).toHaveText('Line L: takes nothing from Line M1')
    await page.keyboard.press('Escape')
    await expectTrades(page, { m1: 0, m2: 12, outside: 0 })

    // Row c: and nothing from M2: the 12 Stone boxes are imported.
    await openList(page)
    await areaLine(page, M2).getByTestId('sources-area-switch').click()
    await expectRows(page, { m1: 0, m2: 0 })
    await expect(reading(page, popover(page).locator('[data-line="import"]'))).toHaveText(/^12(\.0+)?\/m$/)
    await page.keyboard.press('Escape')
    await expect(stoneBox(page)).toHaveAccessibleName(/^Stone box, 12(\.0+)? per minute/)
    await expect(stone(page)).toHaveCount(0)
    await expect(rulesButton(page)).toHaveText('Source rules (2)')
    await expectTrades(page, { m1: 0, m2: 0, outside: 12 })

    // Remove M1's entry: only M2 is off, so M1 supplies the 12 again.
    await rulesButton(page).click()
    const list = page.getByTestId('source-rules-popover')
    await list.locator(`[data-testid="source-rule"][data-other-area-id="${M1}"]`).getByRole('button', { name: /^Remove/ }).click()
    await expect(rulesButton(page)).toHaveText('Source rules (1)')
    await expectRows(page, { m1: 12, m2: 0 })
    // Remove M2's entry: the last one, so the button and the area's rule are gone.
    await list.locator(`[data-testid="source-rule"][data-other-area-id="${M2}"]`).getByRole('button', { name: /^Remove/ }).click()
    await expect(rulesButton(page)).toHaveCount(0)
    await expectRows(page, { m1: 12, m2: 0 })

    const download = await exportPlan(page)
    const file = testInfo.outputPath('exported.json')
    fs.copyFileSync((await download.path())!, file)
    const exported = JSON.parse(fs.readFileSync(file, 'utf8')) as { blocks: { name: string; sourceRules?: unknown; rootPlan: { subPlans: { name: string; sourceRules?: unknown }[] } }[] }
    const crushing = exported.blocks.find(b => b.name === 'Crushing B')!
    expect(crushing.sourceRules ?? {}).toEqual({})
    for (const sp of crushing.rootPlan.subPlans) expect(sp.sourceRules, `${sp.name} has no rule of its own`).toBeUndefined()
  })

  test('row d: with the connection offering 100 and both areas switched off, the 12 come over the connection', async ({ page }) => {
    await load(page)
    await openList(page)
    await areaLine(page, M1).getByTestId('sources-area-switch').click()
    await areaLine(page, M2).getByTestId('sources-area-switch').click()
    await expectRows(page, { m1: 0, m2: 0 })
    const blockLine = popover(page).locator('[data-line="block"]')
    await expect(blockLine.getByTestId('sources-block-rate')).toHaveText(/^12(\.0+)?\/m$/)
    await openLine(blockLine)
    await expect(blockLine.getByTestId('sources-detail-reading')).toHaveText(/of it reaches this area\.$/)
    await expect(popover(page).getByTestId('sources-foot')).toContainText('Reaches Line L')
    await expect(reading(page, popover(page).locator('[data-line="import"]'))).toHaveText('—')
    // The block lines are read-only here (no limit, no Remove); Receive from… stays, as it only adds a connection.
    await expect(blockLine.getByTestId('sources-limit')).toHaveCount(0)
    await expect(blockLine.getByTestId('sources-block-remove')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await selectSlot(page, 'Ingredients', 'Stone box')
    await expect(stoneBox(page)).toHaveAccessibleName(/^Stone box, 12(\.0+)? per minute/)
    await expect(stone(page)).toHaveCount(0)
    await expectTrades(page, { m1: 0, m2: 0, outside: 12 })
  })
})

test("the row's panel reads the area's own rule", async ({ page }) => {
  await load(page)
  // Line L takes nothing from M1: the area has a rule of its own, so the panel lists the area's supply.
  await openList(page)
  await areaLine(page, M1).getByTestId('sources-area-switch').click()
  await expectRows(page, { m1: 0, m2: 12 })
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await selectRow(page, using(page))
  await expect(inputLines(page, BOX, 'other-area')).toHaveCount(1)
  await expect(inputLines(page, BOX, 'other-area')).toHaveAttribute('data-key', `area:${M2}`)
  await expect(inputLines(page, BOX, 'other-area').getByTestId('input-line-rate')).toHaveText(/^12(\.0+)?$/)
  await expect(inputLines(page, BOX, 'other-area')).toHaveAttribute('data-target', 'area')

  // And nothing from M2: no area supplies them, the connection to Boxer does (row d).
  await page.keyboard.press('Escape')
  await openList(page)
  await areaLine(page, M2).getByTestId('sources-area-switch').click()
  await expectRows(page, { m1: 0, m2: 0 })
  await page.keyboard.press('Escape')
  await selectRow(page, using(page))
  await expect(inputLines(page, BOX, 'block')).toHaveCount(1)
  await expect(inputLines(page, BOX, 'block').getByTestId('input-line-label')).toHaveText('Boxer')
  await expect(inputLines(page, BOX, 'block').getByTestId('input-line-rate')).toHaveText(/^12(\.0+)?$/)
  await expect(inputLines(page, BOX, 'other-area')).toHaveCount(0)
})

/**
 * Case 21 C of spec/test-synthetic.md on Nullius, with ratios of its own (re-derived by hand, never fitted): A is "Iron ingot 1"
 * (5 iron ore for 2 ingots and 1 Gravel), X the Gravel it makes on the side, R "Gravel" (1 stone for 1 Gravel), U "Mineral dust
 * (gravel)" (6 Gravel for 5 dust). The block "Dust" asks for 30 ingots (A is pinned at 15 runs: 15 Gravel on the side. The pin is there because a surplus the plan does not pin is free: unpinned, A's output is indifferent to the solver, which over-ran A and made R 30 instead of the derived 39) and 45 dust; Line T
 * has A, Line C1 has U pinned at 4 runs, 20 dust (needs 24 Gravel), Line C2 has U pinned at 5 runs, 25 dust (needs 30) and R. Gravel is 54 in all.
 *
 *   a  no rule:                                R makes 39
 *   c  C1: Don't make more here:               R makes 15 (the side Gravel goes to C2), C1 imports 24
 *   d  c, and C2 takes nothing from T:         R makes 30, the side Gravel goes to C1, which imports 9
 */
const BYPRODUCT = path.resolve('e2e/fixtures/area-byproduct.json')
const T = 'dddd0005-0000-0000-0000-000000000001'
const GRAVEL = 'nullius-gravel'

test('case 21 C, rows c and d: the area that takes nothing from T leaves the side Gravel to the other consumer', async ({ page }) => {
  await loadPlanFixture(page, BYPRODUCT)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  for (const name of ['Line T', 'Line C1', 'Line C2']) {
    await page.getByRole('button', { name: new RegExp(`^(Expand|Collapse) ${name}$`) }).click()
  }
  const dust = (n: 0 | 1) => rows(page).filter({ hasText: 'Mineral dust (gravel)' }).nth(n)
  // Gravel a minute the R row makes (its product chip reads "Gravel — 15.0/m"; a row at 0 may draw none).
  const ranAt = async (): Promise<number> => {
    const chip = page.locator('main tr[data-node-id="dddd0008-0000-0000-0000-000000000002"] [data-variant="product"]').first()
    if ((await chip.count()) === 0) return 0
    const match = /([\d.]+)\/m$/.exec((await chip.getAttribute('aria-label')) ?? '')
    return match ? parseFloat(match[1]) : Number.NaN
  }
  const open = async (n: 0 | 1, area: string) => {
    await dust(n).getByLabel(/^Gravel/).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Comes from…' }).click()
    await expect(popover(page)).toBeVisible()
    await popover(page).getByTestId('comes-from-scope').getByRole('button', { name: area, exact: true }).click()
  }
  const trades = async (area: string, f: { t: number; outside: number }) => {
    await page.getByRole('button', { name: 'Areas in every block' }).click()
    await page.getByRole('table', { name: 'Areas of Dust' }).getByRole('button', { name: area }).click()
    const panel = page.getByRole('complementary', { name: area })
    for (const [testId, rate] of [[`trade-lines-${T}`, f.t], ['trade-lines-outside', f.outside]] as const) {
      const li = panel.getByTestId(testId).locator(`li[data-item-id="${GRAVEL}"][data-direction="in"]`)
      if (rate === 0) await expect(li).toHaveCount(0)
      else await expect(li).toHaveText(new RegExp(`${rate}(\\.0+)?/m in$`))
    }
    await page.locator('div.fixed.inset-0').getByRole('button', { name: 'Close' }).click()
  }
  const line = (id: string) => popover(page).locator(`[data-line="other-area"][data-area-id="${id}"]`)
  const readingOf = (l: ReturnType<typeof line>) => l.getByTestId('sources-rate')
  const importOf = () => popover(page).locator('[data-line="import"]').getByTestId('sources-rate')

  // Row a, as the starting point: the area rows make 39 Gravel.
  await expect.poll(ranAt).toBeCloseTo(39, 1)

  // Row c: Line C1 does not make Gravel more.
  await open(0, 'Line C1')
  await setPreset(popover(page), 'byproducts-first')
  await expect.poll(ranAt).toBeCloseTo(15, 1)
  await expect(readingOf(line(T))).toHaveText('—')
  await expect(importOf()).toHaveText(/^24(\.0+)?\/m$/)
  await page.keyboard.press('Escape')
  await trades('Line C1', { t: 0, outside: 24 })
  await trades('Line C2', { t: 15, outside: 0 })

  // Row d: Line C2 takes nothing from Line T.
  await open(1, 'Line C2')
  await expect(readingOf(line(T))).toHaveText(/^15(\.0+)?\/m$/)
  await line(T).getByTestId('sources-area-switch').click()
  await expect(readingOf(line(T))).toHaveText('—')
  await expect.poll(ranAt).toBeCloseTo(30, 1)
  await page.keyboard.press('Escape')
  await open(0, 'Line C1')
  await expect(readingOf(line(T))).toHaveText(/^15(\.0+)?\/m$/)
  await expect(importOf()).toHaveText(/^9(\.0+)?\/m$/)
  await page.keyboard.press('Escape')
  await trades('Line C1', { t: 15, outside: 9 })
  await trades('Line C2', { t: 0, outside: 0 })
})
