import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, createEvent, within, act } from '@testing-library/react'
import { ComesFrom } from './ComesFrom'
import { ComesFromPopover } from './ComesFromPopover'
import { sourcesLineOrder } from './itemSourcing'
import { useBlockStore, makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { Block, GameData, SolverResult } from '../../data/types'

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
const checkedPreset = () => screen.getAllByRole('radio').find(r => r.getAttribute('aria-checked') === 'true')!.getAttribute('data-sourcing-choice')!

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
    expect(button).toHaveTextContent('Sources…')
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
  const STATES: { name: string; rule: Block['sourceRules'][string] | undefined; preset: string; order: string[]; make: boolean; imp: boolean }[] = [
    { name: 'Make it here', rule: undefined, preset: 'own', order: ['made-here', 'make-here', 'add-block', 'import'], make: true, imp: true },
    { name: 'Make it here, Import off', rule: { importOff: true }, preset: 'own', order: ['made-here', 'make-here', 'add-block', 'import'], make: true, imp: false },
    { name: 'Receive it first', rule: { makeHere: 'after-blocks' }, preset: 'connections-first', order: ['made-here', 'add-block', 'make-here', 'import'], make: true, imp: true },
    { name: 'Receive it first, Import off', rule: { makeHere: 'after-blocks', importOff: true }, preset: 'connections-first', order: ['made-here', 'add-block', 'make-here', 'import'], make: true, imp: false },
    { name: "Don't make more here", rule: { makeHere: 'off' }, preset: 'byproducts-first', order: ['made-here', 'make-here', 'add-block', 'import'], make: false, imp: true },
    { name: "Don't make more here, Import off", rule: { makeHere: 'off', importOff: true }, preset: 'byproducts-first', order: ['made-here', 'make-here', 'add-block', 'import'], make: false, imp: false },
  ]

  for (const s of STATES) {
    it(`reads ${s.name} from the stored rule`, () => {
      setup({ sourceRules: s.rule ? { ore: s.rule } : {} })
      openList()
      expect(checkedPreset()).toBe(s.preset)
      expect(lines()).toEqual(s.order)
      expect(screen.getByTestId('sources-make-here-switch')).toHaveAttribute('aria-checked', String(s.make))
      expect(screen.getByTestId('sources-import-switch')).toHaveAttribute('aria-checked', String(s.imp))
      expect(line('make-here').hasAttribute('data-off')).toBe(!s.make)
    })

    it(`reaches ${s.name} from the list`, () => {
      // From Make it here, with Import on: Move down, the two switches.
      openList()
      if (s.rule?.makeHere === 'after-blocks') fireEvent.click(screen.getByTestId('sources-move-down'))
      if (s.rule?.makeHere === 'off') fireEvent.click(screen.getByTestId('sources-make-here-switch'))
      if (s.rule?.importOff) fireEvent.click(screen.getByTestId('sources-import-switch'))
      expect(ruleOf()).toEqual(s.rule)
      expect(checkedPreset()).toBe(s.preset)
      expect(lines()).toEqual(s.order)
    })

    it(`shows the list of ${s.name} after the presets (and the Import switch of the control) chose it`, () => {
      openList()
      fireEvent.click(document.querySelector(`[data-sourcing-choice="${s.preset}"]`)!)
      if (s.rule?.importOff) fireEvent.click(screen.getByTestId('import-switch'))
      expect(ruleOf()).toEqual(s.rule)
      expect(lines()).toEqual(s.order)
      expect(screen.getByTestId('sources-make-here-switch')).toHaveAttribute('aria-checked', String(s.make))
      expect(screen.getByTestId('sources-import-switch')).toHaveAttribute('aria-checked', String(s.imp))
    })
  }

  it('moves Make more here below with Receive it first, switches it off with Don\'t make more here, and on again with Make it here', () => {
    openList()
    fireEvent.click(screen.getByTestId('sources-move-down'))
    expect(ruleOf()).toEqual({ makeHere: 'after-blocks' })
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(ruleOf()).toEqual({ makeHere: 'off' })
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(ruleOf()).toBeUndefined()
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
    openList()
    fireEvent.click(screen.getByTestId('import-switch'))
    expect(screen.getByTestId('sources-import-switch')).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(screen.getByTestId('sources-import-switch'))
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

describe('the move buttons', () => {
  it('disable the direction that has no place to go, and do nothing while Make more here is off', () => {
    openList()
    expect(screen.getByTestId('sources-move-up')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('sources-move-down')).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(screen.getByTestId('sources-move-up'))
    expect(ruleOf()).toBeUndefined()
    fireEvent.click(screen.getByTestId('sources-move-down'))
    expect(screen.getByTestId('sources-move-up')).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByTestId('sources-move-down')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByTestId('sources-move-up'))
    expect(ruleOf()).toBeUndefined()
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    fireEvent.click(screen.getByTestId('sources-move-down'))
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

describe('help', () => {
  it('shows a help line under the line that has the focus, from SOURCES_LINES', () => {
    openList()
    expect(screen.queryByTestId('sources-help')).toBeNull()
    act(() => line('make-here').focus())
    expect(within(line('make-here')).getByTestId('sources-help')).toHaveTextContent("Run this block's rows, or more of them, for this item. Adds machines.")
    act(() => line('import').focus())
    expect(screen.getAllByTestId('sources-help')).toHaveLength(1)
    expect(within(line('import')).getByTestId('sources-help')).toHaveTextContent('Bring it in from outside the plan. Off: what the other sources leave is shown as missing.')
    act(() => line('import').blur())
    expect(screen.queryByTestId('sources-help')).toBeNull()
  })

  it('names every line with its tooltip, the block lines and the Receive from line with the Other blocks help', () => {
    openList()
    expect(within(line('made-here')).getByRole('tooltip')).toHaveTextContent("What this block's rows already make while running for something else")
    expect(within(line('add-block')).getByRole('tooltip')).toHaveTextContent("Receive it from a connected block, up to the connection's limit.")
  })
})

describe('what the lines read', () => {
  function solved(over: Partial<SolverResult> = {}) {
    act(() => useSolverStore.setState({
      lastResults: {
        main: {
          nodes: [],
          unsatisfied: [],
          warnings: [],
          ...over,
        } as SolverResult,
      },
    }))
  }

  it('reads nothing yet, no row here makes it, and the connection count', () => {
    const main = mainBlock()
    useBlockStore.setState({ blocks: [{ ...main, rootPlan: { ...main.rootPlan, nodes: main.rootPlan.nodes.filter(n => n.kind === 'game-recipe' && n.recipeId === 'smelt') } }] })
    openList()
    expect(line('made-here')).toHaveTextContent('nothing yet')
    expect(line('make-here')).toHaveTextContent('no row here makes it')
    expect(line('add-block')).toHaveTextContent('No connection for Ore.')
  })

  it('lists the dedicated rows under Make more here', () => {
    openList()
    expect(line('make-here')).toHaveTextContent('Ore Synth')
    expect(line('make-here')).not.toHaveTextContent('×')
  })

  it('lists the rows making it at a rate above 0 under Don\'t make more here, the byproduct ones otherwise', () => {
    const nodes = mainBlock().rootPlan.nodes
    const synth = nodes.find(n => n.kind === 'game-recipe' && n.recipeId === 'ore-synth')!.id
    solved({ nodes: [{ recipeNodeId: synth, machineCountCeil: 2, outputRates: { ore: 30 } } as never] })
    openList()
    // The row is dedicated to Ore: not "already made" under Make it here.
    expect(line('made-here')).toHaveTextContent('nothing yet')
    fireEvent.click(screen.getByTestId('sources-make-here-switch'))
    expect(line('made-here')).toHaveTextContent('Ore Synth')
    expect(line('made-here')).toHaveTextContent('30')
  })

  it('reads the imported rate, and Missing with Import off', () => {
    solved({ unsatisfied: [{ itemId: 'ore', rate: 12 } as never] })
    openList()
    expect(line('import')).toHaveTextContent('12')
    expect(line('import')).not.toHaveTextContent('Missing')
    fireEvent.click(screen.getByTestId('sources-import-switch'))
    expect(line('import')).toHaveTextContent('Missing')
    expect(line('import')).toHaveTextContent('12')
  })
})

describe('a solved dedicated row', () => {
  it('reads its machine count, and the recipe alone while it is idle', () => {
    const synth = mainBlock().rootPlan.nodes.find(n => n.kind === 'game-recipe' && n.recipeId === 'ore-synth')!.id
    act(() => useSolverStore.setState({
      lastResults: { main: { nodes: [{ recipeNodeId: synth, machineCountCeil: 2, outputRates: { ore: 30 } }], unsatisfied: [], warnings: [] } as unknown as SolverResult },
    }))
    openList()
    expect(line('make-here')).toHaveTextContent('Ore Synth (2 × machine)')
    act(() => useSolverStore.setState({
      lastResults: { main: { nodes: [{ recipeNodeId: synth, machineCountCeil: 0, outputRates: {} }], unsatisfied: [], warnings: [] } as unknown as SolverResult },
    }))
    expect(line('make-here')).not.toHaveTextContent('×')
  })
})

describe('history', () => {
  const stack = () => useBlockStore.getState().history.main?.undoStack.length ?? 0

  it('makes one undoable entry per action, and undo restores the preset and the side', () => {
    openList()
    const steps = ['sources-move-down', 'sources-make-here-switch', 'sources-make-here-switch', 'sources-import-switch']
    const before: { preset: string; order: (string | null)[] }[] = []
    steps.forEach((testId, i) => {
      before.push({ preset: checkedPreset(), order: lines() })
      fireEvent.click(screen.getByTestId(testId))
      expect(stack(), `entry after step ${i}`).toBe(i + 1)
    })
    for (let i = steps.length - 1; i >= 0; i--) {
      act(() => useBlockStore.getState().undo())
      expect(checkedPreset()).toBe(before[i].preset)
      // A switched-off line has no stored side: undoing back into it draws it where it was drawn last, not where it was.
      if (before[i].preset !== 'byproducts-first') expect(lines()).toEqual(before[i].order)
    }
    expect(ruleOf()).toBeUndefined()
  })

  it('adds no entry for a move that goes nowhere', () => {
    openList()
    fireEvent.click(screen.getByTestId('sources-move-up'))
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
  it('stays in the Make more here line after a move: on the other move button, and on the switch after a switch', () => {
    openList()
    expect(lines()).toEqual(TOP)
    const down = screen.getByTestId('sources-move-down')
    act(() => down.focus())
    fireEvent.click(down)
    expect(document.activeElement).toBe(screen.getByTestId('sources-move-up'))
    expect(line('make-here').contains(document.activeElement)).toBe(true)
    fireEvent.click(screen.getByTestId('sources-move-up'))
    expect(document.activeElement).toBe(screen.getByTestId('sources-move-down'))
    const sw = screen.getByTestId('sources-make-here-switch')
    act(() => sw.focus())
    fireEvent.click(sw)
    expect(document.activeElement).toBe(sw)
  })

  it('reaches every action and line with the keyboard: buttons and focusable lines, none out of the tab order', () => {
    openList()
    for (const id of ['sources-move-up', 'sources-move-down', 'sources-make-here-switch', 'sources-import-switch']) {
      const el = screen.getByTestId(id)
      expect(el.tagName).toBe('BUTTON')
      expect(el).not.toBeDisabled()
      expect(el.getAttribute('tabindex')).toBeNull()
    }
    for (const l of screen.getAllByTestId('sources-line')) expect(l).toHaveAttribute('tabindex', '0')
  })
})

describe('the description of a line', () => {
  it('is one tooltip, set on the line and on its controls, and the help line is hidden from assistive tech', () => {
    openList()
    const tip = within(line('make-here')).getByRole('tooltip')
    expect(line('make-here')).toHaveAttribute('aria-describedby', tip.id)
    expect(screen.getByTestId('sources-make-here-switch')).toHaveAttribute('aria-describedby', tip.id)
    act(() => line('make-here').focus())
    expect(screen.getByTestId('sources-help')).toHaveAttribute('aria-hidden', 'true')
    // The tooltip shows on hover only for a line: the keyboard has the help line.
    expect(tip.className).not.toContain('focus-visible')
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
    expect(within(row('c2')).getByRole('tooltip')).toHaveTextContent("Receive it from a connected block, up to the connection's limit.")
    expect(line('add-block')).toHaveTextContent('Receive from…')
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
      expect(within(row('c1')).getByTestId('sources-block-tag')).toHaveAttribute('title', 'Alpha makes what this block needs of it.')
      expect(within(row('c2')).getByTestId('sources-block-tag')).toHaveAttribute('data-tag', 'existing')
      expect(within(row('c2')).getByTestId('sources-block-tag')).toHaveAttribute('title', 'Beta only gives what it has left over.')
      expect(within(row('c1')).queryByTestId('sources-make-product')).toBeNull()
      expect(within(row('c2')).getByTestId('sources-make-product')).toHaveTextContent('Make it a product')
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
      expect(within(row('c1')).getByTestId('sources-block-tag')).toHaveAttribute('title', expect.stringContaining('the source receives this item itself'))
      expect(within(row('c2')).getByTestId('sources-block-tag')).toHaveAttribute('data-tag', 'requested')
      expect(within(row('c1')).getByTestId('sources-block-rate')).toHaveTextContent('12')
      expect(within(row('c2')).getByTestId('sources-block-rate')).toHaveTextContent('18')
      // Alpha already has the product: the reason is the loop, not a missing product.
      expect(within(row('c1')).queryByTestId('sources-make-product')).toBeNull()
    })

    it('reads the status of the flow as the Ingredients pane does', () => {
      twoSources({ inputConnections: [{ id: 'c1', fromBlockId: 'alpha', itemId: 'ore', maxRate: 10 }, { id: 'c2', fromBlockId: 'beta', itemId: 'ore' }] })
      openList()
      setFlows(
        flow({ status: 'limited', capped: true, rate: 10, available: 10 }),
        flow({ connectionId: 'c2', fromBlockId: 'beta', status: 'unused', rate: 0 }),
      )
      expect(within(row('c1')).getByTestId('sources-block-status')).toHaveTextContent("Limited by this connection's limit of 10.0/m")
      expect(within(row('c2')).getByTestId('sources-block-status')).toHaveTextContent('not used')
    })

    it('Make it a product asks first, then adds the product on the source block, in that block\'s history', () => {
      twoSources()
      openList()
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
        const r = row(id)
        expect(r).toHaveAttribute('data-off', 'true')
        expect(r).not.toHaveAttribute('draggable')
        expect(within(r).queryByTestId('sources-block-tag')).toBeNull()
        expect(within(r).queryByTestId('sources-limit')).toBeNull()
        expect(within(r).queryByTestId('sources-block-move-up')).toBeNull()
        expect(within(r).queryByTestId('sources-make-product')).toBeNull()
        expect(within(r).getByTestId('sources-block-remove')).toBeInTheDocument()
      }
      expect(within(row('c1')).getByTestId('sources-block-name')).toHaveTextContent('(deleted block)')
      expect(row('c1')).toHaveTextContent('the source block was deleted')
      expect(within(row('c2')).getByTestId('sources-block-name')).toHaveTextContent('Main')
      expect(row('c2')).toHaveTextContent('a block cannot supply itself')
      expect(row('c3')).not.toHaveAttribute('data-off')
      fireEvent.click(within(row('c1')).getByTestId('sources-block-remove'))
      expect(order()).toEqual(['c2', 'c3'])
    })
  })

  describe('moving, removing and limiting', () => {
    it('Move up / Move down reorder the connections, disable at either end, and keep the focus on the moved line', () => {
      twoSources()
      openList()
      expect(within(row('c1')).getByTestId('sources-block-move-up')).toHaveAttribute('aria-disabled', 'true')
      expect(within(row('c2')).getByTestId('sources-block-move-down')).toHaveAttribute('aria-disabled', 'true')
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
      const up = within(row('c3')).getByTestId('sources-block-move-up')
      act(() => up.focus())
      fireEvent.click(up)
      expect(order()).toEqual(['c1', 'c3', 'c2'])
      expect(document.activeElement).toBe(within(row('c3')).getByTestId('sources-block-move-up'))
    })

    it('Remove removes the connection and gives the focus to Receive from…', () => {
      twoSources()
      openList()
      fireEvent.click(within(row('c1')).getByTestId('sources-block-remove'))
      expect(order()).toEqual(['c2'])
      expect(document.activeElement).toBe(screen.getByTestId('sources-receive-from'))
    })

    it('the limit field sets, changes and clears the limit of its connection', () => {
      twoSources()
      openList()
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
