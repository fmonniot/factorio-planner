import { useSolverStore, selectSolverResult } from '../store/solverStore'
import { useGameDataStore, selectGameData } from '../store/gameDataStore'

function fmtPower(kw: number): string {
  if (kw >= 1000) return `${(kw / 1000).toFixed(2)} MW`
  return `${kw.toFixed(0)} kW`
}

function fmtRate(rate: number): string {
  if (rate >= 100) return rate.toFixed(0)
  if (rate >= 10) return rate.toFixed(1)
  return rate.toFixed(2)
}

export function SummaryBar() {
  const result = useSolverStore(selectSolverResult)
  const gameData = useGameDataStore(selectGameData)

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
      {/* Aggregate stats */}
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-gray-400">Machines:</span>
        <span className="font-medium text-gray-100">{totalMachines}</span>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-gray-400">Power:</span>
        <span className="font-medium text-gray-100">{fmtPower(totalPower)}</span>
      </div>

      {/* Raw resource inputs */}
      {result.unsatisfied.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-gray-400 shrink-0">Raw inputs:</span>
          {result.unsatisfied.map(({ itemId, rate }) => {
            const name = gameData?.items[itemId]?.name ?? itemId
            return (
              <span
                key={itemId}
                className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded"
              >
                {name} {fmtRate(rate)}/min
              </span>
            )
          })}
        </div>
      )}

      {/* Solver warnings badge */}
      {result.warnings.length > 0 && (
        <div className="ml-auto flex items-center gap-1 text-yellow-400 shrink-0 text-xs">
          <span>⚠</span>
          <span>
            {result.warnings.length} warning{result.warnings.length > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}
