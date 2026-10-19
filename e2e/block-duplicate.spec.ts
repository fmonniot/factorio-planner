import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/** Uses the block-connection fixture: blocks "Plates" and the active "Gears" (iron gear 30/min). */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

test('duplicating a block copies its goal and solves the copy', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  const plateTile = page.locator('button[title^="Iron plate — click to forbid"]')
  const rodTile = page.locator('button[title^="Iron rod — click to forbid"]')
  await expect(plateTile).toBeVisible({ timeout: 10000 })
  const rate = await page.getByTitle(/Target:/).getAttribute('title')

  await page.locator('button[title="Gears"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()

  const copyTab = page.locator('button[title="Gears (copy)"]')
  await expect(copyTab).toBeVisible()
  await expect(copyTab).toHaveClass(/ring-blue-500/)
  await expect(page.getByTitle(/Target:/)).toHaveAttribute('title', rate!)
  await expect(plateTile).toBeVisible({ timeout: 10000 })
  await expect(rodTile).toBeVisible()

  await page.locator('button[title="Gears"]').click()
  await expect(page.locator('button[title="Gears"]')).toHaveClass(/ring-blue-500/)
  await expect(page.getByTitle(/Target:/)).toHaveAttribute('title', rate!)
  await expect(plateTile).toBeVisible()
})
