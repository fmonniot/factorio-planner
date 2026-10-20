import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve('e2e/fixtures/game-data-horizon.json')

/** The horizon fixture plus a mining drill, an offshore pump and the extraction recipes that use them. */
function extractionFixture() {
  const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
  data.items.water = {
    id: 'water', name: 'Water', type: 'fluid', iconPath: '', hidden: false, subgroup: 'intermediate', order: 'b',
  }
  const machine = (id: string, name: string, type: string, craftingSpeed: number, energyUsageKw: number, energyType: string, category: string) => ({
    id, name, type, craftingSpeed, energyUsageKw, energyType, drainKw: 0, moduleSlots: 0,
    allowedEffects: [], craftingCategories: [category], iconPath: '', hidden: false,
  })
  data.machines['electric-mining-drill'] = machine(
    'electric-mining-drill', 'Electric mining drill', 'mining-drill', 0.5, 90, 'electric', 'mining:basic-solid',
  )
  data.machines['offshore-pump'] = machine(
    'offshore-pump', 'Offshore pump', 'offshore-pump', 20, 0, 'void', 'offshore:water',
  )
  data.recipes['mining:iron-ore'] = {
    id: 'mining:iron-ore', name: 'Iron ore (mining)', category: 'mining:basic-solid', craftingTime: 1,
    ingredients: [], products: [{ itemId: 'iron-ore', type: 'item', amount: 1, probability: 1 }],
    madeIn: ['electric-mining-drill'], allowProductivity: true, hidden: false, mainProduct: 'iron-ore',
    subgroup: 'intermediate', order: 'a', extraction: true,
  }
  data.recipes['offshore:water'] = {
    id: 'offshore:water', name: 'Water (offshore pump)', category: 'offshore:water', craftingTime: 1,
    ingredients: [], products: [{ itemId: 'water', type: 'fluid', amount: 60 }],
    madeIn: ['offshore-pump'], allowProductivity: false, hidden: false, mainProduct: 'water',
    subgroup: 'intermediate', order: 'b', extraction: true,
  }
  data.defaultMachines['mining:basic-solid'] = 'electric-mining-drill'
  data.defaultMachines['offshore:water'] = 'offshore-pump'
  return data
}

async function upload(page: Page, data: unknown) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'game-data-extraction.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  })
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

async function addGoal(page: Page, itemId: string, amount: string) {
  const overlay = page.locator('.fixed.inset-0')
  await page.getByTitle('Add goal').click()
  await overlay.getByLabel('Amount').fill(amount)
  await overlay.locator(`[data-testid="item-slot"][data-item-id="${itemId}"]`).click()
  await expect(overlay).not.toBeVisible()
}

async function addRecipe(page: Page, recipeId: string) {
  await page.getByRole('button', { name: 'Add recipe' }).click()
  await page.locator(`[data-testid="recipe-slot"][data-recipe-id="${recipeId}"]`).click()
}

test.describe('Extraction recipes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await upload(page, extractionFixture())
  })

  test('an ore is mined from the ingredient tile', async ({ page }) => {
    await addGoal(page, 'iron-plate', '60')
    await addRecipe(page, 'iron-plate')
    await page.locator('main table tbody tr').first().locator('button[title^="Iron ore"]').first().click()
    await page.locator('[data-testid="recipe-slot"][data-recipe-id="mining:iron-ore"]').click()

    const rows = page.locator('main table tbody tr')
    await expect(rows).toHaveCount(2)
    const drill = rows.nth(1).getByTitle('Electric mining drill', { exact: true })
    await expect(drill).toBeVisible()
    await expect(drill).toHaveText(/^\??2$/)
  })

  test('an offshore pump produces water', async ({ page }) => {
    await addGoal(page, 'water', '72000')
    await addRecipe(page, 'offshore:water')
    const row = page.locator('main table tbody tr').first()
    const pump = row.getByTitle('Offshore pump', { exact: true })
    await expect(pump).toBeVisible()
    await expect(pump).toHaveText(/^\??1$/)
  })

  test('extraction recipes ignore the research horizon', async ({ page }) => {
    await page.getByRole('button', { name: /^Horizon/ }).click()
    await page.locator('[data-tech-id="electronics"]').click()
    await page.getByRole('button', { name: 'Done' }).click()

    await page.getByRole('button', { name: 'Add recipe' }).click()
    const recipeIds = await page.locator('[data-testid="recipe-slot"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-recipe-id') ?? ''),
    )
    expect(recipeIds).toContain('mining:iron-ore')
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByTitle('Add goal').click()
    const itemIds = await page.locator('[data-testid="item-slot"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-item-id') ?? ''),
    )
    expect(itemIds).toContain('iron-ore')
  })
})
