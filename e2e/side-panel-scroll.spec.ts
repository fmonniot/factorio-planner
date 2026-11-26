import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * The page never scrolls: the shell is exactly the viewport tall and the side panel scrolls on its own. An absolutely
 * positioned screen-reader reading (`sr-only`) in a panel list used to anchor to the viewport when no ancestor was
 * positioned, so a reading below the fold stretched the document and the player could scroll past the app, onto white.
 */
test('opening a row detail does not make the page scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 420 })
  await loadPlanFixture(page, path.resolve('e2e/fixtures/pin-recipe-not-working.json'))
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  const row = page.locator('main table tbody tr')
    .filter({ has: page.locator('[data-testid="recipe-name"][data-tip="Saline electrolysis"]') }).first()
  await row.locator('[data-testid="recipe-name"]').first().click()

  const panel = page.getByTestId('side-panel')
  await expect(panel).toBeVisible()
  // The panel has entries to read, and some of their readings sit below the fold.
  await expect(panel.getByTestId('sourcing-entry').first()).toBeAttached()
  const below = await panel.locator('.sr-only').evaluateAll(
    els => els.filter(e => e.getBoundingClientRect().top > window.innerHeight).length,
  )
  expect(below, 'the fixture must have a reading below the fold for this test to mean anything').toBeGreaterThan(0)

  const scrollable = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)
  expect(scrollable, 'the document must not be taller than the window').toBe(0)
})
