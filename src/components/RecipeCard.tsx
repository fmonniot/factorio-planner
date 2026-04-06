import { useState } from 'react'
import type { SolvedNode, SubPlan, GameData, ModuleConfig, BeaconConfig } from '../data/types'
import { useBlockStore } from '../store/blockStore'
import { ItemPicker } from './ItemPicker'

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

export function fmtRate(rate: number): string {
  if (rate >= 100) return rate.toFixed(0)
  if (rate >= 10) return rate.toFixed(1)
  return rate.toFixed(2)
}

function fmtPower(kw: number): string {
  if (kw >= 1000) return `${(kw / 1000).toFixed(2)} MW`
  return `${kw.toFixed(0)} kW`
}

// ---------------------------------------------------------------------------
// Alternate recipe selector (5.2)
// ---------------------------------------------------------------------------

interface AlternateRecipeSelectorProps {
  nodeId: string
  currentRecipeId: string
  primaryItemId: string | undefined
  gameData: GameData
}

function AlternateRecipeSelector({ nodeId, currentRecipeId, primaryItemId, gameData }: AlternateRecipeSelectorProps) {
  const updateNodeRecipe = useBlockStore(s => s.updateNodeRecipe)

  if (!primaryItemId) return null

  // All non-hidden recipes that produce the primary item.
  const candidates = Object.values(gameData.recipes).filter(r =>
    !r.hidden && r.products.some(p => p.itemId === primaryItemId)
  )
  if (candidates.length < 2) return null

  return (
    <select
      value={currentRecipeId}
      onChange={e => updateNodeRecipe(nodeId, e.target.value)}
      className="w-full bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600 outline-none focus:ring-1 focus:ring-blue-500 mb-1"
      title="Alternate recipe"
    >
      {candidates.map(r => (
        <option key={r.id} value={r.id}>{r.name}</option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Machine selector (5.1)
// ---------------------------------------------------------------------------

interface MachineSelectorProps {
  nodeId: string
  recipeCategory: string
  currentMachineId: string | undefined
  gameData: GameData
}

function MachineSelector({ nodeId, recipeCategory, currentMachineId, gameData }: MachineSelectorProps) {
  const updateNodeMachine = useBlockStore(s => s.updateNodeMachine)

  const machines = Object.values(gameData.machines)
    .filter(m => !m.hidden && m.craftingCategories.includes(recipeCategory))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <select
      value={currentMachineId ?? ''}
      onChange={e => updateNodeMachine(nodeId, e.target.value || undefined)}
      className="bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600 outline-none focus:ring-1 focus:ring-blue-500 max-w-full"
    >
      <option value="">Default</option>
      {machines.map(m => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Module editor (5.3)
// ---------------------------------------------------------------------------

function isModuleAllowedInMachine(
  module: { effects: Record<string, number> },
  machine: { allowedEffects: string[] },
): boolean {
  return Object.keys(module.effects).every(e => machine.allowedEffects.includes(e))
}

function isModuleAllowedForRecipe(
  module: { limitation: string[]; limitationBlacklist: string[] },
  recipeId: string,
): boolean {
  if (module.limitation.length > 0 && !module.limitation.includes(recipeId)) return false
  if (module.limitationBlacklist.includes(recipeId)) return false
  return true
}

interface ModuleEditorProps {
  nodeId: string
  modules: ModuleConfig[]
  machineSlots: number
  allowedMachineEffects: string[]
  recipeId: string
  gameData: GameData
}

function ModuleEditor({ nodeId, modules, machineSlots, allowedMachineEffects, recipeId, gameData }: ModuleEditorProps) {
  const updateNodeModules = useBlockStore(s => s.updateNodeModules)
  const [open, setOpen] = useState(false)
  const [addModuleId, setAddModuleId] = useState('')

  const usedSlots = modules.reduce((sum, m) => sum + m.count, 0)
  const remaining = machineSlots - usedSlots

  const allowedModules = Object.values(gameData.modules).filter(m =>
    isModuleAllowedInMachine(m, { allowedEffects: allowedMachineEffects }) &&
    isModuleAllowedForRecipe(m, recipeId)
  )

  const existingIds = new Set(modules.map(m => m.moduleId))
  const addableModules = allowedModules.filter(m => !existingIds.has(m.id))

  if (machineSlots === 0) return null

  function adjustCount(moduleId: string, delta: number) {
    const current = modules.find(m => m.moduleId === moduleId)?.count ?? 0
    const next = current + delta
    if (next <= 0) {
      updateNodeModules(nodeId, modules.filter(m => m.moduleId !== moduleId))
    } else if (delta > 0 && remaining < 1) {
      // Slot limit — no-op
    } else {
      updateNodeModules(nodeId, modules.map(m =>
        m.moduleId === moduleId ? { ...m, count: next } : m
      ))
    }
  }

  function addModule() {
    if (!addModuleId || remaining < 1) return
    updateNodeModules(nodeId, [...modules, { moduleId: addModuleId, count: 1 }])
    setAddModuleId('')
  }

  return (
    <section className="mt-2 border-t border-gray-700 pt-2">
      <button
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 w-full text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>Modules</span>
        <span className="text-gray-600 ml-auto">{usedSlots}/{machineSlots}</span>
      </button>

      {open && (
        <div className="mt-1.5 space-y-1">
          {modules.map(mc => {
            const mod = gameData.modules[mc.moduleId]
            return (
              <div key={mc.moduleId} className="flex items-center gap-1 text-xs">
                <span className="flex-1 truncate text-gray-300" title={mod?.name ?? mc.moduleId}>
                  {mod?.name ?? mc.moduleId}
                </span>
                <button
                  onClick={() => adjustCount(mc.moduleId, -1)}
                  className="text-gray-500 hover:text-red-400 px-1 leading-none"
                  aria-label="Remove one"
                >−</button>
                <span className="text-gray-200 w-4 text-center">{mc.count}</span>
                <button
                  onClick={() => adjustCount(mc.moduleId, 1)}
                  disabled={remaining < 1}
                  className="text-gray-500 hover:text-gray-200 px-1 leading-none disabled:opacity-40"
                  aria-label="Add one"
                >+</button>
              </div>
            )
          })}

          {remaining > 0 && addableModules.length > 0 && (
            <div className="flex items-center gap-1 mt-1">
              <select
                value={addModuleId}
                onChange={e => setAddModuleId(e.target.value)}
                className="flex-1 bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600 outline-none"
              >
                <option value="">— add module —</option>
                {addableModules.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <button
                onClick={addModule}
                disabled={!addModuleId}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-0.5 rounded disabled:opacity-40"
              >Add</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Throughput row with pin toggle (5.5)
// ---------------------------------------------------------------------------

interface ThroughputRowProps {
  nodeId: string
  throughput: number
  pinnedRate: number | undefined
}

export function ThroughputRow({ nodeId, throughput, pinnedRate }: ThroughputRowProps) {
  const updateNodePinnedRate = useBlockStore(s => s.updateNodePinnedRate)
  const isPinned = pinnedRate !== undefined

  function togglePin() {
    if (isPinned) {
      updateNodePinnedRate(nodeId, undefined)
    } else {
      // Pin at the current computed throughput.
      updateNodePinnedRate(nodeId, throughput)
    }
  }

  function handleRateChange(raw: string) {
    const v = parseFloat(raw)
    if (isFinite(v) && v > 0) updateNodePinnedRate(nodeId, v)
  }

  return (
    <div className="flex items-center gap-1.5 text-xs mb-1">
      <button
        onClick={togglePin}
        title={isPinned ? 'Unpin rate' : 'Pin rate'}
        className={`text-sm leading-none ${isPinned ? 'text-yellow-400 hover:text-yellow-300' : 'text-gray-600 hover:text-gray-400'}`}
      >
        {isPinned ? '📌' : '📍'}
      </button>
      {isPinned ? (
        <input
          type="number"
          min="0.001"
          step="any"
          value={pinnedRate}
          onChange={e => handleRateChange(e.target.value)}
          className="w-20 bg-gray-700 text-yellow-300 text-xs rounded px-1 py-0.5 border border-yellow-700 outline-none focus:ring-1 focus:ring-yellow-500 text-right"
          aria-label="Pinned rate"
        />
      ) : (
        <span className="text-gray-400">{fmtRate(throughput)}</span>
      )}
      <span className="text-gray-500">/min</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Beacon editor (5.4)
// ---------------------------------------------------------------------------

interface BeaconEditorProps {
  nodeId: string
  beacon: BeaconConfig | undefined
  gameData: GameData
}

function BeaconEditor({ nodeId, beacon, gameData }: BeaconEditorProps) {
  const updateNodeBeacon = useBlockStore(s => s.updateNodeBeacon)
  const [open, setOpen] = useState(false)

  const modules = Object.values(gameData.modules).sort((a, b) => a.name.localeCompare(b.name))

  function update(patch: Partial<BeaconConfig>) {
    if (!beacon) return
    updateNodeBeacon(nodeId, { ...beacon, ...patch })
  }

  function enable() {
    const firstModule = modules[0]
    if (!firstModule) return
    updateNodeBeacon(nodeId, {
      moduleId: firstModule.id,
      beaconCount: 4,
      modulesPerBeacon: 2,
      distributionEfficiency: 0.5,
    })
    setOpen(true)
  }

  function disable() {
    updateNodeBeacon(nodeId, undefined)
    setOpen(false)
  }

  return (
    <section className="mt-2 border-t border-gray-700 pt-2">
      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 flex-1 text-left"
          onClick={() => beacon ? setOpen(o => !o) : enable()}
        >
          <span>{open && beacon ? '▾' : '▸'}</span>
          <span>Beacon</span>
          {beacon && (
            <span className="text-gray-600 ml-1">
              ×{beacon.beaconCount} ({beacon.modulesPerBeacon} mod)
            </span>
          )}
        </button>
        {beacon && (
          <button
            onClick={disable}
            className="text-xs text-gray-600 hover:text-red-400"
            aria-label="Remove beacon"
          >×</button>
        )}
      </div>

      {open && beacon && (
        <div className="mt-1.5 space-y-1.5">
          {/* Module */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 w-16 shrink-0">Module</span>
            <select
              value={beacon.moduleId}
              onChange={e => update({ moduleId: e.target.value })}
              className="flex-1 bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600 outline-none"
            >
              {modules.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Beacon count */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 w-16 shrink-0">Count</span>
            <input
              type="number"
              min={0}
              step={1}
              value={beacon.beaconCount}
              onChange={e => {
                const v = parseInt(e.target.value, 10)
                if (isFinite(v) && v >= 0) update({ beaconCount: v })
              }}
              className="w-16 bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600 outline-none text-right"
            />
          </div>

          {/* Modules per beacon */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 w-16 shrink-0">Per beacon</span>
            <input
              type="number"
              min={1}
              step={1}
              value={beacon.modulesPerBeacon}
              onChange={e => {
                const v = parseInt(e.target.value, 10)
                if (isFinite(v) && v >= 1) update({ modulesPerBeacon: v })
              }}
              className="w-16 bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600 outline-none text-right"
            />
          </div>

          {/* Distribution efficiency */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 w-16 shrink-0">Efficiency</span>
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
              className="w-16 bg-gray-700 text-gray-200 text-xs rounded px-1 py-0.5 border border-gray-600 outline-none text-right"
            />
          </div>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface RecipeCardProps {
  node: SolvedNode
  plan: SubPlan
  gameData: GameData
}

export function RecipeCard({ node, plan, gameData }: RecipeCardProps) {
  const updateNodeByproductPolicy = useBlockStore(s => s.updateNodeByproductPolicy)
  const addNode = useBlockStore(s => s.addNode)
  const [inputPickerItemId, setInputPickerItemId] = useState<string | null>(null)

  const planNode = plan.nodes.find(n => n.id === node.recipeNodeId)

  // Only game-recipe nodes are handled here; subplan nodes use SubPlanSolvedCard.
  if (!planNode || planNode.kind !== 'game-recipe') return null

  const recipe = gameData.recipes[planNode.recipeId]
  if (!recipe) return null

  const resolvedMachineId = planNode.machineId ?? gameData.defaultMachines[recipe.category]
  const machine = resolvedMachineId ? gameData.machines[resolvedMachineId] : undefined

  // Primary item: explicit mainProduct, or the first product's itemId.
  const primaryItemId = recipe.mainProduct ?? recipe.products[0]?.itemId

  const inputEntries = Object.entries(node.inputRates)
  const outputEntries = Object.entries(node.outputRates)

  return (
    <>
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 w-72">
      {/* Alternate recipe selector (only rendered when ≥2 recipes produce primaryItem) */}
      <AlternateRecipeSelector
        nodeId={node.recipeNodeId}
        currentRecipeId={planNode.recipeId}
        primaryItemId={primaryItemId}
        gameData={gameData}
      />

      {/* Recipe name */}
      <div className="font-medium text-sm text-gray-100 mb-2 truncate" title={recipe.name}>
        {recipe.name}
      </div>

      {/* Throughput + pin (5.5) */}
      <ThroughputRow
        nodeId={node.recipeNodeId}
        throughput={node.throughput}
        pinnedRate={planNode.pinnedRate}
      />

      {/* Machine row */}
      <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
        {machine && <span className="shrink-0">× {node.machineCountCeil}</span>}
        <MachineSelector
          nodeId={node.recipeNodeId}
          recipeCategory={recipe.category}
          currentMachineId={planNode.machineId}
          gameData={gameData}
        />
        {node.powerKw > 0 && (
          <span className="shrink-0 text-gray-500">{fmtPower(node.powerKw)}</span>
        )}
      </div>

      {/* Outputs (with byproduct policy toggles for multi-product recipes, 5.6) */}
      {outputEntries.length > 0 && (
        <section className="mb-2">
          <div className="text-xs font-medium text-gray-500 mb-0.5">Outputs</div>
          {outputEntries.map(([itemId, rate]) => {
            const isMultiProduct = recipe.products.length > 1
            const policy = planNode.byproductPolicy[itemId] ?? 'feed-back'
            return (
              <div key={itemId} className="flex items-center text-xs text-gray-300 gap-1 mb-0.5">
                <span className="flex-1 truncate">{gameData.items[itemId]?.name ?? itemId}</span>
                <span className="text-gray-400 shrink-0">{fmtRate(rate)}/min</span>
                {isMultiProduct && (
                  <button
                    onClick={() => {
                      const next = policy === 'feed-back' ? 'discard' : 'feed-back'
                      updateNodeByproductPolicy(node.recipeNodeId, {
                        ...planNode.byproductPolicy,
                        [itemId]: next,
                      })
                    }}
                    title={policy === 'feed-back' ? 'Feed back (click to discard)' : 'Discarded (click to feed back)'}
                    className={`shrink-0 text-xs px-1 py-0.5 rounded leading-none ${
                      policy === 'feed-back'
                        ? 'bg-blue-900 text-blue-300'
                        : 'bg-gray-700 text-gray-500'
                    }`}
                  >
                    {policy === 'feed-back' ? '↩' : '✕'}
                  </button>
                )}
              </div>
            )
          })}
        </section>
      )}

      {/* Inputs */}
      {inputEntries.length > 0 && (
        <section>
          <div className="text-xs font-medium text-gray-500 mb-0.5">Inputs</div>
          {inputEntries.map(([itemId, rate]) => (
            <div key={itemId} className="flex justify-between text-xs text-gray-300 gap-2">
              <button
                className="truncate text-left hover:text-blue-300 hover:underline"
                title={`Add recipe producing ${gameData.items[itemId]?.name ?? itemId}`}
                onClick={() => setInputPickerItemId(itemId)}
              >
                {gameData.items[itemId]?.name ?? itemId}
              </button>
              <span className="text-gray-400 shrink-0">{fmtRate(rate)}/min</span>
            </div>
          ))}
        </section>
      )}

      {/* Module editor */}
      <ModuleEditor
        nodeId={node.recipeNodeId}
        modules={planNode.modules}
        machineSlots={machine?.moduleSlots ?? 0}
        allowedMachineEffects={machine?.allowedEffects ?? []}
        recipeId={planNode.recipeId}
        gameData={gameData}
      />

      {/* Beacon editor */}
      <BeaconEditor
        nodeId={node.recipeNodeId}
        beacon={planNode.beaconConfig}
        gameData={gameData}
      />
    </div>

    {inputPickerItemId && (
      <ItemPicker
        source="recipes"
        filterByItemId={inputPickerItemId}
        initialQuery={gameData.items[inputPickerItemId]?.name ?? ''}
        onSelect={recipeId => {
          addNode({
            kind: 'game-recipe',
            id: crypto.randomUUID(),
            recipeId,
            modules: [],
            byproductPolicy: {},
          })
        }}
        onClose={() => setInputPickerItemId(null)}
      />
    )}
    </>
  )
}
