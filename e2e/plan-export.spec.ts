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

    const overlay = page.locator('.fixed.inset-0')

    // Add a goal via FactorySummary [+]
    await page.getByTitle('Add goal').click()
    await page.getByPlaceholder('Search items…').fill('nullius-chemical-pack')
    await overlay.getByRole('button', { name: /Chemistry research/ }).first().click()

    // Add a recipe via ProductionTable
    await page.getByText('+ Add recipe').click()
    await page.getByPlaceholder('Search recipes…').fill('Chemistry research 1')
    await overlay.getByRole('button', { name: 'Chemistry research 1' }).first().click()

    // Wait for the recipe row to appear.
    const row = page.locator('main table tbody tr').filter({ has: page.locator('[title="Chemistry research 1"]') }).first()
    await expect(row).toBeVisible()

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

    expect(parsed).toHaveProperty('blocks')
    expect(parsed).toHaveProperty('activeBlockId')
    expect(Array.isArray(parsed.blocks)).toBe(true)
    expect(parsed.blocks.length).toBeGreaterThan(0)

    const rootPlan = parsed.blocks[0].rootPlan
    expect(rootPlan.goals.length).toBeGreaterThan(0)
    expect(rootPlan.goals[0].itemId).toBe('nullius-chemical-pack')
    expect(rootPlan.nodes.length).toBeGreaterThan(0)
    expect(rootPlan.nodes[0].recipeId).toBe('nullius-chemical-pack')
  })

  test('loadPlanFixture round-trip: exported fixture restores the plan on reload', async ({ page }) => {
    const fixturePath = path.resolve('e2e/fixtures/chemistry-research-1.json')
    const { existsSync } = await import('fs')
    if (!existsSync(fixturePath)) {
      test.skip(true, 'Fixture e2e/fixtures/chemistry-research-1.json not yet created — export it from the app first')
      return
    }

    await loadPlanFixture(page, fixturePath)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

    // The recipe row should appear after reload without UI interaction.
    await expect(
      page.locator('main table tbody tr').filter({ has: page.locator('[title="Chemistry research 1"]') }).first()
    ).toBeVisible()
  })
})
