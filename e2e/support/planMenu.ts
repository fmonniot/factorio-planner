import { expect, type Locator, type Page } from '@playwright/test'

export const planTrigger = (page: Page): Locator => page.getByRole('button', { name: /^Plan: / })
export const planMenu = (page: Page): Locator => page.getByRole('menu', { name: 'Plans' })

/** Open the top-bar plan menu (no-op when already open) and return it. */
export async function openPlanMenu(page: Page): Promise<Locator> {
  if ((await planTrigger(page).getAttribute('aria-expanded')) !== 'true') await planTrigger(page).click()
  await expect(planMenu(page)).toBeVisible()
  return planMenu(page)
}

/** Names of the plans of the active data set, in menu order; leaves the menu closed. */
export async function planNames(page: Page): Promise<string[]> {
  const menu = await openPlanMenu(page)
  const names = await menu.getByRole('menuitemradio').allInnerTexts()
  await page.keyboard.press('Escape')
  await expect(planMenu(page)).toBeHidden()
  return names.map(n => n.replace('✓', '').trim())
}

export async function switchToPlan(page: Page, name: string): Promise<void> {
  const menu = await openPlanMenu(page)
  await menu.getByRole('menuitemradio', { name, exact: true }).click()
  await expect(planTrigger(page)).toHaveAccessibleName(`Plan: ${name}`)
}

export async function renameActivePlan(page: Page, name: string): Promise<void> {
  const menu = await openPlanMenu(page)
  await menu.getByRole('menuitem', { name: 'Rename…' }).click()
  await page.getByRole('textbox', { name: 'Plan name' }).fill(name)
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await expect(planTrigger(page)).toHaveAccessibleName(`Plan: ${name}`)
}

/** Run a plan-menu item that needs no dialog (New plan, Duplicate). */
export async function runPlanAction(page: Page, item: 'New plan' | 'Duplicate'): Promise<void> {
  const menu = await openPlanMenu(page)
  await menu.getByRole('menuitem', { name: item, exact: true }).click()
}

/** Delete the active plan through the confirmation dialog. */
export async function deleteActivePlan(page: Page): Promise<void> {
  const menu = await openPlanMenu(page)
  await menu.getByRole('menuitem', { name: 'Delete…' }).click()
  await page.getByRole('button', { name: 'Delete plan' }).click()
}
