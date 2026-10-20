import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
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
          electronics: { id: 'electronics', name: 'Electronics', prerequisites: [], unlockedRecipes: ['circuit'], iconPath: '' },
          'rocket-silo': { id: 'rocket-silo', name: 'Rocket silo', prerequisites: ['electronics'], unlockedRecipes: ['rocket'], iconPath: '' },
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

/** Click the flag, then go through the popover to the tech tree. */
function openTree(flagName: string) {
  fireEvent.click(screen.getByRole('button', { name: flagName }))
  fireEvent.click(screen.getByRole('button', { name: /^(Choose technologies|Edit horizon)/ }))
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
    openTree('Horizon: none')
    fireEvent.click(tech('electronics'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Horizon: Electronics' })).toBeInTheDocument()
    openTree('Horizon: Electronics')
    fireEvent.click(tech('rocket-silo'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Horizon: 2 technologies' })).toBeInTheDocument()
  })

  it('opens the targets popover, not the tree, on click', () => {
    render(<HorizonButton />)
    const flag = screen.getByRole('button', { name: 'Horizon: none' })
    expect(flag).toHaveAttribute('aria-haspopup', 'dialog')
    expect(flag).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(flag)
    expect(flag).toHaveAttribute('aria-expanded', 'true')
    const popover = screen.getByRole('dialog', { name: 'Horizon targets' })
    expect(popover).toHaveTextContent('No targets')
    expect(screen.queryByRole('heading', { name: 'Technology tree' })).not.toBeInTheDocument()
    fireEvent.click(flag)
    expect(screen.queryByRole('dialog', { name: 'Horizon targets' })).not.toBeInTheDocument()
  })

  it('shows the dot only when a valid target is set', () => {
    const { rerender } = render(<HorizonButton />)
    expect(screen.queryByTestId('horizon-dot')).not.toBeInTheDocument()
    useBlockStore.setState({ horizonTechnologyIds: ['gone'] })
    rerender(<HorizonButton />)
    expect(screen.queryByTestId('horizon-dot')).not.toBeInTheDocument()
    useBlockStore.setState({ horizonTechnologyIds: ['electronics'] })
    rerender(<HorizonButton />)
    expect(screen.getByTestId('horizon-dot')).toBeInTheDocument()
  })

  it('lists the valid targets and removes one in place', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['electronics', 'rocket-silo', 'gone'] })
    render(<HorizonButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Horizon: 2 technologies' }))
    const popover = screen.getByRole('dialog', { name: 'Horizon targets' })
    expect(within(popover).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(within(popover).getByRole('button', { name: 'Remove Electronics' }))
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual(['rocket-silo', 'gone'])
    expect(screen.getByRole('button', { name: 'Horizon: Rocket silo' })).toBeInTheDocument()
  })

  it('Clear horizon empties the targets', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['electronics'] })
    render(<HorizonButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Horizon: Electronics' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear horizon' }))
    expect(useBlockStore.getState().horizonTechnologyIds).toEqual([])
    expect(screen.getByRole('button', { name: 'Horizon: none' })).toBeInTheDocument()
  })

  it('moves focus to the edit button, and Escape closes it and refocuses the flag', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['electronics'] })
    render(<HorizonButton />)
    const flag = screen.getByRole('button', { name: 'Horizon: Electronics' })
    fireEvent.click(flag)
    expect(screen.getByRole('button', { name: 'Edit horizon…' })).toHaveFocus()
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    act(() => { document.activeElement!.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Horizon targets' })).not.toBeInTheDocument()
    expect(flag).toHaveFocus()
  })

  it('an outside click closes the popover without moving focus to the flag', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['electronics'] })
    render(<HorizonButton />)
    const flag = screen.getByRole('button', { name: 'Horizon: Electronics' })
    fireEvent.click(flag)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Horizon targets' })).not.toBeInTheDocument()
    expect(flag).not.toHaveFocus()
  })

  it('removing the last target moves focus to Choose technologies…', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['electronics'] })
    render(<HorizonButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Horizon: Electronics' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Electronics' }))
    expect(screen.getByRole('button', { name: 'Choose technologies…' })).toHaveFocus()
  })

  it('closing the tree returns focus to the flag', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['electronics'] })
    render(<HorizonButton />)
    const flag = screen.getByRole('button', { name: 'Horizon: Electronics' })
    fireEvent.click(flag)
    fireEvent.click(screen.getByRole('button', { name: 'Edit horizon…' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(flag).toHaveFocus()
  })

  it('Edit horizon… closes the popover and opens the tech tree', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['electronics'] })
    render(<HorizonButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Horizon: Electronics' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit horizon…' }))
    expect(screen.queryByRole('dialog', { name: 'Horizon targets' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Technology tree' })).toBeInTheDocument()
  })

  it('Choose technologies… opens the tech tree when there are no targets', () => {
    render(<HorizonButton />)
    openTree('Horizon: none')
    expect(screen.getByRole('heading', { name: 'Technology tree' })).toBeInTheDocument()
  })
})
