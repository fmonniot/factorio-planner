import { useState, useRef, useMemo } from 'react'
import type { SolvedNode, SolvedArea, GameData, RecipeNode, SubPlanNode, SubPlan } from '../../data/types'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { isSubPlanDescendant } from '../../store/blockStore'
import { useUiStore, type RateUnit } from '../../store/uiStore'
import { useHorizon } from '../../store/horizon'
import { resolveRowMachine } from '../../data/horizon'
import { fmtPower, fmtItemRateText } from './ItemTile'
import { ItemChip } from './ItemChip'
import { treeGuideStyle, guideLevels, groupRowBackground, OPEN_GROUP_HAIRLINE, INGREDIENTS_INDENT_PX, INGREDIENTS_PADDING_LEFT } from './treeGuides'
import { canAddGroupIn, canMoveNodeInto, NESTING_LIMIT_TITLE } from '../../data/nesting'
import { MachineCell } from './MachineCell'
import { ModuleCell } from './ModuleCell'
import { BeaconCell } from './BeaconPopover'
import { Icon } from '../Icon'
import { useRecipeDnd } from './RecipeDnd'
import { RowActionsMenu, type RowAction } from './RowActionsMenu'
import { FlowChip } from './AreaFlow'
import { AreaChipsMore } from './AreaChipsMore'
import { chipsOnOneLine, useChipsPerLine } from './oneLineChips'
import { AreasIcon, FolderIcon } from '../icons'
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
import { countSubPlanContents, sumSubPlanSolved } from './subPlanContents'
import { ingredientTemperatureLabels, productTemperatureLabels } from './temperature'

// ---------------------------------------------------------------------------
// RecipeRow
// ---------------------------------------------------------------------------

const BYPRODUCT_CONSUMER_HINT =
  'Absorbs byproduct: runs only to consume surplus from other recipes and never imports its own inputs. Right-click the row to stop absorbing.'

const PRIMARY_AREA_HINT = '; the primary product decides what this row builds for its area'

/**
 * Most chips shown per direction on a collapsed area row; the rest is a "+N". A row is one line high, so the line decides
 * first (`chipsOnOneLine`): fewer chips show when they do not fit. Sends sit under the Products and Byproducts columns
 * (spanning both columns, left-aligned so they start under the recipe rows' product chips), receives under Ingredients,
 * left-aligned at the same x as a recipe row's first ingredient.
 */
const AREA_CHIP_CAP = { sends: 8, receives: 16 } as const

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
  // A chip shortcut: select the row and highlight one section of its panel.
  const selectRowSection = useUiStore(s => s.selectRowSection)
  const openSection = (section: 'machine' | 'beacons') => { if (blockId) selectRowSection(blockId, planNode.id, section) }
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
  // At most one context menu is open at a time:
  // - 'row': the row menu (recipe row or sub-factory),
  // - 'item': the menu of a byproduct chip, its single entry "Add consumer recipe…" (product and ingredient chips have none),
  // - 'build' / 'goto': opened from the row menu's "Build also in…" and "Go to row in…",
  // - 'duplicate': a sub-factory's "Duplicate to…".
  const [openMenu, setOpenMenu] = useState<
    { kind: 'row' | 'build' | 'goto' | 'duplicate'; x: number; y: number }
    | { kind: 'item'; itemId: string; x: number; y: number }
    | null
  >(null)
  // A menu closes itself after a selection, by which time the selection may have opened a follow-up menu: only clear its own kind.
  const closeMenu = (kind: NonNullable<typeof openMenu>['kind']) =>
    setOpenMenu(cur => (cur?.kind === kind ? null : cur))
  const rowMenu = openMenu?.kind === 'row' ? openMenu : null
  // The byproduct menu only shows while there is something to add a consumer to.
  const itemMenu = openMenu?.kind === 'item' && onAddConsumer ? openMenu : null
  const areaMenu = openMenu && openMenu.kind !== 'row' && openMenu.kind !== 'item' ? openMenu : null

  function openByproductMenu(e: React.MouseEvent, itemId: string) {
    // Without an entry to offer there is no menu, and the browser's own one stays.
    if (!onAddConsumer) return
    e.preventDefault()
    setOpenMenu({ kind: 'item', itemId, x: e.clientX, y: e.clientY })
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
    const dupOptions = openMenu && areaView
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
      setOpenMenu({ kind: 'row', x: e.clientX, y: e.clientY })
    }

    const recipes = childPlan ? countSubPlanContents(childPlan).recipes : 0
    const { machines, powerKw: groupPowerKw } = groupTotals
    const groupPower = groupPowerKw > 0 ? fmtPower(groupPowerKw) : null

    // An open group is banded (and gets a hairline under its header unless it is selected); a collapsed one keeps its tint.
    const open = isExpanded === true
    const band = open
    const hairline = band && !isSelected ? OPEN_GROUP_HAIRLINE : ''
    const groupIconClass = `w-3 h-3 shrink-0 ${band ? 'text-teal-400' : 'text-gray-400'}`
    // "N machines" when every recipe runs on exactly one machine, else both counts.
    const summary = recipes === machines
      ? `${machines} machine${machines !== 1 ? 's' : ''}`
      : `${recipes} recipe${recipes !== 1 ? 's' : ''} · ${machines} machine${machines !== 1 ? 's' : ''}`

    const subplanOutline = dropZone === 'into' ? 'outline outline-2 outline-blue-500' : ''
    const subplanOpacity = isDragging ? 'opacity-50' : ''

    return (
      <tr
        ref={rowRef}
        data-node-id={planNode.id}
        {...highlightProps}
        data-selected={isSelected ? 'true' : undefined}
        className={`h-[37px] border-b border-gray-800 ${isSelected ? SELECTED_ROW_CLASS : groupRowBackground(depth, band)} hover:bg-gray-800/40 group relative ${subplanOutline} ${subplanOpacity} ${highlightClass}`}
        onClick={handleRowClick}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <ReorderCell nodeId={planNode.id} isFirst={isFirst} isLast={isLast} moveUp={moveNodeUp} moveDown={moveNodeDown} selected={isSelected} className={hairline} />
        <td
          className={`px-2 py-0.5 ${hairline}`}
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
            {childPlan?.area === true
              ? <AreasIcon className={groupIconClass} title="Separate area" testId="area-marker" />
              : <FolderIcon className={groupIconClass} title="Sub-factory" testId="group-marker" />}
            <button
              type="button"
              onClick={select}
              aria-pressed={isSelected}
              title={label}
              className="font-semibold text-xs whitespace-nowrap truncate min-w-0 text-left rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-teal-400"
            >
              {label}
            </button>
            {childPlan && (
              <span data-testid="group-summary" className="text-gray-400 text-[11px] whitespace-nowrap shrink-0">
                {summary}
              </span>
            )}
          </div>
          {rowMenu && (
            <RowActionsMenu
              x={rowMenu.x}
              y={rowMenu.y}
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
                        setOpenMenu({ kind: 'duplicate', x: rowMenu.x, y: rowMenu.y })
                      },
                    }]
                  : []),
                { label: 'Remove subfactory', danger: true, onSelect: handleRemoveSubPlan },
              ]}
              onClose={() => closeMenu('row')}
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
              onClose={() => closeMenu(areaMenu.kind)}
            />
          )}
        </td>
        <td className={`px-2 py-0.5 ${hairline}`} colSpan={2} onContextMenu={openAreaRowMenu}>
          <AreaFlowCell
            flows={solvedArea?.sends ?? []}
            direction="sends"
            items={gameData.items}
            rateUnit={rateUnit}
            testId="area-chips-out"
          />
        </td>
        <td className={`px-2 py-0.5 ${hairline}`} style={{ paddingLeft: INGREDIENTS_PADDING_LEFT }} onContextMenu={openAreaRowMenu}>
          <AreaFlowCell
            flows={solvedArea?.receives ?? []}
            direction="receives"
            items={gameData.items}
            rateUnit={rateUnit}
            testId="area-chips-in"
          />
        </td>
        <td className={`px-2 py-0.5 text-right whitespace-nowrap ${hairline}`} onContextMenu={openAreaRowMenu}>
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
  const menuOpen = openMenu !== null
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
    if (rowMenu) setOpenMenu({ kind, x: rowMenu.x, y: rowMenu.y })
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
      className={`border-b border-gray-800 hover:bg-gray-800/40 group group/row relative ${isSelected ? SELECTED_ROW_CLASS : ''} ${recipeOpacity} ${highlightClass}`}
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
          setOpenMenu({ kind: 'row', x: e.clientX, y: e.clientY })
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
        {rowMenu && (
          <RowActionsMenu x={rowMenu.x} y={rowMenu.y} actions={rowActions} onClose={() => closeMenu('row')} />
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
            onClose={() => closeMenu(areaMenu.kind)}
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
          />
          <ModuleCell
            nodeId={planNode.id}
            recipeId={planNode.recipeId}
            machine={machine}
            modules={planNode.modules}
            machineSlots={machine?.moduleSlots ?? 0}
            gameData={gameData}
            noMachine={noMachineInHorizon}
            onOpenEdit={() => openSection('machine')}
          />
        </div>
      </td>

      {/* Beacons — the data model holds one configuration; the cell takes a list */}
      <td className="px-2 py-0.5 whitespace-nowrap">
        <BeaconCell
          nodeId={planNode.id}
          beacons={planNode.beaconConfigs ?? []}
          gameData={gameData}
          recipeId={planNode.recipeId}
          machineId={planNode.machineId}
          recipeCategory={recipe.category}
          onOpenEdit={() => openSection('beacons')}
        />
      </td>

      {/* Products — the single primary product, left-aligned so it sits above the items a collapsed area sends; the pin badge sits on the chip */}
      <td className="px-2 py-0.5">
        <div className="flex flex-wrap gap-1.5 items-center">
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
            const openItemMenu = (e: React.MouseEvent) => openByproductMenu(e, itemId)
            const sourcing = activeBlock?.itemSourcing[itemId]
            const hint = onAddConsumer ? '; right-click to add a consumer recipe' : ''

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
                  onContextMenu={openItemMenu}
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
                onContextMenu={openItemMenu}
                sourcing={sourcing}
                title={`${itemName} — ${policy} (click to toggle)${hint}`}
              />
            )
          })}
          {itemMenu && (
            <RowActionsMenu
              x={itemMenu.x}
              y={itemMenu.y}
              actions={[{ label: 'Add consumer recipe…', onSelect: () => onAddConsumer?.(itemMenu.itemId, parentSubPlanId) }]}
              onClose={() => closeMenu('item')}
            />
          )}
        </div>
      </td>

      {/* Ingredients, left-aligned at the same x as the items a collapsed area receives */}
      <td className="px-2 py-0.5" style={{ paddingLeft: INGREDIENTS_PADDING_LEFT }}>
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

function AreaFlowCell(props: AreaFlowCellProps) {
  if (props.flows.length === 0) return null
  return <AreaFlowChips {...props} />
}

interface AreaFlowCellProps {
  flows: SolvedArea['receives']
  direction: 'receives' | 'sends'
  items: GameData['items']
  rateUnit: RateUnit
  testId: string
}

// The chips on one line: what fits is shown (all of them, or one fewer than fit and the "+N"); the rest is behind the "+N",
// so a group row is as high as a recipe row whatever it sends and receives. The sent chips also have the 28px the received
// ones are indented by (a negative margin takes them from the next cell's padding).
function AreaFlowChips({ flows, direction, items, rateUnit, testId }: AreaFlowCellProps) {
  const { ref, perLine } = useChipsPerLine<HTMLDivElement>()
  const shown = chipsOnOneLine(flows.length, perLine, AREA_CHIP_CAP[direction])
  return (
    <div
      ref={ref}
      data-testid={testId}
      role="group"
      aria-label={direction === 'receives' ? 'Receives' : 'Sends'}
      className="flex flex-nowrap items-center gap-1.5 justify-start"
      style={direction === 'sends' ? { marginRight: -INGREDIENTS_INDENT_PX } : undefined}
    >
      {flows.slice(0, shown).map(f => (
        <FlowChip key={f.itemId} {...f} direction={direction} items={items} rateUnit={rateUnit} />
      ))}
      <AreaChipsMore flows={flows.slice(shown)} direction={direction} items={items} rateUnit={rateUnit} />
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
  className?: string
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

function ReorderCell({ nodeId, selected, className = '', isFirst, isLast, moveUp, moveDown }: ReorderCellProps) {
  return (
    <td className={`px-1 py-0.5 w-8 ${className}`} style={selected ? { boxShadow: 'inset 3px 0 0 #14b8a6' } : undefined}>
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
