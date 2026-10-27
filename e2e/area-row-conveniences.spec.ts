import { test, expect, type Locator, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { clickRowAction, openRowMenu } from './support/rowMenu'

/**
 * Row conveniences in a block with areas. The fixture builds steam electrolysis in the root and in
 * the "Compression" area; "Chlorides" is a second area that uses hydrogen and has no electrolysis.
 */
const FIXTURE = path.resolve('e2e/fixtures/area-row-conveniences.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'
const COMP_ELEC = 'ffff0011-0000-0000-0000-000000000001'
const COMP_ROW = 'ffff0011-0000-0000-0000-000000000002'
const CHLORIDE_ROW = 'ffff0021-0000-0000-0000-000000000001'

const row = (page: Page, id: string) => page.locator(`main tr[data-node-id="${id}"]`)
const group = (page: Page, name: string) => page.locator('main table tbody tr').filter({ hasText: name })

interface PlanNode { kind: string; recipeId?: string; machineId?: string }
interface PlanTree { nodes: PlanNode[]; subPlans: PlanTree[] }

function electrolysisNodes(plan: unknown): PlanNode[] {
  const walk = (p: PlanTree): PlanNode[] => [
    ...p.nodes.filter(n => n.recipeId === 'nullius-steam-electrolysis'),
    ...p.subPlans.flatMap(walk),
  ]
  return walk((plan as { blocks: { rootPlan: PlanTree }[] }).blocks[0].rootPlan)
}

async function open(page: Page): Promise<void> {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page, ROOT_ELEC)).toBeVisible({ timeout: 10000 })
}

async function pickerSlot(page: Page, from: Locator): Promise<Locator> {
  await from.locator('[title^="Hydrogen — Find producer recipe"]').click()
  await page.getByPlaceholder('Search…').fill('Steam electrolysis')
  return page.locator('[data-testid="recipe-slot"][data-recipe-id="nullius-steam-electrolysis"]')
}

test('the badge, chips, primary-product tooltip and Go to row in… help to read a block with areas', async ({ page }) => {
  await open(page)

  const badge = row(page, ROOT_ELEC).getByTestId('multi-area-badge')
  await expect(badge).toHaveText('2')
  await expect(badge).toHaveAttribute(
    'title',
    /^Steam electrolysis: \d+ buildings? \([\d.]+ exact\) in 2 areas: \d+ here, \d+ Compression$/,
  )

  await expect(
    group(page, 'Compression').getByTestId('area-chips')
      .locator('[data-item-id="nullius-compressed-hydrogen"][data-direction="sends"]'),
  ).toHaveCount(1)
  await expect(
    group(page, 'Chlorides').getByTestId('area-chips')
      .locator('[data-item-id="nullius-hydrogen"][data-direction="receives"]'),
  ).toHaveCount(1)

  await expect(row(page, ROOT_ELEC).locator('[title^="Oxygen — Set as primary"]'))
    .toHaveAttribute('title', /decides what this row builds for its area/)

  const menu = await openRowMenu(page, row(page, ROOT_ELEC))
  await menu.getByRole('menuitem', { name: 'Go to row in…' }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: /^Compression · / }).click()

  await expect(row(page, COMP_ELEC)).toBeVisible()
  await expect(row(page, COMP_ELEC)).toHaveAttribute('data-highlighted', 'true')
  await expect(group(page, 'Compression').getByTestId('area-chips')).toHaveCount(0)
})

test('Build also in… copies the row to an area and Apply to every row sets its machine everywhere', async ({ page }) => {
  await open(page)

  const menu = await openRowMenu(page, row(page, ROOT_ELEC))
  await menu.getByRole('menuitem', { name: 'Build also in…' }).click()
  await page.getByRole('menu').getByRole('menuitem', { name: /^Chlorides · uses / }).click()

  await expect(row(page, ROOT_ELEC).getByTestId('multi-area-badge')).toHaveText('3')
  await expect(page.locator('tr[data-highlighted="true"]').getByTestId('multi-area-badge')).toHaveText('3')
  await expect.poll(async () => {
    const plan = await readActivePlan(page, 'nullius') as { blocks: { rootPlan: PlanTree }[] }
    return plan.blocks[0].rootPlan.subPlans[1].nodes.map(n => n.recipeId)
  }).toEqual(['nullius-hydrogen-chloride', 'nullius-steam-electrolysis'])

  // Every area has the recipe now.
  const again = await openRowMenu(page, row(page, ROOT_ELEC))
  await expect(again.getByRole('menuitem', { name: 'Build also in…' })).toBeDisabled()
  await page.keyboard.press('Escape')

  await row(page, ROOT_ELEC).locator('td').nth(2).locator('button').first().click()
  await expect(page.getByRole('heading', { name: 'Edit machine' })).toBeVisible()
  await page.getByText(/machines$/).click()
  await page.locator('[data-testid="machine-option"][data-machine-id="nullius-surge-electrolyzer-1"]').click()
  await page.getByRole('button', { name: 'Apply to every row of this recipe (3)' }).click()
  await page.getByRole('button', { name: 'Close' }).last().click()

  await expect.poll(async () => electrolysisNodes(await readActivePlan(page, 'nullius')).map(n => n.machineId))
    .toEqual(Array(3).fill('nullius-surge-electrolyzer-1'))
})

test('the recipe picker greys out a recipe the target area already has', async ({ page }) => {
  await open(page)

  await group(page, 'Compression').getByText('Compression').click()
  const inCompression = await pickerSlot(page, row(page, COMP_ROW))
  await expect(inCompression).toBeDisabled()
  await expect(inCompression).toHaveAttribute('data-in-area', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByPlaceholder('Search…')).toHaveCount(0)

  await group(page, 'Chlorides').getByText('Chlorides').click()
  await expect(await pickerSlot(page, row(page, CHLORIDE_ROW))).toBeEnabled()
})

const COMP_HANDLE = 'ffff0005-0000-0000-0000-000000000001'

interface CopyPlan { name: string; area?: boolean; nodes: { id: string; kind: string; recipeId?: string; subPlanId?: string }[]; subPlans: CopyPlan[] }

test('Duplicate to… copies an area into another area', async ({ page }) => {
  await open(page)

  const menu = await openRowMenu(page, row(page, COMP_HANDLE))
  await menu.getByRole('menuitem', { name: 'Duplicate to…' }).click()
  const items = page.getByRole('menu').getByRole('menuitem')
  await expect(items).toHaveText(['Top level', 'Compression', 'Chlorides'])
  await expect(items.nth(1)).toBeDisabled()
  await expect(items.nth(1)).toHaveAttribute('title', 'Cannot copy a subfactory into itself')
  await items.nth(2).click()

  const revealed = page.locator('tr[data-highlighted="true"]')
  await expect(revealed).toContainText('Compression (copy)')
  await expect(revealed.getByTestId('area-marker')).toBeVisible()
  await expect.poll(async () => {
    const plan = await readActivePlan(page, 'nullius') as { blocks: { rootPlan: CopyPlan }[] }
    const chlorides = plan.blocks[0].rootPlan.subPlans[1]
    const copy = chlorides.subPlans[0]
    return {
      kinds: chlorides.nodes.map(n => n.kind),
      name: copy?.name,
      area: copy?.area,
      recipes: copy?.nodes.map(n => n.recipeId),
      fresh: copy?.nodes.every(n => n.id !== COMP_ELEC && n.id !== COMP_ROW),
    }
  }).toEqual({
    kinds: ['game-recipe', 'subplan'],
    name: 'Compression (copy)',
    area: true,
    recipes: ['nullius-steam-electrolysis', 'nullius-compressed-hydrogen'],
    fresh: true,
  })
  await expect(row(page, ROOT_ELEC).getByTestId('multi-area-badge')).toHaveText('3')
})

test('Duplicate to… disables an area that already has a row of the recipe', async ({ page }) => {
  await open(page)

  await group(page, 'Compression').getByText('Compression').click()
  page.once('dialog', d => void d.accept('Packing'))
  await clickRowAction(page, row(page, COMP_ROW), 'Wrap in subfactory…')
  await expect(group(page, 'Packing')).toBeVisible()

  const menu = await openRowMenu(page, group(page, 'Packing'))
  await menu.getByRole('menuitem', { name: 'Duplicate to…' }).click()
  const compression = page.getByRole('menu').getByRole('menuitem', { name: 'Compression' })
  await expect(compression).toBeDisabled()
  await expect(compression).toHaveAttribute('title', 'Already has a row of Compressed hydrogen')
  await page.getByRole('menu').getByRole('menuitem', { name: 'Top level' }).click()

  await expect.poll(async () => {
    const plan = await readActivePlan(page, 'nullius') as { blocks: { rootPlan: CopyPlan }[] }
    const root = plan.blocks[0].rootPlan
    const copy = root.subPlans.find(sp => sp.name === 'Packing (copy)')
    return {
      lastKind: root.nodes.at(-1)?.kind,
      area: copy && 'area' in copy,
      recipes: copy?.nodes.map(n => n.recipeId),
    }
  }).toEqual({ lastKind: 'subplan', area: false, recipes: ['nullius-compressed-hydrogen'] })
})
