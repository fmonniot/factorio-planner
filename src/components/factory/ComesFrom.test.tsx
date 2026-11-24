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

  it('has the Sources… button and a list of the area at area scope', () => {
    render(<ComesFrom itemId="plate" areaId="L" />)
    fireEvent.click(scope('Line L'))
    fireEvent.click(screen.getByTestId('sources-button'))
    const list = screen.getByTestId('sources-list')
    expect(within(list).getAllByTestId('sources-line').map(l => l.getAttribute('data-line'))).toContain('other-area')
    expect(list.querySelector('[data-line="other-area"]')).toHaveAttribute('data-area-id', 'B')
    // The list stays open when the scope changes back to the block.
    fireEvent.click(scope('Whole block'))
    expect(within(screen.getByTestId('sources-list')).queryByTestId('sources-area-switch')).not.toBeInTheDocument()
  })

  it('writes the area rule from a switch, and says what the area takes nothing from', () => {
    openOnArea()
    fireEvent.click(screen.getByTestId('sources-button'))
    expect(screen.getByTestId('follows-block-rule')).toBeInTheDocument()
    expect(screen.getByTestId('sourcing-sentence').textContent).not.toContain('Takes nothing')
    fireEvent.click(screen.getByTestId('sources-area-switch'))
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'after-blocks', areasOff: ['B'] } })
    expect(mainBlock().sourceRules).toEqual({ plate: { makeHere: 'after-blocks' } })
    expect(screen.queryByTestId('follows-block-rule')).not.toBeInTheDocument()
    expect(screen.getByTestId('sourcing-sentence').textContent).toMatch(/^Line L: .* Takes nothing from Line B\.$/)
    fireEvent.click(screen.getByTestId('use-block-rule'))
    expect(areaRules('L')).toBeUndefined()
    expect(screen.getByTestId('follows-block-rule')).toBeInTheDocument()
    expect(screen.getByTestId('sourcing-sentence').textContent).not.toContain('Takes nothing')
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

describe('ComesFrom, in the Comes from popover', () => {
  it('draws the sentence, then one toolbar: the rule group, then Sources…, with no text buttons', () => {
    setup()
    render(<ComesFrom itemId="plate" />)
    const root = screen.getByTestId('comes-from')
    expect(root.firstElementChild).toBe(screen.getByTestId('sourcing-sentence'))
    const toolbar = within(root).getByTestId('strip-toolbar')
    expect([...toolbar.querySelectorAll('button')].map(b => b.getAttribute('aria-label')))
      .toEqual(['Make it here', 'Receive it first', "Don't make more here", 'Import', 'Leftover', 'Sources…'])
    expect(toolbar.firstElementChild).toBe(within(toolbar).getByRole('radiogroup'))
  })

  it('shows the scope control above the sentence, and the area rule writes through the icons', () => {
    setup({ L: { plate: {} } })
    render(<ComesFrom itemId="plate" areaId="L" />)
    const root = screen.getByTestId('comes-from')
    expect(root.firstElementChild).toBe(screen.getByTestId('comes-from-scope'))
    fireEvent.click(within(root).getByRole('radio', { name: "Don't make more here" }))
    expect(areaRules('L')).toEqual({ plate: { makeHere: 'off' } })
    fireEvent.click(screen.getByTestId('import-switch'))
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

  it('draws the sentence, then one toolbar: the given actions, the rule group, then Sources…', () => {
    setup()
    render(<ComesFrom itemId="plate" listInPopover actions={[{ label: 'Find recipe', icon: 'find', side: 'left', onSelect: () => {} }]} />)
    const root = screen.getByTestId('comes-from')
    expect(root.firstElementChild).toBe(screen.getByTestId('sourcing-sentence'))
    const toolbar = within(root).getByTestId('strip-toolbar')
    expect([...toolbar.querySelectorAll('button')].map(b => b.getAttribute('aria-label')))
      .toEqual(['Find recipe', 'Make it here', 'Receive it first', "Don't make more here", 'Import', 'Leftover', 'Sources…'])
    expect(within(toolbar).getByRole('radiogroup')).toHaveAccessibleName('Where Plate comes from')
    expect(within(toolbar).getByTestId('sources-button')).toHaveAttribute('aria-haspopup', 'dialog')
    expect(screen.queryByText('Comes from', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('lights the chosen preset and the switches that are on, and tells the state in the tooltip', () => {
    setup()
    render(<ComesFrom itemId="plate" listInPopover />)
    expect(screen.getByRole('radio', { name: 'Make it here' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Make it here' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Receive it first' })).toHaveAttribute('tabindex', '-1')
    // Each preset has its own icon.
    expect(screen.getByRole('radio', { name: 'Make it here' }).querySelector('svg')).toHaveAttribute('data-icon', 'make')
    expect(screen.getByRole('radio', { name: 'Receive it first' }).querySelector('svg')).toHaveAttribute('data-icon', 'receive-first')
    expect(screen.getByRole('radio', { name: "Don't make more here" }).querySelector('svg')).toHaveAttribute('data-icon', 'dont-make')
    expect(screen.getByTestId('import-switch')).toHaveAttribute('data-tip', expect.stringMatching(/^Import on\. /))
    fireEvent.click(screen.getByTestId('leftover-switch'))
    expect(screen.getByTestId('leftover-switch')).not.toBeChecked()
    expect(screen.getByTestId('leftover-switch')).toHaveAttribute('data-tip', expect.stringMatching(/^Leftover off\. /))
    // A switch that is off draws the struck icon as well as the unlit button.
    expect(screen.getByTestId('leftover-switch').querySelector('svg')).toHaveAttribute('data-icon', 'leftover-off')
    expect(screen.getByTestId('import-switch').querySelector('svg')).toHaveAttribute('data-icon', 'import')
    fireEvent.click(screen.getByTestId('import-switch'))
    expect(screen.getByTestId('import-switch').querySelector('svg')).toHaveAttribute('data-icon', 'import-off')
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

describe('ComesFrom, the Leftover switch', () => {
  const leftover = () => screen.getByTestId('leftover-switch')
  /** A block `Cooler` that takes Plate from Main (a take: Plate is not a product of Main). */
  const addTaker = (name = 'Cooler') => {
    const taker: Block = { ...makeEmptyBlock(name), id: 'cooler', inputConnections: [{ id: 'c1', itemId: 'plate', fromBlockId: 'main' }] }
    useBlockStore.setState(s => ({ blocks: [...s.blocks, taker] }))
  }

  it('is on by default, under Import, and turns off and on with the block\'s rule (undoable)', () => {
    setup({ areas: false })
    render(<ComesFrom itemId="plate" />)
    expect(leftover()).toHaveAttribute('role', 'switch')
    expect(leftover()).toHaveAccessibleName('Leftover')
    expect(leftover()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('import-switch').compareDocumentPosition(leftover()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
    fireEvent.click(screen.getByTestId('import-switch'))
    fireEvent.click(preset('Receive it first'))
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
      expect(screen.getByTestId('leftover-block-note')).toHaveTextContent('Set for the whole block')
      fireEvent.click(leftover())
      expect(mainBlock().sourceRules).toEqual({ plate: { leftoverOff: true } })
    })

    it('has a button that switches the control to the whole block, where the switch works', () => {
      setup({ L: { plate: {} } })
      render(<ComesFrom itemId="plate" areaId="L" />)
      expect(scope('Line L')).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(screen.getByTestId('leftover-whole-block'))
      expect(scope('Whole block')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.queryByTestId('leftover-block-note')).not.toBeInTheDocument()
      expect(leftover()).not.toHaveAttribute('aria-disabled')
    })

    it('has neither the note nor the button at the whole-block scope', () => {
      setup({ L: { plate: {} } })
      render(<ComesFrom itemId="plate" />)
      expect(screen.queryByTestId('leftover-block-note')).not.toBeInTheDocument()
      expect(screen.queryByTestId('leftover-whole-block')).not.toBeInTheDocument()
    })

    it('does not carry the rule into an area edited from the block\'s rule', () => {
      setup({ block: { plate: { leftoverOff: true } } })
      render(<ComesFrom itemId="plate" areaId="L" />)
      fireEvent.click(scope('Line L'))
      fireEvent.click(preset("Don't make more here"))
      expect(areaRules('L')).toEqual({ plate: { makeHere: 'off' } })
      expect(mainBlock().sourceRules).toEqual({ plate: { leftoverOff: true } })
    })
  })

  describe('the take note', () => {
    it('names each block that takes the item from this one, once Leftover is off', () => {
      setup({ areas: false, block: { plate: { leftoverOff: true } } })
      addTaker()
      addTaker('Second')
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => b.name === 'Second' ? { ...b, id: 'second' } : b) }))
      render(<ComesFrom itemId="plate" />)
      const notes = screen.getAllByTestId('leftover-take-note').map(n => n.textContent)
      expect(notes).toEqual([
        'Cooler takes Plate from this block. It gets only what the rows here cannot use; make Plate a product to send it more.',
        'Second takes Plate from this block. It gets only what the rows here cannot use; make Plate a product to send it more.',
      ])
    })

    it('is not shown while Leftover is on, for an item with no take, or for a product (a request)', () => {
      setup({ areas: false })
      addTaker()
      const { unmount } = render(<ComesFrom itemId="plate" />)
      expect(screen.queryByTestId('leftover-take-note')).not.toBeInTheDocument()
      unmount()
      setup({ areas: false, block: { plate: { leftoverOff: true } } })
      render(<ComesFrom itemId="plate" />)
      expect(screen.queryByTestId('leftover-take-note')).not.toBeInTheDocument()
      unmount()
      setup({ areas: false, block: { plate: { leftoverOff: true } } })
      addTaker()
      useBlockStore.setState(s => ({ blocks: s.blocks.map(b => b.id === 'main' ? { ...b, products: [{ id: 'p', itemId: 'plate' }] } : b) }))
      render(<ComesFrom itemId="plate" />)
      expect(screen.queryByTestId('leftover-take-note')).not.toBeInTheDocument()
    })
  })

  it('shows a grey no-effect line with Remove when no row makes the item, and Remove clears the rule', () => {
    setup({ areas: false, block: { ore: { leftoverOff: true } } })
    render(<ComesFrom itemId="ore" />)
    const line = screen.getByTestId('no-effect')
    expect(line).toHaveAttribute('data-rule', 'leftover-off')
    expect(line).toHaveAttribute('data-no-effect', 'not-made')
    expect(line).toHaveTextContent('No row in this block makes Ore.')
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
    fireEvent.click(within(line).getByRole('button', { name: 'Remove' }))
    expect(mainBlock().sourceRules).toEqual({})
  })

  it('shows no grey line for an item no row uses', () => {
    setup({ areas: false, block: { plate: { leftoverOff: true } } })
    render(<ComesFrom itemId="plate" />)
    expect(screen.queryByTestId('no-effect')).not.toBeInTheDocument()
  })
})
