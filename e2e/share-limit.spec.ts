import { test, expect, type Locator, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { openRowMenu, clickRowAction } from './support/rowMenu'

/**
 * Share limit on a recipe row. Goal: 1000 hydrogen/min from steam electrolysis
 * (800 per execution, cheaper) and water electrolysis (140 per execution).
 * Unlimited, the solver uses steam alone; "at most 30 %" on steam moves the rest
 * to water. Water's natural share is 0 %, so limiting it changes nothing.
 */

const BASE_FIXTURE = path.resolve('e2e/fixtures/share-limit-base.json')
const ACTIVE_FIXTURE = path.resolve('e2e/fixtures/share-limit-active.json')

async function waitForRows(page: Page) {
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
}

const steamRow = (page: Page) =>
  page.locator('main table tbody tr').filter({ has: page.locator('[title="Steam electrolysis"]') }).first()
const waterRow = (page: Page) =>
  page.locator('main table tbody tr').filter({ has: page.locator('[title="Water electrolysis"]') }).first()

/** Open a row's menu, pick a prompt-driven action and answer the prompt. */
async function setLimit(page: Page, row: Locator, label: string, answer: string) {
  page.once('dialog', d => d.accept(answer))
  await clickRowAction(page, row, label)
}

test.describe('Share limit', () => {
  test('unlimited, the cheaper steam route makes all the hydrogen', async ({ page }) => {
    await loadPlanFixture(page, BASE_FIXTURE)
    await waitForRows(page)
    await expect(steamRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/1000/)
    await expect(waterRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/0\.00/)
  })

  test('limiting steam to 30% moves the rest to water', async ({ page }) => {
    await loadPlanFixture(page, BASE_FIXTURE)
    await waitForRows(page)
    await setLimit(page, steamRow(page), 'Limit share…', '30')
    await expect(steamRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/300/)
    await expect(waterRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/700/)
    await expect(steamRow(page).getByLabel('Share limit')).toHaveText('≤30%')
  })

  test('changing then removing the limit', async ({ page }) => {
    await loadPlanFixture(page, BASE_FIXTURE)
    await waitForRows(page)
    await setLimit(page, steamRow(page), 'Limit share…', '30')
    await expect(steamRow(page).getByLabel('Share limit')).toBeVisible()

    await setLimit(page, steamRow(page), 'Change share limit…', '80')
    await expect(steamRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/800/)
    await expect(waterRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/200/)

    await clickRowAction(page, steamRow(page), 'Remove share limit')
    await expect(steamRow(page).getByLabel('Share limit')).toHaveCount(0)
    await expect(steamRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/1000/)
    await expect(waterRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/0\.00/)
  })

  test('a limit above the natural share changes nothing', async ({ page }) => {
    await loadPlanFixture(page, BASE_FIXTURE)
    await waitForRows(page)
    await setLimit(page, waterRow(page), 'Limit share…', '30')
    await expect(waterRow(page).getByLabel('Share limit')).toHaveText('≤30%')
    await expect(steamRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/1000/)
    await expect(waterRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/0\.00/)
  })

  test('a saved limit loads: badge, menu and rates', async ({ page }) => {
    await loadPlanFixture(page, ACTIVE_FIXTURE)
    await waitForRows(page)
    await expect(steamRow(page).getByLabel('Share limit')).toHaveText('≤30%')
    await expect(steamRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/300/)
    await expect(waterRow(page).getByTitle('Hydrogen', { exact: true })).toContainText(/700/)

    const menu = await openRowMenu(page, steamRow(page))
    await expect(menu.getByRole('menuitem', { name: 'Remove share limit' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Absorb byproduct' })).toHaveCount(0)
  })
})
