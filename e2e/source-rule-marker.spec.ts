import { test, expect, type Locator, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, pane, slot } from './support/summary'
import { inputLines, openSources, comesFromPopover } from './support/sidePanel'
import { importSwitch, setPreset } from './support/sourcesList'
import { pinEdge, openAreas, pickAreasBlock } from './support/blockGraph'

const FIXTURE = path.resolve('e2e/fixtures/item-sourcing.json')
const OXYGEN = 'nullius-oxygen'

/**
 * The "Acid" block of the item-sourcing fixture (steam electrolysis with oxygen as its side output, nitric acid
 * synthesis that uses oxygen, oxygen decompression that makes it) with methanol as one more product, made from oxygen
 * by a row inside a sub-factory "Methanol line": oxygen is an ingredient of two rows, one of them nested. `itemSourcing`
 * is the block's stored presets; `surfaces` adds what the summary, the areas matrix and the block graph need. Written beside the test's output, so no fixture file joins the solver's golden snapshot.
 */
function markerPlan(outPath: string, itemSourcing: Record<string, string> = {}, surfaces = false): string {
  const plan = JSON.parse(fs.readFileSync(FIXTURE, 'utf-8'))
  const acid = plan.blocks.find((b: { name: string }) => b.name === 'Acid')
  const subPlanId = 'dddd0001-0000-0000-0000-0000000000b1'
  const stamp = acid.rootPlan.createdAt
  acid.rootPlan.subPlans.push({
    id: subPlanId,
    name: 'Methanol line',
    nodes: [{ kind: 'game-recipe', id: 'dddd0001-0000-0000-0000-0000000000n5', recipeId: 'nullius-methanol', modules: [], byproductPolicy: {} }],
    subPlans: [],
    createdAt: stamp,
    updatedAt: stamp,
  })
  acid.rootPlan.nodes.push({ kind: 'subplan', id: 'dddd0001-0000-0000-0000-0000000000n4', subPlanId })
  acid.products.push({ id: 'dddd0001-0000-0000-0000-0000000000p3', itemId: 'nullius-methanol', extraRate: 20 })
  acid.itemSourcing = itemSourcing
  if (surfaces) {
    // For the other surfaces: the sub-factory is a separate area, so the block has an areas matrix that oxygen crosses,
    // and the block receives oxygen from "O2 maker", so oxygen has an Ingredients slot and an edge in the block graph.
    acid.rootPlan.subPlans.at(-1).area = true
    const maker = plan.blocks.find((b: { name: string }) => b.name === 'O2 maker')
    acid.inputConnections = [{ id: 'dddd0001-0000-0000-0000-0000000000c1', itemId: OXYGEN, fromBlockId: maker.id }]
  }
  fs.writeFileSync(outPath, JSON.stringify(plan))
  return outPath
}

const table = (page: Page) => page.locator('main table')
const rows = (page: Page) => table(page).locator('tbody tr')
/** The rows that use oxygen: nitric acid synthesis at the top level, methanol in the sub-factory. */
const userRows = (page: Page) => rows(page).filter({ has: page.locator('[data-variant="ingredient"][aria-label^="Oxygen"]') })
const acidRow = (page: Page) => rows(page).filter({ has: page.locator('[data-testid="recipe-name"][data-tip="Nitric acid"]') })
const methanolRow = (page: Page) => rows(page).filter({ has: page.locator('[data-testid="recipe-name"][data-tip="Methanol"]') })
const markers = (scope: Page | Locator) => scope.getByTestId('source-rule-marker')
/** Every chip of oxygen in the table, whatever its column. */
const oxygenChips = (page: Page) => table(page).locator('[data-variant][aria-label^="Oxygen"]')
const oxygenSlot = (page: Page) => slot(page, 'Ingredients', 'Oxygen')
/** The search box of the producer picker an ingredient chip opens. */
const picker = (page: Page) => page.getByPlaceholder('Search…')
const comesFrom = (page: Page) => detail(page, 'Ingredients').getByTestId('comes-from')

/** Sources… of the selected slot's strip opens the Comes from popover; the control of its list is returned. */
async function openRules(page: Page): Promise<Locator> {
  await comesFrom(page).getByTestId('sources-button').click()
  const control = comesFromPopover(page).getByTestId('comes-from')
  await expect(control.getByTestId('sources-list')).toBeVisible()
  return control
}

/** Escape closes the popover and, pressed again, deselects the slot. */
async function closeRules(page: Page) {
  await page.keyboard.press('Escape')
  await expect(comesFromPopover(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
}

async function open(page: Page, fixture: string) {
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(acidRow(page)).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'Expand Methanol line' }).click()
  await expect(methanolRow(page)).toBeVisible()
  await expect(userRows(page)).toHaveCount(2)
}

test('the marker is on every ingredient chip of an item with a rule that has an effect, and on no other chip', async ({ page }, testInfo) => {
  await open(page, markerPlan(testInfo.outputPath('marker-plan.json')))
  // Oxygen: an ingredient of the nitric acid and methanol rows, the side output of the electrolysis, the product of the decompression.
  await expect(oxygenChips(page)).toHaveCount(4)
  await expect(markers(page)).toHaveCount(0)

  // Receive it first with no connection: a rule with no effect, so no marker.
  const control = await openSources(page, acidRow(page), OXYGEN)
  await setPreset(control, 'connections-first')
  await expect(control.getByTestId('no-effect').getByTestId('no-effect-reason')).toHaveText('No connection')
  await expect(markers(table(page))).toHaveCount(0)

  // Don't make more here has an effect: one marker per ingredient chip, the row in the sub-factory included.
  await setPreset(control, 'byproducts-first')
  await expect(markers(table(page))).toHaveCount(2)
  for (const row of await userRows(page).all()) {
    const frame = row.locator('[data-chip-frame]')
    await expect(frame).toHaveCount(1)
    await expect(frame.locator('[data-variant="ingredient"]')).toHaveAttribute('aria-label', /^Oxygen — Find producer recipe — /)
    await expect(markers(frame)).toHaveAttribute('data-item-id', OXYGEN)
  }
  // No other chip of the table has one: not the oxygen the electrolysis and the decompression make, and no other item.
  await expect(table(page).locator('[data-chip-frame]')).toHaveCount(2)
  await expect(table(page).locator('[data-variant="product"] [data-testid="source-rule-marker"], [data-variant="byproduct"] [data-testid="source-rule-marker"]')).toHaveCount(0)

  // A grey dot named by the rule, with the model's reading once the pointer has been over it: no letter, none of the old badge.
  const marker = markers(acidRow(page))
  // Wait for the solve this rule triggers (the solver is debounced): until it lands, the marker's name is the new rule read
  // against the previous solve, which still has the oxygen decompression running. The panel's made-here line, which names the
  // electrolysis, is the sign that the solve landed.
  await expect(inputLines(page, OXYGEN, 'made-here')).toHaveCount(1)
  await expect(inputLines(page, OXYGEN, 'made-here').getByTestId('input-line-label')).toHaveText(/^Steam electrolysis/)
  await expect(marker).toHaveAttribute('aria-label', "Don't make more here")
  // The popover covers the chip: close it, and the pointer reaches the marker. The model is read once the pointer is over it.
  await page.keyboard.press('Escape')
  await expect(comesFromPopover(page)).toHaveCount(0)
  await marker.hover()
  await expect(marker).toHaveAttribute('aria-label', /^Don't make more here\nAlready made here: /)
  await expect(page.getByTestId('tooltip')).toContainText("Don't make more here")
  await expect(page.getByTestId('tooltip')).toContainText('Already made here')
  await expect(marker).toHaveText('')
  await expect(page.getByTestId('item-tile-sourcing')).toHaveCount(0)
  await expect(page.locator('[data-sourcing]')).toHaveCount(0)
  await expect(table(page).locator('[aria-label*="first)"]')).toHaveCount(0)

  // Back to the default: no rule, no marker.
  await setPreset(await openSources(page, acidRow(page), OXYGEN), 'own')
  await expect(markers(page)).toHaveCount(0)
})

test('the marker only shows the rule: a click on it opens nothing, and a right-click on the chip is how the rule is changed', async ({ page }, testInfo) => {
  await open(page, markerPlan(testInfo.outputPath('marker-plan.json'), { [OXYGEN]: 'byproducts-first' }))
  // The row inside the sub-factory.
  const row = methanolRow(page)
  const marker = markers(row)
  await expect(marker).toBeVisible()
  await expect(marker).toHaveRole('img')
  await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'false')

  // The dot is 6px in the top-right corner of the chip, in a larger box that carries the tooltip.
  const chip = row.locator('[data-variant="ingredient"][aria-label^="Oxygen"]')
  const chipBox = (await chip.boundingBox())!
  const dotBox = (await marker.locator('span').boundingBox())!
  const hitBox = (await marker.boundingBox())!
  expect(Math.round(dotBox.width)).toBe(6)
  expect(Math.round(dotBox.height)).toBe(6)
  expect(hitBox.width).toBeGreaterThanOrEqual(14)
  expect(hitBox.height).toBeGreaterThanOrEqual(14)
  expect(Math.abs(dotBox.x + dotBox.width - (chipBox.x + chipBox.width))).toBeLessThanOrEqual(1)
  expect(Math.abs(dotBox.y - chipBox.y)).toBeLessThanOrEqual(1)
  const centre = { x: dotBox.x + dotBox.width / 2, y: dotBox.y + dotBox.height / 2 }
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'), centre)).toBe('source-rule-marker')

  // A click on it opens neither the popover, nor the slot, nor the chip's producer picker.
  await page.mouse.click(centre.x, centre.y)
  await expect(comesFromPopover(page)).toHaveCount(0)
  await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(picker(page)).toHaveCount(0)
  // It is not in the tab order.
  await expect(markers(page).locator('xpath=self::button')).toHaveCount(0)

  // The chip keeps its click (the producer picker) and has a right-click: its Comes from popover, with the rule set.
  await chip.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Comes from…' }).click()
  await expect(comesFromPopover(page).locator('[data-line-name]').first()).toBeFocused()
  await expect(comesFromPopover(page).getByTestId('sources-rule-chip')).toHaveAttribute('data-preset', 'byproducts-first')
  await page.keyboard.press('Escape')
  await expect(comesFromPopover(page)).toHaveCount(0)
  await chip.click()
  await expect(picker(page)).toBeVisible()
})

test('the marker is on the Ingredients slot, the collapsed line, the areas matrix and the block graph', async ({ page }, testInfo) => {
  // Oxygen is received from another block and has no rule yet.
  await open(page, markerPlan(testInfo.outputPath('marker-plan.json'), {}, true))
  const summary = page.locator('[data-testid="summary-pane"], [data-testid="summary-line"]')
  const ingredients = pane(page, 'Ingredients')
  const lineChip = ingredients.locator(`[data-testid="summary-line-chip"][data-item-id="${OXYGEN}"]`)
  const matrix = page.getByRole('table', { name: 'Areas of Acid' })
  const matrixHeader = matrix.locator(`tr[data-item-id="${OXYGEN}"] th[scope="row"]`)
  const edgeSummary = page.getByTestId('graph-edge-summary')
  const edgeChip = page.getByTestId('graph-detail').getByTestId('graph-edge-label')
  const openMatrix = () => openAreas(page)
  // The overview opens in the view used last, so the graph is chosen explicitly.
  const openGraph = async () => {
    await page.getByRole('button', { name: 'Factory overview' }).click()
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Graph' }).click()
  }
  const close = () => page.getByRole('button', { name: 'Close' }).click()

  // The default: no marker on any of the surfaces.
  await expect(oxygenSlot(page)).toBeVisible()
  await expect(oxygenSlot(page)).not.toHaveAccessibleName(/has a source rule/)
  await expect(markers(page)).toHaveCount(0)
  await openMatrix()
  await expect(matrixHeader).toBeVisible()
  await expect(markers(page)).toHaveCount(0)
  await close()
  await openGraph()
  await expect(edgeSummary).toHaveCount(1)
  await expect(markers(page)).toHaveCount(0)
  await close()

  // Receive it first, with a connection, has an effect. The slot shows the marker while it is selected...
  await oxygenSlot(page).click()
  const rules = await openRules(page)
  await setPreset(rules, 'connections-first')
  await expect(comesFrom(page).getByTestId('no-effect')).toHaveCount(0)
  await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(markers(oxygenSlot(page))).toHaveCount(1)
  await expect(oxygenSlot(page)).toHaveAccessibleName(/^Oxygen, .*, has a source rule$/)
  // The strip says the rule with an icon named as the marker's first line.
  await expect(comesFrom(page).locator('[data-testid="strip-rule-icon"][data-rule="connections-first"]')).toHaveAccessibleName('Receive it first')
  const ruleName = 'Receive it first'
  // ...and when it is not. It is the only marker of the summary: no other slot, and none in Products or Byproducts.
  await closeRules(page)
  await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'false')
  const slotMarker = markers(oxygenSlot(page))
  await expect(slotMarker).toHaveCount(1)
  await expect(markers(summary)).toHaveCount(1)
  // The slot's name says it, so the marker inside is not announced a second time; its tooltip is the rule's name, then (once the
  // pointer is over it) what supplies the item, once the solve with the rule has landed (O2 maker then offers what Acid asks for).
  await expect(slotMarker).toHaveAttribute('aria-label', 'Receive it first')
  await slotMarker.hover()
  await expect(slotMarker).toHaveAttribute('aria-label', /^Receive it first\n(.*\n)*From O2 maker: /)
  await expect(oxygenSlot(page).getByRole('img')).toHaveCount(0)
  // The 6px dot is inside the slot, in its top-right corner, and a click on it is a click on the slot.
  const slotBox = (await oxygenSlot(page).boundingBox())!
  const dot = (await slotMarker.locator('span').boundingBox())!
  expect(Math.round(dot.width)).toBe(6)
  expect(dot.x + dot.width).toBeLessThanOrEqual(slotBox.x + slotBox.width)
  expect(dot.y).toBeGreaterThanOrEqual(slotBox.y)
  expect(slotBox.x + slotBox.width - (dot.x + dot.width)).toBeLessThanOrEqual(4)
  expect(dot.y - slotBox.y).toBeLessThanOrEqual(4)
  await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2)
  await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'true')

  // Import off as well: the locked slot keeps its status badge, with the marker after it in the corner.
  await importSwitch(await openRules(page)).click()
  await closeRules(page)
  await expect(oxygenSlot(page)).toHaveAttribute('data-status', 'locked')
  await expect(oxygenSlot(page)).toHaveAccessibleName(/^Oxygen, .*, locked, has a source rule$/)
  const badge = (await oxygenSlot(page).getByText('⊘').boundingBox())!
  const lockedDot = (await markers(oxygenSlot(page)).locator('span').boundingBox())!
  expect(badge.x + badge.width, 'the badge ends before the dot starts').toBeLessThanOrEqual(lockedDot.x + 0.5)
  await oxygenSlot(page).click()
  await importSwitch(await openRules(page)).click()
  await closeRules(page)
  await expect(oxygenSlot(page)).not.toHaveAttribute('data-status', 'locked')

  // The areas matrix of the block: on the row header of oxygen, and of no other item.
  await openMatrix()
  await expect(markers(matrix)).toHaveCount(1)
  await expect(markers(matrixHeader)).toHaveAccessibleName(ruleName)
  await expect(markers(matrixHeader)).toHaveAttribute('aria-label', ruleName)
  // Every block side by side has none: a rule belongs to one block.
  await pickAreasBlock(page, 'All blocks')
  await expect(markers(page.getByTestId('modal-panel'))).toHaveCount(0)
  await pickAreasBlock(page, /^Acid/)
  // Acid is the active block, and the marker still only shows the rule: a click on it leaves the matrix open.
  await expect(markers(matrixHeader)).toHaveRole('img')
  await markers(matrixHeader).click({ force: true })
  await expect(matrix).toBeVisible()
  await close()

  // The block graph: on the edge chip of the oxygen connection into Acid, with the same rule name.
  // The summary chip of the edge shows the rule as a decorative dot; the chip of the connection, in the edge's list, the marker.
  await openGraph()
  await expect(markers(edgeSummary)).toHaveCount(1)
  await expect(markers(page.getByTestId('modal-panel'))).toHaveCount(1)
  await pinEdge(page, { to: 'Acid' })
  await expect(markers(page.getByTestId('modal-panel'))).toHaveCount(2)
  await expect(markers(edgeChip)).toHaveAccessibleName(ruleName)
  const chipBox = (await edgeChip.boundingBox())!
  const chipDot = (await markers(edgeChip).locator('span').boundingBox())!
  expect(chipDot.y, 'inside the chip').toBeGreaterThanOrEqual(chipBox.y)
  await expect(markers(edgeChip)).toHaveRole('img')
  await close()

  // From O2 maker, which holds no rule, the same chip shows Acid's rule too.
  await openGraph()
  await page.getByTestId('graph-node').filter({ has: page.getByRole('button', { name: 'O2 maker', exact: true }) }).getByTestId('graph-node-open').click()
  await expect(page.getByRole('heading', { name: 'Factory overview' })).toHaveCount(0)
  await expect(markers(summary)).toHaveCount(0)
  await openGraph()
  await pinEdge(page, { to: 'Acid' })
  await expect(markers(edgeChip)).toHaveAccessibleName(ruleName)
  await expect(markers(edgeChip)).toHaveRole('img')
  await page.getByTestId('graph-node').filter({ has: page.getByRole('button', { name: 'Acid', exact: true }) }).getByTestId('graph-node-open').click()
  await expect(oxygenSlot(page)).toBeVisible()

  // The collapsed line: on the chip of oxygen only, as an image beside the chip; it expands nothing.
  await page.getByRole('button', { name: 'Collapse summary' }).click()
  await expect(lineChip).toBeVisible()
  await expect(markers(summary)).toHaveCount(1)
  const lineMarker = markers(ingredients)
  await expect(lineMarker).toHaveAccessibleName(ruleName)
  const lineChipBox = (await lineChip.boundingBox())!
  const lineDot = (await lineMarker.locator('span').boundingBox())!
  expect(Math.abs(lineDot.x + lineDot.width - (lineChipBox.x + lineChipBox.width))).toBeLessThanOrEqual(1)
  expect(Math.abs(lineDot.y - lineChipBox.y)).toBeLessThanOrEqual(1)
  // The line clips what overflows it: the dot is the topmost element at its own centre.
  const centre = { x: lineDot.x + lineDot.width / 2, y: lineDot.y + lineDot.height / 2 }
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid]')?.getAttribute('data-testid'), centre)).toBe('source-rule-marker')
  await expect(lineMarker).toHaveRole('img')
  await lineMarker.click()
  await expect(page.getByTestId('summary-line')).toBeVisible()
  // The summary expands by its own button, and the slot is selected to take the rule off.
  await page.getByRole('button', { name: 'Expand summary' }).first().click()
  await expect(page.getByTestId('summary-line')).toHaveCount(0)
  await oxygenSlot(page).click()

  // Back to the default: the marker goes from every surface.
  await setPreset(await openRules(page), 'own')
  await expect(markers(page)).toHaveCount(0)
  await openMatrix()
  await expect(matrixHeader).toBeVisible()
  await expect(markers(page)).toHaveCount(0)
  await close()
  await openGraph()
  await expect(edgeSummary).toHaveCount(1)
  await expect(markers(page)).toHaveCount(0)
})
