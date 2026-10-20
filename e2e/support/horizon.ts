import type { Page } from '@playwright/test'

export const horizonButton = (page: Page) => page.getByRole('button', { name: /^Horizon/ })

/** Open the tech tree through the flag's targets popover. */
export async function openHorizonTree(page: Page): Promise<void> {
  await horizonButton(page).click()
  await page.getByRole('button', { name: /^(Edit horizon|Choose technologies)/ }).click()
  await page.getByRole('heading', { name: 'Technology tree' }).waitFor()
}

/** Close the tech tree and wait for it to go. */
export async function closeHorizonTree(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('heading', { name: 'Technology tree' }).waitFor({ state: 'detached' })
}
