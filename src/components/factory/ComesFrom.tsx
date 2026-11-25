import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { areaIdsOf, areaName as areaNameOf, storedAreaRule } from '../../data/subPlanTree'
import { blockAreas } from '../../solver/areas'
import { hasProduct } from '../../solver/blockGraph'
import { Segment, Segmented } from '../SegmentedControl'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useSolverStore, selectFlows } from '../../store/solverStore'
import { productChangeEffects, receivedFromSources } from '../../store/connections'
import { MISSING_BLOCK_COLOR } from '../../data/blockColors'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { COMES_FROM_LABEL, LEFTOVER_BLOCK_BUTTON, LEFTOVER_BLOCK_NOTE, LEFTOVER_ROW, LEFTOVER_SWITCH, LIST_ORDER_LABEL, RULE_CHIP_HELP, ruleChipOf, ruleLabel, SOURCES_BUTTON_LABEL } from './itemSourcing'
import { noEffectLabel, ruleId, scopeAreasOf, sourceRules } from './sourceRules'
import type { SourceRulePart } from './sourceRules'
import { useRemoveSourceRule } from './useRemoveSourceRule'
import { ComesFromHeader } from './ComesFromHeader'
import { ProductChangeDialog } from './ProductChangeDialog'
import { SourcesBar } from './SourcesBar'
import { SourcesList } from './SourcesList'
import { useSourcesModel } from './useSourcesModel'
import { RuleIcons } from './RuleIcons'
import { StripIcon } from './StripIcon'
import { Cluster, StripToolbar } from './StripToolbar'
import type { StripAction } from './StripToolbar'
import { MINI_BUTTON_CLASS, Switch } from './Switch'
import { anchorOf } from './popoverAnchor'
import type { Product, SubPlan } from '../../data/types'
import type { ProductChangeEffect } from '../../store/connections'

// ---------------------------------------------------------------------------
// ComesFrom — where an item of the active block comes from: the Sources list (the order it is tried in, Make more here, Import,
// Leftover), the rule's icons in the strip, and any rule of the item that has no effect, with a button to remove it.
// In a block with areas it has a scope control: the whole block, or one area, whose own rule replaces the block's for its rows.
// It sits in the strip of a selected Ingredients slot (`listInPopover`: one toolbar of icons, whose last one, Sources…, opens the
// Comes from popover, then the icons of the item's rule, then the rows that show only in some cases) and in the Comes from popover
// (`ComesFromPopover`), which holds it for an item that has no slot, and in the Source rules list. There it has a header (the item and its
// scope control, the item's need) and the bar of what supplies the need, then the Sources list with its rule chip and Leftover row: the
// one view of the rule, always drawn. A rule that has nothing to act on yet (No connection) offers the way forward. The list is
// at both scopes: the list of an area has one line per supplying area, with a switch.
// ---------------------------------------------------------------------------

/** The name of the first line of the Sources list: where the focus goes when what had it is gone. */
const FIRST_LINE = '[data-testid="sources-line-toggle"]'
/** Make it a product, in the takers note: where the focus returns on Cancel. */
const MAKE_PRODUCT_BUTTON = '[data-testid="leftover-make-product"]'

/** A text link: the rule chip's "Use the block's", the Leftover row's "change". */
const LINK_BUTTON_CLASS = 'text-[11px] text-teal-300 underline underline-offset-2 outline-none hover:text-teal-200 focus-visible:ring-2 focus-visible:ring-teal-400 rounded'

/** The short reason a rule has no effect, a small grey chip; its tip says more when the label does not (a product). */
function NoEffectReason({ rule, rootPlan }: { rule: SourceRulePart; rootPlan: SubPlan }) {
  const { label, tip } = noEffectLabel(rule.noEffect!, {
    inArea: rule.areaId !== undefined,
    otherAreaName: rule.otherAreaId !== undefined ? areaNameOf(rootPlan, rule.otherAreaId) : undefined,
  })
  return <span data-testid="no-effect-reason" data-tip={tip} className="rounded border border-gray-700 px-1.5 text-[11px] leading-4 text-gray-400">{label}</span>
}

export function ComesFrom({ itemId, areaId, listInPopover = false, actions = [], heading }: {
  itemId: string
  /** The area the control is opened for: it starts on that area's scope when the area has a rule for the item, and offers it. */
  areaId?: string
  /** The control sits where the list has no room (an Ingredients slot's strip): Sources… opens the Comes from popover. */
  listInPopover?: boolean
  /** The strip's own actions (Find recipe, Receive from…): they form the left of the toolbar `listInPopover` draws. */
  actions?: StripAction[]
  /** The control is the body of the Comes from popover: its header names the item (`titleId` labels the dialog) and has Close. Without it the header is the embedded one. */
  heading?: { titleId: string; onClose: () => void }
}) {
  const baseId = useId()
  const openComesFrom = useUiStore(s => s.openComesFrom)
  const block = useBlockStore(selectActiveBlock)
  const blocks = useBlockStore(s => s.blocks)
  const toggleLeftoverOff = useBlockStore(s => s.toggleLeftoverOff)
  const clearAreaRule = useBlockStore(s => s.clearAreaRule)
  const addProduct = useBlockStore(s => s.addProduct)
  const flows = useSolverStore(selectFlows)
  // Make it a product, asked first when other blocks' connections change meaning (as the Ingredients slot's action does).
  const [pendingProduct, setPendingProduct] = useState<{ product: Product; effects: ProductChangeEffect[]; received: string[] } | null>(null)
  const gameData = useGameDataStore(selectGameData)
  const removeRule = useRemoveSourceRule()
  const openConnectionMenu = useUiStore(s => s.openConnectionMenu)
  const areaIds = useMemo(() => (block ? areaIdsOf(block.rootPlan) : new Set<string>()), [block])
  // The scope: undefined is the whole block. It starts on the area when that area has its own rule for the item.
  const [scope, setScope] = useState<string | undefined>(
    () => block && areaId !== undefined && storedAreaRule(block.rootPlan, areaId, itemId) !== undefined ? areaId : undefined,
  )
  // An area whose flag went off is no area: the control falls back to the whole block (an undo brings the area back).
  const area = scope !== undefined && areaIds.has(scope) ? scope : undefined
  // A link that removes itself on click leaves the focus on <body>: it names where the focus goes once the view has changed
  // (a selector inside the control), the scope's button of the new scope, or the first line of the list.
  const rootRef = useRef<HTMLDivElement>(null)
  const refocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    const selector = refocus.current
    refocus.current = null
    if (!selector) return
    const root = rootRef.current
    ;(root?.querySelector<HTMLElement>(selector) ?? root?.querySelector<HTMLElement>(FIRST_LINE))?.focus()
  })
  const changeScope = (next: string | undefined) => {
    refocus.current = `[data-testid="comes-from-scope"] [data-scope="${next ?? 'block'}"]`
    setScope(next)
  }
  const clearOwnRule = (areaId: string) => {
    refocus.current = FIRST_LINE
    clearAreaRule(areaId, itemId)
  }
  // The question is about the item it was asked for: another item (the strip's selected slot changed) drops it.
  if (pendingProduct && pendingProduct.product.itemId !== itemId) setPendingProduct(null)
  const unit = useUiStore(s => s.rateUnit)
  const view = useSourcesModel(itemId, area)

  const unavailable = useMemo(() => {
    if (!block || !gameData) return []
    const blockIds = new Set(blocks.map(b => b.id))
    return sourceRules(block, gameData, blockIds).filter(r => r.itemId === itemId && r.noEffect !== undefined && (r.areaId === area || r.kind === 'leftover-off'))
  }, [block, blocks, gameData, itemId, area])

  if (!block || !gameData) return null

  const name = gameData.items[itemId]?.name ?? itemId
  const stored = area !== undefined ? storedAreaRule(block.rootPlan, area, itemId) : undefined
  // Leftover is the block's rule alone: an area's control reads it from the block, never from the area's effective rule.
  const leftoverOn = !block.sourceRules[itemId]?.leftoverOff
  // The blocks that take the item from this one (a connection of the item whose source is this block): with Leftover off they
  // get only what the rows here cannot use, unless the item is a product, which turns the connection into a request.
  const afterProductFocus = listInPopover ? '[data-testid="sources-button"]' : FIRST_LINE
  const takers = leftoverOn || hasProduct(block, itemId)
    ? []
    : blocks.filter(b => b.id !== block.id && b.inputConnections.some(c => c.itemId === itemId && c.fromBlockId === block.id))
  // The areas the scope control offers: the one it was opened for, the one it is on, and those with a rule of their own for the item.
  const scopeAreas = scopeAreasOf(block, itemId, areaId, area)
  const showScope = scopeAreas.length > 0
  // The areas with a rule of their own, for the Ingredients slot's strip (table order).
  const ruledAreas = listInPopover ? (blockAreas(block.rootPlan) ?? []).filter(a => storedAreaRule(block.rootPlan, a.id, itemId) !== undefined) : []

  const makeProductAction: StripAction = {
    label: 'Make it a product',
    title: 'Make it a product to send them more.',
    icon: 'make-product',
    testId: 'leftover-make-product',
    describedBy: `${baseId}-takers`,
    onSelect: () => {
      const product: Product = { id: crypto.randomUUID(), itemId }
      const effects = productChangeEffects(blocks, block.id, itemId, 'add', flows)
      const received = receivedFromSources(blocks, block.id, itemId)
      if (effects.length === 0 && received.length === 0) {
        // The button goes with the takers (the item becomes a product): the focus goes to Sources…, or to the list's first line.
        refocus.current = afterProductFocus
        addProduct(product)
      } else setPendingProduct({ product, effects, received })
    },
  }
  const takersNote = takers.length > 0 && (
    <div role="group" aria-label={`Blocks that take ${name} from this block`} data-testid="leftover-takers" className="flex flex-col gap-0.5">
      <div className="flex items-center gap-2 text-[11px] text-gray-400">
        <span id={`${baseId}-takers`} data-testid="leftover-takers-title" data-tip="These blocks get only what the rows here cannot use." className="min-w-0 flex-1 truncate">Take what is left over</span>
        <Cluster actions={[makeProductAction]} />
      </div>
      <ul className="flex flex-col gap-0.5">
        {takers.map(b => (
          <li key={b.id} data-testid="leftover-taker" data-block-id={b.id} className="flex items-center gap-1.5 text-[11px] text-gray-300">
            <span data-testid="leftover-taker-color" className="inline-block size-2.5 shrink-0 rounded-sm" style={{ background: b.color ?? MISSING_BLOCK_COLOR }} />
            <span className="min-w-0 truncate">{b.name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
  const productDialog = pendingProduct && (
    <ProductChangeDialog
      change="add"
      itemId={pendingProduct.product.itemId}
      itemName={gameData.items[pendingProduct.product.itemId]?.name ?? pendingProduct.product.itemId}
      blockName={block.name}
      effects={pendingProduct.effects}
      received={pendingProduct.received}
      rateUnit={unit}
      onCancel={() => {
        // The button is still there (the item is not a product): the focus goes back to it.
        refocus.current = MAKE_PRODUCT_BUTTON
        setPendingProduct(null)
      }}
      onConfirm={() => {
        // The store refuses a second product of the item, so a block that gained it meanwhile makes this a no-op.
        refocus.current = afterProductFocus
        addProduct(pendingProduct.product)
        setPendingProduct(null)
      }}
    />
  )
  const areasButton = area === undefined && ruledAreas.length > 0 && (
    <div className="flex">
      <button
        type="button"
        data-testid="areas-have-rules"
        aria-haspopup="dialog"
        onClick={e => openComesFrom(itemId, anchorOf(e.currentTarget), { areaId: ruledAreas[0].id })}
        className={MINI_BUTTON_CLASS}
      >
        {ruledAreas.length === 1 ? '1 area has its own rule' : `${ruledAreas.length} areas have their own rule`}
      </button>
    </div>
  )
  const noEffectList = unavailable.length > 0 && (
    <ul className="flex flex-col gap-0.5">
      {unavailable.map(rule => (
        <li
          key={ruleId(rule)}
          data-testid="no-effect"
          data-rule={rule.kind}
          data-no-effect={rule.noEffect}
          className="flex items-center gap-2 text-[11px] leading-snug text-gray-500"
        >
          <span id={`${baseId}-no-effect-${ruleId(rule)}`} className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2">
            <span data-testid="no-effect-rule" className="text-gray-400">{ruleLabel(rule, block.rootPlan)}</span>
            <NoEffectReason rule={rule} rootPlan={block.rootPlan} />
          </span>
          <span className="shrink-0 flex items-baseline gap-1">
            {rule.noEffect === 'no-connection' && (
              <button
                type="button"
                data-testid="receive-from"
                aria-describedby={`${baseId}-no-effect-${ruleId(rule)}`}
                data-tip={`Pick the block that sends ${name} to this one`}
                onClick={e => {
                  const r = e.currentTarget.getBoundingClientRect()
                  openConnectionMenu(itemId, r.left, r.bottom)
                }}
                className="bg-gray-900 border border-gray-700 rounded px-1.5 leading-4 text-gray-300 outline-none hover:border-gray-500 focus-visible:ring-2 focus-visible:ring-teal-400"
              >
                Receive from…
              </button>
            )}
            <button
              type="button"
              aria-describedby={`${baseId}-no-effect-${ruleId(rule)}`}
              data-tip={`Remove the ${ruleLabel(rule, block.rootPlan)} rule`}
              onClick={() => removeRule(rule)}
              className="bg-gray-900 border border-gray-700 rounded px-1.5 leading-4 text-gray-300 hover:border-gray-500"
            >
              Remove
            </button>
          </span>
        </li>
      ))}
    </ul>
  )

  const sourcesAction: StripAction = {
    label: SOURCES_BUTTON_LABEL,
    icon: 'sources',
    side: 'left',
    testId: 'sources-button',
    hasPopup: 'dialog',
    onSelect: e => openComesFrom(itemId, anchorOf(e.currentTarget)),
  }

  if (listInPopover) {
    // The strip of a selected Ingredients slot: one row of icons, the item's rule icons at its end, then the rows that show only in some cases.
    return (
      <div role="group" aria-label={COMES_FROM_LABEL} data-testid="comes-from" ref={rootRef} className="flex flex-col gap-[3px]">
        <StripToolbar
          actions={[...actions, sourcesAction]}
          trailing={<RuleIcons rule={view?.rule} rootPlan={block.rootPlan} testId="strip-rule-icons" iconTestId="strip-rule-icon" className="gap-1.5 ml-1" />}
        />
        {takersNote}
        {areasButton}
        {noEffectList}
        {productDialog}
      </div>
    )
  }

  // The Comes from popover and the Source rules row: the header and the bar, then the Sources list (its own rule chip and Leftover row).
  const scopeHint = area === undefined ? 'Every row of the block, unless an area has its own rule' : `Rows of ${areaNameOf(block.rootPlan, area)}`
  const scopeNode = showScope
    ? (
        <div data-testid="comes-from-scope" data-tip={scopeHint}>
          <Segmented label="Scope" size="xs">
            <Segment pressed={area === undefined} data-scope="block" onClick={() => changeScope(undefined)}>Whole block</Segment>
            {scopeAreas.map(a => (
              <Segment key={a.id} pressed={area === a.id} data-scope={a.id} onClick={() => changeScope(a.id)}>{areaNameOf(block.rootPlan, a.id)}</Segment>
            ))}
          </Segmented>
        </div>
      )
    : undefined
  const item = gameData.items[itemId]
  const header = (
    <ComesFromHeader
      titleId={heading?.titleId}
      item={heading ? { name, iconPath: item?.iconPath } : undefined}
      subtitle={showScope ? undefined : 'Every row of this block'}
      scope={scopeNode}
      need={view?.model.need}
      itemId={itemId}
      unit={unit}
      onClose={heading?.onClose}
    />
  )
  const rootClass = `flex flex-col gap-1.5 ${heading ? '' : 'pt-1 border-t border-gray-700/70'}`

  if (!view) return null
  const chip = ruleChipOf(view.rule, { area, ownRule: stored !== undefined })
  const ownRuleAreas = area === undefined ? (blockAreas(block.rootPlan) ?? []).filter(a => storedAreaRule(block.rootPlan, a.id, itemId) !== undefined) : []
  return (
    <div role="group" aria-label={COMES_FROM_LABEL} data-testid="comes-from" ref={rootRef} className={rootClass}>
      {header}
      <SourcesBar view={view} />
      <div className="flex flex-col gap-0.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
          <span className="text-[11px] text-gray-400">{LIST_ORDER_LABEL}</span>
          <span className="flex items-center gap-2">
            <span
              data-testid="sources-rule-chip"
              data-preset={chip.preset ?? 'own'}
              data-owner={chip.owner}
              data-tip={RULE_CHIP_HELP}
              className={`rounded border px-1.5 text-[11px] leading-4 ${chip.owner === 'own' ? 'border-teal-700 text-teal-300' : 'border-gray-700 text-gray-300'}`}
            >
              {chip.text}
            </span>
            {area !== undefined && stored !== undefined && (
              <button type="button" data-testid="use-block-rule" aria-label="Use the block's rule" onClick={() => clearOwnRule(area)} className={LINK_BUTTON_CLASS}>
                Use the block&apos;s
              </button>
            )}
          </span>
        </div>
        {ownRuleAreas.length > 0 && (
          <div className="flex flex-wrap justify-end gap-x-2">
            {ownRuleAreas.map(a => (
              <button key={a.id} type="button" data-testid="area-own-rule" data-area-id={a.id} onClick={() => changeScope(a.id)} className={LINK_BUTTON_CLASS}>
                {areaNameOf(block.rootPlan, a.id)} has its own
              </button>
            ))}
          </div>
        )}
      </div>
      <SourcesList id={`${baseId}-sources`} view={view} onScope={changeScope} />
      {takersNote}
      {noEffectList}
      <div data-testid="leftover-row" className="flex items-center gap-1.5 border-t border-gray-700/70 pt-1.5 text-[11px] text-gray-400">
        <span aria-hidden="true" className="flex w-4 shrink-0 justify-center text-gray-300"><StripIcon name="leftover" /></span>
        <span className="text-gray-300">{LEFTOVER_ROW.label}</span>
        <span className="min-w-0 flex-1">
          {area === undefined
            ? (leftoverOn ? LEFTOVER_ROW.reading.on : LEFTOVER_ROW.reading.off)
            : (
                <>
                  {LEFTOVER_ROW.areaReading}{' '}
                  <button type="button" data-testid="leftover-whole-block" aria-label={`${LEFTOVER_BLOCK_BUTTON}: change Leftover`} onClick={() => changeScope(undefined)} className={LINK_BUTTON_CLASS}>{LEFTOVER_ROW.changeLabel}</button>
                </>
              )}
        </span>
        <Switch
          on={leftoverOn}
          label={LEFTOVER_SWITCH.label}
          testId="leftover-switch"
          compact
          ariaDisabled={area !== undefined}
          describedBy={`${baseId}-leftover-reason`}
          tip={LEFTOVER_SWITCH.title}
          onToggle={() => toggleLeftoverOff(itemId)}
        />
        <span id={`${baseId}-leftover-reason`} className="sr-only">{area !== undefined ? LEFTOVER_BLOCK_NOTE : LEFTOVER_SWITCH.title}</span>
      </div>
      {productDialog}
    </div>
  )
}
