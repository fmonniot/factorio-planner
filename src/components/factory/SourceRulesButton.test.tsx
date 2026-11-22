import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FactorySummary } from './FactorySummary'
import { SourceRulesButton } from './SourceRulesButton'
import { useBlockStore, makeEmptyBlock, makeRecipeNode } from '../../store/blockStore'
import { useUiStore } from '../../store/uiStore'
import { useGameDataStore } from '../../store/gameDataStore'
import { useSolverStore } from '../../store/solverStore'
import { sourceRulesOf } from '../../test/sourceRulesOf'
import type { AreaSourceRule, Block, GameData, SourceRule } from '../../data/types'

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
  sourcing?: Record<string, 'byproducts-first' | 'connections-first'>
  locked?: string[]
  /** A connection for Ore from the other block. */
  connected?: boolean
  /** Items whose Leftover switch is off. */
  leftoverOff?: string[]
}

/** The active block "Main" (rows Smelt and Ore Synth) with the given rules, and a block "Source" beside it. */
function setup({ sourcing = {}, locked = [], connected = false, leftoverOff = [] }: Rules = {}) {
  const source: Block = { ...makeEmptyBlock('Source'), id: 'source', products: [{ id: 'p', itemId: 'ore' }] }
  const main: Block = { ...makeEmptyBlock('Main'), id: 'main', sourceRules: sourceRulesOf(sourcing, locked) }
  for (const id of leftoverOff) main.sourceRules[id] = { ...main.sourceRules[id], leftoverOff: true }
  main.rootPlan = { ...main.rootPlan, nodes: [makeRecipeNode('smelt'), makeRecipeNode('ore-synth')] }
  if (connected) main.inputConnections = [{ id: 'c', itemId: 'ore', fromBlockId: 'source' }]
  useBlockStore.setState({ blocks: [main, source], activeBlockId: 'main', history: {} })
  useUiStore.setState({ rateUnit: 'min', summaryCollapsed: false, ingredientSlotRequest: null, selectedRow: null, connectionMenu: null, comesFromPopover: null })
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

describe('Source rules — Leftover off', () => {
  it('lists the rule after the item\'s other parts, with its name and the switch\'s help text, and marks the item', () => {
    setup({ locked: ['plate'], leftoverOff: ['plate'] })
    render(<SourceRulesButton />)
    openPopover()
    expect(entries().map(e => [e.dataset.itemId, e.dataset.rule, e.dataset.noEffect])).toEqual([
      ['plate', 'import-off', undefined],
      ['plate', 'leftover-off', undefined],
    ])
    const e = entry('plate', 'leftover-off')
    expect(within(e).getByTestId('source-rule-name')).toHaveTextContent('Leftover off')
    expect(text(e)).toContain('the rows of this block use all of it they can')
    expect(remove(e)).toHaveAccessibleName('Remove the Leftover off rule of Plate')
  })

  it('says why a rule on an item no row makes does nothing, and Remove keeps the item\'s other rule', () => {
    setup({ locked: ['water'], leftoverOff: ['water'] })
    render(<SourceRulesButton />)
    openPopover()
    const e = entry('water', 'leftover-off')
    expect(e).toHaveAttribute('data-no-effect', 'not-made')
    expect(text(e)).toBe('No row in this block makes Water.')
    fireEvent.click(remove(e))
    expect(mainBlock().sourceRules).toEqual({ water: { importOff: true } })
  })

  it('expands the Comes from control with the switch on, to turn it back on', () => {
    setup({ leftoverOff: ['plate'] })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(within(entry('plate', 'leftover-off')).getByTestId('source-rule-item'))
    const sw = within(popover()).getByTestId('leftover-switch')
    expect(sw).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(sw)
    expect(mainBlock().sourceRules).toEqual({})
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
    ['byproducts-first', "Don't make more here", { sourcing: { ore: 'byproducts-first' } }, 'No row here already makes Ore; it is imported.'],
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
    expect(mainBlock().sourceRules).toEqual({ 'plate': { importOff: true } })
    expect(button()).toHaveTextContent('Source rules (1)')
    expect(entries().map(e => e.dataset.rule)).toEqual(['import-off'])
  })

  it('clears an Import off rule and leaves the others', () => {
    setup({ sourcing: { water: 'connections-first' }, locked: ['ore', 'plate'] })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entry('ore', 'import-off')))
    expect(mainBlock().sourceRules).toEqual({ water: { makeHere: 'after-blocks' }, plate: { importOff: true } })
    expect(button()).toHaveTextContent('Source rules (2)')
  })

  it('clears one of the two rules of an item, not the other', () => {
    setup({ sourcing: { ore: 'connections-first' }, locked: ['ore'], connected: true })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entry('ore', 'import-off')))
    expect(mainBlock().sourceRules).toEqual({ ore: { makeHere: 'after-blocks' } })
    fireEvent.click(remove(entry('ore', 'connections-first')))
    expect(mainBlock().sourceRules).toEqual({})
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
  it('shows the Comes from control in its row, and hides it on a second press, without asking for a slot or a popover', () => {
    setup({ sourcing: { water: 'connections-first' }, locked: ['ore'] })
    render(<SourceRulesButton />)
    openPopover()
    const row = entry('ore', 'import-off')
    const toggle = within(row).getByTestId('source-rule-item')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(row).queryByTestId('comes-from')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(within(row).getByTestId('comes-from')).toBeInTheDocument()
    // Only that row is open, and the list stays.
    expect(within(entry('water', 'connections-first')).queryByTestId('comes-from')).not.toBeInTheDocument()
    expect(screen.getByTestId('source-rules-popover')).toBeInTheDocument()
    expect(useUiStore.getState().ingredientSlotRequest).toBeNull()
    expect(useUiStore.getState().comesFromPopover).toBeNull()
    fireEvent.click(toggle)
    expect(within(row).queryByTestId('comes-from')).not.toBeInTheDocument()
  })

  it('changes the rule from the row, also for an item that has no slot of its own', () => {
    // Ore is made and used inside the block: not imported, not connected, not locked.
    setup({ sourcing: { ore: 'byproducts-first' } })
    render(<FactorySummary />)
    const pane = screen.getByRole('region', { name: 'Ingredients' })
    expect(within(pane).queryAllByTestId('summary-slot').map(s => s.getAttribute('data-item-id'))).not.toContain('ore')
    openPopover()
    fireEvent.click(within(entry('ore', 'byproducts-first')).getByTestId('source-rule-item'))
    const row = entry('ore', 'byproducts-first')
    fireEvent.click(within(row).getByRole('radio', { name: 'Receive it first' }))
    expect(mainBlock().sourceRules).toEqual({ ore: { makeHere: 'after-blocks' } })
    // The control is still open on the same item, now for its new rule (which has no connection to act on).
    expect(within(entry('ore', 'connections-first')).getByTestId('comes-from')).toBeInTheDocument()
  })

  it('does not close on a press inside the expanded control, and Tab stays inside the list', () => {
    setup({ locked: ['ore'] })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(within(entry('ore', 'import-off')).getByTestId('source-rule-item'))
    fireEvent.mouseDown(within(popover()).getByTestId('comes-from'))
    expect(screen.getByTestId('source-rules-popover')).toBeInTheDocument()
    const controls = [...popover().querySelectorAll<HTMLElement>('button:not([tabindex="-1"]):not(:disabled)')]
    controls[controls.length - 1].focus()
    fireEvent.keyDown(controls[controls.length - 1], { key: 'Tab' })
    expect(document.activeElement).toBe(controls[0])
  })

  it('starts with every row closed when it opens again', () => {
    setup({ locked: ['ore'] })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(within(entry('ore', 'import-off')).getByTestId('source-rule-item'))
    openPopover()
    openPopover()
    expect(within(popover()).queryByTestId('comes-from')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The rules of an area
// ---------------------------------------------------------------------------

describe('Source rules — the rules of an area', () => {
  const NOW = '2026-01-01T00:00:00.000Z'
  const area = (id: string, rules?: Record<string, AreaSourceRule>) => ({
    id, name: `Line ${id}`, nodes: [makeRecipeNode('smelt')], subPlans: [], area: true as const, createdAt: NOW, updatedAt: NOW,
    ...(rules ? { sourceRules: rules } : {}),
  })
  function setupAreas(L?: Record<string, AreaSourceRule>, block: Record<string, SourceRule> = {}) {
    setup()
    const main = mainBlock()
    useBlockStore.setState({
      blocks: [{ ...main, sourceRules: block, rootPlan: { ...main.rootPlan, nodes: [], subPlans: [area('L', L), area('B')] } }, ...useBlockStore.getState().blocks.slice(1)],
    })
  }
  const lRules = () => mainBlock().rootPlan.subPlans.find(sp => sp.id === 'L')?.sourceRules
  const names = () => entries().map(e => within(e).getByTestId('source-rule-name').textContent)

  it('has one entry per part, named after the area, and counts them', () => {
    setupAreas({ plate: { makeHere: 'after-blocks', importOff: true } })
    render(<SourceRulesButton />)
    expect(button()).toHaveTextContent('Source rules (2)')
    openPopover()
    expect(names()).toEqual(['Line L: Receive it first', 'Line L: Import off'])
    expect(entries().map(e => e.dataset.areaId)).toEqual(['L', 'L'])
    expect(text(entries()[1])).toMatch(/^Line L: /)
    expect(within(entries()[1]).getByRole('button', { name: 'Remove the Line L: Import off rule of Plate' })).toBeInTheDocument()
  })

  it('removes one part of the area rule and leaves the other', () => {
    setupAreas({ plate: { makeHere: 'after-blocks', importOff: true } })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entry('plate', 'import-off')))
    expect(lRules()).toEqual({ plate: { makeHere: 'after-blocks' } })
    expect(button()).toHaveTextContent('Source rules (1)')
  })

  it('removes the area rule altogether when its last part goes and the block has no rule to override', () => {
    setupAreas({ plate: { importOff: true } })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entry('plate', 'import-off')))
    expect(lRules()).toBeUndefined()
    expect(screen.queryByTestId('source-rules')).not.toBeInTheDocument()
  })

  it('keeps a keyless rule when the block has a rule it overrides', () => {
    setupAreas({ plate: { importOff: true } }, { plate: { makeHere: 'off' } })
    render(<SourceRulesButton />)
    openPopover()
    // The block's own entry, then the area's Import off and its make-here override.
    expect(names()).toEqual(["Don't make more here", 'Line L: Import off', 'Line L: Make it here'])
    fireEvent.click(remove(entries().find(e => e.dataset.areaId === 'L' && e.dataset.rule === 'import-off')!))
    expect(lRules()).toEqual({ plate: {} })
  })

  it('lists a keyless area rule under a block Import off, and Remove on it clears the rule (the area follows the block again)', () => {
    setupAreas({ plate: {} }, { plate: { importOff: true } })
    render(<SourceRulesButton />)
    expect(button()).toHaveTextContent('Source rules (2)')
    openPopover()
    expect(names()).toEqual(['Import off', 'Line L: Import on'])
    fireEvent.click(remove(entry('plate', 'import-on')))
    expect(lRules()).toBeUndefined()
  })

  it('removes a rule that repeats the block\'s whole, and a part that leaves one, so Remove never changes what the area does', () => {
    setupAreas({ plate: { makeHere: 'after-blocks' } }, { plate: { makeHere: 'after-blocks' } })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entries().find(e => e.dataset.areaId === 'L')!))
    expect(lRules()).toBeUndefined()
  })

  it('clears the area rule when removing its Import off leaves what the block already says', () => {
    setupAreas({ plate: { importOff: true } }, { plate: { importOff: true } })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entries().find(e => e.dataset.areaId === 'L')!))
    expect(lRules()).toBeUndefined()
  })

  it('clears the area rule from a make-here entry', () => {
    setupAreas({ plate: {} }, { plate: { makeHere: 'off' } })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entry('plate', 'make-here')))
    expect(lRules()).toBeUndefined()
    expect(mainBlock().sourceRules).toEqual({ plate: { makeHere: 'off' } })
  })

  it('lists one entry for an area that only switches another off, and counts it', () => {
    setupAreas({ plate: { areasOff: ['B'] } })
    render(<SourceRulesButton />)
    expect(button()).toHaveTextContent('Source rules (1)')
    openPopover()
    expect(names()).toEqual(['Line L: takes nothing from Line B'])
    expect(entries()[0].dataset).toMatchObject({ rule: 'takes-nothing', areaId: 'L', otherAreaId: 'B' })
    expect(text(entries()[0])).toMatch(/^Line L: .* Takes nothing from Line B\.$/)
    expect(within(entries()[0]).getByRole('button', { name: 'Remove the Line L: takes nothing from Line B rule of Plate' })).toBeInTheDocument()
  })

  it('removes the switch through the store, and the area rule with it when it repeats the block', () => {
    setupAreas({ plate: { areasOff: ['B'] } })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entries()[0]))
    expect(lRules()).toBeUndefined()
    expect(screen.queryByTestId('source-rules')).not.toBeInTheDocument()
  })

  it('removes one of two switches and keeps the other', () => {
    setupAreas({ plate: { areasOff: ['B', 'C'] } })
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => b.id === 'main' ? { ...b, rootPlan: { ...b.rootPlan, subPlans: [...b.rootPlan.subPlans, area('C')] } } : b) }))
    render(<SourceRulesButton />)
    openPopover()
    expect(names()).toEqual(['Line L: takes nothing from Line B', 'Line L: takes nothing from Line C'])
    fireEvent.click(remove(entries()[0]))
    expect(lRules()).toEqual({ plate: { areasOff: ['C'] } })
  })

  it('clears the copied rule when the last switch goes under a block preset', () => {
    setupAreas({ plate: { makeHere: 'after-blocks', areasOff: ['B'] } }, { plate: { makeHere: 'after-blocks' } })
    render(<SourceRulesButton />)
    openPopover()
    expect(entries().filter(e => e.dataset.areaId === 'L').map(e => e.dataset.rule)).toEqual(['connections-first', 'takes-nothing'])
    fireEvent.click(remove(entries().find(e => e.dataset.rule === 'takes-nothing')!))
    expect(lRules()).toBeUndefined()
  })

  it('keeps the switches when the make-here override goes, and gives the area the block\'s preset', () => {
    setupAreas({ plate: { areasOff: ['B'] } }, { plate: { makeHere: 'after-blocks' } })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(remove(entry('plate', 'make-here')))
    expect(lRules()).toEqual({ plate: { makeHere: 'after-blocks', areasOff: ['B'] } })
  })

  it('greys a switch whose other area has no row making the item', () => {
    setupAreas({ plate: { areasOff: ['B'] } })
    useBlockStore.setState(s => ({ blocks: s.blocks.map(b => b.id === 'main' ? { ...b, rootPlan: { ...b.rootPlan, subPlans: b.rootPlan.subPlans.map(sp => sp.id === 'B' ? { ...sp, nodes: [] } : sp) } } : b) }))
    render(<SourceRulesButton />)
    openPopover()
    expect(entries()[0]).toHaveAttribute('data-no-effect', 'not-made')
    expect(text(entries()[0])).toBe('No row in Line B makes Plate.')
  })

  it('expands the Comes from control on the scope of the area', () => {
    setupAreas({ plate: { importOff: true } })
    render(<SourceRulesButton />)
    openPopover()
    fireEvent.click(within(entries()[0]).getByTestId('source-rule-item'))
    const scope = within(entries()[0]).getByTestId('comes-from-scope')
    expect(within(scope).getByRole('button', { name: 'Line L' })).toHaveAttribute('aria-pressed', 'true')
  })
})
