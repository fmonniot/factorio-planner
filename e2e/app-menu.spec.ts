import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { appMenu, menuTrigger, openAppMenu } from './support/appMenu'
import { detail, selectSlot } from './support/summary'

const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('button[title="Gears"]')).toBeVisible()
}

test.describe('workspace menu', () => {
  test('folds export, import and the data set selector into one button', async ({ page }) => {
    await setup(page)
    await expect(menuTrigger(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Export plan' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Import plan' })).toHaveCount(0)
    await expect(page.getByRole('combobox')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Block graph' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveCount(0)
  })

  test('the trigger shows the plan name and the data set label', async ({ page }) => {
    await setup(page)
    await expect(menuTrigger(page)).toHaveText(/Nullius/)
    await expect(menuTrigger(page)).toHaveAccessibleName(/^Plan: /)
  })

  test('lists the items in order with the current data set checked', async ({ page }) => {
    await setup(page)
    const menu = await openAppMenu(page)
    const items = menu.locator('[role^="menuitem"]')
    await expect(items).toHaveText([
      /^✓?Plan 1$/, 'New', 'Rename', 'Duplicate', 'Delete', /Nullius/, /Seablock/, /Upload file…/, 'Export plan', 'Import plan…',
    ])
    await expect(menu.getByRole('menuitemradio', { name: 'Nullius' })).toHaveAttribute('aria-checked', 'true')
  })

  test('keyboard: Enter opens, arrows move, Escape closes and refocuses the button', async ({ page }) => {
    await setup(page)
    await menuTrigger(page).focus()
    await page.keyboard.press('Enter')
    const menu = appMenu(page)
    await expect(menu).toBeVisible()
    // Focus lands on the checked radio, the active plan.
    const plan = menu.getByRole('group', { name: 'Plans' }).getByRole('menuitemradio', { checked: true })
    await expect(plan).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: 'New plan' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(menuTrigger(page)).toBeFocused()
  })

  test('mouse open keeps focus on the button; ArrowUp opens on the last item', async ({ page }) => {
    await setup(page)
    await menuTrigger(page).click()
    await expect(appMenu(page)).toBeVisible()
    await expect(menuTrigger(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(appMenu(page)).toBeHidden()
    await page.keyboard.press('ArrowUp')
    await expect(appMenu(page).getByRole('menuitem', { name: 'Import plan' })).toBeFocused()
  })

  test('clicking outside closes the menu', async ({ page }) => {
    await setup(page)
    await openAppMenu(page)
    await page.locator('main').click({ position: { x: 5, y: 5 } })
    await expect(appMenu(page)).toBeHidden()
  })

  test('Escape closes only the menu and keeps the summary selection', async ({ page }) => {
    await setup(page)
    await selectSlot(page, 'Products', 'Iron gear')
    await openAppMenu(page)
    await page.keyboard.press('Escape')
    await expect(appMenu(page)).toBeHidden()
    await expect(detail(page, 'Products')).toHaveAttribute('data-state', 'selected')
  })

  test('first visit: hint points to the menu, nothing checked, Import plan disabled', async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await expect(page.getByText('Open the workspace menu at the top right to pick a game data set')).toBeVisible()
    await expect(menuTrigger(page)).toHaveAccessibleName('Choose game data')
    const menu = await openAppMenu(page)
    await expect(menu.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'Import plan' })).toBeDisabled()
  })
})
