import { useId, useState } from 'react'
import type { GameData, GameRecipeNode, SolvedNode } from '../../../data/types'
import { useBlockStore } from '../../../store/blockStore'
import { useUiStore } from '../../../store/uiStore'
import { dedicatedProduct } from '../../../solver/areas'
import { neighbourHeatBonus } from '../../../solver/effects'
import { isEnergyItem } from '../../../data/electricity'
import { fmtRate, inputRateUnit } from '../ItemTile'
import { primaryItemPerRun, solvedPrimaryPerRun, pinSeedRate } from '../pinRate'
import { PanelSection } from './PanelParts'

const PIN_NOTE = 'The row always runs at this rate, whatever the block needs.'

/**
 * The Rate section: the pin switch, the pinned rate of the primary product in the current unit, and the runs/min it
 * stands for. `pinnedRate` is stored as executions per minute; the conversion in the input's value and in `change` are inverses.
 */
export function RateSection({ node, solved, gameData }: {
  node: GameRecipeNode
  solved: SolvedNode | undefined
  gameData: GameData
}) {
  const pinNoteId = useId()
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
    updateNodePinnedRate(node.id, checked ? pinSeedRate(solved) : undefined)
  }

  function change(raw: string) {
    const v = parseFloat(raw)
    if (isFinite(v) && v > 0) updateNodePinnedRate(node.id, (unit === 'min' ? v : v * 60) / primaryPerRun)
  }

  return (
    <PanelSection title="Rate" testId="panel-rate">
      {/*
        The switch, then the rate input and its unit (16px between them, 8px inside the group), then the runs/min. The input
        group's slot is reserved while unpinned and the runs/min wraps below the line in a drawer, so the section keeps its
        height when pinning at every width.
      */}
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
        <label
          className="relative flex items-center gap-2 text-xs text-gray-200 min-h-7 cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
          title={absorbs && !pinned ? 'A row that absorbs a byproduct runs on surplus and cannot be pinned' : undefined}
        >
          {/* The native checkbox stays the control (keyboard, label click, form semantics); it is laid invisibly over the track. */}
          <input
            type="checkbox"
            role="switch"
            checked={pinned}
            disabled={absorbs && !pinned}
            onChange={e => togglePin(e.target.checked)}
            data-testid="pin-checkbox"
            aria-describedby={pinned ? pinNoteId : undefined}
            className="peer absolute inset-0 m-0 h-full w-full cursor-[inherit] opacity-0"
          />
          <span
            aria-hidden="true"
            className="relative h-5 w-[34px] shrink-0 rounded-full bg-gray-700 transition-colors peer-checked:bg-teal-500 peer-focus-visible:ring-2 peer-focus-visible:ring-teal-300 after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-3.5"
          />
          <span>Pin rate</span>
        </label>
        {pinned ? (
          <div
            className="flex items-center gap-2"
            title={PIN_NOTE}
          >
            <input
              type="number"
              min="0.001"
              step="any"
              aria-label="Pinned rate"
              // executions/min -> primary product rate in the display unit (inverse of `change`)
              defaultValue={fmtRate((node.pinnedRate ?? 0) * primaryPerRun / 60, unit)}
              key={`${node.id}-pin-${unit}-${primaryPerRun.toFixed(6)}`}
              onChange={e => change(e.target.value)}
              className="h-[26px] w-[90px] box-border bg-gray-950 text-gray-200 font-mono text-[11px] rounded-[5px] px-2 border border-gray-600 outline-none focus:ring-1 focus:ring-teal-500 text-right tabular-nums"
            />
            <span className="w-5 text-gray-400 text-[11px]">{unitLabel}</span>
          </div>
        ) : (
          // Same size as the input group (90 + 8 + 20), so the line breaks the same way pinned or not.
          <div aria-hidden="true" className="h-[26px] w-[118px]" />
        )}
        {/* Reachable without hover (touch, screen readers): the switch is described by it while pinned. */}
        {pinned && <span id={pinNoteId} className="sr-only">{PIN_NOTE}</span>}
        <span data-testid="runs-per-min" className="whitespace-nowrap text-[11px] text-gray-500 tabular-nums max-xl:basis-full">
          = {fmtRate(runs / 60, 'min')} runs/min
        </span>
      </div>
    </PanelSection>
  )
}
