import type { SolvedNode, GameData, RecipeNode, SubPlanNode, SubPlan } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
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
  /** Whether this is the first / last row in the sibling list. */
  isFirst: boolean
  isLast: boolean
  /** Nesting depth (0 = root, 1 = inside first-level subplan, …). */
  depth: number
  /** For SubPlanNode rows only: whether children are currently shown. */
  isExpanded?: boolean
  onToggleExpand?: () => void
  gameData: GameData
  /** The full subplan tree (needed to resolve subplan names). */
  rootPlan: SubPlan
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
}: RecipeRowProps) {
  const moveNodeUp = useBlockStore(s => s.moveNodeUp)
  const moveNodeDown = useBlockStore(s => s.moveNodeDown)
  const updateNodeByproductPolicy = useBlockStore(s => s.updateNodeByproductPolicy)
  const wrapNodeInSubPlan = useBlockStore(s => s.wrapNodeInSubPlan)

  const indentPx = depth * 16

  // ── SubPlan node ─────────────────────────────────────────────────────────

  if (planNode.kind === 'subplan') {
    const childPlan = rootPlan.subPlans.find(sp => sp.id === planNode.subPlanId)
      ?? findSubPlanDeep(rootPlan, planNode.subPlanId)
    const label = childPlan?.name ?? planNode.subPlanId

    return (
      <tr className="border-b border-gray-800 bg-gray-800/20 hover:bg-gray-800/40">
        <ReorderCell nodeId={planNode.id} isFirst={isFirst} isLast={isLast} moveUp={moveNodeUp} moveDown={moveNodeDown} />
        <td
          className="px-2 py-1"
          colSpan={8}
          style={{ paddingLeft: `${8 + indentPx}px` }}
        >
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
      </tr>
    )
  }

  // ── Game-recipe node ──────────────────────────────────────────────────────

  const recipe = gameData.recipes[planNode.recipeId]
  if (!recipe) return null

  const resolvedMachineId = planNode.machineId ?? gameData.defaultMachines[recipe.category]
  const machine = resolvedMachineId ? gameData.machines[resolvedMachineId] : undefined

  const primaryItemId = planNode.primaryProduct ?? recipe.mainProduct ?? recipe.products[0]?.itemId

  const outputEntries = solvedNode ? Object.entries(solvedNode.outputRates) : []
  const productEntries = outputEntries.filter(([id]) => id === primaryItemId)
  const byproductEntries = outputEntries.filter(([id]) => id !== primaryItemId)
  const inputEntries = solvedNode ? Object.entries(solvedNode.inputRates) : []
  const powerKw = solvedNode?.powerKw ?? 0

  return (
    <tr className="border-b border-gray-800 hover:bg-gray-800/40">
      {/* Reorder */}
      <ReorderCell nodeId={planNode.id} isFirst={isFirst} isLast={isLast} moveUp={moveNodeUp} moveDown={moveNodeDown} />

      {/* Recipe */}
      <td className="px-2 py-1 whitespace-nowrap" style={{ paddingLeft: `${8 + indentPx}px` }}>
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-200 truncate max-w-[10rem]" title={recipe.name}>
            {recipe.name}
          </span>
          <button
            type="button"
            onClick={() => {
              const name = window.prompt('Subfactory name:', recipe.name)
              if (name?.trim()) wrapNodeInSubPlan(planNode.id, name.trim())
            }}
            className="text-gray-700 hover:text-gray-500 text-[10px] leading-none shrink-0"
            title="Wrap in subfactory"
          >
            ⊞
          </button>
        </div>
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
