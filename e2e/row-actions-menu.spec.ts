import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Right-clicking the recipe cell of a row opens a menu with the same actions
 * as the hover buttons (absorb byproduct, pin, wrap, remove).
 */
test('right-click menu pins, dismisses with Escape and removes a recipe', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/pin-recipe-not-working.json'))
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  const row = page.locator('main table tbody tr')
    .filter({ has: page.locator('[title="Saline electrolysis"]') }).first()
  await expect(row).toBeVisible({ timeout: 5000 })

  const icon = row.locator('[title="Saline electrolysis"]').first()
  const menu = page.getByRole('menu')

  // Pin through the menu.
  await icon.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Pin rate' }).click()
  await expect(menu).toBeHidden()
  await expect(row.getByTitle('Unpin rate')).toBeVisible()

  // Escape dismisses.
  await icon.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  // Remove through the menu.
  await icon.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Remove recipe' }).click()
  await expect(page.locator('main table tbody tr').filter({ has: page.locator('[title="Saline electrolysis"]') })).toHaveCount(0)
})
