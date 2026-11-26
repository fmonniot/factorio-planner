import { useState } from 'react'
import type { Block, SolverResult } from '../../data/types'
import type { ColumnMode, RowMode } from './areaMatrix'

// The Areas view's state and the choices it opens with (the view itself is PlanAreas.tsx).

export const ALL = 'all'

/** The blocks whose last solve has areas, in plan order. */
export function blocksWithAreas(blocks: Block[], results: Record<string, SolverResult | undefined>): Block[] {
  return blocks.filter(b => results[b.id]?.areas !== undefined)
}

/** The block the view opens on: the active block when it has areas, else the first block that has some, else All blocks. */
export function defaultAreasTab(withAreas: Block[], activeBlockId: string): string {
  if (withAreas.some(b => b.id === activeBlockId)) return activeBlockId
  return withAreas[0]?.id ?? ALL
}

/**
 * The Areas view's own state: the chosen block (or All blocks), the row and column modes, the filter, the focus and the open
 * groups. The modal holds it, so it survives a switch to another view; closing the modal resets it.
 *
 * Until a block is chosen the view follows `defaultTab` (the block it opens on, which can change while the modal is open, e.g.
 * before the first solve has areas), and in All blocks the active block starts expanded.
 */
export function useAreasUi(defaultTab: string, activeBlockId: string) {
  const [chosenTab, setChosenTab] = useState<string | null>(null)
  const [rowMode, setRowMode] = useState<RowMode>('category')
  const [columnMode, setColumnMode] = useState<ColumnMode>('flow')
  const [query, setQuery] = useState('')
  const [focusedAreaId, setFocusedAreaId] = useState<string | null>(null)
  const [showAllAreas, setShowAllAreas] = useState(false)
  const [groupOverrides, setGroupOverrides] = useState<Map<string, boolean>>(() => new Map())
  const [closedTails, setClosedTails] = useState<Set<string>>(() => new Set())
  const [crossingOnly, setCrossingOnly] = useState(true)
  const [openedBlocks, setOpenedBlocks] = useState<Set<string> | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const tab = chosenTab ?? defaultTab
  const expandedBlocks = openedBlocks ?? new Set([activeBlockId])

  function selectTab(next: string) {
    setChosenTab(next)
    setFocusedAreaId(null)
    setShowAllAreas(false)
    setSelectedKey(null)
    setGroupOverrides(new Map())
    setClosedTails(new Set())
  }
  function toggleBlock(id: string) {
    const next = new Set(expandedBlocks)
    if (!next.delete(id)) next.add(id)
    setOpenedBlocks(next)
  }
  return {
    tab, selectTab, rowMode, setRowMode, columnMode, setColumnMode, query, setQuery,
    focusedAreaId, setFocusedAreaId, showAllAreas, setShowAllAreas,
    groupOverrides, setGroupOverrides, closedTails, setClosedTails,
    crossingOnly, setCrossingOnly, expandedBlocks, toggleBlock, selectedKey, setSelectedKey,
  }
}

export type AreasUi = ReturnType<typeof useAreasUi>
