import { useMemo, useState } from 'react'
import { useBlockStore, selectActiveBlock, makeRecipeNode } from '../../store/blockStore'
import { useSolverStore, selectBlockResult, selectFlows } from '../../store/solverStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useUiStore } from '../../store/uiStore'
import { fmtRate } from './ItemTile'
import { RateInput } from './RateInput'
import { ItemPicker } from '../ItemPicker'
import type { ConnectionFlow, Product } from '../../data/types'
import type { RateUnit } from '../../store/uiStore'
import { productChangeEffects } from '../../store/connections'
import type { ProductChangeEffect } from '../../store/connections'
import { hasProduct } from '../../solver/blockGraph'
import { ProductChangeDialog } from './ProductChangeDialog'
import { RowActionsMenu } from './RowActionsMenu'
import type { RowAction } from './RowActionsMenu'
import { ConnectionMenu } from './ConnectionMenu'
import { SummaryPane } from './SummaryPane'
import type { StripAction } from './SummaryDetailStrip'
import { ingredientRows, byproductRows } from './summaryRows'
import { productSlot, byproductSlot, ingredientSlot } from './summarySegments'
import type { ProductInfo } from './summarySegments'
import { netBalance as computeNetBalance, FLOW_TOLERANCE } from '../../solver/index'

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
  const unitLabel = rateUnit === 'min' ? '/m' : '/s'
  const hasExtra = product.extraRate !== undefined
  const extraDisplay = hasExtra ? fmtRate(product.extraRate! / 60, rateUnit) : ''
  const actualDisplay = info.actual !== undefined ? fmtRate(info.actual / 60, rateUnit) : null
  const shortfallDisplay = info.actual !== undefined ? fmtRate((info.required - info.actual) / 60, rateUnit) : null
  const { short } = info
  const showExtra = editing || hasExtra
  const showRequested = info.requested > FLOW_TOLERANCE

  return (
    <span className="flex items-center gap-1 text-xs whitespace-nowrap">
      {/* Extra output — editable; clearing the field removes it */}
      {editing ? (
        <RateInput
          initial={extraDisplay}
          rateUnit={rateUnit}
          ariaLabel="Extra output rate"
          allowClear
          onCommit={onUpdateExtra}
          onStop={onStop}
        />
      ) : hasExtra && (
        <button
          type="button"
          onClick={onStart}
          title={`Extra output: ${extraDisplay}${unitLabel} — click to edit`}
          className="text-gray-300 hover:text-yellow-300 tabular-nums font-mono text-[11px] leading-none"
        >
          extra {extraDisplay}
        </button>
      )}

      {showRequested && (
        <span className="text-gray-300 tabular-nums font-mono text-[11px] leading-none">
          {showExtra ? '+ ' : ''}requested {fmtRate(info.requested / 60, rateUnit)}
        </span>
      )}

      {!showExtra && !showRequested && empty ? (
        <span className="text-gray-500">nothing requested yet</span>
      ) : (
        <>
          {/* Separator + actual (only when solver has run) */}
          {actualDisplay !== null && (
            <>
              {(showExtra || showRequested) && <span className="text-gray-600 text-[10px]">→</span>}
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
        </>
      )}
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
  const [showProductPicker, setShowProductPicker] = useState(false)

  const toggleNoImportItem = useBlockStore(s => s.toggleNoImportItem)
  const noImportItems = activeBlock?.noImportItems ?? []
  const blocks = useBlockStore(s => s.blocks)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const removeInputConnection = useBlockStore(s => s.removeInputConnection)
  const allFlows = useSolverStore(selectFlows)
  const addNode = useBlockStore(s => s.addNode)
  const addBlockForItem = useBlockStore(s => s.addBlockForItem)
  const [byproductMenu, setByproductMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)
  const [consumerPickerItemId, setConsumerPickerItemId] = useState<string | null>(null)
  const [producerPickerItemId, setProducerPickerItemId] = useState<string | null>(null)
  const [productMenu, setProductMenu] = useState<{ productId: string; x: number; y: number } | null>(null)
  const [pendingChange, setPendingChange] = useState<
    | { change: 'add'; product: Product; effects: ProductChangeEffect[] }
    | { change: 'remove'; productId: string; itemId: string; effects: ProductChangeEffect[] }
    | null
  >(null)
  const [connectionChipMenu, setConnectionChipMenu] = useState<{ connectionId: string; x: number; y: number } | null>(null)
  const [connectionMenu, setConnectionMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)

  const products: Product[] = activeBlock?.products ?? []
  const productItemIds = new Set(products.map(p => p.itemId))

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

  // Byproducts: net positive balance of items that are not products, minus what other blocks take.
  const byproductItems = [...netBalance]
    .filter(([id]) => !productItemIds.has(id))
    .map(([id, net]) => ({ itemId: id, ratePerMin: net - (exportedPerMin.get(id) ?? 0) }))
    .filter(({ ratePerMin }) => ratePerMin > FLOW_TOLERANCE)
  const exportedByproducts = [...exportedPerMin.keys()].filter(id => !productItemIds.has(id))
  const byproductRowList = byproductRows(byproductItems, exportedByproducts)

  // Ingredients: unsatisfied raw inputs
  const ingredientItems = (solverResult?.unsatisfied ?? []).filter(u => u.rate > 0)
  const connections = activeBlock?.inputConnections ?? []
  const ingredientRowList = ingredientRows(connections, ingredientItems, noImportItems)
  // Slots: one per item, each split into allocation segments.
  const exportsOf = (itemId: string) => outputFlows.filter(f => f.itemId === itemId)
  const blockIds = new Set(blocks.map(b => b.id))
  // The solver adds a requested amount to the first product of the item.
  const requestedItemIds = new Set(productItemIds)
  const productSlots = products.map(p => {
    const requests = requestedItemIds.delete(p.itemId) ? (requestsByItem.get(p.itemId) ?? []) : []
    return productSlot(
      p,
      // No node makes the item: the product is fully short, not unknown.
      solverResult ? (netBalance.get(p.itemId) ?? 0) : undefined,
      exportsOf(p.itemId),
      rateUnit,
      requests,
    )
  })
  const byproductSlots = byproductRowList.map(r => byproductSlot(r, exportsOf(r.itemId)))
  const ingredientSlots = ingredientRowList.map(r => ingredientSlot(r, inputFlows, blockIds))
  // A product shortfall can neither receive supply nor be forbidden imports (products have no slack).
  const connectable = (itemId: string) => (activeBlock ? !hasProduct(activeBlock, itemId) : false)
  const unitLabel = rateUnit === 'min' ? '/m' : '/s'
  const fmt = (perMin: number) => fmtRate(perMin / 60, rateUnit)

  // A product change asks first when it changes how other blocks' connections behave.
  /** Add a block that makes the item and request it; the picker then adds its recipe to that block. */
  function makeInNewBlock(itemId: string) {
    if (addBlockForItem(itemId, gameData?.items[itemId]?.name ?? itemId)) setProducerPickerItemId(itemId)
  }

  function requestAddProduct(itemId: string, extraRate?: number) {
    if (!activeBlock) return
    const product: Product = { id: crypto.randomUUID(), itemId, ...(extraRate !== undefined ? { extraRate } : {}) }
    const effects = productChangeEffects(blocks, activeBlock.id, itemId, 'add', allFlows)
    if (effects.length === 0) addProduct(product)
    else setPendingChange({ change: 'add', product, effects })
  }

  function requestRemoveProduct(productId: string) {
    if (!activeBlock) return
    const product = activeBlock.products.find(p => p.id === productId)
    if (!product) return
    const effects = productChangeEffects(blocks, activeBlock.id, product.itemId, 'remove', allFlows)
    if (effects.length === 0) removeProduct(productId)
    else setPendingChange({ change: 'remove', productId, itemId: product.itemId, effects })
  }

  function handleAddProduct(itemId: string, rate: number | undefined) {
    requestAddProduct(itemId, rate)
  }

  function confirmPendingChange() {
    if (!pendingChange) return
    if (pendingChange.change === 'add') addProduct(pendingChange.product)
    else removeProduct(pendingChange.productId)
    setPendingChange(null)
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
          renderKeyExtra={(slot, edit) => slot.product!.extra === undefined && !edit.editing && (
            <button
              type="button"
              onClick={edit.start}
              title="Add extra output on top of what is requested"
              className="border border-dashed border-gray-600 rounded px-1.5 text-gray-400 hover:text-gray-200"
            >
              + Extra output
            </button>
          )}
          actionsFor={slot => {
            const actions: StripAction[] = [
              { label: 'Find recipe', onSelect: () => setProducerPickerItemId(slot.itemId) },
            ]
            if (slot.product!.extra !== undefined) {
              actions.push({ label: 'Remove extra', onSelect: () => updateProductExtra(slot.product!.id, undefined) })
            }
            actions.push({ label: 'Remove product', danger: true, onSelect: () => requestRemoveProduct(slot.product!.id) })
            return actions
          }}
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
            { label: 'Make it a product', onSelect: () => requestAddProduct(slot.itemId) },
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
          onMakeInNewBlock={makeInNewBlock}
        />
      )}

      {productMenu && (() => {
        const actions: RowAction[] = []
        if (products.find(p => p.id === productMenu.productId)?.extraRate !== undefined) {
          actions.push({ label: 'Remove extra', onSelect: () => updateProductExtra(productMenu.productId, undefined) })
        }
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
        const actions: RowAction[] = []
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
          actions={[
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

      {pendingChange && activeBlock && (
        <ProductChangeDialog
          change={pendingChange.change}
          itemName={gameData.items[pendingChange.change === 'add' ? pendingChange.product.itemId : pendingChange.itemId]?.name
            ?? (pendingChange.change === 'add' ? pendingChange.product.itemId : pendingChange.itemId)}
          blockName={activeBlock.name}
          effects={pendingChange.effects}
          rateUnit={rateUnit}
          onCancel={() => setPendingChange(null)}
          onConfirm={confirmPendingChange}
        />
      )}

      {showProductPicker && (
        <ItemPicker
          source="items"
          onSelect={handleAddProduct}
          onClose={() => setShowProductPicker(false)}
        />
      )}
    </div>
  )
}
