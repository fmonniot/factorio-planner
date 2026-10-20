import { test, expect } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/** Five Seablock blocks whose first goals have busy icons: two science packs, processing unit, advanced circuit, iron sheet coil. */
const FIXTURE = path.resolve('e2e/fixtures/block-tabs-seablock.json')
const TABS = ['Red science', 'Green science', 'Processing units', 'Advanced circuits', 'Iron coils']

test('each block tab shows its first goal icon and its name', async ({ page }) => {
  await loadPlanFixture(page, FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })

  for (const name of TABS) {
    const tab = page.locator(`button[title="${name}"]`)
    await expect(tab).toHaveText(name)
    const icon = tab.locator('img')
    await expect(icon).toBeVisible()
    await expect.poll(() => icon.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), { message: `${name} icon loaded` }).toBe(true)
  }
  await expect(page.locator('button[title="Processing units"]')).toHaveAttribute('aria-current', 'true')
})
