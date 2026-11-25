import { test, expect, type Locator, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { detail, selectSlot, slot } from './support/summary'
import { openSources, comesFromPopover } from './support/sidePanel'
import { openLine } from './support/sourcesList'

/** Fixture of item-sourcing.spec.ts: the block "Acid" makes oxygen for nitric acid, which also has a compressed oxygen slot. */
const FIXTURE = path.resolve('e2e/fixtures/item-sourcing.json')

const acidRow = (page: Page) =>
  page.locator('main table tbody tr').filter({ has: page.locator('[data-testid="recipe-name"][data-tip="Nitric acid"]') }).first()

async function setup(page: Page) {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(slot(page, 'Ingredients', 'Compressed oxygen')).toBeVisible({ timeout: 10000 })
}

/** The Comes from control of oxygen in its popover: the Sources list is its one view. */
async function openList(page: Page): Promise<Locator> {
  const control = await openSources(page, acidRow(page), 'nullius-oxygen')
  await expect(control.getByTestId('sources-list')).toBeVisible()
  return control
}

const lineOrder = (control: Locator) => control.getByTestId('sources-line').evaluateAll(els => els.map(el => el.getAttribute('data-line')))

/** What the list shows: the preset its rule chip reads, and the two switches. */
async function expectState(control: Locator, preset: string, makeHere: boolean, importOn: boolean, order: string[]) {
  await expect(control.getByTestId('sources-rule-chip')).toHaveAttribute('data-preset', preset)
  const makeSwitch = control.getByTestId('sources-make-here-switch')
  await (makeHere ? expect(makeSwitch).toBeChecked() : expect(makeSwitch).not.toBeChecked())
  const importSwitch = control.getByTestId('sources-import-switch')
  await (importOn ? expect(importSwitch).toBeChecked() : expect(importSwitch).not.toBeChecked())
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
    await expect(control.getByTestId('sources-button')).toHaveCount(0)
    await expectState(control, 'own', true, true, TOP)

    await control.getByTestId('sources-import-switch').click()
    await expectState(control, 'own', true, false, TOP)

    await openLine(control.locator('[data-line="make-here"]'))
    await control.getByTestId('sources-make-after').click()
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

  test("the popover has the list and no rule buttons, and dragging Make more here changes the chip", async ({ page }) => {
    await selectSlot(page, 'Ingredients', 'Compressed oxygen')
    await detail(page, 'Ingredients').getByTestId('comes-from').getByTestId('sources-button').click()
    const popover = comesFromPopover(page)
    await expect(popover.getByTestId('sources-list')).toBeVisible()
    await expect(popover.getByRole('radiogroup')).toHaveCount(0)
    await expect(popover.getByTestId('sourcing-sentence')).toHaveCount(0)
    await expect(popover.getByTestId('sources-rule-chip')).toHaveText('Make it here')
    await popover.locator('[data-line="make-here"]').dragTo(popover.locator('[data-line="add-block"]'), { targetPosition: { x: 20, y: 18 } })
    await expect(popover.getByTestId('sources-rule-chip')).toHaveText('Receive it first')
  })

  test('a line opens its detail with its help, from the keyboard too', async ({ page }) => {
    const control = await openList(page)
    const madeHere = control.locator('[data-line="made-here"]')
    await expect(control.getByTestId('sources-detail')).toHaveCount(0)
    await madeHere.getByTestId('sources-line-toggle').focus()
    await page.keyboard.press('Enter')
    await expect(madeHere.getByTestId('sources-detail')).toContainText("What this block's rows already make")
    await expect(madeHere.getByTestId('sources-line-toggle')).toHaveAttribute('aria-expanded', 'true')
    await control.locator('[data-line="make-here"]').getByTestId('sources-line-toggle').click()
    await expect(control.getByTestId('sources-detail')).toHaveCount(1)
    await expect(control.locator('[data-line="make-here"]').getByTestId('sources-detail')).toContainText("Run this block's rows")
    await control.locator('[data-line="make-here"]').getByTestId('sources-line-toggle').click()
    await expect(control.getByTestId('sources-detail')).toHaveCount(0)
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

  test('the keyboard reaches every line and action, keeps the focus after a move, and a click on a switch opens nothing', async ({ page }) => {
    const control = await openList(page)
    const order: string[] = []
    await control.getByRole('button', { name: 'Close' }).focus()
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab')
      order.push(await page.evaluate(() => {
        const el = document.activeElement as HTMLElement
        const line = el.closest<HTMLElement>('[data-testid="sources-line"]')?.dataset.line
        return `${line ?? 'popover'}:${el.dataset.testid ?? el.getAttribute('aria-label') ?? '?'}`
      }))
    }
    expect(order).toEqual([
      'made-here:sources-line-toggle', 'make-here:sources-line-toggle', 'make-here:sources-make-here-switch',
      'add-block:sources-receive-from', 'import:sources-line-toggle', 'import:sources-import-switch',
    ])

    // After other blocks with the keyboard: the focus stays in the Make more here line, on the button of its new side.
    await openLine(control.locator('[data-line="make-here"]'))
    await control.getByTestId('sources-make-after').focus()
    await page.keyboard.press('Enter')
    await expectState(control, 'connections-first', true, true, BELOW)
    await expect(control.getByTestId('sources-make-after')).toBeFocused()
    await control.getByTestId('sources-make-before').focus()
    await page.keyboard.press('Enter')
    await expectState(control, 'own', true, true, TOP)
    await expect(control.getByTestId('sources-make-before')).toBeFocused()
    // Alt+ArrowDown on the name does the same, and the focus follows the line.
    await control.locator('[data-line="make-here"]').getByTestId('sources-line-toggle').focus()
    await page.keyboard.press('Alt+ArrowDown')
    await expectState(control, 'connections-first', true, true, BELOW)
    await expect(control.locator('[data-line="make-here"]').getByTestId('sources-line-toggle')).toBeFocused()
    await page.keyboard.press('Alt+ArrowUp')
    await expectState(control, 'own', true, true, TOP)
    // The switch keeps its focus when the line moves under it.
    await control.getByTestId('sources-make-here-switch').focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('Space')
    await expect(control.getByTestId('sources-make-here-switch')).toBeFocused()

    // A press on a switch opens no detail (it would shift the lines under the pointer).
    await control.getByTestId('sources-import-switch').click()
    await expect(control.getByTestId('sources-detail')).toHaveCount(1)
  })

  test('a popover closed and opened again keeps the side Make more here was on', async ({ page }) => {
    const control = await openList(page)
    await openLine(control.locator('[data-line="make-here"]'))
    await control.getByTestId('sources-make-after').click()
    await control.getByTestId('sources-make-here-switch').click()
    await control.getByRole('button', { name: 'Close' }).click()
    await expect(comesFromPopover(page)).toHaveCount(0)
    const again = await openSources(page, acidRow(page), 'nullius-oxygen')
    await expectState(again, 'byproducts-first', false, true, BELOW)
  })
})
