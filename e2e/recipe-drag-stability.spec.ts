import { test, expect, type Page } from '@playwright/test'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'

/** Dragging a recipe row must not move the other rows or resize the columns. */
const FIXTURE = path.resolve('e2e/fixtures/summary-many-items.json')

async function layout(page: Page, rowCount: number) {
  return page.evaluate(n => {
    const rows = [...document.querySelectorAll('main table tbody tr')].slice(0, n)
    return {
      tops: rows.map(r => Math.round(r.getBoundingClientRect().top)),
      widths: [...document.querySelectorAll('main table thead th')].map(th => Math.round(th.getBoundingClientRect().width)),
    }
  }, rowCount)
}

/** Move the dragged pointer; Chromium only fires dragover on the move after dragenter, hence the nudge. */
async function dragTo(page: Page, x: number, y: number) {
  await page.mouse.move(x, y, { steps: 3 })
  await page.mouse.move(x + 1, y)
}

async function recipeOrder(page: Page): Promise<string[]> {
  return page.locator('main table tbody tr').evaluateAll(rs => rs.map(r => r.querySelectorAll('td')[1]?.querySelector('img')?.getAttribute('src') ?? ''))
}

test.describe('Recipe row drag stability', () => {
  test.beforeEach(async ({ page }) => {
    await loadPlanFixture(page, FIXTURE)
    await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
    await expect(page.locator('main table tbody tr').first()).toBeVisible({ timeout: 10000 })
  })

  test('rows and columns stay put while hovering across a row, and the drop position follows the half', async ({ page }) => {
    const rows = page.locator('main table tbody tr')
    const count = await rows.count()
    // Column widths keep settling for a moment after load; wait until they stop moving.
    let previous = ''
    await expect.poll(async () => {
      const current = JSON.stringify(await layout(page, count))
      const stable = current === previous
      previous = current
      return stable
    }, { intervals: [300] }).toBe(true)
    const baseline = await layout(page, count)

    const dragBox = (await rows.nth(1).boundingBox())!
    const targetBox = (await rows.nth(3).boundingBox())!
    const before = await recipeOrder(page)
    expect(new Set(before).size, 'recipe icons identify the rows').toBe(before.length)

    await page.mouse.move(dragBox.x + 60, dragBox.y + dragBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(dragBox.x + 70, dragBox.y + dragBox.height / 2 + 12, { steps: 4 })

    // Sweep across the target row, alternating halves and crossing cells.
    const xs = [40, 140, 240, 340, 440, 540]
    for (let i = 0; i < xs.length; i++) {
      const y = targetBox.y + (i % 2 === 0 ? 4 : targetBox.height - 4)
      await dragTo(page, dragBox.x + xs[i], y)
      await expect(page.locator('main table .bg-blue-500').first()).toBeVisible()
      const now = await layout(page, count)
      expect(now.widths, `column widths at step ${i}`).toEqual(baseline.widths)
      expect(now.tops.slice(0, count), `row tops at step ${i}`).toEqual(baseline.tops.slice(0, count))
    }

    // The indicator is a 2px line spanning the whole row.
    const line = await page.locator('main table .bg-blue-500').first().boundingBox()
    expect(line!.height).toBe(2)
    const rowBox = (await rows.nth(3).boundingBox())!
    expect(Math.abs(line!.width - rowBox.width)).toBeLessThanOrEqual(1)

    // Drop on the top half: the dragged recipe lands before the target.
    await dragTo(page, dragBox.x + 100, targetBox.y + 4)
    await page.mouse.up()
    const afterTop = await recipeOrder(page)
    expect(afterTop).not.toEqual(before)
    expect(afterTop.indexOf(before[1])).toBe(2)

    // Drop on the bottom half of the same target yields a different position.
    await page.reload()
    await expect(rows.first()).toBeVisible({ timeout: 10000 })
    const box2 = (await rows.nth(1).boundingBox())!
    const t2 = (await rows.nth(3).boundingBox())!
    await page.mouse.move(box2.x + 60, box2.y + box2.height / 2)
    await page.mouse.down()
    await page.mouse.move(box2.x + 70, box2.y + box2.height / 2 + 12, { steps: 4 })
    await dragTo(page, box2.x + 100, t2.y + t2.height - 4)
    await page.mouse.up()
    const afterBottom = await recipeOrder(page)
    expect(afterBottom.indexOf(before[1])).toBe(3)
    expect(afterBottom).not.toEqual(afterTop)
  })
})
