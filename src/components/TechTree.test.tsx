import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { TechTreeButton } from './TechTree'
import { useGameDataStore } from '../store/gameDataStore'
import { useBlockStore } from '../store/blockStore'
import type { GameData } from '../data/types'

function recipe(id: string): GameData['recipes'][string] {
  return {
    id, name: id, category: 'crafting', craftingTime: 1,
    ingredients: [], products: [{ itemId: id, type: 'item', amount: 1 }],
    madeIn: [], allowProductivity: false, hidden: false,
    mainProduct: undefined, subgroup: '', order: '',
  }
}

function makeGameData(withTechnologies = true): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {
      asm: { id: 'asm', name: 'asm', type: 'item', iconPath: '', hidden: false, subgroup: '', order: '', placeResult: 'asm' },
    },
    recipes: {
      start: recipe('start'), circuit: recipe('circuit'), rocket: recipe('rocket'), asm: recipe('asm'),
      ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`extra-${i}`, recipe(`extra-${i}`)])),
    },
    machines: {
      asm: {
        id: 'asm', name: 'asm', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 1, energyType: 'electric',
        drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: ['crafting'], iconPath: '', hidden: false,
      },
    },
    modules: {},
    beacons: {},
    defaultMachines: {},
    itemGroups: {},
    itemSubgroups: {},
    technologies: withTechnologies
      ? {
          electronics: {
            id: 'electronics', name: 'Electronics', prerequisites: [], unlockedRecipes: ['circuit', ...Array.from({ length: 9 }, (_, i) => `extra-${i}`)], iconPath: '',
            cost: { ingredients: [{ itemId: 'start', amount: 1 }], count: 10, time: 5 },
          },
          'rocket-silo': { id: 'rocket-silo', name: 'Rocket silo', prerequisites: ['electronics'], unlockedRecipes: ['rocket', 'asm'], iconPath: '' },
        }
      : {},
    startingRecipes: ['start'],
  }
}

function load(gameData: GameData) {
  useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
}

function card(id: string) {
  return document.querySelector(`[data-tech-id="${id}"]`) as HTMLElement
}

function open() {
  render(<TechTreeButton />)
  fireEvent.click(screen.getByRole('button', { name: 'Tech tree' }))
}

beforeEach(() => {
  useBlockStore.setState({ horizonTechnologyIds: [] })
  load(makeGameData())
})

describe('TechTreeButton', () => {
  it('renders nothing without technology data', () => {
    load(makeGameData(false))
    render(<TechTreeButton />)
    expect(screen.queryByRole('button', { name: 'Tech tree' })).not.toBeInTheDocument()
  })

  it('shows states, cost and placeholder icons', () => {
    open()
    expect(card('electronics').dataset.state).toBe('available')
    expect(card('rocket-silo').dataset.state).toBe('locked')
    const cost = within(card('electronics')).getByTestId('tech-cost')
    expect(cost).toHaveTextContent('×10')
    expect(cost).toHaveTextContent('5s')
    expect(cost).toHaveTextContent('×10 · 5s')
    expect(within(card('rocket-silo')).queryByTestId('tech-cost')).not.toBeInTheDocument()
    expect(within(card('electronics')).getByTestId('tech-icon-placeholder')).toBeInTheDocument()
    expect(within(card('rocket-silo')).getByTestId('tech-icon-placeholder')).toBeInTheDocument()
  })

  it('clicking a card toggles it as a horizon target', () => {
    open()
    fireEvent.click(card('rocket-silo'))
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual(['rocket-silo'])
    expect(card('rocket-silo').dataset.target).toBe('true')
    expect(card('electronics').dataset.state).toBe('researched')
    fireEvent.click(card('rocket-silo'))
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual([])
  })

  it('zooms in', () => {
    open()
    const canvas = screen.getByTestId('tech-tree-canvas')
    expect(canvas.dataset.scale).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(canvas.dataset.scale).toBe('1.25')
  })

  it('Clear horizon empties the targets', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['electronics'] })
    open()
    expect(screen.getByTestId('tech-tree-horizon')).toHaveTextContent('Horizon: 1 target')
    fireEvent.click(screen.getByRole('button', { name: 'Clear horizon' }))
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual([])
  })

  it('updates the recipe count as the horizon changes', () => {
    open()
    const count = screen.getByTestId('tech-tree-recipe-count')
    expect(count).toHaveTextContent('13 of 13 recipes available')
    fireEvent.click(card('electronics'))
    expect(count).toHaveTextContent('11 of 13 recipes available')
    fireEvent.click(card('rocket-silo'))
    expect(count).toHaveTextContent('13 of 13 recipes available')
  })

  it('Clear horizon removes stale target ids that match no technology', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['gone'] })
    open()
    expect(screen.getByRole('button', { name: 'Clear horizon' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear horizon' }))
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual([])
  })

  it('closes on Escape', () => {
    open()
    expect(screen.getByRole('heading', { name: 'Technology tree' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Technology tree' })).not.toBeInTheDocument()
  })
})

describe('unlocks popup', () => {
  const popup = () => screen.queryByTestId('tech-unlocks-popup')

  const rect = (l: number, t: number, r: number, b: number) =>
    ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t, toJSON: () => ({}) }) as DOMRect

  // happy-dom lays nothing out: every element gets a 1000x800 rect, so cards count as visible.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => rect(0, 0, 1000, 800))
  })

  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('shows after the hover delay with the recipes and machines', () => {
    vi.useFakeTimers()
    open()
    fireEvent.mouseEnter(card('rocket-silo'))
    expect(popup()).not.toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(300) })
    const p = screen.getByTestId('tech-unlocks-popup')
    expect(p.dataset.techId).toBe('rocket-silo')
    expect(within(p).getByText('Rocket silo')).toBeInTheDocument()
    expect(p.querySelector('[data-testid="tech-unlocks-recipe"][data-recipe-id="rocket"]')).toBeInTheDocument()
    expect(p.querySelector('[data-testid="tech-unlocks-machine"][data-machine-id="asm"]')).toBeInTheDocument()
  })

  it('shows at most 8 recipes and counts the rest', () => {
    vi.useFakeTimers()
    open()
    fireEvent.mouseEnter(card('electronics'))
    act(() => { vi.advanceTimersByTime(300) })
    expect(screen.getAllByTestId('tech-unlocks-recipe')).toHaveLength(8)
    expect(screen.getByTestId('tech-unlocks-more')).toHaveTextContent('+2 more')
  })

  it('shows at once on focus and hides on blur', () => {
    open()
    fireEvent.focus(card('rocket-silo'))
    expect(popup()).toBeInTheDocument()
    fireEvent.blur(card('rocket-silo'))
    expect(popup()).not.toBeInTheDocument()
  })

  it('never appears when the pointer leaves before the delay', () => {
    vi.useFakeTimers()
    open()
    fireEvent.mouseEnter(card('rocket-silo'))
    fireEvent.mouseLeave(card('rocket-silo'))
    act(() => { vi.advanceTimersByTime(500) })
    expect(popup()).not.toBeInTheDocument()
  })

  it('hides on click, which still toggles the target', () => {
    open()
    fireEvent.focus(card('rocket-silo'))
    fireEvent.click(card('rocket-silo'), { detail: 1 })
    expect(popup()).not.toBeInTheDocument()
    expect(card('rocket-silo').dataset.target).toBe('true')
  })

  it('keeps the popup on keyboard activation', () => {
    open()
    fireEvent.focus(card('rocket-silo'))
    fireEvent.click(card('rocket-silo'), { detail: 0 })
    expect(popup()).toBeInTheDocument()
    expect(card('rocket-silo').dataset.target).toBe('true')
  })

  it('switches between cards without the delay', () => {
    vi.useFakeTimers()
    open()
    fireEvent.mouseEnter(card('rocket-silo'))
    act(() => { vi.advanceTimersByTime(300) })
    expect(popup()?.getAttribute('data-tech-id')).toBe('rocket-silo')
    fireEvent.mouseLeave(card('rocket-silo'))
    fireEvent.mouseEnter(card('electronics'))
    expect(screen.getAllByTestId('tech-unlocks-popup')).toHaveLength(1)
    expect(popup()?.getAttribute('data-tech-id')).toBe('electronics')
    act(() => { vi.advanceTimersByTime(500) })
    expect(popup()?.getAttribute('data-tech-id')).toBe('electronics')
  })

  it('hides after the grace period when leaving without entering another card', () => {
    vi.useFakeTimers()
    open()
    fireEvent.mouseEnter(card('rocket-silo'))
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.mouseLeave(card('rocket-silo'))
    expect(popup()).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(100) })
    expect(popup()).not.toBeInTheDocument()
  })

  it('shows no popup for the focus a right-button press causes', () => {
    open()
    fireEvent.pointerDown(card('rocket-silo'), { button: 2 })
    fireEvent.focus(card('rocket-silo'))
    expect(popup()).not.toBeInTheDocument()
    fireEvent.pointerUp(window)
    fireEvent.blur(card('rocket-silo'))
    fireEvent.focus(card('rocket-silo'))
    expect(popup()).toBeInTheDocument()
  })

  it('shows no popup on focusing a card outside the visible canvas', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.dataset.techId === 'rocket-silo' ? rect(5000, 5000, 5200, 5040) : rect(0, 0, 1000, 800)
    })
    open()
    fireEvent.focus(card('rocket-silo'))
    expect(popup()).not.toBeInTheDocument()
    fireEvent.focus(card('electronics'))
    expect(popup()).toBeInTheDocument()
  })

  it('hides on a pointer down in the viewport', () => {
    open()
    fireEvent.focus(card('rocket-silo'))
    fireEvent.pointerDown(screen.getByTestId('tech-tree-viewport'), { button: 0 })
    expect(popup()).not.toBeInTheDocument()
  })

  it('Escape dismisses the popup first, then closes the tree', () => {
    open()
    fireEvent.focus(card('rocket-silo'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(popup()).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Technology tree' })).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Technology tree' })).not.toBeInTheDocument()
  })

  it('renders outside the canvas and ignores the pointer', () => {
    open()
    fireEvent.focus(card('rocket-silo'))
    const p = screen.getByTestId('tech-unlocks-popup')
    expect(screen.getByTestId('tech-tree-canvas').contains(p)).toBe(false)
    expect(p.className).toContain('pointer-events-none')
  })

  it('leaves no native title on the cards', () => {
    open()
    expect(card('electronics')).not.toHaveAttribute('title')
  })

  it('says so when a technology unlocks no recipes', () => {
    const data = makeGameData()
    data.technologies['rocket-silo'].unlockedRecipes = []
    load(data)
    open()
    fireEvent.focus(card('rocket-silo'))
    expect(screen.getByTestId('tech-unlocks-popup')).toHaveTextContent('Unlocks no recipes')
    expect(screen.queryByTestId('tech-unlocks-machines')).not.toBeInTheDocument()
  })
})

describe('search', () => {
  function withLeveled(): GameData {
    const data = makeGameData()
    data.technologies['toolbelt-5'] = { id: 'toolbelt-5', name: 'Toolbelt 5', prerequisites: ['electronics'], unlockedRecipes: [], iconPath: '' }
    return data
  }

  const box = () => screen.getByRole('textbox', { name: 'Search technologies' })
  const results = () => screen.queryAllByTestId('tech-tree-search-result')
  const treeOpen = () => screen.queryByRole('heading', { name: 'Technology tree' }) !== null
  const type = (text: string) => fireEvent.change(box(), { target: { value: text } })

  beforeEach(() => { load(withLeveled()) })
  afterEach(() => { vi.useRealTimers() })

  it('lists matching technologies as you type', () => {
    open()
    expect(screen.queryByTestId('tech-tree-search-results')).not.toBeInTheDocument()
    type('elec')
    expect(results().map(r => r.dataset.techId)).toEqual(['electronics'])
  })

  it('matches a leveled name', () => {
    open()
    type('toolbelt 5')
    expect(results().map(r => r.dataset.techId)).toEqual(['toolbelt-5'])
  })

  it('says so when nothing matches', () => {
    open()
    type('zzz')
    expect(results()).toHaveLength(0)
    expect(screen.getByTestId('tech-tree-search-empty')).toHaveTextContent('No matching technologies')
  })

  it('choosing a result highlights its card and clears the box without touching the horizon', () => {
    open()
    const horizon = screen.getByTestId('tech-tree-horizon').textContent
    const targets = Array.from(document.querySelectorAll('[data-testid="tech-card"]')).map(c => (c as HTMLElement).dataset.target)
    type('toolbelt')
    fireEvent.click(results()[0])
    expect(card('toolbelt-5').dataset.highlight).toBe('true')
    expect(card('electronics').dataset.highlight).toBe('false')
    expect(box()).toHaveValue('')
    expect(screen.queryByTestId('tech-tree-search-results')).not.toBeInTheDocument()
    expect(screen.getByTestId('tech-tree-canvas').dataset.scale).toBe('1')
    expect(screen.getByTestId('tech-tree-horizon').textContent).toBe(horizon)
    expect(Array.from(document.querySelectorAll('[data-testid="tech-card"]')).map(c => (c as HTMLElement).dataset.target)).toEqual(targets)
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual([])
  })

  it('the highlight expires', () => {
    vi.useFakeTimers()
    open()
    type('toolbelt')
    fireEvent.click(results()[0])
    expect(card('toolbelt-5').dataset.highlight).toBe('true')
    act(() => { vi.advanceTimersByTime(1500) })
    expect(card('toolbelt-5').dataset.highlight).toBe('false')
  })

  it('Enter picks the first result', () => {
    open()
    type('e')
    const first = results()[0].dataset.techId!
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(card(first).dataset.highlight).toBe('true')
    expect(box()).toHaveValue('')
  })

  it('Enter without a result does nothing', () => {
    open()
    type('zzz')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box()).toHaveValue('zzz')
    expect(document.querySelector('[data-highlight="true"]')).toBeNull()
  })

  it('Escape clears the box before closing the tree', () => {
    open()
    type('elec')
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(box()).toHaveValue('')
    expect(treeOpen()).toBe(true)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(treeOpen()).toBe(false)
  })
})
