import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Fixture: active block "Gears" needs plates and rods from outside. A left click
 * on an Ingredients tile opens the producer picker; import locks live in the
 * right-click menu, and the locked chip unlocks with a left click or its menu.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

const plateTile = (page: Page) => page.locator('button[title^="Iron plate — click to find a producer recipe"]')
const rodTile = (page: Page) => page.locator('button[title^="Iron rod — click to find a producer recipe"]')
const rodChip = (page: Page) => page.locator('button[title^="Iron rod — locked"]')

test.describe('Ingredients pane', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(plateTile(page)).toBeVisible({ timeout: 10000 })
  })

  test('left click on a tile opens the producer picker and adds a row', async ({ page }) => {
    const rows = page.locator('main table tbody tr')
    const before = await rows.count()

    await plateTile(page).click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expect(page.getByText("Choose a recipe to produce 'Iron plate'")).toBeVisible()

    const overlay = page.locator('.fixed.inset-0')
    await overlay.locator('[data-testid="recipe-slot"][data-recipe-id="nullius-iron-plate"]').click()

    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
    await expect(rows).toHaveCount(before + 1)
  })

  test('forbid and allow imports through the right-click menus', async ({ page }) => {
    await rodTile(page).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Forbid imports' }).click()
    await expect(rodChip(page)).toBeVisible()

    await rodChip(page).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Allow imports' }).click()
    await expect(rodChip(page)).toHaveCount(0)
  })

  test('left click on the locked chip unlocks without opening the picker', async ({ page }) => {
    await rodTile(page).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Forbid imports' }).click()
    await expect(rodChip(page)).toBeVisible()

    await rodChip(page).click()
    await expect(rodChip(page)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Add recipe' })).not.toBeVisible()
  })

  test('right click on a tile lists the source blocks and Forbid imports', async ({ page }) => {
    await plateTile(page).click({ button: 'right' })
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: /Plates/ })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Forbid imports' })).toBeVisible()
  })
})
