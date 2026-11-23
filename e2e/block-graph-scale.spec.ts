import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture } from './support/loadPlan'
import { closeGraph, pinEdge, openGraph } from './support/blockGraph'

/**
 * The 15-block "middle ring" plan of the block-graph-scale initiative: 15 blocks and 140 connections between them
 * (46 edges), one block with none. Only the blocks and their connections are real; the blocks are empty, so nothing
 * is solved. The layout fixture lives under initiatives/: fix its path here when the initiative is archived.
 */
const LAYOUT_FIXTURE = path.resolve('initiatives/block-graph-scale/real-plan.layout.json')
/** A Seablock plan of three blocks, only for the shape of a block. */
const TEMPLATE = path.resolve('e2e/fixtures/request-loop-seablock.json')

interface LayoutBlock {
  id: string
  name: string
  color: string
  connections: { id: string; itemId: string; fromBlockId: string }[]
}

function scalePlan(outPath: string): { path: string; blocks: LayoutBlock[] } {
  const layout = JSON.parse(fs.readFileSync(LAYOUT_FIXTURE, 'utf-8')) as { blocks: LayoutBlock[] }
  const template = JSON.parse(fs.readFileSync(TEMPLATE, 'utf-8'))
  const blank = template.blocks[0]
  const stamp = blank.rootPlan.createdAt
  const blocks = layout.blocks.map(b => ({
    ...structuredClone(blank),
    id: b.id,
    name: b.name,
    color: b.color,
    products: [],
    inputConnections: b.connections.map(c => ({ ...c })),
    rootPlan: { id: randomUUID(), name: 'Main', nodes: [], subPlans: [], createdAt: stamp, updatedAt: stamp },
  }))
  fs.writeFileSync(outPath, JSON.stringify({ blocks, activeBlockId: blocks[0].id }))
  return { path: outPath, blocks: layout.blocks }
}

async function setup(page: Page, outPath: string) {
  const plan = scalePlan(outPath)
  await loadPlanFixture(page, plan.path, 'kompetenz-seablock')
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('[data-testid="block-tab"]')).toHaveCount(15, { timeout: 10000 })
  await openGraph(page)
  return plan
}

test.describe('block graph, 15 blocks', () => {
  test('fits every block in the view, with the edges routed and few of them running backwards', async ({ page }, testInfo) => {
    await setup(page, testInfo.outputPath('scale-plan.json'))
    await expect(page.getByTestId('graph-node')).toHaveCount(15)
    await expect(page.getByTestId('graph-edge')).toHaveCount(46)
    expect(await page.locator('[data-testid="graph-edge"][data-back="true"]').count()).toBeLessThanOrEqual(6)

    const viewport = (await page.getByTestId('block-graph-viewport').boundingBox())!
    const nodes = page.getByTestId('graph-node')
    for (let i = 0; i < 15; i++) {
      const box = (await nodes.nth(i).boundingBox())!
      expect(box.x, `node ${i} left`).toBeGreaterThanOrEqual(viewport.x - 0.5)
      expect(box.y, `node ${i} top`).toBeGreaterThanOrEqual(viewport.y - 0.5)
      expect(box.x + box.width, `node ${i} right`).toBeLessThanOrEqual(viewport.x + viewport.width + 0.5)
      expect(box.y + box.height, `node ${i} bottom`).toBeLessThanOrEqual(viewport.y + viewport.height + 0.5)
    }
    // Scaled down to fit: the layer's wrapper carries a scale below 1, and nothing scrolls.
    const scale = await page.getByTestId('block-graph-layer').evaluate(el => {
      const m = new DOMMatrix(getComputedStyle(el.parentElement!).transform)
      return m.a
    })
    expect(scale).toBeLessThan(1)
    expect(scale).toBeGreaterThan(0.2)
    expect(await page.getByTestId('block-graph-viewport').evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true)
  })

  test('no chip covers a block\'s Go to button, at the fit scale', async ({ page }, testInfo) => {
    await setup(page, testInfo.outputPath('scale-plan.json'))
    const goTo = (await page.getByTestId('graph-node-open').evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })))
    const chips = await page.getByTestId('graph-edge-summary').evaluateAll(els => els.map(el => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, icons: el.getAttribute('data-icons') }
    }))
    expect(chips).toHaveLength(46)
    expect(goTo).toHaveLength(15)
    for (const c of chips) {
      for (const g of goTo) {
        const overlaps = c.x < g.x + g.w && g.x < c.x + c.w && c.y < g.y + g.h && g.y < c.y + c.h
        expect(overlaps, `chip at ${Math.round(c.x)},${Math.round(c.y)} (${Math.round(c.w)} wide) covers a Go to button`).toBe(false)
      }
    }
  })

  test('pointing at a block lights its edges and fills the strip', async ({ page }, testInfo) => {
    await setup(page, testInfo.outputPath('scale-plan.json'))
    await page.getByTestId('graph-node').filter({ has: page.getByRole('button', { name: 'Sludge', exact: true }) }).hover()
    await expect(page.locator('[data-testid="graph-edge"][data-lit="true"]')).not.toHaveCount(0)
    await expect(page.locator('[data-testid="graph-edge"][data-dim="true"]')).not.toHaveCount(0)
    const strip = page.getByTestId('graph-detail')
    await expect(strip).toContainText('Receives from')
    await expect(strip).toContainText('Supplies')
    await expect(page.getByTestId('graph-detail-block').first()).toContainText('item')
  })

  test('lists an edge and edits a limit from its chip', async ({ page }, testInfo) => {
    const plan = await setup(page, testInfo.outputPath('scale-plan.json'))
    const target = plan.blocks.find(b => b.connections.length > 0)!
    const connection = target.connections[0]
    const list = await pinEdge(page, { connectionId: connection.id })
    const row = list.locator(`[data-testid="graph-edge-label"][data-connection-id="${connection.id}"]`)
    await expect(row).toBeVisible()
    await row.getByTestId('graph-edge-limit').click()
    await page.getByRole('spinbutton', { name: 'Connection limit' }).fill('5')
    await page.keyboard.press('Enter')
    await expect(row.getByTestId('graph-edge-limit')).toContainText('≤ 5')
    await closeGraph(page)
  })
})
