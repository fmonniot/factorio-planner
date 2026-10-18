import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { HorizonButton } from './HorizonPicker'
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
          electronics: { id: 'electronics', name: 'Electronics', prerequisites: [], unlockedRecipes: ['circuit'] },
          'rocket-silo': { id: 'rocket-silo', name: 'Rocket silo', prerequisites: ['electronics'], unlockedRecipes: ['rocket'] },
        }
      : {},
    startingRecipes: ['start'],
  }
}

function load(gameData: GameData) {
  useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
}

function tech(id: string) {
  return document.querySelector(`[data-tech-id="${id}"]`) as HTMLElement
}

beforeEach(() => {
  useBlockStore.setState({ horizonTechnologyIds: [] })
  load(makeGameData())
})

describe('HorizonButton', () => {
  it('renders nothing without technology data', () => {
    load(makeGameData(false))
    render(<HorizonButton />)
    expect(screen.queryByRole('button', { name: /^Horizon/ })).not.toBeInTheDocument()
  })

  it('labels the horizon by its targets', () => {
    render(<HorizonButton />)
    expect(screen.getByRole('button', { name: 'Horizon: none' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Horizon: none' }))
    fireEvent.click(tech('electronics'))
    fireEvent.click(screen.getByText('Done'))
    expect(screen.getByRole('button', { name: 'Horizon: Electronics' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Horizon: Electronics' }))
    fireEvent.click(tech('rocket-silo'))
    fireEvent.click(screen.getByText('Done'))
    expect(screen.getByRole('button', { name: 'Horizon: 2 technologies' })).toBeInTheDocument()
  })

  it('toggles a target through aria-pressed', () => {
    render(<HorizonButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Horizon: none' }))
    fireEvent.click(tech('electronics'))
    expect(tech('electronics').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(tech('electronics'))
    expect(tech('electronics').getAttribute('aria-pressed')).toBe('false')
  })

  it('Clear empties the targets', () => {
    render(<HorizonButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Horizon: none' }))
    expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled()
    fireEvent.click(tech('electronics'))
    expect(screen.getAllByTestId('horizon-target')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryAllByTestId('horizon-target')).toHaveLength(0)
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual([])
  })

  it('Clear removes stale target ids that match no technology', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['gone'] })
    render(<HorizonButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Horizon: none' }))
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual([])
  })

  it('updates the recipe count', () => {
    render(<HorizonButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Horizon: none' }))
    expect(screen.getByTestId('horizon-recipe-count')).toHaveTextContent('3 of 3 recipes available')
    fireEvent.click(tech('electronics'))
    expect(screen.getByTestId('horizon-recipe-count')).toHaveTextContent('2 of 3 recipes available')
    fireEvent.click(tech('rocket-silo'))
    expect(screen.getByTestId('horizon-recipe-count')).toHaveTextContent('3 of 3 recipes available')
  })
})
