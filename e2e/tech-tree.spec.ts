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

const treeButton = (page: Page) => page.getByRole('button', { name: 'Tech tree' })
const card = (page: Page, id: string) => page.locator(`[data-testid="tech-card"][data-tech-id="${id}"]`)
const canvas = (page: Page) => page.getByTestId('tech-tree-canvas')
const viewport = (page: Page) => page.getByTestId('tech-tree-viewport')
const heading = (page: Page) => page.getByRole('heading', { name: 'Technology tree' })

const transform = (page: Page) => canvas(page).evaluate(el => (el as HTMLElement).style.transform)
const scale = async (page: Page) => Number(await canvas(page).getAttribute('data-scale'))

async function openTree(page: Page) {
  await upload(page)
  await treeButton(page).click()
  await expect(heading(page)).toBeVisible()
}

test.describe('Technology tree', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('is hidden when the data set has no technology data', async ({ page }) => {
    const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
    delete data.technologies
    delete data.startingRecipes
    await upload(page, Buffer.from(JSON.stringify(data)))
    await expect(treeButton(page)).toHaveCount(0)
  })

  test('shows the state and cost of each technology', async ({ page }) => {
    await openTree(page)
    await expect(card(page, 'advanced-material-processing')).toHaveAttribute('data-state', 'available')
    await expect(card(page, 'electronics')).toHaveAttribute('data-state', 'available')
    await expect(card(page, 'rocket-silo')).toHaveAttribute('data-state', 'locked')
    await expect(card(page, 'space-science-pack')).toHaveAttribute('data-state', 'locked')
    await expect(card(page, 'space-science-pack').getByTestId('tech-cost')).toHaveText('Trigger')
    await expect(card(page, 'advanced-material-processing').getByTestId('tech-cost')).toHaveCount(0)
  })

  test('clicking a card sets the horizon up to it', async ({ page }) => {
    await openTree(page)
    await card(page, 'rocket-silo').click()
    await expect(card(page, 'electronics')).toHaveAttribute('data-state', 'researched')
    await expect(card(page, 'rocket-silo')).toHaveAttribute('data-state', 'researched')
    await expect(card(page, 'rocket-silo')).toHaveAttribute('data-target', 'true')
    await expect(card(page, 'space-science-pack')).toHaveAttribute('data-state', 'available')
    await page.keyboard.press('Escape')
    await expect(heading(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Horizon/ })).toHaveAccessibleName('Horizon: Rocket silo')
  })

  test('pans and zooms', async ({ page }) => {
    await openTree(page)
    const box = (await viewport(page).boundingBox())!
    const startX = box.x + box.width - 20
    const startY = box.y + box.height - 20

    const before = await transform(page)
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX - 150, startY, { steps: 5 })
    await page.mouse.up()
    expect(await transform(page)).not.toBe(before)
    expect(await scale(page)).toBe(1)

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -300)
    await expect.poll(() => scale(page)).toBeGreaterThan(1)

    const zoomed = await scale(page)
    await page.getByRole('button', { name: 'Zoom out' }).click()
    expect(await scale(page)).toBeLessThan(zoomed)

    const beforeFit = await transform(page)
    await page.getByRole('button', { name: 'Fit to view' }).click()
    expect(await transform(page)).not.toBe(beforeFit)

    // A click after a drag still toggles a card.
    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX - 40, startY, { steps: 3 })
    await page.mouse.up()
    await card(page, 'electronics').click()
    await expect(card(page, 'electronics')).toHaveAttribute('data-target', 'true')
  })

  test('keyboard activation still works after a drag', async ({ page }) => {
    await openTree(page)
    const box = (await viewport(page).boundingBox())!
    const x = box.x + box.width - 20
    const y = box.y + box.height - 20
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 80, y, { steps: 4 })
    await page.mouse.up()
    await card(page, 'electronics').focus()
    await page.keyboard.press('Enter')
    await expect(card(page, 'electronics')).toHaveAttribute('data-target', 'true')
  })

  test('hovering after releasing outside the viewport does not pan', async ({ page }) => {
    await openTree(page)
    const box = (await viewport(page).boundingBox())!
    await page.mouse.move(box.x + 10, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + 10, box.y - 60) // above the viewport, one move
    await page.mouse.up()
    const before = await transform(page)
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 5 })
    expect(await transform(page)).toBe(before)
  })

  test('closes on a backdrop click', async ({ page }) => {
    await openTree(page)
    await page.mouse.click(2, 2)
    await expect(heading(page)).toHaveCount(0)
  })
})

test.describe('Technology tree search', () => {
  // The shared fixture has no leveled technology, so add one.
  function withLeveled(): Buffer {
    const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
    data.technologies['toolbelt-5'] = {
      id: 'toolbelt-5', name: 'Toolbelt 5', prerequisites: ['electronics'], unlockedRecipes: [], iconPath: '',
    }
    return Buffer.from(JSON.stringify(data))
  }

  const search = (page: Page) => page.getByRole('textbox', { name: 'Search technologies' })

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await upload(page, withLeveled())
    await treeButton(page).click()
    await expect(heading(page)).toBeVisible()
  })

  test('choosing a result centres and highlights its card without changing the horizon', async ({ page }) => {
    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.getByRole('button', { name: 'Zoom out' }).click()
    await expect(canvas(page)).not.toHaveAttribute('data-scale', '1')
    await search(page).fill('toolbelt 5')
    const result = page.getByTestId('tech-tree-search-result')
    await expect(result).toHaveCount(1)
    await expect(page.getByTestId('tech-tree-search-results')).toBeVisible()
    await result.click()

    await expect(canvas(page)).toHaveAttribute('data-scale', '1')
    await expect(card(page, 'toolbelt-5')).toHaveAttribute('data-highlight', 'true')
    const c = (await card(page, 'toolbelt-5').boundingBox())!
    const v = (await viewport(page).boundingBox())!
    expect(Math.abs(c.x + c.width / 2 - (v.x + v.width / 2))).toBeLessThanOrEqual(2)
    expect(Math.abs(c.y + c.height / 2 - (v.y + v.height / 2))).toBeLessThanOrEqual(2)
    await expect(search(page)).toHaveValue('')
    await expect(page.getByTestId('tech-tree-horizon')).toContainText('No horizon')
  })

  test('Escape clears the box before closing the tree', async ({ page }) => {
    await search(page).fill('toolbelt')
    await search(page).press('Escape')
    await expect(search(page)).toHaveValue('')
    await expect(heading(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(heading(page)).toHaveCount(0)
  })

  test('Enter picks the first result', async ({ page }) => {
    await search(page).fill('toolbelt')
    await search(page).press('Enter')
    await expect(card(page, 'toolbelt-5')).toHaveAttribute('data-highlight', 'true')
    await expect(search(page)).toHaveValue('')
  })
})

test.describe('Technology tree hover popup', () => {
  const popup = (page: Page) => page.getByTestId('tech-unlocks-popup')

  // The shared fixture has no item placing a machine, so add one and a recipe for it to `electronics`.
  function withMachine(): Buffer {
    const data = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'))
    data.items['assembling-machine'] = {
      id: 'assembling-machine', name: 'Assembling machine', type: 'item', iconPath: '', hidden: false,
      subgroup: 'intermediate', order: 'g', placeResult: 'assembling-machine',
    }
    data.recipes['assembling-machine'] = {
      ...data.recipes['iron-gear-wheel'],
      id: 'assembling-machine', name: 'Assembling machine',
      products: [{ itemId: 'assembling-machine', type: 'item', amount: 1 }],
    }
    data.technologies.electronics.unlockedRecipes.push('assembling-machine')
    return Buffer.from(JSON.stringify(data))
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await upload(page, withMachine())
    await treeButton(page).click()
    await expect(heading(page)).toBeVisible()
  })

  test('hovering a card lists its recipes and machines inside the viewport', async ({ page }) => {
    await card(page, 'electronics').hover()
    await expect(popup(page)).toBeVisible()
    await expect(popup(page).getByTestId('tech-unlocks-recipe').filter({ hasText: 'Electronic circuit' })).toHaveCount(1)
    await expect(popup(page).getByTestId('tech-unlocks-recipe').filter({ hasText: 'Assembling machine' })).toHaveCount(1)
    await expect(popup(page).locator('[data-machine-id="assembling-machine"]')).toHaveCount(1)
    const box = (await popup(page).boundingBox())!
    const vp = page.viewportSize()!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(vp.width)
    expect(box.y + box.height).toBeLessThanOrEqual(vp.height)
  })

  test('moving off the card hides it', async ({ page }) => {
    await card(page, 'electronics').hover()
    await expect(popup(page)).toBeVisible()
    await page.mouse.move(2, 2)
    await expect(popup(page)).toHaveCount(0)
  })

  test('dragging the background hides it', async ({ page }) => {
    await card(page, 'electronics').hover()
    await expect(popup(page)).toBeVisible()
    const before = await transform(page)
    const box = (await viewport(page).boundingBox())!
    const x = box.x + box.width - 20
    const y = box.y + box.height - 20
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 100, y, { steps: 4 })
    await page.mouse.up()
    await expect(popup(page)).toHaveCount(0)
    expect(await transform(page)).not.toBe(before)
  })

  test('Escape hides the popup first, then closes the tree', async ({ page }) => {
    await card(page, 'electronics').hover()
    await expect(popup(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popup(page)).toHaveCount(0)
    await expect(heading(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(heading(page)).toHaveCount(0)
  })

  test('clicking the card toggles it and shows no popup', async ({ page }) => {
    await card(page, 'electronics').hover()
    await expect(popup(page)).toBeVisible()
    await card(page, 'electronics').click()
    await expect(card(page, 'electronics')).toHaveAttribute('data-target', 'true')
    await expect(popup(page)).toHaveCount(0)
  })

  test('focusing a card shows it without hovering', async ({ page }) => {
    await card(page, 'electronics').focus()
    await expect(popup(page)).toBeVisible()
    await expect(popup(page)).toHaveAttribute('data-tech-id', 'electronics')
  })
  test('moving straight to another card switches without the delay', async ({ page }) => {
    await card(page, 'electronics').hover()
    await expect(popup(page)).toHaveAttribute('data-tech-id', 'electronics')
    await card(page, 'rocket-silo').hover()
    // Well under the 300 ms hover delay.
    await expect(popup(page)).toHaveAttribute('data-tech-id', 'rocket-silo', { timeout: 150 })
    await expect(popup(page)).toHaveCount(1)
  })

  test('Enter on a focused card toggles it and keeps the popup', async ({ page }) => {
    await card(page, 'electronics').focus()
    await expect(popup(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(card(page, 'electronics')).toHaveAttribute('data-target', 'true')
    await expect(popup(page)).toBeVisible()
  })

  test('a right-click shows no popup', async ({ page }) => {
    await card(page, 'electronics').click({ button: 'right' })
    await page.waitForTimeout(400)
    await expect(popup(page)).toHaveCount(0)
  })

  test('focusing a card outside the visible canvas shows no popup', async ({ page }) => {
    for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Zoom in' }).click()
    const vp = (await viewport(page).boundingBox())!
    let target: string | undefined
    for (const id of ['electronics', 'rocket-silo', 'space-science-pack', 'advanced-material-processing']) {
      const b = (await card(page, id).boundingBox())!
      if (b.x + b.width <= vp.x || b.x >= vp.x + vp.width || b.y + b.height <= vp.y || b.y >= vp.y + vp.height) { target = id; break }
    }
    expect(target, 'zooming in leaves at least one card off-screen').toBeDefined()
    await card(page, target!).focus()
    await page.waitForTimeout(400)
    await expect(popup(page)).toHaveCount(0)
  })
})
