import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
    expect(label.getAttribute('data-tip')).toBe('It only crafts an additional category of the recipe, not its primary category (Crafting).')
    expect(screen.getByTestId('machine-option')).toHaveAccessibleDescription(label.getAttribute('data-tip')!)
  })
})

describe('MachinePicker keyboard', () => {
  it('opens on the Default row and ArrowDown walks every button in DOM order, wrapping at the end', () => {
    render(<MachinePicker nodeId="n1" recipeId="circuit" recipeCategory="crafting" machineId={undefined} gameData={gameData} onDone={() => {}} />)
    const stops = Array.from(screen.getByTestId('picker').querySelectorAll<HTMLElement>('button:not(:disabled)'))
    expect(stops.map(b => b.textContent), 'Default, the machine, then All defaults').toEqual(
      expect.arrayContaining([expect.stringContaining('Default (Electronics machine)'), expect.stringContaining('All defaults')]),
    )
    expect(stops.length).toBeGreaterThanOrEqual(3)
    expect(stops[0]).toHaveFocus()
    const visited: Element[] = [document.activeElement!]
    for (let i = 1; i < stops.length; i++) {
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
      visited.push(document.activeElement!)
    }
    expect(visited).toEqual(stops)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(stops[0], 'wraps to the Default row').toHaveFocus()
  })

  it('opens on the machine the row uses', () => {
    render(<MachinePicker nodeId="n1" recipeId="circuit" recipeCategory="crafting" machineId="elec" gameData={gameData} onDone={() => {}} />)
    expect(screen.getByTestId('machine-option')).toHaveFocus()
    expect(screen.getByTestId('machine-option')).toHaveAttribute('aria-current', 'true')
  })
})
