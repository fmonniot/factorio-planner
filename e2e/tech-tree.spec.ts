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
    await expect(page.getByRole('button', { name: /^Horizon/ })).toHaveText('Horizon: Rocket silo')
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
