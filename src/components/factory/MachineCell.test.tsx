import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MachineCell } from './MachineCell'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import type { GameData, GameRecipeNode } from '../../data/types'

const machine = (id: string, name: string, craftingSpeed: number) => ({
  id, name, type: 'assembling-machine', craftingSpeed, energyUsageKw: 75, energyType: 'electric', drainKw: 0,
  moduleSlots: 2, allowedEffects: ['speed'], craftingCategories: ['crafting'], iconPath: '', hidden: false,
})

const gameData = {
  factorioVersion: '2.0.0', modSet: {}, items: {}, modules: {}, beacons: {}, technologies: {}, startingRecipes: [],
  itemGroups: {}, itemSubgroups: {},
  recipes: {
    plate: {
      id: 'plate', name: 'Plate', hidden: false, category: 'crafting', craftingTime: 1, ingredients: [],
      products: [{ itemId: 'plate', type: 'item', amount: 1 }], madeIn: [], allowProductivity: false, subgroup: '', order: '',
    },
  },
  machines: { am1: machine('am1', 'Assembler 1', 0.5), am2: machine('am2', 'Assembler 2', 0.75) },
  defaultMachines: { crafting: 'am1' },
} as unknown as GameData

beforeEach(() => {
  const block = makeEmptyBlock('T')
  const node: GameRecipeNode = { kind: 'game-recipe', id: 'n1', recipeId: 'plate', modules: [], byproductPolicy: {} }
  useBlockStore.setState({ blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [node] } }], activeBlockId: block.id, history: {}, horizonTechnologyIds: [] })
})

describe('MachineCell', () => {
  function renderCell() {
    return render(
      <MachineCell nodeId="n1" recipeId="plate" recipeCategory="crafting" machineId={undefined} machineCountCeil={3} gameData={gameData} />,
    )
  }

  it('opens the machine picker under the chip, listing icon, name and speed', () => {
    renderCell()
    expect(screen.queryByTestId('picker')).toBeNull()
    fireEvent.click(screen.getByTestId('machine-chip'))
    expect(screen.getAllByTestId('machine-option').map(o => o.getAttribute('data-machine-id'))).toEqual(['am1', 'am2'])
    expect(screen.getByText('speed 0.75')).toBeInTheDocument()
  })

  it('changes the machine type of the row and closes', () => {
    renderCell()
    fireEvent.click(screen.getByTestId('machine-chip'))
    fireEvent.click(screen.getByText('Assembler 2'))
    const node = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(node.kind === 'game-recipe' && node.machineId).toBe('am2')
    expect(screen.queryByTestId('picker')).toBeNull()
  })

  it('closes on Esc and on a press away, leaving the machine alone', () => {
    renderCell()
    fireEvent.click(screen.getByTestId('machine-chip'))
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByTestId('picker')).toBeNull()
    fireEvent.click(screen.getByTestId('machine-chip'))
    fireEvent.mouseDown(document.body)
    expect(screen.queryByTestId('picker')).toBeNull()
    const node = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    expect(node.kind === 'game-recipe' && node.machineId).toBeUndefined()
  })
})
