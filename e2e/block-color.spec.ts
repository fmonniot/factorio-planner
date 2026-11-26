import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'
import { detail, slot } from './support/summary'
import { exportPlan } from './support/appMenu'

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

  test('Make in a new block takes the colour of the item icon as it is', async ({ page }) => {
    const bundle = JSON.parse(fs.readFileSync(path.resolve('public/data/nullius/game-data.json'), 'utf8'))
    const iconColor: string = bundle.items['nullius-compressed-oxygen'].iconColor
    expect(iconColor).toMatch(/^#[0-9a-f]{6}$/)

    await loadPlanFixture(page, SOURCING)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(slot(page, 'Ingredients', 'Compressed oxygen')).toBeVisible({ timeout: 10000 })

    await slot(page, 'Ingredients', 'Compressed oxygen').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Make in a new block…' }).click()
    await expect(page.locator('[data-testid="block-tab"] button[aria-label="Compressed oxygen"]')).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).click()
    expect((await exportColors(page))['Compressed oxygen']).toBe(iconColor)
  })

  test('a new block follows the icon of its first product as it is, until a colour is picked', async ({ page }) => {
    const bundle = JSON.parse(fs.readFileSync(path.resolve('public/data/nullius/game-data.json'), 'utf8'))
    const iconColor: string = bundle.items['nullius-compressed-oxygen'].iconColor
    expect(iconColor).toMatch(/^#[0-9a-f]{6}$/)

    await loadPlanFixture(page, PLAN)
    await ready(page)
    await page.getByRole('button', { name: 'Add block', exact: true }).click()
    const tab = page.locator('[data-testid="block-tab"] button[aria-label="Block 3"]')
    await expect(tab).toBeVisible()

    await page.getByRole('button', { name: 'Add product', exact: true }).click()
    const overlay = page.locator('.fixed.inset-0')
    await overlay.getByPlaceholder('Search…').fill('Compressed oxygen')
    await overlay.locator('[data-testid="item-slot"][data-item-id="nullius-compressed-oxygen"]').click()
    await expect(overlay).toHaveCount(0)

    expect((await exportColors(page))['Block 3']).toBe(iconColor)

    // Picking a swatch ends the following.
    // The menu says so: Default colour is checked and no swatch is.
    await tab.click({ button: 'right' })
    await expect(page.getByTestId('block-color-default')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('[data-testid="block-color-swatch"][aria-checked="true"]')).toHaveCount(0)
    await page.getByLabel('Colour #fda4af').click()
    expect((await exportColors(page))['Block 3']).toBe('#fda4af')
    await tab.click({ button: 'right' })
    await expect(page.getByTestId('block-color-default')).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('[data-testid="block-color-swatch"][aria-checked="true"]')).toHaveCount(1)
    await page.keyboard.press('Escape')
  })

  test('Default colour takes the colour of the first product again after a swatch was chosen', async ({ page }) => {
    const bundle = JSON.parse(fs.readFileSync(path.resolve('public/data/nullius/game-data.json'), 'utf8'))
    const iconColor: string | undefined = bundle.items['nullius-compressed-oxygen'].iconColor
    expect(iconColor).toMatch(/^#[0-9a-f]{6}$/)

    await loadPlanFixture(page, PLAN)
    await ready(page)
    await page.getByRole('button', { name: 'Add block', exact: true }).click()
    await expect(page.locator('[data-testid="block-tab"] button[aria-label="Block 3"]')).toBeVisible()
    await page.getByRole('button', { name: 'Add product', exact: true }).click()
    const overlay = page.locator('.fixed.inset-0')
    await overlay.getByPlaceholder('Search…').fill('Compressed oxygen')
    await overlay.locator('[data-testid="item-slot"][data-item-id="nullius-compressed-oxygen"]').click()
    await expect(overlay).toHaveCount(0)

    const tab = page.locator('[data-testid="block-tab"] button[aria-label="Block 3"]')
    await tab.click({ button: 'right' })
    await page.getByLabel('Colour #818cf8').click()
    expect((await exportColors(page))['Block 3']).toBe('#818cf8')

    await tab.click({ button: 'right' })
    await page.getByTestId('block-color-default').click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect((await exportColors(page))['Block 3']).toBe(iconColor)

  })

  test('the tab menu is driven from the keyboard: End and an arrow pick a swatch, Enter sets it, the tab gets the focus back', async ({ page }) => {
    await loadPlanFixture(page, PLAN)
    await ready(page)
    const tab = page.locator('[data-testid="block-tab"] button[aria-label="Gears"]')
    await tab.click({ button: 'right' })
    await expect(page.getByRole('menu')).toBeVisible()
    // The menu does not take the focus when it opens; the first key enters it.
    await expect(tab).toBeFocused()
    await page.keyboard.press('End')
    await expect(page.getByLabel('Colour #d9f99d')).toBeFocused()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByLabel('Colour #f9a8d4')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(tab).toBeFocused()
    expect(await exportColors(page)).toEqual({ Plates: '#60a5fa', Gears: '#f9a8d4' })
  })

  test('the keyboard goes from Delete into the colour grid and back, row by row, and Escape returns the focus to the tab', async ({ page }) => {
    await loadPlanFixture(page, PLAN)
    await ready(page)
    const tab = page.locator('[data-testid="block-tab"] button[aria-label="Gears"]')
    const menu = page.getByRole('menu')
    await tab.click({ button: 'right' })
    // Gears is the last block: Rename, Duplicate, Move left, Delete (Move right is disabled).
    for (const name of ['Rename', 'Duplicate', 'Move left', 'Delete']) {
      await page.keyboard.press('ArrowDown')
      await expect(menu.getByRole('menuitem', { name, exact: true })).toBeFocused()
    }
    // The grid is entered at the checked swatch (Gears: #7dd3fc, the second cell of the first row).
    await page.keyboard.press('ArrowDown')
    await expect(page.getByLabel('Colour #7dd3fc')).toBeFocused()
    const centre = () => page.evaluate(() => {
      const r = document.activeElement!.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    const first = await centre()
    await page.keyboard.press('ArrowDown')
    const second = await centre()
    expect(second.y, 'the next row').toBeGreaterThan(first.y)
    expect(Math.abs(second.x - first.x), 'the same column').toBeLessThan(2)
    await page.keyboard.press('ArrowUp')
    await expect(page.getByLabel('Colour #7dd3fc')).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await expect(menu.getByRole('menuitem', { name: 'Delete', exact: true })).toBeFocused()
    // Down from the last grid row wraps to Rename.
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem', { name: 'Rename', exact: true })).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(tab).toBeFocused()
  })
})
