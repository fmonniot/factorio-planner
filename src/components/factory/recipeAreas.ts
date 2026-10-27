import type { GameData, GameRecipeNode, SolvedArea, SolvedNode, SubPlan } from '../../data/types'
import { areaRecipeIds, blockAreas, dedicatedProduct, subPlanAreaIds, subPlanCopyBlocker } from '../../solver/areas'
import { areaName } from './areaRows'

// ---------------------------------------------------------------------------
// Which rows build which recipe in which area: what the table's area actions
// (badge, Build also in…, Go to row in…, the picker's same-area check) read.
// ---------------------------------------------------------------------------

/** Consumption (items/min) at or below this does not make an area "use" an item. */
const USE_TOLERANCE = 1e-6

export interface RecipeRowRef {
  node: GameRecipeNode
  areaId: string
  subPlanId: string
}

export interface RecipeAreaIndex {
  /** false when no sub-factory is a separate area */
  hasAreas: boolean
  /** table order of the areas (the root is 0); just the root without areas */
  areaRank: Map<string, number>
  areaOfSubPlan: Map<string, string>
  rowById: Map<string, RecipeRowRef>
  /** per recipe, in tree order (a plan's own rows, then its sub-plans'), stable-sorted by area rank */
  rowsByRecipe: Map<string, RecipeRowRef[]>
}

/** What a row needs to know about the areas of its block. */
export interface AreaView {
  index: RecipeAreaIndex
  solvedMap: ReadonlyMap<string, SolvedNode>
  solvedAreas: SolvedArea[] | undefined
}

export function indexRecipeAreas(root: SubPlan): RecipeAreaIndex {
  const areas = blockAreas(root)
  const areaRank = new Map((areas ?? [{ id: root.id }]).map((a, i) => [a.id, i]))
  const areaOfSubPlan = subPlanAreaIds(root)
  const rowById = new Map<string, RecipeRowRef>()
  const rowsByRecipe = new Map<string, RecipeRowRef[]>()
  function visit(plan: SubPlan): void {
    const areaId = areaOfSubPlan.get(plan.id) ?? root.id
    for (const node of plan.nodes) {
      if (node.kind !== 'game-recipe') continue
      const ref: RecipeRowRef = { node, areaId, subPlanId: plan.id }
      rowById.set(node.id, ref)
      const list = rowsByRecipe.get(node.recipeId) ?? []
      list.push(ref)
      rowsByRecipe.set(node.recipeId, list)
    }
    for (const sp of plan.subPlans) visit(sp)
  }
  visit(root)
  const rank = (ref: RecipeRowRef) => areaRank.get(ref.areaId) ?? 0
  for (const list of rowsByRecipe.values()) list.sort((a, b) => rank(a) - rank(b))
  return { hasAreas: areas !== undefined, areaRank, areaOfSubPlan, rowById, rowsByRecipe }
}

/** The areas that have a row of the recipe, in table order. */
export function recipeAreaIds(index: RecipeAreaIndex, recipeId: string): string[] {
  return [...new Set((index.rowsByRecipe.get(recipeId) ?? []).map(r => r.areaId))]
}

/** How many rows of the recipe the block has, in any area. */
export function countRecipeRows(root: SubPlan, recipeId: string): number {
  let count = 0
  function visit(plan: SubPlan): void {
    for (const n of plan.nodes) if (n.kind === 'game-recipe' && n.recipeId === recipeId) count++
    for (const sp of plan.subPlans) visit(sp)
  }
  visit(root)
  return count
}

export interface AreaSplit {
  areaId: string
  name: string
  buildings: number
}

export interface MultiAreaSummary {
  areaCount: number
  /** how many rows of the recipe the summary covers (more than areaCount when an area has several) */
  rowCount: number
  buildings: number
  exact: number
  /** the row's own area first, then the others in table order */
  split: AreaSplit[]
}

/**
 * The buildings a recipe takes in every area that builds it; a row with no solve result counts as 0.
 * The total is the sum of each row's whole machines (R4), not the ceiling of the exact sum.
 * `hereAreaId` undefined names every area, in table order.
 */
export function multiAreaSummary(
  index: RecipeAreaIndex,
  root: SubPlan,
  recipeId: string,
  hereAreaId: string | undefined,
  solvedMap: ReadonlyMap<string, SolvedNode>,
  /** the rows to count; default every row of the recipe in the block */
  rows?: RecipeRowRef[],
): MultiAreaSummary {
  const buildings = new Map<string, number>()
  let exact = 0
  const refs = rows ?? index.rowsByRecipe.get(recipeId) ?? []
  for (const ref of refs) {
    const solved = solvedMap.get(ref.node.id)
    buildings.set(ref.areaId, (buildings.get(ref.areaId) ?? 0) + (solved?.machineCountCeil ?? 0))
    exact += solved?.machineCountExact ?? 0
  }
  const areaIds = [...new Set(refs.map(r => r.areaId))]
  const ordered = [...areaIds.filter(id => id === hereAreaId), ...areaIds.filter(id => id !== hereAreaId)]
  const split = ordered.map(areaId => ({ areaId, name: areaName(root, areaId), buildings: buildings.get(areaId) ?? 0 }))
  return {
    areaCount: areaIds.length,
    rowCount: refs.length,
    buildings: split.reduce((sum, s) => sum + s.buildings, 0),
    exact,
    split,
  }
}

/** "Electrolysis: 15 buildings (13.6 exact) in 3 areas: 5 here, 5 Plastics, 5 Rocket fuel"; without a row's own area, "5 Top level" and so on. */
export function multiAreaTitle(recipeName: string, s: MultiAreaSummary, hereAreaId: string | undefined): string {
  const b = s.buildings
  const parts = s.split.map(a => (a.areaId === hereAreaId ? `${a.buildings} here` : `${a.buildings} ${a.name}`))
  const n = s.areaCount
  return `${recipeName}: ${b} building${b === 1 ? '' : 's'} (${s.exact.toFixed(1)} exact) in ${n} area${n === 1 ? '' : 's'}: ${parts.join(', ')}`
}

export interface RecipeGroup {
  recipeId: string
  /** in table order of their areas, root first */
  rows: RecipeRowRef[]
}

/**
 * The rows of the by-recipe view: one group per recipe, in the order the table shows their first
 * row. Only rows the tree shows are listed (a sub-plan without a handle has none).
 */
export function recipeGroups(root: SubPlan, index: RecipeAreaIndex): RecipeGroup[] {
  const groups = new Map<string, RecipeRowRef[]>()
  function visit(plan: SubPlan): void {
    const areaId = index.areaOfSubPlan.get(plan.id) ?? root.id
    for (const node of plan.nodes) {
      if (node.kind === 'game-recipe') {
        const list = groups.get(node.recipeId) ?? []
        list.push({ node, areaId, subPlanId: plan.id })
        groups.set(node.recipeId, list)
      } else {
        const child = plan.subPlans.find(sp => sp.id === node.subPlanId)
        if (child) visit(child)
      }
    }
  }
  visit(root)
  const rank = (ref: RecipeRowRef) => index.areaRank.get(ref.areaId) ?? 0
  return [...groups].map(([recipeId, rows]) => ({ recipeId, rows: rows.sort((a, b) => rank(a) - rank(b)) }))
}

export interface RecipeGroupRates {
  products: [string, number][]
  byproducts: [string, number][]
  inputs: [string, number][]
  powerKw: number
}

/** What a recipe line shows: the rows' solved rates added up. An output is a product when any row is built for it. */
export function recipeGroupRates(
  rows: RecipeRowRef[],
  recipe: GameData['recipes'][string],
  solvedMap: ReadonlyMap<string, SolvedNode>,
): RecipeGroupRates {
  const outputs = new Map<string, number>()
  const inputs = new Map<string, number>()
  let powerKw = 0
  const primary = new Set<string>()
  for (const row of rows) {
    const primaryId = dedicatedProduct(row.node, recipe)
    if (primaryId !== undefined) primary.add(primaryId)
    const solved = solvedMap.get(row.node.id)
    if (!solved) continue
    for (const [id, rate] of Object.entries(solved.outputRates)) outputs.set(id, (outputs.get(id) ?? 0) + rate)
    for (const [id, rate] of Object.entries(solved.inputRates)) inputs.set(id, (inputs.get(id) ?? 0) + rate)
    powerKw += solved.powerKw
  }
  const out = [...outputs]
  return {
    products: out.filter(([id]) => primary.has(id)),
    byproducts: out.filter(([id]) => !primary.has(id)),
    inputs: [...inputs],
    powerKw,
  }
}

export interface BuildAlsoInOption {
  areaId: string
  name: string
  /** items/min of the item the area's rows consume */
  rate: number
}

/**
 * The areas where row `nodeId` could also be built: those whose rows consume `itemId` and have no
 * row of the same recipe yet, with how much they consume. Empty without areas.
 */
export function buildAlsoInOptions(
  index: RecipeAreaIndex,
  root: SubPlan,
  nodeId: string,
  itemId: string | undefined,
  solvedMap: ReadonlyMap<string, SolvedNode>,
): BuildAlsoInOption[] {
  const row = index.rowById.get(nodeId)
  if (!index.hasAreas || itemId === undefined || !row) return []
  const skip = new Set([row.areaId, ...recipeAreaIds(index, row.node.recipeId)])
  const used = new Map<string, number>()
  for (const ref of index.rowById.values()) {
    const rate = solvedMap.get(ref.node.id)?.inputRates[itemId] ?? 0
    used.set(ref.areaId, (used.get(ref.areaId) ?? 0) + rate)
  }
  return [...index.areaRank.entries()]
    .sort((a, b) => a[1] - b[1])
    .filter(([areaId]) => !skip.has(areaId) && (used.get(areaId) ?? 0) > USE_TOLERANCE)
    .map(([areaId]) => ({ areaId, name: areaName(root, areaId), rate: used.get(areaId)! }))
}

export interface DuplicateToOption {
  areaId: string
  name: string
  /** Why the copy cannot go into this area (the option is then shown disabled). */
  disabledReason?: string
}

/** "Already has a row of X", "… rows of X and Y", "… X, Y and Z", "… X, Y, Z and N more". */
export function copyConflictTitle(names: string[]): string {
  if (names.length === 1) return `Already has a row of ${names[0]}`
  if (names.length <= 3) return `Already has rows of ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `Already has rows of ${names.slice(0, 3).join(', ')} and ${names.length - 3} more`
}

/** Every area of the block in table order as a target for copying sub-factory `subPlanId`; empty without areas or for an unknown sub-factory. */
export function duplicateToOptions(
  index: RecipeAreaIndex,
  root: SubPlan,
  subPlanId: string,
  recipeName: (recipeId: string) => string,
): DuplicateToOption[] {
  if (!index.hasAreas || !index.areaOfSubPlan.has(subPlanId)) return []
  const options: DuplicateToOption[] = []
  for (const [areaId] of [...index.areaRank.entries()].sort((a, b) => a[1] - b[1])) {
    const blocker = subPlanCopyBlocker(root, subPlanId, areaId)
    if (blocker?.reason === 'invalid') continue
    const name = areaName(root, areaId)
    if (!blocker) options.push({ areaId, name })
    else if (blocker.reason === 'inside') options.push({ areaId, name, disabledReason: 'Cannot copy a subfactory into itself' })
    else options.push({ areaId, name, disabledReason: copyConflictTitle(blocker.recipeIds.map(recipeName)) })
  }
  return options
}

export interface GoToRowOption {
  nodeId: string
  areaId: string
  name: string
  buildings: number
}

/** The rows of the same recipe in the other areas, in table order; rows that cannot be revealed (no handle above them) are left out. */
export function goToRowOptions(
  index: RecipeAreaIndex,
  root: SubPlan,
  nodeId: string,
  solvedMap: ReadonlyMap<string, SolvedNode>,
): GoToRowOption[] {
  const row = index.rowById.get(nodeId)
  if (!row) return []
  return (index.rowsByRecipe.get(row.node.recipeId) ?? [])
    .filter(r => r.areaId !== row.areaId && ancestorHandleIds(root, r.node.id) !== undefined)
    .map(r => ({
      nodeId: r.node.id,
      areaId: r.areaId,
      name: areaName(root, r.areaId),
      buildings: solvedMap.get(r.node.id)?.machineCountCeil ?? 0,
    }))
}

/**
 * The sub-factory handles to expand, outermost first, to show row `nodeId`: empty for a root row,
 * undefined when the row is not in the tree or sits in a sub-plan without a handle.
 */
export function ancestorHandleIds(root: SubPlan, nodeId: string): string[] | undefined {
  if (root.nodes.some(n => n.id === nodeId)) return []
  for (const handle of root.nodes) {
    if (handle.kind !== 'subplan') continue
    const child = root.subPlans.find(sp => sp.id === handle.subPlanId)
    const path = child && ancestorHandleIds(child, nodeId)
    if (path) return [handle.id, ...path]
  }
  return undefined
}

/** The recipes the picker should grey out for a row added to sub-plan `subPlanId`: those its area (the whole block without areas) already has. */
export function presentRecipesFor(root: SubPlan, subPlanId: string): { ids: Set<string>; where: 'this area' | 'this block' } {
  return { ids: areaRecipeIds(root, subPlanId), where: blockAreas(root) ? 'this area' : 'this block' }
}
