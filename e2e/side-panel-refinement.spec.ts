import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { sidePanel, selectRow } from './support/sidePanel'

/**
 * The side panel's visual refinement (artifact checks `7 panDash`, `7 panSwitch and panLists`, `7 panNarrow`): the Effects
 * table only once a module or a beacon is set, the Pin rate switch with its rate input on the same line, Receives and Sends
 * capped at six entries, and a drawer of at most 300 px below 1280 px.
 */
const FIXTURE = path.resolve('e2e/fixtures/area-row-conveniences.json')
const OVERFLOW_FIXTURE = path.resolve('e2e/fixtures/area-chips-overflow.json')
const ROOT_ELEC = 'ffff0004-0000-0000-0000-000000000001'
const row = (page: Page) => page.locator(`main tr[data-node-id="${ROOT_ELEC}"]`)
const backdrop = (page: Page) => page.getByTestId('side-panel-backdrop')

async function load(page: Page, fixture: string): Promise<void> {
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
}

test.describe('docked panel', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('Effects on this row appears with the first beacon configuration and goes with the last', async ({ page }) => {
    await load(page, FIXTURE)
    const panel = await selectRow(page, row(page))
    const headings = panel.getByRole('heading', { level: 3 })
    await expect(headings).toHaveText(['Rate', 'Machine', 'Beacons', 'Where inputs come from'])
    await expect(panel.getByText('Effects on this row')).toHaveCount(0)

    await panel.getByTestId('add-beacon-config').click()
    await expect(headings).toHaveText(['Rate', 'Machine', 'Beacons', 'Effects on this row', 'Where inputs come from'])
    await expect(panel.getByTestId('panel-effects')).toBeVisible()

    await panel.getByRole('button', { name: 'Remove beacon configuration' }).click()
    await expect(panel.getByText('Effects on this row')).toHaveCount(0)
  })

  test('Pin rate is a switch whose rate input sits on its line and keeps the section height', async ({ page }) => {
    await load(page, FIXTURE)
    const panel = await selectRow(page, row(page))
    const pin = panel.getByRole('switch', { name: 'Pin rate' })
    const section = panel.getByTestId('panel-rate')
    await expect(pin).not.toBeChecked()
    const before = (await section.boundingBox())!.height

    await pin.check()
    await expect(pin).toBeChecked()
    const input = panel.getByRole('spinbutton', { name: 'Pinned rate' })
    await expect(input).toBeVisible()
    const track = (await pin.locator('xpath=following-sibling::span[1]').boundingBox())!
    const box = (await input.boundingBox())!
    expect(Math.abs((box.y + box.height / 2) - (track.y + track.height / 2)), 'the input is on the switch line').toBeLessThanOrEqual(3)
    expect(box.x).toBeGreaterThan(track.x + track.width)
    expect(box.width).toBe(90)
    expect((await section.boundingBox())!.height, 'pinning does not change the section height').toBe(before)

    await pin.uncheck()
    await expect(input).toHaveCount(0)
    expect((await section.boundingBox())!.height).toBe(before)
  })

  test('Receives and Sends show six entries until "Show all N"', async ({ page }) => {
    await load(page, OVERFLOW_FIXTURE)
    await page.locator('main table tbody tr').filter({ hasText: 'Assembly' }).getByTestId('group-summary').click()
    const panel = sidePanel(page)
    const receives = panel.getByTestId('area-receives')
    await expect(receives.getByRole('listitem')).toHaveCount(6)
    await panel.getByRole('button', { name: 'Show all 20' }).click()
    await expect(receives.getByRole('listitem')).toHaveCount(20)
    await panel.getByRole('button', { name: 'Show fewer' }).click()
    await expect(receives.getByRole('listitem')).toHaveCount(6)
  })

  test('Escape does not clear the selection while the panel is docked', async ({ page }) => {
    await load(page, FIXTURE)
    const panel = await selectRow(page, row(page))
    await page.keyboard.press('Escape')
    await expect(panel).toBeVisible()
  })

  test('stays docked at 380 px', async ({ page }) => {
    await load(page, FIXTURE)
    const panel = await selectRow(page, row(page))
    await expect(panel).toHaveCSS('position', 'static')
    expect((await panel.boundingBox())!.width).toBe(380)
  })
})

test.describe('drawer', () => {
  for (const [width, expected] of [[820, 300], [1279, 300], [400, 260], [360, 220], [320, 200]] as const) {
    test(`is ${expected} px wide at ${width} px and leaves the row's first column visible`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await load(page, FIXTURE)
      const panel = await selectRow(page, row(page))
      await expect(panel).toHaveCSS('position', 'fixed')
      const box = (await panel.boundingBox())!
      expect(box.width).toBe(expected)
      expect(box.x + box.width).toBe(width)
      // The selected row's recipe is not hidden behind the drawer.
      const name = (await row(page).getByTestId('recipe-name').boundingBox())!
      expect(name.x).toBeLessThan(box.x)
    })
  }

  test('is dismissed by its backdrop and its close button', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 })
    await load(page, FIXTURE)
    await selectRow(page, row(page))
    await backdrop(page).click({ position: { x: 20, y: 400 } })
    await expect(sidePanel(page)).toHaveCount(0)
    await selectRow(page, row(page))
    await sidePanel(page).getByRole('button', { name: 'Close panel' }).click()
    await expect(sidePanel(page)).toHaveCount(0)
  })

  test('is dismissed by Escape', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 })
    await load(page, FIXTURE)
    await selectRow(page, row(page))
    await page.keyboard.press('Escape')
    await expect(sidePanel(page)).toHaveCount(0)
  })

  test('Escape closes an open picker first and the drawer on the next press', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 })
    await load(page, FIXTURE)
    const panel = await selectRow(page, row(page))
    // A popover opened from the drawer.
    await panel.getByTestId('machine-picker-button').click()
    const machines = page.getByTestId('picker')
    await expect(machines).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(machines).toHaveCount(0)
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  })

  test('Escape closes the recipe picker opened over the drawer, not the drawer', async ({ page }) => {
    await load(page, FIXTURE)
    const panel = await selectRow(page, row(page))
    // Open the picker while docked (the drawer backdrop would cover the toolbar), then narrow the window to a drawer.
    await page.getByRole('button', { name: 'Add recipe' }).click()
    const picker = page.getByRole('heading', { name: 'Add recipe' })
    await expect(picker).toBeVisible()
    await page.setViewportSize({ width: 820, height: 900 })
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(panel).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
  })

  for (const width of [320, 360]) {
    test(`does not scroll sideways at ${width} px with a beacon configuration`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await load(page, FIXTURE)
      const panel = await selectRow(page, row(page))
      await panel.getByTestId('add-beacon-config').click()
      await expect(panel.getByTestId('beacon-card')).toBeVisible()
      const { scroll, client } = await panel.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }))
      expect(scroll, 'the panel has no horizontal overflow').toBeLessThanOrEqual(client)
    })
  }

  for (const width of [820, 320]) {
    test(`Pin rate keeps the section height at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await load(page, FIXTURE)
      const panel = await selectRow(page, row(page))
      const pin = panel.getByRole('switch', { name: 'Pin rate' })
      const section = panel.getByTestId('panel-rate')
      const before = (await section.boundingBox())!.height
      await pin.check()
      await expect(panel.getByRole('spinbutton', { name: 'Pinned rate' })).toBeVisible()
      expect((await section.boundingBox())!.height, 'pinning does not change the section height').toBe(before)
      // The explanation is the switch's description, not only a tooltip.
      await expect(pin).toHaveAccessibleDescription('The row always runs at this rate, whatever the block needs.')
      const { scroll, client } = await panel.evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth }))
      expect(scroll, 'the pinned rate fits the drawer').toBeLessThanOrEqual(client)
      await pin.uncheck()
      expect((await section.boundingBox())!.height).toBe(before)
    })
  }
})
