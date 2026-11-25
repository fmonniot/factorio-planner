import { useId } from 'react'
import type { GameData, GameRecipeNode, SolvedNode } from '../../../data/types'
import { isEnergyItem } from '../../../data/electricity'
import { useUiStore } from '../../../store/uiStore'
import { Icon } from '../../Icon'
import { fmtItemRate, fmtItemRateText } from '../ItemTile'
import { RailLine, RailList, type RailTarget } from '../RailList'
import { lookOfOutput } from '../segmentLooks'
import { OUTPUT_EMPTY_LABEL, outputEmptyState, outputLineTip, outputReading, sharedTagTip, type OutputLine } from '../outputsModel'
import { useRowOutputs, type RowOutput } from '../useRowOutputs'
import { PanelSection } from './PanelParts'

function targetOf(line: OutputLine): RailTarget {
  switch (line.kind) {
    case 'row': return line.areaName !== undefined ? { kind: 'area' } : { kind: 'row' }
    case 'block': return { kind: 'block', color: lookOfOutput(line.look).mini }
    case 'product': return { kind: 'product' }
    case 'left': return { kind: 'left' }
  }
}

function OutputEntry({ output, gameData }: { output: RowOutput; gameData: GameData }) {
  const unit = useUiStore(s => s.rateUnit)
  const readingId = useId()
  const { itemId, rate, byproduct, discarded, model } = output
  const item = gameData.items[itemId]
  const name = item?.name ?? itemId
  const fmt = (perMin: number) => fmtItemRateText(itemId, perMin / 60, unit)
  // The lines' rates carry no unit (the item's total does), except power, whose unit is part of the figure.
  const lineRate = isEnergyItem(itemId) ? fmt : (perMin: number) => fmtItemRate(itemId, perMin / 60, unit).value
  const empty = outputEmptyState(model)

  return (
    <li
      data-testid="output-entry"
      data-item-id={itemId}
      data-byproduct={byproduct ? 'true' : undefined}
      aria-describedby={readingId}
      className="@container relative py-2 border-b border-gray-800 last:border-b-0"
    >
      <div className="flex items-center gap-2">
        <span className={`shrink-0 ${discarded ? 'opacity-50' : ''}`}>
          {item?.iconPath ? (
            <Icon iconPath={item.iconPath} alt="" className="w-7 h-7 object-contain" />
          ) : (
            <span className="w-7 h-7 bg-gray-700 rounded text-[9px] text-gray-300 flex items-center justify-center">{name.substring(0, 2).toUpperCase()}</span>
          )}
        </span>
        <span className={`flex-1 min-w-0 text-xs truncate ${discarded ? 'text-gray-400' : 'text-gray-200'}`} data-tip={name}>{name}</span>
        {model.otherMakers > 0 && !discarded && (
          <span
            data-testid="output-shared-tag"
            data-count={1 + model.otherMakers}
            data-tip={sharedTagTip(model)}
            className="shrink-0 rounded-[3px] border border-gray-600 px-1 text-[10px] text-gray-300"
          >
            <span className="@max-[15rem]:hidden">block </span>×{1 + model.otherMakers}
          </span>
        )}
        {rate !== undefined && discarded && (
          <span data-testid="output-not-counted" data-tip={`Discarded: this row's ${name} is not counted`} className="shrink-0 text-[11px] text-gray-400">not counted</span>
        )}
        {rate !== undefined && !discarded && (
          <span data-testid="output-rate" className="shrink-0 text-[11px] text-green-300 tabular-nums">{fmt(rate)}</span>
        )}
        <span className="w-12 shrink-0 text-right text-[10px] text-gray-400">{byproduct ? 'Byproduct' : 'Product'}</span>
      </div>
      {(empty === 'unsolved' || empty === 'notProduced' || empty === 'unused') && (
        <p data-testid="output-empty" data-state={empty} className="ml-9 mt-1 text-[11px] text-gray-500">{OUTPUT_EMPTY_LABEL[empty]}</p>
      )}
      {empty === undefined && (
        <RailList arrow="head" label={`Where ${name} goes`} testId="output-lines" className="mr-14">
          {model.lines.map(l => (
            <RailLine
              key={l.key}
              target={targetOf(l)}
              label={l.label}
              tag={l.absorber && (
                <span data-testid="output-absorber-tag" className="ml-1.5 shrink-0 rounded border border-gray-600 px-1 text-[9px] text-gray-400">absorber</span>
              )}
              detail={l.areaName}
              rate={lineRate(l.rate)}
              tip={outputLineTip(l, fmt)}
              testId="output-line"
              labelTestId="output-line-label"
              rateTestId="output-line-rate"
              attrs={{ 'data-kind': l.kind, 'data-absorber': l.absorber ? 'true' : undefined, 'data-key': l.key }}
            />
          ))}
        </RailList>
      )}
      <span id={readingId} className="sr-only" data-testid="output-reading">{outputReading(model, fmt)}</span>
    </li>
  )
}

/**
 * Where outputs go, read-only: one entry per product and byproduct of the row with its rate and a rail of lines for what the solver
 * did with it (which rows use it, which blocks it is sent to, what the block keeps for its goal, what is left over).
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
