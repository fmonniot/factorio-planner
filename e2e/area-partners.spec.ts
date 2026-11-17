import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * The chips of an area row and the "Trades with" list of the areas viewer name the partner of each route: "from Oil",
 * "to the rest of the block", "from outside the block". The first fixture is the synthetic case 7 (a gear block with a
 * plate line and a rod line, both separate areas) on real Nullius recipes; the others are the fixtures of the area-row
 * specs, with several partners and with twenty received items.
 */
const PARTNERS = path.resolve('e2e/fixtures/area-partners.json')
const ROUTES = path.resolve('e2e/fixtures/area-routes.json')
const OVERFLOW = path.resolve('e2e/fixtures/area-chips-overflow.json')

const ASSEMBLY_HANDLE = 'ffff0105-0000-0000-0000-000000000001'
const PLATE_HANDLE = 'cccc0005-0000-0000-0000-000000000001'
const ROD_HANDLE = 'cccc0005-0000-0000-0000-000000000002'
const PLATE_LINE = 'cccc0010-0000-0000-0000-000000000001'
const ROD_LINE = 'cccc0020-0000-0000-0000-000000000001'

const row = (page: Page, id: string) => page.locator(`main tr[data-node-id="${id}"]`)
const matrix = (page: Page, block: string) => page.getByRole('table', { name: `Areas of ${block}` })

async function open(page: Page, fixture: string, firstRow: string): Promise<void> {
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(row(page, firstRow)).toBeVisible({ timeout: 10000 })
}

async function focus(page: Page, block: string, area: string): Promise<void> {
  await page.getByRole('button', { name: 'Areas in every block' }).click()
  await matrix(page, block).getByRole('button', { name: area }).click()
}

test('the chips of case 7 name the partner of each route', async ({ page }) => {
  await open(page, PARTNERS, PLATE_HANDLE)

  const plateIn = row(page, PLATE_HANDLE).getByTestId('area-chips-in')
  await expect(plateIn.locator('[data-item-id="iron-ore"]')).toHaveAttribute('aria-label', / — from outside the block$/)
  const plateOut = row(page, PLATE_HANDLE).getByTestId('area-chips-out')
  await expect(plateOut.locator('[data-item-id="nullius-iron-plate"]')).toHaveAttribute('aria-label', / — to the rest of the block$/)
  await expect(plateOut.locator('[data-item-id="nullius-gravel"]')).toHaveAttribute('aria-label', / — to outside the block$/)

  const rodIn = row(page, ROD_HANDLE).getByTestId('area-chips-in')
  await expect(rodIn.locator('[data-item-id="nullius-iron-ingot"]')).toHaveAttribute('aria-label', / — from the rest of the block$/)
  const rodOut = row(page, ROD_HANDLE).getByTestId('area-chips-out')
  await expect(rodOut.locator('[data-item-id="nullius-iron-rod"]')).toHaveAttribute('aria-label', / — to the rest of the block$/)
})

test('Trades with lists the items each partner exchanges', async ({ page }) => {
  await open(page, PARTNERS, PLATE_HANDLE)
  await focus(page, 'Gears', 'Top level')
  const panel = page.getByRole('complementary', { name: 'Top level' })

  const plate = panel.getByTestId(`trade-lines-${PLATE_LINE}`).locator('li')
  await expect(plate).toHaveCount(1)
  await expect(plate.first()).toHaveAttribute('data-item-id', 'nullius-iron-plate')
  await expect(plate.first()).toHaveAttribute('data-direction', 'in')
  await expect(plate.first()).toHaveText(/[a-z](60\.0)\/m in$/i)

  const rod = panel.getByTestId(`trade-lines-${ROD_LINE}`).locator('li')
  await expect(rod).toHaveCount(2)
  await expect(rod.nth(0)).toHaveAttribute('data-item-id', 'nullius-iron-rod')
  await expect(rod.nth(0)).toHaveAttribute('data-direction', 'in')
  await expect(rod.nth(0)).toHaveText(/[a-z](30\.0)\/m in$/i)
  await expect(rod.nth(1)).toHaveAttribute('data-item-id', 'nullius-iron-ingot')
  await expect(rod.nth(1)).toHaveAttribute('data-direction', 'out')
  await expect(rod.nth(1)).toHaveText(/[a-z](24\.0)\/m out$/i)

  const outside = panel.getByTestId('trade-lines-outside').locator('li')
  await expect(outside).toHaveCount(3)
  // Biggest rate first, and 60 of Iron gear ties with 60 of Iron ore: by name.
  await expect(outside.nth(0)).toHaveAttribute('data-item-id', 'nullius-iron-gear')
  await expect(outside.nth(0)).toHaveAttribute('data-direction', 'out')
  await expect(outside.nth(1)).toHaveAttribute('data-item-id', 'iron-ore')
  await expect(outside.nth(1)).toHaveAttribute('data-direction', 'in')
  await expect(outside.nth(2)).toHaveAttribute('data-item-id', 'nullius-gravel')
  await expect(outside.nth(2)).toHaveAttribute('data-direction', 'out')
  await expect(panel.getByTestId('trade-lines-outside-toggle')).toHaveCount(0)
})

test('several partners are joined in the title and listed apart in Trades with', async ({ page }) => {
  const COMPRESSION_HANDLE = 'ffff0005-0000-0000-0000-000000000001'
  const BACKUP_HANDLE = 'ffff0005-0000-0000-0000-000000000003'
  const ROOT = 'ffff0002-0000-0000-0000-000000000001'
  const BACKUP = 'ffff0030-0000-0000-0000-000000000001'
  await open(page, ROUTES, COMPRESSION_HANDLE)

  await expect(row(page, COMPRESSION_HANDLE).getByTestId('area-chips-in').locator('[data-item-id="nullius-hydrogen"]'))
    .toHaveAttribute('aria-label', / — from the rest of the block, Backup$/)
  await expect(row(page, BACKUP_HANDLE).getByTestId('area-chips-out').locator('[data-item-id="nullius-hydrogen"]'))
    .toHaveAttribute('aria-label', / — to Compression, Chlorides$/)

  await focus(page, 'Hydrogen', 'Compression')
  const panel = page.getByRole('complementary', { name: 'Compression' })
  const fromRoot = panel.getByTestId(`trade-lines-${ROOT}`).locator('[data-item-id="nullius-hydrogen"]')
  await expect(fromRoot).toHaveAttribute('data-direction', 'in')
  await expect(fromRoot).toHaveText(/[a-z](400)\/m in$/i)
  const fromBackup = panel.getByTestId(`trade-lines-${BACKUP}`).locator('[data-item-id="nullius-hydrogen"]')
  await expect(fromBackup).toHaveAttribute('data-direction', 'in')
  await expect(fromBackup).toHaveText(/[a-z](560)\/m in$/i)
})

test('a long list of trades folds after four lines', async ({ page }) => {
  await open(page, OVERFLOW, ASSEMBLY_HANDLE)
  await focus(page, 'Turrets', 'Assembly')
  const panel = page.getByRole('complementary', { name: 'Assembly' })
  const lines = panel.getByTestId('trade-lines-outside').locator('li')
  const toggle = panel.getByTestId('trade-lines-outside-toggle')
  await expect(lines).toHaveCount(4)
  await expect(toggle).toHaveText('Show all 22')
  await toggle.click()
  await expect(lines).toHaveCount(22)
  await expect(toggle).toHaveText('Show fewer')
  await toggle.click()
  await expect(lines).toHaveCount(4)
})

test('the +N popup has a line per partner that says where it comes from', async ({ page }) => {
  await open(page, OVERFLOW, ASSEMBLY_HANDLE)
  const chips = row(page, ASSEMBLY_HANDLE).getByTestId('area-chips-in')
  const more = chips.getByTestId('area-chips-more')
  await expect(more).toBeVisible({ timeout: 10000 })
  const hiddenCount = Number((await more.textContent())!.replace('+', ''))
  await more.hover()
  const lines = page.getByTestId('area-chips-popup').getByTestId('area-chips-line')
  await expect(lines).toHaveCount(hiddenCount)
  for (const text of await lines.allTextContents()) expect(text).toContain('from outside the block')
})
