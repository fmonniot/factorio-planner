import { useState } from 'react'
import type { BeaconConfig, GameData, GameRecipeNode } from '../../../data/types'
import { useBlockStore, selectActiveBlock } from '../../../store/blockStore'
import { useHorizon } from '../../../store/horizon'
import { withinHorizon } from '../../../data/horizon'
import { Icon } from '../../Icon'
import { countRecipeRows } from '../recipeAreas'
import { isModuleAllowedForBeaconRow } from '../moduleRules'
import { beaconModuleOptions } from './moduleOptions'
import { Picker, PickerRow, PickerEmpty } from '../Picker'
import { PickerTrigger } from '../PickerTrigger'
import { PanelSection, BeyondTag, Chevron } from './PanelParts'
import { ModuleSlotRow } from './ModuleSlotRow'
import { availableBeacons, defaultBeaconConfig } from './beaconDefaults'
import { beaconEffects, applyRecipeConstraints, fmtEffect } from './effects'
import { resolveRowMachine } from '../../../data/horizon'
import { rowMachine } from '../../../solver/effects'

/** Configurations a row may hold until the data model supports several (see the multiple beacon configurations initiative). */
export const MAX_BEACON_CONFIGS = 1
export const ONE_BEACON_CONFIG_TITLE = 'One beacon configuration per recipe for now'

/** What one configuration contributes, as text: "speed +50%, energy +70%". */
function contribution(applied: ReturnType<typeof beaconEffects>): string {
  const parts: string[] = []
  if (applied.speed !== 0) parts.push(`speed ${fmtEffect(applied.speed)}`)
  if (applied.productivity !== 0) parts.push(`productivity ${fmtEffect(applied.productivity)}`)
  if (applied.consumption !== 0) parts.push(`energy ${fmtEffect(applied.consumption)}`)
  return parts.length > 0 ? parts.join(', ') : 'no effect'
}

function BeaconCard({ index, beacon, node, gameData, onChange, onRemove }: {
  index: number
  beacon: BeaconConfig
  node: GameRecipeNode
  gameData: GameData
  onChange: (next: BeaconConfig) => void
  onRemove: () => void
}) {
  const horizon = useHorizon(gameData)

  const recipe = gameData.recipes[node.recipeId]
  const allowProductivity = recipe?.allowProductivity ?? false
  const entity = beacon.beaconId ? gameData.beacons[beacon.beaconId] : undefined
  const selectedModule = beacon.moduleId ? gameData.modules[beacon.moduleId] : undefined
  const hasBeaconData = Object.keys(gameData.beacons).length > 0
  const beacons = availableBeacons(gameData, horizon)
  const fits = (m: GameData['modules'][string]) => isModuleAllowedForBeaconRow(m, entity, node.recipeId, allowProductivity)
  const moduleOptions = beaconModuleOptions(gameData, horizon, entity, node.recipeId)
  const moduleNotAllowed = !!selectedModule && !fits(selectedModule)

  const slotCount = entity?.moduleSlots ?? beacon.modulesPerBeacon
  // The data model holds one module type per beacon: every slot of the configuration shows it.
  const filled = beacon.moduleId ? Math.min(beacon.modulesPerBeacon, slotCount) : 0
  const slots = Array.from({ length: Math.max(slotCount, 0) }, (_, i) => (i < filled ? beacon.moduleId : undefined))

  const machineAllowed = rowMachine(node, gameData)?.allowedEffects
  const applied = applyRecipeConstraints(beaconEffects(beacon, gameData), [entity?.allowedEffects, machineAllowed], allowProductivity)
  const efficiency = Math.round(beacon.distributionEfficiency * 100)

  const update = (patch: Partial<BeaconConfig>) => onChange({ ...beacon, ...patch })

  function selectBeacon(beaconId: string) {
    const e = gameData.beacons[beaconId]
    if (!e) return
    update({ beaconId, modulesPerBeacon: e.moduleSlots, distributionEfficiency: e.distributionEfficiency })
  }

  function selectModule(_slot: number, moduleId: string | undefined) {
    // Every slot of a configuration holds the same module: choosing in one slot sets them all.
    update({ moduleId })
  }

  return (
    <div data-testid="beacon-card" data-config-index={index} className="bg-gray-800 rounded p-2 space-y-2">
      <div className="flex items-center gap-2">
        <PickerTrigger
          trigger={({ open, toggle }) => (
            <button
              type="button"
              data-testid="beacon-type-button"
              aria-expanded={open}
              title={entity?.name ?? (hasBeaconData ? 'Select beacon type' : 'No beacon data')}
              aria-label={`Beacon type: ${entity?.name ?? 'none'}`}
              onClick={toggle}
              className={`flex items-center gap-1 rounded px-1 py-0.5 bg-gray-700 hover:bg-gray-600 ${beacon.beaconId && !withinHorizon(horizon.beaconIds, beacon.beaconId) ? 'ring-1 ring-amber-500' : ''}`}
            >
              {entity?.iconPath ? (
                <Icon iconPath={entity.iconPath} alt={entity.name} className="w-8 h-8 object-contain shrink-0" />
              ) : (
                <span className="w-8 h-8 bg-gray-600 rounded flex items-center justify-center text-[10px] text-gray-300 shrink-0">B</span>
              )}
              <Chevron />
            </button>
          )}
        >
          {close => (
            <Picker heading="Beacon type" onClose={close}>
              {hasBeaconData ? beacons.map(b => (
                <PickerRow
                  key={b.id}
                  name={b.name}
                  iconPath={b.iconPath || undefined}
                  selected={b.id === beacon.beaconId}
                  data-testid="beacon-option"
                  data-beacon-id={b.id}
                  onClick={() => { selectBeacon(b.id); close() }}
                />
              )) : (
                <PickerEmpty>No beacon data — re-export game data to populate.</PickerEmpty>
              )}
            </Picker>
          )}
        </PickerTrigger>
        <label className="flex items-center gap-1.5 text-xs text-gray-500">
          ×
          <input
            type="number"
            min={0}
            step={1}
            aria-label="Beacon count"
            value={beacon.beaconCount}
            onChange={e => {
              const v = parseInt(e.target.value, 10)
              if (isFinite(v) && v >= 0) update({ beaconCount: v })
            }}
            className="w-16 bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 outline-none text-right tabular-nums"
          />
        </label>
        <span className="flex-1 min-w-0 text-xs text-gray-400 truncate">
          {entity?.name ?? ''}
          {beacon.beaconId && !withinHorizon(horizon.beaconIds, beacon.beaconId) && <> <BeyondTag /></>}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove beacon configuration"
          title="Remove this beacon configuration"
          className="text-xs text-red-500 hover:text-red-400"
        >
          Remove
        </button>
      </div>

      <ModuleSlotRow
        slots={slots}
        slotCount={slotCount}
        options={moduleOptions}
        gameData={gameData}
        moduleIds={horizon.moduleIds}
        onSelect={selectModule}
        testIdPrefix="beacon-module"
        label="Beacon module slot"
      />
      <p data-testid="beacon-module-hint" className="text-[11px] text-gray-500">
        A beacon holds one module type: choosing a module fills every slot, and emptying a slot removes it from all.
      </p>
      {moduleNotAllowed && (
        <div data-testid="module-not-allowed" className="text-xs text-amber-400">
          {selectedModule?.name} cannot be inserted in {entity?.name ?? 'this beacon'}; pick another module.
        </div>
      )}

      {!hasBeaconData && (
        <div className="space-y-1.5 pt-1 border-t border-gray-700">
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-32 shrink-0">Modules/beacon</span>
            <input
              type="number" min={1} step={1} value={beacon.modulesPerBeacon}
              onChange={e => {
                const v = parseInt(e.target.value, 10)
                if (isFinite(v) && v >= 1) update({ modulesPerBeacon: v })
              }}
              className="w-16 bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 outline-none text-right tabular-nums"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-32 shrink-0">Efficiency</span>
            <input
              type="number" min={0} max={1} step={0.05} value={beacon.distributionEfficiency}
              onChange={e => {
                const v = parseFloat(e.target.value)
                if (isFinite(v) && v >= 0 && v <= 1) update({ distributionEfficiency: v })
              }}
              className="w-16 bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 outline-none text-right tabular-nums"
            />
          </label>
        </div>
      )}

      <div data-testid="beacon-summary" className="text-[11px] text-gray-500">
        {efficiency}% efficiency · {beacon.moduleId ? contribution(applied) : 'no module, so no effect'}
      </div>
    </div>
  )
}

/**
 * The Beacons section: one card per configuration, and "+ Add beacon configuration". It takes a list; the data model holds
 * at most one configuration for now (`beaconConfig`), which the caller adapts as `beaconConfig ? [beaconConfig] : []`.
 */
export function BeaconsSection({ node, configs, gameData, onChange }: {
  node: GameRecipeNode
  configs: readonly BeaconConfig[]
  gameData: GameData
  onChange: (configs: BeaconConfig[]) => void
}) {
  const applyRowSettingsToRecipe = useBlockStore(s => s.applyRowSettingsToRecipe)
  const recipeRowCount = useBlockStore(s => {
    const b = selectActiveBlock(s)
    return b ? countRecipeRows(b.rootPlan, node.recipeId) : 0
  })
  const horizon = useHorizon(gameData)
  const recipe = gameData.recipes[node.recipeId]
  const row = resolveRowMachine(gameData, horizon, recipe?.category ?? '', node.machineId)

  // Configurations have no id yet, so cards are keyed by position; bumping this on removal remounts them all, which
  // drops open popovers instead of handing them to whichever card slid into the removed one's place.
  const [generation, setGeneration] = useState(0)

  const full = configs.length >= MAX_BEACON_CONFIGS
  const nonHidden = Object.values(gameData.beacons).filter(b => !b.hidden)
  const noBeacon = nonHidden.length > 0 && !nonHidden.some(b => withinHorizon(horizon.beaconIds, b.id))
  const noModule = horizon.moduleIds !== null && !Object.keys(gameData.modules).some(id => withinHorizon(horizon.moduleIds, id))
  const blocked = row.noMachineInHorizon
    ? 'No machine within research horizon'
    : noBeacon
      ? 'No beacon within the research horizon'
      : noModule
        ? 'No module within the research horizon'
        : undefined
  const addTitle = full ? ONE_BEACON_CONFIG_TITLE : (blocked ?? 'Add a beacon configuration')

  function add() {
    const config = defaultBeaconConfig(gameData, horizon, node.recipeId)
    if (config) onChange([...configs, config])
  }

  return (
    <PanelSection title="Beacons" testId="panel-beacons" highlightKey="beacons">
      <div className="space-y-2">
        {configs.map((c, i) => (
          <BeaconCard
            key={`${generation}-${i}`}
            index={i}
            beacon={c}
            node={node}
            gameData={gameData}
            onChange={next => onChange(configs.map((x, j) => (j === i ? next : x)))}
            onRemove={() => {
              setGeneration(g => g + 1)
              onChange(configs.filter((_, j) => j !== i))
            }}
          />
        ))}
        <button
          type="button"
          data-testid="add-beacon-config"
          onClick={add}
          disabled={full || blocked !== undefined}
          title={addTitle}
          className="w-full rounded border border-dashed border-gray-600 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-500 disabled:opacity-40 disabled:hover:text-gray-400 disabled:hover:border-gray-600"
        >
          + Add beacon configuration
        </button>
      </div>
      {configs.length > 0 && recipeRowCount > 1 && (
        <div className="mt-3 pt-2 border-t border-gray-800">
          <button
            type="button"
            data-testid="apply-beacon-to-recipe-rows"
            title={`Copy this beacon to the other ${recipeRowCount - 1} row${recipeRowCount === 2 ? '' : 's'} of ${recipe?.name}`}
            onClick={() => applyRowSettingsToRecipe(node.id, 'beacon')}
            className="text-xs text-teal-400 hover:text-teal-300"
          >
            Apply to every row of this recipe ({recipeRowCount})
          </button>
        </div>
      )}
    </PanelSection>
  )
}
