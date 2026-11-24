import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, createEvent, within, act } from '@testing-library/react'
import { ComesFrom } from './ComesFrom'
import { ComesFromPopover } from './ComesFromPopover'
import { sourcesLineOrder } from './itemSourcing'
import { useBlockStore, makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { AreaRoute, AreaSourceRule, Block, GameData, SolverResult, SubPlan } from '../../data/types'

// Ore Synth makes Ore (dedicated); Smelt makes Plate from Ore and Slag as a co-product, so Slag is a byproduct of Smelt.
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
      'ore-synth': {
        id: 'ore-synth', name: 'Ore Synth', category: 'crafting', craftingTime: 1,
        ingredients: [], products: [{ itemId: 'ore', type: 'item', amount: 1 }],
        madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'ore',
      },
    },
    machines: {}, beacons: {}, modules: {}, defaultMachines: {}, technologies: {}, startingRecipes: [],
  } as unknown as GameData
}

const TOP = ['made-here', 'make-here', 'add-block', 'import']
const BELOW = ['made-here', 'add-block', 'make-here', 'import']
const mainBlock = () => useBlockStore.getState().blocks.find(b => b.id === 'main')!
const ruleOf = () => mainBlock().sourceRules.ore
const lines = () => screen.getAllByTestId('sources-line').map(l => l.getAttribute('data-line'))
const line = (name: string) => screen.getAllByTestId('sources-line').find(l => l.getAttribute('data-line') === name)!
/** The preset the rule chip reads ('own' is Make it here), in the list view, which has no radios. */
const chipPreset = () => screen.getByTestId('sources-rule-chip').getAttribute('data-preset')!
const chipText = () => screen.getByTestId('sources-rule-chip').textContent
/** Opens (or closes) the detail of a line by its name button. */
const toggleLine = (li: HTMLElement) => { fireEvent.click(within(li).getByTestId('sources-line-toggle')); return li }
const openLine = (name: string) => toggleLine(line(name))
const rateOf = (li: HTMLElement) => (within(li).queryByTestId('sources-rate') ?? within(li).getByTestId('sources-block-rate')).textContent
const detailOf = (li: HTMLElement) => within(li).getByTestId('sources-detail')

function setup(over: Partial<Block> = {}) {
  const main: Block = { ...makeEmptyBlock('Main'), id: 'main', ...over }
  main.rootPlan = { ...main.rootPlan, nodes: [makeRecipeNode('smelt'), makeRecipeNode('ore-synth')] }
  useBlockStore.setState({ blocks: [main], activeBlockId: 'main', history: {} })
  useUiStore.setState({ rateUnit: 'min', comesFromPopover: null, connectionMenu: null, sourcesSides: {} })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: gameData(), sourceId: 'test' } })
  useSolverStore.setState({ status: { type: 'idle' }, lastResult: undefined, lastResults: {}, flows: [], _setStatus: () => {} })
}

function openList() {
  render(<ComesFrom itemId="ore" />)
  fireEvent.click(screen.getByTestId('sources-button'))
}

/** An empty-handed solve of main: the node rows of the test have no consumption unless given. */
const solvedNodes = (nodes: object[], over: Partial<SolverResult> = {}) => act(() => useSolverStore.setState({
  lastResults: { main: { nodes: nodes.map(n => ({ inputRates: {}, outputRates: {}, ...n })), unsatisfied: [], warnings: [], ...over } as unknown as SolverResult },
}))

beforeEach(() => setup())

describe('sourcesLineOrder', () => {
  it('draws Make more here above the block lines, below them, or where it was last when it is off', () => {
    expect(sourcesLineOrder(undefined, false, 'above')).toEqual(['made-here', 'make-here', 'block', 'import'])
    expect(sourcesLineOrder('after-blocks', false, 'below')).toEqual(['made-here', 'block', 'make-here', 'import'])
    expect(sourcesLineOrder('off', false, 'above')).toEqual(['made-here', 'make-here', 'block', 'import'])
    expect(sourcesLineOrder('off', false, 'below')).toEqual(['made-here', 'block', 'make-here', 'import'])
  })
  it('puts Other areas after Make more here, or after Already made here when that is off', () => {
    expect(sourcesLineOrder(undefined, true, 'above')).toEqual(['made-here', 'make-here', 'other-areas', 'block', 'import'])
    expect(sourcesLineOrder('after-blocks', true, 'below')).toEqual(['made-here', 'block', 'make-here', 'other-areas', 'import'])
    expect(sourcesLineOrder('off', true, 'above')).toEqual(['made-here', 'other-areas', 'make-here', 'block', 'import'])
    expect(sourcesLineOrder('off', true, 'below')).toEqual(['made-here', 'other-areas', 'block', 'make-here', 'import'])
  })
})

describe('the Sources button', () => {
  it('shows and hides the list in place, and reports it with aria-expanded', () => {
    render(<ComesFrom itemId="ore" />)
    const button = screen.getByTestId('sources-button')
    expect(button).toHaveAccessibleName('Sources…')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('sources-list')).toBeNull()
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('sources-list')).toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.queryByTestId('sources-list')).toBeNull()
  })

  it('opens the Comes from popover with the list open when the control sits in a strip', () => {
    render(<ComesFrom itemId="ore" listInPopover />)
    fireEvent.click(screen.getByTestId('sources-button'))
    expect(screen.queryByTestId('sources-list')).toBeNull()
    expect(useUiStore.getState().comesFromPopover).toMatchObject({ itemId: 'ore', list: true })
  })

  it('starts open when asked to', () => {
    render(<ComesFrom itemId="ore" initialListOpen />)
    expect(screen.getByTestId('sources-list')).toBeInTheDocument()
  })
})

describe('the list and the presets are two views of one rule', () => {
  const STATES: { name: string; rule: Block['sourceRules'][string] | undefined; preset: string; chip: string; order: string[]; make: boolean; imp: boolean }[] = [
    { name: 'Make it here', rule: undefined, preset: 'own', chip: 'Make it here', order: ['made-here', 'make-here', 'add-block', 'import'], make: true, imp: true },
    { name: 'Make it here, Import off', rule: { importOff: true }, preset: 'own', chip: 'Make it here · Import off', order: ['made-here', 'make-here', 'add-block', 'import'], make: true, imp: false },
    { name: 'Receive it first', rule: { makeHere: 'after-blocks' }, preset: 'connections-first', chip: 'Receive it first', order: ['made-here', 'add-block', 'make-here', 'import'], make: true, imp: true },
    { name: 'Receive it first, Import off', rule: { makeHere: 'after-blocks', importOff: true }, preset: 'connections-first', chip: 'Receive it first · Import off', order: ['made-here', 'add-block', 'make-here', 'import'], make: true, imp: false },
    { name: "Don't make more here", rule: { makeHere: 'off' }, preset: 'byproducts-first', chip: "Don't make more here", order: ['made-here', 'make-here', 'add-block', 'import'], make: false, imp: true },
    { name: "Don't make more here, Import off", rule: { makeHere: 'off', importOff: true }, preset: 'byproducts-first', chip: "Don't make more here · Import off", order: ['made-here', 'make-here', 'add-block', 'import'], make: false, imp: false },
  ]

  for (const s of STATES) {
    it(`reads ${s.name} from the stored rule`, () => {
      setup({ sourceRules: s.rule ? { ore: s.rule } : {} })
      openList()
      expect(chipPreset()).toBe(s.preset)
      expect(chipText()).toBe(s.chip)
      expect(lines()).toEqual(s.order)
      expect(screen.getByTestId('sources-make-here-switch')).toHaveAttribute('aria-checked', String(s.make))
      expect(screen.getByTestId('sources-import-switch')).toHaveAttribute('aria-checked', String(s.imp))
      expect(line('make-here').hasAttribute('data-off')).toBe(!s.make)
    })

    it(`reaches ${s.name} from the list`, () => {
      // From Make it here, with Import on: After other blocks, the two switches.
      openList()
      openLine('make-here')
      if (s.rule?.makeHere === 'after-blocks') fireEvent.click(screen.getByTestId('sources-make-after'))
      if (s.rule?.makeHere === 'off') fireEvent.click(screen.getByTestId('sources-make-here-switch'))
      if (s.rule?.importOff) fireEvent.click(screen.getByTestId('sources-import-switch'))
      expect(ruleOf()).toEqual(s.rule)
      expect(chipPreset()).toBe(s.preset)
      expect(chipText()).toBe(s.chip)
      expect(lines()).toEqual(s.order)
    })

    it(`shows the list of ${s.name} after the presets (and the Import switch of the control) chose it`, () => {
      render(<ComesFrom itemId="ore" />)
      fireEvent.click(document.querySelector(`[data-sourcing-choice="${s.preset}"]`)!)
      if (s.rule?.importOff) fireEvent.click(screen.getByTestId('import-switch'))
      // The presets and the Import switch are the compact view's: the list is the other view of the same rule.
      fireEvent.click(screen.getByTestId('sources-button'))
      expect(ruleOf()).toEqual(s.rule)
      expect(chipText()).toBe(s.chip)
      expect(lines()).toEqual(s.order)
      expect(screen.getByTestId('sources-make-here-switch')).toHaveAttribute('aria-checked', String(s.make))
      expect(screen.getByTestId('sources-import-switch')).toHaveAttribute('aria-checked', String(s.imp))
    })
  }

  it('moves Make more here below with Receive it first, switches it off with Don\'t make more here, and on again with Make it here', () => {
    openList()
    openLine('make-here')
    fireEvent.click(screen.getByTestId('sources-make-after'))
    expect(ruleOf()).toEqual({ makeHere: 'after-blocks' })
    expect(chipText()).toBe('Receive it first')
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(ruleOf()).toEqual({ makeHere: 'off' })
    expect(chipText()).toBe("Don't make more here")
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(ruleOf()).toBeUndefined()
    expect(chipText()).toBe('Make it here')
    expect(lines()).toEqual(['made-here', 'make-here', 'add-block', 'import'])
  })

  it('keeps Make more here where it was drawn last while it is off', () => {
    setup({ sourceRules: { ore: { makeHere: 'after-blocks' } } })
    openList()
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(ruleOf()).toEqual({ makeHere: 'off' })
    expect(lines()).toEqual(['made-here', 'add-block', 'make-here', 'import'])
    expect(line('make-here').hasAttribute('data-off')).toBe(true)
  })

  it('has one Import switch with the control', () => {
    render(<ComesFrom itemId="ore" />)
    fireEvent.click(screen.getByTestId('import-switch'))
    fireEvent.click(screen.getByTestId('sources-button'))
    expect(screen.getByTestId('sources-import-switch')).toHaveAttribute('aria-checked', 'false')
    expect(chipText()).toBe('Make it here · Import off')
    fireEvent.click(screen.getByTestId('sources-import-switch'))
    fireEvent.click(screen.getByTestId('sources-button'))
    expect(screen.getByTestId('import-switch')).toHaveAttribute('aria-checked', 'true')
    expect(ruleOf()).toBeUndefined()
  })
})

describe('Other areas', () => {
  it('is absent in a block with no area and present, after Make more here, in one with an area', () => {
    openList()
    expect(lines()).not.toContain('other-areas')
  })

  it('is drawn in a block with an area', () => {
    const main = mainBlock()
    useBlockStore.setState({
      blocks: [{ ...main, rootPlan: { ...main.rootPlan, subPlans: [{ ...main.rootPlan, id: 'area-1', nodes: [], subPlans: [], area: true }] } }],
    })
    openList()
    expect(lines()).toEqual(['made-here', 'make-here', 'other-areas', 'add-block', 'import'])
    expect(line('other-areas')).toHaveTextContent('Other areas')
  })
})

describe('the Make more here places', () => {
  it('press the side it is on, disable both while it is off, and do nothing then', () => {
    openList()
    openLine('make-here')
    const before = () => screen.getByTestId('sources-make-before')
    const after = () => screen.getByTestId('sources-make-after')
    expect(before()).toHaveAttribute('aria-pressed', 'true')
    expect(after()).toHaveAttribute('aria-pressed', 'false')
    expect(before()).toHaveTextContent('Before other blocks')
    expect(after()).toHaveTextContent('After other blocks')
    fireEvent.click(before())
    expect(ruleOf()).toBeUndefined()
    fireEvent.click(after())
    expect(before()).toHaveAttribute('aria-pressed', 'false')
    expect(after()).toHaveAttribute('aria-pressed', 'true')
    expect(ruleOf()).toEqual({ makeHere: 'after-blocks' })
    fireEvent.click(after())
    expect(ruleOf()).toEqual({ makeHere: 'after-blocks' })
    fireEvent.click(before())
    expect(ruleOf()).toBeUndefined()
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(before()).toHaveAttribute('aria-disabled', 'true')
    expect(after()).toHaveAttribute('aria-disabled', 'true')
    expect(before()).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(after())
    expect(ruleOf()).toEqual({ makeHere: 'off' })
  })
})

describe('dragging Make more here', () => {
  const dataTransfer = () => ({ setData: () => {}, effectAllowed: '', dropEffect: '' })
  function rect(el: Element) {
    el.getBoundingClientRect = () => ({ top: 100, height: 20, bottom: 120, left: 0, right: 100, width: 100, x: 0, y: 100, toJSON: () => ({}) })
  }

  // happy-dom's DragEvent drops clientY from its init: set it on the event.
  function dragAt(type: 'dragOver' | 'drop', el: Element, clientY: number) {
    const ev = createEvent[type](el, { dataTransfer: dataTransfer() })
    Object.defineProperty(ev, 'clientY', { value: clientY })
    fireEvent(el, ev)
  }

  it('moves below the block lines when dropped on the lower half, and above on the upper half', () => {
    openList()
    const make = line('make-here')
    const block = line('add-block')
    rect(block)
    fireEvent.dragStart(make, { dataTransfer: dataTransfer() })
    dragAt('dragOver', block, 115)
    expect(within(block).getByTestId('sources-drop-line')).toHaveAttribute('data-side', 'after')
    dragAt('drop', block, 115)
    expect(ruleOf()).toEqual({ makeHere: 'after-blocks' })
    expect(lines()).toEqual(['made-here', 'add-block', 'make-here', 'import'])

    fireEvent.dragStart(line('make-here'), { dataTransfer: dataTransfer() })
    dragAt('dragOver', block, 105)
    dragAt('drop', block, 105)
    expect(ruleOf()).toBeUndefined()
  })

  it('draws no drop line where a drop would move nothing, and is not draggable when off', () => {
    openList()
    const block = line('add-block')
    rect(block)
    fireEvent.dragStart(line('make-here'), { dataTransfer: dataTransfer() })
    dragAt('dragOver', block, 105)
    expect(screen.queryByTestId('sources-drop-line')).toBeNull()
    fireEvent.dragEnd(line('make-here'))
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(line('make-here')).not.toHaveAttribute('draggable')
  })
})

describe('the detail of a line', () => {
  it('opens under the line from its name button, one at a time, and closes with a second press', () => {
    openList()
    expect(screen.queryByTestId('sources-detail')).toBeNull()
    const make = line('make-here')
    const toggle = within(make).getByTestId('sources-line-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).not.toHaveAttribute('aria-controls')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', detailOf(make).id)
    expect(detailOf(make)).toHaveTextContent("Run this block's rows, or more of them, for this item. Adds machines.")
    openLine('import')
    expect(screen.getAllByTestId('sources-detail')).toHaveLength(1)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(detailOf(line('import'))).toHaveTextContent('Bring it in from outside the plan. Off: what the other sources leave is shown as missing.')
    openLine('import')
    expect(screen.queryByTestId('sources-detail')).toBeNull()
  })

  it('states each line\'s help in its detail, and has none on the Receive from… line', () => {
    openList()
    expect(detailOf(openLine('made-here'))).toHaveTextContent("What this block's rows already make while running for something else")
    expect(within(line('add-block')).queryByTestId('sources-line-toggle')).toBeNull()
    expect(within(line('add-block')).getByTestId('sources-receive-from')).toBeInTheDocument()
  })

  it('stays open while its line moves', () => {
    openList()
    openLine('make-here')
    fireEvent.click(screen.getByTestId('sources-make-after'))
    expect(lines()).toEqual(BELOW)
    expect(within(line('make-here')).getByTestId('sources-line-toggle')).toHaveAttribute('aria-expanded', 'true')
  })

  it('has a 26px row with a marker, the name, the rate and a chevron, and the line is not a tab stop', () => {
    openList()
    const li = line('made-here')
    expect(li).not.toHaveAttribute('tabindex')
    expect(within(li).getByTestId('sources-line-toggle').tagName).toBe('BUTTON')
    expect(within(li).getByTestId('sources-rate')).toBeInTheDocument()
    expect(within(li).getByTestId('sources-marker')).toBeInTheDocument()
  })
})

describe('what the lines read', () => {
  function solved(over: Partial<SolverResult> = {}) {
    const { nodes, ...rest } = over
    solvedNodes((nodes ?? []) as object[], rest)
  }

  it('reads nothing yet, no row here makes it, and the connection count', () => {
    const main = mainBlock()
    useBlockStore.setState({ blocks: [{ ...main, rootPlan: { ...main.rootPlan, nodes: main.rootPlan.nodes.filter(n => n.kind === 'game-recipe' && n.recipeId === 'smelt') } }] })
    openList()
    expect(detailOf(openLine('made-here'))).toHaveTextContent('nothing yet')
    expect(within(detailOf(line('made-here'))).getByTestId('sources-detail-reading')).toHaveTextContent('nothing yet')
    expect(within(detailOf(openLine('make-here'))).getByTestId('sources-detail-reading')).toHaveTextContent('no row here makes it')
    expect(line('add-block')).toHaveTextContent('No connection for Ore.')
    // Neither makes anything: both lines are marked idle.
    expect(within(line('made-here')).getByTestId('sources-status-mark')).toHaveAttribute('data-status', 'idle')
    expect(within(line('make-here')).getByTestId('sources-status-mark')).toHaveAttribute('data-status', 'idle')
  })

  it('lists the dedicated rows under Make more here', () => {
    openList()
    openLine('make-here')
    expect(detailOf(line('make-here'))).toHaveTextContent('Ore Synth')
    expect(detailOf(line('make-here'))).not.toHaveTextContent('×')
  })

  it('lists the rows making it at a rate above 0 under Don\'t make more here, the byproduct ones otherwise', () => {
    const nodes = mainBlock().rootPlan.nodes
    const synth = nodes.find(n => n.kind === 'game-recipe' && n.recipeId === 'ore-synth')!.id
    solved({ nodes: [{ recipeNodeId: synth, machineCountCeil: 2, outputRates: { ore: 30 } } as never] })
    openList()
    // The row is dedicated to Ore: not "already made" under Make it here.
    expect(detailOf(openLine('made-here'))).toHaveTextContent('nothing yet')
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(detailOf(line('made-here'))).toHaveTextContent('Ore Synth')
    expect(detailOf(line('made-here'))).toHaveTextContent('30')
  })

  it('reads the imported rate, and Missing with Import off', () => {
    solved({ unsatisfied: [{ itemId: 'ore', rate: 12 } as never] })
    openList()
    expect(rateOf(line('import'))).toBe('12.0/m')
    openLine('import')
    expect(detailOf(line('import'))).toHaveTextContent('12')
    expect(detailOf(line('import'))).not.toHaveTextContent('Missing')
    expect(within(line('import')).queryByTestId('sources-status-mark')).toBeNull()
    fireEvent.click(screen.getByTestId('sources-import-switch'))
    expect(detailOf(line('import'))).toHaveTextContent('Missing 12.0/m')
    expect(detailOf(line('import'))).toHaveTextContent('Missing: Import is off and nothing else supplies it.')
    expect(rateOf(line('import'))).toBe('12.0/m')
    expect(within(line('import')).getByTestId('sources-status-mark')).toHaveAttribute('data-status', 'missing')
    // What is missing is not dimmed, as an off line with nothing missing is.
    expect(line('import')).toHaveAttribute('data-off', 'true')
  })

  it('lists an item imported over several ranges once, with the sum', () => {
    solved({ unsatisfied: [{ itemId: 'ore', rate: 12, temp: { min: 465 } }, { itemId: 'ore', rate: 5, temp: {} }] as never })
    openList()
    expect(screen.getAllByTestId('sources-line').filter(l => l.getAttribute('data-line') === 'import')).toHaveLength(1)
    expect(rateOf(line('import'))).toBe('17.0/m')
  })
})

describe('a solved dedicated row', () => {
  it('reads its machine count, and the recipe alone while it is idle', () => {
    const synth = mainBlock().rootPlan.nodes.find(n => n.kind === 'game-recipe' && n.recipeId === 'ore-synth')!.id
    solvedNodes([{ recipeNodeId: synth, machineCountCeil: 2, outputRates: { ore: 30 } }])
    openList()
    openLine('make-here')
    expect(detailOf(line('make-here'))).toHaveTextContent('Ore Synth (2 × machine)')
    solvedNodes([{ recipeNodeId: synth, machineCountCeil: 0, outputRates: {} }])
    expect(detailOf(line('make-here'))).not.toHaveTextContent('×')
  })
})

describe('history', () => {
  const stack = () => useBlockStore.getState().history.main?.undoStack.length ?? 0

  it('makes one undoable entry per action, and undo restores the preset and the side', () => {
    openList()
    openLine('make-here')
    const steps = ['sources-make-after', 'sources-make-here-switch', 'sources-make-here-switch', 'sources-import-switch']
    const before: { preset: string; order: (string | null)[] }[] = []
    steps.forEach((testId, i) => {
      before.push({ preset: chipPreset(), order: lines() })
      fireEvent.click(screen.getByTestId(testId))
      expect(stack(), `entry after step ${i}`).toBe(i + 1)
    })
    for (let i = steps.length - 1; i >= 0; i--) {
      act(() => useBlockStore.getState().undo())
      expect(chipPreset()).toBe(before[i].preset)
      // A switched-off line has no stored side: undoing back into it draws it where it was drawn last, not where it was.
      if (before[i].preset !== 'byproducts-first') expect(lines()).toEqual(before[i].order)
    }
    expect(ruleOf()).toBeUndefined()
  })

  it('adds no entry for a move that goes nowhere', () => {
    openList()
    openLine('make-here')
    fireEvent.click(screen.getByTestId('sources-make-before'))
    expect(stack()).toBe(0)
  })
})

describe('the side Make more here was drawn on', () => {
  it('is remembered when the list closes and opens again', () => {
    setup({ sourceRules: { ore: { makeHere: 'after-blocks' } } })
    openList()
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(lines()).toEqual(BELOW)
    fireEvent.click(screen.getByTestId('sources-button'))
    fireEvent.click(screen.getByTestId('sources-button'))
    expect(lines()).toEqual(BELOW)
  })
})

describe('focus', () => {
  it('stays in the Make more here line after a move: on the button of its new side, and on the switch after a switch', () => {
    openList()
    openLine('make-here')
    expect(lines()).toEqual(TOP)
    const after = screen.getByTestId('sources-make-after')
    act(() => after.focus())
    fireEvent.click(after)
    expect(lines()).toEqual(BELOW)
    expect(document.activeElement).toBe(screen.getByTestId('sources-make-after'))
    expect(line('make-here').contains(document.activeElement)).toBe(true)
    const before = screen.getByTestId('sources-make-before')
    act(() => before.focus())
    fireEvent.click(before)
    expect(lines()).toEqual(TOP)
    expect(document.activeElement).toBe(screen.getByTestId('sources-make-before'))
    const sw = screen.getByTestId('sources-make-here-switch')
    act(() => sw.focus())
    fireEvent.click(sw)
    expect(document.activeElement).toBe(sw)
  })

  it('reaches every action with the keyboard: buttons, none out of the tab order, and no focusable line', () => {
    openList()
    openLine('make-here')
    for (const id of ['sources-make-before', 'sources-make-after', 'sources-make-here-switch', 'sources-import-switch', 'sources-receive-from']) {
      const el = screen.getByTestId(id)
      expect(el.tagName).toBe('BUTTON')
      expect(el).not.toBeDisabled()
      expect(el.getAttribute('tabindex')).toBeNull()
    }
    for (const l of screen.getAllByTestId('sources-line')) expect(l).not.toHaveAttribute('tabindex')
  })
})

describe('Alt+Arrow', () => {
  const alt = (el: Element, key: 'ArrowUp' | 'ArrowDown') => fireEvent.keyDown(el, { key, altKey: true })
  const toggleOf = (li: HTMLElement) => within(li).getByTestId('sources-line-toggle')

  it('moves Make more here across the block lines from its name, and the focus follows it', () => {
    openList()
    act(() => toggleOf(line('make-here')).focus())
    alt(toggleOf(line('make-here')), 'ArrowUp')
    expect(ruleOf()).toBeUndefined()
    alt(toggleOf(line('make-here')), 'ArrowDown')
    expect(ruleOf()).toEqual({ makeHere: 'after-blocks' })
    expect(lines()).toEqual(BELOW)
    expect(document.activeElement).toBe(toggleOf(line('make-here')))
    alt(document.activeElement!, 'ArrowUp')
    expect(ruleOf()).toBeUndefined()
    expect(document.activeElement).toBe(toggleOf(line('make-here')))
  })

  it('does not move Make more here while it is off, nor a plain arrow', () => {
    openList()
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    alt(toggleOf(line('make-here')), 'ArrowDown')
    expect(ruleOf()).toEqual({ makeHere: 'off' })
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    fireEvent.keyDown(toggleOf(line('make-here')), { key: 'ArrowDown' })
    expect(ruleOf()).toBeUndefined()
  })

  it('does nothing on the other lines', () => {
    openList()
    alt(toggleOf(line('import')), 'ArrowUp')
    alt(toggleOf(line('made-here')), 'ArrowDown')
    expect(ruleOf()).toBeUndefined()
    expect(useBlockStore.getState().history.main?.undoStack.length ?? 0).toBe(0)
  })
})

describe('the description of a switch', () => {
  it('is a hidden help text beside the switch, and the tooltip says the state', () => {
    openList()
    const sw = screen.getByTestId('sources-make-here-switch')
    const help = document.getElementById(sw.getAttribute('aria-describedby')!)!
    expect(help).toHaveClass('sr-only')
    expect(help).toHaveTextContent("Run this block's rows, or more of them, for this item. Adds machines.")
    expect(sw).toHaveAccessibleName('Make more here')
    expect(sw).toHaveAttribute('data-tip', 'Make more here on')
    fireEvent.click(sw)
    expect(sw).toHaveAttribute('data-tip', 'Make more here off')
  })
})

describe('the popover', () => {
  it('follows each open request for the list, also for the same item', () => {
    render(<ComesFromPopover hasSlot={() => false} />)
    const anchor = { rect: { left: 0, top: 0, right: 10, bottom: 10 }, avoid: null }
    act(() => useUiStore.getState().openComesFrom('ore', anchor, { list: true }))
    expect(screen.getByTestId('sources-list')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('sources-button'))
    expect(screen.queryByTestId('sources-list')).toBeNull()
    act(() => useUiStore.getState().openComesFrom('ore', anchor, { list: true }))
    expect(screen.getByTestId('sources-list')).toBeInTheDocument()
  })
})

describe('the block lines', () => {
  const order = () => mainBlock().inputConnections.filter(c => c.itemId === 'ore').map(c => c.id)
  const blockLines = () => screen.getAllByTestId('sources-line').filter(l => l.getAttribute('data-line') === 'block')
  const row = (connectionId: string) => blockLines().find(l => l.getAttribute('data-connection-id') === connectionId)!
  const byId = (id: string) => useBlockStore.getState().blocks.find(b => b.id === id)!

  /** Two sources of Ore: "Alpha" makes it (a product), "Beta" only has some to spare; main takes from both, Alpha first. */
  function twoSources(extra: Partial<Block> = {}) {
    const alpha: Block = { ...makeEmptyBlock('Alpha'), id: 'alpha', color: '#112233', products: [{ id: 'pa', itemId: 'ore' }] }
    const beta: Block = { ...makeEmptyBlock('Beta'), id: 'beta', color: '#445566' }
    const main: Block = {
      ...makeEmptyBlock('Main'), id: 'main',
      inputConnections: [{ id: 'c1', fromBlockId: 'alpha', itemId: 'ore' }, { id: 'c2', fromBlockId: 'beta', itemId: 'ore' }],
      ...extra,
    }
    main.rootPlan = { ...main.rootPlan, nodes: [makeRecipeNode('smelt'), makeRecipeNode('ore-synth')] }
    useBlockStore.setState({ blocks: [main, alpha, beta], activeBlockId: 'main', history: {} })
  }
  const flow = (over: Record<string, unknown>) => ({
    connectionId: 'c1', fromBlockId: 'alpha', toBlockId: 'main', itemId: 'ore', available: 60, capped: false, rate: 30, status: 'ok', kind: 'request', requested: 30, ...over,
  })
  const setFlows = (...flows: Record<string, unknown>[]) => act(() => useSolverStore.setState({ flows: flows as never }))

  it('lists one line per connection in connection order, then Receive from…, with the source colour, name and help', () => {
    twoSources()
    openList()
    expect(lines()).toEqual(['made-here', 'make-here', 'block', 'block', 'add-block', 'import'])
    expect(blockLines().map(l => l.getAttribute('data-connection-id'))).toEqual(['c1', 'c2'])
    expect(within(row('c1')).getByTestId('sources-block-name')).toHaveTextContent('Alpha')
    expect(within(row('c2')).getByTestId('sources-block-name')).toHaveTextContent('Beta')
    expect(within(row('c1')).getByTestId('sources-block-color')).toHaveStyle({ background: '#112233' })
    toggleLine(row('c2'))
    expect(detailOf(row('c2'))).toHaveTextContent("Receive it from a connected block, up to the connection's limit.")
    expect(within(line('add-block')).getByTestId('sources-receive-from')).toHaveAccessibleName('Receive from…')
    expect(within(line('add-block')).getByTestId('sources-receive-from')).toHaveAttribute('aria-haspopup', 'menu')
    expect(line('add-block')).not.toHaveTextContent('No connection')
  })

  it('lists only the connections of the item', () => {
    twoSources({ inputConnections: [{ id: 'c1', fromBlockId: 'alpha', itemId: 'ore' }, { id: 'cp', fromBlockId: 'beta', itemId: 'plate' }] })
    openList()
    expect(blockLines().map(l => l.getAttribute('data-connection-id'))).toEqual(['c1'])
  })

  it('keeps Make more here below the block lines and the Receive from… line with Receive it first', () => {
    twoSources({ sourceRules: { ore: { makeHere: 'after-blocks' } } })
    openList()
    expect(lines()).toEqual(['made-here', 'block', 'block', 'add-block', 'make-here', 'import'])
  })

  describe('the tag', () => {
    it('follows hasProduct(source) before the first solve, and offers Make it a product on an existing line without one', () => {
      twoSources()
      openList()
      expect(within(row('c1')).getByTestId('sources-block-tag')).toHaveAttribute('data-tag', 'requested')
      expect(within(row('c1')).getByTestId('sources-block-tag')).toHaveAttribute('data-tip', 'Alpha makes what this block needs of it.')
      expect(within(row('c2')).getByTestId('sources-block-tag')).toHaveAttribute('data-tag', 'existing')
      expect(within(row('c2')).getByTestId('sources-block-tag')).toHaveAttribute('data-tip', 'Beta only gives what it has left over.')
      toggleLine(row('c1'))
      expect(within(row('c1')).queryByTestId('sources-make-product')).toBeNull()
      toggleLine(row('c2'))
      expect(within(row('c2')).getByTestId('sources-make-product')).toHaveAccessibleName('Make it a product')
      expect(within(row('c1')).getByTestId('sources-block-rate')).toHaveTextContent('—')
    })

    it('follows the solver after a solve: a request that is ignored reads existing, with its reason', () => {
      twoSources()
      openList()
      setFlows(
        flow({ connectionId: 'c1', kind: 'take', requested: undefined, requestIgnored: 'source-receives', rate: 12 }),
        flow({ connectionId: 'c2', fromBlockId: 'beta', kind: 'request', rate: 18 }),
      )
      expect(within(row('c1')).getByTestId('sources-block-tag')).toHaveAttribute('data-tag', 'existing')
      expect(within(row('c1')).getByTestId('sources-block-tag')).toHaveAttribute('data-tip', expect.stringContaining('the source receives this item itself'))
      expect(within(row('c2')).getByTestId('sources-block-tag')).toHaveAttribute('data-tag', 'requested')
      expect(within(row('c1')).getByTestId('sources-block-rate')).toHaveTextContent('12')
      expect(within(row('c2')).getByTestId('sources-block-rate')).toHaveTextContent('18')
      // Alpha already has the product: the reason is the loop, not a missing product.
      toggleLine(row('c1'))
      expect(within(row('c1')).queryByTestId('sources-make-product')).toBeNull()
    })

    it('reads the status of the flow as the Ingredients pane does', () => {
      twoSources({ inputConnections: [{ id: 'c1', fromBlockId: 'alpha', itemId: 'ore', maxRate: 10 }, { id: 'c2', fromBlockId: 'beta', itemId: 'ore' }] })
      openList()
      setFlows(
        flow({ status: 'limited', capped: true, rate: 10, available: 10 }),
        flow({ connectionId: 'c2', fromBlockId: 'beta', status: 'unused', rate: 0 }),
      )
      expect(within(row('c1')).getByTestId('sources-status-mark')).toHaveAttribute('data-status', 'limited')
      toggleLine(row('c1'))
      expect(within(row('c1')).getByTestId('sources-block-status')).toHaveTextContent("Limited by this connection's limit of 10.0/m")
      toggleLine(row('c2'))
      expect(within(row('c2')).getByTestId('sources-block-status')).toHaveTextContent('not used')
    })

    it('disables Make it a product, with the reason, when the source receives the item itself', () => {
      twoSources()
      useBlockStore.setState(st => ({ blocks: st.blocks.map(b => (b.id === 'beta' ? { ...b, inputConnections: [{ id: 'cb', fromBlockId: 'alpha', itemId: 'ore' }] } : b)) }))
      openList()
      toggleLine(row('c2'))
      const action = within(row('c2')).getByTestId('sources-make-product')
      expect(action).toHaveAttribute('aria-disabled', 'true')
      expect(action.getAttribute('data-tip')).toMatch(/receives/)
      fireEvent.click(action)
      expect(screen.queryByTestId('product-change-confirm')).toBeNull()
    })

    it('Make it a product asks first, then adds the product on the source block, in that block\'s history', () => {
      twoSources()
      openList()
      toggleLine(row('c2'))
      fireEvent.click(within(row('c2')).getByTestId('sources-make-product'))
      expect(screen.getByTestId('product-change-confirm')).toBeInTheDocument()
      expect(byId('beta').products).toEqual([])
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(byId('beta').products).toEqual([])
      fireEvent.click(within(row('c2')).getByTestId('sources-make-product'))
      fireEvent.click(within(screen.getByTestId('product-change-confirm')).getByRole('button', { name: 'Make it a product' }))
      expect(byId('beta').products).toMatchObject([{ itemId: 'ore' }])
      expect(useBlockStore.getState().activeBlockId).toBe('main')
      expect(useBlockStore.getState().history.beta.undoStack).toHaveLength(1)
      expect(within(row('c2')).getByTestId('sources-block-tag')).toHaveAttribute('data-tag', 'requested')
      expect(within(row('c2')).queryByTestId('sources-make-product')).toBeNull()
    })
  })

  describe('a deleted source and a self-connection', () => {
    it('are listed greyed with Remove only', () => {
      twoSources({ inputConnections: [{ id: 'c1', fromBlockId: 'gone', itemId: 'ore' }, { id: 'c2', fromBlockId: 'main', itemId: 'ore' }, { id: 'c3', fromBlockId: 'alpha', itemId: 'ore' }] })
      openList()
      for (const id of ['c1', 'c2']) {
        const r = toggleLine(row(id))
        expect(r).toHaveAttribute('data-off', 'true')
        expect(r).not.toHaveAttribute('draggable')
        expect(within(r).queryByTestId('sources-block-tag')).toBeNull()
        expect(within(r).queryByTestId('sources-limit')).toBeNull()
        expect(within(r).queryByTestId('sources-block-move-up')).toBeNull()
        expect(within(r).queryByTestId('sources-make-product')).toBeNull()
        expect(within(r).getByTestId('sources-block-remove')).toBeInTheDocument()
      }
      expect(within(row('c1')).getByTestId('sources-block-name')).toHaveTextContent('(deleted block)')
      expect(within(row('c2')).getByTestId('sources-block-name')).toHaveTextContent('Main')
      expect(row('c3')).not.toHaveAttribute('data-off')
      toggleLine(row('c1'))
      expect(row('c1')).toHaveTextContent('the source block was deleted')
      toggleLine(row('c2'))
      expect(row('c2')).toHaveTextContent('a block cannot supply itself')
      toggleLine(row('c1'))
      fireEvent.click(within(row('c1')).getByTestId('sources-block-remove'))
      expect(order()).toEqual(['c2', 'c3'])
    })
  })

  describe('moving, removing and limiting', () => {
    it('Move up / Move down reorder the connections, disable at either end, and keep the focus on the moved line', () => {
      twoSources()
      openList()
      toggleLine(row('c2'))
      expect(within(row('c2')).getByTestId('sources-block-move-down')).toHaveAttribute('aria-disabled', 'true')
      toggleLine(row('c1'))
      expect(within(row('c1')).getByTestId('sources-block-move-up')).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(within(row('c1')).getByTestId('sources-block-move-up'))
      expect(order()).toEqual(['c1', 'c2'])
      const down = within(row('c1')).getByTestId('sources-block-move-down')
      act(() => down.focus())
      fireEvent.click(down)
      expect(order()).toEqual(['c2', 'c1'])
      expect(blockLines().map(l => l.getAttribute('data-connection-id'))).toEqual(['c2', 'c1'])
      // c1 is last now: Move down has nowhere to go, the focus is on Move up of the same line.
      expect(document.activeElement).toBe(within(row('c1')).getByTestId('sources-block-move-up'))
      fireEvent.click(document.activeElement as Element)
      expect(order()).toEqual(['c1', 'c2'])
      expect(document.activeElement).toBe(within(row('c1')).getByTestId('sources-block-move-down'))
      expect(useBlockStore.getState().history.main.undoStack).toHaveLength(2)
    })

    it('keeps the same button focused while the line has somewhere left to go', () => {
      const c = (id: string, from: string) => ({ id, fromBlockId: from, itemId: 'ore' })
      twoSources({ inputConnections: [c('c1', 'alpha'), c('c2', 'beta'), c('c3', 'alpha')] })
      openList()
      toggleLine(row('c3'))
      const up = within(row('c3')).getByTestId('sources-block-move-up')
      act(() => up.focus())
      fireEvent.click(up)
      expect(order()).toEqual(['c1', 'c3', 'c2'])
      expect(document.activeElement).toBe(within(row('c3')).getByTestId('sources-block-move-up'))
    })

    it('Remove removes the connection and gives the focus to Receive from…', () => {
      twoSources()
      openList()
      toggleLine(row('c1'))
      fireEvent.click(within(row('c1')).getByTestId('sources-block-remove'))
      expect(order()).toEqual(['c2'])
      expect(document.activeElement).toBe(screen.getByTestId('sources-receive-from'))
    })

    it('the limit field sets, changes and clears the limit of its connection', () => {
      twoSources()
      openList()
      toggleLine(row('c1'))
      const limit = () => mainBlock().inputConnections.find(c => c.id === 'c1')!.maxRate
      expect(within(row('c1')).getByTestId('sources-limit')).toHaveTextContent('No limit')
      fireEvent.click(within(row('c1')).getByTestId('sources-limit'))
      let input = screen.getByLabelText('Limit of Alpha')
      fireEvent.change(input, { target: { value: '20' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(limit()).toBe(20)
      expect(within(row('c1')).getByTestId('sources-limit')).toHaveTextContent('Limit 20.0/m')
      expect(document.activeElement).toBe(within(row('c1')).getByTestId('sources-limit'))
      fireEvent.click(within(row('c1')).getByTestId('sources-limit'))
      input = screen.getByLabelText('Limit of Alpha')
      fireEvent.change(input, { target: { value: '' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(limit()).toBeUndefined()
    })

    it('gives the focus back to the limit button after Enter, not after a blur', () => {
      twoSources()
      openList()
      toggleLine(row('c1'))
      const button = () => within(row('c1')).getByTestId('sources-limit')
      fireEvent.click(button())
      let input = screen.getByLabelText('Limit of Alpha')
      fireEvent.change(input, { target: { value: '20' } })
      fireEvent.blur(input)
      expect(button()).toHaveTextContent('Limit 20.0/m')
      expect(document.activeElement).not.toBe(button())
      fireEvent.click(button())
      input = screen.getByLabelText('Limit of Alpha')
      fireEvent.change(input, { target: { value: '30' } })
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(document.activeElement).toBe(button())
    })

    it('moves a block line with Alt+ArrowUp / Alt+ArrowDown from its name, the detail stays open and the focus follows', () => {
      twoSources()
      openList()
      toggleLine(row('c1'))
      const toggle = (id: string) => within(row(id)).getByTestId('sources-line-toggle')
      act(() => toggle('c1').focus())
      fireEvent.keyDown(toggle('c1'), { key: 'ArrowUp', altKey: true })
      expect(order()).toEqual(['c1', 'c2'])
      fireEvent.keyDown(toggle('c1'), { key: 'ArrowDown', altKey: true })
      expect(order()).toEqual(['c2', 'c1'])
      expect(blockLines().map(l => l.getAttribute('data-connection-id'))).toEqual(['c2', 'c1'])
      expect(document.activeElement).toBe(toggle('c1'))
      expect(toggle('c1')).toHaveAttribute('aria-expanded', 'true')
      expect(within(row('c1')).getByTestId('sources-detail')).toBeInTheDocument()
      fireEvent.keyDown(toggle('c1'), { key: 'ArrowDown', altKey: true })
      expect(order()).toEqual(['c2', 'c1'])
      // A plain arrow does nothing.
      fireEvent.keyDown(toggle('c1'), { key: 'ArrowUp' })
      expect(order()).toEqual(['c2', 'c1'])
    })

    it('reorders by drag: before the line it is dropped on the upper half of, after the lower half, last on Receive from…', () => {
      const c = (id: string, from: string) => ({ id, fromBlockId: from, itemId: 'ore' })
      twoSources({ inputConnections: [c('c1', 'alpha'), c('c2', 'beta'), c('c3', 'alpha')] })
      openList()
      const dt = () => ({ setData: () => {}, effectAllowed: '', dropEffect: '' })
      const at = (type: 'dragOver' | 'drop', el: Element, clientY: number) => {
        const ev = createEvent[type](el, { dataTransfer: dt() })
        Object.defineProperty(ev, 'clientY', { value: clientY })
        fireEvent(el, ev)
      }
      const rect = (el: Element) => { el.getBoundingClientRect = () => ({ top: 100, height: 20, bottom: 120, left: 0, right: 100, width: 100, x: 0, y: 100, toJSON: () => ({}) }) }
      for (const l of blockLines()) rect(l)
      rect(line('add-block'))

      fireEvent.dragStart(row('c3'), { dataTransfer: dt() })
      at('dragOver', row('c1'), 105)
      expect(within(row('c1')).getByTestId('sources-drop-line')).toHaveAttribute('data-side', 'before')
      at('drop', row('c1'), 105)
      expect(order()).toEqual(['c3', 'c1', 'c2'])

      fireEvent.dragStart(row('c3'), { dataTransfer: dt() })
      at('dragOver', row('c1'), 115)
      expect(within(row('c1')).getByTestId('sources-drop-line')).toHaveAttribute('data-side', 'after')
      at('drop', row('c1'), 115)
      expect(order()).toEqual(['c1', 'c3', 'c2'])

      // Where it already is: no line, no entry.
      const depth = useBlockStore.getState().history.main.undoStack.length
      fireEvent.dragStart(row('c3'), { dataTransfer: dt() })
      at('dragOver', row('c3'), 105)
      expect(screen.queryByTestId('sources-drop-line')).toBeNull()
      at('drop', row('c3'), 105)
      expect(useBlockStore.getState().history.main.undoStack).toHaveLength(depth)

      fireEvent.dragStart(row('c1'), { dataTransfer: dt() })
      at('dragOver', line('add-block'), 105)
      at('drop', line('add-block'), 105)
      expect(order()).toEqual(['c3', 'c2', 'c1'])
    })

    it('drops Make more here before the group on its upper half and after it on its lower half, over any line', () => {
      twoSources()
      openList()
      const dt = () => ({ setData: () => {}, effectAllowed: '', dropEffect: '' })
      const rect = (el: Element) => { el.getBoundingClientRect = () => ({ top: 100, height: 20, bottom: 120, left: 0, right: 100, width: 100, x: 0, y: 100, toJSON: () => ({}) }) }
      const at = (el: Element, clientY: number) => {
        const ev = createEvent.drop(el, { dataTransfer: dt() })
        Object.defineProperty(ev, 'clientY', { value: clientY })
        fireEvent(el, ev)
      }
      for (const l of [...blockLines(), line('add-block')]) rect(l)
      fireEvent.dragStart(line('make-here'), { dataTransfer: dt() })
      // Three rows (two lines and Receive from…): the lower half of the second line is past the middle.
      at(row('c2'), 115)
      expect(ruleOf()).toEqual({ makeHere: 'after-blocks' })
      fireEvent.dragStart(line('make-here'), { dataTransfer: dt() })
      at(row('c1'), 105)
      expect(ruleOf()).toBeUndefined()
    })
  })

  describe('Receive from…', () => {
    it('opens the connection menu for the item, and says there is no connection when there is none', () => {
      openList()
      expect(line('add-block')).toHaveTextContent('No connection for Ore.')
      fireEvent.click(screen.getByTestId('sources-receive-from'))
      expect(useUiStore.getState().connectionMenu).toMatchObject({ itemId: 'ore' })
    })
  })
})

describe('at area scope', () => {
  const NOW = '2026-01-01T00:00:00.000Z'
  const area = (id: string, recipe: string, rules?: Record<string, AreaSourceRule>): SubPlan => ({
    id, name: `Line ${id}`, nodes: [makeRecipeNode(recipe)], subPlans: [], area: true, createdAt: NOW, updatedAt: NOW,
    ...(rules ? { sourceRules: rules } : {}),
  })
  const areaRules = (id: string) => mainBlock().rootPlan.subPlans.find(sp => sp.id === id)?.sourceRules
  const setupAreas = (opts: { M1?: boolean; M2?: boolean; block?: Block['sourceRules']; connected?: boolean } = {}) => {
    const subs = [area('L', 'smelt'), ...(opts.M1 === false ? [] : [area('M1', 'ore-synth')]), ...(opts.M2 === false ? [] : [area('M2', 'ore-synth')])]
    const main: Block = {
      ...makeEmptyBlock('Main'), id: 'main', sourceRules: opts.block ?? {},
      ...(opts.connected ? { inputConnections: [{ id: 'c1', fromBlockId: 'src', itemId: 'ore' }] } : {}),
    }
    main.rootPlan = { ...main.rootPlan, nodes: [], subPlans: subs }
    const src: Block = { ...makeEmptyBlock('Src'), id: 'src', color: '#112233' }
    useBlockStore.setState({ blocks: [main, src], activeBlockId: 'main', history: {} })
  }
  const solve = (areaRoutes: AreaRoute[], unsatisfied: { itemId: string; rate: number }[] = []) => act(() => useSolverStore.setState({
    lastResults: { main: { nodes: [], unsatisfied, warnings: [], areaRoutes } as unknown as SolverResult },
  }))
  const openAreaList = () => {
    render(<ComesFrom itemId="ore" areaId="L" />)
    fireEvent.click(screen.getByRole('button', { name: 'Line L' }))
    fireEvent.click(screen.getByTestId('sources-button'))
  }
  const areaLine = (id: string) => screen.getAllByTestId('sources-line').find(l => l.getAttribute('data-area-id') === id)!
  const reading = (el: HTMLElement) => within(el).getByTestId('sources-rate').textContent
  const into = (from: string | undefined, rate: number, supplied?: number): AreaRoute => ({ itemId: 'ore', ...(from ? { from } : {}), to: 'L', rate, ...(supplied !== undefined ? { supplied } : {}) })

  it('lists one line per supplying area, in table order, each with its area', () => {
    setupAreas()
    openAreaList()
    expect(lines()).toEqual(['made-here', 'make-here', 'other-area', 'other-area', 'add-block', 'import'])
    expect(screen.getAllByTestId('sources-line').filter(l => l.getAttribute('data-line') === 'other-area').map(l => l.getAttribute('data-area-id'))).toEqual(['M1', 'M2'])
    expect(within(areaLine('M1')).getByText('Line M1')).toBeInTheDocument()
  })

  it('keeps the single read-only Other areas line at block scope', () => {
    setupAreas()
    render(<ComesFrom itemId="ore" />)
    fireEvent.click(screen.getByTestId('sources-button'))
    expect(lines()).toEqual(['made-here', 'make-here', 'other-areas', 'add-block', 'import'])
    expect(screen.queryByTestId('sources-area-switch')).not.toBeInTheDocument()
    expect(reading(line('other-areas'))).toBe('—')
  })

  it('reads the rate routed from each area, nothing when it sends none', () => {
    setupAreas()
    openAreaList()
    solve([into('M1', 12)])
    expect(reading(areaLine('M1'))).toBe('12.0/m')
    expect(reading(areaLine('M2'))).toBe('—')
    expect(within(areaLine('M2')).getByTestId('sources-status-mark')).toHaveAttribute('data-status', 'idle')
    expect(detailOf(toggleLine(areaLine('M2')))).toHaveTextContent('sends nothing now')
    for (const sw of screen.getAllByTestId('sources-area-switch')) expect(sw).toHaveAttribute('aria-checked', 'true')
  })

  it('reads nothing before a solve', () => {
    setupAreas()
    openAreaList()
    expect(reading(areaLine('M1'))).toBe('—')
    expect(screen.getByTestId('sources-foot-total')).toHaveTextContent('—')
  })

  it('switches an area off on the area rule only, and reads — for it', () => {
    setupAreas()
    openAreaList()
    solve([into('M1', 12)])
    fireEvent.click(within(areaLine('M1')).getByTestId('sources-area-switch'))
    expect(areaRules('L')).toEqual({ ore: { areasOff: ['M1'] } })
    expect(mainBlock().sourceRules).toEqual({})
    expect(reading(areaLine('M1'))).toBe('—')
    expect(areaLine('M1')).toHaveAttribute('data-off', 'true')
    expect(within(areaLine('M1')).getByTestId('sources-area-switch')).toHaveAttribute('aria-checked', 'false')
    expect(within(areaLine('M2')).getByTestId('sources-area-switch')).toHaveAttribute('aria-checked', 'true')
    // Switched back on, what is left repeats the block's rule: the area follows the block again.
    fireEvent.click(within(areaLine('M1')).getByTestId('sources-area-switch'))
    expect(areaRules('L')).toBeUndefined()
  })

  it('keeps a switched-off area listed though it makes nothing', () => {
    setupAreas({ M2: false })
    openAreaList()
    fireEvent.click(within(areaLine('M1')).getByTestId('sources-area-switch'))
    expect(areaLine('M1')).toBeInTheDocument()
    expect(within(areaLine('M1')).getByTestId('sources-area-switch')).toHaveAttribute('aria-checked', 'false')
  })

  it('writes Make more here to the area rule', () => {
    setupAreas()
    openAreaList()
    openLine('make-here')
    fireEvent.click(screen.getByTestId('sources-make-after'))
    expect(areaRules('L')).toEqual({ ore: { makeHere: 'after-blocks' } })
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(areaRules('L')).toEqual({ ore: { makeHere: 'off' } })
    expect(mainBlock().sourceRules).toEqual({})
  })

  it('writes Import to the area rule', () => {
    setupAreas()
    openAreaList()
    fireEvent.click(screen.getByTestId('sources-import-switch'))
    expect(areaRules('L')).toEqual({ ore: { importOff: true } })
    expect(mainBlock().sourceRules).toEqual({})
  })

  it('reads the Import figure of the area', () => {
    setupAreas()
    openAreaList()
    solve([into('M1', 3, undefined), into(undefined, 5, 0)])
    expect(reading(line('import'))).toBe('5.00/m')
    fireEvent.click(screen.getByTestId('sources-import-switch'))
    expect(reading(line('import'))).toBe('5.00/m')
    expect(detailOf(openLine('import'))).toHaveTextContent('Missing 5.00/m')
    expect(screen.getByTestId('sources-foot')).toHaveAttribute('data-missing', '5')
    expect(screen.getByTestId('sources-foot-missing')).toHaveTextContent('5.00/m missing')
  })

  it('reads none when no leg comes from outside', () => {
    setupAreas()
    openAreaList()
    solve([into('M1', 12)])
    expect(reading(line('import'))).toBe('—')
    expect(detailOf(openLine('import'))).toHaveTextContent('none')
  })

  it('reads the connection flow on its line and what reaches the area under the block lines', () => {
    setupAreas({ connected: true })
    openAreaList()
    act(() => useSolverStore.setState({
      flows: [{ connectionId: 'c1', fromBlockId: 'src', toBlockId: 'main', itemId: 'ore', available: 60, capped: false, rate: 12, status: 'ok', kind: 'take' }] as never,
    }))
    solve([into(undefined, 12, 9)])
    const blockLine = screen.getAllByTestId('sources-line').find(l => l.getAttribute('data-line') === 'block')!
    // The line reads its share of what reaches the area; the connection's whole rate is in the detail.
    expect(within(blockLine).getByTestId('sources-block-rate')).toHaveTextContent('9.00/m')
    toggleLine(blockLine)
    expect(within(blockLine).getByTestId('sources-detail-reading')).toHaveTextContent('12.0/m over this connection; 9.00/m of it reaches this area.')
    expect(reading(line('import'))).toBe('3.00/m')
    expect(screen.getByTestId('sources-foot')).toHaveTextContent('Reaches Line L')
  })

  it('reads what reaches the area from the leg and the block\'s unsatisfied rate when no area shares the item', () => {
    // Only Line L touches the item: nothing for the area LP to split.
    setupAreas({ connected: true, M1: false, M2: false })
    openAreaList()
    act(() => useSolverStore.setState({
      flows: [{ connectionId: 'c1', fromBlockId: 'src', toBlockId: 'main', itemId: 'ore', available: 60, capped: false, rate: 12, status: 'ok', kind: 'take' }] as never,
    }))
    solve([into(undefined, 12)])
    const blockLine = screen.getAllByTestId('sources-line').find(l => l.getAttribute('data-line') === 'block')!
    toggleLine(blockLine)
    expect(within(blockLine).getByTestId('sources-detail-reading')).toHaveTextContent('12.0/m of it reaches this area')
    solve([into(undefined, 12)], [{ itemId: 'ore', rate: 12 }])
    expect(within(blockLine).getByTestId('sources-detail-reading')).toHaveTextContent('none of it reaches this area')
    expect(reading(line('import'))).toBe('12.0/m')
  })

  it('makes the block lines read-only, with a button to the whole block', () => {
    setupAreas({ connected: true })
    openAreaList()
    const blockLine = screen.getAllByTestId('sources-line').find(l => l.getAttribute('data-line') === 'block')!
    toggleLine(blockLine)
    expect(detailOf(blockLine)).toHaveTextContent("Order, limit and Remove are the block's.")
    for (const id of ['sources-limit', 'sources-block-move-up', 'sources-block-move-down', 'sources-block-remove', 'sources-make-product']) {
      expect(within(blockLine).queryByTestId(id)).not.toBeInTheDocument()
    }
    expect(blockLine).not.toHaveAttribute('draggable')
    expect(within(blockLine).getByTestId('sources-block-name')).toHaveTextContent('Src')
    expect(screen.getByTestId('sources-receive-from')).toBeInTheDocument()
    fireEvent.click(within(blockLine).getByTestId('sources-whole-block'))
    expect(screen.getByRole('button', { name: 'Whole block' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('sources-whole-block')).not.toBeInTheDocument()
  })

  it('has one Other areas line saying so when no other area makes the item', () => {
    const main: Block = { ...makeEmptyBlock('Main'), id: 'main' }
    main.rootPlan = { ...main.rootPlan, nodes: [], subPlans: [area('L', 'smelt'), area('M1', 'smelt')] }
    useBlockStore.setState({ blocks: [main], activeBlockId: 'main', history: {} })
    openAreaList()
    expect(lines()).toEqual(['made-here', 'make-here', 'other-areas', 'add-block', 'import'])
    expect(detailOf(openLine('other-areas'))).toHaveTextContent('No other area makes Ore.')
  })

  it('remembers the side of Make more here per scope', () => {
    setupAreas()
    openAreaList()
    openLine('make-here')
    fireEvent.click(screen.getByTestId('sources-make-after'))
    expect(lines()).toEqual(['made-here', 'add-block', 'make-here', 'other-area', 'other-area', 'import'])
    expect(useUiStore.getState().sourcesSides['main/L:ore']).toBe('below')
    expect(useUiStore.getState().sourcesSides['main:ore']).toBeUndefined()
  })

  it('draws the list of the block when the area flag goes off', () => {
    setupAreas()
    openAreaList()
    act(() => useBlockStore.setState(s => ({
      blocks: s.blocks.map(b => b.id === 'main' ? { ...b, rootPlan: { ...b.rootPlan, subPlans: [] } } : b),
    })))
    expect(screen.queryByTestId('sources-area-switch')).not.toBeInTheDocument()
  })
})

describe('what the rate column and the foot read', () => {
  const synthId = () => mainBlock().rootPlan.nodes.find(n => n.kind === 'game-recipe' && n.recipeId === 'ore-synth')!.id
  const alpha = (): Block => ({ ...makeEmptyBlock('Alpha'), id: 'alpha', color: '#112233', products: [{ id: 'pa', itemId: 'ore' }] })
  const dear = (): Block => ({ ...makeEmptyBlock('Dear'), id: 'dear', color: '#445566' })
  const flowOf = (connectionId: string, fromBlockId: string, rate: number) => ({
    connectionId, fromBlockId, toBlockId: 'main', itemId: 'ore', available: 60, capped: false, rate, status: 'ok', kind: 'take',
  })

  /** The rows use 100 Ore/min: 30 from Alpha, none from Dear, 10 imported, the rest made by the row that makes it. */
  function solvedMix() {
    const main: Block = {
      ...makeEmptyBlock('Main'), id: 'main',
      inputConnections: [{ id: 'c1', fromBlockId: 'alpha', itemId: 'ore' }, { id: 'c2', fromBlockId: 'dear', itemId: 'ore' }],
    }
    main.rootPlan = { ...main.rootPlan, nodes: [makeRecipeNode('smelt'), makeRecipeNode('ore-synth')] }
    useBlockStore.setState({ blocks: [main, alpha(), dear()], activeBlockId: 'main', history: {} })
    act(() => useSolverStore.setState({ flows: [flowOf('c1', 'alpha', 30), flowOf('c2', 'dear', 0)] as never }))
    solvedNodes([{ recipeNodeId: synthId(), machineCountCeil: 1, inputRates: { ore: 100 }, outputRates: { ore: 60 } }], { unsatisfied: [{ itemId: 'ore', rate: 10 }] as never })
  }

  it('reads each line\'s consumed share: the rate column, with — for a zero except on a block line', () => {
    solvedMix()
    openList()
    expect(rateOf(line('made-here'))).toBe('—')
    expect(rateOf(line('make-here'))).toBe('60.0/m')
    const [c1, c2] = screen.getAllByTestId('sources-line').filter(l => l.getAttribute('data-line') === 'block')
    expect(rateOf(c1)).toBe('30.0/m')
    expect(rateOf(c2)).toBe('0.00/m')
    expect(rateOf(line('import'))).toBe('10.0/m')
  })

  it('adds the lines up in the foot', () => {
    solvedMix()
    openList()
    const foot = screen.getByTestId('sources-foot')
    expect(foot).toHaveAttribute('data-total', '100')
    expect(foot).toHaveAttribute('data-missing', '0')
    expect(foot).toHaveTextContent('Reaches the rows')
    expect(screen.getByTestId('sources-foot-total')).toHaveTextContent('100/m')
    expect(screen.queryByTestId('sources-foot-missing')).toBeNull()
    expect(screen.getAllByTestId('sources-line').at(-1)!.nextElementSibling).toBe(foot)
  })

  it('names what is missing in the foot with Import off, and still reaches the need', () => {
    solvedMix()
    openList()
    fireEvent.click(screen.getByTestId('sources-import-switch'))
    expect(screen.getByTestId('sources-foot')).toHaveAttribute('data-missing', '10')
    expect(screen.getByTestId('sources-foot-missing')).toHaveTextContent('10.0/m missing')
    expect(screen.getByTestId('sources-foot-total')).toHaveTextContent('100/m')
  })

  it('reads — in the foot before the first solve', () => {
    openList()
    expect(screen.getByTestId('sources-foot-total')).toHaveTextContent('—')
    expect(rateOf(line('make-here'))).toBe('—')
  })

  it('has the rail behind the rows', () => {
    openList()
    expect(screen.getByTestId('sources-list').querySelector(':scope > span[aria-hidden="true"]')).toHaveClass('w-0.5')
  })
})

describe('the bar of the header', () => {
  it('draws one part per supplying line, in list order, with its kind and a tooltip "label rate"', () => {
    const alpha: Block = { ...makeEmptyBlock('Alpha'), id: 'alpha', color: '#112233', products: [{ id: 'pa', itemId: 'ore' }] }
    const main: Block = { ...makeEmptyBlock('Main'), id: 'main', inputConnections: [{ id: 'c1', fromBlockId: 'alpha', itemId: 'ore' }] }
    main.rootPlan = { ...main.rootPlan, nodes: [makeRecipeNode('smelt'), makeRecipeNode('ore-synth')] }
    useBlockStore.setState({ blocks: [main, alpha], activeBlockId: 'main', history: {} })
    const synth = main.rootPlan.nodes.find(n => n.kind === 'game-recipe' && n.recipeId === 'ore-synth')!.id
    act(() => useSolverStore.setState({
      flows: [{ connectionId: 'c1', fromBlockId: 'alpha', toBlockId: 'main', itemId: 'ore', available: 60, capped: false, rate: 30, status: 'ok', kind: 'take' }] as never,
    }))
    solvedNodes([{ recipeNodeId: synth, inputRates: { ore: 100 }, outputRates: { ore: 60 } }], { unsatisfied: [{ itemId: 'ore', rate: 10 }] as never })
    render(<ComesFrom itemId="ore" initialListOpen />)
    const bar = screen.getByTestId('comes-from-bar')
    expect(bar).toHaveAttribute('data-need', '100')
    const parts = within(bar).getAllByTestId('comes-from-bar-segment')
    expect(parts.map(p => p.getAttribute('data-kind'))).toEqual(['made', 'block', 'import'])
    expect(parts.map(p => p.getAttribute('data-key'))).toEqual(['make-here', 'block:c1', 'import'])
    expect(within(parts[1]).getByTestId('summary-segment-tip')).toHaveTextContent('Alpha 30.0/m')
    expect(within(parts[0]).getByTestId('summary-segment-tip')).toHaveTextContent('Make more here 60.0/m')
    expect(parts[1]).toHaveAccessibleName('Alpha · 30.0/m')
    expect(within(bar).getByRole('group', { name: 'Sources of Ore by line' })).toHaveClass('h-2')
    // Not a stop for the keyboard.
    for (const p of parts) expect(p).not.toHaveAttribute('tabindex')
  })

  it('draws an empty track before the first solve, and the missing share as Missing with Import off', () => {
    openList()
    expect(screen.queryByTestId('comes-from-bar-segment')).toBeNull()
    expect(screen.getByTestId('comes-from-bar')).not.toHaveAttribute('data-need')
    const synth = mainBlock().rootPlan.nodes.find(n => n.kind === 'game-recipe' && n.recipeId === 'ore-synth')!.id
    solvedNodes([{ recipeNodeId: synth, inputRates: { ore: 20 } }], { unsatisfied: [{ itemId: 'ore', rate: 20 }] as never })
    fireEvent.click(screen.getByTestId('sources-import-switch'))
    const [missing] = screen.getAllByTestId('comes-from-bar-segment')
    expect(missing).toHaveAttribute('data-kind', 'missing')
    expect(within(missing).getByTestId('summary-segment-tip')).toHaveTextContent('Missing 20.0/m')
  })
})
