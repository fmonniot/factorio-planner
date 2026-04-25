import { useSolverStore, selectSolverResult } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useActiveSubPlanFromFloor } from '../../store/blockStore'
import { WarningsPopover } from './WarningsPopover'

// ---------------------------------------------------------------------------
// BalancedItemsFooter
//
// Shows items whose production is fully balanced by the solver (net ≈ 0),
// as a diagnostic strip at the bottom of the factory view.
// ---------------------------------------------------------------------------

const BALANCE_EPSILON = 0.001

export function BalancedItemsFooter() {
  const result = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)
  const subPlan = useActiveSubPlanFromFloor()

  if (!result) return null

  // Compute net balance per item
  const net = new Map<string, number>()
  for (const node of result.nodes) {
    for (const [id, rate] of Object.entries(node.outputRates))
      net.set(id, (net.get(id) ?? 0) + rate)
    for (const [id, rate] of Object.entries(node.inputRates))
      net.set(id, (net.get(id) ?? 0) - rate)
  }

  const goalIds = new Set((subPlan?.goals ?? []).map(g => g.itemId))

  // Balanced items: net near zero, not a goal, not a raw input
  const balanced = [...net]
    .filter(([id, v]) =>
      Math.abs(v) < BALANCE_EPSILON &&
      !goalIds.has(id) &&
      !result.unsatisfied.some(u => u.itemId === id),
    )
    .map(([id]) => id)

  return (
    <div className="shrink-0 border-t border-gray-800 px-3 py-1 flex items-center gap-1.5 flex-wrap text-[10px] text-gray-600">
      {balanced.length > 0 && (
        <>
          <span>Balanced:</span>
          {balanced.map(id => {
            const item = gameData?.items[id]
            return (
              <span key={id} className="text-gray-500" title={item?.name ?? id}>
                {item?.name ?? id}
              </span>
            )
          })}
        </>
      )}
      <div className="ml-auto">
        <WarningsPopover />
      </div>
    </div>
  )
}
