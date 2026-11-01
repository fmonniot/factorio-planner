import { blockAreas, subPlanAreaIds } from '../solver/areas'
import type {
  AppState,
  Block,
  GameData,
  MultiBlockSolve,
  PlanDataSetStamp,
  SolverResult,
  SolverWarning,
  SubPlan,
} from '../data/types'
import {
  SNAPSHOT_VERSION,
  type Snapshot,
  type SnapshotBlock,
  type SnapshotItemRate,
  type SnapshotItemRef,
  type SnapshotRow,
  type SnapshotWarning,
} from './schema'

/** Rounds to three decimals; never returns -0. */
export function round3(x: number): number {
  return Math.round(x * 1000) / 1000 || 0
}

const EMPTY_RESULT: SolverResult = { nodes: [], unsatisfied: [], warnings: [] }

/**
 * The snapshot of a plan: a pure projection of `state` and its multi-block solve (see
 * initiatives/in-game-viewer/plan.md, "What is sent"). It reads no store.
 *
 * `gameData` is needed for two things the plan and the solve do not hold: whether an id is an
 * item or a fluid, and the default machine of a row that names none. An id missing from it is
 * sent as an `item` (the mod lists ids the game does not know).
 *
 * A block whose solve failed (`solve.errors`) stays in the snapshot, in its place, with its
 * name, colour, products, connections and the solver's message as `error`; its `rows`,
 * `imports` and `warnings` are empty, because the solver returns an empty result for it.
 */
export function projectSnapshot(
  state: AppState,
  solve: MultiBlockSolve,
  gameData: GameData,
  dataSet: PlanDataSetStamp,
): Snapshot {
  const blockIndex = new Map(state.blocks.map((b, i) => [b.id, i]))
  const typeOf = (id: string): SnapshotItemRef['type'] => gameData.items[id]?.type ?? 'item'
  const ref = (id: string): SnapshotItemRef => ({ id, type: typeOf(id) })
  const withRate = (id: string, r: number): SnapshotItemRate => ({ id, type: typeOf(id), rate: round3(r) })

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
    const result = error === undefined ? (solve.results[block.id] ?? EMPTY_RESULT) : EMPTY_RESULT

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
      const names = new Map<string, string>()
      const collect = (p: SubPlan): void => {
        names.set(p.id, p.name)
        p.subPlans.forEach(collect)
      }
      collect(block.rootPlan)
      for (const a of areas) {
        areaIndex.set(a.id, areaNames.length)
        areaNames.push(names.get(a.id) ?? '')
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
        const s = solved.get(node.id)
        if (!s) continue
        const machine = node.machineId ?? (() => {
          const category = gameData.recipes[node.recipeId]?.category
          return category === undefined ? undefined : gameData.defaultMachines[category]
        })()
        const areaId = areas ? areaOf.get(plan.id) : undefined
        const area = areaId === undefined ? undefined : areaIndex.get(areaId)
        rows.push({
          recipe: node.recipeId,
          ...(machine !== undefined ? { machine } : {}),
          ...(area !== undefined ? { area } : {}),
          machines: round3(s.machineCountExact),
          machinesCeil: s.machineCountCeil,
          throughput: round3(s.throughput),
          powerKw: round3(s.powerKw),
        })
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
          : [{ from, id: f.itemId, type: typeOf(f.itemId), available: round3(f.available) }]
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
  const nonEmpty = <T>(key: string, xs: T[]): Record<string, T[]> => (xs.length > 0 ? { [key]: xs } : {})

  switch (w.type) {
    case 'no-recipe':
      return { code: w.type, items: itemRefs([w.itemId]) }
    case 'duplicate-recipe':
      return { code: w.type, recipes: [w.recipeId], ...nonEmpty('areas', areas(w.areaId === undefined ? [] : [w.areaId])) }
    case 'infeasible-pins':
      return { code: w.type, ...nonEmpty('recipes', unique(w.recipeIds)) }
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
