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

const horizonButton = (page: Page) => page.getByRole('button', { name: /^Horizon/ })
const tech = (page: Page, id: string) => page.locator(`[data-tech-id="${id}"]`)
const count = (page: Page) => page.getByTestId('horizon-recipe-count')

async function pickerRecipeIds(page: Page): Promise<string[]> {
  await page.getByText('+ Add recipe').click()
  await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
  const ids = await page.locator('[data-testid="recipe-slot"]').evaluateAll(
    els => els.map(e => e.getAttribute('data-recipe-id') ?? ''),
  )
  await page.getByRole('button', { name: 'Close' }).click()
  return ids.sort()
}

test.describe('Plan horizon', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('is hidden when the data set has no technology data', async ({ page }) => {
    const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
    delete data.technologies
    delete data.startingRecipes
    await upload(page, Buffer.from(JSON.stringify(data)))
    await expect(horizonButton(page)).toHaveCount(0)
  })

  test('setting a horizon limits the recipe picker', async ({ page }) => {
    await upload(page)
    await expect(horizonButton(page)).toHaveText('Horizon: none')
    await horizonButton(page).click()
    await tech(page, 'electronics').click()
    await expect(count(page)).toHaveText('3 of 6 recipes available')
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(horizonButton(page)).toHaveText('Horizon: Electronics')
    expect(await pickerRecipeIds(page)).toEqual(['electronic-circuit', 'iron-gear-wheel', 'iron-plate'])
  })

  test('changing and clearing the target', async ({ page }) => {
    await upload(page)
    await horizonButton(page).click()
    await tech(page, 'electronics').click()
    await tech(page, 'space-science-pack').click()
    await expect(count(page)).toHaveText('5 of 6 recipes available')
    await page.getByRole('button', { name: 'Done' }).click()
    expect(await pickerRecipeIds(page)).toEqual([
      'electronic-circuit', 'iron-gear-wheel', 'iron-plate', 'rocket-part', 'space-science-pack',
    ])

    await horizonButton(page).click()
    await page.getByRole('button', { name: 'Remove Electronics' }).click()
    // electronics is still a prerequisite of the remaining target.
    await expect(count(page)).toHaveText('5 of 6 recipes available')
    await page.getByRole('button', { name: 'Clear' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(horizonButton(page)).toHaveText('Horizon: none')
    expect(await pickerRecipeIds(page)).toHaveLength(6)
  })

  test('persists across a reload', async ({ page }) => {
    await upload(page)
    await horizonButton(page).click()
    await tech(page, 'electronics').click()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(horizonButton(page)).toHaveText('Horizon: Electronics')

    await page.reload()
    await expect(horizonButton(page)).toHaveText('Horizon: Electronics', { timeout: 10000 })
  })
})
