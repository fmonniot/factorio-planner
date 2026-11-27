import { TopBar } from './TopBar'
import { NoPlanScreen } from './NoPlanScreen'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { usePlansStore, selectNoPlan } from '../../store/plansStore'
import { FactorySummary } from './FactorySummary'
import { ProductionTable } from './ProductionTable'
import { TooltipLayer } from '../TooltipLayer'
import { useUndoShortcuts } from './useUndoShortcuts'

export function FactoryShell() {
  useUndoShortcuts()
  // Without game data the table has its own start screen, which a plan list left over from the previous data set must not hide.
  const hasGameData = !!useGameDataStore(selectGameData)
  const noPlan = usePlansStore(selectNoPlan) && hasGameData
  return (
    <div className="relative h-dvh flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      <TopBar />
      <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
        {noPlan ? <NoPlanScreen /> : (
          <>
            <FactorySummary />
            <ProductionTable />
          </>
        )}
      </main>
      <TooltipLayer />
    </div>
  )
}
