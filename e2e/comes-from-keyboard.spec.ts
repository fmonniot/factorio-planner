import { test, expect, type Locator, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { slot } from './support/summary'
import { openSources, comesFromPopover } from './support/sidePanel'
import { openLine } from './support/sourcesList'

/** Fixture of sources-list.spec.ts: the block "Acid" makes oxygen for nitric acid; the block "O2 maker" makes oxygen. */
const FIXTURE = path.resolve('e2e/fixtures/item-sourcing.json')

const acidRow = (page: Page) =>
  page.locator('main table tbody tr').filter({ has: page.locator('[data-testid="recipe-name"][data-tip="Nitric acid"]') }).first()

async function openList(page: Page): Promise<Locator> {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(slot(page, 'Ingredients', 'Compressed oxygen')).toBeVisible({ timeout: 10000 })
  const control = await openSources(page, acidRow(page), 'nullius-oxygen')
  await expect(control.getByTestId('sources-list')).toBeVisible()
  return control
}

/** The line the keyboard focus is on, by its data-line. */
const focusedLine = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement).closest<HTMLElement>('[data-testid="sources-line"]')?.dataset.line)

test.describe('Comes from, keyboard', () => {
  test('the arrow keys move between the line names, stopping at the ends, and Alt+Arrow still reorders', async ({ page }) => {
    const control = await openList(page)
    expect(await focusedLine(page)).toBe('made-here')

    await page.keyboard.press('ArrowDown')
    expect(await focusedLine(page)).toBe('make-here')
    // Add a block has no name to stop at (its button is Receive from…, which stays on Tab).
    await page.keyboard.press('ArrowDown')
    expect(await focusedLine(page)).toBe('import')
    await page.keyboard.press('ArrowUp')
    expect(await focusedLine(page)).toBe('make-here')
    await page.keyboard.press('End')
    expect(await focusedLine(page)).toBe('import')
    await page.keyboard.press('ArrowDown')
    expect(await focusedLine(page), 'stops at the last line').toBe('import')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowUp')
    expect(await focusedLine(page), 'stops at the first line').toBe('made-here')

    await control.locator('[data-line="make-here"]').getByTestId('sources-line-toggle').focus()
    await page.keyboard.press('Alt+ArrowDown')
    expect(await control.getByTestId('sources-line').evaluateAll(els => els.map(el => el.getAttribute('data-line'))))
      .toEqual(['made-here', 'add-block', 'make-here', 'import'])
    await expect(control.locator('[data-line="make-here"]').getByTestId('sources-line-toggle')).toBeFocused()
  })

  test('Receive from… opens a menu the arrows walk, Enter connects', async ({ page }) => {
    const control = await openList(page)
    const receive = control.getByTestId('sources-receive-from')
    await receive.focus()
    await page.keyboard.press('Enter')
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(menu.getByRole('menuitem').first()).toBeFocused()
    await expect(menu.getByRole('menuitem').first()).toContainText('O2 maker')
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    await expect(comesFromPopover(page)).toBeVisible()
    await expect(control.locator('[data-line="block"]')).toHaveCount(1)
  })

  test('Escape closes the connection menu first, then the popover', async ({ page }) => {
    const control = await openList(page)
    const receive = control.getByTestId('sources-receive-from')
    await receive.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(comesFromPopover(page)).toBeVisible()
    await expect(receive).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(comesFromPopover(page)).toHaveCount(0)
  })

  test('Tab closes the connection menu and the focus carries on from the button', async ({ page }) => {
    const control = await openList(page)
    await control.getByTestId('sources-receive-from').focus()
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(comesFromPopover(page)).toBeVisible()
    expect(await focusedLine(page)).toBe('import')
  })
})

// A line that opens keeps working with the arrows once its detail is open.
test('the arrows still walk the names with a detail open', async ({ page }) => {
  const control = await openList(page)
  await openLine(control.locator('[data-line="make-here"]'))
  await control.locator('[data-line="made-here"]').getByTestId('sources-line-name').focus()
  await page.keyboard.press('ArrowDown')
  expect(await focusedLine(page)).toBe('make-here')
  await page.keyboard.press('ArrowDown')
  expect(await focusedLine(page)).toBe('import')
})
