import { test, expect, type Locator, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'
import { changeSourcing, comesFromPopover } from './support/sidePanel'

/** Fixture of item-sourcing.spec.ts: the block "Acid" makes oxygen for nitric acid, which also has a compressed oxygen slot. */
const FIXTURE = path.resolve('e2e/fixtures/item-sourcing.json')

const acidRow = (page: Page) =>
  page.locator('main table tbody tr').filter({ has: page.locator('[title="Nitric acid"]') }).first()

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(slot(page, 'Ingredients', 'Compressed oxygen')).toBeVisible({ timeout: 10000 })
}

/** The Comes from control of oxygen in its popover, with the Sources list open. */
async function openList(page: Page): Promise<Locator> {
  const control = await changeSourcing(page, acidRow(page), 'nullius-oxygen')
  await control.getByTestId('sources-button').click()
  await expect(control.getByTestId('sources-list')).toBeVisible()
  return control
}

const lineOrder = (control: Locator) => control.getByTestId('sources-line').evaluateAll(els => els.map(el => el.getAttribute('data-line')))

/** What the control shows: the chosen preset, and the two switches, as seen by the list and by the presets. */
async function expectState(control: Locator, preset: string, makeHere: boolean, importOn: boolean, order: string[]) {
  await expect(control.locator(`[data-sourcing-choice="${preset}"]`)).toBeChecked()
  const makeSwitch = control.getByTestId('sources-make-here-switch')
  await (makeHere ? expect(makeSwitch).toBeChecked() : expect(makeSwitch).not.toBeChecked())
  const importSwitch = control.getByTestId('sources-import-switch')
  await (importOn ? expect(importSwitch).toBeChecked() : expect(importSwitch).not.toBeChecked())
  await (importOn ? expect(control.getByTestId('import-switch')).toBeChecked() : expect(control.getByTestId('import-switch')).not.toBeChecked())
  expect(await lineOrder(control)).toEqual(order)
}

const TOP = ['made-here', 'make-here', 'add-block', 'import']
const BELOW = ['made-here', 'add-block', 'make-here', 'import']

test.describe('the Sources list', () => {
  test.beforeEach(async ({ page }) => {
    await setup(page)
  })

  test('reaches each of the six states from the list', async ({ page }) => {
    const control = await openList(page)
    await expect(control.getByTestId('sources-button')).toHaveAttribute('aria-expanded', 'true')
    await expectState(control, 'own', true, true, TOP)

    await control.getByTestId('sources-import-switch').click()
    await expectState(control, 'own', true, false, TOP)

    await control.getByTestId('sources-move-down').click()
    await expectState(control, 'connections-first', true, false, BELOW)

    await control.getByTestId('sources-import-switch').click()
    await expectState(control, 'connections-first', true, true, BELOW)

    await control.getByTestId('sources-make-here-switch').click()
    await expectState(control, 'byproducts-first', false, true, BELOW)
    // Switched off, the line stays where it was drawn and is greyed.
    await expect(control.locator('[data-line="make-here"]')).toHaveAttribute('data-off', 'true')

    await control.getByTestId('sources-import-switch').click()
    await expectState(control, 'byproducts-first', false, false, BELOW)

    // On again: Make it here, above the block lines.
    await control.getByTestId('sources-make-here-switch').click()
    await expectState(control, 'own', true, false, TOP)
  })

  test('shows the rule the presets choose, with the list open', async ({ page }) => {
    const control = await openList(page)
    await control.getByRole('radio', { name: 'Receive it first' }).click()
    await expectState(control, 'connections-first', true, true, BELOW)
    await control.getByRole('radio', { name: "Don't make more here" }).click()
    // Switched off, Make more here stays where it was drawn last.
    await expectState(control, 'byproducts-first', false, true, BELOW)
    await control.getByTestId('import-switch').click()
    await expectState(control, 'byproducts-first', false, false, BELOW)
    await control.getByRole('radio', { name: 'Make it here' }).click()
    await expectState(control, 'own', true, false, TOP)
  })

  test('shows the help of the focused line under it', async ({ page }) => {
    const control = await openList(page)
    // The help line opens on keyboard focus: Tab from the button reaches the first line, then the next.
    await control.getByTestId('sources-button').focus()
    await page.keyboard.press('Tab')
    await expect(control.locator('[data-line="made-here"]')).toBeFocused()
    await expect(control.getByTestId('sources-help')).toHaveText(/^What this block's rows already make/)
    await page.keyboard.press('Tab')
    await expect(control.locator('[data-line="make-here"]')).toBeFocused()
    await expect(control.getByTestId('sources-help')).toHaveCount(1)
    await expect(control.getByTestId('sources-help')).toContainText('Run this block\'s rows')
  })

  test("the strip's Sources… opens the Comes from popover with the list open", async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Compressed oxygen')
    const strip = detail(page, 'Ingredients').getByTestId('comes-from')
    await expect(comesFromPopover(page)).toHaveCount(0)
    await strip.getByTestId('sources-button').click()
    await expect(comesFromPopover(page).getByTestId('sources-list')).toBeVisible()
    await expect(strip.getByTestId('sources-list')).toHaveCount(0)
    await expect(comesFromPopover(page)).toHaveAttribute('data-item-id', 'nullius-compressed-oxygen')
    await expect(comesFromPopover(page).getByTestId('sources-line').first()).toHaveAttribute('data-line', 'made-here')
  })

  test('dragging Make more here below the block lines chooses Receive it first', async ({ page }) => {
    const control = await openList(page)
    await expectState(control, 'own', true, true, TOP)
    await control.locator('[data-line="make-here"]').dragTo(control.locator('[data-line="add-block"]'), { targetPosition: { x: 20, y: 18 } })
    await expectState(control, 'connections-first', true, true, BELOW)
    await control.locator('[data-line="make-here"]').dragTo(control.locator('[data-line="add-block"]'), { targetPosition: { x: 20, y: 2 } })
    await expectState(control, 'own', true, true, TOP)
  })

  test('the keyboard reaches every line and action, keeps the focus after a move, and a click opens no help line', async ({ page }) => {
    const control = await openList(page)
    const order: string[] = []
    await control.getByTestId('sources-button').focus()
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press('Tab')
      order.push(await page.evaluate(() => {
        const el = document.activeElement as HTMLElement
        return el.dataset.testid === 'sources-line' ? `line:${el.dataset.line}` : (el.dataset.testid ?? '?')
      }))
    }
    expect(order).toEqual([
      'line:made-here', 'line:make-here', 'sources-move-up', 'sources-move-down', 'sources-make-here-switch',
      'line:add-block', 'sources-receive-from', 'line:import', 'sources-import-switch',
    ])

    // Move down with the keyboard: the focus stays in the Make more here line, on the other move button.
    await control.getByTestId('sources-move-down').focus()
    await page.keyboard.press('Enter')
    await expectState(control, 'connections-first', true, true, BELOW)
    await expect(control.getByTestId('sources-move-up')).toBeFocused()
    await page.keyboard.press('Enter')
    await expectState(control, 'own', true, true, TOP)
    await expect(control.getByTestId('sources-move-down')).toBeFocused()
    // The switch keeps its focus when the line moves under it.
    await control.getByTestId('sources-make-here-switch').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('Space')
    await expect(control.getByTestId('sources-make-here-switch')).toBeFocused()

    // A press on a control opens no help line (it would shift the lines under the pointer); the keyboard does.
    await control.getByTestId('sources-import-switch').click()
    await expect(control.getByTestId('sources-help')).toHaveCount(0)
    await expect(control.locator('[data-line="import"]').getByRole('tooltip')).toBeHidden()
    await control.locator('[data-line="made-here"]').focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(control.getByTestId('sources-help')).toHaveCount(1)
    await expect(control.locator('[data-line="made-here"]').getByRole('tooltip')).toBeHidden()
  })

  test('a list closed and opened again, and a second popover, keep the side Make more here was on', async ({ page }) => {
    const control = await openList(page)
    await control.getByTestId('sources-move-down').click()
    await control.getByTestId('sources-make-here-switch').click()
    await control.getByTestId('sources-button').click()
    await control.getByTestId('sources-button').click()
    await expectState(control, 'byproducts-first', false, true, BELOW)
  })
})
