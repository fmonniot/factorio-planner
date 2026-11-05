import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModuleCell, mostUsedModule } from './ModuleCell'
import type { GameData } from '../../data/types'

const makeSpeedModule = () => ({
  id: 'speed-3',
  name: 'Speed 3',
  effects: { speed: 0.5, consumption: 0.7 },
  limitation: [],
  limitationBlacklist: [],
  hidden: false,
  tier: 3,
  qualityId: undefined,
})

describe('ModuleCell', () => {
  const makeData = () => ({
    items: {}, recipes: {}, machines: {}, beacons: {}, defaultMachines: {}, technologies: {},
    startingRecipes: [], modules: { 'speed-3': makeSpeedModule() },
  } as unknown as GameData)

  it('renders the slot text with zero slots when a module is configured', () => {
    render(<ModuleCell modules={[{ moduleId: 'speed-3', count: 1 }]} machineSlots={0} gameData={makeData()} onOpenEdit={() => {}} />)
    expect(screen.getByText('1/0')).toBeInTheDocument()
  })

  it('renders nothing with zero slots and no modules', () => {
    const { container } = render(<ModuleCell modules={[]} machineSlots={0} gameData={makeData()} onOpenEdit={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  const cell = () => screen.getByRole('button')
  const noop = () => {}

  it('does not claim a missing machine on a real machine with zero slots', () => {
    render(<ModuleCell modules={[{ moduleId: 'speed-3', count: 1 }]} machineSlots={0} gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('title', 'Edit modules (this machine has no module slots)')
    expect(cell()).not.toHaveAttribute('data-beyond-horizon')
    expect(cell()).toHaveAttribute('data-over-slots', 'true')
  })

  it('flags modules without a machine when the row has no machine', () => {
    render(<ModuleCell modules={[{ moduleId: 'speed-3', count: 1 }]} machineSlots={0} noMachine gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('title', 'Modules without a machine')
    expect(cell()).toHaveAttribute('data-beyond-horizon', 'true')
    expect(cell()).not.toHaveAttribute('data-over-slots')
  })

  it('flags more modules than slots', () => {
    render(<ModuleCell modules={[{ moduleId: 'speed-3', count: 4 }]} machineSlots={2} gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('data-over-slots', 'true')
    expect(cell()).toHaveAttribute('title', 'Edit modules (more modules than slots)')
    expect(cell()).toHaveClass('ring-amber-500')
    expect(cell()).not.toHaveAttribute('data-beyond-horizon')
  })

  it('is not flagged when the modules fit', () => {
    render(<ModuleCell modules={[{ moduleId: 'speed-3', count: 2 }]} machineSlots={2} gameData={makeData()} onOpenEdit={noop} />)
    expect(cell()).toHaveAttribute('title', 'Edit modules')
    expect(cell()).not.toHaveAttribute('data-over-slots')
    expect(cell()).not.toHaveClass('ring-amber-500')
  })
})

describe('ModuleCell chip', () => {
  const gd = () => ({
    items: {}, recipes: {}, machines: {}, beacons: {}, defaultMachines: {}, technologies: {}, startingRecipes: [],
    modules: { 'speed-3': makeSpeedModule(), 'eff-1': { ...makeSpeedModule(), id: 'eff-1', name: 'Efficiency 1', iconPath: '/e.png' } },
  } as unknown as GameData)

  it('shows an empty machine as a dashed plus reading 0/N', () => {
    const { container } = render(<ModuleCell modules={[]} machineSlots={4} gameData={gd()} onOpenEdit={() => {}} />)
    expect(screen.getByText('0/4')).toBeInTheDocument()
    expect(container.querySelector('.border-dashed')).not.toBeNull()
  })

  it('shows the most used module type, the first by id on a tie', () => {
    expect(mostUsedModule([{ moduleId: 'speed-3', count: 1 }, { moduleId: 'eff-1', count: 3 }])).toBe('eff-1')
    expect(mostUsedModule([{ moduleId: 'speed-3', count: 2 }, { moduleId: 'eff-1', count: 2 }])).toBe('eff-1')
    expect(mostUsedModule([{ moduleId: 'speed-3', count: 1 }, { moduleId: 'speed-3', count: 2 }, { moduleId: 'eff-1', count: 2 }])).toBe('speed-3')
    expect(mostUsedModule([])).toBeUndefined()
  })

  it('draws used/slots in the bottom-right corner', () => {
    render(<ModuleCell modules={[{ moduleId: 'speed-3', count: 2 }]} machineSlots={4} gameData={gd()} onOpenEdit={() => {}} />)
    expect(screen.getByText('2/4')).toHaveClass('right-0', 'bottom-0')
  })
})
