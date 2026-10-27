import solver, { type SolveResult } from 'javascript-lp-solver'
import type {
  GameData,
  GameRecipeNode,
  Recipe,
  SolvedArea,
  SolvedNode,
  SolverResult,
  SolverWarning,
  SubPlan,
} from '../data/types'
import { buildClassifiedSystem, effectiveProductAmount, type ClassifiedSystem } from './build'
import { BIG_M, buildLPModel, readLPResult, type LPModel, type LPResult } from './solve'
import { computeNodeEffects, type NodeEffects } from './effects'
import {
  FLOW_TOLERANCE,
  blockDiagnostics,
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
  const { classification } = buildClassifiedSystem(gameData, [...new Set(columns.map(c => c.node.recipeId))], goalsMap)
  const S = new Map<string, Map<string, number>>()
  function addCoeff(itemId: string, columnId: string, delta: number) {
    if (!S.has(itemId)) S.set(itemId, new Map())
    S.get(itemId)!.set(columnId, (S.get(itemId)!.get(columnId) ?? 0) + delta)
  }
  for (const col of columns) {
    const recipe = col.recipe
    if (!recipe) continue
    for (const prod of recipe.products) {
      const amount = effectiveProductAmount(
        prod.amount ?? 0,
        prod.probability ?? 1,
        prod.ignoredByProductivity ?? 0,
        col.effects.productivityBonus,
      )
      if (amount > 0) addCoeff(prod.itemId, col.id, amount)
    }
    for (const ing of recipe.ingredients) {
      if (ing.amount > 0) addCoeff(ing.itemId, col.id, -ing.amount)
    }
  }
  return { S, recipes: columns.map(c => c.id), classification }
}

export type AreaLPResult = LPResult & {
  /** what areas with their own row for an item still take from other areas' dedicated rows */
  dedicatedIn: { area: number; itemId: string; rate: number }[]
}

/**
 * The elastic LP of `buildLPModel` plus, for every item that columns of two areas or more touch,
 * flows between areas (see spec/solver.md, "Areas"). An area balances each such item:
 *   Σ S x + din + oin − dout − oout = 0
 * where `d…` flows come from or go to dedicated rows (made for that item) and `o…` flows from
 * other rows. Pools bound what is taken by what is sent (plus slack and supply, for `o…`).
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
  noImportItems: Set<string>,
  supplyCaps: Map<string, number>,
  connectionsFirst: Set<string>,
): AreaLPResult {
  const { S, classification } = system
  const base = buildLPModel(system, pinnedRates, bcColumns, noImportItems, supplyCaps, connectionsFirst)
  const { constraints, variables } = base
  const colVar = new Map(columns.map(c => [c.id, base.recipeToVar.get(c.id)!]))

  // Every variable carries both stage objectives; the library ignores attributes that are neither
  // a constraint nor the optimised one.
  for (const v of Object.values(variables)) v.__s2 = v.__obj__ ?? 0
  for (const name of base.itemToSlack.values()) variables[name].__s1 = BIG_M

  const penalised: { name: string; area: number; itemId: string }[] = []
  const rankOf = (area: number) => SHIP_COST * (1 + RANK_STEP * area)
  let k = 0
  let j = 0
  for (const itemId of [...classification.goals.keys(), ...classification.intermediates]) {
    const rowS = S.get(itemId)
    if (!rowS) continue
    const byArea = new Map<number, { col: Column; coeff: number }[]>()
    for (const col of columns) {
      const coeff = rowS.get(col.id) ?? 0
      if (coeff === 0) continue
      const list = byArea.get(col.area) ?? []
      list.push({ col, coeff })
      byArea.set(col.area, list)
    }
    if (byArea.size < 2) continue

    const dpool = `dpool${j}`
    const opool = `opool${j++}`
    constraints[dpool] = { max: 0 }
    constraints[opool] = { max: 0 }
    const slackName = base.itemToSlack.get(itemId)
    const supplyName = base.itemToSupply.get(itemId)
    if (slackName) variables[slackName][opool] = -1
    if (supplyName) variables[supplyName][opool] = -1

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

  // `local` bounds the dedicated imports in total.
  const run = (optimize: string, local?: number): SolveResult => {
    const cs = structuredClone(constraints)
    const vs = structuredClone(variables)
    if (local !== undefined) {
      cs.local = { max: local }
      for (const p of penalised) vs[p.name].local = 1
    }
    return solver.Solve({ optimize, opType: 'min', constraints: cs, variables: vs }) as SolveResult
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
    // A failed solve still reports variable values; they say nothing about imports.
    const dedicatedIn = result.feasible !== true ? [] : penalised.map(p => ({
      area: p.area,
      itemId: p.itemId,
      rate: typeof result[p.name] === 'number' ? Math.max(0, result[p.name] as number) : 0,
    }))
    return { ...lp, warnings, dedicatedIn }
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

/** Items/min each area receives and sends, from the net production of its rows. */
function areaFlows(
  system: ClassifiedSystem,
  columns: Column[],
  throughput: Map<string, number>,
  areas: SolverArea[],
): SolvedArea[] {
  const areaOf = new Map(columns.map(c => [c.id, c.area]))
  const solved: SolvedArea[] = areas.map(a => ({ areaId: a.id, receives: [], sends: [] }))
  for (const [itemId, rowS] of system.S) {
    const net = areas.map(() => 0)
    const produced = areas.map(() => 0)
    const consumed = areas.map(() => 0)
    let blockNet = 0
    let blockProduced = 0
    let blockConsumed = 0
    for (const [colId, coeff] of rowS) {
      const flow = coeff * (throughput.get(colId) ?? 0)
      const a = areaOf.get(colId)!
      net[a] += flow
      blockNet += flow
      if (flow > 0) {
        produced[a] += flow
        blockProduced += flow
      } else {
        consumed[a] -= flow
        blockConsumed -= flow
      }
    }
    const blockTol = surplusTolerance(Math.max(blockProduced, blockConsumed))
    for (let a = 0; a < areas.length; a++) {
      const tol = surplusTolerance(Math.max(produced[a], consumed[a]))
      if (net[a] > tol) solved[a].sends.push({ itemId, rate: net[a], boundary: blockNet > blockTol })
      else if (net[a] < -tol) solved[a].receives.push({ itemId, rate: -net[a], boundary: blockNet < -blockTol })
    }
  }
  const byRate = (x: { rate: number; itemId: string }, y: { rate: number; itemId: string }) =>
    y.rate - x.rate || (x.itemId < y.itemId ? -1 : x.itemId > y.itemId ? 1 : 0)
  for (const a of solved) {
    a.receives.sort(byRate)
    a.sends.sort(byRate)
  }
  return solved
}

/**
 * `solveBlock` for a plan with areas. Same passes as the plain solve, with one column per row
 * instead of one per recipe, so a recipe can be built in every area; `areaFlows` and the
 * `area-shortfall` warning come on top.
 */
export function solveAreaBlock(
  plan: SolverPlan,
  areas: SolverArea[],
  gameData: GameData,
  supplyCaps: Map<string, number>,
): { result: SolverResult; received: Map<string, number> } {
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
      if (policy === 'discard') {
        const row = system.S.get(itemId)
        if (row) {
          const coeff = row.get(col.id) ?? 0
          if (coeff > 0) row.set(col.id, 0)
        }
      }
    }
  }

  // A row is dedicated to the item it is built for, if it still makes it.
  for (const col of columns) {
    if (!col.recipe) continue
    const itemId = dedicatedProduct(col.node, col.recipe)
    if (itemId !== undefined && (system.S.get(itemId)?.get(col.id) ?? 0) > 0) col.dedicated = itemId
  }

  const pinnedRates = new Map<string, number>()
  for (const col of columns) {
    if (col.node.pinnedRate !== undefined) pinnedRates.set(col.id, col.node.pinnedRate)
  }
  const bcColumns = new Set(columns.filter(c => c.node.byproductConsumer).map(c => c.id))

  // No-import set: user's explicit list, plus byproduct consumers' ingredients (see solveBlock).
  const noImportItems = new Set(plan.noImportItems ?? [])
  for (const col of columns) {
    if (!col.node.byproductConsumer || !col.recipe) continue
    for (const ing of col.recipe.ingredients) {
      noImportItems.add(ing.itemId)
    }
  }

  const totalCaps = new Map([...supplyCaps].filter(([, cap]) => cap > FLOW_TOLERANCE))

  // The passes are those of solveBlock.
  const pass1NoImport = totalCaps.size === 0
    ? noImportItems
    : new Set([...noImportItems].filter(itemId => !totalCaps.has(itemId)))
  const firstItems = new Set(
    (plan.connectionsFirstItems ?? []).filter(
      itemId => totalCaps.has(itemId) && system.classification.intermediates.has(itemId),
    ),
  )
  const firstCaps = new Map([...firstItems].map(itemId => [itemId, totalCaps.get(itemId)!]))
  let lp = solveAreaLP(system, columns, pinnedRates, bcColumns, pass1NoImport, firstCaps, firstItems)

  const pass2Caps = new Map<string, number>()
  const pass2NoImport = new Set(noImportItems)
  for (const [itemId, cap] of totalCaps) {
    if (!system.classification.intermediates.has(itemId)) continue
    const residual = lp.slack.get(itemId) ?? 0
    if (firstItems.has(itemId)) {
      if (residual > FLOW_TOLERANCE) pass2NoImport.delete(itemId)
      continue
    }
    if (residual > FLOW_TOLERANCE) {
      pass2Caps.set(itemId, Math.min(cap, residual))
      if (cap < residual - FLOW_TOLERANCE) pass2NoImport.delete(itemId)
    }
  }
  if (pass2Caps.size > 0) {
    lp = solveAreaLP(
      system, columns, pinnedRates, bcColumns, pass2NoImport,
      new Map([...firstCaps, ...pass2Caps]), firstItems,
    )
  }

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
    ))
  }

  const { overconstrained, unsatisfied, received } = blockDiagnostics({
    goals: plan.goals, system, throughput, slack: lp.slack, supply: lp.supply, nodes, totalCaps,
  })
  if (overconstrained) warnings.push(overconstrained)

  const shortfalls = lp.dedicatedIn
    .filter(d => d.rate > AREA_SHORTFALL_TOLERANCE)
    .map(d => ({ areaId: areas[d.area].id, itemId: d.itemId, rate: d.rate }))
  if (shortfalls.length > 0) warnings.push({ type: 'area-shortfall', shortfalls })

  return {
    result: {
      nodes,
      unsatisfied,
      warnings: [...duplicateWarnings, ...noRecipeWarnings, ...warnings],
      areas: areaFlows(system, columns, throughput, areas),
    },
    received,
  }
}
