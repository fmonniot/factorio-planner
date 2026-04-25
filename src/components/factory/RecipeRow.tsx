import type { SolvedNode, GameData, RecipeNode, SubPlanNode } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { ItemTile } from './ItemTile'
import { MachineCell } from './MachinePopover'
import { ModuleCell } from './ModulePopover'
import { BeaconCell } from './BeaconPopover'

// ---------------------------------------------------------------------------
// RecipeRow
// ---------------------------------------------------------------------------

interface RecipeRowProps {
  /** Solver output for this node (undefined when solver hasn't run yet). */
  solvedNode: SolvedNode | undefined
  /** The plan node (game-recipe or subplan). */
  planNode: RecipeNode | SubPlanNode
  /** Whether this is the first / last row in the list (for disabling move buttons). */
  isFirst: boolean
  isLast: boolean
  gameData: GameData
}

export function RecipeRow({ solvedNode, planNode, isFirst, isLast, gameData }: RecipeRowProps) {
  const moveNodeUp = useBlockStore(s => s.moveNodeUp)
  const moveNodeDown = useBlockStore(s => s.moveNodeDown)
  const updateNodeByproductPolicy = useBlockStore(s => s.updateNodeByproductPolicy)
  const pushFloor = useUiStore(s => s.pushFloor)

  // ── Resolve recipe & machine ───────────────────────────────────────────────

  if (planNode.kind === 'subplan') {
    // SubPlan node: minimal row, click drills into the floor
    const label = `Subplan: ${planNode.subPlanId}`
    return (
      <tr className="border-b border-gray-800 hover:bg-gray-800/40">
        <ReorderCell nodeId={planNode.id} isFirst={isFirst} isLast={isLast} moveUp={moveNodeUp} moveDown={moveNodeDown} />
        <td className="px-2 py-1">
          <input type="checkbox" disabled className="opacity-40" />
        </td>
        <td className="px-2 py-1" colSpan={7}>
          <button
            type="button"
            onClick={() => pushFloor(planNode.subPlanId)}
            className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
            title="Drill into subplan"
          >
            ↳ {label}
          </button>
        </td>
      </tr>
    )
  }

  const recipe = gameData.recipes[planNode.recipeId]
  if (!recipe) return null

  const resolvedMachineId = planNode.machineId ?? gameData.defaultMachines[recipe.category]
  const machine = resolvedMachineId ? gameData.machines[resolvedMachineId] : undefined

  const primaryItemId = planNode.primaryProduct ?? recipe.mainProduct ?? recipe.products[0]?.itemId

  // ── Classify outputs into products vs byproducts ───────────────────────────

  const outputEntries = solvedNode ? Object.entries(solvedNode.outputRates) : []
  const productEntries = outputEntries.filter(([id]) => id === primaryItemId)
  const byproductEntries = outputEntries.filter(([id]) => id !== primaryItemId)

  const inputEntries = solvedNode ? Object.entries(solvedNode.inputRates) : []

  const powerKw = solvedNode?.powerKw ?? 0

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/40">
      {/* Reorder */}
      <ReorderCell nodeId={planNode.id} isFirst={isFirst} isLast={isLast} moveUp={moveNodeUp} moveDown={moveNodeDown} />

      {/* Enable checkbox — placeholder; enable/disable not yet in schema */}
      <td className="px-2 py-1">
        <input type="checkbox" defaultChecked disabled className="opacity-40" />
      </td>

      {/* Recipe */}
      <td className="px-2 py-1 whitespace-nowrap">
        <span className="text-xs text-gray-200 truncate max-w-[10rem] block" title={recipe.name}>
          {recipe.name}
        </span>
      </td>

      {/* Machine + module slots */}
      <td className="px-2 py-1 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <MachineCell
            nodeId={planNode.id}
            recipeId={planNode.recipeId}
            recipeCategory={recipe.category}
            machineId={planNode.machineId}
            machineCountCeil={solvedNode?.machineCountCeil ?? 0}
            gameData={gameData}
          />
          <ModuleCell
            nodeId={planNode.id}
            modules={planNode.modules}
            machineSlots={machine?.moduleSlots ?? 0}
            allowedMachineEffects={machine?.allowedEffects ?? []}
            recipeId={planNode.recipeId}
            gameData={gameData}
          />
        </div>
      </td>

      {/* Beacon */}
      <td className="px-2 py-1 whitespace-nowrap">
        <BeaconCell
          nodeId={planNode.id}
          beacon={planNode.beaconConfig}
          gameData={gameData}
        />
      </td>

      {/* Products */}
      <td className="px-2 py-1">
        <div className="flex flex-wrap gap-0.5">
          {productEntries.map(([itemId, ratePerMin]) => (
            <ItemTile
              key={itemId}
              item={gameData.items[itemId]}
              ratePerSec={ratePerMin / 60}
              variant="product"
            />
          ))}
        </div>
      </td>

      {/* Byproducts */}
      <td className="px-2 py-1">
        <div className="flex flex-wrap gap-0.5">
          {byproductEntries.map(([itemId, ratePerMin]) => {
            const policy = planNode.byproductPolicy[itemId] ?? 'feed-back'
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
                title={`${gameData.items[itemId]?.name ?? itemId} — ${policy} (click to toggle)`}
              />
            )
          })}
        </div>
      </td>

      {/* Ingredients */}
      <td className="px-2 py-1">
        <div className="flex flex-wrap gap-0.5">
          {inputEntries.map(([itemId, ratePerMin]) => (
            <ItemTile
              key={itemId}
              item={gameData.items[itemId]}
              ratePerSec={ratePerMin / 60}
              variant="ingredient"
            />
          ))}
        </div>
      </td>

      {/* Electricity */}
      <td className="px-2 py-1 whitespace-nowrap">
        {powerKw > 0 && (
          <ItemTile
            item={undefined}
            ratePerSec={powerKw / 60}
            variant="electricity"
            title={`${powerKw.toFixed(1)} kW`}
          />
        )}
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
    <td className="px-1 py-1 w-8">
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
