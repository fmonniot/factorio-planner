import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { exportPlan } from './support/appMenu'

const GAME_DATA_PATH = path.resolve('public/data/nullius/game-data.json')

async function loadGameData(page: import('@playwright/test').Page) {
  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(GAME_DATA_PATH)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

test.describe('Plan export', () => {
  test('Export plan downloads valid JSON containing blocks and activeBlockId', async ({ page }) => {
    await page.goto('/')
    await loadGameData(page)

    const overlay = page.locator('.fixed.inset-0')

    // Add a goal via FactorySummary [+]
    await page.getByTitle('Add goal').click()
    await overlay.getByPlaceholder('Search…').fill('nullius-chemical-pack')
    await overlay.locator('[data-testid="item-slot"]').first().click()

    // Add a recipe via ProductionTable
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await overlay.getByPlaceholder('Search…').fill('Chemistry research 1')
    await overlay.locator('[data-testid="recipe-slot"][title="Chemistry research 1"]').click()

    // Wait for the recipe row to appear.
    const row = page.locator('main table tbody tr').filter({ has: page.locator('[title="Chemistry research 1"]') }).first()
    await expect(row).toBeVisible()

    // Trigger the download and capture it.
    const download = await exportPlan(page)

    // Filename carries the plan name: factorio-plan-<slug>-YYYY-MM-DD.json.
    expect(download.suggestedFilename()).toMatch(/^factorio-plan-plan-1-\d{4}-\d{2}-\d{2}\.json$/)

    // Read and parse the downloaded content.
    const filePath = await download.path()
    const { readFileSync } = await import('fs')
    const content = readFileSync(filePath!, 'utf8')
    const parsed = JSON.parse(content)

    expect(parsed).toHaveProperty('blocks')
    expect(parsed).toHaveProperty('activeBlockId')
    expect(parsed.dataSet.id).toMatch(/^custom:game-data\.json#[0-9a-f]{8}$/)
    expect(parsed.dataSet.name).toBe('game-data.json')
    expect(typeof parsed.dataSet.factorioVersion).toBe('string')
    expect(parsed.dataSet.factorioVersion.length).toBeGreaterThan(0)
    expect(Array.isArray(parsed.blocks)).toBe(true)
    expect(parsed.blocks.length).toBeGreaterThan(0)

    const block = parsed.blocks[0]
    expect(block, 'exported block has no gameDataVersion').not.toHaveProperty('gameDataVersion')
    expect(block, 'exported block has no legacy goals').not.toHaveProperty('goals')
    expect(block.products.length).toBeGreaterThan(0)
    expect(block.products[0]).toMatchObject({ itemId: 'nullius-chemical-pack' })
    expect(block.products[0].extraRate).toBeGreaterThan(0)
    expect(block.rootPlan.nodes.length).toBeGreaterThan(0)
    expect(block.rootPlan.nodes[0].recipeId).toBe('nullius-chemical-pack')
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
