import { expect, type Locator, type Page } from '@playwright/test'

// Helpers for the Products / Byproducts / Ingredients panes (slots + detail strip).

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const pane = (page: Page, name: string): Locator =>
  page.getByRole('region', { name, exact: true })

/** A slot by item name; its accessible name is "<item>, <rate> per minute|second[, status]". */
export const slot = (page: Page, paneName: string, itemName: string): Locator =>
  pane(page, paneName).getByRole('button', { name: new RegExp(`^${escapeRe(itemName)}, `) })

export const slotById = (page: Page, paneName: string, itemId: string): Locator =>
  pane(page, paneName).locator(`[data-testid="summary-slot"][data-item-id="${itemId}"]`)

export const detail = (page: Page, paneName: string): Locator =>
  pane(page, paneName).getByTestId('summary-detail')

/** Click a slot and wait for the strip to show it as selected. */
export async function selectSlot(page: Page, paneName: string, itemName: string): Promise<void> {
  await slot(page, paneName, itemName).click()
  await expect(detail(page, paneName)).toHaveAttribute('data-state', 'selected')
}
