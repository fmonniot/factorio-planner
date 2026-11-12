import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture } from './support/loadPlan'
import { detail, pane, slot } from './support/summary'
import { exportPlan } from './support/appMenu'
import { changeSourcing, comesFromPopover, selectRow, sidePanel } from './support/sidePanel'

/**
 * Fixture: the active block "Acid" makes hydrogen 800 and nitric acid 125 with steam electrolysis
 * (whose side output is 400 oxygen), nitric acid synthesis (which needs 500 oxygen) and oxygen
 * decompression. By default decompression covers the 100 oxygen the electrolysis does not (it
 * takes 25 compressed oxygen). With Don't make more here on oxygen the 100 is imported instead.
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

/** The Comes from control of the selected Ingredients slot (its strip), and the one in the popover. */
const comesFrom = (page: Page) => detail(page, 'Ingredients').getByTestId('comes-from')
const popoverControl = (page: Page) => comesFromPopover(page).getByTestId('comes-from')

/**
 * Choose a preset for oxygen ('own' | 'byproducts-first' | 'connections-first'): Change… on the side panel's oxygen
 * entry opens the Comes from popover, which sets it. The popover stays open.
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

  test("Change… opens a popover for oxygen, where Don't make more here imports it instead of decompressing it", async ({ page }) => {
    await expect(compressedSlot(page)).toContainText('25.0')
    await expect(oxygenSlot(page)).toHaveCount(0)

    // A right-click on the ingredient chip has one entry, which opens the same popover; Escape closes it.
    await oxygenChip(page).click({ button: 'right' })
    await expect(page.getByRole('menuitem')).toHaveText(['Comes from…'])
    await page.getByRole('menuitem', { name: 'Comes from…' }).click()
    await expect(comesFromPopover(page)).toBeVisible()
    await expect(comesFromPopover(page)).toContainText('Applies to every row of this block')
    await expect(comesFromPopover(page).getByRole('radio', { name: 'Make it here' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(comesFromPopover(page)).toHaveCount(0)

    // The side panel reads the rule and sets nothing.
    const entry = await oxygenEntry(page)
    await expect(entry.getByTestId('sourcing-sentence')).toContainText('Made here by')
    await expect(entry.getByRole('radio')).toHaveCount(0)
    await expect(entry.getByRole('checkbox')).toHaveCount(0)
    await expect(page.getByTestId('panel-sourcing')).not.toContainText(/forbid imports/i)

    await choose(page, 'byproducts-first')
    const control = popoverControl(page)
    await expect(control.getByRole('radio', { name: "Don't make more here" })).toBeChecked()
    await expect(control.getByTestId('import-switch')).toHaveAttribute('aria-disabled', 'true')
    await expect(control.getByTestId('sourcing-sentence')).toContainText('Uses what this block already makes first')
    // The panel behind it says the same (a press on the row would close the popover, so the entry is read where it is).
    await expect(sidePanel(page).locator('[data-testid="sourcing-entry"][data-item-id="nullius-oxygen"]').getByTestId('sourcing-sentence')).toContainText('Uses what this block already makes first')

    // Oxygen is imported now, so its slot is there in its own right, and the popover links to it.
    await expect(oxygenSlot(page)).toContainText('100')
    await expect(compressedSlot(page)).toHaveCount(0)
    await expect(comesFromPopover(page).getByTestId('comes-from-show-slot')).toBeVisible()
    // The rule shows on the row that uses oxygen: a marker beside its chip, named with the sentence.
    await expect(acidRow(page).getByTestId('source-rule-marker')).toHaveAccessibleName(/^Uses what this block already makes first/)
    await expect(oxygenChip(page)).toHaveAttribute('title', /^Oxygen — Find producer recipe — /)

    const acid = await exportedAcid(page)
    expect(acid.itemSourcing).toEqual({ 'nullius-oxygen': 'byproducts-first' })
    expect(acid.connectionsFirstItems).toBeUndefined()

    // The export menu closed the popover (a press outside it); Change… opens it again, with the rule.
    const again = await changeSourcing(page, acidRow(page), 'nullius-oxygen')
    await expect(again.getByRole('radio', { name: "Don't make more here" })).toBeChecked()
    await again.getByRole('radio', { name: 'Make it here' }).click()
    await expect(compressedSlot(page)).toContainText('25.0')
    await expect(acidRow(page).getByTestId('source-rule-marker')).toHaveCount(0)
    await expect(comesFromPopover(page).getByTestId('comes-from-show-slot')).toHaveCount(0)
  })

  // Oxygen is made and used inside the block: it is not imported, connected or locked, so the pane has no slot for it, and
  // Change… does not expand the summary or select anything: it opens the popover, whatever the summary and the panel are doing.
  for (const [layout, width] of [['docked', 1280], ['drawer', 1000]] as const) {
    test(`Change… opens the popover over a collapsed summary and the ${layout} panel; Show in Ingredients expands and selects the slot`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      // Importing oxygen gives it a slot, which the popover can then link to.
      await choose(page, 'byproducts-first')
      await expect(oxygenSlot(page)).toContainText('100')
      await page.keyboard.press('Escape')
      await expect(comesFromPopover(page)).toHaveCount(0)
      // A drawer covers the page: the next Escape closes it too, and the row is selected again below.
      if (layout === 'drawer') {
        await page.keyboard.press('Escape')
        await expect(sidePanel(page)).toHaveCount(0)
      }
      await page.getByRole('button', { name: 'Collapse summary' }).click()
      await expect(page.getByTestId('summary-line')).toBeVisible()
      await expect(page.getByTestId('summary-pane')).toHaveCount(0)

      await changeSourcing(page, acidRow(page), 'nullius-oxygen')
      // Nothing moved: the summary is still collapsed, and the side panel is where it was (a drawer stays under the popover).
      await expect(page.getByTestId('summary-line')).toBeVisible()
      await expect(sidePanel(page)).toHaveCount(1)
      const popoverBox = (await comesFromPopover(page).boundingBox())!
      const viewport = page.viewportSize()!
      expect(popoverBox.x).toBeGreaterThanOrEqual(0)
      expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(viewport.width)
      expect(popoverBox.y + popoverBox.height).toBeLessThanOrEqual(viewport.height)

      await comesFromPopover(page).getByTestId('comes-from-show-slot').click()
      await expect(comesFromPopover(page)).toHaveCount(0)
      await expect(page.getByTestId('summary-line')).toHaveCount(0)
      await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'true')
      await expect(detail(page, 'Ingredients')).toHaveAttribute('data-state', 'selected')
      // Focus is on the chosen preset, and stays there: a drawer closes instead of taking it back.
      await expect(comesFrom(page).getByRole('radio', { name: "Don't make more here" })).toBeFocused()
      await expect(sidePanel(page)).toHaveCount(layout === 'drawer' ? 0 : 1)
      await page.waitForTimeout(300)
      await expect(comesFrom(page).getByRole('radio', { name: "Don't make more here" })).toBeFocused()

      // The keyboard goes on from there: the arrow chooses the next preset.
      await page.keyboard.press('ArrowLeft')
      await expect(comesFrom(page).getByRole('radio', { name: 'Receive it first' })).toBeChecked()
      await expect(comesFrom(page).getByRole('radio', { name: 'Receive it first' })).toBeFocused()
    })
  }

  test('an item that is only an intermediate has no slot, rule or not, and the popover is where its rule lives', async ({ page }) => {
    const count = await pane(page, 'Ingredients').getByTestId('summary-slot').count()
    await expect(oxygenSlot(page)).toHaveCount(0)
    const summaryHeight = (await page.getByTestId('summary-pane').first().boundingBox())!.height

    // Receive it first with no connection: a rule (with no effect), oxygen is still made here, and nothing in the pane moves.
    await choose(page, 'connections-first')
    await expect(oxygenSlot(page)).toHaveCount(0)
    await expect(pane(page, 'Ingredients').getByTestId('summary-slot')).toHaveCount(count)
    expect((await page.getByTestId('summary-pane').first().boundingBox())!.height).toBe(summaryHeight)
    const control = popoverControl(page)
    await expect(control.getByTestId('no-effect')).toContainText('No connection for Oxygen.')
    expect((await exportedAcid(page)).itemSourcing).toEqual({ 'nullius-oxygen': 'connections-first' })

    // Escape closes the popover; the rule is kept, and is there again when it opens. Removing it there leaves no slot either.
    await page.keyboard.press('Escape')
    await expect(comesFromPopover(page)).toHaveCount(0)
    const again = await changeSourcing(page, acidRow(page), 'nullius-oxygen')
    await expect(again.getByRole('radio', { name: 'Receive it first' })).toBeChecked()
    await again.getByTestId('no-effect').getByRole('button', { name: 'Remove' }).click()
    await expect(again.getByRole('radio', { name: 'Make it here' })).toBeChecked()
    await expect(oxygenSlot(page)).toHaveCount(0)
    await expect(pane(page, 'Ingredients').getByTestId('summary-slot')).toHaveCount(count)
    expect((await exportedAcid(page)).itemSourcing).toEqual({})
  })

  test('Receive from… in the popover connects the item, and the rule then acts; Escape closes the menu before the popover', async ({ page }) => {
    await choose(page, 'connections-first')
    const control = popoverControl(page)
    await expect(control.getByTestId('no-effect')).toContainText('No connection for Oxygen.')
    await expect(oxygenSlot(page)).toHaveCount(0)

    // The menu opens over the popover; Escape closes it and only it.
    await control.getByTestId('receive-from').click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(comesFromPopover(page)).toBeVisible()
    // So does a press outside both: it closes the menu, and the popover stays.
    await control.getByTestId('receive-from').click()
    await expect(menu).toBeVisible()
    await page.getByTestId('summary-pane').first().click({ position: { x: 10, y: 10 } })
    await expect(menu).toHaveCount(0)
    await expect(comesFromPopover(page)).toBeVisible()

    await control.getByTestId('receive-from').click()
    await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'O2 maker' }).click()
    // The popover stays open and now says what the rule does; the item is connected, so it has a slot.
    await expect(comesFromPopover(page)).toBeVisible()
    await expect(control.getByTestId('no-effect')).toHaveCount(0)
    await expect(control.getByTestId('sourcing-sentence')).toContainText('Taken from O2 maker first')
    await expect(oxygenSlot(page)).toBeVisible()
    await expect(comesFromPopover(page).getByTestId('comes-from-show-slot')).toBeVisible()
    await expect(acidRow(page).getByTestId('source-rule-marker')).toHaveCount(1)

    // Two presses, then, from the row to a connected item. The menu closed with its choice; Escape closes the popover.
    await page.keyboard.press('Escape')
    await expect(comesFromPopover(page)).toHaveCount(0)
  })

  test('a request from another block covers only what the byproducts do not', async ({ page }) => {
    await choose(page, 'byproducts-first')
    await expect(oxygenSlot(page)).toContainText('100')
    await page.keyboard.press('Escape')

    await oxygenSlot(page).click({ button: 'right' })
    await page.locator('[role="menuitem"][data-kind="request"]', { hasText: 'O2 maker' }).click()
    await oxygenSlot(page).click()
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
