import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { sidePanel, selectRow, outputEntry } from './support/sidePanel'

/**
 * The side panel's "Where outputs go" section: for each product and byproduct of the selected row, which rows of the block
 * use it, which blocks it is sent to and what is left over.
 *
 * `byproduct-consumer-surplus.json`: goal hydrogen, steam electrolysis (makes oxygen as a byproduct) and nitric acid,
 * which absorbs the oxygen. `connection-replaces-import.json`: the block "Pipes" supplies pipes to the block "Valves".
 */
const SURPLUS = path.resolve('e2e/fixtures/byproduct-consumer-surplus.json')
const CONNECTION = path.resolve('e2e/fixtures/connection-replaces-import.json')
const ELECTROLYSIS = 'bbbb0004-0000-0000-0000-000000000001'
const PIPE_ROW = 'dddd0001-0000-0000-0000-0000000000n1'
const NITRIC = 'bbbb0005-0000-0000-0000-000000000001'

const row = (page: Page, id: string) => page.locator(`main tr[data-node-id="${id}"]`)

async function load(page: Page, fixture: string) {
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
}

test('a byproduct is read as used by the row that absorbs it', async ({ page }) => {
  await load(page, SURPLUS)
  const panel = await selectRow(page, row(page, ELECTROLYSIS))

  // Research depends on the data set's technology data, so only the order of the two sections is fixed.
  const headings = await panel.getByRole('heading', { level: 3 }).allTextContents()
  expect(headings.indexOf('Where outputs go')).toBe(headings.indexOf('Where inputs come from') + 1)

  await expect(outputEntry(page, 'nullius-oxygen')).toHaveAttribute('data-byproduct', 'true')
  const oxygen = outputEntry(page, 'nullius-oxygen').getByTestId('output-sentence')
  await expect(oxygen).toContainText('Used here by')
  await expect(oxygen).toContainText('absorber')
  const hydrogen = outputEntry(page, 'nullius-hydrogen')
  await expect(hydrogen).not.toHaveAttribute('data-byproduct', 'true')
  await expect(hydrogen.getByTestId('output-sentence')).toContainText('A product of this block')

  await selectRow(page, row(page, NITRIC))
  // The absorber's own acid is made for nothing here: the block has 12.5/min of it left over.
  await expect(sidePanel(page).getByTestId('output-sentence')).toHaveText('Left over: no row or block uses it (12.5/m).')
})

test('an output is read as sent to the block that takes it', async ({ page }) => {
  await load(page, CONNECTION)
  await page.locator('[data-testid="block-tab"] button[aria-label="Pipes"]').click()
  await selectRow(page, row(page, PIPE_ROW))
  await expect(outputEntry(page, 'pipe').getByTestId('output-sentence')).toContainText('Sent to Valves')
})
