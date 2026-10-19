import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

const tab = (page: Page, name: string) => page.locator(`button[title="${name}"]`)
const gearTile = (page: Page) => page.getByTitle('Iron gear', { exact: true }).first()

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(tab(page, 'Gears')).toBeVisible()
}

async function pickPlanFile(page: Page, files: string | { name: string; mimeType: string; buffer: Buffer }) {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Import plan' }).click(),
  ])
  await chooser.setFiles(files)
}

async function expectFixtureTabs(page: Page) {
  await expect(tab(page, 'Plates')).toBeVisible()
  await expect(tab(page, 'Gears')).toBeVisible()
  await expect(page.locator('button[title="Add block"]').locator('xpath=preceding-sibling::*')).toHaveCount(2)
  // The active block's name is shown next to the tabs.
  await expect(page.locator('span.truncate', { hasText: 'Gears' })).toBeVisible()
}

test.describe('Plan import', () => {
  test('imports a fixture, replacing the current plan, and autosaves it', async ({ page }) => {
    await setup(page)
    await page.getByTitle('Add block').click()
    await expect(page.locator('button[title="Add block"]').locator('xpath=preceding-sibling::*')).toHaveCount(3)

    await pickPlanFile(page, FIXTURE)
    await expect(page.getByText('Replace the current plan (3 blocks)')).toBeVisible()
    await page.getByRole('button', { name: 'Replace plan' }).click()

    await expectFixtureTabs(page)
    await expect(gearTile(page)).toBeVisible()

    await page.reload()
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expectFixtureTabs(page)
  })

  test('a plan exported from the app can be imported back', async ({ page }) => {
    await setup(page)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export plan' }).click(),
    ])
    const filePath = await download.path()

    await page.getByTitle('Add block').click()
    await expect(page.locator('button[title="Add block"]').locator('xpath=preceding-sibling::*')).toHaveCount(3)

    await pickPlanFile(page, filePath!)
    await page.getByRole('button', { name: 'Replace plan' }).click()
    await expectFixtureTabs(page)
  })

  test('an invalid file leaves the plan intact', async ({ page }) => {
    await setup(page)

    await pickPlanFile(page, { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"blocks": 5}') })
    await expect(page.getByText('Could not import "bad.json"')).toBeVisible()
    await expect(page.locator('pre')).toContainText('blocks')
    await page.getByRole('button', { name: 'Close' }).click()
    await expectFixtureTabs(page)

    await pickPlanFile(page, { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('not json') })
    await expect(page.locator('pre')).toContainText('Not a valid JSON file')
    await page.getByRole('button', { name: 'Close' }).click()
    await expectFixtureTabs(page)
  })

  test('cancel keeps the current plan', async ({ page }) => {
    await setup(page)
    await page.getByTitle('Add block').click()
    await pickPlanFile(page, FIXTURE)
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.locator('button[title="Add block"]').locator('xpath=preceding-sibling::*')).toHaveCount(3)
  })

  test('unknown ids warn but the plan still imports', async ({ page }) => {
    await setup(page)
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
    await pickPlanFile(page, { name: 'ghost.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(plan)) })
    await expect(page.getByTestId('import-unknown-ids')).toContainText('does-not-exist')
    await page.getByRole('button', { name: 'Replace plan' }).click()
    await expect(tab(page, 'Ghost block')).toBeVisible()
  })

  test('the same file can be imported twice in a row', async ({ page }) => {
    await setup(page)
    await pickPlanFile(page, FIXTURE)
    await page.getByRole('button', { name: 'Replace plan' }).click()
    await expect(page.getByRole('button', { name: 'Replace plan' })).not.toBeVisible()

    await pickPlanFile(page, FIXTURE)
    await expect(page.getByRole('button', { name: 'Replace plan' })).toBeVisible()
  })
})
