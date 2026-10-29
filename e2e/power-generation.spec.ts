import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { openHorizonTree, closeHorizonTree } from './support/horizon'
import { openAppMenu } from './support/appMenu'
import { clickRowAction } from './support/rowMenu'
import { slot } from './support/summary'

const FIXTURE_PATH = path.resolve('e2e/fixtures/game-data-horizon.json')

/** The horizon fixture plus the electricity item, a boiler, a steam engine, a solar panel and their power recipes. */
function powerFixture() {
  const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
  const fluid = (id: string, name: string, order: string) => ({
    id, name, type: 'fluid', iconPath: '', hidden: false, subgroup: 'intermediate', order,
  })
  data.items.water = fluid('water', 'Water', 'x1')
  data.items.steam = fluid('steam', 'Steam', 'x2')
  data.items.coal = { id: 'coal', name: 'Coal', type: 'item', iconPath: '', hidden: false, subgroup: 'intermediate', order: 'x3' }
  data.items['power:electricity'] = {
    id: 'power:electricity', name: 'Electricity', type: 'fluid', iconPath: '', hidden: false, subgroup: 'power:electricity', order: 'a',
  }
  data.itemGroups['power:power'] = { id: 'power:power', name: 'Power', order: 'zz', iconPath: '' }
  for (const [id, order] of [['electricity', 'a'], ['boilers', 'b'], ['generators', 'c'], ['solar-panels', 'e']]) {
    data.itemSubgroups[`power:${id}`] = { id: `power:${id}`, group: 'power:power', order }
  }
  const machine = (id: string, name: string, type: string) => ({
    id, name, type, craftingSpeed: 1, energyUsageKw: 0, energyType: 'void', drainKw: 0, moduleSlots: 0,
    allowedEffects: [], craftingCategories: [`power:${id}`], iconPath: '', hidden: false,
  })
  data.machines.boiler = machine('boiler', 'Boiler', 'boiler')
  data.machines['steam-engine'] = machine('steam-engine', 'Steam engine', 'generator')
  data.machines['solar-panel'] = machine('solar-panel', 'Solar panel', 'solar-panel')
  const recipe = (id: string, name: string, category: string, subgroup: string, ingredients: object[], products: object[], mainProduct: string) => ({
    id, name, category, craftingTime: 1, ingredients, products, madeIn: [category.slice('power:'.length)],
    allowProductivity: false, hidden: false, mainProduct, subgroup, order: '', power: true,
  })
  data.recipes['power:boiler:coal'] = recipe(
    'power:boiler:coal', 'Boiler (Coal)', 'power:boiler', 'power:boilers',
    [{ itemId: 'water', type: 'fluid', amount: 60 }, { itemId: 'coal', type: 'item', amount: 0.45 }],
    [{ itemId: 'steam', type: 'fluid', amount: 60 }], 'steam',
  )
  data.recipes['power:steam-engine:steam'] = recipe(
    'power:steam-engine:steam', 'Steam engine (Steam)', 'power:steam-engine', 'power:generators',
    [{ itemId: 'steam', type: 'fluid', amount: 30, minimumTemperature: 165 }],
    [{ itemId: 'power:electricity', type: 'fluid', amount: 0.9 }], 'power:electricity',
  )
  data.recipes['power:solar-panel'] = recipe(
    'power:solar-panel', 'Solar panel', 'power:solar-panel', 'power:solar-panels',
    [], [{ itemId: 'power:electricity', type: 'fluid', amount: 0.042 }], 'power:electricity',
  )
  for (const m of ['boiler', 'steam-engine', 'solar-panel']) data.defaultMachines[`power:${m}`] = m
  return data
}

async function upload(page: Page, data: unknown) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'game-data-power.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)),
  })
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

/** Open Add product, pick Electricity in the Power tab with `amount` MW. */
async function addElectricityGoal(page: Page, amount: string) {
  const overlay = page.locator('.fixed.inset-0')
  await page.getByTitle('Add product').click()
  await overlay.getByLabel('Amount').fill(amount)
  await overlay.locator('[data-testid="item-group-tab"][data-group-id="power:power"]').click()
  await overlay.locator('[data-testid="item-slot"][data-item-id="power:electricity"]').click()
  await expect(overlay).not.toBeVisible()
}

async function addRecipe(page: Page, recipeId: string) {
  await page.getByRole('button', { name: 'Add recipe' }).click()
  await page.locator('[data-testid="recipe-group-tab"][data-group-id="power:power"]').click()
  await page.locator(`[data-testid="recipe-slot"][data-recipe-id="${recipeId}"]`).click()
}

/** Every `pinnedRate` in the plans saved in localStorage. */
async function storedPinnedRates(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const found: number[] = []
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === 'pinnedRate' && typeof x === 'number') found.push(x)
          else walk(x)
        }
      }
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      if (key.startsWith('factorio-planner:plan:')) walk(JSON.parse(localStorage.getItem(key)!))
    }
    return found
  })
}

test.describe('Power generation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await upload(page, powerFixture())
  })

  test('10 MW needs 12 steam engines on 6 boilers and 150 coal per minute', async ({ page }) => {
    await addElectricityGoal(page, '10')
    await addRecipe(page, 'power:steam-engine:steam')
    const electricity = slot(page, 'Products', 'Electricity')
    await expect(electricity).toContainText('10.0MW')
    await expect(electricity).toHaveAccessibleName('Electricity, 10.0 MW')
    const rows = page.locator('main table tbody tr')
    const engine = rows.first()
    await expect(engine.getByTitle('Steam engine', { exact: true })).toHaveText(/^\??12$/)
    await expect(engine.locator('[data-variant="product"]')).toContainText('10.0MW')
    await expect(engine.locator('[data-variant="electricity"]')).toHaveCount(0)

    await engine.locator('button[title^="Steam ("]').first().click()
    await page.locator('[data-testid="recipe-slot"][data-recipe-id="power:boiler:coal"]').click()
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(1).getByTitle('Boiler', { exact: true })).toHaveText(/^\??6$/)
    await expect(slot(page, 'Ingredients', 'Coal')).toHaveAccessibleName('Coal, 150 per minute')
  })

  test('electricity stays in MW per second while other rates switch', async ({ page }) => {
    await addElectricityGoal(page, '10')
    await addRecipe(page, 'power:steam-engine:steam')
    const engine = page.locator('main table tbody tr').first()
    await engine.locator('button[title^="Steam ("]').first().click()
    await page.locator('[data-testid="recipe-slot"][data-recipe-id="power:boiler:coal"]').click()

    const menu = await openAppMenu(page)
    await menu.getByRole('menuitemradio', { name: '/sec' }).click()
    await expect(slot(page, 'Products', 'Electricity')).toContainText('10.0MW')
    await expect(slot(page, 'Ingredients', 'Coal')).toHaveAccessibleName('Coal, 2.50 per second')

    // The pin is typed in MW: 9 MW is 600 executions per minute of the 0.9 MJ recipe.
    await clickRowAction(page, engine, 'Pin rate')
    const pinned = engine.getByLabel('Pinned rate')
    await expect(pinned).toHaveValue('10.0')
    await pinned.fill('9')
    await pinned.press('Tab')
    await expect.poll(() => storedPinnedRates(page)).toContain(600)
    await expect(pinned).toHaveValue('9')
  })

  test('1 MW of solar panels is 24 panels', async ({ page }) => {
    await addElectricityGoal(page, '1')
    await addRecipe(page, 'power:solar-panel')
    const panel = page.locator('main table tbody tr').first().locator('button[title="Solar panel"]')
    await expect(panel).toHaveText(/^\??24$/)
  })

  test('power recipes and electricity ignore the research horizon', async ({ page }) => {
    await openHorizonTree(page)
    await page.locator('[data-tech-id="electronics"]').click()
    await closeHorizonTree(page)

    await page.getByRole('button', { name: 'Add recipe' }).click()
    await page.locator('[data-testid="recipe-group-tab"][data-group-id="power:power"]').click()
    const recipeIds = await page.locator('[data-testid="recipe-slot"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-recipe-id') ?? ''),
    )
    expect(recipeIds).toContain('power:steam-engine:steam')
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByTitle('Add product').click()
    await page.locator('[data-testid="item-group-tab"][data-group-id="power:power"]').click()
    const itemIds = await page.locator('[data-testid="item-slot"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-item-id') ?? ''),
    )
    expect(itemIds).toContain('power:electricity')
  })
})
