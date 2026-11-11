import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockSourceRuleMarker, ItemSourceRuleMarker, SourceRuleMarker, SummarySourceRuleMarker } from './SourceRuleMarker'
import { useBlockStore, makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import type { GameData } from '../../data/types'

const SENTENCE = 'Uses what this block already makes first (Smelt 30/m). The rest is imported.'

describe('SourceRuleMarker', () => {
  it('is a 6px grey dot with the sentence as its tooltip and accessible name, and no letter', () => {
    render(<SourceRuleMarker sentence={SENTENCE} itemId="plate" />)
    const marker = screen.getByTestId('source-rule-marker')
    expect(marker).toHaveAccessibleName(SENTENCE)
    expect(marker).toHaveAttribute('title', SENTENCE)
    expect(marker).toHaveAttribute('data-item-id', 'plate')
    expect(marker).toHaveTextContent('')
    expect(marker).not.toHaveAttribute('data-sourcing')
    const dot = marker.firstElementChild!
    expect(dot).toHaveClass('w-1.5', 'h-1.5', 'rounded-full', 'bg-gray-400')
    expect(marker.className + dot.className).not.toContain('amber')
  })

  it('is an image, larger than the dot, with nothing to press', () => {
    render(<SourceRuleMarker sentence={SENTENCE} />)
    const marker = screen.getByRole('img', { name: SENTENCE })
    expect(marker).toBe(screen.getByTestId('source-rule-marker'))
    expect(marker).toHaveClass('w-3.5', 'h-3.5')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('does nothing of its own on a click: the click is a click on what it sits on', () => {
    const onParent = vi.fn()
    render(<div onClick={onParent}><SourceRuleMarker sentence={SENTENCE} /></div>)
    fireEvent.click(screen.getByRole('img'))
    expect(onParent).toHaveBeenCalledTimes(1)
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
    expect(useUiStore.getState().comesFromPopover).toBeNull()
  })

  it('still has a name without a sentence', () => {
    render(<SourceRuleMarker sentence="" />)
    expect(screen.getByTestId('source-rule-marker')).toHaveAccessibleName('Has a source rule')
  })
})

describe('ItemSourceRuleMarker', () => {
  const gameData = {
    items: { plate: { id: 'plate', name: 'Plate' }, ore: { id: 'ore', name: 'Ore' } },
    recipes: {
      smelt: {
        id: 'smelt', name: 'Smelt', category: 'smelting', craftingTime: 1,
        ingredients: [{ itemId: 'ore', type: 'item', amount: 1 }],
        products: [{ itemId: 'plate', type: 'item', amount: 1 }],
      },
    },
    machines: {},
    defaultMachines: {},
  } as unknown as GameData

  beforeEach(() => {
    const block = makeEmptyBlock('Test')
    block.rootPlan.nodes = [makeRecipeNode('smelt')]
    block.noImportItems = ['plate']
    useBlockStore.setState({ blocks: [block], activeBlockId: block.id, history: {} })
    useUiStore.setState({ ingredientSlotRequest: null })
  })

  it("reads the active block's sentence for the item", () => {
    render(<ItemSourceRuleMarker itemId="plate" gameData={gameData} />)
    const marker = screen.getByTestId('source-rule-marker')
    expect(marker).toHaveAccessibleName(/^Made here by Smelt.* Import is off\.$/)
    expect(marker).toHaveAttribute('title', marker.getAttribute('aria-label')!)
    expect(marker).toHaveAttribute('data-item-id', 'plate')
  })

  it('only shows the rule: no button, and a click opens nothing', () => {
    render(<ItemSourceRuleMarker itemId="plate" gameData={gameData} />)
    expect(screen.queryByRole('button')).toBeNull()
    fireEvent.click(screen.getByRole('img'))
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
    expect(useUiStore.getState().comesFromPopover).toBeNull()
  })
})

describe('BlockSourceRuleMarker and SummarySourceRuleMarker', () => {
  const gameData = {
    items: { plate: { id: 'plate', name: 'Plate' }, ore: { id: 'ore', name: 'Ore' } },
    recipes: {
      smelt: {
        id: 'smelt', name: 'Smelt', category: 'smelting', craftingTime: 1,
        ingredients: [{ itemId: 'ore', type: 'item', amount: 1 }],
        products: [{ itemId: 'plate', type: 'item', amount: 1 }],
      },
    },
    machines: {},
    defaultMachines: {},
  } as unknown as GameData

  /** Two blocks: the active one has no rule, the other makes plate with Import off. */
  function twoBlocks() {
    const active = makeEmptyBlock('Active')
    const other = makeEmptyBlock('Other')
    other.rootPlan.nodes = [makeRecipeNode('smelt')]
    other.noImportItems = ['plate']
    useBlockStore.setState({ blocks: [active, other], activeBlockId: active.id, history: {} })
    useUiStore.setState({ ingredientSlotRequest: null })
    return { active, other }
  }

  it('reads the sentence of the item in the block it is given, not in the active one', () => {
    const { active, other } = twoBlocks()
    const { unmount } = render(<BlockSourceRuleMarker block={other} itemId="plate" gameData={gameData} />)
    expect(screen.getByRole('img')).toHaveAccessibleName(/^Made here by Smelt.* Import is off\.$/)
    unmount()
    render(<BlockSourceRuleMarker block={active} itemId="plate" gameData={gameData} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('No row here makes Plate; it is imported.')
  })

  it('never opens a slot or a popover by itself', () => {
    const { other } = twoBlocks()
    render(<BlockSourceRuleMarker block={other} itemId="plate" gameData={gameData} />)
    expect(screen.queryByRole('button')).toBeNull()
    fireEvent.click(screen.getByRole('img'))
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
    expect(useUiStore.getState().comesFromPopover).toBeNull()
  })

  it('SummarySourceRuleMarker is the marker of the active block with the game data of the store', () => {
    const { other } = twoBlocks()
    useBlockStore.setState({ activeBlockId: other.id })
    useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
    render(<SummarySourceRuleMarker itemId="plate" />)
    expect(screen.getByRole('img')).toHaveAccessibleName(/^Made here by Smelt.* Import is off\.$/)
  })
})
