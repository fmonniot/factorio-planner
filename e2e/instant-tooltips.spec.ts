import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * The elements that used to carry a native `title` show their text in the instant tooltip (`TooltipLayer`) and, where the tooltip
 * says more than the accessible name, expose it as the accessible description. No element of the table, the side panel or the
 * pickers keeps a native `title` (the browser's delayed tooltip).
 */
const BASE = path.resolve('e2e/fixtures/byproduct-consumer-base.json')
const FEEDER = path.resolve('e2e/fixtures/byproduct-consumer-feeder.json')

const tooltip = (page: Page) => page.getByTestId('tooltip')

async function open(page: Page, fixture = BASE): Promise<void> {
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 20000 })
}

test('a recipe name opens its tooltip instantly', async ({ page }) => {
  await open(page)
  const name = page.getByTestId('recipe-name').first()
  const text = (await name.textContent())!.trim()
  await name.hover()
  await expect(tooltip(page)).toBeVisible({ timeout: 250 })
  await expect(tooltip(page)).toHaveText(text)
})

test('Add product opens its tooltip instantly and keeps its accessible name', async ({ page }) => {
  await open(page)
  const add = page.getByRole('button', { name: 'Add product', exact: true })
  await add.hover()
  await expect(tooltip(page)).toBeVisible({ timeout: 250 })
  await expect(tooltip(page)).toHaveText('Add product (A)')
})

test('the machine button of the side panel names the machine', async ({ page }) => {
  await open(page)
  await page.getByTestId('recipe-name').first().click()
  const button = page.getByTestId('machine-picker-button')
  await expect(button).toBeVisible()
  const machine = (await button.getAttribute('data-tip'))!
  expect(machine.length).toBeGreaterThan(0)
  await button.hover()
  await expect(tooltip(page)).toBeVisible({ timeout: 250 })
  await expect(tooltip(page)).toHaveText(machine)
})

test('the disabled Move up button still shows why while filtering, and describes it', async ({ page }) => {
  await open(page)
  await page.getByRole('searchbox', { name: 'Filter recipes or items' }).fill('nitric')
  const up = page.getByRole('button', { name: 'Move up' }).first()
  await expect(up).toBeDisabled()
  await up.hover({ force: true })
  await expect(tooltip(page)).toBeVisible({ timeout: 250 })
  await expect(tooltip(page)).toHaveText('Clear the filter to reorder rows')
  await expect(up).toHaveAccessibleDescription('Clear the filter to reorder rows')
})

test('the absorbing and feeding badges show and describe their hint', async ({ page }) => {
  await open(page, FEEDER)
  for (const name of ['Absorbs byproduct', 'Feeds an absorbing row']) {
    const badge = page.getByRole('img', { name })
    await expect(badge).toHaveCount(1)
    const hint = (await badge.getAttribute('data-tip'))!
    expect(hint.length).toBeGreaterThan(name.length)
    await expect(badge).toHaveAccessibleDescription(hint)
    await badge.hover()
    await expect(tooltip(page)).toBeVisible({ timeout: 250 })
    await expect(tooltip(page)).toHaveText(hint)
  }
})

test('no element of the table, the side panel or the picker keeps a native title', async ({ page }) => {
  await open(page)
  await expect(page.locator('[title]')).toHaveCount(0)
  await page.getByTestId('recipe-name').first().click()
  await expect(page.getByTestId('machine-picker-button')).toBeVisible()
  await expect(page.locator('[title]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add recipe' }).click()
  await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
  await expect(page.locator('[title]')).toHaveCount(0)
})
