import { expect, type Locator, type Page } from '@playwright/test'

/** The side panel on the right of the production table. */
export const sidePanel = (page: Page): Locator => page.getByTestId('side-panel')

/** Select a production-table row through its recipe button (the keyboard path of the row click) and return the opened panel. */
export async function selectRow(page: Page, row: Locator): Promise<Locator> {
  await row.getByTestId('recipe-name').click()
  const panel = sidePanel(page)
  await expect(panel).toBeVisible()
  return panel
}

/** Open the machine picker of the panel's Machine section. */
export async function openMachinePicker(page: Page): Promise<void> {
  await sidePanel(page).getByTestId('machine-picker-button').click()
}

/** The Comes from popover (`ComesFromPopover`): where an item with no Ingredients slot gets its rule. */
export const comesFromPopover = (page: Page): Locator => page.getByTestId('comes-from-popover')

/**
 * Select a row and press Change… on one ingredient of its "Where inputs come from" section. That opens the item's Comes
 * from popover, beside the panel; the returned locator is its Comes from control, which has the keyboard focus. The row
 * stays selected, and the popover open, until something closes them.
 */
export async function changeSourcing(page: Page, row: Locator, itemId: string): Promise<Locator> {
  const panel = sidePanel(page)
  if (!(await panel.isVisible())) await selectRow(page, row)
  await panel.locator(`[data-testid="sourcing-entry"][data-item-id="${itemId}"]`).getByTestId('sourcing-change').click()
  const control = comesFromPopover(page).getByTestId('comes-from')
  await expect(control).toBeVisible()
  await expect(control.locator(':focus')).toHaveCount(1)
  return control
}
