import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { exportPlan } from './support/appMenu'
import { openRowMenu } from './support/rowMenu'
import { detail, pane, selectSlot, slot } from './support/summary'
import { expectPreset, openLine, setPreset } from './support/sourcesList'

/**
 * Case 21 A of spec/test-synthetic.md on real Nullius recipes: plate is the Stone box, gear the Gravel box, "Stone boxing"
 * (20 stone for 4 Stone boxes) makes the plate and "Gravel (boxed)" (1 Stone box for 1 Gravel box) uses it. The block
 * "Crushing" asks for 20 Gravel boxes a minute; its areas "Line L" and "Line B" run the Gravel (boxed) row pinned at 12 and 8,
 * each with a Stone boxing row beside it; "Boxer" offers 100 Stone boxes a minute over one connection.
 *
 * Rows of case 21 A, in Stone boxes a minute (what the Stone boxing rows run at, and what the connection brings):
 *   a  no rule:                       L 12, B 8, connection 0
 *   b  the block receives it first:   L 0,  B 0, connection 20
 *   c  L receives it first:           L 0,  B 8, connection 12
 *   d  the block receives it first, B makes it here ({}):  L 0, B 8, connection 12
 *   j  no offer (the connection removed), L: Don't make more here and Import off: L 0, B 8, 12 missing
 */
const FIXTURE = path.resolve('e2e/fixtures/area-rules.json')
const L_ID = 'cccc0005-0000-0000-0000-000000000001'

async function load(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  for (const name of ['Line L', 'Line B']) {
    await page.getByRole('button', { name: new RegExp(`^(Expand|Collapse) ${name}$`) }).click()
  }
}

const rows = (page: Page) => page.locator('main table tbody tr')
/** The Stone boxing and Gravel (boxed) rows of an area, in table order (L first). */
const boxing = (page: Page, area: 'L' | 'B') => rows(page).filter({ hasText: 'Stone boxing' }).nth(area === 'L' ? 0 : 1)
const using = (page: Page, area: 'L' | 'B') => rows(page).filter({ hasText: 'Gravel (boxed)' }).nth(area === 'L' ? 0 : 1)
/** Stone boxes a minute a Stone boxing row makes: its product chip reads "Stone box — 12.0/m", and a row at 0 may draw none. */
const made = (page: Page, area: 'L' | 'B') => async (): Promise<number> => {
  const chip = boxing(page, area).locator('[data-variant="product"]').first()
  if ((await chip.count()) === 0) return 0
  const match = /([\d.]+)\/m$/.exec((await chip.getAttribute('aria-label')) ?? '')
  return match ? parseFloat(match[1]) : Number.NaN
}
const stoneBox = (page: Page) => slot(page, 'Ingredients', 'Stone box')
const stone = (page: Page) => slot(page, 'Ingredients', 'Stone')
const rulesButton = (page: Page) => pane(page, 'Ingredients').getByTestId('source-rules')
const popover = (page: Page) => page.getByTestId('comes-from-popover')
const scopeButton = (page: Page, name: string) => popover(page).getByTestId('comes-from-scope').getByRole('button', { name, exact: true })

/** The figures of one row of case 21 A: Stone boxes each Stone boxing row makes, what the connection brings, and the stone taken. */
async function expectFigures(page: Page, f: { l: number; b: number; connection: number; stone: number }) {
  await expect.poll(made(page, 'L'), { message: "Line L's Stone boxing row" }).toBeCloseTo(f.l, 1)
  await expect.poll(made(page, 'B'), { message: "Line B's Stone boxing row" }).toBeCloseTo(f.b, 1)
  await expect(stoneBox(page)).toHaveAccessibleName(new RegExp(`^Stone box, ${f.connection}(\\.0+)? per minute`))
  // An item nothing imports has no slot.
  if (f.stone === 0) await expect(stone(page)).toHaveCount(0)
  else await expect(stone(page)).toHaveAccessibleName(new RegExp(`^Stone, ${f.stone}(\\.0+)? per minute`))
}

/** Right-click the Stone box ingredient chip of an area's Gravel (boxed) row and open Comes from…. */
async function openFromChip(page: Page, area: 'L' | 'B') {
  await using(page, area).getByLabel(/^Stone box/).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Comes from…' }).click()
  await expect(popover(page)).toBeVisible()
}

test.describe('area source rules (case 21 A)', () => {
  test('row c: Line L receives it first, from a row chip; the pane, the markers and the rule list show it, and Use the block\'s rule undoes it', async ({ page }) => {
    await load(page)
    await expect(pane(page, 'Ingredients').getByTestId('source-rules')).toHaveCount(0)
    await expectFigures(page, { l: 12, b: 8, connection: 0, stone: 100 })

    await openFromChip(page, 'L')
    await expect(popover(page).getByTestId('comes-from-scope')).toHaveAttribute('data-tip', /^Every row of the block/)
    await expect(scopeButton(page, 'Whole block')).toHaveAttribute('aria-pressed', 'true')
    await expect(scopeButton(page, 'Line L')).toHaveAttribute('aria-pressed', 'false')
    await expect(popover(page).getByTestId('comes-from-scope').getByRole('button')).toHaveCount(2)
    await scopeButton(page, 'Line L').click()
    await expect(popover(page).getByTestId('sources-rule-chip')).toHaveAttribute('data-owner', 'follows')

    await setPreset(popover(page), 'connections-first')
    await expect(popover(page).getByTestId('use-block-rule')).toBeVisible()
    await expect(popover(page).getByTestId('sources-rule-chip')).toHaveAttribute('data-owner', 'own')
    await expectFigures(page, { l: 0, b: 8, connection: 12, stone: 40 })

    // The marker follows the rule of the area: its rows only.
    await expect(using(page, 'L').getByTestId('source-rule-marker')).toHaveAccessibleName(/^Line L: /)
    await expect(using(page, 'B').getByTestId('source-rule-marker')).toHaveCount(0)

    // The rule list has one entry for the part of the area's rule.
    await rulesButton(page).click()
    await expect(rulesButton(page)).toHaveText('Source rules (1)')
    const entry = page.getByTestId('source-rules-popover').getByTestId('source-rule')
    await expect(entry).toHaveCount(1)
    await expect(entry).toHaveAttribute('data-area-id', L_ID)
    await expect(entry.getByTestId('source-rule-name')).toHaveText('Line L: Receive it first')
    await page.keyboard.press('Escape')

    // The slot says how many areas have their own rule, and opens the popover on the first.
    await selectSlot(page, 'Ingredients', 'Stone box')
    const strip = pane(page, 'Ingredients').getByTestId('summary-detail')
    await expect(strip.getByTestId('areas-have-rules')).toHaveText('1 area has its own rule')
    await expect(strip.getByTestId('comes-from-scope')).toHaveCount(0)
    await strip.getByTestId('areas-have-rules').click()
    await expect(popover(page)).toBeVisible()
    await expect(scopeButton(page, 'Line L')).toHaveAttribute('aria-pressed', 'true')
    await expectPreset(popover(page), 'connections-first')

    // The column of the area in the areas matrix has the marker; the other column has none.
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Areas in every block' }).click()
    const matrix = page.locator('div.fixed.inset-0').getByRole('table', { name: /^Areas of / })
    await expect(matrix.locator(`th[data-area-id="${L_ID}"]`).getByTestId('source-rule-marker')).toBeVisible()
    await expect(matrix.locator('th[data-area-id]').getByTestId('source-rule-marker')).toHaveCount(1)
    await page.locator('div.fixed.inset-0').getByRole('button', { name: 'Close' }).click()

    // Use the block's rule: row a again, and nothing marks a rule.
    await openFromChip(page, 'L')
    await expect(scopeButton(page, 'Line L')).toHaveAttribute('aria-pressed', 'true')
    await popover(page).getByTestId('use-block-rule').click()
    await expect(popover(page).getByTestId('sources-rule-chip')).toHaveAttribute('data-owner', 'follows')
    await expectFigures(page, { l: 12, b: 8, connection: 0, stone: 100 })
    await expect(page.getByTestId('source-rule-marker')).toHaveCount(0)
    await expect(rulesButton(page)).toHaveCount(0)
  })

  test("row d: the block receives it first and Line B makes it here; Remove in the rule list goes back to row b", async ({ page }, testInfo) => {
    await load(page)
    await openFromChip(page, 'B')
    await expect(scopeButton(page, 'Whole block')).toHaveAttribute('aria-pressed', 'true')
    await expect(scopeButton(page, 'Line B')).toHaveAttribute('aria-pressed', 'false')
    await expect(popover(page).getByTestId('comes-from-scope').getByRole('button')).toHaveCount(2)

    // Row b: the block receives it first.
    await setPreset(popover(page), 'connections-first')
    await expectFigures(page, { l: 0, b: 0, connection: 20, stone: 0 })

    // Row d: B makes it here, whatever the block says (an empty rule on the area).
    await scopeButton(page, 'Line B').click()
    await expectPreset(popover(page), 'connections-first')
    await setPreset(popover(page), 'own')
    await expect(popover(page).getByTestId('use-block-rule')).toBeVisible()
    await expectFigures(page, { l: 0, b: 8, connection: 12, stone: 40 })

    await rulesButton(page).click()
    await expect(rulesButton(page)).toHaveText('Source rules (2)')
    const list = page.getByTestId('source-rules-popover')
    await expect(list.getByTestId('source-rule-name')).toHaveText(['Receive it first', 'Line B: Make it here'])

    // Remove the area's entry: row b again, one rule left, and the area holds no key.
    await list.locator('[data-testid="source-rule"][data-rule="make-here"]').getByRole('button', { name: /^Remove/ }).click()
    await expect(rulesButton(page)).toHaveText('Source rules (1)')
    await expectFigures(page, { l: 0, b: 0, connection: 20, stone: 0 })
    await page.keyboard.press('Escape')

    const download = await exportPlan(page)
    const file = testInfo.outputPath('exported.json')
    fs.copyFileSync((await download.path())!, file)
    const exported = JSON.parse(fs.readFileSync(file, 'utf8')) as { blocks: { name: string; sourceRules?: unknown; rootPlan: { subPlans: { name: string; sourceRules?: unknown }[] } }[] }
    const crushing = exported.blocks.find(b => b.name === 'Crushing')!
    expect(crushing.sourceRules).toEqual({ 'nullius-box-stone': { makeHere: 'after-blocks' } })
    for (const sp of crushing.rootPlan.subPlans) expect(sp.sourceRules, `${sp.name} has no rule of its own`).toBeUndefined()
  })

  test('switching the area flag off takes its rule with it', async ({ page }) => {
    await load(page)
    await openFromChip(page, 'L')
    await scopeButton(page, 'Line L').click()
    await setPreset(popover(page), 'connections-first')
    await expectFigures(page, { l: 0, b: 8, connection: 12, stone: 40 })
    await page.keyboard.press('Escape')
    await expect(rulesButton(page)).toHaveText('Source rules (1)')

    const menu = await openRowMenu(page, rows(page).filter({ hasText: 'Line L' }).first())
    await menu.getByRole('menuitemcheckbox', { name: 'Separate area' }).click()

    // The rule, its entry, its marker and its scope are gone, and so is the key in the saved plan.
    await expect(rulesButton(page)).toHaveCount(0)
    await expect(page.getByTestId('source-rule-marker')).toHaveCount(0)
    await expect.poll(async () => {
      const plan = (await readActivePlan(page, 'nullius')) as { blocks: { name: string; rootPlan: { subPlans: { name: string; sourceRules?: unknown }[] } }[] }
      const l = plan.blocks.find(b => b.name === 'Crushing')!.rootPlan.subPlans.find(sp => sp.name === 'Line L')!
      return l.sourceRules
    }).toBeUndefined()
    await openFromChip(page, 'L')
    await expect(popover(page).getByTestId('comes-from-scope').getByRole('button', { name: 'Line L', exact: true })).toHaveCount(0)
    // The undo of the flag is covered by ComesFrom.test.tsx: nothing in the page undoes.
  })

  test("row j: with no offer, Line L set to Don't make more here with Import off leaves 12 missing; Import on again imports them", async ({ page }) => {
    await load(page)
    // No offer: the block's one connection goes (the Sources list of the chip's popover has its Remove).
    await openFromChip(page, 'L')
    await openLine(popover(page).locator('[data-line="block"]'))
    await popover(page).getByTestId('sources-block-remove').click()
    await expect(popover(page).getByTestId('sources-block-name')).toHaveCount(0)
    await page.keyboard.press('Escape')
    // Row g, as the starting point: L does not make it, nothing is offered, so 12 are imported and none missing.
    await openFromChip(page, 'L')
    await scopeButton(page, 'Line L').click()
    await setPreset(popover(page), 'byproducts-first')
    await expect.poll(made(page, 'L'), { message: "Line L's Stone boxing row" }).toBeCloseTo(0, 1)
    await expect.poll(made(page, 'B'), { message: "Line B's Stone boxing row" }).toBeCloseTo(8, 1)
    await expect(stoneBox(page)).toHaveAccessibleName(/^Stone box, 12(\.0+)? per minute/)
    await expect(stoneBox(page)).not.toHaveAccessibleName(/missing|short/i)

    // Row j: Import off on L. Its 12 cannot come from anywhere: they are missing, the slot is short by 12.
    await popover(page).getByTestId('sources-import-switch').click()
    await expect.poll(made(page, 'L'), { message: "Line L's Stone boxing row" }).toBeCloseTo(0, 1)
    await expect.poll(made(page, 'B'), { message: "Line B's Stone boxing row" }).toBeCloseTo(8, 1)
    await page.keyboard.press('Escape')
    await selectSlot(page, 'Ingredients', 'Stone box')
    const segments = detail(page, 'Ingredients')
    await expect(slot(page, 'Ingredients', 'Stone box')).toHaveAccessibleName(/^Stone box, 12(\.0+)? per minute.*(short|missing)/i)
    await expect(segments).toContainText(/Missing/i)

    // Import on again: Line L imports its 12 (row g).
    await openFromChip(page, 'L')
    await popover(page).getByTestId('sources-import-switch').click()
    await expect(slot(page, 'Ingredients', 'Stone box')).not.toHaveAccessibleName(/missing|short/i)
    await expect(slot(page, 'Ingredients', 'Stone box')).toHaveAccessibleName(/^Stone box, 12(\.0+)? per minute/)
  })

  test("the list's rule chip says whose rule it is at area scope, and Use the block's clears the area's", async ({ page }) => {
    await load(page)
    await openFromChip(page, 'L')
    await scopeButton(page, 'Line L').click()
    const chip = popover(page).getByTestId('sources-rule-chip')
    await expect(chip).toHaveText("Block's rule · Make it here")
    await expect(chip).toHaveAttribute('data-owner', 'follows')
    await expect(popover(page).getByTestId('use-block-rule')).toHaveCount(0)
    // Switching Make more here off in the list writes the area's own rule.
    await popover(page).getByTestId('sources-make-here-switch').click()
    await expect(chip).toHaveText("Own rule · Don't make more here")
    await expect(chip).toHaveAttribute('data-owner', 'own')
    const clear = popover(page).getByTestId('use-block-rule')
    await expect(clear).toHaveText("Use the block's")
    await clear.click()
    await expect(chip).toHaveText("Block's rule · Make it here")
    await expect(popover(page).getByTestId('use-block-rule')).toHaveCount(0)
    await expect(rulesButton(page)).toHaveCount(0)
  })

  test('the Leftover row of the list is the block\'s at area scope: read-only, with a change link to the whole block', async ({ page }) => {
    await load(page)
    await openFromChip(page, 'L')
    await scopeButton(page, 'Line L').click()
    const row = popover(page).getByTestId('leftover-row')
    await expect(row.getByTestId('leftover-switch')).toHaveAttribute('aria-disabled', 'true')
    await expect(row.getByTestId('leftover-switch')).toBeChecked()
    await row.getByTestId('leftover-switch').click({ force: true })
    await expect(row.getByTestId('leftover-switch')).toBeChecked()
    await expect(row).toContainText('whole block only')
    await row.getByTestId('leftover-whole-block').click()
    await expect(scopeButton(page, 'Whole block')).toHaveAttribute('aria-pressed', 'true')
    await expect(row.getByTestId('leftover-switch')).not.toHaveAttribute('aria-disabled', 'true')
    await row.getByTestId('leftover-switch').click()
    await expect(row.getByTestId('leftover-switch')).not.toBeChecked()
  })
})
