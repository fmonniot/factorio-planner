import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { selectDataset, exportPlan, pickPlanFile } from './support/appMenu'
import { planTrigger, planNames, switchToPlan } from './support/planMenu'

const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

const tab = (page: Page, name: string) => page.locator(`[data-testid="block-tab"] button[aria-label="${name}"]`)
const tabCount = (page: Page) => page.getByTestId('block-tab')
const expectPlan = (page: Page, name: string) => expect(planTrigger(page)).toHaveAccessibleName(`Plan: ${name}`)

/** Add a goal of `amount` for the first item in the picker. */
async function addGoal(page: Page, amount: string) {
  const overlay = page.locator('.fixed.inset-0')
  await page.getByTitle('Add product').click()
  await overlay.getByLabel('Amount').fill(amount)
  await overlay.locator('[data-testid="item-slot"]').first().click()
  await expect(overlay).not.toBeVisible()
}

async function expectFixtureTabs(page: Page) {
  await expect(tab(page, 'Plates')).toBeVisible()
  await expect(tab(page, 'Gears')).toBeVisible()
  await expect(tabCount(page)).toHaveCount(2)
}

/** Plan 1 with two blocks and a 250 goal, so it is distinguishable from the fixture. */
async function expectPlanOne(page: Page) {
  await expectPlan(page, 'Plan 1')
  await expect(tabCount(page)).toHaveCount(2)
  await expect(tab(page, 'Factory')).toBeVisible()
  await tab(page, 'Factory').click()
  await expect(page.locator('main')).toContainText('250')
}

// Starts from a clean profile: the fixture helper re-seeds the old plan key on
// every navigation, which would add plans and hide what is persisted.
test.describe('Plan import', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('factorio-planner:ui', JSON.stringify({ summaryCollapsed: false })) }) // a clean profile that has expanded the summary
    await page.reload()
    await selectDataset(page, 'Nullius')
    await addGoal(page, '250')
    await page.getByRole('button', { name: 'Add block', exact: true }).click()
    await expect(tabCount(page)).toHaveCount(2)
    await tab(page, 'Factory').click()
  })

  test('imports a file as a new plan and keeps the current one', async ({ page }) => {
    await pickPlanFile(page, FIXTURE)
    await expectPlan(page, 'block-connection')
    await expectFixtureTabs(page)
    expect(await planNames(page)).toEqual(['Plan 1', 'block-connection'])

    await switchToPlan(page, 'Plan 1')
    await expectPlanOne(page)
  })

  test('an imported plan persists across a reload', async ({ page }) => {
    await pickPlanFile(page, FIXTURE)
    await expectPlan(page, 'block-connection')

    await page.reload()
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expectPlan(page, 'block-connection')
    await expectFixtureTabs(page)
    expect(await planNames(page)).toEqual(['Plan 1', 'block-connection'])
  })

  test('a plan exported from the app can be imported back as a second plan', async ({ page }) => {
    const download = await exportPlan(page)
    const exportedName = download.suggestedFilename()
    expect(exportedName).toMatch(/^factorio-plan-plan-1-\d{4}-\d{2}-\d{2}\.json$/)
    const buffer = fs.readFileSync((await download.path())!)

    await pickPlanFile(page, { name: exportedName, mimeType: 'application/json', buffer })
    const importedName = exportedName.replace(/\.json$/, '')
    await expectPlan(page, importedName)
    expect(await planNames(page)).toEqual(['Plan 1', importedName])
    await expect(tabCount(page)).toHaveCount(2)
    await expect(tab(page, 'Factory')).toBeVisible()
    await expect(page.locator('main')).toContainText('250')
  })

  test("a plan in the old shape that carries Don't make more here and Import off loads as Import off alone", async ({ page }) => {
    const plan = JSON.parse(fs.readFileSync(path.resolve('e2e/fixtures/item-sourcing.json'), 'utf8'))
    const oxygen = 'nullius-oxygen'
    plan.blocks[0].itemSourcing = { [oxygen]: 'byproducts-first' }
    plan.blocks[0].noImportItems = [oxygen]
    await pickPlanFile(page, { name: 'old-pair.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) })
    await expectPlan(page, 'old-pair')

    const download = await exportPlan(page)
    const exported = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'))
    const acid = exported.blocks.find((b: { name: string }) => b.name === 'Acid')
    expect(acid.sourceRules).toEqual({ [oxygen]: { importOff: true } })
    expect(acid.itemSourcing).toBeUndefined()
    expect(acid.noImportItems).toBeUndefined()
  })

  test('a plan exported for another data set warns about the mismatch', async ({ page }) => {
    const download = await exportPlan(page)
    const exportedName = download.suggestedFilename()
    const buffer = fs.readFileSync((await download.path())!)
    await selectDataset(page, 'Seablock')

    const file = { name: exportedName, mimeType: 'application/json', buffer }
    await pickPlanFile(page, file)
    const warning = page.getByTestId('import-data-set-mismatch')
    await expect(warning).toContainText('Nullius')
    await expect(warning).toContainText('Seablock')
    await page.getByRole('button', { name: 'Cancel' }).click()
    expect(await planNames(page)).toEqual(['Plan 1'])

    await pickPlanFile(page, file)
    await page.getByRole('button', { name: 'Import anyway' }).click()
    await expectPlan(page, exportedName.replace(/\.json$/, ''))
  })

  test('an invalid file leaves the plans intact', async ({ page }) => {
    await pickPlanFile(page, { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"blocks": 5}') })
    await expect(page.getByText('Could not import "bad.json"')).toBeVisible()
    await expect(page.locator('pre')).toContainText('blocks')
    await page.getByRole('button', { name: 'Close' }).click()
    await expectPlanOne(page)

    await pickPlanFile(page, { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not json') })
    await expect(page.locator('pre')).toContainText('Not a valid JSON file')
    await page.getByRole('button', { name: 'Close' }).click()
    await expectPlanOne(page)
    expect(await planNames(page)).toEqual(['Plan 1'])
  })

  test('unknown ids warn, Cancel adds nothing and Import anyway adds the plan', async ({ page }) => {
    const plan = {
      blocks: [{
        id: 'ghost-block', name: 'Ghost block', goals: [{ id: 'g1', itemId: 'nope-item', rate: 10 }], noImportItems: [],
        rootPlan: {
          id: 'rp', name: 'Main', subPlans: [],
          nodes: [{ kind: 'game-recipe', id: 'n1', recipeId: 'does-not-exist', modules: [], byproductPolicy: {} }],
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      }],
      activeBlockId: 'ghost-block',
    }
    const ghost = { name: 'ghost.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) }

    await pickPlanFile(page, ghost)
    await expect(page.getByTestId('import-unknown-ids')).toContainText('does-not-exist')
    await expect(page.getByTestId('import-unknown-ids')).toContainText('nope-item')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expectPlanOne(page)
    expect(await planNames(page)).toEqual(['Plan 1'])

    await pickPlanFile(page, ghost)
    await page.getByRole('button', { name: 'Import anyway' }).click()
    await expect(tab(page, 'Ghost block')).toBeVisible()
    await expectPlan(page, 'ghost')
  })

  test('the same file can be imported twice in a row', async ({ page }) => {
    await pickPlanFile(page, FIXTURE)
    await expectPlan(page, 'block-connection')
    await pickPlanFile(page, FIXTURE)
    await expect.poll(() => planNames(page)).toEqual(['Plan 1', 'block-connection', 'block-connection'])
  })
})
