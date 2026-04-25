import { useUiStore } from '../../store/uiStore'
import { useBlockStore } from '../../store/blockStore'
import { findSubPlan } from '../../store/blockStore'

export function FloorBreadcrumb() {
  const floorPath = useUiStore(s => s.activeFloorPath)
  const popFloor = useUiStore(s => s.popFloor)
  const resetFloor = useUiStore(s => s.resetFloor)

  const activeBlock = useBlockStore(s => s.blocks.find(b => b.id === s.activeBlockId))

  if (floorPath.length === 0) return null

  const level = floorPath.length + 1

  // Resolve name of the current floor's subplan
  const currentId = floorPath[floorPath.length - 1]
  const currentName = activeBlock
    ? findSubPlan(activeBlock.rootPlan, currentId)?.name ?? currentId
    : currentId

  return (
    <div className="flex items-center gap-2 text-xs text-gray-400 px-3 py-1 border-b border-gray-800 bg-gray-900/50">
      <span className="text-gray-500">Level {level}</span>
      <span className="text-gray-600">·</span>
      <span className="text-gray-300 truncate">{currentName}</span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={popFloor}
          className="hover:text-gray-200 px-1"
          title="Go up one level"
        >
          ↑ Up
        </button>
        <button
          type="button"
          onClick={resetFloor}
          className="hover:text-gray-200 px-1"
          title="Jump to top level"
        >
          ⤒ Top
        </button>
      </div>
    </div>
  )
}
