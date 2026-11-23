import { expect, type Page } from '@playwright/test'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import { loadPlanFixture } from './loadPlan'
import { openGraph } from './blockGraph'

/**
 * The 15-block "middle ring" plan of the block-graph-scale initiative: 15 blocks and 140 connections between them
 * (46 edges), one block with none. Only the blocks and their connections are real; the blocks are empty, so nothing
 * is solved.
 */
const LAYOUT_FIXTURE = path.resolve('initiatives/archive/block-graph-scale/real-plan.layout.json')
/** A Seablock plan of three blocks, only for the shape of a block. */
const TEMPLATE = path.resolve('e2e/fixtures/request-loop-seablock.json')

export interface LayoutBlock {
  id: string
  name: string
  color: string
  connections: { id: string; itemId: string; fromBlockId: string }[]
}

export function scalePlan(outPath: string): { path: string; blocks: LayoutBlock[] } {
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

/** Build the 15-block plan at `outPath`, load it with the Seablock data, wait for its tabs and open the block graph. */
export async function openScalePlan(page: Page, outPath: string) {
  const plan = scalePlan(outPath)
  await loadPlanFixture(page, plan.path, 'kompetenz-seablock')
  await expect(page.locator('main').getByText('Load game data to begin')).not.toBeVisible({ timeout: 10000 })
  await expect(page.locator('[data-testid="block-tab"]')).toHaveCount(15, { timeout: 10000 })
  await openGraph(page)
  return plan
}
