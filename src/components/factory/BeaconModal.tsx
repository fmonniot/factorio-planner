import { useState } from 'react'
import type { GameData, BeaconConfig } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { Modal } from '../Modal'
import { iconUrl } from '../../utils/iconUrl'
import { EffectsPanel, applyRecipeConstraints } from './EditMachineModal'
import type { EffectTotals } from './EditMachineModal'

// ---------------------------------------------------------------------------
// Beacon effects computation
// ---------------------------------------------------------------------------

function computeBeaconEffects(
  beacon: BeaconConfig,
  gameData: GameData,
): EffectTotals {
  const totals: EffectTotals = { speed: 0, productivity: 0, consumption: 0, pollution: 0, quality: 0 }
  const mod = gameData.modules[beacon.moduleId]
  if (!mod) return totals

  const beaconEntity = beacon.beaconId ? gameData.beacons[beacon.beaconId] : undefined
  const effectiveSlots = beaconEntity?.moduleSlots ?? beacon.modulesPerBeacon
  const effectiveEfficiency = beaconEntity?.distributionEfficiency ?? beacon.distributionEfficiency

  const multiplier = beacon.beaconCount * effectiveSlots * effectiveEfficiency
  for (const [effect, value] of Object.entries(mod.effects)) {
    const key = effect as keyof EffectTotals
    if (key in totals) totals[key] += (value as number) * multiplier
  }
  return totals
}

// ---------------------------------------------------------------------------
// BeaconModal
// ---------------------------------------------------------------------------

export interface BeaconModalProps {
  nodeId: string
  beacon: BeaconConfig
  recipeId: string
  machineId: string | undefined
  recipeCategory: string
  gameData: GameData
  onClose: () => void
}

export function BeaconModal({
  nodeId,
  beacon,
  recipeId,
  machineId,
  recipeCategory,
  gameData,
  onClose,
}: BeaconModalProps) {
  const updateNodeBeacon = useBlockStore(s => s.updateNodeBeacon)

  const [showBeaconPicker, setShowBeaconPicker] = useState(false)
  const [showModulePicker, setShowModulePicker] = useState(false)

  const recipe = gameData.recipes[recipeId]
  const resolvedMachineId = machineId ?? gameData.defaultMachines[recipeCategory]
  const machine = resolvedMachineId ? gameData.machines[resolvedMachineId] : undefined

  const beaconEntity = beacon.beaconId ? gameData.beacons[beacon.beaconId] : undefined
  const selectedModule = gameData.modules[beacon.moduleId]
  const hasBeaconData = Object.keys(gameData.beacons).length > 0

  const availableBeacons = Object.values(gameData.beacons)
    .filter(b => !b.hidden)
    .sort((a, b) => a.name.localeCompare(b.name))

  const availableModules = Object.values(gameData.modules)
    .filter(m => !('hidden' in m) || !(m as { hidden?: boolean }).hidden)
    .sort((a, b) => a.name.localeCompare(b.name))

  function update(patch: Partial<BeaconConfig>) {
    updateNodeBeacon(nodeId, { ...beacon, ...patch })
  }

  function selectBeacon(beaconId: string) {
    const entity = gameData.beacons[beaconId]
    if (!entity) return
    update({
      beaconId,
      modulesPerBeacon: entity.moduleSlots,
      distributionEfficiency: entity.distributionEfficiency,
    })
    setShowBeaconPicker(false)
  }

  function selectModule(moduleId: string) {
    update({ moduleId })
    setShowModulePicker(false)
  }

  // Effects
  const rawEffects = computeBeaconEffects(beacon, gameData)
  const recipeEffects = applyRecipeConstraints(
    rawEffects,
    machine?.allowedEffects ?? [],
    recipe?.allowProductivity ?? false,
  )
  const showQuality = rawEffects.quality !== 0

  const beaconIcon = beaconEntity?.iconPath
  const moduleIcon = selectedModule?.iconPath

  return (
    <Modal onClose={onClose} className="w-[460px] max-w-[95vw] max-h-[90vh] overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-700">
        <h2 className="text-sm font-semibold text-gray-200">Edit beacon</h2>
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
          Configure the beacon for &apos;{recipe.name}&apos;
        </div>
      )}

      <div className="px-4 py-3 space-y-4">
        {/* Beacon section */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Beacon</div>
          <div className="bg-gray-800 rounded p-2 space-y-2">
            {/* Beacon type selector */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setShowBeaconPicker(p => !p); setShowModulePicker(false) }}
                className="relative w-8 h-8 shrink-0 hover:ring-1 hover:ring-gray-500 rounded"
                title={beaconEntity?.name ?? 'Select beacon type'}
              >
                {beaconIcon ? (
                  <img src={iconUrl(beaconIcon)} alt={beaconEntity?.name} className="w-full h-full object-contain" />
                ) : (
                  <span className="w-full h-full bg-gray-700 rounded flex items-center justify-center text-[9px] text-gray-400">?</span>
                )}
                <span className="absolute bottom-0 right-0 text-[8px] text-gray-400">▾</span>
              </button>
              <span className="text-xs text-gray-300 flex-1">
                {beaconEntity?.name ?? (hasBeaconData ? 'Select beacon type' : 'No beacon data')}
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">Amount</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={beacon.beaconCount}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10)
                    if (isFinite(v) && v >= 0) update({ beaconCount: v })
                  }}
                  className="w-16 bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 outline-none text-right tabular-nums"
                />
              </div>
            </div>

            {/* Beacon type picker */}
            {showBeaconPicker && (
              <div className="border border-gray-700 rounded p-1 max-h-36 overflow-y-auto space-y-0.5">
                {hasBeaconData ? availableBeacons.map(b => (
                  <button
                    key={b.id}
                    onClick={() => selectBeacon(b.id)}
                    className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 flex items-center gap-1.5 ${b.id === beacon.beaconId ? 'text-teal-400' : 'text-gray-300'}`}
                  >
                    {b.iconPath && <img src={iconUrl(b.iconPath)} alt={b.name} className="w-4 h-4 object-contain shrink-0" />}
                    {b.name}
                  </button>
                )) : (
                  <div className="px-2 py-1.5 text-xs text-gray-500 italic">
                    No beacon data — re-export game data to populate.
                  </div>
                )}
              </div>
            )}

            {/* Legacy inputs when no beacon-type data */}
            {!hasBeaconData && (
              <div className="space-y-1.5 pt-1 border-t border-gray-700">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-32 shrink-0">Modules/beacon</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={beacon.modulesPerBeacon}
                    onChange={e => {
                      const v = parseInt(e.target.value, 10)
                      if (isFinite(v) && v >= 1) update({ modulesPerBeacon: v })
                    }}
                    className="w-16 bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 outline-none text-right tabular-nums"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-32 shrink-0">Efficiency</span>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={beacon.distributionEfficiency}
                    onChange={e => {
                      const v = parseFloat(e.target.value)
                      if (isFinite(v) && v >= 0 && v <= 1) update({ distributionEfficiency: v })
                    }}
                    className="w-16 bg-gray-700 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-600 outline-none text-right tabular-nums"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Effects panels */}
        <div className="flex gap-2">
          <EffectsPanel label="Beacon effects" totals={rawEffects} showQuality={showQuality} />
          <EffectsPanel label="Recipe effects" totals={recipeEffects} showQuality={showQuality} />
        </div>

        {/* Module section */}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1.5">Module</div>
          <div className="bg-gray-800 rounded p-2 space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setShowModulePicker(p => !p); setShowBeaconPicker(false) }}
                className="relative w-8 h-8 shrink-0 hover:ring-1 hover:ring-gray-500 rounded"
                title={selectedModule?.name ?? 'Select module'}
              >
                {moduleIcon ? (
                  <img src={iconUrl(moduleIcon)} alt={selectedModule?.name} className="w-full h-full object-contain" />
                ) : (
                  <span className="w-full h-full bg-gray-700 rounded flex items-center justify-center text-[9px] text-gray-400">M</span>
                )}
                <span className="absolute bottom-0 right-0 text-[8px] text-gray-400">▾</span>
              </button>
              <span className="text-xs text-gray-300 flex-1">
                {selectedModule?.name ?? beacon.moduleId}
              </span>
            </div>

            {/* Module picker */}
            {showModulePicker && (
              <div className="border border-gray-700 rounded p-1 max-h-48 overflow-y-auto space-y-0.5">
                {availableModules.map(m => (
                  <button
                    key={m.id}
                    onClick={() => selectModule(m.id)}
                    className={`w-full text-left px-2 py-1 rounded text-xs hover:bg-gray-700 flex items-center gap-1.5 ${m.id === beacon.moduleId ? 'text-teal-400' : 'text-gray-300'}`}
                  >
                    {m.iconPath && <img src={iconUrl(m.iconPath)} alt={m.name} className="w-4 h-4 object-contain shrink-0" />}
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-gray-700">
        <button
          type="button"
          onClick={() => { updateNodeBeacon(nodeId, undefined); onClose() }}
          className="text-xs text-red-500 hover:text-red-400"
        >
          Remove beacon
        </button>
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
