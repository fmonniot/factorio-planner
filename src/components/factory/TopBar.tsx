import { BlockTabs } from '../BlockTabs'
import { HorizonButton } from '../HorizonPicker'
import { BlockGraphButton } from './BlockGraph'
import { TechTreeButton } from '../TechTree'
import { WorkspaceMenu } from '../WorkspaceMenu'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'

export function TopBar() {
  // The icon tools are hidden without game data, so the divider goes with them.
  const hasGameData = !!useGameDataStore(selectGameData)
  return (
    <div className="shrink-0 bg-gray-900 border-b border-gray-700">
      {/* Single row: block tabs left (tabs sitting on the bottom border), tools and workspace menu right */}
      <div className="flex items-center justify-between gap-4 px-2 h-11">
        <div className="flex items-center gap-2 min-w-0 self-stretch">
          <BlockTabs />
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <HorizonButton />
          <BlockGraphButton />
          <TechTreeButton />
          {hasGameData && <div aria-hidden className="w-px h-5 bg-gray-700 mx-1.5" />}
          <WorkspaceMenu />
        </div>
      </div>
    </div>
  )
}
