import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

const FIXTURE = path.resolve('e2e/fixtures/ingredient-click-subgroup.json')

async function setup(page: Parameters<typeof loadPlanFixture>[0]) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
}

test.describe('ingredient click adds to correct subgroup', () => {
  test('clicking an ingredient inside a subgroup adds the new recipe to that subgroup', async ({ page }) => {
    await setup(page)

    // Expand the "Acid Sub" subgroup.
    await page.locator('main button', { hasText: 'Acid Sub' }).click()

    // Wait for the subgroup recipe row to appear.
    const subgroupBadge = page.locator('main button', { hasText: 'Acid Sub' }).locator('span', { hasText: /recipe/ })
    await expect(subgroupBadge).toHaveText('1 recipe')

    // Find an ingredient tile belonging to the subgroup recipe (appears after expanding).
    // All ingredient tiles match [title$="Find producer recipe"]; the subgroup recipe's
    // tiles appear after the subgroup header row in DOM order, so we take the last one
    // (root recipe tiles come first in the DOM).
    const ingredientTiles = page.locator('main button[title$="Find producer recipe"]')
    const tileCount = await ingredientTiles.count()
    expect(tileCount).toBeGreaterThan(0)

    // Click the last ingredient tile — it belongs to the subgroup recipe (deepest in DOM).
    await ingredientTiles.last().click()

    // Picker opens.
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()

    // Select the first available recipe slot.
    const slots = page.locator('[data-testid="recipe-slot"]')
    await expect(slots.first()).toBeVisible({ timeout: 5000 })
    await slots.first().click()

    // The subgroup badge should now show 2 recipes.
    await expect(subgroupBadge).toHaveText('2 recipes')
  })

  test('clicking an ingredient at root level adds the new recipe to root (regression)', async ({ page }) => {
    await setup(page)

    // Count root-level rows before: 1 game-recipe row + 1 subplan row = 2 visible rows
    // (don't expand the subgroup so we know subgroup count stays the same).
    const subgroupBadge = page.locator('main button', { hasText: 'Acid Sub' }).locator('span', { hasText: /recipe/ })
    await expect(subgroupBadge).toHaveText('1 recipe')

    // Click an ingredient tile from the root recipe (the first one in DOM order).
    const ingredientTiles = page.locator('main button[title$="Find producer recipe"]')
    await expect(ingredientTiles.first()).toBeVisible()
    await ingredientTiles.first().click()

    // Picker opens.
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()

    // Select the first available recipe slot.
    const slots = page.locator('[data-testid="recipe-slot"]')
    await expect(slots.first()).toBeVisible({ timeout: 5000 })
    await slots.first().click()

    // Subgroup badge must still show 1 recipe — the new node went to root, not subgroup.
    await expect(subgroupBadge).toHaveText('1 recipe')
  })
})
