import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { openHorizonTree, closeHorizonTree } from './support/horizon'
import { openAppMenu } from './support/appMenu'
import { sidePanel, selectRow, openMachinePicker } from './support/sidePanel'
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
  // Two more fuels, so the boiler has several recipes and the pickers collapse them into one entry.
  for (const [id, name, amount] of [['wood', 'Wood', 0.9], ['solid-fuel', 'Solid fuel', 0.3]] as const) {
    data.items[id] = { id, name, type: 'item', iconPath: '', hidden: false, subgroup: 'intermediate', order: `x-${id}` }
    data.recipes[`power:boiler:${id}`] = recipe(
      `power:boiler:${id}`, `Boiler (${name})`, 'power:boiler', 'power:boilers',
      [{ itemId: 'water', type: 'fluid', amount: 60 }, { itemId: id, type: 'item', amount }],
      [{ itemId: 'steam', type: 'fluid', amount: 60 }], 'steam',
    )
  }
  // Solid fuel has a producer unlocked by a far-off technology, so its boiler recipe lies beyond an early horizon.
  data.recipes['solid-fuel-synthesis'] = {
    ...structuredClone(data.recipes['iron-plate']), id: 'solid-fuel-synthesis', name: 'Solid fuel synthesis',
    ingredients: [{ itemId: 'iron-ore', type: 'item', amount: 1 }],
    products: [{ itemId: 'solid-fuel', type: 'item', amount: 1 }], mainProduct: undefined,
  }
  data.technologies['rocket-silo'].unlockedRecipes.push('solid-fuel-synthesis')
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

/** The power fixture plus the heat item, a heat exchanger, a nuclear reactor and their recipes. */
function heatFixture() {
  const data = powerFixture()
  data.items['power:heat'] = {
    id: 'power:heat', name: 'Heat', type: 'fluid', iconPath: '', hidden: false, subgroup: 'power:electricity', order: 'b',
  }
  for (const [id, name, order] of [['uranium-fuel-cell', 'Uranium fuel cell', 'x4'], ['depleted-uranium-fuel-cell', 'Depleted uranium fuel cell', 'x5']]) {
    data.items[id] = { id, name, type: 'item', iconPath: '', hidden: false, subgroup: 'intermediate', order }
  }
  data.itemSubgroups['power:reactors'] = { id: 'power:reactors', group: 'power:power', order: 'f' }
  const machine = (id: string, name: string, type: string, extra: object = {}) => ({
    id, name, type, craftingSpeed: 1, energyUsageKw: 0, energyType: 'void', drainKw: 0, moduleSlots: 0,
    allowedEffects: [], craftingCategories: [`power:${id}`], iconPath: '', hidden: false, ...extra,
  })
  data.machines['heat-exchanger'] = machine('heat-exchanger', 'Heat exchanger', 'boiler')
  data.machines['nuclear-reactor'] = machine('nuclear-reactor', 'Nuclear reactor', 'reactor', { neighbourBonus: 1 })
  const recipe = (id: string, name: string, category: string, subgroup: string, ingredients: object[], products: object[], mainProduct: string) => ({
    id, name, category, craftingTime: 1, ingredients, products, madeIn: [category.slice('power:'.length)],
    allowProductivity: false, hidden: false, mainProduct, subgroup, order: '', power: true,
  })
  data.recipes['power:heat-exchanger:power:heat'] = recipe(
    'power:heat-exchanger:power:heat', 'Heat exchanger (Heat)', 'power:heat-exchanger', 'power:boilers',
    [{ itemId: 'water', type: 'fluid', amount: 120 }, { itemId: 'power:heat', type: 'fluid', amount: 7.2 }],
    [{ itemId: 'steam', type: 'fluid', amount: 120 }], 'steam',
  )
  data.recipes['power:nuclear-reactor:uranium-fuel-cell'] = recipe(
    'power:nuclear-reactor:uranium-fuel-cell', 'Nuclear reactor (Uranium fuel cell)', 'power:nuclear-reactor', 'power:reactors',
    [{ itemId: 'uranium-fuel-cell', type: 'item', amount: 0.0054 }],
    [{ itemId: 'power:heat', type: 'fluid', amount: 10.8 }, { itemId: 'depleted-uranium-fuel-cell', type: 'item', amount: 0.0054 }],
    'power:heat',
  )
  for (const m of ['heat-exchanger', 'nuclear-reactor']) data.defaultMachines[`power:${m}`] = m
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

/** In the open recipe picker (Power tab), open the boiler's fuel view and pick the recipe for `recipeId`. */
async function pickBoilerFuel(page: Page, recipeId: string) {
  await page.locator('[data-testid="recipe-group-slot"][data-machine-id="boiler"]').click()
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
    await expect(engine.locator('[data-testid="row-power"]')).toHaveCount(0)
    // Generators draw nothing, so the header shows no power total.
    await expect(page.getByTestId('block-power-total')).toHaveCount(0)

    await engine.locator('button[title^="Steam ("]').first().click()
    await pickBoilerFuel(page, 'power:boiler:coal')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(1).getByTitle('Boiler', { exact: true })).toHaveText(/^\??6$/)
    await expect(slot(page, 'Ingredients', 'Coal')).toHaveAccessibleName('Coal, 150 per minute')
  })

  test('electricity stays in MW per second while other rates switch', async ({ page }) => {
    await addElectricityGoal(page, '10')
    await addRecipe(page, 'power:steam-engine:steam')
    const engine = page.locator('main table tbody tr').first()
    await engine.locator('button[title^="Steam ("]').first().click()
    await pickBoilerFuel(page, 'power:boiler:coal')

    const menu = await openAppMenu(page)
    await menu.getByRole('menuitemradio', { name: '/sec' }).click()
    await expect(slot(page, 'Products', 'Electricity')).toContainText('10.0MW')
    await expect(slot(page, 'Ingredients', 'Coal')).toHaveAccessibleName('Coal, 2.50 per second')

    // The pin is typed in MW: 9 MW is 600 executions per minute of the 0.9 MJ recipe.
    const panel = await selectRow(page, engine)
    await panel.getByRole('checkbox', { name: 'Pin rate' }).check()
    const pinned = panel.getByLabel('Pinned rate')
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

  test('power recipes stay inside the horizon unless their fuel is beyond it', async ({ page }) => {
    await openHorizonTree(page)
    await page.locator('[data-tech-id="electronics"]').click()
    await closeHorizonTree(page)

    await page.getByRole('button', { name: 'Add recipe' }).click()
    await page.locator('[data-testid="recipe-group-tab"][data-group-id="power:power"]').click()
    const recipeIds = await page.locator('[data-testid="recipe-slot"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-recipe-id') ?? ''),
    )
    expect(recipeIds).toContain('power:steam-engine:steam')
    const boilerGroup = page.locator('[data-testid="recipe-group-slot"][data-machine-id="boiler"]')
    await expect(boilerGroup).toBeVisible()
    // Solid fuel is only produced by a recipe outside the horizon, so its boiler recipe is hidden.
    await expect(boilerGroup).toHaveAttribute('data-recipe-count', '2')
    await page.getByRole('button', { name: 'Close' }).click()

    await page.getByTitle('Add product').click()
    await page.locator('[data-testid="item-group-tab"][data-group-id="power:power"]').click()
    const itemIds = await page.locator('[data-testid="item-slot"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-item-id') ?? ''),
    )
    expect(itemIds).toContain('power:electricity')
  })

  test('a multi-fuel boiler is one picker slot that opens its fuels', async ({ page }) => {
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await page.locator('[data-testid="recipe-group-tab"][data-group-id="power:power"]').click()
    const group = page.locator('[data-testid="recipe-group-slot"][data-machine-id="boiler"]')
    await expect(group).toHaveCount(1)
    await expect(group.getByTestId('recipe-group-count')).toHaveText('3')
    await expect(page.locator('[data-testid="recipe-slot"][data-recipe-id^="power:boiler:"]')).toHaveCount(0)

    await group.click()
    await expect(page.getByTestId('recipe-fuel-grid').getByTestId('recipe-slot')).toHaveCount(3)
    await page.getByTestId('recipe-fuel-back').click()
    await expect(group).toBeVisible()
    await expect(page.getByTestId('recipe-fuel-grid')).toHaveCount(0)
  })

  test('searching for one fuel gives a plain slot that adds the row', async ({ page }) => {
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await page.getByPlaceholder('Search…').fill('Boiler (Wood)')
    await expect(page.getByTestId('recipe-group-slot')).toHaveCount(0)
    await page.locator('[data-testid="recipe-slot"][data-recipe-id="power:boiler:wood"]').click()
    await expect(page.locator('main table tbody tr')).toHaveCount(1)
  })

  test('the side panel swaps a boiler fuel from a collapsed Alternate recipe group', async ({ page }) => {
    await addElectricityGoal(page, '10')
    await addRecipe(page, 'power:steam-engine:steam')
    const rows = page.locator('main table tbody tr')
    await rows.first().locator('button[title^="Steam ("]').first().click()
    await pickBoilerFuel(page, 'power:boiler:coal')
    await expect(slot(page, 'Ingredients', 'Coal')).toBeVisible()

    await rows.nth(1).getByTitle('Boiler', { exact: true }).click()
    await openMachinePicker(page)
    const group = page.locator('[data-testid="alt-recipe-group"][data-machine-id="boiler"]')
    await expect(group).toHaveAttribute('data-recipe-count', '2')
    await group.click()
    await page.locator('[data-testid="alt-recipe-fuel"][data-recipe-id="power:boiler:wood"]').click()

    await expect(slot(page, 'Ingredients', 'Wood')).toBeVisible()
    await expect(slot(page, 'Ingredients', 'Coal')).toHaveCount(0)
  })
})

test.describe('Heat', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await upload(page, heatFixture())
  })

  test('10.8 MW of steam engines on heat exchangers and nuclear reactors', async ({ page }) => {
    await addElectricityGoal(page, '10.8')
    await addRecipe(page, 'power:steam-engine:steam')
    const rows = page.locator('main table tbody tr')
    await rows.first().locator('button[title^="Steam ("]').first().click()
    await page.locator('[data-testid="recipe-slot"][data-recipe-id="power:heat-exchanger:power:heat"]').click()
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(1).getByTitle('Heat exchanger', { exact: true })).toHaveText(/^\??3$/)
    const heat = slot(page, 'Ingredients', 'Heat')
    await expect(heat).toHaveAccessibleName('Heat, 21.6 MW')
    await expect(heat).toContainText('21.6MW')

    await rows.nth(1).locator('button[title^="Heat — Find producer recipe"]').click()
    await page.locator('[data-testid="recipe-slot"][data-recipe-id="power:nuclear-reactor:uranium-fuel-cell"]').click()
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(2).getByTitle('Nuclear reactor', { exact: true })).toHaveText(/^\??2$/)
    await expect(slot(page, 'Ingredients', 'Uranium fuel cell')).toHaveAccessibleName('Uranium fuel cell, 0.65 per minute')
    await expect(slot(page, 'Ingredients', 'Heat')).toHaveCount(0)

    await rows.nth(1).getByTitle('Heat exchanger', { exact: true }).click()
    await expect(page.getByTestId('neighbour-section')).toHaveCount(0)
  })

  test('heat is typed in MW and stays in MW per second', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByTitle('Add product').click()
    await expect(overlay.getByText('/min (MW for Electricity and Heat)')).toBeVisible()
    await overlay.getByLabel('Amount').fill('21.6')
    await overlay.locator('[data-testid="item-group-tab"][data-group-id="power:power"]').click()
    await overlay.locator('[data-testid="item-slot"][data-item-id="power:heat"]').click()
    await expect(overlay).not.toBeVisible()
    await addRecipe(page, 'power:nuclear-reactor:uranium-fuel-cell')
    await expect(slot(page, 'Products', 'Heat')).toHaveAccessibleName('Heat, 21.6 MW')

    const menu = await openAppMenu(page)
    await menu.getByRole('menuitemradio', { name: '/sec' }).click()
    await expect(slot(page, 'Products', 'Heat')).toContainText('21.6MW')
  })

  test('a reactor neighbour count lowers the reactor count and the fuel', async ({ page }) => {
    const overlay = page.locator('.fixed.inset-0')
    await page.getByTitle('Add product').click()
    await overlay.getByLabel('Amount').fill('21.6')
    await overlay.locator('[data-testid="item-group-tab"][data-group-id="power:power"]').click()
    await overlay.locator('[data-testid="item-slot"][data-item-id="power:heat"]').click()
    await expect(overlay).not.toBeVisible()
    await addRecipe(page, 'power:nuclear-reactor:uranium-fuel-cell')
    const rows = page.locator('main table tbody tr')
    const reactor = rows.first().getByTitle('Nuclear reactor', { exact: true })
    await expect(reactor).toHaveText(/^\??2$/)

    await reactor.click()
    const count = page.getByLabel('Neighbouring reactors')
    await expect(count).toHaveValue('0')
    // The caption wraps inside the panel instead of running off its right edge.
    const caption = page.getByTestId('neighbour-section').getByText(/^Each number is how many reactors/)
    expect((await caption.boundingBox())!.height).toBeGreaterThan(20)
    await count.fill('3')
    await expect(page.getByTestId('neighbour-multiplier')).toHaveText('×4')
    await expect(sidePanel(page).getByTestId('machine-needed')).toHaveText('1 needed')

    await expect(reactor).toHaveText(/^\??1$/)
    await expect(slot(page, 'Ingredients', 'Uranium fuel cell')).toHaveAccessibleName('Uranium fuel cell, 0.16 per minute')
    await expect(slot(page, 'Products', 'Heat')).toHaveAccessibleName('Heat, 21.6 MW')

    // Reopen the panel: it starts from the stored count, which is a 4 × 4 cluster.
    await sidePanel(page).getByRole('button', { name: 'Close panel' }).click()
    await reactor.click()
    await expect(page.getByLabel('Neighbouring reactors')).toHaveValue('3')
    await expect(page.getByTestId('neighbour-cols')).toHaveValue('4')
    await expect(page.getByTestId('neighbour-rows')).toHaveValue('4')
    await page.getByLabel('Neighbouring reactors').fill('0')
    await expect(reactor).toHaveText(/^\??2$/)
  })

  test('heat and reactor recipes stay inside the horizon when their inputs are', async ({ page }) => {
    await openHorizonTree(page)
    await page.locator('[data-tech-id="electronics"]').click()
    await closeHorizonTree(page)
    await page.getByTitle('Add product').click()
    await page.locator('[data-testid="item-group-tab"][data-group-id="power:power"]').click()
    const itemIds = await page.locator('[data-testid="item-slot"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-item-id') ?? ''),
    )
    expect(itemIds).toContain('power:heat')
  })
})
