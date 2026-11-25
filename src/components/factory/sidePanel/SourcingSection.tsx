import { useId, useMemo } from 'react'
import type { GameData, GameRecipeNode, SolvedNode } from '../../../data/types'
import { useUiStore } from '../../../store/uiStore'
import { useBlockStore, selectActiveBlock } from '../../../store/blockStore'
import { isEnergyItem } from '../../../data/electricity'
import { areaName, storedAreaRule } from '../../../data/subPlanTree'
import { indexRecipeAreas } from '../recipeAreas'
import { anchorOf } from '../popoverAnchor'
import { Icon } from '../../Icon'
import { fmtItemRate, fmtItemRateText } from '../ItemTile'
import { RailLine, RailList, type RailTarget } from '../RailList'
import { StripIcon } from '../StripIcon'
import { Cluster, type StripAction } from '../StripToolbar'
import { SOURCES_BUTTON_LABEL, ruleLabel } from '../itemSourcing'
import { INPUT_EMPTY_LABEL, buildInputLines, inputEmptyState, inputLineTip, inputsReading, ruleIconsOf, type InputLine } from '../inputsModel'
import { useBlockSourcesModel } from '../useSourcesModel'
import { PanelSection } from './PanelParts'

function targetOf(line: InputLine): RailTarget {
  switch (line.kind) {
    case 'make-here':
    case 'made-here': return { kind: 'row' }
    case 'other-area': return { kind: 'area' }
    // The block's own colour, not the limited amber: the "!" says limited.
    case 'block': return { kind: 'block', color: line.look.kind === 'block' ? line.look.color : '#6b7280' }
    case 'import': return { kind: 'import' }
    case 'missing': return { kind: 'missing' }
  }
}

function SourcingEntry({ itemId, ratePerMin, gameData, areaId }: { itemId: string; ratePerMin: number | undefined; gameData: GameData; areaId: string | undefined }) {
  const block = useBlockStore(selectActiveBlock)
  const unit = useUiStore(s => s.rateUnit)
  const openComesFrom = useUiStore(s => s.openComesFrom)
  const readingId = useId()

  const item = gameData.items[itemId]
  const name = item?.name ?? itemId
  // The row's area: the lists are the area's when the area has its own rule for the item.
  const hasOwnRule = block !== undefined && areaId !== undefined && storedAreaRule(block.rootPlan, areaId, itemId) !== undefined
  const scopeArea = hasOwnRule ? areaId : undefined
  // The strip owns the remembered side of Make more here, so this hook does not (rememberSide stays off).
  const view = useBlockSourcesModel(block, itemId, scopeArea)
  const fmt = (perMin: number) => fmtItemRateText(itemId, perMin / 60, unit)
  // The lines' rates carry no unit (the item's total does), except power, whose unit is part of the figure.
  const lineRate = isEnergyItem(itemId) ? fmt : (perMin: number) => fmtItemRate(itemId, perMin / 60, unit).value
  const lines = view ? buildInputLines(view.model, view.rows) : []
  const empty = inputEmptyState(view?.model)
  const icons = ruleIconsOf(view?.rule)

  const sources: StripAction = {
    label: `Sources of ${name}`,
    title: SOURCES_BUTTON_LABEL,
    icon: 'sources',
    testId: 'input-sources',
    hasPopup: 'dialog',
    describedBy: readingId,
    onSelect: e => openComesFrom(itemId, anchorOf(e.currentTarget), areaId !== undefined ? { areaId } : undefined),
  }

  return (
    <li data-testid="sourcing-entry" data-item-id={itemId} aria-describedby={readingId} className="py-2 border-b border-gray-800 last:border-b-0">
      <div className="flex items-center gap-2">
        {item?.iconPath ? (
          <Icon iconPath={item.iconPath} alt="" className="w-7 h-7 object-contain shrink-0" />
        ) : (
          <span className="w-7 h-7 bg-gray-700 rounded text-[9px] text-gray-300 flex items-center justify-center shrink-0">{name.substring(0, 2).toUpperCase()}</span>
        )}
        <span className="flex-1 min-w-0 text-xs text-gray-200 truncate" data-tip={name}>{name}</span>
        {block && icons.length > 0 && (
          <span data-testid="input-rule-icons" className="inline-flex shrink-0 gap-1 text-teal-300">
            {icons.map(i => {
              const ruleName = ruleLabel({ kind: i.kind, areaId: scopeArea }, block.rootPlan)
              return (
                <span key={i.kind} data-testid="input-rule-icon" data-rule={i.kind} role="img" aria-label={ruleName} data-tip={ruleName}>
                  <StripIcon name={i.icon} />
                </span>
              )
            })}
          </span>
        )}
        {ratePerMin !== undefined && (
          <span className="text-[11px] text-green-300 tabular-nums">{fmt(ratePerMin)}</span>
        )}
        <Cluster actions={[sources]} />
      </div>
      {empty !== undefined && (
        <p data-testid="input-empty" data-state={empty} className="ml-9 mt-1 text-[11px] text-gray-500">{INPUT_EMPTY_LABEL[empty]}</p>
      )}
      {view && empty === undefined && (
        <RailList arrow="foot" label={`Where ${name} comes from`} testId="input-lines" className="mr-8">
          {lines.map(l => (
            <RailLine
              key={l.key}
              target={targetOf(l)}
              label={l.label}
              detail={l.detail}
              tag={l.limited && (
                <span data-testid="input-limited" role="img" aria-label="limited" className="ml-1 shrink-0 font-bold leading-none text-amber-300">!</span>
              )}
              tone={l.kind === 'missing' ? 'warn' : undefined}
              rate={lineRate(l.rate)}
              tip={inputLineTip(l, fmt)}
              testId="input-line"
              labelTestId="input-line-label"
              rateTestId="input-line-rate"
              attrs={{ 'data-kind': l.kind, 'data-key': l.key, 'data-limited': l.limited ? 'true' : undefined }}
            />
          ))}
        </RailList>
      )}
      <span id={readingId} className="sr-only" data-testid="input-reading">
        {view && block ? inputsReading(view.model, fmt, scopeArea !== undefined ? areaName(block.rootPlan, scopeArea) : undefined) : ''}
      </span>
    </li>
  )
}

/**
 * Where inputs come from, read-only: one entry per ingredient with its rate, icons for a rule that is not the default, a rail of
 * lines for what supplies it, and a Sources… button that opens the Comes from popover of the item, which sets the block's rule for it
 * (or the row's area's, in a block with areas).
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
