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

/**
 * Select a row and press Change… on one ingredient of its "Where inputs come from" section. That opens the item's
 * Ingredients slot; the returned locator is the slot's Comes from control, which has the keyboard focus.
 */
export async function changeSourcing(page: Page, row: Locator, itemId: string): Promise<Locator> {
  const panel = await selectRow(page, row)
  await panel.locator(`[data-testid="sourcing-entry"][data-item-id="${itemId}"]`).getByTestId('sourcing-change').click()
  const comesFrom = page.getByRole('region', { name: 'Ingredients', exact: true }).getByTestId('comes-from')
  await expect(comesFrom.locator(':focus')).toHaveCount(1)
  return comesFrom
}
