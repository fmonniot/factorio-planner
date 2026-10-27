import type { GameRecipeNode, SolvedArea, SolvedNode, SubPlan } from '../../data/types'
import { areaRecipeIds, blockAreas, subPlanAreaIds } from '../../solver/areas'
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
  buildings: number
  exact: number
  /** the row's own area first, then the others in table order */
  split: AreaSplit[]
}

/** The buildings a recipe takes in every area that builds it; a row with no solve result counts as 0. */
export function multiAreaSummary(
  index: RecipeAreaIndex,
  root: SubPlan,
  recipeId: string,
  hereAreaId: string,
  solvedMap: ReadonlyMap<string, SolvedNode>,
): MultiAreaSummary {
  const buildings = new Map<string, number>()
  let exact = 0
  for (const ref of index.rowsByRecipe.get(recipeId) ?? []) {
    const solved = solvedMap.get(ref.node.id)
    buildings.set(ref.areaId, (buildings.get(ref.areaId) ?? 0) + (solved?.machineCountCeil ?? 0))
    exact += solved?.machineCountExact ?? 0
  }
  const areaIds = recipeAreaIds(index, recipeId)
  const ordered = [...areaIds.filter(id => id === hereAreaId), ...areaIds.filter(id => id !== hereAreaId)]
  const split = ordered.map(areaId => ({ areaId, name: areaName(root, areaId), buildings: buildings.get(areaId) ?? 0 }))
  return {
    areaCount: areaIds.length,
    buildings: split.reduce((sum, s) => sum + s.buildings, 0),
    exact,
    split,
  }
}

/** "Electrolysis: 15 buildings (13.6 exact) in 3 areas: 5 here, 5 Plastics, 5 Rocket fuel". */
export function multiAreaTitle(recipeName: string, s: MultiAreaSummary, hereAreaId: string): string {
  const b = s.buildings
  const parts = s.split.map(a => (a.areaId === hereAreaId ? `${a.buildings} here` : `${a.buildings} ${a.name}`))
  return `${recipeName}: ${b} building${b === 1 ? '' : 's'} (${s.exact.toFixed(1)} exact) in ${s.areaCount} areas: ${parts.join(', ')}`
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
