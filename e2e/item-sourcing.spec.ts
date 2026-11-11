import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture } from './support/loadPlan'
import { detail, pane, slot } from './support/summary'
import { exportPlan } from './support/appMenu'
import { changeSourcing, selectRow, sidePanel } from './support/sidePanel'

/**
 * Fixture: the active block "Acid" makes hydrogen 800 and nitric acid 125 with steam electrolysis
 * (whose side output is 400 oxygen), nitric acid synthesis (which needs 500 oxygen) and oxygen
 * decompression. By default decompression covers the 100 oxygen the electrolysis does not (it
 * takes 25 compressed oxygen). With Only what's already made on oxygen the 100 is imported instead.
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

/** Select the Nitric acid row and return the oxygen entry of the panel's sourcing section. */
async function oxygenEntry(page: Page) {
  const panel = await selectRow(page, acidRow(page))
  return panel.getByTestId('panel-sourcing').locator('[data-testid="sourcing-entry"][data-item-id="nullius-oxygen"]')
}

const comesFrom = (page: Page) => detail(page, 'Ingredients').getByTestId('comes-from')

/**
 * Choose a preset for oxygen ('own' | 'byproducts-first' | 'connections-first'): Change… on the side panel's oxygen
 * entry opens the Ingredients slot, whose Comes from control sets it. The slot stays selected.
 */
async function choose(page: Page, mode: string) {
  const control = await changeSourcing(page, acidRow(page), 'nullius-oxygen')
  await control.locator(`[data-sourcing-choice="${mode}"]`).click()
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

  test("Change… opens a slot for oxygen, where Only what's already made imports it instead of decompressing it", async ({ page }) => {
    await expect(compressedSlot(page)).toContainText('25.0')
    await expect(oxygenSlot(page)).toHaveCount(0)

    // The chip has no menu of its own.
    await oxygenChip(page).click({ button: 'right' })
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(page.getByRole('menuitemradio')).toHaveCount(0)

    // The side panel reads the rule and sets nothing.
    const entry = await oxygenEntry(page)
    await expect(entry.getByTestId('sourcing-sentence')).toContainText('Made here by')
    await expect(entry.getByRole('radio')).toHaveCount(0)
    await expect(entry.getByRole('checkbox')).toHaveCount(0)
    await expect(page.getByTestId('panel-sourcing')).not.toContainText(/forbid imports/i)

    await choose(page, 'byproducts-first')
    await expect(comesFrom(page).getByRole('radio', { name: "Only what's already made" })).toBeChecked()
    await expect(comesFrom(page).getByTestId('import-switch')).toHaveAttribute('aria-disabled', 'true')
    await expect(comesFrom(page).getByTestId('sourcing-sentence')).toContainText('Uses what this block already makes first')
    await expect((await oxygenEntry(page)).getByTestId('sourcing-sentence')).toContainText('Uses what this block already makes first')

    // Oxygen is imported now, so its slot is there in its own right.
    await expect(oxygenSlot(page)).toContainText('100')
    await expect(compressedSlot(page)).toHaveCount(0)
    // The rule shows on the row that uses oxygen: a marker beside its chip, named with the sentence.
    await expect(acidRow(page).getByTestId('source-rule-marker')).toHaveAccessibleName(/^Uses what this block already makes first/)
    await expect(oxygenChip(page)).toHaveAttribute('title', /^Oxygen — Find producer recipe — /)

    const acid = await exportedAcid(page)
    expect(acid.itemSourcing).toEqual({ 'nullius-oxygen': 'byproducts-first' })
    expect(acid.connectionsFirstItems).toBeUndefined()

    await comesFrom(page).getByRole('radio', { name: 'Make it here' }).click()
    await expect(compressedSlot(page)).toContainText('25.0')
    await expect(acidRow(page).getByTestId('source-rule-marker')).toHaveCount(0)
  })

  // Oxygen is made and used inside the block: it is not imported, connected or locked, so the pane has no slot for it.
  for (const [layout, width] of [['docked', 1280], ['drawer', 1000]] as const) {
    test(`Change… with the summary collapsed expands it, selects the slot and focuses Comes from (${layout} panel)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      await page.getByRole('button', { name: 'Collapse summary' }).click()
      await expect(page.getByTestId('summary-line')).toBeVisible()
      await expect(page.getByTestId('summary-pane')).toHaveCount(0)

      const panel = await selectRow(page, acidRow(page))
      await panel.locator('[data-testid="sourcing-entry"][data-item-id="nullius-oxygen"]').getByTestId('sourcing-change').click()

      await expect(page.getByTestId('summary-line')).toHaveCount(0)
      await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'true')
      await expect(detail(page, 'Ingredients')).toHaveAttribute('data-state', 'selected')
      // Focus is on the chosen preset, and stays there: a drawer closes instead of taking it back.
      await expect(comesFrom(page).getByRole('radio', { name: 'Make it here' })).toBeFocused()
      await expect(sidePanel(page)).toHaveCount(layout === 'drawer' ? 0 : 1)
      await page.waitForTimeout(300)
      await expect(comesFrom(page).getByRole('radio', { name: 'Make it here' })).toBeFocused()

      // The keyboard goes on from there: the arrow chooses the next preset.
      await page.keyboard.press('ArrowRight')
      await expect(comesFrom(page).getByRole('radio', { name: 'Receive it first' })).toBeChecked()
      await expect(comesFrom(page).getByRole('radio', { name: 'Receive it first' })).toBeFocused()
    })
  }

  test('an item that is only an intermediate has no slot, rule or not, except while Change… has it selected', async ({ page }) => {
    const count = await pane(page, 'Ingredients').getByTestId('summary-slot').count()
    await expect(oxygenSlot(page)).toHaveCount(0)

    // Receive it first with no connection: a rule (with no effect), and oxygen is still made here.
    await choose(page, 'connections-first')
    await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(pane(page, 'Ingredients').getByTestId('summary-slot')).toHaveCount(count + 1)
    await expect(comesFrom(page).getByTestId('no-effect')).toContainText('No connection for Oxygen.')

    // Deselecting takes the slot away: having a rule does not keep it.
    await page.keyboard.press('Escape')
    await expect(oxygenSlot(page)).toHaveCount(0)
    await expect(pane(page, 'Ingredients').getByTestId('summary-slot')).toHaveCount(count)
    expect((await exportedAcid(page)).itemSourcing).toEqual({ 'nullius-oxygen': 'connections-first' })

    // Asked for again, it is back with its rule, which can be removed there; another slot's selection ends it.
    const control = await changeSourcing(page, acidRow(page), 'nullius-oxygen')
    await expect(control.getByRole('radio', { name: 'Receive it first' })).toBeChecked()
    await control.getByTestId('no-effect').getByRole('button', { name: 'Remove' }).click()
    await expect(control.getByRole('radio', { name: 'Make it here' })).toBeChecked()
    await expect(oxygenSlot(page)).toHaveCount(1)
    await compressedSlot(page).click()
    await expect(oxygenSlot(page)).toHaveCount(0)
    await expect(pane(page, 'Ingredients').getByTestId('summary-slot')).toHaveCount(count)
    expect((await exportedAcid(page)).itemSourcing).toEqual({})
  })

  test('a request from another block covers only what the byproducts do not', async ({ page }) => {
    await choose(page, 'byproducts-first')
    await expect(oxygenSlot(page)).toContainText('100')

    await oxygenSlot(page).click({ button: 'right' })
    await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'O2 maker' }).click()
    // The slot is still selected from the Change… above.
    await expect(detail(page, 'Ingredients')).toHaveAttribute('data-state', 'selected')
    await expect(detail(page, 'Ingredients').locator('[data-testid="summary-segment"][data-kind="source"]').getByTestId('summary-segment-tip')).toContainText('100')
    await expect(detail(page, 'Ingredients').locator('[data-testid="summary-segment"][data-kind="import"]')).toHaveCount(0)

    // O2 maker decompresses the 100 oxygen Acid asked for.
    await page.locator('[data-testid="block-tab"] button[aria-label="O2 maker"]').click()
    await expect(compressedSlot(page)).toContainText('25.0')
    await page.locator('[data-testid="block-tab"] button[aria-label="Acid"]').click()

    // Back to Make it here: the connection delivers nothing, Acid decompresses by itself again.
    await choose(page, 'own')
    await expect(detail(page, 'Ingredients').locator('[data-testid="summary-segment"][data-kind="source"]')).toHaveCount(0)
    await expect(compressedSlot(page)).toContainText('25.0')
  })
})
