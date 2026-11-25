import type { Block, GameData, SolverResult } from '../../data/types'
import { blockAreas, dedicatedProduct } from '../../solver/areas'
import { rowMachine } from '../../solver/effects'

// ---------------------------------------------------------------------------
// The recipe rows of a block that make one item, with what the solver ran them at: the makers of the Sources model.
// ---------------------------------------------------------------------------

/** A recipe row of the block that makes the item. */
export interface ItemMaker {
  recipeName: string
  machineName: string
  /** Machines the solver needs for the row (rounded up). */
  machineCount: number
  /** items/min of the item the row makes (gross). */
  rate: number
  /** The item is a co-product of the row, not its primary product. */
  byproduct: boolean
}

/** The block's recipe rows that make `itemId`, with what the solver ran them at; with `areaId`, those of that area. */
export function itemMakers(block: Block, gameData: GameData, result: SolverResult | undefined, itemId: string, areaId?: string): ItemMaker[] {
  // With an area, only the rows it holds (the rows of its sub-plans that are not areas themselves included).
  const inArea = areaId === undefined ? undefined : new Set(blockAreas(block.rootPlan)?.find(a => a.id === areaId)?.nodeIds)
  const solved = new Map(result?.nodes.map(n => [n.recipeNodeId, n]) ?? [])
  const makers: ItemMaker[] = []
  const visit = (plan: Block['rootPlan']) => {
    for (const n of plan.nodes) {
      if (n.kind !== 'game-recipe') continue
      const recipe = gameData.recipes[n.recipeId]
      if (!recipe || !recipe.products.some(p => p.itemId === itemId)) continue
      if (inArea && !inArea.has(n.id)) continue
      const s = solved.get(n.id)
      makers.push({
        recipeName: recipe.name,
        machineName: rowMachine(n, gameData)?.name ?? 'machine',
        machineCount: s?.machineCountCeil ?? 0,
        rate: s?.outputRates[itemId] ?? 0,
        byproduct: dedicatedProduct(n, recipe) !== itemId,
      })
    }
    plan.subPlans.forEach(visit)
  }
  visit(block.rootPlan)
  return makers
}
