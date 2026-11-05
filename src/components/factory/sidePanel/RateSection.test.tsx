import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RateSection } from './RateSection'
import { useBlockStore, makeEmptyBlock } from '../../../store/blockStore'
import { useUiStore } from '../../../store/uiStore'
import type { GameData, GameRecipeNode, SolvedNode } from '../../../data/types'

/** Electrolysis makes 6 hydrogen per run; iron plate 1 per run. Fresh each call. */
function makeGameData(): GameData {
  return {
    factorioVersion: '2.0.0', modSet: {},
    items: {
      hydrogen: { id: 'hydrogen', name: 'Hydrogen', type: 'fluid', iconPath: '', hidden: false },
      oxygen: { id: 'oxygen', name: 'Oxygen', type: 'fluid', iconPath: '', hidden: false },
      water: { id: 'water', name: 'Water', type: 'fluid', iconPath: '', hidden: false },
      'iron-plate': { id: 'iron-plate', name: 'Iron Plate', type: 'item', iconPath: '', hidden: false },
    },
    recipes: {
      electrolysis: {
        id: 'electrolysis', name: 'Electrolysis', category: 'chemistry', craftingTime: 2,
        ingredients: [{ itemId: 'water', type: 'fluid', amount: 100 }],
        products: [{ itemId: 'hydrogen', type: 'fluid', amount: 6 }, { itemId: 'oxygen', type: 'fluid', amount: 3 }],
        madeIn: [], allowProductivity: false, hidden: false, mainProduct: 'hydrogen',
      },
      'iron-plate': {
        id: 'iron-plate', name: 'Iron Plate', category: 'smelting', craftingTime: 3.2, ingredients: [],
        products: [{ itemId: 'iron-plate', type: 'item', amount: 1 }], madeIn: [], allowProductivity: true, hidden: false, mainProduct: 'iron-plate',
      },
      'power:reactor:fuel': {
        id: 'power:reactor:fuel', name: 'Reactor fuel', category: 'power:reactor', craftingTime: 1, ingredients: [],
        products: [{ itemId: 'power:heat', type: 'fluid', amount: 10 }], madeIn: ['reactor'], allowProductivity: false, hidden: false, mainProduct: undefined,
      },
    },
    machines: {
      reactor: {
        id: 'reactor', name: 'Reactor', type: 'reactor', craftingSpeed: 1, energyUsageKw: 0, energyType: 'electric',
        drainKw: 0, moduleSlots: 0, allowedEffects: [], craftingCategories: ['power:reactor'], neighbourBonus: 1, iconPath: '', hidden: false,
      },
    },
    modules: {}, beacons: {}, defaultMachines: { 'power:reactor': 'reactor' }, itemGroups: {}, itemSubgroups: {}, technologies: {}, startingRecipes: [],
  } as unknown as GameData
}

const electrolysis = (over: Partial<GameRecipeNode> = {}): GameRecipeNode =>
  ({ kind: 'game-recipe', id: 'n1', recipeId: 'electrolysis', modules: [], byproductPolicy: {}, ...over })

const solved = (over: Partial<SolvedNode> = {}): SolvedNode => ({
  recipeNodeId: 'n1', inputRates: { water: 100 }, outputRates: { hydrogen: 60, oxygen: 30 },
  throughput: 10, machineCountExact: 1, machineCountCeil: 1, powerKw: 50, ...over,
})

function setRow(node: GameRecipeNode) {
  const block = makeEmptyBlock('Test')
  useBlockStore.setState({ blocks: [{ ...block, rootPlan: { ...block.rootPlan, nodes: [node] } }], activeBlockId: block.id, history: {} })
}
const stored = () => (useBlockStore.getState().blocks[0].rootPlan.nodes[0] as GameRecipeNode).pinnedRate
const gd = makeGameData()
const renderRate = (node: GameRecipeNode, s: SolvedNode | undefined = solved(), gameData: GameData = gd) => {
  setRow(node)
  return render(<RateSection node={node} solved={s} gameData={gameData} />)
}

beforeEach(() => {
  useUiStore.setState({ rateUnit: 'min' })
})

describe('RateSection — pin', () => {
  it('has an unchecked pin checkbox and no rate input for an unpinned row', () => {
    renderRate(electrolysis())
    expect(screen.getByRole('checkbox', { name: 'Pin rate' })).not.toBeChecked()
    expect(screen.queryByLabelText('Pinned rate')).not.toBeInTheDocument()
    expect(screen.getByTestId('runs-per-min')).toHaveTextContent('= 10.0 runs/min')
  })

  it('pins at the current throughput, and unpins', () => {
    setRow(electrolysis())
    function Live() {
      const node = useBlockStore(st => st.blocks[0].rootPlan.nodes[0]) as GameRecipeNode
      return <RateSection node={node} solved={solved()} gameData={gd} />
    }
    render(<Live />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pin rate' }))
    expect(stored()).toBe(10)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pin rate' }))
    expect(stored()).toBeUndefined()
  })

  it('pins at a value above 0 even when the throughput is 0', () => {
    renderRate(electrolysis(), solved({ throughput: 0 }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pin rate' }))
    expect(stored()).toBeGreaterThan(0)
  })

  it('cannot pin a row that absorbs a byproduct', () => {
    renderRate(electrolysis({ byproductConsumer: true }))
    expect(screen.getByRole('checkbox', { name: 'Pin rate' })).toBeDisabled()
  })
})

describe('RateSection — pinned rate', () => {
  // Electrolysis makes 6 hydrogen per run (60 / 10 in solved()): the pin is shown and typed as the hydrogen rate, stored as runs per minute.
  it('shows the pinned runs as the primary product rate in the current unit', () => {
    const pinned = electrolysis({ pinnedRate: 20 }) // 20 runs/min * 6 hydrogen = 120/min
    const { unmount } = renderRate(pinned)
    expect(screen.getByLabelText('Pinned rate')).toHaveValue(120)
    expect(screen.getByTestId('runs-per-min')).toHaveTextContent('= 20.0 runs/min')
    unmount()
    useUiStore.setState({ rateUnit: 'sec' })
    renderRate(pinned)
    expect(screen.getByLabelText('Pinned rate')).toHaveValue(2)
  })

  it('typing a product rate in /min mode stores runs = rate / items per run', () => {
    renderRate(electrolysis({ pinnedRate: 1 }))
    fireEvent.change(screen.getByLabelText('Pinned rate'), { target: { value: '120' } })
    expect(stored()).toBeCloseTo(20)
  })

  it('typing a product rate in /sec mode stores value * 60 / items per run', () => {
    useUiStore.setState({ rateUnit: 'sec' })
    renderRate(electrolysis({ pinnedRate: 1 }))
    fireEvent.change(screen.getByLabelText('Pinned rate'), { target: { value: '5' } })
    expect(stored()).toBeCloseTo(50)
  })

  it('shows the pin unchanged for a single-product amount-1 recipe', () => {
    const node: GameRecipeNode = { kind: 'game-recipe', id: 'n1', recipeId: 'iron-plate', modules: [], byproductPolicy: {}, pinnedRate: 30 }
    renderRate(node, solved({ outputRates: { 'iron-plate': 30 }, throughput: 30 }))
    expect(screen.getByLabelText('Pinned rate')).toHaveValue(30)
  })

  it('keeps the input mounted and its factor when the solve later zeroes the node', () => {
    const pinned = electrolysis({ pinnedRate: 10 })
    const prod = solved({ outputRates: { hydrogen: 66 } }) // productivity: 6.6 per run
    const { rerender } = renderRate(pinned, prod)
    const input = screen.getByLabelText('Pinned rate')
    fireEvent.change(input, { target: { value: '66' } })
    rerender(<RateSection node={pinned} solved={{ ...prod, throughput: 0 }} gameData={gd} />)
    expect(screen.getByLabelText('Pinned rate')).toBe(input)
    expect(input).toHaveValue(66)
  })

  it('applies the heat bonus when converting a typed pin with no solved throughput', () => {
    const node: GameRecipeNode = {
      kind: 'game-recipe', id: 'n1', recipeId: 'power:reactor:fuel', modules: [], byproductPolicy: {}, neighbourCount: 3, pinnedRate: 1,
    }
    renderRate(node, solved({ inputRates: {}, outputRates: { 'power:heat': 0 }, throughput: 0, machineCountExact: 0, machineCountCeil: 0, powerKw: 0 }))
    // 10 heat/run * (1 + 1 * 3) = 40 heat/run; energy items are typed per second.
    fireEvent.change(screen.getByLabelText('Pinned rate'), { target: { value: '20' } })
    expect(stored()).toBeCloseTo(30) // 20 * 60 / 40
  })
})
