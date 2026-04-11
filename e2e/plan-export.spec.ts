import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

const GAME_DATA_PATH = path.resolve('data/samples/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

test.describe('Plan export', () => {
  test('Export plan button downloads valid JSON containing blocks and activeBlockId', async ({ page }) => {
    await page.goto('/')
    await loadGameData(page)

    // Add a goal and recipe node so the exported state is non-trivial.
    const overlay = page.locator('.fixed.inset-0')
    await page.getByRole('button', { name: '+ Add' }).first().click()
    await page.getByPlaceholder('Search items…').fill('nullius-chemical-pack')
    await overlay.getByRole('button', { name: /Chemistry research/ }).first().click()

    await page.getByRole('button', { name: '+ Add' }).nth(1).click()
    await page.getByPlaceholder('Search recipes…').fill('Chemistry research 1')
    await overlay.getByRole('button', { name: 'Chemistry research 1' }).first().click()

    // Wait for the recipe card to appear so state is fully settled.
    await expect(page.locator('main').locator('.bg-gray-800').filter({ hasText: 'Chemistry research 1' }).first()).toBeVisible()

    // Trigger the download and capture it.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export plan' }).click(),
    ])

    // Filename should match the pattern factorio-plan-YYYY-MM-DD.json.
    expect(download.suggestedFilename()).toMatch(/^factorio-plan-\d{4}-\d{2}-\d{2}\.json$/)

    // Read and parse the downloaded content.
    const filePath = await download.path()
    const { readFileSync } = await import('fs')
    const content = readFileSync(filePath!, 'utf8')
    const parsed = JSON.parse(content)

    // Must contain the required AppState fields.
    expect(parsed).toHaveProperty('blocks')
    expect(parsed).toHaveProperty('activeBlockId')
    expect(Array.isArray(parsed.blocks)).toBe(true)
    expect(parsed.blocks.length).toBeGreaterThan(0)

    // The exported block should contain the goal we added.
    const rootPlan = parsed.blocks[0].rootPlan
    expect(rootPlan.goals.length).toBeGreaterThan(0)
    expect(rootPlan.goals[0].itemId).toBe('nullius-chemical-pack')

    // And the recipe node.
    expect(rootPlan.nodes.length).toBeGreaterThan(0)
    expect(rootPlan.nodes[0].recipeId).toBe('nullius-chemical-pack')
  })

  test('loadPlanFixture round-trip: exported fixture restores the plan on reload', async ({ page }) => {
    // This test uses the pre-built sample fixture (a simple Chemistry research 1 plan).
    // To create: export from the app and save to e2e/fixtures/chemistry-research-1.json.
    const fixturePath = path.resolve('e2e/fixtures/chemistry-research-1.json')

    // Skip if the fixture doesn't exist yet — it must be created by the user via the export button.
    const { existsSync } = await import('fs')
    if (!existsSync(fixturePath)) {
      test.skip(true, 'Fixture e2e/fixtures/chemistry-research-1.json not yet created — export it from the app first')
      return
    }

    await loadPlanFixture(page, fixturePath)

    // After reload, game data loads (nullius is auto-selected) and the plan is restored.
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

    // The recipe card should appear without any UI interaction.
    await expect(
      page.locator('main').locator('.bg-gray-800').filter({ hasText: 'Chemistry research 1' }).first()
    ).toBeVisible()
  })
})
