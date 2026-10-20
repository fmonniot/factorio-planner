import { Fragment, useMemo, useState } from 'react'
import { useBlockStore, selectActiveBlock, makeRecipeNode } from '../../store/blockStore'
import { useSolverStore, selectBlockResult, selectFlows } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import { fmtRate } from './ItemTile'
import { Icon } from '../Icon'
import { ItemTile } from './ItemTile'
import { ItemPicker } from '../ItemPicker'
import type { ProductionGoal, Item } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { WarningsPopover } from './WarningsPopover'
import { isGoalItem } from '../../store/connections'
import { RowActionsMenu } from './RowActionsMenu'
import { ConnectionMenu, ConnectionChip, ExportChip } from './ConnectionMenu'
import { netBalance as computeNetBalance, FLOW_TOLERANCE } from '../../solver/index'

// ---------------------------------------------------------------------------
// GoalTile — shows target → actual with inline edit for target
// ---------------------------------------------------------------------------

interface GoalTileProps {
  goal: ProductionGoal
  /** Solver's actual output for this item in items/min. Undefined before solver runs. */
  actualPerMin: number | undefined
  item: Item | undefined
  rateUnit: RateUnit
  onUpdateRate: (rate: number) => void
  onRemove: () => void
  /** Open the recipe picker filtered to producers of this goal's item. */
  onFindProducer: () => void
}

function GoalTile({ goal, actualPerMin, item, rateUnit, onUpdateRate, onRemove, onFindProducer }: GoalTileProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  // goal.rate is stored in items/min internally
  const unitLabel = rateUnit === 'min' ? '/m' : '/s'
  const targetDisplay = fmtRate(goal.rate / 60, rateUnit)
  const actualDisplay = actualPerMin !== undefined ? fmtRate(actualPerMin / 60, rateUnit) : null

  function startEdit() {
    setDraft(fmtRate(goal.rate / 60, rateUnit))
    setEditing(true)
  }

  function commitEdit() {
    const v = parseFloat(draft)
    if (isFinite(v) && v > 0) {
      // Convert from display unit back to items/min for storage
      const perMin = rateUnit === 'min' ? v : v * 60
      onUpdateRate(perMin)
    }
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitEdit()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-xs group/goal">
      {/* Icon (or name) — opens the producer recipe picker */}
      <button
        type="button"
        onClick={onFindProducer}
        title={`${item?.name ?? goal.itemId} — click to add a producer recipe`}
        className="shrink-0 flex items-center rounded hover:bg-gray-700"
      >
        {item?.iconPath ? (
          <Icon
            iconPath={item.iconPath}
            alt={item.name}
            className="w-5 h-5 object-contain shrink-0"
          />
        ) : (
          <span className="text-gray-400 text-[10px]">{item?.name ?? goal.itemId}</span>
        )}
      </button>

      {/* Target rate — editable */}
      {editing ? (
        <input
          type="number"
          min="0.001"
          step="any"
          autoFocus
          aria-label="Goal target rate"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={handleKeyDown}
          className="w-14 bg-gray-700 text-yellow-300 rounded px-1 py-0 border border-yellow-600 outline-none text-right tabular-nums text-[11px]"
        />
      ) : (
        <button
          type="button"
          onClick={startEdit}
          title={`Target: ${targetDisplay}${unitLabel} — click to edit`}
          className="text-gray-300 hover:text-yellow-300 tabular-nums font-mono text-[11px] leading-none"
        >
          {targetDisplay}
        </button>
      )}

      {/* Separator + actual (only when solver has run) */}
      {actualDisplay !== null && (
        <>
          <span className="text-gray-600 text-[10px]">→</span>
          <span
            title={`Actual: ${actualDisplay}${unitLabel} — solver output`}
            className="text-teal-400 tabular-nums font-mono text-[11px] leading-none"
          >
            {actualDisplay}
          </span>
        </>
      )}

      <span className="text-gray-600 text-[10px]">{unitLabel}</span>

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        title="Remove goal"
        className="text-gray-700 hover:text-red-400 leading-none text-xs ml-0.5 opacity-0 group-hover/goal:opacity-100 transition-opacity"
      >
        ×
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// FactorySummary
// ---------------------------------------------------------------------------

export function FactorySummary() {
  const activeBlock = useBlockStore(selectActiveBlock)
  const renameBlock = useBlockStore(s => s.renameBlock)
  const solverResult = useSolverStore(selectBlockResult(activeBlock?.id))
  const gameData = useGameDataStore(selectGameData)
  const rateUnit = useUiStore(s => s.rateUnit)
  const setRateUnit = useUiStore(s => s.setRateUnit)
  const addGoal = useBlockStore(s => s.addGoal)
  const removeGoal = useBlockStore(s => s.removeGoal)
  const updateGoalRate = useBlockStore(s => s.updateGoalRate)
  const [showGoalPicker, setShowGoalPicker] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')

  const toggleNoImportItem = useBlockStore(s => s.toggleNoImportItem)
  const noImportItems = activeBlock?.noImportItems ?? []
  const blocks = useBlockStore(s => s.blocks)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const removeInputConnection = useBlockStore(s => s.removeInputConnection)
  const allFlows = useSolverStore(selectFlows)
  const addNode = useBlockStore(s => s.addNode)
  const [byproductMenu, setByproductMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)
  const [consumerPickerItemId, setConsumerPickerItemId] = useState<string | null>(null)
  const [producerPickerItemId, setProducerPickerItemId] = useState<string | null>(null)
  const [connectionMenu, setConnectionMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)

  const goals: ProductionGoal[] = activeBlock?.goals ?? []
  const goalIds = new Set(goals.map(g => g.itemId))

  const netBalance = solverResult ? computeNetBalance(solverResult.nodes) : new Map<string, number>()

  const activeBlockId = activeBlock?.id
  const inputFlows = useMemo(
    () => new Map(allFlows.filter(f => f.toBlockId === activeBlockId).map(f => [f.connectionId, f])),
    [allFlows, activeBlockId],
  )
  // Deliveries to other blocks, by item (items/min).
  const outputFlows = useMemo(
    () => allFlows.filter(f => f.fromBlockId === activeBlockId && f.rate > FLOW_TOLERANCE),
    [allFlows, activeBlockId],
  )
  const exportedPerMin = new Map<string, number>()
  for (const f of outputFlows) exportedPerMin.set(f.itemId, (exportedPerMin.get(f.itemId) ?? 0) + f.rate)

  function renderExportChips(itemId: string) {
    return outputFlows
      .filter(f => f.itemId === itemId)
      .map(f => (
        <ExportChip
          key={f.connectionId}
          flow={f}
          item={gameData?.items[itemId]}
          consumerName={blocks.find(b => b.id === f.toBlockId)?.name ?? f.toBlockId}
          onSelectConsumer={() => setActiveBlock(f.toBlockId)}
        />
      ))
  }

  // Byproducts: net positive balance not in goals, minus what other blocks take
  const byproductItems = [...netBalance]
    .filter(([id]) => !goalIds.has(id))
    .map(([id, net]) => ({ itemId: id, ratePerMin: net - (exportedPerMin.get(id) ?? 0) }))
    .filter(({ ratePerMin }) => ratePerMin > FLOW_TOLERANCE)
  const exportedByproducts = [...exportedPerMin.keys()].filter(id => !goalIds.has(id))

  // Ingredients: unsatisfied raw inputs
  const ingredientItems = (solverResult?.unsatisfied ?? []).filter(u => u.rate > 0)
  const importedPerMin = new Map(ingredientItems.map(u => [u.itemId, u.rate]))
  const connections = activeBlock?.inputConnections ?? []
  // Per item: everything this block needs from outside, whether delivered or still imported.
  const neededPerMin = new Map<string, number>()
  for (const c of connections) {
    neededPerMin.set(c.itemId, importedPerMin.get(c.itemId) ?? 0)
  }
  for (const c of connections) {
    neededPerMin.set(c.itemId, neededPerMin.get(c.itemId)! + (inputFlows.get(c.id)?.rate ?? 0))
  }

  function handleAddGoal(itemId: string, rate: number) {
    addGoal({ id: crypto.randomUUID(), itemId, rate })
  }

  function startNameEdit() {
    setNameDraft(activeBlock?.name ?? '')
    setEditingName(true)
  }

  function commitNameEdit() {
    const trimmed = nameDraft.trim()
    if (trimmed && activeBlock) renameBlock(activeBlock.id, trimmed)
    setEditingName(false)
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commitNameEdit()
    if (e.key === 'Escape') setEditingName(false)
  }

  // The plan may not belong to the selected data set until its data has loaded,
  // so nothing here can be edited before then.
  if (!gameData) return null

  return (
    <div className="border-b border-gray-700 bg-gray-900 shrink-0">
      {/* Block name + rate unit toggle */}
      <div className="flex items-center justify-between px-3 pt-1.5 gap-2 text-xs text-gray-500">
        {editingName ? (
          <input
            type="text"
            aria-label="Block name"
            autoFocus
            value={nameDraft}
            onChange={e => setNameDraft(e.target.value)}
            onBlur={commitNameEdit}
            onKeyDown={handleNameKeyDown}
            className="bg-gray-800 text-gray-100 text-xs font-semibold rounded px-1.5 py-0.5 border border-gray-600 outline-none focus:ring-1 focus:ring-teal-500 w-32"
          />
        ) : (
          <button
            type="button"
            onClick={startNameEdit}
            title="Click to rename"
            className="font-semibold text-gray-300 hover:text-gray-100 text-xs"
          >
            {activeBlock?.name ?? 'Factory'}
          </button>
        )}
        <div className="flex items-center gap-3">
          <WarningsPopover />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRateUnit('sec')}
              className={`hover:text-gray-200 ${rateUnit === 'sec' ? 'text-teal-400' : ''}`}
            >
              /sec
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => setRateUnit('min')}
              className={`hover:text-gray-200 ${rateUnit === 'min' ? 'text-teal-400' : ''}`}
            >
              /min
            </button>
          </div>
        </div>
      </div>

      {/* Three-pane summary */}
      <div className="grid grid-cols-3 gap-2 px-3 pb-2 pt-1">
        {/* Products — one GoalTile per goal */}
        <SummaryPane label="Products">
          {goals.map(goal => (
            <Fragment key={goal.id}>
              <GoalTile
                goal={goal}
                actualPerMin={netBalance.get(goal.itemId)}
                item={gameData?.items[goal.itemId]}
                rateUnit={rateUnit}
                onUpdateRate={rate => updateGoalRate(goal.id, rate)}
                onRemove={() => removeGoal(goal.id)}
                onFindProducer={() => setProducerPickerItemId(goal.itemId)}
              />
              {renderExportChips(goal.itemId)}
            </Fragment>
          ))}
          <button
            type="button"
            onClick={() => setShowGoalPicker(true)}
            className="text-gray-600 hover:text-gray-400 text-xs px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500"
            title="Add goal"
          >
            +
          </button>
        </SummaryPane>

        {/* Byproducts */}
        <SummaryPane label="Byproducts">
          {byproductItems.map(({ itemId, ratePerMin }) => (
            <ItemTile
              key={itemId}
              item={gameData?.items[itemId]}
              ratePerSec={ratePerMin / 60}
              variant="byproduct"
              onContextMenu={e => {
                e.preventDefault()
                setByproductMenu({ itemId, x: e.clientX, y: e.clientY })
              }}
              title={`${gameData?.items[itemId]?.name ?? itemId} — right-click to add a consumer recipe`}
            />
          ))}
          {exportedByproducts.flatMap(renderExportChips)}
        </SummaryPane>

        {/* Ingredients (click an active tile to forbid the LP from importing it;
            right-click it to receive it from another block; click a locked chip
            to allow imports again). */}
        <SummaryPane label="Ingredients">
          {connections.map(c => {
            const source = blocks.find(b => b.id === c.fromBlockId)
            return (
              <ConnectionChip
                key={c.id}
                connection={c}
                flow={inputFlows.get(c.id)}
                item={gameData?.items[c.itemId]}
                sourceName={source?.name}
                neededPerMin={neededPerMin.get(c.itemId) ?? 0}
                onSelectSource={() => setActiveBlock(c.fromBlockId)}
                onRemove={() => removeInputConnection(c.id)}
              />
            )
          })}
          {ingredientItems.map(({ itemId, rate }) => {
            const connectable = activeBlock ? !isGoalItem(activeBlock, itemId) : false
            return (
              <ItemTile
                key={itemId}
                item={gameData?.items[itemId]}
                ratePerSec={rate / 60}
                variant="ingredient"
                onClick={() => toggleNoImportItem(itemId)}
                // A goal shortfall cannot be fed by a connection (goals never receive supply).
                onContextMenu={connectable ? e => {
                  e.preventDefault()
                  const rect = e.currentTarget.getBoundingClientRect()
                  setConnectionMenu({ itemId, x: rect.left, y: rect.bottom })
                } : undefined}
                title={`${gameData?.items[itemId]?.name ?? itemId} — click to forbid imports${connectable ? ', right-click to receive from another block' : ''}`}
              />
            )
          })}
          {noImportItems.map(itemId => (
            <NoImportChip
              key={itemId}
              item={gameData?.items[itemId]}
              itemId={itemId}
              onClick={() => toggleNoImportItem(itemId)}
            />
          ))}
        </SummaryPane>
      </div>

      {connectionMenu && (
        <ConnectionMenu
          itemId={connectionMenu.itemId}
          x={connectionMenu.x}
          y={connectionMenu.y}
          onClose={() => setConnectionMenu(null)}
        />
      )}

      {byproductMenu && (
        <RowActionsMenu
          x={byproductMenu.x}
          y={byproductMenu.y}
          actions={[{ label: 'Add consumer recipe…', onSelect: () => setConsumerPickerItemId(byproductMenu.itemId) }]}
          onClose={() => setByproductMenu(null)}
        />
      )}

      {consumerPickerItemId && (
        <ItemPicker
          source="recipes"
          consumesItemId={consumerPickerItemId}
          onSelect={id => addNode(makeRecipeNode(id))}
          onClose={() => setConsumerPickerItemId(null)}
        />
      )}

      {producerPickerItemId && (
        <ItemPicker
          source="recipes"
          filterByItemId={producerPickerItemId}
          onSelect={id => addNode(makeRecipeNode(id))}
          onClose={() => setProducerPickerItemId(null)}
        />
      )}

      {showGoalPicker && (
        <ItemPicker
          source="items"
          onSelect={handleAddGoal}
          onClose={() => setShowGoalPicker(false)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SummaryPane
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// NoImportChip — locked item: small grey chip with lock icon + click to unlock
// ---------------------------------------------------------------------------

function NoImportChip({
  item,
  itemId,
  onClick,
}: {
  item: Item | undefined
  itemId: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${item?.name ?? itemId} — locked (LP cannot import). Click to allow imports.`}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-gray-800 text-gray-500 border border-gray-700 hover:text-gray-300 hover:border-gray-600"
    >
      {item?.iconPath ? (
        <Icon
          iconPath={item.iconPath}
          alt={item.name}
          className="w-5 h-5 object-contain shrink-0 opacity-50"
        />
      ) : (
        <span className="text-[10px] truncate max-w-[4rem]">{item?.name ?? itemId}</span>
      )}
      <span className="text-[10px] leading-none">🔒</span>
    </button>
  )
}

function SummaryPane({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-700 rounded bg-gray-900/40 px-2 py-1.5 flex flex-col max-h-[25vh]">
      <div className="text-[10px] uppercase tracking-wide text-gray-600 mb-1 shrink-0">{label}</div>
      <div className="flex flex-wrap gap-1 items-center content-start min-h-[1.75rem] overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
