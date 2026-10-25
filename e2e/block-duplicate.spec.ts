import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { selectSlot, slot } from './support/summary'

/** Uses the block-connection fixture: blocks "Plates" and the active "Gears" (iron gear 30/min). */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

test('duplicating a block copies its goal and solves the copy', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  const plateTile = slot(page, 'Ingredients', 'Iron plate')
  const rodTile = slot(page, 'Ingredients', 'Iron rod')
  await expect(plateTile).toBeVisible({ timeout: 10000 })
  await selectSlot(page, 'Products', 'Iron gear')
  const rate = await page.getByTitle(/^Extra output:/).getAttribute('title')

  await page.locator('button[title="Gears"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Duplicate' }).click()

  const copyTab = page.locator('button[title="Gears (copy)"]')
  await expect(copyTab).toBeVisible()
  await expect(copyTab).toHaveAttribute('aria-current', 'true')
  await selectSlot(page, 'Products', 'Iron gear')
  await expect(page.getByTitle(/^Extra output:/)).toHaveAttribute('title', rate!)
  await expect(plateTile).toBeVisible({ timeout: 10000 })
  await expect(rodTile).toBeVisible()

  await page.locator('button[title="Gears"]').click()
  await expect(page.locator('button[title="Gears"]')).toHaveAttribute('aria-current', 'true')
  await selectSlot(page, 'Products', 'Iron gear')
  await expect(page.getByTitle(/^Extra output:/)).toHaveAttribute('title', rate!)
  await expect(plateTile).toBeVisible()
})
