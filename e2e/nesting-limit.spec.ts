import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { openRowMenu } from './support/rowMenu'
import { sidePanel } from './support/sidePanel'

/**
 * Groups in the production table: the chevron collapses and expands a group, a group row opens the group panel
 * whose buttons select what is inside, and the 4-level nesting limit disables the actions that would go past it.
 *
 * The plan is built here: a chain G1 > G2 > G3 > G4 of organising groups (G4 holds one recipe row), a separate
 * area "Area A" holding a separate area "Area B", and a small group "Loose" with one row.
 */
const NESTING_TITLE = 'Cannot nest deeper than 4 levels'

const id = (kind: string, n: number) => `cccc${String(kind.charCodeAt(0)).padStart(4, '0')}-0000-0000-0000-${String(n).padStart(12, '0')}`
const STAMP = '2026-05-10T00:00:00.000Z'

interface Node { kind: string; id: string; recipeId?: string; subPlanId?: string; modules?: unknown[]; byproductPolicy?: object }
interface Plan { id: string; name: string; nodes: Node[]; subPlans: Plan[]; area?: boolean; createdAt: string; updatedAt: string }

const recipe = (n: number, recipeId: string): Node => ({ kind: 'game-recipe', id: id('r', n), recipeId, modules: [], byproductPolicy: {} })
const handle = (n: number, subPlanId: string): Node => ({ kind: 'subplan', id: id('h', n), subPlanId })
const plan = (n: number, name: string, nodes: Node[], subPlans: Plan[] = [], area = false): Plan => ({
  id: id('p', n), name, nodes, subPlans, ...(area ? { area } : {}), createdAt: STAMP, updatedAt: STAMP,
})

const R_ROOT = id('r', 1)
const R_DEEP = id('r', 2)

function buildPlan() {
  const g4 = plan(4, 'G4', [recipe(2, 'nullius-compressed-hydrogen')])
  const g3 = plan(3, 'G3', [handle(3, g4.id)], [g4])
  const g2 = plan(2, 'G2', [handle(2, g3.id)], [g3])
  const g1 = plan(1, 'G1', [handle(1, g2.id)], [g2])
  const areaB = plan(8, 'Area B', [recipe(4, 'nullius-hydrogen-chloride')], [], true)
  const areaA = plan(7, 'Area A', [recipe(3, 'nullius-steam-electrolysis'), handle(7, areaB.id)], [areaB], true)
  const loose = plan(9, 'Loose', [recipe(5, 'nullius-hydrogen-chloride')])
  const root = plan(0, 'Main', [
    recipe(1, 'nullius-steam-electrolysis'),
    handle(4, g1.id),
    handle(5, areaA.id),
    handle(6, loose.id),
  ], [g1, areaA, loose])
  return {
    blocks: [{
      id: id('b', 1), name: 'Nesting', color: '#60a5fa',
      products: [{ id: id('q', 1), itemId: 'nullius-hydrogen', extraRate: 100 }],
      noImportItems: [], inputConnections: [], rootPlan: root,
    }],
    activeBlockId: id('b', 1),
  }
}

// The chevron's accessible name is "Expand <name>" or "Collapse <name>"; match the two exact strings, never a pattern built from the name.
const chevron = (page: Page, name: string) => page.getByRole('button', { name: `Expand ${name}`, exact: true }).or(page.getByRole('button', { name: `Collapse ${name}`, exact: true }))
const group = (page: Page, name: string) => page.locator('main table tbody tr').filter({ has: chevron(page, name) })
const rowOf = (page: Page, nodeId: string) => page.locator(`main tr[data-node-id="${nodeId}"]`)

async function expandChain(page: Page) {
  // Expansion state is React state (not persisted), so every test starts collapsed; still, only click what is collapsed.
  for (const name of ['G1', 'G2', 'G3', 'G4']) {
    const button = chevron(page, name)
    await expect(button).toBeVisible()
    if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
  }
  await expect(rowOf(page, R_DEEP)).toBeVisible()
}

interface PlanTree { id: string; name: string; nodes: { id: string }[]; subPlans: PlanTree[] }
async function savedPlan(page: Page, name: string): Promise<PlanTree> {
  const saved = (await readActivePlan(page, 'nullius')) as { blocks: { rootPlan: PlanTree }[] }
  const find = (p: PlanTree): PlanTree | undefined => p.name === name ? p : p.subPlans.map(find).find(Boolean)
  return find(saved.blocks[0].rootPlan)!
}

test.beforeEach(async ({ page }, testInfo) => {
  const fixture = testInfo.outputPath('plan.json')
  fs.mkdirSync(path.dirname(fixture), { recursive: true })
  fs.writeFileSync(fixture, JSON.stringify(buildPlan()))
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(rowOf(page, R_ROOT)).toBeVisible({ timeout: 10000 })
})

test('the chevron collapses and expands a group, hiding everything below it', async ({ page }) => {
  await expect(chevron(page, 'G1')).toHaveAttribute('aria-expanded', 'false')
  await expect(rowOf(page, R_DEEP)).toHaveCount(0)

  await expandChain(page)
  await expect(chevron(page, 'G4')).toHaveAttribute('aria-expanded', 'true')
  // The chevron does not select the group.
  await expect(sidePanel(page)).toHaveCount(0)
  // One guide per ancestor level, up to the limit.
  await expect(rowOf(page, R_DEEP).locator('td[data-guide-levels="4"]')).toBeVisible()

  // Collapsing G2 hides G3, G4 and the row; G1 stays open.
  await chevron(page, 'G2').click()
  await expect(chevron(page, 'G2')).toHaveAttribute('aria-expanded', 'false')
  await expect(rowOf(page, R_DEEP)).toHaveCount(0)
  await expect(chevron(page, 'G3')).toHaveCount(0)
  await expect(chevron(page, 'G1')).toHaveAttribute('aria-expanded', 'true')

  // Expanding it again finds G3 and G4 as they were left (open).
  await chevron(page, 'G2').click()
  await expect(rowOf(page, R_DEEP)).toBeVisible()
})

test('a group row opens the group panel, whose buttons select what is inside', async ({ page }) => {
  await chevron(page, 'G1').click()
  await group(page, 'G1').getByTestId('group-summary').click()
  const panel = sidePanel(page)
  await expect(panel.getByTestId('panel-title')).toHaveText('G1')
  await expect(panel).toContainText('Sub-factory · level 1 of 4')
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Summary', 'Inside this group'])
  await expect(group(page, 'G1')).toHaveAttribute('data-selected', 'true')

  await panel.getByTestId('group-child').click()
  await expect(panel.getByTestId('panel-title')).toHaveText('G2')
  await expect(panel).toContainText('Sub-factory · level 2 of 4')

  await panel.getByRole('button', { name: 'Close panel' }).click()
  await expect(sidePanel(page)).toHaveCount(0)
})

test('actions that would nest past 4 levels are disabled with the reason', async ({ page }) => {
  await expandChain(page)

  // A row four levels deep cannot be wrapped in another group; a root row can.
  const deepMenu = await openRowMenu(page, rowOf(page, R_DEEP))
  const wrapDeep = deepMenu.getByRole('menuitem', { name: 'Wrap in subfactory…' })
  await expect(wrapDeep).toBeDisabled()
  await expect(wrapDeep).toHaveAttribute('title', NESTING_TITLE)
  await page.keyboard.press('Escape')

  const rootMenu = await openRowMenu(page, rowOf(page, R_ROOT))
  await expect(rootMenu.getByRole('menuitem', { name: 'Wrap in subfactory…' })).toBeEnabled()
  await page.keyboard.press('Escape')

  // G2 (it and the two groups under it span 3 levels) fits in Area A (1 level down) but not in Area B (2 levels down).
  const menu = await openRowMenu(page, group(page, 'G2'))
  await menu.getByRole('menuitem', { name: 'Duplicate to…' }).click()
  const areaA = page.getByRole('menuitem', { name: 'Area A', exact: true })
  const areaB = page.getByRole('menuitem', { name: 'Area B', exact: true })
  await expect(areaA).toBeEnabled()
  await expect(areaB).toBeDisabled()
  await expect(areaB).toHaveAttribute('title', NESTING_TITLE)
})

test('dropping a group onto a group that is too deep does nothing', async ({ page }) => {
  await expandChain(page)
  const dragRow = group(page, 'Loose')

  async function drag(target: ReturnType<typeof group>, half: 'top' | 'bottom') {
    const from = (await dragRow.boundingBox())!
    const to = (await target.boundingBox())!
    await page.mouse.move(from.x + 60, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 70, from.y + from.height / 2 + 12, { steps: 4 })
    const y = to.y + (half === 'top' ? 4 : to.height - 4)
    // Chromium only fires dragover on the move after dragenter, hence the nudge.
    await page.mouse.move(to.x + 150, y, { steps: 6 })
    await page.mouse.move(to.x + 151, y)
    // The dragged row is dimmed from dragstart to dragend, and the drop handler runs before dragend:
    // once the dimming is gone the drop has been handled and whatever it wrote is already saved.
    await expect(dragRow).toHaveClass(/opacity-50/)
    await page.mouse.up()
    await expect(dragRow).not.toHaveClass(/opacity-50/)
  }

  // G4 sits four levels down: a group (which brings its own row one level lower) does not fit in it.
  await drag(group(page, 'G4'), 'bottom')
  expect((await savedPlan(page, 'G4')).nodes).toHaveLength(1)
  expect((await savedPlan(page, 'Loose')).nodes).toHaveLength(1)
  expect((await savedPlan(page, 'Main')).nodes.map(n => n.id)).toContain(id('h', 6))
  await expect(group(page, 'Loose')).toBeVisible()

  // G3 is one level up, so it takes the group: the Loose handle moves out of Main into G3, after G4's handle.
  await drag(group(page, 'G3'), 'bottom')
  await expect.poll(async () => (await savedPlan(page, 'G3')).nodes.map(n => n.id)).toEqual([id('h', 3), id('h', 6)])
  expect((await savedPlan(page, 'Main')).nodes.map(n => n.id)).not.toContain(id('h', 6))
  expect((await savedPlan(page, 'Loose')).nodes).toHaveLength(1)
})
