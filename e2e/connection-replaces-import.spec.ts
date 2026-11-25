import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'
import { inputLines, selectRow } from './support/sidePanel'

/**
 * With the default rule a connection replaces an import: a block does not import an intermediate while one of its
 * connections could cover the need, whichever of the two items the connection is on (case 22 of spec/test-synthetic.md).
 * Before this rule, whether the connection delivered depended on the recipe ratio.
 *
 * `connection-replaces-import.json` is case 22 A row b on Nullius: the block "Valves" makes 30 one-way valves per
 * minute. Each needs a pipe, and 1 iron rod makes 3 pipes (one pipe per rod would have delivered before, three per rod
 * did not). The rod row is pinned at 1 execution per minute, so the block has 5 rods, which make 15 pipes. The
 * connection from "Pipes" gives the other 15 and the block imports no rod.
 *
 * `connection-replaces-import-mirror.json` is row g, the mirror: the block "Gears" makes 30 gears per minute from
 * plates, and 4 iron ingots make 3 plates. The ingot row is pinned at 5 executions per minute (10 ingots) and the
 * connection from "Ingots" is on the ingot, the item upstream of the plate. The connection delivers 30 ingots and the
 * block imports no plate. (The gear recipe also needs rods, which no row of the block makes: they are a raw input, 15 per
 * minute, and have nothing to do with the check.)
 */
const FIXTURE = path.resolve('e2e/fixtures/connection-replaces-import.json')
const MIRROR = path.resolve('e2e/fixtures/connection-replaces-import-mirror.json')

const sourceSegment = (page: Page) => detail(page, 'Ingredients').locator('[data-testid="summary-segment"][data-kind="source"]')
const kindSegments = (page: Page, kind: string) => detail(page, 'Ingredients').locator(`[data-testid="summary-segment"][data-kind="${kind}"]`)

async function setup(page: Page, fixture: string, firstSlot: string) {
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(slot(page, 'Ingredients', firstSlot)).toBeVisible({ timeout: 10000 })
}

/** Select the row of a recipe, which opens its panel. */
async function selectRecipe(page: Page, recipeTitle: string) {
  const row = page.locator('main table tbody tr').filter({ has: page.locator(`[data-testid="recipe-name"][data-tip="${recipeTitle}"]`) }).first()
  await selectRow(page, row)
}

test.describe('a connection replaces an import', () => {
  test('row b: the connection delivers what the rods cannot make and no rod is imported', async ({ page }) => {
    await setup(page, FIXTURE, 'Pipe 1')

    // The pipe slot is received, not imported: the connection's segment carries the 15 pipes the block lacks.
    await selectSlot(page, 'Ingredients', 'Pipe 1')
    await expect(sourceSegment(page)).toContainText('Pipes')
    await expect(sourceSegment(page).getByTestId('summary-segment-tip')).toContainText('15.0')
    await expect(kindSegments(page, 'import')).toHaveCount(0)
    // The flow is used: it is not the "unused" segment, and it is not capped.
    await expect(kindSegments(page, 'unused')).toHaveCount(0)
    await expect(sourceSegment(page)).not.toHaveAttribute('data-limited', 'true')

    // The rod, the item before the ratio decided, is not imported: it has no slot (the rows make all of it).
    await expect(slot(page, 'Ingredients', 'Iron rod')).toHaveCount(0)
    // The sheet has no row in the block: it is a raw input, as before.
    await expect(slot(page, 'Ingredients', 'Iron sheet')).toBeVisible()

    // The row panel's lines name the row and the connection that deliver the pipes, and no import.
    await selectRecipe(page, 'One-way valve 1')
    await expect(inputLines(page, 'pipe', 'make-here')).toHaveCount(1)
    await expect(inputLines(page, 'pipe', 'make-here').getByTestId('input-line-label')).toHaveText('Pipe 1 (iron)')
    await expect(inputLines(page, 'pipe', 'make-here')).toContainText('1 × Foundry 3')
    await expect(inputLines(page, 'pipe', 'block')).toHaveCount(1)
    await expect(inputLines(page, 'pipe', 'block').getByTestId('input-line-label')).toHaveText('Pipes')
    await expect(inputLines(page, 'pipe', 'block').getByTestId('input-line-rate')).toHaveText('15.0')
    await expect(inputLines(page, 'pipe', 'import')).toHaveCount(0)
  })

  test('row g, the mirror: the connection on the ingot delivers and no plate is imported', async ({ page }) => {
    await setup(page, MIRROR, 'Iron ingot')

    await selectSlot(page, 'Ingredients', 'Iron ingot')
    await expect(sourceSegment(page)).toContainText('Ingots')
    await expect(sourceSegment(page).getByTestId('summary-segment-tip')).toContainText('30.0')
    await expect(kindSegments(page, 'unused')).toHaveCount(0)
    await expect(slot(page, 'Ingredients', 'Iron plate')).toHaveCount(0)

    await selectRecipe(page, 'Iron plate')
    await expect(inputLines(page, 'nullius-iron-ingot', 'make-here').getByTestId('input-line-label')).toHaveText('Iron ingot 1')
    await expect(inputLines(page, 'nullius-iron-ingot', 'make-here')).toContainText('1 × Medium furnace 3')
    await expect(inputLines(page, 'nullius-iron-ingot', 'block').getByTestId('input-line-label')).toHaveText('Ingots')
    await expect(inputLines(page, 'nullius-iron-ingot', 'block').getByTestId('input-line-rate')).toHaveText('30.0')
  })
})
