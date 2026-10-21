import { test, expect, type Page } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { horizonButton, openHorizonTree, closeHorizonTree } from './support/horizon'
import { runPlanAction, switchToPlan } from './support/planMenu'

const FIXTURE_PATH = path.resolve('e2e/fixtures/game-data-horizon.json')

async function upload(page: Page, buffer: Buffer = fs.readFileSync(FIXTURE_PATH)) {
  await page.locator('input[type="file"]').setInputFiles({
    name: 'game-data-horizon.json',
    mimeType: 'application/json',
    buffer,
  })
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

const tech = (page: Page, id: string) => page.locator(`[data-tech-id="${id}"]`)
const count = (page: Page) => page.getByTestId('tech-tree-recipe-count')

async function pickerRecipeIds(page: Page): Promise<string[]> {
  await page.getByRole('button', { name: 'Add recipe' }).click()
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
    await expect(horizonButton(page)).toHaveAccessibleName('Horizon: none')
    await openHorizonTree(page)
    await tech(page, 'electronics').click()
    await expect(count(page)).toHaveText('3 of 6 recipes available')
    await closeHorizonTree(page)
    await expect(horizonButton(page)).toHaveAccessibleName('Horizon: Electronics')
    expect(await pickerRecipeIds(page)).toEqual(['electronic-circuit', 'iron-gear-wheel', 'iron-plate'])
  })

  test('the recipe picker can reveal recipes beyond the horizon temporarily', async ({ page }) => {
    await upload(page)
    const slots = page.locator('[data-testid="recipe-slot"]')
    const beyondBox = page.getByLabel('Beyond research horizon')

    // No horizon: the checkbox would be inert, so it is not offered.
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expect(beyondBox).toHaveCount(0)
    await page.getByRole('button', { name: 'Close' }).click()

    await openHorizonTree(page)
    await tech(page, 'electronics').click()
    await closeHorizonTree(page)

    await page.getByRole('button', { name: 'Add recipe' }).click()
    await expect(slots).toHaveCount(3)
    await beyondBox.check()
    await expect(slots).toHaveCount(6)
    await expect(page.locator('[data-testid="recipe-slot"][data-beyond-horizon="true"]')).toHaveCount(3)

    // The checkbox is picker-local: reopening starts unticked again.
    await page.getByRole('button', { name: 'Close' }).click()
    await page.getByRole('button', { name: 'Add recipe' }).click()
    await expect(beyondBox).not.toBeChecked()
    await expect(slots).toHaveCount(3)
  })

  test('setting a horizon limits the goal picker', async ({ page }) => {
    await upload(page)
    await openHorizonTree(page)
    await tech(page, 'electronics').click()
    await closeHorizonTree(page)
    expect(await pickerGoalItemIds(page)).toEqual(['electronic-circuit', 'iron-gear-wheel', 'iron-ore', 'iron-plate'])

    await openHorizonTree(page)
    await page.getByRole('button', { name: 'Clear horizon' }).click()
    await closeHorizonTree(page)
    await expect(horizonButton(page)).toHaveAccessibleName('Horizon: none')
    expect(await pickerGoalItemIds(page)).toHaveLength(6)
  })

  test('changing and clearing the target', async ({ page }) => {
    await upload(page)
    await openHorizonTree(page)
    await tech(page, 'electronics').click()
    await tech(page, 'space-science-pack').click()
    await expect(count(page)).toHaveText('5 of 6 recipes available')
    await closeHorizonTree(page)
    expect(await pickerRecipeIds(page)).toEqual([
      'electronic-circuit', 'iron-gear-wheel', 'iron-plate', 'rocket-part', 'space-science-pack',
    ])

    await openHorizonTree(page)
    await tech(page, 'electronics').click()
    // electronics is still a prerequisite of the remaining target.
    await expect(count(page)).toHaveText('5 of 6 recipes available')
    await page.getByRole('button', { name: 'Clear horizon' }).click()
    await closeHorizonTree(page)
    await expect(horizonButton(page)).toHaveAccessibleName('Horizon: none')
    expect(await pickerRecipeIds(page)).toHaveLength(6)
  })

  test('persists across a reload', async ({ page }) => {
    await upload(page)
    await openHorizonTree(page)
    await tech(page, 'electronics').click()
    await closeHorizonTree(page)
    await expect(horizonButton(page)).toHaveAccessibleName('Horizon: Electronics')

    await page.reload()
    await expect(horizonButton(page)).toHaveAccessibleName('Horizon: Electronics', { timeout: 10000 })
  })
})

/** Replace the page with the horizon fixture plus 45 extra technologies; returns their ids. */
async function uploadManyTechnologies(page: Page): Promise<string[]> {
  const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
  const ids = Array.from({ length: 45 }, (_, i) => `bulk-tech-${i}`)
  for (const id of ids) data.technologies[id] = { id, name: `Bulk tech ${id.slice(10)}`, prerequisites: [], unlockedRecipes: [], iconPath: '' }
  await page.goto('/')
  await upload(page, Buffer.from(JSON.stringify(data)))
  return ids
}

test.describe('Horizon popover', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await upload(page)
  })

  test('the dot follows the targets and the popover lists and removes them', async ({ page }) => {
    await expect(page.getByTestId('horizon-dot')).toHaveCount(0)
    await openHorizonTree(page)
    await tech(page, 'electronics').click()
    await closeHorizonTree(page)
    await expect(page.getByTestId('horizon-dot')).toBeVisible()

    await horizonButton(page).click()
    const popover = page.getByRole('dialog', { name: 'Horizon targets' })
    await expect(popover).toContainText('Electronics')
    await popover.getByRole('button', { name: 'Remove Electronics' }).click()
    await expect(horizonButton(page)).toHaveAccessibleName('Horizon: none')
    await expect(page.getByTestId('horizon-dot')).toHaveCount(0)
  })

  test('Escape closes the popover and refocuses the flag', async ({ page }) => {
    await horizonButton(page).click()
    await expect(page.getByRole('dialog', { name: 'Horizon targets' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Horizon targets' })).toBeHidden()
    await expect(horizonButton(page)).toBeFocused()
  })

  test('opening the popover focuses Edit horizon…, not a remove button', async ({ page }) => {
    await openHorizonTree(page)
    await tech(page, 'electronics').click()
    await closeHorizonTree(page)
    await expect(horizonButton(page)).toBeFocused()
    await horizonButton(page).click()
    await expect(page.getByRole('button', { name: 'Edit horizon…' })).toBeFocused()
  })

  test('the popover stays within 70% of the viewport with many targets', async ({ page }) => {
    const ids = await uploadManyTechnologies(page)
    await setHorizon(page, ...ids)
    await expect(horizonButton(page)).toHaveAccessibleName('Horizon: 45 technologies')

    await horizonButton(page).click()
    const popover = page.getByRole('dialog', { name: 'Horizon targets' })
    await expect(popover.getByRole('button', { name: /^Remove / })).toHaveCount(45)

    const viewportHeight = page.viewportSize()!.height
    const box = (await popover.locator('xpath=..').boundingBox())!
    expect(box.height).toBeLessThanOrEqual(viewportHeight * 0.7 + 1) // +1: sub-pixel rounding
    expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight)

    // The footer actions stay reachable while the list scrolls.
    await expect(popover.getByRole('button', { name: 'Edit horizon…' })).toBeInViewport()
    await expect(popover.getByRole('button', { name: 'Clear horizon' })).toBeInViewport()
    const list = popover.getByTestId('horizon-target-list')
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  })

  test('the horizon follows plan switches', async ({ page }) => {
    await openHorizonTree(page)
    await tech(page, 'electronics').click()
    await closeHorizonTree(page)
    await expect(page.getByTestId('horizon-dot')).toBeVisible()

    await runPlanAction(page, 'New plan')
    await expect(page.getByTestId('horizon-dot')).toHaveCount(0)
    await switchToPlan(page, 'Plan 1')
    await expect(page.getByTestId('horizon-dot')).toBeVisible()
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
  await openHorizonTree(page)
  const clear = page.getByRole('button', { name: 'Clear horizon' })
  if (await clear.isEnabled()) await clear.click()
  // Dispatched, not clicked: with many technologies most cards sit outside the tree's viewport.
  for (const id of techIds) await tech(page, id).dispatchEvent('click')
  await closeHorizonTree(page)
}

async function addGoal(page: Page, itemId: string) {
  await page.getByTitle('Add goal').click()
  await page.locator(`[data-testid="item-slot"][data-item-id="${itemId}"]`).click()
}

async function addRecipe(page: Page, recipeId: string) {
  await page.getByRole('button', { name: 'Add recipe' }).click()
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

// ---------------------------------------------------------------------------
// Default machine per category
// ---------------------------------------------------------------------------

test.describe('Default machines', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await upload(page, Buffer.from(JSON.stringify(machineFixture())))
    await addGoal(page, 'iron-gear-wheel')
    await addRecipe(page, 'iron-gear-wheel')
  })

  const firstRow = (page: Page) => page.locator('main table tbody tr').first()

  async function openDefaultMachines(page: Page) {
    await page.getByRole('button', { name: /^Plan: / }).click()
    await page.getByRole('menuitem', { name: 'Default machines' }).click()
    const flyout = page.getByRole('menu', { name: 'Default machines' })
    await expect(flyout).toBeVisible()
    return flyout
  }

  test('"Make default" in the edit modal changes the row and persists', async ({ page }) => {
    const row = firstRow(page)
    await row.getByTitle('Assembling machine 2', { exact: true }).click()
    await page.getByText(/machines$/).click()
    await page.getByRole('button', { name: 'Make Assembling machine the Crafting default' }).click()
    await page.getByRole('button', { name: 'Close', exact: true }).last().click()
    await expect(row.getByTitle('Assembling machine', { exact: true })).toBeVisible()

    await row.getByTitle('Assembling machine', { exact: true }).click()
    await page.getByText(/machines$/).click()
    await expect(page.getByTestId('default-machine-usage')).toContainText('Crafting default is used by 1 row')
    await page.getByRole('button', { name: 'Close', exact: true }).last().click()

    await page.reload()
    await expect(row.getByTitle('Assembling machine', { exact: true })).toBeVisible({ timeout: 10000 })
  })

  test('the workspace menu sets and resets the default', async ({ page }) => {
    const row = firstRow(page)
    const flyout = await openDefaultMachines(page)
    await flyout.getByRole('group', { name: 'Crafting' }).getByRole('menuitemradio', { name: 'Assembling machine', exact: true }).click()
    await expect(row.getByTitle('Assembling machine', { exact: true })).toBeVisible()
    await flyout.getByRole('menuitem', { name: 'Reset all' }).click()
    await expect(row.getByTitle('Assembling machine 2', { exact: true })).toBeVisible()
  })

  test('an override outside the horizon is ignored, then applies again', async ({ page }) => {
    const row = firstRow(page)
    const flyout = await openDefaultMachines(page)
    await flyout.getByRole('group', { name: 'Crafting' }).getByRole('menuitemradio', { name: 'Assembling machine 2' }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await setHorizon(page, 'electronics')
    await expect(row.getByTitle('Assembling machine', { exact: true })).toBeVisible()
    await setHorizon(page)
    await expect(row.getByTitle('Assembling machine 2', { exact: true })).toBeVisible()
  })

  test('"All defaults…" opens the flyout on the category', async ({ page }) => {
    await firstRow(page).getByTitle('Assembling machine 2', { exact: true }).click()
    await page.getByText(/machines$/).click()
    await page.getByRole('button', { name: 'All defaults…' }).click()
    const flyout = page.getByRole('menu', { name: 'Default machines' })
    await expect(flyout).toBeVisible()
    await expect(flyout.getByRole('group', { name: 'Crafting' }).getByRole('menuitemradio', { checked: true })).toBeFocused()
  })
})
