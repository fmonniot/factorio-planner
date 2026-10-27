import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'
import { exportPlan } from './support/appMenu'

/**
 * Fixture: the active block "Acid" makes hydrogen 800 and nitric acid 125 with steam electrolysis
 * (whose side output is 400 oxygen), nitric acid synthesis (which needs 500 oxygen) and oxygen
 * decompression. By default decompression covers the 100 oxygen the electrolysis does not (it
 * takes 25 compressed oxygen). With Byproducts first on oxygen the 100 is imported instead.
 * The block "O2 maker" has oxygen as a product, so it can be requested from.
 */
const FIXTURE = path.resolve('e2e/fixtures/item-sourcing.json')

const oxygenSlot = (page: Page) => slot(page, 'Ingredients', 'Oxygen')
const compressedSlot = (page: Page) => slot(page, 'Ingredients', 'Compressed oxygen')
const acidRow = (page: Page) =>
  page.locator('main table tbody tr').filter({ has: page.locator('[title="Nitric acid"]') }).first()
const oxygenChip = (page: Page) => acidRow(page).getByTitle(/^Oxygen/)

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(compressedSlot(page)).toBeVisible({ timeout: 10000 })
}

/** Right-click the oxygen chip of the Nitric acid row and choose a mode. */
async function chooseFromChip(page: Page, name: string) {
  await oxygenChip(page).click({ button: 'right' })
  await page.getByRole('menuitemradio', { name }).click()
}

async function exportedAcid(page: Page) {
  const download = await exportPlan(page)
  const exported = JSON.parse(fs.readFileSync((await download.path())!, 'utf8'))
  return exported.blocks.find((b: { name: string }) => b.name === 'Acid')
}

test.describe('item sourcing', () => {
  test.beforeEach(async ({ page }) => {
    await setup(page)
  })

  test('the chip menu sets Byproducts first, which imports oxygen instead of decompressing it', async ({ page }) => {
    await expect(compressedSlot(page)).toContainText('25.0')
    await expect(oxygenSlot(page)).toHaveCount(0)

    await oxygenChip(page).click({ button: 'right' })
    await expect(page.getByRole('menuitemradio', { name: 'Own recipes first' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('menuitemradio', { name: 'Byproducts first' }).click()

    await expect(oxygenSlot(page)).toContainText('100')
    await expect(compressedSlot(page)).toHaveCount(0)
    await expect(oxygenChip(page).getByTestId('item-tile-sourcing')).toBeVisible()

    await oxygenSlot(page).click({ button: 'right' })
    await expect(page.getByRole('menuitemradio', { name: 'Byproducts first' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')

    const acid = await exportedAcid(page)
    expect(acid.itemSourcing).toEqual({ 'nullius-oxygen': 'byproducts-first' })
    expect(acid.connectionsFirstItems).toBeUndefined()

    await chooseFromChip(page, 'Own recipes first')
    await expect(compressedSlot(page)).toContainText('25.0')
  })

  test('a request from another block covers only what the byproducts do not', async ({ page }) => {
    await chooseFromChip(page, 'Byproducts first')
    await expect(oxygenSlot(page)).toContainText('100')

    await oxygenSlot(page).click({ button: 'right' })
    await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'O2 maker' }).click()
    await selectSlot(page, 'Ingredients', 'Oxygen')
    await expect(detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="source"]')).toContainText('100')
    await expect(detail(page, 'Ingredients').locator('[data-testid="summary-key-entry"][data-kind="import"]')).toHaveCount(0)

    // O2 maker decompresses the 100 oxygen Acid asked for.
    await page.locator('button[title="O2 maker"]').click()
    await expect(compressedSlot(page)).toContainText('25.0')
    await page.locator('button[title="Acid"]').click()

    // Back to own recipes first: the connection delivers nothing, Acid decompresses by itself again.
    await oxygenSlot(page).click({ button: 'right' })
    await page.getByRole('menuitemradio', { name: 'Own recipes first' }).click()
    await expect(detail(page, 'Ingredients').locator('[data-testid="summary-segment"][data-kind="source"]')).toHaveCount(0)
    await expect(compressedSlot(page)).toContainText('25.0')
  })
})
