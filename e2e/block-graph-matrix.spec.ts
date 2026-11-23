import { test, expect, type Page } from '@playwright/test'
import { closeGraph, matrixCell, openGraph, pinEdge, selectCell, setView } from './support/blockGraph'
import { openScalePlan, type LayoutBlock } from './support/scalePlan'

/**
 * The matrix view of the Block graph modal on the 15-block "middle ring" plan (see support/scalePlan.ts): 15 x 15 blocks,
 * 46 filled cells carrying 140 connections. The plan is unsolved, so no cell is limited or unused here; the amber ring
 * is covered by the DOM test.
 */
test.use({ viewport: { width: 1280, height: 720 } })

const setup = (page: Page, outPath: string) => openScalePlan(page, outPath)
const out = (testInfo: { outputPath: (n: string) => string }) => testInfo.outputPath('scale-plan.json')

/** The connections of each (source, consumer) pair of the plan, in plan order. */
function pairs(blocks: LayoutBlock[]) {
  const map = new Map<string, { from: string; to: string; ids: string[] }>()
  for (const b of blocks) {
    for (const c of b.connections) {
      const key = `${c.fromBlockId}>${b.id}`
      const p = map.get(key) ?? { from: c.fromBlockId, to: b.id, ids: [] }
      p.ids.push(c.id)
      map.set(key, p)
    }
  }
  return [...map.values()]
}

async function reopenAfterReload(page: Page) {
  await page.reload()
  await expect(page.locator('[data-testid="block-tab"]')).toHaveCount(15, { timeout: 10000 })
  await openGraph(page)
}

test.describe('block graph matrix, 15 blocks', () => {
  test('has the shape of the plan', async ({ page }, testInfo) => {
    await setup(page, out(testInfo))
    await setView(page, 'Matrix')
    await expect(page.getByTestId('matrix-row-head')).toHaveCount(15)
    await expect(page.getByTestId('matrix-col-head')).toHaveCount(15)
    await expect(page.locator('table tbody td')).toHaveCount(225)
    await expect(page.getByTestId('matrix-cell')).toHaveCount(46)
    const counts = await page.getByTestId('matrix-cell').evaluateAll(els => els.map(el => Number(el.getAttribute('data-count'))))
    expect(counts.reduce((a, b) => a + b, 0)).toBe(140)
    expect(await page.locator('[data-testid="matrix-cell"][data-back="true"]').count()).toBeLessThanOrEqual(6)
    await expect(page.getByTestId('matrix-summary')).toContainText('46 filled')
  })

  test('fits at 1280 px with no horizontal scroll', async ({ page }, testInfo) => {
    await setup(page, out(testInfo))
    await setView(page, 'Matrix')
    const scroll = page.getByTestId('matrix-scroll')
    expect(await scroll.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    expect(await scroll.evaluate(el => el.scrollHeight <= el.clientHeight), 'no vertical scroll for 15 blocks').toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const modal = (await page.getByTestId('modal-panel').boundingBox())!
    const pane = (await scroll.boundingBox())!
    const table = (await page.locator('table').boundingBox())!
    expect(table.x).toBeGreaterThanOrEqual(modal.x - 0.5)
    expect(table.x + table.width).toBeLessThanOrEqual(modal.x + modal.width + 0.5)
    const heads = page.getByTestId('matrix-col-head')
    for (let i = 0; i < 15; i++) {
      const box = (await heads.nth(i).boundingBox())!
      expect(box.x, `column ${i} left`).toBeGreaterThanOrEqual(pane.x - 0.5)
      expect(box.x + box.width, `column ${i} right`).toBeLessThanOrEqual(pane.x + pane.width + 0.5)
    }
    const widths = await page.locator('table tbody td').evaluateAll(els => els.map(el => el.getBoundingClientRect().width))
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(27.5)
  })

  test('remembers the view and the order across a reload', async ({ page }, testInfo) => {
    await setup(page, out(testInfo))
    await setView(page, 'Matrix')
    await closeGraph(page)
    await openGraph(page)
    await expect(page.getByRole('button', { name: 'Matrix', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await reopenAfterReload(page)
    await expect(page.getByRole('button', { name: 'Matrix', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('matrix-cell')).toHaveCount(46)

    await page.getByRole('button', { name: 'Plan order' }).click()
    await expect(page.getByRole('button', { name: 'Plan order' })).toHaveAttribute('aria-pressed', 'true')
    await reopenAfterReload(page)
    await expect(page.getByRole('button', { name: 'Plan order' })).toHaveAttribute('aria-pressed', 'true')

    await setView(page, 'Graph')
    await reopenAfterReload(page)
    await expect(page.getByRole('button', { name: 'Graph', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('graph-node')).toHaveCount(15)
  })

  test('lists the blocks in tab order in plan order, and has fewer cells below the diagonal in dependency order', async ({ page }, testInfo) => {
    const plan = await setup(page, out(testInfo))
    await setView(page, 'Matrix')
    const back = () => page.locator('[data-testid="matrix-cell"][data-back="true"]').count()
    const dependencyBack = await back()
    expect(dependencyBack).toBeLessThanOrEqual(6)
    await page.getByRole('button', { name: 'Plan order' }).click()
    await expect(page.getByRole('button', { name: 'Plan order' })).toHaveAttribute('aria-pressed', 'true')
    const rows = await page.getByTestId('matrix-row-head').evaluateAll(els => els.map(el => el.querySelector('span:not([aria-hidden])')?.textContent?.trim()))
    expect(rows).toEqual(plan.blocks.map(b => b.name))
    expect(await back()).toBeGreaterThanOrEqual(dependencyBack)
  })

  test('a limit set from a cell shows in the graph', async ({ page }, testInfo) => {
    const plan = await setup(page, out(testInfo))
    const target = plan.blocks.find(b => b.connections.length > 0)!
    const connection = target.connections[0]
    await setView(page, 'Matrix')
    const panel = await selectCell(page, { connectionId: connection.id })
    const chip = panel.locator(`[data-testid="graph-edge-label"][data-connection-id="${connection.id}"]`)
    await expect(chip).toBeVisible()
    await expect(chip.locator('img')).toHaveCount(1)
    await chip.getByTestId('graph-edge-limit').click()
    await page.getByRole('spinbutton', { name: 'Connection limit' }).fill('5')
    await page.keyboard.press('Enter')
    await expect(chip.getByTestId('graph-edge-limit')).toContainText('≤ 5')

    await setView(page, 'Graph')
    const strip = await pinEdge(page, { connectionId: connection.id })
    await expect(strip.locator(`[data-testid="graph-edge-label"][data-connection-id="${connection.id}"]`)).toContainText('≤ 5')

    await setView(page, 'Matrix')
    const again = await selectCell(page, { connectionId: connection.id })
    await expect(again.locator(`[data-connection-id="${connection.id}"]`)).toContainText('≤ 5')
  })

  test('removing from a cell lowers its count, and removing the last one clears the cell', async ({ page }, testInfo) => {
    const plan = await setup(page, out(testInfo))
    const all = pairs(plan.blocks)
    const multi = all.find(p => p.ids.length >= 2)!
    const single = all.find(p => p.ids.length === 1)!
    await setView(page, 'Matrix')

    const cell = matrixCell(page, { connectionId: multi.ids[1] })
    const before = Number(await cell.getAttribute('data-count'))
    const panel = await selectCell(page, { connectionId: multi.ids[0] })
    await panel.locator(`[data-connection-id="${multi.ids[0]}"]`).getByTestId('graph-edge-remove').click()
    await expect(cell).toHaveAttribute('data-count', String(before - 1))

    const lone = matrixCell(page, { connectionId: single.ids[0] })
    const lonePanel = await selectCell(page, { connectionId: single.ids[0] })
    await lonePanel.getByTestId('graph-edge-remove').click()
    await expect(lone).toHaveCount(0)
    await expect(page.getByTestId('matrix-legend')).toBeVisible()
  })

  test('hovering a cell crosses its row and its column', async ({ page }, testInfo) => {
    await setup(page, out(testInfo))
    await setView(page, 'Matrix')
    const cell = page.getByTestId('matrix-cell').first()
    const from = (await cell.getAttribute('data-from'))!
    const to = (await cell.getAttribute('data-to'))!
    await cell.hover()
    await expect(page.locator('[data-testid="matrix-row-head"][data-crosshair="true"]')).toHaveCount(1)
    await expect(page.locator('[data-testid="matrix-col-head"][data-crosshair="true"]')).toHaveCount(1)
    await expect(page.locator(`[data-testid="matrix-row-head"][data-block-id="${from}"]`)).toHaveAttribute('data-crosshair', 'true')
    await expect(page.locator(`[data-testid="matrix-col-head"][data-block-id="${to}"]`)).toHaveAttribute('data-crosshair', 'true')
  })

  test('opens the panel from the keyboard and Escape steps back before it closes', async ({ page }, testInfo) => {
    await setup(page, out(testInfo))
    await setView(page, 'Matrix')
    const cell = page.getByTestId('matrix-cell').first()
    await cell.focus()
    await page.keyboard.press('Enter')
    await expect(cell).toHaveAttribute('aria-pressed', 'true')
    const panel = page.getByTestId('matrix-panel')
    expect(await panel.evaluate(el => el.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(cell).toHaveAttribute('aria-pressed', 'false')
    await expect(cell).toBeFocused()
    await expect(page.getByRole('heading', { name: 'Block graph' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: 'Block graph' })).toHaveCount(0)
  })

  test('shows an instant tooltip on a cell and no native title', async ({ page }, testInfo) => {
    await setup(page, out(testInfo))
    await setView(page, 'Matrix')
    await page.getByTestId('matrix-cell').first().hover()
    await expect(page.getByTestId('tooltip')).toContainText(/\d+ items? from .+ to .+ — click to list them/)
    await expect(page.locator('[data-testid="matrix-cell"][title]')).toHaveCount(0)
  })
})
