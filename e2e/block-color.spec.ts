import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture } from './support/loadPlan'
import { detail } from './support/summary'
import { planStorageKey } from '../src/store/sourceId'
import { exportPlan } from './support/appMenu'

const PLAN = path.resolve('e2e/fixtures/block-connection.json')
const MANY = path.resolve('e2e/fixtures/summary-many-items.json')
const SCIENCES_ID = 'cccc0002-0000-0000-0000-000000000001'

async function exportColors(page: Page): Promise<Record<string, string>> {
  const download = await exportPlan(page)
  const exported = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'))
  return Object.fromEntries(exported.blocks.map((b: { name: string; color: string }) => [b.name, b.color]))
}

async function ready(page: Page) {
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('button[title="Gears"]')).toBeVisible({ timeout: 10000 })
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

    await page.locator('button[title="Gears"]').click({ button: 'right' })
    await page.getByLabel('Colour #a3e635').click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect(await exportColors(page)).toEqual({ Plates: '#60a5fa', Gears: '#a3e635' })
    // Gears is the active block in the fixture (right-click does not activate a tab), so its stripe is at full strength.
    const stripe = page.locator('button[title="Gears"] [data-testid="block-tab-stripe"]')
    await expect(stripe).toHaveCSS('background-color', 'rgb(163, 230, 53)')

    // loadPlanFixture re-seeds localStorage on every load, so a reload would
    // discard the choice; check the persisted plan directly instead.
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), planStorageKey('nullius'))
    expect(saved.blocks.map((b: { color: string }) => b.color)).toEqual(['#60a5fa', '#a3e635'])
  })

  test('new and duplicated blocks get a colour of their own', async ({ page }) => {
    await loadPlanFixture(page, PLAN)
    await ready(page)

    await page.getByTitle('Add block').click()
    await expect(page.locator('button[title="Block 3"]')).toBeVisible()
    const afterAdd = await exportColors(page)
    expect(afterAdd['Block 3']).toMatch(/^#[0-9a-f]{6}$/)
    expect([afterAdd.Plates, afterAdd.Gears]).not.toContain(afterAdd['Block 3'])

    await page.locator('button[title="Gears"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Duplicate' }).click()
    await expect(page.locator('button[title="Gears (copy)"]')).toBeVisible()
    const afterCopy = await exportColors(page)
    expect(afterCopy['Gears (copy)']).not.toBe(afterCopy.Gears)
  })

  test('the overview swatch of a consumer uses its block colour', async ({ page }) => {
    await loadPlanFixture(page, MANY)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    const row = detail(page, 'Products').locator(`[data-testid="summary-overview-row"][data-key="to:${SCIENCES_ID}"]`)
    await expect(row).toBeVisible({ timeout: 20000 })
    // Sciences is the second block: #7dd3fc, as a translucent fill with a stronger border.
    const swatch = row.locator('span').first()
    await expect(swatch).toHaveCSS('background-color', 'rgba(125, 211, 252, 0.32)')
    await expect(swatch).toHaveCSS('border-top-color', 'rgba(125, 211, 252, 0.75)')
  })
})
