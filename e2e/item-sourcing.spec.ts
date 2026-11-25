import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture } from './support/loadPlan'
import { detail, pane, selectSlot, slot } from './support/summary'
import { exportPlan } from './support/appMenu'
import { inputLines, openSources, comesFromPopover, selectRow, sidePanel } from './support/sidePanel'
import { expectPreset, importSwitch, setPreset, type Preset } from './support/sourcesList'

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
  page.locator('main table tbody tr').filter({ has: page.locator('[data-testid="recipe-name"][data-tip="Nitric acid"]') }).first()
const oxygenChip = (page: Page) => acidRow(page).getByLabel(/^Oxygen/)

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
 * Choose a preset for oxygen ('own' | 'byproducts-first' | 'connections-first'): Sources… on the side panel's oxygen
 * entry opens the Comes from popover, which sets it. The popover stays open.
 */
async function choose(page: Page, mode: Preset) {
  const control = await openSources(page, acidRow(page), 'nullius-oxygen')
  await setPreset(control, mode)
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

  test("Sources… opens a popover for oxygen, where Don't make more here imports it instead of decompressing it", async ({ page }) => {
    await expect(compressedSlot(page)).toContainText('25.0')
    await expect(oxygenSlot(page)).toHaveCount(0)

    // A right-click on the ingredient chip has one entry, which opens the same popover; Escape closes it.
    await oxygenChip(page).click({ button: 'right' })
    await expect(page.getByRole('menuitem')).toHaveText(['Comes from…'])
    await page.getByRole('menuitem', { name: 'Comes from…' }).click()
    await expect(comesFromPopover(page)).toBeVisible()
    await expect(comesFromPopover(page)).toContainText('Every row of this block')
    await expect(comesFromPopover(page).getByTestId('sources-line-toggle').first()).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(comesFromPopover(page)).toHaveCount(0)

    // The side panel reads the rule and sets nothing.
    const entry = await oxygenEntry(page)
    await expect(inputLines(page, 'nullius-oxygen', 'made-here')).toHaveCount(1)
    await expect(inputLines(page, 'nullius-oxygen', 'make-here')).toHaveCount(1)
    await expect(entry.getByTestId('input-rule-icons')).toHaveCount(0)
    await expect(entry.getByTestId('input-sources')).toHaveAccessibleName(/^Sources of Oxygen$/)
    await expect(entry.getByRole('radio')).toHaveCount(0)
    await expect(entry.getByRole('checkbox')).toHaveCount(0)
    await expect(page.getByTestId('panel-sourcing')).not.toContainText(/forbid imports/i)

    await choose(page, 'byproducts-first')
    const control = popoverControl(page)
    await expectPreset(control, 'byproducts-first')
    await expect(importSwitch(control)).not.toHaveAttribute('aria-disabled')
    await expect(importSwitch(control)).toBeChecked()
    // The panel behind it reads the rule (a press on the row would close the popover, so the entry is read where it is).
    await expect(sidePanel(page).locator('[data-testid="input-rule-icon"][data-rule="byproducts-first"]')).toHaveAccessibleName("Don't make more here")
    await expect(inputLines(page, 'nullius-oxygen', 'made-here')).toHaveCount(1)
    await expect(inputLines(page, 'nullius-oxygen', 'make-here')).toHaveCount(0)
    await expect(inputLines(page, 'nullius-oxygen', 'import')).toContainText('100')

    // Oxygen is imported now, so its slot is there in its own right, and the popover links to it.
    await expect(oxygenSlot(page)).toContainText('100')
    await expect(compressedSlot(page)).toHaveCount(0)
    await expect(comesFromPopover(page).getByTestId('comes-from-show-slot')).toBeVisible()
    // The rule shows on the row that uses oxygen: a marker beside its chip, named with the sentence.
    await expect(acidRow(page).getByTestId('source-rule-marker')).toHaveAccessibleName(/^Uses what this block already makes \(/)
    await expect(oxygenChip(page)).toHaveAttribute('aria-label', /^Oxygen — Find producer recipe — /)

    const acid = await exportedAcid(page)
    expect(acid.sourceRules).toEqual({ 'nullius-oxygen': { makeHere: 'off' } })
    expect(acid.itemSourcing).toBeUndefined()
    expect(acid.noImportItems).toBeUndefined()
    expect(acid.connectionsFirstItems).toBeUndefined()

    // The export menu closed the popover (a press outside it); Sources… opens it again, with the rule.
    const again = await openSources(page, acidRow(page), 'nullius-oxygen')
    await expectPreset(again, 'byproducts-first')
    await setPreset(again, 'own')
    await expect(compressedSlot(page)).toContainText('25.0')
    await expect(acidRow(page).getByTestId('source-rule-marker')).toHaveCount(0)
    await expect(comesFromPopover(page).getByTestId('comes-from-show-slot')).toHaveCount(0)
  })

  test("Don't make more here with Import off is chosen in either order and leaves the 100 oxygen missing", async ({ page }) => {
    await choose(page, 'byproducts-first')
    await expect(oxygenSlot(page)).toContainText('100')
    await expect(oxygenSlot(page)).not.toHaveAttribute('data-status', 'short')

    // The switch is free while the preset is chosen: both stay chosen.
    const control = popoverControl(page)
    await importSwitch(control).click()
    await expectPreset(control, 'byproducts-first')
    await expect(importSwitch(control)).not.toBeChecked()
    await expect(control.getByTestId('sources-rule-chip')).toHaveText("Don't make more here · Import off")
    await expect(sidePanel(page).locator('[data-testid="input-rule-icon"][data-rule="import-off"]')).toHaveAccessibleName('Import off')
    await expect(inputLines(page, 'nullius-oxygen', 'missing')).toHaveCount(1)
    // Nothing is imported or made for it: the slot reads short, with the missing amount.
    await expect(oxygenSlot(page)).toHaveAttribute('data-status', 'short')
    await expect(oxygenSlot(page)).toHaveAccessibleName(/^Oxygen, 100 per minute, short, has a source rule$/)
    await expect(compressedSlot(page)).toHaveCount(0)

    const acid = await exportedAcid(page)
    expect(acid.sourceRules).toEqual({ 'nullius-oxygen': { makeHere: 'off', importOff: true } })

    // Choosing the preset first, from the other side: Make it here keeps Import off, and the pair comes back by the preset.
    const again = await openSources(page, acidRow(page), 'nullius-oxygen')
    await setPreset(again, 'own')
    await expect(importSwitch(again)).not.toBeChecked()
    await setPreset(again, 'byproducts-first')
    await expectPreset(again, 'byproducts-first')
    await expect(oxygenSlot(page)).toHaveAttribute('data-status', 'short')

    // Its strip names what is missing and why.
    await selectSlot(page, 'Ingredients', 'Oxygen')
    const segment = detail(page, 'Ingredients').getByTestId('summary-segment')
    await expect(segment).toHaveCount(2)
    await expect(segment.filter({ hasText: 'Missing' })).toContainText('100')
  })

  // Oxygen is made and used inside the block: it is not imported, connected or locked, so the pane has no slot for it, and
  // Sources… does not expand the summary or select anything: it opens the popover, whatever the summary and the panel are doing.
  for (const [layout, width] of [['docked', 1280], ['drawer', 1000]] as const) {
    test(`Sources… opens the popover over a collapsed summary and the ${layout} panel; Show in Ingredients expands and selects the slot`, async ({ page }) => {
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

      await openSources(page, acidRow(page), 'nullius-oxygen')
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
      // Focus is on the strip's Sources…, and stays there: a drawer closes instead of taking it back.
      await expect(comesFrom(page).getByTestId('sources-button')).toBeFocused()
      await expect(sidePanel(page)).toHaveCount(layout === 'drawer' ? 0 : 1)
      await page.waitForTimeout(300)
      await expect(comesFrom(page).getByTestId('sources-button')).toBeFocused()

      // The keyboard goes on from there: Enter opens the popover with the rule's list.
      await page.keyboard.press('Enter')
      await expectPreset(popoverControl(page), 'byproducts-first')
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
    expect((await exportedAcid(page)).sourceRules).toEqual({ 'nullius-oxygen': { makeHere: 'after-blocks' } })

    // Escape closes the popover; the rule is kept, and is there again when it opens. Removing it there leaves no slot either.
    await page.keyboard.press('Escape')
    await expect(comesFromPopover(page)).toHaveCount(0)
    const again = await openSources(page, acidRow(page), 'nullius-oxygen')
    await expectPreset(again, 'connections-first')
    await again.getByTestId('no-effect').getByRole('button', { name: 'Remove' }).click()
    await expectPreset(again, 'own')
    await expect(oxygenSlot(page)).toHaveCount(0)
    await expect(pane(page, 'Ingredients').getByTestId('summary-slot')).toHaveCount(count)
    expect((await exportedAcid(page)).sourceRules).toEqual({})
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
    await expect(control.locator('[data-line="block"]')).toHaveCount(1)
    await expect(control.locator('[data-line="block"]')).toContainText('O2 maker')
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

test.describe('stored rules', () => {
  const expectOxygenRule = async (page: Page) => {
    const acid = await exportedAcid(page)
    expect(acid.sourceRules).toEqual({ 'nullius-oxygen': { makeHere: 'off' } })
    expect(acid.itemSourcing).toBeUndefined()
    expect(acid.noImportItems).toBeUndefined()
  }

  test('a plan saved with sourceRules loads as that rule', async ({ page }, testInfo) => {
    // The fixture of this spec, saved in the new shape (the fixtures folder keeps the old one on purpose: it is
    // the migration's real-data test, and every plan in it is pinned by the legacy parity golden file).
    const plan = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    for (const block of plan.blocks) {
      delete block.noImportItems
      block.sourceRules = block.name === 'Acid' ? { 'nullius-oxygen': { makeHere: 'off' } } : {}
    }
    const file = testInfo.outputPath('plan.json')
    fs.writeFileSync(file, JSON.stringify(plan))
    await loadPlanFixture(page, file)
    await expect(oxygenSlot(page)).toContainText('100', { timeout: 10000 })
    await expect(compressedSlot(page)).toHaveCount(0)
    await expect(acidRow(page).getByTestId('source-rule-marker')).toHaveAccessibleName(/^Uses what this block already makes \(/)
    await expectOxygenRule(page)
  })

  test('a plan saved in the old shape is exported with sourceRules once it has a rule', async ({ page }) => {
    await setup(page)
    await choose(page, 'byproducts-first')
    await expect(oxygenSlot(page)).toContainText('100')
    await expectOxygenRule(page)
  })
})
