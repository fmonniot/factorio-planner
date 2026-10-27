import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'

/**
 * A plan saved when dragging a sub-factory's handle into another plan left the sub-factory stored
 * where it was. The fixture shows "Electrolysers" under the "Compression" area (its handle is
 * there) but stores it under Main, so the loader has to move it. Electrolysis is built in the
 * top level and in Electrolysers.
 */
const FIXTURE = path.resolve('e2e/fixtures/stranded-subplan.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'
const GROUP_ELEC = 'ffff0011-0000-0000-0000-000000000001'

const row = (page: Page, id: string) => page.locator(`main tr[data-node-id="${id}"]`)

test('a sub-factory shown under an area belongs to that area', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page, ROOT_ELEC)).toBeVisible({ timeout: 10000 })

  await page.getByRole('button', { name: 'By recipe' }).click()
  const line = page.locator('[data-testid="recipe-group"][data-recipe-id="nullius-steam-electrolysis"]')
  await line.getByRole('button', { name: /rows per area/ }).click()
  await expect(row(page, ROOT_ELEC).getByTestId('row-area')).toHaveText('Top level')
  await expect(row(page, GROUP_ELEC).getByTestId('row-area')).toHaveText('Compression')

  // Two rows of one recipe in one area would be a duplicate; in two areas they are not.
  await expect(page.getByText(/duplicate/i)).toHaveCount(0)
})

interface PlanTree { id: string; name: string; subPlans: PlanTree[] }

test('dragging a sub-factory into an area stores it under that area', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/area-row-conveniences.json'))
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page, ROOT_ELEC)).toBeVisible({ timeout: 10000 })

  const storedUnder = async (name: string): Promise<string | undefined> => {
    const plan = await readActivePlan(page, 'nullius') as { blocks: { rootPlan: PlanTree }[] }
    const find = (p: PlanTree, parent?: string): string | undefined =>
      p.name === name ? parent : p.subPlans.map(sp => find(sp, p.name)).find(x => x !== undefined)
    return find(plan.blocks[0].rootPlan)
  }
  expect(await storedUnder('Chlorides')).toBe('Main')

  // Drag the Chlorides group onto the collapsed Compression group, which appends into it.
  const groupRow = (name: string) => page.locator('main table tbody tr').filter({ hasText: name }).first()
  // Column widths and row heights keep settling for a moment after load; drag from boxes taken once they stop moving.
  const boxes = async () => JSON.stringify([await groupRow('Chlorides').boundingBox(), await groupRow('Compression').boundingBox()])
  let previous = ''
  await expect.poll(async () => {
    const current = await boxes()
    const stable = current === previous
    previous = current
    return stable
  }, { intervals: [300] }).toBe(true)
  const [from, to] = JSON.parse(previous) as { x: number; y: number; height: number }[]
  await page.mouse.move(from.x + 60, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + 70, from.y + from.height / 2 + 12, { steps: 4 })
  await page.mouse.move(to.x + 100, to.y + to.height / 2, { steps: 4 })
  await page.mouse.move(to.x + 101, to.y + to.height / 2)
  await page.mouse.up()

  await expect.poll(() => storedUnder('Chlorides')).toBe('Compression')
})
