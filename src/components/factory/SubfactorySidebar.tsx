import { useState } from 'react'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import type { SubPlan } from '../../data/types'

// ---------------------------------------------------------------------------
// SubfactorySidebar
//
// Flat list of top-level subplans of the active block's root plan.
// Selecting a row navigates to it (sets floor path + syncs activeSubPlanId).
// ---------------------------------------------------------------------------

export function SubfactorySidebar() {
  const activeBlock = useBlockStore(selectActiveBlock)
  const activeSubPlanId = useBlockStore(s => s.activeSubPlanId)
  const addSubPlan = useBlockStore(s => s.addSubPlan)
  const removeSubPlan = useBlockStore(s => s.removeSubPlan)
  const renameSubPlan = useBlockStore(s => s.renameSubPlan)
  const setActiveSubPlan = useBlockStore(s => s.setActiveSubPlan)
  const setFloorPath = useUiStore(s => s.setFloorPath)
  const resetFloor = useUiStore(s => s.resetFloor)

  const [search, setSearch] = useState('')

  if (!activeBlock) return null

  const rootPlan = activeBlock.rootPlan
  const subPlans: SubPlan[] = rootPlan.subPlans

  const filtered = search.trim()
    ? subPlans.filter(sp => sp.name.toLowerCase().includes(search.toLowerCase()))
    : subPlans

  function selectSubfactory(subPlanId: string) {
    resetFloor()
    setActiveSubPlan(subPlanId)
    setFloorPath([subPlanId])
  }

  function handleAdd() {
    const name = window.prompt('Subfactory name:', 'New Subfactory')
    if (name?.trim()) {
      addSubPlan(rootPlan.id, name.trim())
    }
  }

  function handleRename(sp: SubPlan) {
    const name = window.prompt('Rename subfactory:', sp.name)
    if (name?.trim()) renameSubPlan(sp.id, name.trim())
  }

  function handleDelete(sp: SubPlan) {
    if (!window.confirm(`Delete "${sp.name}"?`)) return
    removeSubPlan(sp.id)
    if (activeSubPlanId === sp.id) {
      // Fall back to root plan
      setActiveSubPlan(rootPlan.id)
      resetFloor()
    }
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 border-r border-gray-700 w-56 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Subfactories</span>
        <button
          type="button"
          onClick={handleAdd}
          className="text-gray-500 hover:text-gray-200 text-lg leading-none"
          title="Add subfactory"
        >
          +
        </button>
      </div>

      {/* Subfactory list */}
      <div className="flex-1 overflow-y-auto py-1">
        {subPlans.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-600 text-center">
            No subfactories yet
          </div>
        )}
        {filtered.map(sp => {
          const isActive = activeSubPlanId === sp.id
          return (
            <div
              key={sp.id}
              className={`group flex items-center gap-1 px-3 py-1.5 cursor-pointer text-xs ${
                isActive
                  ? 'bg-orange-900/40 text-orange-300'
                  : 'text-gray-300 hover:bg-gray-800'
              }`}
              onClick={() => selectSubfactory(sp.id)}
            >
              <span className="flex-1 truncate">{sp.name}</span>
              <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); handleRename(sp) }}
                  className="text-gray-500 hover:text-gray-200 px-0.5"
                  title="Rename"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); handleDelete(sp) }}
                  className="text-gray-500 hover:text-red-400 px-0.5"
                  title="Delete"
                >
                  ×
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Search */}
      <div className="shrink-0 px-2 py-2 border-t border-gray-800">
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-gray-800 text-gray-200 text-xs rounded px-2 py-1 border border-gray-700 outline-none focus:border-gray-500 placeholder-gray-600"
        />
      </div>
    </div>
  )
}
