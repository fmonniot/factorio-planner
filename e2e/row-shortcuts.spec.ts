import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { sidePanel } from './support/sidePanel'

/**
 * Pickers and chip shortcuts of the production table: the machine chip's picker, the fill-all pickers of the dashed
 * module and beacon chips, and the filled chips that open the side panel on a highlighted section. The fixture's root
 * row is rewritten to Hydrogen chloride, whose chemical plants have module slots (Steam electrolysis machines have none).
 */
const FIXTURE = path.resolve('e2e/fixtures/area-row-conveniences.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'

const row = (page: Page) => page.locator(`main tr[data-node-id="${ROOT_ELEC}"]`)

interface PlanNode {
  id?: string
  recipeId?: string
  machineId?: string
  modules?: { moduleId: string; count: number }[]
  beaconConfigs?: { beaconId?: string; modules: { moduleId: string; count: number }[]; beaconCount: number; modulesPerBeacon: number }[]
}
interface PlanTree { nodes: PlanNode[]; subPlans: PlanTree[] }

async function rootNode(page: Page): Promise<PlanNode> {
  const plan = await readActivePlan(page, 'nullius')
  return (plan as { blocks: { rootPlan: PlanTree }[] }).blocks[0].rootPlan.nodes[0]
}

test.beforeEach(async ({ page }, testInfo) => {
  const plan = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { blocks: { rootPlan: PlanTree }[] }
  plan.blocks[0].rootPlan.nodes[0].recipeId = 'nullius-hydrogen-chloride'
  const fixture = testInfo.outputPath('plan.json')
  fs.mkdirSync(path.dirname(fixture), { recursive: true })
  fs.writeFileSync(fixture, JSON.stringify(plan))
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page)).toBeVisible({ timeout: 10000 })
})

test('the machine chip opens a picker of icon, name and speed that changes the machine', async ({ page }) => {
  const chip = row(page).getByTestId('machine-chip')
  await chip.click()
  const picker = page.getByTestId('picker')
  await expect(picker).toBeVisible()
  await expect(picker.getByTestId('machine-option').first()).toContainText('speed')
  // The row is not selected by the chip: the picker is the shortcut.
  await expect(sidePanel(page)).toHaveCount(0)

  await picker.locator('[data-testid="machine-option"][data-machine-id="nullius-chemical-plant-2"]').click()
  await expect(page.getByTestId('picker')).toHaveCount(0)
  await expect.poll(async () => (await rootNode(page)).machineId).toBe('nullius-chemical-plant-2')
})

test('Esc and a click away close a picker, and nothing else reacts', async ({ page }) => {
  await row(page).getByTestId('recipe-name').click()
  await expect(sidePanel(page)).toBeVisible()

  await row(page).getByTestId('machine-chip').click()
  await expect(page.getByTestId('picker')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('picker')).toHaveCount(0)
  // The panel is still open: the Esc belonged to the picker.
  await expect(sidePanel(page)).toBeVisible()

  await row(page).getByTestId('machine-chip').click()
  await expect(page.getByTestId('picker')).toBeVisible()
  await sidePanel(page).getByTestId('panel-title').click()
  await expect(page.getByTestId('picker')).toHaveCount(0)
  expect((await rootNode(page)).machineId).toBeUndefined()
})

test('the empty module chip fills every slot with the chosen module', async ({ page }) => {
  const chip = row(page).getByTestId('module-chip')
  const slots = Number((await chip.getByText(/^0\/\d+$/).textContent())!.split('/')[1])
  expect(slots).toBeGreaterThan(0)

  await chip.click()
  const picker = page.getByTestId('picker')
  await expect(picker.getByTestId('picker-heading')).toContainText(`Fill all ${slots}`)
  const option = picker.getByTestId('module-fill-option').first()
  const moduleId = (await option.getAttribute('data-module-id'))!
  await option.click()

  await expect(page.getByTestId('picker')).toHaveCount(0)
  await expect.poll(async () => (await rootNode(page)).modules).toEqual([{ moduleId, count: slots }])
  await expect(chip).toContainText(`${slots}/${slots}`)
  // Selecting nothing but the chip: the panel did not open.
  await expect(sidePanel(page)).toHaveCount(0)
})

test('the empty beacon plus adds one beacon with the chosen module', async ({ page }) => {
  await row(page).getByLabel('Add beacon', { exact: true }).click()
  const picker = page.getByTestId('picker')
  await expect(picker.getByTestId('picker-heading')).toHaveText('Add 1 × Beacon, fill its slots with')
  const option = picker.getByTestId('module-fill-option').first()
  const moduleId = (await option.getAttribute('data-module-id'))!
  await option.click()

  await expect.poll(async () => (await rootNode(page)).beaconConfigs).toMatchObject([{ beaconCount: 1, modules: [{ moduleId }] }])
  await expect(row(page).getByTestId('beacon-count')).toHaveText('1')
  await expect(page.getByTestId('picker')).toHaveCount(0)
})

test('the empty beacon module chip fills a beacon that has none', async ({ page }) => {
  await row(page).getByLabel('Add beacon', { exact: true }).click()
  const first = page.getByTestId('module-fill-option').first()
  await first.click()
  // Empty the beacon's slots from the panel one by one, then fill them again from the chip.
  const chip = row(page).getByTestId('beacon-module-chip')
  const [, slotsText] = (await chip.textContent())!.match(/^(\d+)\/(\d+)$/)!.slice(1)
  const slots = Number(slotsText)
  await row(page).getByRole('button', { name: 'Edit beacon', exact: true }).click()
  const panel = sidePanel(page)
  const firstId = (await rootNode(page)).beaconConfigs![0].modules[0].moduleId
  expect((await rootNode(page)).beaconConfigs![0].modules).toEqual([{ moduleId: firstId, count: slots }])
  for (let left = slots - 1; left >= 0; left--) {
    await panel.getByTestId('beacon-module-slot').first().click()
    await page.getByTestId('beacon-module-option-empty').click()
    await expect.poll(async () => (await rootNode(page)).beaconConfigs![0].modules)
      .toEqual(left > 0 ? [{ moduleId: firstId, count: left }] : [])
  }

  await chip.click()
  const options = page.getByTestId('module-fill-option')
  await expect(options.first()).toBeVisible()
  // A beacon takes speed and efficiency modules, not productivity.
  expect(await options.evaluateAll(els => els.map(e => e.getAttribute('data-module-id')))).not.toContainEqual(expect.stringMatching(/productivity/))
  const moduleId = (await options.first().getAttribute('data-module-id'))!
  await options.first().click()
  await expect.poll(async () => (await rootNode(page)).beaconConfigs?.[0]?.modules).toEqual([{ moduleId, count: slots }])
})

test('beacon module slots change independently', async ({ page }) => {
  await row(page).getByLabel('Add beacon', { exact: true }).click()
  const first = page.getByTestId('module-fill-option').first()
  const idA = (await first.getAttribute('data-module-id'))!
  await first.click()
  const chip = row(page).getByTestId('beacon-module-chip')
  await row(page).getByRole('button', { name: 'Edit beacon', exact: true }).click()
  const panel = sidePanel(page)
  let slots = Number((await chip.textContent())!.split('/')[1])
  if (slots < 2) {
    // The default beacon has one slot: switch to one that has more.
    await panel.getByTestId('beacon-type-button').click()
    await page.locator('[data-testid="beacon-option"][data-beacon-id="nullius-beacon-2"]').click()
    await expect(chip).toHaveText(/\/2$/)
    slots = Number((await chip.textContent())!.split('/')[1])
  }
  expect(slots).toBeGreaterThanOrEqual(2)
  const modules = async () => (await rootNode(page)).beaconConfigs![0].modules

  await panel.getByTestId('beacon-module-slot').nth(1).click()
  const optionB = page.getByTestId('beacon-module-option').locator(`xpath=self::*[@data-module-id!="${idA}"]`).first()
  const idB = (await optionB.getAttribute('data-module-id'))!
  await optionB.click()
  await expect.poll(modules).toEqual([{ moduleId: idA, count: slots - 1 }, { moduleId: idB, count: 1 }])
  await expect(panel.getByTestId('beacon-module-slot').first()).toHaveAttribute('aria-label', /^Beacon module slot 1: (?!empty)/)
  await expect(chip).toHaveText(`${slots}/${slots}`)
  const nameA = (await panel.getByTestId('beacon-module-slot').first().getAttribute('aria-label'))!.replace(/^Beacon module slot 1: /, '')
  await expect(chip).toHaveAttribute('title', new RegExp(`${nameA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} × ${slots - 1} \\+ .+ × 1 per beacon`))

  // Emptying the last slot removes only module B.
  await panel.getByTestId('beacon-module-slot').nth(slots - 1).click()
  await page.getByTestId('beacon-module-option-empty').click()
  await expect.poll(modules).toEqual([{ moduleId: idA, count: slots - 1 }])
  await expect(chip).toHaveText(`${slots - 1}/${slots}`)
})

test('two beacon configurations from the panel', async ({ page }) => {
  await row(page).getByLabel('Add beacon', { exact: true }).click()
  await page.getByTestId('module-fill-option').first().click()
  await row(page).getByRole('button', { name: 'Edit beacon', exact: true }).click()
  const panel = sidePanel(page)
  await expect(panel.getByTestId('beacon-card')).toHaveCount(1)

  const add = panel.getByTestId('add-beacon-config')
  await expect(add).toBeEnabled()
  await add.click()
  await expect(panel.getByTestId('beacon-card')).toHaveCount(2)
  await expect.poll(async () => (await rootNode(page)).beaconConfigs?.length).toBe(2)
  await expect(row(page).getByTestId('chip-more')).toHaveText('+1')
  await expect(panel.getByRole('columnheader').allTextContents()).resolves.toEqual(['', 'Machine', 'Beacons 1', 'Beacons 2', 'Total'])

  await panel.getByTestId('beacon-card').nth(1).getByLabel('Beacon count').fill('8')
  await expect.poll(async () => (await rootNode(page)).beaconConfigs?.map(c => c.beaconCount)).toEqual([1, 8])

  await panel.getByTestId('beacon-card').first().getByRole('button', { name: 'Remove beacon configuration' }).click()
  await expect.poll(async () => (await rootNode(page)).beaconConfigs).toMatchObject([{ beaconCount: 8 }])
  await expect(row(page).getByTestId('chip-more')).toHaveCount(0)
})

test('a filled module chip opens the panel on the highlighted Machine section', async ({ page }) => {
  await row(page).getByTestId('module-chip').click()
  await page.getByTestId('module-fill-option').first().click()

  await row(page).getByTestId('module-chip').click()
  const panel = sidePanel(page)
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('panel-machine')).toHaveAttribute('data-highlighted', 'true')
  await expect(panel.getByTestId('panel-beacons')).not.toHaveAttribute('data-highlighted', 'true')
  // The highlight is short-lived.
  await expect(panel.getByTestId('panel-machine')).not.toHaveAttribute('data-highlighted', 'true', { timeout: 5000 })
})

test('a filled beacon chip opens the panel on the highlighted Beacons section', async ({ page }) => {
  await row(page).getByLabel('Add beacon', { exact: true }).click()
  await page.getByTestId('module-fill-option').first().click()

  await row(page).getByRole('button', { name: 'Edit beacon', exact: true }).click()
  const panel = sidePanel(page)
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('panel-beacons')).toHaveAttribute('data-highlighted', 'true')
  await expect(panel.getByTestId('panel-machine')).not.toHaveAttribute('data-highlighted', 'true')
})

test('a picker opened from the bottom row or the Beacons column stays inside the viewport', async ({ page }) => {
  // A short window, so the table's last rows sit close to the bottom edge.
  await page.setViewportSize({ width: 1100, height: 520 })
  const rows = page.locator('main tr[data-node-id]:has([data-testid="machine-chip"])')
  const last = rows.last()
  await last.scrollIntoViewIfNeeded()

  async function expectInViewport() {
    const picker = page.getByTestId('picker')
    await expect(picker).toBeVisible()
    const box = (await picker.boundingBox())!
    const view = page.viewportSize()!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(view.width)
    expect(box.y + box.height).toBeLessThanOrEqual(view.height)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('picker')).toHaveCount(0)
  }

  await last.getByTestId('machine-chip').click()
  await expectInViewport()
  const add = last.getByLabel('Add beacon', { exact: true })
  if (await add.count()) {
    await add.click()
    await expectInViewport()
  }
  await row(page).getByLabel('Add beacon', { exact: true }).click()
  await expectInViewport()
})
