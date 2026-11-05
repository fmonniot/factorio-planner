import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'

const FIXTURE_PATH = path.resolve('e2e/fixtures/game-data-horizon.json')

/** The horizon fixture with a 90 kW fluid-burning furnace smelting iron plates and two fluids with a fuel value. */
function makeGameData(energyType: 'fluid-burner' | 'void') {
  const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
  const fluid = (id: string, name: string, fuelValueKj: number) => ({
    id, name, type: 'fluid', iconPath: '', hidden: false, subgroup: 'intermediate', order: `x-${id}`, fuelValueKj,
  })
  data.items['light-oil'] = fluid('light-oil', 'Light oil', 100)
  data.items['heavy-oil'] = fluid('heavy-oil', 'Heavy oil', 300)
  data.machines['stone-furnace'] = { ...data.machines['stone-furnace'], name: 'Fluid furnace', energyType }
  return data
}

async function upload(page: Page, data: unknown) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'game-data-fluid-burner.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  })
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

/** 60 iron plates per minute smelted by one row. */
async function addPlateRow(page: Page) {
  const overlay = page.locator('.fixed.inset-0')
  await page.getByTitle('Add product').click()
  await overlay.locator('[data-testid="item-slot"][data-item-id="iron-plate"]').click()
  await expect(overlay).not.toBeVisible()
  await page.getByRole('button', { name: 'Add recipe' }).click()
  await page.locator('[data-testid="recipe-slot"][data-recipe-id="iron-plate"]').click()
}

/** The plans saved in localStorage, as one string. */
const storedPlans = (page: Page) =>
  page.evaluate(() => {
    let all = ''
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      if (key.startsWith('factorio-planner:plan:')) all += localStorage.getItem(key)
    }
    return all
  })

test.describe('Fluid-burning machines', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('a fluid-burning row burns a fluid that is one of its ingredients', async ({ page }) => {
    await upload(page, makeGameData('fluid-burner'))
    await addPlateRow(page)
    const row = page.locator('main table tbody tr').first()
    await expect(row).toBeVisible()

    // Default: the lowest-value fluid, as an ingredient tile; no electricity draw.
    const fuel = row.locator('[data-fuel="true"]')
    await expect(fuel).toHaveCount(1)
    await expect(fuel).toHaveAttribute('title', /^Fuel: Light oil — Find producer recipe — \S+$/)
    await expect(row.locator('[data-testid="row-power"]')).toHaveCount(0)

    // Pick the other fluid in the side panel's Machine section.
    await row.getByTitle('Fluid furnace', { exact: true }).click()
    await expect(page.getByTestId('fuel-button')).toContainText('Light oil')
    await page.getByTestId('fuel-button').click()
    await page.locator('[data-testid="fuel-option"][data-item-id="heavy-oil"]').click()
    await expect(page.getByTestId('fuel-button')).toContainText('Heavy oil')

    await expect(fuel).toHaveAttribute('title', /^Fuel: Heavy oil — Find producer recipe — \S+$/)
    await expect(row.locator('[data-testid="row-power"]')).toHaveCount(0)
    expect(await storedPlans(page)).toContain('"fuelItemId":"heavy-oil"')
  })

  test('the same machine exported as void keeps its electricity draw', async ({ page }) => {
    await upload(page, makeGameData('void'))
    await addPlateRow(page)
    const row = page.locator('main table tbody tr').first()
    await expect(row).toBeVisible()
    await expect(row.locator('[data-fuel="true"]')).toHaveCount(0)
    await expect(row.locator('[data-testid="row-power"]')).toHaveCount(1)
  })
})
