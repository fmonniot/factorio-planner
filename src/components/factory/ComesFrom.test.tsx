import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { ComesFrom } from './ComesFrom'
import { ComesFromPopover } from './ComesFromPopover'
import { useBlockStore, makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { AreaSourceRule, Block, GameData, SubPlan } from '../../data/types'

// Lines L and B (areas) each hold a Smelt row that makes Plate from Ore; a third plan, Group, is not an area.
function gameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {
      plate: { id: 'plate', name: 'Plate', type: 'item', iconPath: '', hidden: false },
      ore: { id: 'ore', name: 'Ore', type: 'item', iconPath: '', hidden: false },
    },
    recipes: {
      smelt: {
        id: 'smelt', name: 'Smelt', category: 'smelting', craftingTime: 1,
        ingredients: [{ itemId: 'ore', type: 'item', amount: 1 }],
        products: [{ itemId: 'plate', type: 'item', amount: 1 }],
        madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'plate',
      },
    },
    machines: {}, beacons: {}, modules: {}, defaultMachines: {}, technologies: {}, startingRecipes: [],
  } as unknown as GameData
}

const NOW = '2026-01-01T00:00:00.000Z'

const area = (id: string, rules?: Record<string, AreaSourceRule>): SubPlan => ({
  id, name: `Line ${id}`, nodes: [makeRecipeNode('smelt')], subPlans: [], area: true, createdAt: NOW, updatedAt: NOW,
  ...(rules ? { sourceRules: rules } : {}),
})

function setup(opts: { block?: Block['sourceRules']; L?: Record<string, AreaSourceRule>; B?: Record<string, AreaSourceRule>; areas?: boolean } = {}) {
  const main: Block = { ...makeEmptyBlock('Main'), id: 'main', sourceRules: opts.block ?? {} }
  main.rootPlan = { ...main.rootPlan, subPlans: opts.areas === false ? [] : [area('L', opts.L), area('B', opts.B)], nodes: opts.areas === false ? [makeRecipeNode('smelt')] : [] }
  useBlockStore.setState({ blocks: [main], activeBlockId: 'main', history: {} })
  useUiStore.setState({ rateUnit: 'min', comesFromPopover: null, connectionMenu: null, ingredientSlotRequest: null })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: gameData(), sourceId: 'test' } })
  useSolverStore.setState({ status: { type: 'idle' }, lastResult: undefined, lastResults: {}, flows: [], _setStatus: () => {} })
}

const mainBlock = () => useBlockStore.getState().blocks.find(b => b.id === 'main')!
const areaRules = (id: string) => mainBlock().rootPlan.subPlans.find(sp => sp.id === id)?.sourceRules
const preset = (name: string) => screen.getByRole('radio', { name })
const scope = (name: string) => within(screen.getByTestId('comes-from-scope')).getByRole('button', { name })

afterEach(() => vi.restoreAllMocks())

describe('ComesFrom, scope', () => {
  beforeEach(() => setup())

  it('has no scope control in a block without areas', () => {
    setup({ areas: false })
    render(<ComesFrom itemId="plate" />)
    expect(screen.queryByTestId('comes-from-scope')).not.toBeInTheDocument()
  })

  it('offers the whole block and the area it is opened for, on the whole block while the area has no rule', () => {
    render(<ComesFrom itemId="plate" areaId="L" />)
    expect(scope('Whole block')).toHaveAttribute('aria-pressed', 'true')
    expect(scope('Line L')).toHaveAttribute('aria-pressed', 'false')
    expect(within(screen.getByTestId('comes-from-scope')).queryByRole('button', { name: 'Line B' })).not.toBeInTheDocument()
    expect(screen.getByTestId('scope-hint')).toHaveTextContent('Every row of the block, unless an area has its own rule')
  })

  it('has no scope control without an area to offer, but the whole block', () => {
    render(<ComesFrom itemId="plate" />)
    expect(screen.queryByTestId('comes-from-scope')).not.toBeInTheDocument()
  })

  it('starts on the area when it has a rule for the item, and offers the other areas that have one', () => {
    setup({ L: { plate: { makeHere: 'off' } }, B: { plate: {} } })
    render(<ComesFrom itemId="plate" areaId="L" />)
    expect(scope('Line L')).toHaveAttribute('aria-pressed', 'true')
    expect(scope('Line B')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('scope-hint')).toHaveTextContent('Rows of Line L')
    expect(preset("Don't make more here")).toHaveAttribute('aria-checked', 'true')
  })

  it('moves between the scopes and shows the rule of each', () => {
    setup({ block: { plate: { makeHere: 'after-blocks' } }, L: { plate: { makeHere: 'off' } } })
    render(<ComesFrom itemId="plate" areaId="L" />)
    expect(preset("Don't make more here")).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(scope('Whole block'))
    expect(preset('Receive it first')).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByTestId('use-block-rule')).not.toBeInTheDocument()
  })
})

describe('ComesFrom, an area with no rule', () => {
  beforeEach(() => setup({ block: { plate: { makeHere: 'after-blocks' } } }))

  function openOnArea() {
    render(<ComesFrom itemId="plate" areaId="L" />)
    fireEvent.click(scope('Line L'))
  }

  it("follows the block's rule and shows it", () => {
    openOnArea()
    expect(screen.getByTestId('follows-block-rule')).toHaveTextContent("Follows the block's rule")
    expect(preset('Receive it first')).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByTestId('use-block-rule')).not.toBeInTheDocument()
  })

  it('writes a rule on that area only when a preset is chosen', () => {
    openOnArea()
    fireEvent.click(preset("Don't make more here"))
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'off' } })
    expect(areaRules('B')).toBeUndefined()
    expect(mainBlock().sourceRules).toEqual({ plate: { makeHere: 'after-blocks' } })
    expect(screen.queryByTestId('follows-block-rule')).not.toBeInTheDocument()
  })

  it('writes the block\'s rule as the start of the area rule when only Import is switched', () => {
    openOnArea()
    fireEvent.click(screen.getByTestId('import-switch'))
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'after-blocks', importOff: true } })
    expect(mainBlock().sourceRules).toEqual({ plate: { makeHere: 'after-blocks' } })
  })

  it('writes a keyless rule when Make it here is chosen over the block\'s rule', () => {
    openOnArea()
    fireEvent.click(preset('Make it here'))
    expect(areaRules('L')).toEqual({ plate: {} })
    expect(screen.getByTestId('use-block-rule')).toBeInTheDocument()
  })

  it("removes the area's rule with Use the block's rule", () => {
    openOnArea()
    fireEvent.click(preset("Don't make more here"))
    fireEvent.click(screen.getByTestId('use-block-rule'))
    expect(areaRules('L')).toBeUndefined()
    expect(screen.getByTestId('follows-block-rule')).toBeInTheDocument()
    expect(preset('Receive it first')).toHaveAttribute('aria-checked', 'true')
  })

  it('has no Sources… button and no list at area scope, and has the button at block scope', () => {
    render(<ComesFrom itemId="plate" areaId="L" />)
    expect(screen.getByTestId('sources-button')).toBeInTheDocument()
    fireEvent.click(scope('Line L'))
    expect(screen.queryByTestId('sources-button')).not.toBeInTheDocument()
  })

  it('writes the block rule again from the whole block scope', () => {
    render(<ComesFrom itemId="plate" areaId="L" />)
    fireEvent.click(preset("Don't make more here"))
    expect(mainBlock().sourceRules).toEqual({ plate: { makeHere: 'off' } })
    expect(areaRules('L')).toBeUndefined()
  })

  it('starts the sentence with the name of the area', () => {
    openOnArea()
    expect(screen.getByTestId('sourcing-sentence').textContent).toMatch(/^Line L: /)
    fireEvent.click(scope('Whole block'))
    expect(screen.getByTestId('sourcing-sentence').textContent).not.toMatch(/^Line L: /)
  })
})

describe('ComesFrom, the strip of an Ingredients slot', () => {
  it('has no scope control, and says how many areas have their own rule', () => {
    setup({ L: { plate: { makeHere: 'off' } }, B: { plate: {} } })
    render(<ComesFrom itemId="plate" listInPopover />)
    expect(screen.queryByTestId('comes-from-scope')).not.toBeInTheDocument()
    expect(screen.getByTestId('areas-have-rules')).toHaveTextContent('2 areas have their own rule')
  })

  it('says it for one area, and says nothing without one', () => {
    setup({ B: { plate: {} } })
    const { unmount } = render(<ComesFrom itemId="plate" listInPopover />)
    expect(screen.getByTestId('areas-have-rules')).toHaveTextContent('1 area has its own rule')
    unmount()
    setup()
    render(<ComesFrom itemId="plate" listInPopover />)
    expect(screen.queryByTestId('areas-have-rules')).not.toBeInTheDocument()
  })

  it('opens the popover on the first of them, in table order', () => {
    setup({ L: { plate: { makeHere: 'off' } }, B: { plate: {} } })
    render(<><ComesFrom itemId="plate" listInPopover /><ComesFromPopover hasSlot={() => true} /></>)
    fireEvent.click(screen.getByTestId('areas-have-rules'))
    expect(useUiStore.getState().comesFromPopover).toMatchObject({ itemId: 'plate', areaId: 'L' })
    const popover = screen.getByTestId('comes-from-popover')
    expect(popover).toHaveTextContent('For the whole block or for one area')
    expect(within(within(popover).getByTestId('comes-from-scope')).getByRole('button', { name: 'Line L' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says nothing about areas for an item whose areas have no rule of their own', () => {
    setup({ L: { ore: {} } })
    render(<ComesFrom itemId="plate" listInPopover />)
    expect(screen.queryByTestId('areas-have-rules')).not.toBeInTheDocument()
  })
})

describe('ComesFrom, the area flag', () => {
  it('falls back to the whole block when the flag goes off, and can show the area again after an undo', () => {
    setup({ L: { plate: { makeHere: 'off' } } })
    render(<ComesFrom itemId="plate" areaId="L" />)
    expect(scope('Line L')).toHaveAttribute('aria-pressed', 'true')
    act(() => useBlockStore.getState().setSubPlanArea('L', false))
    // The rule went with the flag (D3); no area is left to offer, so no scope control either.
    expect(screen.queryByTestId('comes-from-scope')).not.toBeInTheDocument()
    expect(mainBlock().rootPlan.subPlans.find(sp => sp.id === 'L')?.sourceRules).toBeUndefined()
    expect(preset('Make it here')).toHaveAttribute('aria-checked', 'true')
    act(() => useBlockStore.getState().undo())
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'off' } })
    expect(scope('Line L')).toBeInTheDocument()
  })
})
