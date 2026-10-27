import type { GameData, SolvedNode, SubPlan } from '../../data/types'
import { dedicatedProduct } from '../../solver/areas'
import { Icon } from '../Icon'
import { ItemTile } from './ItemTile'
import {
  multiAreaSummary,
  multiAreaTitle,
  recipeGroupRates,
  type RecipeAreaIndex,
  type RecipeGroup,
} from './recipeAreas'

interface RecipeGroupRowProps {
  group: RecipeGroup
  rootPlan: SubPlan
  index: RecipeAreaIndex
  solvedMap: ReadonlyMap<string, SolvedNode>
  gameData: GameData
  isOpen: boolean
  onToggle: () => void
}

// A recipe built in several areas, as one line of the by-recipe view: its total over every area.
// The rows per area open under it. Display only: the rows keep every action.
export function RecipeGroupRow({ group, rootPlan, index, solvedMap, gameData, isOpen, onToggle }: RecipeGroupRowProps) {
  const recipe = gameData.recipes[group.recipeId]
  if (!recipe) return null

  // The same rows as the tiles below: the ones the view lists (a sub-plan without a handle has none).
  const summary = multiAreaSummary(index, rootPlan, group.recipeId, undefined, solvedMap, group.rows)
  const rates = recipeGroupRates(group.rows, recipe, solvedMap)
  const primaryItemId = dedicatedProduct(group.rows[0].node, recipe)
  const iconPath = primaryItemId ? gameData.items[primaryItemId]?.iconPath : undefined
  const b = summary.buildings

  return (
    <tr data-testid="recipe-group" data-recipe-id={group.recipeId} className="border-b border-gray-800 hover:bg-gray-800/40">
      <td />
      <td className="px-2 py-0.5 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`${recipe.name}: rows per area`}
            onClick={onToggle}
            className="w-4 text-[10px] text-gray-400 hover:text-gray-200"
          >
            <span aria-hidden>{isOpen ? '▼' : '▶'}</span>
          </button>
          {iconPath ? (
            <Icon iconPath={iconPath} alt={recipe.name} title={recipe.name} className="w-8 h-8 object-contain shrink-0" />
          ) : (
            <span
              title={recipe.name}
              className="w-8 h-8 bg-gray-800 rounded text-[9px] text-gray-400 flex items-center justify-center shrink-0 leading-none select-none"
            >
              {recipe.name.substring(0, 2).toUpperCase()}
            </span>
          )}
          <span className="text-[10px] px-1 rounded border border-teal-700 text-teal-300 tabular-nums select-none">
            {summary.areaCount === summary.rowCount
              ? `${summary.areaCount} areas`
              : `${summary.rowCount} rows in ${summary.areaCount} area${summary.areaCount === 1 ? '' : 's'}`}
          </span>
        </div>
      </td>
      <td className="px-2 py-0.5 whitespace-nowrap text-gray-200">
        <span data-testid="recipe-group-buildings" title={multiAreaTitle(recipe.name, summary, undefined)}>
          {b} building{b === 1 ? '' : 's'}
        </span>
      </td>
      <td />
      <td className="px-2 py-0.5">
        <div className="flex flex-wrap gap-0.5">
          {rates.products.map(([id, rate]) => (
            <ItemTile key={id} item={gameData.items[id]} ratePerSec={rate / 60} variant="product" />
          ))}
        </div>
      </td>
      <td className="px-2 py-0.5">
        <div className="flex flex-wrap gap-0.5">
          {rates.byproducts.map(([id, rate]) => (
            <ItemTile key={id} item={gameData.items[id]} ratePerSec={rate / 60} variant="byproduct" />
          ))}
        </div>
      </td>
      <td className="px-2 py-0.5">
        <div className="flex items-start gap-1">
          <div className="flex flex-wrap gap-0.5 flex-1">
            {rates.inputs.map(([id, rate]) => (
              <ItemTile key={id} item={gameData.items[id]} ratePerSec={rate / 60} variant="ingredient" />
            ))}
          </div>
          {rates.powerKw > 0 && <ItemTile item={undefined} ratePerSec={rates.powerKw} variant="electricity" />}
        </div>
      </td>
    </tr>
  )
}
