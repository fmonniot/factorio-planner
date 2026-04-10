import { useSolverStore, selectSolverResult } from '../store/solverStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'
import { useBlockStore, selectActiveSubPlan } from '../store/blockStore'
import { iconUrl } from '../utils/iconUrl'

function fmtPower(kw: number): string {
  if (kw >= 1000) return `${(kw / 1000).toFixed(2)} MW`
  return `${kw.toFixed(0)} kW`
}

function fmtRate(rate: number): string {
  if (rate >= 100) return rate.toFixed(0)
  if (rate >= 10) return rate.toFixed(1)
  return rate.toFixed(2)
}

// ---------------------------------------------------------------------------
// FlowRow — outputs (main products + byproducts) → raw inputs
// ---------------------------------------------------------------------------

export function FlowRow() {
  const result = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)
  const subPlan = useBlockStore(selectActiveSubPlan)

  if (!result || result.nodes.length === 0 || !gameData) return null

  // Compute net balance per item across all solved nodes.
  const netBalance = new Map<string, number>()
  for (const node of result.nodes) {
    for (const [id, rate] of Object.entries(node.outputRates))
      netBalance.set(id, (netBalance.get(id) ?? 0) + rate)
    for (const [id, rate] of Object.entries(node.inputRates))
      netBalance.set(id, (netBalance.get(id) ?? 0) - rate)
  }

  const goalIds = new Set((subPlan?.goals ?? []).map(g => g.itemId))

  const mainProducts = [...netBalance]
    .filter(([id, net]) => net > 0 && goalIds.has(id))
    .map(([id, net]) => ({ id, rate: net }))

  const byproducts = [...netBalance]
    .filter(([id, net]) => net > 0 && !goalIds.has(id))
    .map(([id, net]) => ({ id, rate: net }))

  const rawInputs = result.unsatisfied.filter(u => u.rate > 0)

  if (mainProducts.length === 0 && byproducts.length === 0 && rawInputs.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 flex-wrap text-xs min-w-0">
      {/* Main products — teal */}
      {mainProducts.map(({ id, rate }) => {
        const item = gameData.items[id]
        return (
          <span key={id} className="flex items-center gap-1 bg-teal-950 text-teal-300 px-1.5 py-0.5 rounded shrink-0">
            {item?.iconPath
              ? <img src={iconUrl(item.iconPath)} alt={item.name} title={item.name} className="w-5 h-5 object-contain" />
              : <span title={item?.name ?? id}>{item?.name ?? id}</span>
            }
            <span className="text-teal-400">{fmtRate(rate)}/min</span>
          </span>
        )
      })}

      {/* Byproducts — dimmer with marker */}
      {byproducts.map(({ id, rate }) => {
        const item = gameData.items[id]
        return (
          <span key={id} className="flex items-center gap-1 bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded shrink-0">
            <span className="text-gray-600 text-[10px]">↩</span>
            {item?.iconPath
              ? <img src={iconUrl(item.iconPath)} alt={item.name} title={item.name} className="w-5 h-5 object-contain opacity-60" />
              : <span title={item?.name ?? id}>{item?.name ?? id}</span>
            }
            <span className="text-gray-500">{fmtRate(rate)}/min</span>
          </span>
        )
      })}

      {/* Divider */}
      {rawInputs.length > 0 && (
        <>
          <span className="text-gray-600 mx-1 shrink-0">→</span>

          {/* Raw inputs — amber, pushed right */}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {rawInputs.map(({ itemId, rate }) => {
              const item = gameData.items[itemId]
              return (
                <span key={itemId} className="flex items-center gap-1 bg-amber-950 text-amber-300 px-1.5 py-0.5 rounded shrink-0">
                  {item?.iconPath
                    ? <img src={iconUrl(item.iconPath)} alt={item.name} title={item.name} className="w-5 h-5 object-contain" />
                    : <span title={item?.name ?? itemId}>{item?.name ?? itemId}</span>
                  }
                  <span className="text-amber-400">{fmtRate(rate)}/min</span>
                </span>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SummaryBar — aggregate machine + power stats and warnings
// ---------------------------------------------------------------------------

export function SummaryBar() {
  const result = useSolverStore(selectSolverResult)

  if (!result || result.nodes.length === 0) {
    return (
      <div className="h-14 flex items-center px-4 text-gray-600 text-sm">
        No active plan
      </div>
    )
  }

  const totalMachines = result.nodes.reduce((sum, n) => sum + n.machineCountCeil, 0)
  const totalPower = result.nodes.reduce((sum, n) => sum + n.powerKw, 0)

  return (
    <div className="h-auto min-h-14 flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-2 text-sm">
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-gray-400">Machines:</span>
        <span className="font-medium text-gray-100">{totalMachines}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-gray-400">Power:</span>
        <span className="font-medium text-gray-100">{fmtPower(totalPower)}</span>
      </div>

      {result.warnings.length > 0 && (
        <div className="ml-auto flex items-center gap-1 text-yellow-400 shrink-0 text-xs">
          <span>⚠</span>
          <span>{result.warnings.length} warning{result.warnings.length > 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  )
}
