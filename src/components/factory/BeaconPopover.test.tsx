import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BeaconModal } from './BeaconModal'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import type { GameData, BeaconConfig, RecipeNode } from '../../data/types'

const speedModule = {
  id: 'speed-3',
  name: 'Speed 3',
  iconPath: '',
  effects: { speed: 0.5, consumption: 0.7 },
  limitation: [],
  limitationBlacklist: [],
  hidden: false,
  tier: 3,
}

const mockGameData: GameData = {
  factorioVersion: '2.0.0',
  modSet: {},
  items: {},
  recipes: {
    'iron-plate': {
      id: 'iron-plate',
      name: 'Iron Plate',
      hidden: false,
      category: 'crafting',
      craftingTime: 1,
      ingredients: [],
      products: [{ itemId: 'iron-plate', type: 'item', amount: 1 }],
      madeIn: [],
      allowProductivity: false,
      mainProduct: undefined,
    },
  },
  machines: {},
  modules: { 'speed-3': speedModule },
  beacons: {},
  defaultMachines: {},
}

const beacon: BeaconConfig = {
  moduleId: 'speed-3',
  beaconCount: 4,
  modulesPerBeacon: 2,
  distributionEfficiency: 0.5,
}

const node: RecipeNode = {
  kind: 'game-recipe',
  id: 'n1',
  recipeId: 'iron-plate',
  modules: [],
  byproductPolicy: {},
  beaconConfig: beacon,
}

beforeEach(() => {
  const block = makeEmptyBlock('Test')
  const rootPlan = { ...block.rootPlan, nodes: [node] }
  useBlockStore.setState({
    blocks: [{ ...block, rootPlan }],
    activeBlockId: block.id,
    activeSubPlanId: rootPlan.id,
    history: {},
  })
})

describe('BeaconModal', () => {
  it('renders the beacon count field', () => {
    render(
      <BeaconModal
        nodeId="n1"
        beacon={beacon}
        recipeId="iron-plate"
        machineId={undefined}
        recipeCategory="crafting"
        gameData={mockGameData}
        onClose={() => {}}
      />
    )
    expect(screen.getByDisplayValue('4')).toBeInTheDocument()
  })

  it('calls updateNodeBeacon(undefined) when Remove beacon is clicked', () => {
    render(
      <BeaconModal
        nodeId="n1"
        beacon={beacon}
        recipeId="iron-plate"
        machineId={undefined}
        recipeCategory="crafting"
        gameData={mockGameData}
        onClose={() => {}}
      />
    )
    fireEvent.click(screen.getByText('Remove beacon'))
    const updatedNode = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    if (updatedNode.kind === 'game-recipe') {
      expect(updatedNode.beaconConfig).toBeUndefined()
    }
  })

  it('updates beaconCount on input change', () => {
    render(
      <BeaconModal
        nodeId="n1"
        beacon={beacon}
        recipeId="iron-plate"
        machineId={undefined}
        recipeCategory="crafting"
        gameData={mockGameData}
        onClose={() => {}}
      />
    )
    const input = screen.getByDisplayValue('4')
    fireEvent.change(input, { target: { value: '8' } })
    const updatedNode = useBlockStore.getState().blocks[0].rootPlan.nodes[0]
    if (updatedNode.kind === 'game-recipe') {
      expect(updatedNode.beaconConfig?.beaconCount).toBe(8)
    }
  })
})
