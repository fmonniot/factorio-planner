import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve('e2e/fixtures/game-data-horizon.json')

async function upload(page: Page, buffer: Buffer = fs.readFileSync(FIXTURE_PATH)) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'game-data-horizon.json',
    mimeType: 'application/json',
    buffer,
  })
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

async function hoverRecipe(page: Page, id: string) {
  await page.getByText('+ Add recipe').click()
  await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
  await page.locator(`[data-testid="recipe-slot"][data-recipe-id="${id}"]`).hover()
  return page.getByTestId('recipe-unlock')
}

test.describe('Recipe picker — unlocking technology', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('shows the technology, its packs and count without the time', async ({ page }) => {
    await upload(page)
    const unlock = await hoverRecipe(page, 'electronic-circuit')
    const row = unlock.locator('[data-tech-id="electronics"]')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('Electronics')
    await expect(unlock.getByTitle('Iron plate ×1')).toBeVisible()
    const cost = unlock.getByTestId('tech-cost')
    await expect(cost).toContainText('×10')
    await expect(cost).not.toContainText('·')
    await expect(cost).not.toContainText('5s')
  })

  test('shows every science pack of a multi-pack technology', async ({ page }) => {
    await upload(page)
    const unlock = await hoverRecipe(page, 'rocket-part')
    await expect(unlock.getByTitle('Iron plate ×1')).toBeVisible()
    await expect(unlock.getByTitle('Electronic circuit ×1')).toBeVisible()
    const cost = unlock.getByTestId('tech-cost')
    await expect(cost).toContainText('×100')
    await expect(cost).not.toContainText('30s')
  })

  test('shows Trigger for a research-trigger technology', async ({ page }) => {
    await upload(page)
    const unlock = await hoverRecipe(page, 'space-science-pack')
    await expect(unlock.getByTestId('tech-cost')).toHaveText('Trigger')
  })

  test('shows no cost for a technology without cost data', async ({ page }) => {
    await upload(page)
    const unlock = await hoverRecipe(page, 'advanced-iron-smelting')
    await expect(unlock.locator('[data-tech-id="advanced-material-processing"]')).toHaveCount(1)
    await expect(unlock.getByTestId('tech-cost')).toHaveCount(0)
  })

  test('reads "Available from the start" for a starting recipe', async ({ page }) => {
    await upload(page)
    const unlock = await hoverRecipe(page, 'iron-plate')
    await expect(unlock).toContainText('Available from the start')
    await expect(unlock.getByTestId('recipe-unlock-tech')).toHaveCount(0)
  })

  test('lists every technology that unlocks the recipe', async ({ page }) => {
    const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
    data.technologies['rocket-silo'].unlockedRecipes.push('electronic-circuit')
    await upload(page, Buffer.from(JSON.stringify(data)))
    const unlock = await hoverRecipe(page, 'electronic-circuit')
    await expect(unlock.getByTestId('recipe-unlock-tech')).toHaveCount(2)
    const ids = await unlock.getByTestId('recipe-unlock-tech').evaluateAll(els => els.map(e => e.getAttribute('data-tech-id')))
    expect(ids).toEqual(['electronics', 'rocket-silo'])
  })

  test('is absent when the data set has no technology data', async ({ page }) => {
    const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
    delete data.technologies
    delete data.startingRecipes
    await upload(page, Buffer.from(JSON.stringify(data)))
    const unlock = await hoverRecipe(page, 'electronic-circuit')
    await expect(page.getByTestId('recipe-detail-panel')).toBeVisible()
    await expect(unlock).toHaveCount(0)
  })
})
