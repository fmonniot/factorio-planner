import { test, expect, type Page, type TestInfo } from '@playwright/test'
import path from 'path'
import fs from 'fs'
import { loadPlanFixture } from './support/loadPlan'
import { detail, pane, slot } from './support/summary'

/**
 * Fixture (see item-sourcing.spec.ts): the active block "Acid" makes and uses oxygen (steam electrolysis and oxygen
 * decompression make it, nitric acid synthesis uses it) and imports compressed oxygen; "O2 maker" has oxygen as a
 * product. Each test adds its own rules to Acid before the plan is loaded.
 */
const FIXTURE = path.resolve('e2e/fixtures/item-sourcing.json')
const OXYGEN = 'nullius-oxygen'
const COMPRESSED = 'nullius-compressed-oxygen'

interface AcidPatch {
  itemSourcing?: Record<string, string>
  noImportItems?: string[]
  /** Acid receives oxygen from O2 maker. */
  connected?: boolean
}

async function setup(page: Page, testInfo: TestInfo, patch: AcidPatch) {
  const plan = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  const [acid, maker] = plan.blocks
  acid.itemSourcing = patch.itemSourcing ?? {}
  acid.noImportItems = patch.noImportItems ?? []
  if (patch.connected) acid.inputConnections = [{ id: 'dddd0001-0000-0000-0000-0000000000c1', itemId: OXYGEN, fromBlockId: maker.id }]
  const file = testInfo.outputPath('plan.json')
  fs.writeFileSync(file, JSON.stringify(plan))
  await loadPlanFixture(page, file)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(pane(page, 'Ingredients').getByTestId('summary-slot').first()).toBeVisible({ timeout: 10000 })
}

const rulesButton = (page: Page) => pane(page, 'Ingredients').getByTestId('source-rules')
const popover = (page: Page) => page.getByTestId('source-rules-popover')
const rule = (page: Page, itemId: string, kind: string) =>
  popover(page).locator(`[data-testid="source-rule"][data-item-id="${itemId}"][data-rule="${kind}"]`)
const oxygenSlot = (page: Page) => slot(page, 'Ingredients', 'Oxygen')

/** The popover is whole inside the viewport, and nothing covers its corners. */
async function expectUnclipped(page: Page) {
  const box = (await popover(page).boundingBox())!
  const viewport = page.viewportSize()!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  const corners = [[box.x + 2, box.y + 2], [box.x + box.width - 2, box.y + box.height - 2]]
  for (const [x, y] of corners) {
    const inside = await page.evaluate(
      ([px, py]) => !!document.elementFromPoint(px, py)?.closest('[data-testid="source-rules-popover"]'),
      [x, y],
    )
    expect(inside, `the popover is on top at ${x}, ${y}`).toBe(true)
  }
}

test.describe('source rules', () => {
  test('lists the rules of the block, removes one, and changes another in its row', async ({ page }, testInfo) => {
    await setup(page, testInfo, {
      itemSourcing: { [OXYGEN]: 'connections-first', [COMPRESSED]: 'byproducts-first' },
      noImportItems: [OXYGEN],
      connected: true,
    })
    await expect(rulesButton(page)).toHaveText('Source rules (3)')
    await expect(popover(page)).toHaveCount(0)

    // By keyboard: Enter opens it and focus goes to the first rule's item.
    await rulesButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeVisible()
    await expectUnclipped(page)
    await expect(popover(page).getByRole('listitem')).toHaveCount(3)
    await expect(rule(page, OXYGEN, 'connections-first').getByTestId('source-rule-item')).toBeFocused()

    // A rule with an effect: its name and the item's sentence.
    const received = rule(page, OXYGEN, 'connections-first')
    await expect(received).not.toHaveAttribute('data-no-effect')
    await expect(received.getByTestId('source-rule-name')).toHaveText('Receive it first')
    await expect(received.getByTestId('source-rule-text')).toContainText('Taken from O2 maker first')
    await expect(rule(page, OXYGEN, 'import-off').getByTestId('source-rule-name')).toHaveText('Import off')

    // A rule with no effect: why, in place of the sentence.
    const unused = rule(page, COMPRESSED, 'byproducts-first')
    await expect(unused).toHaveAttribute('data-no-effect', 'not-made')
    await expect(unused.getByTestId('source-rule-name')).toHaveText("Don't make more here")
    await expect(unused.getByTestId('source-rule-text')).toHaveText('No row in this block makes Compressed oxygen.')

    // Tab reaches every control and stays in the popover.
    await page.keyboard.press('Tab')
    await expect(received.getByRole('button', { name: 'Remove the Receive it first rule of Oxygen' })).toBeFocused()
    for (let i = 0; i < 5; i++) await page.keyboard.press('Tab')
    await expect(received.getByTestId('source-rule-item')).toBeFocused()

    // Remove the rule with no effect: the popover stays, focus is on the Remove that took its place.
    await unused.getByRole('button', { name: /^Remove/ }).click()
    await expect(unused).toHaveCount(0)
    await expect(rulesButton(page)).toHaveText('Source rules (2)')
    await expect(popover(page).getByRole('listitem')).toHaveCount(2)
    await expect(rule(page, OXYGEN, 'import-off').getByRole('button', { name: /^Remove/ })).toBeFocused()

    // Escape closes it and gives the focus back to the button.
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
    await expect(rulesButton(page)).toBeFocused()

    // A rule's item shows its Comes from control in the row, and the list stays: nothing is selected in the pane.
    await rulesButton(page).click()
    const row = rule(page, OXYGEN, 'import-off')
    await row.getByTestId('source-rule-item').click()
    await expect(popover(page)).toBeVisible()
    await expect(row.getByTestId('comes-from')).toBeVisible()
    await expect(row.getByTestId('source-rule-item')).toHaveAttribute('aria-expanded', 'true')
    await expect(detail(page, 'Ingredients')).not.toHaveAttribute('data-state', 'selected')
    await expect(oxygenSlot(page)).toHaveAttribute('aria-pressed', 'false')
    // The switch is the rule: turning Import on takes the entry away, and the control goes with it.
    await row.getByTestId('import-switch').click()
    await expect(row).toHaveCount(0)
    await expect(rulesButton(page)).toHaveText('Source rules (1)')
  })

  test('finds the rule of an item that is only an intermediate, and removes the last rule', async ({ page }, testInfo) => {
    // Receive it first with no connection: oxygen is still made and used here, so the pane has no slot for it.
    await setup(page, testInfo, { itemSourcing: { [OXYGEN]: 'connections-first' } })
    const slots = pane(page, 'Ingredients').getByTestId('summary-slot')
    const count = await slots.count()
    await expect(oxygenSlot(page)).toHaveCount(0)
    await expect(rulesButton(page)).toHaveText('Source rules (1)')

    await rulesButton(page).click()
    const only = rule(page, OXYGEN, 'connections-first')
    await expect(only).toHaveAttribute('data-no-effect', 'no-connection')
    await expect(only.getByTestId('source-rule-text')).toHaveText('No connection for Oxygen.')

    // Its item shows its Comes from control in the row, with the way forward; no slot appears, in the pane or anywhere.
    await only.getByTestId('source-rule-item').click()
    await expect(popover(page)).toBeVisible()
    await expect(only.getByTestId('comes-from').getByRole('radio', { name: 'Receive it first' })).toBeChecked()
    await expect(only.getByTestId('receive-from')).toBeVisible()
    await expect(oxygenSlot(page)).toHaveCount(0)
    await expect(slots).toHaveCount(count)
    // Escape closes the list; opening it again starts with the row closed.
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
    await rulesButton(page).click()
    await expect(only.getByTestId('comes-from')).toHaveCount(0)

    // Removing the last rule takes the button and the popover away; focus stays in the pane.
    await only.getByRole('button', { name: /^Remove/ }).click()
    await expect(popover(page)).toHaveCount(0)
    await expect(rulesButton(page)).toHaveCount(0)
    await expect(pane(page, 'Ingredients').locator(':focus')).toHaveCount(1)
    await expect(slots).toHaveCount(count)
  })

  test('is not clipped on a narrow screen, and is absent from the collapsed summary', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await setup(page, testInfo, { itemSourcing: { [COMPRESSED]: 'byproducts-first' }, noImportItems: [OXYGEN] })
    await rulesButton(page).click()
    await expect(popover(page)).toBeVisible()
    await expectUnclipped(page)

    // A press outside closes it.
    await page.mouse.click(5, 790)
    await expect(popover(page)).toHaveCount(0)

    await page.getByRole('button', { name: 'Collapse summary' }).click()
    await expect(page.getByTestId('summary-line')).toBeVisible()
    await expect(page.getByTestId('source-rules')).toHaveCount(0)
  })
})
