import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

const FIXTURE = path.resolve('e2e/fixtures/block-tabs-seablock.json')

test('icon <source> takes no layout space, so no phantom gap precedes the image', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  const tab = page.locator('button[title="Red science"]')
  await expect(tab.locator('img')).toBeVisible()

  const displays = await page.evaluate(() =>
    [...document.querySelectorAll('picture > source')].map(s => getComputedStyle(s).display),
  )
  expect(displays.length).toBeGreaterThan(0)
  expect(displays.every(d => d === 'none'), 'every picture > source is display: none').toBe(true)

  // The icon is the first child of the tab's flex row: it starts at the left padding, with no gap before it.
  const offsets = await tab.evaluate((button: HTMLElement) => {
    const img = button.querySelector('img')!
    const paddingLeft = parseFloat(getComputedStyle(button).paddingLeft)
    const borderLeft = parseFloat(getComputedStyle(button).borderLeftWidth)
    return {
      offset: img.getBoundingClientRect().left - button.getBoundingClientRect().left,
      expected: paddingLeft + borderLeft,
    }
  })
  expect(offsets.offset).toBeLessThanOrEqual(offsets.expected + 0.5)
})
