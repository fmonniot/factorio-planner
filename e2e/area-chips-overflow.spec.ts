import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/**
 * The "+N" of a collapsed area row opens a popup with the flows the row has no room for. The fixture is one
 * area holding a turret recipe with nine ingredients, so it receives nine items: four chips and "+5".
 */
const FIXTURE = path.resolve('e2e/fixtures/area-chips-overflow.json')

const group = (page: Page, name: string) => page.locator('main table tbody tr').filter({ hasText: name })

test('the +N opens a popup listing the hidden items, on hover and on focus', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE)
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  const chips = group(page, 'Assembly').getByTestId('area-chips')
  await expect(chips.locator('[data-direction="receives"]')).toHaveCount(4, { timeout: 10000 })
  const more = chips.getByTestId('area-chips-more')
  await expect(more).toHaveText('+5')

  const inline = await chips.locator('[data-direction="receives"]').evaluateAll(
    els => els.map(el => el.getAttribute('data-item-id')),
  )

  await more.hover()
  const popup = page.getByRole('tooltip')
  await expect(popup).toBeVisible()
  const hidden = popup.locator('[data-direction="receives"]')
  await expect(hidden).toHaveCount(5)
  const hiddenIds = await hidden.evaluateAll(els => els.map(el => el.getAttribute('data-item-id')))
  for (const id of hiddenIds) expect(inline).not.toContain(id)

  await page.mouse.move(0, 0)
  await expect(popup).toBeHidden()

  await more.focus()
  await expect(popup).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
})
