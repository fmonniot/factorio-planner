import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { sidePanel, selectRow, openMachinePicker } from './support/sidePanel'

/**
 * Selection and the side panel: a click on a row (or on its recipe button) selects it and opens the panel; the
 * panel exists only while a row is selected; it edits the machine and the pinned rate; a group row shows the
 * read-only group panel. The fixture has a recipe row in the root and two separate areas.
 */
const FIXTURE = path.resolve('e2e/fixtures/area-row-conveniences.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'

const row = (page: Page, id: string) => page.locator(`main tr[data-node-id="${id}"]`)
const group = (page: Page, name: string) => page.locator('main table tbody tr').filter({ hasText: name })

interface PlanNode { recipeId?: string; machineId?: string; pinnedRate?: number }
interface PlanTree { nodes: PlanNode[]; subPlans: PlanTree[] }

function rootNode(plan: unknown): PlanNode {
  return (plan as { blocks: { rootPlan: PlanTree }[] }).blocks[0].rootPlan.nodes[0]
}

test.beforeEach(async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page, ROOT_ELEC)).toBeVisible({ timeout: 10000 })
})

test('clicking a row opens the panel, the close button clears the selection', async ({ page }) => {
  const elec = row(page, ROOT_ELEC)
  await expect(sidePanel(page)).toHaveCount(0)
  const before = await elec.boundingBox()

  // Anywhere on the row that is not a button or a field: the Power cell.
  await elec.locator('td').last().click()
  const panel = sidePanel(page)
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('panel-title')).toHaveText('Steam electrolysis')
  await expect(elec).toHaveAttribute('data-selected', 'true')
  // The six sections, in order.
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText([
    'Rate', 'Machine', 'Beacons', 'Effects on this row', 'Where inputs come from',
  ])
  // The rows do not move vertically when the panel opens.
  expect((await elec.boundingBox())!.y).toBe(before!.y)

  await panel.getByRole('button', { name: 'Close panel' }).click()
  await expect(sidePanel(page)).toHaveCount(0)
  await expect(elec).not.toHaveAttribute('data-selected', 'true')

  // The recipe icon and name is a button: the keyboard path to the same panel.
  await elec.getByRole('button', { name: /Steam electrolysis/ }).click()
  await expect(sidePanel(page)).toBeVisible()
})

test('a click on a control inside the row does not select it', async ({ page }) => {
  await row(page, ROOT_ELEC).getByRole('button', { name: 'Move down' }).click()
  await expect(sidePanel(page)).toHaveCount(0)
})

test('the panel changes the machine', async ({ page }) => {
  await selectRow(page, row(page, ROOT_ELEC))

  await openMachinePicker(page)
  await page.locator('[data-testid="machine-option"][data-machine-id="nullius-surge-electrolyzer-1"]').click()

  await expect.poll(async () => rootNode(await readActivePlan(page, 'nullius')).machineId).toBe('nullius-surge-electrolyzer-1')
  // The picker closes after a choice.
  await expect(page.getByTestId('machine-option')).toHaveCount(0)
})

test('the Rate section pins the rate, and unpinning removes the badge', async ({ page }) => {
  const elec = row(page, ROOT_ELEC)
  await elec.locator('td').last().click()
  const panel = sidePanel(page)

  await expect(elec.getByTestId('chip-pin')).toHaveCount(0)
  await panel.getByRole('checkbox', { name: 'Pin rate' }).check()
  await expect(elec.getByTestId('chip-pin')).toBeVisible()
  const input = panel.getByLabel('Pinned rate')
  await input.fill('60')
  await input.press('Tab')
  await expect.poll(async () => rootNode(await readActivePlan(page, 'nullius')).pinnedRate).toBeGreaterThan(0)
  await expect(panel.getByTestId('runs-per-min')).toContainText('runs/min')

  await panel.getByRole('checkbox', { name: 'Pin rate' }).uncheck()
  await expect(elec.getByTestId('chip-pin')).toHaveCount(0)
})

test('a separate area shows the group panel, whose rows select from its list', async ({ page }) => {
  const comp = group(page, 'Compression')
  // The chevron expands the group and does not select it.
  await comp.getByRole('button', { name: /^(Expand|Collapse) Compression$/ }).click()
  await expect(sidePanel(page)).toHaveCount(0)

  await comp.getByTestId('group-summary').click()
  const panel = sidePanel(page)
  await expect(panel.getByTestId('panel-title')).toHaveText('Compression')
  await expect(panel.getByTestId('panel-area-marker')).toBeVisible()
  await expect(panel.getByRole('heading', { level: 3 })).toContainText(['Summary', 'Receives', 'Sends', 'Inside this group'])
  await expect(comp).toHaveAttribute('data-selected', 'true')

  const children = panel.getByTestId('group-child')
  await expect(children).toHaveCount(2)
  await children.first().click()
  await expect(panel.getByTestId('panel-title')).toHaveText('Steam electrolysis')
  await expect(panel.getByRole('heading', { level: 3 }).first()).toHaveText('Rate')
})

test('removing the selected row closes the panel', async ({ page }) => {
  const elec = row(page, ROOT_ELEC)
  await elec.locator('td').last().click()
  await expect(sidePanel(page)).toBeVisible()
  await elec.locator('td').nth(1).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Remove recipe' }).click()
  await expect(row(page, ROOT_ELEC)).toHaveCount(0)
  await expect(sidePanel(page)).toHaveCount(0)
})
