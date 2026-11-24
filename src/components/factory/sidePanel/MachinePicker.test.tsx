import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MachinePicker } from './MachinePicker'
import { recipeFallbackKey } from '../../../data/horizon'
import type { GameData } from '../../../data/types'

// The horizon the picker sees: the primary category has no default, the row falls back to the electronics machine.
vi.mock('../../../store/horizon', () => ({
  useHorizon: () => ({
    recipeIds: null, itemIds: null, machineIds: null, moduleIds: null,
    defaultMachines: { [recipeFallbackKey('circuit')]: 'elec' },
  }),
  useAvailableRecipeIds: () => null,
}))

const machine = (id: string, name: string, categories: string[]) => ({
  id, name, type: 'assembling-machine', craftingSpeed: 1, energyUsageKw: 75, energyType: 'electric', drainKw: 0,
  moduleSlots: 2, allowedEffects: ['speed'], craftingCategories: categories, iconPath: '', hidden: false,
})

const gameData = {
  factorioVersion: '2.0.0', modSet: {}, items: {}, modules: {}, beacons: {}, technologies: {}, startingRecipes: [],
  itemGroups: {}, itemSubgroups: {},
  recipes: {
    circuit: {
      id: 'circuit', name: 'Circuit', hidden: false, category: 'crafting', additionalCategories: ['electronics'], craftingTime: 1,
      ingredients: [], products: [{ itemId: 'circuit', type: 'item', amount: 1 }], madeIn: [], allowProductivity: false, subgroup: '', order: '',
    },
  },
  machines: { elec: machine('elec', 'Electronics machine', ['electronics']) },
  defaultMachines: { crafting: 'am-gone' },
} as unknown as GameData

describe('MachinePicker with an additional-category fallback', () => {
  it('names the fallback machine in the Default row', () => {
    render(<MachinePicker nodeId="n1" recipeId="circuit" recipeCategory="crafting" machineId={undefined} gameData={gameData} onDone={() => {}} />)
    expect(screen.getByTestId('machine-option-default')).toHaveTextContent('Default (Electronics machine)')
  })

  it('says on a row-only machine why it has no default, as tooltip and description', () => {
    render(<MachinePicker nodeId="n1" recipeId="circuit" recipeCategory="crafting" machineId={undefined} gameData={gameData} onDone={() => {}} />)
    const label = screen.getByTestId('row-only-label')
    expect(label).not.toHaveAttribute('title')
    expect(label.getAttribute('data-tip')).toMatch(/^Defaults are per primary category/)
    expect(screen.getByTestId('machine-option')).toHaveAccessibleDescription(label.getAttribute('data-tip')!)
  })
})
