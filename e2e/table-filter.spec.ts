import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

// The table filter. Hydrogen block: a root row "Steam electrolysis", and two collapsed groups, "Compression"
// (Steam electrolysis, Compressed hydrogen) and "Chlorides" (Hydrogen chloride). 6 rows in all.

const AREAS = path.resolve('e2e/fixtures/area-matrix.json')

async function open(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await loadPlanFixture(page, AREAS)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr [data-variant], main table tbody tr [data-direction]').first()).toBeVisible({ timeout: 10000 })
}

const rows = (page: Page) => page.locator('main table tbody tr')
const field = (page: Page) => page.getByRole('searchbox', { name: 'Filter recipes or items' })
const status = (page: Page) => page.getByTestId('table-filter-status')
const toggle = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^(Expand|Collapse) ${name}$`) })

test('narrows to matches, keeps parents, reports hidden rows', async ({ page }) => {
  await open(page)
  await expect(rows(page)).toHaveCount(3)
  await field(page).fill('chlorine')
  await expect(status(page)).toHaveText(/4 of 6 rows hidden/)
  await expect(page.getByRole('button', { name: 'Collapse Chlorides' })).toBeVisible()
  await expect(rows(page).filter({ hasText: 'Hydrogen chloride' })).toHaveCount(1)
  await expect(toggle(page, 'Compression')).toHaveCount(0)
  await expect(rows(page).filter({ hasText: 'Steam electrolysis' })).toHaveCount(0)

  await field(page).press('Escape')
  await expect(field(page)).toHaveValue('')
  await expect(status(page)).toHaveCount(0)
  await expect(rows(page)).toHaveCount(3)
  await expect(page.getByRole('button', { name: 'Expand Chlorides' })).toBeVisible()
})

test('shows an empty state, and Clear filter restores the table', async ({ page }) => {
  await open(page)
  await field(page).fill('zzzz')
  await expect(page.getByText('No rows match "zzzz"')).toBeVisible()
  await expect(page.locator('main table')).toHaveCount(0)
  await page.getByRole('button', { name: 'Show all rows' }).click()
  await expect(rows(page)).toHaveCount(3)
  await expect(field(page)).toHaveValue('')
})

test('a group whose name matches shows its whole subtree', async ({ page }) => {
  await open(page)
  await field(page).fill('chlorides')
  await expect(status(page)).toHaveText(/4 of 6 rows hidden/)
  await expect(page.getByRole('button', { name: 'Collapse Chlorides' })).toBeVisible()
  await expect(rows(page).filter({ hasText: 'Hydrogen chloride' })).toHaveCount(1)
})

test('the toolbar does not overflow at phone width with a filter active', async ({ page }) => {
  await open(page)
  await field(page).fill('chlorine')
  await page.setViewportSize({ width: 375, height: 800 })
  await expect(field(page)).toBeHidden()
  await expect(status(page)).toBeVisible()
  const toolbar = page.getByTestId('table-toolbar')
  const overflow = await toolbar.evaluate(el => el.scrollWidth - el.clientWidth)
  expect(overflow, 'toolbar scrollWidth beyond clientWidth').toBeLessThanOrEqual(0)
  const box = await status(page).boundingBox()
  expect(box!.x + box!.width).toBeLessThanOrEqual(375)
})
