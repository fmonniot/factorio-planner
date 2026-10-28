import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * The areas viewer as a balance matrix. The fixture has two copies of the area-row-conveniences
 * block ("Hydrogen", "Hydrogen 2": Top level, Compression, Chlorides) and an "Acid" block without
 * areas that takes hydrogen chloride from "Hydrogen" through a connection.
 */
const FIXTURE = path.resolve('e2e/fixtures/area-matrix.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'
const CHLORIDES_HANDLE = 'ffff0005-0000-0000-0000-000000000002'
const CHLORIDES = 'ffff0020-0000-0000-0000-000000000001'
const HYDROGEN = 'ffff0001-0000-0000-0000-000000000001'
const HCl = 'nullius-hydrogen-chloride'

const row = (page: Page, id: string) => page.locator(`main tr[data-node-id="${id}"]`)
const blockTabs = (page: Page) => page.getByRole('group', { name: 'Block' })
const matrix = (page: Page, block = 'Hydrogen') => page.getByRole('table', { name: `Areas of ${block}` })

async function open(page: Page): Promise<void> {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page, ROOT_ELEC)).toBeVisible({ timeout: 10000 })
  await page.getByRole('button', { name: 'Areas in every block' }).click()
}

test('the block view balances every row and names the areas', async ({ page }) => {
  await open(page)

  await expect(blockTabs(page).getByRole('button')).toHaveText([/^Hydrogen\s*3$/, /^Hydrogen 2\s*3$/, 'All blocks'])
  await expect(matrix(page).getByRole('columnheader')).toHaveText([
    /items/, 'From outside', /^Top level/, /^Compression/, /^Chlorides/, 'To outside',
  ])
  for (const name of ['Top level', 'Compression', 'Chlorides']) {
    await expect(matrix(page).getByRole('button', { name })).toBeVisible()
  }

  // Each row balances: the area cells plus what comes from outside minus what goes outside.
  const sums = await matrix(page).locator('tr[data-item-id]').evaluateAll(trs =>
    trs.map(tr => {
      const rate = (sel: string) => Number(tr.querySelector(sel)?.getAttribute('data-rate') ?? 0)
      const cells = [...tr.querySelectorAll('td[data-col]:not([data-col$="outside"])')]
      const areas = cells.reduce((n, td) => n + Number(td.getAttribute('data-rate')), 0)
      return areas + rate('td[data-col="from-outside"]') - rate('td[data-col="to-outside"]')
    }),
  )
  expect(sums.length).toBeGreaterThan(0)
  for (const s of sums) expect(Math.abs(s)).toBeLessThan(1e-6)

  const hcl = matrix(page).locator(`tr[data-item-id="${HCl}"]`)
  await expect(hcl.locator(`td[data-col="${CHLORIDES}"]`)).toHaveAttribute('data-sign', 'send')
  await expect(hcl.locator('td[data-col="to-outside"]')).not.toBeEmpty()
})

test('A-Z lists the rows without groups', async ({ page }) => {
  await open(page)
  await page.getByRole('group', { name: 'Rows' }).getByRole('button', { name: 'A–Z' }).click()
  await expect(matrix(page).locator('th[scope="rowgroup"]')).toHaveCount(0)
  const names = await matrix(page).locator('tbody tr[data-item-id] th[scope="row"]').allTextContents()
  expect(names.length).toBeGreaterThan(1)
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
})

test('focusing an area shows its counterparts and jumps to its row', async ({ page }) => {
  await open(page)

  await matrix(page).getByRole('button', { name: 'Chlorides' }).click()
  await expect(matrix(page).getByRole('button', { name: 'Chlorides' })).toHaveAttribute('aria-pressed', 'true')
  const panel = page.getByRole('complementary', { name: 'Chlorides' })
  await expect(panel).toContainText('Area in Hydrogen')
  const counterparts = matrix(page).locator('td[data-counterpart="true"]')
  await expect(counterparts.first()).toHaveText(/→$/)

  await panel.getByRole('button', { name: 'Show in table' }).click()
  await expect(page.getByLabel('Filter areas')).toHaveCount(0)
  await expect(page.locator('button[title="Hydrogen"]')).toHaveAttribute('aria-current', 'true')
  await expect(row(page, CHLORIDES_HANDLE)).toHaveAttribute('data-highlighted', 'true')
})

test('the filter keeps the matching area column', async ({ page }) => {
  await open(page)

  await page.getByLabel('Filter areas').fill('Chlorides')
  await expect(matrix(page).locator('th[data-area-id]')).toHaveCount(1)
  await expect(matrix(page).locator(`th[data-area-id="${CHLORIDES}"]`)).toBeVisible()

  // A query naming the block keeps every area column.
  await page.getByLabel('Filter areas').fill('Hydrogen')
  await expect(matrix(page).locator('th[data-area-id]')).toHaveCount(3)

  await page.getByLabel('Filter areas').fill('zzz')
  await expect(page.getByText(/No area or item matches/)).toBeVisible()
})

test('All blocks puts the blocks side by side with what no block takes', async ({ page }) => {
  await open(page)

  await blockTabs(page).getByRole('button', { name: 'All blocks' }).click()
  await expect(page.getByRole('checkbox', { name: 'Only items that cross a block boundary' })).toBeChecked()
  const hcl = page.locator(`tr[data-item-id="${HCl}"]`)
  await expect(hcl).toBeVisible()

  // The active block starts expanded, the others collapsed.
  const header = page.getByRole('button', { name: /^Hydrogen\b.*3 areas/ })
  await expect(header).toHaveAttribute('aria-expanded', 'true')
  await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'false')
  await expect(hcl.locator(`td[data-col="${HYDROGEN}:areas"]`)).toBeVisible()
  await expect(page.getByRole('columnheader', { name: /Acid/ }).getByRole('button')).toHaveCount(0)
  await expect(hcl.locator('td[data-col="not-taken"]')).toHaveText('1200')

  // The figure counts every block, so unticking the filter does not change it.
  await page.getByRole('checkbox', { name: 'Only items that cross a block boundary' }).uncheck()
  await expect(hcl.locator('td[data-col="not-taken"]')).toHaveText('1200')
  await page.getByRole('checkbox', { name: 'Only items that cross a block boundary' }).check()

  await hcl.getByRole('button').click()
  const inspector = page.getByRole('region', { name: 'Hydrogen chloride across blocks' })
  await expect(inspector).toContainText('leaves the block')
  await expect(inspector).toContainText('enters the block')
  await expect(inspector).toContainText('1200/m is not taken')
})

test('Escape closes the viewer', async ({ page }) => {
  await open(page)
  await expect(page.getByLabel('Filter areas')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByLabel('Filter areas')).toHaveCount(0)
})
