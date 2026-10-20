import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'

/**
 * Fixture: active block "Gears" needs plates and rods from outside. Selecting an
 * Ingredients slot offers Find recipe, Receive from… and Forbid imports in the
 * detail strip; the right-click menu keeps the connection entries and Forbid imports.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

const plateSlot = (page: Page) => slot(page, 'Ingredients', 'Iron plate')
const rodSlot = (page: Page) => slot(page, 'Ingredients', 'Iron rod')
const stripAction = (page: Page, name: string) => detail(page, 'Ingredients').getByRole('button', { name })

test.describe('Ingredients pane', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })
  })

  test('Find recipe opens the producer picker and adds a row', async ({ page }) => {
    const rows = page.locator('main table tbody tr')
    const before = await rows.count()

    await selectSlot(page, 'Ingredients', 'Iron plate')
    await stripAction(page, 'Find recipe').click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expect(page.getByText("Choose a recipe to produce 'Iron plate'")).toBeVisible()

    const overlay = page.locator('.fixed.inset-0')
    await overlay.locator('[data-testid="recipe-slot"][data-recipe-id="nullius-iron-plate"]').click()

    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
    await expect(rows).toHaveCount(before + 1)
  })

  test('Escape closes the Receive from… menu first, then clears the selection', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await stripAction(page, 'Receive from…').click()
    await expect(page.getByRole('menu')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).not.toBeVisible()
    await expect(plateSlot(page)).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('Escape')
    await expect(plateSlot(page)).toHaveAttribute('aria-pressed', 'false')
  })

  test('forbid and allow imports through the right-click menus', async ({ page }) => {
    await rodSlot(page).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Forbid imports' }).click()
    await expect(rodSlot(page)).toHaveAttribute('data-status', 'locked')

    await rodSlot(page).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Allow imports' }).click()
    await expect(rodSlot(page)).not.toHaveAttribute('data-status', 'locked')
  })

  test('a left click on a locked slot only selects it; Allow imports unlocks', async ({ page }) => {
    await rodSlot(page).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Forbid imports' }).click()
    await expect(rodSlot(page)).toHaveAttribute('data-status', 'locked')

    await selectSlot(page, 'Ingredients', 'Iron rod')
    await expect(rodSlot(page)).toHaveAttribute('data-status', 'locked')
    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()

    await stripAction(page, 'Allow imports').click()
    await expect(rodSlot(page)).not.toHaveAttribute('data-status', 'locked')
  })

  test('right click on a slot lists the source blocks and Forbid imports', async ({ page }) => {
    await plateSlot(page).click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: /Plates/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Forbid imports' })).toBeVisible()
  })

  test('Receive from… in the strip opens the same menu', async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Iron plate')
    await stripAction(page, 'Receive from…').click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: /Plates/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Forbid imports' })).toBeVisible()
  })
})
