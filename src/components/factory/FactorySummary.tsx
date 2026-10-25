import { useMemo, useState } from 'react'
import { useBlockStore, selectActiveBlock, makeRecipeNode } from '../../store/blockStore'
import { useSolverStore, selectBlockResult, selectFlows } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import { fmtRate } from './ItemTile'
import { RateInput } from './RateInput'
import { ItemPicker } from '../ItemPicker'
import type { Product } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { connectionPullBlocker, pullBlockerTitle, isGoalItem } from '../../store/connections'
import { RowActionsMenu } from './RowActionsMenu'
import type { RowAction } from './RowActionsMenu'
import { ConnectionMenu } from './ConnectionMenu'
import { SummaryPane } from './SummaryPane'
import type { StripAction } from './SummaryDetailStrip'
import { ingredientRows, byproductRows } from './summaryRows'
import { productSlot, pulledSlot, byproductSlot, ingredientSlot } from './summarySegments'
import type { GoalInfo } from './summarySegments'
import { netBalance as computeNetBalance, FLOW_TOLERANCE } from '../../solver/index'

// ---------------------------------------------------------------------------
// GoalRates — a goal's target → actual in the detail strip, with inline edit for the target
// ---------------------------------------------------------------------------

interface GoalRatesProps {
  goal: Product
  info: GoalInfo
  rateUnit: RateUnit
  editing: boolean
  onStart: () => void
  onStop: () => void
  onUpdateRate: (rate: number) => void
}

function GoalRates({ goal, info, rateUnit, editing, onStart, onStop, onUpdateRate }: GoalRatesProps) {
  // goal.extraRate is stored in items/min internally
  const unitLabel = rateUnit === 'min' ? '/m' : '/s'
  const targetDisplay = fmtRate(goal.extraRate / 60, rateUnit)
  const actualDisplay = info.actual !== undefined ? fmtRate(info.actual / 60, rateUnit) : null
  const shortfallDisplay = info.actual !== undefined ? fmtRate((info.required - info.actual) / 60, rateUnit) : null
  const { short } = info

  return (
    <span className="flex items-center gap-1 text-xs">
      {/* Target rate — editable */}
      {editing ? (
        <RateInput
          initial={targetDisplay}
          rateUnit={rateUnit}
          ariaLabel="Goal target rate"
          onCommit={perMin => perMin !== undefined && onUpdateRate(perMin)}
          onStop={onStop}
        />
      ) : (
        <button
          type="button"
          onClick={onStart}
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
            title={short
              ? `Actual: ${actualDisplay}${unitLabel} — short by ${shortfallDisplay}${unitLabel}`
              : `Actual: ${actualDisplay}${unitLabel} — solver output`}
            className={`${short ? 'text-amber-400' : 'text-teal-400'} tabular-nums font-mono text-[11px] leading-none`}
          >
            {short && '▼ '}
            {actualDisplay}
          </span>
        </>
      )}

      <span className="text-gray-600 text-[10px]">{unitLabel}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// FactorySummary
// ---------------------------------------------------------------------------

export function FactorySummary() {
  const activeBlock = useBlockStore(selectActiveBlock)
  const solverResult = useSolverStore(selectBlockResult(activeBlock?.id))
  const gameData = useGameDataStore(selectGameData)
  const rateUnit = useUiStore(s => s.rateUnit)
  const addProduct = useBlockStore(s => s.addProduct)
  const removeProduct = useBlockStore(s => s.removeProduct)
  const updateProductExtra = useBlockStore(s => s.updateProductExtra)
  const [showGoalPicker, setShowGoalPicker] = useState(false)

  const toggleNoImportItem = useBlockStore(s => s.toggleNoImportItem)
  const noImportItems = activeBlock?.noImportItems ?? []
  const blocks = useBlockStore(s => s.blocks)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const removeInputConnection = useBlockStore(s => s.removeInputConnection)
  const setConnectionPull = useBlockStore(s => s.setConnectionPull)
  const allFlows = useSolverStore(selectFlows)
  const addNode = useBlockStore(s => s.addNode)
  const [byproductMenu, setByproductMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)
  const [consumerPickerItemId, setConsumerPickerItemId] = useState<string | null>(null)
  const [producerPickerItemId, setProducerPickerItemId] = useState<string | null>(null)
  const [goalMenu, setGoalMenu] = useState<{ goalId: string; x: number; y: number } | null>(null)
  const [connectionChipMenu, setConnectionChipMenu] = useState<{ connectionId: string; x: number; y: number } | null>(null)
  const [connectionMenu, setConnectionMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)

  const goals: Product[] = activeBlock?.products ?? []
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

  // What other blocks pull from this one, by item: made on demand, so neither a goal nor a byproduct.
  const pulledPerMin = new Map<string, number>()
  for (const f of allFlows) {
    if (f.fromBlockId !== activeBlockId || !f.demand) continue
    pulledPerMin.set(f.itemId, (pulledPerMin.get(f.itemId) ?? 0) + f.demand)
  }
  const pulledOnlyIds = [...pulledPerMin]
    .filter(([id, rate]) => !goalIds.has(id) && rate > FLOW_TOLERANCE)
    .map(([id]) => id)
  const isPulledOnly = (id: string) => pulledOnlyIds.includes(id)

  // Deliveries of an item that are not for a pull: a pulled-only item's byproduct surplus is
  // what is made beyond the pulled amount, minus what push connections take of it.
  const pushExportedPerMin = new Map<string, number>()
  for (const f of outputFlows) {
    if (f.demand === undefined) pushExportedPerMin.set(f.itemId, (pushExportedPerMin.get(f.itemId) ?? 0) + f.rate)
  }

  // Byproducts: net positive balance not in goals, minus what is pulled and what other blocks take.
  const byproductItems = [...netBalance]
    .filter(([id]) => !goalIds.has(id))
    .map(([id, net]) =>
      isPulledOnly(id)
        ? { itemId: id, ratePerMin: Math.max(0, net - pulledPerMin.get(id)!) - (pushExportedPerMin.get(id) ?? 0) }
        : { itemId: id, ratePerMin: net - (exportedPerMin.get(id) ?? 0) },
    )
    .filter(({ ratePerMin }) => ratePerMin > FLOW_TOLERANCE)
  const exportedByproducts = [...exportedPerMin.keys()].filter(
    id => !goalIds.has(id) && (!isPulledOnly(id) || (pushExportedPerMin.get(id) ?? 0) > FLOW_TOLERANCE),
  )
  const byproductRowList = byproductRows(byproductItems, exportedByproducts)

  // Ingredients: unsatisfied raw inputs
  const ingredientItems = (solverResult?.unsatisfied ?? []).filter(u => u.rate > 0)
  const connections = activeBlock?.inputConnections ?? []
  const ingredientRowList = ingredientRows(connections, ingredientItems, noImportItems)
  // Slots: one per item, each split into allocation segments.
  const exportsOf = (itemId: string) => outputFlows.filter(f => f.itemId === itemId)
  // A pulled-only item's pulled part sits in its product slot, the rest in Byproducts.
  const byproductExportsOf = (itemId: string) =>
    exportsOf(itemId).filter(f => !isPulledOnly(itemId) || f.demand === undefined)
  const blockIds = new Set(blocks.map(b => b.id))
  // The solver adds a pulled amount to the first goal of the item.
  const pulledGoalIds = new Set(goalIds)
  const goalSlots = goals.map(g => {
    const pulled = pulledGoalIds.delete(g.itemId) ? (pulledPerMin.get(g.itemId) ?? 0) : 0
    return productSlot(
      g,
      // No node makes the item: the goal is fully short, not unknown.
      solverResult ? (netBalance.get(g.itemId) ?? 0) : undefined,
      exportsOf(g.itemId),
      rateUnit,
      pulled,
    )
  })
  const productSlots = [
    ...goalSlots,
    ...pulledOnlyIds.map(id =>
      pulledSlot(
        id,
        pulledPerMin.get(id)!,
        netBalance.get(id) ?? 0,
        exportsOf(id).filter(f => f.demand !== undefined),
        rateUnit,
      )),
  ]
  const byproductSlots = byproductRowList.map(r => byproductSlot(r, byproductExportsOf(r.itemId)))
  const ingredientSlots = ingredientRowList.map(r => ingredientSlot(r, inputFlows, blockIds))
  // A goal shortfall can neither receive supply nor be forbidden imports (goals have no slack).
  const connectable = (itemId: string) => (activeBlock ? !isGoalItem(activeBlock, itemId) : false)
  const unitLabel = rateUnit === 'min' ? '/m' : '/s'
  const fmt = (perMin: number) => fmtRate(perMin / 60, rateUnit)

  function handleAddGoal(itemId: string, rate: number) {
    addProduct({ id: crypto.randomUUID(), itemId, extraRate: rate })
  }

  // The plan may not belong to the selected data set until its data has loaded,
  // so nothing here can be edited before then.
  if (!gameData) return null

  return (
    <div className="border-b border-gray-700 bg-gray-900 shrink-0">
      {/* Three-pane summary: Products, Byproducts, Ingredients. The key resets selection when the block changes. */}
      <div className="grid grid-cols-3 gap-2 px-3 pb-2 pt-2">
        <SummaryPane
          key={`products-${activeBlock?.id}`}
          pane="products"
          label="Products"
          action={
            <button
              type="button"
              onClick={() => setShowGoalPicker(true)}
              className="w-[22px] h-5 inline-flex items-center justify-center text-gray-400 hover:text-gray-200 rounded border border-gray-700 hover:border-gray-500"
              title="Add goal"
              aria-label="Add goal"
            >
              {/* An SVG rather than a "+" glyph, whose font metrics sit it off-centre. */}
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          }
          slots={productSlots}
          items={gameData.items}
          blocks={blocks}
          rateUnit={rateUnit}
          editable
          onSlotContextMenu={(slot, e) => {
            // A pulled-only item has no goal to edit or remove.
            if (slot.pulledOnly) return
            e.preventDefault()
            setGoalMenu({ goalId: slot.goal!.id, x: e.clientX, y: e.clientY })
          }}
          renderRates={(slot, edit) => {
            if (slot.pulledOnly) {
              return (
                <span className="text-xs text-gray-300">
                  pulled{' '}
                  {slot.pulledShort !== undefined && (
                    <span className="text-amber-400 font-mono tabular-nums">{fmt(slot.rate - slot.pulledShort)} of </span>
                  )}
                  <span className="font-mono tabular-nums">{fmt(slot.rate)}</span>
                  <span className="text-gray-600 text-[10px]">{unitLabel}</span>
                </span>
              )
            }
            const goal = goals.find(g => g.id === slot.goal!.id)
            return goal && (
              <GoalRates
                goal={goal}
                info={slot.goal!}
                rateUnit={rateUnit}
                editing={edit.editing}
                onStart={edit.start}
                onStop={edit.stop}
                onUpdateRate={rate => updateProductExtra(goal.id, rate)}
              />
            )
          }}
          actionsFor={slot => slot.pulledOnly
            ? [{ label: 'Find recipe', onSelect: () => setProducerPickerItemId(slot.itemId) }]
            : [
              { label: 'Find recipe', onSelect: () => setProducerPickerItemId(slot.itemId) },
              { label: 'Remove goal', danger: true, onSelect: () => removeProduct(slot.goal!.id) },
            ]}
          onOpenBlock={setActiveBlock}
        />

        {/* Byproducts: an item that is only exported has rate 0 and only export segments. */}
        <SummaryPane
          key={`byproducts-${activeBlock?.id}`}
          pane="byproducts"
          label="Byproducts"
          slots={byproductSlots}
          items={gameData.items}
          blocks={blocks}
          rateUnit={rateUnit}
          onSlotContextMenu={(slot, e) => {
            e.preventDefault()
            setByproductMenu({ itemId: slot.itemId, x: e.clientX, y: e.clientY })
          }}
          renderRates={slot => (
            <span className="text-xs text-gray-300">
              made <span className="font-mono tabular-nums">{fmt(slot.scale)}</span>
              <span className="text-gray-600 text-[10px]">{unitLabel}</span>
            </span>
          )}
          actionsFor={slot => [
            { label: 'Add consumer recipe…', onSelect: () => setConsumerPickerItemId(slot.itemId) },
          ]}
          onOpenBlock={setActiveBlock}
        />

        {/* Ingredients: select a slot for Find recipe / Receive from… / Forbid imports; right-click
            it for the connection menu. Remove a connection by right-clicking its segment. */}
        <SummaryPane
          key={`ingredients-${activeBlock?.id}`}
          pane="ingredients"
          label="Ingredients"
          slots={ingredientSlots}
          items={gameData.items}
          blocks={blocks}
          rateUnit={rateUnit}
          onSlotContextMenu={(slot, e) => {
            // A goal shortfall has no menu: there is nothing to offer.
            if (!connectable(slot.itemId) && !slot.locked) return
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            setConnectionMenu({ itemId: slot.itemId, x: rect.left, y: rect.bottom })
          }}
          renderRates={slot => (
            <span className="text-xs text-gray-300">
              need <span className="font-mono tabular-nums">{fmt(slot.scale)}</span>
              <span className="text-gray-600 text-[10px]">{unitLabel}</span>
            </span>
          )}
          actionsFor={slot => {
            const canConnect = connectable(slot.itemId)
            const actions: StripAction[] = [
              { label: 'Find recipe', onSelect: () => setProducerPickerItemId(slot.itemId) },
            ]
            if (canConnect) {
              actions.push({
                label: 'Receive from…',
                onSelect: e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setConnectionMenu({ itemId: slot.itemId, x: rect.left, y: rect.bottom })
                },
              })
            }
            if (canConnect || slot.locked) {
              actions.push({
                label: slot.locked ? 'Allow imports' : 'Forbid imports',
                onSelect: () => toggleNoImportItem(slot.itemId),
              })
            }
            return actions
          }}
          onOpenBlock={setActiveBlock}
          onConnectionContextMenu={(connectionId, e) =>
            setConnectionChipMenu({ connectionId, x: e.clientX, y: e.clientY })}
        />
      </div>

      {connectionMenu && (
        <ConnectionMenu
          itemId={connectionMenu.itemId}
          x={connectionMenu.x}
          y={connectionMenu.y}
          onClose={() => setConnectionMenu(null)}
        />
      )}

      {goalMenu && (
        <RowActionsMenu
          x={goalMenu.x}
          y={goalMenu.y}
          actions={[{ label: 'Remove goal', danger: true, onSelect: () => removeProduct(goalMenu.goalId) }]}
          onClose={() => setGoalMenu(null)}
        />
      )}

      {connectionChipMenu && (() => {
        const connection = connections.find(c => c.id === connectionChipMenu.connectionId)
        const actions: RowAction[] = []
        if (activeBlock && connection) {
          actions.push(connection.pull
            ? { label: 'Stop pulling', onSelect: () => setConnectionPull(connection.id, false) }
            : (() => {
              const blocker = gameData ? connectionPullBlocker(blocks, activeBlock, connection, gameData) : 'no-producer'
              return {
                label: 'Pull from source',
                disabled: blocker !== undefined,
                title: blocker && pullBlockerTitle(
                  blocker,
                  blocks.find(b => b.id === connection.fromBlockId)?.name ?? connection.fromBlockId,
                  activeBlock.name,
                  gameData?.items[connection.itemId]?.name ?? connection.itemId,
                ),
                onSelect: () => setConnectionPull(connection.id, true),
              }
            })())
        }
        actions.push({
          label: 'Remove connection',
          danger: true,
          onSelect: () => removeInputConnection(connectionChipMenu.connectionId),
        })
        return (
          <RowActionsMenu
            x={connectionChipMenu.x}
            y={connectionChipMenu.y}
            actions={actions}
            onClose={() => setConnectionChipMenu(null)}
          />
        )
      })()}

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
