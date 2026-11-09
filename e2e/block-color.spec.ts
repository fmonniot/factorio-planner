import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { detail, slot } from './support/summary'
import { exportPlan } from './support/appMenu'
import { pickBlockColorForIcon } from '../src/data/blockColors'

const PLAN = path.resolve('e2e/fixtures/block-connection.json')
const MANY = path.resolve('e2e/fixtures/summary-many-items.json')
const SOURCING = path.resolve('e2e/fixtures/item-sourcing.json')
const SCIENCES_ID = 'cccc0002-0000-0000-0000-000000000001'

async function exportColors(page: Page): Promise<Record<string, string>> {
  const download = await exportPlan(page)
  const exported = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'))
  return Object.fromEntries(exported.blocks.map((b: { name: string; color: string }) => [b.name, b.color]))
}

async function ready(page: Page) {
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('[data-testid="block-tab"] button[aria-label="Gears"]')).toBeVisible({ timeout: 10000 })
}

test.describe('block colours', () => {
  test('a plan saved without colours gets palette colours in block order, the same on every load', async ({ page }) => {
    await loadPlanFixture(page, PLAN)
    await ready(page)
    expect(await exportColors(page)).toEqual({ Plates: '#60a5fa', Gears: '#7dd3fc' })

    await page.reload()
    await ready(page)
    expect(await exportColors(page)).toEqual({ Plates: '#60a5fa', Gears: '#7dd3fc' })
  })

  test('a colour picked from the tab menu is exported and is persisted', async ({ page }) => {
    await loadPlanFixture(page, PLAN)
    await ready(page)

    await page.locator('[data-testid="block-tab"] button[aria-label="Gears"]').click({ button: 'right' })
    await page.getByLabel('Colour #a3e635').click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect(await exportColors(page)).toEqual({ Plates: '#60a5fa', Gears: '#a3e635' })
    // Gears is the active block in the fixture (right-click does not activate a tab), so its stripe is at full strength.
    const stripe = page.locator('[data-testid="block-tab"] button[aria-label="Gears"] [data-testid="block-tab-stripe"]')
    await expect(stripe).toHaveCSS('background-color', 'rgb(163, 230, 53)')

    // loadPlanFixture re-seeds localStorage on every load, so a reload would
    // discard the choice; check the persisted plan directly instead.
    const saved = await readActivePlan(page, 'nullius') as { blocks: { color: string }[] }
    expect(saved.blocks.map((b: { color: string }) => b.color)).toEqual(['#60a5fa', '#a3e635'])
  })

  test('new and duplicated blocks get a colour of their own', async ({ page }) => {
    await loadPlanFixture(page, PLAN)
    await ready(page)

    await page.getByRole('button', { name: 'Add block', exact: true }).click()
    await expect(page.locator('[data-testid="block-tab"] button[aria-label="Block 3"]')).toBeVisible()
    const afterAdd = await exportColors(page)
    expect(afterAdd['Block 3']).toMatch(/^#[0-9a-f]{6}$/)
    expect([afterAdd.Plates, afterAdd.Gears]).not.toContain(afterAdd['Block 3'])

    await page.locator('[data-testid="block-tab"] button[aria-label="Gears"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect(page.locator('[data-testid="block-tab"] button[aria-label="Gears (copy)"]')).toBeVisible()
    const afterCopy = await exportColors(page)
    expect(afterCopy['Gears (copy)']).not.toBe(afterCopy.Gears)
  })

  test('the overview swatch of a consumer uses its block colour', async ({ page }) => {
    await loadPlanFixture(page, MANY)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    const row = detail(page, 'Products').locator(`[data-testid="summary-overview-segment"][data-key="to:${SCIENCES_ID}"]`)
    await expect(row).toBeVisible({ timeout: 20000 })
    // Sciences is the second block: #7dd3fc, as a translucent fill with a stronger border.
    const fill = row.getByTestId('summary-segment-fill')
    await expect(fill).toHaveCSS('background-color', 'rgba(125, 211, 252, 0.32)')
    await expect(fill).toHaveCSS('border-top-color', 'rgba(125, 211, 252, 0.75)')
  })

  test('Make in a new block takes the palette colour nearest the item icon', async ({ page }) => {
    // Compressed oxygen's icon is a saturated red: the expected colour comes from the same helper the app uses.
    const bundle = JSON.parse(fs.readFileSync(path.resolve('public/data/nullius/game-data.json'), 'utf8'))
    const iconColor: string = bundle.items['nullius-compressed-oxygen'].iconColor
    expect(iconColor).toMatch(/^#[0-9a-f]{6}$/)

    await loadPlanFixture(page, SOURCING)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(slot(page, 'Ingredients', 'Compressed oxygen')).toBeVisible({ timeout: 10000 })

    // Give the existing block the colour the helper would pick first, so the new block must take another one.
    const taken = pickBlockColorForIcon(iconColor, [], { random: () => 0 })
    await page.locator('[data-testid="block-tab"] button[aria-label="Acid"]').click({ button: 'right' })
    await page.getByLabel(`Colour ${taken}`).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    const used = Object.values(await exportColors(page))

    await slot(page, 'Ingredients', 'Compressed oxygen').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Make in a new block…' }).click()
    await expect(page.locator('[data-testid="block-tab"] button[aria-label="Compressed oxygen"]')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    // Ties are broken at random, so accept every colour the helper can return for this state.
    const allowed = [0, 0.999].map(r => pickBlockColorForIcon(iconColor, used, { random: () => r }))
    expect(allowed).not.toContain(taken)
    expect(allowed).toContain((await exportColors(page))['Compressed oxygen'])
  })

  test('a new block follows the icon of its first product, until a colour is picked', async ({ page }) => {
    const bundle = JSON.parse(fs.readFileSync(path.resolve('public/data/nullius/game-data.json'), 'utf8'))
    const iconColor: string = bundle.items['nullius-compressed-oxygen'].iconColor
    expect(iconColor).toMatch(/^#[0-9a-f]{6}$/)

    await loadPlanFixture(page, PLAN)
    await ready(page)
    await page.getByRole('button', { name: 'Add block', exact: true }).click()
    const tab = page.locator('[data-testid="block-tab"] button[aria-label="Block 3"]')
    await expect(tab).toBeVisible()

    await page.getByTitle('Add product').click()
    const overlay = page.locator('.fixed.inset-0')
    await overlay.getByPlaceholder('Search…').fill('Compressed oxygen')
    await overlay.locator('[data-testid="item-slot"][data-item-id="nullius-compressed-oxygen"]').click()
    await expect(overlay).toHaveCount(0)

    const colors = await exportColors(page)
    // Ties are broken at random, so accept every colour the helper can return for this state.
    const allowed = [0, 0.999].map(r => pickBlockColorForIcon(iconColor, [colors.Plates, colors.Gears], { random: () => r }))
    expect(allowed).toContain(colors['Block 3'])

    // Picking a swatch ends the following.
    await tab.click({ button: 'right' })
    await page.getByLabel('Colour #fda4af').click()
    expect((await exportColors(page))['Block 3']).toBe('#fda4af')
  })

  test('Default colour takes the colour of the first product again after a swatch was chosen', async ({ page }) => {
    const bundle = JSON.parse(fs.readFileSync(path.resolve('public/data/nullius/game-data.json'), 'utf8'))
    const iconColor: string | undefined = bundle.items['nullius-compressed-oxygen'].iconColor
    expect(iconColor).toMatch(/^#[0-9a-f]{6}$/)

    await loadPlanFixture(page, PLAN)
    await ready(page)
    await page.getByRole('button', { name: 'Add block', exact: true }).click()
    await expect(page.locator('[data-testid="block-tab"] button[aria-label="Block 3"]')).toBeVisible()
    await page.getByTitle('Add product').click()
    const overlay = page.locator('.fixed.inset-0')
    await overlay.getByPlaceholder('Search…').fill('Compressed oxygen')
    await overlay.locator('[data-testid="item-slot"][data-item-id="nullius-compressed-oxygen"]').click()
    await expect(overlay).toHaveCount(0)

    const tab = page.locator('[data-testid="block-tab"] button[aria-label="Block 3"]')
    await tab.click({ button: 'right' })
    await page.getByLabel('Colour #818cf8').click()
    expect((await exportColors(page))['Block 3']).toBe('#818cf8')

    await tab.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Default colour' }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    const colors = await exportColors(page)
    const used = [colors.Plates, colors.Gears]
    // Ties are broken at random, so accept every colour the helper can return for this state.
    const allowed = [0, 0.999].map(r => pickBlockColorForIcon(iconColor, used, { random: () => r }))
    expect(allowed).toContain(colors['Block 3'])
  })
})
