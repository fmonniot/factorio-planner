import type { GameData, GameRecipeNode, SolvedNode } from '../../../data/types'
import { useUiStore } from '../../../store/uiStore'
import { Icon } from '../../Icon'
import { fmtItemRateText } from '../ItemTile'
import { useRowOutputs, type RowOutput } from '../useRowOutputs'
import { PanelSection } from './PanelParts'

function OutputEntry({ output, gameData }: { output: RowOutput; gameData: GameData }) {
  const unit = useUiStore(s => s.rateUnit)
  const { itemId, rate, byproduct, discarded, text } = output
  const item = gameData.items[itemId]
  const name = item?.name ?? itemId

  return (
    <li data-testid="output-entry" data-item-id={itemId} data-byproduct={byproduct ? 'true' : undefined} className="py-2 border-b border-gray-800 last:border-b-0">
      <div className="flex items-center gap-2">
        {item?.iconPath ? (
          <Icon iconPath={item.iconPath} alt="" className="w-7 h-7 object-contain shrink-0" />
        ) : (
          <span className="w-7 h-7 bg-gray-700 rounded text-[9px] text-gray-300 flex items-center justify-center shrink-0">{name.substring(0, 2).toUpperCase()}</span>
        )}
        <span className="flex-1 min-w-0 text-xs text-gray-200 truncate" data-tip={name}>{name}</span>
        {rate !== undefined && discarded && <span data-testid="output-not-counted" className="text-[11px] text-gray-500">not counted</span>}
        {rate !== undefined && !discarded && (
          <span className="text-[11px] text-green-300 tabular-nums">{fmtItemRateText(itemId, rate / 60, unit)}</span>
        )}
        <span className="text-[10px] text-gray-400">{byproduct ? 'Byproduct' : 'Product'}</span>
      </div>
      <p data-testid="output-sentence" className="mt-1.5 text-[11px] text-gray-400">{text}</p>
    </li>
  )
}

/**
 * Where outputs go, read-only: one entry per product and byproduct of the row with its rate and a sentence about what the
 * solver did with it (which rows use it, which blocks it is sent to, what is left over).
 */
export function OutputsSection({ node, solved, gameData }: {
  node: GameRecipeNode
  solved: SolvedNode | undefined
  gameData: GameData
}) {
  const outputs = useRowOutputs(node, solved, gameData)

  return (
    <PanelSection title="Where outputs go" testId="panel-outputs">
      {outputs.length === 0 ? (
        <p className="text-xs text-gray-400 italic">This row makes no outputs.</p>
      ) : (
        <ul>
          {outputs.map(o => <OutputEntry key={o.itemId} output={o} gameData={gameData} />)}
        </ul>
      )}
    </PanelSection>
  )
}
