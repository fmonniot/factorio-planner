import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BeaconPopover } from './BeaconPopover'
import { useBlockStore, makeEmptyBlock } from '../../store/blockStore'
import type { GameData, BeaconConfig, RecipeNode } from '../../data/types'

const speedModule = {
  id: 'speed-3',
  name: 'Speed 3',
  effects: { speed: 0.5, consumption: 0.7 },
  limitation: [],
  limitationBlacklist: [],
  hidden: false,
  tier: 3,
  qualityId: undefined,
}

const mockGameData = {
  modules: { 'speed-3': speedModule },
} as unknown as GameData

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

describe('BeaconPopover', () => {
  it('renders the beacon count field', () => {
    render(
      <BeaconPopover
        nodeId="n1"
        beacon={beacon}
        gameData={mockGameData}
        onClose={() => {}}
      />
    )
    expect(screen.getByDisplayValue('4')).toBeInTheDocument()
  })

  it('calls updateNodeBeacon(undefined) when Remove beacon is clicked', () => {
    const onClose = () => {}
    render(
      <BeaconPopover
        nodeId="n1"
        beacon={beacon}
        gameData={mockGameData}
        onClose={onClose}
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
      <BeaconPopover
        nodeId="n1"
        beacon={beacon}
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
