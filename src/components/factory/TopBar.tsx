import { BlockTabs } from '../BlockTabs'
import { HorizonButton } from '../HorizonPicker'
import { BlockGraphButton } from './BlockGraph'
import { TechTreeButton } from '../TechTree'
import { GameDataSelector, ExportPlanButton, ImportPlanButton } from '../GameDataSelector'

export function TopBar() {
  return (
    <div className="shrink-0 bg-gray-900 border-b border-gray-700">
      {/* Single row: block tabs left (sitting on the bottom border), controls right */}
      <div className="flex items-center justify-between gap-4 px-2 h-10">
        <BlockTabs />
        <div className="flex items-center gap-2 shrink-0">
          <BlockGraphButton />
          <HorizonButton />
          <TechTreeButton />
          <ExportPlanButton />
          <ImportPlanButton />
          <GameDataSelector />
        </div>
      </div>
    </div>
  )
}
