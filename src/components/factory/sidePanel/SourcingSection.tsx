import type { GameData, GameRecipeNode, SolvedNode } from '../../../data/types'
import { useUiStore } from '../../../store/uiStore'
import { Icon } from '../../Icon'
import { fmtItemRateText } from '../ItemTile'
import { useSourcingSentence } from '../useSourcingSentence'
import { PanelSection } from './PanelParts'

function SourcingEntry({ itemId, ratePerMin, gameData }: { itemId: string; ratePerMin: number | undefined; gameData: GameData }) {
  const unit = useUiStore(s => s.rateUnit)
  const openIngredientSlot = useUiStore(s => s.openIngredientSlot)

  const item = gameData.items[itemId]
  const name = item?.name ?? itemId
  const text = useSourcingSentence(itemId, gameData)

  return (
    <li data-testid="sourcing-entry" data-item-id={itemId} className="py-2 border-b border-gray-800 last:border-b-0">
      <div className="flex items-center gap-2">
        {item?.iconPath ? (
          <Icon iconPath={item.iconPath} alt="" className="w-7 h-7 object-contain shrink-0" />
        ) : (
          <span className="w-7 h-7 bg-gray-700 rounded text-[9px] text-gray-300 flex items-center justify-center shrink-0">{name.substring(0, 2).toUpperCase()}</span>
        )}
        <span className="flex-1 min-w-0 text-xs text-gray-200 truncate" title={name}>{name}</span>
        {ratePerMin !== undefined && (
          <span className="text-[11px] text-green-300 tabular-nums">{fmtItemRateText(itemId, ratePerMin / 60, unit)}</span>
        )}
      </div>
      <p data-testid="sourcing-sentence" className="mt-1.5 text-[11px] text-gray-400">{text}</p>
      <button
        type="button"
        data-testid="sourcing-change"
        aria-label={`Change where ${name} comes from`}
        title="Open this item in the Ingredients pane, where its Comes from control is"
        onClick={() => openIngredientSlot(itemId)}
        className="mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-[11px] leading-4 text-gray-300 hover:border-gray-500"
      >
        Change…
      </button>
    </li>
  )
}

/**
 * Where inputs come from, read-only: one entry per ingredient with its rate, the sentence about what the solver did, and
 * a Change… button that opens the item's Ingredients slot, where the Comes from control sets the rule.
 */
export function SourcingSection({ node, solved, gameData }: {
  node: GameRecipeNode
  solved: SolvedNode | undefined
  gameData: GameData
}) {
  const recipe = gameData.recipes[node.recipeId]
  const entries: { itemId: string; rate: number | undefined }[] = solved
    ? Object.entries(solved.inputRates).map(([itemId, rate]) => ({ itemId, rate }))
    : [...new Set(recipe?.ingredients.map(i => i.itemId) ?? [])].map(itemId => ({ itemId, rate: undefined }))

  return (
    <PanelSection title="Where inputs come from" testId="panel-sourcing">
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 italic">This row takes no inputs.</p>
      ) : (
        <ul>
          {entries.map(e => <SourcingEntry key={e.itemId} itemId={e.itemId} ratePerMin={e.rate} gameData={gameData} />)}
        </ul>
      )}
    </PanelSection>
  )
}
