import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FactorySummary } from './FactorySummary'
import { SourceRulesButton } from './SourceRulesButton'
import { useBlockStore, makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import type { Block, GameData, ItemSourcingMode } from '../../data/types'

// Smelt turns Ore into Plate; Ore Synth makes Ore. So Ore and Plate are made by the block, Water is not.
function gameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {
      plate: { id: 'plate', name: 'Plate', type: 'item', iconPath: '', hidden: false },
      ore: { id: 'ore', name: 'Ore', type: 'item', iconPath: '', hidden: false },
      water: { id: 'water', name: 'Water', type: 'fluid', iconPath: '', hidden: false },
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
    machines: {},
    beacons: {},
    modules: {},
    defaultMachines: {},
    technologies: {},
    startingRecipes: [],
  } as unknown as GameData
}

interface Rules {
  sourcing?: Record<string, ItemSourcingMode>
  locked?: string[]
  /** A connection for Ore from the other block. */
  connected?: boolean
}

/** The active block "Main" (rows Smelt and Ore Synth) with the given rules, and a block "Source" beside it. */
function setup({ sourcing = {}, locked = [], connected = false }: Rules = {}) {
  const source: Block = { ...makeEmptyBlock('Source'), id: 'source', products: [{ id: 'p', itemId: 'ore' }] }
  const main: Block = { ...makeEmptyBlock('Main'), id: 'main', itemSourcing: sourcing, noImportItems: locked }
  main.rootPlan = { ...main.rootPlan, nodes: [makeRecipeNode('smelt'), makeRecipeNode('ore-synth')] }
  if (connected) main.inputConnections = [{ id: 'c', itemId: 'ore', fromBlockId: 'source' }]
  useBlockStore.setState({ blocks: [main, source], activeBlockId: 'main', history: {} })
  useUiStore.setState({ rateUnit: 'min', summaryCollapsed: false, ingredientSlotRequest: null, selectedRow: null })
  useGameDataStore.setState({ status: { type: 'loaded', gameData: gameData(), sourceId: 'test' } })
  useSolverStore.setState({ status: { type: 'idle' }, lastResult: undefined, lastResults: {}, flows: [], _setStatus: () => {} })
}

const mainBlock = () => useBlockStore.getState().blocks.find(b => b.id === 'main')!
const button = () => screen.getByTestId('source-rules')
const popover = () => screen.getByTestId('source-rules-popover')
const entries = () => within(popover()).getAllByTestId('source-rule')
const entry = (itemId: string, kind: string) =>
  entries().find(e => e.dataset.itemId === itemId && e.dataset.rule === kind)!
const text = (el: HTMLElement) => within(el).getByTestId('source-rule-text').textContent
const remove = (el: HTMLElement) => within(el).getByRole('button', { name: /^Remove/ })
const openPopover = () => fireEvent.click(button())

beforeEach(() => setup())

describe('Source rules — the button', () => {
  it('is in the header of the Ingredients pane, after the item count, with the number of rules', () => {
    setup({ sourcing: { ore: 'byproducts-first', water: 'connections-first' }, locked: ['plate'] })
    render(<FactorySummary />)
    const pane = screen.getByRole('region', { name: 'Ingredients' })
    expect(within(pane).getByTestId('source-rules')).toHaveTextContent('Source rules (3)')
    const header = button().parentElement!
    expect(header.textContent).toMatch(/^Ingredients· \d+Source rules \(3\)$/)
    expect(screen.getAllByTestId('source-rules')).toHaveLength(1)
  })

  it('is not drawn for a block with no rule', () => {
    render(<FactorySummary />)
    expect(screen.getByRole('region', { name: 'Ingredients' })).toBeInTheDocument()
    expect(screen.queryByTestId('source-rules')).not.toBeInTheDocument()
  })

  it('is not drawn in the collapsed summary line', () => {
    setup({ locked: ['ore'] })
    useUiStore.setState({ summaryCollapsed: true })
    render(<FactorySummary />)
    expect(screen.getByTestId('summary-line')).toBeInTheDocument()
    expect(screen.queryByTestId('source-rules')).not.toBeInTheDocument()
  })

  it('counts a rule with no effect, and an item with two rules twice', () => {
    setup({ sourcing: { water: 'byproducts-first', ore: 'connections-first' }, locked: ['ore'] })
    render(<SourceRulesButton />)
    expect(button()).toHaveTextContent('Source rules (3)')
  })

  it('opens and closes a dialog it names as its popup', () => {
    setup({ locked: ['ore'] })
    render(<SourceRulesButton />)
    expect(button()).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('source-rules-popover')).not.toBeInTheDocument()
    openPopover()
    expect(button()).toHaveAttribute('aria-expanded', 'true')
    expect(popover()).toHaveAttribute('role', 'dialog')
    expect(popover()).toHaveAccessibleName('Source rules')
    expect(button()).toHaveAttribute('aria-controls', popover().id)
    openPopover()
    expect(screen.queryByTestId('source-rules-popover')).not.toBeInTheDocument()
  })
})

describe('Source rules — the list', () => {
  it('lists every rule in the order of sourceRules, as a list', () => {
    setup({ sourcing: { ore: 'connections-first', water: 'byproducts-first' }, locked: ['plate'], connected: true })
    render(<SourceRulesButton />)
    openPopover()
    expect(within(popover()).getByRole('list')).toBeInTheDocument()
    expect(within(popover()).getAllByRole('listitem')).toHaveLength(3)
    expect(entries().map(e => [e.dataset.itemId, e.dataset.rule, e.dataset.noEffect])).toEqual([
      ['ore', 'connections-first', undefined],
      ['water', 'byproducts-first', 'not-made'],
      ['plate', 'import-off', undefined],
    ])
  })

  it.each([
    ['connections-first', 'Receive it first', { sourcing: { ore: 'connections-first' }, connected: true }, 'Taken from Source first'],
    ['byproducts-first', "Only what's already made", { sourcing: { ore: 'byproducts-first' } }, 'No row here already makes Ore, so Ore Synth covers it.'],
    ['import-off', 'Import off', { locked: ['ore'] }, 'Import is off.'],
  ] as [string, string, Rules, string][])('shows a %s rule with its item, the name "%s" and the item\'s sentence', (kind, name, rules, sentence) => {
    setup(rules)
    render(<SourceRulesButton />)
    openPopover()
    const e = entry('ore', kind)
    expect(e).not.toHaveAttribute('data-no-effect')
    expect(within(e).getByTestId('source-rule-item')).toHaveTextContent('Ore')
    expect(within(e).getByTestId('source-rule-name')).toHaveTextContent(name)
    expect(text(e)).toContain(sentence)
    expect(within(e).getByTestId('source-rule-item')).toHaveClass('text-gray-100')
    expect(remove(e)).toHaveAccessibleName(`Remove the ${name} rule of Ore`)
  })

  it('shows the item\'s icon', () => {
    const data = gameData()
    data.items.ore.iconPath = 'icons/ore.png'
    setup({ locked: ['ore'] })
    useGameDataStore.setState({ status: { type: 'loaded', gameData: data, sourceId: 'test' } })
    render(<SourceRulesButton />)
    openPopover()
    expect(entry('ore', 'import-off').querySelector('img')).not.toBeNull()
  })

  it.each([
    ['not-made', { sourcing: { water: 'byproducts-first' } }, 'water', 'byproducts-first', 'No row in this block makes Water.'],
    ['no-connection', { sourcing: { ore: 'connections-first' } }, 'ore', 'connections-first', 'No connection for Ore.'],
    ['locked', { sourcing: { ore: 'byproducts-first' }, locked: ['ore'] }, 'ore', 'byproducts-first', 'Import is off for Ore, so the block has to make it.'],
  ] as [string, Rules, string, string, string][])('greys a rule with no effect (%s) and says why in place of the sentence', (reason, rules, itemId, kind, why) => {
    setup(rules)
    render(<SourceRulesButton />)
    openPopover()
    const e = entry(itemId, kind)
    expect(e).toHaveAttribute('data-no-effect', reason)
    expect(text(e)).toBe(why)
    expect(within(e).getByTestId('source-rule-item')).toHaveClass('text-gray-400')
    expect(within(e).getByTestId('source-rule-name')).toHaveClass('text-gray-400')
    // It can still be removed.
    expect(remove(e)).toBeEnabled()
  })

  it('greys a rule on a product of the block', () => {
    setup({ locked: ['plate'] })
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => (b.id === 'main' ? { ...b, products: [{ id: 'g', itemId: 'plate' }] } : b)) }))
    render(<SourceRulesButton />)
    openPopover()
    expect(entry('plate', 'import-off')).toHaveAttribute('data-no-effect', 'product')
    expect(text(entry('plate', 'import-off'))).toBe('Plate is a product of this block, so the block always makes it.')
  })

  it('lists an item with a preset and Import off as two entries', () => {
    setup({ sourcing: { ore: 'connections-first' }, locked: ['ore'], connected: true })
    render(<SourceRulesButton />)
    openPopover()
    expect(entries().map(e => [e.dataset.itemId, e.dataset.rule])).toEqual([
      ['ore', 'connections-first'],
      ['ore', 'import-off'],
    ])
    expect(within(popover()).getAllByRole('button', { name: /^Remove/ })).toHaveLength(2)
  })
})

describe('Source rules — Remove', () => {
  it.each([
    ['connections-first', { sourcing: { ore: 'connections-first' }, locked: ['plate'] }, 'ore'],
    ['byproducts-first', { sourcing: { ore: 'byproducts-first' }, locked: ['plate'] }, 'ore'],
  ] as [string, Rules, string][])('clears a %s rule and leaves the others', (kind, rules, itemId) => {
    setup(rules)
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entry(itemId, kind)))
    expect(mainBlock().itemSourcing).toEqual({})
    expect(mainBlock().noImportItems).toEqual(['plate'])
    expect(button()).toHaveTextContent('Source rules (1)')
    expect(entries().map(e => e.dataset.rule)).toEqual(['import-off'])
  })

  it('clears an Import off rule and leaves the others', () => {
    setup({ sourcing: { water: 'connections-first' }, locked: ['ore', 'plate'] })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entry('ore', 'import-off')))
    expect(mainBlock().noImportItems).toEqual(['plate'])
    expect(mainBlock().itemSourcing).toEqual({ water: 'connections-first' })
    expect(button()).toHaveTextContent('Source rules (2)')
  })

  it('clears one of the two rules of an item, not the other', () => {
    setup({ sourcing: { ore: 'connections-first' }, locked: ['ore'], connected: true })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entry('ore', 'import-off')))
    expect(mainBlock().noImportItems).toEqual([])
    expect(mainBlock().itemSourcing).toEqual({ ore: 'connections-first' })
    fireEvent.click(remove(entry('ore', 'connections-first')))
    expect(mainBlock().itemSourcing).toEqual({})
  })

  it('keeps the popover open and moves focus to the next rule\'s Remove, else the previous one', () => {
    setup({ sourcing: { ore: 'byproducts-first', water: 'connections-first' }, locked: ['plate'] })
    render(<SourceRulesButton />)
    openPopover()
    // The middle one goes: the one after it takes its place.
    fireEvent.click(remove(entry('water', 'connections-first')))
    expect(document.activeElement).toBe(remove(entry('plate', 'import-off')))
    // The last one goes: the one before it.
    fireEvent.click(remove(entry('plate', 'import-off')))
    expect(document.activeElement).toBe(remove(entry('ore', 'byproducts-first')))
  })

  it('closes with the last rule, and focus goes to a slot of the pane', () => {
    setup({ sourcing: { water: 'connections-first' } })
    render(<FactorySummary />)
    openPopover()
    fireEvent.click(remove(entry('water', 'connections-first')))
    expect(screen.queryByTestId('source-rules-popover')).not.toBeInTheDocument()
    expect(screen.queryByTestId('source-rules')).not.toBeInTheDocument()
    const pane = screen.getByRole('region', { name: 'Ingredients' })
    expect(document.activeElement).not.toBe(document.body)
    expect(pane).toContainElement(document.activeElement as HTMLElement)
  })
})

describe('Source rules — focus and dismissal', () => {
  it('moves focus into the popover when it opens', () => {
    setup({ locked: ['ore'] })
    render(<SourceRulesButton />)
    openPopover()
    expect(document.activeElement).toBe(within(entry('ore', 'import-off')).getByTestId('source-rule-item'))
  })

  it('closes on Escape and gives the focus back to the button', () => {
    setup({ locked: ['ore'] })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByTestId('source-rules-popover')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(button())
  })

  it('closes on a press outside, not on a press inside', () => {
    setup({ locked: ['ore'] })
    render(<div><SourceRulesButton /><p>elsewhere</p></div>)
    openPopover()
    fireEvent.mouseDown(within(popover()).getByText('Source rules'))
    expect(popover()).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByText('elsewhere'))
    expect(screen.queryByTestId('source-rules-popover')).not.toBeInTheDocument()
  })

  it('keeps Tab inside the popover', () => {
    setup({ sourcing: { ore: 'byproducts-first' }, locked: ['plate'] })
    render(<SourceRulesButton />)
    openPopover()
    const controls = within(popover()).getAllByRole('button')
    expect(controls).toHaveLength(4)
    controls[3].focus()
    fireEvent.keyDown(controls[3], { key: 'Tab' })
    expect(document.activeElement).toBe(controls[0])
    fireEvent.keyDown(controls[0], { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(controls[3])
  })
})

describe('Source rules — a rule\'s item', () => {
  it('asks the store to open the item\'s Ingredients slot and closes the popover', () => {
    setup({ sourcing: { water: 'connections-first' }, locked: ['ore'] })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(within(entry('ore', 'import-off')).getByTestId('source-rule-item'))
    expect(useUiStore.getState().ingredientSlotRequest).toMatchObject({ itemId: 'ore' })
    expect(screen.queryByTestId('source-rules-popover')).not.toBeInTheDocument()
  })

  it('lands in the Comes from control of the slot, also for an item that has no slot of its own', () => {
    // Ore is made and used inside the block: not imported, not connected, not locked.
    setup({ sourcing: { ore: 'byproducts-first' } })
    render(<FactorySummary />)
    const pane = screen.getByRole('region', { name: 'Ingredients' })
    const slotIds = () => within(pane).queryAllByTestId('summary-slot').map(s => s.getAttribute('data-item-id'))
    expect(slotIds()).not.toContain('ore')
    openPopover()
    fireEvent.click(within(entry('ore', 'byproducts-first')).getByTestId('source-rule-item'))
    expect(screen.queryByTestId('source-rules-popover')).not.toBeInTheDocument()
    expect(slotIds()).toContain('ore')
    const comesFrom = within(pane).getByTestId('comes-from')
    expect(comesFrom).toContainElement(document.activeElement as HTMLElement)
    expect(document.activeElement).toBe(within(comesFrom).getByRole('radio', { name: "Only what's already made" }))
  })

  it('keeps the slot\'s controls when the pointer is left resting on another slot, until it moves', () => {
    // The popover covers the slot grid: once it closes, the pointer is over whatever slot was under it.
    setup({ sourcing: { ore: 'byproducts-first' }, locked: ['water'] })
    render(<FactorySummary />)
    const pane = screen.getByRole('region', { name: 'Ingredients' })
    const strip = () => within(pane).getByTestId('summary-detail')
    const water = within(pane).getAllByTestId('summary-slot').find(s => s.getAttribute('data-item-id') === 'water')!
    openPopover()
    fireEvent.click(within(entry('ore', 'byproducts-first')).getByTestId('source-rule-item'))
    fireEvent.mouseEnter(water)
    expect(strip()).toHaveAttribute('data-state', 'selected')
    expect(within(pane).getByTestId('comes-from')).toContainElement(document.activeElement as HTMLElement)
    // A pointer that moves hovers again.
    fireEvent.mouseLeave(water)
    fireEvent.mouseMove(document.body)
    fireEvent.mouseEnter(water)
    expect(strip()).toHaveAttribute('data-state', 'preview')
  })
})
