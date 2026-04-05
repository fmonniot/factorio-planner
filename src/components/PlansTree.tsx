import { useState } from 'react'
import { useBlockStore, selectActiveBlock } from '../store/blockStore'
import type { SubPlan } from '../data/types'

// ---------------------------------------------------------------------------
// Single tree node
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  subPlan: SubPlan
  depth: number
  activeSubPlanId: string
  onSelect: (id: string) => void
  onAddChild: (parentId: string) => void
  onRemove: (id: string) => void
  onRename: (id: string, name: string) => void
  isRoot: boolean
}

function TreeNode({
  subPlan,
  depth,
  activeSubPlanId,
  onSelect,
  onAddChild,
  onRemove,
  onRename,
  isRoot,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(true)
  const [hovered, setHovered] = useState(false)
  const isActive = subPlan.id === activeSubPlanId
  const hasChildren = subPlan.subPlans.length > 0

  function handleRename() {
    const name = window.prompt('Sub-plan name:', subPlan.name)
    if (name !== null && name.trim()) onRename(subPlan.id, name.trim())
  }

  return (
    <div>
      <div
        className={`
          flex items-center gap-1 px-2 py-1 rounded cursor-pointer select-none
          ${isActive ? 'bg-blue-700 text-white' : 'text-gray-300 hover:bg-gray-800'}
        `}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => onSelect(subPlan.id)}
      >
        {/* Expand/collapse toggle */}
        <button
          className={`shrink-0 w-3 text-xs leading-none ${hasChildren ? '' : 'invisible'}`}
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
        >
          {expanded ? '▾' : '▸'}
        </button>

        {/* Name */}
        <span className="flex-1 text-xs truncate">{subPlan.name}</span>

        {/* Active indicator */}
        {isActive && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-white opacity-80" />}

        {/* Action buttons — show on hover */}
        {hovered && (
          <span className="flex gap-1 shrink-0" onClick={e => e.stopPropagation()}>
            <button
              title="Rename"
              className="text-gray-400 hover:text-gray-100 text-xs px-0.5"
              onClick={handleRename}
            >
              ✎
            </button>
            {!isRoot && (
              <button
                title="Delete sub-plan"
                className="text-gray-400 hover:text-red-400 text-xs px-0.5"
                onClick={() => onRemove(subPlan.id)}
              >
                ×
              </button>
            )}
          </span>
        )}
      </div>

      {/* Children */}
      {expanded && subPlan.subPlans.map(child => (
        <TreeNode
          key={child.id}
          subPlan={child}
          depth={depth + 1}
          activeSubPlanId={activeSubPlanId}
          onSelect={onSelect}
          onAddChild={onAddChild}
          onRemove={onRemove}
          onRename={onRename}
          isRoot={false}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PlansTree panel
// ---------------------------------------------------------------------------

export function PlansTree() {
  const activeBlock = useBlockStore(selectActiveBlock)
  const activeSubPlanId = useBlockStore(s => s.activeSubPlanId)
  const setActiveSubPlan = useBlockStore(s => s.setActiveSubPlan)
  const addSubPlan = useBlockStore(s => s.addSubPlan)
  const removeSubPlan = useBlockStore(s => s.removeSubPlan)
  const renameSubPlan = useBlockStore(s => s.renameSubPlan)

  if (!activeBlock) return null

  function handleAddSubPlan() {
    const name = window.prompt('Sub-plan name:', 'New sub-plan')
    if (name !== null && name.trim()) {
      addSubPlan(activeSubPlanId, name.trim())
    }
  }

  return (
    <div className="flex flex-col">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center shrink-0">
        <span className="text-sm font-medium text-gray-300">Plans</span>
        <button
          className="ml-auto text-xs bg-gray-700 hover:bg-gray-600 active:bg-gray-800 text-gray-300 px-2 py-1 rounded"
          onClick={handleAddSubPlan}
          title="Add sub-plan under current selection"
        >
          + Sub-plan
        </button>
      </div>

      {/* Tree */}
      <div className="py-1">
        <TreeNode
          subPlan={activeBlock.rootPlan}
          depth={0}
          activeSubPlanId={activeSubPlanId}
          onSelect={setActiveSubPlan}
          onAddChild={(parentId) => {
            const name = window.prompt('Sub-plan name:', 'New sub-plan')
            if (name !== null && name.trim()) addSubPlan(parentId, name.trim())
          }}
          onRemove={removeSubPlan}
          onRename={renameSubPlan}
          isRoot={true}
        />
      </div>
    </div>
  )
}
