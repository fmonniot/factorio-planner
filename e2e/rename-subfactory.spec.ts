import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { clickRowAction } from './support/rowMenu'

/** A sub-factory is renamed from its right-click menu. */
const FIXTURE = path.resolve('e2e/fixtures/byproduct-add-consumer.json')

test.describe('Rename subfactory through the right-click menu', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  })

  test('renames a sub-factory, and a dismissed prompt leaves it unchanged', async ({ page }) => {
    const rows = page.locator('main table tbody tr')

    page.once('dialog', d => void d.accept('Smelting'))
    await clickRowAction(page, rows.first(), 'Wrap in subfactory…')
    const subRow = rows.filter({ hasText: 'Smelting' })
    await expect(subRow).toBeVisible()

    let defaultValue = ''
    page.once('dialog', d => {
      defaultValue = d.defaultValue()
      void d.accept('Furnaces')
    })
    await clickRowAction(page, subRow, 'Rename subfactory…')
    expect(defaultValue).toBe('Smelting')
    await expect(rows.filter({ hasText: 'Furnaces' })).toBeVisible()
    await expect(rows.filter({ hasText: 'Smelting' })).toHaveCount(0)

    page.once('dialog', d => void d.dismiss())
    await clickRowAction(page, rows.filter({ hasText: 'Furnaces' }), 'Rename subfactory…')
    await expect(rows.filter({ hasText: 'Furnaces' })).toBeVisible()
  })
})
