import { BlockTabs } from '../BlockTabs'
import { GameDataSelector, ExportPlanButton } from '../GameDataSelector'

export function TopBar() {
  return (
    <div className="shrink-0 bg-gray-900 border-b border-gray-700">
      {/* Title bar */}
      <div className="flex items-center justify-between px-4 h-10 border-b border-gray-800">
        <span className="font-semibold text-gray-100 text-sm">Factorio Planner</span>
        <div className="flex items-center gap-2">
          <ExportPlanButton />
          <GameDataSelector />
        </div>
      </div>
      {/* Block tabs */}
      <BlockTabs />
    </div>
  )
}
