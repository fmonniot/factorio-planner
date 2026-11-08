import { ELECTRICITY_ITEM_ID, HEAT_ITEM_ID, isEnergyItem } from '../data/electricity'
import { applyDefaultMachineOverrides, computeHorizon, resolveRowMachine } from '../data/horizon'
import { syntheticRecipeKind } from '../data/syntheticRecipes'
import type {
  AppState,
  Block,
  GameData,
  GameRecipeNode,
  MultiBlockSolve,
  PlanDataSetStamp,
  SolvedNode,
  SolverResult,
  SubPlan,
} from '../data/types'
import {
  SNAPSHOT_ELECTRICITY_ID,
  SNAPSHOT_HEAT_ID,
  SNAPSHOT_VERSION,
  type Snapshot,
  type SnapshotBeacon,
  type SnapshotBlock,
  type SnapshotGroup,
  type SnapshotItemRate,
  type SnapshotItemRef,
  type SnapshotGameRow,
  type SnapshotModule,
  type SnapshotRow,
} from './schema'

/** Rounds to three decimals; undefined for a value that is not a finite non-negative number (-0 counts as 0). */
export function round3(x: number): number | undefined {
  const r = Math.round(x * 1000) / 1000
  return Number.isFinite(r) && r >= 0 ? r + 0 : undefined
}

/** A required rate: three decimals, 0 when the value is unusable. */
const rate3 = (x: number): number => round3(x) ?? 0

/** The optional keys of a row's solved values, each left out when its value is unusable. */
function solvedValues(s: SolvedNode): Pick<SnapshotGameRow, 'machines' | 'machinesCeil' | 'throughput'> {
  const out: Pick<SnapshotGameRow, 'machines' | 'machinesCeil' | 'throughput'> = {}
  const machines = round3(s.machineCountExact)
  const throughput = round3(s.throughput)
  if (machines !== undefined) out.machines = machines
  if (Number.isInteger(s.machineCountCeil) && s.machineCountCeil >= 0) out.machinesCeil = s.machineCountCeil
  if (throughput !== undefined) out.throughput = throughput
  return out
}

/** A row's solved item rates, three decimals, without electricity and heat and without zero or unusable rates. */
function itemRates(rates: Record<string, number>, ref: (id: string) => SnapshotItemRef): SnapshotItemRate[] {
  return Object.entries(rates).flatMap(([id, r]) => {
    const rounded = isEnergyItem(id) ? undefined : round3(r)
    return rounded ? [{ ...ref(id), rate: rounded }] : []
  })
}

/** The keys of a row that come from the plan's node: its machine modules and its first sendable beacon, each left out when there is nothing to place. */
function nodeValues(node: GameRecipeNode): { modules?: SnapshotModule[]; beacon?: SnapshotBeacon } {
  const modules = node.modules.filter(m => m.moduleId !== '').map(m => ({ id: m.moduleId, count: m.count }))
  // The wire format carries one beacon: the first configuration that has something to place.
  const cfg = (node.beaconConfigs ?? []).find(c => c.beaconId && c.moduleId && c.beaconCount > 0)
  const beacon = cfg?.beaconId && cfg.moduleId
    ? { id: cfg.beaconId, count: cfg.beaconCount, module: cfg.moduleId, modules: cfg.modulesPerBeacon }
    : undefined
  return {
    ...(modules.length > 0 ? { modules } : {}),
    ...(beacon ? { beacon } : {}),
  }
}

/** Whether a sub-plan holds a recipe row at any depth. */
function hasRows(plan: SubPlan): boolean {
  return plan.nodes.some(n => n.kind !== 'subplan') || plan.subPlans.some(hasRows)
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
 * `power:` recipe carries its `kind` and `product` instead of a recipe id, electricity and
 * heat are the `virtual` items `electricity` and `heat`.
 *
 * Rows mirror the plan. A row without a solved node (every row of a block whose solve failed, or a
 * row the solve skipped) keeps its ids and omits the solved values, as does a value that is not a
 * finite non-negative number. A block whose solve failed (`solve.errors`) stays in the snapshot,
 * in its place, with its name, colour, products, the result's imports (the solver gives such a block
 * an empty result) and the solver's message as `error`.
 *
 * Warnings, connections between blocks, areas and power are not projected: the in-game table does not
 * draw them.
 *
 * A row also carries what the in-game table needs: its solved item rates (`inputs`, `outputs`, without
 * electricity and heat), the machine's modules and its beacon, and the sub-factory it sits in (`group`, an index
 * into the block's `groups`, which lists every sub-plan holding rows at any depth, parents first).
 */
export function projectSnapshot(
  state: AppState,
  solve: MultiBlockSolve,
  gameData: GameData,
  dataSet: PlanDataSetStamp,
): Snapshot {
  const horizon = computeHorizon(gameData, state.horizonTechnologyIds)
  const defaultMachines = applyDefaultMachineOverrides(gameData, horizon.machineIds, horizon.defaultMachines, state.defaultMachineOverrides)
  const ref = (id: string): SnapshotItemRef =>
    id === ELECTRICITY_ITEM_ID ? { id: SNAPSHOT_ELECTRICITY_ID, type: 'virtual' }
      : id === HEAT_ITEM_ID ? { id: SNAPSHOT_HEAT_ID, type: 'virtual' }
      : { id, type: gameData.items[id]?.type ?? 'item' }
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

    const solved = new Map(result.nodes.map(n => [n.recipeNodeId, n]))
    const rows: SnapshotRow[] = []
    const groups: SnapshotGroup[] = []
    const visited = new Set<string>()
    // A sub-plan with rows at any depth becomes the next group on being entered, so a parent comes before its children.
    const enter = (sp: SubPlan, parent: number | undefined): void => {
      if (visited.has(sp.id) || !hasRows(sp)) return
      groups.push({ name: sp.name, ...(parent !== undefined ? { parent } : {}), ...(sp.area ? { area: true as const } : {}) })
      visit(sp, groups.length - 1)
    }
    // Table order: a plan's nodes in order, a sub-factory's rows where its handle is, then sub-factories without a handle.
    const visit = (plan: SubPlan, group: number | undefined): void => {
      if (visited.has(plan.id)) return
      visited.add(plan.id)
      const byId = new Map(plan.subPlans.map(sp => [sp.id, sp]))
      for (const node of plan.nodes) {
        if (node.kind === 'subplan') {
          const sp = byId.get(node.subPlanId)
          if (sp) enter(sp, group)
          continue
        }
        const category = gameData.recipes[node.recipeId]?.category
        const machine = category === undefined
          ? node.machineId
          : resolveRowMachine(gameData, { ...horizon, defaultMachines }, category, node.machineId).machineId
        const s = solved.get(node.id)
        const inputs = s ? itemRates(s.inputRates, ref) : []
        const outputs = s ? itemRates(s.outputRates, ref) : []
        const common = {
          ...(machine !== undefined ? { machine } : {}),
          ...(group !== undefined ? { group } : {}),
          ...(s ? solvedValues(s) : {}),
          ...(inputs.length > 0 ? { inputs } : {}),
          ...(outputs.length > 0 ? { outputs } : {}),
          ...nodeValues(node),
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
      for (const sp of plan.subPlans) enter(sp, group)
    }
    visit(block.rootPlan, undefined)

    return {
      name: block.name,
      color: block.color,
      products,
      ...(groups.length > 0 ? { groups } : {}),
      rows,
      imports: result.unsatisfied.map(u => withRate(u.itemId, u.rate)),
      ...(error !== undefined ? { error } : {}),
    }
  }

  return {
    v: SNAPSHOT_VERSION,
    dataSet,
    blocks: state.blocks.map(projectBlock),
  }
}
