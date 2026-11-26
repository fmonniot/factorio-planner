import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Right-clicking the recipe cell of a row opens a menu with the row actions
 * (absorb byproduct, pin, wrap, remove) — the only place they are offered.
 */
test('right-click menu pins, dismisses with Escape and removes a recipe', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/pin-recipe-not-working.json'))
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  const row = page.locator('main table tbody tr')
    .filter({ has: page.locator('[data-testid="recipe-name"][data-tip="Saline electrolysis"]') }).first()
  await expect(row).toBeVisible({ timeout: 5000 })

  const icon = row.locator('[data-testid="recipe-name"][data-tip="Saline electrolysis"]').first()
  const menu = page.getByRole('menu')

  // Pin through the menu.
  await icon.click({ button: 'right' })
  await expect(menu).toBeVisible()
  // The menu hugs its labels instead of stretching across the row.
  expect((await menu.boundingBox())!.width).toBeLessThan(200)
  await menu.getByRole('menuitem', { name: 'Pin rate' }).click()
  await expect(menu).toBeHidden()
  await expect(row.getByTestId('chip-pin')).toBeVisible()

  // Escape dismisses.
  await icon.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

  // Remove through the menu.
  await icon.click({ button: 'right' })
  await menu.getByRole('menuitem', { name: 'Remove recipe' }).click()
  await expect(page.locator('main table tbody tr').filter({ has: page.locator('[data-testid="recipe-name"][data-tip="Saline electrolysis"]') })).toHaveCount(0)
})

test('the right-click menu is walked with the arrow keys, Enter runs the focused action and Tab closes it', async ({ page }) => {
  await loadPlanFixture(page, path.resolve('e2e/fixtures/pin-recipe-not-working.json'))
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  const row = page.locator('main table tbody tr')
    .filter({ has: page.locator('[data-testid="recipe-name"][data-tip="Saline electrolysis"]') }).first()
  await expect(row).toBeVisible({ timeout: 5000 })
  const icon = row.locator('[data-testid="recipe-name"][data-tip="Saline electrolysis"]').first()
  const menu = page.getByRole('menu')
  const focusedName = () => page.evaluate(() => document.activeElement?.textContent?.trim())

  await icon.click({ button: 'right' })
  await expect(menu).toBeVisible()
  // ArrowUp from outside enters at the last item, which wraps to the first on ArrowDown.
  await page.keyboard.press('ArrowUp')
  await expect(menu.getByRole('menuitem', { name: 'Remove recipe' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  const firstName = await focusedName()
  expect(firstName).not.toBe('Remove recipe')
  await page.keyboard.press('End')
  await page.keyboard.press('Home')
  expect(await focusedName()).toBe(firstName)

  // Enter runs the focused action: walk down to Pin rate.
  for (let i = 0; i < 10 && (await focusedName()) !== 'Pin rate'; i++) await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('menuitem', { name: 'Pin rate' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(row.getByTestId('chip-pin')).toBeVisible()

  // Tab closes it.
  await icon.click({ button: 'right' })
  await expect(menu).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Tab')
  await expect(menu).toBeHidden()
})
