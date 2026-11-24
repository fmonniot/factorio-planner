import { useMemo } from 'react'
import { areaIdsOf, effectiveAreaRule, storedAreaRule } from '../../data/subPlanTree'
import { areaLPItems, blockAreas } from '../../solver/areas'
import { flattenBlock } from '../../solver/index'
import { useBlockStore, selectActiveBlock } from '../../store/blockStore'
import { useGameDataStore, selectGameData } from '../../store/gameDataStore'
import { useSolverStore, selectBlockResult, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { areaSupply, supplierLines } from './areaSources'
import { fmtItemRateText } from './ItemTile'
import { sourcesLineOrder } from './itemSourcing'
import type { Side } from './itemSourcing'
import { buildSourcesModel } from './sourcesModel'
import { buildBlockRows } from './sourcesRows'
import { itemMakers } from './sourcingText'

/**
 * Everything the Sources list and the header's bar read for one item: the store reads, the rule of the scope, the lines' model.
 * `enabled` is false for the control that draws neither (the strip's), which then does none of the work.
 * Undefined without a block or game data.
 */
export function useSourcesModel(itemId: string, areaId: string | undefined, enabled = true) {
  const block = useBlockStore(selectActiveBlock)
  const blocks = useBlockStore(s => s.blocks)
  const gameData = useGameDataStore(selectGameData)
  const result = useSolverStore(selectBlockResult(block?.id))
  const flows = useSolverStore(selectFlows)
  const unit = useUiStore(s => s.rateUnit)

  const rootPlan = block?.rootPlan
  // An area whose flag went off is no area: the list falls back to the block's.
  const area = useMemo(() => (rootPlan !== undefined && areaId !== undefined && areaIdsOf(rootPlan).has(areaId) ? areaId : undefined), [rootPlan, areaId])
  const rule = block && rootPlan && area !== undefined ? effectiveAreaRule(rootPlan, block.sourceRules, area, itemId) : block?.sourceRules[itemId]
  const stored = rootPlan && area !== undefined ? storedAreaRule(rootPlan, area, itemId) : undefined
  const makeHere = rule?.makeHere
  // Where *Make more here* was drawn last: it keeps that place while it is switched off. Session state in the ui store, not part
  // of the stored rule, so that every surface that shows the list agrees and a closed list remembers it.
  // At area scope it is remembered per area.
  const sideKey = block ? (area !== undefined ? `${block.id}/${area}` : block.id) : undefined
  const storedSide = useUiStore(s => (sideKey ? s.sourcesSides[`${sideKey}:${itemId}`] : undefined))
  const drawnSide: Side | undefined = makeHere === 'after-blocks' ? 'below' : makeHere === undefined ? 'above' : undefined
  const lastSide: Side = drawnSide ?? storedSide ?? 'above'

  const hasAreas = useMemo(() => rootPlan !== undefined && blockAreas(rootPlan) !== undefined, [rootPlan])
  const makers = useMemo(
    () => (enabled && block && gameData ? itemMakers(block, gameData, result, itemId, area) : []),
    [enabled, block, gameData, result, itemId, area],
  )
  // The other areas that supply this one (area scope only): walks the plan once per other area, so kept until the plan, the solve or the switches change.
  // (The switches are keyed by their ids: an area with no rule of its own gets a fresh empty rule on every render.)
  const offKey = (block && rootPlan && area !== undefined ? effectiveAreaRule(rootPlan, block.sourceRules, area, itemId).areasOff : undefined)?.join('\n') ?? ''
  const suppliers = useMemo(
    () => (enabled && block && gameData && area !== undefined ? supplierLines(block, gameData, result, itemId, area, { areasOff: offKey === '' ? undefined : offKey.split('\n') }) : []),
    [enabled, block, gameData, result, itemId, area, offKey],
  )
  // Whether the area LP splits the item's outside legs between the areas (two areas or more touch it); not told by the routes, which omit a part at zero.
  const split = useMemo(
    () => (enabled && block && gameData && area !== undefined ? areaLPItems(flattenBlock(block), gameData).has(itemId) : false),
    [enabled, block, gameData, itemId, area],
  )

  const name = gameData?.items[itemId]?.name ?? itemId
  const rate = (perMin: number) => fmtItemRateText(itemId, perMin / 60, unit)
  const rows = useMemo(
    () => (enabled && block ? buildBlockRows({ block, blocks, flows, itemId, itemName: name, rate: perMin => fmtItemRateText(itemId, perMin / 60, unit) }) : []),
    [enabled, block, blocks, flows, itemId, name, unit],
  )
  // A split fluid can be imported over several ranges: all of them count.
  const unsatisfied = (result?.unsatisfied ?? []).filter(u => u.itemId === itemId).reduce((t, u) => t + u.rate, 0)
  // At area scope: the area's own figure (areaSupply), not the block's.
  const supply = area !== undefined ? areaSupply(result?.areaRoutes, itemId, area, rule ?? {}, unsatisfied, split) : undefined

  const order = useMemo(
    () => sourcesLineOrder(makeHere, hasAreas, lastSide, suppliers.map(l => l.areaId)),
    [makeHere, hasAreas, lastSide, suppliers],
  )
  if (!block || !gameData || !enabled) return undefined
  const model = buildSourcesModel({ block, result, itemId, area, rule, makers, suppliers, supply, unsatisfied, rows, order })
  return {
    block, blocks, flows, gameData, itemId, name, unit, rate, solved: result !== undefined, area, rule, stored, makeHere, drawnSide, lastSide,
    sideKey: sideKey!, hasAreas, makers, suppliers, rows, supply, unsatisfied, order, model, importOn: !rule?.importOff,
  }
}

/** What the Sources list and the header's bar read, once the hook has it. */
export type SourcesView = NonNullable<ReturnType<typeof useSourcesModel>>
