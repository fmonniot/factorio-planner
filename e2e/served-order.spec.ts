import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'

/**
 * Fixture: block "Plates" (iron plate, extra 60/min) and the active block "Gears" (30 plate/min needed from outside),
 * as in block-requests.spec.ts. Once Gears requests plates, Plates serves two things of iron plate: Gears first,
 * then its own extra output.
 */
const FIXTURE = path.resolve('e2e/fixtures/block-connection.json')

const plateSlot = (page: Page) => slot(page, 'Ingredients', 'Iron plate')
const servedButton = (page: Page) => detail(page, 'Products').getByRole('button', { name: 'Served order…' })

test('Served order lists who a source served, the extra last', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(plateSlot(page)).toBeVisible({ timeout: 10000 })

  // Nothing consumes Plates yet: no order to show.
  await page.locator('[data-testid="block-tab"] button[aria-label="Plates"]').click()
  await selectSlot(page, 'Products', 'Iron plate')
  await expect(servedButton(page)).toHaveCount(0)

  // Gears requests plates.
  await page.locator('[data-testid="block-tab"] button[aria-label="Gears"]').click()
  await plateSlot(page).click({ button: 'right' })
  await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'Plates' }).click()
  await expect(plateSlot(page)).toBeVisible()

  await page.locator('[data-testid="block-tab"] button[aria-label="Plates"]').click()
  await selectSlot(page, 'Products', 'Iron plate')
  await servedButton(page).click()

  const popover = page.getByTestId('served-order-popover')
  const lines = popover.getByTestId('served-line')
  await expect(lines).toHaveCount(2)
  await expect(lines.nth(0)).toContainText('Gears')
  await expect(lines.nth(0)).toContainText('asked 30.0')
  await expect(lines.nth(0)).toContainText('got 30.0')
  await expect(lines.nth(1)).toContainText('Extra output')
  await expect(lines.nth(1)).toContainText('asked 60.0')
  await expect(lines.nth(1)).toContainText('got 60.0')
  await expect(popover.getByTestId('served-short')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await expect(detail(page, 'Products')).toHaveAttribute('data-state', 'selected')
})
