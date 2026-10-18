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

async function pickerGoalItemIds(page: Page): Promise<string[]> {
  await page.getByTitle('Add goal').click()
  await expect(page.getByRole('heading', { name: 'Add product' })).toBeVisible()
  const ids = await page.locator('[data-testid="item-slot"]').evaluateAll(
    els => els.map(e => e.getAttribute('data-item-id') ?? ''),
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

  test('setting a horizon limits the goal picker', async ({ page }) => {
    await upload(page)
    await horizonButton(page).click()
    await tech(page, 'electronics').click()
    await page.getByRole('button', { name: 'Done' }).click()
    expect(await pickerGoalItemIds(page)).toEqual(['electronic-circuit', 'iron-gear-wheel', 'iron-ore', 'iron-plate'])

    await horizonButton(page).click()
    await page.getByRole('button', { name: 'Clear' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(horizonButton(page)).toHaveText('Horizon: none')
    expect(await pickerGoalItemIds(page)).toHaveLength(6)
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

// ---------------------------------------------------------------------------
// Machines, modules and beacons follow the horizon
// ---------------------------------------------------------------------------

/** The horizon fixture plus machine, module and beacon items, their recipes and technologies. */
function machineFixture() {
  const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
  const placer = (id: string, name: string, placeResult: string) => ({
    id, name, type: 'item', iconPath: '', hidden: false, subgroup: 'intermediate', order: 'z', placeResult,
  })
  data.items['assembling-machine'] = placer('assembling-machine', 'Assembling machine', 'assembling-machine')
  data.items['assembling-machine-2'] = placer('assembling-machine-2', 'Assembling machine 2', 'assembling-machine-2')
  data.items['stone-furnace'] = placer('stone-furnace', 'Stone furnace', 'stone-furnace')
  data.items['speed-module'] = { ...placer('speed-module', 'Speed module', ''), placeResult: undefined }
  data.items.beacon = placer('beacon', 'Beacon', 'beacon')

  const maker = (id: string) => ({ ...data.recipes['iron-gear-wheel'], id, name: id, ingredients: [], products: [{ itemId: id, type: 'item', amount: 1 }] })
  for (const id of ['assembling-machine', 'assembling-machine-2', 'stone-furnace', 'speed-module', 'beacon']) {
    data.recipes[id] = maker(id)
  }

  data.machines['assembling-machine-2'] = {
    ...data.machines['assembling-machine'], id: 'assembling-machine-2', name: 'Assembling machine 2',
    craftingSpeed: 2, moduleSlots: 2, allowedEffects: ['speed'],
  }
  data.modules['speed-module'] = {
    id: 'speed-module', name: 'Speed module', category: 'speed', tier: 1,
    effects: { speed: 0.2 }, limitation: [], limitationBlacklist: [], iconPath: '',
  }
  data.beacons.beacon = {
    id: 'beacon', name: 'Beacon', iconPath: '', hidden: false, moduleSlots: 2,
    distributionEfficiency: 1.5, allowedEffects: ['speed'],
  }
  const t = (id: string, name: string, prerequisites: string[], unlockedRecipes: string[]) => ({
    id, name, prerequisites, unlockedRecipes, iconPath: '',
  })
  data.technologies['automation-2'] = t('automation-2', 'Automation 2', ['electronics'], ['assembling-machine-2'])
  data.technologies.smelting = t('smelting', 'Smelting', [], ['stone-furnace'])
  data.technologies.modules = t('modules', 'Modules', [], ['speed-module', 'beacon'])
  data.startingRecipes.push('assembling-machine')
  data.defaultMachines.crafting = 'assembling-machine-2'
  return data
}

async function setHorizon(page: Page, ...techIds: string[]) {
  await horizonButton(page).click()
  const clear = page.getByRole('button', { name: 'Clear' })
  if (await clear.isEnabled()) await clear.click()
  for (const id of techIds) await tech(page, id).click()
  await page.getByRole('button', { name: 'Done' }).click()
}

async function addGoal(page: Page, itemId: string) {
  await page.getByTitle('Add goal').click()
  await page.locator(`[data-testid="item-slot"][data-item-id="${itemId}"]`).click()
}

async function addRecipe(page: Page, recipeId: string) {
  await page.getByText('+ Add recipe').click()
  await page.locator(`[data-testid="recipe-slot"][data-recipe-id="${recipeId}"]`).click()
}


test.describe('Plan horizon: machines and modules', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await upload(page, Buffer.from(JSON.stringify(machineFixture())))
  })

  test('the default machine follows the horizon', async ({ page }) => {
    await setHorizon(page, 'electronics')
    await addGoal(page, 'iron-gear-wheel')
    await addRecipe(page, 'iron-gear-wheel')
    const row = page.locator('main table tbody tr').first()
    await expect(row.getByTitle('Assembling machine', { exact: true })).toBeVisible()

    await setHorizon(page, 'electronics', 'automation-2')
    await expect(row.getByTitle('Assembling machine 2', { exact: true })).toBeVisible()

    await setHorizon(page)
    await expect(row.getByTitle('Assembling machine 2', { exact: true })).toBeVisible()
  })

  test('a recipe with no machine within the horizon shows zero machines', async ({ page }) => {
    await setHorizon(page, 'electronics')
    await addGoal(page, 'iron-plate')
    await addRecipe(page, 'iron-plate')
    const row = page.locator('main table tbody tr').first()
    const cell = row.locator('[data-no-machine="true"]')
    await expect(cell).toHaveText('?0')
    await expect(row.getByLabel('Add beacon')).toBeDisabled()

    await cell.click()
    await expect(page.getByTestId('no-machine-in-horizon')).toBeVisible()
    await page.getByText(/machines$/).click()
    await expect(page.getByTestId('machine-picker-empty')).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).last().click()

    await setHorizon(page, 'electronics', 'smelting')
    await expect(row.getByTitle('Stone furnace', { exact: true })).toBeVisible()
    await expect(row.locator('[data-no-machine="true"]')).toHaveCount(0)
    // The machine count (the icon is a "?" placeholder in the fixture) becomes at least 1 once re-solved.
    await expect(row.getByTitle('Stone furnace', { exact: true })).toHaveText(/^\??[1-9]\d*$/)
  })

  test('the machine list is gated', async ({ page }) => {
    await setHorizon(page, 'electronics')
    await addGoal(page, 'iron-gear-wheel')
    await addRecipe(page, 'iron-gear-wheel')
    await page.getByTitle('Assembling machine', { exact: true }).click()
    await page.getByText(/machines$/).click()
    const ids = await page.locator('[data-testid="machine-option"]').evaluateAll(
      els => els.map(e => e.getAttribute('data-machine-id')),
    )
    expect(ids).toEqual(['assembling-machine'])
  })

  test('an explicit machine beyond the horizon is kept and flagged', async ({ page }) => {
    await addGoal(page, 'iron-gear-wheel')
    await addRecipe(page, 'iron-gear-wheel')
    const row = page.locator('main table tbody tr').first()
    await row.getByTitle('Assembling machine 2', { exact: true }).click()
    await page.getByText(/machines$/).click()
    await page.locator('[data-testid="machine-option"][data-machine-id="assembling-machine-2"]').click()
    await page.getByRole('button', { name: 'Close', exact: true }).last().click()

    await setHorizon(page, 'electronics')
    await expect(row.locator('[data-beyond-horizon="true"]').first()).toHaveAttribute('title', /Assembling machine 2/)

    await page.reload()
    await expect(row.locator('[data-beyond-horizon="true"]').first()).toHaveAttribute('title', /Assembling machine 2/, { timeout: 10000 })
  })

  test('modules and beacons are gated', async ({ page }) => {
    await setHorizon(page, 'electronics', 'automation-2')
    await addGoal(page, 'iron-gear-wheel')
    await addRecipe(page, 'iron-gear-wheel')
    const row = page.locator('main table tbody tr').first()
    await row.getByLabel('Add beacon').waitFor()
    await row.getByTitle('Edit modules').click()
    await expect(page.getByRole('option', { name: 'Speed module' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Close', exact: true }).last().click()
    await expect(row.getByLabel('Add beacon')).toBeDisabled()
    await expect(row.getByLabel('Add beacon')).toHaveAttribute('title', 'No beacon within the research horizon')

    await setHorizon(page, 'electronics', 'automation-2', 'modules')
    await row.getByTitle('Edit modules').click()
    await expect(page.getByRole('option', { name: 'Speed module' })).toHaveCount(1)
    await page.getByRole('button', { name: 'Close', exact: true }).last().click()
    await row.getByLabel('Add beacon').click()
    await expect(page.getByRole('heading', { name: 'Edit beacon' })).toBeVisible()
    await expect(page.getByTitle('Beacon', { exact: true })).toBeVisible()
  })
})
