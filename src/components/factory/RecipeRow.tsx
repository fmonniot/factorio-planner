import { useState, useRef, useMemo } from 'react'
import type { SolvedNode, SolvedArea, GameData, RecipeNode, SubPlanNode, SubPlan } from '../../data/types'
import { useBlockStore } from '../../store/blockStore'
import { isSubPlanDescendant } from '../../store/blockStore'
import { useUiStore, type RateUnit } from '../../store/uiStore'
import { useHorizon } from '../../store/horizon'
import { resolveRowMachine } from '../../data/horizon'
import { ItemTile, fmtRate } from './ItemTile'
import { MachineCell } from './MachineCell'
import { ModuleCell } from './ModuleCell'
import { BeaconCell } from './BeaconPopover'
import { EditMachineModal } from './EditMachineModal'
import { Icon } from '../Icon'
import { useRecipeDnd } from './RecipeDnd'
import { RowActionsMenu, type RowAction } from './RowActionsMenu'
import { FlowChip } from './AreasPane'
import { areaName } from './areaRows'
import {
  buildAlsoInOptions,
  duplicateToOptions,
  goToRowOptions,
  multiAreaSummary,
  multiAreaTitle,
  recipeAreaIds,
  type AreaView,
} from './recipeAreas'
import { dedicatedProduct } from '../../solver/areas'
import { countSubPlanContents } from './subPlanContents'
import { ingredientTemperatureLabels } from './temperature'

/** Solved items-per-run of the primary product; undefined unless strictly positive. */
// eslint-disable-next-line react-refresh/only-export-components
export function solvedPrimaryPerRun(
  primaryItemId: string | undefined,
  solvedNode: SolvedNode | undefined,
): number | undefined {
  if (!primaryItemId || !solvedNode || !(solvedNode.throughput > 0)) return undefined
  const out = solvedNode.outputRates[primaryItemId]
  if (out === undefined || !(out > 0)) return undefined
  const v = out / solvedNode.throughput
  return Number.isFinite(v) ? v : undefined
}

/**
 * Items of `primaryItemId` produced per recipe execution, productivity included.
 * Derived from the solved node when available (so it follows modules and
 * productivity); otherwise from the recipe's declared product amounts.
 * Converts the stored pin (executions/min) to the primary product's rate.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function primaryItemPerRun(
  recipe: GameData['recipes'][string],
  primaryItemId: string | undefined,
  solvedNode: SolvedNode | undefined,
): number {
  const solved = solvedPrimaryPerRun(primaryItemId, solvedNode)
  if (solved !== undefined) return solved
  const declared = recipe.products
    .filter(p => p.itemId === primaryItemId)
    .reduce((sum, p) => sum + (p.amount ?? 0) * (p.probability ?? 1), 0)
  return declared > 0 ? declared : 1
}

// ---------------------------------------------------------------------------
// RecipeRow
// ---------------------------------------------------------------------------

const BYPRODUCT_CONSUMER_HINT =
  'Absorbs byproduct: runs only to consume surplus from other recipes and never imports its own inputs. Right-click the row to stop absorbing.'

const PRIMARY_AREA_HINT = '; the primary product decides what this row builds for its area'

/** Chips shown per direction on a collapsed area row; the rest is a "+N". */
const AREA_CHIP_CAP = 4

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
  /** The SubPlan that directly contains this node — used for DnD. */
  parentSubPlanId: string
  /** Index of this node within its parent SubPlan — used for DnD. */
  nodeIndex: number
  /** Open the recipe picker pre-filtered to recipes producing this item. */
  onIngredientClick?: (itemId: string, subPlanId: string) => void
  /** Open the recipe picker filtered to recipes consuming this byproduct. */
  onAddConsumer?: (itemId: string, subPlanId: string) => void
  /** Areas of the block, solved rows and flows; absent in tests that do not need them. */
  areaView?: AreaView
  /** Flash the row: it was just revealed. */
  isHighlighted?: boolean
  /** Shown under a recipe line of the by-recipe view: no reorder or drag (the position means nothing there), and the area's name instead of the multi-area badge. */
  byRecipeView?: boolean
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
  parentSubPlanId,
  nodeIndex,
  onIngredientClick,
  onAddConsumer,
  areaView,
  isHighlighted,
  byRecipeView = false,
}: RecipeRowProps) {
  const moveNodeUp = useBlockStore(s => s.moveNodeUp)
  const moveNodeDown = useBlockStore(s => s.moveNodeDown)
  const moveNode = useBlockStore(s => s.moveNode)
  const updateNodeByproductPolicy = useBlockStore(s => s.updateNodeByproductPolicy)
  const updateNodeByproductConsumer = useBlockStore(s => s.updateNodeByproductConsumer)
  const updateNodePrimaryProduct = useBlockStore(s => s.updateNodePrimaryProduct)
  const updateNodePinnedRate = useBlockStore(s => s.updateNodePinnedRate)
  const wrapNodeInSubPlan = useBlockStore(s => s.wrapNodeInSubPlan)
  const removeNode = useBlockStore(s => s.removeNode)
  const removeSubPlan = useBlockStore(s => s.removeSubPlan)
  const renameSubPlan = useBlockStore(s => s.renameSubPlan)
  const setSubPlanArea = useBlockStore(s => s.setSubPlanArea)
  const buildRowAlsoIn = useBlockStore(s => s.buildRowAlsoIn)
  const duplicateSubPlanTo = useBlockStore(s => s.duplicateSubPlanTo)
  const requestRevealRow = useUiStore(s => s.requestRevealRow)
  const rateUnit = useUiStore(s => s.rateUnit)
  const horizon = useHorizon(gameData)

  const { dragging, beginDrag, endDrag } = useRecipeDnd()
  const [dropZone, setDropZone] = useState<'before' | 'after' | 'into' | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)
  // Last positive solved items-per-run, so the pin factor (and the pin input's
  // key) stays stable when a later solve zeroes this node.
  const [lastSolvedPerRun, setLastSolvedPerRun] = useState<number | undefined>(undefined)

  const indentPx = depth * 16
  // The badge tooltip, memoised: it walks every area of the recipe, and a badged row renders often.
  const multiAreaBadgeTitle = useMemo(() => {
    if (planNode.kind !== 'game-recipe' || !areaView) return undefined
    const hereId = areaView.index.rowById.get(planNode.id)?.areaId
    const recipeName = gameData.recipes[planNode.recipeId]?.name
    if (!hereId || recipeName === undefined || recipeAreaIds(areaView.index, planNode.recipeId).length < 2) return undefined
    return multiAreaTitle(
      recipeName,
      multiAreaSummary(areaView.index, rootPlan, planNode.recipeId, hereId, areaView.solvedMap),
      hereId,
    )
  }, [planNode, areaView, gameData, rootPlan])
  const [editMachineOpen, setEditMachineOpen] = useState(false)
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [byproductMenu, setByproductMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)
  // The menus opened from the row menu's "Build also in…" and "Go to row in…", and a sub-factory's "Duplicate to…".
  const [areaMenu, setAreaMenu] = useState<{ kind: 'build' | 'goto' | 'duplicate'; x: number; y: number } | null>(null)

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.effectAllowed = 'move'
    setIsDragging(true)
    if (planNode.kind === 'subplan') {
      beginDrag({ nodeId: planNode.id, kind: 'subplan', subPlanId: planNode.subPlanId, sourceSubPlanId: parentSubPlanId })
    } else {
      beginDrag({ nodeId: planNode.id, kind: 'game-recipe', sourceSubPlanId: parentSubPlanId })
    }
  }

  function handleDragEnd() {
    setIsDragging(false)
    setDropZone(null)
    endDrag()
  }

  function computeDropZone(e: React.DragEvent): 'before' | 'after' | 'into' | null {
    if (!dragging) return null
    const rect = rowRef.current?.getBoundingClientRect()
    if (!rect) return null

    // Cycle guard: don't allow dropping a subplan onto its own subtree.
    if (dragging.kind === 'subplan' && dragging.subPlanId) {
      if (isSubPlanDescendant(rootPlan, dragging.subPlanId, parentSubPlanId)) return null
    }

    const relY = (e.clientY - rect.top) / rect.height

    if (planNode.kind === 'subplan') {
      // Collapsed subgroup: always append-into
      if (!isExpanded) return 'into'
      // Expanded subgroup: top half = before (sibling), bottom half = first child
      return relY < 0.5 ? 'before' : 'into'
    }

    return relY < 0.5 ? 'before' : 'after'
  }

  function handleDragOver(e: React.DragEvent) {
    const zone = computeDropZone(e)
    if (!zone) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropZone(zone)
  }

  function handleDragLeave(e: React.DragEvent) {
    // dragleave bubbles from child elements; only clear when the pointer leaves the row itself.
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return
    setDropZone(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const zone = dropZone ?? computeDropZone(e)
    if (!dragging || !zone) { setDropZone(null); return }

    if (zone === 'into') {
      // Append into the subplan referenced by this node.
      if (planNode.kind === 'subplan') {
        const childPlan = findSubPlanDeep(rootPlan, planNode.subPlanId)
        if (childPlan) {
          moveNode(dragging.nodeId, childPlan.id, childPlan.nodes.length)
        }
      }
    } else {
      const insertIndex = zone === 'before' ? nodeIndex : nodeIndex + 1
      moveNode(dragging.nodeId, parentSubPlanId, insertIndex)
    }

    setDropZone(null)
    endDrag()
  }

  const highlightProps = isHighlighted ? { 'data-highlighted': 'true' } : {}
  const highlightClass = isHighlighted ? 'bg-teal-900/40 outline outline-2 outline-teal-400' : ''

  // ── SubPlan node ─────────────────────────────────────────────────────────

  if (planNode.kind === 'subplan') {
    const childPlan = findSubPlanDeep(rootPlan, planNode.subPlanId)
    const subPlanId = planNode.subPlanId
    const label = childPlan?.name ?? subPlanId

    function handleRenameSubPlan() {
      const name = window.prompt('Subfactory name:', label)
      if (name?.trim()) renameSubPlan(subPlanId, name.trim())
    }

    function handleRemoveSubPlan() {
      const isEmpty = !childPlan || (childPlan.nodes.length === 0 && childPlan.subPlans.length === 0)
      if (!isEmpty) {
        const { recipes, subfactories } = countSubPlanContents(childPlan)
        const parts = [
          recipes > 0 && `${recipes} recipe${recipes !== 1 ? 's' : ''}`,
          subfactories > 0 && `${subfactories} nested subfactor${subfactories !== 1 ? 'ies' : 'y'}`,
        ].filter(Boolean)
        if (!window.confirm(`Remove subfactory "${label}" and its ${parts.join(' and ') || 'contents'}?`)) return
      }
      removeSubPlan(subPlanId)
    }

    // Only while a menu is open: the options walk the tree for every area.
    const dupOptions = (menuPos || areaMenu) && areaView
      ? duplicateToOptions(areaView.index, rootPlan, subPlanId, id => gameData.recipes[id]?.name ?? id)
      : []
    const dupEnabled = dupOptions.some(o => !o.disabledReason)

    const solvedArea = childPlan?.area === true && !isExpanded
      ? areaView?.solvedAreas?.find(a => a.areaId === subPlanId)
      : undefined

    const subplanOutline = dropZone === 'into' ? 'outline outline-2 outline-blue-500' : ''
    const subplanOpacity = isDragging ? 'opacity-50' : ''

    return (
      <tr
        ref={rowRef}
        data-node-id={planNode.id}
        {...highlightProps}
        className={`border-b border-gray-800 bg-gray-800/20 hover:bg-gray-800/40 group relative ${subplanOutline} ${subplanOpacity} ${highlightClass}`}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <ReorderCell nodeId={planNode.id} isFirst={isFirst} isLast={isLast} moveUp={moveNodeUp} moveDown={moveNodeDown} />
        <td
          className="px-2 py-0.5"
          colSpan={6}
          style={{ paddingLeft: `${8 + indentPx}px` }}
          onContextMenu={e => {
            e.preventDefault()
            setAreaMenu(null)
            setMenuPos({ x: e.clientX, y: e.clientY })
          }}
        >
          {dropZone === 'before' && <DropLine edge="top" />}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onToggleExpand}
              className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 text-left"
            >
              <span className="shrink-0">{isExpanded ? '▼' : '▶'}</span>
              <span className="font-medium">{label}</span>
              {childPlan?.area === true && (
                <span
                  data-testid="area-marker"
                  title="Separate area"
                  className="text-[10px] px-1 rounded border border-teal-700 text-teal-300"
                >
                  Area
                </span>
              )}
              {childPlan && (() => {
                const { recipes } = countSubPlanContents(childPlan)
                return (
                  <span className="text-gray-600 text-[10px]">
                    {recipes} recipe{recipes !== 1 ? 's' : ''}
                  </span>
                )
              })()}
            </button>
            {solvedArea && (solvedArea.receives.length > 0 || solvedArea.sends.length > 0) && (
              <AreaChips area={solvedArea} items={gameData.items} rateUnit={rateUnit} />
            )}
          </div>
          {menuPos && (
            <RowActionsMenu
              x={menuPos.x}
              y={menuPos.y}
              actions={[
                { label: 'Rename subfactory…', onSelect: handleRenameSubPlan },
                {
                  label: 'Separate area',
                  checked: childPlan?.area === true,
                  title: 'Solve this subfactory as its own area: its rows serve it first, and the summary lists what it receives and sends',
                  onSelect: () => setSubPlanArea(subPlanId, !(childPlan?.area === true)),
                },
                ...(dupOptions.length > 0
                  ? [{
                      label: 'Duplicate to…',
                      disabled: !dupEnabled,
                      title: dupEnabled ? undefined : 'Every area already has a row of one of its recipes',
                      onSelect: () => {
                        if (menuPos) setAreaMenu({ kind: 'duplicate', ...menuPos })
                      },
                    }]
                  : []),
                { label: 'Remove subfactory', danger: true, onSelect: handleRemoveSubPlan },
              ]}
              onClose={() => setMenuPos(null)}
            />
          )}
          {areaMenu?.kind === 'duplicate' && (
            <RowActionsMenu
              x={areaMenu.x}
              y={areaMenu.y}
              actions={dupOptions.map(o => ({
                id: o.areaId,
                label: o.name,
                disabled: o.disabledReason !== undefined,
                title: o.disabledReason,
                onSelect: () => {
                  const id = duplicateSubPlanTo(subPlanId, o.areaId)
                  if (id) requestRevealRow(id)
                },
              }))}
              onClose={() => setAreaMenu(null)}
            />
          )}
        </td>
      </tr>
    )
  }

  // ── Game-recipe node ──────────────────────────────────────────────────────

  const recipe = gameData.recipes[planNode.recipeId]
  if (!recipe) return null

  const temperatureLabels = ingredientTemperatureLabels(recipe)

  const { machine, noMachineInHorizon } = resolveRowMachine(gameData, horizon, recipe.category, planNode.machineId)

  const primaryItemId = dedicatedProduct(planNode, recipe)
  const solvedPerRun = solvedPrimaryPerRun(primaryItemId, solvedNode)
  if (solvedPerRun !== undefined && solvedPerRun !== lastSolvedPerRun) setLastSolvedPerRun(solvedPerRun)
  const primaryPerRun = solvedPerRun ?? lastSolvedPerRun ?? primaryItemPerRun(recipe, primaryItemId, undefined)
  const isMultiOutput = recipe.products.length > 1
  const isPinned = planNode.pinnedRate !== undefined
  const isByproductConsumer = planNode.byproductConsumer === true

  const index = areaView?.index
  const hasAreas = index?.hasAreas === true
  const hereAreaId = index?.rowById.get(planNode.id)?.areaId
  const recipeAreaCount = index ? recipeAreaIds(index, planNode.recipeId).length : 0
  // Only while a menu is open: the options are not needed otherwise.
  const menuOpen = menuPos !== null || areaMenu !== null
  const buildOptions = menuOpen && index && areaView
    ? buildAlsoInOptions(index, rootPlan, planNode.id, primaryItemId, areaView.solvedMap)
    : []
  const gotoOptions = menuOpen && index && areaView
    ? goToRowOptions(index, rootPlan, planNode.id, areaView.solvedMap)
    : []
  const rateSuffix = rateUnit === 'min' ? '/m' : '/s'

  const outputEntries = solvedNode ? Object.entries(solvedNode.outputRates) : []
  const productEntries = outputEntries.filter(([id]) => id === primaryItemId)
  const byproductEntries = outputEntries.filter(([id]) => id !== primaryItemId)
  const inputEntries = solvedNode ? Object.entries(solvedNode.inputRates) : []
  const powerKw = solvedNode?.powerKw ?? 0

  function handlePin() {
    const seedRate = Math.max(solvedNode?.throughput ?? 0, 1)
    updateNodePinnedRate(planNode.id, seedRate)
  }

  function handleUnpin() {
    updateNodePinnedRate(planNode.id, undefined)
  }

  function openAreaMenu(kind: 'build' | 'goto') {
    if (menuPos) setAreaMenu({ kind, ...menuPos })
  }

  function handleToggleByproductConsumer() {
    updateNodeByproductConsumer(planNode.id, !isByproductConsumer)
  }

  function handleWrap() {
    const name = window.prompt('Subfactory name:', recipe.name)
    if (name?.trim()) wrapNodeInSubPlan(planNode.id, name.trim())
  }

  const rowActions: RowAction[] = [
    {
      label: isByproductConsumer ? 'Stop absorbing byproduct' : 'Absorb byproduct',
      onSelect: handleToggleByproductConsumer,
    },
    ...(!isByproductConsumer
      ? [{ label: isPinned ? 'Unpin rate' : 'Pin rate', onSelect: isPinned ? handleUnpin : handlePin }]
      : []),
    { label: 'Wrap in subfactory…', onSelect: handleWrap },
    ...(hasAreas
      ? [
          {
            label: 'Build also in…',
            disabled: buildOptions.length === 0,
            title: buildOptions.length === 0
              ? !areaView?.solvedMap.has(planNode.id)
                ? 'Waiting for the solve'
                : `No other area uses ${primaryItemId ? (gameData.items[primaryItemId]?.name ?? primaryItemId) : 'its product'} without a row of this recipe`
              : undefined,
            onSelect: () => openAreaMenu('build'),
          },
          ...(gotoOptions.length > 0 ? [{ label: 'Go to row in…', onSelect: () => openAreaMenu('goto') }] : []),
        ]
      : []),
    { label: 'Remove recipe', onSelect: () => removeNode(planNode.id), danger: true },
  ]

  // `pinnedRate` is stored as executions per minute; the input shows the primary
  // product's rate in the current unit. This conversion and the `* primaryPerRun / 60`
  // in the input's defaultValue are inverses: keep them in sync.
  function handlePinnedRateChange(raw: string) {
    const v = parseFloat(raw)
    if (isFinite(v) && v > 0) {
      updateNodePinnedRate(planNode.id, (rateUnit === 'min' ? v : v * 60) / primaryPerRun)
    }
  }

  const recipeOpacity = isDragging ? 'opacity-50' : ''

  return (
    <tr
      ref={rowRef}
      data-node-id={planNode.id}
      {...highlightProps}
      className={`border-b border-gray-800 hover:bg-gray-800/40 group relative ${recipeOpacity} ${highlightClass}`}
      draggable={!byRecipeView}
      onDragStart={byRecipeView ? undefined : handleDragStart}
      onDragEnd={byRecipeView ? undefined : handleDragEnd}
      onDragOver={byRecipeView ? undefined : handleDragOver}
      onDragLeave={byRecipeView ? undefined : handleDragLeave}
      onDrop={byRecipeView ? undefined : handleDrop}
    >
      {/* Reorder */}
      {byRecipeView
        ? <td />
        : <ReorderCell nodeId={planNode.id} isFirst={isFirst} isLast={isLast} moveUp={moveNodeUp} moveDown={moveNodeDown} />}

      {/* Recipe icon — row actions live in the right-click menu */}
      <td
        className="px-2 py-0.5 whitespace-nowrap"
        style={{ paddingLeft: `${8 + indentPx}px` }}
        onContextMenu={e => {
          e.preventDefault()
          setByproductMenu(null)
          setAreaMenu(null)
          setMenuPos({ x: e.clientX, y: e.clientY })
        }}
      >
        {dropZone === 'before' && <DropLine edge="top" />}
        {dropZone === 'after' && <DropLine edge="bottom" />}
        <div className="flex items-center gap-1">
          <div className="relative shrink-0">
            {/* Recipe icon derived from primary product */}
            {primaryItemId && gameData.items[primaryItemId]?.iconPath ? (
              <Icon
                iconPath={gameData.items[primaryItemId]!.iconPath}
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
            {isByproductConsumer && (
              <span
                role="img"
                aria-label="Absorbs byproduct"
                title={BYPRODUCT_CONSUMER_HINT}
                className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-amber-600 text-white text-[9px] leading-none flex items-center justify-center select-none"
              >
                ↓
              </span>
            )}
          </div>
          {byRecipeView && hasAreas && hereAreaId && (
            <span data-testid="row-area" className="text-[10px] text-gray-400 select-none">
              {areaName(rootPlan, hereAreaId)}
            </span>
          )}
          {!byRecipeView && index && areaView && recipeAreaCount >= 2 && hereAreaId && (
            <span
              data-testid="multi-area-badge"
              title={multiAreaBadgeTitle}
              className="text-[10px] px-1 rounded border border-teal-700 text-teal-300 tabular-nums select-none"
            >
              {recipeAreaCount}
            </span>
          )}
        </div>
        {menuPos && (
          <RowActionsMenu x={menuPos.x} y={menuPos.y} actions={rowActions} onClose={() => setMenuPos(null)} />
        )}
        {areaMenu && areaMenu.kind !== 'duplicate' && (
          <RowActionsMenu
            x={areaMenu.x}
            y={areaMenu.y}
            actions={
              areaMenu.kind === 'build'
                ? buildOptions.map(o => ({
                    id: o.areaId,
                    label: `${o.name} · uses ${fmtRate(o.rate / 60, rateUnit)}${rateSuffix}`,
                    onSelect: () => {
                      const id = buildRowAlsoIn(planNode.id, o.areaId)
                      if (id) requestRevealRow(id)
                    },
                  }))
                : gotoOptions.map(o => ({
                    id: o.nodeId,
                    label: `${o.name} · ${o.buildings} building${o.buildings === 1 ? '' : 's'}`,
                    onSelect: () => requestRevealRow(o.nodeId),
                  }))
            }
            onClose={() => setAreaMenu(null)}
          />
        )}
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
            noMachine={noMachineInHorizon}
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
                    // executions/min -> primary product rate in the display unit (inverse of handlePinnedRateChange)
                    defaultValue={fmtRate((planNode.pinnedRate ?? 0) * primaryPerRun / 60, rateUnit)}
                    key={`${planNode.id}-pin-${rateUnit}-${primaryPerRun.toFixed(6)}`}
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
            const openMenu = onAddConsumer
              ? (e: React.MouseEvent) => {
                  e.preventDefault()
                  setMenuPos(null)
                  setAreaMenu(null)
                  setByproductMenu({ itemId, x: e.clientX, y: e.clientY })
                }
              : undefined
            const hint = onAddConsumer ? '; right-click to add a consumer recipe' : ''

            if (isMultiOutput) {
              // In multi-output recipes, clicking a byproduct tile makes it primary.
              return (
                <ItemTile
                  key={itemId}
                  item={gameData.items[itemId]}
                  ratePerSec={ratePerMin / 60}
                  variant="byproduct"
                  onClick={() => updateNodePrimaryProduct(planNode.id, itemId)}
                  onContextMenu={openMenu}
                  title={`${itemName} — Set as primary${hasAreas ? PRIMARY_AREA_HINT : ''}${hint}`}
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
                onContextMenu={openMenu}
                title={`${itemName} — ${policy} (click to toggle)${hint}`}
              />
            )
          })}
          {byproductMenu && onAddConsumer && (
            <RowActionsMenu
              x={byproductMenu.x}
              y={byproductMenu.y}
              actions={[{ label: 'Add consumer recipe…', onSelect: () => onAddConsumer(byproductMenu.itemId, parentSubPlanId) }]}
              onClose={() => setByproductMenu(null)}
            />
          )}
        </div>
      </td>

      {/* Ingredients + electricity */}
      <td className="px-2 py-0.5">
        <div className="flex items-start gap-1">
          <div className="flex flex-wrap gap-0.5 flex-1">
            {inputEntries.map(([itemId, ratePerMin]) => {
              const itemName = gameData.items[itemId]?.name ?? itemId
              const temp = temperatureLabels[itemId]
              const label = temp ? `${itemName} (${temp})` : itemName
              return (
                <ItemTile
                  key={itemId}
                  item={gameData.items[itemId]}
                  ratePerSec={ratePerMin / 60}
                  variant="ingredient"
                  onClick={onIngredientClick ? () => onIngredientClick(itemId, parentSubPlanId) : undefined}
                  temperature={temp}
                  title={onIngredientClick ? `${label} — Find producer recipe` : temp ? label : undefined}
                />
              )
            })}
          </div>
          {powerKw > 0 && (
            <ItemTile
              item={undefined}
              ratePerSec={powerKw}
              variant="electricity"
            />
          )}
        </div>
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// AreaChips — what a collapsed area receives and sends, display-only
// ---------------------------------------------------------------------------

function AreaChips({ area, items, rateUnit }: { area: SolvedArea; items: GameData['items']; rateUnit: RateUnit }) {
  const unit = rateUnit === 'min' ? '/m' : '/s'
  function more(rest: SolvedArea['receives']) {
    if (rest.length === 0) return null
    const title = rest.map(f => `${items[f.itemId]?.name ?? f.itemId} ${fmtRate(f.rate / 60, rateUnit)}${unit}`).join(', ')
    return (
      <span data-testid="area-chips-more" title={title} className="text-[10px] text-gray-500">
        +{rest.length}
      </span>
    )
  }
  return (
    <div data-testid="area-chips" className="flex flex-wrap items-center gap-1 ml-2">
      {area.receives.length > 0 && <span className="text-[10px] text-gray-500">in</span>}
      {area.receives.slice(0, AREA_CHIP_CAP).map(f => (
        <FlowChip key={`in-${f.itemId}`} {...f} direction="receives" items={items} rateUnit={rateUnit} />
      ))}
      {more(area.receives.slice(AREA_CHIP_CAP))}
      {area.sends.length > 0 && <span className="text-[10px] text-gray-500">out</span>}
      {area.sends.slice(0, AREA_CHIP_CAP).map(f => (
        <FlowChip key={`out-${f.itemId}`} {...f} direction="sends" items={items} rateUnit={rateUnit} />
      ))}
      {more(area.sends.slice(AREA_CHIP_CAP))}
    </div>
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

/**
 * Blue drop indicator. An overlay inside a cell, never a table cell itself (a
 * cell would take part in column sizing and shift the rows). The cell is not
 * positioned, so the line spans the (relative) row.
 */
function DropLine({ edge }: { edge: 'top' | 'bottom' }) {
  return (
    <div
      aria-hidden
      className={`absolute left-0 right-0 h-0.5 bg-blue-500 pointer-events-none ${edge === 'top' ? 'top-0' : 'bottom-0'}`}
      style={{ zIndex: 10 }}
    />
  )
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
