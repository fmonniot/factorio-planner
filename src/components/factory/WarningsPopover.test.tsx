import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WarningsPopover } from './WarningsPopover'
import { useSolverStore } from '../../store/solverStore'
import { useGameDataStore } from '../../store/gameDataStore'
import type { GameData, SolverResult } from '../../data/types'

// ---------------------------------------------------------------------------
// Minimal GameData with recipe and item names
// ---------------------------------------------------------------------------

const mockGameData: GameData = {
  factorioVersion: '2.0.0',
  modSet: {},
  items: {
    steam: { id: 'steam', name: 'Steam', type: 'fluid', iconPath: '', hidden: false },
    oxygen: { id: 'oxygen', name: 'Oxygen', type: 'fluid', iconPath: '', hidden: false },
  },
  recipes: {
    'smelt-a': { id: 'smelt-a', name: 'Smelt A', category: 'crafting', craftingTime: 1, ingredients: [], products: [], madeIn: [], allowProductivity: false, mainProduct: undefined, hidden: false },
    'smelt-b': { id: 'smelt-b', name: 'Smelt B', category: 'crafting', craftingTime: 1, ingredients: [], products: [], madeIn: [], allowProductivity: false, mainProduct: undefined, hidden: false },
    'boiler': { id: 'boiler', name: 'Boiler Recipe', category: 'crafting', craftingTime: 1, ingredients: [], products: [], madeIn: [], allowProductivity: false, mainProduct: undefined, hidden: false },
  },
  machines: {},
  modules: {},
  defaultMachines: {},
} as unknown as GameData

function setupWithWarnings(result: Partial<SolverResult>) {
  useGameDataStore.setState({ status: { type: 'loaded', gameData: mockGameData } })
  useSolverStore.setState({
    status: { type: 'idle' },
    lastResult: { nodes: [], unsatisfied: [], warnings: [], ...result },
    _setStatus: () => {},
  })
}

function openPopover() {
  fireEvent.click(screen.getByTitle('Show solver warnings'))
}

beforeEach(() => {
  useGameDataStore.setState({ status: { type: 'loaded', gameData: mockGameData } })
})

// ---------------------------------------------------------------------------
// too-many-alternatives
// ---------------------------------------------------------------------------

describe('WarningsPopover — too-many-alternatives', () => {
  beforeEach(() => {
    setupWithWarnings({ warnings: [{ type: 'too-many-alternatives', recipeIds: ['smelt-a', 'smelt-b'] }] })
    render(<WarningsPopover />)
    openPopover()
  })

  it('shows title "Ambiguous production split"', () => {
    expect(screen.getByText(/Ambiguous production split/i)).toBeInTheDocument()
  })

  it('body contains recipe names', () => {
    expect(screen.getByText(/Smelt A.*Smelt B/i)).toBeInTheDocument()
  })

  it('hint mentions pinning', () => {
    expect(screen.getByText(/pin one recipe/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// overconstrained
// ---------------------------------------------------------------------------

describe('WarningsPopover — overconstrained', () => {
  beforeEach(() => {
    setupWithWarnings({ warnings: [{ type: 'overconstrained', surplusItems: [{ itemId: 'steam', rate: 15 }, { itemId: 'oxygen', rate: 5 }] }] })
    render(<WarningsPopover />)
    openPopover()
  })

  it("shows title \"Recipe network can't fully balance\"", () => {
    expect(screen.getByText(/can't fully balance/i)).toBeInTheDocument()
  })

  it('body contains surplus item names', () => {
    expect(screen.getByText(/Steam.*Oxygen|Oxygen.*Steam/i)).toBeInTheDocument()
  })

  it('hint mentions material loop', () => {
    expect(screen.getByText(/material loop/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// infeasible-pins
// ---------------------------------------------------------------------------

describe('WarningsPopover — infeasible-pins', () => {
  beforeEach(() => {
    setupWithWarnings({ warnings: [{ type: 'infeasible-pins', recipeIds: ['boiler'] }] })
    render(<WarningsPopover />)
    openPopover()
  })

  it('shows title "Pinned rate is impossible"', () => {
    expect(screen.getByText(/Pinned rate is impossible/i)).toBeInTheDocument()
  })

  it('body contains the recipe name', () => {
    expect(screen.getByText(/Boiler Recipe/i)).toBeInTheDocument()
  })

  it('hint mentions unpinning', () => {
    expect(screen.getByText(/unpin/i)).toBeInTheDocument()
  })
})
