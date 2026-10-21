import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ModuleCell } from './ModuleCell'
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
