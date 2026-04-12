import { test, expect } from '@playwright/test'

const GAME_DATA_KEY = 'factorio-planner:game-data-source'

/**
 * Functional test for the empty-subplan warning flow.
 *
 * Progression tested:
 *   1. Create a sub-plan → card shows "No goals" warning.
 *   2. Add a goal to the sub-plan → card shows "No recipe nodes" warning.
 *   3. Add a recipe node to the sub-plan → warning disappears, scale/pin visible.
 *
 * A lubricant goal is added to the parent plan first so the solver has
 * something to compute once the sub-plan produces lubricant. This ensures
 * the sub-plan card transitions to a fully-solved state (non-zero scale).
 */
test.beforeEach(async ({ page }) => {
  // Fresh app state; auto-load the nullius dataset via localStorage.
  await page.goto('/')
  await page.evaluate((key) => localStorage.setItem(key, 'nullius'), GAME_DATA_KEY)
  await page.reload()
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
})

test('empty subplan shows warnings that clear as goals and nodes are added', async ({ page }) => {
  const sidebar = page.locator('aside')
  const pickerOverlay = page.locator('.fixed.inset-0')

  // ── 0. Add a lubricant goal to the parent plan ────────────────────────────
  // This gives the solver real work so the subplan ends up with a non-zero scale.
  // Use exact match to select "Lubricant" (not "Lubricant barrel" or other variants).
  await page.getByRole('button', { name: '+ Add' }).first().click()
  await page.getByPlaceholder('Search items…').fill('lubricant')
  await pickerOverlay.getByRole('button', { name: /^Lubricant(?! barrel)/ }).first().click()

  // ── 1. Create the sub-plan ────────────────────────────────────────────────
  page.once('dialog', dialog => dialog.accept('My Subplan'))
  await page.getByTitle('Add sub-plan under current selection').click()

  // The empty subplan card must appear in the tree view.
  const card = page.locator('main .bg-gray-800').filter({ hasText: 'My Subplan' }).first()
  await expect(card).toBeVisible({ timeout: 5000 })

  // Warning: no goals yet.
  await expect(card.getByText(/No goals/)).toBeVisible()

  // ── 2. Navigate into the subplan and add a goal ───────────────────────────
  await sidebar.getByText('My Subplan').first().click()
  // Confirm navigation: My Subplan has no goals yet (Main's goals panel doesn't show this)
  await expect(sidebar.getByText(/No goals yet/)).toBeVisible({ timeout: 3000 })

  await page.getByRole('button', { name: '+ Add' }).first().click()
  await page.getByPlaceholder('Search items…').fill('lubricant')
  // Same pattern as step 0: skip "Lubricant barrel", pick the lubricant fluid item.
  await pickerOverlay.getByRole('button', { name: /^Lubricant(?! barrel)/ }).first().click()

  // ── 3. Navigate back to the parent ───────────────────────────────────────
  await sidebar.getByText('Main').first().click()

  // Warning must have changed: goal is now set, but there are no recipe nodes.
  await expect(card.getByText(/No recipe nodes/)).toBeVisible({ timeout: 5000 })
  await expect(card.getByText(/No goals/)).not.toBeVisible()

  // ── 4. Navigate into the subplan and add a recipe node ────────────────────
  await sidebar.getByText('My Subplan').first().click()
  // Confirm navigation: My Subplan has no recipe nodes yet (Main's nodes panel shows subplan link, not this)
  await expect(sidebar.getByText(/No nodes yet/)).toBeVisible({ timeout: 3000 })

  await page.getByRole('button', { name: '+ Add' }).nth(1).click()
  await page.getByPlaceholder('Search recipes…').fill('lubricant')
  // Use /^Lubricant/ to match the lubricant-producing recipe, not "Fill lubricant barrel".
  await pickerOverlay.getByRole('button', { name: /^Lubricant/ }).first().click()

  // ── 5. Navigate back to the parent ───────────────────────────────────────
  await sidebar.getByText('Main').first().click()

  // Wait for the solver to finish — pin button appearing proves the subplan is fully solved.
  await expect(card.getByTitle('Pin scale')).toBeVisible({ timeout: 10000 })

  // All warnings gone — the solver now produces a result for this subplan.
  await expect(card.getByText(/No goals/)).not.toBeVisible()
  await expect(card.getByText(/No recipe nodes/)).not.toBeVisible()
})
