import { blockAreas, subPlanAreaIds } from '../solver/areas'
import { ELECTRICITY_ITEM_ID } from '../data/electricity'
import { applyDefaultMachineOverrides, computeHorizon, resolveRowMachine } from '../data/horizon'
import { areaName } from '../data/subPlanTree'
import { syntheticRecipeKind } from '../data/syntheticRecipes'
import type {
  AppState,
  Block,
  GameData,
  MultiBlockSolve,
  PlanDataSetStamp,
  SolvedNode,
  SolverResult,
  SolverWarning,
  SubPlan,
} from '../data/types'
import {
  SNAPSHOT_ELECTRICITY_ID,
  SNAPSHOT_VERSION,
  type Snapshot,
  type SnapshotBlock,
  type SnapshotItemRate,
  type SnapshotItemRef,
  type SnapshotGameRow,
  type SnapshotRow,
  type SnapshotWarning,
} from './schema'

/** Rounds to three decimals; undefined for a value that is not a finite non-negative number (-0 counts as 0). */
export function round3(x: number): number | undefined {
  const r = Math.round(x * 1000) / 1000
  return Number.isFinite(r) && r >= 0 ? r + 0 : undefined
}

/** A required rate: three decimals, 0 when the value is unusable. */
const rate3 = (x: number): number => round3(x) ?? 0

/** The optional keys of a row's solved values, each left out when its value is unusable. */
function solvedValues(s: SolvedNode): Pick<SnapshotGameRow, 'machines' | 'machinesCeil' | 'throughput' | 'powerKw'> {
  const out: Pick<SnapshotGameRow, 'machines' | 'machinesCeil' | 'throughput' | 'powerKw'> = {}
  const machines = round3(s.machineCountExact)
  const throughput = round3(s.throughput)
  const powerKw = round3(s.powerKw)
  if (machines !== undefined) out.machines = machines
  if (Number.isInteger(s.machineCountCeil) && s.machineCountCeil >= 0) out.machinesCeil = s.machineCountCeil
  if (throughput !== undefined) out.throughput = throughput
  if (powerKw !== undefined) out.powerKw = powerKw
  return out
}

const EMPTY_RESULT: SolverResult = { nodes: [], unsatisfied: [], warnings: [] }

/**
 * The snapshot of a plan: a pure projection of `state` and its multi-block solve (see
 * initiatives/archive/in-game-viewer/plan.md, "What is sent"). It reads no store.
 *
 * `gameData` is needed for what the plan and the solve do not hold: whether an id is an item or
 * a fluid, the main product of an exporter-invented recipe, and the default machine of a row that
 * names none. That machine is resolved as the solver wiring does (the plan's research horizon,
 * then its default-machine overrides), so a row never shows a machine the solve did not use. An
 * item id missing from the data set is sent as an `item` (the mod lists ids the game does not know).
 *
 * Ids the exporter invented never reach the snapshot: a row of a `mining:`, `offshore:` or
 * `power:` recipe carries its `kind` and `product` instead of a recipe id, the electricity
 * pseudo-item is the `virtual` item `electricity`, and such recipe ids are left out of a warning's
 * `recipes`.
 *
 * Rows mirror the plan. A row without a solved node (every row of a block whose solve failed, or a
 * row the solve skipped) keeps its ids and omits the solved values, as does a value that is not a
 * finite non-negative number. A block whose solve failed (`solve.errors`) stays in the snapshot,
 * in its place, with its name, colour, products, connections, the result's imports and warnings
 * (the solver gives such a block an empty result, or only warnings that name it) and the solver's
 * message as `error`.
 */
export function projectSnapshot(
  state: AppState,
  solve: MultiBlockSolve,
  gameData: GameData,
  dataSet: PlanDataSetStamp,
): Snapshot {
  const blockIndex = new Map(state.blocks.map((b, i) => [b.id, i]))
  const horizon = computeHorizon(gameData, state.horizonTechnologyIds)
  const defaultMachines = applyDefaultMachineOverrides(gameData, horizon.machineIds, horizon.defaultMachines, state.defaultMachineOverrides)
  const ref = (id: string): SnapshotItemRef =>
    id === ELECTRICITY_ITEM_ID ? { id: SNAPSHOT_ELECTRICITY_ID, type: 'virtual' } : { id, type: gameData.items[id]?.type ?? 'item' }
  const withRate = (id: string, r: number): SnapshotItemRate => ({ ...ref(id), rate: rate3(r) })

  /** What other blocks request of `blockId`, by item (requested flows only). */
  const requestedOf = (blockId: string): Map<string, number> => {
    const m = new Map<string, number>()
    for (const f of solve.flows) {
      if (f.fromBlockId === blockId && f.kind === 'request' && f.requested !== undefined) {
        m.set(f.itemId, (m.get(f.itemId) ?? 0) + f.requested)
      }
    }
    return m
  }

  const projectBlock = (block: Block): SnapshotBlock => {
    const error = solve.errors[block.id]
    const result = solve.results[block.id] ?? EMPTY_RESULT

    // The first product of an item receives the requested amount, as the solver does.
    const requested = requestedOf(block.id)
    const seen = new Set<string>()
    const products = block.products.map(p => {
      let r = p.extraRate ?? 0
      if (!seen.has(p.itemId)) {
        seen.add(p.itemId)
        r += requested.get(p.itemId) ?? 0
      }
      return withRate(p.itemId, r)
    })

    const areas = blockAreas(block.rootPlan)
    const areaOf = subPlanAreaIds(block.rootPlan)
    const areaNames: string[] = []
    const areaIndex = new Map<string, number>()
    if (areas) {
      for (const a of areas) {
        areaIndex.set(a.id, areaNames.length)
        areaNames.push(areaName(block.rootPlan, a.id))
      }
    }

    const solved = new Map(result.nodes.map(n => [n.recipeNodeId, n]))
    const rows: SnapshotRow[] = []
    const visited = new Set<string>()
    // Table order: a plan's nodes in order, a sub-factory's rows where its handle is, then sub-factories without a handle.
    const visit = (plan: SubPlan): void => {
      if (visited.has(plan.id)) return
      visited.add(plan.id)
      const byId = new Map(plan.subPlans.map(sp => [sp.id, sp]))
      for (const node of plan.nodes) {
        if (node.kind === 'subplan') {
          const sp = byId.get(node.subPlanId)
          if (sp) visit(sp)
          continue
        }
        const areaId = areas ? areaOf.get(plan.id) : undefined
        const area = areaId === undefined ? undefined : areaIndex.get(areaId)
        const category = gameData.recipes[node.recipeId]?.category
        const machine = category === undefined
          ? node.machineId
          : resolveRowMachine(gameData, { ...horizon, defaultMachines }, category, node.machineId).machineId
        const s = solved.get(node.id)
        const common = {
          ...(machine !== undefined ? { machine } : {}),
          ...(area !== undefined ? { area } : {}),
          ...(s ? solvedValues(s) : {}),
        }
        const kind = syntheticRecipeKind(node.recipeId)
        if (kind === undefined) {
          rows.push({ recipe: node.recipeId, ...common })
          continue
        }
        const recipe = gameData.recipes[node.recipeId]
        const main = recipe ? (recipe.mainProduct ?? recipe.products[0]?.itemId) : undefined
        rows.push({ kind, ...(main ? { product: ref(main) } : {}), ...common })
      }
      for (const sp of plan.subPlans) visit(sp)
    }
    visit(block.rootPlan)

    const connections = solve.flows
      .filter(f => f.toBlockId === block.id && f.status !== 'missing-source' && f.status !== 'self')
      .flatMap(f => {
        const from = blockIndex.get(f.fromBlockId)
        return from === undefined
          ? []
          : [{ from, ...ref(f.itemId), available: rate3(f.available) }]
      })

    return {
      name: block.name,
      color: block.color,
      products,
      ...(areas ? { areas: areaNames } : {}),
      rows,
      imports: result.unsatisfied.map(u => withRate(u.itemId, u.rate)),
      warnings: result.warnings.map(w => projectWarning(w, ref, blockIndex, areaIndex)),
      connections,
      ...(error !== undefined ? { error } : {}),
    }
  }

  return {
    v: SNAPSHOT_VERSION,
    dataSet,
    blocks: state.blocks.map(projectBlock),
  }
}

/** A warning reduced to its code and the ids it names. */
function projectWarning(
  w: SolverWarning,
  ref: (id: string) => SnapshotItemRef,
  blockIndex: Map<string, number>,
  areaIndex: Map<string, number>,
): SnapshotWarning {
  const blocks = (ids: string[]): number[] => ids.flatMap(id => blockIndex.get(id) ?? [])
  const areas = (ids: string[]): number[] => ids.flatMap(id => areaIndex.get(id) ?? [])
  const unique = <T>(xs: T[]): T[] => [...new Set(xs)]
  const itemRefs = (ids: string[]): SnapshotItemRef[] => unique(ids).map(ref)
  const gameRecipes = (ids: string[]): string[] => ids.filter(id => syntheticRecipeKind(id) === undefined)
  const nonEmpty = <T>(key: string, xs: T[]): Record<string, T[]> => (xs.length > 0 ? { [key]: xs } : {})

  switch (w.type) {
    case 'no-recipe':
      return { code: w.type, items: itemRefs([w.itemId]) }
    case 'duplicate-recipe':
      return { code: w.type, ...nonEmpty('recipes', gameRecipes([w.recipeId])), ...nonEmpty('areas', areas(w.areaId === undefined ? [] : [w.areaId])) }
    case 'infeasible-pins':
      return { code: w.type, ...nonEmpty('recipes', unique(gameRecipes(w.recipeIds))) }
    case 'overconstrained':
      return { code: w.type, ...nonEmpty('items', itemRefs(w.surplusItems.map(s => s.itemId))) }
    case 'area-shortfall':
      return {
        code: w.type,
        ...nonEmpty('items', itemRefs(w.shortfalls.map(s => s.itemId))),
        ...nonEmpty('areas', unique(areas(w.shortfalls.map(s => s.areaId)))),
      }
    case 'loop-not-converged':
    case 'request-loop-not-converged':
      return { code: w.type, ...nonEmpty('blocks', blocks(w.blockIds)) }
  }
}
