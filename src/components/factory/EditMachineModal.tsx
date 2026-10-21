import { useMemo, useState } from 'react'
import type { GameData, ModuleConfig } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useAvailableRecipeIds, useHorizon } from '../../store/horizon'
import { resolveRowMachine, withinHorizon } from '../../data/horizon'
import { availableMachinesFor, categoryLabel, defaultMachineRowCounts } from '../../data/defaultMachines'
import { Modal } from '../Modal'
import { Icon } from '../Icon'
import { isModuleAllowedInMachine, isModuleAllowedForRecipe } from './ModulePopover'

// ---------------------------------------------------------------------------
// Effect computation helpers
// ---------------------------------------------------------------------------

export interface EffectTotals {
  speed: number
  productivity: number
  consumption: number
  pollution: number
  quality: number
}

function computeModuleEffects(modules: ModuleConfig[], gameData: GameData): EffectTotals {
  const totals: EffectTotals = { speed: 0, productivity: 0, consumption: 0, pollution: 0, quality: 0 }
  for (const mc of modules) {
    const mod = gameData.modules[mc.moduleId]
    if (!mod) continue
    for (const [effect, value] of Object.entries(mod.effects)) {
      const key = effect as keyof EffectTotals
      if (key in totals) totals[key] += (value as number) * mc.count
    }
  }
  return totals
}

// eslint-disable-next-line react-refresh/only-export-components
export function applyRecipeConstraints(
  totals: EffectTotals,
  allowedEffects: string[],
  allowProductivity: boolean,
): EffectTotals {
  return {
    speed: allowedEffects.includes('speed') ? totals.speed : 0,
    productivity: allowProductivity && allowedEffects.includes('productivity') ? totals.productivity : 0,
    consumption: allowedEffects.includes('consumption') ? totals.consumption : 0,
    pollution: allowedEffects.includes('pollution') ? totals.pollution : 0,
    quality: allowedEffects.includes('quality') ? totals.quality : 0,
  }
}

function fmtEffect(value: number): string {
  const pct = Math.round(value * 100)
  return pct >= 0 ? `+${pct}%` : `${pct}%`
}

// ---------------------------------------------------------------------------
// EffectsPanel
// ---------------------------------------------------------------------------

export interface EffectsPanelProps {
  label: string
  totals: EffectTotals
  showQuality: boolean
}

export function EffectsPanel({ label, totals, showQuality }: EffectsPanelProps) {
  const rows: { key: keyof EffectTotals; display: string }[] = [
    { key: 'speed', display: 'Speed' },
    { key: 'productivity', display: 'Productivity' },
    { key: 'consumption', display: 'Energy use' },
    { key: 'pollution', display: 'Pollution' },
    ...(showQuality ? [{ key: 'quality' as keyof EffectTotals, display: 'Quality' }] : []),
  ]

  const hasAny = rows.some(r => totals[r.key] !== 0)

  return (
    <div className="bg-gray-800 rounded p-2 flex-1 min-w-0">
      <div className="text-gray-400 text-[10px] uppercase tracking-wide mb-1.5">{label}</div>
      {hasAny ? (
        <div className="space-y-0.5">
          {rows.map(r => {
            const v = totals[r.key]
            if (v === 0) return null
            return (
              <div key={r.key} className="flex justify-between gap-2 text-xs">
                <span className="text-gray-400">{r.display}:</span>
                <span className={v > 0 ? 'text-green-400' : 'text-red-400'}>{fmtEffect(v)}</span>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="text-gray-600 text-xs italic">No active effects</div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EditMachineModal
// ---------------------------------------------------------------------------

export interface EditMachineModalProps {
  nodeId: string
  recipeId: string
  recipeCategory: string
  machineId: string | undefined
  machineCountCeil: number
  modules: ModuleConfig[]
  gameData: GameData
  onClose: () => void
}

export function EditMachineModal({
  nodeId,
  recipeId,
  recipeCategory,
  machineId,
  machineCountCeil,
  modules,
  gameData,
  onClose,
}: EditMachineModalProps) {
  const updateNodeMachine = useBlockStore(s => s.updateNodeMachine)
  const updateNodeModules = useBlockStore(s => s.updateNodeModules)
  const updateNodeRecipe = useBlockStore(s => s.updateNodeRecipe)
  const setDefaultMachine = useBlockStore(s => s.setDefaultMachine)
  const blocks = useBlockStore(s => s.blocks)
  const requestDefaultMachines = useUiStore(s => s.requestDefaultMachines)
  const available = useAvailableRecipeIds()
  const horizon = useHorizon(gameData)

  const [showMachinePicker, setShowMachinePicker] = useState(false)
  const [addModuleId, setAddModuleId] = useState('')

  const row = resolveRowMachine(gameData, horizon, recipeCategory, machineId)
  const { machine } = row
  const recipe = gameData.recipes[recipeId]

  const machineSlots = machine?.moduleSlots ?? 0
  const usedSlots = modules.reduce((sum, m) => sum + m.count, 0)
  const remaining = machineSlots - usedSlots

  // Available machines for this recipe category
  const availableMachines = availableMachinesFor(gameData, horizon, recipeCategory)

  const defaultMachineId = horizon.defaultMachines[recipeCategory]
  const defaultMachineName = defaultMachineId ? gameData.machines[defaultMachineId]?.name : undefined
  const defaultRowCounts = useMemo(() => defaultMachineRowCounts(blocks, gameData), [blocks, gameData])
  const defaultRowCount = defaultRowCounts.get(recipeCategory) ?? 0

  // Alternate recipes
  const primaryItemId = recipe?.mainProduct ?? recipe?.products[0]?.itemId
  const altRecipes = primaryItemId
    ? Object.values(gameData.recipes).filter(
        r => !r.hidden && r.id !== recipeId && r.products.some(p => p.itemId === primaryItemId) &&
          (available === null || available.has(r.id))
      )
    : []

  // Allowed modules for this machine + recipe
  const allowedModules = Object.values(gameData.modules).filter(
    m =>
      machine &&
      isModuleAllowedInMachine(m, machine) &&
      isModuleAllowedForRecipe(m, recipeId) &&
      withinHorizon(horizon.moduleIds, m.id),
  )
  const existingIds = new Set(modules.map(m => m.moduleId))
  const addableModules = allowedModules.filter(m => !existingIds.has(m.id))

  // Effects computation
  const machineEffects = computeModuleEffects(modules, gameData)
  const recipeEffects = applyRecipeConstraints(
    machineEffects,
    machine?.allowedEffects ?? [],
    recipe?.allowProductivity ?? false,
  )
  const showQuality =
    (machine?.allowedEffects.includes('quality') ?? false) && machineEffects.quality !== 0

  function selectMachine(id: string | undefined) {
    updateNodeMachine(nodeId, id)
    setShowMachinePicker(false)
  }

  function makeDefault(id: string) {
    setDefaultMachine(recipeCategory, id)
    if (machineId !== undefined) updateNodeMachine(nodeId, undefined)
    setShowMachinePicker(false)
  }

  function openAllDefaults() {
    onClose()
    requestDefaultMachines(recipeCategory)
  }

  function selectRecipe(newRecipeId: string) {
    updateNodeRecipe(nodeId, newRecipeId)
    setShowMachinePicker(false)
  }

  function adjustCount(moduleId: string, delta: number) {
    const current = modules.find(m => m.moduleId === moduleId)?.count ?? 0
    const next = current + delta
    if (next <= 0) {
      updateNodeModules(nodeId, modules.filter(m => m.moduleId !== moduleId))
    } else if (delta > 0 && remaining < 1) {
      // slots full, no-op
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

  return (
    <Modal onClose={onClose} className="w-[480px] max-w-[95vw] max-h-[90vh] overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
        <h2 className="text-sm font-semibold text-gray-200">Edit machine</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-500 hover:text-gray-200 text-lg leading-none"
          title="Close"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      {recipe && (
        <div className="px-4 py-1.5 text-xs text-gray-500 border-b border-gray-800">
          Configure the machine for &apos;{recipe.name}&apos;
        </div>
      )}

      <div className="px-4 py-3 space-y-4">
        {/* Machine section */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Machine</div>
          <button
            type="button"
            onClick={() => setShowMachinePicker(p => !p)}
            className="flex items-center gap-2 w-full bg-gray-800 hover:bg-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
          >
            {machine?.iconPath ? (
              <Icon iconPath={machine.iconPath} alt={machine.name} className="w-[30px] h-[30px] object-contain shrink-0" />
            ) : (
              <span className="w-[30px] h-[30px] bg-gray-700 rounded flex items-center justify-center text-[9px] text-gray-400 shrink-0">?</span>
            )}
            {row.noMachineInHorizon ? (
              <span data-testid="no-machine-in-horizon" className="flex-1 text-left text-amber-400">
                No machine within research horizon
              </span>
            ) : (
              <span className="flex-1 text-left">
                {machine?.name ?? 'Default'}
                {row.beyondHorizon && (
                  <>
                    {' '}
                    <span data-testid="beyond-horizon" className="text-[10px] text-amber-400">Beyond research horizon</span>
                  </>
                )}
              </span>
            )}
            <span className="text-gray-500 text-xs">×{machineCountCeil} machines</span>
            <span className="text-gray-500 text-xs">▾</span>
          </button>

          {showMachinePicker && (
            <div className="mt-1 bg-gray-800 border border-gray-700 rounded p-1.5 space-y-1 max-h-40 overflow-y-auto">
              <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 mb-1">Select machine</div>
              <button
                onClick={() => selectMachine(undefined)}
                className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 ${!machineId ? 'text-teal-400' : 'text-gray-300'}`}
              >
                {defaultMachineName ? `Default (${defaultMachineName})` : 'Default'}
              </button>
              {availableMachines.length === 0 && (
                <div data-testid="machine-picker-empty" className="px-2 py-1 text-xs text-gray-500 italic">
                  No machine for this recipe within the research horizon. Widen the horizon to choose one.
                </div>
              )}
              {availableMachines.map(m => (
                <div key={m.id} className="group flex items-center">
                  <button
                    data-testid="machine-option"
                    data-machine-id={m.id}
                    onClick={() => selectMachine(m.id)}
                    className={`flex-1 min-w-0 text-left px-2 py-1 rounded text-xs hover:bg-gray-700 flex items-center gap-1.5 ${m.id === machineId ? 'text-teal-400' : 'text-gray-300'}`}
                  >
                    {m.iconPath && (
                      <Icon iconPath={m.iconPath} alt={m.name} className="w-5 h-5 object-contain shrink-0" />
                    )}
                    {m.name}
                  </button>
                  {m.id === defaultMachineId ? (
                    <span data-testid="default-machine-badge" className="px-1.5 text-[10px] text-gray-500">default</span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Make ${m.name} the ${categoryLabel(recipeCategory)} default`}
                      onClick={() => makeDefault(m.id)}
                      className="px-1.5 py-0.5 rounded text-[10px] text-teal-400 hover:bg-gray-700 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    >
                      Make default
                    </button>
                  )}
                </div>
              ))}
              <div
                data-testid="default-machine-usage"
                className="flex items-center justify-between gap-2 px-2 pt-1 border-t border-gray-700 mt-1 text-[10px] text-gray-500"
              >
                <span>
                  {categoryLabel(recipeCategory)} default is used by {defaultRowCount} {defaultRowCount === 1 ? 'row' : 'rows'}
                </span>
                <button type="button" onClick={openAllDefaults} className="text-teal-400 hover:underline">
                  All defaults…
                </button>
              </div>
              {altRecipes.length > 0 && (
                <>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 pt-1 border-t border-gray-700 mt-1">Alternate recipe</div>
                  {altRecipes.map(r => (
                    <button
                      key={r.id}
                      onClick={() => selectRecipe(r.id)}
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 text-gray-300"
                    >
                      {r.name}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Modules section */}
        {(machineSlots > 0 || modules.length > 0) && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] uppercase tracking-wide text-gray-500">Modules</div>
              <div className="text-[10px] text-gray-600">{usedSlots} / {machineSlots} slots used</div>
            </div>

            <div className="space-y-1">
              {modules.map(mc => {
                const mod = gameData.modules[mc.moduleId]
                return (
                  <div key={mc.moduleId} className="flex items-center gap-2 bg-gray-800 rounded px-2 py-1">
                    {mod?.iconPath ? (
                      <Icon iconPath={mod.iconPath} alt={mod.name} className="w-[25px] h-[25px] object-contain shrink-0" />
                    ) : (
                      <span className="w-[25px] h-[25px] bg-gray-700 rounded flex items-center justify-center text-[8px] text-gray-400 shrink-0">M</span>
                    )}
                    <span className="flex-1 text-xs text-gray-300 truncate" title={mod?.name ?? mc.moduleId}>
                      {mod?.name ?? mc.moduleId}
                    </span>
                    {!withinHorizon(horizon.moduleIds, mc.moduleId) && (
                      <span data-testid="beyond-horizon" className="text-[10px] text-amber-400">Beyond research horizon</span>
                    )}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => adjustCount(mc.moduleId, -1)}
                        className="text-gray-500 hover:text-red-400 w-5 h-5 flex items-center justify-center rounded hover:bg-gray-700 text-sm leading-none"
                        aria-label={`Remove one ${mod?.name}`}
                      >
                        −
                      </button>
                      <span className="text-gray-200 text-xs w-4 text-center tabular-nums">{mc.count}</span>
                      <button
                        onClick={() => adjustCount(mc.moduleId, 1)}
                        disabled={remaining < 1}
                        className="text-gray-500 hover:text-gray-200 w-5 h-5 flex items-center justify-center rounded hover:bg-gray-700 text-sm leading-none disabled:opacity-30"
                        aria-label={`Add one ${mod?.name}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                )
              })}

              {remaining > 0 && addableModules.length > 0 && (
                <div className="flex gap-1.5 mt-1">
                  <select
                    value={addModuleId}
                    onChange={e => setAddModuleId(e.target.value)}
                    className="flex-1 bg-gray-800 border border-gray-700 text-gray-200 rounded px-1.5 py-1 text-xs outline-none focus:border-gray-500"
                  >
                    <option value="">— add module —</option>
                    {addableModules.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <button
                    onClick={addModule}
                    disabled={!addModuleId}
                    className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs px-2.5 py-1 rounded disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Effects panels */}
        {modules.length > 0 && (
          <div className="flex gap-2">
            <EffectsPanel label="Module effects" totals={machineEffects} showQuality={showQuality} />
            <EffectsPanel label="Recipe effects" totals={recipeEffects} showQuality={showQuality} />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end px-4 py-2.5 border-t border-gray-700">
        <button
          type="button"
          onClick={onClose}
          className="bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm px-4 py-1.5 rounded"
        >
          Close
        </button>
      </div>
    </Modal>
  )
}
