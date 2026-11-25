import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BlockSourceRuleMarker, ItemSourceRuleMarker, SourceRuleMarker, SummarySourceRuleMarker } from './SourceRuleMarker'
import { useBlockSourcesModel } from './useSourcesModel'
import { useBlockStore, makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { Block, GameData, SolverResult, SubPlan } from '../../data/types'

vi.mock('./useSourcesModel', async importOriginal => {
  const actual = await importOriginal<typeof import('./useSourcesModel')>()
  return { ...actual, useBlockSourcesModel: vi.fn(actual.useBlockSourcesModel) }
})

const NAME = "Don't make more here"

describe('SourceRuleMarker', () => {
  it('is a 6px grey dot with the rule name as its tooltip and accessible name, and no letter', () => {
    render(<SourceRuleMarker label={NAME} itemId="plate" />)
    const marker = screen.getByTestId('source-rule-marker')
    expect(marker).toHaveAccessibleName(NAME)
    expect(marker).toHaveAttribute('aria-label', NAME)
    expect(marker).toHaveAttribute('data-tip', '')
    expect(marker).not.toHaveAttribute('title')
    expect(marker).toHaveAttribute('data-item-id', 'plate')
    expect(marker).toHaveTextContent('')
    expect(marker).not.toHaveAttribute('data-sourcing')
    const dot = marker.firstElementChild!
    expect(dot).toHaveClass('w-1.5', 'h-1.5', 'rounded-full', 'bg-gray-400')
    expect(marker.className + dot.className).not.toContain('amber')
  })

  it('is an image, larger than the dot, with nothing to press', () => {
    render(<SourceRuleMarker label={NAME} />)
    const marker = screen.getByRole('img', { name: NAME })
    expect(marker).toBe(screen.getByTestId('source-rule-marker'))
    expect(marker).toHaveClass('w-3.5', 'h-3.5')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('adds the reading on a second line', () => {
    render(<SourceRuleMarker label={NAME} reading={'Already made here: 30/m\nImported: 5/m'} />)
    expect(screen.getByTestId('source-rule-marker')).toHaveAttribute('aria-label', `${NAME}\nAlready made here: 30/m\nImported: 5/m`)
  })

  it('does nothing of its own on a click: the click is a click on what it sits on', () => {
    const onParent = vi.fn()
    render(<div onClick={onParent}><SourceRuleMarker label={NAME} /></div>)
    fireEvent.click(screen.getByRole('img'))
    expect(onParent).toHaveBeenCalledTimes(1)
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
    expect(useUiStore.getState().comesFromPopover).toBeNull()
  })

  it('still has a name without a label', () => {
    render(<SourceRuleMarker label="" />)
    expect(screen.getByTestId('source-rule-marker')).toHaveAccessibleName('Has a source rule')
  })

  it('tells its parent when the pointer is over it, and holds the reader the parent mounts inside', () => {
    const onArm = vi.fn()
    render(<SourceRuleMarker label={NAME} onArm={onArm}><i data-testid="reader" /></SourceRuleMarker>)
    expect(screen.getByTestId('source-rule-marker')).toContainElement(screen.getByTestId('reader'))
    expect(onArm).not.toHaveBeenCalled()
    fireEvent.pointerOver(screen.getByTestId('source-rule-marker'))
    expect(onArm).toHaveBeenCalled()
  })
})

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

const spy = vi.mocked(useBlockSourcesModel)

describe('ItemSourceRuleMarker', () => {
  let block: Block
  beforeEach(() => {
    block = makeEmptyBlock('Test')
    block.rootPlan.nodes = [makeRecipeNode('smelt')]
    block.sourceRules = { plate: { importOff: true } }
    useBlockStore.setState({ blocks: [block], activeBlockId: block.id, history: {} })
    useUiStore.setState({ ingredientSlotRequest: null, comesFromPopover: null })
    useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
    useSolverStore.setState({ lastResults: {}, flows: [] })
    spy.mockClear()
  })

  it("is named by the active block's rule, and reads no model until the pointer is over it", () => {
    render(<ItemSourceRuleMarker itemId="plate" gameData={gameData} />)
    const marker = screen.getByTestId('source-rule-marker')
    expect(marker).toHaveAccessibleName('Import off')
    expect(marker).toHaveAttribute('data-tip', '')
    expect(marker).not.toHaveAttribute('title')
    expect(marker).toHaveAttribute('data-item-id', 'plate')
    expect(spy).not.toHaveBeenCalled()
  })

  it('reads the model once the pointer is over it: not solved yet', () => {
    render(<ItemSourceRuleMarker itemId="plate" gameData={gameData} />)
    const marker = screen.getByTestId('source-rule-marker')
    fireEvent.pointerOver(marker)
    expect(spy).toHaveBeenCalled()
    expect(marker.getAttribute('aria-label')).toBe('Import off\nNot solved yet.')
  })

  it('reads one line per source from a solve', () => {
    const node = block.rootPlan.nodes[0]
    useSolverStore.setState({
      lastResults: { [block.id]: { nodes: [{ recipeNodeId: node.id, inputRates: { plate: 30 }, outputRates: { plate: 30 }, machineCountCeil: 1, machineCountExact: 1 }], unsatisfied: [], warnings: [] } as unknown as SolverResult },
    })
    render(<ItemSourceRuleMarker itemId="plate" gameData={gameData} />)
    const marker = screen.getByTestId('source-rule-marker')
    fireEvent.pointerOver(marker)
    expect(marker.getAttribute('aria-label')).toBe('Import off\nMade by more rows here: 30.0/m')
  })

  it('names the rule of the row\'s area when the area has its own', () => {
    const area: SubPlan = { id: 'L', name: 'Line L', nodes: [makeRecipeNode('smelt')], subPlans: [], area: true, createdAt: '', updatedAt: '', sourceRules: { plate: { makeHere: 'off' } } }
    const withArea = { ...block, rootPlan: { ...block.rootPlan, nodes: [], subPlans: [area] }, sourceRules: {} }
    useBlockStore.setState({ blocks: [withArea], activeBlockId: withArea.id })
    render(<ItemSourceRuleMarker itemId="plate" gameData={gameData} areaId="L" />)
    expect(screen.getByTestId('source-rule-marker')).toHaveAccessibleName(`Line L: ${NAME}`)
  })

  it('names every part of the rule, in order', () => {
    useBlockStore.setState({ blocks: [{ ...block, sourceRules: { plate: { makeHere: 'off', importOff: true } } }] })
    render(<ItemSourceRuleMarker itemId="plate" gameData={gameData} />)
    expect(screen.getByTestId('source-rule-marker')).toHaveAccessibleName(`${NAME}, Import off`)
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
  /** Two blocks: the active one has no rule, the other makes plate with Import off. */
  function twoBlocks() {
    const active = makeEmptyBlock('Active')
    const other = makeEmptyBlock('Other')
    other.rootPlan.nodes = [makeRecipeNode('smelt')]
    other.sourceRules = { plate: { importOff: true } }
    useBlockStore.setState({ blocks: [active, other], activeBlockId: active.id, history: {} })
    useUiStore.setState({ ingredientSlotRequest: null, comesFromPopover: null })
    useSolverStore.setState({ lastResults: {}, flows: [] })
    return { active, other }
  }

  it('is named by the rule of the item in the block it is given, not in the active one', () => {
    const { active, other } = twoBlocks()
    const { unmount } = render(<BlockSourceRuleMarker block={other} itemId="plate" gameData={gameData} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Import off')
    unmount()
    render(<BlockSourceRuleMarker block={active} itemId="plate" gameData={gameData} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Has a source rule')
  })

  it('reads the model of the given block once hovered', () => {
    const { other } = twoBlocks()
    render(<BlockSourceRuleMarker block={other} itemId="plate" gameData={gameData} />)
    fireEvent.pointerOver(screen.getByRole('img'))
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Import off\nNot solved yet.')
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
    expect(screen.getByRole('img')).toHaveAccessibleName('Import off')
  })
})
