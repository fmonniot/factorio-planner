import type { Page } from '@playwright/test'

export const horizonButton = (page: Page) => page.getByRole('button', { name: /^Horizon/ })

/** Open the horizon modal through the flag's targets popover. */
export async function openHorizonDialog(page: Page): Promise<void> {
  await horizonButton(page).click()
  await page.getByRole('button', { name: /^(Edit horizon|Choose technologies)/ }).click()
}
