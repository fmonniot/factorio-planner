import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { ComesFromPopover } from './ComesFromPopover'
import { FactorySummary } from './FactorySummary'
import { useBlockStore, makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import type { PopoverAnchor } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { Block, GameData } from '../../data/types'

// Ore Synth makes Ore and Smelt turns it into Plate, so Ore is an intermediate of the block (no Ingredients slot) and a block
// "Source" can send it.
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

const anchor: PopoverAnchor = { rect: { left: 100, top: 100, right: 160, bottom: 120 }, avoid: null }

function setup(over: Partial<Block> = {}) {
  const source: Block = { ...makeEmptyBlock('Source'), id: 'source', products: [{ id: 'p', itemId: 'ore' }] }
  const main: Block = { ...makeEmptyBlock('Main'), id: 'main', ...over }
  main.rootPlan = { ...main.rootPlan, nodes: [makeRecipeNode('smelt'), makeRecipeNode('ore-synth')] }
  useBlockStore.setState({ blocks: [main, source], activeBlockId: 'main', history: {} })
  useUiStore.setState({
    rateUnit: 'min', summaryCollapsed: false, ingredientSlotRequest: null, selectedRow: null,
    comesFromPopover: null, connectionMenu: null,
  })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: gameData(), sourceId: 'test' } })
  useSolverStore.setState({ status: { type: 'idle' }, lastResult: undefined, lastResults: {}, flows: [], _setStatus: () => {} })
}

const open = (itemId: string) => act(() => useUiStore.getState().openComesFrom(itemId, anchor))
const popover = () => screen.getByTestId('comes-from-popover')
const mainBlock = () => useBlockStore.getState().blocks.find(b => b.id === 'main')!

beforeEach(() => setup())
afterEach(() => vi.restoreAllMocks())

describe('ComesFromPopover', () => {
  it('draws nothing until it is opened', () => {
    render(<ComesFromPopover hasSlot={() => false} />)
    expect(screen.queryByTestId('comes-from-popover')).not.toBeInTheDocument()
  })

  it('opens for an item with no slot, names the item and whose rule it is, and focuses the chosen preset', () => {
    render(<ComesFromPopover hasSlot={() => false} />)
    open('ore')
    expect(popover()).toHaveAccessibleName('Ore')
    expect(popover()).toHaveAttribute('data-item-id', 'ore')
    expect(popover()).toHaveTextContent('Applies to every row of this block')
    const control = within(popover()).getByTestId('comes-from')
    expect(document.activeElement).toBe(within(control).getByRole('radio', { name: 'Make it here' }))
    // No slot, so nothing to link to.
    expect(within(popover()).queryByTestId('comes-from-show-slot')).not.toBeInTheDocument()
  })

  it('sets the rule of the block from the control', () => {
    render(<ComesFromPopover hasSlot={() => false} />)
    open('ore')
    fireEvent.click(within(popover()).getByRole('radio', { name: "Don't make more here" }))
    expect(mainBlock().itemSourcing).toEqual({ ore: 'byproducts-first' })
    // It stays open, and the same on another item.
    expect(popover()).toBeInTheDocument()
  })

  it('links to the slot when the item has one: it closes and asks the pane for the slot', () => {
    render(<ComesFromPopover hasSlot={id => id === 'ore'} />)
    open('ore')
    fireEvent.click(within(popover()).getByTestId('comes-from-show-slot'))
    expect(screen.queryByTestId('comes-from-popover')).not.toBeInTheDocument()
    expect(useUiStore.getState().comesFromPopover).toBeNull()
    expect(useUiStore.getState().ingredientSlotRequest).toMatchObject({ itemId: 'ore' })
  })

  it('closes on Escape and gives the focus back to what had it, and on its close button', () => {
    render(<button type="button">Change…</button>)
    const trigger = screen.getByRole('button', { name: 'Change…' })
    trigger.focus()
    render(<ComesFromPopover hasSlot={() => false} />)
    open('ore')
    expect(trigger).not.toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('comes-from-popover')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    open('ore')
    fireEvent.click(within(popover()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('comes-from-popover')).not.toBeInTheDocument()
  })

  it('gives the focus to the anchor when what had it is gone (a menu entry that opened the popover)', () => {
    render(<button type="button">Chip</button>)
    const chip = screen.getByRole('button', { name: 'Chip' })
    render(<ComesFromPopover hasSlot={() => false} />)
    // Nothing is focused when it opens, as after a menu closed with its choice.
    act(() => useUiStore.getState().openComesFrom('ore', { ...anchor, el: chip }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(chip).toHaveFocus()
  })

  it('closes on a press outside, not on a press inside', () => {
    render(<ComesFromPopover hasSlot={() => false} />)
    open('ore')
    fireEvent.mouseDown(within(popover()).getByTestId('comes-from'))
    expect(popover()).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('comes-from-popover')).not.toBeInTheDocument()
  })

  it('closes with a block change, and follows another item that asks', () => {
    render(<ComesFromPopover hasSlot={() => false} />)
    open('ore')
    open('plate')
    expect(popover()).toHaveAccessibleName('Plate')
    act(() => useBlockStore.setState({ activeBlockId: 'source' }))
    expect(screen.queryByTestId('comes-from-popover')).not.toBeInTheDocument()
  })

  it('keeps Tab inside itself', () => {
    render(<ComesFromPopover hasSlot={() => true} />)
    open('ore')
    const controls = [...popover().querySelectorAll<HTMLElement>('button:not([tabindex="-1"]):not(:disabled)')]
    const last = controls[controls.length - 1]
    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(controls[0])
    fireEvent.keyDown(controls[0], { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('stays inside the window: it flips above an anchor near the bottom and aligns right at the right edge', () => {
    const w = 340
    const h = 150
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(w)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(h)
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(700)
    render(<ComesFromPopover hasSlot={() => false} />)
    act(() => useUiStore.getState().openComesFrom('ore', { rect: { left: 900, top: 650, right: 960, bottom: 670 }, avoid: null }))
    // Right edges aligned (960 - 340), and above the anchor (650 - 150 - 6).
    expect(popover().style.left).toBe('620px')
    expect(popover().style.top).toBe('494px')
    // From the side panel it opens to the panel's left, level with the button.
    act(() => useUiStore.getState().openComesFrom('ore', {
      rect: { left: 900, top: 300, right: 960, bottom: 320 }, avoid: { left: 700, top: 0, right: 1000, bottom: 700 },
    }))
    expect(popover().style.left).toBe('354px')
    expect(popover().style.top).toBe('292px')
  })
})

describe('Receive from… in the popover', () => {
  const menu = () => screen.queryByRole('menu')

  function openWithNoConnection() {
    setup({ itemSourcing: { ore: 'connections-first' } })
    render(<FactorySummary />)
    open('ore')
    return within(popover()).getByTestId('no-effect')
  }

  it('is offered on a "No connection" line, beside Remove, and not on another reason', () => {
    const line = openWithNoConnection()
    expect(line).toHaveTextContent('No connection for Ore.')
    expect(within(line).getByTestId('receive-from')).toHaveTextContent('Receive from…')
    expect(within(line).getByRole('button', { name: 'Remove' })).toBeInTheDocument()
    // An item no row makes (the rule has another reason not to act) gets no such button.
    act(() => useUiStore.getState().closeComesFrom())
    setup({ itemSourcing: { plate: 'byproducts-first' } })
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => b.id === 'main' ? { ...b, products: [{ id: 'q', itemId: 'plate' }] } : b) }))
    open('plate')
    expect(within(popover()).getByTestId('no-effect')).toHaveTextContent('Plate is a product of this block')
    expect(within(popover()).queryByTestId('receive-from')).not.toBeInTheDocument()
  })

  it('opens the connection menu for the item, and a choice connects it while the popover stays open', () => {
    const line = openWithNoConnection()
    fireEvent.click(within(line).getByTestId('receive-from'))
    expect(useUiStore.getState().connectionMenu).toMatchObject({ itemId: 'ore' })
    const items = within(menu()!).getAllByRole('menuitem')
    expect(items.map(i => i.textContent)).toContain('Source')
    fireEvent.click(within(menu()!).getByRole('menuitem', { name: /Source/ }))
    expect(mainBlock().inputConnections).toEqual([expect.objectContaining({ itemId: 'ore', fromBlockId: 'source' })])
    expect(useUiStore.getState().connectionMenu).toBeNull()
    expect(popover()).toBeInTheDocument()
  })

  it('Escape closes the menu first and only it, then the popover', () => {
    const line = openWithNoConnection()
    fireEvent.click(within(line).getByTestId('receive-from'))
    expect(menu()).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(menu()).not.toBeInTheDocument()
    expect(popover()).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('comes-from-popover')).not.toBeInTheDocument()
  })

  it('a press outside both closes the menu and leaves the popover; a press on the menu closes neither', () => {
    const line = openWithNoConnection()
    fireEvent.click(within(line).getByTestId('receive-from'))
    fireEvent.mouseDown(within(menu()!).getAllByRole('menuitem')[0])
    expect(menu()).toBeInTheDocument()
    expect(popover()).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(menu()).not.toBeInTheDocument()
    expect(popover()).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('comes-from-popover')).not.toBeInTheDocument()
  })
})
