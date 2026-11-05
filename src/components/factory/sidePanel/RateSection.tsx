import { useState } from 'react'
import type { GameData, GameRecipeNode, SolvedNode } from '../../../data/types'
import { useBlockStore } from '../../../store/blockStore'
import { useUiStore } from '../../../store/uiStore'
import { dedicatedProduct } from '../../../solver/areas'
import { neighbourHeatBonus } from '../../../solver/effects'
import { isEnergyItem } from '../../../data/electricity'
import { fmtRate, inputRateUnit } from '../ItemTile'
import { primaryItemPerRun, solvedPrimaryPerRun } from '../RecipeRow'
import { PanelSection } from './PanelParts'

/**
 * The Rate section: the pin checkbox, the pinned rate of the primary product in the current unit, and the runs/min it
 * stands for. `pinnedRate` is stored as executions per minute; the conversion in the input's value and in `change` are inverses.
 */
export function RateSection({ node, solved, gameData }: {
  node: GameRecipeNode
  solved: SolvedNode | undefined
  gameData: GameData
}) {
  const updateNodePinnedRate = useBlockStore(s => s.updateNodePinnedRate)
  const rateUnit = useUiStore(s => s.rateUnit)
  // Last positive solved items-per-run, so the pin factor (and the input's key) stays stable when a later solve zeroes this node.
  const [lastSolvedPerRun, setLastSolvedPerRun] = useState<number | undefined>(undefined)

  const recipe = gameData.recipes[node.recipeId]
  if (!recipe) return null
  const primaryItemId = dedicatedProduct(node, recipe)
  const solvedPerRun = solvedPrimaryPerRun(primaryItemId, solved)
  if (solvedPerRun !== undefined && solvedPerRun !== lastSolvedPerRun) setLastSolvedPerRun(solvedPerRun)
  const primaryPerRun =
    solvedPerRun ?? lastSolvedPerRun ?? primaryItemPerRun(recipe, primaryItemId, undefined, neighbourHeatBonus(node, gameData))

  const pinned = node.pinnedRate !== undefined
  const absorbs = node.byproductConsumer === true
  const unit = inputRateUnit(primaryItemId, rateUnit)
  const unitLabel = isEnergyItem(primaryItemId) ? 'MW' : rateUnit === 'min' ? '/m' : '/s'
  const runs = pinned ? node.pinnedRate! : (solved?.throughput ?? 0)

  function togglePin(checked: boolean) {
    updateNodePinnedRate(node.id, checked ? Math.max(solved?.throughput ?? 0, 1) : undefined)
  }

  function change(raw: string) {
    const v = parseFloat(raw)
    if (isFinite(v) && v > 0) updateNodePinnedRate(node.id, (unit === 'min' ? v : v * 60) / primaryPerRun)
  }

  return (
    <PanelSection title="Rate" testId="panel-rate">
      <div className="flex items-center gap-2 flex-wrap">
        <label
          className="flex items-center gap-1.5 text-xs text-gray-300"
          title={absorbs ? 'A row that absorbs a byproduct runs on surplus and cannot be pinned' : undefined}
        >
          <input
            type="checkbox"
            checked={pinned}
            disabled={absorbs}
            onChange={e => togglePin(e.target.checked)}
            data-testid="pin-checkbox"
            className="accent-amber-400"
          />
          Pin rate
        </label>
        {pinned && (
          <>
            <input
              type="number"
              min="0.001"
              step="any"
              aria-label="Pinned rate"
              // executions/min -> primary product rate in the display unit (inverse of `change`)
              defaultValue={fmtRate((node.pinnedRate ?? 0) * primaryPerRun / 60, unit)}
              key={`${node.id}-pin-${unit}-${primaryPerRun.toFixed(6)}`}
              onChange={e => change(e.target.value)}
              className="w-24 bg-gray-700 text-yellow-300 text-xs rounded px-1.5 py-0.5 border border-yellow-700 outline-none focus:ring-1 focus:ring-yellow-500 text-right tabular-nums"
            />
            <span className="text-gray-500 text-[11px]">{unitLabel}</span>
          </>
        )}
        <span data-testid="runs-per-min" className="text-[11px] text-gray-500 tabular-nums">
          = {fmtRate(runs / 60, 'min')} runs/min
        </span>
      </div>
      {pinned && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          The row always runs at this rate, whatever the block needs.
        </p>
      )}
    </PanelSection>
  )
}
