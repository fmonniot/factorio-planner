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
/** The preset the rule chip of the list reads ('own' is Make it here). */
const chipPreset = () => screen.getByTestId('sources-rule-chip').getAttribute('data-preset')
const makeHereLine = () => screen.getAllByTestId('sources-line').find(l => l.getAttribute('data-line') === 'make-here')!
/** Receive it first, Make it here: Make more here below the block lines, or above them, through its detail. */
const makeAfter = () => { fireEvent.click(within(makeHereLine()).getByTestId('sources-line-toggle')); fireEvent.click(screen.getByTestId('sources-make-after')) }
const makeBefore = () => { fireEvent.click(within(makeHereLine()).getByTestId('sources-line-toggle')); fireEvent.click(screen.getByTestId('sources-make-before')) }
/** Don't make more here: the switch of the Make more here line. */
const makeOff = () => fireEvent.click(screen.getByTestId('sources-make-here-switch'))
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
    expect(screen.getByTestId('comes-from-scope')).toHaveAttribute('data-tip', 'Every row of the block, unless an area has its own rule')
    expect(screen.queryByTestId('scope-hint')).not.toBeInTheDocument()
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
    expect(screen.getByTestId('comes-from-scope')).toHaveAttribute('data-tip', 'Rows of Line L')
    expect(chipPreset()).toBe('byproducts-first')
  })

  it('moves between the scopes and shows the rule of each', () => {
    setup({ block: { plate: { makeHere: 'after-blocks' } }, L: { plate: { makeHere: 'off' } } })
    render(<ComesFrom itemId="plate" areaId="L" />)
    expect(chipPreset()).toBe('byproducts-first')
    fireEvent.click(scope('Whole block'))
    expect(chipPreset()).toBe('connections-first')
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
    expect(screen.getByTestId('sources-rule-chip')).toHaveAttribute('data-owner', 'follows')
    expect(chipPreset()).toBe('connections-first')
    expect(screen.queryByTestId('use-block-rule')).not.toBeInTheDocument()
  })

  it('writes a rule on that area only when the list changes the rule', () => {
    openOnArea()
    makeOff()
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'off' } })
    expect(areaRules('B')).toBeUndefined()
    expect(mainBlock().sourceRules).toEqual({ plate: { makeHere: 'after-blocks' } })
    expect(screen.getByTestId('sources-rule-chip')).toHaveAttribute('data-owner', 'own')
  })

  it('writes the block\'s rule as the start of the area rule when only Import is switched', () => {
    openOnArea()
    fireEvent.click(screen.getByTestId('sources-import-switch'))
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'after-blocks', importOff: true } })
    expect(mainBlock().sourceRules).toEqual({ plate: { makeHere: 'after-blocks' } })
  })

  it('writes a keyless rule when Make it here is chosen over the block\'s rule', () => {
    openOnArea()
    makeBefore()
    expect(areaRules('L')).toEqual({ plate: {} })
    expect(screen.getByTestId('use-block-rule')).toBeInTheDocument()
  })

  it("removes the area's rule with Use the block's", () => {
    openOnArea()
    makeOff()
    fireEvent.click(screen.getByTestId('use-block-rule'))
    expect(areaRules('L')).toBeUndefined()
    expect(screen.getByTestId('sources-rule-chip')).toHaveAttribute('data-owner', 'follows')
    expect(chipPreset()).toBe('connections-first')
  })

  it('draws the list of the area at area scope, and the list of the block when the scope changes back', () => {
    render(<ComesFrom itemId="plate" areaId="L" />)
    fireEvent.click(scope('Line L'))
    const list = screen.getByTestId('sources-list')
    expect(within(list).getAllByTestId('sources-line').map(l => l.getAttribute('data-line'))).toContain('other-area')
    expect(list.querySelector('[data-line="other-area"]')).toHaveAttribute('data-area-id', 'B')
    fireEvent.click(scope('Whole block'))
    expect(within(screen.getByTestId('sources-list')).queryByTestId('sources-area-switch')).not.toBeInTheDocument()
  })

  it('writes the area rule from a switch', () => {
    openOnArea()
    expect(screen.getByTestId('sources-rule-chip')).toHaveAttribute('data-owner', 'follows')
    fireEvent.click(screen.getByTestId('sources-area-switch'))
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'after-blocks', areasOff: ['B'] } })
    expect(mainBlock().sourceRules).toEqual({ plate: { makeHere: 'after-blocks' } })
    expect(screen.getByTestId('sources-rule-chip')).toHaveAttribute('data-owner', 'own')
    fireEvent.click(screen.getByTestId('use-block-rule'))
    expect(areaRules('L')).toBeUndefined()
    expect(screen.getByTestId('sources-rule-chip')).toHaveAttribute('data-owner', 'follows')
  })

  it('writes the block rule again from the whole block scope', () => {
    render(<ComesFrom itemId="plate" areaId="L" />)
    makeOff()
    expect(mainBlock().sourceRules).toEqual({ plate: { makeHere: 'off' } })
    expect(areaRules('L')).toBeUndefined()
  })
})

describe('ComesFrom, in the Comes from popover', () => {
  it('draws the header, the bar, the list and the Leftover row: no sentence, no icon toolbar, no Sources toggle', () => {
    setup()
    render(<ComesFrom itemId="plate" />)
    const root = screen.getByTestId('comes-from')
    expect(root.children[0]).toBe(screen.getByTestId('comes-from-header'))
    expect(root.children[1]).toBe(screen.getByTestId('comes-from-bar'))
    expect(within(root).getByTestId('sources-list')).toBeInTheDocument()
    expect(root.lastElementChild).toBe(screen.getByTestId('leftover-row'))
    expect(screen.queryByTestId('strip-toolbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByTestId('sources-button')).not.toBeInTheDocument()
  })

  it('shows the scope control in the header, above the list, and the area rule writes through the list', () => {
    setup({ L: { plate: {} } })
    render(<ComesFrom itemId="plate" areaId="L" />)
    expect(within(screen.getByTestId('comes-from-header')).getByTestId('comes-from-scope')).toBe(screen.getByTestId('comes-from-scope'))
    expect(screen.getByTestId('comes-from-scope').compareDocumentPosition(screen.getByTestId('sources-list')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    makeOff()
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'off' } })
    fireEvent.click(screen.getByTestId('sources-import-switch'))
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'off', importOff: true } })
    expect(mainBlock().sourceRules).toEqual({})
  })
})

describe('ComesFrom, the strip of an Ingredients slot', () => {
  it('has no scope control, and says how many areas have their own rule', () => {
    setup({ L: { plate: { makeHere: 'off' } }, B: { plate: {} } })
    render(<ComesFrom itemId="plate" listInPopover />)
    expect(screen.queryByTestId('comes-from-scope')).not.toBeInTheDocument()
    expect(screen.getByTestId('areas-have-rules')).toHaveTextContent('2 areas have their own rule')
  })

  it('draws one toolbar first: the given actions, then Sources…, with no sentence and no rule group', () => {
    setup()
    render(<ComesFrom itemId="plate" listInPopover actions={[{ label: 'Find recipe', icon: 'find', side: 'left', onSelect: () => {} }]} />)
    const root = screen.getByTestId('comes-from')
    expect(root.firstElementChild).toBe(screen.getByTestId('strip-toolbar'))
    expect(screen.queryByTestId('strip-rule-icons')).not.toBeInTheDocument()
    const toolbar = within(root).getByTestId('strip-toolbar')
    expect([...toolbar.querySelectorAll('button')].map(b => b.getAttribute('aria-label')))
      .toEqual(['Find recipe', 'Sources…'])
    expect(within(root).queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(within(root).queryByRole('switch')).not.toBeInTheDocument()
    expect(within(toolbar).getByTestId('sources-button')).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.queryByText('Comes from', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('draws the icons of a rule that is not the default at the end of the toolbar, named by the rule', () => {
    setup({ block: { plate: { makeHere: 'after-blocks', importOff: true } } })
    render(<ComesFrom itemId="plate" listInPopover />)
    const toolbar = screen.getByTestId('strip-toolbar')
    const icons = within(toolbar).getAllByTestId('strip-rule-icon')
    expect(icons.map(i => i.getAttribute('data-rule'))).toEqual(['connections-first', 'import-off'])
    expect(icons.map(i => i.getAttribute('aria-label'))).toEqual(['Receive it first', 'Import off'])
    expect(icons.map(i => i.getAttribute('data-tip'))).toEqual(['Receive it first', 'Import off'])
    expect(toolbar.lastElementChild).toBe(screen.getByTestId('strip-rule-icons'))
  })

  it('draws no icon for a rule that is only Leftover off', () => {
    setup({ block: { plate: { leftoverOff: true } } })
    render(<ComesFrom itemId="plate" listInPopover />)
    expect(screen.queryByTestId('strip-rule-icon')).not.toBeInTheDocument()
  })

  it('opens the popover from Sources…, which has the list', () => {
    setup()
    render(<><ComesFrom itemId="plate" listInPopover /><ComesFromPopover hasSlot={() => true} /></>)
    fireEvent.click(screen.getByTestId('sources-button'))
    expect(useUiStore.getState().comesFromPopover).toMatchObject({ itemId: 'plate' })
    expect(within(screen.getByTestId('comes-from-popover')).getByTestId('sources-list')).toBeInTheDocument()
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
    expect(within(popover).getByTestId('comes-from-scope')).toHaveAttribute('data-tip', 'Rows of Line L')
    expect(within(within(popover).getByTestId('comes-from-scope')).getByRole('button', { name: 'Line L' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says nothing about areas for an item whose areas have no rule of their own', () => {
    setup({ L: { ore: {} } })
    render(<ComesFrom itemId="plate" listInPopover />)
    expect(screen.queryByTestId('areas-have-rules')).not.toBeInTheDocument()
  })
})

describe('ComesFrom, the one view', () => {
  it('is the list, with no toggle: the sentence, the toolbar and the presets are the strip\'s', () => {
    setup()
    render(<ComesFrom itemId="plate" areaId="L" />)
    expect(screen.getByTestId('sources-list')).toBeInTheDocument()
    expect(screen.queryByTestId('sources-button')).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByTestId('strip-toolbar')).not.toBeInTheDocument()
    expect(screen.getByTestId('comes-from-bar')).toBeInTheDocument()
  })

  it('keeps the takers and no-effect notes in the list view', () => {
    setup({ areas: false, block: { plate: { leftoverOff: true }, ore: { importOff: true } } })
    const taker: Block = { ...makeEmptyBlock('Cooler'), id: 'cooler', inputConnections: [{ id: 'c1', itemId: 'plate', fromBlockId: 'main' }] }
    useBlockStore.setState(s => ({ blocks: [...s.blocks, taker] }))
    render(<ComesFrom itemId="plate" />)
    expect(screen.getByTestId('leftover-takers')).toBeInTheDocument()
    expect(screen.getByTestId('sources-list')).toBeInTheDocument()
  })

  it('has no need in the header before the first solve', () => {
    setup({ areas: false })
    render(<ComesFrom itemId="plate" />)
    expect(screen.queryByTestId('comes-from-need')).not.toBeInTheDocument()
  })

  it('says "Every row of this block" when no area is offered, and has no heading without one', () => {
    setup({ areas: false })
    render(<ComesFrom itemId="plate" />)
    expect(screen.getByTestId('comes-from-header')).toHaveTextContent('Every row of this block')
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })
})

describe('ComesFrom, the rule chip and the Leftover row of the list view', () => {
  it('reads the block\'s rule as the chip, with Import off', () => {
    setup({ areas: false, block: { plate: { makeHere: 'after-blocks', importOff: true } } })
    render(<ComesFrom itemId="plate" />)
    const chip = screen.getByTestId('sources-rule-chip')
    expect(chip).toHaveTextContent('Receive it first · Import off')
    expect(chip).toHaveAttribute('data-preset', 'connections-first')
    expect(chip).toHaveAttribute('data-owner', 'block')
    expect(chip).toHaveAttribute('data-tip', expect.stringContaining('Move Make more here'))
  })

  it('prefixes the chip at area scope, and Use the block\'s clears the area rule', () => {
    setup({ block: { plate: { makeHere: 'after-blocks' } } })
    render(<ComesFrom itemId="plate" areaId="L" />)
    fireEvent.click(scope('Line L'))
    expect(screen.getByTestId('sources-rule-chip')).toHaveTextContent("Block's rule · Receive it first")
    expect(screen.queryByTestId('use-block-rule')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'off' } })
    expect(screen.getByTestId('sources-rule-chip')).toHaveTextContent("Own rule · Don't make more here")
    expect(screen.getByTestId('sources-rule-chip')).toHaveAttribute('data-owner', 'own')
    const clear = screen.getByTestId('use-block-rule')
    expect(clear).toHaveTextContent("Use the block's")
    expect(clear).toHaveAccessibleName("Use the block's rule")
    fireEvent.click(clear)
    expect(areaRules('L')).toBeUndefined()
    expect(screen.getByTestId('sources-rule-chip')).toHaveAttribute('data-owner', 'follows')
  })

  it('offers each area with its own rule at block scope, and a click switches to it', () => {
    setup({ L: { plate: { makeHere: 'off' } }, B: { plate: {} } })
    render(<ComesFrom itemId="plate" />)
    const links = screen.getAllByTestId('area-own-rule')
    expect(links.map(l => l.textContent)).toEqual(['Line L has its own', 'Line B has its own'])
    expect(links.map(l => l.getAttribute('data-area-id'))).toEqual(['L', 'B'])
    fireEvent.click(links[1])
    expect(scope('Line B')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('area-own-rule')).not.toBeInTheDocument()
  })

  it('has no such link when no area has a rule', () => {
    setup()
    render(<ComesFrom itemId="plate" />)
    expect(screen.queryByTestId('area-own-rule')).not.toBeInTheDocument()
  })

  it('has the Leftover row at the foot, with the block\'s switch', () => {
    setup({ areas: false })
    render(<ComesFrom itemId="plate" />)
    const row = screen.getByTestId('leftover-row')
    expect(row).toHaveTextContent("Leftover")
    expect(row).toHaveTextContent("what the rows don't use stays spare")
    const sw = within(row).getByTestId('leftover-switch')
    expect(sw).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(sw)
    expect(mainBlock().sourceRules).toEqual({ plate: { leftoverOff: true } })
    expect(row).toHaveTextContent('the rows use all they can')
  })

  it('is read-only at area scope, shows the block\'s value, and "change" switches to the whole block', () => {
    setup({ block: { plate: { leftoverOff: true } }, L: { plate: {} } })
    render(<ComesFrom itemId="plate" areaId="L" />)
    const sw = screen.getByTestId('leftover-switch')
    expect(sw).toHaveAttribute('aria-disabled', 'true')
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    expect(mainBlock().sourceRules).toEqual({ plate: { leftoverOff: true } })
    const row = screen.getByTestId('leftover-row')
    expect(row).toHaveTextContent('whole block only')
    const change = within(row).getByTestId('leftover-whole-block')
    expect(change).toHaveTextContent('change')
    expect(change).toHaveAccessibleName('Whole block: change Leftover')
    fireEvent.click(change)
    expect(scope('Whole block')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('leftover-switch')).not.toHaveAttribute('aria-disabled')
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
    expect(chipPreset()).toBe('own')
    act(() => useBlockStore.getState().undo())
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'off' } })
    expect(scope('Line L')).toBeInTheDocument()
  })
})

describe('ComesFrom, the Leftover switch', () => {
  const leftover = () => screen.getByTestId('leftover-switch')
  /** A block `Cooler` that takes Plate from Main (a take: Plate is not a product of Main). */
  const addTaker = (name = 'Cooler') => {
    const taker: Block = { ...makeEmptyBlock(name), id: 'cooler', inputConnections: [{ id: 'c1', itemId: 'plate', fromBlockId: 'main' }] }
    useBlockStore.setState(s => ({ blocks: [...s.blocks, taker] }))
  }

  it('is on by default, under the lines, and turns off and on with the block\'s rule (undoable)', () => {
    setup({ areas: false })
    render(<ComesFrom itemId="plate" />)
    expect(leftover()).toHaveAttribute('role', 'switch')
    expect(leftover()).toHaveAccessibleName('Leftover')
    expect(leftover()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('sources-import-switch').compareDocumentPosition(leftover()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(leftover())
    expect(leftover()).toHaveAttribute('aria-checked', 'false')
    expect(mainBlock().sourceRules).toEqual({ plate: { leftoverOff: true } })
    act(() => useBlockStore.getState().undo())
    expect(leftover()).toHaveAttribute('aria-checked', 'true')
    expect(mainBlock().sourceRules).toEqual({})
  })

  it('has a help text as its description, with the two limits', () => {
    setup({ areas: false })
    render(<ComesFrom itemId="plate" />)
    const help = document.getElementById(leftover().getAttribute('aria-describedby')!)!
    expect(help).toHaveTextContent('Off: the rows of this block use all of it they can. What they cannot use is still left over, and the warning names it.')
    expect(help).toHaveTextContent('every item of a chain')
    expect(help).toHaveTextContent('Receive it first')
  })

  it('leaves the item\'s other settings alone', () => {
    setup({ areas: false, block: { plate: { makeHere: 'off', importOff: true } } })
    render(<ComesFrom itemId="plate" />)
    fireEvent.click(leftover())
    expect(mainBlock().sourceRules).toEqual({ plate: { makeHere: 'off', importOff: true, leftoverOff: true } })
    fireEvent.click(screen.getByTestId('sources-import-switch'))
    // Make more here is off: its switch turns it on again, then it moves below the block lines.
    makeOff()
    makeAfter()
    expect(mainBlock().sourceRules).toEqual({ plate: { makeHere: 'after-blocks', leftoverOff: true } })
  })

  describe('at area scope', () => {
    it('shows the block\'s switch, read-only, with the line "Set for the whole block"', () => {
      setup({ block: { plate: { leftoverOff: true } }, L: { plate: { makeHere: 'off' } } })
      render(<ComesFrom itemId="plate" areaId="L" />)
      expect(scope('Line L')).toHaveAttribute('aria-pressed', 'true')
      // The area's own rule replaces the block's whole, but the switch still reads the block's.
      expect(leftover()).toHaveAttribute('aria-checked', 'false')
      expect(leftover()).toHaveAttribute('aria-disabled', 'true')
      expect(document.getElementById(leftover().getAttribute('aria-describedby')!)).toHaveTextContent('Set for the whole block')
      fireEvent.click(leftover())
      expect(mainBlock().sourceRules).toEqual({ plate: { leftoverOff: true } })
    })

    it('has a button that switches the control to the whole block, where the switch works', () => {
      setup({ L: { plate: {} } })
      render(<ComesFrom itemId="plate" areaId="L" />)
      expect(scope('Line L')).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(screen.getByTestId('leftover-whole-block'))
      expect(scope('Whole block')).toHaveAttribute('aria-pressed', 'true')
      expect(leftover()).not.toHaveAttribute('aria-disabled')
    })

    it('has no button to the whole block at the whole-block scope', () => {
      setup({ L: { plate: {} } })
      render(<ComesFrom itemId="plate" />)
      expect(screen.queryByTestId('leftover-whole-block')).not.toBeInTheDocument()
    })

    it('does not carry the rule into an area edited from the block\'s rule', () => {
      setup({ block: { plate: { leftoverOff: true } } })
      render(<ComesFrom itemId="plate" areaId="L" />)
      fireEvent.click(scope('Line L'))
      makeOff()
      expect(areaRules('L')).toEqual({ plate: { makeHere: 'off' } })
      expect(mainBlock().sourceRules).toEqual({ plate: { leftoverOff: true } })
    })
  })

  describe('the takers note', () => {
    it('lists each block that takes the item from this one, once Leftover is off, with its colour', () => {
      setup({ areas: false, block: { plate: { leftoverOff: true } } })
      addTaker()
      addTaker('Second')
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => b.name === 'Second' ? { ...b, id: 'second', color: '#123456' } : b.name === 'Cooler' ? { ...b, color: '#abcdef' } : b) }))
      render(<ComesFrom itemId="plate" />)
      const takers = screen.getAllByTestId('leftover-taker')
      expect(takers.map(t => t.textContent)).toEqual(['Cooler', 'Second'])
      expect(takers.map(t => t.getAttribute('data-block-id'))).toEqual(['cooler', 'second'])
      expect(takers.map(t => within(t).getByTestId('leftover-taker-color').style.background)).toEqual(['#abcdef', '#123456'])
      expect(screen.getByTestId('leftover-takers-title')).toHaveTextContent('Take what is left over')
      expect(screen.getByTestId('leftover-takers-title')).toHaveAttribute('data-tip', 'These blocks get only what the rows here cannot use.')
    })

    it('is not shown while Leftover is on, for an item with no take, or for a product (a request)', () => {
      setup({ areas: false })
      addTaker()
      const { unmount } = render(<ComesFrom itemId="plate" />)
      expect(screen.queryByTestId('leftover-takers')).not.toBeInTheDocument()
      unmount()
      setup({ areas: false, block: { plate: { leftoverOff: true } } })
      const second = render(<ComesFrom itemId="plate" />)
      expect(screen.queryByTestId('leftover-takers')).not.toBeInTheDocument()
      second.unmount()
      setup({ areas: false, block: { plate: { leftoverOff: true } } })
      addTaker()
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => b.id === 'main' ? { ...b, products: [{ id: 'p', itemId: 'plate' }] } : b) }))
      render(<ComesFrom itemId="plate" />)
      expect(screen.queryByTestId('leftover-takers')).not.toBeInTheDocument()
    })

    describe('Make it a product', () => {
      const makeProduct = () => screen.getByTestId('leftover-make-product')
      beforeEach(() => {
        setup({ areas: false, block: { plate: { leftoverOff: true } } })
        addTaker()
      })

      it('is an icon button named and described for the takers', () => {
        render(<ComesFrom itemId="plate" />)
        expect(makeProduct()).toHaveAccessibleName('Make it a product')
        expect(makeProduct()).toHaveAttribute('data-tip', 'Make it a product to send them more.')
        expect(makeProduct()).toHaveAccessibleDescription('Take what is left over')
      })

      it('asks first, because the connections change meaning, and a confirm adds the product and ends the note', () => {
        render(<ComesFrom itemId="plate" />)
        fireEvent.click(makeProduct())
        const dialog = screen.getByTestId('product-change-confirm')
        expect(mainBlock().products).toEqual([])
        fireEvent.click(within(dialog).getByRole('button', { name: 'Make it a product' }))
        expect(mainBlock().products.map(p => p.itemId)).toEqual(['plate'])
        expect(screen.queryByTestId('product-change-confirm')).not.toBeInTheDocument()
        expect(screen.queryByTestId('leftover-takers')).not.toBeInTheDocument()
      })

      it('leaves the block untouched on Cancel', () => {
        render(<ComesFrom itemId="plate" />)
        fireEvent.click(makeProduct())
        fireEvent.click(within(screen.getByTestId('product-change-confirm')).getByRole('button', { name: 'Cancel' }))
        expect(mainBlock().products).toEqual([])
        expect(screen.queryByTestId('product-change-confirm')).not.toBeInTheDocument()
        expect(screen.getByTestId('leftover-takers')).toBeInTheDocument()
      })

      it('asks too in the strip, and the focus goes to Sources… once the product is made', () => {
        render(<ComesFrom itemId="plate" listInPopover />)
        fireEvent.click(makeProduct())
        fireEvent.click(within(screen.getByTestId('product-change-confirm')).getByRole('button', { name: 'Make it a product' }))
        expect(mainBlock().products.map(p => p.itemId)).toEqual(['plate'])
        expect(screen.getByTestId('sources-button')).toHaveFocus()
      })

      it('puts the focus on the first line of the Sources list after a confirm in the popover view', () => {
        render(<ComesFrom itemId="plate" />)
        fireEvent.click(makeProduct())
        fireEvent.click(within(screen.getByTestId('product-change-confirm')).getByRole('button', { name: 'Make it a product' }))
        expect(screen.getAllByTestId('sources-line-toggle')[0]).toHaveFocus()
      })
    })
  })

  it('shows a grey no-effect line with Remove when no row makes the item, and Remove clears the rule', () => {
    setup({ areas: false, block: { ore: { leftoverOff: true } } })
    render(<ComesFrom itemId="ore" />)
    const line = screen.getByTestId('no-effect')
    expect(line).toHaveAttribute('data-rule', 'leftover-off')
    expect(line).toHaveAttribute('data-no-effect', 'not-made')
    expect(within(line).getByTestId('no-effect-rule')).toHaveTextContent('Leftover off')
    expect(within(line).getByTestId('no-effect-reason')).toHaveTextContent('No row here makes it')
    fireEvent.click(within(line).getByRole('button', { name: 'Remove' }))
    expect(mainBlock().sourceRules).toEqual({})
    expect(screen.queryByTestId('no-effect')).not.toBeInTheDocument()
  })

  it('shows that grey line at area scope too, since the rule is the block\'s', () => {
    setup({ block: { ore: { leftoverOff: true } }, L: { ore: {} } })
    // No row makes Ore in this block: the line is the block rule's, and its Remove clears it.
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => ({ ...b, rootPlan: { ...b.rootPlan, subPlans: b.rootPlan.subPlans.map(sp => ({ ...sp, nodes: [] })) } })) }))
    render(<ComesFrom itemId="ore" areaId="L" />)
    fireEvent.click(scope('Line L'))
    const line = screen.getByTestId('no-effect')
    expect(line).toHaveAttribute('data-rule', 'leftover-off')
    expect(within(line).getByTestId('no-effect-reason')).toHaveTextContent('No row here makes it')
    fireEvent.click(within(line).getByRole('button', { name: 'Remove' }))
    expect(mainBlock().sourceRules).toEqual({})
  })

  it('says No connection for Receive it first with no connection, and offers Receive from…', () => {
    setup({ areas: false, block: { plate: { makeHere: 'after-blocks' } } })
    render(<ComesFrom itemId="plate" />)
    const line = screen.getByTestId('no-effect')
    expect(line).toHaveAttribute('data-no-effect', 'no-connection')
    expect(within(line).getByTestId('no-effect-rule')).toHaveTextContent('Receive it first')
    expect(within(line).getByTestId('no-effect-reason')).toHaveTextContent('No connection')
    expect(within(line).getByTestId('receive-from')).toBeInTheDocument()
  })

  it('says Always made here for a rule on a product, with the reason as the tip', () => {
    setup({ areas: false, block: { plate: { makeHere: 'off' } } })
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => ({ ...b, products: [{ id: 'p', itemId: 'plate' }] })) }))
    render(<ComesFrom itemId="plate" />)
    const reason = within(screen.getByTestId('no-effect')).getByTestId('no-effect-reason')
    expect(reason).toHaveTextContent('Always made here')
    expect(reason).toHaveAttribute('data-tip', 'It is a product of this block, so the block always makes it.')
  })

  it('shows no grey line for an item no row uses', () => {
    setup({ areas: false, block: { plate: { leftoverOff: true } } })
    render(<ComesFrom itemId="plate" />)
    expect(screen.queryByTestId('no-effect')).not.toBeInTheDocument()
  })
})
