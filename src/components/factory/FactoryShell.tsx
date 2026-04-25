import { TopBar } from './TopBar'
import { SubfactorySidebar } from './SubfactorySidebar'
import { FactorySummary } from './FactorySummary'
import { ProductionTable } from './ProductionTable'
import { BalancedItemsFooter } from './BalancedItemsFooter'

export function FactoryShell() {
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* Top bar: title + block tabs */}
      <TopBar />

      {/* Two-pane body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: subfactory sidebar */}
        <SubfactorySidebar />

        {/* Right: summary header + production table + footer */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <FactorySummary />
          <ProductionTable />
          <BalancedItemsFooter />
        </div>
      </div>
    </div>
  )
}
