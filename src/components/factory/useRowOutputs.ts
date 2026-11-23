import { useMemo } from 'react'
import type { GameData, GameRecipeNode, SolvedNode } from '../../data/types'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useSolverStore, selectBlockResult, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { dedicatedProduct } from '../../solver/areas'
import { indexRecipeAreas } from './recipeAreas'
import { itemMakers } from './sourcingText'
import { itemConsumers, itemLeftover, itemReceivers, outputText } from './outputsText'

/** One product or byproduct of a row, with the sentence about where it goes. */
export interface RowOutput {
  itemId: string
  /** items/min the row makes (gross); undefined without a solve. */
  rate: number | undefined
  /** The item is a co-product of the row, not the one it is built for. */
  byproduct: boolean
  text: string
}

const EPS = 1e-6

/**
 * The outputs of a row of the active block, the item the row is built for first, with where each goes, from the last solve.
 * Empty without a block or game data. Like the inputs section, it reads the active block.
 */
export function useRowOutputs(node: GameRecipeNode, solved: SolvedNode | undefined, gameData: GameData | undefined): RowOutput[] {
  const block = useBlockStore(selectActiveBlock)
  const blocks = useBlockStore(s => s.blocks)
  const result = useSolverStore(selectBlockResult(block?.id))
  const flows = useSolverStore(selectFlows)
  const unit = useUiStore(s => s.rateUnit)

  return useMemo(() => {
    if (!block || !gameData) return []
    const recipe = gameData.recipes[node.recipeId]
    const primary = recipe ? dedicatedProduct(node, recipe) : undefined
    const recipeItems = [...new Set(recipe?.products.map(p => p.itemId) ?? [])]
    const itemIds = solved ? Object.keys(solved.outputRates) : recipeItems
    // The item the row is built for first, then the recipe's order.
    const order = (id: string) => (id === primary ? -1 : recipeItems.indexOf(id) < 0 ? recipeItems.length : recipeItems.indexOf(id))
    const sorted = [...itemIds].sort((a, b) => order(a) - order(b))
    const index = indexRecipeAreas(block.rootPlan)
    const rowAreaId = index.rowById.get(node.id)?.areaId
    const productIds = new Set(block.products.map(p => p.itemId))

    return sorted.map(itemId => {
      const rate = solved?.outputRates[itemId]
      const product = productIds.has(itemId)
      // Rows that make the item at the moment, other than this one.
      const otherMakers = Math.max(0, itemMakers(block, gameData, result, itemId).filter(m => m.rate > EPS).length - ((rate ?? 0) > EPS ? 1 : 0))
      return {
        itemId,
        rate,
        byproduct: primary !== undefined && itemId !== primary,
        text: outputText({
          itemId,
          itemName: gameData.items[itemId]?.name ?? itemId,
          unit,
          solved: solved !== undefined,
          rate: rate ?? 0,
          discarded: node.byproductPolicy[itemId] === 'discard',
          product,
          consumers: itemConsumers(block, gameData, result, itemId, node.id, index, rowAreaId),
          receivers: itemReceivers(block.id, blocks, flows, itemId),
          leftover: product ? 0 : itemLeftover(result, flows, block.id, itemId),
          otherMakers,
        }),
      }
    })
  }, [block, blocks, result, flows, unit, node, solved, gameData])
}
