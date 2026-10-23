import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture, readActivePlan } from './support/loadPlan'

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

const TAB_ORDER = ['Red science', 'Green science', 'Processing units', 'Advanced circuits', 'Iron coils']

async function tabOrder(page: Page): Promise<string[]> {
  return page.getByTestId('block-tab').evaluateAll(els => els.map(e => e.querySelector('button')!.title))
}

async function savedOrder(page: Page): Promise<string[]> {
  const plan = (await readActivePlan(page, 'kompetenz-seablock')) as { blocks: { name: string }[] }
  return plan.blocks.map(b => b.name)
}

async function openFixture(page: Page) {
  await loadPlanFixture(page, FIXTURE, 'kompetenz-seablock')
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.getByTestId('block-tab')).toHaveCount(5)
}

test.describe('Block tab reorder and overflow', () => {
  test('dragging a tab onto another reorders the blocks and keeps the active one', async ({ page }) => {
    await openFixture(page)
    const source = (await page.locator('button[title="Iron coils"]').boundingBox())!
    const target = (await page.locator('button[title="Green science"]').boundingBox())!

    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 6 })
    await page.mouse.move(target.x + 9, target.y + target.height / 2, { steps: 3 })
    await page.mouse.move(target.x + 10, target.y + target.height / 2, { steps: 3 })
    await expect(page.getByTestId('block-tab-drop-line')).toHaveAttribute('data-side', 'before')
    await page.mouse.up()

    const expected = ['Red science', 'Iron coils', 'Green science', 'Processing units', 'Advanced circuits']
    await expect.poll(() => tabOrder(page), { message: 'tab order' }).toEqual(expected)
    await expect(page.locator('button[title="Processing units"]')).toHaveAttribute('aria-current', 'true')
    await expect.poll(() => savedOrder(page), { message: 'saved order' }).toEqual(expected)
  })

  test('Move right in the context menu swaps a tab with its right neighbour', async ({ page }) => {
    await openFixture(page)
    await page.locator('button[title="Red science"]').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Move right' }).click()
    await expect.poll(() => tabOrder(page)).toEqual(['Green science', 'Red science', ...TAB_ORDER.slice(2)])
  })

  test('narrow window: the strip scrolls and the All blocks menu reaches every tab', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 })
    await openFixture(page)
    const allBlocks = page.getByTitle('All blocks')
    await expect(allBlocks).toBeVisible()
    await expect(page.locator('button[title="Iron coils"]')).not.toBeInViewport()
    await expect(page.getByTitle('Add block')).toBeInViewport()

    await allBlocks.click()
    await expect(page.getByRole('menuitemradio')).toHaveCount(5)
    await expect(page.getByRole('menuitemradio', { name: 'Processing units' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('menuitemradio', { name: 'Iron coils' }).click()
    await expect(page.locator('button[title="Iron coils"]')).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('button[title="Iron coils"]')).toBeInViewport()

    await page.getByTitle('Add block').click()
    await expect(page.getByTestId('block-tab')).toHaveCount(6)
    const added = page.locator('[data-testid="block-tab"] button[aria-current="true"]')
    await expect(added).toBeInViewport()

    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(page.getByTitle('All blocks')).toHaveCount(0)
  })

  test('narrow window: the tab context menu stays fully on screen', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 })
    await openFixture(page)
    // Icons load lazily and widen their tabs; let the strip settle so Playwright's own scroll-into-view does not close the menu.
    await expect.poll(() => page.locator('[data-testid="block-tab"] img').evaluateAll(
      imgs => imgs.every(i => (i as HTMLImageElement).complete),
    ), { message: 'tab icons loaded' }).toBe(true)
    await page.locator('button[title="Processing units"]').scrollIntoViewIfNeeded()
    await page.locator('button[title="Processing units"]').click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeInViewport()
    await expect(page.locator('[aria-label="Block colour"]')).toBeInViewport()
  })
})
