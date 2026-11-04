import { useEffect, useMemo, useRef, useState } from 'react'
import type { GameData, ModuleConfig, Recipe } from '../../data/types'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useAvailableRecipeIds, useHorizon } from '../../store/horizon'
import { resolveRowMachine, withinHorizon } from '../../data/horizon'
import { acceptedFuels, burnsFuel, defaultFuel, hasFuelData, resolveRowFuel } from '../../data/fuel'
import { groupPowerRecipes, powerInputItemId, type RecipeEntry } from '../../data/powerFuelGroups'
import { availableMachinesFor, categoryLabel, defaultMachineRowCounts } from '../../data/defaultMachines'
import { Modal } from '../Modal'
import { Icon } from '../Icon'
import { NeighbourSection } from './NeighbourSection'
import { countRecipeRows } from './recipeAreas'
import { isModuleAllowedInMachine, isModuleAllowedForRecipe, isModuleAllowedByProductivity } from './moduleRules'

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

/** "4 MJ" for a fuel value in kJ. */
function fmtFuelValue(kj: number): string {
  return kj >= 1000 ? `${+(kj / 1000).toPrecision(4)} MJ` : `${+kj.toPrecision(4)} kJ`
}

function BeyondTag() {
  return <span data-testid="beyond-horizon" className="ml-1 text-[10px] text-amber-400">Beyond research horizon</span>
}

/** The Alternate recipe list: plain recipes, and one expandable entry per machine with several power (per-fuel) recipes. */
function AlternateRecipeList({ entries, gameData, available, onSelect }: {
  entries: RecipeEntry[]
  gameData: GameData
  /** Recipes inside the research horizon; null = no limit. Power recipes beyond it are listed and flagged. */
  available: ReadonlySet<string> | null
  onSelect: (recipeId: string) => void
}) {
  const [openMachineId, setOpenMachineId] = useState<string | null>(null)
  const openRef = useRef<HTMLDivElement>(null)
  const isBeyond = (r: Recipe) => !!available && !available.has(r.id)
  // The list sits inside a short scroll area: bring the expanded fuels into view.
  useEffect(() => {
    if (openMachineId) openRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [openMachineId])
  return (
    <>
      {entries.map(e => {
        if (e.kind === 'recipe') {
          return (
            <button
              key={e.recipe.id}
              data-testid="alt-recipe"
              data-recipe-id={e.recipe.id}
              onClick={() => onSelect(e.recipe.id)}
              className="w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 text-gray-300"
            >
              {e.recipe.name}
              {isBeyond(e.recipe) && <BeyondTag />}
            </button>
          )
        }
        const machine = gameData.machines[e.machineId]
        const open = openMachineId === e.machineId
        return (
          <div key={`group:${e.machineId}`}>
            <button
              type="button"
              data-testid="alt-recipe-group"
              data-machine-id={e.machineId}
              data-recipe-count={e.recipes.length}
              aria-expanded={open}
              onClick={() => setOpenMachineId(open ? null : e.machineId)}
              className="w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 text-gray-300 flex items-center gap-1.5"
            >
              {machine?.iconPath && (
                <Icon iconPath={machine.iconPath} alt={machine.name} className="w-5 h-5 object-contain shrink-0" />
              )}
              <span className="flex-1">{machine?.name ?? e.machineId}</span>
              <span className="text-gray-500">({e.recipes.length} recipes)</span>
              <span className="text-gray-500">{open ? '▾' : '▸'}</span>
            </button>
            {open && (
              <div ref={openRef} className="ml-3 border-l border-gray-700 pl-1">
                {e.recipes.map(r => {
                  const fuel = gameData.items[powerInputItemId(r) ?? '']
                  return (
                    <button
                      key={r.id}
                      data-testid="alt-recipe-fuel"
                      data-recipe-id={r.id}
                      data-beyond-horizon={isBeyond(r) ? 'true' : undefined}
                      onClick={() => onSelect(r.id)}
                      className="w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 text-gray-300 flex items-center gap-1.5"
                    >
                      {fuel?.iconPath && (
                        <Icon iconPath={fuel.iconPath} alt={fuel.name} className="w-5 h-5 object-contain shrink-0" />
                      )}
                      <span className="flex-1">{fuel?.name ?? powerInputItemId(r) ?? r.name}{isBeyond(r) && <BeyondTag />}</span>
                      {fuel?.type === 'item' && fuel.fuelValueKj !== undefined && (
                        <span className="text-gray-500">{fmtFuelValue(fuel.fuelValueKj)}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
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
//
// Every valid change is saved immediately through a store action (the footer
// only has Close). "Apply to every row of this recipe" copies machine, modules and
// fuel, not the reactor neighbour count.
// ---------------------------------------------------------------------------

export interface EditMachineModalProps {
  nodeId: string
  recipeId: string
  recipeCategory: string
  machineId: string | undefined
  machineCountCeil: number
  modules: ModuleConfig[]
  neighbourCount?: number
  fuelItemId?: string
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
  neighbourCount,
  fuelItemId,
  gameData,
  onClose,
}: EditMachineModalProps) {
  const updateNodeMachine = useBlockStore(s => s.updateNodeMachine)
  const updateNodeModules = useBlockStore(s => s.updateNodeModules)
  const updateNodeFuel = useBlockStore(s => s.updateNodeFuel)
  const updateNodeRecipe = useBlockStore(s => s.updateNodeRecipe)
  const setDefaultMachine = useBlockStore(s => s.setDefaultMachine)
  const recipeRowCount = useBlockStore(s => {
    const b = selectActiveBlock(s)
    return b ? countRecipeRows(b.rootPlan, recipeId) : 0
  })
  const applyRowSettingsToRecipe = useBlockStore(s => s.applyRowSettingsToRecipe)
  const blocks = useBlockStore(s => s.blocks)
  const requestDefaultMachines = useUiStore(s => s.requestDefaultMachines)
  const available = useAvailableRecipeIds()
  const horizon = useHorizon(gameData)

  const [showMachinePicker, setShowMachinePicker] = useState(false)
  const [showFuelPicker, setShowFuelPicker] = useState(false)
  const [addModuleId, setAddModuleId] = useState('')

  const row = resolveRowMachine(gameData, horizon, recipeCategory, machineId)
  const { machine } = row
  const recipe = gameData.recipes[recipeId]

  const neighbourBonus = machine?.neighbourBonus ?? 0

  const machineSlots = machine?.moduleSlots ?? 0
  const usedSlots = modules.reduce((sum, m) => sum + m.count, 0)
  const remaining = machineSlots - usedSlots

  // Available machines for this recipe category
  const availableMachines = availableMachinesFor(gameData, horizon, recipeCategory)

  const defaultMachineId = horizon.defaultMachines[recipeCategory]
  const defaultMachineName = defaultMachineId ? gameData.machines[defaultMachineId]?.name : undefined
  const defaultRowCounts = useMemo(() => defaultMachineRowCounts(blocks, gameData), [blocks, gameData])
  const defaultRowCount = defaultRowCounts.get(recipeCategory) ?? 0

  // Fuel (burner machines): the explicit choice or the default, and the accepted fuels within the horizon.
  const isBurner = burnsFuel(machine)
  const fuel = resolveRowFuel(gameData, machine, fuelItemId)
  const fuelDefault = machine ? defaultFuel(gameData, machine) : undefined
  const fuelOptions = machine ? acceptedFuels(gameData, machine).filter(f => withinHorizon(horizon.itemIds, f.id)) : []
  // A machine with fuel categories whose every accepted fuel is filtered out (burnt result, hidden) is not "no data".
  const hasData = hasFuelData(gameData, machine)

  // Alternate recipes
  const primaryItemId = recipe?.mainProduct ?? recipe?.products[0]?.itemId
  const altRecipes = useMemo(
    () => primaryItemId
      ? Object.values(gameData.recipes).filter(
          r => !r.hidden && r.id !== recipeId && r.products.some(p => p.itemId === primaryItemId) &&
            (available === null || r.power || available.has(r.id))
        )
      : [],
    [gameData, primaryItemId, recipeId, available],
  )
  // A machine's per-fuel power recipes collapse into one expandable entry.
  const altEntries = useMemo(() => groupPowerRecipes(altRecipes), [altRecipes])

  // Allowed modules for this machine + recipe
  const allowedModules = Object.values(gameData.modules).filter(
    m =>
      machine &&
      isModuleAllowedInMachine(m, machine) &&
      isModuleAllowedForRecipe(m, recipeId) &&
      isModuleAllowedByProductivity(m, recipe?.allowProductivity ?? false) &&
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

  function selectFuel(id: string | undefined) {
    updateNodeFuel(nodeId, id)
    setShowFuelPicker(false)
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
                  <AlternateRecipeList entries={altEntries} gameData={gameData} available={available} onSelect={selectRecipe} />
                </>
              )}
            </div>
          )}
        </div>

        {/* Fuel section (burner machines) */}
        {isBurner && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Fuel</div>
            {fuel ? (
              <>
                <button
                  type="button"
                  data-testid="fuel-button"
                  onClick={() => setShowFuelPicker(p => !p)}
                  className="flex items-center gap-2 w-full bg-gray-800 hover:bg-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
                >
                  {fuel.iconPath ? (
                    <Icon iconPath={fuel.iconPath} alt={fuel.name} className="w-[30px] h-[30px] object-contain shrink-0" />
                  ) : (
                    <span className="w-[30px] h-[30px] bg-gray-700 rounded flex items-center justify-center text-[9px] text-gray-400 shrink-0">?</span>
                  )}
                  <span className="flex-1 text-left">
                    {fuel.name}
                    {!withinHorizon(horizon.itemIds, fuel.id) && (
                      <>
                        {' '}
                        <span data-testid="beyond-horizon" className="text-[10px] text-amber-400">Beyond research horizon</span>
                      </>
                    )}
                  </span>
                  <span className="text-gray-500 text-xs">{fmtFuelValue(fuel.fuelValueKj ?? 0)}</span>
                  <span className="text-gray-500 text-xs">▾</span>
                </button>
                {showFuelPicker && (
                  <div className="mt-1 bg-gray-800 border border-gray-700 rounded p-1.5 space-y-1 max-h-40 overflow-y-auto">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500 px-1 mb-1">Select fuel</div>
                    <button
                      data-testid="fuel-default"
                      onClick={() => selectFuel(undefined)}
                      className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 ${fuelItemId === undefined ? 'text-teal-400' : 'text-gray-300'}`}
                    >
                      {fuelDefault ? `Default (${fuelDefault.name})` : 'Default'}
                    </button>
                    {fuelOptions.map(f => (
                      <button
                        key={f.id}
                        data-testid="fuel-option"
                        data-item-id={f.id}
                        onClick={() => selectFuel(f.id)}
                        className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 flex items-center gap-1.5 ${f.id === fuelItemId ? 'text-teal-400' : 'text-gray-300'}`}
                      >
                        {f.iconPath && (
                          <Icon iconPath={f.iconPath} alt={f.name} className="w-5 h-5 object-contain shrink-0" />
                        )}
                        <span className="flex-1">{f.name}</span>
                        <span className="text-gray-500">{fmtFuelValue(f.fuelValueKj ?? 0)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div data-testid="no-fuel-data" className="px-2 py-1.5 text-xs text-gray-500 italic">
                {hasData ? 'No usable fuel for this machine' : 'No fuel data in this data set'}
              </div>
            )}
          </div>
        )}

        {/* Neighbours section (reactors) */}
        {neighbourBonus > 0 && (
          <NeighbourSection nodeId={nodeId} neighbourCount={neighbourCount} neighbourBonus={neighbourBonus} />
        )}

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
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-700">
        {recipeRowCount > 1 && (
          <button
            type="button"
            data-testid="apply-to-recipe-rows"
            title={`Copy this row's machine, fuel and modules to the other ${recipeRowCount - 1} row${recipeRowCount === 2 ? '' : 's'} of ${recipe?.name}`}
            onClick={() => applyRowSettingsToRecipe(nodeId, 'machine')}
            className="text-xs text-teal-400 hover:text-teal-300"
          >
            Apply to every row of this recipe ({recipeRowCount})
          </button>
        )}
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
