import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The shell clips its overflow (`overflow-hidden`), so `document.scrollWidth` never grows: measure the shell itself
 * and the right edge of the regions that must fit the viewport.
 */
export async function expectShellFits(page: Page): Promise<void> {
  const shell = page.locator('body > div > div').first()
  const [scrollWidth, clientWidth] = await shell.evaluate(el => [el.scrollWidth, el.clientWidth])
  expect(scrollWidth, 'shell content is no wider than the shell').toBeLessThanOrEqual(clientWidth)
  for (const id of ['top-bar', 'table-toolbar']) {
    const region = page.getByTestId(id)
    await expectWithinViewport(page, region)
    // The shell hides overflow inside the regions too: compare each region with its own content.
    const [sw, cw] = await region.evaluate(el => [el.scrollWidth, el.clientWidth])
    expect(sw, `${id} content is no wider than ${id}`).toBeLessThanOrEqual(cw)
  }
  await expectWithinViewport(page, page.getByTestId('summary-pane').first())
}

/** The element's box lies inside the viewport horizontally. */
export async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox()
  const width = page.viewportSize()!.width
  expect(box, 'element has a box').not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(-0.5)
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5)
}

/** The scrolling wrapper of the production table. */
export const tableScroller = (page: Page): Locator =>
  page.locator('main table').first().locator('xpath=ancestor::div[contains(@class,"overflow-auto")][1]')
