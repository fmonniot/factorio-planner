import { useEffect, useMemo, useState } from 'react'
import { importOffItems } from '../../data/sourceRules'
import { useBlockStore, selectActiveBlock, makeRecipeNode } from '../../store/blockStore'
import { useSolverStore, selectBlockResult, selectFlows, selectServed } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import { fmtRate, fmtItemRate, fmtItemRateText, inputRateUnit } from './ItemTile'
import { isEnergyItem } from '../../data/electricity'
import { RateInput } from './RateInput'
import { ItemPicker } from '../ItemPicker'
import type { ConnectionFlow, Product } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { offerByItem, parseFlowKey } from '../../data/flowKey'
import { flowAtKey } from './flowParts'
import { productChangeEffects, receivedFromSources } from '../../store/connections'
import type { ProductChangeEffect } from '../../store/connections'
import { hasProduct } from '../../solver/blockGraph'
import { ComesFrom } from './ComesFrom'
import { ComesFromPopover } from './ComesFromPopover'
import { SourceRulesButton } from './SourceRulesButton'
import { useDrawerLayout } from './sidePanel/useDrawerLayout'
import { ProductChangeDialog } from './ProductChangeDialog'
import { RowActionsMenu } from './RowActionsMenu'
import { USE_IT_ALL_ACTION } from './itemSourcing'
import type { RowAction } from './RowActionsMenu'
import { ConnectionMenu } from './ConnectionMenu'
import { ConnectionLimitEditor } from './ConnectionLimitEditor'
import { ServedOrderPopover } from './ServedOrderPopover'
import { hasServedOrder, servedLines, unrankedCount } from './servedOrder'
import { servedListOf } from '../../data/servedEntries'
import { SummaryPane } from './SummaryPane'
import { SummaryLine } from './SummaryLine'
import type { StripAction } from './SummaryDetailStrip'
import { presentRecipesFor } from './recipeAreas'
import { ingredientRows, byproductRows, areaMissingOf, exportedByKey, leftoverByKey } from './summaryRows'
import { productSlot, byproductSlot, ingredientSlot } from './summarySegments'
import type { ProductInfo } from './summarySegments'
import { netBalance as computeNetBalance, grossFlow, FLOW_TOLERANCE } from '../../solver/index'
import { useSourceRuleItems } from './useSourceRuleItems'

// ---------------------------------------------------------------------------
// ProductRates — a product's extra → actual in the detail strip, with inline edit for the extra
// ---------------------------------------------------------------------------

interface ProductRatesProps {
  product: Product
  info: ProductInfo
  rateUnit: RateUnit
  editing: boolean
  empty: boolean
  onStart: () => void
  onStop: () => void
  onUpdateExtra: (extraRate: number | undefined) => void
}

function ProductRates({ product, info, rateUnit, editing, empty, onStart, onStop, onUpdateExtra }: ProductRatesProps) {
  // product.extraRate is stored in items/min internally
  // Electricity and heat are shown in power units (value and unit together); its inputs are typed in MW.
  const power = isEnergyItem(product.itemId)
  const unitLabel = power ? '' : fmtItemRate(product.itemId, 0, rateUnit).unit
  const text = (perMin: number) => power
    ? fmtItemRateText(product.itemId, perMin / 60, rateUnit)
    : fmtRate(perMin / 60, rateUnit)
  const hasExtra = product.extraRate !== undefined
  const extraInput = hasExtra ? fmtRate(product.extraRate! / 60, inputRateUnit(product.itemId, rateUnit)) : ''
  const extraDisplay = hasExtra ? text(product.extraRate!) : ''
  const actualDisplay = info.actual !== undefined ? text(info.actual) : null
  const shortfallDisplay = info.actual !== undefined ? text(info.required - info.actual) : null
  const { short } = info
  const showExtra = editing || hasExtra
  const showRequested = info.requested > FLOW_TOLERANCE

  return (
    <span className="flex items-center gap-1 text-xs whitespace-nowrap">
      {/* Extra output — editable; clearing the field removes it */}
      {editing ? (
        <>
          <RateInput
            initial={extraInput}
            rateUnit={inputRateUnit(product.itemId, rateUnit)}
            ariaLabel="Extra output rate"
            allowClear
            onCommit={onUpdateExtra}
            onStop={onStop}
          />
          {/* Electricity and heat have no unitLabel, but its field is typed in MW whatever the rate unit. */}
          {power && <span data-testid="extra-input-unit" className="text-gray-400 text-[10px]">MW</span>}
        </>
      ) : hasExtra && (
        <button
          type="button"
          onClick={onStart}
          data-tip={`Extra output: ${extraDisplay}${unitLabel} — click to edit`}
          className="text-gray-300 hover:text-yellow-300 tabular-nums font-mono text-[11px] leading-none"
        >
          extra {extraDisplay}
        </button>
      )}

      {showRequested && (
        <span className="text-gray-300 tabular-nums font-mono text-[11px] leading-none">
          {showExtra ? '+ ' : ''}requested {text(info.requested)}
        </span>
      )}

      {!showExtra && !showRequested && empty ? (
        <span className="text-gray-400">nothing requested yet</span>
      ) : (
        <>
          {/* Separator + actual (only when solver has run) */}
          {actualDisplay !== null && (
            <>
              {(showExtra || showRequested) && <span className="text-gray-400 text-[10px]">→</span>}
              <span
                data-tip={short
                  ? `Actual: ${actualDisplay}${unitLabel} — short by ${shortfallDisplay}${unitLabel}`
                  : `Actual: ${actualDisplay}${unitLabel} — solver output`}
                className={`${short ? 'text-amber-400' : 'text-teal-400'} tabular-nums font-mono text-[11px] leading-none`}
              >
                {short && '▼ '}
                {actualDisplay}
              </span>
            </>
          )}

          {unitLabel && <span className="text-gray-400 text-[10px]">{unitLabel}</span>}
        </>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// FactorySummary
// ---------------------------------------------------------------------------

/** Below `md` the panes form a horizontal snap strip; from `md` they share a three-column grid. */
const PANE_RESPONSIVE = 'shrink-0 basis-[85%] snap-start md:basis-auto'

export function FactorySummary() {
  const activeBlock = useBlockStore(selectActiveBlock)
  const solverResult = useSolverStore(selectBlockResult(activeBlock?.id))
  const gameData = useGameDataStore(selectGameData)
  const rateUnit = useUiStore(s => s.rateUnit)
  const collapsed = useUiStore(s => s.summaryCollapsed)
  const setCollapsed = useUiStore(s => s.setSummaryCollapsed)
  const addProduct = useBlockStore(s => s.addProduct)
  const removeProduct = useBlockStore(s => s.removeProduct)
  const moveProduct = useBlockStore(s => s.moveProduct)
  const moveProductBy = useBlockStore(s => s.moveProductBy)
  const updateProductExtra = useBlockStore(s => s.updateProductExtra)
  const [showProductPicker, setShowProductPicker] = useState(false)

  // The handle tab is one element in both states, so it keeps its focus across a toggle.
  const toggle = (next: boolean) => {
    // Collapsing unmounts the panes and their selection with them.
    if (next) setOpened(null)
    setCollapsed(next)
  }

  const activeBlockId = activeBlock?.id

  // A request to show an item's Ingredients slot (`uiStore.openIngredientSlot`, from the Comes from popover's "Show in
  // Ingredients"): the strip expands, the Ingredients pane selects the slot and focuses its Comes from control. `opened` is
  // the request for the pane. A request left over from before this strip mounted is ignored.
  const slotRequest = useUiStore(s => s.ingredientSlotRequest)
  const clearSlotRequest = useUiStore(s => s.clearIngredientSlotRequest)
  const clearSelectedRow = useUiStore(s => s.clearSelectedRow)
  const drawer = useDrawerLayout()
  const [handledSlotSeq, setHandledSlotSeq] = useState(() => useUiStore.getState().ingredientSlotRequest?.seq ?? 0)
  const [opened, setOpened] = useState<{ seq: number; blockId: string; itemId: string } | null>(null)
  if (slotRequest && slotRequest.seq !== handledSlotSeq) {
    setHandledSlotSeq(slotRequest.seq)
    if (activeBlockId !== undefined) setOpened({ ...slotRequest, blockId: activeBlockId })
  }
  // The panes are keyed by block, so the selection does not survive a block change.
  if (opened && opened.blockId !== activeBlockId) setOpened(null)
  const openedSeq = opened?.seq
  useEffect(() => {
    if (!slotRequest) return
    clearSlotRequest(slotRequest.seq)
    if (slotRequest.seq !== openedSeq) return
    setCollapsed(false)
    // A side panel that is a drawer is modal: it covers the strip and keeps Tab inside itself, so it closes.
    // The pane takes the focus in the same commit, before the drawer would hand it back to the row.
    if (drawer) clearSelectedRow()
  }, [slotRequest, openedSeq, drawer, clearSlotRequest, clearSelectedRow, setCollapsed])

  const noImportItems = importOffItems(activeBlock?.sourceRules)
  const blocks = useBlockStore(s => s.blocks)
  const ruleItems = useSourceRuleItems(activeBlock, gameData)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const removeInputConnection = useBlockStore(s => s.removeInputConnection)
  const moveServed = useBlockStore(s => s.moveServed)
  const placeServed = useBlockStore(s => s.placeServed)
  const setServedTied = useBlockStore(s => s.setServedTied)
  const setServedShare = useBlockStore(s => s.setServedShare)
  const resetServedOrder = useBlockStore(s => s.resetServedOrder)
  const setConnectionMaxRate = useBlockStore(s => s.setConnectionMaxRate)
  const allFlows = useSolverStore(selectFlows)
  const addNode = useBlockStore(s => s.addNode)
  const toggleLeftoverOff = useBlockStore(s => s.toggleLeftoverOff)
  const addBlockForItem = useBlockStore(s => s.addBlockForItem)
  const [byproductMenu, setByproductMenu] = useState<{ itemId: string; rate: number; x: number; y: number } | null>(null)
  const [consumerPickerItemId, setConsumerPickerItemId] = useState<string | null>(null)
  const [producerPickerItemId, setProducerPickerItemId] = useState<string | null>(null)
  const [productMenu, setProductMenu] = useState<{ productId: string; x: number; y: number } | null>(null)
  const [pendingChange, setPendingChange] = useState<
    | { change: 'add'; product: Product; effects: ProductChangeEffect[]; received: string[] }
    | { change: 'remove'; productId: string; itemId: string; effects: ProductChangeEffect[] }
    | null
  >(null)
  const [connectionChipMenu, setConnectionChipMenu] = useState<{ connectionId: string; x: number; y: number } | null>(null)
  // The limit editor outlives the menu, which closes itself after a selection.
  const [limitEditor, setLimitEditor] = useState<{ connectionId: string; toBlockId: string; x: number; y: number } | null>(null)
  const [servedPopover, setServedPopover] = useState<{ blockId: string; itemId: string; x: number; y: number } | null>(null)
  const connectionMenu = useUiStore(s => s.connectionMenu)
  const openConnectionMenu = useUiStore(s => s.openConnectionMenu)
  const closeConnectionMenu = useUiStore(s => s.closeConnectionMenu)

  const products: Product[] = activeBlock?.products ?? []
  const productItemIds = new Set(products.map(p => p.itemId))

  // Per flow key: a split fluid's temperatures and ranges are separate entries, a plain item's key is its id.
  const netBalance = solverResult ? computeNetBalance(solverResult.nodes, solverResult.conversions) : new Map<string, number>()
  const gross = solverResult ? grossFlow(solverResult.nodes, solverResult.conversions) : new Map<string, number>()
  const netOfItem = offerByItem(netBalance)

  const inputFlows = useMemo(
    () => new Map(allFlows.filter(f => f.toBlockId === activeBlockId).map(f => [f.connectionId, f])),
    [allFlows, activeBlockId],
  )
  // Deliveries to other blocks, by item (items/min).
  const outputFlows = useMemo(
    () => allFlows.filter(f => f.fromBlockId === activeBlockId && f.rate > FLOW_TOLERANCE),
    [allFlows, activeBlockId],
  )
  // By flow key: a split fluid's connection leaves the block at the keys its parts carry.
  const exportedKeys = exportedByKey(outputFlows, activeBlockId ?? '')

  // What other blocks request from this one, by item, in solve order. Uses every flow (a request for 0 draws nothing).
  const requestsByItem = useMemo(() => {
    const byItem = new Map<string, ConnectionFlow[]>()
    for (const f of allFlows) {
      if (f.fromBlockId !== activeBlockId || f.kind !== 'request') continue
      const list = byItem.get(f.itemId)
      if (list) list.push(f)
      else byItem.set(f.itemId, [f])
    }
    return byItem
  }, [allFlows, activeBlockId])

  // Byproducts: net positive balance of items that are not products, minus what other blocks take at that key;
  // a leftover that is only LP rounding noise (see isLeftover) gets no tile. The maths is `leftoverByKey`, shared with the
  // side panel's "Where outputs go".
  const byproductItems = [...leftoverByKey(netBalance, gross, exportedKeys)]
    .map(([key, ratePerMin]) => ({ key, ratePerMin, ...parseFlowKey(key) }))
    .filter(({ itemId }) => !productItemIds.has(itemId))
    .map(({ key, ratePerMin, itemId, tag }) => ({ itemId, key, ...(tag ? { temp: tag } : {}), ratePerMin }))
  const exportedByproducts = [...exportedKeys.keys()].filter(key => !productItemIds.has(parseFlowKey(key).itemId))
  const byproductRowList = byproductRows(byproductItems, exportedByproducts)

  // Ingredients: unsatisfied raw inputs
  const ingredientItems = (solverResult?.unsatisfied ?? []).filter(u => u.rate > 0)
  const connections = activeBlock?.inputConnections ?? []
  // A block with areas: the missing part of an import comes from the areas' own rules (`areaMissingPerMin`).
  const areaRoutes = solverResult?.areaRoutes
  const ingredientRowList = ingredientRows(
    connections, ingredientItems, noImportItems,
    activeBlock && areaRoutes ? areaMissingOf(activeBlock.sourceRules, activeBlock.rootPlan, areaRoutes) : undefined,
    inputFlows,
  )
  const limitConnection =
    limitEditor && limitEditor.toBlockId === activeBlockId
      ? connections.find(c => c.id === limitEditor.connectionId)
      : undefined
  // The editor is tied to one connection of one block: close it when either goes away.
  if (limitEditor && !limitConnection) setLimitEditor(null)
  const served = useSolverStore(selectServed)
  const servedOf = (itemId: string) => (activeBlockId ? served[activeBlockId]?.[itemId] : undefined)
  // The popover is tied to one item of one block: close it when either goes away or the order stops being worth showing.
  if (servedPopover && (servedPopover.blockId !== activeBlockId || !hasServedOrder(servedOf(servedPopover.itemId)))) setServedPopover(null)
  const storedOf = (itemId: string) => (activeBlock ? servedListOf(activeBlock, itemId) : undefined)
  // A leftover slot (a rate above 0: an export-only slot has none) can switch Leftover off for its item, so the rows use it up. With
  // the rule already off the action stays, disabled, to say that the rows cannot use more of it.
  const leftoverAction = (itemId: string, rate: number): RowAction[] => {
    if (!(rate > 0) || !activeBlock) return []
    const off = activeBlock.sourceRules[itemId]?.leftoverOff === true
    return [{
      label: USE_IT_ALL_ACTION.label,
      disabled: off,
      title: off ? USE_IT_ALL_ACTION.offTitle : USE_IT_ALL_ACTION.title,
      onSelect: () => toggleLeftoverOff(itemId),
    }]
  }
  const servedAction = (itemId: string): StripAction[] => {
    const list = servedOf(itemId)
    if (!hasServedOrder(list)) return []
    const n = unrankedCount(servedLines(list!, itemId, rateUnit), storedOf(itemId))
    return [{
      id: 'served-order',
      label: 'Served order…',
      icon: 'list',
      badge: n > 0 ? { count: n, noun: 'not ranked' } : undefined,
      onSelect: e => {
        const r = e.currentTarget.getBoundingClientRect()
        setServedPopover({ blockId: activeBlockId!, itemId, x: r.left, y: r.bottom })
      },
    }]
  }
  // Slots: one per item, each split into allocation segments.
  const exportsOf = (itemId: string) => outputFlows.filter(f => f.itemId === itemId)
  const blockIds = new Set(blocks.map(b => b.id))
  const productSlots = products.map(p => {
    const requests = requestsByItem.get(p.itemId) ?? []
    return productSlot(
      p,
      // No node makes the item: the product is fully short, not unknown.
      solverResult ? (netOfItem.get(p.itemId) ?? 0) : undefined,
      exportsOf(p.itemId),
      rateUnit,
      requests,
    )
  })
  // The deliveries of a split fluid sit on the slot of the key their part carries.
  const exportsOfKey = (key: string) =>
    outputFlows.flatMap(f => {
      const at = flowAtKey(f, key)
      return at && at.rate > FLOW_TOLERANCE ? [at] : []
    })
  const byproductSlots = byproductRowList.map(r => byproductSlot(r, exportsOfKey(r.key)))
  const ingredientSlots = ingredientRowList.map(r => ingredientSlot(r, inputFlows, blockIds, ruleItems))
  // Slot ids of the Ingredients pane are flow keys: the request names the item's first slot, none when the block has no such slot.
  const openedSlotId = opened ? ingredientSlots.find(s => s.itemId === opened.itemId)?.id : undefined
  // A product shortfall cannot receive supply (products have no import slack either).
  const connectable = (itemId: string) => (activeBlock ? !hasProduct(activeBlock, itemId) : false)
  // Number and unit of a rate of `itemId` (power units for electricity and heat).
  const fmtFor = (itemId: string, perMin: number) => fmtItemRate(itemId, perMin / 60, rateUnit)

  function requestAddProduct(itemId: string, extraRate?: number) {
    if (!activeBlock || hasProduct(activeBlock, itemId)) return
    const product: Product = { id: crypto.randomUUID(), itemId, ...(extraRate !== undefined ? { extraRate } : {}) }
    const effects = productChangeEffects(blocks, activeBlock.id, itemId, 'add', allFlows)
    const received = receivedFromSources(blocks, activeBlock.id, itemId)
    if (effects.length === 0 && received.length === 0) addProduct(product)
    else setPendingChange({ change: 'add', product, effects, received })
  }

  /** Move earlier / Move later for a product, for both menus; none with fewer than two products. */
  function productMoveActions(productId: string): { label: string; onSelect: () => void; disabled?: boolean; title?: string }[] {
    const index = products.findIndex(p => p.id === productId)
    if (index < 0 || products.length < 2) return []
    const first = index === 0
    const last = index === products.length - 1
    return [
      {
        label: 'Move earlier',
        onSelect: () => moveProductBy(productId, -1),
        ...(first ? { disabled: true, title: 'Already the first product' } : {}),
      },
      {
        label: 'Move later',
        onSelect: () => moveProductBy(productId, 1),
        ...(last ? { disabled: true, title: 'Already the last product' } : {}),
      },
    ]
  }

  function requestRemoveProduct(productId: string) {
    if (!activeBlock) return
    const product = activeBlock.products.find(p => p.id === productId)
    if (!product) return
    const effects = productChangeEffects(blocks, activeBlock.id, product.itemId, 'remove', allFlows)
    if (effects.length === 0) removeProduct(productId)
    else setPendingChange({ change: 'remove', productId, itemId: product.itemId, effects })
  }

  /** Add a block that makes the item and request it; the picker then adds its recipe to that block. */
  function makeInNewBlock(itemId: string) {
    if (addBlockForItem(itemId, gameData?.items[itemId]?.name ?? itemId)) setProducerPickerItemId(itemId)
  }

  function handleAddProduct(itemId: string, rate: number | undefined) {
    requestAddProduct(itemId, rate)
  }

  function confirmPendingChange() {
    if (!pendingChange) return
    // addProduct is a no-op when the block gained the product while the dialog was open.
    if (pendingChange.change === 'add') addProduct(pendingChange.product)
    else removeProduct(pendingChange.productId)
    setPendingChange(null)
  }

  // The plan may not belong to the selected data set until its data has loaded,
  // so nothing here can be edited before then.
  if (!gameData) return null

  return (
    <div className="bg-gray-900 shrink-0">
      {collapsed ? (
        <SummaryLine
          panes={[
            { pane: 'products', label: 'Products', slots: productSlots },
            { pane: 'byproducts', label: 'Byproducts', slots: byproductSlots },
            { pane: 'ingredients', label: 'Ingredients', slots: ingredientSlots },
          ]}
          items={gameData.items}
          rateUnit={rateUnit}
        />
      ) : (
      /* Three-pane summary: Products, Byproducts, Ingredients. The key resets selection when the block changes. */
      <div className="group/panes flex overflow-x-auto max-md:overflow-y-hidden snap-x snap-mandatory scroll-px-3 overscroll-x-contain gap-2 px-3 pb-2 pt-2 border-b border-gray-700 md:grid md:grid-cols-3 md:overflow-visible">
        <SummaryPane
          key={`products-${activeBlock?.id}`}
          pane="products"
          className={PANE_RESPONSIVE}
          label="Products"
          action={
            <button
              type="button"
              onClick={() => setShowProductPicker(true)}
              className="w-[22px] h-5 inline-flex items-center justify-center text-gray-400 hover:text-gray-200 rounded border border-gray-700 hover:border-gray-500"
              title="Add product"
              aria-label="Add product"
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
          // Slot ids of the Products pane are product ids.
          onReorder={(slotId, toIndex) => moveProduct(slotId, toIndex)}
          onSlotContextMenu={(slot, e) => {
            e.preventDefault()
            setProductMenu({ productId: slot.product!.id, x: e.clientX, y: e.clientY })
          }}
          renderRates={(slot, edit) => {
            const product = products.find(p => p.id === slot.product!.id)
            return product && (
              <ProductRates
                product={product}
                info={slot.product!}
                rateUnit={rateUnit}
                editing={edit.editing}
                empty={slot.empty === true}
                onStart={edit.start}
                onStop={edit.stop}
                onUpdateExtra={rate => updateProductExtra(product.id, rate)}
              />
            )
          }}
          actionsFor={(slot, edit) => {
            const actions: StripAction[] = [
              { label: 'Find recipe', icon: 'search', side: 'left', onSelect: () => setProducerPickerItemId(slot.itemId) },
              ...servedAction(slot.itemId),
            ]
            // The extra output field takes the place of the plus while it is open.
            if (slot.product!.extra !== undefined) {
              actions.push({
                label: 'Remove extra',
                icon: 'minus',
                title: 'Remove extra output',
                onSelect: () => updateProductExtra(slot.product!.id, undefined),
              })
            } else if (!edit.editing) {
              actions.push({
                label: 'Add extra output',
                icon: 'plus',
                title: 'Add extra output on top of what is requested',
                onSelect: edit.start,
              })
            }
            // The two moves are one joined pair.
            actions.push(...productMoveActions(slot.product!.id).map((a, i): StripAction => ({ ...a, icon: i === 0 ? 'left' : 'right', joined: i === 1 })))
            actions.push({ label: 'Remove product', icon: 'trash', danger: true, onSelect: () => requestRemoveProduct(slot.product!.id) })
            return actions
          }}
          onOpenBlock={setActiveBlock}
        />

        {/* Byproducts: an item that is only exported has rate 0 and only export segments. */}
        <SummaryPane
          key={`byproducts-${activeBlock?.id}`}
          pane="byproducts"
          className={PANE_RESPONSIVE}
          label="Byproducts"
          slots={byproductSlots}
          items={gameData.items}
          blocks={blocks}
          rateUnit={rateUnit}
          onSlotContextMenu={(slot, e) => {
            e.preventDefault()
            setByproductMenu({ itemId: slot.itemId, rate: slot.rate, x: e.clientX, y: e.clientY })
          }}
          renderRates={slot => (
            <span className="text-xs text-gray-300">
              made <span className="font-mono tabular-nums">{fmtFor(slot.itemId, slot.scale).value}</span>
              <span className="text-gray-400 text-[10px]">{fmtFor(slot.itemId, slot.scale).unit}</span>
            </span>
          )}
          actionsFor={slot => [
            { label: 'Add consumer recipe…', icon: 'arrowR', side: 'left', onSelect: () => setConsumerPickerItemId(slot.itemId) },
            ...servedAction(slot.itemId),
            ...leftoverAction(slot.itemId, slot.rate).map((a): StripAction => ({ ...a, icon: 'flame' })),
            { label: 'Make it a product', icon: 'flag', onSelect: () => requestAddProduct(slot.itemId) },
          ]}
          onOpenBlock={setActiveBlock}
        />

        {/* Ingredients: select a slot for Find recipe / Receive from… and the Comes from control; right-click
            it for the connection menu. Limit or remove a connection by right-clicking its segment. */}
        <SummaryPane
          key={`ingredients-${activeBlock?.id}`}
          pane="ingredients"
          className={PANE_RESPONSIVE}
          label="Ingredients"
          action={<SourceRulesButton />}
          slots={ingredientSlots}
          items={gameData.items}
          blocks={blocks}
          rateUnit={rateUnit}
          onSlotContextMenu={(slot, e) => {
            // A goal shortfall has no menu: there is nothing to offer.
            if (!connectable(slot.itemId)) return
            e.preventDefault()
            const rect = e.currentTarget.getBoundingClientRect()
            openConnectionMenu(slot.itemId, rect.left, rect.bottom)
          }}
          renderRates={slot => (
            <span className="text-xs text-gray-300">
              need <span className="font-mono tabular-nums">{fmtFor(slot.itemId, slot.scale).value}</span>
              <span className="text-gray-400 text-[10px]">{fmtFor(slot.itemId, slot.scale).unit}</span>
            </span>
          )}
          actionsFor={slot => {
            const canConnect = connectable(slot.itemId)
            const actions: StripAction[] = [
              { label: 'Find recipe', icon: 'search', side: 'left', onSelect: () => setProducerPickerItemId(slot.itemId) },
            ]
            if (canConnect) {
              actions.push({
                label: 'Receive from…',
                icon: 'arrowL',
                side: 'left',
                onSelect: e => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  openConnectionMenu(slot.itemId, rect.left, rect.bottom)
                },
              })
            }
            return actions
          }}
          renderControls={slot => <ComesFrom itemId={slot.itemId} listInPopover />}
          openRequest={openedSlotId !== undefined ? { seq: opened!.seq, slotId: openedSlotId } : undefined}
          onOpenBlock={setActiveBlock}
          onConnectionContextMenu={(connectionId, e) =>
            setConnectionChipMenu({ connectionId, x: e.clientX, y: e.clientY })}
        />
      </div>
      )}

      {/* The handle tab: it collapses the expanded summary and expands the collapsed one, from md and below alike. It
          hangs off the summary's bottom border like a tab: it starts on that border (`-mt-px`, 1px taller than its row), so its
          background hides the border line above it and its side borders continue the strip's. Below xl it has a row of
          its own, 18px high; from xl the row has no height and the tab overlaps the top of the table toolbar, whose
          middle is empty, so the toolbar sits right under the summary. Its text is its accessible name (the action it
          performs), so it carries no aria-expanded: that would state the same fact twice. */}
      <div className="relative z-10 flex h-[18px] justify-center xl:h-0">
        <button
          type="button"
          data-testid="summary-handle"
          onClick={() => toggle(!collapsed)}
          className="h-[19px] -mt-px pt-px flex items-center justify-center gap-1.5 px-4 rounded-b-lg border border-t-0 border-gray-700 bg-gray-900 text-[10px] tracking-[0.04em] text-gray-400 hover:text-gray-200"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className={collapsed ? 'rotate-180' : undefined}>
            <path d="M2 6.5 5 3.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          {collapsed ? 'Expand summary' : 'Collapse summary'}
        </button>
      </div>

      <ComesFromPopover hasSlot={itemId => ingredientRowList.some(r => r.itemId === itemId)} />

      {connectionMenu && (
        <ConnectionMenu
          itemId={connectionMenu.itemId}
          x={connectionMenu.x}
          y={connectionMenu.y}
          onClose={closeConnectionMenu}
          onMakeInNewBlock={makeInNewBlock}
        />
      )}

      {productMenu && (() => {
        const actions: RowAction[] = []
        if (products.find(p => p.id === productMenu.productId)?.extraRate !== undefined) {
          actions.push({ label: 'Remove extra', onSelect: () => updateProductExtra(productMenu.productId, undefined) })
        }
        actions.push(...productMoveActions(productMenu.productId))
        actions.push({ label: 'Remove product', danger: true, onSelect: () => requestRemoveProduct(productMenu.productId) })
        return (
          <RowActionsMenu
            x={productMenu.x}
            y={productMenu.y}
            actions={actions}
            onClose={() => setProductMenu(null)}
          />
        )
      })()}

      {connectionChipMenu && (() => {
        const chipConnection = connections.find(c => c.id === connectionChipMenu.connectionId)
        const hasLimit = chipConnection?.maxRate !== undefined
        const actions: RowAction[] = []
        actions.push({
          label: hasLimit ? 'Change limit…' : 'Limit rate…',
          onSelect: () => {
            if (activeBlockId) setLimitEditor({ ...connectionChipMenu, toBlockId: activeBlockId })
          },
        })
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

      {limitEditor && limitConnection && (
        <ConnectionLimitEditor
          key={`${limitEditor.connectionId}-${rateUnit}`}
          x={limitEditor.x}
          y={limitEditor.y}
          initial={limitConnection.maxRate !== undefined
            ? fmtRate(limitConnection.maxRate / 60, inputRateUnit(limitConnection.itemId, rateUnit))
            : ''}
          itemId={limitConnection.itemId}
          rateUnit={inputRateUnit(limitConnection.itemId, rateUnit)}
          onCommit={perMin => setConnectionMaxRate(limitEditor.connectionId, perMin, limitEditor.toBlockId)}
          onClose={() => setLimitEditor(null)}
        />
      )}

      {servedPopover && gameData && (
        <ServedOrderPopover
          key={`${servedPopover.blockId}-${servedPopover.itemId}`}
          itemId={servedPopover.itemId}
          list={servedOf(servedPopover.itemId)!}
          items={gameData.items}
          blocks={blocks}
          rateUnit={rateUnit}
          stored={storedOf(servedPopover.itemId)}
          onMove={(entry, to, shown) => moveServed(servedPopover.blockId, servedPopover.itemId, entry, to, shown)}
          onPlace={(entry, place, shown) => placeServed(servedPopover.blockId, servedPopover.itemId, entry, place, shown)}
          onTie={(entry, tied, shown) => setServedTied(servedPopover.blockId, servedPopover.itemId, entry, tied, shown)}
          onShare={(entry, pct, shown) => setServedShare(servedPopover.blockId, servedPopover.itemId, entry, pct, shown)}
          onReset={() => resetServedOrder(servedPopover.blockId, servedPopover.itemId)}
          x={servedPopover.x}
          y={servedPopover.y}
          onClose={() => setServedPopover(null)}
        />
      )}

      {byproductMenu && (
        <RowActionsMenu
          x={byproductMenu.x}
          y={byproductMenu.y}
          actions={[
            ...leftoverAction(byproductMenu.itemId, byproductMenu.rate),
            { label: 'Add consumer recipe…', onSelect: () => setConsumerPickerItemId(byproductMenu.itemId) },
            { label: 'Make it a product', onSelect: () => requestAddProduct(byproductMenu.itemId) },
          ]}
          onClose={() => setByproductMenu(null)}
        />
      )}

      {consumerPickerItemId && (
        <ItemPicker
          source="recipes"
          consumesItemId={consumerPickerItemId}
          onSelect={id => addNode(makeRecipeNode(id))}
          presentRecipes={activeBlock ? presentRecipesFor(activeBlock.rootPlan, activeBlock.rootPlan.id) : undefined}
          onClose={() => setConsumerPickerItemId(null)}
        />
      )}

      {producerPickerItemId && (
        <ItemPicker
          source="recipes"
          filterByItemId={producerPickerItemId}
          onSelect={id => addNode(makeRecipeNode(id))}
          presentRecipes={activeBlock ? presentRecipesFor(activeBlock.rootPlan, activeBlock.rootPlan.id) : undefined}
          onClose={() => setProducerPickerItemId(null)}
        />
      )}

      {pendingChange && activeBlock && (
        <ProductChangeDialog
          change={pendingChange.change}
          itemId={pendingChange.change === 'add' ? pendingChange.product.itemId : pendingChange.itemId}
          itemName={gameData.items[pendingChange.change === 'add' ? pendingChange.product.itemId : pendingChange.itemId]?.name
            ?? (pendingChange.change === 'add' ? pendingChange.product.itemId : pendingChange.itemId)}
          blockName={activeBlock.name}
          effects={pendingChange.effects}
          received={pendingChange.change === 'add' ? pendingChange.received : undefined}
          rateUnit={rateUnit}
          onCancel={() => setPendingChange(null)}
          onConfirm={confirmPendingChange}
        />
      )}

      {showProductPicker && (
        <ItemPicker
          source="items"
          presentItems={productItemIds}
          onSelect={handleAddProduct}
          onClose={() => setShowProductPicker(false)}
        />
      )}
    </div>
  )
}
