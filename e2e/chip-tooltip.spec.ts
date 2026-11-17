import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * Item chips show their name and rate in an instant tooltip (`TooltipLayer`), not the browser's delayed `title`. The
 * accessible name is the same text (`aria-label`); the tooltip itself is `aria-hidden`, fixed on `document.body` and gone as
 * soon as the pointer leaves, the chip is pressed, Escape is pressed or the table scrolls. Touch never opens it.
 */
const FIXTURE = path.resolve('e2e/fixtures/byproduct-consumer-base.json')
const SUMMARY = path.resolve('e2e/fixtures/summary-many-items.json')
const PARTNERS = path.resolve('e2e/fixtures/area-partners.json')
const NO_CHOICE = { cookies: [], origins: [] }

const tooltip = (page: Page) => page.getByTestId('tooltip')
const chips = (page: Page) => page.locator('main table tbody tr [data-variant="ingredient"]')

async function open(page: Page, fixture = FIXTURE): Promise<void> {
  await loadPlanFixture(page, fixture)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 20000 })
}

test('opens instantly with the chip name and rate, without a role', async ({ page }) => {
  await open(page)
  const chip = chips(page).first()
  const label = await chip.getAttribute('aria-label')
  await chip.hover()
  await expect(tooltip(page)).toBeVisible({ timeout: 250 })
  await expect(tooltip(page)).toHaveText(label!)
  expect(label).toMatch(/^.+ — \S+$/)
  await expect(tooltip(page)).not.toHaveAttribute('role', /.+/)
  await expect(tooltip(page)).toHaveAttribute('aria-hidden', 'true')
})

test('no chip of the table keeps a native title', async ({ page }) => {
  await open(page)
  await expect(page.locator('main table tbody tr [data-variant][title]')).toHaveCount(0)
})

test('is a fixed box on the body, inside the window, also on a narrow screen', async ({ page }) => {
  await open(page)
  const chip = chips(page).first()
  await chip.hover()
  await expect(tooltip(page)).toBeVisible()
  expect(await tooltip(page).evaluate(el => el.parentElement === document.body)).toBe(true)
  const inside = async () => {
    const box = (await tooltip(page).boundingBox())!
    const { width, height } = page.viewportSize()!
    expect(box.x).toBeGreaterThanOrEqual(8)
    expect(box.x + box.width).toBeLessThanOrEqual(width - 8)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(height)
  }
  await inside()
  await page.setViewportSize({ width: 360, height: 800 })
  await expect(tooltip(page)).toHaveCount(0) // a resize closes it
  await chips(page).first().scrollIntoViewIfNeeded()
  await chips(page).first().hover()
  await expect(tooltip(page)).toBeVisible()
  await inside()
})

test('closes when the pointer leaves, on press, on Escape and when the table scrolls', async ({ page }) => {
  await open(page)
  const chip = chips(page).first()
  await chip.hover()
  await expect(tooltip(page)).toBeVisible()
  await page.mouse.move(2, 2)
  await expect(tooltip(page)).toHaveCount(0)

  await chip.hover()
  await expect(tooltip(page)).toBeVisible()
  await chip.click()
  await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
  await expect(tooltip(page)).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Add recipe' })).toHaveCount(0)

  await chip.hover()
  await expect(tooltip(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tooltip(page)).toHaveCount(0)

  await page.mouse.move(2, 2) // Escape hides it until the pointer comes back
  // A real scroll: the fixture is short, so stretch the table until its container (the scroll container) overflows, then scroll it.
  const table = page.locator('main table').first()
  await table.evaluate(t => { t.style.marginBottom = '3000px' })
  const scroller = table.locator('xpath=ancestor::*[contains(@class,"overflow-auto") or contains(@class,"overflow-y-auto")][1]')
  expect(await scroller.evaluate(el => el.scrollHeight > el.clientHeight), 'the table body overflows').toBe(true)
  await scroller.evaluate(el => { el.scrollTop = 0 })
  await chip.hover()
  await expect(tooltip(page)).toBeVisible()
  await scroller.evaluate(el => { el.scrollTop = 30 })
  await expect(tooltip(page)).toHaveCount(0)
})

test('stays visible while the pointer crosses from the chip icon to its quantity', async ({ page }) => {
  await open(page)
  const chip = chips(page).first()
  const box = (await chip.boundingBox())!
  await page.mouse.move(box.x + 4, box.y + 4)
  await expect(tooltip(page)).toBeVisible()
  await page.mouse.move(box.x + box.width - 3, box.y + box.height - 3, { steps: 4 })
  await expect(tooltip(page)).toBeVisible()
})

test('opens on keyboard focus but not after a mouse click', async ({ page }) => {
  await open(page)
  const chip = chips(page).first()
  await chip.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(chip).toBeFocused()
  await expect(tooltip(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(tooltip(page)).toHaveCount(0)

  await page.reload()
  await expect(chips(page).first()).toBeVisible({ timeout: 20000 })
  await chips(page).first().click()
  await page.mouse.move(2, 2)
  await expect(tooltip(page)).toHaveCount(0)
})

test.describe('touch', () => {
  test.use({ hasTouch: true })

  test('a tap does the chip action and never shows the tooltip', async ({ page }) => {
    await open(page)
    await chips(page).first().tap()
    await expect(page.getByRole('heading', { name: 'Add recipe' })).toBeVisible()
    await expect(tooltip(page)).toHaveCount(0)
  })
})

test.describe('collapsed summary', () => {
  test.use({ storageState: NO_CHOICE })

  test('a line chip names its goal', async ({ page }) => {
    await open(page, SUMMARY)
    const chip = page.getByTestId('summary-line-chip').first()
    await chip.hover()
    await expect(tooltip(page)).toBeVisible({ timeout: 250 })
    await expect(tooltip(page)).toHaveText(/^.+ — .+/)
    await expect(tooltip(page)).toHaveText((await chip.getAttribute('aria-label'))!)
  })
})

test('an expanded summary slot shows only the item name', async ({ page }) => {
  await open(page, SUMMARY)
  const slot = page.getByTestId('summary-slot').first()
  await slot.hover()
  await expect(tooltip(page)).toBeVisible({ timeout: 250 })
  await expect(tooltip(page)).toHaveText((await slot.getAttribute('data-tip'))!)
  await expect(tooltip(page)).not.toHaveText(/ — | per /)
})

test('an area flow chip names the other end of its route', async ({ page }) => {
  await open(page, PARTNERS)
  const chip = page.getByTestId('area-chips-in').first().locator('[data-item-id]').first()
  await chip.hover()
  await expect(tooltip(page)).toBeVisible({ timeout: 250 })
  await expect(tooltip(page)).toHaveText(/ — from /)
})
