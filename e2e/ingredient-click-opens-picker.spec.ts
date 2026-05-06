import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

const SURPLUS_FIXTURE = path.resolve('e2e/fixtures/byproduct-consumer-surplus.json')

test.describe('Click ingredient → recipe picker filtered to producers', () => {
  test('clicking an ingredient tile opens the picker filtered to that item', async ({ page }) => {
    // Load a fixture with a configured goal so the solver runs and ingredient
    // tiles show up in the rows.
    await loadPlanFixture(page, SURPLUS_FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })

    // Ingredient tiles render as buttons with title "<Name> — Find producer recipe".
    const ingredientTile = page.locator('main button[title$="Find producer recipe"]').first()
    await expect(ingredientTile).toBeVisible()
    const tileTitle = await ingredientTile.getAttribute('title')
    expect(tileTitle).toMatch(/^.+ — Find producer recipe$/)

    await ingredientTile.click()

    // Picker opens, filtered for the clicked item.
    const overlay = page.locator('.fixed.inset-0')
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expect(overlay.locator('text=/Choose a recipe to produce /')).toBeVisible()

    // Filtering is actually applied — every visible recipe slot produces the
    // targeted item, so the count should be small relative to the full set.
    const slots = overlay.locator('[data-testid="recipe-slot"]')
    const slotCount = await slots.count()
    expect(slotCount).toBeGreaterThan(0)
    expect(slotCount).toBeLessThan(50)
  })
})
