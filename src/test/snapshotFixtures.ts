import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { loadGameDataFromJson } from '../data/loader'
import { solveAll } from '../solver'
import { projectSnapshot } from '../snapshot/project'
import { SnapshotSchema, type Snapshot } from '../snapshot/schema'
import type { AppState, Block, GameData, MultiBlockSolve, PlanDataSetStamp, RecipeNode, SubPlan } from '../data/types'

// ---------------------------------------------------------------------------
// Builds the shared snapshot fixtures (contract/fixtures/*.json) and the JSON Schema
// (contract/snapshot.schema.json) from the bundled Seablock export. Used by the generator
// script (scripts/build-snapshot-contract.mjs) and by the tests that check the checked-in
// files are up to date. Every call builds fresh objects.
// ---------------------------------------------------------------------------

const SEABLOCK_PATH = resolve(import.meta.dirname, '../../public/data/kompetenz-seablock/game-data.json')

export function loadSeablock(): GameData {
  return loadGameDataFromJson(readFileSync(SEABLOCK_PATH, 'utf-8'))
}

const NOW = '2026-01-01T00:00:00.000Z'

function row(id: string, recipeId: string, machineId?: string): RecipeNode {
  return { kind: 'game-recipe', id, recipeId, ...(machineId ? { machineId } : {}), modules: [], byproductPolicy: {} }
}

function plan(id: string, name: string, nodes: RecipeNode[], subPlans: SubPlan[] = [], area?: true): SubPlan {
  return { id, name, nodes, subPlans, ...(area ? { area } : {}), createdAt: NOW, updatedAt: NOW }
}

interface BlockSpec {
  id: string
  name: string
  color: string
  products: [itemId: string, extraRate?: number][]
  recipes?: string[]
  rootPlan?: SubPlan
  /** [itemId, fromBlockId] */
  connections?: [string, string][]
}

function block(spec: BlockSpec): Block {
  return {
    id: spec.id,
    name: spec.name,
    color: spec.color,
    products: spec.products.map(([itemId, extraRate], i) => ({
      id: `${spec.id}-p${i}`,
      itemId,
      ...(extraRate !== undefined ? { extraRate } : {}),
    })),
    noImportItems: [],
    itemSourcing: {},
    inputConnections: (spec.connections ?? []).map(([itemId, fromBlockId], i) => ({
      id: `${spec.id}-c${i}`,
      itemId,
      fromBlockId,
    })),
    rootPlan: spec.rootPlan ?? plan(`${spec.id}-root`, 'Main', (spec.recipes ?? []).map((r, i) => row(`${spec.id}-r${i}`, r))),
  }
}

function stateOf(blocks: Block[]): AppState {
  return { blocks, activeBlockId: blocks[0]?.id ?? '', horizonTechnologyIds: [], defaultMachineOverrides: {} }
}

function stampOf(gameData: GameData): PlanDataSetStamp {
  return { id: 'kompetenz-seablock', name: 'Kompetenz Seablock', factorioVersion: gameData.factorioVersion }
}

function snapshotOf(gameData: GameData, blocks: Block[], patch?: (solve: MultiBlockSolve) => void): Snapshot {
  const state = stateOf(blocks)
  const solve = solveAll(state.blocks, gameData)
  patch?.(solve)
  return projectSnapshot(state, solve, gameData, stampOf(gameData))
}

/** One block with a handful of rows and no connections. */
function smallPlan(gameData: GameData): Snapshot {
  return snapshotOf(gameData, [
    block({
      id: 'b-gears',
      name: 'Gears',
      color: '#3b82f6',
      products: [['iron-gear-wheel', 60]],
      recipes: ['iron-gear-wheel', 'sb-iron-plate-from-ore'],
    }),
  ])
}

/** A block whose root and a nested sub-factory are separate areas, one of them with a fluid. */
function areasPlan(gameData: GameData): Snapshot {
  const root = plan(
    'b-areas-root',
    'Main',
    [row('a-r0', 'copper-cable'), { kind: 'subplan', id: 'a-h0', subPlanId: 'a-sp0' }, { kind: 'subplan', id: 'a-h1', subPlanId: 'a-sp1' }],
    [
      plan('a-sp0', 'Smelting', [row('a-r1', 'sb-copper-plate-from-ore'), row('a-r2', 'sb-iron-plate-from-ore')], [], true),
      plan('a-sp1', 'Pumps', [row('a-r3', 'offshore:water'), row('a-r4', 'iron-gear-wheel')], [], true),
    ],
  )
  return snapshotOf(gameData, [
    block({
      id: 'b-areas',
      name: 'Cables and gears',
      color: '#10b981',
      products: [['copper-cable', 240], ['iron-gear-wheel', 30], ['water']],
      rootPlan: root,
    }),
  ])
}

/** Three blocks (the loop fixture): a loop (smelter and parts supply each other), a plain consumer, a block with no recipe for its product. */
export function loopBlocks(): Block[] {
  return [
    block({
      id: 'b-smelter',
      name: 'Smelter',
      color: '#f97316',
      products: [['iron-plate', 120], ['copper-plate', 60], ['gun-turret', 2]],
      recipes: ['sb-iron-plate-from-ore', 'sb-copper-plate-from-ore', 'gun-turret'],
      connections: [['iron-gear-wheel', 'b-parts']],
    }),
    block({
      id: 'b-parts',
      name: 'Parts',
      color: '#8b5cf6',
      products: [['iron-gear-wheel'], ['pipe', 30]],
      recipes: ['iron-gear-wheel', 'pipe'],
      connections: [['iron-plate', 'b-smelter']],
    }),
    block({
      id: 'b-engines',
      name: 'Engines',
      color: '#ec4899',
      products: [['steam-engine', 1], ['uranium-ore', 5]],
      recipes: ['steam-engine'],
      connections: [['pipe', 'b-parts'], ['iron-gear-wheel', 'b-parts'], ['iron-plate', 'b-smelter']],
    }),
  ]
}

/**
 * What the Lua reader must handle beyond the plain cases: exporter-invented recipes (power, offshore
 * pump, mining), the virtual electricity item in a product and a connection, a block whose solve
 * failed (set by hand, as the solver does when it throws: an empty result and a message) with a row of
 * a recipe the data set lacks, which carries no machine and no solved values, and warnings that name
 * recipes, blocks and areas (also set by hand, since a small plan does not produce them).
 */
export function edgeCaseBlocks(): Block[] {
  const root = plan(
    'e-root',
    'Main',
    [row('e-r0', 'power:solar-panel'), { kind: 'subplan', id: 'e-h0', subPlanId: 'e-sp0' }],
    [plan('e-sp0', 'Pumps', [row('e-r1', 'offshore:water'), row('e-r2', 'mining:crude-oil')], [], true)],
  )
  return [
    block({ id: 'e-power', name: 'Power and fluids', color: '#eab308', products: [['power:electricity', 600], ['water', 120]], rootPlan: root }),
    block({
      id: 'e-parts',
      name: 'Parts',
      color: '#06b6d4',
      products: [['iron-gear-wheel', 30]],
      recipes: ['iron-gear-wheel'],
      connections: [['power:electricity', 'e-power'], ['water', 'e-power']],
    }),
    block({ id: 'e-broken', name: 'After a mod update', color: '#64748b', products: [['pipe', 10]], recipes: ['pipe', 'recipe-removed-by-a-mod-update'] }),
  ]
}

function edgeCasesPlan(gameData: GameData): Snapshot {
  return snapshotOf(gameData, edgeCaseBlocks(), solve => {
    solve.results['e-broken'] = { nodes: [], unsatisfied: [], warnings: [] }
    solve.errors['e-broken'] = 'LP solver failed: the model is unbounded'
    solve.results['e-power'].warnings.push({
      type: 'area-shortfall',
      shortfalls: [{ areaId: 'e-sp0', itemId: 'water', rate: 5 }],
    })
    solve.results['e-parts'].warnings.push(
      { type: 'duplicate-recipe', recipeId: 'iron-gear-wheel', count: 2 },
      { type: 'infeasible-pins', recipeIds: ['iron-gear-wheel', 'power:solar-panel'] },
      { type: 'loop-not-converged', blockIds: ['e-parts', 'e-power'], rounds: 8 },
    )
  })
}

/** Block and sub-factory names with accents, CJK and emoji (multi-byte UTF-8, and a surrogate pair), so a chunk boundary can fall inside a character. */
function unicodePlan(gameData: GameData): Snapshot {
  const root = plan(
    'u-root',
    'Principal',
    [row('u-r0', 'sb-iron-plate-from-ore'), { kind: 'subplan', id: 'u-h0', subPlanId: 'u-sp0' }],
    [plan('u-sp0', '銅の精錬 🔥', [row('u-r1', 'sb-copper-plate-from-ore')], [], true)],
  )
  return snapshotOf(gameData, [
    block({ id: 'u-1', name: 'Fonderie à fer – été', color: '#ef4444', products: [['iron-plate', 90], ['copper-plate', 30]], rootPlan: root }),
    block({
      id: 'u-2',
      name: '鉄工場 (歯車)',
      color: '#14b8a6',
      products: [['iron-gear-wheel', 45]],
      recipes: ['iron-gear-wheel'],
      connections: [['iron-plate', 'u-1']],
    }),
    block({
      id: 'u-3',
      name: 'Électricité ⚡🏭 « Ünï»',
      color: '#a855f7',
      products: [['pipe', 15]],
      recipes: ['pipe'],
      connections: [['iron-plate', 'u-1']],
    }),
  ])
}

/** Every shared fixture, by file name (without `.json`). */
export function buildSnapshotFixtures(gameData: GameData = loadSeablock()): Record<string, Snapshot> {
  return {
    small: smallPlan(gameData),
    'seablock-areas': areasPlan(gameData),
    'seablock-loop': snapshotOf(gameData, loopBlocks()),
    unicode: unicodePlan(gameData),
    'seablock-edge-cases': edgeCasesPlan(gameData),
  }
}

/** The JSON Schema of the snapshot, from the Zod schema. */
export function buildSnapshotJsonSchema(): unknown {
  return z.toJSONSchema(SnapshotSchema, { target: 'draft-2020-12', io: 'output' })
}

/** Text of a generated file: two-space JSON and a final newline. */
export function toFileText(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}
