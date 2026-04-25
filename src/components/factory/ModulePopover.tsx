import { useState } from 'react'
import type { GameData, ModuleConfig } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { Popover } from './Popover'

// ---------------------------------------------------------------------------
// Logic helpers (pure, exported for testing)
// ---------------------------------------------------------------------------

export function isModuleAllowedInMachine(
  module: { effects: Record<string, number> },
  machine: { allowedEffects: string[] },
): boolean {
  return Object.keys(module.effects).every(e => machine.allowedEffects.includes(e))
}

export function isModuleAllowedForRecipe(
  module: { limitation: string[]; limitationBlacklist: string[] },
  recipeId: string,
): boolean {
  if (module.limitation.length > 0 && !module.limitation.includes(recipeId)) return false
  if (module.limitationBlacklist.includes(recipeId)) return false
  return true
}

// ---------------------------------------------------------------------------
// ModulePopover
// ---------------------------------------------------------------------------

interface ModulePopoverProps {
  nodeId: string
  modules: ModuleConfig[]
  machineSlots: number
  allowedMachineEffects: string[]
  recipeId: string
  gameData: GameData
  onClose: () => void
}

export function ModulePopover({
  nodeId,
  modules,
  machineSlots,
  allowedMachineEffects,
  recipeId,
  gameData,
  onClose,
}: ModulePopoverProps) {
  const updateNodeModules = useBlockStore(s => s.updateNodeModules)
  const [addModuleId, setAddModuleId] = useState('')

  const usedSlots = modules.reduce((sum, m) => sum + m.count, 0)
  const remaining = machineSlots - usedSlots

  const allowedModules = Object.values(gameData.modules).filter(
    m =>
      isModuleAllowedInMachine(m, { allowedEffects: allowedMachineEffects }) &&
      isModuleAllowedForRecipe(m, recipeId),
  )

  const existingIds = new Set(modules.map(m => m.moduleId))
  const addableModules = allowedModules.filter(m => !existingIds.has(m.id))

  function adjustCount(moduleId: string, delta: number) {
    const current = modules.find(m => m.moduleId === moduleId)?.count ?? 0
    const next = current + delta
    if (next <= 0) {
      updateNodeModules(nodeId, modules.filter(m => m.moduleId !== moduleId))
    } else if (delta > 0 && remaining < 1) {
      // no-op: slots full
    } else {
      updateNodeModules(
        nodeId,
        modules.map(m => (m.moduleId === moduleId ? { ...m, count: next } : m)),
      )
    }
  }

  function addModule() {
    if (!addModuleId || remaining < 1) return
    updateNodeModules(nodeId, [...modules, { moduleId: addModuleId, count: 1 }])
    setAddModuleId('')
  }

  if (machineSlots === 0) return null

  return (
    <Popover onClose={onClose} className="w-56 p-2 text-xs space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-gray-400">Modules</span>
        <span className="text-gray-600">{usedSlots}/{machineSlots}</span>
      </div>

      {modules.length > 0 && (
        <div className="space-y-1">
          {modules.map(mc => {
            const mod = gameData.modules[mc.moduleId]
            return (
              <div key={mc.moduleId} className="flex items-center gap-1">
                <span className="flex-1 truncate text-gray-300" title={mod?.name ?? mc.moduleId}>
                  {mod?.name ?? mc.moduleId}
                </span>
                <button
                  onClick={() => adjustCount(mc.moduleId, -1)}
                  className="text-gray-500 hover:text-red-400 px-1"
                  aria-label="Remove one"
                >
                  −
                </button>
                <span className="text-gray-200 w-4 text-center tabular-nums">{mc.count}</span>
                <button
                  onClick={() => adjustCount(mc.moduleId, 1)}
                  disabled={remaining < 1}
                  className="text-gray-500 hover:text-gray-200 px-1 disabled:opacity-40"
                  aria-label="Add one"
                >
                  +
                </button>
              </div>
            )
          })}
        </div>
      )}

      {remaining > 0 && addableModules.length > 0 && (
        <div className="flex gap-1">
          <select
            value={addModuleId}
            onChange={e => setAddModuleId(e.target.value)}
            className="flex-1 bg-gray-700 text-gray-200 rounded px-1 py-0.5 border border-gray-600 outline-none text-xs"
          >
            <option value="">— add —</option>
            {addableModules.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            onClick={addModule}
            disabled={!addModuleId}
            className="bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded disabled:opacity-40"
          >
            Add
          </button>
        </div>
      )}
    </Popover>
  )
}

// ---------------------------------------------------------------------------
// Trigger cell
// ---------------------------------------------------------------------------

interface ModuleCellProps {
  nodeId: string
  modules: ModuleConfig[]
  machineSlots: number
  allowedMachineEffects: string[]
  recipeId: string
  gameData: GameData
}

export function ModuleCell(props: ModuleCellProps) {
  const [open, setOpen] = useState(false)
  const usedSlots = props.modules.reduce((sum, m) => sum + m.count, 0)

  if (props.machineSlots === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-xs text-gray-400 hover:text-gray-200"
        title="Edit modules"
      >
        [{usedSlots}/{props.machineSlots}]
      </button>
      {open && (
        <ModulePopover {...props} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}
