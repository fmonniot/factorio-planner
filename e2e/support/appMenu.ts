import { expect, type Download, type FileChooser, type Locator, type Page } from '@playwright/test'

/** The workspace button: named after the active plan, or inviting a data set pick. */
export const menuTrigger = (page: Page) => page.getByRole('button', { name: /^(Plan: |Choose game data)/ })
export const appMenu = (page: Page) => page.getByRole('menu', { name: 'Plan and game data' })

/** Open the workspace menu (no-op when already open) and return it. */
export async function openAppMenu(page: Page): Promise<Locator> {
  if ((await menuTrigger(page).getAttribute('aria-expanded')) !== 'true') await menuTrigger(page).click()
  await expect(appMenu(page)).toBeVisible()
  return appMenu(page)
}

export async function closeAppMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(appMenu(page)).toBeHidden()
}

/** Pick a bundled data set and wait for it to load. */
export async function selectDataset(page: Page, label: 'Nullius' | 'Seablock'): Promise<void> {
  const menu = await openAppMenu(page)
  await menu.getByRole('menuitemradio', { name: label, exact: true }).click()
  await expect(menu).toBeHidden()
  await expect(page.getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
}

/** Assert the checked data set (null: none) via the menu's radio items; leaves the menu closed. */
export async function expectDataset(page: Page, name: string | null, opts?: { timeout?: number }): Promise<void> {
  const menu = await openAppMenu(page)
  if (name) {
    await expect(menu.getByRole('menuitemradio', { name, exact: true })).toHaveAttribute('aria-checked', 'true', opts)
  } else {
    await expect(menu.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveCount(0)
  }
  await closeAppMenu(page)
}

export async function exportPlan(page: Page): Promise<Download> {
  const menu = await openAppMenu(page)
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    menu.getByRole('menuitem', { name: 'Export plan' }).click(),
  ])
  return download
}

export async function pickPlanFile(page: Page, files: Parameters<FileChooser['setFiles']>[0]): Promise<void> {
  const menu = await openAppMenu(page)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    menu.getByRole('menuitem', { name: 'Import plan…' }).click(),
  ])
  await chooser.setFiles(files)
}
