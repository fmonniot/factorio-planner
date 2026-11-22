import type { SolveResult } from 'javascript-lp-solver'
import type {
  GameData,
  GameRecipeNode,
  Recipe,
  AreaRoute,
  AreaSourceRule,
  SolvedArea,
  SolvedNode,
  SolverResult,
  SolverWarning,
  SourceRule,
  SubPlan,
} from '../data/types'
import { buildClassifiedSystem, discardProduct, lockedIngredients, rowIngredients, rowProductAmount, type ClassifiedSystem, type RowEffects } from './build'
import { itemRoutes, type ItemRoute, type RouteReceiver, type RouteSender } from './areaRoutes'
import { FluidTemperatureCollector } from './temperatureRows'
import {
  BIG_M, BYPRODUCTS_FIRST_SLACK_COST, SLACK_TOLERANCE, boundShortfall, buildLPModel, hasGoalRow, readLPResult, runLP,
  type LPModel, type LPResult,
} from './solve'
import { computeNodeEffects, type NodeEffects } from './effects'
import { isFeeder } from './absorbers'
import { boundOf, boundedStep, improvesImport } from './connectionOrder'
import {
  FLOW_TOLERANCE,
  blockDiagnostics,
  coproductDrivenWarning,
  itemGrossFlow,
  sourcingSets,
  itemsWithSourcing,
  pass2Plan,
  solvedNodeOf,
  surplusTolerance,
  zeroNode,
  type SolverPlan,
} from './blockResult'

// ---------------------------------------------------------------------------
// Areas: a sub-factory with `area: true` is solved as its own area. Its rows serve
// it first; what it still lacks comes from other areas, and what it makes beyond its
// own need goes to them. See spec/solver.md ("Areas").
// ---------------------------------------------------------------------------

/** The rows of one area, in the order `flattenBlock` visits them (id: root plan id or sub-plan id). */
export interface SolverArea {
  id: string
  nodeIds: string[]
  /** this area's own rules (`SubPlan.sourceRules`), each replacing the block's rule in this area, whole; absent when it has none */
  rules?: Record<string, AreaSourceRule>
}

/**
 * The areas with the rules of their sub-plans (`SubPlan.sourceRules`), for the plan `flattenBlock` builds. An area has `rules` only when
 * its sub-plan's record has a key, so a plan with no area rule keeps the very areas `blockAreas` made (and the keys built from them).
 */
export function withAreaRules(root: SubPlan, areas: SolverArea[]): SolverArea[] {
  const ruled = new Map<string, Record<string, AreaSourceRule>>()
  function visit(p: SubPlan): void {
    if (p.sourceRules && Object.keys(p.sourceRules).length > 0) ruled.set(p.id, p.sourceRules)
    for (const sp of p.subPlans) visit(sp)
  }
  visit(root)
  if (ruled.size === 0) return areas
  return areas.map(a => {
    const rules = ruled.get(a.id)
    return rules ? { ...a, rules } : a
  })
}

/** The rule an area applies to an item: its own (a keyless `{}` is a rule), else the block's, else `{}`. */
export function areaRuleOf(area: SolverArea, blockRules: Record<string, SourceRule> | undefined, itemId: string): AreaSourceRule {
  if (area.rules && Object.hasOwn(area.rules, itemId)) return area.rules[itemId]
  if (blockRules && Object.hasOwn(blockRules, itemId)) return blockRules[itemId]
  return {}
}

/**
 * javascript-lp-solver 1.0.3 pivots with a precision of 1e-8 and rounds every value it returns to
 * the nearest 1e-8, so a bound built from returned values can be off by about 1e-8 per non-zero
 * term. Each tolerance below sits well above that.
 */
/** Total dedicated imports at or below this count as none, so stage 2 requires exactly none. */
const LOCAL_ZERO = 1e-7
/** Absolute slack added to the stage-1 optimum before it bounds stage 2: 10 times the rounding step. */
const STAGE_ABS = 1e-7
/** Relative slack added to the stage-1 optimum, for float error when it is large. */
const STAGE_REL = 1e-7
/** Objective cost per unit sent to another area: 100 times the pivot precision, so it decides only ties. */
const SHIP_COST = 1e-6
/** Extra shipping cost per area of rank: the higher an area is in the table, the cheaper it is to send from. */
const RANK_STEP = 0.1
/** Dedicated imports above this are reported as `area-shortfall` (same as a goal shortfall). */
const AREA_SHORTFALL_TOLERANCE = 1e-4

/** The item a row is built for: `primaryProduct`, else the recipe's main product, else its first product. */
export function dedicatedProduct(node: GameRecipeNode, recipe: Recipe): string | undefined {
  return node.primaryProduct ?? recipe.mainProduct ?? recipe.products[0]?.itemId
}

/** The item a recipe names as its main product (the row's `primaryProduct`, else the recipe's `mainProduct`), if any. */
export function explicitMainProduct(node: GameRecipeNode, recipe: Recipe): string | undefined {
  return node.primaryProduct ?? recipe.mainProduct ?? undefined
}

/**
 * The areas of a block, in table order (the root first), or undefined when no sub-factory is a
 * separate area. A row belongs to its nearest enclosing area; a sub-factory that is not an area
 * only organises the rows of the area around it.
 */
export function blockAreas(root: SubPlan): SolverArea[] | undefined {
  const hasArea = (plan: SubPlan): boolean => plan.subPlans.some(sp => sp.area === true || hasArea(sp))
  if (!hasArea(root)) return undefined

  const areas = new Map<string, SolverArea>()
  function visit(plan: SubPlan, area: SolverArea): void {
    for (const n of plan.nodes) if (n.kind === 'game-recipe') area.nodeIds.push(n.id)
    for (const sp of plan.subPlans) {
      let next = area
      if (sp.area === true) {
        next = { id: sp.id, nodeIds: [] }
        areas.set(sp.id, next)
      }
      visit(sp, next)
    }
  }
  const rootArea: SolverArea = { id: root.id, nodeIds: [] }
  areas.set(root.id, rootArea)
  visit(root, rootArea)

  // Table order: a sub-factory's handle decides its place, sub-factories without one come last.
  const order: string[] = [root.id]
  const seen = new Set<string>()
  function rank(plan: SubPlan): void {
    const byId = new Map(plan.subPlans.map(sp => [sp.id, sp]))
    const handled = plan.nodes.flatMap(n => (n.kind === 'subplan' ? [byId.get(n.subPlanId)] : []))
    for (const sp of [...handled, ...plan.subPlans]) {
      if (!sp || seen.has(sp.id)) continue
      seen.add(sp.id)
      if (sp.area === true) order.push(sp.id)
      rank(sp)
    }
  }
  rank(root)
  return order.map(id => areas.get(id)!)
}

/** The area of every sub-plan: its own id when it is a separate area, else its nearest enclosing area's (the root's id at the top level). Blocks without areas map everything to the root. */
export function subPlanAreaIds(root: SubPlan): Map<string, string> {
  const map = new Map<string, string>()
  function visit(plan: SubPlan, areaId: string): void {
    map.set(plan.id, areaId)
    for (const sp of plan.subPlans) visit(sp, sp.area === true ? sp.id : areaId)
  }
  visit(root, root.id)
  return map
}

/** Recipe ids of the rows in the area containing sub-plan `subPlanId` (the whole block without areas); empty set when the sub-plan is not in the tree. */
export function areaRecipeIds(root: SubPlan, subPlanId: string): Set<string> {
  const areaIds = subPlanAreaIds(root)
  const areaId = areaIds.get(subPlanId)
  const ids = new Set<string>()
  if (areaId === undefined) return ids
  function visit(plan: SubPlan): void {
    if (areaIds.get(plan.id) === areaId) {
      for (const n of plan.nodes) if (n.kind === 'game-recipe') ids.add(n.recipeId)
    }
    for (const sp of plan.subPlans) visit(sp)
  }
  visit(root)
  return ids
}

export type SubPlanCopyBlocker = { reason: 'invalid' } | { reason: 'inside' } | { reason: 'recipes'; recipeIds: string[] }

function findPlan(plan: SubPlan, id: string): SubPlan | undefined {
  if (plan.id === id) return plan
  for (const sp of plan.subPlans) {
    const found = findPlan(sp, id)
    if (found) return found
  }
  return undefined
}

/**
 * Why a copy of sub-plan `subPlanId` cannot go into area `areaId`, or undefined when it can.
 * `invalid`: not a copyable sub-plan or not an area of the block. `inside`: the area is the sub-plan
 * or lies in its subtree. `recipes`: the rows that would join the area (the sub-plan's own rows and
 * those of its nested non-area sub-plans; none when the sub-plan is itself an area, as it keeps its own
 * area) already have a row of these recipes there, which would be a `duplicate-recipe`.
 */
export function subPlanCopyBlocker(root: SubPlan, subPlanId: string, areaId: string): SubPlanCopyBlocker | undefined {
  const source = subPlanId === root.id ? undefined : findPlan(root, subPlanId)
  if (!source || subPlanAreaIds(root).get(areaId) !== areaId) return { reason: 'invalid' }
  if (findPlan(source, areaId)) return { reason: 'inside' }
  if (source.area === true) return undefined
  const joining = new Set<string>()
  function collect(plan: SubPlan): void {
    for (const n of plan.nodes) if (n.kind === 'game-recipe') joining.add(n.recipeId)
    for (const sp of plan.subPlans) if (sp.area !== true) collect(sp)
  }
  collect(source)
  const taken = areaRecipeIds(root, areaId)
  const recipeIds = [...joining].filter(id => taken.has(id))
  return recipeIds.length > 0 ? { reason: 'recipes', recipeIds } : undefined
}

interface Column {
  /** LP name of the row (`n0`, `n1`, …): never collides with the other LP names. */
  id: string
  node: GameRecipeNode
  recipe: Recipe | undefined
  /** index in the block's areas */
  area: number
  effects: NodeEffects
  /** the item this row serves its area with first, when it makes it */
  dedicated?: string
}

/** The classified system over the block's columns: the same arithmetic as `buildClassifiedSystem`, one column per row. */
function buildColumnSystem(
  gameData: GameData,
  columns: Column[],
  goalsMap: Map<string, number>,
): ClassifiedSystem {
  // Productivity cannot change the sign of a coefficient, so this equals a per-column classification.
  // A burner column's fuel counts as a consumption (only the sign matters), so an in-plan fuel is an
  // intermediate, not a byproduct.
  const effectsMap = new Map<string, RowEffects>()
  for (const col of columns) {
    const prev = effectsMap.get(col.node.recipeId)
    const fuels = [prev?.fuel ?? [], col.effects.fuel ?? []].flat()
    effectsMap.set(col.node.recipeId, { ...col.effects, fuel: fuels })
  }
  const { classification } = buildClassifiedSystem(
    gameData, [...new Set(columns.map(c => c.node.recipeId))], goalsMap, effectsMap,
  )
  const S = new Map<string, Map<string, number>>()
  function addCoeff(itemId: string, columnId: string, delta: number) {
    if (!S.has(itemId)) S.set(itemId, new Map())
    S.get(itemId)!.set(columnId, (S.get(itemId)!.get(columnId) ?? 0) + delta)
  }
  const temperatures = new FluidTemperatureCollector()
  for (const col of columns) {
    const recipe = col.recipe
    if (!recipe) continue
    for (const prod of recipe.products) {
      const amount = rowProductAmount(prod, col.effects.productivityBonus, col.effects.heatBonus)
      if (amount > 0) {
        addCoeff(prod.itemId, col.id, amount)
        temperatures.addProduct(col.id, prod, amount, gameData.items[prod.itemId])
      }
    }
    for (const ing of rowIngredients(recipe, col.effects)) {
      if (ing.amount > 0) {
        addCoeff(ing.itemId, col.id, -ing.amount)
        temperatures.addIngredient(col.id, ing)
      }
    }
  }
  return { S, recipes: columns.map(c => c.id), classification, fluidTemperatures: temperatures.finish() }
}

/**
 * The size of the area ranks an item's tie-breaks are scaled by: the number of areas up to the lowest
 * one that touches the item, at least 2.
 */
const tieScale = (areas: number[]) => Math.max(2, ...areas.map(a => a + 1))
/**
 * The unit of the cost on what an area takes from other areas (`din`, `oin`): n times it per rank stays below half
 * a rank step of a sender, so among receivers the one higher in the table takes other areas' output first and the
 * lower ones import.
 */
const receiverTieUnit = (n: number) => SHIP_COST * RANK_STEP / (2 * n * n)

/** One area of an item that two areas or more touch, for one pass. */
export interface AreaItemArea {
  area: number
  /** stage-2 cost of the area's slack `s_a`; undefined: no slack (locked) */
  slackCost?: number
  /** cap of the area's supply `u_a` (Infinity: only the shared offer); undefined: no supply variable */
  supplyCap?: number
  /** `u_a` covers at most what the area's own columns outside the flagged rows (or the chain, see absorbers.ts) use (connections first) */
  supUse: boolean
  /** `u_a` counts in the least received of the order of a connection replacing an import (see `AreaOrder`) */
  received?: boolean
  /** the areas this one takes nothing from (read only when the item is a pair item: `AreaItemSpec.pairs`) */
  off: Set<number>
}

/** An item that two areas or more touch, solved with a slack and a supply per area. */
export interface AreaItemSpec {
  itemId: string
  /** the item's offer, shared by the areas' supplies (Infinity: unlimited, 0: none) */
  offer: number
  areas: AreaItemArea[]
  /** a pair item: flows per ordered pair of areas in place of the two pools, so a switched-off pair has no flow */
  pairs: boolean
}

/** What the LP gives per area for an area item: the slack (import or missing) and the supply. */
export interface AreaOutside { itemId: string; area: number; slack: number; supply: number }

/** What a pair item sends from one area, in the LP's solution: to another area, or (`to` absent) out of the block. */
export interface AreaPair { itemId: string; from: number; to?: number; rate: number }

/**
 * The steps of `connectionOrder.ts` in the area LP (sourcing priority phase 6). `measure` runs one LP on that
 * objective (`__imp`: every slack that costs `BIG_M`; `__rec`: the supplies of `defaults` and of the areas whose spec says
 * `received`) and returns its sum as `measured`; without it the two stages run as usual. `importCap` and `receivedCap`
 * bound the two sums in every stage.
 */
export interface AreaOrder {
  /** The plain (not per-area) connected items whose supply counts as received. */
  defaults: Set<string>
  byproductsFirst: Set<string>
  measure?: '__imp' | '__rec'
  /** build the temperature rows without slack as `today` did (see `LPBuildOptions.lockedTemperatures`; default true) */
  lockedTemperatures?: boolean
  importCap?: number
  receivedCap?: number
}

export type AreaLPResult = LPResult & {
  /** the sum `AreaOrder.measure` asked for */
  measured?: number
  /** how many variables that sum ran over (the bound of the next step leaves n·1e-8 of room, see `boundOf`) */
  measuredTerms?: number
  /** what areas with their own row for an item still take from other areas' dedicated rows */
  dedicatedIn: { area: number; itemId: string; rate: number }[]
  /** per area item and area: the slack and the supply */
  outside: AreaOutside[]
  /** per pair item: the flow of each ordered pair of areas and each area's sink; empty when the LP is infeasible */
  pairs: AreaPair[]
}

/**
 * The elastic LP of `buildLPModel` plus, for every item that columns of two areas or more touch,
 * flows between areas (see spec/solver.md, "Areas"). An area balances each such item:
 *   Σ S x + din + oin − dout − oout (+ s_a + u_a, for an intermediate) = 0
 * where `d…` flows come from or go to dedicated rows (made for that item) and `o…` flows from
 * other rows. Pools bound what is taken by what is sent. An intermediate has its own slack `s_a` and
 * supply `u_a` in each area's row (`areaItems`), which carry that area's rule. An item with a supplier switched off
 * (`AreaItemSpec.pairs`) has flows per ordered pair of areas in place of the pools, none for a switched-off pair, and a
 * free sink per producing area for what leaves the block.
 *
 * Two LP calls: stage 1 minimises imports, then dedicated imports (an area with its own row for an
 * item takes nothing from others when it can help it); stage 2 keeps those at their optimum and
 * minimises runs, with a tiny cost per unit sent so that local production wins ties and, among
 * senders, the area higher in the table does.
 */
function solveAreaLP(
  system: ClassifiedSystem,
  columns: Column[],
  pinnedRates: Map<string, number>,
  bcColumns: Set<string>,
  feederColumns: Set<string>,
  noImportItems: Set<string>,
  supplyCaps: Map<string, number>,
  connectionsFirst: Set<string>,
  byproductsFirst: Set<string>,
  areaItems: AreaItemSpec[],
  order?: AreaOrder,
): AreaLPResult {
  const args = [system, columns, pinnedRates, bcColumns, feederColumns, noImportItems, supplyCaps, connectionsFirst, byproductsFirst, areaItems] as const
  const first = solveAreaLPOnce(...args, { elastic: false, lockedTemperatures: order?.lockedTemperatures ?? true }, order)
  // The order runs only on a block whose passes were feasible; it never goes elastic nor drops the locked rows.
  if (first.feasible || order) return first
  // As in `solveLP`: the temperature rows without slack give way first, then goal rows go elastic (kept only if feasible).
  const plain = first.lockedTemperatures ? solveAreaLPOnce(...args, { elastic: false, lockedTemperatures: false }) : first
  if (plain.feasible || !hasGoalRow(system)) return plain
  const elastic = solveAreaLPOnce(...args, { elastic: true, lockedTemperatures: false })
  return elastic.feasible ? elastic : plain
}

function solveAreaLPOnce(
  system: ClassifiedSystem,
  columns: Column[],
  pinnedRates: Map<string, number>,
  bcColumns: Set<string>,
  feederColumns: Set<string>,
  noImportItems: Set<string>,
  supplyCaps: Map<string, number>,
  connectionsFirst: Set<string>,
  byproductsFirst: Set<string>,
  areaItems: AreaItemSpec[],
  mode: { elastic: boolean; lockedTemperatures: boolean },
  order?: AreaOrder,
): AreaLPResult {
  const elasticGoals = mode.elastic
  const { S, classification } = system
  const specOf = new Map(areaItems.map(s => [s.itemId, s]))
  // An area item's block row keeps one slack as the template of the per-area ones: no lock, no supply here.
  // The items whose supply gets an `auuse` row below never anchor an unflagged candidate (see absorbers.ts).
  const extraSupplied = new Set(
    areaItems.filter(s => s.offer > 0 && classification.intermediates.has(s.itemId)
      && s.areas.some(a => a.supUse && a.supplyCap !== undefined)).map(s => s.itemId),
  )
  const base = buildLPModel(
    system, pinnedRates, bcColumns,
    specOf.size === 0 ? noImportItems : new Set([...noImportItems].filter(id => !specOf.has(id))),
    specOf.size === 0 ? supplyCaps : new Map([...supplyCaps].filter(([id]) => !specOf.has(id))),
    connectionsFirst, byproductsFirst, elasticGoals,
    // An area whose rule is Don't make more here has a cheap slack of its own for the item.
    new Set(areaItems.filter(s => s.areas.some(a => a.slackCost !== undefined && a.slackCost < BIG_M)).map(s => s.itemId)),
    { markedFeeders: feederColumns, extraSupplied, lockedTemperatures: mode.lockedTemperatures },
  )
  const { constraints, variables } = base
  const colVar = new Map(columns.map(c => [c.id, base.recipeToVar.get(c.id)!]))

  // Every variable carries both stage objectives; the library ignores attributes that are neither
  // a constraint nor the optimised one.
  for (const v of Object.values(variables)) v.__s2 = v.__obj__ ?? 0
  // Stage 1 only produces the bound L on dedicated imports, so every slack keeps BIG_M, byproducts-first
  // ones included: stage 2 already carries the real slack cost and chooses the import over running a row.
  // Epsilon here would make stage 1 import rather than use another area's dedicated row, forcing L = 0
  // and forbidding that area's dedicated output even when it is made anyway. Byproducts from other
  // areas' non-dedicated rows flow through the unpenalised `o…` pools at SHIP_COST, below epsilon,
  // so they are shipped before importing.
  for (const name of base.itemToSlack.values()) variables[name].__s1 = BIG_M
  // The elastic solve's shortfalls cost like an import in both stages (see `buildLPModel`).
  for (const name of base.goalToShort.values()) variables[name].__s1 = BIG_M

  const penalised: { name: string; area: number; itemId: string }[] = []
  const rankOf = (area: number) => SHIP_COST * (1 + RANK_STEP * area)
  let k = 0
  let j = 0

  // An area item. Each area gets its own slack `s_a` and supply `u_a` in its balance row, in place of the item's one
  // slack and supply in the other pool; the pools carry only the flows between areas.
  const areaNames: { itemId: string; area: number; slack?: string; supply?: string }[] = []
  // The variables the order's two sums run over (see `AreaOrder`).
  const orderNames: { imp: string[]; rec: string[] } = { imp: [], rec: [] }
  const pairNames: { itemId: string; from: number; to?: number; names: string[] }[] = []
  function addAreaItem(spec: AreaItemSpec, byArea: Map<number, { col: Column; coeff: number }[]>): void {
    const { itemId } = spec
    const tmplName = base.itemToSlack.get(itemId)
    // The rows the item's slack sits in (its block row and its fluid temperature rows): every s_a and u_a joins them.
    const rows: Record<string, number> = {}
    if (tmplName) {
      for (const [key, v] of Object.entries(variables[tmplName])) if (!key.startsWith('__')) rows[key] = v
      delete variables[tmplName]
      base.itemToSlack.delete(itemId)
    }
    const offerRow = `aucap${j}`
    if (Number.isFinite(spec.offer) && spec.offer > 0) constraints[offerRow] = { max: spec.offer }
    const areaSpec = new Map(spec.areas.map(a => [a.area, a]))

    const info: { area: number; row: string; i: number; hasDedicated: boolean; hasOther: boolean }[] = []
    const n = tieScale([...byArea.keys()])
    let created = 0
    for (const area of [...byArea.keys()].sort((a, b) => a - b)) {
      const cols = byArea.get(area)!
      const i = k++
      const row = `area${i}`
      constraints[row] = { equal: 0 }
      for (const { col, coeff } of cols) variables[colVar.get(col.id)!][row] = coeff
      const hasDedicated = cols.some(({ col, coeff }) => col.dedicated === itemId && coeff > 0)
      const hasOther = cols.some(({ col, coeff }) => col.dedicated !== itemId && coeff > 0)
      info.push({ area, row, i, hasDedicated, hasOther })

      const sa = areaSpec.get(area)
      const names: { itemId: string; area: number; slack?: string; supply?: string } = { itemId, area }
      if (sa?.slackCost !== undefined && tmplName) {
        names.slack = `as${i}`
        created++
        variables[names.slack] = { ...rows, __obj__: sa.slackCost, __s2: sa.slackCost, __s1: BIG_M, [row]: 1 }
        if (order && sa.slackCost === BIG_M) orderNames.imp.push(names.slack)
      }
      if (sa?.supplyCap !== undefined && tmplName && spec.offer > 0) {
        names.supply = `au${i}`
        created++
        // Below half a shipped unit whatever the number of areas, so it never outweighs taking another area's surplus:
        // a short offer goes to the area higher in the table.
        const tie = SHIP_COST * area / (2 * n)
        const u: Record<string, number> = { ...rows, __obj__: 0, __s2: tie, [row]: 1 }
        if (constraints[offerRow]) u[offerRow] = 1
        if (Number.isFinite(sa.supplyCap)) {
          constraints[`aucapa${i}`] = { max: sa.supplyCap }
          u[`aucapa${i}`] = 1
        }
        if (sa.supUse) {
          // As `supuse` in `buildLPModel`, over this area's columns.
          constraints[`auuse${i}`] = { max: 0 }
          u[`auuse${i}`] = 1
          for (const { col, coeff } of cols) {
            if (coeff < 0 && !base.absorbers.noSupply.has(col.id)) variables[colVar.get(col.id)!][`auuse${i}`] = coeff
          }
        }
        variables[names.supply] = u
        if (order && sa.received) orderNames.rec.push(names.supply)
      }
      areaNames.push(names)
    }
    // An area item that gets neither an import nor a supply in any area (locked) is like an item `buildLPModel` builds
    // without them: its temperature rows (the template slack is gone, so they have none) stay as slack-less rows when
    // every consumer class has a producer (`temperatureFitItems`), else they go.
    if (tmplName !== undefined && created === 0) {
      if (base.temperatureFitItems.has(itemId) && base.itemToTemperatureRows.get(itemId)?.length) base.lockedTemperatureItems.add(itemId)
      else for (const r of base.itemToTemperatureRows.get(itemId) ?? []) delete constraints[r]
    }

    const capRows = (x: (typeof info)[number]) => {
      const cols = byArea.get(x.area)!
      if (x.hasDedicated) {
        constraints[`dcap${x.i}`] = { max: 0 }
        for (const { col, coeff } of cols) {
          if (col.dedicated === itemId && coeff > 0) variables[colVar.get(col.id)!][`dcap${x.i}`] = -coeff
        }
      }
      if (x.hasOther) {
        constraints[`ocap${x.i}`] = { max: 0 }
        for (const { col, coeff } of cols) {
          if (col.dedicated !== itemId && coeff > 0) variables[colVar.get(col.id)!][`ocap${x.i}`] = -coeff
        }
      }
    }

    if (spec.pairs) {
      j++
      for (const x of info) capRows(x)
      // μ·b·(n − a) is a Monge cost increasing with the receiver's rank: the cheapest transport is the north-west
      // corner (senders in table order fill receivers in table order), and what is imported goes to the last
      // receivers. μ·n stays below half a rank step of the sender, so the sender's rank still decides first.
      const tie = (a: number, b: number) => receiverTieUnit(n) * b * (n - a)
      for (const from of info) {
        // What leaves the block from this area (a goal, a surplus): free: shipping costs more than leaving, and costing the sink like a shipped unit sank the first sender's surplus (the pools price leaving at the sender's rank, `dout`/`oout`; a pair item's surplus is not priced, so the two paths agree only where a surplus is pinned or consumed).
        if (from.hasDedicated || from.hasOther) {
          const sink = `sk${from.i}`
          variables[sink] = { __s2: 0, [from.row]: -1 }
          pairNames.push({ itemId, from: from.area, names: [sink] })
        }
        for (const to of info) {
          if (to === from || areaSpec.get(to.area)?.off.has(from.area)) continue
          const names: string[] = []
          if (from.hasDedicated) {
            const name = `dp${from.i}_${to.i}`
            variables[name] = { __s2: rankOf(from.area) + tie(from.area, to.area), [from.row]: -1, [to.row]: 1, [`dcap${from.i}`]: 1 }
            if (to.hasDedicated) {
              variables[name].__s1 = 1
              penalised.push({ name, area: to.area, itemId })
            }
            names.push(name)
          }
          if (from.hasOther) {
            const name = `op${from.i}_${to.i}`
            variables[name] = { __s2: rankOf(from.area) + tie(from.area, to.area), [from.row]: -1, [to.row]: 1, [`ocap${from.i}`]: 1 }
            names.push(name)
          }
          if (names.length > 0) pairNames.push({ itemId, from: from.area, to: to.area, names })
        }
      }
      return
    }

    const dpool = `dpool${j}`
    const opool = `opool${j++}`
    constraints[dpool] = { max: 0 }
    constraints[opool] = { max: 0 }
    // What is taken from other areas goes to the receivers higher in the table first (as `itemRoutes` pairs),
    // so the imports, per area, go to the last ones.
    for (const x of info) {
      const tie = receiverTieUnit(n) * x.area * n
      variables[`din${x.i}`] = { __s2: tie, [x.row]: 1, [dpool]: 1 }
      variables[`oin${x.i}`] = { __s2: tie, [x.row]: 1, [opool]: 1 }
      capRows(x)
      if (x.hasDedicated) {
        variables[`dout${x.i}`] = { __s2: rankOf(x.area), [x.row]: -1, [dpool]: -1, [`dcap${x.i}`]: 1 }
        variables[`din${x.i}`].__s1 = 1
        penalised.push({ name: `din${x.i}`, area: x.area, itemId })
      }
      if (x.hasOther) variables[`oout${x.i}`] = { __s2: rankOf(x.area), [x.row]: -1, [opool]: -1, [`ocap${x.i}`]: 1 }
    }
  }

  const colOf = new Map(columns.map(c => [c.id, c]))
  const colIndex = new Map(columns.map((c, i) => [c.id, i]))
  for (const itemId of [...classification.goals.keys(), ...classification.intermediates]) {
    const rowS = S.get(itemId)
    if (!rowS) continue
    const byArea = new Map<number, { col: Column; coeff: number }[]>()
    // The row's columns in column order, so the order of the LP's terms does not depend on how `S` was filled.
    const inRow = [...rowS].flatMap(([id, coeff]) => (coeff !== 0 && colOf.has(id) ? [{ col: colOf.get(id)!, coeff }] : []))
    inRow.sort((x, y) => colIndex.get(x.col.id)! - colIndex.get(y.col.id)!)
    for (const { col, coeff } of inRow) {
      const list = byArea.get(col.area) ?? []
      list.push({ col, coeff })
      byArea.set(col.area, list)
    }
    if (byArea.size < 2) continue

    const spec = specOf.get(itemId)
    if (spec) {
      addAreaItem(spec, byArea)
      continue
    }

    const dpool = `dpool${j}`
    const opool = `opool${j++}`
    constraints[dpool] = { max: 0 }
    constraints[opool] = { max: 0 }

    for (const area of [...byArea.keys()].sort((a, b) => a - b)) {
      const cols = byArea.get(area)!
      const i = k++
      const hasDedicated = cols.some(({ col, coeff }) => col.dedicated === itemId && coeff > 0)
      const hasOther = cols.some(({ col, coeff }) => col.dedicated !== itemId && coeff > 0)
      const areaRow = `area${i}`
      constraints[areaRow] = { equal: 0 }
      for (const { col, coeff } of cols) variables[colVar.get(col.id)!][areaRow] = coeff

      variables[`din${i}`] = { __s2: 0, [areaRow]: 1, [dpool]: 1 }
      variables[`oin${i}`] = { __s2: 0, [areaRow]: 1, [opool]: 1 }
      if (hasDedicated) {
        variables[`dout${i}`] = { __s2: rankOf(area), [areaRow]: -1, [dpool]: -1, [`dcap${i}`]: 1 }
        constraints[`dcap${i}`] = { max: 0 }
        for (const { col, coeff } of cols) {
          if (col.dedicated === itemId && coeff > 0) variables[colVar.get(col.id)!][`dcap${i}`] = -coeff
        }
        variables[`din${i}`].__s1 = 1
        penalised.push({ name: `din${i}`, area, itemId })
      }
      if (hasOther) {
        variables[`oout${i}`] = { __s2: rankOf(area), [areaRow]: -1, [opool]: -1, [`ocap${i}`]: 1 }
        constraints[`ocap${i}`] = { max: 0 }
        for (const { col, coeff } of cols) {
          if (col.dedicated !== itemId && coeff > 0) variables[colVar.get(col.id)!][`ocap${i}`] = -coeff
        }
      }
    }
  }

  if (order) {
    for (const [itemId, name] of base.itemToSlack) if (!order.byproductsFirst.has(itemId)) orderNames.imp.push(name)
    for (const [itemId, name] of base.itemToSupply) if (order.defaults.has(itemId)) orderNames.rec.push(name)
    for (const [names, attr] of [[orderNames.imp, '__imp'], [orderNames.rec, '__rec']] as const) {
      for (const name of names) variables[name][attr] = 1
    }
    if (order.importCap !== undefined) {
      constraints.__impcap = { max: order.importCap }
      for (const name of orderNames.imp) variables[name].__impcap = 1
    }
    if (order.receivedCap !== undefined) {
      constraints.__reccap = { max: order.receivedCap }
      for (const name of orderNames.rec) variables[name].__reccap = 1
    }
    if (order.measure === '__rec') {
      // Within the import bound's room, an import costs BIG_M (see connectionOrder.ts, step 3).
      for (const name of orderNames.imp) variables[name].__rec = BIG_M
    }
  }

  // `local` bounds the dedicated imports in total.
  const run = (optimize: string, local?: number): SolveResult => {
    const cs = structuredClone(constraints)
    const vs = structuredClone(variables)
    if (local !== undefined) {
      cs.local = { max: local }
      for (const p of penalised) vs[p.name].local = 1
    }
    return runLP(optimize, cs, vs)
  }
  const finish = (result: SolveResult, model: LPModel): AreaLPResult => {
    const lp = readLPResult(result, model, system.recipes, pinnedRates, result.feasible === true)
    // The LP is keyed by column id; warnings name recipes.
    const recipeOf = new Map(columns.map(c => [c.id, c.node.recipeId]))
    const warnings = lp.warnings.map(w =>
      w.type === 'infeasible-pins'
        ? { ...w, recipeIds: [...new Set(w.recipeIds.map(id => recipeOf.get(id) ?? id))] }
        : w,
    )
    const value = (name: string | undefined) =>
      name !== undefined && typeof result[name] === 'number' ? Math.max(0, result[name] as number) : 0
    // A failed solve still reports variable values; they say nothing about imports.
    // Summed per area and item: a pair item has one penalised flow per sender.
    const dedicatedInOf = new Map<string, { area: number; itemId: string; rate: number }>()
    if (result.feasible === true) {
      for (const p of penalised) {
        const key = `${p.area}\u0000${p.itemId}`
        const d = dedicatedInOf.get(key) ?? { area: p.area, itemId: p.itemId, rate: 0 }
        d.rate += value(p.name)
        dedicatedInOf.set(key, d)
      }
    }
    const dedicatedIn = [...dedicatedInOf.values()]

    // Area items: the block's slack and supply are the sums over the areas.
    const outside = areaNames.map(n => ({ itemId: n.itemId, area: n.area, slack: value(n.slack), supply: value(n.supply) }))
    const slack = new Map(lp.slack)
    const supply = new Map(lp.supply)
    const totals = new Map<string, { s: number; u: number }>()
    for (const o of outside) {
      const t = totals.get(o.itemId) ?? { s: 0, u: 0 }
      t.s += o.slack
      t.u += o.supply
      totals.set(o.itemId, t)
    }
    // `specOf` order, as before.
    for (const itemId of specOf.keys()) {
      const t = totals.get(itemId)
      if (!t) continue
      if (t.s > SLACK_TOLERANCE) slack.set(itemId, t.s)
      if (t.u > SLACK_TOLERANCE) supply.set(itemId, t.u)
    }
    const pairs: AreaPair[] = result.feasible !== true ? [] : pairNames.map(p => ({
      itemId: p.itemId,
      from: p.from,
      ...(p.to !== undefined ? { to: p.to } : {}),
      rate: p.names.reduce((t, name) => t + value(name), 0),
    }))
    return { ...lp, slack, supply, warnings, dedicatedIn, outside, pairs }
  }

  if (order?.measure) {
    const result = runLP(order.measure, constraints, variables)
    const names = order.measure === '__imp' ? orderNames.imp : orderNames.rec
    const measured = names.reduce((t, name) => t + (typeof result[name] === 'number' ? Math.max(0, result[name] as number) : 0), 0)
    return { ...finish(result, base), measured, measuredTerms: names.length }
  }

  // Elastic: the least total shortfall comes first, before stage 1 (pools included, so a goal another
  // area could cover is not left short).
  if (elasticGoals) {
    const failed = boundShortfall(base)
    if (failed) return finish(failed, base)
  }

  let stage1: SolveResult | undefined
  let d1 = 0
  if (penalised.length > 0) {
    stage1 = run('__s1')
    if (stage1.feasible !== true) return finish(stage1, base)
    for (const p of penalised) d1 += Math.max(0, (stage1[p.name] as number | undefined) ?? 0)
  }

  const relaxed = d1 * (1 + STAGE_REL) + STAGE_ABS
  const bound = d1 <= LOCAL_ZERO ? 0 : relaxed
  let stage2 = run('__s2', stage1 ? bound : undefined)
  if (stage2.feasible !== true && stage1 && bound === 0) stage2 = run('__s2', relaxed)
  // Still infeasible with the relaxed bound: drop `local` rather than keep stage 1, whose
  // objective puts no cost on recipe runs (its throughputs are arbitrary vertices).
  // Not unit-tested: stage 2 only differs from stage 1 by `local` and the cost terms, and no
  // fixture makes a feasible stage 1 infeasible without it.
  if (stage2.feasible !== true && stage1) stage2 = run('__s2')
  if (stage2.feasible !== true) return finish(stage2, base)
  return finish(stage2, base)
}

/**
 * The rule the block-wide sets read for an item one area touches (its own rule, else the block's), without
 * `areasOff`; the items two areas or more touch, which the LP gives a slack and a supply per area; and the pair items,
 * touched by two areas or more where one area switches off another that also touches the item (goals included).
 * `offOf` is the set of areas an area takes nothing from for an item (a switch naming the area itself or an unknown id is dropped).
 * With no area rule `effective` is `plan.sourceRules` itself.
 */
function resolveAreaRules(plan: SolverPlan, areas: SolverArea[], columns: Column[], system: ClassifiedSystem): {
  areaItems: Set<string>
  pairItems: Set<string>
  effective: SolverPlan['sourceRules']
  ruleOf: (area: number, itemId: string) => AreaSourceRule
  offOf: (area: number, itemId: string) => Set<number>
  touching: Map<string, number[]>
} {
  const touching = touchingAreas(system, columns)
  const ruleOf = (a: number, itemId: string): AreaSourceRule => areaRuleOf(areas[a], plan.sourceRules, itemId)
  const indexOf = new Map(areas.map((a, i) => [a.id, i]))
  const offOf = (a: number, itemId: string): Set<number> => {
    const off = new Set<number>()
    for (const id of ruleOf(a, itemId).areasOff ?? []) {
      const b = indexOf.get(id)
      if (b !== undefined && b !== a) off.add(b)
    }
    return off
  }
  const areaItems = new Set<string>()
  const pairItems = new Set<string>()
  const effective: Record<string, SourceRule> = { ...plan.sourceRules }
  let changed = false
  for (const [itemId, as] of touching) {
    if (as.length >= 2) {
      if (system.classification.intermediates.has(itemId)) areaItems.add(itemId)
      if (as.some(a => [...offOf(a, itemId)].some(b => as.includes(b)))) pairItems.add(itemId)
      continue
    }
    if (as.length === 0) continue
    // An item one area touches keeps only its block row: it follows that area's rule through the block-wide sets.
    const own = ruleOf(as[0], itemId)
    const block = plan.sourceRules?.[itemId] ?? {}
    if (own.makeHere === block.makeHere && (own.importOff === true) === (block.importOff === true)) continue
    const core: SourceRule = {}
    if (own.makeHere !== undefined) core.makeHere = own.makeHere
    if (own.importOff === true) core.importOff = true
    effective[itemId] = core
    changed = true
  }
  return { areaItems, pairItems, effective: changed ? effective : plan.sourceRules, ruleOf, offOf, touching }
}

/**
 * One area's outside leg: its slack plus its supply, at most what it takes (`supplied` the supply's part). `excess` is what
 * it brings beyond that, `passing` the supply's part of it (what passes through the area to the others).
 */
function outsideLeg(o: AreaOutside, receivers: RouteReceiver[], tol: number) {
  const full = o.slack + o.supply
  const takes = receivers.find(r => r.area === o.area)?.rate ?? 0
  const rate = Math.min(full, takes)
  return {
    rate,
    supplied: Math.min(o.supply, rate),
    excess: full - takes,
    passing: full - takes > tol ? Math.max(0, o.supply - takes) : 0,
  }
}

/**
 * The routes of an area item, read from the LP. Outside legs into an area are its slack plus its supply, at most what it
 * receives (`supplied` the supply's part). What an area takes beyond that (a supply bounded by its use, while its rows
 * make as much) passes through it to the others: it is outside supply to them, so the routes keep agreeing with the nets.
 * The area-to-area legs, and the outside legs left over, are paired by `itemRoutes`, on what each receiver still takes
 * once its own outside leg is counted. A pair item (`pairs` given) reads its area-to-area legs from the LP too (`pairItemRoutes`).
 */
function areaItemRoutes(
  itemId: string,
  areas: SolverArea[],
  outside: AreaOutside[],
  senders: RouteSender[],
  receivers: RouteReceiver[],
  pairs?: AreaPair[],
): AreaRoute[] {
  if (pairs !== undefined) return pairItemRoutes(itemId, areas, outside, senders, receivers, pairs)
  const tol = Math.min(...senders.map(x => x.tol), ...receivers.map(x => x.tol))
  const into = new Map<number, { rate: number; supplied: number }>()
  const outsideIn = new Map<number, number>()
  let passing = 0
  for (const o of outside) {
    const leg = outsideLeg(o, receivers, tol)
    passing += leg.passing
    if (leg.rate <= tol) continue
    outsideIn.set(o.area, leg.rate)
    into.set(o.area, { rate: leg.rate, supplied: leg.supplied })
  }
  const rest = receivers
    .map(r => ({ ...r, rate: r.rate - (outsideIn.get(r.area) ?? 0) }))
    .filter(r => r.rate > r.tol)
  const legs: ItemRoute[] = []
  for (const l of itemRoutes(senders, rest)) {
    if (l.from !== undefined || l.to === undefined) {
      legs.push(l)
      continue
    }
    // Outside supply left over for this receiver: what an area passed on is connected supply.
    const part = Math.min(passing, l.rate)
    passing -= part
    const own = into.get(l.to)
    into.set(l.to, { rate: (own?.rate ?? 0) + l.rate, supplied: (own?.supplied ?? 0) + part })
  }
  for (const [to, v] of into) legs.push({ to, rate: v.rate })
  return legRoutes(itemId, areas, legs, into)
}

/** Sorts the legs and gives each outside leg into an area its `supplied`. */
function legRoutes(
  itemId: string,
  areas: SolverArea[],
  legs: ItemRoute[],
  into: Map<number, { rate: number; supplied: number }>,
): AreaRoute[] {
  const rank = (a: number | undefined) => (a === undefined ? Infinity : a)
  return legs
    .sort((a, b) => rank(a.from) - rank(b.from) || rank(a.to) - rank(b.to))
    .map(l => {
      const s = l.from === undefined && l.to !== undefined ? into.get(l.to)?.supplied ?? 0 : 0
      return {
        itemId,
        ...(l.from !== undefined ? { from: areas[l.from].id } : {}),
        ...(l.to !== undefined ? { to: areas[l.to].id } : {}),
        rate: l.rate,
        ...(s > FLOW_TOLERANCE ? { supplied: s } : {}),
      }
    })
}

/**
 * The routes of a pair item: the LP's flow of each ordered pair of areas and each area's sink are the legs. Outside supply
 * (the slack and the supply of an area) is a leg into the area, at most what the area takes; what it brings beyond that
 * passes through the area, so it is taken back from the area's own outgoing legs (the sink first, then the receivers lowest
 * in the table first) and moved to an outside leg into the receiver, `supplied` for the supply's part. A relay (c to a,
 * a to b) stays as two legs.
 */
function pairItemRoutes(
  itemId: string,
  areas: SolverArea[],
  outside: AreaOutside[],
  senders: RouteSender[],
  receivers: RouteReceiver[],
  pairs: AreaPair[],
): AreaRoute[] {
  const tol = Math.min(...senders.map(x => x.tol), ...receivers.map(x => x.tol))
  const legs: ItemRoute[] = pairs
    .filter(p => p.rate > tol)
    .map(p => ({ from: p.from, ...(p.to !== undefined ? { to: p.to } : {}), rate: p.rate }))
  const into = new Map<number, { rate: number; supplied: number }>()
  for (const o of outside) {
    const { rate, supplied: inSupplied, excess: out, passing: pass } = outsideLeg(o, receivers, tol)
    if (rate > tol) {
      // An earlier area's pass-through may already have put a leg here.
      const v = into.get(o.area) ?? { rate: 0, supplied: 0 }
      into.set(o.area, { rate: v.rate + rate, supplied: v.supplied + inSupplied })
    }
    let excess = out
    if (excess <= tol) continue
    let passing = pass
    const own = legs
      .filter(l => l.from === o.area)
      .sort((a, b) => (a.to === undefined ? -1 : b.to === undefined ? 1 : b.to - a.to))
    for (const leg of own) {
      if (excess <= tol) break
      const part = Math.min(excess, leg.rate)
      leg.rate -= part
      excess -= part
      // Outside, through the area, back outside: nothing to add.
      if (leg.to === undefined) continue
      const supplied = Math.min(passing, part)
      passing -= supplied
      const v = into.get(leg.to) ?? { rate: 0, supplied: 0 }
      into.set(leg.to, { rate: v.rate + part, supplied: v.supplied + supplied })
    }
    // Outside supply that never entered the area's legs (rounding, or a surplus the LP kept in its balance): it stays an
    // outside leg into the area, so the routes still add up.
    if (excess > tol) {
      const supplied = Math.min(passing, excess)
      const v = into.get(o.area) ?? { rate: 0, supplied: 0 }
      into.set(o.area, { rate: v.rate + excess, supplied: v.supplied + supplied })
    }
  }
  const all: ItemRoute[] = legs.filter(l => l.rate > tol)
  for (const [to, v] of into) all.push({ to, rate: v.rate })
  return legRoutes(itemId, areas, all, into)
}

/**
 * Items/min each area receives and sends, from the net production of its rows, and the routes
 * between areas (`itemRoutes`; `dedicatedIn` is the final pass's allowed shortfall per restricted area;
 * an area item's routes come from the LP, see `areaItemRoutes`; a pair item's area-to-area legs too, `pairItems` with the LP's `pairs`).
 */
function areaFlows(
  system: ClassifiedSystem,
  columns: Column[],
  throughput: Map<string, number>,
  areas: SolverArea[],
  dedicatedIn: { area: number; itemId: string; rate: number }[],
  outside: AreaOutside[],
  areaItems: ReadonlySet<string>,
  pairItems: ReadonlySet<string>,
  pairs: AreaPair[],
): { areas: SolvedArea[]; routes: AreaRoute[] } {
  const colById = new Map(columns.map(c => [c.id, c]))
  const dedicatedInOf = new Map(dedicatedIn.map(d => [`${d.area}\u0000${d.itemId}`, d.rate]))
  const solved: SolvedArea[] = areas.map(a => ({ areaId: a.id, receives: [], sends: [] }))
  const routes: AreaRoute[] = []
  const outsideOf = new Map<string, AreaOutside[]>()
  for (const o of outside) outsideOf.set(o.itemId, [...(outsideOf.get(o.itemId) ?? []), o])
  for (const [itemId, rowS] of [...system.S].sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) {
    const net = areas.map(() => 0)
    const other = areas.map(() => 0)
    const restricted = areas.map(() => false)
    const produced = areas.map(() => 0)
    const consumed = areas.map(() => 0)
    let blockNet = 0
    let blockProduced = 0
    let blockConsumed = 0
    for (const [colId, coeff] of rowS) {
      const flow = coeff * (throughput.get(colId) ?? 0)
      const a = colById.get(colId)!.area
      net[a] += flow
      blockNet += flow
      const dedicated = colById.get(colId)?.dedicated === itemId
      if (dedicated && coeff > 0) restricted[a] = true
      if (flow > 0) {
        if (!dedicated) other[a] += flow
        produced[a] += flow
        blockProduced += flow
      } else {
        consumed[a] -= flow
        blockConsumed -= flow
      }
    }
    const blockTol = surplusTolerance(Math.max(blockProduced, blockConsumed))
    const senders: RouteSender[] = []
    const receivers: RouteReceiver[] = []
    for (let a = 0; a < areas.length; a++) {
      const tol = surplusTolerance(Math.max(produced[a], consumed[a]))
      if (net[a] > tol) {
        solved[a].sends.push({ itemId, rate: net[a], boundary: blockNet > blockTol })
        senders.push({ area: a, rate: net[a], other: other[a], tol })
      } else if (net[a] < -tol) {
        solved[a].receives.push({ itemId, rate: -net[a], boundary: blockNet < -blockTol })
        receivers.push({
          area: a,
          rate: -net[a],
          restricted: restricted[a],
          dedicatedIn: dedicatedInOf.get(`${a}\u0000${itemId}`) ?? 0,
          tol,
        })
      }
    }
    if (areaItems.has(itemId) || pairItems.has(itemId)) {
      routes.push(...areaItemRoutes(
        itemId, areas, outsideOf.get(itemId) ?? [], senders, receivers,
        pairItems.has(itemId) ? pairs.filter(p => p.itemId === itemId) : undefined,
      ))
      continue
    }
    for (const r of itemRoutes(senders, receivers)) {
      routes.push({
        itemId,
        ...(r.from !== undefined ? { from: areas[r.from].id } : {}),
        ...(r.to !== undefined ? { to: areas[r.to].id } : {}),
        rate: r.rate,
      })
    }
  }
  const byRate = (x: { rate: number; itemId: string }, y: { rate: number; itemId: string }) =>
    y.rate - x.rate || (x.itemId < y.itemId ? -1 : x.itemId > y.itemId ? 1 : 0)
  for (const a of solved) {
    a.receives.sort(byRate)
    a.sends.sort(byRate)
  }
  return { areas: solved, routes }
}

/** The pieces of an area solve that depend on the rows only: one column per row, the classified system over them, and the notes on the rows. */
function buildAreaColumns(plan: SolverPlan, areas: SolverArea[], gameData: GameData): {
  gameRecipeNodes: GameRecipeNode[]
  columns: Column[]
  duplicateIds: Set<string>
  duplicateWarnings: SolverWarning[]
  noRecipeWarnings: SolverWarning[]
  system: ClassifiedSystem
} {
  const gameRecipeNodes = plan.nodes.filter(n => n.kind === 'game-recipe') as GameRecipeNode[]
  const nodeById = new Map(gameRecipeNodes.map(n => [n.id, n]))

  // One column per recipe and area: the first row of that recipe in the area is authoritative
  // (effects, pin, byproduct settings); later duplicates in the same area solve to zero.
  const columns: Column[] = []
  const duplicateIds = new Set<string>()
  const duplicateWarnings: SolverWarning[] = []
  areas.forEach((area, index) => {
    const counts = new Map<string, number>()
    for (const id of area.nodeIds) {
      const node = nodeById.get(id)
      if (!node) continue
      counts.set(node.recipeId, (counts.get(node.recipeId) ?? 0) + 1)
      if (counts.get(node.recipeId) === 1) {
        columns.push({
          id: `n${columns.length}`,
          node,
          recipe: gameData.recipes[node.recipeId],
          area: index,
          effects: computeNodeEffects(node, gameData),
        })
      } else {
        duplicateIds.add(node.id)
      }
    }
    for (const [recipeId, count] of counts) {
      if (count > 1) duplicateWarnings.push({ type: 'duplicate-recipe', recipeId, count, areaId: area.id })
    }
  })

  const goalsMap = new Map(plan.goals.map(g => [g.itemId, g.rate]))
  const system = buildColumnSystem(gameData, columns, goalsMap)

  // Warn for goal items with no producer row in the plan.
  const noRecipeWarnings: SolverWarning[] = []
  for (const goal of plan.goals) {
    const row = system.S.get(goal.itemId)
    const hasProducer = row !== undefined && [...row.values()].some(c => c > 0)
    if (!hasProducer) {
      noRecipeWarnings.push({ type: 'no-recipe', itemId: goal.itemId })
    }
  }

  for (const col of columns) {
    for (const [itemId, policy] of Object.entries(col.node.byproductPolicy)) {
      if (policy === 'discard') discardProduct(system, itemId, col.id)
    }
  }

  // A row is dedicated to the item it is built for, if it still makes it.
  for (const col of columns) {
    if (!col.recipe) continue
    const itemId = dedicatedProduct(col.node, col.recipe)
    if (itemId !== undefined && (system.S.get(itemId)?.get(col.id) ?? 0) > 0) col.dedicated = itemId
  }
  return { gameRecipeNodes, columns, duplicateIds, duplicateWarnings, noRecipeWarnings, system }
}

/** For each goal and intermediate, the indices of the areas (sorted) that have a column with a non-zero coefficient in its row. */
function touchingAreas(system: ClassifiedSystem, columns: Column[]): Map<string, number[]> {
  const touching = new Map<string, number[]>()
  const { goals, intermediates } = system.classification
  const areaOf = new Map(columns.map(c => [c.id, c.area]))
  for (const itemId of [...goals.keys(), ...intermediates]) {
    const set = new Set<number>()
    for (const [colId, coeff] of system.S.get(itemId) ?? []) if (coeff !== 0 && areaOf.has(colId)) set.add(areaOf.get(colId)!)
    touching.set(itemId, [...set].sort((a, b) => a - b))
  }
  return touching
}

/**
 * The intermediates two areas or more touch: the items whose LP rows carry a slack and a supply per area, and whose
 * routes into an area come from the LP (`AreaRoute.supplied`). Empty for a plan without areas.
 */
export function areaLPItems(plan: SolverPlan, gameData: GameData): Set<string> {
  if (!plan.areas) return new Set()
  const { columns, system } = buildAreaColumns(plan, plan.areas, gameData)
  const touching = touchingAreas(system, columns)
  return new Set([...touching].filter(([itemId, as]) => as.length >= 2 && system.classification.intermediates.has(itemId)).map(([itemId]) => itemId))
}

/**
 * `solveBlock` for a plan with areas. Same passes as the plain solve, with one column per row
 * instead of one per recipe, so a recipe can be built in every area; `areaFlows` and the
 * `area-shortfall` warning come on top. Each area applies its own rule for an item (see `areaRuleOf`).
 */
export function solveAreaBlock(
  plan: SolverPlan,
  areas: SolverArea[],
  gameData: GameData,
  supplyCaps: Map<string, number>,
): { result: SolverResult; received: Map<string, number> } {
  const { gameRecipeNodes, columns, duplicateIds, duplicateWarnings, noRecipeWarnings, system } = buildAreaColumns(plan, areas, gameData)

  const pinnedRates = new Map<string, number>()
  for (const col of columns) {
    if (col.node.pinnedRate !== undefined) pinnedRates.set(col.id, col.node.pinnedRate)
  }
  const bcColumns = new Set(columns.filter(c => c.node.byproductConsumer).map(c => c.id))
  const feederColumns = new Set(columns.filter(c => c.node.absorberFeeder && !c.node.byproductConsumer).map(c => c.id))

  // Ingredients of byproduct consumers (see solveBlock).
  const consumerIngredients = new Set<string>()
  for (const col of columns) {
    if (!col.node.byproductConsumer || !col.recipe) continue
    for (const ing of lockedIngredients(col.recipe, col.effects, col.node)) {
      consumerIngredients.add(ing.itemId)
    }
  }

  // Which items get a slack and a supply per area, and the rule the block-wide sets read for the others.
  const { areaItems, pairItems, effective, ruleOf, offOf, touching } = resolveAreaRules(plan, areas, columns, system)
  const effPlan: SolverPlan = effective === plan.sourceRules ? plan : { ...plan, sourceRules: effective }

  // The LP's locked set, its byproducts-first set and the set `coproductDrivenWarning` reads (see `sourcingSets`).
  // An area item's lock, cost and caps are set per area (`areaItemSpecs`), so the block-wide sets leave it out.
  const sets = sourcingSets(effPlan, consumerIngredients)
  const plainOf = (s: Set<string>) => (areaItems.size === 0 ? s : new Set([...s].filter(id => !areaItems.has(id))))
  const locked = plainOf(sets.locked)
  const byproductsFirst = plainOf(sets.byproductsFirst)
  // An area item cannot be imported when it is a byproduct consumer's ingredient or every area that touches it says Import off.
  const cannotImport = plainOf(sets.cannotImport)
  for (const itemId of areaItems) {
    if (consumerIngredients.has(itemId) || touching.get(itemId)!.every(a => ruleOf(a, itemId).importOff === true)) cannotImport.add(itemId)
  }

  const totalCaps = new Map([...supplyCaps].filter(([, cap]) => cap > FLOW_TOLERANCE))
  const plainCaps = areaItems.size === 0 ? totalCaps : new Map([...totalCaps].filter(([id]) => !areaItems.has(id)))

  // The passes are those of solveBlock.
  const pass1NoImport = plainCaps.size === 0
    ? locked
    : new Set([...locked].filter(itemId => !plainCaps.has(itemId)))
  const firstItems = new Set(
    itemsWithSourcing(effPlan, 'after-blocks').filter(
      itemId => plainCaps.has(itemId) && system.classification.intermediates.has(itemId),
    ),
  )
  const firstCaps = new Map([...firstItems].map(itemId => [itemId, plainCaps.get(itemId)!]))

  // Per area item and area, for one pass (`residual` undefined: pass 1). As `pass2Plan`, area by area:
  // an area whose rule is Receive it first has its supply in every pass, bounded by its own use; any other
  // area has it in pass 2 only, capped at its pass-1 residual. A locked area gets a slack in pass 1 when the
  // item is connected, and keeps it in pass 2 when the offer is below the item's residual over the areas
  // (connections first: when its own residual is left).
  const isFirst = (a: number, itemId: string) =>
    totalCaps.has(itemId) && ruleOf(a, itemId).makeHere === 'after-blocks' && system.classification.intermediates.has(itemId)
  const isLocked = (a: number, itemId: string) => {
    const rule = ruleOf(a, itemId)
    return consumerIngredients.has(itemId) || (rule.importOff === true && rule.makeHere !== 'off')
  }
  // A goal that is a pair item gets a spec too (no slack, no supply: only the flows between areas).
  const specItems = [...areaItems, ...[...pairItems].filter(id => !areaItems.has(id))]
  // An area on Don't make more here has the cheap slack, except for a byproduct consumer's ingredient (as the plain path's byproducts-first).
  const bfArea = (a: number, itemId: string) => ruleOf(a, itemId).makeHere === 'off' && !consumerIngredients.has(itemId)
  const lockKey = (itemId: string, a: number) => `${itemId}\u0000${a}`
  // `order`: the specs of the order's steps (connectionOrder.ts): as pass 1, plus a supply capped by the offer only in
  // every area that is not Receive it first nor Don't make more here, bounded by its own use and counted as received.
  // `order.relock`: the locked connected (item, area) pairs whose step-3 slack is 0 get no slack (the plain `__relock_`).
  // `order.refill`: the supply of a Don't make more here area, capped at the slack the fill left it (the plain path's refill).
  const areaItemSpecs = (
    residual?: Map<string, Map<number, number>>,
    order?: { relock: Set<string>; refill?: Map<string, Map<number, number>> },
  ): AreaItemSpec[] => specItems.map(itemId => {
    const cap = totalCaps.get(itemId)
    const res = residual?.get(itemId) ?? new Map<number, number>()
    let resTotal = 0
    for (const [a, r] of res) if (!isFirst(a, itemId)) resTotal += r
    return {
      itemId,
      offer: cap ?? 0,
      areas: touching.get(itemId)!.map((a): AreaItemArea => {
        const lockedA = isLocked(a, itemId)
        const first = isFirst(a, itemId)
        const r = res.get(a) ?? 0
        let slack: boolean
        if (!lockedA) slack = true
        else if (cap === undefined) slack = false
        else if (residual === undefined) slack = !order?.relock.has(lockKey(itemId, a))
        else slack = first ? r > FLOW_TOLERANCE : cap < resTotal - FLOW_TOLERANCE
        const orderSupply = order !== undefined && !first && cap !== undefined && !bfArea(a, itemId)
          && system.classification.intermediates.has(itemId)
        const refillCap = order?.refill?.get(itemId)?.get(a)
        const supplyCap = first ? Infinity
          : orderSupply ? Infinity
          : order !== undefined ? (cap !== undefined && refillCap !== undefined && refillCap > FLOW_TOLERANCE ? Math.min(cap, refillCap) : undefined)
          : residual !== undefined && cap !== undefined && r > FLOW_TOLERANCE ? Math.min(cap, r) : undefined
        return {
          area: a,
          ...(slack ? { slackCost: bfArea(a, itemId) ? BYPRODUCTS_FIRST_SLACK_COST : BIG_M } : {}),
          ...(supplyCap !== undefined ? { supplyCap } : {}),
          supUse: first || orderSupply || (order !== undefined && supplyCap !== undefined),
          ...(orderSupply ? { received: true } : {}),
          off: pairItems.has(itemId) ? offOf(a, itemId) : new Set(),
        }
      }),
      pairs: pairItems.has(itemId),
    }
  })

  let lp = solveAreaLP(system, columns, pinnedRates, bcColumns, feederColumns, pass1NoImport, firstCaps, firstItems, byproductsFirst, areaItemSpecs())

  /**
   * The order of connectionOrder.ts on the area LP: when the passes end with an import (a slack at BIG_M, per area for an
   * area item) while a default-rule connected intermediate has offer to spare, measure the least import with every such
   * supply capped by the offer, then the least received at that import, then solve both stages with the two sums
   * bounded. As on the plain path, a Don't make more here item or area has no supply in steps 2 and 3 and gets it back in
   * a refill of the fill (capped at the slack the fill left it), and a locked connected item (plain, or per area) whose
   * step-3 slack is 0 is locked again in the fill. Undefined: today's result stands. The retry and the "least import is a
   * gain" test are shared with the plain path (connectionOrder.ts); the gate and the steps stay two copies, because
   * each solves a different model (one mutable LP there, `solveAreaLP`'s two stages here).
   */
  const areaConnectionOrder = (today: AreaLPResult): AreaLPResult | undefined => {
    if (!today.feasible || today.shortfall.size > 0 || today.warnings.some(w => w.type === 'infeasible-pins')) return undefined
    const tol = (itemId: string) => surplusTolerance(itemGrossFlow(system.S.get(itemId), today.throughput))
    // Counted as the LP's `__imp` sum counts: every slack at BIG_M. An area on Don't make more here has the cheap slack,
    // except for a byproduct consumer's ingredient, whose slack stays at BIG_M. An item's slacks over its areas add up
    // before they are compared with its noise floor (as `areaPass2` does).
    const imported = new Map<string, number>()
    for (const [itemId, rate] of today.slack) {
      if (areaItems.has(itemId) || byproductsFirst.has(itemId)) continue
      imported.set(itemId, (imported.get(itemId) ?? 0) + rate)
    }
    for (const o of today.outside) {
      if (bfArea(o.area, o.itemId)) continue
      imported.set(o.itemId, (imported.get(o.itemId) ?? 0) + o.slack)
    }
    let todayImport = 0
    let imports = false
    for (const [itemId, rate] of imported) {
      todayImport += rate
      if (rate > tol(itemId)) imports = true
    }
    if (!imports) return undefined
    const intermediate = (itemId: string) => system.classification.intermediates.has(itemId)
    const plainDefaults = new Set([...plainCaps.keys()].filter(itemId =>
      intermediate(itemId) && !firstItems.has(itemId) && !byproductsFirst.has(itemId)))
    const spare = (itemId: string) => totalCaps.get(itemId)! - (today.supply.get(itemId) ?? 0) > FLOW_TOLERANCE
    const areaDefault = (itemId: string) => areaItems.has(itemId) && totalCaps.has(itemId) && intermediate(itemId)
      && touching.get(itemId)!.some(a => !isFirst(a, itemId) && !bfArea(a, itemId))
    if (![...plainDefaults].some(spare) && ![...areaItems].some(itemId => areaDefault(itemId) && spare(itemId))) return undefined

    const caps = new Map([...firstCaps, ...[...plainDefaults].map(itemId => [itemId, plainCaps.get(itemId)!] as const)])
    const specs = areaItemSpecs(undefined, { relock: new Set() })
    const step = (
      order: AreaOrder, noImport: Set<string>, stepCaps: Map<string, number>, connectionsFirst: Set<string>, stepSpecs: AreaItemSpec[],
    ) => solveAreaLP(system, columns, pinnedRates, bcColumns, feederColumns, noImport, stepCaps, connectionsFirst, byproductsFirst, stepSpecs, order)
    const base = { defaults: plainDefaults, byproductsFirst, lockedTemperatures: today.lockedTemperatures }
    const defaultsFirst = new Set([...firstItems, ...plainDefaults])
    const step2 = step({ ...base, measure: '__imp' }, pass1NoImport, caps, defaultsFirst, specs)
    if (!step2.feasible || step2.measured === undefined) return undefined
    if (!improvesImport(step2.measured, todayImport)) return undefined
    // The bounds count the variables their sum runs over (the LP reports it), and a tight bound that comes back
    // infeasible is retried once looser, as on the plain path (boundedStep).
    const step3 = boundedStep(looser =>
      step({ ...base, measure: '__rec', importCap: boundOf(step2.measured!, step2.measuredTerms!, looser) }, pass1NoImport, caps, defaultsFirst, specs))
    if (!step3 || step3.measured === undefined) return undefined
    // A locked connected item (plain, or per area) that step 3 left no slack is locked again in the fill, as `pass2Plan` does.
    const noImport = new Set([...pass1NoImport, ...[...locked].filter(id => plainCaps.has(id) && (step3.slack.get(id) ?? 0) <= FLOW_TOLERANCE)])
    const relock = new Set<string>()
    for (const o of step3.outside) {
      if (areaItems.has(o.itemId) && totalCaps.has(o.itemId) && isLocked(o.area, o.itemId) && o.slack <= FLOW_TOLERANCE) relock.add(lockKey(o.itemId, o.area))
    }
    const fill = (fillCaps: Map<string, number>, connectionsFirst: Set<string>, fillSpecs: AreaItemSpec[]) => boundedStep(looser => step({
      ...base,
      importCap: boundOf(step2.measured!, step2.measuredTerms!, looser),
      receivedCap: boundOf(step3.measured!, step3.measuredTerms!, looser),
    }, noImport, fillCaps, connectionsFirst, fillSpecs))
    const fill1 = fill(caps, defaultsFirst, areaItemSpecs(undefined, { relock }))
    if (!fill1) return undefined
    // A Don't make more here item or area has no supply in steps 2 and 3, so its slack is arbitrary there: the fill measured
    // its residual with no supply, and its supply now fills that residual (min(offer, residual), as `pass2Plan`).
    const refillPlain = new Map<string, number>()
    for (const [itemId, cap] of plainCaps) {
      const r = fill1.slack.get(itemId) ?? 0
      if (intermediate(itemId) && byproductsFirst.has(itemId) && r > FLOW_TOLERANCE) refillPlain.set(itemId, Math.min(cap, r))
    }
    const refillAreas = new Map<string, Map<number, number>>()
    for (const o of fill1.outside) {
      if (!bfArea(o.area, o.itemId) || !totalCaps.has(o.itemId) || !intermediate(o.itemId) || o.slack <= FLOW_TOLERANCE) continue
      const m = refillAreas.get(o.itemId) ?? new Map<number, number>()
      m.set(o.area, o.slack)
      refillAreas.set(o.itemId, m)
    }
    if (refillPlain.size === 0 && refillAreas.size === 0) return fill1
    return fill(
      new Map([...caps, ...refillPlain]), new Set([...defaultsFirst, ...refillPlain.keys()]), areaItemSpecs(undefined, { relock, refill: refillAreas }),
    )
  }

  const pass2 = pass2Plan({
    totalCaps: plainCaps, intermediates: system.classification.intermediates, firstItems, locked,
    slack: lp.slack, S: system.S, throughput: lp.throughput,
  })
  // An area item runs pass 2 when the residuals of its areas that are not connections-first add up to more than the item's noise
  // (as `pass2Plan`, on the item's total).
  const residual = new Map<string, Map<number, number>>()
  const openResidual = new Map<string, number>()
  for (const o of lp.outside) {
    if (o.slack <= FLOW_TOLERANCE) continue
    const m = residual.get(o.itemId) ?? new Map<number, number>()
    m.set(o.area, o.slack)
    residual.set(o.itemId, m)
    if (totalCaps.has(o.itemId) && !isFirst(o.area, o.itemId)) openResidual.set(o.itemId, (openResidual.get(o.itemId) ?? 0) + o.slack)
  }
  const areaPass2 = [...openResidual].some(([itemId, r]) => r > surplusTolerance(itemGrossFlow(system.S.get(itemId), lp.throughput)))
  if (pass2.run || areaPass2) {
    lp = solveAreaLP(
      system, columns, pinnedRates, bcColumns, feederColumns, pass2.noImport,
      new Map([...firstCaps, ...pass2.caps]), firstItems, byproductsFirst, areaItemSpecs(residual),
    )
  }

  lp = areaConnectionOrder(lp) ?? lp

  const { throughput, warnings } = lp
  const columnOf = new Map(columns.map(c => [c.node.id, c]))
  const nodes: SolvedNode[] = []
  for (const planNode of gameRecipeNodes) {
    const col = columnOf.get(planNode.id)
    if (!col) {
      if (duplicateIds.has(planNode.id)) nodes.push(zeroNode(planNode.id))
      continue
    }
    if (!col.recipe) continue
    nodes.push(solvedNodeOf(
      planNode, col.recipe, throughput.get(col.id) ?? 0, col.effects, col.effects.productivityBonus, gameData,
      isFeeder(lp.absorbers, bcColumns, col.id),
    ))
  }

  const recipeOfCol = new Map(columns.map(c => [c.id, c.node.recipeId]))
  const mainItemOfCol = new Map<string, string>()
  for (const c of columns) {
    const main = c.recipe ? explicitMainProduct(c.node, c.recipe) : undefined
    if (main !== undefined) mainItemOfCol.set(c.id, main)
  }
  const { overconstrained, itemSurplus, itemGross, unsatisfied, received } = blockDiagnostics({
    goals: plan.goals, system, throughput, slack: lp.slack, supply: lp.supply, nodes, totalCaps,
  })
  if (overconstrained) warnings.push(overconstrained)
  // Pins that cannot be met make the flows meaningless for this check.
  const coproductDriven = warnings.some(w => w.type === 'infeasible-pins') ? undefined : coproductDrivenWarning({
    goals: plan.goals, system, throughput, slack: lp.slack, itemSurplus, itemGross,
    fixed: new Set([...pinnedRates.keys(), ...lp.absorbers.absorberOnly]), noImportItems: cannotImport, recipeOf: id => recipeOfCol.get(id) ?? id,
    mainItemOf: id => mainItemOfCol.get(id),
  })
  if (coproductDriven) warnings.push(coproductDriven)

  const shortfalls = lp.dedicatedIn
    .filter(d => d.rate > AREA_SHORTFALL_TOLERANCE)
    .map(d => ({ areaId: areas[d.area].id, itemId: d.itemId, rate: d.rate }))
  if (shortfalls.length > 0) warnings.push({ type: 'area-shortfall', shortfalls })

  // An area with no supplier left for an item that cannot be imported and has no row that makes it: its rows that use the
  // item cannot run. Only said when the plan is feasible and a goal falls short; infeasible pins name their own conflict.
  const cutOffAreas = (): { areaId: string; itemId: string }[] => {
    // Items the short goals need: the goals, then the ingredients of every row that makes a needed item. An area is cut off
    // only when one of its rows using the item makes something needed, so a short goal elsewhere does not blame it.
    const neededItems = new Set(lp.shortfall.keys())
    for (let grew = true; grew;) {
      grew = false
      for (const col of columns) {
        if (![...neededItems].some(id => (system.S.get(id)?.get(col.id) ?? 0) > 0)) continue
        for (const [id, m] of system.S) {
          if ((m.get(col.id) ?? 0) < 0 && !neededItems.has(id)) {
            neededItems.add(id)
            grew = true
          }
        }
      }
    }
    const needed = (area: number, itemId: string) => columns.some(col =>
      col.area === area && !lp.absorbers.absorberOnly.has(col.id) && (system.S.get(itemId)?.get(col.id) ?? 0) < 0 &&
      [...neededItems].some(id => (system.S.get(id)?.get(col.id) ?? 0) > 0))
    const cut: { area: number; itemId: string }[] = []
    for (const itemId of pairItems) {
      if (!system.classification.intermediates.has(itemId) || totalCaps.has(itemId)) continue
      const producers = new Set<number>()
      for (const col of columns) if ((system.S.get(itemId)?.get(col.id) ?? 0) > 0) producers.add(col.area)
      if (producers.size === 0) continue
      for (const a of touching.get(itemId)!) {
        // Cut off by the area's own rule only: a byproduct consumer's ingredient is locked too, and a switch there is the way
        // to reserve a byproduct.
        const rule = ruleOf(a, itemId)
        if (producers.has(a) || consumerIngredients.has(itemId) || rule.importOff !== true || rule.makeHere === 'off') continue
        if (!needed(a, itemId)) continue
        const off = offOf(a, itemId)
        if ([...producers].every(b => off.has(b))) cut.push({ area: a, itemId })
      }
    }
    return cut
      .sort((x, y) => x.area - y.area || (x.itemId < y.itemId ? -1 : x.itemId > y.itemId ? 1 : 0))
      .map(c => ({ areaId: areas[c.area].id, itemId: c.itemId }))
  }
  const cut = lp.feasible && lp.shortfall.size > 0 ? cutOffAreas() : []
  if (cut.length > 0) warnings.push({ type: 'area-cut-off', cutOffs: cut })

  const flows = areaFlows(system, columns, throughput, areas, lp.dedicatedIn, lp.outside, areaItems, lp.feasible ? pairItems : new Set(), lp.pairs)
  return {
    result: {
      nodes,
      unsatisfied,
      warnings: [...duplicateWarnings, ...noRecipeWarnings, ...warnings],
      areas: flows.areas,
      areaRoutes: flows.routes,
    },
    received,
  }
}
