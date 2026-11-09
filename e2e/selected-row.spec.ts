import { test, expect, type Page, type Locator } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * A selected row is clearly different (visual refinement, finding 8, `selStrong`): a full-row teal tint, a 3px
 * bar on the left, a 1px outline around the row and a white, bold name. Group rows too. The fixture has a recipe
 * row in the root and two separate areas.
 */
const FIXTURE = path.resolve('e2e/fixtures/area-row-conveniences.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'

const row = (page: Page, id: string) => page.locator(`main tr[data-node-id="${id}"]`)
const group = (page: Page) => page.locator('main table tbody tr:not([data-node-id="' + ROOT_ELEC + '"])').filter({ has: page.getByRole('button', { name: /^(Collapse|Expand) / }) }).first()

interface RowLook {
  background: string
  outline: string
  bar: string
  nameColor: string
  nameWeight: string
}

async function look(tr: Locator, name: Locator): Promise<RowLook> {
  const [background, outline, bar, nameColor, nameWeight] = await Promise.all([
    tr.evaluate(el => getComputedStyle(el).backgroundColor),
    tr.evaluate(el => {
      const s = getComputedStyle(el)
      return `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor} offset ${s.outlineOffset}`
    }),
    tr.locator('td').first().evaluate(el => getComputedStyle(el).boxShadow),
    name.evaluate(el => getComputedStyle(el).color),
    name.evaluate(el => getComputedStyle(el).fontWeight),
  ])
  return { background, outline, bar, nameColor, nameWeight }
}

test.beforeEach(async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page, ROOT_ELEC)).toBeVisible({ timeout: 10000 })
})

test('8 selStrong: a selected recipe row gets a full-row tint, a bar, an outline and a white bold name', async ({ page }) => {
  const tr = row(page, ROOT_ELEC)
  const name = tr.getByTestId('recipe-name')
  const before = await look(tr, name)
  const box = await tr.boundingBox()
  expect(before.bar).toBe('none')

  await tr.locator('td').last().click()
  await expect(tr).toHaveAttribute('data-selected', 'true')
  // Move the pointer away: the hover tint must not hide the selection.
  await page.mouse.move(0, 0)
  const after = await look(tr, name)

  expect(after.background, 'tint changes').not.toBe(before.background)
  expect(after.background).toBe('rgba(20, 184, 166, 0.22)')
  expect(after.bar).toContain('rgb(45, 212, 191)')
  expect(after.bar).toContain('3px')
  expect(after.outline).toBe('1px solid rgba(45, 212, 191, 0.65) offset -1px')
  expect(after.nameColor).toBe('rgb(255, 255, 255)')
  expect(after.nameWeight).toBe('700')

  // Hovering the selected row keeps the tint.
  await tr.hover()
  expect((await look(tr, name)).background).toBe('rgba(20, 184, 166, 0.22)')

  // Selecting costs no height (the width follows the side panel, which is not this change).
  expect((await tr.boundingBox())!.height).toBe(box!.height)
})

test('8 selStrong: a group row gets the same treatment', async ({ page }) => {
  const tr = group(page)
  await expect(tr).toBeVisible()
  const name = tr.locator('td').nth(1).getByRole('button').nth(1)
  const before = await look(tr, name)

  await tr.locator('td').last().click()
  await expect(tr).toHaveAttribute('data-selected', 'true')
  await page.mouse.move(0, 0)
  const after = await look(tr, name)

  expect(after.background).toBe('rgba(20, 184, 166, 0.22)')
  expect(after.background).not.toBe(before.background)
  expect(after.bar).toContain('rgb(45, 212, 191)')
  expect(after.outline).toBe('1px solid rgba(45, 212, 191, 0.65) offset -1px')
  expect(after.nameColor).toBe('rgb(255, 255, 255)')
  expect(after.nameWeight).toBe('700')
})
