import { useState, useRef, useMemo } from 'react'
import type { SolvedNode, SolvedArea, GameData, RecipeNode, SubPlanNode, SubPlan } from '../../data/types'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { isSubPlanDescendant } from '../../store/blockStore'
import { useUiStore, type RateUnit } from '../../store/uiStore'
import { useHorizon } from '../../store/horizon'
import { resolveRowMachine } from '../../data/horizon'
import { fmtPower, fmtItemRateText } from './ItemTile'
import { ItemChip } from './ItemChip'
import { treeGuideStyle, guideLevels } from './treeGuides'
import { canAddGroupIn, canMoveNodeInto, NESTING_LIMIT_TITLE } from '../../data/nesting'
import { MachineCell } from './MachineCell'
import { ModuleCell } from './ModuleCell'
import { BeaconCell } from './BeaconPopover'
import { Icon } from '../Icon'
import { useRecipeDnd } from './RecipeDnd'
import { RowActionsMenu, type RowAction } from './RowActionsMenu'
import { FlowChip } from './AreaFlow'
import { AreaChipsMore } from './AreaChipsMore'
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
import { pinSeedRate } from './pinRate'
import { hasProduct } from '../../solver/blockGraph'
import { itemSourcingActions } from './itemSourcing'
import { countSubPlanContents, sumSubPlanSolved } from './subPlanContents'
import { ingredientTemperatureLabels, productTemperatureLabels } from './temperature'

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
}

/** Clicks that come from these do not select the row. */
const CONTROL_SELECTOR = 'button, input, select, textarea, a, label, [role="menu"], [role="dialog"]'

const SELECTED_ROW_CLASS = 'bg-teal-900/25'

const NO_SOLVED: ReadonlyMap<string, SolvedNode> = new Map()

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
  const setItemSourcing = useBlockStore(s => s.setItemSourcing)
  const activeBlock = useBlockStore(selectActiveBlock)
  const requestRevealRow = useUiStore(s => s.requestRevealRow)
  const rateUnit = useUiStore(s => s.rateUnit)
  const horizon = useHorizon(gameData)

  const { dragging, beginDrag, endDrag } = useRecipeDnd()
  const [dropZone, setDropZone] = useState<'before' | 'after' | 'into' | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const rowRef = useRef<HTMLTableRowElement>(null)

  // Selection: the side panel shows the selected row.
  const blockId = activeBlock?.id
  const isSelected = useUiStore(s => s.selectedRow !== null && s.selectedRow.nodeId === planNode.id && s.selectedRow.blockId === blockId)
  const selectRow = useUiStore(s => s.selectRow)
  const select = () => { if (blockId) selectRow(blockId, planNode.id) }
  // A click anywhere on the row that is not a control selects it; the controls keep their own behaviour.
  function handleRowClick(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(CONTROL_SELECTOR)) return
    select()
  }

  // A group row's machines and power over its whole subtree, memoised: the walk would otherwise run on every render.
  const groupTotals = useMemo(() => {
    const child = planNode.kind === 'subplan' ? findSubPlanDeep(rootPlan, planNode.subPlanId) : undefined
    return child ? sumSubPlanSolved(child, areaView?.solvedMap ?? NO_SOLVED) : { machines: 0, powerKw: 0 }
  }, [planNode, rootPlan, areaView?.solvedMap])

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
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null)
  // The menu of an item chip: the sourcing choice, and for a byproduct chip "Add consumer recipe…".
  const [itemMenu, setItemMenu] = useState<{ itemId: string; byproduct: boolean; x: number; y: number } | null>(null)
  // The menus opened from the row menu's "Build also in…" and "Go to row in…", and a sub-factory's "Duplicate to…".
  const [areaMenu, setAreaMenu] = useState<{ kind: 'build' | 'goto' | 'duplicate'; x: number; y: number } | null>(null)

  function openItemMenu(e: React.MouseEvent, itemId: string, byproduct: boolean) {
    e.preventDefault()
    setMenuPos(null)
    setAreaMenu(null)
    setItemMenu({ itemId, byproduct, x: e.clientX, y: e.clientY })
  }

  function itemMenuActions(menu: { itemId: string; byproduct: boolean }): RowAction[] {
    const addConsumer: RowAction[] = menu.byproduct && onAddConsumer
      ? [{ label: 'Add consumer recipe…', onSelect: () => onAddConsumer(menu.itemId, parentSubPlanId) }]
      : []
    const itemName = gameData.items[menu.itemId]?.name ?? menu.itemId
    const isProduct = activeBlock !== undefined && hasProduct(activeBlock, menu.itemId)
    return [
      ...addConsumer,
      ...itemSourcingActions(activeBlock?.itemSourcing[menu.itemId], mode => setItemSourcing(menu.itemId, mode), {
        separate: addConsumer.length > 0,
        disabledTitle: isProduct ? `${itemName} is a product of this block, so the block always makes it` : undefined,
      }),
    ]
  }

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
    // Nesting limit: the dragged row or group (with everything under it) has to fit where it would land.
    const fits = (planId: string) => planId === dragging.sourceSubPlanId || canMoveNodeInto(rootPlan, dragging.nodeId, planId)

    if (planNode.kind === 'subplan') {
      // Collapsed subgroup: always append-into
      if (!isExpanded) return fits(planNode.subPlanId) ? 'into' : null
      // Expanded subgroup: top half = before (sibling), bottom half = first child
      if (relY < 0.5) return fits(parentSubPlanId) ? 'before' : null
      return fits(planNode.subPlanId) ? 'into' : null
    }

    if (!fits(parentSubPlanId)) return null
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
    // Blame recipe rows only when every area is disabled for that reason (not for being inside the source).
    const dupDisabledTitle = dupOptions.every(o => o.disabledReason?.startsWith('Already has'))
      ? 'Every area already has a row of one of its recipes'
      : 'No area can take a copy of this subfactory'

    const solvedArea = childPlan?.area === true
      ? areaView?.solvedAreas?.find(a => a.areaId === subPlanId)
      : undefined

    // Every cell of the area row opens the row menu, the chips included (they are display-only).
    const openAreaRowMenu = (e: React.MouseEvent) => {
      e.preventDefault()
      setAreaMenu(null)
      setMenuPos({ x: e.clientX, y: e.clientY })
    }

    const recipes = childPlan ? countSubPlanContents(childPlan).recipes : 0
    const { machines, powerKw: groupPowerKw } = groupTotals
    const groupPower = groupPowerKw > 0 ? fmtPower(groupPowerKw) : null

    const subplanOutline = dropZone === 'into' ? 'outline outline-2 outline-blue-500' : ''
    const subplanOpacity = isDragging ? 'opacity-50' : ''

    return (
      <tr
        ref={rowRef}
        data-node-id={planNode.id}
        {...highlightProps}
        data-selected={isSelected ? 'true' : undefined}
        className={`border-b border-gray-800 ${isSelected ? SELECTED_ROW_CLASS : 'bg-gray-800/20'} hover:bg-gray-800/40 group relative ${subplanOutline} ${subplanOpacity} ${highlightClass}`}
        onClick={handleRowClick}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <ReorderCell nodeId={planNode.id} isFirst={isFirst} isLast={isLast} moveUp={moveNodeUp} moveDown={moveNodeDown} selected={isSelected} />
        <td
          className="px-2 py-0.5"
          colSpan={3}
          data-guide-levels={guideLevels(depth)}
          style={treeGuideStyle(depth)}
          onContextMenu={openAreaRowMenu}
        >
          {dropZone === 'before' && <DropLine edge="top" />}
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={onToggleExpand}
              aria-expanded={isExpanded === true}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${label}`}
              className="w-[22px] h-[22px] shrink-0 flex items-center justify-center text-gray-400 hover:text-gray-200"
            >
              <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
                <path d={isExpanded ? 'M1 3l4 4 4-4' : 'M3 1l4 4-4 4'} fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
            </button>
            <button
              type="button"
              onClick={select}
              aria-pressed={isSelected}
              title={label}
              className="font-semibold text-xs whitespace-nowrap truncate min-w-0 text-left rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-teal-400"
            >
              {label}
            </button>
            {childPlan?.area === true && (
              <span
                data-testid="area-marker"
                title="Separate area"
                className="text-[10px] px-1 rounded border border-teal-700 text-teal-300 shrink-0"
              >
                Area
              </span>
            )}
            {childPlan && (
              <span data-testid="group-summary" className="text-gray-400 text-[11px] whitespace-nowrap shrink-0">
                {recipes} recipe{recipes !== 1 ? 's' : ''} · {machines} machine{machines !== 1 ? 's' : ''}
              </span>
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
                      title: dupEnabled ? undefined : dupDisabledTitle,
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
        <td className="px-2 py-0.5" onContextMenu={openAreaRowMenu}>
          <AreaFlowCell
            flows={solvedArea?.sends ?? []}
            direction="sends"
            items={gameData.items}
            rateUnit={rateUnit}
            testId="area-chips-out"
          />
        </td>
        <td className="px-2 py-0.5" onContextMenu={openAreaRowMenu} />
        <td className="px-2 py-0.5" onContextMenu={openAreaRowMenu}>
          <AreaFlowCell
            flows={solvedArea?.receives ?? []}
            direction="receives"
            items={gameData.items}
            rateUnit={rateUnit}
            testId="area-chips-in"
          />
        </td>
        <td className="px-2 py-0.5 text-right whitespace-nowrap" onContextMenu={openAreaRowMenu}>
          {groupPower && (
            <span data-testid="group-power" className="font-mono tabular-nums text-[11px] text-gray-400">
              {groupPower.value}<span className="opacity-60">{groupPower.unit}</span>
            </span>
          )}
        </td>
      </tr>
    )
  }

  // ── Game-recipe node ──────────────────────────────────────────────────────

  const recipe = gameData.recipes[planNode.recipeId]
  if (!recipe) return null

  const temperatureLabels = ingredientTemperatureLabels(recipe)
  const productTemperatures = productTemperatureLabels(recipe)

  const { machine, noMachineInHorizon } = resolveRowMachine(gameData, horizon, recipe.category, planNode.machineId)

  const primaryItemId = dedicatedProduct(planNode, recipe)
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

  const outputEntries = solvedNode ? Object.entries(solvedNode.outputRates) : []
  const productEntries = outputEntries.filter(([id]) => id === primaryItemId)
  const byproductEntries = outputEntries.filter(([id]) => id !== primaryItemId)
  const inputEntries = solvedNode ? Object.entries(solvedNode.inputRates) : []
  const powerKw = solvedNode?.powerKw ?? 0

  function handlePin() {
    updateNodePinnedRate(planNode.id, pinSeedRate(solvedNode))
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

  const canWrap = canAddGroupIn(rootPlan, parentSubPlanId)

  const rowActions: RowAction[] = [
    {
      label: isByproductConsumer ? 'Stop absorbing byproduct' : 'Absorb byproduct',
      onSelect: handleToggleByproductConsumer,
    },
    ...(!isByproductConsumer
      ? [{ label: isPinned ? 'Unpin rate' : 'Pin rate', onSelect: isPinned ? handleUnpin : handlePin }]
      : []),
    {
      label: 'Wrap in subfactory…',
      disabled: !canWrap,
      title: canWrap ? undefined : NESTING_LIMIT_TITLE,
      onSelect: handleWrap,
    },
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

  const recipeOpacity = isDragging ? 'opacity-50' : ''

  return (
    <tr
      ref={rowRef}
      data-node-id={planNode.id}
      {...highlightProps}
      data-selected={isSelected ? 'true' : undefined}
      className={`border-b border-gray-800 hover:bg-gray-800/40 group relative ${isSelected ? SELECTED_ROW_CLASS : ''} ${recipeOpacity} ${highlightClass}`}
      onClick={handleRowClick}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Reorder */}
      <ReorderCell nodeId={planNode.id} isFirst={isFirst} isLast={isLast} moveUp={moveNodeUp} moveDown={moveNodeDown} selected={isSelected} />

      {/* Recipe icon — row actions live in the right-click menu */}
      <td
        className="px-2 py-0.5 whitespace-nowrap"
        data-guide-levels={guideLevels(depth)}
        style={treeGuideStyle(depth)}
        onContextMenu={e => {
          e.preventDefault()
          setItemMenu(null)
          setAreaMenu(null)
          setMenuPos({ x: e.clientX, y: e.clientY })
        }}
      >
        {dropZone === 'before' && <DropLine edge="top" />}
        {dropZone === 'after' && <DropLine edge="bottom" />}
        <div className="flex items-center gap-1 min-w-0">
          <button
            type="button"
            onClick={select}
            aria-pressed={isSelected}
            className="flex items-center gap-1 min-w-0 text-left rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-teal-400"
          >
          <div className="relative shrink-0">
            {/* Recipe icon derived from primary product */}
            {primaryItemId && gameData.items[primaryItemId]?.iconPath ? (
              <Icon
                iconPath={gameData.items[primaryItemId]!.iconPath}
                alt={recipe.name}
                className="w-7 h-7 object-contain shrink-0"
              />
            ) : (
              <span
                className="w-7 h-7 bg-gray-800 rounded text-[9px] text-gray-400 flex items-center justify-center shrink-0 leading-none select-none"
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
          <span data-testid="recipe-name" title={recipe.name} className="text-[11px] font-medium truncate min-w-0">
            {recipe.name}
          </span>
          </button>
          {index && areaView && recipeAreaCount >= 2 && hereAreaId && (
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
                    label: `${o.name} · uses ${fmtItemRateText(primaryItemId, o.rate / 60, rateUnit)}`,
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
            onOpenEdit={select}
          />
          <ModuleCell
            modules={planNode.modules}
            machineSlots={machine?.moduleSlots ?? 0}
            gameData={gameData}
            noMachine={noMachineInHorizon}
            onOpenEdit={select}
          />
        </div>
      </td>

      {/* Beacons — the data model holds one configuration; the cell takes a list */}
      <td className="px-2 py-0.5 whitespace-nowrap">
        <BeaconCell
          nodeId={planNode.id}
          beacons={planNode.beaconConfig ? [planNode.beaconConfig] : []}
          gameData={gameData}
          recipeId={planNode.recipeId}
          machineId={planNode.machineId}
          recipeCategory={recipe.category}
          onOpenEdit={select}
        />
      </td>

      {/* Products — primary output(s), right-aligned; the pin badge sits on the chip */}
      <td className="px-2 py-0.5">
        <div className="flex flex-wrap gap-1.5 items-center justify-end">
          {productEntries.map(([itemId, ratePerMin]) => {
            const showPin = isPinned && !isByproductConsumer
            const productTemp = productTemperatures[itemId]
            return (
              <div key={itemId} className="flex items-center gap-1">
                <ItemChip
                  item={gameData.items[itemId]}
                  ratePerSec={ratePerMin / 60}
                  variant="product"
                  pinned={showPin}
                  sourcing={activeBlock?.itemSourcing[itemId]}
                  onContextMenu={e => openItemMenu(e, itemId, false)}
                  temperature={productTemp}
                  title={productTemp ? `${gameData.items[itemId]?.name ?? itemId} (${productTemp})` : undefined}
                />
              </div>
            )
          })}
        </div>
      </td>

      {/* Byproducts — non-primary outputs; click chip to make it primary */}
      <td className="px-2 py-0.5">
        <div className="flex flex-wrap gap-1.5">
          {byproductEntries.map(([itemId, ratePerMin]) => {
            const policy = planNode.byproductPolicy[itemId] ?? 'feed-back'
            const baseName = gameData.items[itemId]?.name ?? itemId
            const byproductTemp = productTemperatures[itemId]
            const itemName = byproductTemp ? `${baseName} (${byproductTemp})` : baseName
            const openMenu = (e: React.MouseEvent) => openItemMenu(e, itemId, true)
            const sourcing = activeBlock?.itemSourcing[itemId]
            const hint = onAddConsumer ? '; right-click to add a consumer recipe or choose how it is sourced' : '; right-click to choose how it is sourced'

            if (isMultiOutput) {
              // In multi-output recipes, clicking a byproduct chip makes it primary.
              return (
                <ItemChip
                  key={itemId}
                  item={gameData.items[itemId]}
                  ratePerSec={ratePerMin / 60}
                  variant="byproduct"
                  temperature={byproductTemp}
                  onClick={() => updateNodePrimaryProduct(planNode.id, itemId)}
                  onContextMenu={openMenu}
                  sourcing={sourcing}
                  title={`${itemName} — Set as primary${hasAreas ? PRIMARY_AREA_HINT : ''}${hint}`}
                />
              )
            }

            // Single-output (shouldn't have byproducts, but handle gracefully):
            // clicking toggles feed-back / discard policy.
            return (
              <ItemChip
                key={itemId}
                item={gameData.items[itemId]}
                ratePerSec={ratePerMin / 60}
                variant="byproduct"
                temperature={byproductTemp}
                onClick={() =>
                  updateNodeByproductPolicy(planNode.id, {
                    ...planNode.byproductPolicy,
                    [itemId]: policy === 'feed-back' ? 'discard' : 'feed-back',
                  })
                }
                onContextMenu={openMenu}
                sourcing={sourcing}
                title={`${itemName} — ${policy} (click to toggle)${hint}`}
              />
            )
          })}
          {itemMenu && (
            <RowActionsMenu
              x={itemMenu.x}
              y={itemMenu.y}
              actions={itemMenuActions(itemMenu)}
              onClose={() => setItemMenu(null)}
            />
          )}
        </div>
      </td>

      {/* Ingredients */}
      <td className="px-2 py-0.5">
        <div className="flex flex-wrap gap-1.5">
          {inputEntries.map(([itemId, ratePerMin]) => {
            const itemName = gameData.items[itemId]?.name ?? itemId
            const temp = temperatureLabels[itemId]
            const label = temp ? `${itemName} (${temp})` : itemName
            const isFuel = itemId === solvedNode?.fuelItemId
            return (
              <ItemChip
                key={itemId}
                item={gameData.items[itemId]}
                ratePerSec={ratePerMin / 60}
                variant="ingredient"
                fuel={isFuel}
                onClick={onIngredientClick ? () => onIngredientClick(itemId, parentSubPlanId) : undefined}
                onContextMenu={e => openItemMenu(e, itemId, false)}
                sourcing={activeBlock?.itemSourcing[itemId]}
                temperature={temp}
                title={isFuel
                  ? `Fuel: ${label}${onIngredientClick ? ' — Find producer recipe' : ''}`
                  : onIngredientClick ? `${label} — Find producer recipe` : temp ? label : undefined}
              />
            )
          })}
        </div>
      </td>

      {/* Power */}
      <td className="px-2 py-0.5 text-right whitespace-nowrap">
        {powerKw > 0 && (() => {
          const power = fmtPower(powerKw)
          return (
            <span data-testid="row-power" className="font-mono tabular-nums text-[11px] text-cyan-300">
              {power.value}<span className="opacity-60">{power.unit}</span>
            </span>
          )
        })()}
      </td>
    </tr>
  )
}

// ---------------------------------------------------------------------------
// AreaFlowCell — what a collapsed area receives or sends, in its table column. The chips are display-only;
// the "+N" for the flows past the cap is a button that opens a popup.
// ---------------------------------------------------------------------------

function AreaFlowCell({ flows, direction, items, rateUnit, testId }: {
  flows: SolvedArea['receives']
  direction: 'receives' | 'sends'
  items: GameData['items']
  rateUnit: RateUnit
  testId: string
}) {
  if (flows.length === 0) return null
  return (
    <div
      data-testid={testId}
      role="group"
      aria-label={direction === 'receives' ? 'Receives' : 'Sends'}
      className="flex flex-wrap items-center justify-end gap-1.5"
    >
      {flows.slice(0, AREA_CHIP_CAP).map(f => (
        <FlowChip key={f.itemId} {...f} direction={direction} items={items} rateUnit={rateUnit} />
      ))}
      <AreaChipsMore flows={flows.slice(AREA_CHIP_CAP)} direction={direction} items={items} rateUnit={rateUnit} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// ReorderCell
// ---------------------------------------------------------------------------

interface ReorderCellProps {
  nodeId: string
  /** The row is selected: a teal bar on the left edge. */
  selected?: boolean
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

function ReorderCell({ nodeId, selected, isFirst, isLast, moveUp, moveDown }: ReorderCellProps) {
  return (
    <td className="px-1 py-0.5 w-8" style={selected ? { boxShadow: 'inset 3px 0 0 #14b8a6' } : undefined}>
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
