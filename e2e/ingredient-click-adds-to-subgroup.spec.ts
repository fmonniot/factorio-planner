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

    // Scope to the row right after the subgroup header: that is the subgroup's recipe row.
    // Its ingredient tiles only render once the solver result lands, so rely on
    // auto-waiting (a one-shot count()/last() can run before then, or while only the
    // root recipe's tiles exist, and pick the wrong tile).
    const subgroupRecipeRow = page
      .locator('main tr', { has: page.locator('button', { hasText: 'Acid Sub' }) })
      .locator('xpath=following-sibling::tr[1]')
    const ingredientTile = subgroupRecipeRow.locator('button[title$="Find producer recipe"]').first()
    await expect(ingredientTile).toBeVisible({ timeout: 10000 })
    await ingredientTile.click()

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
