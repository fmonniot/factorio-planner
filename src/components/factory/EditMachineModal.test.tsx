import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditMachineModal } from './EditMachineModal'
import { useBlockStore } from '../../store/blockStore'
import { useGameDataStore } from '../../store/gameDataStore'
import type { GameData } from '../../data/types'

function recipe(id: string, name: string): GameData['recipes'][string] {
  return {
    id, name, category: 'crafting', craftingTime: 1,
    ingredients: [], products: [{ itemId: 'plate', type: 'item', amount: 1 }],
    madeIn: ['assembler'], allowProductivity: false, hidden: false,
    mainProduct: undefined, subgroup: '', order: '',
  }
}

function makeGameData(): GameData {
  return {
    factorioVersion: '2.0.0',
    modSet: {},
    items: {},
    recipes: { plate: recipe('plate', 'Plate'), 'plate-alt': recipe('plate-alt', 'Plate (alternate)') },
    machines: {
      assembler: {
        id: 'assembler', name: 'Assembler', type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 75,
        energyType: 'electric', drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: ['crafting'],
        iconPath: '', hidden: false,
      },
    },
    modules: {},
    beacons: {},
    defaultMachines: { crafting: 'assembler' },
    itemGroups: {},
    itemSubgroups: {},
    technologies: {
      base: { id: 'base', name: 'Base', prerequisites: [], unlockedRecipes: ['plate'] },
      alt: { id: 'alt', name: 'Alt', prerequisites: [], unlockedRecipes: ['plate-alt'] },
    },
    startingRecipes: [],
  }
}

function renderModal(gameData: GameData) {
  useGameDataStore.setState({ status: { type: 'loaded', gameData, sourceId: 'test' } })
  render(
    <EditMachineModal
      nodeId="n1"
      recipeId="plate"
      recipeCategory="crafting"
      machineId={undefined}
      machineCountCeil={1}
      modules={[]}
      gameData={gameData}
      onClose={() => {}}
    />,
  )
  fireEvent.click(screen.getByText(/machines$/))
}

beforeEach(() => {
  useBlockStore.setState({ horizonTechnologyIds: [] })
})

describe('EditMachineModal — alternate recipes and the research horizon', () => {
  it('omits an alternate recipe outside the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base'] })
    renderModal(makeGameData())
    expect(screen.queryByText('Plate (alternate)')).not.toBeInTheDocument()
  })

  it('lists the alternate recipe when it is inside the horizon', () => {
    useBlockStore.setState({ horizonTechnologyIds: ['base', 'alt'] })
    renderModal(makeGameData())
    expect(screen.getByText('Plate (alternate)')).toBeInTheDocument()
  })

  it('lists the alternate recipe without targets', () => {
    renderModal(makeGameData())
    expect(screen.getByText('Plate (alternate)')).toBeInTheDocument()
  })
})
