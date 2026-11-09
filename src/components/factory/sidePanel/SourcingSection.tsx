import { useMemo } from 'react'
import type { GameData, GameRecipeNode, ItemSourcingMode, SolvedNode } from '../../../data/types'
import { useBlockStore, selectActiveBlock } from '../../../store/blockStore'
import { useSolverStore, selectBlockResult, selectFlows } from '../../../store/solverStore'
import { useUiStore } from '../../../store/uiStore'
import { hasProduct } from '../../../solver/blockGraph'
import { Icon } from '../../Icon'
import { fmtItemRateText } from '../ItemTile'
import { ITEM_SOURCING_CHOICES, forbidImportsTitle } from '../itemSourcing'
import { itemConnections, itemMakers, sourcingText } from '../sourcingText'
import { PanelSection } from './PanelParts'

function SourcingEntry({ itemId, ratePerMin, gameData }: { itemId: string; ratePerMin: number | undefined; gameData: GameData }) {
  const block = useBlockStore(selectActiveBlock)
  const blocks = useBlockStore(s => s.blocks)
  const setItemSourcing = useBlockStore(s => s.setItemSourcing)
  const toggleNoImportItem = useBlockStore(s => s.toggleNoImportItem)
  const result = useSolverStore(selectBlockResult(block?.id))
  const flows = useSolverStore(selectFlows)
  const unit = useUiStore(s => s.rateUnit)

  const item = gameData.items[itemId]
  const name = item?.name ?? itemId
  const mode = block?.itemSourcing[itemId]
  const noImport = block?.noImportItems.includes(itemId) ?? false
  // A product of the block is always made by it: only Own recipes first applies (a leftover mode can still be cleared).
  const isProduct = block !== undefined && hasProduct(block, itemId)
  const productTitle = `${name} is a product of this block, so the block always makes it`
  const forbidTitle = forbidImportsTitle(block, gameData, itemId)

  const text = useMemo(
    () => block
      ? sourcingText({
          itemId, itemName: name, mode, noImport, unit,
          makers: itemMakers(block, gameData, result, itemId),
          connections: itemConnections(block, blocks, flows, itemId),
        })
      : '',
    [block, blocks, flows, gameData, result, itemId, name, mode, noImport, unit],
  )

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
      <div role="radiogroup" aria-label={`How ${name} is sourced`} className="mt-1.5 flex rounded overflow-hidden border border-gray-700">
        {ITEM_SOURCING_CHOICES.map(choice => {
          const selected = choice.mode === mode
          // Own recipes first stays enabled while a mode is set, so the entry can always be cleared.
          const disabled = isProduct && !(choice.mode === undefined && mode !== undefined) && choice.mode !== undefined
          return (
            <button
              key={choice.label}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              title={disabled ? productTitle : choice.label}
              data-sourcing-choice={choice.mode ?? 'own'}
              onClick={() => setItemSourcing(itemId, choice.mode as ItemSourcingMode | undefined)}
              className={`flex-1 min-w-0 px-0.5 py-1 text-[11px] leading-tight [overflow-wrap:anywhere] border-r border-gray-700 last:border-r-0 disabled:opacity-40 ${selected ? 'bg-teal-900/60 text-teal-200' : 'text-gray-300 hover:bg-gray-800'}`}
            >
              {choice.label.replace(' first', '')}
            </button>
          )
        })}
      </div>
      <p data-testid="sourcing-sentence" className="mt-1.5 text-[11px] text-gray-400">{text}</p>
      <label className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-400" title={forbidTitle}>
        <input
          type="checkbox"
          checked={noImport}
          disabled={forbidTitle !== undefined}
          onChange={() => toggleNoImportItem(itemId)}
          data-testid="forbid-imports"
          className="accent-teal-400"
        />
        Forbid imports
      </label>
    </li>
  )
}

/**
 * Where inputs come from: one entry per ingredient with the three sourcing modes (per item for the whole block, so every
 * row that uses the item follows it), one sentence about what the solver did, and Forbid imports.
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
        <p className="text-xs text-gray-500 italic">This row takes no inputs.</p>
      ) : (
        <ul>
          {entries.map(e => <SourcingEntry key={e.itemId} itemId={e.itemId} ratePerMin={e.rate} gameData={gameData} />)}
        </ul>
      )}
      <p className="mt-2 text-[10px] text-gray-500">The mode is per item for the whole block: every row that uses the item follows it.</p>
    </PanelSection>
  )
}
