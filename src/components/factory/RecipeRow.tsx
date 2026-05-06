import { useState } from 'react'
import type { SolvedNode, GameData, RecipeNode, SubPlanNode, SubPlan } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { ItemTile, fmtRate } from './ItemTile'
import { MachineCell } from './MachinePopover'
import { ModuleCell } from './ModulePopover'
import { BeaconCell } from './BeaconPopover'
import { EditMachineModal } from './EditMachineModal'
import { iconUrl } from '../../utils/iconUrl'

// ---------------------------------------------------------------------------
// RecipeRow
// ---------------------------------------------------------------------------

interface RecipeRowProps {
  solvedNode: SolvedNode | undefined
  planNode: RecipeNode | SubPlanNode
  isFirst: boolean
  isLast: boolean
  depth: number
  isExpanded?: boolean
  onToggleExpand?: () => void
  gameData: GameData
  rootPlan: SubPlan
  /** Open the recipe picker pre-filtered to recipes producing this item. */
  onIngredientClick?: (itemId: string) => void
}

export function RecipeRow({
  solvedNode,
  planNode,
  isFirst,
  isLast,
  depth,
  isExpanded,
  onToggleExpand,
  gameData,
  rootPlan,
  onIngredientClick,
}: RecipeRowProps) {
  const moveNodeUp = useBlockStore(s => s.moveNodeUp)
  const moveNodeDown = useBlockStore(s => s.moveNodeDown)
  const updateNodeByproductPolicy = useBlockStore(s => s.updateNodeByproductPolicy)
  const updateNodeByproductConsumer = useBlockStore(s => s.updateNodeByproductConsumer)
  const updateNodePrimaryProduct = useBlockStore(s => s.updateNodePrimaryProduct)
  const updateNodePinnedRate = useBlockStore(s => s.updateNodePinnedRate)
  const wrapNodeInSubPlan = useBlockStore(s => s.wrapNodeInSubPlan)
  const removeNode = useBlockStore(s => s.removeNode)
  const rateUnit = useUiStore(s => s.rateUnit)

  const indentPx = depth * 16
  const [editMachineOpen, setEditMachineOpen] = useState(false)

  // ── SubPlan node ─────────────────────────────────────────────────────────

  if (planNode.kind === 'subplan') {
    const childPlan = findSubPlanDeep(rootPlan, planNode.subPlanId)
    const label = childPlan?.name ?? planNode.subPlanId

    return (
      <tr className="border-b border-gray-800 bg-gray-800/20 hover:bg-gray-800/40 group">
        <ReorderCell nodeId={planNode.id} isFirst={isFirst} isLast={isLast} moveUp={moveNodeUp} moveDown={moveNodeDown} />
        <td className="px-2 py-0.5" colSpan={6} style={{ paddingLeft: `${8 + indentPx}px` }}>
          <button
            type="button"
            onClick={onToggleExpand}
            className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 w-full text-left"
          >
            <span className="shrink-0">{isExpanded ? '▼' : '▶'}</span>
            <span className="font-medium">{label}</span>
            {childPlan && (
              <span className="text-gray-600 text-[10px]">
                {childPlan.nodes.length} recipe{childPlan.nodes.length !== 1 ? 's' : ''}
              </span>
            )}
          </button>
        </td>
        <td className="px-1 py-0.5 text-right">
          <button
            type="button"
            onClick={() => removeNode(planNode.id)}
            title="Remove subplan"
            className="text-gray-700 hover:text-red-400 text-sm leading-none opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ×
          </button>
        </td>
      </tr>
    )
  }

  // ── Game-recipe node ──────────────────────────────────────────────────────

  const recipe = gameData.recipes[planNode.recipeId]
  if (!recipe) return null

  const resolvedMachineId = planNode.machineId ?? gameData.defaultMachines[recipe.category]
  const machine = resolvedMachineId ? gameData.machines[resolvedMachineId] : undefined

  const primaryItemId = planNode.primaryProduct ?? recipe.mainProduct ?? recipe.products[0]?.itemId
  const isMultiOutput = recipe.products.length > 1
  const isPinned = planNode.pinnedRate !== undefined
  const isByproductConsumer = planNode.byproductConsumer === true

  const outputEntries = solvedNode ? Object.entries(solvedNode.outputRates) : []
  const productEntries = outputEntries.filter(([id]) => id === primaryItemId)
  const byproductEntries = outputEntries.filter(([id]) => id !== primaryItemId)
  const inputEntries = solvedNode ? Object.entries(solvedNode.inputRates) : []
  const powerKw = solvedNode?.powerKw ?? 0

  // Rate for the pinned input — expressed in the current unit.
  const unitMultiplier = rateUnit === 'min' ? 60 : 1

  function handlePin() {
    const seedRate = Math.max(solvedNode?.throughput ?? 0, 1)
    updateNodePinnedRate(planNode.id, seedRate)
  }

  function handleUnpin() {
    updateNodePinnedRate(planNode.id, undefined)
  }

  function handlePinnedRateChange(raw: string) {
    const v = parseFloat(raw)
    if (isFinite(v) && v > 0) {
      updateNodePinnedRate(planNode.id, v / unitMultiplier)
    }
  }

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/40 group">
      {/* Reorder */}
      <ReorderCell nodeId={planNode.id} isFirst={isFirst} isLast={isLast} moveUp={moveNodeUp} moveDown={moveNodeDown} />

      {/* Recipe icon + wrap + pin */}
      <td className="px-2 py-0.5 whitespace-nowrap" style={{ paddingLeft: `${8 + indentPx}px` }}>
        <div className="flex items-center gap-1">
          {/* Byproduct-consumer toggle */}
          <button
            type="button"
            onClick={() => updateNodeByproductConsumer(planNode.id, !isByproductConsumer)}
            title={isByproductConsumer ? 'Stop absorbing byproduct (re-enter main solve)' : 'Only run to absorb byproduct from other recipes'}
            className={`text-sm leading-none shrink-0 transition-opacity ${
              isByproductConsumer
                ? 'text-emerald-400 hover:text-emerald-300'
                : 'text-gray-700 hover:text-gray-400 opacity-0 group-hover:opacity-100'
            }`}
          >
            ♻
          </button>
          {/* Pin toggle — hidden when byproduct consumer (throughput is derived) */}
          {!isByproductConsumer && (
            <button
              type="button"
              onClick={isPinned ? handleUnpin : handlePin}
              title={isPinned ? 'Unpin rate' : 'Pin rate'}
              className={`text-sm leading-none shrink-0 transition-opacity ${
                isPinned
                  ? 'text-yellow-400 hover:text-yellow-300'
                  : 'text-gray-700 hover:text-gray-400 opacity-0 group-hover:opacity-100'
              }`}
            >
              {isPinned ? '📌' : '📍'}
            </button>
          )}
          {/* Wrap in subfactory */}
          <button
            type="button"
            onClick={() => {
              const name = window.prompt('Subfactory name:', recipe.name)
              if (name?.trim()) wrapNodeInSubPlan(planNode.id, name.trim())
            }}
            className="text-gray-700 hover:text-gray-500 text-[10px] leading-none shrink-0 opacity-0 group-hover:opacity-100"
            title="Wrap in subfactory"
          >
            ⊞
          </button>
          {/* Remove node */}
          <button
            type="button"
            onClick={() => removeNode(planNode.id)}
            title="Remove recipe"
            className="text-gray-700 hover:text-red-400 text-sm leading-none shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            ×
          </button>
          {/* Recipe icon derived from primary product */}
          {primaryItemId && gameData.items[primaryItemId]?.iconPath ? (
            <img
              src={iconUrl(gameData.items[primaryItemId]!.iconPath)}
              alt={recipe.name}
              title={recipe.name}
              className="w-8 h-8 object-contain shrink-0"
            />
          ) : (
            <span
              title={recipe.name}
              className="w-8 h-8 bg-gray-800 rounded text-[9px] text-gray-400 flex items-center justify-center shrink-0 leading-none select-none"
            >
              {recipe.name.substring(0, 2).toUpperCase()}
            </span>
          )}
        </div>
      </td>

      {/* Machine + module slots */}
      <td className="px-2 py-0.5 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <MachineCell
            nodeId={planNode.id}
            recipeId={planNode.recipeId}
            recipeCategory={recipe.category}
            machineId={planNode.machineId}
            machineCountCeil={solvedNode?.machineCountCeil ?? 0}
            gameData={gameData}
            onOpenEdit={() => setEditMachineOpen(true)}
          />
          <ModuleCell
            modules={planNode.modules}
            machineSlots={machine?.moduleSlots ?? 0}
            gameData={gameData}
            onOpenEdit={() => setEditMachineOpen(true)}
          />
        </div>
        {editMachineOpen && (
          <EditMachineModal
            nodeId={planNode.id}
            recipeId={planNode.recipeId}
            recipeCategory={recipe.category}
            machineId={planNode.machineId}
            machineCountCeil={solvedNode?.machineCountCeil ?? 0}
            modules={planNode.modules}
            gameData={gameData}
            onClose={() => setEditMachineOpen(false)}
          />
        )}
      </td>

      {/* Beacon */}
      <td className="px-2 py-0.5 whitespace-nowrap">
        <BeaconCell
          nodeId={planNode.id}
          beacon={planNode.beaconConfig}
          gameData={gameData}
          recipeId={planNode.recipeId}
          machineId={planNode.machineId}
          recipeCategory={recipe.category}
        />
      </td>

      {/* Products — primary output(s), with pinned-rate input when pinned */}
      <td className="px-2 py-0.5">
        <div className="flex flex-wrap gap-0.5 items-center">
          {productEntries.map(([itemId, ratePerMin]) => {
            if (isPinned && !isByproductConsumer) {
              // Replace the static tile with an editable input.
              return (
                <div key={itemId} className="flex items-center gap-1">
                  <input
                    type="number"
                    min="0.001"
                    step="any"
                    aria-label="Pinned rate"
                    defaultValue={fmtRate((planNode.pinnedRate ?? 0) * unitMultiplier, rateUnit)}
                    key={`${planNode.id}-pin-${rateUnit}`}
                    onChange={e => handlePinnedRateChange(e.target.value)}
                    className="w-20 bg-gray-700 text-yellow-300 text-xs rounded px-1 py-0.5 border border-yellow-700 outline-none focus:ring-1 focus:ring-yellow-500 text-right tabular-nums"
                  />
                  <span className="text-gray-600 text-[10px]">{rateUnit === 'min' ? '/m' : '/s'}</span>
                </div>
              )
            }
            return (
              <ItemTile
                key={itemId}
                item={gameData.items[itemId]}
                ratePerSec={ratePerMin / 60}
                variant="product"
              />
            )
          })}
        </div>
      </td>

      {/* Byproducts — non-primary outputs; click tile to make it primary */}
      <td className="px-2 py-0.5">
        <div className="flex flex-wrap gap-0.5">
          {byproductEntries.map(([itemId, ratePerMin]) => {
            const policy = planNode.byproductPolicy[itemId] ?? 'feed-back'
            const itemName = gameData.items[itemId]?.name ?? itemId

            if (isMultiOutput) {
              // In multi-output recipes, clicking a byproduct tile makes it primary.
              return (
                <ItemTile
                  key={itemId}
                  item={gameData.items[itemId]}
                  ratePerSec={ratePerMin / 60}
                  variant="byproduct"
                  onClick={() => updateNodePrimaryProduct(planNode.id, itemId)}
                  title={`${itemName} — Set as primary`}
                />
              )
            }

            // Single-output (shouldn't have byproducts, but handle gracefully):
            // clicking toggles feed-back / discard policy.
            return (
              <ItemTile
                key={itemId}
                item={gameData.items[itemId]}
                ratePerSec={ratePerMin / 60}
                variant="byproduct"
                onClick={() =>
                  updateNodeByproductPolicy(planNode.id, {
                    ...planNode.byproductPolicy,
                    [itemId]: policy === 'feed-back' ? 'discard' : 'feed-back',
                  })
                }
                title={`${itemName} — ${policy} (click to toggle)`}
              />
            )
          })}
        </div>
      </td>

      {/* Ingredients + electricity inline */}
      <td className="px-2 py-0.5">
        <div className="flex flex-wrap gap-0.5">
          {inputEntries.map(([itemId, ratePerMin]) => {
            const itemName = gameData.items[itemId]?.name ?? itemId
            return (
              <ItemTile
                key={itemId}
                item={gameData.items[itemId]}
                ratePerSec={ratePerMin / 60}
                variant="ingredient"
                onClick={onIngredientClick ? () => onIngredientClick(itemId) : undefined}
                title={onIngredientClick ? `${itemName} — Find producer recipe` : undefined}
              />
            )
          })}
          {powerKw > 0 && (
            <ItemTile
              item={undefined}
              ratePerSec={powerKw / 60}
              variant="electricity"
              title={`${powerKw.toFixed(1)} kW`}
            />
          )}
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// ReorderCell
// ---------------------------------------------------------------------------

interface ReorderCellProps {
  nodeId: string
  isFirst: boolean
  isLast: boolean
  moveUp: (id: string) => void
  moveDown: (id: string) => void
}

function ReorderCell({ nodeId, isFirst, isLast, moveUp, moveDown }: ReorderCellProps) {
  return (
    <td className="px-1 py-0.5 w-8">
      <div className="flex flex-col items-center gap-0">
        <button
          type="button"
          onClick={() => moveUp(nodeId)}
          disabled={isFirst}
          className="text-gray-600 hover:text-gray-300 disabled:opacity-20 leading-none text-[10px]"
          aria-label="Move up"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => moveDown(nodeId)}
          disabled={isLast}
          className="text-gray-600 hover:text-gray-300 disabled:opacity-20 leading-none text-[10px]"
          aria-label="Move down"
        >
          ▼
        </button>
      </div>
    </td>
  )
}

// ---------------------------------------------------------------------------
// Helper: find subplan anywhere in the tree
// ---------------------------------------------------------------------------

function findSubPlanDeep(plan: SubPlan, id: string): SubPlan | undefined {
  if (plan.id === id) return plan
  for (const sp of plan.subPlans) {
    const found = findSubPlanDeep(sp, id)
    if (found) return found
  }
  return undefined
}
