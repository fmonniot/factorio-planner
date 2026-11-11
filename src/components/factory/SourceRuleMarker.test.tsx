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

  it('is an image without onOpen: nothing to press', () => {
    render(<SourceRuleMarker sentence={SENTENCE} />)
    expect(screen.getByRole('img', { name: SENTENCE })).toBe(screen.getByTestId('source-rule-marker'))
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('is a button with onOpen, larger than the dot, whose click stays off its parent', () => {
    const onOpen = vi.fn()
    const onParent = vi.fn()
    render(<div onClick={onParent}><SourceRuleMarker sentence={SENTENCE} onOpen={onOpen} /></div>)
    const marker = screen.getByRole('button', { name: SENTENCE })
    expect(marker).toBe(screen.getByTestId('source-rule-marker'))
    expect(marker).toHaveAttribute('type', 'button')
    expect(marker).toHaveClass('w-3.5', 'h-3.5')
    fireEvent.click(marker)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onParent).not.toHaveBeenCalled()
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

  it("opens the item's Ingredients slot on a click", () => {
    render(<ItemSourceRuleMarker itemId="plate" gameData={gameData} />)
    fireEvent.click(screen.getByRole('button'))
    expect(useUiStore.getState().ingredientSlotRequest).toMatchObject({ itemId: 'plate' })
  })

  it('only shows the rule with opens={false}', () => {
    render(<ItemSourceRuleMarker itemId="plate" gameData={gameData} opens={false} />)
    expect(screen.queryByRole('button')).toBeNull()
    fireEvent.click(screen.getByRole('img'))
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
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

  it('is a button only when it is given somewhere to lead, and never opens a slot by itself', () => {
    const { other } = twoBlocks()
    const onOpen = vi.fn()
    render(<BlockSourceRuleMarker block={other} itemId="plate" gameData={gameData} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
  })

  it('SummarySourceRuleMarker is the marker of the active block with the game data of the store', () => {
    const { other } = twoBlocks()
    useBlockStore.setState({ activeBlockId: other.id })
    useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
    const { unmount } = render(<SummarySourceRuleMarker itemId="plate" opens={false} />)
    expect(screen.getByRole('img')).toHaveAccessibleName(/^Made here by Smelt.* Import is off\.$/)
    unmount()
    render(<SummarySourceRuleMarker itemId="plate" />)
    fireEvent.click(screen.getByRole('button'))
    expect(useUiStore.getState().ingredientSlotRequest).toMatchObject({ itemId: 'plate' })
  })
})
