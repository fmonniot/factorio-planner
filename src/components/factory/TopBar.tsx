import { BlockTabs } from '../BlockTabs'
import { GameDataSelector, ExportPlanButton } from '../GameDataSelector'

export function TopBar() {
  return (
    <div className="shrink-0 bg-gray-900 border-b border-gray-700">
      {/* Single row: block tabs left, controls right */}
      <div className="flex items-center justify-between px-2 h-10">
        <BlockTabs />
        <div className="flex items-center gap-2 shrink-0">
          <ExportPlanButton />
          <GameDataSelector />
        </div>
      </div>
    </div>
  )
}
