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
