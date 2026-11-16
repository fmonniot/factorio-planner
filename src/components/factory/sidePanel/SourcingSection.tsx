import { useMemo } from 'react'
import type { GameData, GameRecipeNode, SolvedNode } from '../../../data/types'
import { useUiStore } from '../../../store/uiStore'
import { useBlockStore, selectActiveBlock } from '../../../store/blockStore'
import { storedAreaRule } from '../../../data/subPlanTree'
import { indexRecipeAreas } from '../recipeAreas'
import { anchorOf } from '../popoverAnchor'
import { Icon } from '../../Icon'
import { fmtItemRateText } from '../ItemTile'
import { useSourcingSentence } from '../useSourcingSentence'
import { PanelSection } from './PanelParts'

function SourcingEntry({ itemId, ratePerMin, gameData, areaId }: { itemId: string; ratePerMin: number | undefined; gameData: GameData; areaId: string | undefined }) {
  const block = useBlockStore(selectActiveBlock)
  const unit = useUiStore(s => s.rateUnit)
  const openComesFrom = useUiStore(s => s.openComesFrom)

  const item = gameData.items[itemId]
  const name = item?.name ?? itemId
  // The row's area: its sentence is the area's when the area has its own rule for the item.
  const hasOwnRule = block !== undefined && areaId !== undefined && storedAreaRule(block.rootPlan, areaId, itemId) !== undefined
  const text = useSourcingSentence(itemId, gameData, hasOwnRule ? areaId : undefined)

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
        title={areaId !== undefined ? "Choose where this item comes from, for the block or for this row's area" : 'Choose where this item comes from, for every row of the block'}
        aria-haspopup="dialog"
        onClick={e => openComesFrom(itemId, anchorOf(e.currentTarget), areaId !== undefined ? { areaId } : undefined)}
        className="mt-1 bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-[11px] leading-4 text-gray-300 hover:border-gray-500"
      >
        Change…
      </button>
    </li>
  )
}

/**
 * Where inputs come from, read-only: one entry per ingredient with its rate, the sentence about what the solver did, and
 * a Change… button that opens the Comes from popover of the item, which sets the block's rule for it (or the row's area's, in a block with areas).
 */
export function SourcingSection({ node, solved, gameData }: {
  node: GameRecipeNode
  solved: SolvedNode | undefined
  gameData: GameData
}) {
  const recipe = gameData.recipes[node.recipeId]
  const block = useBlockStore(selectActiveBlock)
  // In a block with areas, the area of the row.
  const rootPlan = block?.rootPlan
  const index = useMemo(() => (rootPlan ? indexRecipeAreas(rootPlan) : undefined), [rootPlan])
  const areaId = index?.hasAreas ? index.rowById.get(node.id)?.areaId : undefined
  const entries: { itemId: string; rate: number | undefined }[] = solved
    ? Object.entries(solved.inputRates).map(([itemId, rate]) => ({ itemId, rate }))
    : [...new Set(recipe?.ingredients.map(i => i.itemId) ?? [])].map(itemId => ({ itemId, rate: undefined }))

  return (
    <PanelSection title="Where inputs come from" testId="panel-sourcing">
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400 italic">This row takes no inputs.</p>
      ) : (
        <ul>
          {entries.map(e => <SourcingEntry key={e.itemId} itemId={e.itemId} ratePerMin={e.rate} gameData={gameData} areaId={areaId} />)}
        </ul>
      )}
    </PanelSection>
  )
}
