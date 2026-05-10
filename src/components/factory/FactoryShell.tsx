import { TopBar } from './TopBar'
import { FactorySummary } from './FactorySummary'
import { ProductionTable } from './ProductionTable'

export function FactoryShell() {
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 overflow-hidden">
      <TopBar />
      <main className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <FactorySummary />
        <ProductionTable />
      </main>
    </div>
  )
}
