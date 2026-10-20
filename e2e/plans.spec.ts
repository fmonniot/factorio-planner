import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { selectDataset } from './support/appMenu'
import { loadPlanFixture } from './support/loadPlan'
import {
  planTrigger, planNames, switchToPlan, renameActivePlan, runPlanAction, deleteActivePlan,
} from './support/planMenu'

/** Add a goal of `amount` for the first item in the picker. */
async function addGoal(page: Page, amount: string) {
  const overlay = page.locator('.fixed.inset-0')
  await page.getByTitle('Add goal').click()
  await overlay.getByLabel('Amount').fill(amount)
  await overlay.locator('[data-testid="item-slot"]').first().click()
  await expect(overlay).not.toBeVisible()
}

const expectPlan = (page: Page, name: string) => expect(planTrigger(page)).toHaveAccessibleName(`Plan: ${name}`)

test.describe('multiple plans per data set', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await selectDataset(page, 'Nullius')
    await expectPlan(page, 'Plan 1')
  })

  test('creating a plan starts empty and switching back restores the first', async ({ page }) => {
    await addGoal(page, '250')
    await expect(page.locator('main')).toContainText('250')

    await runPlanAction(page, 'New plan')
    await expectPlan(page, 'Plan 2')
    await expect(page.locator('main')).not.toContainText('250')

    await switchToPlan(page, 'Plan 1')
    await expect(page.locator('main')).toContainText('250')
  })

  test('a renamed plan keeps its name across a reload', async ({ page }) => {
    await renameActivePlan(page, 'Late game')
    await page.reload()
    await expectPlan(page, 'Late game')
  })

  test('a duplicate is independent of the original', async ({ page }) => {
    await addGoal(page, '250')
    await runPlanAction(page, 'Duplicate')
    await expectPlan(page, 'Plan 1 (copy)')
    await expect(page.locator('main')).toContainText('250')

    await addGoal(page, '375')
    await expect(page.locator('main')).toContainText('375')

    await switchToPlan(page, 'Plan 1')
    await expect(page.locator('main')).toContainText('250')
    await expect(page.locator('main')).not.toContainText('375')
  })

  test('deleting a plan activates another; deleting the only plan leaves an empty Plan 1', async ({ page }) => {
    await addGoal(page, '250')
    await runPlanAction(page, 'New plan')
    await deleteActivePlan(page)
    await expectPlan(page, 'Plan 1')
    await expect(page.locator('main')).toContainText('250')
    expect(await planNames(page)).toEqual(['Plan 1'])

    await deleteActivePlan(page)
    await expectPlan(page, 'Plan 1')
    await expect(page.locator('main')).not.toContainText('250')
    expect(await planNames(page)).toEqual(['Plan 1'])
  })

  test('each data set has its own plan list', async ({ page }) => {
    await renameActivePlan(page, 'Nullius run')
    await runPlanAction(page, 'New plan')
    await expectPlan(page, 'Plan 2')

    await selectDataset(page, 'Seablock')
    await expectPlan(page, 'Plan 1')
    expect(await planNames(page)).toEqual(['Plan 1'])

    await selectDataset(page, 'Nullius')
    await expectPlan(page, 'Plan 2')
    expect(await planNames(page)).toEqual(['Nullius run', 'Plan 2'])
  })
})

test('a plan stored in the old single-plan shape is migrated', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/block-connection.json'))
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('button[title="Gears"]')).toBeVisible()
  await expectPlan(page, 'Plan 1')
  // The seed script re-adds the old key on every navigation, so it is gone only
  // until the next one; right after this load the app has already moved it.
  const keys = await page.evaluate(() => Object.keys(localStorage))
  expect(keys).not.toContain('factorio-planner:app-state:nullius')
  expect(keys.some(k => k.startsWith('factorio-planner:plan-index:nullius'))).toBe(true)
})
