import { expect, type Locator, type Page } from '@playwright/test'

/** Right-click the recipe cell of a production-table row and return the opened menu. */
export async function openRowMenu(page: Page, row: Locator): Promise<Locator> {
  await row.locator('td').nth(1).click({ button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  return menu
}

/** Run a row action through the right-click menu. */
export async function clickRowAction(page: Page, row: Locator, name: string): Promise<void> {
  const menu = await openRowMenu(page, row)
  await menu.getByRole('menuitem', { name }).click()
}
