import { useMemo } from 'react'
import { useBlockStore } from '../../store/blockStore'
import { useSolverStore, selectBlockResults, selectFlows } from '../../store/solverStore'
import { useUiStore } from '../../store/uiStore'
import { Segment, Segmented } from '../SegmentedControl'
import { BlockPicker, type BlockPickerOption } from './BlockPicker'
import { ViewToolbar } from './ViewToolbar'
import { BlockAreaMatrix } from './BlockAreaMatrix'
import { AllBlocksMatrix } from './AllBlocksMatrix'
import { blockMatrix, machineItemIds, type MatrixArea } from './areaMatrix'
import { planMatrix } from './planAreaMatrix'
import type { GameData } from '../../data/types'
import { ALL, blocksWithAreas, type AreasUi } from './areasUi'
import { BlockSourceRuleMarker, SourceRuleMarker } from './SourceRuleMarker'
import { useAreaRuleItems, useSourceRuleItems } from './useSourceRuleItems'

// ---------------------------------------------------------------------------
// Areas as a balance matrix: items as rows, areas as columns, the outside at both ends. One block
// at a time, or every block side by side. Read-only: it jumps to an area's row in its block's table.
// The Areas view of the Factory overview modal (see BlockGraph.tsx), which keeps its state across a switch of view.
// ---------------------------------------------------------------------------

export function PlanAreasView({ ui, gameData, onClose }: { ui: AreasUi; gameData: GameData; onClose: () => void }) {
  const blocks = useBlockStore(s => s.blocks)
  const setActiveBlock = useBlockStore(s => s.setActiveBlock)
  const results = useSolverStore(selectBlockResults)
  const flows = useSolverStore(selectFlows)
  const rateUnit = useUiStore(s => s.rateUnit)
  const requestRevealRow = useUiStore(s => s.requestRevealRow)

  const withAreas = useMemo(() => blocksWithAreas(blocks, results), [blocks, results])
  const {
    tab, selectTab, rowMode, setRowMode, columnMode, setColumnMode, query, setQuery,
    focusedAreaId, setFocusedAreaId, showAllAreas, setShowAllAreas,
    groupOverrides, setGroupOverrides, closedTails, setClosedTails,
    crossingOnly, setCrossingOnly, expandedBlocks, toggleBlock, selectedKey, setSelectedKey,
  } = ui

  const machines = useMemo(() => machineItemIds(gameData), [gameData])
  const block = tab === ALL ? undefined : withAreas.find(b => b.id === tab)
  const matrix = useMemo(
    () => (block ? blockMatrix(block, results[block.id], gameData, machines) : undefined),
    [block, results, gameData, machines],
  )
  // The items of the shown block that carry the source rule marker on their row header.
  const ruleItems = useSourceRuleItems(block, gameData)
  // The areas of the shown block that have source rules of their own, and the items those rules are for.
  const areaRuleItemsOfBlock = useAreaRuleItems(block, gameData)
  const plan = useMemo(
    () => (tab === ALL ? planMatrix(blocks, results, flows, gameData, machines, { crossingOnly }) : undefined),
    [tab, blocks, results, flows, gameData, machines, crossingOnly],
  )

  function focusArea(id: string | null) {
    setFocusedAreaId(id)
    setShowAllAreas(false)
  }
  const toggleGroup = (id: string, open: boolean) => setGroupOverrides(m => new Map(m).set(id, open))
  const toggleTail = (id: string) => setClosedTails(s => {
    const next = new Set(s)
    if (!next.delete(id)) next.add(id)
    return next
  })

  // The block switch comes first: the reveal request is resolved against the active block's plan.
  function openArea(area: MatrixArea) {
    if (!block) return
    setActiveBlock(block.id)
    if (area.handleNodeId !== undefined) {
      requestRevealRow(area.handleNodeId)
    }
    onClose()
  }

  // The marker of a row of the shown block: it shows that block's rule for the item.
  function sourceRuleMarker(itemId: string) {
    if (!block || !ruleItems.has(itemId)) return null
    return <BlockSourceRuleMarker block={block} itemId={itemId} gameData={gameData} />
  }

  // The marker of an area's column: it names the items the area has its own rule for.
  function areaRuleMarker(areaId: string) {
    const items = areaRuleItemsOfBlock.get(areaId)
    if (!items || items.size === 0) return null
    const names = [...items].map(id => gameData.items[id]?.name ?? id).join(', ')
    return <SourceRuleMarker label={`Has its own source rule for ${names}`} />
  }

  const options: BlockPickerOption[] = withAreas.map(b => ({
    id: b.id,
    label: b.name,
    color: b.color,
    meta: `${results[b.id].areas!.length} ${results[b.id].areas!.length === 1 ? 'area' : 'areas'}`,
  }))
  const allOption: BlockPickerOption = { id: ALL, label: 'All blocks', meta: `${withAreas.length} ${withAreas.length === 1 ? 'block' : 'blocks'}` }

  return (
    <div data-testid="areas-view" className="flex-1 min-h-0 flex flex-col">
      <ViewToolbar testId="areas-toolbar">
        <BlockPicker label="Block" options={options} extra={allOption} value={tab} onChange={selectTab} />
        <Segmented label="Rows">
          <Segment pressed={rowMode === 'category'} onClick={() => setRowMode('category')}>By category</Segment>
          <Segment pressed={rowMode === 'rate'} onClick={() => setRowMode('rate')}>By rate</Segment>
          <Segment pressed={rowMode === 'name'} onClick={() => setRowMode('name')}>{'A\u2013Z'}</Segment>
        </Segmented>
        {tab !== ALL && (
          <Segmented label="Column order">
            <Segment pressed={columnMode === 'flow'} onClick={() => setColumnMode('flow')}>Flow order</Segment>
            <Segment pressed={columnMode === 'table'} onClick={() => setColumnMode('table')}>Table order</Segment>
          </Segmented>
        )}
        <input
          type="text"
          aria-label="Filter areas"
          placeholder="Filter by area, block or item"
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="flex-1 min-w-[10rem] h-7 box-border text-[13px] bg-gray-950 text-gray-100 border border-gray-700 rounded-md px-2.5 placeholder:text-gray-400"
        />
      </ViewToolbar>

      {matrix && (
        <BlockAreaMatrix
          matrix={matrix}
          gameData={gameData}
          rateUnit={rateUnit}
          rowMode={rowMode}
          columnMode={columnMode}
          query={query}
          focusedAreaId={focusedAreaId}
          onFocus={focusArea}
          showAllAreas={showAllAreas}
          onShowAll={setShowAllAreas}
          groupOverrides={groupOverrides}
          onToggleGroup={toggleGroup}
          closedTails={closedTails}
          onToggleTail={toggleTail}
          onOpenArea={openArea}
          sourceRuleMarker={sourceRuleMarker}
          areaRuleMarker={areaRuleMarker}
        />
      )}
      {plan && (
        <AllBlocksMatrix
          model={plan}
          gameData={gameData}
          rateUnit={rateUnit}
          rowMode={rowMode}
          query={query}
          crossingOnly={crossingOnly}
          onCrossingOnly={setCrossingOnly}
          expandedBlocks={expandedBlocks}
          onToggleBlock={toggleBlock}
          selectedKey={selectedKey}
          onSelectKey={id => setSelectedKey(cur => (cur === id ? null : id))}
          groupOverrides={groupOverrides}
          onToggleGroup={toggleGroup}
          closedTails={closedTails}
          onToggleTail={toggleTail}
        />
      )}
      {!matrix && !plan && <p className="p-4 text-sm text-gray-400">This block has no areas.</p>}

      <div className="px-3 py-2 border-t border-gray-700 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
        <span className="flex items-center gap-1.5"><i aria-hidden className="w-5 h-3 rounded-sm bg-sky-400/30 inline-block" />+ sends</span>
        <span className="flex items-center gap-1.5"><i aria-hidden className="w-5 h-3 rounded-sm bg-orange-400/30 inline-block" />{'\u2212'} receives</span>
        <span>Rates per {rateUnit === 'min' ? 'minute' : 'second'}.</span>
      </div>
    </div>
  )
}
