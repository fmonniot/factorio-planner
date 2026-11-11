import { test, expect, type Locator, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, slot } from './support/summary'
import { changeSourcing, sidePanel } from './support/sidePanel'

const FIXTURE = path.resolve('e2e/fixtures/item-sourcing.json')
const OXYGEN = 'nullius-oxygen'

/**
 * The "Acid" block of the item-sourcing fixture (steam electrolysis with oxygen as its side output, nitric acid
 * synthesis that uses oxygen, oxygen decompression that makes it) with methanol as one more product, made from oxygen
 * by a row inside a sub-factory "Methanol line": oxygen is an ingredient of two rows, one of them nested. `itemSourcing`
 * is the block's stored presets. Written beside the test's output, so no fixture file joins the solver's golden snapshot.
 */
function markerPlan(outPath: string, itemSourcing: Record<string, string> = {}): string {
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
  fs.writeFileSync(outPath, JSON.stringify(plan))
  return outPath
}

const table = (page: Page) => page.locator('main table')
const rows = (page: Page) => table(page).locator('tbody tr')
/** The rows that use oxygen: nitric acid synthesis at the top level, methanol in the sub-factory. */
const userRows = (page: Page) => rows(page).filter({ has: page.locator('[data-variant="ingredient"][title^="Oxygen"]') })
const acidRow = (page: Page) => rows(page).filter({ has: page.locator('[title="Nitric acid"]') })
const methanolRow = (page: Page) => rows(page).filter({ has: page.locator('[title="Methanol"]') })
const markers = (scope: Page | Locator) => scope.getByTestId('source-rule-marker')
/** Every chip of oxygen in the table, whatever its column. */
const oxygenChips = (page: Page) => table(page).locator('[data-variant][title^="Oxygen"]')
const oxygenSlot = (page: Page) => slot(page, 'Ingredients', 'Oxygen')
/** The search box of the producer picker an ingredient chip opens. */
const picker = (page: Page) => page.getByPlaceholder('Search…')
const comesFrom = (page: Page) => detail(page, 'Ingredients').getByTestId('comes-from')

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
  const control = await changeSourcing(page, acidRow(page), OXYGEN)
  await control.locator('[data-sourcing-choice="connections-first"]').click()
  await expect(control.getByTestId('no-effect')).toContainText('No connection for Oxygen.')
  await expect(markers(table(page))).toHaveCount(0)

  // Only what's already made has an effect: one marker per ingredient chip, the row in the sub-factory included.
  await control.locator('[data-sourcing-choice="byproducts-first"]').click()
  await expect(markers(table(page))).toHaveCount(2)
  for (const row of await userRows(page).all()) {
    const frame = row.locator('[data-chip-frame]')
    await expect(frame).toHaveCount(1)
    await expect(frame.locator('[data-variant="ingredient"]')).toHaveAttribute('title', /^Oxygen — Find producer recipe — /)
    await expect(markers(frame)).toHaveAttribute('data-item-id', OXYGEN)
  }
  // No other chip of the table has one: not the oxygen the electrolysis and the decompression make, and no other item.
  await expect(table(page).locator('[data-chip-frame]')).toHaveCount(2)
  await expect(table(page).locator('[data-variant="product"] [data-testid="source-rule-marker"], [data-variant="byproduct"] [data-testid="source-rule-marker"]')).toHaveCount(0)

  // A grey dot with the item's sentence as its name and tooltip: no letter, none of the old badge.
  const marker = markers(acidRow(page))
  const sentence = (await control.getByTestId('sourcing-sentence').textContent())!
  expect(sentence).toContain('Uses what this block already makes first')
  await expect(marker).toHaveAccessibleName(sentence)
  await expect(marker).toHaveAttribute('title', sentence)
  await expect(marker).toHaveText('')
  await expect(page.getByTestId('item-tile-sourcing')).toHaveCount(0)
  await expect(page.locator('[data-sourcing]')).toHaveCount(0)
  await expect(table(page).locator('[title*="first)"]')).toHaveCount(0)

  // Back to the default: no rule, no marker.
  await control.locator('[data-sourcing-choice="own"]').click()
  await expect(markers(page)).toHaveCount(0)
})

test('a click on the marker opens the Ingredients slot of the item and leaves the chip and the row alone', async ({ page }, testInfo) => {
  await open(page, markerPlan(testInfo.outputPath('marker-plan.json'), { [OXYGEN]: 'byproducts-first' }))
  // The row inside the sub-factory.
  const row = methanolRow(page)
  const marker = markers(row)
  await expect(marker).toBeVisible()
  await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'false')

  // The dot is 6px in the top-right corner of the chip; what takes the click is larger and is the marker at the dot's centre.
  const chip = row.locator('[data-variant="ingredient"][title^="Oxygen"]')
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

  await page.mouse.click(centre.x, centre.y)
  await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(detail(page, 'Ingredients')).toHaveAttribute('data-state', 'selected')
  await expect(comesFrom(page).getByRole('radio', { name: "Only what's already made" })).toBeFocused()
  // Neither the chip's own click (the producer picker) nor the row's (the side panel) happened.
  await expect(picker(page)).toHaveCount(0)
  await expect(sidePanel(page)).toHaveCount(0)

  // The keyboard reaches it too: it is a button.
  await page.keyboard.press('Escape')
  await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'false')
  await marker.focus()
  await page.keyboard.press('Enter')
  await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(comesFrom(page).locator(':focus')).toHaveCount(1)
  await expect(picker(page)).toHaveCount(0)
  await expect(sidePanel(page)).toHaveCount(0)

  // The rest of the chip keeps its click: it opens the producer picker.
  await chip.click()
  await expect(picker(page)).toBeVisible()
})
