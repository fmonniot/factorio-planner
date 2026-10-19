import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
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
    items: {},
    recipes: { start: recipe('start'), circuit: recipe('circuit'), rocket: recipe('rocket') },
    machines: {},
    modules: {},
    beacons: {},
    defaultMachines: {},
    itemGroups: {},
    itemSubgroups: {},
    technologies: withTechnologies
      ? {
          electronics: {
            id: 'electronics', name: 'Electronics', prerequisites: [], unlockedRecipes: ['circuit'], iconPath: '',
            cost: { ingredients: [{ itemId: 'start', amount: 1 }], count: 10, time: 5 },
          },
          'rocket-silo': { id: 'rocket-silo', name: 'Rocket silo', prerequisites: ['electronics'], unlockedRecipes: ['rocket'], iconPath: '' },
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

  it('closes on Escape', () => {
    open()
    expect(screen.getByRole('heading', { name: 'Technology tree' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Technology tree' })).not.toBeInTheDocument()
  })
})
